#!/usr/bin/env bash
#
# Lance le projet Caisse.
#
#   ./script.sh            installe si besoin, puis ouvre l'atelier
#   ./script.sh demo       joue la chaîne complète en console et chronomètre
#   ./script.sh test       la suite de tests
#   ./script.sh verifier   pilote l'atelier dans un vrai navigateur
#
# Le seul prérequis non installable ici est le jeton Zoo : sans lui, rien de ce
# qui touche à Zoo ne peut tourner, et le script le dit tout de suite plutôt que
# de laisser découvrir l'erreur au premier appel.

set -euo pipefail
cd "$(dirname "$0")"

# 5174 : le configurateur BESS, premier projet du makeathon, occupe 5173.
PORT="${PORT:-5174}"
ACTION="${1:-atelier}"

bleu()  { printf '\033[1;34m%s\033[0m\n' "$*"; }
rouge() { printf '\033[1;31m%s\033[0m\n' "$*"; }
gris()  { printf '\033[2m%s\033[0m\n' "$*"; }

# ── Prérequis ────────────────────────────────────────────────────────────────

if ! command -v node >/dev/null 2>&1; then
  rouge "Node n'est pas installé. Node 20 ou plus est nécessaire."
  exit 1
fi

MAJEUR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$MAJEUR" -lt 20 ]; then
  rouge "Node $MAJEUR détecté, Node 20 minimum est nécessaire."
  exit 1
fi

if [ ! -d node_modules ]; then
  bleu "Installation des dépendances…"
  npm install --silent
fi

# ── Jeton Zoo ────────────────────────────────────────────────────────────────

if [ ! -f .env ] && [ -z "${ZOO_API_TOKEN:-}" ]; then
  cp .env.example .env
  rouge "Aucun jeton Zoo."
  gris  "Un .env vient d'être créé. Renseignez-y ZOO_API_TOKEN, obtenu sur"
  gris  "https://zoo.dev/account/api-tokens, puis relancez."
  gris  ""
  gris  "Sans jeton, le calcul d'emprise et les verdicts fonctionnent sur un"
  gris  "maillage déjà converti, mais ni la lecture d'un STEP ni la génération"
  gris  "de la caisse ne sont possibles : les deux sont chez Zoo."
  exit 1
fi

# ── Actions ──────────────────────────────────────────────────────────────────

case "$ACTION" in
  test)
    bleu "Tests"
    npm test
    ;;

  demo)
    # La chaîne complète, chronométrée poste par poste : STEP entrant, lecture
    # par Zoo, mesure et décision chez nous, caisse et STEP sortant par Zoo.
    bleu "Chaîne complète sur la machine de démonstration"
    npx tsx src/bout-en-bout.ts fixtures/machine-demo.step 2350
    ;;

  verifier)
    # Le navigateur est nécessaire : un serveur qui répond 200 ne prouve pas
    # qu'une page fonctionne.
    if [ ! -d "$HOME/.cache/ms-playwright" ]; then
      bleu "Installation du navigateur de vérification…"
      npx --yes playwright@latest install chromium
    fi
    CHROME="$(find "$HOME/.cache/ms-playwright" -name chrome -type f -path '*chrome-linux*' 2>/dev/null | sort | tail -1)"
    bleu "Vérification de l'atelier dans un navigateur"
    PORT="$PORT" npx tsx src/serveur.ts >/tmp/caisse-serveur.log 2>&1 &
    SERVEUR=$!
    trap 'kill $SERVEUR 2>/dev/null || true' EXIT
    sleep 5
    CHROME="$CHROME" node tools/verifier-ui.mjs "http://localhost:$PORT/"
    ;;

  atelier)
    # Un maillage doit exister pour que l'atelier ait quelque chose à montrer
    # au premier lancement. Celui de la machine de démonstration se produit en
    # quelques secondes, et c'est l'occasion de vérifier que le jeton marche.
    if ! ls out/*.obj >/dev/null 2>&1; then
      bleu "Premier lancement : conversion de la machine de démonstration par Zoo…"
      npx tsx src/async-conversion.ts fixtures/machine-demo.step
    fi

    bleu "Atelier Caisse — http://localhost:$PORT"
    gris "Ctrl-C pour arrêter."
    PORT="$PORT" exec npx tsx src/serveur.ts
    ;;

  *)
    rouge "Action inconnue : $ACTION"
    gris  "Attendu : atelier (défaut), demo, test, verifier"
    exit 1
    ;;
esac
