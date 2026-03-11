#!/bin/bash
set -euo pipefail

RED='\033[31m'
GREEN='\033[32m'
YELLOW='\033[33m'
BOLD='\033[1m'
RESET='\033[0m'

info()  { printf "${BOLD}==> %s${RESET}\n" "$1"; }
ok()    { printf "${GREEN}==> %s${RESET}\n" "$1"; }
warn()  { printf "${YELLOW}==> %s${RESET}\n" "$1"; }
fail()  { printf "${RED}==> %s${RESET}\n" "$1"; exit 1; }

check_cmd() {
    command -v "$1" >/dev/null 2>&1
}

info "Checking prerequisites..."

MISSING=()
check_cmd docker   || MISSING+=("docker")
check_cmd node     || MISSING+=("node (v20+)")
check_cmd pnpm     || MISSING+=("pnpm (v9+)")
check_cmd cargo    || MISSING+=("cargo (Rust 1.82+)")

if [ ${#MISSING[@]} -gt 0 ]; then
    fail "Missing: ${MISSING[*]}"
fi

NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 20 ]; then
    fail "Node.js 20+ required (found v$(node -v))"
fi

if ! docker info >/dev/null 2>&1; then
    fail "Docker daemon not running"
fi

ok "Prerequisites OK"

info "Installing TypeScript dependencies..."
pnpm install --frozen-lockfile 2>/dev/null || pnpm install

info "Building TypeScript packages..."
pnpm build

info "Building Rust worker..."
(cd packages/worker && cargo build --release)

info "Checking for iii-engine..."
if check_cmd iii; then
    III_BIN=$(command -v iii)
    ok "Found iii at $III_BIN"
elif [ -f "$HOME/.local/bin/iii" ]; then
    III_BIN="$HOME/.local/bin/iii"
    ok "Found iii at $III_BIN"
else
    warn "iii-engine binary not found"
    echo "  Install from: https://github.com/iii-hq/iii"
    echo "  Or run with docker-compose: docker compose up"
    echo ""
fi

ok "Setup complete"
echo ""
echo "  Start iii-engine:  iii --config iii-config.yaml"
echo "  Start worker:      cd packages/worker && cargo run --release"
echo "  Or use compose:    docker compose up"
echo ""
echo "  Test it:"
echo "    curl -s http://localhost:3111/sandbox/health | jq"
echo ""
