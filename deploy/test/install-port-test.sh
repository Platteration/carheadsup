#!/usr/bin/env bash
# carheadsup: tests for the port detection in deploy/install.sh (effective_port and
# effective_tls_port), which fills in the static Avahi advertisement and the summary. Sources the
# installer's functions without running it; needs Node.js, no root, and changes nothing outside a
# temporary directory.
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

# The TLS port of the phone link: --tls-port, CARHEADSUP_TLS_PORT, server.tlsPort, else 8443;
# "off" when switched off.
printf '{ "server": { "port": 8090, "tlsPort": 9443 } }\n' >"${WORK}/tls-config.json"
printf '{ "server": { "tlsPort": null } }\n' >"${WORK}/tls-off-config.json"
printf 'CARHEADSUP_TLS_PORT=9444\n' >"${WORK}/env-tls"
printf "CARHEADSUP_TLS_PORT='off'\n" >"${WORK}/env-tls-off"
dropin_tls=$(printf '%s\n[Service]\nExecStart=\nExecStart=/usr/bin/node main.ts --tls-port 9445 --config %s\n' \
  "$shipped" "${WORK}/tls-config.json")
dropin_tls_off=$(printf '%s\n[Service]\nExecStart=\nExecStart=/usr/bin/node main.ts --tls-port=OFF\n' "$shipped")

# expect_tls <description> <expected> <unit text> <env file> <default config>
expect_tls() {
  local description=$1 expected=$2 actual
  actual=$(effective_tls_port "$3" "$4" "$5")
  if [[ $actual == "$expected" ]]; then
    printf 'ok    install.sh TLS port: %s\n' "$description"
  else
    printf 'FAIL  install.sh TLS port: %s: expected %s, got %s\n' "$description" "$expected" "$actual" >&2
    failures=$((failures + 1))
  fi
}

expect_tls "nothing configured" 8443 "" "${WORK}/missing-env" "${WORK}/missing.json"
expect_tls "server.tlsPort in the config file" 9443 "" "${WORK}/env-empty" "${WORK}/tls-config.json"
expect_tls "server.tlsPort null switches it off" off "" "${WORK}/env-empty" "${WORK}/tls-off-config.json"
expect_tls "a config without tlsPort" 8443 "" "${WORK}/env-empty" "${WORK}/etc-config.json"
printf '{ "server": { "port": 8443 } }\n' >"${WORK}/legacy-8443-config.json"
expect_tls "a config from before TLS on port 8443" 8444 "" "${WORK}/env-empty" "${WORK}/legacy-8443-config.json"
expect_tls "CARHEADSUP_TLS_PORT beats server.tlsPort" 9444 "" "${WORK}/env-tls" "${WORK}/tls-config.json"
expect_tls "CARHEADSUP_TLS_PORT=off" off "" "${WORK}/env-tls-off" "${WORK}/tls-config.json"
expect_tls "--tls-port from a drop-in beats everything" 9445 "$dropin_tls" "${WORK}/env-tls" "${WORK}/tls-config.json"
expect_tls "--tls-port=OFF" off "$dropin_tls_off" "${WORK}/env-tls" "${WORK}/tls-config.json"
expect_tls "--port does not set the TLS port" 8443 "$dropin_port" "${WORK}/env-port" "${WORK}/missing.json"

# The address the installer asks the restarted server at: --host, CARHEADSUP_HOST, server.host,
# else all addresses.
printf '{ "server": { "host": "10.42.0.1" } }\n' >"${WORK}/host-config.json"
printf 'CARHEADSUP_HOST="192.168.4.1"\n' >"${WORK}/env-host"
dropin_host=$(printf '%s\n[Service]\nExecStart=\nExecStart=/usr/bin/node main.ts --host=127.0.0.1\n' "$shipped")

# expect_host <description> <expected> <unit text> <env file> <default config>
expect_host() {
  local description=$1 expected=$2 actual
  actual=$(effective_host "$3" "$4" "$5")
  if [[ $actual == "$expected" ]]; then
    printf 'ok    install.sh host: %s\n' "$description"
  else
    printf 'FAIL  install.sh host: %s: expected %s, got %s\n' "$description" "$expected" "$actual" >&2
    failures=$((failures + 1))
  fi
}

expect_host "nothing configured" 0.0.0.0 "" "${WORK}/missing-env" "${WORK}/missing.json"
expect_host "server.host in the config file" 10.42.0.1 "" "${WORK}/env-empty" "${WORK}/host-config.json"
expect_host "CARHEADSUP_HOST beats server.host" 192.168.4.1 "" "${WORK}/env-host" "${WORK}/host-config.json"
expect_host "--host from a drop-in beats everything" 127.0.0.1 "$dropin_host" "${WORK}/env-host" "${WORK}/host-config.json"

# The static Avahi file gets both ports, or no tls record when TLS is off.
readonly AVAHI_TEMPLATE="${TEST_DIR}/../avahi/carheadsup.service"
expect_avahi() {
  local description=$1 port=$2 tls=$3 pattern=$4 absent=$5 text
  text=$(static_avahi_service "$port" "$tls" <"$AVAHI_TEMPLATE")
  if [[ $text == *"$pattern"* && (-z $absent || $text != *"$absent"*) ]]; then
    printf 'ok    install.sh Avahi file: %s\n' "$description"
  else
    printf 'FAIL  install.sh Avahi file: %s\n%s\n' "$description" "$text" >&2
    failures=$((failures + 1))
  fi
}
expect_avahi "ports filled in" 8090 9443 "<port>8090</port>" "<port>8080</port>"
expect_avahi "TLS port in the tls record" 8090 9443 "<txt-record>tls=9443</txt-record>" "tls=8443"
expect_avahi "no tls record when TLS is off" 8080 off "<port>8080</port>" "tls="
expect_avahi "protocol version 3" 8080 8443 "<txt-record>v=3</txt-record>" ""

if ((failures > 0)); then
  printf '%d install.sh test(s) failed\n' "$failures" >&2
  exit 1
fi
