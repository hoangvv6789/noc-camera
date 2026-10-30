import asyncio
import json
import logging
import platform
import time
import gc
from datetime import datetime, timezone
from typing import Dict, Any, Tuple, Optional, List
from sqlmodel import Session, select

from app.models import NVR, Camera, NetworkMapping, AlertLog
from app.config import settings
from app.database import engine, shrink_sqlite_memory
from app.services.alert_manager import broadcast_nvr_status_change, broadcast_status_change
from app.services.ping_checker import _windows_icmp_ping, IS_WINDOWS, NATIVE_ICMP_AVAILABLE

logger = logging.getLogger(__name__)


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


async def ping_ip(ip: str, timeout: float) -> Tuple[bool, Optional[float]]:
    """Kiểm tra Ping ICMP đến IP đầu ghi NVR (In-Process, 0 subprocess)."""
    timeout_ms = int(timeout * 1000)
    if IS_WINDOWS and NATIVE_ICMP_AVAILABLE:
        return await asyncio.to_thread(_windows_icmp_ping, ip, timeout_ms)

    # Fallback Linux/Mac
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
            return True, latency_ms
        return False, None
    except Exception as e:
        logger.debug(f"Lỗi ping NVR {ip}: {e}")
        return False, None


async def probe_tcp_port(ip: str, port: int, port_name: str, timeout: float) -> Dict[str, Any]:
    """Kiểm tra kết nối TCP socket tới cổng dịch vụ của NVR, đảm bảo đóng socket triệt để."""
    start = time.perf_counter()
    writer = None
    try:
        _, writer = await asyncio.wait_for(
            asyncio.open_connection(ip, port),
            timeout=timeout
        )
        latency = round((time.perf_counter() - start) * 1000, 1)

        # Nếu là port RTSP (554), gửi probe RTSP OPTIONS
        if port == 554:
            try:
                probe_req = f"OPTIONS rtsp://{ip}:{port}/ RTSP/1.0\r\nCSeq: 1\r\nUser-Agent: NVR-Probe\r\n\r\n"
                writer.write(probe_req.encode())
                await asyncio.wait_for(writer.drain(), timeout=1.0)
            except Exception:
                pass

        return {
            "port": port,
            "name": port_name,
            "alive": True,
            "latency_ms": latency,
            "error": None
        }
    except asyncio.TimeoutError:
        return {
            "port": port,
            "name": port_name,
            "alive": False,
            "latency_ms": None,
            "error": "Timeout (Dịch vụ không phản hồi / Treo)"
        }
    except ConnectionRefusedError:
        return {
            "port": port,
            "name": port_name,
            "alive": False,
            "latency_ms": None,
            "error": "Connection Refused (Dịch vụ chưa bật hoặc bị crash)"
        }
    except Exception as e:
        return {
            "port": port,
            "name": port_name,
            "alive": False,
            "latency_ms": None,
            "error": str(e)
        }
    finally:
        if writer:
            try:
                writer.close()
                await writer.wait_closed()
            except Exception:
                pass


