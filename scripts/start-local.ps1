<#
  Starts CareerForge locally on Windows.

      powershell -ExecutionPolicy Bypass -File scripts\start-local.ps1

  Why this script exists: the project path contains an "&", which cmd.exe
  treats as a command separator, so `npm run dev` fails here. This calls node
  directly and sidesteps that entirely.

  It starts a throwaway MySQL on port 3307 using the binaries from your
  installed MySQL Server 8.0 - your MySQL80 Windows service is never touched.
  Data lives in .local-db\ and persists between runs; delete that folder for a
  clean slate.

  Flags:
    -Reset    drop the local database and re-seed from scratch
    -NoSeed   skip demo data
    -Port     API port (default 4000)
#>

[CmdletBinding()]
param(
  [switch]$Reset,
  [switch]$NoSeed,
  [int]$Port = 4000,
  [int]$DbPort = 3307
)

$ErrorActionPreference = 'Stop'
$root    = Split-Path -Parent $PSScriptRoot
$dataDir = Join-Path $root '.local-db'
$mysqlBin = 'C:\Program Files\MySQL\MySQL Server 8.0\bin'

function Info($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Warn($msg) { Write-Host " !  $msg" -ForegroundColor Yellow }
function Die($msg)  { Write-Host "ERROR: $msg" -ForegroundColor Red; exit 1 }

# ----------------------------------------------------------------- checks
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Die 'node is not on PATH. Install Node.js 20 or newer.'
}
if (-not (Test-Path (Join-Path $mysqlBin 'mysqld.exe'))) {
  Die "mysqld.exe not found under $mysqlBin. Edit `$mysqlBin at the top of this script."
}
if (-not (Test-Path (Join-Path $root 'node_modules'))) {
  Info 'Installing dependencies (first run only)'
  Push-Location $root
  npm install --no-audit --no-fund
  Pop-Location
}

# ------------------------------------------------------------------ reset
if ($Reset -and (Test-Path $dataDir)) {
  Info 'Resetting the local database'
  & (Join-Path $mysqlBin 'mysqladmin.exe') -u root -h 127.0.0.1 -P $DbPort --protocol=TCP shutdown 2>$null
  Start-Sleep -Seconds 3
  Remove-Item -Recurse -Force $dataDir
}

# --------------------------------------------------------------- database
if (-not (Test-Path $dataDir)) {
  Info 'Initialising the local database (one time, ~30s)'
  & (Join-Path $mysqlBin 'mysqld.exe') --initialize-insecure --datadir=$dataDir --log-error-verbosity=1
  if ($LASTEXITCODE -ne 0) { Die 'mysqld --initialize-insecure failed.' }
}

$alreadyUp = $false
try {
  $probe = New-Object System.Net.Sockets.TcpClient
  $probe.Connect('127.0.0.1', $DbPort)
  $probe.Close()
  $alreadyUp = $true
} catch { }

if ($alreadyUp) {
  Info "MySQL already listening on $DbPort"
} else {
  Info "Starting MySQL on port $DbPort"
  Start-Process -FilePath (Join-Path $mysqlBin 'mysqld.exe') -WindowStyle Hidden -ArgumentList @(
    "--datadir=$dataDir"
    "--port=$DbPort"
    '--socket=cf_dev_sock'
    '--shared-memory-base-name=cf_dev_shm'
    '--skip-named-pipe'
    '--skip-mysqlx'
    '--log-error-verbosity=1'
  )

  $ready = $false
  foreach ($i in 1..30) {
    try {
      $probe = New-Object System.Net.Sockets.TcpClient
      $probe.Connect('127.0.0.1', $DbPort)
      $probe.Close()
      $ready = $true
      break
    } catch { Start-Sleep -Seconds 1 }
  }
  if (-not $ready) { Die "MySQL did not come up on port $DbPort. Check $dataDir\*.err" }
}

# ------------------------------------------------------------------- env
$envFile = Join-Path $root 'server\.env'
if (-not (Test-Path $envFile)) {
  Info 'Creating server\.env from the example'
  Copy-Item (Join-Path $root 'server\.env.example') $envFile
  Warn "Edit $envFile - DB_PORT must be $DbPort and DB_PASSWORD empty for this local database."
}

# -------------------------------------------------------- migrate + seed
Info 'Applying migrations'
node (Join-Path $root 'server\src\db\migrate.js')
if ($LASTEXITCODE -ne 0) { Die 'Migration failed.' }

if (-not $NoSeed) {
  Info 'Seeding demo data'
  node (Join-Path $root 'server\src\db\seed.js')
}

# ------------------------------------------------------------ front end
if (-not (Test-Path (Join-Path $root 'client\dist\index.html'))) {
  Info 'Building the front end'
  Push-Location (Join-Path $root 'client')
  node (Join-Path $root 'node_modules\vite\bin\vite.js') build
  Pop-Location
}

# ----------------------------------------------------------------- serve
Write-Host ''
Write-Host '  CareerForge is starting' -ForegroundColor Green
Write-Host "  app     http://localhost:$Port"
Write-Host "  api     http://localhost:$Port/api/health"
Write-Host "  demo    http://localhost:$Port/u/aarav-sharma"
Write-Host ''
Write-Host '  Sign in with any real email address - no mailbox needed locally,'
Write-Host '  the OTP is printed below and shown on screen.'
Write-Host ''
Write-Host '  Ctrl+C stops the API. MySQL keeps running; stop it with:'
Write-Host "    & '$mysqlBin\mysqladmin.exe' -u root -h 127.0.0.1 -P $DbPort --protocol=TCP shutdown"
Write-Host ''

$env:PORT = $Port
node (Join-Path $root 'server\src\index.js')
