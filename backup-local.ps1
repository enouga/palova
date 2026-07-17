# Sauvegarde manuelle de la base Postgres de DEV (Docker Desktop).
# A lancer avant une migration risquee ou un gros refactor.
# Les dumps vont dans %USERPROFILE%\palova-backups (hors du repo/OneDrive).
# Voir docs/sauvegardes.md section 2.

$BACKUP_DIR = "$env:USERPROFILE\palova-backups"
New-Item -ItemType Directory -Force $BACKUP_DIR | Out-Null
$stamp = Get-Date -Format 'yyyy-MM-dd-HHmm'
$file = "$BACKUP_DIR\palova-dev-$stamp.dump"

# -Fc = format custom compresse (restaurable table par table avec pg_restore)
# cmd /c pour la redirection : l'operateur `>` natif de PowerShell 5.1 fait
# transiter le stdout binaire de pg_dump par le pipeline objets/texte et le
# reencode en UTF-16 (BOM inclus) -> archive corrompue, invisible tant qu'on
# ne restaure pas (trouve via un test de restauration reel, audit pre-MEP
# 2026-07-17 SS1.1). cmd.exe redirige au niveau du handle de fichier, sans
# reinterpretation.
cmd /c "docker exec palova_postgres_1 pg_dump -U palovauser -Fc palova > `"$file`""

$validDump = $false
if ($LASTEXITCODE -eq 0 -and (Test-Path $file)) {
    # Garde-fou : une archive pg_dump valide commence par la signature "PGDMP".
    $stream = [System.IO.File]::OpenRead($file)
    $header = New-Object byte[] 5
    $stream.Read($header, 0, 5) | Out-Null
    $stream.Close()
    $validDump = ([System.Text.Encoding]::ASCII.GetString($header) -eq 'PGDMP')
}

if ($validDump) {
    Write-Host "Sauvegarde OK -> $file" -ForegroundColor Green
    # Rotation : ne garder que les 10 derniers dumps
    Get-ChildItem $BACKUP_DIR -Filter 'palova-dev-*.dump' |
        Sort-Object LastWriteTime -Descending |
        Select-Object -Skip 10 |
        Remove-Item -Confirm:$false
} else {
    Write-Host "ECHEC de la sauvegarde (conteneur demarre ? ou dump corrompu)" -ForegroundColor Red
    Remove-Item $file -ErrorAction SilentlyContinue
}
