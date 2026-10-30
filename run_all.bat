@echo off
title Camera NOC Dashboard (All-in-One)
cd /d "%~dp0"

echo =======================================================
echo     HE THONG GIAM SAT CAMERA ACTi & CISCO SWITCH
echo           (Chay tren 1 Port duy nhat: 8687)
echo =======================================================
echo.

set PYTHONIOENCODING=utf-8

REM Kiem tra neu chua build frontend thi tu dong build
if not exist "frontend\dist\index.html" (
    echo [THONG BAO] Dang build giao dien Frontend lan dau...
    cd frontend
    call npm install
    call npm run build
    cd ..
)

echo 1. Dang khoi dong He thong (Backend + Web Dashboard)...
cd backend

if not exist "venv\Scripts\python.exe" (
    echo Dang tao moi truong ao venv...
    python -m venv venv
    call venv\Scripts\activate
    pip install -r requirements.txt
)

echo 2. Dang mo trinh duyet Web Dashboard...
start http://localhost:8687

echo.
echo =======================================================
echo  DA KHOI DONG THANH CONG TAI: http://localhost:8687
echo  - Web Dashboard: http://localhost:8687
echo  - API Swagger:   http://localhost:8687/docs
echo =======================================================
echo.
echo (De dung chuong trinh, hay nhan Ctrl+C hoac dong cua so nay)
echo.

venv\Scripts\python -m uvicorn app.main:app --host 0.0.0.0 --port 8687

pause
