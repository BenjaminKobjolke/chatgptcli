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

for /f "delims=" %%v in ('call "%~dp0package_version_get.bat"') do set VERSION=%%v
if "%VERSION%"=="" (
    echo [FAIL] could not read version from package.json
    exit /b 1
)

rem Keep the Claude plugin manifest version in sync with package.json -
rem "claude plugin update" reads plugin.json, not package.json
powershell -NoProfile -Command "$m = 'plugin/.claude-plugin/plugin.json'; $j = Get-Content $m -Raw -Encoding UTF8 | ConvertFrom-Json; if ($j.version -ne '%VERSION%') { $j.version = '%VERSION%'; [IO.File]::WriteAllText((Resolve-Path $m), ($j | ConvertTo-Json), [Text.UTF8Encoding]::new($false)); Write-Host ('[OK] plugin.json version -> %VERSION%') }"

for /f "delims=" %%l in ('call "%~dp0version_get.bat"') do set LABEL=%%l
if "%LABEL%"=="" (
    echo [FAIL] could not read release label from version_get.bat
    exit /b 1
)

rem Release body: authored release notes if present, otherwise gh-generated notes
set NOTES_ARGS=--generate-notes
if exist "release-notes\%LABEL%\en.json" (
    powershell -NoProfile -Command "$j = Get-Content 'release-notes/%LABEL%/en.json' -Raw | ConvertFrom-Json; $lines = @($j.title, '') + @($j.notes | ForEach-Object { '- ' + $_ }); Set-Content -Path '%TEMP%\chatgptcli_release_notes.md' -Value $lines -Encoding UTF8"
    set NOTES_ARGS=--notes-file "%TEMP%\chatgptcli_release_notes.md"
) else (
    echo [WARN] release-notes\%LABEL%\en.json not found - using gh --generate-notes
)

rem Every release run asks whether the exe gets uploaded (user requirement).
rem Pass Y or N as first arg to skip the prompt (for automated/skill runs).
set ASSET=chatgptcli.exe
if /i "%~1"=="Y" goto :asset_done
if /i "%~1"=="N" (
    set ASSET=
    goto :asset_done
)
choice /c YN /m "Upload chatgptcli.exe to the GitHub release"
if errorlevel 2 set ASSET=
:asset_done

echo Creating GitHub release v%VERSION% ...
gh release create v%VERSION% %ASSET% --repo BenjaminKobjolke/chatgptcli --title "v%VERSION%" %NOTES_ARGS%
if errorlevel 1 (
    echo [FAIL] gh release create failed. Tag may already exist - bump version in package.json first.
    exit /b 1
)

echo [OK] Release v%VERSION% published
exit /b 0
