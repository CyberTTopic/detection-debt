# Dump the real inputSchema of every tool both Context endpoints serve.
#
#   .\probe-context-tools.ps1
#   .\probe-context-tools.ps1 -Save    # also writes evidence\context-tool-schemas.json
#
# Why this exists: the agent's tool wrappers have to match the server's actual
# argument names. Guessing them produces a tool that silently returns an error
# string the model then reasons over as if it were data, which is worse than
# failing loudly. So the shapes get read from the server once and written down.
#
# Nothing is written to the dataset. The token never leaves this machine.

param([switch]$Save)

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

$endpoints = @(
  @{ Label = 'GROQ mode'; Url = $cfg['SANITY_CONTEXT_GROQ_URL'] }
  @{ Label = 'Knowledge Base mode'; Url = $cfg['SANITY_CONTEXT_KB_URL'] }
)

$collected = @{}

foreach ($e in $endpoints) {
  Write-Host ""
  Write-Host ("=" * 72) -ForegroundColor DarkGray
  Write-Host $e.Label -ForegroundColor Cyan
  Write-Host ("=" * 72) -ForegroundColor DarkGray

  if (-not $e.Url) { Write-Host "  not configured" -ForegroundColor Yellow; continue }

  $res = Invoke-Mcp $e.Url 'tools/list' $null
  $collected[$e.Label] = $res.result.tools

  foreach ($t in $res.result.tools) {
    Write-Host ""
    Write-Host "  $($t.name)" -ForegroundColor Green

    if ($t.description) {
      # Descriptions can be long; the first two lines say what it is for.
      ($t.description -split "`n" | Where-Object { $_.Trim() } | Select-Object -First 2) |
        ForEach-Object { Write-Host "    $($_.Trim())" -ForegroundColor DarkGray }
    }

    $props = $t.inputSchema.properties
    if (-not $props) {
      Write-Host "    (takes no arguments)" -ForegroundColor DarkGray
      continue
    }

    $required = @()
    if ($t.inputSchema.required) { $required = @($t.inputSchema.required) }

    Write-Host "    arguments:" -ForegroundColor DarkGray
    foreach ($name in $props.PSObject.Properties.Name) {
      $p = $props.$name
      $type = if ($p.type) { $p.type } else { 'any' }
      if ($type -eq 'array' -and $p.items.type) { $type = "array<$($p.items.type)>" }
      $flag = if ($required -contains $name) { 'required' } else { 'optional' }
      $colour = if ($required -contains $name) { 'White' } else { 'DarkGray' }
      Write-Host ("      {0,-22} {1,-16} {2}" -f $name, $type, $flag) -ForegroundColor $colour
      if ($p.description) {
        $d = ($p.description -split "`n")[0].Trim()
        if ($d.Length -gt 100) { $d = $d.Substring(0, 100) + '...' }
        Write-Host "        $d" -ForegroundColor DarkGray
      }
    }
  }
}

# The one answer the wrappers actually hinge on.
Write-Host ""
Write-Host ("=" * 72) -ForegroundColor DarkGray
Write-Host "The question this was run to answer" -ForegroundColor Cyan
Write-Host ("=" * 72) -ForegroundColor DarkGray

$groq = $collected['GROQ mode'] | Where-Object { $_.name -eq 'groq_query' }
if ($groq) {
  $argNames = @($groq.inputSchema.properties.PSObject.Properties.Name)
  Write-Host "  groq_query accepts: $($argNames -join ', ')"
  if ($argNames -contains 'params') {
    Write-Host "  -> parameterised queries are supported. Pass params as an object." -ForegroundColor Green
  } else {
    Write-Host "  -> NO params argument. Values must be inlined into the query text," -ForegroundColor Yellow
    Write-Host "     which means the wrappers have to serialise them safely themselves." -ForegroundColor Yellow
  }
} else {
  Write-Host "  groq_query not found on the GROQ endpoint." -ForegroundColor Red
}

if ($Save) {
  $dir = Join-Path $PSScriptRoot 'evidence'
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  $out = Join-Path $dir 'context-tool-schemas.json'
  $collected | ConvertTo-Json -Depth 20 | Set-Content -Path $out -Encoding UTF8
  Write-Host ""
  Write-Host "  Saved to evidence\context-tool-schemas.json" -ForegroundColor DarkGray
}

Write-Host ""
