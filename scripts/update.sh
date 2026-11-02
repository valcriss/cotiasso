#!/usr/bin/env bash
# Met à jour une installation cotiasso vers une nouvelle version, en SAUVEGARDANT et VÉRIFIANT d'abord.
#
#   ./scripts/update.sh <nouvelle-version> [--env-file .env.prod] [--yes]
#
# Avant de lancer : récupérer le code de la nouvelle version (git pull / git checkout), car l'image est construite
# depuis ce dossier. Le script s'arrête AVANT toute modification si la sauvegarde ou sa vérification échoue : rien n'est
# alors changé. Les migrations de base de données ne sont pas réversibles ; pour revenir en arrière, on restaure la
# sauvegarde faite ici (la commande exacte est affichée).
set -euo pipefail

ENV_FILE=".env.prod"
ASSUME_YES="no"
VERSION=""

while [ $# -gt 0 ]; do
  case "$1" in
    --env-file) ENV_FILE="${2:?--env-file attend un chemin}"; shift 2 ;;
    --yes) ASSUME_YES="yes"; shift ;;
    -h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "Option inconnue : $1" >&2; exit 2 ;;
    *) [ -z "$VERSION" ] || { echo "Une seule version attendue." >&2; exit 2; }; VERSION="$1"; shift ;;
  esac
done

log() { printf '%s\n' "$*"; }
fail() { printf '\nERREUR : %s\n' "$*" >&2; exit 1; }

[ -n "$VERSION" ] || { echo "Usage : ./scripts/update.sh <nouvelle-version> [--env-file .env.prod] [--yes]" >&2; exit 2; }
[[ "$VERSION" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || fail "Version invalide : « $VERSION ». Utilisez des lettres, chiffres, points, tirets ou soulignés (ex. 1.2.0)."

cd "$(dirname "$0")/.."
[ -f "$ENV_FILE" ] || fail "Fichier de configuration introuvable : $ENV_FILE (copiez .env.prod.example et renseignez-le)."

compose() { docker compose --env-file "$ENV_FILE" "$@"; }

CURRENT="$(sed -n 's/^COTIASSO_VERSION=\(.*\)$/\1/p' "$ENV_FILE" | tail -n 1)"
[ -n "$CURRENT" ] || fail "COTIASSO_VERSION est absente de $ENV_FILE."
[ "$CURRENT" != "$VERSION" ] || fail "L'installation est déjà en version $VERSION."

log "Mise à jour : $CURRENT → $VERSION"
log "Étapes : 1) sauvegarde  2) vérification par restauration en base temporaire  3) changement de version  4) redémarrage."
log "Rien n'est modifié tant que les étapes 1 et 2 n'ont pas réussi."
if [ "$ASSUME_YES" != "yes" ]; then
  read -r -p "Continuer ? [o/N] " answer
  case "$answer" in o|O|oui|OUI|y|Y|yes) ;; *) log "Abandon : rien n'a été modifié."; exit 1 ;; esac
fi

log ""
log "1/4 Sauvegarde…"
compose exec -T backup /usr/local/bin/backup.sh once \
  || fail "La sauvegarde a échoué. Rien n'a été modifié : la version reste $CURRENT. Consultez : docker compose logs backup"

ARCHIVE="$(compose exec -T backup /usr/local/bin/backup.sh list | head -n 1 | awk '{print $1}')"
[ -n "$ARCHIVE" ] || fail "Aucune archive trouvée après la sauvegarde. Rien n'a été modifié."

log ""
log "2/4 Vérification de $ARCHIVE (restauration dans une base temporaire)…"
compose --profile tools run --rm tools verify "$ARCHIVE" \
  || fail "La vérification de la sauvegarde a échoué : elle ne prouve pas qu'on saurait restaurer. Rien n'a été modifié : la version reste $CURRENT."

log ""
log "3/4 Changement de version dans $ENV_FILE (copie de l'ancien fichier : $ENV_FILE.avant-$VERSION)…"
( umask 077; cp "$ENV_FILE" "$ENV_FILE.avant-$VERSION" )
TMP="$ENV_FILE.tmp"
( umask 077; sed "s/^COTIASSO_VERSION=.*/COTIASSO_VERSION=$VERSION/" "$ENV_FILE" > "$TMP" )
mv "$TMP" "$ENV_FILE"

log ""
log "4/4 Construction et redémarrage (les migrations s'appliquent au démarrage de l'API)…"
if ! compose up -d --build --wait --wait-timeout 300; then
  cat >&2 <<MSG

ERREUR : le démarrage de la version $VERSION a échoué.
Pour revenir à la version $CURRENT avec les données d'avant la mise à jour (les migrations ne sont pas réversibles) :

  docker compose --env-file $ENV_FILE stop api web
  cp $ENV_FILE.avant-$VERSION $ENV_FILE
  CONFIRM_RESTORE=yes docker compose --env-file $ENV_FILE --profile tools run --rm tools restore $ARCHIVE
  docker compose --env-file $ENV_FILE up -d --build

Sauvegarde utilisée : $ARCHIVE
MSG
  exit 1
fi

log ""
log "Mise à jour terminée : $CURRENT → $VERSION."
log "Contrôlez la version et l'état dans Paramètres › Exploitation, puis la chaîne du Journal d'audit."
log "Sauvegarde de sécurité conservée : $ARCHIVE (et $ENV_FILE.avant-$VERSION pour revenir en arrière)."
