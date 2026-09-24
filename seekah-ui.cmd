@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul
where node >nul 2>&1
if errorlevel 1 (
  echo 找不到 Node.js。請先安裝 Node.js 22.17.0 以上，再雙擊這個檔案。
  pause
  exit /b 1
)
node "%~dp0scripts\launch-ui.mjs"
set EXITCODE=%errorlevel%
if not %EXITCODE%==0 (
  echo.
  echo Seekah 啟動失敗。
  pause
)
exit /b %EXITCODE%
