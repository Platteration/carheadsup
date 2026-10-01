#!/usr/bin/env bash
# carheadsup: install or update the HUD on Raspberry Pi OS (Bookworm, 64-bit) or another
# systemd-based Debian. Run it as root from a checkout in which `npm ci` and `npm run build`
# have completed:
#
#   sudo deploy/install.sh [--obd-mac AA:BB:CC:DD:EE:FF] [--no-kiosk] [--no-start] [--no-prune]
#   sudo deploy/install.sh --rollback
#
# What it does (every step is idempotent, so re-running it after
# `git pull && npm ci && npm run build` is how you update):
#
#   - creates the system user "carheadsup" (groups i2c, gpio, dialout, video) that runs the
#     server, and "carheadsup-kiosk" (video, render, input) that runs the kiosk browser;
#   - copies the built code to /opt/carheadsup (owned by root, without devDependencies), flushed
#     to disk before and after it replaces the old copy, which is kept as /opt/carheadsup.prev;
#   - creates /var/lib/carheadsup (data) and /etc/carheadsup (config.json, created with defaults
#     and a random pairing code by the server on its first start), keeping whatever is already
#     there;
#   - installs /etc/default/carheadsup (once), a udev rule for the display backlight, the kiosk's
#     PAM stack, the static Avahi advertisement when avahi-utils is missing, and the systemd
#     units carheadsup.service, carheadsup-kiosk.service and obd-rfcomm@.service;
#   - lets the hardware watchdog reset a frozen system (RuntimeWatchdogSec, when there is one);
#   - enables and (re)starts the services, and waits until the server answers: after an update
#     that does not, it goes back to the previous version by itself.
#
# See docs/install-raspberry-pi.md for the whole procedure, and deploy/uninstall.sh to undo it.
set -euo pipefail
umask 022

readonly SERVICE_USER=carheadsup
readonly KIOSK_USER=carheadsup-kiosk
readonly PREFIX=/opt/carheadsup
readonly DATA_DIR=/var/lib/carheadsup
readonly CONFIG_DIR=/etc/carheadsup
readonly CONFIG_FILE=${CONFIG_DIR}/config.json
readonly KIOSK_HOME=/var/lib/carheadsup-kiosk
readonly UNIT_DIR=/etc/systemd/system
readonly ENV_FILE=/etc/default/carheadsup
readonly PAM_FILE=/etc/pam.d/carheadsup-kiosk
readonly UDEV_RULE=/etc/udev/rules.d/99-carheadsup-backlight.rules
readonly AVAHI_DIR=/etc/avahi/services
readonly AVAHI_SERVICE=${AVAHI_DIR}/carheadsup.service
readonly WATCHDOG_CONF=/etc/systemd/system.conf.d/carheadsup-watchdog.conf
readonly SERVICE_GROUPS=(i2c gpio dialout video)
readonly KIOSK_GROUPS=(video render input)
# What the HUD needs at runtime (docs are referenced by the units' Documentation= lines).
readonly COPY_ITEMS=(package.json package-lock.json node_modules packages deploy docs README.md)
readonly RENDERER_PAGES=(index.html settings.html dev.html)

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
REPO_ROOT=$(cd -- "${SCRIPT_DIR}/.." && pwd -P)
readonly SCRIPT_DIR REPO_ROOT

opt_kiosk=1
opt_kiosk_given=0
opt_start=1
opt_prune=1
opt_obd_mac=""
opt_rollback=0
opt_hardware_watchdog=1
opt_hardware_watchdog_given=0
opt_start_timeout=60
NODE_BIN=""
WORK_DIR=""
# Set by install_code when this run replaced an installed version (which can be rolled back to).
code_replaced=0

usage() {
  cat <<'EOF'
Usage: sudo deploy/install.sh [options]

Install or update carheadsup from this (built) checkout.

Options:
  --obd-mac <MAC>  Bind /dev/rfcomm0 to this paired Bluetooth OBD-II adapter at boot
                   (enables obd-rfcomm@<MAC>.service)
  --no-kiosk       Do not install the Chromium kiosk (removes it if it was installed)
  --no-start       Install and enable the services, but do not (re)start them now
  --no-prune       Keep devDependencies in /opt/carheadsup
  --no-hardware-watchdog
                   Do not let the hardware watchdog reset a frozen system (removes the setting
                   if it was installed)
  --start-timeout <s>
                   How long to wait for the restarted server to answer (default 60; 0: do not
                   wait). After an update that does not answer in time, the previous version
                   is put back by itself.
  --rollback       Go back to the version before the last update (/opt/carheadsup.prev, with its
                   systemd units); running it again goes forward again. Keeps the kiosk and the
                   hardware watchdog as installed, unless --no-kiosk or --no-hardware-watchdog
  -h, --help       Show this help
EOF
}

