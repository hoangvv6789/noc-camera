from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, Request
import asyncio
from app.services.alert_manager import manager
from app.database import get_session
from sqlmodel import Session
from app.api.dashboard import get_dashboard_summary

router = APIRouter()

@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, session: Session = Depends(get_session)):
    """
    WebSocket endpoint để client kết nối và nhận sự kiện real-time.
    - Nhận snapshot ban đầu
    - Gửi/Nhận ping-pong keepalive
    - Nhận event broadcast từ alert_manager
    """
    await manager.connect(websocket)
    try:
        # Gửi ngay snapshot dashboard summary khi mới kết nối
        summary = get_dashboard_summary(session)
        init_data = {
            "event_type": "init_snapshot",
            "data": summary.model_dump()
        }
        await websocket.send_json(init_data)
        
        # Lắng nghe message từ client (ping/pong, đóng kết nối)
        while True:
            data = await websocket.receive_text()
            # Nếu client gửi ping, phản hồi lại pong
            if data.lower() == "ping":
                await websocket.send_text("pong")
                
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        # Log lỗi nếu cần thiết
        manager.disconnect(websocket)



# WebSocket router chỉ phục vụ kết nối real-time cho Frontend

