@echo off
title Cai Dat & Khoi Dong Camera NOC Tren May Moi
cd /d "%~dp0"

echo =======================================================
echo    CAI DAT & KHOI DONG CAMERA NOC TREN MAY TINH MOI
echo =======================================================
echo.

set PYTHONIOENCODING=utf-8

REM Kiem tra xem may da cai Python chua
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [LOI] May tinh chua cai dat Python!
    echo Vui long tai va cai dat Python 3.10 tro len tai: https://www.python.org/downloads/
    echo (Luu y: Khi cai dat nho tich vao o "Add Python to PATH")
    pause
    exit /b 1
)

cd backend

REM Tao moi truong ao neu chua co
if not exist "venv" (
    echo 1. Dang tao moi truong ao Python venv...
    python -m venv venv
)

echo 2. Dang cai dat cac thu vien can thiet...
call venv\Scripts\pip install -r requirements.txt

cd ..

echo 3. Dang khoi dong he thong...
call run_all.bat
