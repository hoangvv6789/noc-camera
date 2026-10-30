import sys
import os
import json
from typing import List
from pydantic_settings import BaseSettings, SettingsConfigDict


def get_default_db_url() -> str:
    """Tự động xác định đường dẫn file SQLite db (trong cùng thư mục chạy exe hoặc app)."""
    if getattr(sys, 'frozen', False):
        base_dir = os.path.dirname(sys.executable)
    else:
        base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    db_path = os.path.join(base_dir, "camera_monitor.db").replace("\\", "/")
    return f"sqlite:///{db_path}"


class Settings(BaseSettings):
    DATABASE_URL: str = get_default_db_url()
    SECRET_KEY: str = "change-me-in-production"
    PING_INTERVAL_SECONDS: int = 300
    SNMP_INTERVAL_SECONDS: int = 3600
    NVR_INTERVAL_SECONDS: int = 60       # Chu kỳ kiểm tra NVR & Camera (giây, mặc định 60s / 1 phút)
    NVR_TIMEOUT: float = 2.0            # Timeout kiểm tra mỗi cổng NVR (giây)
    PING_CONCURRENCY: int = 500  # Giới hạn số lượng ping đồng thời
    PING_TIMEOUT: float = 1.0
    CORS_ORIGINS: str = '["*"]'

    @property
    def cors_origins_list(self) -> List[str]:
        try:
            return json.loads(self.CORS_ORIGINS)
        except Exception:
            return ["*"]

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


settings = Settings()
