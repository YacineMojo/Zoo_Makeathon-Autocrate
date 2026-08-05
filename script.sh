#!/usr/bin/env bash
#
# Launches AutoCrate.
#
#   ./script.sh            installs if needed, then opens the studio
#   ./script.sh demo       plays the whole chain in the console, timed
#   ./script.sh test       the test suite
#   ./script.sh verifier   drives the studio in a real browser
#
# The one prerequisite this script cannot install is the Zoo token: without it
# nothing that touches Zoo can run, and the script says so immediately rather
# than letting you discover the error on the first call.

set -euo pipefail
cd "$(dirname "$0")"

# 5174: the BESS configurator, first project of the makeathon, occupies 5173.
PORT="${PORT:-5174}"
ACTION="${1:-atelier}"

blue() { printf '\033[1;34m%s\033[0m\n' "$*"; }
red()  { printf '\033[1;31m%s\033[0m\n' "$*"; }
dim()  { printf '\033[2m%s\033[0m\n' "$*"; }

# ── Prerequisites ────────────────────────────────────────────────────────────

if ! command -v node >/dev/null 2>&1; then
  red "Node is not installed. Node 20 or later is required."
  exit 1
fi

MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$MAJOR" -lt 20 ]; then
  red "Node $MAJOR detected, Node 20 is the minimum."
  exit 1
fi

if [ ! -d node_modules ]; then
  blue "Installing dependencies…"
  npm install --silent
fi

# ── Zoo token ────────────────────────────────────────────────────────────────

if [ ! -f .env ] && [ -z "${ZOO_API_TOKEN:-}" ]; then
  cp .env.example .env
  red "No Zoo token."
  dim "A .env file has just been created. Set ZOO_API_TOKEN in it — get one from"
  dim "https://zoo.dev/account/api-tokens — then run this again."
  dim ""
  dim "Without a token, footprint computation and gauge verdicts still work on an"
  dim "already converted mesh, but neither reading a STEP nor generating the crate"
  dim "is possible: both of those live at Zoo."
  exit 1
fi

# ── Actions ──────────────────────────────────────────────────────────────────

case "$ACTION" in
  test)
    blue "Tests"
    npm test
    ;;

  demo)
    # The whole chain, timed post by post: incoming STEP, read by Zoo, measured
    # and decided by us, crate and outgoing STEP by Zoo.
    blue "Full chain on the demo machine"
    npx tsx src/bout-en-bout.ts fixtures/machine-demo.step 2350
    ;;

  verifier)
    # The browser is required: a server that answers 200 does not prove that a
    # page works.
    if [ ! -d "$HOME/.cache/ms-playwright" ]; then
      blue "Installing the verification browser…"
      npx --yes playwright@latest install chromium
    fi
    CHROME="$(find "$HOME/.cache/ms-playwright" -name chrome -type f -path '*chrome-linux*' 2>/dev/null | sort | tail -1)"
    blue "Checking the studio in a browser"
    PORT="$PORT" npx tsx src/serveur.ts >/tmp/caisse-serveur.log 2>&1 &
    SERVER=$!
    trap 'kill $SERVER 2>/dev/null || true' EXIT
    sleep 5
    CHROME="$CHROME" node tools/verifier-ui.mjs "http://localhost:$PORT/"
    ;;

  atelier)
    # A mesh has to exist for the studio to have something to show on the first
    # launch. It is the KUKA KR 6 with its tool: the only real machine model
    # whose licence lets us fetch it and show it (MIT, csbebetter/OCC_Qt_Robot).
    # Its STEP is not committed here — we do not redistribute a third party's
    # file when we can point at its source.
    #
    # Converting it takes several minutes at Zoo: that is the price of a 5.4 MB
    # STEP, and it is said before the wait, not after.
    KR6=fixtures/kuka_kr6_with_tool.step
    if ! ls out/async-*.obj out/web-*.obj >/dev/null 2>&1; then
      if [ ! -f "$KR6" ]; then
        blue "First launch: fetching the KUKA KR 6 (MIT)…"
        curl -sSL --fail -o "$KR6" \
          https://raw.githubusercontent.com/csbebetter/OCC_Qt_Robot/master/robot/KR6/KR6withTool.STEP
      fi
      blue "Converting the KR 6 at Zoo — expect four to five minutes…"
      npx tsx src/async-conversion.ts "$KR6"
    fi

    blue "AutoCrate studio — http://localhost:$PORT"
    dim "Ctrl-C to stop."
    PORT="$PORT" exec npx tsx src/serveur.ts
    ;;

  *)
    red "Unknown action: $ACTION"
    dim "Expected: atelier (default), demo, test, verifier"
    exit 1
    ;;
esac