log() { printf '==> %s\n' "$*"; }
warn() { printf 'warning: %s\n' "$*" >&2; }
die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

parse_args() {
  while (($# > 0)); do
    case $1 in
      --no-kiosk)
        opt_kiosk=0
        opt_kiosk_given=1
        ;;
      --no-start) opt_start=0 ;;
      --no-prune) opt_prune=0 ;;
      --no-hardware-watchdog)
        opt_hardware_watchdog=0
        opt_hardware_watchdog_given=1
        ;;
      --rollback) opt_rollback=1 ;;
      --start-timeout)
        (($# >= 2)) || die "--start-timeout needs a number of seconds"
        opt_start_timeout=$2
        shift
        ;;
      --start-timeout=*) opt_start_timeout=${1#*=} ;;
      --obd-mac)
        (($# >= 2)) || die "--obd-mac needs a MAC address"
        opt_obd_mac=$2
        shift
        ;;
      --obd-mac=*) opt_obd_mac=${1#*=} ;;
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
  [[ $opt_start_timeout =~ ^[0-9]{1,5}$ ]] ||
    die "--start-timeout needs a whole number of seconds, got '${opt_start_timeout}'"
  opt_start_timeout=$((10#$opt_start_timeout))
  if [[ -n $opt_obd_mac ]]; then
    opt_obd_mac=${opt_obd_mac^^}
    [[ $opt_obd_mac =~ ^([0-9A-F]{2}:){5}[0-9A-F]{2}$ ]] ||
      die "not a Bluetooth MAC address: ${opt_obd_mac} (expected e.g. 00:1D:A5:68:98:8B)"
  fi
}

# True for Node.js >= 22.18 (type stripping on by default); 23.6+ and 24+ qualify too.
node_version_ok() {
  "$NODE_BIN" -e '
    const [major, minor] = process.versions.node.split(".").map(Number);
    const ok = major >= 24 || (major === 23 && minor >= 6) || (major === 22 && minor >= 18);
    process.exit(ok ? 0 : 1);
  '
}

preflight() {
  ((EUID == 0)) || die "run this as root: sudo $0"
  command -v systemctl >/dev/null 2>&1 || die "systemd is required"
  if ! grep -qs '"name": "carheadsup"' "${REPO_ROOT}/package.json"; then
    die "${REPO_ROOT} is not a carheadsup checkout"
  fi

  NODE_BIN=$(command -v node) || die "Node.js is not installed (see docs/install-raspberry-pi.md)"
  local resolved
  resolved=$(readlink -f -- "$NODE_BIN")
  case $resolved in
    /home/* | /root/*)
      die "Node.js at ${resolved} is inside a home directory, which the service cannot read; install it system-wide (NodeSource or /usr/local)"
      ;;
  esac
  [[ $NODE_BIN =~ ^[A-Za-z0-9._/+-]+$ ]] || die "unsupported characters in the Node.js path: ${NODE_BIN}"
  node_version_ok || die "Node.js $("$NODE_BIN" --version) is too old; carheadsup needs 22.18 or newer"

  if ((opt_rollback)); then
    [[ -d ${PREFIX}.prev ]] || die "there is no previous version to go back to (${PREFIX}.prev)"
    keep_installed_choices "${UNIT_DIR}/carheadsup-kiosk.service" "$WATCHDOG_CONF"
  else
    [[ -d ${REPO_ROOT}/node_modules/@carheadsup ]] ||
      die "dependencies are missing: run 'npm ci' in ${REPO_ROOT} first"
    local page
    for page in "${RENDERER_PAGES[@]}"; do
      [[ -f ${REPO_ROOT}/packages/hud-renderer/dist/${page} ]] ||
        die "the renderer is not built: run 'npm run build' in ${REPO_ROOT} first"
    done
  fi

  if ((opt_kiosk)); then
    command -v cage >/dev/null 2>&1 ||
      die "cage is not installed (sudo apt install cage), or run with --no-kiosk"
    command -v chromium >/dev/null 2>&1 || command -v chromium-browser >/dev/null 2>&1 ||
      die "Chromium is not installed (sudo apt install chromium-browser), or run with --no-kiosk"
  fi
}

# A rollback keeps the kiosk and the hardware watchdog as they are installed — off when their
# unit or drop-in is missing (an installation with --no-kiosk or --no-hardware-watchdog) —
# unless its own command line says otherwise.
#
#   keep_installed_choices <kiosk unit file> <watchdog drop-in>
keep_installed_choices() {
  local kiosk_unit=$1 watchdog_conf=$2
  if ((!opt_kiosk_given)) && [[ ! -e $kiosk_unit ]]; then
    opt_kiosk=0
  fi
  if ((!opt_hardware_watchdog_given)) && [[ ! -e $watchdog_conf ]]; then
    opt_hardware_watchdog=0
  fi
}

# Create a system user (with its own group) unless it exists; add it to those of `groups` that
# exist on this system.
ensure_user() {
  local user=$1 home=$2 comment=$3
  shift 3
  if ! id -u "$user" >/dev/null 2>&1; then
    log "creating system user ${user}"
    useradd --system --user-group --home-dir "$home" --no-create-home \
      --shell /usr/sbin/nologin --comment "$comment" "$user"
  fi
  local group
  local -a present=()
  for group in "$@"; do
    if getent group "$group" >/dev/null; then
      present+=("$group")
    else
      warn "group ${group} does not exist here; ${user} is not added to it"
    fi
  done
  if ((${#present[@]} > 0)); then
    usermod --append --groups "$(
      IFS=,
      printf '%s' "${present[*]}"
    )" "$user"
  fi
}

ensure_directories() {
  install -d -m 0700 -o "$SERVICE_USER" -g "$SERVICE_USER" "$DATA_DIR"
  install -d -m 0750 -o "$SERVICE_USER" -g "$SERVICE_USER" "$CONFIG_DIR"
  chown -R "${SERVICE_USER}:${SERVICE_USER}" "$DATA_DIR" "$CONFIG_DIR"
  # The config holds the API and pairing tokens.
  find "$CONFIG_DIR" -maxdepth 1 -type f -exec chmod 0600 {} +
}

# Put the staged tree <stage> in place as <prefix>, keeping the tree it replaces as
# <prefix>.prev (for --rollback). Safe against a power cut — likely in a car, right after an
# update: the staged files are flushed to disk before the renames (ext4 can hold freshly written
# files in RAM for half a minute, and a power cut would leave them empty: a server that cannot
# start, ever), and the renames before the services restart. The two renames normally reach the
# disk together; should a power cut fall between them, the next run of the installer finds no
# <prefix> and puts <prefix>.prev back (finish_interrupted_swap).
#
#   swap_in <stage> <prefix>
swap_in() {
  local stage=$1 prefix=$2
  sync
  if [[ -e $prefix ]]; then
    rm -rf -- "${prefix}.prev"
    mv -- "$prefix" "${prefix}.prev"
  fi
  mv -- "$stage" "$prefix"
  sync
}

# Swap <prefix> and <prefix>.prev: the version before the last update becomes the installed one,
# and the installed one becomes <prefix>.prev, so that running it again goes forward again.
# Fails (changing nothing) when there is no <prefix>.prev.
#
#   swap_previous <prefix>
swap_previous() {
  local prefix=$1
  [[ -d ${prefix}.prev ]] || return 1
  rm -rf -- "${prefix}.swap"
  sync
  if [[ -e $prefix ]]; then
    mv -- "$prefix" "${prefix}.swap"
  fi
  mv -- "${prefix}.prev" "$prefix"
  if [[ -e ${prefix}.swap ]]; then
    mv -- "${prefix}.swap" "${prefix}.prev"
  fi
  sync
}

# Repair what a power cut between the renames of swap_in or swap_previous left behind: no
# <prefix> (put back the one that was moved away), or a <prefix>.swap still waiting to become
# <prefix>.prev.
#
#   finish_interrupted_swap <prefix>
finish_interrupted_swap() {
  local prefix=$1
  if [[ ! -e $prefix ]]; then
    if [[ -e ${prefix}.swap ]]; then
      mv -- "${prefix}.swap" "$prefix"
    elif [[ -d ${prefix}.prev ]]; then
      mv -- "${prefix}.prev" "$prefix"
    else
      return 0
    fi
    warn "an earlier update was cut short; ${prefix} is back"
  elif [[ -e ${prefix}.swap ]]; then
    if [[ -e ${prefix}.prev ]]; then
      rm -rf -- "${prefix}.swap"
    else
      mv -- "${prefix}.swap" "${prefix}.prev"
    fi
  else
    return 0
  fi
  sync
}

# Copy the runtime files into a staging directory, drop devDependencies, check that the copy
# runs, then swap it into place (see swap_in).
install_code() {
  if [[ $REPO_ROOT == "$PREFIX" ]]; then
    log "running from ${PREFIX} itself; using the checkout in place"
    return
  fi
  local stage="${PREFIX}.new" item
  # .old: left behind by installers before the rollback.
  rm -rf -- "$stage" "${PREFIX}.old"
  install -d -m 0755 "$stage"
  log "copying the HUD to ${PREFIX}"
  for item in "${COPY_ITEMS[@]}"; do
    if [[ -e ${REPO_ROOT}/${item} ]]; then
      cp -a -- "${REPO_ROOT}/${item}" "${stage}/"
    elif [[ $item != docs && $item != README.md ]]; then
      die "${REPO_ROOT}/${item} is missing"
    fi
  done
  if ((opt_prune)); then
    if ! command -v npm >/dev/null 2>&1; then
      warn "npm not found; keeping devDependencies"
    elif ! (cd -- "$stage" && npm prune --omit=dev --offline --no-audit --no-fund >/dev/null); then
      warn "'npm prune --omit=dev' failed; keeping devDependencies"
    fi
  fi
  chown -R root:root "$stage"
  chmod -R go-w "$stage"
  chmod 0755 "${stage}/deploy/"*.sh
  "$NODE_BIN" "${stage}/packages/hud-server/src/main.ts" --version >/dev/null ||
    die "the copied server does not start; ${PREFIX} was left unchanged"
  if [[ -e $PREFIX ]]; then
    code_replaced=1
  fi
  swap_in "$stage" "$PREFIX"
}

# The unit's effective ExecStart line: a drop-in resets ExecStart with an empty
# assignment and then sets it again, so the last non-empty one wins. Continuation lines are
# joined first.
#
#   exec_start_line <unit files, concatenated>
exec_start_line() {
  local unit_text=$1 exec_line="" line
  unit_text=${unit_text//$'\\\n'/ }
  while IFS= read -r line; do
    if [[ $line =~ ^[[:space:]]*ExecStart=(.+)$ ]]; then
      exec_line=${BASH_REMATCH[1]}
    fi
  done <<<"$unit_text"
  printf '%s' "$exec_line"
}

# The port the server will listen on, resolved the way the server does it: `--port` on the
# unit's ExecStart (a drop-in may add it), else CARHEADSUP_PORT from the environment file, else
# server.port in the config file the unit passes with `--config` (the read-only-root recipe
# moves it), else 8080. Used for the static Avahi advertisement and the summary.
#
#   effective_port <unit files, concatenated> <environment file> <default config file>
effective_port() {
  local unit_text=$1 env_file=$2 config=$3
  local flag_port="" env_port="" line

  local -a words=()
  read -r -a words <<<"$(exec_start_line "$unit_text")"
  local i
  for ((i = 0; i < ${#words[@]}; i++)); do
    case ${words[i]} in
      --port) flag_port=${words[i + 1]:-} ;;
      --port=*) flag_port=${words[i]#*=} ;;
      --config) config=${words[i + 1]:-$config} ;;
      --config=*) config=${words[i]#*=} ;;
    esac
  done

  if [[ -r $env_file ]]; then
    while IFS= read -r line; do
      if [[ $line =~ ^[[:space:]]*CARHEADSUP_PORT=[\"\']?([0-9]+)[\"\']?[[:space:]]*$ ]]; then
        env_port=${BASH_REMATCH[1]}
      fi
    done <"$env_file"
  fi

  local candidate
  for candidate in "$flag_port" "$env_port"; do
    # 0 means "any free port", which cannot be advertised statically.
    if [[ $candidate =~ ^[0-9]{1,5}$ ]] && ((10#$candidate >= 1 && 10#$candidate <= 65535)); then
      printf '%d' "$((10#$candidate))"
      return
    fi
  done
  "$NODE_BIN" -e '
    let port = 8080;
    try {
      const config = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
      const value = config?.server?.port;
      if (Number.isInteger(value) && value > 0 && value < 65536) port = value;
    } catch {}
    process.stdout.write(String(port));
  ' "$config"
}

# The TLS port of the phone link, resolved the same way: `--tls-port` on the unit's ExecStart,
# else CARHEADSUP_TLS_PORT, else server.tlsPort in the config file, else 8443 (8444 for a config
# from before TLS whose server.port is 8443, as the server's parseConfig does it) — or "off" when
# the TLS listener is switched off (`--tls-port off`, or "tlsPort": null). Used for the static
# Avahi advertisement (TXT tls, which the companion app connects to) and the summary.
#
#   effective_tls_port <unit files, concatenated> <environment file> <default config file>
effective_tls_port() {
  local unit_text=$1 env_file=$2 config=$3
  local flag_port="" env_port="" line

  local -a words=()
  read -r -a words <<<"$(exec_start_line "$unit_text")"
  local i
  for ((i = 0; i < ${#words[@]}; i++)); do
    case ${words[i]} in
      --tls-port) flag_port=${words[i + 1]:-} ;;
      --tls-port=*) flag_port=${words[i]#*=} ;;
      --config) config=${words[i + 1]:-$config} ;;
      --config=*) config=${words[i]#*=} ;;
    esac
  done

  if [[ -r $env_file ]]; then
    while IFS= read -r line; do
      if [[ $line =~ ^[[:space:]]*CARHEADSUP_TLS_PORT=[\"\']?([A-Za-z0-9]+)[\"\']?[[:space:]]*$ ]]; then
        env_port=${BASH_REMATCH[1]}
      fi
    done <"$env_file"
  fi

  local candidate
  for candidate in "$flag_port" "$env_port"; do
    case ${candidate,,} in
      off | none | false | no)
        printf 'off'
        return
        ;;
    esac
    # 0 means "any free port", which cannot be advertised statically.
    if [[ $candidate =~ ^[0-9]{1,5}$ ]] && ((10#$candidate >= 1 && 10#$candidate <= 65535)); then
      printf '%d' "$((10#$candidate))"
      return
    fi
  done
  "$NODE_BIN" -e '
    let port = "8443";
    try {
      const config = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
      const value = config?.server?.tlsPort;
      if (value === null) port = "off";
      else if (Number.isInteger(value) && value > 0 && value < 65536) port = String(value);
      else if (value === undefined && config?.server?.port === 8443) port = "8444";
    } catch {}
    process.stdout.write(port);
  ' "$config"
}

# The address the server will listen on, resolved like the port: `--host` on the unit's
# ExecStart, else CARHEADSUP_HOST from the environment file, else server.host in the config file,
# else 0.0.0.0.
#
#   effective_host <unit files, concatenated> <environment file> <default config file>
effective_host() {
  local unit_text=$1 env_file=$2 config=$3
  local flag_host="" env_host="" line

  local -a words=()
  read -r -a words <<<"$(exec_start_line "$unit_text")"
  local i
  for ((i = 0; i < ${#words[@]}; i++)); do
    case ${words[i]} in
      --host) flag_host=${words[i + 1]:-} ;;
      --host=*) flag_host=${words[i]#*=} ;;
      --config) config=${words[i + 1]:-$config} ;;
      --config=*) config=${words[i]#*=} ;;
    esac
  done

  if [[ -r $env_file ]]; then
    while IFS= read -r line; do
      if [[ $line =~ ^[[:space:]]*CARHEADSUP_HOST=[\"\']?([0-9A-Za-z.:%_-]+)[\"\']?[[:space:]]*$ ]]; then
        env_host=${BASH_REMATCH[1]}
      fi
    done <"$env_file"
  fi

  local candidate
  for candidate in "$flag_host" "$env_host"; do
    if [[ $candidate =~ ^[0-9A-Za-z.:%_-]+$ ]]; then
      printf '%s' "$candidate"
      return
    fi
  done
  "$NODE_BIN" -e '
    let host = "0.0.0.0";
    try {
      const config = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
      const value = config?.server?.host;
      if (typeof value === "string" && /^[0-9A-Za-z.:%_-]+$/.test(value)) host = value;
    } catch {}
    process.stdout.write(host);
  ' "$config"
}

# Where the installer asks the server whether it runs: /api/info at an address the server listens
# on (loopback when it listens on all of them).
#
#   info_url <host> <port>
info_url() {
  local host=$1 port=$2
  case $host in
    '' | 0.0.0.0) host=127.0.0.1 ;;
    ::) host='[::1]' ;;
    *:*) host="[${host}]" ;;
  esac
  printf 'http://%s:%s/api/info' "$host" "$port"
}

# effective_host for the installed unit, its drop-ins and /etc/default/carheadsup.
config_host() {
  local unit_text
  unit_text=$(cat -- "${UNIT_DIR}/carheadsup.service" "${UNIT_DIR}/carheadsup.service.d/"*.conf 2>/dev/null || true)
  effective_host "$unit_text" "$ENV_FILE" "$CONFIG_FILE"
}

# effective_port for the installed unit, its drop-ins and /etc/default/carheadsup.
config_port() {
  local unit_text
  unit_text=$(cat -- "${UNIT_DIR}/carheadsup.service" "${UNIT_DIR}/carheadsup.service.d/"*.conf 2>/dev/null || true)
  effective_port "$unit_text" "$ENV_FILE" "$CONFIG_FILE"
}

# effective_tls_port for the installed unit, its drop-ins and /etc/default/carheadsup.
config_tls_port() {
  local unit_text
  unit_text=$(cat -- "${UNIT_DIR}/carheadsup.service" "${UNIT_DIR}/carheadsup.service.d/"*.conf 2>/dev/null || true)
  effective_tls_port "$unit_text" "$ENV_FILE" "$CONFIG_FILE"
}

# The static Avahi service file (on stdin) for the given ports: the service's port, and the TXT
# record tls with the phone link's port — left out when TLS is off.
#
#   static_avahi_service <port> <TLS port or "off">
static_avahi_service() {
  local port=$1 tls_port=$2
  if [[ $tls_port == off ]]; then
    sed -e "s#<port>8080</port>#<port>${port}</port>#" -e '/<txt-record>tls=8443<\/txt-record>/d'
  else
    sed -e "s#<port>8080</port>#<port>${port}</port>#" \
      -e "s#<txt-record>tls=8443</txt-record>#<txt-record>tls=${tls_port}</txt-record>#"
  fi
}

install_system_files() {
  local tmp="${WORK_DIR}/file"

  install -D -m 0644 "${PREFIX}/deploy/udev/99-carheadsup-backlight.rules" "$UDEV_RULE"
  if command -v udevadm >/dev/null 2>&1; then
    udevadm control --reload-rules || true
    udevadm trigger --subsystem-match=backlight --action=add || true
    udevadm trigger --subsystem-match=pwm --action=add || true
  fi

  if [[ ! -e $ENV_FILE ]]; then
    install -m 0644 "${PREFIX}/deploy/default/carheadsup" "$ENV_FILE"
  fi

  sed "s#^ExecStart=/usr/bin/node #ExecStart=${NODE_BIN} #" \
    "${PREFIX}/deploy/systemd/carheadsup.service" >"$tmp"
  install -m 0644 "$tmp" "${UNIT_DIR}/carheadsup.service"
  install -m 0644 "${PREFIX}/deploy/systemd/obd-rfcomm@.service" "${UNIT_DIR}/obd-rfcomm@.service"

  if command -v avahi-publish-service >/dev/null 2>&1; then
    # The server advertises itself; a static file as well would show the HUD twice.
    if [[ -f $AVAHI_SERVICE ]] && grep -q '_carheadsup._tcp' "$AVAHI_SERVICE"; then
      rm -f -- "$AVAHI_SERVICE"
      log "removed ${AVAHI_SERVICE} (the server advertises itself through avahi-utils)"
    fi
  elif [[ -d $AVAHI_DIR ]]; then
    static_avahi_service "$(config_port)" "$(config_tls_port)" \
      <"${PREFIX}/deploy/avahi/carheadsup.service" >"$tmp"
    install -m 0644 "$tmp" "$AVAHI_SERVICE"
    log "installed the static mDNS advertisement ${AVAHI_SERVICE}"
  else
    warn "Avahi is not installed: the phone cannot find the HUD by itself (sudo apt install avahi-daemon avahi-utils)"
  fi
}

# The systemd drop-in that lets the hardware watchdog reset a frozen system.
watchdog_conf() {
  cat <<'EOF'
# carheadsup (deploy/install.sh): let the hardware watchdog reset the system when the kernel or
# systemd freezes, instead of a frozen HUD keeping its last image (speed, alerts) on the
# windshield as if it were live. systemd pets the watchdog while it runs. 15 s is the longest the
# Raspberry Pi's watchdog can wait. Remove with: sudo deploy/install.sh --no-hardware-watchdog
[Manager]
RuntimeWatchdogSec=15
EOF
}

# Write the watchdog drop-in to <file> unless it already says the same. True when it changed.
#
#   write_watchdog_conf <file>
write_watchdog_conf() {
  local file=$1 wanted
  wanted=$(watchdog_conf)
  if [[ -f $file && $(<"$file") == "$wanted" ]]; then
    return 1
  fi
  install -d -m 0755 "$(dirname -- "$file")"
  printf '%s\n' "$wanted" >"${file}.tmp"
  chmod 0644 "${file}.tmp"
  mv -- "${file}.tmp" "$file"
}

# With --no-hardware-watchdog, remove the drop-in; otherwise install it where there is a
# watchdog device. systemd reads its own settings only when it starts (or re-executes).
configure_hardware_watchdog() {
  if ((!opt_hardware_watchdog)); then
    if [[ -e $WATCHDOG_CONF ]]; then
      rm -f -- "$WATCHDOG_CONF"
      systemctl daemon-reexec
      log "removed ${WATCHDOG_CONF} (--no-hardware-watchdog)"
    fi
    return
  fi
  if ! compgen -G '/dev/watchdog*' >/dev/null; then
    warn "no hardware watchdog (/dev/watchdog): a frozen system keeps its last image on the display until the power is cut"
    return
  fi
  if write_watchdog_conf "$WATCHDOG_CONF"; then
    systemctl daemon-reexec
    log "hardware watchdog: a frozen system resets after 15 s (${WATCHDOG_CONF})"
  fi
}

install_kiosk() {
  ensure_user "$KIOSK_USER" "$KIOSK_HOME" "carheadsup kiosk browser" "${KIOSK_GROUPS[@]}"
  install -d -m 0700 -o "$KIOSK_USER" -g "$KIOSK_USER" "$KIOSK_HOME"
  install -m 0644 "${PREFIX}/deploy/pam.d/carheadsup-kiosk" "$PAM_FILE"
  install -m 0644 "${PREFIX}/deploy/systemd/carheadsup-kiosk.service" \
    "${UNIT_DIR}/carheadsup-kiosk.service"
}

remove_kiosk() {
  if [[ -e ${UNIT_DIR}/carheadsup-kiosk.service ]]; then
    log "removing the kiosk (--no-kiosk)"
    systemctl disable --now carheadsup-kiosk.service || true
    rm -f -- "${UNIT_DIR}/carheadsup-kiosk.service" "$PAM_FILE"
  fi
}

enable_services() {
  systemctl daemon-reload
  systemctl enable carheadsup.service
  if ((opt_kiosk)); then
    systemctl enable carheadsup-kiosk.service
    if [[ $(systemctl get-default) != graphical.target ]]; then
      systemctl set-default graphical.target
      log "default boot target set to graphical.target (starts the kiosk)"
    fi
    if systemctl is-enabled display-manager.service >/dev/null 2>&1; then
      warn "a desktop display manager (display-manager.service, e.g. lightdm) is enabled: graphical.target starts it next to the kiosk and it takes the screen. Disable it (sudo systemctl disable display-manager.service) or use Raspberry Pi OS Lite"
    fi
  fi
  if [[ -n $opt_obd_mac ]]; then
    systemctl enable "obd-rfcomm@${opt_obd_mac}.service"
  fi
}

start_services() {
  if [[ -n $opt_obd_mac ]]; then
    systemctl restart "obd-rfcomm@${opt_obd_mac}.service" ||
      warn "could not bind /dev/rfcomm0 (is the adapter paired? see docs/obd.md)"
  fi
  log "starting carheadsup.service"
  # A failure shows when the server does not answer (verify_started).
  systemctl restart carheadsup.service || warn "carheadsup.service did not start"
  if ((opt_kiosk)); then
    log "starting carheadsup-kiosk.service"
    systemctl restart carheadsup-kiosk.service || warn "carheadsup-kiosk.service did not start"
  fi
}

# True once GET <url> (the server's /api/info) answers as carheadsup, within <timeout> seconds.
#
#   hud_answers <url> <timeout, s>
hud_answers() {
  "$NODE_BIN" -e '
    const [url, timeoutS] = [process.argv[1], Number(process.argv[2])];
    const deadline = Date.now() + timeoutS * 1000;
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    (async () => {
      for (;;) {
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(2000), redirect: "manual" });
          if (res.ok && (await res.json())?.name === "carheadsup") process.exit(0);
        } catch {}
        if (Date.now() >= deadline) process.exit(1);
        await sleep(1000);
      }
    })();
  ' "$1" "$2"
}

# The server's last log lines, for a start that failed.
show_recent_log() {
  if command -v journalctl >/dev/null 2>&1; then
    journalctl -u carheadsup.service -n 15 --no-pager >&2 || true
  fi
}

# Put the previous version back (with its units: the newer ones may expect what it lacks) and
# start it.
roll_back() {
  swap_previous "$PREFIX" || die "there is no previous version to go back to (${PREFIX}.prev)"
  configure_system
  start_services
}

# After a (re)start: wait until the server answers. When it does not and this run replaced an
# installed version, go back to that one, so that a failed update does not leave the car without
# a HUD.
verify_started() {
  ((opt_start_timeout > 0)) || return 0
  local url
  url=$(info_url "$(config_host)" "$(config_port)")
  log "waiting up to ${opt_start_timeout} s for carheadsup to answer at ${url}"
  if hud_answers "$url" "$opt_start_timeout"; then
    log "carheadsup answers"
    return 0
  fi
  show_recent_log
  if ((!code_replaced)); then
    die "carheadsup does not answer at ${url} (journalctl -u carheadsup -b; --start-timeout to wait longer)"
  fi
  warn "the new version does not answer within ${opt_start_timeout} s; going back to the previous one"
  roll_back
  if hud_answers "$url" "$opt_start_timeout"; then
    die "the update failed and was rolled back: the previous version runs again. The new one is kept in ${PREFIX}.prev (sudo deploy/install.sh --rollback to try it again); see journalctl -u carheadsup -b"
  fi
  show_recent_log
  die "neither the new nor the previous version answers at ${url}; see journalctl -u carheadsup -b"
}

# Warn about optional tools that are missing, with the package that provides each.
report_missing_tools() {
  local -a missing=()
  local entry tool package
  local -a tools=(avahi-publish-service:avahi-utils gpiomon:gpiod i2cdetect:i2c-tools rfcomm:bluez
    ddcutil:ddcutil)
  for entry in "${tools[@]}"; do
    tool=${entry%%:*}
    package=${entry#*:}
    command -v "$tool" >/dev/null 2>&1 || missing+=("$package")
  done
  if ((${#missing[@]} > 0)); then
    warn "optional packages missing: ${missing[*]} (sudo apt install ${missing[*]})"
  fi
}

summary() {
  local host port tls_port phone settings
  host=$(hostname 2>/dev/null || echo raspberrypi)
  port=$(config_port)
  tls_port=$(config_tls_port)
  if [[ $tls_port == off ]]; then
    phone="off: server.tlsPort is null, so the companion app cannot connect"
    settings="http://${host}.local:${port}/settings   (or http://<HUD address>:${port}/settings; TLS is off, so the API token crosses the Wi-Fi unencrypted)"
  else
    phone="TLS port ${tls_port} (open it in any firewall); to pair, park and scan the QR code the HUD shows (settings app: Phone, Show pairing code on the HUD)"
    settings="https://${host}.local:${tls_port}/settings   (or https://<HUD address>:${tls_port}/settings; compare the certificate fingerprint the HUD shows before accepting the browser's warning)"
  fi
  cat <<EOF

carheadsup is installed.
  code     ${PREFIX}
  config   ${CONFIG_FILE}   (created with defaults and a random pairing code on the first start)
  data     ${DATA_DIR}   (tls.pem: the HUD's TLS key and certificate, made on the first start)
  logs     journalctl -u carheadsup -f     (kiosk: journalctl -u carheadsup-kiosk -f);
           kept across power cuts in ${DATA_DIR}/logs
  settings ${settings}
  phone    ${phone}
EOF
  if ((!opt_start)); then
    printf '\nServices are enabled but not started (--no-start): sudo systemctl start carheadsup\n'
  fi
}

# Install the system files and units of the code in ${PREFIX}, and enable the services.
configure_system() {
  install_system_files
  if ((opt_kiosk)); then
    install_kiosk
  else
    remove_kiosk
  fi
  configure_hardware_watchdog
  enable_services
}

main() {
  parse_args "$@"
  ((EUID == 0)) || die "run this as root: sudo $0"
  finish_interrupted_swap "$PREFIX"
  preflight
  WORK_DIR=$(mktemp -d)
  trap 'rm -rf -- "$WORK_DIR"' EXIT
  if ((opt_rollback)); then
    swap_previous "$PREFIX" || die "there is no previous version to go back to (${PREFIX}.prev)"
    log "${PREFIX} is the previous version again; the one it replaced is ${PREFIX}.prev"
  else
    ensure_user "$SERVICE_USER" "$DATA_DIR" "carheadsup HUD server" "${SERVICE_GROUPS[@]}"
    ensure_directories
    install_code
  fi
  configure_system
  if ((opt_start)); then
    start_services
    verify_started
  fi
  report_missing_tools
  summary
}

# Run only when executed, so the tests can source the functions.
if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  main "$@"
fi
