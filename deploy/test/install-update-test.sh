#!/usr/bin/env bash
# carheadsup: tests for the update path of deploy/install.sh — the power-cut-safe swap of the
# code (flushed to disk before and after the renames, the old version kept), --rollback, the
# repair of a swap a power cut interrupted, the check that the restarted server answers with the
# automatic rollback when it does not, and the hardware watchdog setting. Sources the installer's
# functions without running it; needs Node.js, no root, and changes nothing outside a temporary
# directory.
set -euo pipefail

TEST_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
# The installer is checked on its own.
# shellcheck source=/dev/null
source "${TEST_DIR}/../install.sh"
# Read by the sourced hud_answers.
# shellcheck disable=SC2034
NODE_BIN=$(command -v node)

failures=0
WORK=$(mktemp -d)
readonly WORK
server_pid=""
cleanup() {
  if [[ -n $server_pid ]]; then
    kill "$server_pid" 2>/dev/null || true
  fi
  rm -rf -- "$WORK"
}
trap cleanup EXIT

pass() { printf 'ok    install.sh update: %s\n' "$*"; }
fail() {
  printf 'FAIL  install.sh update: %s\n' "$*" >&2
  failures=$((failures + 1))
}

# version <dir>: what the fake tree in <dir> says it is ("-" when there is none).
version() {
  if [[ -f $1/VERSION ]]; then
    cat -- "$1/VERSION"
  else
    printf -- '-'
  fi
}

# make_tree <dir> <version>
make_tree() {
  mkdir -p "$1/packages"
  printf '%s' "$2" >"$1/VERSION"
  printf 'code of %s\n' "$2" >"$1/packages/main.ts"
}

# Records what the trees look like whenever the code is flushed to disk (stands in for sync).
sync() {
  printf '%s %s %s\n' "$(version "${WORK}/opt/hud.new")" "$(version "${WORK}/opt/hud")" \
    "$(version "${WORK}/opt/hud.prev")" >>"${WORK}/syncs"
}

test_swap_in() {
  local prefix="${WORK}/opt/hud"
  mkdir -p "${WORK}/opt"
  rm -f -- "${WORK}/syncs"
  make_tree "$prefix" 1
  make_tree "${prefix}.new" 2
  swap_in "${prefix}.new" "$prefix"
  if [[ $(version "$prefix") == 2 && $(version "${prefix}.prev") == 1 && ! -e ${prefix}.new ]]; then
    pass "the new version is installed, the old one kept as .prev"
  else
    fail "swap_in: installed $(version "$prefix"), previous $(version "${prefix}.prev")"
  fi
  # Flushed with the staged tree complete and the old one still in place, then after the renames.
  if [[ $(<"${WORK}/syncs") == $'2 1 -\n- 2 1' ]]; then
    pass "flushed to disk before and after the renames"
  else
    fail "swap_in: unexpected flushes (staged, installed, previous): $(<"${WORK}/syncs")"
  fi
  make_tree "${prefix}.new" 3
  swap_in "${prefix}.new" "$prefix"
  if [[ $(version "$prefix") == 3 && $(version "${prefix}.prev") == 2 ]]; then
    pass "the next update keeps only the version before it"
  else
    fail "second swap_in: installed $(version "$prefix"), previous $(version "${prefix}.prev")"
  fi
  rm -rf -- "${WORK}/opt"
  make_tree "${prefix}.new" 1
  swap_in "${prefix}.new" "$prefix"
  if [[ $(version "$prefix") == 1 && ! -e ${prefix}.prev ]]; then
    pass "a first installation has no previous version"
  else
    fail "first swap_in: installed $(version "$prefix"), previous $(version "${prefix}.prev")"
  fi
  rm -rf -- "${WORK}/opt"
}

test_swap_previous() {
  local prefix="${WORK}/opt/hud"
  make_tree "$prefix" 2
  if swap_previous "$prefix"; then
    fail "swap_previous without a previous version succeeded"
  elif [[ $(version "$prefix") == 2 ]]; then
    pass "--rollback without a previous version changes nothing"
  else
    fail "swap_previous without a previous version changed the installed one"
  fi
  make_tree "${prefix}.prev" 1
  swap_previous "$prefix"
  if [[ $(version "$prefix") == 1 && $(version "${prefix}.prev") == 2 && ! -e ${prefix}.swap ]]; then
    pass "--rollback puts the previous version back and keeps the newer one"
  else
    fail "swap_previous: installed $(version "$prefix"), previous $(version "${prefix}.prev")"
  fi
  swap_previous "$prefix"
  if [[ $(version "$prefix") == 2 && $(version "${prefix}.prev") == 1 ]]; then
    pass "--rollback again goes forward again"
  else
    fail "second swap_previous: installed $(version "$prefix"), previous $(version "${prefix}.prev")"
  fi
  rm -rf -- "${WORK}/opt"
}

