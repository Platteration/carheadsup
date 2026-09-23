#!/usr/bin/env bash
# carheadsup: tests for the port detection in deploy/install.sh (effective_port), which fills in
# the static Avahi advertisement and the summary. Sources the installer's functions without
# running it; needs Node.js, no root, and changes nothing outside a temporary directory.
set -euo pipefail

TEST_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
# The installer is checked on its own.
# shellcheck source=/dev/null
source "${TEST_DIR}/../install.sh"
# Read by the sourced effective_port.
# shellcheck disable=SC2034
NODE_BIN=$(command -v node)

failures=0
WORK=$(mktemp -d)
readonly WORK
trap 'rm -rf -- "$WORK"' EXIT

readonly SHIPPED_UNIT="${TEST_DIR}/../systemd/carheadsup.service"
printf '{ "server": { "port": 8090 } }\n' >"${WORK}/etc-config.json"
printf '{ "server": { "port": 8091 } }\n' >"${WORK}/data-config.json"
printf '# nothing set\n#CARHEADSUP_PORT=8080\n' >"${WORK}/env-empty"
printf 'CARHEADSUP_LOG_LEVEL=debug\nCARHEADSUP_PORT="8092"\n' >"${WORK}/env-port"

# expect <description> <expected port> <unit text> <env file> <default config>
expect() {
  local description=$1 expected=$2 actual
  actual=$(effective_port "$3" "$4" "$5")
  if [[ $actual == "$expected" ]]; then
    printf 'ok    install.sh port: %s\n' "$description"
  else
    printf 'FAIL  install.sh port: %s: expected %s, got %s\n' "$description" "$expected" "$actual" >&2
    failures=$((failures + 1))
  fi
}

# The shipped unit, with its --config pointing into the temporary directory.
shipped=$(<"$SHIPPED_UNIT")
shipped=${shipped//\/etc\/carheadsup\/config.json/${WORK}\/etc-config.json}
dropin_config=$(printf '%s\n[Service]\nExecStart=\nExecStart=/usr/bin/node main.ts --config %s --data-dir /var/lib/carheadsup\n' \
  "$shipped" "${WORK}/data-config.json")
dropin_port=$(printf '%s\n[Service]\nExecStart=\nExecStart=/usr/bin/node main.ts \\\n  --config %s --port=8093\n' \
  "$shipped" "${WORK}/data-config.json")

expect "nothing configured" 8080 "" "${WORK}/missing-env" "${WORK}/missing.json"
expect "server.port in the config file" 8090 "" "${WORK}/env-empty" "${WORK}/etc-config.json"
expect "server.port in the unit's --config file" 8090 "$shipped" "${WORK}/env-empty" "${WORK}/missing.json"
expect "CARHEADSUP_PORT beats server.port" 8092 "$shipped" "${WORK}/env-port" "${WORK}/etc-config.json"
expect "--config from a drop-in (read-only root)" 8091 "$dropin_config" "${WORK}/env-empty" "${WORK}/etc-config.json"
expect "--port from a drop-in beats everything" 8093 "$dropin_port" "${WORK}/env-port" "${WORK}/etc-config.json"

if ((failures > 0)); then
  printf '%d install.sh test(s) failed\n' "$failures" >&2
  exit 1
fi
