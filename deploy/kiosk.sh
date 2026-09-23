#!/usr/bin/env bash
# carheadsup kiosk browser. Runs inside the cage Wayland compositor (see
# deploy/systemd/carheadsup-kiosk.service): waits until the HUD server answers, then replaces
# itself with Chromium in kiosk mode showing the HUD page.
#
# Environment (set with `sudo systemctl edit carheadsup-kiosk`):
#   CARHEADSUP_KIOSK_URL     page to show (default http://localhost:8080/)
#   CARHEADSUP_KIOSK_WAIT_S  how long to wait for the server before starting anyway (default 60)
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

# True once `url` answers: an HTTP success with curl, or at least an open TCP port without it.
server_ready() {
  local url=$1
  if command -v curl >/dev/null 2>&1; then
    curl --silent --fail --output /dev/null --max-time 2 "$url"
    return
  fi
  local host port
  if [[ $url =~ ^https?://([^/:]+)(:([0-9]+))? ]]; then
    host=${BASH_REMATCH[1]}
    port=${BASH_REMATCH[3]:-80}
  else
    return 0
  fi
  (exec 3<>"/dev/tcp/${host}/${port}") 2>/dev/null
}

wait_for_server() {
  local url=$1 wait_s=$2
  local deadline=$((SECONDS + wait_s))
  until server_ready "$url"; do
    if ((SECONDS >= deadline)); then
      log "no answer from ${url} after ${wait_s} s; starting the browser anyway"
      return 0
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

  exec "$browser" \
    --kiosk \
    --ozone-platform=wayland \
    --user-data-dir="$profile" \
    --force-device-scale-factor="$scale" \
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
