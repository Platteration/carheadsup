#!/usr/bin/env bash
# carheadsup kiosk browser. Runs inside the cage Wayland compositor (see
# deploy/systemd/carheadsup-kiosk.service): waits until the HUD server answers, then replaces
# itself with Chromium in kiosk mode showing the HUD page.
#
# Chromium is only ever started on a page that loads. Its own "This site can't be reached" page
# is a large bright area in the driver's view, so while the server does not answer — it is
# starting, crash-looping, or listening on another port than CARHEADSUP_KIOSK_URL says — the
# screen stays black (cage draws black without a client) and the reason goes to the journal.
#
# Environment (set with `sudo systemctl edit carheadsup-kiosk`):
#   CARHEADSUP_KIOSK_URL     page to show (default http://localhost:8080/)
#   CARHEADSUP_KIOSK_WAIT_S  while the server does not answer, log a warning this often, in
#                            seconds (default 60); the kiosk keeps waiting either way
#   CARHEADSUP_KIOSK_SCALE   Chromium device scale factor (default 1: one CSS pixel per panel pixel)
#   CARHEADSUP_KIOSK_FLAGS   extra Chromium flags, separated by spaces
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
# starts or without a built renderer…) would show an error page, so it counts as not ready.
server_ready() {
  local url=$1
  if command -v curl >/dev/null 2>&1; then
    local status
    status=$(curl --silent --output /dev/null --max-time 2 --write-out '%{http_code}' "$url") ||
      status=000
    if [[ $status =~ ^[23][0-9][0-9]$ ]]; then
      return 0
    fi
    case $status in
      000) ready_problem="no answer" ;;
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
  local -a extra=()
  read -r -a extra <<<"${CARHEADSUP_KIOSK_FLAGS:-}"

  if ! [[ $wait_s =~ ^[0-9]+$ ]]; then
    log "CARHEADSUP_KIOSK_WAIT_S must be a whole number of seconds, got '${wait_s}'"
    exit 2
  fi
  wait_s=$((10#$wait_s))
  ((wait_s >= 1)) || wait_s=1

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
  exec "$browser" \
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
    "${extra[@]}" \
    "$url"
}

main "$@"
