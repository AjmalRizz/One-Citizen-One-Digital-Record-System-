@echo off
title OCODR - Democratic Socialist Republic of Sri Lanka - National Identity Platform

echo ======================================================================
echo  OCODR National Digital Citizen Identity Platform
echo  Starting server and launching web application...
echo ======================================================================
echo.

where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js is not found in your system PATH.
    echo Please install Node.js from https://nodejs.org/ and try again.
    pause
    exit /b 1
)

npm start
