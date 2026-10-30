import asyncio
import csv
import io
import math
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, Query, HTTPException, UploadFile, File, BackgroundTasks
from sqlmodel import Session, select, func, or_, desc, asc

from app.database import get_session, engine
from app.models import NVR
from app.schemas import PaginatedNVRs, NVRRead, NVRCreate, NVRUpdate, NVRSyncResult
from app.services.nvr_checker import check_all_nvrs, check_single_nvr

router = APIRouter()


def _to_nvr_read(nvr: NVR) -> NVRRead:
    """Chuyển đổi model NVR sang NVRRead schema an toàn, không bao giờ lộ password ra ngoài."""
    return NVRRead(
        id=nvr.id,
        name=nvr.name,
        ip=nvr.ip,
        model=nvr.model,
        location=nvr.location,
        http_port=nvr.http_port,
        rtsp_port=nvr.rtsp_port,
        service_port=nvr.service_port,
        custom_ports=nvr.custom_ports,
        username=nvr.username,
        has_password=bool(nvr.password and len(nvr.password.strip()) > 0),
        status=nvr.status,
        service_status_detail=nvr.service_status_detail,
        latency_ms=nvr.latency_ms,
        last_seen_at=nvr.last_seen_at,
        last_synced_at=nvr.last_synced_at,
        synced_camera_count=nvr.synced_camera_count or 0,
        created_at=nvr.created_at,
    )


@router.get("", response_model=PaginatedNVRs)
def get_nvrs(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=1000),
    status: Optional[str] = None,  # ALL, ONLINE, SERVICE_FROZEN, OFFLINE
    search: Optional[str] = None,
    session: Session = Depends(get_session)
):
    """Lấy danh sách đầu ghi NVR có phân trang, tìm kiếm và lọc trạng thái."""
    base_query = select(NVR)
    filters = []

    if status and status.upper() != "ALL":
        filters.append(NVR.status == status.upper())

    if search:
        search_term = f"%{search}%"
        filters.append(
            or_(
                NVR.name.ilike(search_term),
                NVR.ip.ilike(search_term),
                NVR.model.ilike(search_term),
                NVR.location.ilike(search_term),
            )
        )

    if filters:
        base_query = base_query.where(*filters)

    count_query = select(func.count()).select_from(base_query.subquery())
    total_items = session.exec(count_query).one()

    # Sắp xếp: SERVICE_FROZEN lên đầu, sau đó OFFLINE, sau đó theo tên
    order_query = base_query.order_by(
        desc(NVR.status == "SERVICE_FROZEN"),
        desc(NVR.status == "OFFLINE"),
        asc(NVR.name)
    )

    offset = (page - 1) * page_size
    results = session.exec(order_query.offset(offset).limit(page_size)).all()

    items = [_to_nvr_read(n) for n in results]
    total_pages = math.ceil(total_items / page_size) if total_items > 0 else 0

    return PaginatedNVRs(
        items=items,
        total=total_items,
        page=page,
        page_size=page_size,
        total_pages=total_pages
    )


@router.post("/sync-all", response_model=NVRSyncResult)
async def sync_all_nvrs_endpoint(session: Session = Depends(get_session)):
    """Đồng bộ toàn bộ danh sách Camera từ CMS 2.0."""
    from app.services.cms2_client import sync_cms2_to_db
    from app.models import CMSConfig

    cfg = session.exec(select(CMSConfig)).first()
    if not cfg:
        raise HTTPException(
            status_code=400,
            detail="Chưa cấu hình thông tin kết nối CMS 2.0. Vui lòng bấm 'Đồng bộ từ CMS 2.0' để nhập thông tin."
        )

    res = await sync_cms2_to_db(
        session=session,
        ip=cfg.ip,
        port=cfg.port,
        username=cfg.username,
        password=cfg.password or "",
        save_config=False
    )
    return NVRSyncResult(
        success=res.get("success", False),
        message=res.get("message", ""),
        total_found=res.get("total_cameras", 0),
        added=res.get("cameras_added", 0),
        updated=res.get("cameras_updated", 0),
        errors=res.get("errors", [])
    )


@router.post("/{nvr_id}/sync-cameras", response_model=NVRSyncResult)
async def sync_cameras_endpoint(nvr_id: int, session: Session = Depends(get_session)):
    """Đồng bộ danh sách Camera từ CMS 2.0."""
    return await sync_all_nvrs_endpoint(session)



@router.post("", response_model=NVRRead, status_code=201)

async def create_nvr(
    nvr_in: NVRCreate,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session)
):
    """Thêm đầu ghi NVR mới và tự động chạy kiểm tra ngay."""
    existing = session.exec(select(NVR).where(NVR.ip == nvr_in.ip)).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Đầu ghi NVR với IP {nvr_in.ip} đã tồn tại (ID: {existing.id})")

    nvr = NVR(
        name=nvr_in.name,
        ip=nvr_in.ip,
        model=nvr_in.model or "ACTi NVR",
        location=nvr_in.location,
        http_port=nvr_in.http_port or 80,
        rtsp_port=nvr_in.rtsp_port or 554,
        service_port=nvr_in.service_port,
        custom_ports=nvr_in.custom_ports,
        username=nvr_in.username or "admin",
        password=nvr_in.password or "",
        created_at=datetime.now(timezone.utc),
    )
    session.add(nvr)
    session.commit()
    session.refresh(nvr)

    # Chạy kiểm tra sức khỏe ngay ở background
    async def scan_new():
        with Session(engine) as s:
            target = s.get(NVR, nvr.id)
            if target:
                await check_single_nvr(target, s)
                s.commit()

    background_tasks.add_task(scan_new)

    return _to_nvr_read(nvr)


