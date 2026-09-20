# Diagnose an "API key is invalid" without ever printing the key.
#
#   .\check-anthropic-key.ps1
#
# "Invalid" is Anthropic's answer to several different problems and it says the
# same thing for all of them: a truncated paste, a stray quote, a trailing space,
# a disabled key, or - the one that is genuinely hard to spot - a stale
# ANTHROPIC_API_KEY sitting in the shell environment, which the agent's config
# loader prefers over the file because that is what makes deployment work.
#
# This reports the shape of what it found, says which source would win, and then
# makes one real one-token request so the server's own reason is visible.
#
# The key is never written to the console, only described.

$ErrorActionPreference = 'Stop'

function Describe($label, $value, $origin) {
  Write-Host ""
  Write-Host "  $label" -ForegroundColor Cyan
  if (-not $value) {
    Write-Host "    not set in $origin" -ForegroundColor DarkGray
    return $false
  }

  $len = $value.Length
  Write-Host "    length          $len characters"

  # Built in steps rather than inline. A double-quoted string containing a
  # $(...) that itself contains a double-quoted string does not parse in
  # Windows PowerShell 5.1, and it reports the failure many lines later.
  $goodPrefix = $value.StartsWith('sk-ant-')
  if ($goodPrefix) {
    $prefixNote = 'sk-ant-  (correct)'
    $prefixColour = 'Green'
  } else {
    $seen = $value.Substring(0, [Math]::Min(7, $len))
    $prefixNote = "'$seen'  (expected sk-ant-)"
    $prefixColour = 'Red'
  }
  Write-Host "    starts with     $prefixNote" -ForegroundColor $prefixColour

  # Quote characters held in variables, so no quoting subtlety is involved.
  $dq = [char]34
  $sq = [char]39
  $first = $value.Substring(0, 1)
  $last = $value.Substring($len - 1, 1)
  $wrapped = ($first -eq $dq -or $first -eq $sq -or $last -eq $dq -or $last -eq $sq)

  $problems = @()
  if ($value -ne $value.Trim())     { $problems += 'has leading or trailing whitespace' }
  if ($value -match '\s')           { $problems += 'contains a space, tab or newline INSIDE the value' }
  if ($wrapped)                     { $problems += 'is wrapped in quotes - remove them' }
  if ($value -match '[^\x20-\x7E]') { $problems += 'contains a non-printable or non-ASCII character' }
  # Anthropic keys are comfortably longer than this; a short one is a partial paste.
  if ($len -lt 40)                     { $problems += 'is far too short - the paste was probably cut off' }

  if ($problems.Count -eq 0) {
    Write-Host "    shape           looks clean" -ForegroundColor Green
  } else {
    foreach ($p in $problems) { Write-Host "    PROBLEM         $p" -ForegroundColor Red }
  }

  # The last four characters, to identify WHICH key this is.
  #
  # When the shape is clean and the server still says invalid, the open question
  # is no longer "is the value damaged" but "is this the key I think it is". The
  # console lists keys by their last few characters, so this is the one thing
  # that answers it. Four of 108 characters is not a usable secret, and it is
  # what the console already shows on screen.
  $tail = $value.Substring($len - 4, 4)
  Write-Host "    ends with       ...$tail   (match this against the console list)" -ForegroundColor DarkGray

  return $true
}

# --- Where the value could come from --------------------------------

$envFile = Join-Path $PSScriptRoot '.env.local'
$fromFile = $null
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*ANTHROPIC_API_KEY\s*=\s*(.*)$') { $fromFile = $Matches[1].Trim() }
  }
} else {
  Write-Host ".env.local not found next to this script." -ForegroundColor Red
  exit 1
}

$fromShell = $env:ANTHROPIC_API_KEY

Write-Host ""
Write-Host ("=" * 68) -ForegroundColor DarkGray
Write-Host "Where the agent would get its key" -ForegroundColor Cyan
Write-Host ("=" * 68) -ForegroundColor DarkGray

$hasFile  = Describe '.env.local' $fromFile 'the file'
$hasShell = Describe 'shell environment variable' $fromShell 'this PowerShell session'

