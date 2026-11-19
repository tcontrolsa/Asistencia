<#
  TCONTROL · Registra en OpenWA el webhook de la autorrespuesta de soporte (soporte_autorespuesta.gs).

  OpenWA avisa a Apps Script cada vez que entra un mensaje con «REPORTE DE INCIDENCIA»; Apps Script
  confirma el reporte al colaborador. Se filtra en OpenWA (body contiene el texto) para no enviar el resto.

  La clave de OpenWA se toma del contenedor "tunel-whatsapp" (variable OPENWA_API_KEY) sin mostrarla.
  La URL del webhook lleva el secreto: no se guarda en el repositorio. Dásela al script así:
    - archivo .env junto al script con la línea  WEBHOOK_URL=https://script.google.com/macros/s/<ID>/exec?webhook=soporte&s=<SECRETO>
      (bórralo después), o
    - te la pide al ejecutar (no se muestra al escribir).

  Uso (en el servidor, PowerShell):
      powershell -ExecutionPolicy Bypass -File .\crear_webhook_soporte.ps1            # crea (o reemplaza el anterior)
      powershell -ExecutionPolicy Bypass -File .\crear_webhook_soporte.ps1 -Listar     # solo muestra los webhooks actuales
      powershell -ExecutionPolicy Bypass -File .\crear_webhook_soporte.ps1 -Quitar     # elimina el webhook de soporte
  Solo comandos docker y llamadas a OpenWA: no detiene ni reinicia nada.
#>
param(
    [switch]$Listar,
    [switch]$Quitar,
    [string]$Base = "http://localhost:2785",
    [string]$EnvFile = (Join-Path $PSScriptRoot ".env")
)
$ErrorActionPreference = "Stop"
$MARCA = "tcontrol-soporte"          # se guarda en una cabecera propia para reconocer este webhook

docker info --format "{{.ServerVersion}}" *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker no responde. Abre Docker Desktop y vuelve a ejecutar." }

# Clave de OpenWA: del contenedor del túnel (no se imprime)
$json = docker inspect tunel-whatsapp --format '{{json .Config.Env}}' 2>$null
if ($LASTEXITCODE -ne 0 -or -not $json) { throw "No encuentro el contenedor tunel-whatsapp (de ahí se toma la clave de OpenWA)." }
$envT = $json | ConvertFrom-Json
$clave = (($envT | Where-Object { $_ -like 'OPENWA_API_KEY=*' } | Select-Object -First 1) -replace '^OPENWA_API_KEY=', '').Trim().Trim('"').Trim("'")
if (-not $clave) { throw "El contenedor tunel-whatsapp no tiene OPENWA_API_KEY." }
# Mismos encabezados que usa el túnel (X-API-Key y Bearer)
$h = @{ 'X-API-Key' = $clave; 'Authorization' = "Bearer $clave" }
# Mismo destino que usa el túnel (DESTINO), visto desde el servidor
if (-not $PSBoundParameters.ContainsKey('Base')) {
    $dest = (($envT | Where-Object { $_ -like 'DESTINO=*' } | Select-Object -First 1) -replace '^DESTINO=', '').Trim().TrimEnd('/')
    if ($dest) { $Base = $dest -replace 'host\.docker\.internal', 'localhost' }
}
Write-Host "OpenWA: $Base (clave de $($clave.Length) caracteres)"

# Sesión activa
$ses = Invoke-RestMethod -Uri "$Base/api/sessions" -Headers $h
$lista = if ($ses -is [array]) { $ses } elseif ($ses.data) { $ses.data } else { @($ses) }
$sesion = $lista | Where-Object { $_.status -in 'ready', 'WORKING', 'RUNNING', 'PAIRED' } | Select-Object -First 1
if (-not $sesion) { $sesion = $lista | Select-Object -First 1 }
if (-not $sesion) { throw "OpenWA no tiene sesiones." }
Write-Host ("Sesión: {0} ({1})" -f $sesion.name, $sesion.status)
$ruta = "$Base/api/sessions/$($sesion.id)/webhooks"

