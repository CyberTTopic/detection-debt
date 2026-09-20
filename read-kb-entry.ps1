# Read full Knowledge Base entries through the MCP endpoint.
#
#   .\read-kb-entry.ps1 emergency_access
#   .\read-kb-entry.ps1 mfa/session_lifetime conditional_access/session_controls
#   .\read-kb-entry.ps1 -Grep "32 characters" emergency_access
#
# Paths come verbatim from the outline that test-context-endpoint.ps1 prints.
# Up to 20 paths per call. Use -Grep to show only matching lines with context,
# which is how you check whether a specific claim made it into an entry.

# Parameter binding here took two attempts, so it is spelled out.
#
# ValueFromRemainingArguments alone drops the path when -Grep comes first: it
# only collects arguments PowerShell could not otherwise bind. Position = 0
# alone takes just the first path, because a second bare word has no position
# left to bind to.
#
# So: Position 0 for the first path, plus a remaining-arguments catch-all, and
# merge them. Every calling style now works:
#
#   .\read-kb-entry.ps1 emergency_access
#   .\read-kb-entry.ps1 emergency_access privileged_access
#   .\read-kb-entry.ps1 emergency_access,privileged_access -Grep "characters"
#   .\read-kb-entry.ps1 -Grep "32" emergency_access
param(
  [Parameter(Mandatory = $true, Position = 0)][string[]]$Paths,
  [string]$Grep,
  [string]$KbId = 'kbtescebD5nQ',
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest
)

$ErrorActionPreference = 'Stop'

if ($Rest) { $Paths = @($Paths) + @($Rest) }
$Paths = @($Paths | Where-Object { $_ -and $_.Trim() } | ForEach-Object { $_.Trim() })
if ($Paths.Count -eq 0) { throw "Give at least one entry path from the outline" }
if ($Paths.Count -gt 20) { throw "knowledge_base_read accepts at most 20 paths per call" }

Write-Host "Reading $($Paths.Count) entr$(if ($Paths.Count -eq 1) {'y'} else {'ies'}): $($Paths -join ', ')" -ForegroundColor Cyan
Write-Host ""

$envFile = Join-Path $PSScriptRoot '.env.local'
$cfg = @{}
Get-Content $envFile | ForEach-Object {
  if ($_ -match '^\s*([A-Z_]+)\s*=\s*(.*)$') { $cfg[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'") }
}

$body = @{
  jsonrpc = '2.0'; id = 1; method = 'tools/call'
  params  = @{ name = 'knowledge_base_read'; arguments = @{ knowledgeBase = $KbId; paths = $Paths } }
} | ConvertTo-Json -Depth 8

$res = Invoke-RestMethod -Method Post -Uri $cfg['SANITY_CONTEXT_KB_URL'] `
  -Headers @{ Authorization = "Bearer $($cfg['SANITY_ORGANIZATION_TOKEN'])"; Accept = 'application/json, text/event-stream' } `
  -ContentType 'application/json' -Body $body

$text = ($res.result.content | Where-Object { $_.type -eq 'text' } | ForEach-Object { $_.text }) -join "`n"

if ($Grep) {
  Write-Host "Lines matching '$Grep':" -ForegroundColor Yellow
  $lines = $text -split "`n"
  $hits = 0
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match [regex]::Escape($Grep)) {
      $hits++
      $from = [Math]::Max(0, $i - 2); $to = [Math]::Min($lines.Count - 1, $i + 2)
      Write-Host "--- line $($i+1) ---" -ForegroundColor DarkGray
      $from..$to | ForEach-Object {
        $c = if ($_ -eq $i) { 'Green' } else { 'Gray' }
        Write-Host $lines[$_] -ForegroundColor $c
      }
    }
  }
  if ($hits -eq 0) { Write-Host "  No match. That claim is not in the entries you read." -ForegroundColor Red }
  else { Write-Host "`n$hits match(es)." -ForegroundColor Green }
} else {
  Write-Host $text
}
