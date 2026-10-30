from fastapi import APIRouter, HTTPException
import asyncio
import os
import logging
from typing import Dict, Optional
from pydantic import BaseModel

from app.services.ping_checker import ping_all_cameras
from app.services.snmp_crawler import crawl_all_switches
from app.services.ssh_crawler import crawl_all_switches_ssh
from app.services.alert_manager import broadcast_scan_complete

router = APIRouter()
logger = logging.getLogger(__name__)

job_status: Dict[str, bool] = {
    "ping": False,
    "snmp": False,
    "ssh": False,
}


class SshCredentials(BaseModel):
    username: Optional[str] = None
    password: Optional[str] = None
    secret: Optional[str] = None


async def run_ping_job():
    if job_status["ping"]:
        return
    job_status["ping"] = True
    try:
        await ping_all_cameras()
    except Exception as e:
        logger.error(f"Lỗi khi chạy manual ping job: {e}", exc_info=True)
    finally:
        job_status["ping"] = False


async def run_ssh_crawl_job(username: str, password: str, secret: Optional[str]):
    try:
        logger.info("Bắt đầu tác vụ quét MAC qua SSH Cisco...")
        loop = asyncio.get_running_loop()
        # Chạy crawler trong thread pool để không làm nghẽn event loop
        res = await loop.run_in_executor(None, crawl_all_switches_ssh, username, password, secret)
        logger.info(f"SSH Crawl hoàn tất: {res}")

        msg = res.get("message", "Đã quét xong bảng MAC qua SSH!")
        total_mapped = res.get("total_mapped", 0)
        await broadcast_scan_complete(msg, total_mapped)
    except Exception as e:
        logger.error(f"Lỗi khi chạy SSH crawl: {e}", exc_info=True)
    finally:
        job_status["ssh"] = False


@router.post("/ping")
async def trigger_ping_scan():
    """Kích hoạt quét ping thủ công (chạy nền)."""
    if job_status["ping"]:
        return {"message": "Job ping đang chạy, vui lòng chờ", "status": "running"}
    asyncio.create_task(run_ping_job())
    return {"message": "Đã bắt đầu quét ping", "status": "started"}


@router.post("/ssh-mac")
async def trigger_ssh_scan(creds: SshCredentials):
    """
    Kích hoạt quét MAC qua SSH Cisco Switch.
    Nhận username/password trực tiếp từ form hoặc từ biến môi trường .env.
    """
    if job_status["ssh"]:
        return {"message": "Job quét SSH đang chạy, vui lòng chờ...", "status": "running"}

    username = creds.username or os.getenv("SWITCH_SSH_USERNAME")
    password = creds.password or os.getenv("SWITCH_SSH_PASSWORD")
    secret = creds.secret or os.getenv("SWITCH_SSH_SECRET")

    if not username or not password:
        raise HTTPException(
            status_code=400,
            detail="Vui lòng cung cấp Username và Password SSH của Switch!"
        )

    job_status["ssh"] = True
    asyncio.create_task(run_ssh_crawl_job(username, password, secret))

    return {
        "message": "Đã bắt đầu quét bảng MAC qua SSH...",
        "status": "started"
    }


@router.post("/mac-table")
async def trigger_snmp_or_ssh_scan(creds: Optional[SshCredentials] = None):
    """
    Kích hoạt quét MAC. Nếu có SSH credentials thì chạy SSH, nếu không thử SNMP.
    """
    username = creds.username if creds else os.getenv("SWITCH_SSH_USERNAME")
    password = creds.password if creds else os.getenv("SWITCH_SSH_PASSWORD")

    if username and password:
        return await trigger_ssh_scan(creds)

    if job_status["snmp"]:
        return {"message": "Job SNMP đang chạy", "status": "running"}
    asyncio.create_task(crawl_all_switches())
    return {"message": "Đã bắt đầu quét SNMP MAC table", "status": "started"}


@router.get("/status")
async def get_scan_status() -> Dict[str, bool]:
    """Kiểm tra trạng thái các job."""
    return job_status
