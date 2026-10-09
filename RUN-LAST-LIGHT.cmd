@echo off
setlocal
chcp 65001 >nul
rem Keep this file in the Frontier Command repository ROOT.
set "GAME_DIR=%~dp0"
set "FRONTIER_USER_DATA=%LOCALAPPDATA%\FrontierCommand-LastLight-Offline-v16"
if not exist "%GAME_DIR%package.json" (
  echo [ERROR] Place RUN-LAST-LIGHT.cmd beside package.json.
  pause
  exit /b 1
)
pushd "%GAME_DIR%" || exit /b 1
echo [LAST LIGHT] Running main checkout from %CD%
echo [LAST LIGHT] Save data: %FRONTIER_USER_DATA%
call npm start
set "EXIT_CODE=%ERRORLEVEL%"
popd
if not "%EXIT_CODE%"=="0" pause
exit /b %EXIT_CODE%
