from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from pydantic import BaseModel
from typing import List, Optional
import csv
import io
import os
import asyncio
from collections import defaultdict
from sqlmodel import Session, select
from app.database import get_session
from app.models import Switch, Camera, NetworkMapping
from app.schemas import SwitchRead, SwitchCreate, SwitchUpdate
from app.services.ssh_crawler import exec_cisco_command, reset_cisco_port, crawl_single_switch_and_update
from app.services.ping_checker import ping_single

router = APIRouter()


class SshCommandRequest(BaseModel):
    switch_ip: str
    username: str
    password: str
    secret: Optional[str] = None
    command: str


class SshResetPortRequest(BaseModel):
    switch_ip: str
    username: str
    password: str
    secret: Optional[str] = None
    port: str
    delay_seconds: int = 15


class SwitchScanRequest(BaseModel):
    username: Optional[str] = None
    password: Optional[str] = None
    secret: Optional[str] = None


@router.post("/exec-command")
async def execute_switch_command(req: SshCommandRequest):
    """
    Thực thi lệnh chẩn đoán Cisco trực tiếp qua SSH và trả về kết quả thời gian thực.
    Ví dụ: show interface Gi1/0/32 status, show mac address-table, show run, ping...
    """
    if not req.switch_ip or not req.username or not req.password or not req.command:
        raise HTTPException(status_code=400, detail="Vui lòng cung cấp đầy đủ: Switch IP, Username, Password và Lệnh thực thi.")

    loop = asyncio.get_running_loop()
    res = await loop.run_in_executor(
        None,
        exec_cisco_command,
        req.switch_ip,
        req.username,
        req.password,
        req.secret,
        req.command
    )
    return res


@router.post("/reset-port")
async def reset_switch_port_endpoint(req: SshResetPortRequest):
    """
    Thực hiện chu trình ngắt cổng Switch (shutdown), tạm dừng 15-30 giây để xả nguồn PoE, sau đó bật lại cổng (no shutdown).
    """
    if not req.switch_ip or not req.username or not req.password or not req.port:
        raise HTTPException(status_code=400, detail="Vui lòng cung cấp đầy đủ: Switch IP, Username, Password và Cổng (Port).")

    loop = asyncio.get_running_loop()
    res = await loop.run_in_executor(
        None,
        reset_cisco_port,
        req.switch_ip,
        req.username,
        req.password,
        req.secret,
        req.port,
        req.delay_seconds
    )
    return res


@router.get("", response_model=List[SwitchRead])
def get_switches(session: Session = Depends(get_session)):
    """Lấy danh sách tất cả các switch kèm thống kê số lượng camera"""
    switches = session.exec(select(Switch)).all()
    mappings = session.exec(select(NetworkMapping)).all()

    count_map = defaultdict(int)
    online_count_map = defaultdict(int)

    for m in mappings:
        if m.switch_id:
            count_map[m.switch_id] += 1
            if m.status == 'ONLINE':
                online_count_map[m.switch_id] += 1

    result = []
    for sw in switches:
        sw_dict = sw.model_dump()
        sw_dict["camera_count"] = count_map.get(sw.id, 0)
        sw_dict["online_camera_count"] = online_count_map.get(sw.id, 0)
        result.append(SwitchRead(**sw_dict))
    return result


@router.post("/ping-all")
async def ping_all_switches(session: Session = Depends(get_session)):
    """Kiểm tra phản hồi Ping đồng loạt tới tất cả các Switch"""
    switches = session.exec(select(Switch)).all()
    if not switches:
        return {}

    async def _ping_sw(sw):
        ip, alive, rtt = await ping_single(sw.ip, timeout=1.0)
        return sw.id, {"alive": alive, "latency_ms": rtt}

    tasks = [_ping_sw(sw) for sw in switches]
    results = await asyncio.gather(*tasks)
    return dict(results)


@router.get("/{switch_id}/cameras")
def get_switch_cameras(switch_id: int, session: Session = Depends(get_session)):
    """Lấy danh sách tất cả camera đang được định vị trên Switch này"""
    sw = session.get(Switch, switch_id)
    if not sw:
        raise HTTPException(status_code=404, detail="Không tìm thấy Switch")

    mappings = session.exec(select(NetworkMapping).where(NetworkMapping.switch_id == switch_id)).all()
    cam_ids = [m.camera_id for m in mappings if m.camera_id]
    if not cam_ids:
        return []

    cameras = session.exec(select(Camera).where(Camera.id.in_(cam_ids))).all()
    cam_dict = {c.id: c for c in cameras}

    result = []
    for m in mappings:
        cam = cam_dict.get(m.camera_id)
        if cam:
            result.append({
                "camera_id": cam.id,
                "name": cam.name,
                "ip": cam.ip,
                "mac_address": cam.mac_address,
                "status": m.status or "OFFLINE",
                "switch_port": m.switch_port or "Unknown",
                "latency_ms": m.latency_ms,
                "last_seen_at": m.last_seen_at.isoformat() if m.last_seen_at else None,
            })
    result.sort(key=lambda x: x["switch_port"])
    return result


