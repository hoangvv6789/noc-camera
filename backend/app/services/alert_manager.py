from fastapi import WebSocket
from typing import List, Dict, Any
import logging

logger = logging.getLogger(__name__)

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        """Chấp nhận connection WS và thêm vào danh sách"""
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"Client connected. Active connections: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        """Xóa connection khỏi danh sách khi đóng"""
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            logger.info(f"Client disconnected. Active connections: {len(self.active_connections)}")

    async def broadcast(self, data: Dict[str, Any]):
        """Gửi message JSON đến toàn bộ active connections"""
        disconnected_ws = []
        for connection in self.active_connections:
            try:
                await connection.send_json(data)
            except Exception as e:
                logger.error(f"Lỗi khi gửi data qua WS: {e}")
                disconnected_ws.append(connection)
                
        # Dọn dẹp connection lỗi
        for ws in disconnected_ws:
            self.disconnect(ws)

# Khởi tạo singleton manager
manager = ConnectionManager()

async def broadcast_status_change(camera_id: int, camera_name: str, camera_ip: str, 
                                 old_status: str, new_status: str, latency_ms: float):
    """Helper method để gửi event thay đổi trạng thái"""
    event_data = {
        "event_type": "status_change",
        "data": {
            "camera_id": camera_id,
            "camera_name": camera_name,
            "camera_ip": camera_ip,
            "old_status": old_status,
            "new_status": new_status,
            "latency_ms": latency_ms
        }
    }
    await manager.broadcast(event_data)


async def broadcast_scan_complete(message: str, total_mapped: int):
    """Helper gửi event khi quét MAC hoặc quét Ping hoàn tất"""
    event_data = {
        "event_type": "scan_complete",
        "data": {
            "message": message,
            "total_mapped": total_mapped,
        }
    }
    await manager.broadcast(event_data)


async def broadcast_nvr_status_change(
    nvr_id: int,
    nvr_name: str,
    nvr_ip: str,
    old_status: str,
    new_status: str,
    latency_ms: float = None,
    service_status_detail: str = None
):
    """Helper gửi event thay đổi trạng thái đầu ghi NVR"""
    event_data = {
        "event_type": "nvr_status_change",
        "data": {
            "nvr_id": nvr_id,
            "nvr_name": nvr_name,
            "nvr_ip": nvr_ip,
            "old_status": old_status,
            "new_status": new_status,
            "latency_ms": latency_ms,
            "service_status_detail": service_status_detail,
        }
    }
    await manager.broadcast(event_data)


