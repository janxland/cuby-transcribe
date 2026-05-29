# One-shot startup for cuby-transcribe.
# Usage:   .\start-all.ps1
# Stop:    close the 3 spawned terminal windows, or Ctrl+C in each.

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$python = "D:\Base\miniconda3\envs\cuby\python.exe"

if (-not (Test-Path $python)) {
    Write-Error "conda env 'cuby' python not found: $python"
    exit 1
}

Write-Host "[1/3] Python agent (port 8000)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "cd '$root\python-agent'; & '$python' -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"
) -WindowStyle Normal

Start-Sleep -Milliseconds 800

Write-Host "[2/3] Node backend (port 3000)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "cd '$root\node-backend'; npm run dev"
) -WindowStyle Normal

Start-Sleep -Milliseconds 500

Write-Host "[3/3] Web frontend (port 5173)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "cd '$root\web'; npm run dev"
) -WindowStyle Normal

Write-Host ""
Write-Host "All services launched." -ForegroundColor Green
Write-Host "  Web:    http://localhost:5173" -ForegroundColor Yellow
Write-Host "  Node:   http://localhost:3000" -ForegroundColor Yellow
Write-Host "  Agent:  http://localhost:8000/docs" -ForegroundColor Yellow
