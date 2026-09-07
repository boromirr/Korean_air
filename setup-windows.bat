@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
pushd "%~dp0"
if errorlevel 1 exit /b 1
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
set "APP_EXIT_CODE=1"
if /i "%~1"=="--help" goto help
if /i "%~1"=="--check" goto check
if not "%~1"=="" goto help_error

where node >nul 2>nul
if errorlevel 1 goto missing_node
where npm >nul 2>nul
if errorlevel 1 goto missing_node
node scripts\check-environment.mjs --prerequisites
if errorlevel 1 goto finish
echo.
echo Installing project dependencies, including Playwright...
call npm ci
if errorlevel 1 goto finish
goto check

:check
where node >nul 2>nul
if errorlevel 1 goto missing_node
node scripts\check-environment.mjs
if errorlevel 1 goto finish
echo.
echo Setup complete. Double-click start-windows.bat to open the app.
set "APP_EXIT_CODE=0"
goto finish

:missing_node
echo Node.js 22 or later with npm is required. Install it, then reopen this window.
echo https://nodejs.org/en/download
goto finish

:help
echo Usage: setup-windows.bat [--check ^| --help]
echo No arguments: install dependencies with npm ci and check Python and Chrome.
echo --check: check the installed environment without installing packages.
set "APP_EXIT_CODE=0"
goto finish

:help_error
echo Unknown option. Use setup-windows.bat --help.

:finish
if not "%APP_EXIT_CODE%"=="0" echo Setup was not completed. See the message above and docs\usage.md.
if "%~1"=="" pause
popd
exit /b %APP_EXIT_CODE%
