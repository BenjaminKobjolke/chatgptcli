@echo off
cd /d "%~dp0.."

rem Stale daemon instances keep the exe locked and the build's move fails with EPERM
taskkill /im chatgptcli.exe /f >nul 2>&1

call "%~dp0build.bat"
if errorlevel 1 (
    echo [FAIL] build failed
    exit /b 1
)
if not exist chatgptcli.exe (
    echo [FAIL] build did not produce chatgptcli.exe
    exit /b 1
)

for /f "delims=" %%v in ('powershell -NoProfile -Command "(Get-Content package.json -Raw | ConvertFrom-Json).version"') do set VERSION=%%v
if "%VERSION%"=="" (
    echo [FAIL] could not read version from package.json
    exit /b 1
)

echo Creating GitHub release v%VERSION% ...
gh release create v%VERSION% chatgptcli.exe --repo BenjaminKobjolke/chatgptcli --title "v%VERSION%" --generate-notes
if errorlevel 1 (
    echo [FAIL] gh release create failed. Tag may already exist - bump version in package.json first.
    exit /b 1
)

echo [OK] Release v%VERSION% published with chatgptcli.exe
