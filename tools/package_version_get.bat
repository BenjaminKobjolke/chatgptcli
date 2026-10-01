@echo off
rem Prints the semver from package.json (single source for all release tooling).
rem Errors go to stderr so `for /f` callers capture nothing on failure.
cd /d "%~dp0.."
for /f "delims=" %%v in ('powershell -NoProfile -Command "(Get-Content package.json -Raw | ConvertFrom-Json).version"') do set VERSION=%%v
if "%VERSION%"=="" (
    echo [FAIL] could not read version from package.json 1>&2
    exit /b 1
)
echo %VERSION%
exit /b 0
