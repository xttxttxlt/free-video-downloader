@echo off
cd /d "%~dp0frontend"
echo [FlashSave] Installing frontend dependencies ...
call npm install
echo [FlashSave] Starting frontend dev server at http://localhost:5173 (HMR)
echo [FlashSave] /api is proxied to backend http://127.0.0.1:8000 - run start-backend.bat first.
call npm run dev
pause