@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
pushd "%~dp0"
if errorlevel 1 exit /b 1
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
set "APP_EXIT_CODE=1"
if /i "%~1"=="--help" goto find_python
if /i "%~1"=="-h" goto find_python
where node >nul 2>nul
if errorlevel 1 goto missing_node
if not exist "node_modules\tsx\dist\cli.mjs" goto missing_dependencies

:find_python
python -c "import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)" >nul 2>nul
if not errorlevel 1 goto run_python
py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)" >nul 2>nul
if not errorlevel 1 goto run_py
echo Python 3.8 or later is required. Install Python and reopen this window.
echo https://www.python.org/downloads/windows/
goto finish

:run_python
python -u local_app.py --open %*
set "APP_EXIT_CODE=%ERRORLEVEL%"
goto finish

:run_py
py -3 -u local_app.py --open %*
set "APP_EXIT_CODE=%ERRORLEVEL%"
goto finish

:missing_node
echo Node.js 22 or later is required. Install it, then run setup-windows.bat.
echo https://nodejs.org/en/download
goto finish

:missing_dependencies
echo Run setup-windows.bat first to install Playwright and the project tools.

:finish
if not "%APP_EXIT_CODE%"=="0" echo The app has stopped. See the message above and docs\usage.md.
if not "%APP_EXIT_CODE%"=="0" if "%~1"=="" pause
popd
exit /b %APP_EXIT_CODE%
