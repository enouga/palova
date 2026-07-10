# Demarrage complet Palova : Docker + Postgres/Redis + backend + frontend + Prisma Studio.
# Les serveurs tournent CACHES en arriere-plan (aucune fenetre) ; leurs logs vont dans logs\*.log.
#   .\start.ps1        -> (re)demarre tout proprement
#   .\start.ps1 -Stop  -> arrete tous les serveurs
# NB : garder ce fichier 100% ASCII (PowerShell 5.1 sans BOM transforme un tiret typographique
# en guillemet et casse tout le parsing).
param([switch]$Stop)

# Le chemin du projet = le dossier de CE script (plus jamais de chemin OneDrive en dur).
$PALOVA_PATH = $PSScriptRoot
if (-not $PALOVA_PATH) { $PALOVA_PATH = "C:\ProjetsIA\05_PERSO\RESERVE\palova" }
$LOGS = "$PALOVA_PATH\logs"
$DOCKER_COMPOSE = "C:\Program Files\Docker\Docker\resources\bin\docker-compose-v1.exe"
$DOCKER_DESKTOP = "C:\Program Files\Docker\Docker\Docker Desktop.exe"

# Garde-fou : la copie OneDrive est un husk non-git casse - on refuse de demarrer depuis la.
if ($PALOVA_PATH -like "*OneDrive*") {
    Write-Host "ERREUR : ce script tourne depuis la copie OneDrive ($PALOVA_PATH)." -ForegroundColor Red
    Write-Host "Le seul repo valide est C:\ProjetsIA\05_PERSO\RESERVE\palova - lance le start.ps1 de la-bas." -ForegroundColor Red
    exit 1
}

function Stop-PortOwner([int]$Port) {
    Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique |
        ForEach-Object {
            try {
                Stop-Process -Id $_ -Force -ErrorAction Stop
                Write-Host "  process $_ (port $Port) arrete" -ForegroundColor DarkGray
            } catch { }
        }
}

# Tue TOUTE la pile dev de CE repo (nodemon/ts-node/next/prisma studio + leurs cmd de
# redirection), y compris les zombies sans socket : apres une mise en veille, un backend
# peut rester vivant sans plus ecouter -> il echappe a Stop-PortOwner ET garde logs\*.log
# verrouille, ce qui fait mourir en silence la redirection du nouveau demarrage.
function Stop-StaleStack {
    $killed = 0
    Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='cmd.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and (
            $_.CommandLine -like "*$PALOVA_PATH\backend*" -or
            $_.CommandLine -like "*$PALOVA_PATH\frontend*" -or
            $_.CommandLine -like "*$LOGS*" -or
            $_.CommandLine -like "*ts-node/register src/app.ts*") } |
        ForEach-Object {
            try {
                Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop
                $killed++
                $cmd = $_.CommandLine.Substring(0, [Math]::Min(70, $_.CommandLine.Length))
                Write-Host "  process $($_.ProcessId) arrete ($cmd...)" -ForegroundColor DarkGray
            } catch { }
        }
    # Les handles (verrous sur logs\*.log) mettent ~1 s a etre relaches apres le kill.
    if ($killed -gt 0) { Start-Sleep -Seconds 2 }
}

function Wait-Http([string]$Url, [int]$TimeoutSec) {
    for ($i = 0; $i -lt $TimeoutSec; $i++) {
        try {
            Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2 | Out-Null
            Write-Host ""
            return $true
        } catch { }
        Write-Host -NoNewline "."
        Start-Sleep -Seconds 1
    }
    Write-Host ""
    return $false
}

