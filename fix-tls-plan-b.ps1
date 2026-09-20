# Plan B for corporate TLS inspection.
#
#   .\fix-tls-plan-b.ps1
#
# Use only if `$env:NODE_OPTIONS = "--use-system-ca"` did not work.
#
# Exports the certificate authorities Windows already trusts into a PEM bundle
# and points Node at it with NODE_EXTRA_CA_CERTS. Node keeps verifying
# certificates normally; it just also trusts what your machine trusts.
#
# Reads the certificate store. Changes nothing in it. The bundle contains public
# certificates only, no private keys.

$ErrorActionPreference = 'Stop'
$out = Join-Path $PSScriptRoot 'ca-bundle.pem'

Write-Host "Exporting trusted certificate authorities from the Windows store..." -ForegroundColor Yellow

$stores = @('Cert:\LocalMachine\Root', 'Cert:\CurrentUser\Root',
            'Cert:\LocalMachine\CA', 'Cert:\CurrentUser\CA')

$certs = foreach ($store in $stores) {
  if (Test-Path $store) { Get-ChildItem $store -ErrorAction SilentlyContinue }
}

# The same CA often appears in several stores; thumbprint deduplicates.
$unique = $certs | Sort-Object -Property Thumbprint -Unique
Write-Host "  Found $($unique.Count) unique certificates" -ForegroundColor Green

$blocks = foreach ($c in $unique) {
  try {
    $b64 = [Convert]::ToBase64String($c.RawData, 'InsertLineBreaks')
    "# $($c.Subject)`r`n-----BEGIN CERTIFICATE-----`r`n$b64`r`n-----END CERTIFICATE-----"
  } catch {
    # A malformed entry in the store should not abort the whole export.
  }
}

$blocks -join "`r`n" | Set-Content -Path $out -Encoding ascii
Write-Host "  Written to $out ($([math]::Round((Get-Item $out).Length / 1KB)) KB)" -ForegroundColor Green

# Point Node at the bundle, for this session and for future ones.
$env:NODE_EXTRA_CA_CERTS = $out
[Environment]::SetEnvironmentVariable('NODE_EXTRA_CA_CERTS', $out, 'User')

Write-Host ""
Write-Host "NODE_EXTRA_CA_CERTS set to that bundle." -ForegroundColor Cyan
Write-Host "Active in this window and in new ones." -ForegroundColor Cyan
Write-Host ""

# Which CA is doing the inspecting is worth knowing, and it is a good detail for
# the writeup.
$corporate = $unique | Where-Object {
  $_.Subject -match 'thryv|zscaler|netskope|bluecoat|forcepoint|palo ?alto|fortinet|mcafee|proxy|websense'
}
if ($corporate) {
  Write-Host "TLS-inspecting CAs found in your trust store:" -ForegroundColor Yellow
  $corporate | ForEach-Object { Write-Host "  $($_.Subject)" -ForegroundColor DarkGray }
  Write-Host ""
}

Write-Host "Now run:" -ForegroundColor Cyan
Write-Host "  npm run seed:infra"
