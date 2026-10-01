#!/usr/bin/env bash
# carheadsup: behaviour tests for deploy/kiosk.sh, with stub `curl` and `chromium` commands.
# Run by deploy/check.sh; needs no root, a display or a browser, and changes nothing outside a
# temporary directory. Takes about a minute (the launcher polls once a second while it waits for
# the server, then every 2 s while it watches the page).
#
# The rules under test: Chromium is started only once the HUD page loads. Its own error page is
# a large bright area on the windshield, so a server that does not answer (or answers with an
# error) must leave the screen black, however long that lasts. Once running, the browser is
# restarted when the page stops sending its heartbeat while the server answers — and never while
# the server is down or starting, within the start grace, or because of a server that does not
# know the health endpoint.
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

# Stubs: `curl` answers the page with the HTTP status in $WORK/status ("000" = no answer), and
# the health endpoint with $WORK/health-status (default 404) and the body in $WORK/health;
# `chromium` records its arguments, then exits with the status in $WORK/browser-exit — or, with
# "run" there, runs until it is stopped and records that in $WORK/browser-stopped.
mkdir -p "${WORK}/bin" "${WORK}/run"
cat >"${WORK}/bin/curl" <<'STUB'
#!/usr/bin/env bash
url=${*: -1}
if [[ $url == */api/kiosk/health ]]; then
  status=$(cat "${KIOSK_TEST_WORK}/health-status" 2>/dev/null || echo 404)
  [[ $status != 000 ]] || exit 7
  printf '%s\n%s' "$(cat "${KIOSK_TEST_WORK}/health" 2>/dev/null)" "$status"
  exit 0
fi
status=$(cat "${KIOSK_TEST_WORK}/status")
printf '%s' "$status"
[[ $status != 000 ]] || exit 7
STUB
cat >"${WORK}/bin/chromium" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$@" >"${KIOSK_TEST_WORK}/browser-args"
mode=$(cat "${KIOSK_TEST_WORK}/browser-exit" 2>/dev/null || echo 0)
if [[ $mode != run ]]; then
  exit "$mode"
fi
trap 'echo stopped >"${KIOSK_TEST_WORK}/browser-stopped"; exit 143' TERM
while :; do sleep 0.1; done
STUB
chmod +x "${WORK}/bin/curl" "${WORK}/bin/chromium"

# run_kiosk <seconds> [VAR=value …]: run the launcher for at most that long; sets `code` (124 =
# still waiting when the time ran out) and `output` (its log).
run_kiosk() {
  local limit=$1
  shift
  rm -f -- "${WORK}/browser-args" "${WORK}/browser-stopped"
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
  # 307: the HUD sends the kiosk to HTTPS when it takes it for another device (it came through an
  # address that is not the machine's own).
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
  local name
  for name in CARHEADSUP_KIOSK_WAIT_S CARHEADSUP_KIOSK_GRACE_S CARHEADSUP_KIOSK_STALE_S; do
    run_kiosk 5 "${name}=soon"
    if [[ $code == 2 && ! -e ${WORK}/browser-args && $output == *"$name"* ]]; then
      pass "invalid ${name} is refused"
    else
      fail "invalid ${name}: expected exit 2 (got ${code}): ${output}"
    fi
  done
}

test_browser_flags() {
  echo 200 >"${WORK}/status"
  echo 0 >"${WORK}/browser-exit"
  run_kiosk 5
  if printf '%s\n' "$(<"${WORK}/browser-args")" | grep -qx -- --disable-hang-monitor &&
    printf '%s\n' "$(<"${WORK}/browser-args")" | grep -qx -- --enable-logging=stderr; then
    pass "no hang dialog, Chromium's errors in the journal"
  else
    fail "expected --disable-hang-monitor and --enable-logging=stderr: $(<"${WORK}/browser-args")"
  fi
}

test_browser_exits() {
  echo 200 >"${WORK}/status"
  echo 3 >"${WORK}/browser-exit"
  run_kiosk 5
  if [[ $code == 3 && $output == *"Chromium exited (status 3)"* ]]; then
    pass "browser exits: the kiosk exits with its status (systemd starts it again)"
  else
    fail "browser exits: expected exit 3 (got ${code}): ${output}"
  fi
}