# Lance une commande en arriere-plan SANS fenetre, sortie fusionnee dans un fichier log.
function Start-Hidden([string]$WorkDir, [string]$Command, [string]$LogFile) {
    # Si un ancien process verrouille encore le log, la redirection cmd echouerait en
    # silence (le serveur ne demarre jamais). On purge ; sinon, log de repli horodate.
    try { if (Test-Path $LogFile) { Remove-Item $LogFile -Force -ErrorAction Stop } }
    catch {
        $LogFile = $LogFile -replace '\.log$', ("-{0:yyyyMMdd-HHmmss}.log" -f (Get-Date))
        Write-Host "  log verrouille, sortie vers $LogFile" -ForegroundColor Yellow
    }
    Start-Process -FilePath $env:ComSpec -ArgumentList '/c', "$Command > `"$LogFile`" 2>&1" `
        -WorkingDirectory $WorkDir -WindowStyle Hidden
}

# node_modules peut exister mais avoir son node_modules\.bin vide (shims nodemon/next
# disparus alors que les paquets sont intacts) : un simple Test-Path node_modules ne le
# detecte pas, npm run dev echoue alors instantanement ("nodemon n'est pas reconnu") et
# le script attend 60 s pour rien avant de conclure "le backend ne repond pas".
function Test-DepsInstalled([string]$Dir, [string]$BinCheck) {
    return (Test-Path "$Dir\node_modules") -and (Test-Path "$Dir\node_modules\.bin\$BinCheck")
}

# ---------- Mode -Stop ----------
if ($Stop) {
    Write-Host "`nArret des serveurs Palova..." -ForegroundColor Yellow
    Stop-StaleStack
    Stop-PortOwner 3000
    Stop-PortOwner 3001
    Stop-PortOwner 5555
    Write-Host "Serveurs arretes (les conteneurs Docker restent en place)." -ForegroundColor Green
    exit 0
}

New-Item -ItemType Directory -Force $LOGS | Out-Null

Write-Host "`nPalova Startup (repo : $PALOVA_PATH)" -ForegroundColor Cyan
Write-Host ("=" * 60) -ForegroundColor Cyan

# ---------- 1) Docker ----------
Write-Host "`n[1/5] Docker..." -ForegroundColor Yellow
$dockerRunning = $false
try { docker ps 2>$null | Out-Null; if ($LASTEXITCODE -eq 0) { $dockerRunning = $true } } catch { }

if (-not $dockerRunning) {
    if (-not (Test-Path $DOCKER_DESKTOP)) {
        Write-Host "Docker Desktop introuvable : $DOCKER_DESKTOP" -ForegroundColor Red
        exit 1
    }
    Write-Host "Docker ne tourne pas, demarrage de Docker Desktop (jusqu'a 120 s)..." -ForegroundColor Yellow
    Start-Process $DOCKER_DESKTOP
    for ($i = 0; $i -lt 120; $i++) {
        Start-Sleep -Seconds 1
        try { docker ps 2>$null | Out-Null; if ($LASTEXITCODE -eq 0) { $dockerRunning = $true; break } } catch { }
        Write-Host -NoNewline "."
    }
    Write-Host ""
    if (-not $dockerRunning) {
        Write-Host "ECHEC : Docker Desktop n'a pas demarre. Lance-le manuellement puis relance ce script." -ForegroundColor Red
        exit 1
    }
}
Write-Host "Docker OK" -ForegroundColor Green

# ---------- 2) Postgres + Redis ----------
Write-Host "`n[2/5] Conteneurs (Postgres + Redis)..." -ForegroundColor Yellow
if (-not (Test-Path $DOCKER_COMPOSE)) {
    Write-Host "docker-compose-v1 introuvable : $DOCKER_COMPOSE" -ForegroundColor Red
    exit 1
}
Push-Location $PALOVA_PATH
& $DOCKER_COMPOSE up -d 2>$null
Pop-Location

$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    try { docker exec palova_postgres_1 pg_isready -U palovauser 2>$null | Out-Null; if ($LASTEXITCODE -eq 0) { $ready = $true; break } } catch { }
    Start-Sleep -Seconds 1
}
if ($ready) { Write-Host "PostgreSQL OK" -ForegroundColor Green }
else { Write-Host "PostgreSQL : timeout (on continue quand meme)" -ForegroundColor Yellow }

