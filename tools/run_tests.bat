@echo off
cd /d "%~dp0.."
bun test --timeout 5000
exit /b %errorlevel%
