from fastapi import APIRouter, Depends, Query, HTTPException, UploadFile, File
from sqlmodel import Session, select, func, or_, desc, asc
from typing import Optional, List
from datetime import datetime, timezone
import math
import csv
import io
import os
import asyncio
from app.database import get_session
from app.models import Camera, NetworkMapping, Switch, NVR
from app.schemas import PaginatedCameras, CameraRead, CameraCreate, CameraScanMacRequest
from app.services.ping_checker import ping_single_camera_by_id
from app.services.ssh_crawler import crawl_single_camera_mac

router = APIRouter()



@router.get("", response_model=PaginatedCameras)
def get_cameras(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=1000),
    status: Optional[str] = None,  # ALL, ONLINE, OFFLINE
    search: Optional[str] = None,
    switch_id: Optional[int] = None,
    nvr_id: Optional[int] = None,
    mapped: Optional[str] = None,  # ALL, MAPPED, UNMAPPED
    session: Session = Depends(get_session)
):
    """
    Lấy danh sách camera có phân trang, tìm kiếm và lọc.
    Trả về camera kèm thông tin từ bảng mapping, switch và đầu ghi NVR.
    """
    base_query = select(
        Camera.id,
        Camera.name,
        Camera.ip,
        Camera.mac_address,
        Camera.model,
        Camera.location,
        Camera.nvr_id,
        Camera.nvr_channel_id,
        Camera.nvr_status,
        Camera.created_at,
        NetworkMapping.status,
        NetworkMapping.latency_ms,
        NetworkMapping.switch_port,
        NetworkMapping.last_seen_at,
        Switch.hostname.label("switch_name"),
        Switch.ip.label("switch_ip"),
        NVR.name.label("nvr_name"),
        NVR.ip.label("nvr_ip"),
    ).outerjoin(
        NetworkMapping, Camera.id == NetworkMapping.camera_id
    ).outerjoin(
        Switch, NetworkMapping.switch_id == Switch.id
    ).outerjoin(
        NVR, Camera.nvr_id == NVR.id
    )

    filters = []

    if status and status.upper() != "ALL":
        filters.append(NetworkMapping.status == status.upper())

    if switch_id:
        filters.append(Switch.id == switch_id)

    if nvr_id:
        filters.append(Camera.nvr_id == nvr_id)

    if mapped:
        if mapped.upper() == "MAPPED":
            filters.append(NetworkMapping.switch_id.is_not(None))
        elif mapped.upper() == "UNMAPPED":
            filters.append(NetworkMapping.switch_id.is_(None))

    if search:
        search_term = f"%{search}%"
        filters.append(
            or_(
                Camera.name.ilike(search_term),
                Camera.ip.ilike(search_term),
                Camera.mac_address.ilike(search_term),
                NetworkMapping.switch_port.ilike(search_term),
                Switch.hostname.ilike(search_term),
                Switch.ip.ilike(search_term),
                NVR.name.ilike(search_term),
                NVR.ip.ilike(search_term)
            )
        )

    if filters:
        base_query = base_query.where(*filters)

    count_query = select(func.count()).select_from(base_query.subquery())
    total_items = session.exec(count_query).one()

    # Sắp xếp: OFFLINE lên đầu, sau đó theo tên
    order_query = base_query.order_by(
        desc(NetworkMapping.status == "OFFLINE"),
        asc(Camera.name)
    )

    offset = (page - 1) * page_size
    results = session.exec(order_query.offset(offset).limit(page_size)).all()

    items = []
    for row in results:
        items.append(CameraRead(
            id=row.id,
            name=row.name,
            ip=row.ip,
            mac_address=row.mac_address,
            model=row.model,
            location=row.location,
            nvr_id=row.nvr_id,
            nvr_channel_id=row.nvr_channel_id,
            nvr_status=row.nvr_status,
            nvr_name=row.nvr_name,
            nvr_ip=row.nvr_ip,
            created_at=row.created_at,
            status=row.status or "UNKNOWN",
            latency_ms=row.latency_ms,
            switch_port=row.switch_port,
            switch_name=row.switch_name,
            switch_ip=row.switch_ip,
            last_seen_at=row.last_seen_at,
        ))

    total_pages = math.ceil(total_items / page_size) if total_items > 0 else 0

    return PaginatedCameras(
        items=items,
        total=total_items,
        page=page,
        page_size=page_size,
        total_pages=total_pages
    )


