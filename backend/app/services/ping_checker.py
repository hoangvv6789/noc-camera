import asyncio
import ctypes
import struct
import platform
import time
import gc
import logging
from ctypes import wintypes
from datetime import datetime, timezone, timedelta
from typing import Tuple, Optional, List, Dict
from sqlmodel import Session, select

from app.models import Camera, NetworkMapping, AlertLog
from app.config import settings
from app.services.alert_manager import broadcast_status_change
from app.database import engine, shrink_sqlite_memory

logger = logging.getLogger(__name__)

IS_WINDOWS = platform.system().lower() == "windows"

# ─────────────────────────────────────────────────────────────
# WINDOWS NATIVE ICMP PING (iphlpapi.dll)
# Chạy trực tiếp trong tiến trình (In-Process), KHÔNG tạo subprocess ping.exe
# -> Tránh triệt để rò rỉ bộ nhớ (memory leak) và handle leak của Windows IOCP
# ─────────────────────────────────────────────────────────────
if IS_WINDOWS:
    try:
        iphlpapi = ctypes.WinDLL("iphlpapi.dll")
        ws2_32 = ctypes.WinDLL("ws2_32.dll")

        iphlpapi.IcmpCreateFile.restype = wintypes.HANDLE
        iphlpapi.IcmpCloseHandle.argtypes = [wintypes.HANDLE]
        iphlpapi.IcmpCloseHandle.restype = wintypes.BOOL

        iphlpapi.IcmpSendEcho.argtypes = [
            wintypes.HANDLE,
            wintypes.DWORD,
            wintypes.LPVOID,
            wintypes.WORD,
            wintypes.LPVOID,
            wintypes.LPVOID,
            wintypes.DWORD,
            wintypes.DWORD,
        ]
        iphlpapi.IcmpSendEcho.restype = wintypes.DWORD

        ws2_32.inet_addr.argtypes = [ctypes.c_char_p]
        ws2_32.inet_addr.restype = wintypes.DWORD
        NATIVE_ICMP_AVAILABLE = True
    except Exception as e:
        logger.warning(f"Không thể nạp Windows native ICMP ping: {e}")
        NATIVE_ICMP_AVAILABLE = False
else:
    NATIVE_ICMP_AVAILABLE = False


def now_utc() -> datetime:
    """Trả về UTC hiện tại."""
    return datetime.now(timezone.utc)


def _windows_icmp_ping(ip_str: str, timeout_ms: int = 1000) -> Tuple[bool, Optional[float]]:
    """Gửi 1 gói ICMP echo trực tiếp qua Win32 API."""
    if not NATIVE_ICMP_AVAILABLE:
        return False, None

    h_icmp = iphlpapi.IcmpCreateFile()
    if not h_icmp:
        return False, None

    try:
        dest_addr = ws2_32.inet_addr(ip_str.encode("ascii"))
        if dest_addr == 0xFFFFFFFF and ip_str != "255.255.255.255":
            return False, None

        data = b"ping"
        reply_size = 128
        reply_buf = ctypes.create_string_buffer(reply_size)

        res = iphlpapi.IcmpSendEcho(
            h_icmp,
            dest_addr,
            data,
            len(data),
            None,
            reply_buf,
            reply_size,
            timeout_ms
        )
        if res > 0:
            status, rtt = struct.unpack_from("<II", reply_buf.raw, 4)
            if status == 0:
                return True, float(max(1, rtt))
        return False, None
    except Exception:
        return False, None
    finally:
        iphlpapi.IcmpCloseHandle(h_icmp)


