#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$REPO_ROOT/server"
MARKET_SEED_DIR="$REPO_ROOT/tools/market-seed"
MARKET_SERVER_DIR="$REPO_ROOT/externalservices/market-server"
MARKET_DB_PATH="$MARKET_SERVER_DIR/data/generated/market.sqlite"
STATIC_DATA_SENTINEL="$SERVER_DIR/src/newDatabase/data/solarSystems/data.json"
RUNTIME_DATA_SENTINEL="$SERVER_DIR/src/newDatabase/data/accounts/data.json"
CA_CERT_PATH="$REPO_ROOT/server/certs/xmpp-ca-cert.pem"
CA_KEY_PATH="$REPO_ROOT/server/certs/xmpp-ca-key.pem"
GATEWAY_CERT_DIR="$REPO_ROOT/server/src/_secondary/express/certs"
GATEWAY_CERT_PATH="$GATEWAY_CERT_DIR/gateway-dev-cert.pem"
GATEWAY_KEY_PATH="$GATEWAY_CERT_DIR/gateway-dev-key.pem"
GATEWAY_CERT_BUILDER="$REPO_ROOT/tools/macos/build-gateway-cert.sh"
HOST_PLATFORM="$(uname -s)"

market_mode="none"
market_pid=""
if [[ -n "${EVEJS_CLIENT_HANDSHAKE_MODE:-}" ]]; then
  client_handshake_mode="$EVEJS_CLIENT_HANDSHAKE_MODE"
elif [[ "$HOST_PLATFORM" == "Darwin" ]]; then
  client_handshake_mode="stock"
else
  client_handshake_mode="patched"
fi
proxy_local_intercept="${EVEJS_PROXY_LOCAL_INTERCEPT:-1}"

usage() {
  cat <<'EOF'
Usage: ./QuickstartServer.sh [--patched-client] [--stock-client] [--remote-gateway] [--market-smoke|--market-jita] [--help]

Starts a local EvEJS dev server on macOS/Linux.

Default mode is platform-sensitive:
  - macOS (`Darwin`): stock-client staged-runtime workflow
  - other platforms: upstream patched-client workflow

In both cases local proxy/gateway interception stays enabled by default.

Options:
  --patched-client
                  Research mode for explicitly patched clients. Enables the
                  handshake-time signedFunc injection path used by the Windows
                  Placebo client flow.
  --stock-client  Explicitly force the stock-client handshake path. This is
                  the default and disables handshake-time signedFunc injection
                  for untouched native Mac clients.
  --remote-gateway
                  Do not locally intercept public-gateway gRPC. Mostly useful
                  while debugging the stock-client path.
  --market-smoke  Build a tiny smoke-test market DB, start the market daemon,
                  then start the main server.
  --market-jita   Build a Jita + New Caldari market DB, start the market
                  daemon, then start the main server.
  --help          Show this help text.
EOF
}

require_command() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "[eve.js] Missing required command: $name" >&2
    exit 1
  fi
}

cleanup() {
  if [[ -n "$market_pid" ]]; then
    kill "$market_pid" >/dev/null 2>&1 || true
    wait "$market_pid" >/dev/null 2>&1 || true
  fi
}

gateway_cert_needs_rebuild() {
  if [[ ! -f "$GATEWAY_CERT_PATH" || ! -f "$GATEWAY_KEY_PATH" ]]; then
    return 0
  fi

  if ! command -v openssl >/dev/null 2>&1; then
    return 1
  fi

  if ! openssl x509 -in "$GATEWAY_CERT_PATH" -noout -ext subjectAltName 2>/dev/null |
    grep -q "DNS:live-public-gateway.evetech.net"; then
    return 0
  fi

  if ! openssl x509 -in "$GATEWAY_CERT_PATH" -noout -subject 2>/dev/null |
    grep -q "CN=live-public-gateway.evetech.net"; then
    return 0
  fi

  return 1
}

ensure_gateway_cert() {
  if [[ ! -f "$CA_CERT_PATH" || ! -f "$CA_KEY_PATH" || ! -f "$GATEWAY_CERT_BUILDER" ]]; then
    return
  fi

  if ! gateway_cert_needs_rebuild; then
    return
  fi

  echo "[eve.js] Building local gateway TLS cert..."
  mkdir -p "$GATEWAY_CERT_DIR"
  bash "$GATEWAY_CERT_BUILDER" \
    --ca-cert "$CA_CERT_PATH" \
    --ca-key "$CA_KEY_PATH" \
    --out-cert "$GATEWAY_CERT_PATH" \
    --out-key "$GATEWAY_KEY_PATH"
}