@router.post("", response_model=CameraRead, status_code=201)
def create_camera(camera_in: CameraCreate, session: Session = Depends(get_session)):
    """
    Thêm một camera mới vào hệ thống.
    Sau khi thêm, camera sẽ được ping tự động trong chu kỳ tiếp theo (30s).
    """
    # Kiểm tra IP trùng lặp
    existing = session.exec(select(Camera).where(Camera.ip == camera_in.ip)).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Camera với IP {camera_in.ip} đã tồn tại (ID: {existing.id})")

    # Chuẩn hóa MAC address (uppercase)
    mac = camera_in.mac_address.upper().replace("-", ":") if camera_in.mac_address else None

    camera = Camera(
        name=camera_in.name,
        ip=camera_in.ip,
        mac_address=mac,
        model=camera_in.model,
        location=camera_in.location,
        created_at=datetime.now(timezone.utc),
    )
    session.add(camera)
    session.commit()
    session.refresh(camera)

    return CameraRead(
        id=camera.id,
        name=camera.name,
        ip=camera.ip,
        mac_address=camera.mac_address,
        model=camera.model,
        location=camera.location,
        created_at=camera.created_at,
        status="UNKNOWN",
        latency_ms=None,
        switch_port=None,
        switch_name=None,
        last_seen_at=None,
    )


@router.put("/{camera_id}", response_model=CameraRead)
def update_camera(
    camera_id: int,
    camera_in: CameraCreate,
    session: Session = Depends(get_session)
):
    """Cập nhật thông tin camera (tên, IP, MAC, model, vị trí)."""
    camera = session.get(Camera, camera_id)
    if not camera:
        raise HTTPException(status_code=404, detail="Không tìm thấy camera")

    # Kiểm tra IP trùng (chỉ khi đổi IP sang IP khác)
    if camera_in.ip != camera.ip:
        existing = session.exec(select(Camera).where(Camera.ip == camera_in.ip)).first()
        if existing:
            raise HTTPException(status_code=409, detail=f"IP {camera_in.ip} đã được dùng bởi camera khác")

    camera.name = camera_in.name
    camera.ip = camera_in.ip
    camera.mac_address = camera_in.mac_address.upper().replace("-", ":") if camera_in.mac_address else None
    camera.model = camera_in.model
    camera.location = camera_in.location

    session.add(camera)
    session.commit()
    session.refresh(camera)

    # Lấy thêm thông tin mapping để trả về
    mapping = session.exec(select(NetworkMapping).where(NetworkMapping.camera_id == camera.id)).first()
    switch_name = None
    if mapping and mapping.switch_id:
        sw = session.get(Switch, mapping.switch_id)
        switch_name = sw.hostname if sw else None

    return CameraRead(
        id=camera.id,
        name=camera.name,
        ip=camera.ip,
        mac_address=camera.mac_address,
        model=camera.model,
        location=camera.location,
        created_at=camera.created_at,
        status=mapping.status if mapping else "UNKNOWN",
        latency_ms=mapping.latency_ms if mapping else None,
        switch_port=mapping.switch_port if mapping else None,
        switch_name=switch_name,
        last_seen_at=mapping.last_seen_at if mapping else None,
    )


