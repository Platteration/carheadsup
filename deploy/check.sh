#!/usr/bin/env bash
# carheadsup: lint the deployment kit. Runs anywhere (no root, changes nothing):
#
#   deploy/check.sh
#
# - bash -n on every script, and shellcheck when it is installed;
# - systemd-analyze verify on the units when available (complaints about binaries or units that
#   only exist on the Pi, such as cage, rfcomm or bluetooth.service, are expected and filtered);
# - xmllint on the Avahi service file when available.
# Exits non-zero if any check fails.
set -euo pipefail

DEPLOY_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
readonly DEPLOY_DIR

failures=0

pass() { printf 'ok    %s\n' "$*"; }
fail() {
  printf 'FAIL  %s\n' "$*" >&2
  failures=$((failures + 1))
}
skip() { printf 'skip  %s\n' "$*"; }

check_scripts() {
  local script
  for script in "${DEPLOY_DIR}"/*.sh; do
    if bash -n "$script"; then
      pass "bash -n $(basename -- "$script")"
    else
      fail "bash -n $(basename -- "$script")"
    fi
  done
  if command -v shellcheck >/dev/null 2>&1; then
    if shellcheck "${DEPLOY_DIR}"/*.sh; then
      pass "shellcheck"
    else
      fail "shellcheck"
    fi
  else
    skip "shellcheck (not installed)"
  fi
}

check_units() {
  if ! command -v systemd-analyze >/dev/null 2>&1; then
    skip "systemd-analyze verify (not installed)"
    return
  fi
  local unit output
  for unit in "${DEPLOY_DIR}"/systemd/*.service; do
    # Missing executables and units are expected off the Pi; anything else is a real problem.
    output=$(systemd-analyze verify --man=no "$unit" 2>&1 |
      grep -v -e 'is not executable' -e 'not found' -e 'Failed to create .*/start' || true)
    if [[ -z $output ]]; then
      pass "systemd-analyze verify $(basename -- "$unit")"
    else
      fail "systemd-analyze verify $(basename -- "$unit"): ${output}"
    fi
  done
}

check_avahi() {
  if ! command -v xmllint >/dev/null 2>&1; then
    skip "xmllint (not installed)"
    return
  fi
  if xmllint --noout "${DEPLOY_DIR}/avahi/carheadsup.service"; then
    pass "xmllint avahi/carheadsup.service"
  else
    fail "xmllint avahi/carheadsup.service"
  fi
}

main() {
  check_scripts
  check_units
  check_avahi
  if ((failures > 0)); then
    printf '%d check(s) failed\n' "$failures" >&2
    exit 1
  fi
  printf 'all checks passed\n'
}

main "$@"
