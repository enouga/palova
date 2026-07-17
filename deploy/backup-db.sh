#!/usr/bin/env bash
# Sauvegarde quotidienne de la prod Palova — à lancer par cron sur la VM.
#
#   Postgres  : dump transactionnellement cohérent (format custom compressé)  → ÉCHEC DUR
#   Uploads   : archive des fichiers disque (avatars, photos club, affiches,
#               images de messagerie privée)                                  → best-effort
#
# Installation (une fois, sur la VM) :
#   chmod +x deploy/backup-db.sh
#   crontab -e   →   0 3 * * *  /root/palova/deploy/backup-db.sh >> /var/log/palova-backup.log 2>&1
#
# Voir docs/sauvegardes.md §3 pour le dispositif complet (hors-site, supervision, restore).
set -euo pipefail

# Répertoire du repo : dérivé de la position du script (robuste au chemin de clone).
PALOVA_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${PALOVA_DIR_BACKUPS:-/root/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
STAMP="$(date +%F-%H%M)"

COMPOSE="docker compose --env-file .env.prod -f docker-compose.prod.yml"

mkdir -p "$BACKUP_DIR"
cd "$PALOVA_DIR"

# ---------------------------------------------------------------------------
# 1. Postgres (CRITIQUE — un échec ici stoppe le script via set -e)
# ---------------------------------------------------------------------------
DB_FILE="$BACKUP_DIR/palova-$STAMP.dump"

# -T : pas de pseudo-TTY (indispensable en cron, sinon corruption du flux).
$COMPOSE exec -T postgres pg_dump -U palovauser -Fc palova > "$DB_FILE"

# Garde-fou : un dump anormalement petit = problème (base vide, conteneur HS…).
DB_SIZE="$(stat -c%s "$DB_FILE")"
if [ "$DB_SIZE" -lt 10000 ]; then
  echo "ERREUR : dump Postgres suspect ($DB_SIZE octets)" >&2
  exit 1
fi
echo "OK postgres $STAMP ($DB_SIZE octets)"

# ---------------------------------------------------------------------------
# 2. Uploads sur disque (best-effort — ne doit jamais faire échouer le dump DB)
#    Streamés depuis le conteneur backend (évite de dépendre du nom de volume
#    préfixé par le projet compose).
# ---------------------------------------------------------------------------
UP_FILE="$BACKUP_DIR/palova-uploads-$STAMP.tar.gz"
if $COMPOSE exec -T backend tar czf - -C /app uploads uploads-private > "$UP_FILE" 2>/dev/null; then
  UP_SIZE="$(stat -c%s "$UP_FILE")"
  echo "OK uploads $STAMP ($UP_SIZE octets)"
else
  echo "AVERTISSEMENT : sauvegarde des uploads échouée (dump Postgres OK)" >&2
  rm -f "$UP_FILE"
fi

# ---------------------------------------------------------------------------
# 3. Rotation locale
# ---------------------------------------------------------------------------
find "$BACKUP_DIR" -name 'palova-*.dump'        -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -name 'palova-uploads-*.tar.gz' -mtime +"$RETENTION_DAYS" -delete

# ---------------------------------------------------------------------------
# 4. Copie HORS SITE (le « 1 » du 3-2-1) — À ACTIVER une fois la destination choisie.
#    Décommenter l'une des options (voir docs/sauvegardes.md §3 niveau 3).
# ---------------------------------------------------------------------------
# Option A — Hetzner Storage Box (recommandée). Remplacer uXXXXXX par ton identifiant.
#   scp -P 23 "$DB_FILE" "$UP_FILE" uXXXXXX@uXXXXXX.your-storagebox.de:backups/
#
# Option B — S3 compatible (Backblaze B2, Scaleway…) via rclone préconfiguré :
#   rclone copy "$DB_FILE" remote:palova-backups/
#   rclone copy "$UP_FILE" remote:palova-backups/
#
# Chiffrement recommandé avant l'envoi (age) : voir le runbook §3.

# ---------------------------------------------------------------------------
# 5. Supervision (dead man's switch) — À ACTIVER une fois le check créé.
#    Prévient par e-mail si ce script cesse de tourner (cron cassé, erreur set -e).
# ---------------------------------------------------------------------------
# curl -fsS -m 10 https://hc-ping.com/<uuid-du-check> > /dev/null

echo "Terminé $STAMP"
