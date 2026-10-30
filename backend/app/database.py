from sqlmodel import SQLModel, Session, create_engine
from sqlalchemy import event
from sqlalchemy.pool import StaticPool
from app.config import settings

# Khởi tạo SQLite engine tối ưu RAM và tốc độ truy vấn
connect_args = {"check_same_thread": False, "timeout": 15} if settings.DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(
    settings.DATABASE_URL,
    echo=False,
    connect_args=connect_args,
    poolclass=StaticPool if settings.DATABASE_URL.startswith("sqlite") else None,
)


@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    """
    Tối ưu hóa bộ nhớ RAM và tốc độ đọc/ghi cho SQLite:
    - WAL mode: Tăng tốc độ đọc/ghi đồng thời, không khóa DB
    - cache_size = -1000: Giới hạn bộ đệm RAM tối đa 1MB
    - wal_autocheckpoint = 500: Tự động dọn dẹp file WAL để không phình to đĩa và RAM
    - temp_store = MEMORY: Xử lý bảng tạm trong RAM nhỏ
    - synchronous = NORMAL: Giảm tải I/O đĩa
    """
    if settings.DATABASE_URL.startswith("sqlite"):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode = WAL")
        cursor.execute("PRAGMA synchronous = NORMAL")
        cursor.execute("PRAGMA cache_size = -1000")
        cursor.execute("PRAGMA wal_autocheckpoint = 500")
        cursor.execute("PRAGMA temp_store = MEMORY")
        cursor.close()


def shrink_sqlite_memory():
    """Giải phóng các trang bộ nhớ đệm SQLite thừa về cho hệ điều hành."""
    if settings.DATABASE_URL.startswith("sqlite"):
        try:
            with engine.connect() as conn:
                conn.exec_driver_sql("PRAGMA shrink_memory")
                conn.exec_driver_sql("PRAGMA wal_checkpoint(PASSIVE)")
        except Exception:
            pass



def create_db_and_tables():
    """Tạo database và các bảng nếu chưa có"""
    SQLModel.metadata.create_all(engine)


def get_session():
    """Dependency injection cho FastAPI để lấy session"""
    with Session(engine) as session:
        yield session