Write-Host ""
if ($hasShell -and $hasFile -and ($fromShell -ne $fromFile)) {
  Write-Host "  THE TWO DISAGREE." -ForegroundColor Red
  Write-Host "  The agent prefers the shell value, so the one you edited in .env.local" -ForegroundColor Red
  Write-Host "  is being ignored. Clear it and restart the dev server:" -ForegroundColor Red
  Write-Host ""
  Write-Host '      Remove-Item Env:\ANTHROPIC_API_KEY' -ForegroundColor Yellow
  Write-Host ""
  Write-Host "  If it survives a new PowerShell window it is stored permanently - remove it" -ForegroundColor DarkGray
  Write-Host "  from the Windows environment variables, not just this session." -ForegroundColor DarkGray
} elseif ($hasShell) {
  Write-Host "  The shell value wins, and it matches the file." -ForegroundColor DarkGray
} else {
  Write-Host "  The file value will be used." -ForegroundColor DarkGray
}

$key = if ($fromShell) { $fromShell } else { $fromFile }
if (-not $key) {
  Write-Host ""
  Write-Host "  No key anywhere. Add ANTHROPIC_API_KEY to .env.local." -ForegroundColor Red
  exit 1
}

# --- Ask Anthropic ---------------------------------------------------

Write-Host ""
Write-Host ("=" * 68) -ForegroundColor DarkGray
Write-Host "What Anthropic says about it" -ForegroundColor Cyan
Write-Host ("=" * 68) -ForegroundColor DarkGray
Write-Host ""

$body = @{
  model      = 'claude-haiku-4-5-20251001'
  max_tokens = 1
  messages   = @(@{ role = 'user'; content = 'hi' })
} | ConvertTo-Json -Depth 6

try {
  $null = Invoke-RestMethod -Method Post -Uri 'https://api.anthropic.com/v1/messages' `
    -Headers @{ 'x-api-key' = $key; 'anthropic-version' = '2023-06-01' } `
    -ContentType 'application/json' -Body $body

  Write-Host "  The key works. Anthropic accepted a request and billed one token." -ForegroundColor Green
  Write-Host ""
  Write-Host "  So if the app still reports an invalid key, the app is reading a" -ForegroundColor DarkGray
  Write-Host "  different value than this script did. Restart the dev server." -ForegroundColor DarkGray
  exit 0
} catch {
  $code = $null
  if ($_.Exception.Response) { $code = $_.Exception.Response.StatusCode.value__ }

  $raw = $null
  if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
    $raw = $_.ErrorDetails.Message
  } else {
    try {
      $s = $_.Exception.Response.GetResponseStream()
      $s.Position = 0
      $r = New-Object System.IO.StreamReader($s)
      $raw = $r.ReadToEnd()
      $r.Close()
    } catch { }
  }

  $type = $null
  $message = $null
  if ($raw) {
    try {
      $j = $raw | ConvertFrom-Json
      $type = $j.error.type
      $message = $j.error.message
    } catch { }
  }

  Write-Host "  HTTP $code" -ForegroundColor Red
  if ($message) { Write-Host "  $message" -ForegroundColor Red }

  Write-Host ""
  switch ($type) {
    'authentication_error' {
      Write-Host "  The key itself is rejected. Either the paste is incomplete, or the key" -ForegroundColor Yellow
      Write-Host "  was deleted, expired, or belongs to a different workspace." -ForegroundColor Yellow
      Write-Host "  Create a fresh one at console.anthropic.com/settings/keys." -ForegroundColor Yellow
    }
    'permission_error' {
      Write-Host "  The key is valid but not allowed to do this. Check the workspace it was" -ForegroundColor Yellow
      Write-Host "  scoped to, and whether that workspace can use this model." -ForegroundColor Yellow
    }
    'invalid_request_error' {
      Write-Host "  The key authenticated. The request itself was rejected - most often this" -ForegroundColor Yellow
      Write-Host "  is the model name. That is a different problem from an invalid key." -ForegroundColor Yellow
    }
    'rate_limit_error' {
      Write-Host "  The key is valid and rate limited. Wait and retry." -ForegroundColor Yellow
    }
    default {
      if ($code -eq 400 -and $message -match 'credit|balance') {
        Write-Host "  The key is valid; the account has no credit. Add some under Billing." -ForegroundColor Yellow
      } elseif ($raw) {
        Write-Host "  Server response:" -ForegroundColor DarkGray
        Write-Host "    $raw" -ForegroundColor DarkGray
      }
    }
  }
  Write-Host ""
  exit 1
}
