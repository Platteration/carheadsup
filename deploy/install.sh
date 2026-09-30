#!/usr/bin/env bash
# carheadsup: install or update the HUD on Raspberry Pi OS (Bookworm, 64-bit) or another
# systemd-based Debian. Run it as root from a checkout in which `npm ci` and `npm run build`
# have completed:
#
#   sudo deploy/install.sh [--obd-mac AA:BB:CC:DD:EE:FF] [--no-kiosk] [--no-start] [--no-prune]
#
# What it does (every step is idempotent, so re-running it after
# `git pull && npm ci && npm run build` is how you update):
#
#   - creates the system user "carheadsup" (groups i2c, gpio, dialout, video) that runs the
#     server, and "carheadsup-kiosk" (video, render, input) that runs the kiosk browser;
#   - copies the built code to /opt/carheadsup (owned by root, without devDependencies);
#   - creates /var/lib/carheadsup (data) and /etc/carheadsup (config.json, created with defaults
#     and a random pairing code by the server on its first start), keeping whatever is already
#     there;
#   - installs /etc/default/carheadsup (once), a udev rule for the display backlight, the kiosk's
#     PAM stack, the static Avahi advertisement when avahi-utils is missing, and the systemd
#     units carheadsup.service, carheadsup-kiosk.service and obd-rfcomm@.service;
#   - enables and (re)starts the services.
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
readonly SERVICE_GROUPS=(i2c gpio dialout video)
readonly KIOSK_GROUPS=(video render input)
# What the HUD needs at runtime (docs are referenced by the units' Documentation= lines).
readonly COPY_ITEMS=(package.json package-lock.json node_modules packages deploy docs README.md)
readonly RENDERER_PAGES=(index.html settings.html dev.html)

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
REPO_ROOT=$(cd -- "${SCRIPT_DIR}/.." && pwd -P)
readonly SCRIPT_DIR REPO_ROOT

opt_kiosk=1
opt_start=1
opt_prune=1
opt_obd_mac=""
NODE_BIN=""
WORK_DIR=""

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
      --no-kiosk) opt_kiosk=0 ;;
      --no-start) opt_start=0 ;;
      --no-prune) opt_prune=0 ;;
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

  [[ -d ${REPO_ROOT}/node_modules/@carheadsup ]] ||
    die "dependencies are missing: run 'npm ci' in ${REPO_ROOT} first"
  local page
  for page in "${RENDERER_PAGES[@]}"; do
    [[ -f ${REPO_ROOT}/packages/hud-renderer/dist/${page} ]] ||
      die "the renderer is not built: run 'npm run build' in ${REPO_ROOT} first"
  done

  if ((opt_kiosk)); then
    command -v cage >/dev/null 2>&1 ||
      die "cage is not installed (sudo apt install cage), or run with --no-kiosk"
    command -v chromium >/dev/null 2>&1 || command -v chromium-browser >/dev/null 2>&1 ||
      die "Chromium is not installed (sudo apt install chromium-browser), or run with --no-kiosk"
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

# Copy the runtime files into a staging directory, drop devDependencies, check that the copy
# runs, then swap it into place.
install_code() {
  if [[ $REPO_ROOT == "$PREFIX" ]]; then
    log "running from ${PREFIX} itself; using the checkout in place"
    return
  fi
  local stage="${PREFIX}.new" old="${PREFIX}.old" item
  rm -rf -- "$stage" "$old"
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
    mv -- "$PREFIX" "$old"
  fi
  mv -- "$stage" "$PREFIX"
  rm -rf -- "$old"
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
  systemctl restart carheadsup.service
  if ((opt_kiosk)); then
    log "starting carheadsup-kiosk.service"
    systemctl restart carheadsup-kiosk.service
  fi
}

# Warn about optional tools that are missing, with the package that provides each.
report_missing_tools() {
  local -a missing=()
  local entry tool package
  local -a tools=(avahi-publish-service:avahi-utils gpiomon:gpiod i2cdetect:i2c-tools rfcomm:bluez)
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
  local host port tls_port phone
  host=$(hostname 2>/dev/null || echo raspberrypi)
  port=$(config_port)
  tls_port=$(config_tls_port)
  if [[ $tls_port == off ]]; then
    phone="off: server.tlsPort is null, so the companion app cannot connect"
  else
    phone="TLS port ${tls_port} (open it in any firewall); to pair, park and scan the QR code the HUD shows (settings app: Phone, Show pairing code on the HUD)"
  fi
  cat <<EOF

carheadsup is installed.
  code     ${PREFIX}
  config   ${CONFIG_FILE}   (created with defaults and a random pairing code on the first start)
  data     ${DATA_DIR}   (tls.pem: the HUD's TLS key and certificate, made on the first start)
  logs     journalctl -u carheadsup -f     (kiosk: journalctl -u carheadsup-kiosk -f)
  settings http://${host}.local:${port}/settings   (or http://<HUD address>:${port}/settings)
  phone    ${phone}
EOF
  if ((!opt_start)); then
    printf '\nServices are enabled but not started (--no-start): sudo systemctl start carheadsup\n'
  fi
}

main() {
  parse_args "$@"
  preflight
  WORK_DIR=$(mktemp -d)
  trap 'rm -rf -- "$WORK_DIR"' EXIT
  ensure_user "$SERVICE_USER" "$DATA_DIR" "carheadsup HUD server" "${SERVICE_GROUPS[@]}"
  ensure_directories
  install_code
  install_system_files
  if ((opt_kiosk)); then
    install_kiosk
  else
    remove_kiosk
  fi
  enable_services
  if ((opt_start)); then
    start_services
  fi
  report_missing_tools
  summary
}

# Run only when executed, so the tests can source the functions.
if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  main "$@"
fi
