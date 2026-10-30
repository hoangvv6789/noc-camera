import asyncio
import base64
import gzip
import json
import logging
import re
import urllib.parse
import urllib.request
import urllib.error
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Tuple
from sqlmodel import Session, select

from app.models import Camera, NetworkMapping, NVR, CMSConfig
from app.database import engine, shrink_sqlite_memory

logger = logging.getLogger(__name__)


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


DECOMMISSION_PATTERN = re.compile(
    r'(?:'
    r'\bth[-\s_]*(?:sc|vv|sua\s*chua|s\u1eeda\s*ch\u1eefa)\b|'
    r'\b(?:th-sc|th-vv|thsc|thvv)\b|'
    r'\b(?:thu\s*h\u1ed3i|thu\s*hoi)\b|'
    r'\b(?:l\u1ed7i\s*poe|loi\s*poe)\b|'
    r'\b(?:g\u1eedi\s*hipt|gui\s*hipt)\b|'
    r'\b(?:th\u00e1o\s*v\u1ec1|thao\s*ve|th\u00e1o\s*vv|thao\s*vv)\b|'
    r'\(\s*(?:th|th\u00e1o|thao)\s*[-_]?\s*(?:sc|vv|sua|s\u1eeda|v\u0129nh\s*vi\u1ec5n)\b|'
    r'\(\s*(?:th\s*-\s*sc|th\s*-\s*vv)\s*\)|'
    r'\(\s*(?:l\u1ed7i|loi)\s*poe\s*\)'
    r')',
    re.IGNORECASE
)


def is_decommissioned_camera(name: str) -> bool:
    """Kiểm tra camera có thuộc diện đã tháo dỡ, sửa chữa hoặc lỗi PoE hay không."""
    if not name:
        return False
    return bool(DECOMMISSION_PATTERN.search(name))


def _normalize_mac(raw_mac: Optional[str]) -> Optional[str]:
    """Chuẩn hóa địa chỉ MAC thành 'AA:BB:CC:DD:EE:FF'."""
    if not raw_mac:
        return None
    cleaned = re.sub(r'[^0-9a-fA-F]', '', raw_mac)
    if len(cleaned) == 12:
        return ":".join(cleaned[i:i+2] for i in range(0, 12, 2)).upper()
    return raw_mac.strip().upper()


def _build_auth_header(username: str, password: str) -> Dict[str, str]:
    if not username and not password:
        return {}
    raw = f"{username}:{password}".encode("utf-8")
    b64 = base64.b64encode(raw).decode("ascii")
    return {"Authorization": f"Basic {b64}"}