@router.post("/{switch_id}/ping")
async def ping_switch(switch_id: int, session: Session = Depends(get_session)):
    """Kiểm tra phản hồi Ping tới Switch"""
    sw = session.get(Switch, switch_id)
    if not sw:
        raise HTTPException(status_code=404, detail="Không tìm thấy Switch")

    ip, alive, rtt = await ping_single(sw.ip, timeout=1.0)
    msg = f"Switch '{sw.hostname}' ({sw.ip}) phản hồi tốt trong {rtt:.1f}ms" if alive else f"Switch '{sw.hostname}' ({sw.ip}) không phản hồi (Mất kết nối)!"
    return {
        "switch_id": switch_id,
        "hostname": sw.hostname,
        "ip": sw.ip,
        "alive": alive,
        "latency_ms": rtt,
        "message": msg
    }


@router.post("/{switch_id}/scan-mac")
async def scan_switch_mac(
    switch_id: int,
    req: Optional[SwitchScanRequest] = None,
    session: Session = Depends(get_session)
):
    """Kích hoạt quét MAC riêng cho một switch qua SSH"""
    username = (req.username if req else None) or os.getenv("SWITCH_SSH_USERNAME")
    password = (req.password if req else None) or os.getenv("SWITCH_SSH_PASSWORD")
    secret = (req.secret if req else None) or os.getenv("SWITCH_SSH_SECRET")

    if not username or not password:
        raise HTTPException(
            status_code=400,
            detail="Vui lòng cung cấp Username và Password SSH của Switch!"
        )

    loop = asyncio.get_running_loop()
    res = await loop.run_in_executor(
        None,
        crawl_single_switch_and_update,
        switch_id,
        username,
        password,
        secret
    )
    return res


@router.post("", response_model=SwitchRead, status_code=status.HTTP_201_CREATED)
def create_switch(switch_in: SwitchCreate, session: Session = Depends(get_session)):
    """Thêm một switch mới"""
    existing = session.exec(select(Switch).where(Switch.ip == switch_in.ip)).first()
    if existing:
        raise HTTPException(status_code=400, detail="Switch với IP này đã tồn tại")

    db_switch = Switch.model_validate(switch_in)
    session.add(db_switch)
    session.commit()
    session.refresh(db_switch)
    return db_switch


@router.put("/{switch_id}", response_model=SwitchRead)
def update_switch(switch_id: int, switch_in: SwitchUpdate, session: Session = Depends(get_session)):
    """Cập nhật thông tin switch"""
    db_switch = session.get(Switch, switch_id)
    if not db_switch:
        raise HTTPException(status_code=404, detail="Không tìm thấy Switch")

    update_data = switch_in.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_switch, key, value)

    session.add(db_switch)
    session.commit()
    session.refresh(db_switch)
    return db_switch


@router.delete("/{switch_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_switch(switch_id: int, session: Session = Depends(get_session)):
    """Xóa một switch"""
    db_switch = session.get(Switch, switch_id)
    if not db_switch:
        raise HTTPException(status_code=404, detail="Không tìm thấy Switch")

    session.delete(db_switch)
    session.commit()
    return None


@router.post("/import-csv", status_code=status.HTTP_200_OK)
async def import_switches_csv(
    file: UploadFile = File(...),
    session: Session = Depends(get_session)
):
    """
    Import hàng loạt switch từ file CSV.
    Header yêu cầu: ip,hostname
    Header tùy chọn: community_string,snmp_version,location
    """
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Chỉ hỗ trợ file định dạng CSV (.csv)")

    content = await file.read()
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = content.decode("cp1252", errors="replace")

    reader = csv.DictReader(io.StringIO(text))
    required_cols = {"ip", "hostname"}
    if not required_cols.issubset(set(reader.fieldnames or [])):
        raise HTTPException(
            status_code=400,
            detail=f"CSV thiếu cột bắt buộc. Cần có: {required_cols}. Hiện có: {reader.fieldnames}"
        )

    added, skipped, errors = 0, 0, []

    for line_num, row in enumerate(reader, start=2):
        ip = (row.get("ip") or "").strip()
        hostname = (row.get("hostname") or "").strip()

        if not ip or not hostname:
            errors.append(f"Dòng {line_num}: thiếu IP hoặc Hostname")
            continue

        existing = session.exec(select(Switch).where(Switch.ip == ip)).first()
        if existing:
            skipped += 1
            continue

        community = (row.get("community_string") or row.get("community") or "public").strip()
        version = (row.get("snmp_version") or "v2c").strip()
        location = (row.get("location") or row.get("vi_tri") or "Server Room").strip()

        sw = Switch(
            ip=ip,
            hostname=hostname,
            community_string=community,
            snmp_version=version,
            location=location
        )
        session.add(sw)
        added += 1

    session.commit()

    return {
        "message": f"Import thành công: {added} switch mới, {skipped} bỏ qua (IP trùng), {len(errors)} lỗi",
        "added": added,
        "skipped": skipped,
        "errors": errors,
    }
