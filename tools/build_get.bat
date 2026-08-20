@echo off
rem Prints the build number. Errors go to stderr so `for /f` callers capture nothing on failure.
cd /d "%~dp0.."
if not exist build_version.txt (
    echo [FAIL] build_version.txt not found 1>&2
    exit /b 1
)
set /p BUILD=<build_version.txt
echo %BUILD%
