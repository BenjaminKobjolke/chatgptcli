@echo off
rem Internal helper: shifts the build number in build_version.txt by %1 (e.g. 1 or -1).
cd /d "%~dp0.."
if "%~1"=="" (
    echo [FAIL] missing shift amount
    exit /b 1
)
for /f "delims=" %%b in ('call "%~dp0build_get.bat"') do set BUILD=%%b
if "%BUILD%"=="" (
    echo [FAIL] could not read build number
    exit /b 1
)
set /a NEW=BUILD+%~1
(echo %NEW%)>build_version.txt
echo %NEW%
exit /b 0
