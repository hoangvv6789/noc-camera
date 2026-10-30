@echo off
title Dong Goi Ung Dung Thanh File .EXE (PyInstaller)
cd /d "%~dp0"

echo =======================================================
echo   DANG DONG GOI HE THONG CAMERA NOC THANH FILE .EXE
echo =======================================================
echo.

REM 1. Build Frontend
echo [Buoc 1/3] Dang build giao dien React Frontend...
cd frontend
call npm run build
cd ..

REM 2. Cai dat PyInstaller neu chua co
echo [Buoc 2/3] Kiem tra thu vien PyInstaller...
cd backend
venv\Scripts\pip install pyinstaller

REM 3. Dong goi file EXE
echo [Buoc 3/3] Dang bien dich thanh file CameraNOC.exe...
venv\Scripts\pyinstaller --noconfirm --onedir --windowed ^
    --name "CameraNOC" ^
    --add-data "../frontend/dist;dist" ^
    --collect-all "netmiko" ^
    --collect-all "paramiko" ^
    --collect-all "ntc_templates" ^
    --hidden-import "uvicorn.logging" ^
    --hidden-import "uvicorn.loops" ^
    --hidden-import "uvicorn.loops.auto" ^
    --hidden-import "uvicorn.protocols" ^
    --hidden-import "uvicorn.protocols.http" ^
    --hidden-import "uvicorn.protocols.http.auto" ^
    --hidden-import "uvicorn.protocols.websockets" ^
    --hidden-import "uvicorn.protocols.websockets.auto" ^
    --hidden-import "uvicorn.lifespans" ^
    --hidden-import "uvicorn.lifespans.on" ^
    --hidden-import "sqlmodel" ^
    --hidden-import "apscheduler" ^
    run_server.py

REM Copy file database hiện tại sang thư mục dist/CameraNOC nếu có
if exist "camera_monitor.db" (
    echo Dang sao chep database hien tai vao ban dong goi...
    copy /Y "camera_monitor.db" "dist\CameraNOC\camera_monitor.db" >nul
)

cd ..

echo.
echo =======================================================
echo  DA DONG GOI HOAN TAT!
echo  Thu muc chua file chay: E:\logcam\backend\dist\CameraNOC\
echo  File chay chinh: CameraNOC.exe
echo =======================================================
echo.
pause