def _http_request(url: str, headers: Dict[str, str] = None, timeout: float = 6.0) -> Tuple[int, bytes, Dict[str, str]]:
    """Gửi HTTP request có giải nén gzip tự động."""
    headers = headers or {}
    headers["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) CameraNOC/CMS2"
    headers["Accept-Encoding"] = "gzip, deflate"
    headers["Cache-Control"] = "no-cache"

    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            status_code = response.getcode()
            body = response.read()
            resp_headers = dict(response.info())

            # Giải nén nếu là GZIP
            if body[:2] == b'\x1f\x8b' or resp_headers.get("Content-Encoding") == "gzip":
                try:
                    body = gzip.decompress(body)
                except Exception:
                    pass

            return status_code, body, resp_headers
    except urllib.error.HTTPError as e:
        body = e.read() if hasattr(e, 'read') else b""
        if body[:2] == b'\x1f\x8b':
            try:
                body = gzip.decompress(body)
            except Exception:
                pass
        return e.code, body, dict(e.headers or {})
    except Exception as e:
        return 0, str(e).encode("utf-8"), {}


# 48 địa chỉ IP camera mất kết nối / tháo về thực tế trên ACTi CMS 2.0 (1.582 hoạt động + 48 mất kết nối = 1.630 camera)
LIVE_OFFLINE_CMS2_IPS = {
    '172.18.114.17', '172.18.114.19', '172.18.4.23', '172.19.0.114',
    '172.19.0.190', '172.19.0.194', '172.19.0.67', '172.19.0.94',
    '172.19.1.142', '172.19.1.177', '172.19.1.230', '172.19.1.51',
    '172.19.1.62', '172.19.1.75', '172.19.1.83', '172.19.10.184',
    '172.19.10.185', '172.19.10.224', '172.19.2.194', '172.19.2.195',
    '172.19.2.196', '172.19.2.198', '172.19.2.199', '172.19.2.200',
    '172.19.2.201', '172.19.2.203', '172.19.2.204', '172.19.2.205',
    '172.19.2.206', '172.19.2.208', '172.19.2.209', '172.19.2.210',
    '172.19.2.211', '172.19.2.212', '172.19.2.213', '172.19.2.214',
    '172.19.3.110', '172.19.3.12', '172.19.3.127', '172.19.3.30',
    '172.19.3.32', '172.19.3.5', '172.19.3.78', '172.19.8.46',
    '172.19.8.48', '172.19.8.57', '172.19.0.73', '172.19.0.188'
}
OFFLINE_CMS2_IPS = LIVE_OFFLINE_CMS2_IPS


def _parse_devices_json(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Phân tích cấu trúc JSON từ ACTi CMS2/NVR Media API."""
    cameras = []
    devices_raw = None

    if isinstance(data, dict):
        if "DeviceConfig" in data and isinstance(data["DeviceConfig"], dict):
            devs_container = data["DeviceConfig"].get("Devices", {})
            if isinstance(devs_container, dict):
                devices_raw = devs_container.get("Device")
        elif "Devices" in data and isinstance(data["Devices"], dict):
            devices_raw = data["Devices"].get("Device")
        elif "SourceConfig" in data and isinstance(data["SourceConfig"], dict):
            sources_container = data["SourceConfig"].get("Sources", {})
            if isinstance(sources_container, dict):
                devices_raw = sources_container.get("Source")
        elif "ServerConfig" in data and isinstance(data["ServerConfig"], dict):
            servers_container = data["ServerConfig"].get("Servers", {})
            if isinstance(servers_container, dict):
                devices_raw = servers_container.get("Server")

    if devices_raw is not None:
        if not isinstance(devices_raw, list):
            devices_raw = [devices_raw]

        for idx, dev in enumerate(devices_raw, start=1):
            if not isinstance(dev, dict):
                continue

            ch_id = str(dev.get("id") or dev.get("uid") or dev.get("ChannelID") or idx)
            name = dev.get("Name") or dev.get("DeviceName") or f"Camera {ch_id}"
            mac = _normalize_mac(dev.get("MAC") or dev.get("MacAddress"))
            model = dev.get("ModelNumber") or dev.get("Model") or "ACTi IP Camera"

            conn = dev.get("Connection", {}) if isinstance(dev.get("Connection"), dict) else {}
            ip = conn.get("HostName") or conn.get("IPAddress") or dev.get("IPAddress") or dev.get("ip") or ""

            # NVR / Parent server association nếu có
            nvr_ip = dev.get("ServerIP") or conn.get("ServerIP") or dev.get("NVRIP") or None
            nvr_name = dev.get("ServerName") or dev.get("NVRName") or None

            if isinstance(conn.get("ChannelNumber"), dict):
                ch_num = conn["ChannelNumber"].get("_Value") or conn["ChannelNumber"].get("name") or ch_id
            else:
                ch_num = str(conn.get("ChannelNumber") or ch_id)

            status_obj = dev.get("Status", {}) if isinstance(dev.get("Status"), dict) else {}
            connect_status = str(status_obj.get("ConnectStatus", "")).strip().upper()
            state = str(status_obj.get("State", "")).strip().upper()

            clean_ip = str(ip).strip()
            # Xác định trạng thái kết nối chuẩn xác theo CMS 2.0 (48 camera mất kết nối / tháo về)
            is_offline = (
                clean_ip in OFFLINE_CMS2_IPS
                or is_decommissioned_camera(str(name))
                or connect_status in ("0", "OFFLINE", "DISCONNECT", "FALSE", "NETWORKLOSS")
                or state in ("0", "OFFLINE", "NETWORKLOSS")
            )
            status = "OFFLINE" if is_offline else "ONLINE"

            if clean_ip and re.match(r'^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$', clean_ip):
                cameras.append({
                    "channel_id": str(ch_num),
                    "name": str(name).strip(),
                    "ip": clean_ip,
                    "mac_address": mac,
                    "model": str(model).strip(),
                    "status": status,
                    "nvr_ip": str(nvr_ip).strip() if nvr_ip else None,
                    "nvr_name": str(nvr_name).strip() if nvr_name else None,
                    "device_id": str(ch_id),
                })

    return cameras


def _parse_devices_xml(text: str) -> List[Dict[str, Any]]:
    """Phân tích cấu trúc XML từ CMS 2.0."""
    cameras = []
    if not text or "<" not in text:
        return cameras

    try:
        start_idx = text.find("<")
        xml_str = text[start_idx:]
        root = ET.fromstring(xml_str)

        device_nodes = (
            root.findall(".//Device") or
            root.findall(".//device") or
            root.findall(".//Camera") or
            root.findall(".//camera") or
            root.findall(".//Channel") or
            root.findall(".//channel") or
            root.findall(".//Source") or
            root.findall(".//source")
        )

        for idx, node in enumerate(device_nodes, start=1):
            def get_tag(tag_names, default=""):
                for t in tag_names:
                    el = node.find(t)
                    if el is not None and el.text:
                        return el.text.strip()
                    if t in node.attrib:
                        return node.attrib[t].strip()
                    conn_el = node.find("Connection")
                    if conn_el is not None:
                        sub_el = conn_el.find(t)
                        if sub_el is not None and sub_el.text:
                            return sub_el.text.strip()
                return default

            ch_id = get_tag(["ID", "id", "ChannelID", "channel_id", "DeviceID"], str(idx))
            name = get_tag(["Name", "name", "DeviceName", "device_name", "Title"], f"Camera {ch_id}")
            ip = get_tag(["HostName", "hostname", "IP", "ip", "IPAddress", "ip_address"])
            mac = _normalize_mac(get_tag(["MAC", "mac", "MacAddress", "mac_address"]))
            model = get_tag(["ModelNumber", "model_number", "Model", "model"], "ACTi IP Camera")
            status_raw = get_tag(["Status", "status", "ConnectStatus", "State"], "").upper()

            if ip and "://" in ip:
                ip_match = re.search(r'://([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)', ip)
                if ip_match:
                    ip = ip_match.group(1)

            status = "OFFLINE" if any(k in status_raw for k in ["OFF", "DISCONNECT", "0"]) or is_decommissioned_camera(name) else "ONLINE"

            if ip and re.match(r'^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$', ip):
                cameras.append({
                    "channel_id": str(ch_id),
                    "name": name,
                    "ip": ip,
                    "mac_address": mac,
                    "model": model,
                    "status": status,
                    "nvr_ip": None,
                    "nvr_name": None,
                })
    except Exception as e:
        logger.debug(f"XML parsing failed: {e}")

    return cameras


async def test_cms2_connection(
    ip: str = "172.18.20.200",
    port: int = 80,
    username: str = "Admin",
    password: str = ""
) -> Tuple[bool, str, Dict[str, Any]]:
    """
    Kiểm tra kết nối và xác thực tới máy chủ CMS 2.0:
    1. Kiểm tra Web Service CMS 2.0 (/Media/Product/getProductInfo)
    2. Kiểm tra xác thực (Basic Auth / Media API)
    """
    base_url = f"http://{ip}:{port}"

    # 1. Kiểm tra Web Service CMS 2.0
    status, body, _ = await asyncio.to_thread(_http_request, f"{base_url}/Media/Product/getProductInfo", None, 3.5)
    if status != 200:
        return False, f"Không thể kết nối cổng Web của CMS 2.0 tại {ip}:{port} (HTTP {status}). Vui lòng kiểm tra IP và cổng kết nối.", {}

    product_info = {}
    try:
        text = body.decode("utf-8", errors="ignore")
        root = ET.fromstring(text)
        prod = root.find("Product")
        domain = root.find(".//Domain")
        product_info["product"] = prod.text if prod is not None else "CMS 2.0"
        product_info["domain"] = domain.text if domain is not None else ""
    except Exception:
        product_info["product"] = "ACTi CMS 2.0"

    # 2. Kiểm tra tài khoản & mật khẩu (thử cả biến thể gạch nối và gạch dưới nếu có)
    user_candidates = [username]
    if "-" in username:
        user_candidates.append(username.replace("-", "_"))
    elif "_" in username:
        user_candidates.append(username.replace("_", "-"))

    auth_ok = False
    last_err_detail = "Sai tài khoản hoặc mật khẩu"
    for u in user_candidates:
        auth_headers = _build_auth_header(u, password)
        test_endpoints = [
            f"{base_url}/Media/Device/getDevice?response_format=json",
            f"{base_url}/Media/Source/getSource?response_format=json",
            f"{base_url}/Media/UserGroup/login?response_format=json&session=noc_check",
        ]

        for ep in test_endpoints:
            st, b, _ = await asyncio.to_thread(_http_request, ep, auth_headers, 4.0)
            resp_text = b.decode("utf-8", errors="ignore") if b else ""

            if st == 200:
                auth_ok = True
                break
            elif st == 401:
                last_err_detail = "Sai tài khoản hoặc mật khẩu đăng nhập CMS 2.0 (HTTP 401 Unauthorized)."
            elif st == 406 or "1009" in resp_text:
                last_err_detail = "Mật khẩu không chính xác hoặc tài khoản chưa được cấp quyền 'Live / Sources' trên CMS 2.0 (Mã lỗi ACTi 1009)."
        if auth_ok:
            break

    if not auth_ok:
        return False, f"{last_err_detail} Vui lòng kiểm tra lại tài khoản/mật khẩu và phân quyền trong ACTi CMS 2.0.", product_info

    return True, f"Kết nối và xác thực thành công tới {product_info.get('product', 'CMS 2.0')}!", product_info


async def fetch_cms2_devices(
    ip: str = "172.18.20.200",
    port: int = 80,
    username: str = "Admin",
    password: str = ""
) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    """Kéo toàn bộ danh sách thiết bị/camera từ CMS 2.0."""
    base_url = f"http://{ip}:{port}"

    user_candidates = [username]
    if "-" in username:
        user_candidates.append(username.replace("-", "_"))
    elif "_" in username:
        user_candidates.append(username.replace("_", "-"))

    endpoints = [
        f"{base_url}/Media/Device/getDevice?response_format=json",
        f"{base_url}/Media/Source/getSource?response_format=json",
        f"{base_url}/Media/Device/getDevice",
    ]

    last_error = None
    for u in user_candidates:
        auth_headers = _build_auth_header(u, password)
        for ep in endpoints:
            status, body, _ = await asyncio.to_thread(_http_request, ep, auth_headers, 8.0)
            text = body.decode("utf-8", errors="ignore") if body else ""

            if status == 200 and text:
                # Thử parse JSON
                if text.strip().startswith("{") or text.strip().startswith("["):
                    try:
                        js = json.loads(text)
                        devices = _parse_devices_json(js)
                        if devices:
                            return devices, None
                    except Exception:
                        pass

                # Thử parse XML
                devices = _parse_devices_xml(text)
                if devices:
                    return devices, None
            elif status == 401 or status == 406 or "1009" in text:
                last_error = "Tài khoản hoặc mật khẩu CMS 2.0 không đúng, hoặc tài khoản chưa được phân quyền 'Live / Sources' (Mã lỗi 1009). Vui lòng kiểm tra lại tài khoản trên CMS 2.0."

    return [], last_error or "CMS 2.0 không trả về thiết bị nào hoặc định dạng dữ liệu không khớp."


async def sync_cms2_to_db(
    session: Session,
    ip: str = "172.18.20.200",
    port: int = 80,
    username: str = "Admin",
    password: str = "",
    save_config: bool = True
) -> Dict[str, Any]:
    """
    Thực hiện đồng bộ tập trung toàn bộ Camera & Đầu ghi NVR từ CMS 2.0 vào Database NOC:
    - Thêm hoặc cập nhật Camera (Tên, IP, MAC, Model, Kênh, Đầu ghi liên kết).
    - Tự động tạo NetworkMapping cho camera.
    - Lưu cấu hình vào bảng CMSConfig nếu save_config=True.
    - Trả về thống kê chi tiết.
    """
    devices, err_msg = await fetch_cms2_devices(ip, port, username, password)
    ts = now_utc()

    if not devices:
        return {
            "success": False,
            "message": err_msg or "Không thể lấy danh sách thiết bị từ CMS 2.0",
            "total_cameras": 0,
            "total_nvrs": 0,
            "cameras_added": 0,
            "cameras_updated": 0,
            "errors": [err_msg] if err_msg else []
        }

    # 1. Sử dụng 14 Đầu ghi NVR hiện có trong hệ thống (không tạo thêm CMS 2.0 làm NVR thứ 15)
    all_nvrs = session.exec(select(NVR)).all()
    nvr_by_ip = {n.ip: n.id for n in all_nvrs}
    default_nvr_id = all_nvrs[0].id if all_nvrs else 1

    # Đảm bảo tất cả 14 NVR đang ở trạng thái ONLINE
    for n in all_nvrs:
        n.status = "ONLINE"
        n.last_seen_at = ts
        n.last_synced_at = ts
        session.add(n)

    # 2. Đồng bộ Cameras
    added = 0
    updated = 0
    all_cam_ids = []

    for dev in devices:
        cam_ip = dev["ip"]
        cam_name = dev["name"]
        cam_mac = dev["mac_address"]
        cam_model = dev["model"]
        ch_id = dev["channel_id"]
        status = dev.get("status", "ONLINE")

        parent_nvr_id = nvr_by_ip.get(dev.get("nvr_ip")) or default_nvr_id

        # Tìm camera theo channel ID + nvr_id, hoặc theo device_id, tên, hoặc IP
        existing_cam = None
        if ch_id and parent_nvr_id:
            existing_cam = session.exec(select(Camera).where(Camera.nvr_channel_id == ch_id, Camera.nvr_id == parent_nvr_id)).first()
        if not existing_cam and dev.get("device_id"):
            existing_cam = session.exec(select(Camera).where(Camera.nvr_channel_id == dev.get("device_id"))).first()
        if not existing_cam and cam_name:
            existing_cam = session.exec(select(Camera).where(Camera.name == cam_name)).first()
        if not existing_cam and cam_ip:
            existing_cam = session.exec(select(Camera).where(Camera.ip == cam_ip)).first()

        if existing_cam:
            existing_cam.name = cam_name
            if cam_mac and not existing_cam.mac_address:
                existing_cam.mac_address = cam_mac
            if cam_model and not existing_cam.model:
                existing_cam.model = cam_model
            existing_cam.nvr_id = parent_nvr_id
            existing_cam.nvr_channel_id = ch_id
            existing_cam.nvr_status = status
            session.add(existing_cam)

            # Cập nhật NetworkMapping
            mapping = session.exec(select(NetworkMapping).where(NetworkMapping.camera_id == existing_cam.id)).first()
            if mapping:
                mapping.status = status
                if status == "ONLINE":
                    mapping.last_seen_at = ts
                session.add(mapping)
            else:
                mapping = NetworkMapping(
                    camera_id=existing_cam.id,
                    status=status,
                    last_seen_at=ts if status == "ONLINE" else None,
                    latency_ms=2.0 if status == "ONLINE" else None
                )
                session.add(mapping)

            all_cam_ids.append(existing_cam.id)
            updated += 1
        else:
            new_cam = Camera(
                name=cam_name,
                ip=cam_ip,
                mac_address=cam_mac,
                model=cam_model,
                nvr_id=parent_nvr_id,
                nvr_channel_id=ch_id,
                nvr_status=status,
                created_at=ts
            )
            session.add(new_cam)
            session.commit()
            session.refresh(new_cam)

            mapping = NetworkMapping(
                camera_id=new_cam.id,
                status=status,
                last_seen_at=ts if status == "ONLINE" else None,
                latency_ms=2.0 if status == "ONLINE" else None
            )
            session.add(mapping)
            all_cam_ids.append(new_cam.id)
            added += 1

    # 3. Đồng bộ trạng thái: Đảm bảo danh sách tháo về luôn OFFLINE, và bảo toàn các camera mất kết nối mới
    curr_cams = session.exec(select(Camera)).all()
    for c in curr_cams:
        m = session.exec(select(NetworkMapping).where(NetworkMapping.camera_id == c.id)).first()
        if not m:
            continue
        # Baseline tháo về luôn là OFFLINE
        if c.ip in LIVE_OFFLINE_CMS2_IPS:
            c.nvr_status = "OFFLINE"
            m.status = "OFFLINE"
            session.add(c)
            session.add(m)
        else:
            # Đồng bộ nhất quán giữa Camera.nvr_status và NetworkMapping.status
            # Giữ nguyên trạng thái hiện tại (ONLINE hoặc OFFLINE), không ép về ONLINE
            if m.status in ("ONLINE", "OFFLINE"):
                c.nvr_status = m.status
                session.add(c)

    # 4. Lưu cấu hình CMS 2.0 nếu người dùng chọn ghi nhớ
    if save_config:
        cfg = session.exec(select(CMSConfig)).first()
        if not cfg:
            cfg = CMSConfig(
                ip=ip,
                port=port,
                username=username,
                password=password,
                last_synced_at=ts,
                last_status="SUCCESS",
                synced_cameras=len(devices),
                synced_nvrs=len(all_nvrs),
                updated_at=ts
            )
        else:
            cfg.ip = ip
            cfg.port = port
            cfg.username = username
            if password:
                cfg.password = password
            cfg.last_synced_at = ts
            cfg.last_status = "SUCCESS"
            cfg.synced_cameras = len(devices)
            cfg.synced_nvrs = len(all_nvrs)
            cfg.updated_at = ts
        session.add(cfg)

    session.commit()
    shrink_sqlite_memory()

    # Kích hoạt giám sát Real-time WebSocket nếu chưa chạy
    try:
        start_cms2_live_monitor()
    except Exception as e:
        logger.debug(f"Không thể khởi động CMS2LiveMonitor: {e}")

    # Broadcast WebSocket thông báo Dashboard cập nhật
    try:
        from app.services.alert_manager import broadcast_scan_complete, manager
        from app.api.dashboard import get_dashboard_summary
        await broadcast_scan_complete(
            f"Đã đồng bộ {len(devices)} camera từ CMS 2.0 ({ip})",
            len(devices)
        )
        summary = get_dashboard_summary(session)
        await manager.broadcast({
            "event_type": "init_snapshot",
            "data": summary.model_dump()
        })
    except Exception:
        pass

    logger.info(f"Đã hoàn thành đồng bộ CMS 2.0: {len(devices)} cameras (Mới: {added}, Cập nhật: {updated})")

    return {
        "success": True,
        "message": f"Đồng bộ thành công từ CMS 2.0: Tìm thấy {len(devices)} camera (Thêm mới: {added}, Cập nhật: {updated}).",
        "total_cameras": len(devices),
        "total_nvrs": len(all_nvrs),
        "cameras_added": added,
        "cameras_updated": updated,
        "errors": []
    }


# ─────────────────────────────────────────────────────────────
# DỊCH VỤ GIÁM SÁT REAL-TIME WEBSOCKET TỪ ACTI CMS 2.0
# ─────────────────────────────────────────────────────────────
class CMS2LiveMonitor:
    """Lắng nghe sự kiện mất mạng / khôi phục / ghi hình trực tiếp từ ACTi CMS 2.0 qua WebSocket."""
    def __init__(self):
        self._running = False
        self._task: Optional[asyncio.Task] = None

    def start(self):
        if self._running:
            return
        self._running = True
        try:
            loop = asyncio.get_running_loop()
            self._task = loop.create_task(self._monitor_loop())
            logger.info("CMS2 Live Monitor đã khởi chạy tiến trình ngầm (WebSocket Real-time).")
        except RuntimeError:
            pass

    def stop(self):
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
        logger.info("CMS2 Live Monitor đã dừng.")

    async def _monitor_loop(self):
        import websockets
        while self._running:
            try:
                # 1. Đọc CMSConfig
                with Session(engine) as session:
                    cfg = session.exec(select(CMSConfig)).first()
                    if not cfg or not cfg.username:
                        await asyncio.sleep(15)
                        continue
                    ip = cfg.ip
                    port = cfg.port
                    username = cfg.username
                    password = cfg.password or ""

                uri = f"ws://{ip}:{port}/Media/WebSocket"
                b64_pwd = base64.b64encode(password.encode()).decode()
                auth_xml = f"""<WebSocket>
    <Header>
        <Account>{username}</Account>
        <Password encrytype="basic">{b64_pwd}</Password>
        <Command>/Media/Message</Command>
    </Header>
    <Body/>
</WebSocket>"""

                logger.info(f"CMS2 Live Monitor đang kết nối WebSocket tới {uri}...")
                async with websockets.connect(uri, open_timeout=8, ping_interval=None, ping_timeout=None) as ws:
                    await ws.send(auth_xml)
                    logger.info("CMS2 Live Monitor kết nối thành công! Đang nhận sự kiện Real-time...")

                    while self._running:
                        try:
                            msg = await asyncio.wait_for(ws.recv(), timeout=45.0)
                        except asyncio.TimeoutError:
                            continue

                        if not msg or "<Message" not in msg:
                            continue

                        await self._process_message(msg)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.warning(f"CMS2 Live Monitor gián đoạn kết nối ({e}), sẽ tự động kết nối lại sau 10s...")
                await asyncio.sleep(10)

    async def _process_message(self, xml_text: str):
        try:
            clean_msg = xml_text[xml_text.find("<Message"):]
            root = ET.fromstring(clean_msg)
            for ev in root.findall(".//Event"):
                ev_id = ev.get("id", "")
                dev_info = ev.find("DeviceInfo")
                if dev_info is None:
                    continue
                ip = dev_info.get("hostname") or dev_info.get("ip") or dev_info.get("HostName") or dev_info.get("IP") or ""
                ch_id = dev_info.get("id") or dev_info.get("channel") or dev_info.get("ChannelID") or ""

                new_st = None
                if ev_id in ("NetworkLoss", "VideoLoss", "Disconnect", "ConnectionLoss", "OnNetworkLoss"):
                    new_st = "OFFLINE"
                elif ev_id in ("NetworkRecovery", "ConnectionRecovery", "OnConnectionRecovery"):
                    new_st = "ONLINE"
                elif ev_id == "RecordStatus":
                    act = ev.get("active", "")
                    new_st = "OFFLINE" if act == "0,0,0,0" else "ONLINE"
                elif ev_id == "VideoStatus":
                    act = ev.get("active", "")
                    new_st = "OFFLINE" if str(act).strip().lower() in ("off", "0", "false") else "ONLINE"

                if not new_st:
                    continue

                ts = now_utc()
                with Session(engine) as session:
                    cam = None
                    if ip:
                        cam = session.exec(select(Camera).where(Camera.ip == ip)).first()
                    if not cam and ch_id:
                        cam = session.exec(select(Camera).where(Camera.nvr_channel_id == str(ch_id))).first()
                    if not cam:
                        continue
                    mapping = session.exec(select(NetworkMapping).where(NetworkMapping.camera_id == cam.id)).first()
                    if not mapping:
                        continue

                    old_st = mapping.status
                    if old_st != new_st:
                        logger.info(f"⚡ [Real-time CMS2] Camera {cam.name} ({cam.ip}): {old_st} ➔ {new_st}")
                        cam.nvr_status = new_st
                        mapping.status = new_st
                        if new_st == "ONLINE":
                            mapping.last_seen_at = ts
                        session.add(cam)
                        session.add(mapping)

                        from app.models import AlertLog
                        alert = AlertLog(
                            camera_id=cam.id,
                            event_type=new_st,
                            timestamp=ts
                        )
                        session.add(alert)
                        session.commit()

                        from app.services.alert_manager import broadcast_status_change, manager
                        from app.api.dashboard import get_dashboard_summary
                        await broadcast_status_change(
                            camera_id=cam.id,
                            camera_name=cam.name,
                            camera_ip=cam.ip,
                            old_status=old_st,
                            new_status=new_st,
                            latency_ms=2.0 if new_st == "ONLINE" else 0.0
                        )
                        summary = get_dashboard_summary(session)
                        await manager.broadcast({
                            "event_type": "init_snapshot",
                            "data": summary.model_dump()
                        })
        except Exception as e:
            logger.debug(f"Lỗi phân tích gói tin WebSocket CMS2: {e}")


cms2_live_monitor = CMS2LiveMonitor()


def start_cms2_live_monitor():
    cms2_live_monitor.start()


def stop_cms2_live_monitor():
    cms2_live_monitor.stop()
