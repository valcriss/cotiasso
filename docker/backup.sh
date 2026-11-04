#!/usr/bin/env bash
# Sauvegarde, restauration et vérification d'une installation cotiasso.
#
#   backup.sh run               boucle de sauvegarde planifiée (service « backup »)
#   backup.sh once              une sauvegarde immédiate
#   backup.sh list              liste les sauvegardes
#   backup.sh verify [fichier]  restaure temporairement, compare les comptages et les empreintes des pièces
#   backup.sh restore fichier   restaure l'installation (exige CONFIRM_RESTORE=yes, API arrêtée)
#   backup.sh offsite           copie les sauvegardes vers le stockage hors site (rclone), si configuré
#
# Une sauvegarde est une archive chiffrée (AES-256) contenant : la base (pg_dump), les documents et un manifeste.
# Ordre : base d'abord, puis fichiers. Les pièces référencées par la copie de la base sont contrôlées avant publication.
# La clé MFA_ENCRYPTION_KEY n'est PAS dans l'archive : elle se conserve séparément, et son empreinte figure au manifeste.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backups}"
DOCUMENTS_DIR="${DOCUMENTS_DIR:-/data/documents}"
BACKUP_INTERVAL_HOURS="${BACKUP_INTERVAL_HOURS:-24}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
BACKUP_KEEP_MIN="${BACKUP_KEEP_MIN:-7}"
export PGHOST="${PGHOST:-db}" PGUSER="${PGUSER:-cotiasso}" PGDATABASE="${PGDATABASE:-cotiasso}"
STATUS_FILE="$BACKUP_DIR/status.json"
OFFSITE_STATUS_FILE="$BACKUP_DIR/offsite.json"

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
  local stamp name work database
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  name="cotiasso-$stamp"
  work="$(mktemp -d)"
  database="cotiasso_backup_${work##*.}"
  trap 'dropdb --if-exists --force "$database" 2>/dev/null || true; rm -rf "$work"; rm -f "$BACKUP_DIR/$name.tar.enc.partial"' EXIT

  log "Sauvegarde de la base…"
  pg_dump --format=custom --no-owner --file="$work/db.dump"

  log "Archivage des documents…"
  mkdir -p "$DOCUMENTS_DIR"
  tar -C "$DOCUMENTS_DIR" -cf "$work/documents.tar" .
  createdb "$database"
  pg_restore --exit-on-error --no-owner --dbname="$database" "$work/db.dump"
  mkdir "$work/documents"
  tar -C "$work/documents" -xf "$work/documents.tar"
  verify_documents "$database" "$work/documents"

  # Comptages calculés avant d'écrire le manifeste : un échec ici interrompt la sauvegarde (les substitutions
  # placées dans un document « heredoc » ne feraient pas échouer le script).
  local migrations users documents versions events
  migrations="$(psql -tA -v ON_ERROR_STOP=1 -c 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL' "$database")"
  [[ "$migrations" =~ ^[0-9]+$ ]] || die "Lecture des migrations impossible."
  users="$(count User "$database")"
  documents="$(count Document "$database")"
  versions="$(count DocumentVersion "$database")"
  events="$(count AuditEvent "$database")"

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

# ---------- Copie hors site ----------
# Les archives sont DÉJÀ chiffrées (AES-256) : seules des archives chiffrées quittent le serveur. La configuration est
# déclarative, par variables d'environnement : OFFSITE_TYPE (s3, sftp, webdav, local…), OFFSITE_PATH (dossier ou bucket
# distant) et les paramètres du type choisi (OFFSITE_PROVIDER, OFFSITE_ENDPOINT, OFFSITE_REGION, OFFSITE_ACCESS_KEY_ID,
# OFFSITE_SECRET_ACCESS_KEY, OFFSITE_HOST, OFFSITE_PORT, OFFSITE_USER, OFFSITE_PASS, OFFSITE_URL, OFFSITE_VENDOR, et pour
# les services à connexion OAuth comme Dropbox : OFFSITE_TOKEN (le jeton JSON de « rclone config show »), OFFSITE_CLIENT_ID,
# OFFSITE_CLIENT_SECRET).
# On COPIE sans jamais supprimer côté distant : une erreur locale ne peut pas effacer la copie de secours. La durée de
# conservation distante se règle chez l'hébergeur du stockage (règle de cycle de vie).
offsite_enabled() { [ -n "${OFFSITE_TYPE:-}" ] || [ -n "${OFFSITE_PATH:-}" ]; }