@router.put("/{nvr_id}", response_model=NVRRead)
async def update_nvr(
    nvr_id: int,
    nvr_in: NVRUpdate,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session)
):
    """Cập nhật thông tin và các cổng giám sát của NVR."""
    nvr = session.get(NVR, nvr_id)
    if not nvr:
        raise HTTPException(status_code=404, detail="Không tìm thấy đầu ghi NVR")

    if nvr_in.ip and nvr_in.ip != nvr.ip:
        existing = session.exec(select(NVR).where(NVR.ip == nvr_in.ip)).first()
        if existing:
            raise HTTPException(status_code=409, detail=f"IP {nvr_in.ip} đã được dùng bởi đầu ghi khác")
        nvr.ip = nvr_in.ip

    if nvr_in.name is not None:
        nvr.name = nvr_in.name
    if nvr_in.model is not None:
        nvr.model = nvr_in.model
    if nvr_in.location is not None:
        nvr.location = nvr_in.location
    if nvr_in.http_port is not None:
        nvr.http_port = nvr_in.http_port
    if nvr_in.rtsp_port is not None:
        nvr.rtsp_port = nvr_in.rtsp_port
    if nvr_in.service_port is not None:
        nvr.service_port = nvr_in.service_port
    if nvr_in.custom_ports is not None:
        nvr.custom_ports = nvr_in.custom_ports
    if nvr_in.username is not None:
        nvr.username = nvr_in.username
    # Chỉ cập nhật mật khẩu nếu người dùng nhập mật khẩu mới không rỗng
    if nvr_in.password is not None and nvr_in.password.strip() != "":
        nvr.password = nvr_in.password.strip()

    session.add(nvr)
    session.commit()
    session.refresh(nvr)

    # Chạy quét lại sau khi cập nhật cấu hình
    async def scan_updated():
        with Session(engine) as s:
            target = s.get(NVR, nvr.id)
            if target:
                await check_single_nvr(target, s)
                s.commit()

    background_tasks.add_task(scan_updated)

    return _to_nvr_read(nvr)


@router.delete("/{nvr_id}", status_code=204)
def delete_nvr(nvr_id: int, session: Session = Depends(get_session)):
    """Xóa đầu ghi NVR khỏi hệ thống."""
    nvr = session.get(NVR, nvr_id)
    if not nvr:
        raise HTTPException(status_code=404, detail="Không tìm thấy đầu ghi NVR")

    session.delete(nvr)
    session.commit()
    return None


@router.post("/scan", status_code=200)
async def scan_all_nvrs(background_tasks: BackgroundTasks):
    """Kích hoạt quét toàn bộ đầu ghi NVR ngay lập tức."""
    background_tasks.add_task(check_all_nvrs)
    return {"message": "Đã bắt đầu quét kiểm tra dịch vụ toàn bộ đầu ghi NVR..."}


@router.post("/{nvr_id}/scan", response_model=NVRRead)
async def scan_single_nvr_endpoint(nvr_id: int, session: Session = Depends(get_session)):
    """Quét kiểm tra trực tiếp 1 đầu ghi NVR và trả về kết quả ngay."""
    nvr = session.get(NVR, nvr_id)
    if not nvr:
        raise HTTPException(status_code=404, detail="Không tìm thấy đầu ghi NVR")

    await check_single_nvr(nvr, session)
    session.commit()
    session.refresh(nvr)
    return _to_nvr_read(nvr)


@router.post("/import-csv", status_code=200)
async def import_nvrs_csv(
    file: UploadFile = File(...),
    session: Session = Depends(get_session)
):
    """
    Import hàng loạt đầu ghi NVR từ file CSV.
    Header mẫu: name,ip,model,location,http_port,rtsp_port,service_port,custom_ports
    """
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Chỉ hỗ trợ file CSV (.csv)")

    content = await file.read()
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = content.decode("cp1252", errors="replace")

    reader = csv.DictReader(io.StringIO(text))

    required_cols = {"name", "ip"}
    if not required_cols.issubset(set(reader.fieldnames or [])):
        raise HTTPException(
            status_code=400,
            detail=f"CSV thiếu cột bắt buộc. Cần có: {required_cols}. Hiện có: {reader.fieldnames}"
        )

    added, skipped, errors = 0, 0, []

    for line_num, row in enumerate(reader, start=2):
        ip = (row.get("ip") or "").strip()
        name = (row.get("name") or "").strip()

        if not ip or not name:
            errors.append(f"Dòng {line_num}: thiếu 'name' hoặc 'ip'")
            continue

        existing = session.exec(select(NVR).where(NVR.ip == ip)).first()
        if existing:
            skipped += 1
            continue

        http_port = int(row.get("http_port")) if row.get("http_port") and row.get("http_port").isdigit() else 80
        rtsp_port = int(row.get("rtsp_port")) if row.get("rtsp_port") and row.get("rtsp_port").isdigit() else 554
        service_port = int(row.get("service_port")) if row.get("service_port") and row.get("service_port").isdigit() else None

        nvr = NVR(
            name=name,
            ip=ip,
            model=(row.get("model") or "").strip() or "ACTi NVR",
            location=(row.get("location") or "").strip() or None,
            http_port=http_port,
            rtsp_port=rtsp_port,
            service_port=service_port,
            custom_ports=(row.get("custom_ports") or "").strip() or None,
            created_at=datetime.now(timezone.utc),
        )
        session.add(nvr)
        added += 1

    session.commit()

    return {
        "message": f"Import hoàn tất: {added} NVR mới, {skipped} bỏ qua (IP trùng), {len(errors)} lỗi",
        "added": added,
        "skipped": skipped,
        "errors": errors,
    }
