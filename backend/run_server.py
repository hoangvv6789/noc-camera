"""
Entry point để chạy server hoặc đóng gói thành file .EXE (PyInstaller).
Đã xử lý triệt để lỗi 'NoneType' object has no attribute 'isatty' khi chạy ở chế độ ẩn console (windowed).
"""
import sys
import os
import io
import time
import webbrowser
import threading
import logging


# ─────────────────────────────────────────────────────────────
# FIX CHO PYINSTALLER WINDOWED MODE:
# Khi chạy --windowed, sys.stdout và sys.stderr bị gán None
# -> Cần mock stream có hàm isatty() trả về False để Uvicorn không crash
# ─────────────────────────────────────────────────────────────
class SafeStream:
    def __init__(self, target_file=None):
        self.target_file = target_file

    def isatty(self):
        return False

    def write(self, data):
        if self.target_file:
            try:
                with open(self.target_file, "a", encoding="utf-8") as f:
                    f.write(data)
            except Exception:
                pass

    def flush(self):
        pass

    def fileno(self):
        raise io.UnsupportedOperation("fileno not available")


# Xác định thư mục ứng dụng
if getattr(sys, 'frozen', False):
    app_dir = os.path.dirname(sys.executable)
else:
    app_dir = os.path.dirname(os.path.abspath(__file__))

log_file = os.path.join(app_dir, "server.log")

if sys.stdout is None:
    sys.stdout = SafeStream(log_file)
if sys.stderr is None:
    sys.stderr = SafeStream(log_file)
if sys.stdin is None:
    sys.stdin = SafeStream(None)


def open_browser():
    """Tự động mở trình duyệt web sau khi server khởi động."""
    time.sleep(1.8)
    webbrowser.open("http://localhost:8687")


if __name__ == "__main__":
    # Đảm bảo đường dẫn import
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    os.environ["PYTHONIOENCODING"] = "utf-8"

    # Mở trình duyệt web tự động
    threading.Thread(target=open_browser, daemon=True).start()

    import uvicorn
    from app.main import app

    # Chạy uvicorn với log_config=None hoặc use_colors=False để tránh format isatty
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8687,
        log_config=None,
        use_colors=False,
    )