async def ping_single(ip: str, timeout: float) -> Tuple[str, bool, Optional[float]]:
    """
    Ping một IP:
    1. Ưu tiên Windows Native ICMP (không tạo tiến trình).
    2. Fallback sang TCP port 80/554 nếu ICMP bị chặn.
    """
    timeout_ms = int(timeout * 1000)

    # 1. Native ICMP Ping
    if IS_WINDOWS and NATIVE_ICMP_AVAILABLE:
        alive, rtt = await asyncio.to_thread(_windows_icmp_ping, ip, timeout_ms)
        if alive:
            return ip, True, rtt
    else:
        # Linux/Mac fallback ICMP
        try:
            cmd = ["ping", "-c", "1", "-W", str(int(max(1, timeout))), ip]
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await process.communicate()
            if process.returncode == 0:
                output = stdout.decode("utf-8", errors="ignore").lower()
                latency_ms = 1.0
                if "time=" in output:
                    try:
                        part = output.split("time=")[1].split(" ")[0].strip()
                        latency_ms = float(part)
                    except Exception:
                        pass
                return ip, True, latency_ms
        except Exception:
            pass

    # 2. Fallback TCP Port 80 (HTTP) hoặc 554 (RTSP)
    for port in (80, 554):
        writer = None
        try:
            start = time.perf_counter()
            _, writer = await asyncio.wait_for(
                asyncio.open_connection(ip, port), timeout=timeout
            )
            latency = (time.perf_counter() - start) * 1000
            return ip, True, max(1.0, latency)
        except Exception:
            continue
        finally:
            if writer:
                try:
                    writer.close()
                    await writer.wait_closed()
                except Exception:
                    pass

    return ip, False, None


async def ping_worker(semaphore: asyncio.Semaphore, cam_info: Tuple[int, str, str]) -> Tuple[int, str, str, bool, Optional[float]]:
    """Ping 1 camera mà KHÔNG giữ database session."""
    cam_id, cam_name, cam_ip = cam_info
    async with semaphore:
        _, alive, latency_ms = await ping_single(cam_ip, settings.PING_TIMEOUT)
        return cam_id, cam_name, cam_ip, alive, latency_ms


def cleanup_old_alerts(session: Session, max_records: int = 5000):
    """Giữ lại tối đa `max_records` alerts gần nhất để tránh phình to database."""
    try:
        total = session.exec(select(AlertLog)).all()
        if len(total) > max_records:
            # Xóa các alert cũ nhất
            to_delete = total[:-max_records]
            for a in to_delete:
                session.delete(a)
    except Exception:
        pass


async def ping_all_cameras(session: Session = None):
    """
    Ping toàn bộ camera trong DB:
    - Bước 1: Đọc nhanh danh sách (id, name, ip) và đóng session đọc.
    - Bước 2: Thực hiện ping mạng song song hoàn toàn trong RAM (không chạm DB).
    - Bước 3: Mở 1 session ngắn, batch update mapping + alert trong 1 transaction.
    - Bước 4: Thu hồi RAM triệt để với shrink_sqlite_memory() và gc.collect().
    """
    # ── Bước 1: Lấy danh sách toàn bộ camera trong DB
    with Session(engine) as read_session:
        cameras_raw = read_session.exec(
            select(Camera.id, Camera.name, Camera.ip)
        ).all()
        camera_list = [(c[0], c[1], c[2]) for c in cameras_raw]

    if not camera_list:
        logger.info("Chưa có camera nào trong cơ sở dữ liệu để ping.")
        return

    logger.info(f"Bắt đầu ping {len(camera_list)} cameras...")
    semaphore = asyncio.Semaphore(settings.PING_CONCURRENCY)

    # ── Bước 2: Ping song song qua async tasks
    tasks = [ping_worker(semaphore, cam) for cam in camera_list]
    results = await asyncio.gather(*tasks)

    # ── Bước 3: Batch Update vào DB trong 1 session duy nhất
    ts = now_utc()
    status_changes = []

    with Session(engine) as write_session:
        try:
            # Lấy tất cả camera và mapping hiện có
            cams = write_session.exec(select(Camera)).all()
            cam_dict: Dict[int, Camera] = {c.id: c for c in cams if c.id}

            mappings = write_session.exec(select(NetworkMapping)).all()
            mapping_dict: Dict[int, NetworkMapping] = {m.camera_id: m for m in mappings}

            for cam_id, cam_name, cam_ip, alive, latency_ms in results:
                new_status = "ONLINE" if alive else "OFFLINE"
                
                # Cập nhật model Camera
                cam_obj = cam_dict.get(cam_id)
                if cam_obj:
                    cam_obj.nvr_status = new_status
                    write_session.add(cam_obj)

                mapping = mapping_dict.get(cam_id)
                if mapping:
                    old_status = mapping.status
                    mapping.status = new_status
                    mapping.latency_ms = latency_ms
                    if alive:
                        mapping.last_seen_at = ts
                    write_session.add(mapping)

                    if old_status != new_status:
                        event_type = "OFFLINE" if not alive else "RECOVERED"
                        alert = AlertLog(
                            camera_id=cam_id,
                            event_type=event_type,
                            timestamp=ts,
                        )
                        write_session.add(alert)
                        status_changes.append((cam_id, cam_name, cam_ip, old_status, new_status, latency_ms))
                else:
                    mapping = NetworkMapping(
                        camera_id=cam_id,
                        switch_id=None,
                        switch_port=None,
                        status=new_status,
                        latency_ms=latency_ms,
                        last_seen_at=ts if alive else None,
                    )
                    write_session.add(mapping)

            # Dọn dẹp log cũ
            cleanup_old_alerts(write_session)
            write_session.commit()
            logger.info(f"Đã hoàn thành ping {len(camera_list)} cameras.")

        except Exception as e:
            logger.error(f"Lỗi khi cập nhật kết quả ping vào DB: {e}", exc_info=True)
            write_session.rollback()

    # ── Bước 4: Broadcast WebSocket sau khi commit DB xong
    for cam_id, cam_name, cam_ip, old_status, new_status, latency_ms in status_changes:
        try:
            await broadcast_status_change(
                camera_id=cam_id,
                camera_name=cam_name,
                camera_ip=cam_ip,
                old_status=old_status,
                new_status=new_status,
                latency_ms=latency_ms,
            )
        except Exception:
            pass

    # ── Bước 5: Giải phóng RAM và shrink bộ đệm SQLite
    shrink_sqlite_memory()
    gc.collect()