@router.patch("/{camera_id}/name", response_model=CameraRead)
async def update_camera_name(
    camera_id: int,
    name_in: dict,
    session: Session = Depends(get_session)
):
    """Sửa trực tiếp tên Camera từ bảng Dashboard và tự động đồng bộ sang đầu ghi NVR."""
    camera = session.get(Camera, camera_id)
    if not camera:
        raise HTTPException(status_code=404, detail="Không tìm thấy camera")

    new_name = name_in.get("name", "").strip()
    if not new_name:
        raise HTTPException(status_code=400, detail="Tên camera không được để trống")

    camera.name = new_name
    session.add(camera)
    session.commit()
    session.refresh(camera)

    # Nếu camera có liên kết với NVR -> Gửi lệnh đổi tên đồng bộ sang đầu ghi
    if camera.nvr_id:
        try:
            from app.services.acti_nvr_client import set_camera_name_on_nvr
            asyncio.create_task(set_camera_name_on_nvr(camera.id, new_name))
        except Exception:
            pass

    mapping = session.exec(select(NetworkMapping).where(NetworkMapping.camera_id == camera.id)).first()
    switch_name = None
    if mapping and mapping.switch_id:
        sw = session.get(Switch, mapping.switch_id)
        switch_name = sw.hostname if sw else None

    nvr_name = None
    nvr_ip = None
    if camera.nvr_id:
        nvr = session.get(NVR, camera.nvr_id)
        if nvr:
            nvr_name = nvr.name
            nvr_ip = nvr.ip

    return CameraRead(
        id=camera.id,
        name=camera.name,
        ip=camera.ip,
        mac_address=camera.mac_address,
        model=camera.model,
        location=camera.location,
        nvr_id=camera.nvr_id,
        nvr_channel_id=camera.nvr_channel_id,
        nvr_status=camera.nvr_status,
        nvr_name=nvr_name,
        nvr_ip=nvr_ip,
        created_at=camera.created_at,
        status=mapping.status if mapping else "UNKNOWN",
        latency_ms=mapping.latency_ms if mapping else None,
        switch_port=mapping.switch_port if mapping else None,
        switch_name=switch_name,
        last_seen_at=mapping.last_seen_at if mapping else None,
    )


@router.post("/{camera_id}/ping")
async def ping_single_camera_endpoint(
    camera_id: int,
    session: Session = Depends(get_session)
):
    """Ping kiểm tra phản hồi trực tiếp của 1 camera cụ thể theo yêu cầu người dùng."""
    camera = session.get(Camera, camera_id)
    if not camera:
        raise HTTPException(status_code=404, detail="Không tìm thấy camera")
    
    res = await ping_single_camera_by_id(camera_id)
    return res


@router.post("/{camera_id}/scan-mac")
async def scan_single_camera_mac_endpoint(
    camera_id: int,
    req: Optional[CameraScanMacRequest] = None,
    session: Session = Depends(get_session)
):
    """
    Quét tìm địa chỉ MAC và định vị vị trí Switch / Cổng kết nối cho 1 camera cụ thể.
    Sử dụng thông tin đăng nhập SSH từ form hoặc từ cấu hình .env.
    """
    camera = session.get(Camera, camera_id)
    if not camera:
        raise HTTPException(status_code=404, detail="Không tìm thấy camera")

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
        crawl_single_camera_mac,
        camera_id,
        username,
        password,
        secret
    )
    return res


@router.patch("/{camera_id}/status")
async def toggle_camera_status(
    camera_id: int,
    status: Optional[str] = Query(None),
    session: Session = Depends(get_session)
):
    """
    Đổi trạng thái camera (ONLINE / OFFLINE) thủ công trực tiếp từ giao diện.
    Nếu không truyền tham số ?status= thì sẽ tự đảo ngược trạng thái hiện tại.
    """
    from datetime import datetime, timezone
    from app.models import NetworkMapping, AlertLog
    from app.services.alert_manager import broadcast_status_change

    camera = session.get(Camera, camera_id)
    if not camera:
        raise HTTPException(status_code=404, detail="Không tìm thấy camera")

    mapping = session.exec(select(NetworkMapping).where(NetworkMapping.camera_id == camera_id)).first()
    old_status = mapping.status if mapping else "ONLINE"

    new_status = status.upper() if status else ("OFFLINE" if old_status == "ONLINE" else "ONLINE")
    ts = datetime.now(timezone.utc)

    camera.nvr_status = new_status
    session.add(camera)

    if mapping:
        mapping.status = new_status
        if new_status == "ONLINE":
            mapping.last_seen_at = ts
        else:
            mapping.latency_ms = None
        session.add(mapping)
    else:
        mapping = NetworkMapping(
            camera_id=camera.id,
            switch_id=None,
            switch_port=None,
            status=new_status,
            last_seen_at=ts if new_status == "ONLINE" else None,
        )
        session.add(mapping)

    alert = AlertLog(
        camera_id=camera.id,
        event_type="OFFLINE" if new_status == "OFFLINE" else "RECOVERED",
        timestamp=ts,
    )
    session.add(alert)
    session.commit()

    try:
        await broadcast_status_change(
            camera_id=camera.id,
            camera_name=camera.name,
            camera_ip=camera.ip,
            old_status=old_status,
            new_status=new_status,
            latency_ms=1.0 if new_status == "ONLINE" else None,
        )
    except Exception:
        pass

    return {
        "success": True,
        "camera_id": camera.id,
        "camera_name": camera.name,
        "old_status": old_status,
        "new_status": new_status
    }