offsite_configure() {
  [ -n "${OFFSITE_TYPE:-}" ] && [ -n "${OFFSITE_PATH:-}" ] || return 1
  export RCLONE_CONFIG_OFFSITE_TYPE="$OFFSITE_TYPE"
  local key value
  for key in PROVIDER ENDPOINT REGION ACCESS_KEY_ID SECRET_ACCESS_KEY HOST PORT USER PASS URL VENDOR TOKEN CLIENT_ID CLIENT_SECRET; do
    value="$(eval "printf '%s' \"\${OFFSITE_$key:-}\"")"
    [ -z "$value" ] || export "RCLONE_CONFIG_OFFSITE_$key=$value"
  done
  export RCLONE_CONFIG=/dev/null
}

# Écrit l'état de la copie hors site, lu par l'API (écran Exploitation). Le dernier succès est conservé d'un cycle à l'autre.
write_offsite_status() {
  local success="$1" error="$2" last_success
  last_success="$(sed -n 's/.*"lastSuccessAt": *"\([^"]*\)".*/\1/p' "$OFFSITE_STATUS_FILE" 2>/dev/null || true)"
  [ "$success" = "yes" ] && last_success="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  local tmp="$OFFSITE_STATUS_FILE.tmp"
  printf '{\n  "lastAttemptAt": "%s",\n  "lastSuccessAt": "%s",\n  "lastError": %s,\n  "target": "%s"\n}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$last_success" \
    "$([ -n "$error" ] && printf '"%s"' "${error//\"/\'}" || printf 'null')" \
    "${OFFSITE_TYPE:-}:${OFFSITE_PATH:-}" > "$tmp"
  mv "$tmp" "$OFFSITE_STATUS_FILE"
}

# Un échec de la copie ne fait jamais échouer la sauvegarde locale : il est enregistré et visible dans l'écran d'exploitation.
cmd_offsite() {
  offsite_enabled || { log "Copie hors site non configurée (OFFSITE_TYPE et OFFSITE_PATH)."; return 0; }
  mkdir -p "$BACKUP_DIR"
  if ! offsite_configure; then
    write_offsite_status no "Configuration incomplète : OFFSITE_TYPE et OFFSITE_PATH sont tous deux nécessaires."
    log "ERREUR : configuration de la copie hors site incomplète."
    return 1
  fi
  log "Copie hors site vers ${OFFSITE_TYPE}:${OFFSITE_PATH}…"
  # Archives d'abord, manifestes ensuite : un manifeste distant désigne toujours une archive déjà arrivée.
  if rclone copy "$BACKUP_DIR" "offsite:$OFFSITE_PATH" --include 'cotiasso-*.tar.enc' --retries 3 --low-level-retries 5 \
       && rclone copy "$BACKUP_DIR" "offsite:$OFFSITE_PATH" --include 'cotiasso-*.manifest.json' --retries 3; then
    write_offsite_status yes ""
    log "Copie hors site terminée."
  else
    write_offsite_status no "La copie hors site a échoué (voir les journaux du service backup)."
    log "ERREUR : la copie hors site a échoué."
    return 1
  fi
}

cmd_once() {
  mkdir -p "$BACKUP_DIR"
  # Le processus séparé garde errexit actif même si l'appelant teste le code de sortie.
  if bash "$0" create; then
    write_status yes ""
    apply_retention
    # Copie hors site : un échec est enregistré mais ne remet pas en cause la sauvegarde locale réussie.
    cmd_offsite || log "La copie hors site a échoué ; nouvelle tentative au prochain cycle."
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

verify_documents() {
  local database="$1" directory="$2" rows key expected actual
  rows="$(psql -tA -F '|' -v ON_ERROR_STOP=1 -c 'SELECT "storageKey", sha256 FROM "DocumentVersion"' "$database")" \
    || die "Impossible de lire les empreintes des documents."
  [ -n "$rows" ] || return 0
  while IFS='|' read -r key expected; do
    [[ "$key" =~ ^[0-9]{4}/[0-9]{2}/[0-9a-f-]{36}$ ]] || die "Clé de document invalide : $key."
    [ -f "$directory/$key" ] && [ ! -L "$directory/$key" ] || die "Document absent : $key."
    actual="$(sha256sum "$directory/$key" | cut -d' ' -f1)"
    [ "$actual" = "$expected" ] || die "Empreinte de document invalide : $key."
  done <<< "$rows"
}

cmd_verify() (
  local file="${1:-$(latest_backup)}"
  [ -n "$file" ] || die "Aucune sauvegarde à vérifier."
  [ -f "$file" ] || file="$BACKUP_DIR/$file"
  local work scratch database
  work="$(mktemp -d)"; scratch="$(mktemp -d)"
  database="cotiasso_verify_${work##*.}"
  trap 'dropdb --if-exists --force "$database" 2>/dev/null || true; rm -rf "$work" "$scratch"' EXIT

  log "Vérification de $(basename "$file") dans une base temporaire ($database)…"
  unpack "$file" "$work"
  createdb "$database"
  pg_restore --exit-on-error --no-owner --dbname="$database" "$work/db.dump"
  tar -C "$scratch" -xf "$work/documents.tar"
  verify_documents "$database" "$scratch"
  log "Documents restaurés : $(find "$scratch" -type f | wc -l | tr -d ' ') fichier(s)"
  compare_counts "$work" "$database" || die "Les comptages de la base restaurée ne correspondent pas au manifeste."
  log "Vérification réussie : l'archive est lisible et complète."
)

cmd_restore() (
  local file="${1:-}"
  [ -n "$file" ] || die "Usage : backup.sh restore <archive.tar.enc>"
  [ -f "$file" ] || file="$BACKUP_DIR/$file"
  [ "${CONFIRM_RESTORE:-}" = "yes" ] || die "Restauration destructive : elle remplace la base et les documents. Relancer avec CONFIRM_RESTORE=yes, API et web arrêtés."

  local work stage database previous item
  local -a moved_old=() moved_new=()
  local switched=no
  work="$(mktemp -d)"
  trap 'rm -rf "$work"' EXIT
  unpack "$file" "$work"

  mkdir -p "$DOCUMENTS_DIR"
  stage="$(mktemp -d "$DOCUMENTS_DIR/.restore.XXXXXXXX")"
  database="cotiasso_restore_${stage##*.}"
  previous="cotiasso_previous_${stage##*.}"
  cleanup_restore() {
    local result=$? item
    if [ "$switched" = no ]; then
      for item in "${moved_new[@]}"; do mv -- "$DOCUMENTS_DIR/$item" "$stage/new/" || return 1; done
      for item in "${moved_old[@]}"; do mv -- "$stage/old/$item" "$DOCUMENTS_DIR/" || return 1; done
      dropdb --if-exists --force "$database" 2>/dev/null || true
    fi
    rm -rf -- "$work" "$stage"
    return "$result"
  }
  trap cleanup_restore EXIT
  createdb "$database"
  pg_restore --exit-on-error --no-owner --dbname="$database" "$work/db.dump"
  mkdir "$stage/new" "$stage/old"
  tar -C "$stage/new" -xf "$work/documents.tar"
  verify_documents "$database" "$stage/new"
  compare_counts "$work" "$database" || die "Les comptages de la base restaurée ne correspondent pas au manifeste."

  shopt -s nullglob dotglob
  for item in "$DOCUMENTS_DIR"/*; do
    [ "$item" != "$stage" ] || continue
    mv -- "$item" "$stage/old/"
    moved_old+=("${item##*/}")
  done
  for item in "$stage/new"/*; do
    mv -- "$item" "$DOCUMENTS_DIR/"
    moved_new+=("${item##*/}")
  done

  psql -X -v ON_ERROR_STOP=1 --single-transaction -d postgres \
    -v live="$PGDATABASE" -v staged="$database" -v previous="$previous" <<'SQL'
ALTER DATABASE :"live" RENAME TO :"previous";
ALTER DATABASE :"staged" RENAME TO :"live";
SQL
  switched=yes
  dropdb --if-exists "$previous" || log "Ancienne base conservée : $previous."
  log "Restauration terminée. Redémarrer l'API et le web, puis vérifier le journal d'audit (Paramètres, Journal d'audit)."
)

case "${1:-}" in
  create) do_backup ;;
  run) cmd_run ;;
  once) cmd_once ;;
  list) cmd_list ;;
  verify) shift; cmd_verify "${1:-}" ;;
  restore) shift; cmd_restore "${1:-}" ;;
  offsite) cmd_offsite ;;
  *) echo "Usage : backup.sh {run|once|list|verify [archive]|restore archive|offsite}" >&2; exit 2 ;;
esac
