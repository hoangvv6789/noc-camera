import os
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from contextlib import asynccontextmanager
import logging

# Import các components
from app.config import settings
from app.database import create_db_and_tables
from app.services.scheduler import start_scheduler, shutdown_scheduler

# Import routers
from app.api.dashboard import router as dashboard_router
from app.api.cameras import router as cameras_router
from app.api.switches import router as switches_router
from app.api.scan import router as scan_router
from app.api.websocket import router as ws_router
from app.api.nvrs import router as nvrs_router
from app.api.cms2 import router as cms2_router

# Thiết lập logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    create_db_and_tables()
    start_scheduler()
    from app.services.cms2_client import start_cms2_live_monitor, stop_cms2_live_monitor
    start_cms2_live_monitor()
    yield
    # Shutdown
    stop_cms2_live_monitor()
    shutdown_scheduler()


app = FastAPI(
    title="Camera NOC Dashboard",
    description="Hệ thống giám sát camera ACTi, đầu ghi NVR & định vị port switch Cisco",
    version="1.3.0",
    lifespan=lifespan
)

# Cấu hình CORS middleware (cho phép cả khi chạy dev mode hoặc cùng port)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Gắn các API routers (tất cả đều có prefix /api)
app.include_router(dashboard_router, prefix="/api/dashboard", tags=["Dashboard"])
app.include_router(cameras_router, prefix="/api/cameras", tags=["Cameras"])
app.include_router(nvrs_router, prefix="/api/nvrs", tags=["NVRs"])
app.include_router(switches_router, prefix="/api/switches", tags=["Switches"])
app.include_router(scan_router, prefix="/api/scan", tags=["Scan Actions"])
app.include_router(ws_router, prefix="/api/events", tags=["WebSocket"])
app.include_router(cms2_router, prefix="/api/cms2", tags=["CMS 2.0"])



@app.get("/health")
def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "version": "1.2.0"}


import sys

# ─────────────────────────────────────────────────────────────
# GỘP FRONTEND VÀ BACKEND CHẠY TRÊN CÙNG 1 PORT DUY NHẤT
# Tự động phục vụ các file tĩnh đã build từ frontend/dist
# (Tương thích cả khi chạy code nguồn lẫn khi đóng gói file .EXE)
# ─────────────────────────────────────────────────────────────
if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
    # Đang chạy từ file .EXE đóng gói PyInstaller
    frontend_dist_dir = os.path.join(sys._MEIPASS, 'dist')
    if not os.path.exists(frontend_dist_dir):
        frontend_dist_dir = os.path.join(sys._MEIPASS, 'frontend', 'dist')
else:
    # Đang chạy mã nguồn Python bình thường
    frontend_dist_dir = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist")
    )

if os.path.exists(frontend_dist_dir):
    logger.info(f"Đang phục vụ Frontend tĩnh từ: {frontend_dist_dir}")

    # Mount thư mục assets (CSS, JS, images)
    assets_dir = os.path.join(frontend_dist_dir, "assets")
    if os.path.exists(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    # Phục vụ file index.html cho trang chủ và tất cả các đường dẫn giao diện SPA
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        # Nếu yêu cầu file tĩnh cụ thể trong dist (favicon, robots, etc.)
        file_path = os.path.join(frontend_dist_dir, full_path)
        if full_path and os.path.isfile(file_path):
            return FileResponse(file_path)
        # Mặc định trả về index.html cho React Router
        return FileResponse(os.path.join(frontend_dist_dir, "index.html"))
else:
    @app.get("/")
    def root():
        return {
            "message": "Camera NOC Backend API is running.",
            "note": "Chưa tìm thấy frontend/dist. Hãy chạy 'npm run build' trong thư mục frontend."
        }
