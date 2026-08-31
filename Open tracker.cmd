@echo off
cd /d "%~dp0"
start "" python "%~dp0server.py"
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:8788/"
