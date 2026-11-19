$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $projectRoot
$runtimeDir = Join-Path $projectRoot '.demo-runtime'
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
if (Get-NetTCPConnection -State Listen -LocalPort 3100 -ErrorAction SilentlyContinue) {
  throw 'Port 3100 jest zajety. Jesli demo juz dziala, jego adres jest w .demo-runtime/url.txt.'
}
if (!(Test-Path -LiteralPath '.next/BUILD_ID')) {
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
}
$tunnelLog = Join-Path $runtimeDir 'tunnel.err.log'
$tunnel = Start-Process -FilePath (Get-Command cloudflared).Source -ArgumentList @('tunnel','--url','http://localhost:3100','--protocol','http2','--no-autoupdate') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimeDir 'tunnel.out.log') -RedirectStandardError $tunnelLog -PassThru
$publicUrl = $null
for ($attempt = 0; $attempt -lt 45; $attempt++) {
  Start-Sleep -Seconds 1
  $log = Get-Content -LiteralPath $tunnelLog -Raw -ErrorAction SilentlyContinue
  if ($log -match 'https://[a-z-]+\.trycloudflare\.com') { $publicUrl = $Matches[0]; break }
  if ($tunnel.HasExited) { throw 'Cloudflare zakonczyl dzialanie. Sprawdz .demo-runtime/tunnel.err.log.' }
}
if (!$publicUrl) { Stop-Process -Id $tunnel.Id; throw 'Nie uzyskano adresu Cloudflare.' }
$envFile = Join-Path $projectRoot '.env.local'
$envText = Get-Content -LiteralPath $envFile -Raw
$envText = [regex]::Replace($envText, '(?m)^APP_URL=.*$', "APP_URL=$publicUrl")
if ($envText -notmatch '(?m)^PUBLIC_DEMO=') { $envText += "`nPUBLIC_DEMO=true`n" }
else { $envText = [regex]::Replace($envText, '(?m)^PUBLIC_DEMO=.*$', 'PUBLIC_DEMO=true') }
Set-Content -LiteralPath $envFile -Value $envText -Encoding utf8
Set-Content -LiteralPath (Join-Path $runtimeDir 'url.txt') -Value $publicUrl
$server = Start-Process -FilePath (Get-Command node).Source -ArgumentList @('node_modules/next/dist/bin/next','start','--hostname','localhost','--port','3100') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimeDir 'server.out.log') -RedirectStandardError (Join-Path $runtimeDir 'server.err.log') -PassThru
@{ server = $server.Id; tunnel = $tunnel.Id; url = $publicUrl } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimeDir 'processes.json')
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  try { $null = Invoke-WebRequest -Uri "$publicUrl/api/version" -TimeoutSec 3; break } catch { Start-Sleep -Seconds 1 }
}
& node --env-file=.env.local scripts/register-telegram.mjs
Write-Host "Demo: $publicUrl"
Write-Host "Panel: $publicUrl/admin/login"
Write-Host 'Hasla: .demo-runtime/DOSTEP.txt. Komputer musi pozostac wlaczony. Po ponownym uruchomieniu tunelu link sie zmieni.'

