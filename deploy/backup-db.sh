#!/usr/bin/env bash
# Sauvegarde quotidienne de la prod Palova — à lancer par cron sur la VM.
#
#   Postgres  : dump transactionnellement cohérent (format custom compressé)  → ÉCHEC DUR
#   Uploads   : archive des fichiers disque (avatars, photos club, affiches,
#               images de messagerie privée)                                  → best-effort
#
# Options ACTIVÉES PAR VARIABLES D'ENV (lues depuis .env.prod à la racine du repo,
# ou héritées de l'environnement) — toutes VIDES par défaut = inactives.
# Il n'y a donc RIEN à décommenter sur la VM : on remplit une variable et ça s'active.
#   HC_PING_URL            supervision healthchecks.io (ping start / succès / échec)
#   OFFSITE_SCP_DEST       copie hors-site par scp  (ex. uXXXX@uXXXX.your-storagebox.de:backups/)
#   OFFSITE_SCP_PORT       port scp (défaut 23, adapté aux Storage Box Hetzner)
#   OFFSITE_RCLONE_REMOTE  copie hors-site par rclone (ex. remote:palova-backups/)
#   AGE_RECIPIENT          chiffrement age avant l'envoi hors-site (clé publique age1...)
#
# Installation (une fois, sur la VM) :
#   chmod +x deploy/backup-db.sh
#   crontab -e   →   0 3 * * *  /root/palova/deploy/backup-db.sh >> /var/log/palova-backup.log 2>&1
#
# Voir docs/sauvegardes.md §3 pour le dispositif complet (hors-site, supervision, restore).
set -Eeuo pipefail

# Répertoire du repo : dérivé de la position du script (robuste au chemin de clone).
PALOVA_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${PALOVA_DIR_BACKUPS:-/root/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
STAMP="$(date +%F-%H%M)"
ENV_FILE="$PALOVA_DIR/.env.prod"

COMPOSE="docker compose --env-file .env.prod -f docker-compose.prod.yml"

# ---------------------------------------------------------------------------
# Configuration optionnelle : priorité à l'environnement, repli sur .env.prod.
# NB : on lit les clés au grep (JAMAIS `source .env.prod`) — ce fichier suit la
# convention docker-compose du `$$` échappé, que bash interpréterait de travers.
# ---------------------------------------------------------------------------
read_env() {
  [ -f "$ENV_FILE" ] || return 0
  local v
  v="$(grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- || true)"
  v="${v%\"}"; v="${v#\"}"          # retire d'éventuels guillemets encadrants
  printf '%s' "$v"
}
HC_PING_URL="${HC_PING_URL:-$(read_env HC_PING_URL)}"
OFFSITE_SCP_DEST="${OFFSITE_SCP_DEST:-$(read_env OFFSITE_SCP_DEST)}"
OFFSITE_SCP_PORT="${OFFSITE_SCP_PORT:-$(read_env OFFSITE_SCP_PORT)}"; : "${OFFSITE_SCP_PORT:=23}"
OFFSITE_RCLONE_REMOTE="${OFFSITE_RCLONE_REMOTE:-$(read_env OFFSITE_RCLONE_REMOTE)}"
AGE_RECIPIENT="${AGE_RECIPIENT:-$(read_env AGE_RECIPIENT)}"

# ---------------------------------------------------------------------------
# Supervision (dead man's switch) — pings healthchecks.io si HC_PING_URL défini.
# Le trap EXIT garantit qu'un échec (set -e OU exit explicite) pinge /fail → alerte.
# ---------------------------------------------------------------------------
hc() { [ -n "$HC_PING_URL" ] && curl -fsS -m 10 "${HC_PING_URL}${1:-}" -o /dev/null || true; }
finish() {
  local code=$?
  if [ "$code" -eq 0 ]; then hc; else hc /fail; fi
}
trap finish EXIT
hc /start

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
find "$BACKUP_DIR" -name 'palova-*.dump'           -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -name 'palova-uploads-*.tar.gz'  -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -name 'palova-*.age'             -mtime +"$RETENTION_DAYS" -delete

# ---------------------------------------------------------------------------
# 4. Chiffrement optionnel (age) — actif seulement si AGE_RECIPIENT est défini.
#    Produit des copies .age transitoires ; la clé PRIVÉE vit au coffre, jamais
#    sur la VM (voir docs/sauvegardes.md §3 niveau 3 et §5).
# ---------------------------------------------------------------------------
SHIP_FILES=("$DB_FILE")
if [ -f "$UP_FILE" ]; then SHIP_FILES+=("$UP_FILE"); fi

if [ -n "$AGE_RECIPIENT" ]; then
  if command -v age >/dev/null 2>&1; then
    ENC_FILES=()
    for f in "${SHIP_FILES[@]}"; do
      if age -r "$AGE_RECIPIENT" -o "$f.age" "$f"; then
        ENC_FILES+=("$f.age")
      else
        echo "AVERTISSEMENT : chiffrement age échoué pour $(basename "$f")" >&2
      fi
    done
    SHIP_FILES=()
    if [ ${#ENC_FILES[@]} -gt 0 ]; then SHIP_FILES=("${ENC_FILES[@]}"); fi
  else
    echo "AVERTISSEMENT : AGE_RECIPIENT défini mais 'age' introuvable — envoi hors-site annulé" >&2
    SHIP_FILES=()
  fi
fi

# ---------------------------------------------------------------------------
# 5. Copie HORS SITE optionnelle (le « 1 » du 3-2-1) — best-effort.
#    scp (Storage Box Hetzner) OU rclone (S3/B2). Rien de défini = rien à faire.
# ---------------------------------------------------------------------------
if [ ${#SHIP_FILES[@]} -gt 0 ]; then
  if [ -n "$OFFSITE_SCP_DEST" ]; then
    if scp -P "$OFFSITE_SCP_PORT" "${SHIP_FILES[@]}" "$OFFSITE_SCP_DEST"; then
      echo "OK hors-site (scp) $STAMP -> $OFFSITE_SCP_DEST"
    else
      echo "AVERTISSEMENT : copie hors-site scp échouée" >&2
    fi
  elif [ -n "$OFFSITE_RCLONE_REMOTE" ]; then
    off_ok=1
    for f in "${SHIP_FILES[@]}"; do
      rclone copy "$f" "$OFFSITE_RCLONE_REMOTE" || off_ok=0
    done
    if [ "$off_ok" -eq 1 ]; then
      echo "OK hors-site (rclone) $STAMP -> $OFFSITE_RCLONE_REMOTE"
    else
      echo "AVERTISSEMENT : copie hors-site rclone échouée" >&2
    fi
  fi
fi

# Les .age sont transitoires (la copie locale conservée reste le .dump en clair).
if [ -n "$AGE_RECIPIENT" ]; then
  rm -f "$DB_FILE.age" "$UP_FILE.age" 2>/dev/null || true
fi

echo "Terminé $STAMP"