async def ping_single_camera_by_id(camera_id: int) -> dict:
    """
    Ping kiểm tra 1 camera cụ thể theo ID:
    - Gửi ICMP Ping (hoặc Fallback TCP port 80/554) tới IP của camera.
    - Cập nhật NetworkMapping (status, latency_ms, last_seen_at nếu online).
    - Tạo AlertLog và broadcast status_change nếu có thay đổi trạng thái.
    - Trả về kết quả chi tiết cho người dùng ngay lập tức.
    """
    with Session(engine) as session:
        camera = session.get(Camera, camera_id)
        if not camera:
            return {"success": False, "message": "Không tìm thấy camera trong cơ sở dữ liệu."}
        
        mapping = session.exec(select(NetworkMapping).where(NetworkMapping.camera_id == camera.id)).first()
        old_status = mapping.status if mapping else "UNKNOWN"
        cam_ip = camera.ip
        cam_name = camera.name

    # Thực hiện ping ngoài session DB để tránh lock DB
    _, alive, latency_ms = await ping_single(cam_ip, timeout=settings.PING_TIMEOUT)
    new_status = "ONLINE" if alive else "OFFLINE"
    ts = now_utc()

    with Session(engine) as session:
        mapping = session.exec(select(NetworkMapping).where(NetworkMapping.camera_id == camera_id)).first()
        if not mapping:
            mapping = NetworkMapping(
                camera_id=camera_id,
                switch_id=None,
                switch_port=None,
                status=new_status,
                latency_ms=latency_ms,
                last_seen_at=ts if alive else None,
            )
            session.add(mapping)
        else:
            mapping.status = new_status
            mapping.latency_ms = latency_ms
            if alive:
                mapping.last_seen_at = ts
            session.add(mapping)

        # Nếu thay đổi trạng thái -> ghi log AlertLog
        if old_status != new_status:
            event_type = "OFFLINE" if not alive else "RECOVERED"
            alert = AlertLog(
                camera_id=camera_id,
                event_type=event_type,
                timestamp=ts,
            )
            session.add(alert)

        cleanup_old_alerts(session)
        session.commit()
        shrink_sqlite_memory()

    # Broadcast websocket event
    if old_status != new_status:
        try:
            await broadcast_status_change(
                camera_id=camera_id,
                camera_name=cam_name,
                camera_ip=cam_ip,
                old_status=old_status,
                new_status=new_status,
                latency_ms=latency_ms,
            )
        except Exception:
            pass

    msg = f"Camera '{cam_name}' ({cam_ip}) phản hồi tốt ({latency_ms:.1f} ms)" if alive else f"Camera '{cam_name}' ({cam_ip}) không phản hồi (Mất kết nối)"

    return {
        "success": True,
        "alive": alive,
        "camera_id": camera_id,
        "camera_name": cam_name,
        "camera_ip": cam_ip,
        "status": new_status,
        "latency_ms": latency_ms,
        "message": msg,
    }
