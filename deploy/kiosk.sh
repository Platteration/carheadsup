#!/usr/bin/env bash
# carheadsup kiosk browser. Runs inside the cage Wayland compositor (see
# deploy/systemd/carheadsup-kiosk.service): waits until the HUD server answers, starts Chromium in
# kiosk mode showing the HUD page, and watches that the page keeps drawing.
#
# Chromium is only ever started on a page that loads. Its own "This site can't be reached" page
# is a large bright area in the driver's view, so while the server does not answer — it is
# starting, crash-looping, or listening on another port than CARHEADSUP_KIOSK_URL says — the
# screen stays black (cage draws black without a client) and the reason goes to the journal.
#
# The page's own guards blank the HUD when frames stop coming, but they run inside the page: a
# page whose main thread or compositor hangs, or whose renderer process crashed ("Aw, Snap!",
# e.g. killed for lack of memory), would leave its last image — speed, alerts — on the glass as if
# it were live, and Chromium itself does not exit then. So the page sends the server a heartbeat
# from its animation frames, and this script asks for its age (GET /api/kiosk/health) every 2 s.
# When the server answers but has had no heartbeat for CARHEADSUP_KIOSK_STALE_S, the browser is
# stopped: this script, and with it cage, exits, and systemd starts the kiosk again (on a page
# that loads). Never while the server does not answer (stopped, restarting — the page blanks
# itself then), never within CARHEADSUP_KIOSK_GRACE_S of starting the browser, and never because
# of a server that has no such endpoint.
#
# Environment (set with `sudo systemctl edit carheadsup-kiosk`):
#   CARHEADSUP_KIOSK_URL      page to show (default http://localhost:8080/)
#   CARHEADSUP_KIOSK_WAIT_S   while the server does not answer, log a warning this often, in
#                             seconds (default 60); the kiosk keeps waiting either way
#   CARHEADSUP_KIOSK_SCALE    Chromium device scale factor (default 1: one CSS pixel per panel pixel)
#   CARHEADSUP_KIOSK_FLAGS    extra Chromium flags, separated by spaces
#   CARHEADSUP_KIOSK_GRACE_S  seconds after starting Chromium before the page must send its
#                             heartbeat (default 30; more on a slow board); also how long a
#                             freshly started server may go without one
#   CARHEADSUP_KIOSK_STALE_S  restart the browser after this many seconds without a heartbeat
#                             (default 5; 0 switches the watchdog off)
#
# Chromium gets a fresh profile in the session's runtime directory (a tmpfs) on every start: no
# "restore pages?" prompt after the power is cut, and nothing written to the SD card.
set -euo pipefail

log() {
  printf 'carheadsup-kiosk: %s\n' "$*" >&2
}

find_browser() {
  local candidate
  for candidate in chromium chromium-browser; do
    if command -v "$candidate" >/dev/null 2>&1; then
      command -v "$candidate"
      return 0
    fi
  done
  return 1
}

# Why the last readiness check failed, for the log.
ready_problem=""

