# Sauvegarde manuelle de la base Postgres de DEV (Docker Desktop).
# A lancer avant une migration risquee ou un gros refactor.
# Les dumps vont dans %USERPROFILE%\palova-backups (hors du repo/OneDrive).
# Voir docs/sauvegardes.md section 2.

$BACKUP_DIR = "$env:USERPROFILE\palova-backups"
New-Item -ItemType Directory -Force $BACKUP_DIR | Out-Null
$stamp = Get-Date -Format 'yyyy-MM-dd-HHmm'
$file = "$BACKUP_DIR\palova-dev-$stamp.dump"

# -Fc = format custom compresse (restaurable table par table avec pg_restore)
docker exec palova_postgres_1 pg_dump -U palovauser -Fc palova > $file

if ($LASTEXITCODE -eq 0) {
    Write-Host "Sauvegarde OK -> $file" -ForegroundColor Green
    # Rotation : ne garder que les 10 derniers dumps
    Get-ChildItem $BACKUP_DIR -Filter 'palova-dev-*.dump' |
        Sort-Object LastWriteTime -Descending |
        Select-Object -Skip 10 |
        Remove-Item -Confirm:$false
} else {
    Write-Host "ECHEC de la sauvegarde (conteneur demarre ?)" -ForegroundColor Red
    Remove-Item $file -ErrorAction SilentlyContinue
}
