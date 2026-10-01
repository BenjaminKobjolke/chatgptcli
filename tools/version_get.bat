@echo off
for /f "delims=" %%v in ('call "%~dp0package_version_get.bat"') do set VERSION=%%v
if "%VERSION%"=="" exit /b 1
for /f "delims=" %%b in ('call "%~dp0build_get.bat"') do set BUILD=%%b
if "%BUILD%"=="" exit /b 1
echo %VERSION%_%BUILD%
exit /b 0
