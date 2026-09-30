# Installing on a Raspberry Pi

This guide takes a Raspberry Pi 4 or 5 from a blank SD card to a HUD that starts with the car:
the server as a hardened systemd service, Chromium full screen in the cage kiosk compositor, the
OBD-II adapter bound at boot, and a Wi-Fi network for the phone. Everything the installer puts
on the system is listed in [Files and services](#files-and-services), and
[`deploy/uninstall.sh`](../deploy/uninstall.sh) removes it again.

Target: **Raspberry Pi OS Lite (64-bit), Bookworm** (Debian 12). Other systemd-based Debian
releases work the same way where the packages exist.

1. [Prepare the SD card](#1-prepare-the-sd-card)
2. [Update and enable I2C](#2-update-and-enable-i2c)
3. [Install system packages](#3-install-system-packages)
4. [Install Node.js](#4-install-nodejs)
5. [Get and build carheadsup](#5-get-and-build-carheadsup)
6. [Pair the OBD-II adapter](#6-pair-the-obd-ii-adapter)
7. [Run the installer](#7-run-the-installer)
8. [Wi-Fi for the phone](#8-wi-fi-for-the-phone)
9. [Boot configuration](#9-boot-configuration)
10. [Configure the HUD](#10-configure-the-hud)

Then: [read-only root file system](#read-only-root-file-system), [updating](#updating),
[logs](#logs), [troubleshooting](#troubleshooting), [uninstalling](#uninstalling).

## 1. Prepare the SD card

With [Raspberry Pi Imager](https://www.raspberrypi.com/software/) write **Raspberry Pi OS Lite
(64-bit)** and, in the customisation dialog, set:

- a hostname, e.g. `hud` (the Pi is then reachable as `hud.local`);
- a user name and password;
- your home Wi-Fi (for the installation; the car network comes in step 8);
- your Wi-Fi country, time zone and keyboard layout;
- SSH enabled (the rest of this guide runs over SSH).

Use Lite: the kiosk replaces the desktop. On the desktop image, switch the desktop off before
step 7:

```sh
sudo systemctl disable display-manager.service      # the desktop's login manager (lightdm)
```

Switching to console boot (`raspi-config` → *System Options → Boot / Auto Login → Console*) is
not enough: it only changes the default boot target, which the installer sets back to
`graphical.target` to start the kiosk — and that starts an enabled display manager too, which
then takes the screen from the HUD.

## 2. Update and enable I2C

```sh
sudo apt update && sudo apt full-upgrade -y
sudo raspi-config nonint do_i2c 0      # only needed for light/gesture sensors or an I²C clock
sudo reboot
```

## 3. Install system packages

```sh
sudo apt install -y git curl build-essential python3 \
  avahi-daemon avahi-utils gpiod i2c-tools bluez \
  cage chromium-browser
```

| Package | Why |
| --- | --- |
| `git`, `curl` | Getting the code and Node.js |
| `build-essential`, `python3` | Compiling the `i2c-bus` module during `npm ci` (light and gesture sensors) |
| `avahi-daemon`, `avahi-utils` | mDNS: the server advertises itself as `_carheadsup._tcp` with `avahi-publish-service` so the phone finds it |
| `gpiod` | `gpiomon`, which the server uses to read the buttons |
| `i2c-tools` | `i2cdetect` for checking sensor wiring |
| `can-utils` (not in the list above) | Only for [steering-wheel buttons from the CAN bus](hardware.md#can-bus-an-mcp2515-can-hat): `candump`, which the server reads them with, and `cansniffer` for finding them |
| `bluez` | `bluetoothctl` and `rfcomm` for a Bluetooth OBD adapter |
| `cage`, `chromium-browser` | The kiosk: a single-application Wayland compositor and the browser. On newer images the browser package is called `chromium`; either works. |

Skip what you do not use: a USB adapter needs no `bluez` tools, a build without sensors no
`i2c-tools`, a headless test setup no `cage` and `chromium-browser` (install with `--no-kiosk`).

## 4. Install Node.js

carheadsup needs **Node.js 22.18 or newer** (it runs TypeScript directly). Debian's own `nodejs`
package is too old; use the NodeSource repository:

```sh
curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
sudo bash /tmp/nodesource_setup.sh
sudo apt install -y nodejs
node --version      # v22.18.0 or newer
```

Node.js must be installed system-wide (`/usr/bin/node` or `/usr/local/bin/node`): the service
user cannot read a copy in someone's home directory (nvm), and the installer refuses one.

## 5. Get and build carheadsup

As your normal user:

```sh
git clone https://github.com/Platteration/carheadsup ~/carheadsup
cd ~/carheadsup
npm ci
npm run build
```

`npm ci` compiles the optional `i2c-bus` module; if that fails, everything else still works and
the server logs that the sensors are unavailable. `npm run build` builds the three web pages into
`packages/hud-renderer/dist`.

To try it before installing: `npm run sim`, then open `https://hud.local:8443/dev` from your
computer — `http://hud.local:8080/dev` redirects there — and accept the browser's warning about
the HUD's self-signed certificate ([below](#browsers-and-the-huds-certificate)). `Ctrl+C` stops
it.

## 6. Pair the OBD-II adapter

Skip this for a USB or Wi-Fi adapter (set `obd.serialPath` or `obd.transport` in step 10 instead,
see [hardware.md](hardware.md#obd-ii-adapter)).

Plug the adapter into the car, switch the ignition on, and pair it once from the Pi (within a few
metres of the car):

```text
$ bluetoothctl
[bluetooth]# power on
[bluetooth]# agent on
[bluetooth]# default-agent
[bluetooth]# scan on
          … wait for the adapter to appear (OBDLink, vLinker, OBDII …) and note its MAC address
[bluetooth]# scan off
[bluetooth]# pair 00:1D:A5:68:98:8B
          … enter the PIN if asked (often 1234 or 0000); OBDLink adapters want their button pressed
[bluetooth]# trust 00:1D:A5:68:98:8B
[bluetooth]# quit
```

Do not `connect`: the serial link is opened by `rfcomm` when the HUD opens `/dev/rfcomm0`. Pass the
MAC address to the installer in the next step (`--obd-mac`), or bind it any time later with:

```sh
sudo systemctl enable --now obd-rfcomm@00:1D:A5:68:98:8B.service
ls -l /dev/rfcomm0        # crw-rw---- root dialout … /dev/rfcomm0
```

An adapter accepts one Bluetooth connection at a time: unpair it from your phone's OBD apps, or
they will fight over it.

## 7. Run the installer

```sh
cd ~/carheadsup
sudo deploy/install.sh --obd-mac 00:1D:A5:68:98:8B
```

[`deploy/install.sh`](../deploy/install.sh) is idempotent; re-running it is also how you
[update](#updating). It:

1. checks for Node.js ≥ 22.18, a built checkout, and (unless `--no-kiosk`) `cage` and Chromium;
2. creates the system user **`carheadsup`** (groups `i2c`, `gpio`, `dialout`, `video`) that runs
   the server, and **`carheadsup-kiosk`** (groups `video`, `render`, `input`) that runs the
   browser;
3. copies the code to **`/opt/carheadsup`** (owned by root, devDependencies pruned), after
   checking that the copy starts;
4. creates **`/var/lib/carheadsup`** (data, mode 0700) and **`/etc/carheadsup`** (config, mode
   0750), both owned by `carheadsup`. The server writes `/etc/carheadsup/config.json` with the
   defaults on its first start; existing files are kept;
5. installs `/etc/default/carheadsup` (once), a udev rule that lets the `video` group set the
   display backlight, the kiosk's PAM stack, the static Avahi advertisement if `avahi-utils` is
   missing, and the systemd units;
6. enables `carheadsup.service`, `carheadsup-kiosk.service` (and makes `graphical.target` the
   default boot target, which starts it) and `obd-rfcomm@<MAC>.service`;
7. restarts the services.

| Option | Effect |
| --- | --- |
| `--obd-mac <MAC>` | Enable and start `obd-rfcomm@<MAC>.service` |
| `--no-kiosk` | No kiosk (headless, e.g. a test machine); removes a previously installed kiosk |
| `--no-start` | Install and enable, but do not (re)start anything now |
| `--no-prune` | Keep devDependencies in `/opt/carheadsup` |

After a minute the display shows the HUD — mirrored, because it is meant to be seen in the glass.

### The units

**`carheadsup.service`** ([source](../deploy/systemd/carheadsup.service)) runs

```text
/usr/bin/node /opt/carheadsup/packages/hud-server/src/main.ts \
  --config /etc/carheadsup/config.json --data-dir /var/lib/carheadsup \
  --renderer-dir /opt/carheadsup/packages/hud-renderer/dist
```

as `carheadsup`, restarts it whenever it exits (`Restart=always`), gives it 30 s to save its state
on stop, waits for the file systems that hold `/var/lib/carheadsup` and `/etc/carheadsup` to be
mounted (`RequiresMountsFor`, see [read-only root](#read-only-root-file-system)), and confines
it: `NoNewPrivileges`, no capabilities, `ProtectSystem=strict` with
`ReadWritePaths=` only for `/var/lib/carheadsup`, `/etc/carheadsup` and `/sys/class/backlight`,
`ProtectHome`, `PrivateTmp`, restricted address families, namespaces and system calls. Device
access (I²C, GPIO, serial, backlight) comes from the user's groups. Further `CARHEADSUP_*`
variables (log level, backlight device, port and host overrides) go in `/etc/default/carheadsup`;
see [configuration.md](configuration.md#command-line-and-environment).

**`carheadsup-kiosk.service`** ([source](../deploy/systemd/carheadsup-kiosk.service)) takes over
`tty1` from the login prompt, opens a logind session for `carheadsup-kiosk` (PAM stack
`/etc/pam.d/carheadsup-kiosk`) and runs `cage -d -s -- /opt/carheadsup/deploy/kiosk.sh`. The
[launcher](../deploy/kiosk.sh) waits until the HUD page loads, then starts Chromium in kiosk mode
on `http://localhost:8080/` with a fresh profile in RAM (no "restore pages?" prompt after a power
cut). It never points Chromium at a page that does not load, because the browser's own error page
would be a bright rectangle on the windshield: while the server does not answer — starting,
crash-looping, or listening on another port — the screen stays black (cage draws black), however
long that lasts, and every `CARHEADSUP_KIOSK_WAIT_S` seconds the kiosk's log says why ("no
answer", "HTTP 503" …). Should a page still fail later, Chromium runs with dark error pages. cage
has no idle timeout, so the screen never blanks by itself; if cage or Chromium exits, systemd
restarts it. Settings (in a drop-in, `sudo systemctl edit carheadsup-kiosk`):

```ini
[Service]
Environment=CARHEADSUP_KIOSK_URL=http://localhost:8080/
Environment=CARHEADSUP_KIOSK_WAIT_S=60
Environment=CARHEADSUP_KIOSK_SCALE=1
Environment=CARHEADSUP_KIOSK_FLAGS=
```

`CARHEADSUP_KIOSK_WAIT_S` is how often a warning is logged while the kiosk waits (it keeps
waiting); `CARHEADSUP_KIOSK_SCALE` is Chromium's device scale factor (1 = one CSS pixel per panel
pixel); `CARHEADSUP_KIOSK_FLAGS` are extra Chromium flags, separated by spaces. When the server
moves to another port (`server.port`, `CARHEADSUP_PORT`), change `CARHEADSUP_KIOSK_URL` with it —
until then the kiosk stays black.

`-s` lets you switch to a text console with `Ctrl+Alt+F2` when a keyboard is attached. The kiosk
page maps keys to HUD inputs (Enter / Escape / arrows / B / + / −, see
[architecture.md](architecture.md#driver-input)).

**`obd-rfcomm@.service`** ([source](../deploy/systemd/obd-rfcomm@.service)) runs
`rfcomm bind rfcomm0 <MAC> 1` before the server starts (channel 1 is the serial port profile on
practically every adapter) and `rfcomm release rfcomm0` on stop.

## 8. Wi-Fi for the phone

The phone and the HUD need a common network. Pick one:

### HUD as access point (recommended)

The Pi opens its own WPA2 network; the phone joins it and keeps using mobile data for the
internet (the companion binds its HUD connection to this Wi-Fi). Nothing depends on the phone's
hotspot being switched on.

```sh
sudo ~/carheadsup/deploy/hotspot.sh --ssid CarHUD --password 'choose a long passphrase' --country DE
sudo reboot
```

[`deploy/hotspot.sh`](../deploy/hotspot.sh) creates (or updates) the NetworkManager connection
`carheadsup-hotspot`: an access point on `wlan0` (2.4 GHz by default, `--band a` for 5 GHz),
WPA2-AES only, the Pi at **10.42.0.1** handing out addresses to the phone, started at boot with a
higher priority than other Wi-Fi networks. `--up` activates it immediately instead of at the next
boot (that disconnects an SSH session running over Wi-Fi). The same thing by hand:

```sh
sudo nmcli connection add type wifi ifname wlan0 con-name carheadsup-hotspot \
  autoconnect yes connection.autoconnect-priority 100 ssid CarHUD \
  802-11-wireless.mode ap 802-11-wireless.band bg ipv4.method shared ipv6.method disabled \
  wifi-sec.key-mgmt wpa-psk wifi-sec.proto rsn wifi-sec.pairwise ccmp wifi-sec.group ccmp \
  wifi-sec.psk 'choose a long passphrase'
```

On the phone, join `CarHUD` and tell Android to stay connected although the network has no
internet. The HUD is `https://10.42.0.1:8443` for browsers (`http://10.42.0.1:8080` redirects
there); the companion app connects to the same TLS port, `10.42.0.1:8443`.

The Pi itself has no internet on its own network — no network time (see
[hardware.md](hardware.md#clock)) and no updates. To update at home:
`sudo nmcli connection down carheadsup-hotspot` (the Pi falls back to your home Wi-Fi), update,
then `sudo nmcli connection up carheadsup-hotspot`.

### HUD joins the phone's hotspot

```sh
sudo nmcli device wifi connect "Pixel hotspot" password 'hotspot passphrase'
sudo nmcli connection modify "Pixel hotspot" connection.autoconnect-priority 100
```

The Pi gets internet and network time, but the phone's hotspot must be on for every drive, and
the HUD's address can change. Discovery by mDNS on the phone's own hotspot does not work on every
phone; if the companion does not find the HUD, enter its address (from the phone's list of
connected devices) in the companion's *Setup*.

In both cases the server must listen on the network: `server.host` is `0.0.0.0` by default. It
listens on two ports: **8443** (`server.tlsPort`, HTTPS: the companion app, whose link is
encrypted and pinned to the HUD's certificate, and browsers on other devices) and **8080**
(`server.port`, plain HTTP: the kiosk on the Pi itself; other devices are redirected to 8443). A
firewall on the Pi, if you add one, must let phones and laptops reach 8443 (8080 only for the
redirect); UDP 5353 for mDNS.

## 9. Boot configuration

### /boot/firmware/config.txt

Add what applies to your build at the end of the file, then reboot:

```ini
# I2C for the light / gesture sensors and an I2C clock (raspi-config does the same)
dtparam=i2c_arm=on

# Safe shutdown: your power controller signals "ignition off" on GPIO 26.
# Use the pin and active level its documentation gives. Not GPIO 3 when I2C is in use.
dtoverlay=gpio-shutdown,gpio_pin=26,active_low=1,gpio_pull=up

# Only if the power controller waits for a "halted" signal before cutting the power:
#dtoverlay=gpio-poweroff,gpiopin=16

# DS3231 real-time clock module
#dtoverlay=i2c-rtc,ds3231

# Raspberry Pi 5 with the official rechargeable RTC battery
#dtparam=rtc_bbat_vchg=3000000

# Official Touch Display 2 mounted sideways (the HUD can rotate instead, see below)
#dtoverlay=vc4-kms-dsi-ili9881-7inch,rotation=90

# No rainbow splash at power-on
disable_splash=1
```

`gpio-shutdown` turns the pin into a power key: logind shuts the Pi down when it is pressed (or,
here, when the controller pulls it). `gpio-poweroff` drives its pin when the Pi has halted; use it
only with a controller that then really removes power (see the overlay notes in
`/boot/firmware/overlays/README`).

**Display orientation**: prefer the HUD's own `display.projection.rotation` (settings app →
*Projection → Panel rotation*): it rotates, mirrors and keystones in one step and needs nothing
from the OS. Rotate at the OS level only if you also want the boot console turned; do not do both.

### /boot/firmware/cmdline.txt

This file is a single line; append options with a space, on the same line:

- `consoleblank=0` keeps the text console from blanking (the kiosk never blanks by itself);
- a bar display that does not announce its resolution can be forced to it, e.g.
  `video=HDMI-A-1:1280x480M@60` (check the display's documentation for its mode);
- `video=DSI-1:800x480@60,rotate=180` turns the console of an upside-down DSI panel.

## 10. Configure the HUD

Open the settings app from the phone — the companion's *Setup → HUD settings*, or any browser at
`https://10.42.0.1:8443/settings` (HUD hotspot) or `https://hud.local:8443/settings` (the plain
`http://…:8080` addresses redirect there) — and go through it. Changes apply immediately. At
least:

1. **Pair the phone** — parked: the HUD made a random pairing code when it created its
   `config.json`. In the settings app, *Phone → Show pairing code on the HUD* (or page to the
   dashboard's last page, *Pair a phone*, with the page button): the HUD shows a QR code. In the
   companion, *Setup → Scan HUD QR code* and point the phone at the HUD's display. The app now
   knows the pairing code, the HUD's identity and its certificate — it pins them without trusting
   anything on first use — and the HUD's address, and connects. The page closes by itself after
   3 minutes and only exists while parked
   ([details](protocol.md#pairing-by-qr-code)). A HUD installed before this had no pairing code:
   generate one under *Phone → Pairing code*, save, then show the code.
2. **Security**: *Server → API token* (generate), then enter it in the companion's *Setup*. To
   pair by hand instead of scanning, enter *Phone → Pairing code* there too: when the companion
   connects the first time, it shows the HUD certificate's fingerprint (*Status*); it should be
   the one under *Phone → Encrypted link* in the settings app (or in
   `journalctl -u carheadsup | grep 'Phone link'`). The companion remembers the certificate from
   then on. From the Pi itself (loopback needs no token) setting both tokens is:

   ```sh
   API_TOKEN=$(openssl rand -hex 16)
   PAIRING=$(openssl rand -hex 12)
   curl -sS -X PATCH http://127.0.0.1:8080/api/config -H 'Content-Type: application/json' \
     -d "{\"server\":{\"apiToken\":\"$API_TOKEN\"},\"phone\":{\"pairingToken\":\"$PAIRING\"}}" \
     >/dev/null && echo "API token: $API_TOKEN  pairing code: $PAIRING"
   ```

   From then on, browsers on other devices need the API token too: the settings app and the
   developer console ask for it once and keep it in that browser (or open
   `https://hud.local:8443/settings?token=<token>` or `/dev?token=<token>` once — never a plain
   `http://` address with the token: it would cross the Wi-Fi in clear text, and the redirect
   drops it). The kiosk on the Pi itself needs none.

3. **Vehicle**: fuel type, tank size, engine displacement, transmission, redline, fuel price.
4. **Units**: km/h or mph, economy, temperature, pressure, clock, currency.
5. **OBD**: serial path or TCP address if not the Bluetooth default.
6. **Projection**: sit in the driver's seat, turn on the calibration grid, square it up with the
   keystone corners, size and position; turn the grid off.
7. **Sensors and buttons**, **Layout**, **Alerts**, **Maintenance** (enter the date and odometer
   of each item's last service).

Leave *Server → Port*, *Secure port (TLS)* and *Listen address* alone unless you need them: they
take effect at the next restart, and the kiosk only follows a new port once
`CARHEADSUP_KIOSK_URL` says so (it stays black until then; see [the units](#the-units)). Ports
below 1024 do not work, since the service has no privileges. Leave *Also accept unencrypted
phone connections* and *Also serve other devices over plain http* off: the companion and
browsers do not need them.

### Browsers and the HUD's certificate

Browsers on other devices use the settings app and the developer console over HTTPS on the TLS
port (8443), so the API token and your settings never cross the Wi-Fi in clear text; the plain
port (8080) serves only the Pi itself and sends other devices there
([details](configuration.md#remote-https)). The HUD's certificate is its own, not one from an
authority, so each browser warns once ("Your connection is not private", "Warning: Potential
Security Risk Ahead"). Before you accept it, compare the fingerprint: in the browser, open the
certificate details (the warning page's *Advanced* / padlock → certificate) and read its SHA-256
fingerprint; it must begin with the short form the HUD shows — on its *Pair a phone* page, under
*Phone → Certificate fingerprint* in the settings app on a device that already has access, or in
`journalctl -u carheadsup | grep 'Phone link'` (e.g. `FDC1 53EE DCA2 B536 4DD7`). If it differs,
another device is posing as the HUD: do not accept it, and do not enter the token. Browsers keep
the exception per address, so accept it for the address you use (`10.42.0.1` or `hud.local`).
The companion app needs none of this: it pins the certificate when it pairs.

For development only, *Server → Also serve other devices over plain http*
(`server.allowPlainRemote`) serves other devices on the plain port again — with the token in
clear text. With *Secure port (TLS)* empty (TLS off), plain http is the only way in, with the
same risk; the HUD logs a warning and the settings app shows one.

Every option is described in [configuration.md](configuration.md). To edit the file by hand, stop
the service first, since it rewrites the file on changes from the settings app, and check the
syntax before you start it again:

```sh
sudo systemctl stop carheadsup
sudoedit /etc/carheadsup/config.json
sudo python3 -m json.tool /etc/carheadsup/config.json >/dev/null && echo "valid JSON"
sudo systemctl start carheadsup
journalctl -u carheadsup -b | grep Config:     # invalid fields are reported and reset
```

The server repairs invalid *fields* one by one, but a file that is not valid JSON at all — a
missing comma or quote, a trailing comma — cannot be read: the HUD then starts with **every**
setting at its default (the default projection too) and **locked**: the API token and pairing
code become random values nobody knows, so the phone and other devices cannot connect (the HUD's
own display works). The file is left as it is and the settings app cannot save. The log says
"is not valid JSON (…) … Fix it and restart the HUD". To recover, stop the service, fix
`config.json`, check it as above and start the service.

## Read-only root file system

Power disappears whenever the ignition goes off. The HUD's own files are written crash-safely,
but the OS writes elsewhere too. For a car that is switched off without a clean shutdown, make the
root file system read-only with the overlay of `raspi-config` (the `overlayroot` package): every
change to the root file system then lives in RAM and is gone at the next power cycle, so the HUD
needs a file system of its own outside the overlay.

1. **Finish setting up first.** With the overlay active, changes outside the HUD's data
   partition — `/etc/default/carheadsup`, unit drop-ins, packages, Wi-Fi settings — are lost at
   the next power cycle.
2. **Give the HUD a persistent place**: a small separate ext4 partition (or USB stick) labelled
   `hud-data`, mounted at `/var/lib/carheadsup`, with the existing data and the config moved onto
   it:

   ```sh
   # e.g. a USB stick (this erases it): sudo mkfs.ext4 -L hud-data /dev/sda1
   sudo systemctl stop carheadsup
   sudo mkdir -p /mnt/hud-data && sudo mount LABEL=hud-data /mnt/hud-data
   sudo cp -a /var/lib/carheadsup/. /mnt/hud-data/          # state.json, trips.jsonl, hud-id, tls.pem
   sudo install -o carheadsup -g carheadsup -m 0600 /etc/carheadsup/config.json /mnt/hud-data/config.json
   sudo chown carheadsup:carheadsup /mnt/hud-data && sudo chmod 0700 /mnt/hud-data
   sudo umount /mnt/hud-data
   echo 'LABEL=hud-data /var/lib/carheadsup ext4 defaults,noatime,nofail 0 2' | sudo tee -a /etc/fstab
   sudo systemctl daemon-reload && sudo mount /var/lib/carheadsup
   sudo systemctl edit carheadsup
   ```

   and in the drop-in, point `--config` at the data directory (use the Node.js path from
   `systemctl cat carheadsup` if it is not `/usr/bin/node`):

   ```ini
   [Service]
   ExecStart=
   ExecStart=/usr/bin/node /opt/carheadsup/packages/hud-server/src/main.ts --config /var/lib/carheadsup/config.json --data-dir /var/lib/carheadsup --renderer-dir /opt/carheadsup/packages/hud-renderer/dist
   ```

   Then `sudo systemctl start carheadsup`. The unit waits for this mount
   (`RequiresMountsFor=/var/lib/carheadsup`): a USB stick that shows up a few seconds late
   delays the HUD instead of letting it start on the empty mount point — where it would create
   default settings without tokens and later write them over your data. If the partition is
   missing altogether the HUD does not start (`nofail` keeps the rest of the system booting).
3. **Enable the overlay**: `sudo raspi-config` → *Performance Options → Overlay File System* →
   enable it (and write-protect the boot partition if you like). Do not reboot yet.
4. **Keep the data partition out of the overlay.** By default the overlay also covers every other
   file system in `/etc/fstab` — `hud-data` included: the HUD would read its data but lose every
   change (settings, odometer, service records, trips) at the next power cut. `raspi-config` put
   `overlayroot=tmpfs` in `cmdline.txt`; add `recurse=0` so that only the root file system is
   overlaid, then reboot:

   ```sh
   sudo sed -i 's/overlayroot=tmpfs /overlayroot=tmpfs:recurse=0 /' /boot/firmware/cmdline.txt
   grep -o 'overlayroot=[^ ]*' /boot/firmware/cmdline.txt     # overlayroot=tmpfs:recurse=0
   sudo reboot
   ```

5. **Check** after the reboot:

   ```sh
   findmnt -no FSTYPE,OPTIONS /                     # overlay rw,…
   findmnt -no FSTYPE,OPTIONS /var/lib/carheadsup   # ext4 rw,noatime,…
   ```

   The second line must say `ext4` and `rw`. If it says `overlay`, or prints nothing, the HUD's
   changes are not kept: go back to steps 4 and 2.

**Changing the system later** (updates, packages, `/boot/firmware`): `raspi-config` cannot switch
this overlay off — its *disable* removes only the exact text `overlayroot=tmpfs ` and reports
success anyway. Remove the option by hand and reboot:

```sh
sudo mount -o remount,rw /boot/firmware
sudo sed -i 's/overlayroot=tmpfs:recurse=0 //' /boot/firmware/cmdline.txt
sudo reboot
```

Make the change (if you write-protected the boot partition, `sudo mount -o remount,rw
/boot/firmware` before anything writes to it, e.g. a kernel update), then repeat steps 3–5.

A lighter alternative without the overlay: a good high-endurance card, the HUD's crash-safe
writes, and the journal in RAM (`Storage=volatile` in `/etc/systemd/journald.conf`).

## Updating

```sh
cd ~/carheadsup
git pull
npm ci
npm run build
sudo deploy/install.sh
```

The installer replaces `/opt/carheadsup`, keeps `/etc/carheadsup` and `/var/lib/carheadsup`,
leaves an enabled `obd-rfcomm@…` unit enabled (no need to repeat `--obd-mac`) and restarts the
services. Config files from older versions are read leniently: new options get their defaults,
and a file that had to be corrected is kept as `config.json.bak`. With a read-only root, switch
the overlay off first ([changing the system later](#read-only-root-file-system)).

## Logs

```sh
journalctl -u carheadsup -f               # server: OBD link, phone, sensors, config
journalctl -u carheadsup-kiosk -f         # cage, Chromium, and why the kiosk is still waiting
journalctl -u 'obd-rfcomm@*' -b           # Bluetooth binding
systemctl status carheadsup carheadsup-kiosk
```

For more detail uncomment `CARHEADSUP_LOG_LEVEL=debug` in `/etc/default/carheadsup` and
`sudo systemctl restart carheadsup`. Log lines never contain request query strings (where remote
renderer clients pass their token) or message content.

## Troubleshooting

| Symptom | Things to check |
| --- | --- |
| Display stays black | `systemctl status carheadsup-kiosk`, `journalctl -u carheadsup-kiosk -b`. "waiting for http://localhost:8080/ … (no answer)": the kiosk waits for the server — is it running (`systemctl status carheadsup`), and on the port in `CARHEADSUP_KIOSK_URL`? "HTTP 503": the renderer is not built (`npm run build` in the checkout, then `sudo deploy/install.sh`). "HTTP 403": the server does not accept the host name in `CARHEADSUP_KIOSK_URL` (use `localhost`). "HTTP 307": `CARHEADSUP_KIOSK_URL` names one of the Pi's network addresses, so the server takes the kiosk for another device and sends it to HTTPS (use `localhost`). Otherwise: is `graphical.target` the default (`systemctl get-default`)? A desktop display manager competing for the screen (`sudo systemctl disable display-manager.service`)? `dtoverlay=vc4-kms-v3d` still in `config.txt` (cage needs KMS)? |
| Page "The HUD renderer has not been built" (in a browser) | `npm run build` in the checkout, then `sudo deploy/install.sh` again. |
| HUD does not start; `systemctl status carheadsup` says "Dependency failed" | With the [read-only root](#read-only-root-file-system) recipe: the `hud-data` file system is missing or cannot be mounted (`lsblk -f`, `journalctl -b -u var-lib-carheadsup.mount`). |
| Settings, odometer or trips are back to old values after every start | With a read-only root: the data partition is under the overlay (`findmnt /var/lib/carheadsup` says `overlay`) — see [step 4 of the recipe](#read-only-root-file-system). |
| All settings back to defaults after a hand edit, the phone cannot connect, settings cannot be saved | The file is not valid JSON (the log says "is not valid JSON"); the HUD runs locked until it is fixed — see [editing by hand](#10-configure-the-hud). |
| Only a tiny red dot in a corner | The page is loaded but receives no frames: the server is down or restarting (`systemctl status carheadsup`). |
| Only a tiny ring in a corner | The HUD is blanked: hold the primary button, press B on a keyboard, or send `toggle-blank` from the companion's remote. |
| Text reads backwards / upside down on the glass | *Projection*: `mirrorX`, `mirrorY`, *Panel rotation*. |
| OBD never connects | `journalctl -u carheadsup` shows the reason. Ignition on? `/dev/rfcomm0` present (`systemctl status obd-rfcomm@<MAC>`)? Adapter paired *and* trusted? Another device (a phone app) connected to it? For USB: right `obd.serialPath` and `obd.baudRate`? Try `obd.protocol` = `"6"` (CAN 11-bit 500 kbit/s) instead of automatic on a modern car. |
| "OBD LINK LOST" after switching off | Expected: the ECU stops answering; the HUD parks and keeps probing slowly. |
| Phone does not find the HUD | Same Wi-Fi? `avahi-browse -rt _carheadsup._tcp` on the Pi lists the advertisement (install `avahi-utils`) with `tls=8443`. Enter `10.42.0.1:8443` (the TLS port, not 8080) manually in the companion's *Setup* (an address saved by an earlier app version with `:8080` is moved to `:8443` by itself; one with another port must be changed to the HUD's `server.tlsPort`). |
| Phone cannot connect at all; `/api/info` shows `"tls": null` | The TLS listener is not running: `server.tlsPort` is null, or the port is taken (`journalctl -u carheadsup -b \| grep TLS` says so). Free the port or pick another one (`server.tlsPort`, or `CARHEADSUP_TLS_PORT` in `/etc/default/carheadsup`), restart, and re-run the installer if it uses the static Avahi file. |
| Phone connects and is dropped at once | Pairing code mismatch: the log says "sent a wrong proof". The companion shows "wrong pairing code". If the code is right, something between phone and HUD is relaying the connection with a certificate of its own. |
| Companion says "HUD certificate changed — re-pair" | The HUD at the paired address presented another TLS certificate than the paired one, and the app stopped. Expected after `/var/lib/carheadsup/tls.pem` was deleted or replaced, or the Pi's card was set up anew: then *Forget paired HUD* and pair again, comparing the new fingerprint with the settings app. Otherwise another device is posing as the HUD — do not forget the HUD; check who is on the car's Wi-Fi. |
| Companion says "A different HUD is answering" | It is paired with another HUD id than this one's (`/var/lib/carheadsup/hud-id`): the Pi was replaced or its data directory reset. If this is your HUD, *Forget paired HUD* in the companion; it pairs again with the next HUD that proves the code. |
| Companion asks "This is my HUD — connect" | The HUD has no pairing code, so the phone cannot verify it. Confirm only if it is yours; better, set a pairing code. |
| The pairing page shows no QR code | "No pairing code set": generate one under *Phone → Pairing code* and save. "Pairing unavailable": the TLS listener is not running (`server.tlsPort`, see the log) or the HUD listens only on a loopback address (`server.host`). The page exists only while parked. |
| The companion does not read the QR code | Hold the phone close to the display and square to it, and avoid glare; turning the HUD brighter helps. Scanning the reflection in the windshield works too. It reports a code that is not a carheadsup pairing code, or one it cannot read. Pairing by hand still works. |
| Browser warns that the connection is not private | Expected for the HUD's self-signed certificate on `https://…:8443`: compare its fingerprint, then accept it ([how](#browsers-and-the-huds-certificate)). |
| `http://…:8080` from a laptop or phone jumps to `https://…:8443`, or answers "HTTPS required" | Expected: other devices use the TLS port. Open `https://<HUD address>:8443/settings`. "…the HUD's TLS listener is not running": the TLS port is taken or no certificate could be made (`journalctl -u carheadsup -b \| grep TLS`); the kiosk keeps working. |
| Settings app asks for a token | `server.apiToken` is set: enter it (it is stored in that browser, per address: once more after moving to `https://`). |
| Developer console from another device: "No feed", no live HUD | `server.apiToken` is set: enter it when the console asks, or open `/dev?token=<token>` once. |
| Browser says "Unknown host name" | The HUD answers only to its IP address, `localhost`, `<hostname>` and `<hostname>.local` (protection against DNS rebinding). Use one of those, or add the name to `CARHEADSUP_ALLOWED_HOSTS` in `/etc/default/carheadsup`. |
| Light or gesture sensor does nothing | `i2cdetect -y 1` shows the address? I²C enabled? The log says whether the `i2c-bus` module is missing (then rebuild with `build-essential` installed: `npm ci`, `sudo deploy/install.sh`). `id carheadsup` lists the `i2c` group? |
| Buttons do nothing | `gpiod` installed? BCM numbers (not header pins) in the config? The log names the GPIO chip and lines it watches. |
| Backlight never dims | `ls /sys/class/backlight` — HDMI panels usually have no backlight device (the page is dimmed instead). For DSI panels: `ls -l /sys/class/backlight/*/brightness` should show group `video` writable (udev rule; reboot after installing). `journalctl -u carheadsup -b \| grep Backlight`: "no backlight device found" or "no usable device" at start-up is fine if a later line says "controlling …" — the HUD looks again every 10 s, so a display driver or udev rule that comes up after the server is picked up by itself. If "controlling" never follows, fix the permissions (`sudo udevadm trigger --subsystem-match=backlight --action=add` applies the rule without a reboot). |
| Wrong clock / dates | See [hardware.md](hardware.md#clock): network time or an RTC. |
| Hotspot not visible | Wi-Fi country set (`--country`)? `nmcli device status`, `rfkill list`. |
| Port 8080 taken | Set `server.port` (or `CARHEADSUP_PORT` in `/etc/default/carheadsup`) to a free port of 1024 or above, restart, point the kiosk at it (`CARHEADSUP_KIOSK_URL`; it stays black until then) and re-run the installer if it uses the static Avahi file (it picks up either setting). Port 8443 (the phone's) likewise: `server.tlsPort` or `CARHEADSUP_TLS_PORT`. |

## Uninstalling

```sh
sudo ~/carheadsup/deploy/uninstall.sh            # keeps /etc/carheadsup and /var/lib/carheadsup
sudo ~/carheadsup/deploy/uninstall.sh --purge    # deletes config, data and the two users too
sudo systemctl set-default multi-user.target     # back to the text console at boot
sudo nmcli connection delete carheadsup-hotspot  # if you created the hotspot
```

## Files and services

| Path | Owner / mode | What |
| --- | --- | --- |
| `/opt/carheadsup` | root, read-only to others | Code, production dependencies, built pages, `deploy/`, `docs/` |
| `/etc/carheadsup/config.json` | `carheadsup`, 0600 | Configuration (contains the tokens); `config.json.bak` after a correction |
| `/var/lib/carheadsup` | `carheadsup`, 0700 | `state.json` (odometer, learned gears, service records), `trips.jsonl`, `hud-id` and `tls.pem` (the HUD's identity and TLS key and certificate, which paired phones pin — keep them when moving to a new card, or pair the phone again) |
| `/var/lib/carheadsup-kiosk` | `carheadsup-kiosk`, 0700 | Home of the kiosk user |
| `/etc/default/carheadsup` | root, 0644 | `CARHEADSUP_*` environment for the server |
| `/etc/systemd/system/carheadsup.service` | root | The server |
| `/etc/systemd/system/carheadsup-kiosk.service` | root | The kiosk |
| `/etc/systemd/system/obd-rfcomm@.service` | root | Bluetooth OBD binding, one instance per adapter MAC |
| `/etc/pam.d/carheadsup-kiosk` | root | Session setup for the kiosk |
| `/etc/udev/rules.d/99-carheadsup-backlight.rules` | root | Backlight writable by the `video` group |
| `/etc/avahi/services/carheadsup.service` | root | Static mDNS advertisement, only when `avahi-utils` is missing |
