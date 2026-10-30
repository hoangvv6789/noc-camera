from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

# --- Switch Schemas ---
class SwitchBase(BaseModel):
    ip: str
    hostname: str
    community_string: str = 'public'
    snmp_version: str = 'v2c'
    location: str

class SwitchCreate(SwitchBase):
    pass

class SwitchUpdate(SwitchBase):
    ip: Optional[str] = None
    hostname: Optional[str] = None
    location: Optional[str] = None

class SwitchRead(BaseModel):
    id: int
    ip: str
    hostname: str
    community_string: Optional[str] = 'public'
    snmp_version: str = 'v2c'
    location: str
    last_scanned_at: Optional[datetime] = None
    camera_count: Optional[int] = 0
    online_camera_count: Optional[int] = 0
    ping_status: Optional[str] = None
    latency_ms: Optional[float] = None

    class Config:
        from_attributes = True

# --- Camera Schemas ---
class CameraBase(BaseModel):
    name: str
    ip: str
    mac_address: Optional[str] = None
    model: Optional[str] = None
    location: Optional[str] = None
    nvr_id: Optional[int] = None
    nvr_channel_id: Optional[str] = None
    nvr_status: Optional[str] = None

class CameraCreate(CameraBase):
    pass

class CameraUpdate(BaseModel):
    name: Optional[str] = None
    ip: Optional[str] = None
    mac_address: Optional[str] = None
    model: Optional[str] = None
    location: Optional[str] = None
    nvr_id: Optional[int] = None
    nvr_channel_id: Optional[str] = None

class CameraNameUpdate(BaseModel):
    name: str

class CameraScanMacRequest(BaseModel):
    username: Optional[str] = None
    password: Optional[str] = None
    secret: Optional[str] = None


class CameraRead(CameraBase):
    id: int
    created_at: datetime
    # Extra fields từ NetworkMapping & NVR
    switch_name: Optional[str] = None
    switch_ip: Optional[str] = None          # ← IP của Switch
    switch_port: Optional[str] = None
    nvr_name: Optional[str] = None           # ← Tên đầu ghi NVR
    nvr_ip: Optional[str] = None             # ← IP đầu ghi NVR
    status: Optional[str] = "UNKNOWN"
    latency_ms: Optional[float] = None
    last_seen_at: Optional[datetime] = None  # ← thêm để frontend hiển thị "Lần cuối thấy"

    class Config:
        from_attributes = True

# --- NetworkMapping Schemas ---
class NetworkMappingRead(BaseModel):
    id: int
    camera_id: int
    switch_id: int
    switch_port: str
    vlan: Optional[int]
    status: str
    last_seen_at: datetime
    latency_ms: Optional[float]

    class Config:
        from_attributes = True

# --- AlertLog Schemas ---
class AlertLogRead(BaseModel):
    id: int
    camera_id: int
    event_type: str
    timestamp: datetime
    acknowledged: bool

    class Config:
        from_attributes = True

# --- NVR Schemas ---
class NVRBase(BaseModel):
    name: str
    ip: str
    model: Optional[str] = "ACTi NVR"
    location: Optional[str] = None
    http_port: int = 80
    rtsp_port: int = 554
    service_port: Optional[int] = None
    custom_ports: Optional[str] = None
    username: Optional[str] = "admin"
    password: Optional[str] = ""

class NVRCreate(NVRBase):
    pass

class NVRUpdate(BaseModel):
    name: Optional[str] = None
    ip: Optional[str] = None
    model: Optional[str] = None
    location: Optional[str] = None
    http_port: Optional[int] = None
    rtsp_port: Optional[int] = None
    service_port: Optional[int] = None
    custom_ports: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None

class NVRRead(BaseModel):
    id: int
    name: str
    ip: str
    model: Optional[str] = "ACTi NVR"
    location: Optional[str] = None
    http_port: int = 80
    rtsp_port: int = 554
    service_port: Optional[int] = None
    custom_ports: Optional[str] = None
    username: Optional[str] = "admin"
    has_password: bool = False  # Chỉ trả về cờ đánh dấu đã có mật khẩu, không bao giờ lộ plain password ra API
    status: str = "UNKNOWN"
    service_status_detail: Optional[str] = None
    latency_ms: Optional[float] = None
    last_seen_at: Optional[datetime] = None
    last_synced_at: Optional[datetime] = None
    synced_camera_count: Optional[int] = 0
    created_at: datetime

    class Config:
        from_attributes = True

class NVRSyncResult(BaseModel):
    success: bool
    message: str
    total_found: int = 0
    added: int = 0
    updated: int = 0
    errors: List[str] = []

class PaginatedNVRs(BaseModel):
    items: List[NVRRead]
    total: int
    page: int
    page_size: int
    total_pages: int


# --- Dashboard Schemas ---
class DashboardSummary(BaseModel):
    total_cameras: int
    online_cameras: int
    offline_cameras: int
    total_switches: int
    offline_rate_percent: float
    total_mapped_cameras: int = 0
    unmapped_cameras: int = 0
    # NVR Metrics
    total_nvrs: int = 0
    online_nvrs: int = 0
    frozen_nvrs: int = 0
    offline_nvrs: int = 0

# --- Pagination Schemas ---
class PaginatedCameras(BaseModel):
    items: List[CameraRead]
    total: int
    page: int
    page_size: int
    total_pages: int


# --- CMS 2.0 Schemas ---
class CMS2ConfigRequest(BaseModel):
    ip: str = "172.18.20.200"
    port: int = 80
    username: str = "Admin"
    password: Optional[str] = ""
    save_config: bool = True


class CMS2ConfigRead(BaseModel):
    ip: str = "172.18.20.200"
    port: int = 80
    username: str = "Admin"
    has_password: bool = False
    last_synced_at: Optional[datetime] = None
    last_status: Optional[str] = None
    synced_cameras: int = 0
    synced_nvrs: int = 0
    updated_at: Optional[datetime] = None


class CMS2TestResult(BaseModel):
    success: bool
    message: str
    product_name: Optional[str] = None
    domain: Optional[str] = None


class CMS2SyncResult(BaseModel):
    success: bool
    message: str
    total_cameras: int = 0
    total_nvrs: int = 0
    cameras_added: int = 0
    cameras_updated: int = 0
    errors: List[str] = []


