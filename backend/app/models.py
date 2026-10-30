from sqlmodel import SQLModel, Field
from typing import Optional
from datetime import datetime, timezone


def utcnow() -> datetime:
    """Trả về UTC hiện tại (timezone-aware). Thay thế datetime.utcnow() đã deprecated."""
    return datetime.now(timezone.utc)


class Switch(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    ip: str = Field(unique=True, index=True)
    hostname: str
    community_string: str = Field(default="public")
    snmp_version: str = Field(default="v2c")
    location: str
    last_scanned_at: Optional[datetime] = None


class Camera(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    ip: str = Field(index=True)
    mac_address: Optional[str] = Field(default=None, index=True)
    model: Optional[str] = None
    location: Optional[str] = None
    # Liên kết với Đầu ghi NVR
    nvr_id: Optional[int] = Field(default=None, foreign_key="nvr.id", index=True)
    nvr_channel_id: Optional[str] = Field(default=None)  # ID kênh hoặc Device ID trên NVR
    nvr_status: Optional[str] = Field(default=None)       # ONLINE / RECORDING / VIDEO_LOSS / OFFLINE
    created_at: datetime = Field(default_factory=utcnow)


class NetworkMapping(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    camera_id: int = Field(foreign_key="camera.id", index=True)
    # FIX: switch_id và switch_port là Optional để camera mới chưa có switch vẫn có mapping
    switch_id: Optional[int] = Field(default=None, foreign_key="switch.id", index=True)
    switch_port: Optional[str] = Field(default=None)
    vlan: Optional[int] = None
    status: str = Field(default="OFFLINE")   # ONLINE / OFFLINE
    # FIX: last_seen_at Optional + timezone-aware default
    last_seen_at: Optional[datetime] = Field(default=None)
    latency_ms: Optional[float] = None


class AlertLog(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    camera_id: int = Field(foreign_key="camera.id", index=True)
    event_type: str   # OFFLINE / RECOVERED
    timestamp: datetime = Field(default_factory=utcnow)
    acknowledged: bool = Field(default=False)


class NVR(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    ip: str = Field(unique=True, index=True)
    model: Optional[str] = Field(default="ACTi NVR")
    location: Optional[str] = None
    http_port: int = Field(default=80)
    rtsp_port: int = Field(default=554)
    service_port: Optional[int] = Field(default=None)  # Tùy chọn (để None nếu không dùng)
    custom_ports: Optional[str] = Field(default=None)  # Danh sách port phụ (VD: 8080,8899)
    # Thông tin đăng nhập NVR để đồng bộ Camera
    username: Optional[str] = Field(default="admin")
    password: Optional[str] = Field(default="")
    status: str = Field(default="UNKNOWN")  # ONLINE / SERVICE_FROZEN / OFFLINE / UNKNOWN
    service_status_detail: Optional[str] = Field(default=None)  # JSON string lưu trạng thái từng port
    latency_ms: Optional[float] = None
    last_seen_at: Optional[datetime] = None
    last_synced_at: Optional[datetime] = None
    synced_camera_count: Optional[int] = Field(default=0)
    created_at: datetime = Field(default_factory=utcnow)


class CMSConfig(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    ip: str = Field(default="172.18.20.200")
    port: int = Field(default=80)
    username: str = Field(default="Admin")
    password: Optional[str] = Field(default="")
    last_synced_at: Optional[datetime] = None
    last_status: Optional[str] = None
    synced_cameras: Optional[int] = Field(default=0)
    synced_nvrs: Optional[int] = Field(default=0)
    updated_at: datetime = Field(default_factory=utcnow)


