#!/usr/bin/env bash
# Teste scripts/update.sh avec un faux « docker » qui journalise ses appels : ordre des étapes, arrêt avant toute
# modification si la sauvegarde ou la vérification échoue, instructions de retour arrière.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
FAILED=0

check() { if [ "$2" = "ok" ]; then echo "  ok  $1"; else echo "  ÉCHEC  $1"; FAILED=1; fi; }
contains() { grep -qF -- "$2" "$1" && echo ok || echo no; }

setup() {
  rm -rf "$WORK/site" "$WORK/bin" "$WORK/calls.log"
  mkdir -p "$WORK/site/scripts" "$WORK/bin"
  cp "$ROOT/scripts/update.sh" "$WORK/site/scripts/update.sh"
  printf 'POSTGRES_PASSWORD=secret\nCOTIASSO_VERSION=1.0.0\nBACKUP_PASSPHRASE=p\n' > "$WORK/site/.env.prod"
  cat > "$WORK/bin/docker" <<'STUB'
#!/usr/bin/env bash
echo "docker $*" >> "$CALLS"
case "$*" in
  *"backup.sh once"*) [ "${FAIL_STEP:-}" = "backup" ] && exit 1 ;;
  *"backup.sh list"*) echo "cotiasso-20261110T010000Z.tar.enc  1234 octets"; exit 0 ;;
  *"tools verify"*) [ "${FAIL_STEP:-}" = "verify" ] && exit 1 ;;
  *"up -d"*) [ "${FAIL_STEP:-}" = "up" ] && exit 1 ;;
esac
exit 0
STUB
  chmod +x "$WORK/bin/docker"
}

run() { (cd "$WORK/site" && CALLS="$WORK/calls.log" PATH="$WORK/bin:$PATH" bash scripts/update.sh "$@" >"$WORK/out.log" 2>"$WORK/err.log"); }
version() { sed -n 's/^COTIASSO_VERSION=//p' "$WORK/site/.env.prod"; }

echo "Mise à jour réussie"
setup; run 1.1.0 --yes; rc=$?
check "code de sortie 0" "$([ $rc -eq 0 ] && echo ok || echo no)"
check "version changée" "$([ "$(version)" = "1.1.0" ] && echo ok || echo no)"
check "ancien fichier conservé" "$([ -f "$WORK/site/.env.prod.avant-1.1.0" ] && grep -q 'COTIASSO_VERSION=1.0.0' "$WORK/site/.env.prod.avant-1.1.0" && echo ok || echo no)"
check "fichier de configuration non lisible par les autres" "$([ "$(stat -c %a "$WORK/site/.env.prod.avant-1.1.0")" = "600" ] && echo ok || echo no)"
check "ordre : sauvegarde, vérification, démarrage" "$([ "$(grep -n 'backup.sh once' "$WORK/calls.log" | cut -d: -f1)" -lt "$(grep -n 'tools verify' "$WORK/calls.log" | cut -d: -f1)" ] && [ "$(grep -n 'tools verify' "$WORK/calls.log" | cut -d: -f1)" -lt "$(grep -n 'up -d' "$WORK/calls.log" | cut -d: -f1)" ] && echo ok || echo no)"
check "vérifie l'archive qui vient d'être créée" "$(contains "$WORK/calls.log" 'tools verify cotiasso-20261110T010000Z.tar.enc')"

echo "Échec de la sauvegarde : rien n'est modifié"
setup; FAIL_STEP=backup run 1.1.0 --yes; rc=$?
check "code de sortie non nul" "$([ $rc -ne 0 ] && echo ok || echo no)"
check "version inchangée" "$([ "$(version)" = "1.0.0" ] && echo ok || echo no)"
check "aucun démarrage" "$(contains "$WORK/calls.log" 'up -d' | sed 's/ok/no/;t;s/no/ok/')"
check "message clair" "$(contains "$WORK/err.log" 'Rien n'"'"'a été modifié')"

echo "Échec de la vérification : rien n'est modifié"
setup; FAIL_STEP=verify run 1.1.0 --yes; rc=$?
check "code de sortie non nul" "$([ $rc -ne 0 ] && echo ok || echo no)"
check "version inchangée" "$([ "$(version)" = "1.0.0" ] && echo ok || echo no)"
check "aucun démarrage" "$(contains "$WORK/calls.log" 'up -d' | sed 's/ok/no/;t;s/no/ok/')"

echo "Échec du démarrage : instructions de retour arrière"
setup; FAIL_STEP=up run 1.1.0 --yes; rc=$?
check "code de sortie non nul" "$([ $rc -ne 0 ] && echo ok || echo no)"
check "indique l'archive de sécurité" "$(contains "$WORK/err.log" 'tools restore cotiasso-20261110T010000Z.tar.enc')"
check "indique la confirmation de restauration" "$(contains "$WORK/err.log" 'CONFIRM_RESTORE=yes')"

echo "Entrées invalides"
setup; run '1.1.0;rm -rf /' --yes; rc=$?
check "version dangereuse refusée" "$([ $rc -ne 0 ] && [ ! -s "$WORK/calls.log" ] && echo ok || echo no)"
setup; run 1.0.0 --yes; rc=$?
check "même version refusée" "$([ $rc -ne 0 ] && [ ! -s "$WORK/calls.log" ] && echo ok || echo no)"
setup; run --yes; rc=$?
check "version absente refusée" "$([ $rc -ne 0 ] && echo ok || echo no)"
setup; rm "$WORK/site/.env.prod"; run 1.1.0 --yes; rc=$?
check "fichier de configuration absent refusé" "$([ $rc -ne 0 ] && echo ok || echo no)"

echo "Confirmation refusée"
setup; (cd "$WORK/site" && echo n | CALLS="$WORK/calls.log" PATH="$WORK/bin:$PATH" bash scripts/update.sh 1.1.0 >/dev/null 2>&1); rc=$?
check "rien n'est lancé" "$([ $rc -ne 0 ] && [ ! -s "$WORK/calls.log" ] && [ "$(version)" = "1.0.0" ] && echo ok || echo no)"

[ $FAILED -eq 0 ] && echo "Tous les contrôles réussissent." || { echo "Des contrôles échouent."; exit 1; }
