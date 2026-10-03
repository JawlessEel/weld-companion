@echo off
rem Starts the Weld agent bridge. Double-click this file, or run it from a terminal.
rem It prints the setup line for each AI agent and copies the token to your clipboard.
title Weld agent bridge
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed or not on PATH. Install it from https://nodejs.org and try again.
  pause
  exit /b 1
)
node bridge\weld-bridge.js --copy %*
echo.
echo The bridge stopped.
pause
