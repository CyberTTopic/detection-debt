# Install Node.js without administrator rights.
#
#   .\install-node-portable.ps1
#
# Downloads the official Node LTS zip from nodejs.org, extracts it into your
# user profile, and adds it to your user PATH. Nothing is written outside your
# own profile, no installer runs, and no administrator prompt appears.
#
# Uninstalling is deleting the folder and removing the PATH entry.

$ErrorActionPreference = 'Stop'
$installRoot = Join-Path $env:LOCALAPPDATA 'node-portable'

Write-Host "Node.js portable install" -ForegroundColor Cyan
Write-Host "Target: $installRoot" -ForegroundColor DarkGray
Write-Host ""

# --- 1. Find the current LTS version ---
Write-Host "Looking up the current LTS release..." -ForegroundColor Yellow
try {
  $index = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -TimeoutSec 30
} catch {
  Write-Host "Could not reach nodejs.org." -ForegroundColor Red
  Write-Host "If you are behind a corporate proxy, this is likely blocked." -ForegroundColor Red
  Write-Host "Tell me and we will use a different route." -ForegroundColor Red
  exit 1
}

# Entries carry an `lts` field: false for non-LTS, otherwise the codename.
$lts = $index | Where-Object { $_.lts -and $_.lts -ne $false } | Select-Object -First 1
if (-not $lts) { throw "No LTS release found in the version index" }

$version = $lts.version           # e.g. v22.20.0
$codename = $lts.lts
Write-Host "  Latest LTS: $version ($codename)" -ForegroundColor Green

$major = [int]($version -replace '^v(\d+)\..*$', '$1')
if ($major -lt 22) {
  Write-Host "  Warning: this project expects Node 22 or newer." -ForegroundColor Yellow
}

# --- 2. Download ---
$zipName = "node-$version-win-x64.zip"
$url = "https://nodejs.org/dist/$version/$zipName"
$zipPath = Join-Path $env:TEMP $zipName

Write-Host ""
Write-Host "Downloading $zipName (about 30 MB)..." -ForegroundColor Yellow
$ProgressPreference = 'SilentlyContinue'   # the progress bar makes this far slower
try {
  Invoke-WebRequest -Uri $url -OutFile $zipPath -TimeoutSec 600
} catch {
  Write-Host "  Download failed: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
$ProgressPreference = 'Continue'
Write-Host "  Done: $([math]::Round((Get-Item $zipPath).Length / 1MB, 1)) MB" -ForegroundColor Green

# --- 3. Extract ---
Write-Host ""
Write-Host "Extracting..." -ForegroundColor Yellow
if (Test-Path $installRoot) { Remove-Item $installRoot -Recurse -Force }
New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
Expand-Archive -Path $zipPath -DestinationPath $installRoot -Force

# The zip contains a single top-level folder; that is where node.exe lives.
$nodeDir = (Get-ChildItem $installRoot -Directory | Select-Object -First 1).FullName
if (-not (Test-Path (Join-Path $nodeDir 'node.exe'))) {
  throw "node.exe not found after extraction - the archive layout was unexpected"
}
Write-Host "  Extracted to $nodeDir" -ForegroundColor Green
Remove-Item $zipPath -Force

# --- 4. Add to PATH, for this session and for future ones ---
Write-Host ""
Write-Host "Adding to PATH..." -ForegroundColor Yellow

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($userPath -notlike "*$nodeDir*") {
  # Drop any previous portable install from the PATH before adding this one.
  $cleaned = ($userPath -split ';' | Where-Object { $_ -and $_ -notlike "*node-portable*" }) -join ';'
  $newPath = if ($cleaned) { "$cleaned;$nodeDir" } else { $nodeDir }
  [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
  Write-Host "  Added to your user PATH (persists across restarts)" -ForegroundColor Green
} else {
  Write-Host "  Already on your user PATH" -ForegroundColor DarkGray
}

# The user-level change does not reach the running process, so set it here too.
$env:Path = "$nodeDir;$env:Path"

# --- 5. Verify ---
Write-Host ""
Write-Host "Verifying..." -ForegroundColor Yellow
$nodeVersion = & (Join-Path $nodeDir 'node.exe') --version
$npmVersion = & (Join-Path $nodeDir 'npm.cmd') --version
Write-Host "  node $nodeVersion" -ForegroundColor Green
Write-Host "  npm  $npmVersion" -ForegroundColor Green

Write-Host ""
Write-Host "Done. Working in THIS window already." -ForegroundColor Cyan
Write-Host "New PowerShell windows will pick it up automatically." -ForegroundColor Cyan
