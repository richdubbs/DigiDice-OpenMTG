@echo off
rem Double-click to play OpenMTG on Windows. The first run installs the packages and downloads the card data
rem from Scryfall (a few minutes); later runs start in seconds. Needs Node.js 20 or newer (https://nodejs.org).
setlocal
cd /d "%~dp0"
title OpenMTG

where node >nul 2>nul
if errorlevel 1 goto :nonode
for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 20 goto :nonode

if exist node_modules\ goto :cards
echo Installing OpenMTG, first run only. This takes a few minutes...
call npm ci
if errorlevel 1 goto :fail

:cards
if exist .cache\scryfall\cards.jsonl goto :play
echo Downloading the card data from Scryfall, first run only...
call npm run cards -- refresh
if errorlevel 1 goto :fail

:play
echo.
echo OpenMTG is starting and will open in your browser: http://127.0.0.1:47600
echo Keep this window open while you play. Close it to stop OpenMTG.
echo.
call npm run play -- --open
goto :eof

:nonode
echo OpenMTG needs Node.js 20 or newer. Install the LTS version from https://nodejs.org, then double-click this file again.
pause
exit /b 1

:fail
echo.
echo Something went wrong (see the messages above). Check your internet connection and double-click this file again.
pause
exit /b 1
