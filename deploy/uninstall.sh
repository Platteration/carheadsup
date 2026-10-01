#!/usr/bin/env bash
# carheadsup: remove what deploy/install.sh installed.
#
#   sudo deploy/uninstall.sh            # remove the code, units and system files; keep config and data
#   sudo deploy/uninstall.sh --purge    # also delete config, data, trips and the two system users
#
# Idempotent: parts that are already gone are skipped. Packages installed with apt, the
# NetworkManager hotspot and edits to /boot/firmware are left alone; the default boot target
# stays graphical.target (`sudo systemctl set-default multi-user.target` to change it back).
set -euo pipefail

readonly PREFIX=/opt/carheadsup
readonly DATA_DIR=/var/lib/carheadsup
readonly CONFIG_DIR=/etc/carheadsup
readonly KIOSK_HOME=/var/lib/carheadsup-kiosk
readonly UNIT_DIR=/etc/systemd/system
readonly USERS=(carheadsup-kiosk carheadsup)
readonly SYSTEM_FILES=(
  "${UNIT_DIR}/carheadsup.service"
  "${UNIT_DIR}/carheadsup-kiosk.service"
  "${UNIT_DIR}/obd-rfcomm@.service"
  /etc/pam.d/carheadsup-kiosk
  /etc/udev/rules.d/99-carheadsup-backlight.rules
)
readonly AVAHI_SERVICE=/etc/avahi/services/carheadsup.service
readonly WATCHDOG_CONF=/etc/systemd/system.conf.d/carheadsup-watchdog.conf
readonly ENV_FILE=/etc/default/carheadsup

opt_purge=0

log() { printf '==> %s\n' "$*"; }
die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage: sudo deploy/uninstall.sh [--purge]

Remove carheadsup's code, systemd units and system files.

Options:
  --purge     Also delete /etc/carheadsup (config), /var/lib/carheadsup (state and trips),
              /etc/default/carheadsup and the system users carheadsup and carheadsup-kiosk
  -h, --help  Show this help
EOF
}

parse_args() {
  while (($# > 0)); do
    case $1 in
      --purge) opt_purge=1 ;;
      -h | --help)
        usage
        exit 0
        ;;
      *)
        usage >&2
        die "unknown option: $1"
        ;;
    esac
    shift
  done
}

# Every enabled or running obd-rfcomm@<MAC> instance.
rfcomm_instances() {
  local path
  shopt -s nullglob
  for path in "${UNIT_DIR}"/*.wants/obd-rfcomm@?*.service; do
    basename -- "$path"
  done
  shopt -u nullglob
  if command -v systemctl >/dev/null 2>&1; then
    systemctl list-units --all --plain --no-legend 'obd-rfcomm@*.service' 2>/dev/null |
      awk '{ print $1 }'
  fi
}

stop_services() {
  command -v systemctl >/dev/null 2>&1 || return 0
  local unit
  local -a units=(carheadsup-kiosk.service carheadsup.service)
  while IFS= read -r unit; do
    [[ -n $unit ]] && units+=("$unit")
  done < <(rfcomm_instances | sort -u)
  for unit in "${units[@]}"; do
    systemctl disable --now "$unit" >/dev/null 2>&1 || true
  done
  log "stopped and disabled ${units[*]}"
}

remove_files() {
  local file
  for file in "${SYSTEM_FILES[@]}"; do
    rm -f -- "$file"
  done
  if [[ -f $AVAHI_SERVICE ]] && grep -q '_carheadsup._tcp' "$AVAHI_SERVICE"; then
    rm -f -- "$AVAHI_SERVICE"
  fi
  rm -rf -- "$PREFIX" "${PREFIX}.new" "${PREFIX}.old" "${PREFIX}.prev" "${PREFIX}.swap"
  log "removed ${PREFIX} (and the previous version) and the system files"
  local watchdog=0
  if [[ -e $WATCHDOG_CONF ]]; then
    rm -f -- "$WATCHDOG_CONF"
    watchdog=1
    log "removed ${WATCHDOG_CONF} (the hardware watchdog setting)"
  fi
  if command -v systemctl >/dev/null 2>&1; then
    if ((watchdog)); then
      systemctl daemon-reexec || true
    else
      systemctl daemon-reload || true
    fi
  fi
  if command -v udevadm >/dev/null 2>&1; then
    udevadm control --reload-rules || true
  fi
}

purge() {
  rm -rf -- "$CONFIG_DIR" "$DATA_DIR" "$KIOSK_HOME" "$ENV_FILE"
  local user
  for user in "${USERS[@]}"; do
    if id -u "$user" >/dev/null 2>&1; then
      userdel "$user" || true
    fi
  done
  log "deleted the configuration, data and system users"
}

main() {
  parse_args "$@"
  ((EUID == 0)) || die "run this as root: sudo $0"
  stop_services
  remove_files
  if ((opt_purge)); then
    purge
  else
    log "kept ${CONFIG_DIR} and ${DATA_DIR} (use --purge to delete them)"
  fi
}

main "$@"
