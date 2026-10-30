@echo off
title Dung Camera NOC Dashboard
cd /d "%~dp0"

echo =======================================================
echo     DANG TAT TIEN TRINH CAMERA NOC (PORT 8687)...
echo =======================================================
echo.

REM Tim PID dang chiem port 8687, 8686 va 8000 va dong tien trinh do
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8687 "') do (
    if not "%%a"=="0" (
        echo Dang tat tien trinh PID: %%a ...
        taskkill /F /PID %%a >nul 2>&1
    )
)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8686 "') do (
    if not "%%a"=="0" (
        echo Dang tat tien trinh PID: %%a ...
        taskkill /F /PID %%a >nul 2>&1
    )
)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8000 "') do (
    if not "%%a"=="0" (
        echo Dang tat tien trinh cu PID: %%a ...
        taskkill /F /PID %%a >nul 2>&1
    )
)

echo.
echo [THANH CONG] He thong Camera NOC da duoc dung hoan toan.
echo.
timeout /t 3
