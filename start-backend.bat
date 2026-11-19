@echo off
cd /d "%~dp0"
echo [FlashSave] Starting backend API at http://127.0.0.1:8000 (docs at /docs)
.venv\Scripts\python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
pause