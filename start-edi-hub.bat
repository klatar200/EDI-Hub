@echo off
REM EDI Hub one-click startup.
REM Calls start-edi-hub.ps1 with ExecutionPolicy Bypass so it always runs
REM regardless of the system's PowerShell policy. Double-click this file
REM after a PC restart to bring the whole stack back up.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-edi-hub.ps1" %*
