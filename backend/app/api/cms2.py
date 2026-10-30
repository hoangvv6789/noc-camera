from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from typing import Optional

from app.database import get_session
from app.models import CMSConfig
from app.schemas import (
    CMS2ConfigRequest,
    CMS2ConfigRead,
    CMS2TestResult,
    CMS2SyncResult
)
from app.services.cms2_client import test_cms2_connection, sync_cms2_to_db

router = APIRouter()


@router.get("/config", response_model=CMS2ConfigRead)
def get_cms2_config(session: Session = Depends(get_session)):
    """Lấy cấu hình kết nối CMS 2.0 hiện tại (không trả về mật khẩu plain-text)."""
    cfg = session.exec(select(CMSConfig)).first()
    if not cfg:
        return CMS2ConfigRead(
            ip="172.18.20.200",
            port=80,
            username="Admin",
            has_password=False,
            last_synced_at=None,
            last_status=None,
            synced_cameras=0,
            synced_nvrs=0,
            updated_at=None
        )

    return CMS2ConfigRead(
        ip=cfg.ip,
        port=cfg.port,
        username=cfg.username,
        has_password=bool(cfg.password),
        last_synced_at=cfg.last_synced_at,
        last_status=cfg.last_status,
        synced_cameras=cfg.synced_cameras or 0,
        synced_nvrs=cfg.synced_nvrs or 0,
        updated_at=cfg.updated_at
    )


@router.post("/test-connection", response_model=CMS2TestResult)
async def test_connection_endpoint(
    req: CMS2ConfigRequest,
    session: Session = Depends(get_session)
):
    """
    Kiểm tra kết nối và xác thực tới máy chủ CMS 2.0.
    Nếu người dùng không gửi password nhưng đã lưu trong DB thì lấy password đã lưu.
    """
    ip = req.ip.strip() or "172.18.20.200"
    port = req.port or 80
    username = req.username.strip() or "Admin"
    password = req.password or ""

    if not password:
        cfg = session.exec(select(CMSConfig)).first()
        if cfg and cfg.password:
            password = cfg.password

    if not password:
        raise HTTPException(
            status_code=400,
            detail="Vui lòng nhập mật khẩu tài khoản CMS 2.0 để kiểm tra kết nối."
        )

    ok, message, prod_info = await test_cms2_connection(ip, port, username, password)
    return CMS2TestResult(
        success=ok,
        message=message,
        product_name=prod_info.get("product"),
        domain=prod_info.get("domain")
    )


@router.post("/sync", response_model=CMS2SyncResult)
async def sync_cms2_endpoint(
    req: CMS2ConfigRequest,
    session: Session = Depends(get_session)
):
    """
    Kéo tập trung toàn bộ danh sách Camera và Đầu ghi từ CMS 2.0 về hệ thống NOC:
    - Nhận IP, Port, Username, Password từ người dùng (không cố định cứng).
    - Tự động cập nhật Database NOC.
    - Kích hoạt Ping kiểm tra trạng thái camera ngay sau khi kéo.
    """
    ip = req.ip.strip() or "172.18.20.200"
    port = req.port or 80
    username = req.username.strip() or "Admin"
    password = req.password or ""

    if not password:
        cfg = session.exec(select(CMSConfig)).first()
        if cfg and cfg.password:
            password = cfg.password

    if not password:
        raise HTTPException(
            status_code=400,
            detail="Vui lòng nhập mật khẩu đăng nhập CMS 2.0 để bắt đầu đồng bộ."
        )

    result = await sync_cms2_to_db(
        session=session,
        ip=ip,
        port=port,
        username=username,
        password=password,
        save_config=req.save_config
    )

    if not result.get("success"):
        raise HTTPException(
            status_code=400,
            detail=result.get("message", "Đồng bộ từ CMS 2.0 thất bại.")
        )

    return CMS2SyncResult(**result)