function Leer-Webhooks {
    $r = Invoke-RestMethod -Uri $ruta -Headers $h
    if ($r -is [array]) { $r } elseif ($r.data) { $r.data } else { @($r) }
}
$actuales = @(Leer-Webhooks)
# Muestra solo el host/ruta (la URL de Apps Script lleva el secreto después del '?')
function Corta($u) { if ($u) { ($u -split '\?')[0] } else { '' } }
Write-Host ("Webhooks actuales: {0}" -f $actuales.Count)
foreach ($w in $actuales) { Write-Host ("  - {0}  {1}  eventos={2}  activo={3}" -f $w.id, (Corta $w.url), ($w.events -join ','), $w.active) }
if ($Listar) { return }

# Cualquier webhook hacia Apps Script (script.google.com) se considera el de soporte y se reemplaza
$propios = @($actuales | Where-Object { $_.url -like 'https://script.google.com/*' })
if ($Quitar) {
    foreach ($w in $propios) { Invoke-RestMethod -Method Delete -Uri "$ruta/$($w.id)" -Headers $h | Out-Null; Write-Host "Eliminado $($w.id)" }
    if (-not $propios) { Write-Host "No había webhook de soporte." }
    return
}

# URL con el secreto
$url = $null
if (Test-Path $EnvFile) {
    foreach ($l in Get-Content $EnvFile) { if ($l -match '^\s*WEBHOOK_URL\s*=\s*(.+?)\s*$') { $url = $Matches[1].Trim('"').Trim("'") } }
}
if (-not $url) {
    $sec = Read-Host "Pega la URL del webhook (https://script.google.com/macros/s/.../exec?webhook=soporte&s=SECRETO)" -AsSecureString
    $url = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
}
$url = $url.Trim()
$fallos = @()
if ($url -notmatch '^https://script\.google\.com/macros/s/[^/?\s]+/exec(\?|$)') { $fallos += "debe empezar por https://script.google.com/macros/s/<ID>/exec (con un solo /exec, sin espacios ni barra final antes del ?)" }
if ($url -notmatch '[?&]webhook=soporte(&|$)') { $fallos += "falta el parámetro  webhook=soporte" }
if ($url -notmatch '[?&]s=[^&\s]{16,}') { $fallos += "falta  s=<SECRETO>  o tiene menos de 16 caracteres" }
if ($fallos) {
    Write-Host ("URL recibida: {0} caracteres, parte inicial: {1}" -f $url.Length, (($url -split '\?')[0]))
    # Nombres de los parámetros y largo de cada valor (nunca el valor: es el secreto)
    $q = ($url -split '\?', 2)[1]
    if ($q) { foreach ($par in ($q -split '&')) { $kv = $par -split '=', 2; Write-Host ("  parámetro «{0}»  valor de {1} caracteres" -f $kv[0], ($kv[1]).Length) } } else { Write-Host "  (la URL no tiene parámetros después del ?)" }
    throw ("La URL no es válida: " + ($fallos -join '; ') + ". Ejemplo: https://script.google.com/macros/s/<ID>/exec?webhook=soporte&s=<SECRETO>")
}

# Reemplaza el webhook de soporte anterior, si había
foreach ($w in $propios) { Invoke-RestMethod -Method Delete -Uri "$ruta/$($w.id)" -Headers $h | Out-Null; Write-Host "Reemplazo: eliminado $($w.id)" }

$cuerpo = @{
    url     = $url
    events  = @('message.received')
    filters = @{ conditions = @(@{ field = 'body'; operator = 'contains'; value = 'REPORTE DE INCIDENCIA'; caseSensitive = $false }) }
    retryCount = 1
    headers = @{ 'X-Origen' = $MARCA }
} | ConvertTo-Json -Depth 6
$nuevo = Invoke-RestMethod -Method Post -Uri $ruta -Headers $h -ContentType 'application/json' -Body $cuerpo
Write-Host ("Webhook creado: {0}  eventos={1}" -f $nuevo.id, ($nuevo.events -join ','))
Write-Host "Prueba: escribe un reporte de incidencia desde otro teléfono y revisa la hoja ACCESOS (acción webhookSoporte)."
Write-Host "Borra el archivo .env si lo usaste."
