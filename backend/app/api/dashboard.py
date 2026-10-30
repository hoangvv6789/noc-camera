from fastapi import APIRouter, Depends
from sqlmodel import Session, select, func
from app.database import get_session
from app.models import Camera, Switch, NetworkMapping, NVR
from app.schemas import DashboardSummary

router = APIRouter()

@router.get("/summary", response_model=DashboardSummary)
def get_dashboard_summary(session: Session = Depends(get_session)):
    """Lấy thông tin tổng quan dashboard (Camera + Switch + NVR)"""
    # Đếm tổng số camera
    total_cameras = session.exec(select(func.count(Camera.id))).first() or 0
    
    # Đếm số lượng online / offline từ NetworkMapping
    online_cameras = session.exec(
        select(func.count(NetworkMapping.id)).where(NetworkMapping.status == "ONLINE")
    ).first() or 0
    
    offline_cameras = session.exec(
        select(func.count(NetworkMapping.id)).where(NetworkMapping.status == "OFFLINE")
    ).first() or 0
    
    # Đảm bảo tổng số luôn bằng đúng Hoạt Động + Mất Kết Nối
    if (online_cameras + offline_cameras) != total_cameras:
        offline_cameras = max(0, total_cameras - online_cameras)
    
    # Đếm tổng số switch
    total_switches = session.exec(select(func.count(Switch.id))).first() or 0
    
    # Tính tỷ lệ offline camera
    offline_rate = 0.0
    if total_cameras > 0:
        offline_rate = (offline_cameras / total_cameras) * 100.0
        
    # Thống kê NVR
    total_nvrs = session.exec(select(func.count(NVR.id))).first() or 0
    online_nvrs = session.exec(
        select(func.count(NVR.id)).where(NVR.status == "ONLINE")
    ).first() or 0
    frozen_nvrs = session.exec(
        select(func.count(NVR.id)).where(NVR.status == "SERVICE_FROZEN")
    ).first() or 0
    offline_nvrs = session.exec(
        select(func.count(NVR.id)).where(NVR.status == "OFFLINE")
    ).first() or 0

    # Đếm số camera đã định vị trên Switch
    total_mapped_cameras = session.exec(
        select(func.count(NetworkMapping.id)).where(NetworkMapping.switch_id.is_not(None))
    ).first() or 0
    unmapped_cameras = max(0, total_cameras - total_mapped_cameras)

    return DashboardSummary(
        total_cameras=total_cameras,
        online_cameras=online_cameras,
        offline_cameras=offline_cameras,
        total_switches=total_switches,
        offline_rate_percent=round(offline_rate, 2),
        total_mapped_cameras=total_mapped_cameras,
        unmapped_cameras=unmapped_cameras,
        total_nvrs=total_nvrs,
        online_nvrs=online_nvrs,
        frozen_nvrs=frozen_nvrs,
        offline_nvrs=offline_nvrs,
    )


@router.get("/alerts")
def get_recent_alerts(limit: int = 50, session: Session = Depends(get_session)):
    """Lấy danh sách các cảnh báo sự cố Camera/NVR gần nhất."""
    from app.models import AlertLog, Camera
    from sqlmodel import desc

    alerts_query = (
        select(
            AlertLog.id,
            AlertLog.camera_id,
            AlertLog.event_type,
            AlertLog.timestamp,
            AlertLog.acknowledged,
            Camera.name.label("camera_name"),
            Camera.ip.label("camera_ip"),
            Camera.location.label("camera_location"),
        )
        .join(Camera, AlertLog.camera_id == Camera.id)
        .order_by(desc(AlertLog.timestamp))
        .limit(limit)
    )
    rows = session.exec(alerts_query).all()

    return [
        {
            "id": r.id,
            "camera_id": r.camera_id,
            "camera_name": r.camera_name,
            "camera_ip": r.camera_ip,
            "camera_location": r.camera_location,
            "event_type": r.event_type,
            "timestamp": r.timestamp,
            "acknowledged": r.acknowledged,
        }
        for r in rows
    ]


@router.post("/alerts/clear")
def clear_alerts(session: Session = Depends(get_session)):
    """Đánh dấu đã xem hoặc xóa các cảnh báo cũ."""
    from app.models import AlertLog
    logs = session.exec(select(AlertLog)).all()
    for l in logs:
        session.delete(l)
    session.commit()
    return {"message": "Đã xóa toàn bộ lịch sử cảnh báo"}

