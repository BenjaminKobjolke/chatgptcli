@echo off
cd /d "%~dp0.."

rem Stale daemon instances keep the repo exe and the installed exe locked
taskkill /im chatgptcli.exe /f >nul 2>&1

call "%~dp0build.bat"
if errorlevel 1 (
    echo [FAIL] build failed
    exit /b 1
)

set DEST=%USERPROFILE%\.chatgptcli\bin
if not exist "%DEST%" mkdir "%DEST%"
copy /y chatgptcli.exe "%DEST%\chatgptcli.exe" >nul
if errorlevel 1 (
    echo [FAIL] copy to %DEST% failed
    exit /b 1
)

"%DEST%\chatgptcli.exe" --version
echo [OK] installed to %DEST%
