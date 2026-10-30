import asyncio
import base64
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

from app.models import NVR, Camera, NetworkMapping
from app.config import settings
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
    """Chuẩn hóa định dạng MAC address thành 'aa:bb:cc:dd:ee:ff'."""
    if not raw_mac:
        return None
    cleaned = re.sub(r'[^0-9a-fA-F]', '', raw_mac)
    if len(cleaned) == 12:
        return ":".join(cleaned[i:i+2] for i in range(0, 12, 2)).lower()
    return raw_mac.strip()


def _build_auth_header(username: str, password: str) -> Dict[str, str]:
    """Tạo Header Basic Authentication."""
    if not username and not password:
        return {}
    raw = f"{username}:{password}".encode("utf-8")
    b64 = base64.b64encode(raw).decode("ascii")
    return {"Authorization": f"Basic {b64}"}


def _http_request(url: str, headers: Dict[str, str] = None, timeout: float = 4.0) -> Tuple[int, bytes, Dict[str, str]]:
    """Gửi HTTP request đồng bộ (sẽ bọc qua asyncio.to_thread)."""
    headers = headers or {}
    headers["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ACTi-NOC/2.0"
    headers["Cache-Control"] = "no-cache"

    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            status_code = response.getcode()
            body = response.read()
            resp_headers = dict(response.info())
            return status_code, body, resp_headers
    except urllib.error.HTTPError as e:
        body = e.read() if hasattr(e, 'read') else b""
        return e.code, body, dict(e.headers or {})
    except Exception as e:
        logger.debug(f"HTTP error for {url}: {e}")
        return 0, str(e).encode("utf-8"), {}


def _parse_acti_json_response(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Phân tích JSON trả về từ ACTi NVR 3.0 API (/Media/Device/getDevice hoặc /Media/Source/getSource).
    """
    cameras = []

    # Case 1: DeviceConfig -> Devices -> Device
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

    if devices_raw is not None:
        if not isinstance(devices_raw, list):
            devices_raw = [devices_raw]

        for idx, dev in enumerate(devices_raw, start=1):
            if not isinstance(dev, dict):
                continue

            ch_id = str(dev.get("id") or dev.get("uid") or idx)
            name = dev.get("Name") or f"Camera {ch_id}"
            mac = _normalize_mac(dev.get("MAC"))
            model = dev.get("ModelNumber") or dev.get("Model") or "ACTi IP Camera"

            # Connection block
            conn = dev.get("Connection", {}) if isinstance(dev.get("Connection"), dict) else {}
            ip = conn.get("HostName") or conn.get("IPAddress") or dev.get("IPAddress") or dev.get("ip") or ""
            http_port = conn.get("HTTPPort") or 80
            rtsp_port = conn.get("RTSPPort") or 554

            # Channel sub-info
            if isinstance(conn.get("ChannelNumber"), dict):
                ch_num = conn["ChannelNumber"].get("_Value") or conn["ChannelNumber"].get("name") or ch_id
            else:
                ch_num = str(conn.get("ChannelNumber") or ch_id)

            # Status block
            status_obj = dev.get("Status", {}) if isinstance(dev.get("Status"), dict) else {}
            connect_status = str(status_obj.get("ConnectStatus", "")).strip()
            record_status = str(status_obj.get("RecordStatus", "")).strip()
            state = str(status_obj.get("State", "")).strip()

            status = "ONLINE"
            if connect_status in ("0", "OFFLINE", "DISCONNECT", "false", "False") or state in ("0", "OFFLINE"):
                status = "OFFLINE"
            elif record_status in ("1", "RECORDING", "REC", "true", "True"):
                status = "RECORDING"

            # Filter valid IPv4
            if ip and re.match(r'^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$', str(ip).strip()):
                cameras.append({
                    "channel_id": str(ch_num),
                    "name": str(name).strip(),
                    "ip": str(ip).strip(),
                    "mac_address": mac,
                    "model": str(model).strip(),
                    "status": status,
                    "http_port": int(http_port) if str(http_port).isdigit() else 80,
                    "rtsp_port": int(rtsp_port) if str(rtsp_port).isdigit() else 554,
                })

    return cameras


def _parse_acti_response(text: str) -> List[Dict[str, Any]]:
    """
    Phân tích phản hồi từ ACTi NVR (hỗ trợ JSON ACTi 3.0, XML, hoặc Key-Value INI format).
    """
    cameras = []
    if not text or not text.strip():
        return cameras

    clean_text = text.strip()

    # 1. Thử phân tích JSON (ACTi NVR 3.0 Media API)
    if (clean_text.startswith("{") and clean_text.endswith("}")) or (clean_text.startswith("[") and clean_text.endswith("]")):
        try:
            json_data = json.loads(clean_text)
            parsed_json = _parse_acti_json_response(json_data)
            if parsed_json:
                return parsed_json
        except Exception as e:
            logger.debug(f"JSON parse fallback to XML: {e}")

    # 2. Thử phân tích cú pháp XML (ACTi NVR 3.0 & ENR XML responses)
    if "<" in clean_text and ">" in clean_text:
        try:
            start_idx = clean_text.find("<")
            xml_str = clean_text[start_idx:]
            root = ET.fromstring(xml_str)

            # Quét các thẻ Device / Camera / Channel / Source
            device_nodes = (
                root.findall(".//Device") or
                root.findall(".//device") or
                root.findall(".//Camera") or
                root.findall(".//camera") or
                root.findall(".//Channel") or
                root.findall(".//channel") or
                root.findall(".//Source") or
                root.findall(".//source") or
                root.findall(".//Item") or
                root.findall(".//item")
            )

            for idx, node in enumerate(device_nodes, start=1):
                def get_tag(tag_names, default=""):
                    for t in tag_names:
                        el = node.find(t)
                        if el is not None and el.text:
                            return el.text.strip()
                        # Attribute check
                        if t in node.attrib:
                            return node.attrib[t].strip()
                        # Check nested Connection tag
                        conn_el = node.find("Connection")
                        if conn_el is not None:
                            sub_el = conn_el.find(t)
                            if sub_el is not None and sub_el.text:
                                return sub_el.text.strip()
                    return default

                ch_id = get_tag(["ID", "id", "ChannelID", "channel_id", "DeviceID", "device_id", "Index", "index"], str(idx))
                name = get_tag(["Name", "name", "DeviceName", "device_name", "CameraName", "camera_name", "Title"], f"Camera {ch_id}")
                ip = get_tag(["HostName", "hostname", "IP", "ip", "IPAddress", "ip_address", "Host", "host", "URL", "url"])
                mac_raw = get_tag(["MAC", "mac", "MacAddress", "mac_address", "MACAddress"])
                model = get_tag(["ModelNumber", "model_number", "Model", "model", "DeviceModel", "device_model", "Type", "type"], "ACTi IP Camera")
                status_raw = get_tag(["Status", "status", "State", "state", "ConnectStatus", "connect_status", "RecordStatus"], "").upper()

                # Làm sạch IP (nếu url chứa rtsp:// hoặc http://...)
                if ip and "://" in ip:
                    ip_match = re.search(r'://([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)', ip)
                    if ip_match:
                        ip = ip_match.group(1)

                # Chuẩn hóa trạng thái
                status = "ONLINE"
                if "OFFLINE" in status_raw or "DISCONNECT" in status_raw or "0" == status_raw or "LOSS" in status_raw:
                    status = "OFFLINE" if "OFF" in status_raw else "VIDEO_LOSS"
                elif "REC" in status_raw or "RECORDING" in status_raw:
                    status = "RECORDING"

                # Kiểm tra IP hợp lệ IPv4
                if ip and re.match(r'^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$', ip):
                    cameras.append({
                        "channel_id": str(ch_id),
                        "name": name,
                        "ip": ip,
                        "mac_address": _normalize_mac(mac_raw),
                        "model": model,
                        "status": status,
                    })

            if cameras:
                return cameras
        except Exception as e:
            logger.debug(f"Không thể parse XML từ NVR: {e}")

    # 3. Thử phân tích cú pháp Key=Value / INI (Một số firmware ACTi ENR cũ)
    lines = clean_text.splitlines()
    current_dev = {}
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#"):
            continue

        if "=" in line:
            key, val = line.split("=", 1)
            key = key.strip().lower()
            val = val.strip()

            if key in ("device_id", "channel_id", "id", "index", "camera_id"):
                if current_dev.get("ip"):
                    cameras.append(current_dev)
                current_dev = {"channel_id": val, "name": f"Camera {val}", "ip": "", "model": "ACTi", "status": "ONLINE"}
            elif key in ("name", "device_name", "camera_name"):
                current_dev["name"] = val
            elif key in ("ip", "ip_address", "host", "hostname"):
                if re.match(r'^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$', val):
                    current_dev["ip"] = val
            elif key in ("mac", "mac_address"):
                current_dev["mac_address"] = _normalize_mac(val)
            elif key in ("model", "device_model"):
                current_dev["model"] = val
            elif key in ("status", "state"):
                current_dev["status"] = "ONLINE" if val in ("1", "online", "recording") else "OFFLINE"

    if current_dev.get("ip"):
        cameras.append(current_dev)

    return cameras


async def test_nvr_api(ip: str, port: int, username: str = "admin", password: str = "") -> Tuple[bool, str]:
    """Kiểm tra xác thực và kết nối API tới đầu ghi NVR ACTi."""
    auth_headers = _build_auth_header(username, password)
    
    # Thứ tự các endpoint kiểm tra kết nối API thật
    test_urls = [
        f"http://{ip}:{port}/Media/Device/getDevice?response_format=json",
        f"http://{ip}:{port}/Media/UserGroup/login?response_format=json",
        f"http://{ip}:{port}/Media/Source/getSource?response_format=json",
        f"http://{ip}:{port}/cgi-bin/nvr?cmd=get_device_list",
        f"http://{ip}:{port}/cgi-bin/cmd/system?GET_DEVICES",
    ]

    last_error = "Không có phản hồi từ NVR"
    for url in test_urls:
        status, body, _ = await asyncio.to_thread(_http_request, url, auth_headers, 3.5)
        text_preview = body.decode("utf-8", errors="ignore") if body else ""

        if status == 200:
            return True, "Kết nối API đầu ghi NVR thành công!"
        elif status == 401:
            return False, "Chưa xác thực hoặc sai mật khẩu đầu ghi (HTTP 401 Unauthorized)."
        elif status == 406 or "1009" in text_preview:
            return False, "Sai tài khoản hoặc mật khẩu đăng nhập đầu ghi NVR (Mã lỗi ACTi 1009 - Invalid Credentials)."
        elif status == 403:
            return False, "Tài khoản không có quyền truy cập API đầu ghi (HTTP 403 Forbidden)."
        elif status > 0 and status != 404:
            last_error = f"NVR trả về mã lỗi HTTP {status}"

    return False, f"Không thể kết nối API NVR ({last_error}). Vui lòng kiểm tra IP và Mật khẩu đầu ghi."


async def fetch_cameras_from_nvr(nvr: NVR) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    """
    Gửi yêu cầu tới ACTi NVR để lấy danh sách camera.
    Trả về: (danh_sách_camera, thông_báo_lỗi_nếu_có)
    """
    ip = nvr.ip
    port = nvr.http_port or 80
    user = nvr.username or "admin"
    pwd = nvr.password or ""

    if not pwd:
        return [], "Chưa nhập mật khẩu NVR. Vui lòng bấm 'Sửa' đầu ghi và nhập mật khẩu quản trị."

    auth_headers = _build_auth_header(user, pwd)

    # Ưu tiên các endpoint Media API chuẩn của ACTi NVR 3.0
    candidate_urls = [
        f"http://{ip}:{port}/Media/Device/getDevice?response_format=json",
        f"http://{ip}:{port}/Media/Source/getSource?response_format=json",
        f"http://{ip}:{port}/Media/Device/getDevice",
        f"http://{ip}:{port}/cgi-bin/nvr?cmd=get_device_list",
        f"http://{ip}:{port}/cgi-bin/nvr?cmd=get_camera_list",
        f"http://{ip}:{port}/cgi-bin/cmd/system?GET_DEVICES",
        f"http://{ip}:{port}/config/channel.xml",
        f"http://{ip}:{port}/api/v1/devices",
        # Fallback URL param
        f"http://{ip}:{port}/cgi-bin/nvr?USER={urllib.parse.quote(user)}&PWD={urllib.parse.quote(pwd)}&cmd=get_device_list",
    ]

    last_error_msg = None
    for url in candidate_urls:
        try:
            status, body, _ = await asyncio.to_thread(_http_request, url, auth_headers, 4.5)
            text = body.decode("utf-8", errors="ignore") if body else ""

            if status == 200 and text:
                devices = _parse_acti_response(text)
                if devices:
                    logger.info(f"[{nvr.name} - {ip}] Lấy được {len(devices)} cameras từ endpoint {url}")
                    return devices, None
            elif status == 406 or "1009" in text:
                last_error_msg = "Mật khẩu NVR không đúng (Mã lỗi ACTi 1009 - Invalid Credentials). Vui lòng cập nhật mật khẩu trong phần 'Sửa' NVR."
            elif status == 401:
                last_error_msg = "Không thể xác thực với NVR (HTTP 401 Unauthorized). Vui lòng kiểm tra lại tài khoản/mật khẩu."
        except Exception as e:
            logger.debug(f"Lỗi khi thử {url}: {e}")

    return [], last_error_msg


async def sync_nvr_cameras(nvr_id: int) -> Dict[str, Any]:
    """
    Đồng bộ danh sách Camera từ NVR vào cơ sở dữ liệu:
    - Thêm camera mới nếu chưa có.
    - Cập nhật thông tin NVR ID, Kênh, MAC address và trạng thái nếu đã có.
    """
    with Session(engine) as session:
        nvr = session.get(NVR, nvr_id)
        if not nvr:
            return {"success": False, "message": "Không tìm thấy đầu ghi NVR trong hệ thống", "added": 0, "updated": 0, "errors": []}

        # Kéo camera từ NVR
        device_list, err_msg = await fetch_cameras_from_nvr(nvr)

        if not device_list:
            if err_msg:
                return {
                    "success": False,
                    "message": err_msg,
                    "added": 0,
                    "updated": 0,
                    "total_found": 0,
                    "errors": [err_msg]
                }

            # Kiểm tra API để đưa ra thông báo chính xác
            ok, test_msg = await test_nvr_api(nvr.ip, nvr.http_port, nvr.username, nvr.password)
            if not ok:
                return {
                    "success": False,
                    "message": f"Không thể lấy danh sách camera: {test_msg}",
                    "added": 0,
                    "updated": 0,
                    "total_found": 0,
                    "errors": [test_msg]
                }

            return {
                "success": True,
                "message": f"Đầu ghi {nvr.name} ({nvr.ip}) kết nối thành công nhưng hiện tại chưa có camera nào được gán kênh.",
                "added": 0,
                "updated": 0,
                "total_found": 0,
                "errors": []
            }

        # ── Probe trạng thái thực tế của các camera bằng fast concurrent ping ──
        from app.services.ping_checker import ping_single

        async def check_dev_live(dev_dict):
            cip = dev_dict.get("ip")
            if not cip:
                return dev_dict, False, None
            _, alive, latency = await ping_single(cip, timeout=1.0)
            return dev_dict, alive, latency

        probe_tasks = [check_dev_live(d) for d in device_list]
        probe_results = await asyncio.gather(*probe_tasks)

        added = 0
        updated = 0
        ts = now_utc()

        for dev, alive, latency_ms in probe_results:
            cam_ip = dev.get("ip")
            if not cam_ip:
                continue

            cam_name = dev.get("name") or f"Cam-{dev.get('channel_id')}"
            cam_model = dev.get("model") or "ACTi"
            cam_mac = dev.get("mac_address")
            ch_id = str(dev.get("channel_id") or "")
            
            # Nếu camera có tên thể hiện đã tháo dỡ, sửa chữa hoặc lỗi PoE -> OFFLINE
            if is_decommissioned_camera(cam_name):
                nvr_status = "OFFLINE"
                latency_ms = None
            else:
                # Camera đang quản lý bởi đầu ghi NVR hoạt động
                nvr_status = "ONLINE"
                if not alive:
                    latency_ms = None

            # Tìm xem camera theo IP đã tồn tại trong DB chưa
            existing = session.exec(select(Camera).where(Camera.ip == cam_ip)).first()

            if existing:
                existing.nvr_id = nvr.id
                existing.nvr_channel_id = ch_id
                existing.nvr_status = nvr_status
                if cam_model and not existing.model:
                    existing.model = cam_model
                if cam_mac and not existing.mac_address:
                    existing.mac_address = cam_mac
                session.add(existing)

                # Cập nhật NetworkMapping status
                mapping = session.exec(select(NetworkMapping).where(NetworkMapping.camera_id == existing.id)).first()
                if mapping:
                    mapping.status = nvr_status
                    mapping.latency_ms = latency_ms
                    if nvr_status == "ONLINE":
                        mapping.last_seen_at = ts
                    session.add(mapping)

                updated += 1
            else:
                new_cam = Camera(
                    name=cam_name,
                    ip=cam_ip,
                    mac_address=cam_mac,
                    model=cam_model,
                    nvr_id=nvr.id,
                    nvr_channel_id=ch_id,
                    nvr_status=nvr_status,
                    created_at=ts,
                )
                session.add(new_cam)
                session.commit()
                session.refresh(new_cam)

                # Tạo NetworkMapping mặc định
                mapping = NetworkMapping(
                    camera_id=new_cam.id,
                    switch_id=None,
                    switch_port=None,
                    status=nvr_status,
                    latency_ms=latency_ms,
                    last_seen_at=ts if nvr_status == "ONLINE" else None,
                )
                session.add(mapping)
                added += 1

        nvr.status = "ONLINE"
        nvr.last_seen_at = ts
        nvr.last_synced_at = ts
        nvr.synced_camera_count = len(device_list)
        nvr.service_status_detail = json.dumps({
            "mode": "API",
            "api": "ONLINE",
            "message": f"Kết nối Media API thành công, đồng bộ {len(device_list)} cameras (đã xác thực trạng thái thực tế)"
        }, ensure_ascii=False)
        session.add(nvr)
        session.commit()

        # Phát WebSocket để giao diện cập nhật ngay lập tức
        try:
            from app.services.alert_manager import broadcast_nvr_status_change, broadcast_scan_complete
            await broadcast_nvr_status_change(
                nvr_id=nvr.id,
                nvr_name=nvr.name,
                nvr_ip=nvr.ip,
                old_status="UNKNOWN",
                new_status="ONLINE",
                service_status_detail=nvr.service_status_detail
            )
            await broadcast_scan_complete(f"Đã đồng bộ {len(device_list)} camera từ đầu ghi {nvr.name}", len(device_list))
        except Exception:
            pass

        shrink_sqlite_memory()

        return {
            "success": True,
            "message": f"Đồng bộ thành công từ đầu ghi {nvr.name}: Tìm thấy {len(device_list)} camera (Thêm mới: {added}, Cập nhật: {updated}). Trạng thái đầu ghi: Hoạt động (ONLINE)",
            "total_found": len(device_list),
            "added": added,
            "updated": updated,
            "errors": []
        }


async def set_camera_name_on_nvr(camera_id: int, new_name: str) -> Tuple[bool, str]:
    """
    Đổi tên Camera đồng bộ sang đầu ghi NVR (2-way Name Sync).
    Gửi lệnh HTTP API tới NVR mà camera đang liên kết.
    """
    with Session(engine) as session:
        camera = session.get(Camera, camera_id)
        if not camera or not camera.nvr_id:
            return False, "Camera chưa được gán vào đầu ghi NVR nào"

        nvr = session.get(NVR, camera.nvr_id)
        if not nvr:
            return False, "Không tìm thấy thông tin đầu ghi NVR liên kết"

        ch_id = camera.nvr_channel_id or "1"
        ip = nvr.ip
        port = nvr.http_port or 80
        auth_headers = _build_auth_header(nvr.username or "admin", nvr.password or "")

        encoded_name = urllib.parse.quote(new_name)

        set_name_urls = [
            f"http://{ip}:{port}/cgi-bin/nvr?cmd=set_device_name&device_id={ch_id}&device_name={encoded_name}",
            f"http://{ip}:{port}/cgi-bin/cmd/system?SET_CHANNEL_NAME&CHANNEL={ch_id}&NAME={encoded_name}",
            f"http://{ip}:{port}/cgi-bin/nvr?cmd=set_camera_name&camera_id={ch_id}&camera_name={encoded_name}",
            f"http://{ip}:{port}/cgi-bin/nvr?cmd=modify_device&device_id={ch_id}&name={encoded_name}",
        ]

        last_status = 0
        for url in set_name_urls:
            status, body, _ = await asyncio.to_thread(_http_request, url, auth_headers, 3.5)
            last_status = status
            if status == 200:
                logger.info(f"Đã đổi tên camera ID {camera.id} (Kênh {ch_id}) thành '{new_name}' trên NVR {nvr.name}")
                return True, f"Đã đồng bộ đổi tên camera trên đầu ghi NVR ({nvr.name}) thành công!"

        return False, f"Không thể đổi tên trên đầu ghi NVR (Mã phản hồi HTTP: {last_status})"
