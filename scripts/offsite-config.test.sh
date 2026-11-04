#!/usr/bin/env bash
# Teste la traduction des variables OFFSITE_* en configuration rclone (docker/backup.sh, fonction offsite_configure) :
# toutes les clés prévues sont transmises, y compris le jeton JSON d'un service OAuth comme Dropbox, intact.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FAILED=0
check() { if [ "$2" = "ok" ]; then echo "  ok  $1"; else echo "  ÉCHEC  $1"; FAILED=1; fi; }

# On ne charge que la fonction à tester : backup.sh n'est pas faite pour être « sourcée ».
FUNCTION="$(awk '/^offsite_configure\(\) \{/{on=1} on{print} on&&/^\}/{exit}' "$ROOT/docker/backup.sh")"
[ -n "$FUNCTION" ] || { echo "  ÉCHEC  fonction offsite_configure introuvable"; exit 1; }

run() { # variables d'environnement passées par l'appelant ; affiche la configuration rclone obtenue
  ( eval "$FUNCTION"; offsite_configure && env | grep '^RCLONE_CONFIG' | sort )
}

TOKEN='{"access_token":"sl.abc-DEF_123","token_type":"bearer","refresh_token":"ref$resh","expiry":"2026-11-04T10:00:00.1+01:00"}'

echo "Dropbox : type, jeton JSON, identifiants d'application"
out="$(OFFSITE_TYPE=dropbox OFFSITE_PATH=cotiasso OFFSITE_TOKEN="$TOKEN" OFFSITE_CLIENT_ID=cid OFFSITE_CLIENT_SECRET=csecret run)"
echo "$out" | grep -qxF "RCLONE_CONFIG_OFFSITE_TYPE=dropbox" && check "type transmis" ok || check "type transmis" ko
echo "$out" | grep -qxF "RCLONE_CONFIG_OFFSITE_TOKEN=$TOKEN" && check "jeton JSON transmis à l'identique" ok || check "jeton JSON transmis à l'identique" ko
echo "$out" | grep -qxF "RCLONE_CONFIG_OFFSITE_CLIENT_ID=cid" && check "client_id transmis" ok || check "client_id transmis" ko
echo "$out" | grep -qxF "RCLONE_CONFIG_OFFSITE_CLIENT_SECRET=csecret" && check "client_secret transmis" ok || check "client_secret transmis" ko
echo "$out" | grep -qxF "RCLONE_CONFIG=/dev/null" && check "aucun fichier de configuration lu ni écrit" ok || check "aucun fichier de configuration lu ni écrit" ko

echo "Clés vides : rien n'est exporté"
out="$(OFFSITE_TYPE=dropbox OFFSITE_PATH=cotiasso OFFSITE_TOKEN= run)"
echo "$out" | grep -q "OFFSITE_TOKEN" && check "un jeton vide n'est pas transmis" ko || check "un jeton vide n'est pas transmis" ok

echo "S3 : les clés existantes restent transmises"
out="$(OFFSITE_TYPE=s3 OFFSITE_PATH=bucket/x OFFSITE_PROVIDER=Other OFFSITE_ENDPOINT=https://s3.test OFFSITE_ACCESS_KEY_ID=ak OFFSITE_SECRET_ACCESS_KEY=sk run)"
for expected in RCLONE_CONFIG_OFFSITE_PROVIDER=Other RCLONE_CONFIG_OFFSITE_ENDPOINT=https://s3.test RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID=ak RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY=sk; do
  echo "$out" | grep -qxF "$expected" && check "$expected" ok || check "$expected" ko
done

echo "Configuration incomplète : refusée"
( eval "$FUNCTION"; OFFSITE_TYPE=dropbox offsite_configure ) && check "sans OFFSITE_PATH" ko || check "sans OFFSITE_PATH" ok

exit "$FAILED"
