# Avvia il sito dell'hotel (versione veloce) sulla porta 3005.
# Dal 19.11.2026 il sito vive su Vercel (dati in Supabase). Due copie che salvano insieme si
# sovrascriverebbero: questa non parte piu. Per avviarla di nuovo apposta: .\avvia-sito.ps1 -Forza
param([switch]$Forza)
Set-Location $PSScriptRoot
if (-not $Forza) {
  Write-Host "Il sito ora e' online su Vercel: questa copia sul computer non parte (usa -Forza solo se sai cosa fai)."
  exit 1
}
npx next start -p 3005
