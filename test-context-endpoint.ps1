# Verify Sanity Context MCP endpoints end to end.
#
#   .\test-context-endpoint.ps1            # both endpoints
#   .\test-context-endpoint.ps1 -Only groq  # just the GROQ one
#   .\test-context-endpoint.ps1 -Only kb
#
# Lists the tools each endpoint serves, checks them against what the mode is
# documented to serve, and for GROQ mode runs a real query to prove the schema
# is readable server-side. Nothing is written. The token never leaves this machine.

param([ValidateSet('both','groq','kb')][string]$Only = 'both')

$ErrorActionPreference = 'Stop'

$envFile = Join-Path $PSScriptRoot '.env.local'
if (-not (Test-Path $envFile)) { throw ".env.local not found next to this script" }
$cfg = @{}
Get-Content $envFile | ForEach-Object {
  if ($_ -match '^\s*([A-Z_]+)\s*=\s*(.*)$') { $cfg[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'") }
}
$token = $cfg['SANITY_ORGANIZATION_TOKEN']
if (-not $token) { throw "SANITY_ORGANIZATION_TOKEN is empty in .env.local" }

$headers = @{ Authorization = "Bearer $token"; Accept = 'application/json, text/event-stream' }

function Invoke-Mcp($url, $method, $params) {
  $body = @{ jsonrpc = '2.0'; id = 1; method = $method }
  if ($params) { $body.params = $params }
  Invoke-RestMethod -Method Post -Uri $url -Headers $headers `
    -ContentType 'application/json' -Body ($body | ConvertTo-Json -Depth 8)
}

# The status code alone is rarely enough. The server puts the reason in the
# response body, and Windows PowerShell 5.1 does not surface it, so read the
# stream by hand. PowerShell 7 has it on ErrorDetails.
function Get-ErrorBody($err) {
  if ($err.ErrorDetails -and $err.ErrorDetails.Message) { return $err.ErrorDetails.Message }
  try {
    $stream = $err.Exception.Response.GetResponseStream()
    $stream.Position = 0
    $reader = New-Object System.IO.StreamReader($stream)
    $body = $reader.ReadToEnd()
    $reader.Close()
    return $body
  } catch { return $null }
}

function Explain-HttpError($err) {
  $code = $err.Exception.Response.StatusCode.value__
  $body = Get-ErrorBody $err

  $hint = switch ($code) {
    400 { "400 - the server rejected the request. Its reason is below." }
    401 { "401 - token missing or malformed." }
    403 { "403 - this is a PROJECT token. Context needs an ORGANIZATION token with Context Viewer." }
    404 { "404 - the endpoint name in the URL does not match one that exists." }
    default { "HTTP $code - $($err.Exception.Message)" }
  }

  if ($body) {
    # Pretty-print JSON when that is what came back; otherwise show it raw.
    try {
      $parsed = $body | ConvertFrom-Json
      $pretty = $parsed | ConvertTo-Json -Depth 8
      return "$hint`n`n  Server said:`n$($pretty -split "`n" | ForEach-Object { "    $_" } | Out-String)"
    } catch {
      return "$hint`n`n  Server said:`n    $body"
    }
  }
  return $hint
}

# Documented tool sets, per mode.
$expected = @{
  kb   = @('initial_context','knowledge_base_read')
  groq = @('initial_context','schema_explorer','groq_query','array_field_reader')
}

$targets = @()
if ($Only -in 'both','kb')   { $targets += @{ Mode='kb';   Url=$cfg['SANITY_CONTEXT_KB_URL'];   Label='Knowledge Base mode' } }
if ($Only -in 'both','groq') { $targets += @{ Mode='groq'; Url=$cfg['SANITY_CONTEXT_GROQ_URL']; Label='GROQ mode' } }

$failures = 0