# interrupted <description> <expected installed> <expected previous>: run finish_interrupted_swap
# on the trees set up before.
interrupted() {
  local prefix="${WORK}/opt/hud" output
  output=$(finish_interrupted_swap "$prefix" 2>&1)
  if [[ $(version "$prefix") == "$2" && $(version "${prefix}.prev") == "$3" && ! -e ${prefix}.swap ]]; then
    pass "power cut $1: repaired"
  else
    fail "power cut $1: installed $(version "$prefix"), previous $(version "${prefix}.prev"): ${output}"
  fi
  rm -rf -- "${WORK}/opt"
}

test_interrupted_swaps() {
  local prefix="${WORK}/opt/hud"
  # swap_in, between its renames: the old version had moved away, the new one not in yet.
  make_tree "${prefix}.prev" 1
  make_tree "${prefix}.new" 2
  interrupted "during an update" 1 -
  # swap_previous, after its first rename.
  make_tree "${prefix}.swap" 2
  make_tree "${prefix}.prev" 1
  interrupted "early in a rollback" 2 1
  # swap_previous, after its second rename.
  make_tree "$prefix" 1
  make_tree "${prefix}.swap" 2
  interrupted "late in a rollback" 1 2
  # Nothing to repair.
  make_tree "$prefix" 2
  make_tree "${prefix}.prev" 1
  interrupted "(nothing to repair)" 2 1
}

# A tiny HTTP server answering every request with <status> and <body>; sets server_port.
start_server() {
  local status=$1 body=$2
  "$NODE_BIN" -e '
    const [status, body] = [Number(process.argv[1]), process.argv[2]];
    const server = require("node:http").createServer((req, res) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(body);
    });
    server.listen(0, "127.0.0.1", () => console.log(server.address().port));
  ' "$status" "$body" >"${WORK}/port" &
  server_pid=$!
  local i
  for ((i = 0; i < 50; i++)); do
    [[ -s ${WORK}/port ]] && break
    sleep 0.1
  done
  server_port=$(<"${WORK}/port")
}

stop_server() {
  kill "$server_pid" 2>/dev/null || true
  wait "$server_pid" 2>/dev/null || true
  server_pid=""
  rm -f -- "${WORK}/port"
}

test_hud_answers() {
  local server_port
  start_server 200 '{"name":"carheadsup","version":"0.1.0"}'
  if hud_answers "http://127.0.0.1:${server_port}/api/info" 5; then
    pass "a server that answers as carheadsup is up"
  else
    fail "hud_answers: the server answers, but was taken for down"
  fi
  stop_server
  start_server 503 '{"error":"The HUD is starting"}'
  local started=$SECONDS
  if hud_answers "http://127.0.0.1:${server_port}/api/info" 2; then
    fail "hud_answers: HTTP 503 was taken for a running server"
  elif ((SECONDS - started <= 5)); then
    pass "HTTP 503 does not count, and the wait ends on time"
  else
    fail "hud_answers: waited $((SECONDS - started)) s instead of 2"
  fi
  stop_server
  start_server 200 '{"name":"something-else"}'
  if hud_answers "http://127.0.0.1:${server_port}/api/info" 1; then
    fail "hud_answers: another service on the port was taken for carheadsup"
  else
    pass "another service on the port does not count"
  fi
  stop_server
}

# run_verify <code_replaced> <answer>…: run verify_started with the server answering ("yes") or
# not ("no") at each check and the rollback stubbed; sets `code`, `output` and `calls`.
# The stubs replace the sourced functions in a subshell, which shellcheck cannot follow.
# shellcheck disable=SC2317,SC2034
run_verify() {
  local replaced=$1
  shift
  printf '%s\n' "$@" >"${WORK}/answers"
  : >"${WORK}/calls"
  code=0
  output=$(
    hud_answers() {
      local answer
      answer=$(head -n 1 "${WORK}/answers")
      sed -i 1d "${WORK}/answers"
      echo "hud_answers $1" >>"${WORK}/calls"
      [[ $answer == yes ]]
    }
    roll_back() { echo roll_back >>"${WORK}/calls"; }
    config_host() { echo 0.0.0.0; }
    config_port() { echo 8090; }
    show_recent_log() { :; }
    code_replaced=$replaced
    opt_start_timeout=5
    verify_started 2>&1
  ) || code=$?
  calls=$(<"${WORK}/calls")
}

