#!/usr/bin/env bash
# carheadsup: make the HUD a Wi-Fi access point for the phone, with NetworkManager (the default
# on Raspberry Pi OS Bookworm).
#
#   sudo deploy/hotspot.sh --ssid CarHUD --password 'a long passphrase' [--country DE] [--up]
#
# Creates, or updates in place, the connection "carheadsup-hotspot": WPA2 (AES) access point on
# wlan0, the HUD at 10.42.0.1 handing out addresses to the phone (NetworkManager "shared" mode),
# started automatically at boot. The phone keeps using mobile data for the internet; the companion
# app binds its HUD connection to this Wi-Fi network.
#
# Without --up the access point starts at the next boot (or with
# `sudo nmcli connection up carheadsup-hotspot`), so an SSH session over Wi-Fi is not cut off.
set -euo pipefail

readonly CONNECTION=carheadsup-hotspot

opt_ssid=""
opt_password=""
opt_ifname=wlan0
opt_band="bg"
opt_channel=""
opt_address=10.42.0.1/24
opt_country=""
opt_up=0

log() { printf '==> %s\n' "$*"; }
die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage: sudo deploy/hotspot.sh --ssid <name> --password <passphrase> [options]

Create or update the NetworkManager access point "carheadsup-hotspot".

Options:
  --ssid <name>          Network name (1-32 bytes)
  --password <psk>       WPA2 passphrase (8-63 characters)
  --ifname <dev>         Wi-Fi interface (default wlan0)
  --band <bg|a>          2.4 GHz (bg, default: works with every phone) or 5 GHz (a)
  --channel <n>          Fixed channel (default: automatic)
  --address <cidr>       The HUD's address on the hotspot (default 10.42.0.1/24)
  --country <XX>         Set the Wi-Fi country first (raspi-config), e.g. DE, GB, US
  --up                   Activate the access point now (disconnects other Wi-Fi on the interface)
  -h, --help             Show this help
EOF
}

need_value() {
  (($# >= 2)) || die "$1 needs a value"
}

parse_args() {
  while (($# > 0)); do
    case $1 in
      --ssid)
        need_value "$@"
        opt_ssid=$2
        shift
        ;;
      --password)
        need_value "$@"
        opt_password=$2
        shift
        ;;
      --ifname)
        need_value "$@"
        opt_ifname=$2
        shift
        ;;
      --band)
        need_value "$@"
        opt_band=$2
        shift
        ;;
      --channel)
        need_value "$@"
        opt_channel=$2
        shift
        ;;
      --address)
        need_value "$@"
        opt_address=$2
        shift
        ;;
      --country)
        need_value "$@"
        opt_country=${2^^}
        shift
        ;;
      --up) opt_up=1 ;;
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

  [[ -n $opt_ssid ]] || die "--ssid is required"
  local ssid_bytes
  ssid_bytes=$(printf '%s' "$opt_ssid" | wc -c)
  ((ssid_bytes >= 1 && ssid_bytes <= 32)) || die "the SSID must be 1-32 bytes long"
  ((${#opt_password} >= 8 && ${#opt_password} <= 63)) ||
    die "--password must be 8-63 characters long"
  [[ $opt_band == bg || $opt_band == a ]] || die "--band must be bg or a"
  [[ -z $opt_channel || $opt_channel =~ ^[0-9]{1,3}$ ]] || die "--channel must be a number"
  [[ $opt_address =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}/[0-9]{1,2}$ ]] ||
    die "--address must look like 10.42.0.1/24"
  [[ -z $opt_country || $opt_country =~ ^[A-Z]{2}$ ]] || die "--country must be a two-letter code"
}

main() {
  parse_args "$@"
  ((EUID == 0)) || die "run this as root: sudo $0"
  command -v nmcli >/dev/null 2>&1 || die "NetworkManager (nmcli) is not installed"

  if [[ -n $opt_country ]]; then
    command -v raspi-config >/dev/null 2>&1 ||
      die "--country needs raspi-config; set the regulatory domain another way"
    raspi-config nonint do_wifi_country "$opt_country"
    log "Wi-Fi country set to ${opt_country}"
  fi
  nmcli radio wifi on

  local -a settings=(
    connection.interface-name "$opt_ifname"
    connection.autoconnect yes
    connection.autoconnect-priority 100
    802-11-wireless.ssid "$opt_ssid"
    802-11-wireless.mode ap
    802-11-wireless.band "$opt_band"
    802-11-wireless.channel "${opt_channel:-0}"
    ipv4.method shared
    ipv4.addresses "$opt_address"
    ipv6.method disabled
    wifi-sec.key-mgmt wpa-psk
    wifi-sec.proto rsn
    wifi-sec.pairwise ccmp
    wifi-sec.group ccmp
    wifi-sec.psk "$opt_password"
  )
  if nmcli connection show "$CONNECTION" >/dev/null 2>&1; then
    nmcli connection modify "$CONNECTION" "${settings[@]}"
    log "updated the connection ${CONNECTION}"
  else
    nmcli connection add type wifi con-name "$CONNECTION" "${settings[@]}"
    log "created the connection ${CONNECTION}"
  fi

  if ((opt_up)); then
    nmcli connection up "$CONNECTION"
    log "access point \"${opt_ssid}\" is up; the HUD is at ${opt_address%/*}"
  else
    log "access point \"${opt_ssid}\" starts at the next boot (now: sudo nmcli connection up ${CONNECTION})"
  fi
}

main "$@"
