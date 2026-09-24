@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
chcp 65001 >nul

set "NODE_EXE="
for /f "delims=" %%I in ('where node 2^>nul') do (
  set "CAND=%%I"
  if "!CAND:WindowsApps=!"=="!CAND!" (
    set "NODE_EXE=%%I"
    goto have_node
  )
)
if exist "%ProgramFiles%\nodejs\node.exe" (
  set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
  goto have_node
)
if exist "%LocalAppData%\Programs\nodejs\node.exe" (
  set "NODE_EXE=%LocalAppData%\Programs\nodejs\node.exe"
  goto have_node
)

echo 找不到 Node.js。請先安裝 Node.js 22.17.0 以上，安裝時勾選 Add to PATH。
echo 安裝後關閉這個視窗，再雙擊 seekah-ui.cmd。
echo 可先開命令提示字元執行 node -v，應會顯示版本號。
pause
exit /b 1

:have_node
echo 使用 Node.js："%NODE_EXE%"
"%NODE_EXE%" "%~dp0scripts\launch-ui.mjs"
set "EXITCODE=%ERRORLEVEL%"
if not "%EXITCODE%"=="0" (
  echo.
  echo Seekah 啟動失敗。
  pause
)
exit /b %EXITCODE%
