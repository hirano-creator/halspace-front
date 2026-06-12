@echo off
chcp 65001 > nul
echo === AI to CAD Converter ===
echo.

cd /d "%~dp0"

where python >nul 2>&1
if %errorlevel% neq 0 (
    echo [エラー] Python が見つかりません。https://python.org からインストールしてください。
    pause
    exit /b 1
)

echo 依存ライブラリを確認中...
pip install -r requirements.txt -q

echo.
echo サーバーを起動します: http://localhost:8080
echo 停止するには Ctrl+C を押してください
echo.

python -m uvicorn main:app --host 127.0.0.1 --port 8080

pause
