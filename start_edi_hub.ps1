# EDI Data Hub - local boot script (Windows 11).
#
# Run after a fresh PC restart. Brings up everything the dev stack needs:
#
#   1. Docker Desktop (started if not already running).
#   2. docker compose services - Postgres + MinIO + SFTP drop folder.
#   3. cloudflared quick tunnel for Clerk webhooks (new window).
#   4. The Fastify API on :3000 (new window).
#   5. The Vite web app on :5173 (new window).
#
# Each long-running service opens in its own PowerShell window so logs are
# visible and you can Ctrl-C any one of them independently. The launcher
# script itself exits as soon as everything is up.
#
# Usage (from anywhere):
#   powershell -ExecutionPolicy Bypass -File "C:\Users\latar\Claude\Projects\EDI Hub\start_edi_hub.ps1"
#
# Or pin to a desktop shortcut: right-click .ps1 -> Run with PowerShell.
#
# Skip optional steps:
#   -SkipDocker       skip Docker check + compose up (use if already running)
#   -SkipTunnel       skip cloudflared (use if you don't need Clerk webhooks now)
#   -OpenBrowser      open http://localhost:5173 once the web is up

param(
  [switch]$SkipDocker,
  [switch]$SkipTunnel,
  [switch]$OpenBrowser
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

function Write-Step($msg)  { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Info($msg)  { Write-Host "    $msg" -ForegroundColor Gray }
function Write-Warn2($msg) { Write-Host "!!  $msg" -ForegroundColor Yellow }
function Write-Err2($msg)  { Write-Host "XX  $msg" -ForegroundColor Red }

# -------------------------------------------------------------
# 1. Docker Desktop
# -------------------------------------------------------------

if (-not $SkipDocker) {
  Write-Step "Checking Docker"

  # `docker info` exits non-zero if the daemon isn't reachable. Start
  # Docker Desktop and poll until it answers.
  $dockerReady = $false
  try { docker info *> $null; $dockerReady = ($LASTEXITCODE -eq 0) } catch { $dockerReady = $false }

  if (-not $dockerReady) {
    $dockerExe = "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe"
    if (-not (Test-Path $dockerExe)) {
      Write-Err2 "Docker Desktop not found at '$dockerExe'. Install from https://docs.docker.com/desktop/install/windows-install/ or pass -SkipDocker."
      exit 1
    }
    Write-Info "Starting Docker Desktop and waiting for the daemon to come up (can take 30-60s)..."
    Start-Process -FilePath $dockerExe -WindowStyle Minimized | Out-Null
    $deadline = (Get-Date).AddSeconds(90)
    while ((Get-Date) -lt $deadline) {
      Start-Sleep -Seconds 3
      try { docker info *> $null; if ($LASTEXITCODE -eq 0) { $dockerReady = $true; break } } catch { }
    }
    if (-not $dockerReady) {
      Write-Err2 "Docker did not become ready within 90s. Open Docker Desktop manually then re-run."
      exit 1
    }
  }
  Write-Info "Docker is up."

  # -----------------------------------------------------------
  # 2. docker compose - Postgres + MinIO + SFTP
  # -----------------------------------------------------------

  Write-Step "Starting compose services (postgres, minio, sftp)"
  Push-Location $repoRoot
  try {
    docker compose up -d postgres minio minio-init sftp
    if ($LASTEXITCODE -ne 0) { throw "docker compose up failed" }
  } finally { Pop-Location }

  # Wait for Postgres healthcheck - pg_isready inside the container reports OK.
  Write-Info "Waiting for Postgres to report healthy..."
  $deadline = (Get-Date).AddSeconds(60)
  $pgReady = $false
  while ((Get-Date) -lt $deadline) {
    $status = (docker inspect --format '{{.State.Health.Status}}' edi-postgres 2>$null)
    if ($status -eq 'healthy') { $pgReady = $true; break }
    Start-Sleep -Seconds 2
  }
  if (-not $pgReady) {
    Write-Warn2 "Postgres didn't report healthy within 60s. The API may fail on first query - check 'docker logs edi-postgres'."
  } else {
    Write-Info "Postgres healthy. MinIO console: http://localhost:9001 (minioadmin / minioadmin)."
  }
} else {
  Write-Step "Skipping Docker (per -SkipDocker)"
}

# -------------------------------------------------------------
# 3. cloudflared tunnel (so Clerk webhooks reach localhost:3000)
# -------------------------------------------------------------

if (-not $SkipTunnel) {
  Write-Step "Starting cloudflared tunnel (new window)"
  $cloudflared = (Get-Command cloudflared -ErrorAction SilentlyContinue)
  $tunnelPath = $null
  if ($cloudflared) {
    $tunnelPath = $cloudflared.Source
  } else {
    # Fall back to the default MSI install path.
    $candidate = "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe"
    if (Test-Path $candidate) { $tunnelPath = $candidate }
  }
  if (-not $tunnelPath) {
    Write-Warn2 "cloudflared not found on PATH. Install via 'winget install Cloudflare.cloudflared' or pass -SkipTunnel."
  } else {
    $banner = "Write-Host 'cloudflared tunnel: copy the trycloudflare.com URL into Clerk dashboard -> Webhooks (append /webhooks/clerk).' -ForegroundColor Yellow"
    # --protocol http2: skip QUIC (UDP/7844). Many networks block QUIC and
    # cloudflared otherwise burns minutes retrying before falling back.
    $cmd = "$banner; & '$tunnelPath' tunnel --url http://localhost:3000 --protocol http2"
    Start-Process -FilePath 'powershell' -ArgumentList @('-NoExit', '-Command', $cmd) | Out-Null
    Write-Info "cloudflared window opened. Update the Clerk webhook URL each restart - the subdomain changes."
  }
} else {
  Write-Step "Skipping cloudflared (per -SkipTunnel)"
}

# -------------------------------------------------------------
# 4. API (Fastify) on :3000
# -------------------------------------------------------------

Write-Step "Starting API (new window - http://localhost:3000)"
$apiCmd = "Set-Location -LiteralPath '$repoRoot'; npm run dev --workspace=apps/api"
Start-Process -FilePath 'powershell' -ArgumentList @('-NoExit', '-Command', $apiCmd) | Out-Null

# Give the API a short head start so the web app's first /me probe lands
# against an alive server (otherwise React Query retries make the page
# slow to first render).
Start-Sleep -Seconds 3

# -------------------------------------------------------------
# 5. Web (Vite) on :5173
# -------------------------------------------------------------

Write-Step "Starting web (new window - http://localhost:5173)"
$webCmd = "Set-Location -LiteralPath '$repoRoot'; npm run dev --workspace=apps/web"
Start-Process -FilePath 'powershell' -ArgumentList @('-NoExit', '-Command', $webCmd) | Out-Null

if ($OpenBrowser) {
  Start-Sleep -Seconds 4
  Start-Process 'http://localhost:5173'
}

Write-Host ""
Write-Host "All services launched." -ForegroundColor Green
Write-Host "  API     -> http://localhost:3000  (and /health, /readiness, /internal/metrics)" -ForegroundColor Gray
Write-Host "  Web     -> http://localhost:5173" -ForegroundColor Gray
Write-Host "  MinIO   -> http://localhost:9001  (minioadmin / minioadmin)" -ForegroundColor Gray
Write-Host "  SFTP    -> sftp -P 2222 edi@localhost  (password: edi)" -ForegroundColor Gray
Write-Host ""
Write-Host "Close any of the spawned PowerShell windows to stop that service." -ForegroundColor Gray
Write-Host "Run 'docker compose down' from the repo root when finished for the day." -ForegroundColor Gray
