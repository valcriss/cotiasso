#!/usr/bin/env bash
# Affiche le jeton d'installation (à usage unique) écrit dans les journaux de l'API au démarrage.
#
#   ./scripts/install-token.sh [--env-file .env.prod]
#
# À lancer depuis le dossier du docker-compose.yml. Le jeton le plus récent est le bon : chaque redémarrage de l'API en
# remplace un inutilisé. Le script n'affiche RIEN d'autre que le jeton (pratique pour le copier) et ne le garde nulle part.
# Si aucun jeton n'apparaît, c'est que l'installation est déjà faite, ou que l'API n'a pas encore démarré.
set -euo pipefail

ENV_FILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --env-file) ENV_FILE="${2:?--env-file attend un chemin}"; shift 2 ;;
    -h|--help) sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Option inconnue : $1" >&2; exit 2 ;;
  esac
done

cd "$(dirname "$0")/.."
compose() { if [ -n "$ENV_FILE" ]; then docker compose --env-file "$ENV_FILE" "$@"; else docker compose "$@"; fi; }

# Le journal contient, sur la ligne qui suit « Jeton d'installation », le jeton précédé du préfixe de Docker Compose.
TOKEN="$(compose logs --no-color api 2>/dev/null | grep -A1 "Jeton d'installation" | grep -v "Jeton d'installation" | grep -v '^--$' | awk '{print $NF}' | tail -n 1)" || true

if [ -z "$TOKEN" ]; then
  echo "Aucun jeton d'installation trouvé dans les journaux de l'API." >&2
  echo "Si le premier compte existe déjà, il n'y a plus de jeton : c'est normal. Sinon, redémarrez l'API (docker compose restart api) et relancez ce script." >&2
  exit 1
fi
printf '%s\n' "$TOKEN"
