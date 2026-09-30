#!/usr/bin/env bash
# carheadsup: behaviour tests for deploy/kiosk.sh, with stub `curl` and `chromium` commands.
# Run by deploy/check.sh; needs no root, a display or a browser, and changes nothing outside a
# temporary directory. Takes about ten seconds (the launcher polls once a second).
#
# The rule under test: Chromium is started only once the HUD page loads. Its own error page is
# a large bright area on the windshield, so a server that does not answer (or answers with an
# error) must leave the screen black, however long that lasts.
set -euo pipefail

TEST_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
readonly KIOSK="${TEST_DIR}/../kiosk.sh"

failures=0
WORK=$(mktemp -d)
readonly WORK
trap 'rm -rf -- "$WORK"' EXIT

pass() { printf 'ok    kiosk.sh: %s\n' "$*"; }
fail() {
  printf 'FAIL  kiosk.sh: %s\n' "$*" >&2
  failures=$((failures + 1))
}

# Stubs: `curl` answers with the HTTP status in $WORK/status ("000" = no answer); `chromium`
# records its arguments and exits.
mkdir -p "${WORK}/bin" "${WORK}/run"
cat >"${WORK}/bin/curl" <<'STUB'
#!/usr/bin/env bash
status=$(cat "${KIOSK_TEST_WORK}/status")
printf '%s' "$status"
[[ $status != 000 ]] || exit 7
STUB
cat >"${WORK}/bin/chromium" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$@" >"${KIOSK_TEST_WORK}/browser-args"
STUB
chmod +x "${WORK}/bin/curl" "${WORK}/bin/chromium"

# run_kiosk <seconds> [VAR=value …]: run the launcher for at most that long; sets `code` (124 =
# still waiting when the time ran out) and `output` (its log).
run_kiosk() {
  local limit=$1
  shift
  rm -f -- "${WORK}/browser-args"
  code=0
  output=$(env PATH="${WORK}/bin:${PATH}" KIOSK_TEST_WORK="$WORK" XDG_RUNTIME_DIR="${WORK}/run" \
    CARHEADSUP_KIOSK_URL=http://localhost:8080/ "$@" timeout "$limit" bash "$KIOSK" 2>&1) ||
    code=$?
}

test_never_answers() {
  echo 000 >"${WORK}/status"
  run_kiosk 4 CARHEADSUP_KIOSK_WAIT_S=1
  if [[ $code == 124 && ! -e ${WORK}/browser-args ]]; then
    pass "no answer: keeps waiting, browser not started"
  else
    fail "no answer: expected to keep waiting without a browser (exit ${code}): ${output}"
  fi
  if [[ $output == *"no answer"* && $output == *"screen stays black"* ]]; then
    pass "no answer: warns in the log"
  else
    fail "no answer: expected a warning in the log: ${output}"
  fi
}

test_error_status() {
  local status
  # 307: the HUD sends the kiosk to HTTPS when it comes by another address than loopback.
  for status in 403 404 503 307; do
    echo "$status" >"${WORK}/status"
    run_kiosk 3 CARHEADSUP_KIOSK_WAIT_S=1
    if [[ $code == 124 && ! -e ${WORK}/browser-args && $output == *"HTTP ${status}"* ]]; then
      pass "HTTP ${status}: keeps waiting, browser not started"
    else
      fail "HTTP ${status}: expected to keep waiting without a browser (exit ${code}): ${output}"
    fi
  done
}

test_redirect_to_https() {
  echo 307 >"${WORK}/status"
  run_kiosk 3 CARHEADSUP_KIOSK_WAIT_S=1
  if [[ $output == *"only serves other devices over HTTPS"* && $output == *"localhost"* ]]; then
    pass "HTTP 307: says to use localhost"
  else
    fail "HTTP 307: expected the log to point at localhost: ${output}"
  fi
}

test_answers_later() {
  echo 000 >"${WORK}/status"
  (
    sleep 2
    echo 200 >"${WORK}/status"
  ) &
  local flipper=$!
  run_kiosk 10 CARHEADSUP_KIOSK_WAIT_S=60
  wait "$flipper" || true
  if [[ $code != 0 || ! -e ${WORK}/browser-args ]]; then
    fail "answers later: expected the browser to start (exit ${code}): ${output}"
    return
  fi
  local -a args=()
  mapfile -t args <"${WORK}/browser-args"
  if [[ ${args[-1]} == http://localhost:8080/ ]] &&
    printf '%s\n' "${args[@]}" | grep -qx -- --kiosk &&
    printf '%s\n' "${args[@]}" | grep -qx -- --force-dark-mode; then
    pass "answers later: browser started in kiosk mode on the HUD URL, dark error pages"
  else
    fail "answers later: unexpected browser arguments: ${args[*]}"
  fi
}

test_invalid_wait() {
  echo 200 >"${WORK}/status"
  run_kiosk 5 CARHEADSUP_KIOSK_WAIT_S=soon
  if [[ $code == 2 && ! -e ${WORK}/browser-args ]]; then
    pass "invalid CARHEADSUP_KIOSK_WAIT_S is refused"
  else
    fail "invalid CARHEADSUP_KIOSK_WAIT_S: expected exit 2 (got ${code}): ${output}"
  fi
}

test_never_answers
test_error_status
test_redirect_to_https
test_answers_later
test_invalid_wait

if ((failures > 0)); then
  printf '%d kiosk.sh test(s) failed\n' "$failures" >&2
  exit 1
fi
