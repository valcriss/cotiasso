#!/usr/bin/env bash
# Sauvegarde, restauration et vérification d'une installation cotiasso.
#
#   backup.sh run               boucle de sauvegarde planifiée (service « backup »)
#   backup.sh once              une sauvegarde immédiate
#   backup.sh list              liste les sauvegardes
#   backup.sh verify [fichier]  restaure dans une base et un dossier TEMPORAIRES et compare les comptages
#   backup.sh restore fichier   restaure l'installation (exige CONFIRM_RESTORE=yes, API arrêtée)
#
# Une sauvegarde est une archive chiffrée (AES-256) contenant : la base (pg_dump), les documents et un manifeste.
# Ordre : base d'abord, puis fichiers. Les fichiers sont immuables une fois écrits (clés opaques, versions
# immuables) : un document déposé entre les deux étapes est simplement absent de la base sauvegardée, jamais l'inverse.
# La clé MFA_ENCRYPTION_KEY n'est PAS dans l'archive : elle se conserve séparément, et son empreinte figure au manifeste.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backups}"
DOCUMENTS_DIR="${DOCUMENTS_DIR:-/data/documents}"
BACKUP_INTERVAL_HOURS="${BACKUP_INTERVAL_HOURS:-24}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
BACKUP_KEEP_MIN="${BACKUP_KEEP_MIN:-7}"
export PGHOST="${PGHOST:-db}" PGUSER="${PGUSER:-cotiasso}" PGDATABASE="${PGDATABASE:-cotiasso}"
STATUS_FILE="$BACKUP_DIR/status.json"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "ERREUR : $*"; exit 1; }

require_passphrase() {
  [ -n "${BACKUP_PASSPHRASE:-}" ] || die "BACKUP_PASSPHRASE est obligatoire (phrase de passe de chiffrement, à conserver séparément)."
}

mfa_fingerprint() {
  if [ -n "${MFA_ENCRYPTION_KEY:-}" ]; then printf '%s' "$MFA_ENCRYPTION_KEY" | sha256sum | cut -c1-16; else printf 'inconnue'; fi
}