# True once `url` loads: an HTTP 2xx/3xx answer with curl, or at least an open TCP port without
# it. Anything else (no answer, 403 for a host name the server does not accept, 503 while it
# starts or without a built renderer, 307 when the server takes the kiosk for another device — it
# came through an address that is not this machine's own — and sends it to HTTPS, whose
# self-signed certificate Chromium would answer with its warning page…)
# would show an error page, so it counts as not ready.
server_ready() {
  local url=$1
  if command -v curl >/dev/null 2>&1; then
    local status
    status=$(curl --silent --output /dev/null --max-time 2 --write-out '%{http_code}' "$url") ||
      status=000
    if [[ $status =~ ^[23][0-9][0-9]$ && $status != 307 ]]; then
      return 0
    fi
    case $status in
      000) ready_problem="no answer" ;;
      307) ready_problem="HTTP 307: the server only serves other devices over HTTPS and took the kiosk for one; use an address of this machine in CARHEADSUP_KIOSK_URL: http://localhost:<port>/, or server.host when it names one address" ;;
      403) ready_problem="HTTP 403: does the server accept the host name in CARHEADSUP_KIOSK_URL?" ;;
      503) ready_problem="HTTP 503: still starting, or the renderer is not built" ;;
      *) ready_problem="HTTP ${status}" ;;
    esac
    return 1
  fi
  local host port
  if [[ $url =~ ^https?://([^/:]+)(:([0-9]+))? ]]; then
    host=${BASH_REMATCH[1]}
    port=${BASH_REMATCH[3]:-80}
  else
    return 0
  fi
  ready_problem="no answer"
  (exec 3<>"/dev/tcp/${host}/${port}") 2>/dev/null
}

# The server's health endpoint for the page at `url` (same scheme, host and port), or nothing
# when `url` is not an http(s) URL.
health_url() {
  local url=$1
  if [[ $url =~ ^(https?://[^/?#]+) ]]; then
    printf '%s/api/kiosk/health' "${BASH_REMATCH[1]}"
  fi
}

# The verdict on one health answer (the JSON of GET /api/kiosk/health), on stdout: "ok", "stale"
# followed by the reason, or "unknown" for an answer without the fields (another server).
#
#   health_verdict <body> <stale after, ms> <grace, ms>
health_verdict() {
  local body=$1 stale_ms=$2 grace_ms=$3 alive uptime
  if [[ ! $body =~ \"aliveAgoMs\"[[:space:]]*:[[:space:]]*(null|[0-9]+) ]]; then
    echo unknown
    return
  fi
  alive=${BASH_REMATCH[1]}
  if [[ ! $body =~ \"uptimeMs\"[[:space:]]*:[[:space:]]*([0-9]+) ]]; then
    echo unknown
    return
  fi
  uptime=${BASH_REMATCH[1]}
  if [[ $alive == null ]]; then
    # A server that just (re)started has not heard from the page yet: the page reconnects within
    # seconds, so only a long silence counts.
    if ((uptime > grace_ms)); then
      echo "stale the page has sent no heartbeat since the server started $((uptime / 1000)) s ago"
    else
      echo ok
    fi
  elif ((alive > stale_ms)); then
    echo "stale the page has sent no heartbeat for $((alive / 1000)) s"
  else
    echo ok
  fi
}

# Ask the server how the page is doing: prints the verdict (see health_verdict), or "unknown"
# when the server does not answer with one (stopped, starting, an older version).
#
#   check_health <health URL> <stale after, ms> <grace, ms>
check_health() {
  local url=$1 stale_ms=$2 grace_ms=$3 reply status
  reply=$(curl --silent --max-time 2 --write-out '\n%{http_code}' "$url" 2>/dev/null) || true
  status=${reply##*$'\n'}
  if [[ $status != 200 ]]; then
    echo unknown
    return
  fi
  health_verdict "${reply%$'\n'*}" "$stale_ms" "$grace_ms"
}

# Stop the browser: SIGTERM, and SIGKILL when it is still there after 5 s.
stop_browser() {
  local pid=$1 i
  kill -TERM "$pid" 2>/dev/null || return 0
  for ((i = 0; i < 50; i++)); do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 0.1
  done
  log "Chromium did not stop within 5 s; killing it"
  kill -KILL "$pid" 2>/dev/null || true
}

# Wait for the browser to exit while checking every 2 s that the page still draws; stop it when
# it does not. Returns the browser's exit status, or 1 after stopping it.
#
#   supervise <browser pid> <health URL or ""> <grace, s> <stale after, s>
supervise() {
  local pid=$1 url=$2 grace_s=$3 stale_s=$4
  local started=$SECONDS verdict
  local watching=1
  if [[ -z $url ]] || ((stale_s == 0)); then
    watching=0
  elif ! command -v curl >/dev/null 2>&1; then
    log "curl is not installed: a hung or crashed page is not noticed (sudo apt install curl)"
    watching=0
  fi
  while kill -0 "$pid" 2>/dev/null; do
    # In the background, so that a SIGTERM (systemd stopping the kiosk) is handled at once.
    sleep 2 >/dev/null 2>&1 &
    wait $! || true
    ((watching)) || continue
    kill -0 "$pid" 2>/dev/null || break
    ((SECONDS - started >= grace_s)) || continue
    verdict=$(check_health "$url" "$((stale_s * 1000))" "$((grace_s * 1000))")
    if [[ $verdict == stale* ]]; then
      log "${verdict#stale }: it is hung or has crashed; restarting the browser"
      stop_browser "$pid"
      wait "$pid" 2>/dev/null || true
      return 1
    fi
  done
  local status=0
  wait "$pid" || status=$?
  log "Chromium exited (status ${status})"
  return "$status"
}

# Wait until `url` loads, however long that takes, with a warning every `warn_s` seconds.
wait_for_server() {
  local url=$1 warn_s=$2
  local started=$SECONDS
  local next_warning=$((SECONDS + warn_s))
  until server_ready "$url"; do
    if ((SECONDS >= next_warning)); then
      log "waiting for ${url} for $((SECONDS - started)) s (${ready_problem}); the screen stays black until it loads (is carheadsup.service running on that port? systemctl status carheadsup)"
      next_warning=$((SECONDS + warn_s))
    fi
    sleep 1
  done
}

main() {
  local url=${CARHEADSUP_KIOSK_URL:-http://localhost:8080/}
  local wait_s=${CARHEADSUP_KIOSK_WAIT_S:-60}
  local scale=${CARHEADSUP_KIOSK_SCALE:-1}
  local grace_s=${CARHEADSUP_KIOSK_GRACE_S:-30}
  local stale_s=${CARHEADSUP_KIOSK_STALE_S:-5}
  local -a extra=()
  read -r -a extra <<<"${CARHEADSUP_KIOSK_FLAGS:-}"

  local name value
  for name in CARHEADSUP_KIOSK_WAIT_S CARHEADSUP_KIOSK_GRACE_S CARHEADSUP_KIOSK_STALE_S; do
    value=${!name:-0}
    if ! [[ $value =~ ^[0-9]+$ ]]; then
      log "${name} must be a whole number of seconds, got '${value}'"
      exit 2
    fi
  done
  wait_s=$((10#$wait_s))
  ((wait_s >= 1)) || wait_s=1
  grace_s=$((10#$grace_s))
  stale_s=$((10#$stale_s))

  local browser
  if ! browser=$(find_browser); then
    log "Chromium is not installed (sudo apt install chromium-browser, or chromium)"
    exit 1
  fi

  local profile="${XDG_RUNTIME_DIR:-/tmp}/carheadsup-chromium"
  rm -rf -- "$profile"
  mkdir -p -- "$profile"

  wait_for_server "$url" "$wait_s"
  log "starting ${browser} on ${url}"

  # --force-dark-mode: should a page still fail to load later (the server restarting just then),
  # Chromium's error page is dark grey instead of white. The HUD page itself is always dark.
  # --disable-hang-monitor: no "Page unresponsive" dialog on the windshield; a hung page is this
  # script's to handle. --enable-logging=stderr: Chromium's warnings and errors (a crashed
  # renderer, GPU trouble) reach the journal.
  local browser_pid=""
  trap 'if [[ -n $browser_pid ]]; then stop_browser "$browser_pid"; fi; exit 143' TERM INT HUP
  "$browser" \
    --kiosk \
    --ozone-platform=wayland \
    --user-data-dir="$profile" \
    --force-device-scale-factor="$scale" \
    --force-dark-mode \
    --no-first-run \
    --no-default-browser-check \
    --noerrdialogs \
    --disable-infobars \
    --disable-session-crashed-bubble \
    --disable-features=Translate,TranslateUI \
    --disable-pinch \
    --overscroll-history-navigation=0 \
    --password-store=basic \
    --check-for-update-interval=31536000 \
    --hide-scrollbars \
    --disable-hang-monitor \
    --enable-logging=stderr \
    --log-level=1 \
    "${extra[@]}" \
    "$url" &
  browser_pid=$!
  local status=0
  supervise "$browser_pid" "$(health_url "$url")" "$grace_s" "$stale_s" || status=$?
  exit "$status"
}

main "$@"