@router.delete("/{camera_id}", status_code=204)

def delete_camera(camera_id: int, session: Session = Depends(get_session)):
    """Xoá camera và tất cả mapping/alert liên quan."""
    camera = session.get(Camera, camera_id)
    if not camera:
        raise HTTPException(status_code=404, detail="Không tìm thấy camera")

    # Xoá NetworkMapping liên quan
    mappings = session.exec(select(NetworkMapping).where(NetworkMapping.camera_id == camera_id)).all()
    for m in mappings:
        session.delete(m)

    session.delete(camera)
    session.commit()
    return None


@router.post("/import-csv", status_code=200)
async def import_cameras_csv(
    file: UploadFile = File(...),
    session: Session = Depends(get_session)
):
    """
    Import hàng loạt camera từ file CSV.

    Định dạng CSV (có header):
        name,ip,mac_address,model,location
        CAM-Cong-Chinh,192.168.10.5,00:1A:2B:3C:4D:5E,ACTi E71,Cổng chính

    - Bỏ qua các dòng có IP đã tồn tại (không ghi đè).
    - Trả về: số camera đã thêm, số bỏ qua, danh sách lỗi.
    """
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Chỉ hỗ trợ file CSV (.csv)")

    content = await file.read()
    try:
        text = content.decode("utf-8-sig")  # utf-8-sig xử lý BOM từ Excel
    except UnicodeDecodeError:
        text = content.decode("cp1252", errors="replace")  # fallback Windows encoding

    reader = csv.DictReader(io.StringIO(text))

    # Kiểm tra headers bắt buộc
    required_cols = {"name", "ip"}
    if not required_cols.issubset(set(reader.fieldnames or [])):
        raise HTTPException(
            status_code=400,
            detail=f"CSV thiếu cột bắt buộc. Cần có: {required_cols}. Hiện có: {reader.fieldnames}"
        )

    added, skipped, errors = 0, 0, []

    for line_num, row in enumerate(reader, start=2):  # start=2 vì dòng 1 là header
        ip = (row.get("ip") or "").strip()
        name = (row.get("name") or "").strip()

        if not ip or not name:
            errors.append(f"Dòng {line_num}: thiếu 'name' hoặc 'ip'")
            continue

        # Bỏ qua nếu IP đã tồn tại
        existing = session.exec(select(Camera).where(Camera.ip == ip)).first()
        if existing:
            skipped += 1
            continue

        mac = (row.get("mac_address") or "").strip()
        mac = mac.upper().replace("-", ":") if mac else None

        camera = Camera(
            name=name,
            ip=ip,
            mac_address=mac,
            model=(row.get("model") or "").strip() or None,
            location=(row.get("location") or "").strip() or None,
            created_at=datetime.now(timezone.utc),
        )
        session.add(camera)
        added += 1

    session.commit()

    return {
        "message": f"Import hoàn tất: {added} camera mới, {skipped} bỏ qua (IP trùng), {len(errors)} lỗi",
        "added": added,
        "skipped": skipped,
        "errors": errors,
    }
