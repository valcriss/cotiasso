#!/usr/bin/env bash
# Teste scripts/install-token.sh avec un faux « docker » qui rejoue un journal Docker Compose réel : le jeton le plus
# récent est le seul affiché, et l'absence de jeton est expliquée.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
FAILED=0
check() { if [ "$2" = "ok" ]; then echo "  ok  $1"; else echo "  ÉCHEC  $1"; FAILED=1; fi; }

mkdir -p "$WORK/site/scripts" "$WORK/bin"
cp "$ROOT/scripts/install-token.sh" "$WORK/site/scripts/install-token.sh"
cat > "$WORK/bin/docker" <<'STUB'
#!/usr/bin/env bash
case "$*" in
  *"logs"*)
    if [ "${NO_TOKEN:-}" = "1" ]; then echo "api-1  | [Nest] 1  - 11/03/2026, 6:00:00 AM     LOG [NestApplication] Nest application successfully started"; exit 0; fi
    cat <<'LOG'
api-1  | [Nest] 1  - 11/03/2026, 6:00:00 AM    WARN [SetupService]
api-1  | ============================================================
api-1  |  Installation requise : aucun compte n'existe.
api-1  |  Jeton d'installation (à usage unique, à saisir dans l'assistant) :
api-1  |  ancienJetonAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
api-1  | ============================================================
api-1  | [Nest] 1  - 11/03/2026, 6:05:00 AM    WARN [SetupService]
api-1  | ============================================================
api-1  |  Installation requise : aucun compte n'existe.
api-1  |  Jeton d'installation (à usage unique, à saisir dans l'assistant) :
api-1  |  nouveauJeton_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB
api-1  | ============================================================
LOG
    ;;
esac
STUB
chmod +x "$WORK/bin/docker"
run() { (cd "$WORK/site" && PATH="$WORK/bin:$PATH" "$@" bash scripts/install-token.sh >"$WORK/out.log" 2>"$WORK/err.log"); }

echo "Jeton présent : seul le plus récent est affiché, sans autre texte"
run env; rc=$?
check "code de sortie 0" "$([ $rc -eq 0 ] && echo ok || echo no)"
check "jeton le plus récent" "$([ "$(cat "$WORK/out.log")" = "nouveauJeton_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB" ] && echo ok || echo no)"

echo "Aucun jeton : message explicatif et code de sortie 1"
run env NO_TOKEN=1; rc=$?
check "code de sortie 1" "$([ $rc -eq 1 ] && echo ok || echo no)"
check "rien sur la sortie standard" "$([ ! -s "$WORK/out.log" ] && echo ok || echo no)"
check "explication sur la sortie d'erreur" "$(grep -q 'Aucun jeton' "$WORK/err.log" && echo ok || echo no)"

[ $FAILED -eq 0 ] && echo "Tout est bon." || { echo "Des vérifications ont échoué."; exit 1; }