wait_for_market() {
  local attempts=30
  local url="http://127.0.0.1:40110/health"

  require_command curl

  for ((i = 0; i < attempts; i += 1)); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  echo "[eve.js] Market daemon did not become healthy at $url" >&2
  return 1
}

ensure_node_deps_and_data() {
  if [[ ! -d "$REPO_ROOT/node_modules" ]]; then
    echo "[eve.js] Installing root dependencies..."
    npm --prefix "$REPO_ROOT" ci
  fi

  if [[ ! -d "$SERVER_DIR/node_modules" ]]; then
    echo "[eve.js] Installing server dependencies..."
    npm --prefix "$SERVER_DIR" ci
  fi

  if [[ ! -f "$RUNTIME_DATA_SENTINEL" ]]; then
    echo "[eve.js] Creating local runtime database baseline..."
    npm --prefix "$REPO_ROOT" run db:bootstrap:apply
  fi

  if [[ ! -s "$STATIC_DATA_SENTINEL" ]]; then
    echo "[eve.js] Generated SDE data is missing. Downloading and applying current JSONL SDE..."
    npm --prefix "$REPO_ROOT" run datasync:sde -- --download --apply
  fi
}

build_market_seed() {
  local mode="$1"

  require_command cargo

  echo "[eve.js] Building market seed ($mode)..."

  if [[ "$mode" == "smoke" ]]; then
    (
      cd "$MARKET_SEED_DIR"
      cargo run --manifest-path Cargo.toml -- --config config/market-seed.local.toml build --force --station-limit 25 --type-limit 250
    )
    return
  fi

  (
    cd "$MARKET_SEED_DIR"
    cargo run --release --manifest-path Cargo.toml -- --config config/market-seed.local.toml build --force --preset jita_new_caldari
  )
}

start_market_daemon() {
  require_command cargo

  if [[ ! -f "$MARKET_DB_PATH" ]]; then
    echo "[eve.js] Market DB not found at $MARKET_DB_PATH" >&2
    echo "[eve.js] Re-run with --market-smoke or --market-jita to build one first." >&2
    exit 1
  fi

  echo "[eve.js] Starting standalone market daemon..."

  (
    cd "$MARKET_SERVER_DIR"
    cargo run --manifest-path Cargo.toml -- --config config/market-server.local.toml serve
  ) &
  market_pid="$!"

  wait_for_market
  echo "[eve.js] Market daemon is healthy on http://127.0.0.1:40110"
}

for arg in "$@"; do
  case "$arg" in
    --market-smoke)
      market_mode="smoke"
      ;;
    --market-jita)
      market_mode="jita"
      ;;
    --patched-client)
      client_handshake_mode="patched"
      ;;
    --stock-client)
      client_handshake_mode="stock"
      ;;
    --remote-gateway)
      proxy_local_intercept="0"
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "[eve.js] Unknown argument: $arg" >&2
      echo >&2
      usage >&2
      exit 1
      ;;
  esac
done

trap cleanup EXIT

require_command node
require_command npm

ensure_gateway_cert
ensure_node_deps_and_data

mkdir -p "$SERVER_DIR/logs/node-reports"
export EVEJS_PROXY_LOCAL_INTERCEPT="$proxy_local_intercept"
export EVEJS_CLIENT_HANDSHAKE_MODE="$client_handshake_mode"
if [[ -z "${EVEJS_PROXY_ALLOWED_HOSTS+x}" && "$HOST_PLATFORM" == "Darwin" ]]; then
  export EVEJS_PROXY_ALLOWED_HOSTS="clientresources.eveonline.com"
fi

if [[ "$market_mode" != "none" ]]; then
  build_market_seed "$market_mode"
  start_market_daemon
fi

echo "[eve.js] Client handshake mode: $EVEJS_CLIENT_HANDSHAKE_MODE"
echo "[eve.js] Local public-gateway intercept: $EVEJS_PROXY_LOCAL_INTERCEPT"
if [[ -n "${EVEJS_PROXY_ALLOWED_HOSTS:-}" ]]; then
  echo "[eve.js] Proxy allowed hosts: $EVEJS_PROXY_ALLOWED_HOSTS"
fi
if [[ "$EVEJS_CLIENT_HANDSHAKE_MODE" == "patched" ]]; then
  echo "[eve.js] Mode: patched-client research path"
else
  echo "[eve.js] Mode: stock-client / staged native-mac default"
fi
echo "[eve.js] Starting main server..."
echo "[eve.js] Press Ctrl+C to stop."
npm --prefix "$SERVER_DIR" start
