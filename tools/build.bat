@echo off
cd /d "%~dp0.."
bun build --compile --outfile chatgptcli.exe src/main.js
exit /b %errorlevel%