# ---------- 3) Backend (port 3001) ----------
Write-Host "`n[3/5] Backend..." -ForegroundColor Yellow
if (-not (Test-DepsInstalled "$PALOVA_PATH\backend" "nodemon.cmd")) {
    Write-Host "node_modules absent ou incomplet (bin shims manquants) - npm install + prisma generate..." -ForegroundColor Yellow
    Push-Location "$PALOVA_PATH\backend"; npm install; npx prisma generate; Pop-Location
}
Stop-StaleStack
Stop-PortOwner 3001
Start-Hidden "$PALOVA_PATH\backend" "npm run dev" "$LOGS\backend.log"
Write-Host "Attente de http://localhost:3001/health (jusqu'a 60 s)..." -ForegroundColor Yellow
if (Wait-Http "http://localhost:3001/health" 60) {
    Write-Host "Backend OK" -ForegroundColor Green
} else {
    Write-Host "ECHEC : le backend ne repond pas. Regarde $LOGS\backend.log" -ForegroundColor Red
    exit 1
}

# ---------- 4) Frontend (port 3000, cache purge) ----------
Write-Host "`n[4/5] Frontend..." -ForegroundColor Yellow
if (-not (Test-DepsInstalled "$PALOVA_PATH\frontend" "next.cmd")) {
    Write-Host "node_modules absent ou incomplet (bin shims manquants) - npm install..." -ForegroundColor Yellow
    Push-Location "$PALOVA_PATH\frontend"; npm install; Pop-Location
}
Stop-PortOwner 3000
Start-Sleep -Seconds 2   # laisse le process tue relacher ses verrous sur .next
Push-Location "$PALOVA_PATH\frontend"
for ($i = 0; $i -lt 3; $i++) {
    node scripts\clean-next.mjs all
    if (-not (Test-Path .next)) { break }
    Start-Sleep -Seconds 2
}
if (Test-Path .next) { Write-Host ".next pas completement purge (fichiers verrouilles) - on continue" -ForegroundColor Yellow }
Pop-Location
Start-Hidden "$PALOVA_PATH\frontend" "npm run dev" "$LOGS\frontend.log"
Write-Host "Attente de http://localhost:3000 (jusqu'a 60 s)..." -ForegroundColor Yellow
if (Wait-Http "http://localhost:3000" 60) {
    Write-Host "Frontend OK" -ForegroundColor Green
} else {
    Write-Host "ECHEC : le frontend ne repond pas. Regarde $LOGS\frontend.log" -ForegroundColor Red
    exit 1
}

# ---------- 5) Prisma Studio (port 5555) ----------
Write-Host "`n[5/5] Prisma Studio..." -ForegroundColor Yellow
Stop-PortOwner 5555
Start-Hidden "$PALOVA_PATH\backend" "npx prisma studio --port 5555 --browser none" "$LOGS\studio.log"

# ---------- Recapitulatif ----------
Write-Host "`nTOUT EST PRET (serveurs en arriere-plan, aucune fenetre)" -ForegroundColor Green
Write-Host "Site club -> http://padel-arena-paris.localhost:3000" -ForegroundColor Gray
Write-Host "Backend   -> http://localhost:3001/health" -ForegroundColor Gray
Write-Host "Studio    -> http://localhost:5555" -ForegroundColor Gray
Write-Host "Logs      -> $LOGS\backend.log / frontend.log / studio.log" -ForegroundColor Gray
Write-Host "            (suivre en direct : Get-Content $LOGS\frontend.log -Tail 30 -Wait)" -ForegroundColor DarkGray
Write-Host "Arreter   -> .\start.ps1 -Stop" -ForegroundColor Gray
Write-Host ("=" * 60) -ForegroundColor Cyan
Start-Process "http://padel-arena-paris.localhost:3000"