test_verify_started() {
  local code output calls
  run_verify 1 yes
  if [[ $code == 0 && $calls == "hud_answers http://127.0.0.1:8090/api/info" ]]; then
    pass "a server that answers: done, nothing rolled back"
  else
    fail "verify_started, answers: exit ${code}, calls ${calls}: ${output}"
  fi
  run_verify 1 no yes
  if [[ $code == 1 && $calls == *roll_back* && $output == *"rolled back"* ]]; then
    pass "an update that does not answer is rolled back (and the run fails)"
  else
    fail "verify_started, update fails: exit ${code}, calls ${calls}: ${output}"
  fi
  run_verify 1 no no
  if [[ $code == 1 && $output == *"neither"* ]]; then
    pass "when the previous version does not answer either, it says so"
  else
    fail "verify_started, both fail: exit ${code}, calls ${calls}: ${output}"
  fi
  run_verify 0 no
  if [[ $code == 1 && $calls != *roll_back* && $output == *"does not answer"* ]]; then
    pass "a first installation that does not answer fails without a rollback"
  else
    fail "verify_started, first install fails: exit ${code}, calls ${calls}: ${output}"
  fi
}

test_info_url() {
  local host expected actual
  while read -r host expected; do
    actual=$(info_url "$host" 8080)
    if [[ $actual == "$expected" ]]; then
      pass "server at ${host}: asked at ${actual}"
    else
      fail "info_url ${host}: expected ${expected}, got ${actual}"
    fi
  done <<'EOF'
0.0.0.0 http://127.0.0.1:8080/api/info
:: http://[::1]:8080/api/info
10.42.0.1 http://10.42.0.1:8080/api/info
fd00::1 http://[fd00::1]:8080/api/info
EOF
}

test_watchdog_conf() {
  local file="${WORK}/system.conf.d/carheadsup-watchdog.conf"
  if write_watchdog_conf "$file" && grep -qx 'RuntimeWatchdogSec=15' "$file" &&
    grep -qx '\[Manager\]' "$file"; then
    pass "the hardware watchdog setting is written"
  else
    fail "write_watchdog_conf: $(cat -- "$file" 2>&1)"
  fi
  if write_watchdog_conf "$file"; then
    fail "write_watchdog_conf rewrote an unchanged file (systemd would be re-executed for nothing)"
  else
    pass "an unchanged setting is left alone"
  fi
}

# rollback_choices <args>…: what `install.sh --rollback <args>` installs, given the kiosk unit
# and the watchdog drop-in that exist in ${WORK}/installed: "kiosk=<0|1> watchdog=<0|1>".
# The options are the sourced installer's, which shellcheck cannot follow.
# shellcheck disable=SC2154
rollback_choices() {
  (
    parse_args --rollback "$@"
    keep_installed_choices "${WORK}/installed/carheadsup-kiosk.service" \
      "${WORK}/installed/carheadsup-watchdog.conf"
    printf 'kiosk=%s watchdog=%s' "$opt_kiosk" "$opt_hardware_watchdog"
  ) 2>&1
}

# expect_choices <description> <expected> <args>…
expect_choices() {
  local description=$1 expected=$2 actual
  shift 2
  actual=$(rollback_choices "$@")
  if [[ $actual == "$expected" ]]; then
    pass "--rollback $description: ${actual}"
  else
    fail "--rollback ${description}: expected ${expected}, got ${actual}"
  fi
}

test_rollback_keeps_choices() {
  local dir="${WORK}/installed"
  mkdir -p "$dir"
  rm -f -- "${dir}/carheadsup-kiosk.service" "${dir}/carheadsup-watchdog.conf"
  # Installed with --no-kiosk --no-hardware-watchdog: a rollback must not bring either back.
  expect_choices "keeps the kiosk and the hardware watchdog off" "kiosk=0 watchdog=0"
  touch "${dir}/carheadsup-kiosk.service" "${dir}/carheadsup-watchdog.conf"
  expect_choices "keeps the kiosk and the hardware watchdog on" "kiosk=1 watchdog=1"
  expect_choices "with --no-kiosk --no-hardware-watchdog: off" "kiosk=0 watchdog=0" \
    --no-kiosk --no-hardware-watchdog
  rm -f -- "${dir}/carheadsup-watchdog.conf"
  expect_choices "keeps the kiosk on and the hardware watchdog off" "kiosk=1 watchdog=0"
}

test_swap_in
test_swap_previous
test_interrupted_swaps
test_hud_answers
test_verify_started
test_info_url
test_watchdog_conf
test_rollback_keeps_choices

if ((failures > 0)); then
  printf '%d install.sh update test(s) failed\n' "$failures" >&2
  exit 1
fi