async def check_single_nvr(nvr: NVR, session: Session) -> NVR:
    """
    Kiểm tra trạng thái NVR và đồng bộ trạng thái camera:
    1. Ưu tiên: Gọi NVR Media API. Nếu API trả lời -> NVR ONLINE và cập nhật luôn trạng thái
       tất cả camera con mà KHÔNG cần ping hay probe cổng TCP.
    2. Fallback: Nếu không có cấu hình tài khoản hoặc API lỗi -> Kiểm tra ICMP Ping + TCP Ports
       để phát hiện SERVICE_FROZEN / OFFLINE.
    """
    old_status = nvr.status
    ts = now_utc()

    # ─────────────────────────────────────────────────────────────
    # BƯỚC 1: Ưu tiên truy vấn qua NVR Media API (Không cần ping/port check)
    # ─────────────────────────────────────────────────────────────
    if nvr.username and nvr.password:
        try:
            from app.services.acti_nvr_client import fetch_cameras_from_nvr
            device_list, err_msg = await fetch_cameras_from_nvr(nvr)

            if device_list:
                new_status = "ONLINE"
                nvr.status = new_status
                nvr.last_seen_at = ts
                nvr.synced_camera_count = len(device_list)
                nvr.service_status_detail = json.dumps({
                    "mode": "API",
                    "api": "ONLINE",
                    "message": f"NVR Media API hoạt động bình thường, trực tiếp quản lý {len(device_list)} kênh (không cần ping/check port)"
                }, ensure_ascii=False)
                session.add(nvr)

                # ── Probe trạng thái thực tế của các camera thuộc NVR ──
                cams = session.exec(select(Camera).where(Camera.nvr_id == nvr.id)).all()
                cam_ids = [c.id for c in cams if c.id]

                from app.services.ping_checker import ping_single

                async def check_cam_live(cam_obj):
                    if not cam_obj.ip:
                        return cam_obj.id, False, None
                    _, alive, latency = await ping_single(cam_obj.ip, timeout=1.0)
                    return cam_obj.id, alive, latency

                cam_tasks = [check_cam_live(c) for c in cams]
                live_results = await asyncio.gather(*cam_tasks) if cam_tasks else []
                live_map = {cid: (alive, lat) for cid, alive, lat in live_results}

                mappings = session.exec(select(NetworkMapping).where(NetworkMapping.camera_id.in_(cam_ids))).all() if cam_ids else []
                mapping_map = {m.camera_id: m for m in mappings}

                from app.services.acti_nvr_client import is_decommissioned_camera

                for cam in cams:
                    alive, lat = live_map.get(cam.id, (False, None))
                    if is_decommissioned_camera(cam.name):
                        new_cam_status = "OFFLINE"
                        lat = None
                    else:
                        new_cam_status = "ONLINE"
                        if not alive:
                            lat = None

                    cam.nvr_status = new_cam_status
                    session.add(cam)

                    mapping = mapping_map.get(cam.id)
                    if mapping:
                        old_cam_status = mapping.status
                        mapping.status = new_cam_status
                        mapping.latency_ms = lat
                        if new_cam_status == "ONLINE":
                            mapping.last_seen_at = ts
                        session.add(mapping)

                        if old_cam_status != new_cam_status:
                            alert = AlertLog(
                                camera_id=cam.id,
                                event_type="OFFLINE" if new_cam_status == "OFFLINE" else "RECOVERED",
                                timestamp=ts,
                            )
                            session.add(alert)
                            try:
                                await broadcast_status_change(
                                    camera_id=cam.id,
                                    camera_name=cam.name,
                                    camera_ip=cam.ip,
                                    old_status=old_cam_status,
                                    new_status=new_cam_status,
                                    latency_ms=lat or 1.0,
                                )
                            except Exception:
                                pass
                    else:
                        new_mapping = NetworkMapping(
                            camera_id=cam.id,
                            switch_id=None,
                            switch_port=None,
                            status=new_cam_status,
                            latency_ms=lat,
                            last_seen_at=ts if alive else None,
                        )
                        session.add(new_mapping)

                # Bắn WebSocket cho NVR nếu trạng thái thay đổi
                if old_status != new_status:
                    try:
                        await broadcast_nvr_status_change(
                            nvr_id=nvr.id,
                            nvr_name=nvr.name,
                            nvr_ip=nvr.ip,
                            old_status=old_status,
                            new_status=new_status,
                            latency_ms=nvr.latency_ms,
                            service_status_detail=nvr.service_status_detail
                        )
                    except Exception:
                        pass

                return nvr
        except Exception as e:
            logger.debug(f"Thử kiểm tra qua NVR API không thành công: {e}")

    # ─────────────────────────────────────────────────────────────
    # BƯỚC 2: Fallback kiểm tra mạng TCP/ICMP nếu không có mật khẩu API
    # ─────────────────────────────────────────────────────────────
    ip = nvr.ip
    timeout = settings.NVR_TIMEOUT

    # 1. Ping ICMP
    ping_ok, ping_latency = await ping_ip(ip, timeout=1.0)

    ports_to_check = []
    if nvr.http_port:
        ports_to_check.append((nvr.http_port, f"Web ({nvr.http_port})"))
    if nvr.rtsp_port:
        ports_to_check.append((nvr.rtsp_port, f"RTSP ({nvr.rtsp_port})"))
    if nvr.custom_ports:
        for p_str in nvr.custom_ports.split(","):
            p_str = p_str.strip()
            if p_str.isdigit():
                p = int(p_str)
                if p not in [nvr.http_port, nvr.rtsp_port]:
                    ports_to_check.append((p, f"Port {p}"))

    # 2. Probe các cổng dịch vụ song song
    port_tasks = [probe_tcp_port(ip, port, name, timeout) for port, name in ports_to_check]
    port_results = await asyncio.gather(*port_tasks)

    # 3. Phân loại trạng thái
    if not ping_ok:
        any_port_alive = any(r["alive"] for r in port_results)
        if any_port_alive:
            new_status = "ONLINE"
            nvr.latency_ms = next(r["latency_ms"] for r in port_results if r["alive"])
            nvr.last_seen_at = ts
        else:
            new_status = "OFFLINE"
            nvr.latency_ms = None
    else:
        nvr.latency_ms = ping_latency
        nvr.last_seen_at = ts

        any_service_failed = any(not r["alive"] for r in port_results)
        if not any_service_failed:
            new_status = "ONLINE"
        else:
            new_status = "SERVICE_FROZEN"

    nvr.status = new_status
    nvr.service_status_detail = json.dumps({
        "ping": {"alive": ping_ok, "latency_ms": ping_latency},
        "ports": port_results
    }, ensure_ascii=False)

    session.add(nvr)

    # Bắn WebSocket nếu thay đổi trạng thái
    if old_status != new_status:
        try:
            await broadcast_nvr_status_change(
                nvr_id=nvr.id,
                nvr_name=nvr.name,
                nvr_ip=nvr.ip,
                old_status=old_status,
                new_status=new_status,
                latency_ms=nvr.latency_ms,
                service_status_detail=nvr.service_status_detail
            )
        except Exception:
            pass

    return nvr


async def check_all_nvrs(session: Session = None):
    """Kiểm tra toàn bộ đầu ghi NVR trong DB."""
    close_session = False
    if session is None:
        session = Session(engine)
        close_session = True

    try:
        nvrs = session.exec(select(NVR)).all()
        if not nvrs:
            logger.debug("Không có đầu ghi NVR nào để kiểm tra.")
            return

        logger.info(f"Bắt đầu kiểm tra {len(nvrs)} đầu ghi NVR...")
        tasks = [check_single_nvr(nvr, session) for nvr in nvrs]
        await asyncio.gather(*tasks)
        session.commit()
        logger.info(f"Đã hoàn thành kiểm tra {len(nvrs)} đầu ghi NVR.")
    except Exception as e:
        logger.error(f"Lỗi trong quá trình kiểm tra NVR: {e}", exc_info=True)
        session.rollback()
    finally:
        if close_session:
            session.close()
        shrink_sqlite_memory()
        gc.collect()
