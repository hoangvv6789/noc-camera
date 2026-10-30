import logging
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from app.config import settings
from app.services.ping_checker import ping_all_cameras

logger = logging.getLogger(__name__)

# Khởi tạo scheduler
scheduler = AsyncIOScheduler()


async def periodic_cms2_sync_job():
    """Tự động đồng bộ lại từ CMS 2.0 định kỳ 5 phút 1 lần."""
    from app.database import engine
    from sqlmodel import Session, select
    from app.models import CMSConfig
    from app.services.cms2_client import sync_cms2_to_db

    logger.info("⏱️ [Scheduler] Bắt đầu chu kỳ tự động đồng bộ CMS 2.0 (mỗi 5 phút)...")
    try:
        with Session(engine) as session:
            cfg = session.exec(select(CMSConfig)).first()
            if not cfg or not cfg.username:
                logger.info("Chưa lưu tài khoản CMS 2.0, bỏ qua chu kỳ tự động đồng bộ.")
                return

            ip = cfg.ip
            port = cfg.port
            username = cfg.username
            password = cfg.password or ""

        # Tiến hành đồng bộ từ CMS 2.0
        with Session(engine) as session:
            result = await sync_cms2_to_db(
                session=session,
                ip=ip,
                port=port,
                username=username,
                password=password,
                save_config=True
            )
            logger.info(f"✅ [Scheduler] Hoàn tất chu kỳ 5p: {result.get('message')}")
    except Exception as e:
        logger.error(f"❌ [Scheduler] Lỗi trong chu kỳ tự động đồng bộ CMS 2.0: {e}")


def start_scheduler():
    """Khởi động scheduler với chu kỳ tự động đồng bộ CMS 2.0 mỗi 5 phút."""
    # Thêm job tự động đồng bộ CMS 2.0 mỗi 5 phút
    scheduler.add_job(
        periodic_cms2_sync_job,
        IntervalTrigger(minutes=5),
        id="cms2_periodic_sync",
        name="CMS 2.0 Periodic Sync (Every 5 minutes)",
        replace_existing=True
    )
    scheduler.start()
    logger.info("Scheduler đã khởi động: Tự động đồng bộ CMS 2.0 mỗi 5 phút (Real-time stream qua WebSocket)")


def shutdown_scheduler():
    """Tắt scheduler khi ứng dụng đóng"""
    if scheduler.running:
        scheduler.shutdown()
        logger.info("Scheduler shutdown successfully")

