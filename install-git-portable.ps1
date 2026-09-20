# Install Git without administrator rights.
#
#   .\install-git-portable.ps1
#
# Downloads MinGit, the minimal Git for Windows build that the Git project
# publishes for exactly this purpose, extracts it into your user profile, and
# adds it to your user PATH. No installer, no administrator prompt, nothing
# written outside your own profile.
#
# You need Git regardless of this project's imports: the challenge requires a
# public repository, so this is not a detour.

$ErrorActionPreference = 'Stop'
$installRoot = Join-Path $env:LOCALAPPDATA 'git-portable'

Write-Host "Git portable install (MinGit)" -ForegroundColor Cyan
Write-Host "Target: $installRoot" -ForegroundColor DarkGray
Write-Host ""

# --- 1. Find the latest MinGit asset ---
Write-Host "Looking up the latest Git for Windows release..." -ForegroundColor Yellow
try {
  $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/git-for-windows/git/releases/latest' `
    -Headers @{ 'User-Agent' = 'detection-debt-setup' } -TimeoutSec 30
} catch {
  Write-Host "Could not reach the GitHub API." -ForegroundColor Red
  Write-Host "If a proxy is blocking it, download MinGit-*-64-bit.zip by hand from" -ForegroundColor Red
  Write-Host "  https://github.com/git-for-windows/git/releases/latest" -ForegroundColor Red
  Write-Host "extract it to $installRoot, and tell me." -ForegroundColor Red
  exit 1
}

# MinGit is the stripped-down build: no GUI, no bundled shell extras, ~50 MB
# against ~300 MB for the full installer. `git clone` is all we need.
$asset = $release.assets | Where-Object { $_.name -like 'MinGit-*-64-bit.zip' } | Select-Object -First 1
if (-not $asset) { throw "No MinGit 64-bit asset in release $($release.tag_name)" }

Write-Host "  $($release.tag_name) - $($asset.name) ($([math]::Round($asset.size / 1MB, 1)) MB)" -ForegroundColor Green

# --- 2. Download ---
$zipPath = Join-Path $env:TEMP $asset.name
Write-Host ""
Write-Host "Downloading..." -ForegroundColor Yellow
$ProgressPreference = 'SilentlyContinue'
try {
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zipPath -TimeoutSec 900
} catch {
  Write-Host "  Download failed: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
$ProgressPreference = 'Continue'
Write-Host "  Done" -ForegroundColor Green

# --- 3. Extract ---
Write-Host ""
Write-Host "Extracting..." -ForegroundColor Yellow
if (Test-Path $installRoot) { Remove-Item $installRoot -Recurse -Force }
New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
Expand-Archive -Path $zipPath -DestinationPath $installRoot -Force

# MinGit extracts flat, so git.exe sits in cmd\ at the root.
$binDir = Join-Path $installRoot 'cmd'
if (-not (Test-Path (Join-Path $binDir 'git.exe'))) {
  $found = Get-ChildItem $installRoot -Recurse -Filter 'git.exe' -ErrorAction SilentlyContinue |
    Where-Object { $_.DirectoryName -like '*cmd*' } | Select-Object -First 1
  if (-not $found) { throw "git.exe not found after extraction" }
  $binDir = $found.DirectoryName
}
Write-Host "  git.exe at $binDir" -ForegroundColor Green
Remove-Item $zipPath -Force

# --- 4. PATH ---
Write-Host ""
Write-Host "Adding to PATH..." -ForegroundColor Yellow
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($userPath -notlike "*$binDir*") {
  $cleaned = ($userPath -split ';' | Where-Object { $_ -and $_ -notlike '*git-portable*' }) -join ';'
  [Environment]::SetEnvironmentVariable('Path', "$cleaned;$binDir", 'User')
  Write-Host "  Added to your user PATH" -ForegroundColor Green
} else {
  Write-Host "  Already present" -ForegroundColor DarkGray
}
$env:Path = "$binDir;$env:Path"

# --- 5. Trust the same certificate authorities Windows trusts ---
# Git bundles its own CA file and, like Node, ignores the Windows store. On a
# network that inspects TLS the clone fails the same way the Sanity writes did.
# schannel is Git's own switch for using the Windows store instead.
Write-Host ""
Write-Host "Configuring TLS backend for corporate certificate inspection..." -ForegroundColor Yellow
& (Join-Path $binDir 'git.exe') config --global http.sslBackend schannel
Write-Host "  http.sslBackend = schannel" -ForegroundColor Green

# --- 6. Verify ---
Write-Host ""
$gitVersion = & (Join-Path $binDir 'git.exe') --version
Write-Host $gitVersion -ForegroundColor Green
Write-Host ""
Write-Host "Working in this window already." -ForegroundColor Cyan