foreach ($t in $targets) {
  Write-Host ""
  Write-Host ("=" * 70) -ForegroundColor DarkGray
  Write-Host "$($t.Label)" -ForegroundColor Cyan
  Write-Host ("=" * 70) -ForegroundColor DarkGray

  if (-not $t.Url) {
    Write-Host "  Not configured. Set SANITY_CONTEXT_$($t.Mode.ToUpper())_URL in .env.local." -ForegroundColor Yellow
    continue
  }
  Write-Host "$($t.Url)" -ForegroundColor DarkGray
  Write-Host ""

  # --- tools/list ---
  try {
    $tools = Invoke-Mcp $t.Url 'tools/list' $null
  } catch {
    Write-Host "  $(Explain-HttpError $_)" -ForegroundColor Red
    $failures++
    continue
  }

  $names = @($tools.result.tools | ForEach-Object { $_.name })
  if ($names.Count -eq 0) {
    Write-Host "  Served no tools. Check the endpoint's mode and its sources." -ForegroundColor Red
    $failures++
    continue
  }

  $want = $expected[$t.Mode]
  foreach ($n in $want) {
    if ($names -contains $n) { Write-Host "  ok    $n" -ForegroundColor Green }
    else { Write-Host "  MISSING  $n" -ForegroundColor Red; $failures++ }
  }
  foreach ($n in $names) {
    if ($want -notcontains $n) { Write-Host "  extra $n" -ForegroundColor DarkGray }
  }

  # --- GROQ mode: prove the schema is readable and the data is queryable ---
  if ($t.Mode -eq 'groq') {
    Write-Host ""
    Write-Host "  Running a real query through groq_query..." -ForegroundColor Yellow
    $q = 'count(*[_type == "detectionRule"])'
    try {
      $res = Invoke-Mcp $t.Url 'tools/call' @{
        name = 'groq_query'; arguments = @{ query = $q }
      }
      $text = ($res.result.content | Where-Object { $_.type -eq 'text' } | ForEach-Object { $_.text }) -join "`n"
      if ($res.result.isError) {
        Write-Host "  Query returned an error:" -ForegroundColor Red
        Write-Host "  $text" -ForegroundColor Red
        $failures++
      } else {
        Write-Host "  $q" -ForegroundColor DarkGray
        Write-Host "  -> $($text.Trim())" -ForegroundColor Green
        Write-Host ""
        Write-Host "  A number here means the deployed schema is being read and the" -ForegroundColor DarkGray
        Write-Host "  dataset source is serving. That was the last blocker." -ForegroundColor DarkGray
      }
    } catch {
      Write-Host "  $(Explain-HttpError $_)" -ForegroundColor Red
      $failures++
    }

    # schema_explorer is what tells the agent what the fields mean.
    Write-Host ""
    Write-Host "  Checking schema_explorer on detectionRule..." -ForegroundColor Yellow
    try {
      $res = Invoke-Mcp $t.Url 'tools/call' @{
        name = 'schema_explorer'; arguments = @{ type = 'detectionRule' }
      }
      $text = ($res.result.content | Where-Object { $_.type -eq 'text' } | ForEach-Object { $_.text }) -join "`n"
      if ($text -match 'kqlFeatures') {
        Write-Host "  ok    kqlFeatures is visible to the agent" -ForegroundColor Green
        # The field descriptions are agent-facing documentation, so confirm they survived.
        if ($text -match 'single-table') {
          Write-Host "  ok    field descriptions came through" -ForegroundColor Green
          Write-Host "        the agent can read why a tier downgrade breaks a rule" -ForegroundColor DarkGray
        } else {
          Write-Host "  note  descriptions may be truncated in this view" -ForegroundColor Yellow
        }
      } else {
        Write-Host "  Could not find kqlFeatures in the returned schema." -ForegroundColor Red
        $failures++
      }
    } catch {
      Write-Host "  $(Explain-HttpError $_)" -ForegroundColor Red
      $failures++
    }
  }

  # --- initial_context: what the agent reads before choosing anything ---
  Write-Host ""
  Write-Host "  initial_context (first 20 lines)..." -ForegroundColor Yellow
  try {
    $ctx = Invoke-Mcp $t.Url 'tools/call' @{ name = 'initial_context'; arguments = @{} }
    $text = ($ctx.result.content | Where-Object { $_.type -eq 'text' } | ForEach-Object { $_.text }) -join "`n"
    ($text -split "`n" | Select-Object -First 20) | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    $total = ($text -split "`n").Count
    if ($total -gt 20) { Write-Host "    ... $($total - 20) more lines" -ForegroundColor DarkGray }
  } catch {
    Write-Host "  $(Explain-HttpError $_)" -ForegroundColor Red
    $failures++
  }
}

Write-Host ""
Write-Host ("=" * 70) -ForegroundColor DarkGray
if ($failures -eq 0) {
  Write-Host "All checks passed." -ForegroundColor Green
} else {
  Write-Host "$failures check(s) failed." -ForegroundColor Red
}
exit $failures