# Écrit le fichier d'état de façon atomique (lu par l'API et par l'écran d'exploitation).
write_status() {
  local success="$1" error="$2"
  local last_success
  last_success="$(sed -n 's/.*"lastSuccessAt": *"\([^"]*\)".*/\1/p' "$STATUS_FILE" 2>/dev/null || true)"
  [ "$success" = "yes" ] && last_success="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  local tmp="$STATUS_FILE.tmp"
  printf '{\n  "lastAttemptAt": "%s",\n  "lastSuccessAt": "%s",\n  "lastError": %s,\n  "intervalHours": %s,\n  "retentionDays": %s\n}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$last_success" \
    "$([ -n "$error" ] && printf '"%s"' "${error//\"/\'}" || printf 'null')" \
    "$BACKUP_INTERVAL_HOURS" "$BACKUP_RETENTION_DAYS" > "$tmp"
  mv "$tmp" "$STATUS_FILE"
}

# Nombre de lignes d'une table. Échoue si la requête échoue ou ne renvoie pas un entier : un comptage vide ou
# invalide ne doit JAMAIS finir dans un manifeste (une sauvegarde « réussie » mais invalide serait pire qu'un échec).
count() {
  local value
  value="$(psql -tA -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM \"$1\"" "${2:-$PGDATABASE}")" || die "Comptage impossible sur la table $1."
  [[ "$value" =~ ^[0-9]+$ ]] || die "Comptage invalide pour la table $1 : « $value »."
  printf '%s' "$value"
}

# Attend que l'API ait créé le schéma (migrations appliquées au démarrage) avant de sauvegarder.
wait_for_schema() {
  until [ "$(psql -tA -c "SELECT to_regclass('\"User\"') IS NOT NULL" 2>/dev/null)" = "t" ]; do
    log "En attente du schéma de la base (migrations de l'API)…"
    sleep 5
  done
}

# Corps en sous-shell : le nettoyage à la sortie (trap EXIT) ne concerne que cette sauvegarde, et un échec (die) ne tue pas le planificateur.
do_backup() (
  require_passphrase
  mkdir -p "$BACKUP_DIR"
  local stamp name work
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  name="cotiasso-$stamp"
  work="$(mktemp -d)"
  trap 'rm -rf "$work"' EXIT

  log "Sauvegarde de la base…"
  pg_dump --format=custom --no-owner --file="$work/db.dump"

  log "Archivage des documents…"
  mkdir -p "$DOCUMENTS_DIR"
  tar -C "$DOCUMENTS_DIR" -cf "$work/documents.tar" .

  # Comptages calculés avant d'écrire le manifeste : un échec ici interrompt la sauvegarde (les substitutions
  # placées dans un document « heredoc » ne feraient pas échouer le script).
  local migrations users documents versions events
  migrations="$(psql -tA -v ON_ERROR_STOP=1 -c 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL')"
  [[ "$migrations" =~ ^[0-9]+$ ]] || die "Lecture des migrations impossible."
  users="$(count User)"
  documents="$(count Document)"
  versions="$(count DocumentVersion)"
  events="$(count AuditEvent)"

  cat > "$work/manifest.json" <<EOF
{
  "format": 1,
  "name": "$name",
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "appVersion": "${COTIASSO_VERSION:-inconnue}",
  "migrations": $migrations,
  "mfaKeyFingerprint": "$(mfa_fingerprint)",
  "counts": {
    "users": $users,
    "documents": $documents,
    "documentVersions": $versions,
    "auditEvents": $events
  },
  "sha256": {
    "db.dump": "$(sha256sum "$work/db.dump" | cut -d' ' -f1)",
    "documents.tar": "$(sha256sum "$work/documents.tar" | cut -d' ' -f1)"
  }
}
EOF

  log "Chiffrement…"
  tar -C "$work" -cf - db.dump documents.tar manifest.json \
    | openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -pass env:BACKUP_PASSPHRASE -out "$BACKUP_DIR/$name.tar.enc.partial"
  mv "$BACKUP_DIR/$name.tar.enc.partial" "$BACKUP_DIR/$name.tar.enc"

  # Manifeste en clair à côté de l'archive : comptages et versions, aucun secret. Il sert à la liste et au contrôle d'intégrité.
  sed "s|\"format\": 1,|\"format\": 1,\n  \"archiveSha256\": \"$(sha256sum "$BACKUP_DIR/$name.tar.enc" | cut -d' ' -f1)\",\n  \"archiveBytes\": $(wc -c < "$BACKUP_DIR/$name.tar.enc" | tr -d ' '),|" \
    "$work/manifest.json" > "$BACKUP_DIR/$name.manifest.json"

  log "Sauvegarde terminée : $name.tar.enc"
)

apply_retention() {
  # Supprime les sauvegardes plus anciennes que la rétention, en gardant toujours les BACKUP_KEEP_MIN plus récentes.
  local total=0 kept=0 file
  total="$(find "$BACKUP_DIR" -maxdepth 1 -name 'cotiasso-*.tar.enc' | wc -l | tr -d ' ')"
  [ "$total" -gt "$BACKUP_KEEP_MIN" ] || return 0
  while IFS= read -r file; do
    kept=$((kept + 1))
    [ "$kept" -le "$BACKUP_KEEP_MIN" ] && continue
    if [ -n "$(find "$file" -mtime +"$BACKUP_RETENTION_DAYS" -print 2>/dev/null)" ]; then
      log "Rétention : suppression de $(basename "$file")"
      rm -f "$file" "${file%.tar.enc}.manifest.json"
    fi
  done < <(find "$BACKUP_DIR" -maxdepth 1 -name 'cotiasso-*.tar.enc' | sort -r)
}

cmd_once() {
  mkdir -p "$BACKUP_DIR"
  if do_backup; then
    write_status yes ""
    apply_retention
  else
    write_status no "La sauvegarde a échoué (voir les journaux du service backup)."
    return 1
  fi
}

cmd_run() {
  log "Planification : une sauvegarde toutes les ${BACKUP_INTERVAL_HOURS} h, rétention ${BACKUP_RETENTION_DAYS} jours (minimum ${BACKUP_KEEP_MIN} conservées)."
  require_passphrase
  until pg_isready -q; do log "En attente de la base…"; sleep 3; done
  wait_for_schema
  while true; do
    # Un échec n'arrête pas la boucle : il est enregistré dans l'état et sera visible dans l'écran d'exploitation.
    (cmd_once) || log "La sauvegarde a échoué ; nouvelle tentative au prochain cycle."
    sleep "$((BACKUP_INTERVAL_HOURS * 3600))"
  done
}

cmd_list() {
  ls -1 "$BACKUP_DIR"/cotiasso-*.tar.enc 2>/dev/null | sort -r | while read -r f; do
    printf '%s  %s octets\n' "$(basename "$f")" "$(wc -c < "$f" | tr -d ' ')"
  done
}

latest_backup() { ls -1 "$BACKUP_DIR"/cotiasso-*.tar.enc 2>/dev/null | sort -r | head -n 1; }

# Déchiffre l'archive, contrôle le manifeste et les empreintes ; laisse le contenu dans le dossier donné.
unpack() {
  local file="$1" dest="$2"
  [ -f "$file" ] || die "Archive introuvable : $file"
  require_passphrase
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass env:BACKUP_PASSPHRASE -in "$file" | tar -C "$dest" -xf - \
    || die "Déchiffrement impossible : phrase de passe incorrecte ou archive altérée."
  for part in db.dump documents.tar; do
    local expected actual
    expected="$(sed -n "s/.*\"$part\": *\"\\([0-9a-f]*\\)\".*/\\1/p" "$dest/manifest.json")"
    actual="$(sha256sum "$dest/$part" | cut -d' ' -f1)"
    [ -n "$expected" ] && [ "$expected" = "$actual" ] || die "Empreinte invalide pour $part : l'archive est corrompue."
  done
  local fingerprint
  fingerprint="$(sed -n 's/.*"mfaKeyFingerprint": *"\([^"]*\)".*/\1/p' "$dest/manifest.json")"
  if [ "$fingerprint" != "$(mfa_fingerprint)" ]; then
    log "ATTENTION : la clé MFA_ENCRYPTION_KEY fournie ne correspond pas à celle de la sauvegarde. Les seconds facteurs seront illisibles (à réinitialiser par un administrateur)."
  fi
}

manifest_count() { sed -n "s/.*\"$1\": *\\([0-9]*\\).*/\\1/p" "$2/manifest.json" | head -n 1; }

compare_counts() {
  local work="$1" database="$2" ok=0
  for pair in users:User documents:Document documentVersions:DocumentVersion auditEvents:AuditEvent; do
    local key="${pair%%:*}" table="${pair##*:}" expected actual
    expected="$(manifest_count "$key" "$work")"
    actual="$(count "$table" "$database")"
    if [ "$expected" = "$actual" ]; then log "  $table : $actual (conforme)"; else log "  $table : attendu $expected, obtenu $actual"; ok=1; fi
  done
  return $ok
}

cmd_verify() (
  local file="${1:-$(latest_backup)}"
  [ -n "$file" ] || die "Aucune sauvegarde à vérifier."
  [ -f "$file" ] || file="$BACKUP_DIR/$file"
  local work scratch database
  work="$(mktemp -d)"; scratch="$(mktemp -d)"
  database="cotiasso_verify_$(date -u +%s)"
  trap 'dropdb --if-exists --force "$database" 2>/dev/null || true; rm -rf "$work" "$scratch"' EXIT

  log "Vérification de $(basename "$file") dans une base temporaire ($database)…"
  unpack "$file" "$work"
  createdb "$database"
  pg_restore --no-owner --dbname="$database" "$work/db.dump"
  tar -C "$scratch" -xf "$work/documents.tar"
  log "Documents restaurés : $(find "$scratch" -type f | wc -l | tr -d ' ') fichier(s)"
  compare_counts "$work" "$database" || die "Les comptages de la base restaurée ne correspondent pas au manifeste."
  log "Vérification réussie : l'archive est lisible et complète."
)

cmd_restore() (
  local file="${1:-}"
  [ -n "$file" ] || die "Usage : backup.sh restore <archive.tar.enc>"
  [ -f "$file" ] || file="$BACKUP_DIR/$file"
  [ "${CONFIRM_RESTORE:-}" = "yes" ] || die "Restauration destructive : elle remplace la base et les documents. Relancer avec CONFIRM_RESTORE=yes, API et web arrêtés."

  local work
  work="$(mktemp -d)"
  trap 'rm -rf "$work"' EXIT
  unpack "$file" "$work"

  log "Remplacement de la base…"
  dropdb --if-exists --force "$PGDATABASE"
  createdb "$PGDATABASE"
  pg_restore --no-owner --dbname="$PGDATABASE" "$work/db.dump"

  log "Remplacement des documents…"
  mkdir -p "$DOCUMENTS_DIR"
  find "$DOCUMENTS_DIR" -mindepth 1 -delete
  tar -C "$DOCUMENTS_DIR" -xf "$work/documents.tar"

  compare_counts "$work" "$PGDATABASE" || die "Les comptages de la base restaurée ne correspondent pas au manifeste."
  log "Restauration terminée. Redémarrer l'API et le web, puis vérifier le journal d'audit (Paramètres, Journal d'audit)."
)

case "${1:-}" in
  run) cmd_run ;;
  once) cmd_once ;;
  list) cmd_list ;;
  verify) shift; cmd_verify "${1:-}" ;;
  restore) shift; cmd_restore "${1:-}" ;;
  *) echo "Usage : backup.sh {run|once|list|verify [archive]|restore archive}" >&2; exit 2 ;;
esac
