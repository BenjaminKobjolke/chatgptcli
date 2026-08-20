@echo off
set "EXT_DIR=%~dp0..\.omx\reference\opencli\extension"
if defined CHATGPTCLI_OPENCLI_ROOT set "EXT_DIR=%CHATGPTCLI_OPENCLI_ROOT%\extension"
set "PROFILE_DIR=%USERPROFILE%\.chatgptcli\chrome-profile"
if not exist "%PROFILE_DIR%" mkdir "%PROFILE_DIR%"
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir="%PROFILE_DIR%" --load-extension="%EXT_DIR%" https://chatgpt.com/