# watch <seconds> <health status> <health body> [VAR=value …]: start a browser that keeps
# running, with the health endpoint answering as given, for at most that long.
watch() {
  local limit=$1 health_status=$2 body=$3
  shift 3
  echo 200 >"${WORK}/status"
  echo run >"${WORK}/browser-exit"
  echo "$health_status" >"${WORK}/health-status"
  printf '%s' "$body" >"${WORK}/health"
  run_kiosk "$limit" "$@"
}

test_heartbeat_stops() {
  watch 10 200 '{"aliveAgoMs":9000,"uptimeMs":600000,"displays":1}' CARHEADSUP_KIOSK_GRACE_S=1
  if [[ $code == 1 && -e ${WORK}/browser-stopped &&
    $output == *"no heartbeat for 9 s"*"restarting the browser"* ]]; then
    pass "heartbeat stops: browser stopped, the kiosk exits (systemd starts it again)"
  else
    fail "heartbeat stops: expected the browser to be stopped (exit ${code}): ${output}"
  fi
}

test_no_heartbeat_since_server_start() {
  watch 10 200 '{"aliveAgoMs":null,"uptimeMs":45000,"displays":0}' CARHEADSUP_KIOSK_GRACE_S=1
  if [[ $code == 1 && $output == *"no heartbeat since the server started 45 s ago"* ]]; then
    pass "no heartbeat long after the server started: browser stopped"
  else
    fail "no heartbeat since the server started: expected a restart (exit ${code}): ${output}"
  fi
  # A server that has just restarted: the page has yet to reconnect.
  watch 4.5 200 '{"aliveAgoMs":null,"uptimeMs":3000,"displays":0}' CARHEADSUP_KIOSK_GRACE_S=10
  if [[ $code == 124 && $output != *"restarting"* ]]; then
    pass "a server that just started: the page gets time to reconnect"
  else
    fail "a server that just started: expected no restart (exit ${code}): ${output}"
  fi
}

# expect_kept <description>: the last watch ran out of time with the browser still running.
expect_kept() {
  if [[ $code == 124 && $output != *"restarting the browser"* ]]; then
    pass "$1: browser kept"
  else
    fail "$1: expected the browser to keep running (exit ${code}): ${output}"
  fi
}

test_browser_kept() {
  watch 4.5 200 '{"aliveAgoMs":400,"uptimeMs":600000,"displays":1}' CARHEADSUP_KIOSK_GRACE_S=0
  expect_kept "fresh heartbeat"
  watch 4.5 000 '' CARHEADSUP_KIOSK_GRACE_S=0
  expect_kept "server down (the page blanks itself)"
  watch 4.5 503 '{"error":"The HUD is starting"}' CARHEADSUP_KIOSK_GRACE_S=0
  expect_kept "server starting"
  watch 4.5 404 '{"error":"No API endpoint /api/kiosk/health"}' CARHEADSUP_KIOSK_GRACE_S=0
  expect_kept "server without the health endpoint"
  watch 4.5 200 '{"aliveAgoMs":9000,"uptimeMs":600000,"displays":1}' CARHEADSUP_KIOSK_GRACE_S=20
  expect_kept "within the start grace"
  watch 4.5 200 '{"aliveAgoMs":9000,"uptimeMs":600000,"displays":1}' \
    CARHEADSUP_KIOSK_GRACE_S=0 CARHEADSUP_KIOSK_STALE_S=0
  expect_kept "watchdog off (CARHEADSUP_KIOSK_STALE_S=0)"
  watch 4.5 200 '{"aliveAgoMs":9000,"uptimeMs":600000,"displays":1}' \
    CARHEADSUP_KIOSK_GRACE_S=0 CARHEADSUP_KIOSK_STALE_S=15
  expect_kept "a longer CARHEADSUP_KIOSK_STALE_S"
  # Stopping the kiosk (systemd's SIGTERM, here from `timeout`) stops the browser too.
  if [[ -e ${WORK}/browser-stopped ]]; then
    pass "stopping the kiosk stops the browser"
  else
    fail "stopping the kiosk: the browser was left running"
  fi
}

test_never_answers
test_error_status
test_redirect_to_https
test_answers_later
test_invalid_wait
test_browser_flags
test_browser_exits
test_heartbeat_stops
test_no_heartbeat_since_server_start
test_browser_kept

if ((failures > 0)); then
  printf '%d kiosk.sh test(s) failed\n' "$failures" >&2
  exit 1
fi
