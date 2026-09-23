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

Use Lite: the kiosk replaces the desktop. On the desktop image switch to console boot first
(`sudo raspi-config nonint do_boot_behaviour B1`).

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

To try it before installing: `npm run sim`, then open `http://hud.local:8080/dev` from your
computer (`Ctrl+C` to stop).

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
on stop, and confines it: `NoNewPrivileges`, no capabilities, `ProtectSystem=strict` with
`ReadWritePaths=` only for `/var/lib/carheadsup`, `/etc/carheadsup` and `/sys/class/backlight`,
`ProtectHome`, `PrivateTmp`, restricted address families, namespaces and system calls. Device
access (I²C, GPIO, serial, backlight) comes from the user's groups. Further `CARHEADSUP_*`
variables (log level, backlight device, port and host overrides) go in `/etc/default/carheadsup`;
see [configuration.md](configuration.md#command-line-and-environment).

**`carheadsup-kiosk.service`** ([source](../deploy/systemd/carheadsup-kiosk.service)) takes over
`tty1` from the login prompt, opens a logind session for `carheadsup-kiosk` (PAM stack
`/etc/pam.d/carheadsup-kiosk`) and runs `cage -d -s -- /opt/carheadsup/deploy/kiosk.sh`. The
[launcher](../deploy/kiosk.sh) waits up to 60 s for the server to answer, then starts Chromium in
kiosk mode on `http://localhost:8080/` with a fresh profile in RAM (no "restore pages?" prompt
after a power cut). cage has no idle timeout, so the screen never blanks by itself; if cage or
Chromium exits, systemd restarts it. Settings (in a drop-in, `sudo systemctl edit
carheadsup-kiosk`):

```ini
[Service]
Environment=CARHEADSUP_KIOSK_URL=http://localhost:8080/
Environment=CARHEADSUP_KIOSK_WAIT_S=60
Environment=CARHEADSUP_KIOSK_SCALE=1
Environment=CARHEADSUP_KIOSK_FLAGS=
```

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
internet. The HUD is `http://10.42.0.1:8080`.

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

In both cases the server must listen on the network: `server.host` is `0.0.0.0` by default.

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
`http://10.42.0.1:8080/settings` (HUD hotspot) or `http://hud.local:8080/settings` — and go
through it. Changes apply immediately. At least:

1. **Security**: *Phone → Pairing code* and *Server → API token* (both have a generate button),
   then enter the same values in the companion's *Setup*. From the Pi itself (loopback needs no
   token) the same is:

   ```sh
   API_TOKEN=$(openssl rand -hex 16)
   PAIRING=$(openssl rand -hex 4)
   curl -sS -X PATCH http://127.0.0.1:8080/api/config -H 'Content-Type: application/json' \
     -d "{\"server\":{\"apiToken\":\"$API_TOKEN\"},\"phone\":{\"pairingToken\":\"$PAIRING\"}}" \
     >/dev/null && echo "API token: $API_TOKEN  pairing code: $PAIRING"
   ```

2. **Vehicle**: fuel type, tank size, engine displacement, transmission, redline, fuel price.
3. **Units**: km/h or mph, economy, temperature, pressure, clock, currency.
4. **OBD**: serial path or TCP address if not the Bluetooth default.
5. **Projection**: sit in the driver's seat, turn on the calibration grid, square it up with the
   keystone corners, size and position; turn the grid off.
6. **Sensors and buttons**, **Layout**, **Alerts**, **Maintenance** (enter the date and odometer
   of each item's last service).

Every option is described in [configuration.md](configuration.md). To edit the file by hand, stop
the service first, since it rewrites the file on changes from the settings app:

```sh
sudo systemctl stop carheadsup
sudoedit /etc/carheadsup/config.json
sudo systemctl start carheadsup
journalctl -u carheadsup -b | grep Config:     # invalid fields are reported and reset
```

## Read-only root file system

Power disappears whenever the ignition goes off. The HUD's own files are written crash-safely,
but the OS writes elsewhere too. For a car that is switched off without a clean shutdown, make the
root file system read-only:

1. Finish configuring first: with the overlay active, changes to `/etc` and `/var` live in RAM
   and are gone after the next power cycle — including the HUD's config, trips and odometer.
2. Give the HUD a persistent place: a small separate ext4 partition (or USB stick) labelled
   `hud-data`, mounted at `/var/lib/carheadsup`, and the config moved there.

   ```sh
   echo 'LABEL=hud-data /var/lib/carheadsup ext4 defaults,noatime,nofail 0 2' | sudo tee -a /etc/fstab
   sudo systemctl stop carheadsup
   sudo mount /var/lib/carheadsup            # (copy any existing data onto it first)
   sudo chown carheadsup:carheadsup /var/lib/carheadsup && sudo chmod 0700 /var/lib/carheadsup
   sudo install -o carheadsup -g carheadsup -m 0600 /etc/carheadsup/config.json /var/lib/carheadsup/config.json
   sudo systemctl edit carheadsup
   ```

   and in the drop-in, point `--config` at the data directory:

   ```ini
   [Service]
   ExecStart=
   ExecStart=/usr/bin/node /opt/carheadsup/packages/hud-server/src/main.ts --config /var/lib/carheadsup/config.json --data-dir /var/lib/carheadsup --renderer-dir /opt/carheadsup/packages/hud-renderer/dist
   ```

3. `sudo raspi-config` → *Performance Options → Overlay File System* → enable the overlay (and
   write-protect the boot partition), reboot.

To change the system later (updates, packages, `/boot/firmware`), disable the overlay in
`raspi-config`, reboot, make the change, and enable it again.

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
and a file that had to be corrected is kept as `config.json.bak`. With a read-only root, disable
the overlay first.

## Logs

```sh
journalctl -u carheadsup -f               # server: OBD link, phone, sensors, config
journalctl -u carheadsup-kiosk -f         # cage and Chromium
journalctl -u 'obd-rfcomm@*' -b           # Bluetooth binding
systemctl status carheadsup carheadsup-kiosk
```

For more detail uncomment `CARHEADSUP_LOG_LEVEL=debug` in `/etc/default/carheadsup` and
`sudo systemctl restart carheadsup`. Log lines never contain request query strings (where remote
renderer clients pass their token) or message content.

## Troubleshooting

| Symptom | Things to check |
| --- | --- |
| Display stays black | `systemctl status carheadsup-kiosk`, `journalctl -u carheadsup-kiosk -b`. Is `graphical.target` the default (`systemctl get-default`)? A desktop display manager competing for the screen? `dtoverlay=vc4-kms-v3d` still in `config.txt` (cage needs KMS)? |
| Page "The HUD renderer has not been built" | `npm run build` in the checkout, then `sudo deploy/install.sh` again. |
| Only a tiny red dot in a corner | The page is loaded but receives no frames: the server is down or restarting (`systemctl status carheadsup`), or the kiosk points at the wrong port. |
| Only a tiny ring in a corner | The HUD is blanked: hold the primary button, press B on a keyboard, or send `toggle-blank` from the companion's remote. |
| Text reads backwards / upside down on the glass | *Projection*: `mirrorX`, `mirrorY`, *Panel rotation*. |
| OBD never connects | `journalctl -u carheadsup` shows the reason. Ignition on? `/dev/rfcomm0` present (`systemctl status obd-rfcomm@<MAC>`)? Adapter paired *and* trusted? Another device (a phone app) connected to it? For USB: right `obd.serialPath` and `obd.baudRate`? Try `obd.protocol` = `"6"` (CAN 11-bit 500 kbit/s) instead of automatic on a modern car. |
| "OBD LINK LOST" after switching off | Expected: the ECU stops answering; the HUD parks and keeps probing slowly. |
| Phone does not find the HUD | Same Wi-Fi? `avahi-browse -rt _carheadsup._tcp` on the Pi lists the advertisement (install `avahi-utils`). Enter `10.42.0.1:8080` manually in the companion's *Setup*. |
| Phone connects and is dropped at once | Pairing code mismatch: the log says "sent a wrong pairing token". |
| Settings app asks for a token | `server.apiToken` is set: enter it (it is stored in that browser). |
| Light or gesture sensor does nothing | `i2cdetect -y 1` shows the address? I²C enabled? The log says whether the `i2c-bus` module is missing (then rebuild with `build-essential` installed: `npm ci`, `sudo deploy/install.sh`). `id carheadsup` lists the `i2c` group? |
| Buttons do nothing | `gpiod` installed? BCM numbers (not header pins) in the config? The log names the GPIO chip and lines it watches. |
| Backlight never dims | `ls /sys/class/backlight` — HDMI panels usually have no backlight device (the page is dimmed instead). For DSI panels: `ls -l /sys/class/backlight/*/brightness` should show group `video` writable (udev rule; reboot after installing). |
| Wrong clock / dates | See [hardware.md](hardware.md#clock): network time or an RTC. |
| Hotspot not visible | Wi-Fi country set (`--country`)? `nmcli device status`, `rfkill list`. |
| Port 8080 taken | Set `server.port` (or `CARHEADSUP_PORT`), restart, point the kiosk at it (`CARHEADSUP_KIOSK_URL`) and re-run the installer if it uses the static Avahi file. |

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
| `/var/lib/carheadsup` | `carheadsup`, 0700 | `state.json` (odometer, learned gears, service records), `trips.jsonl` |
| `/var/lib/carheadsup-kiosk` | `carheadsup-kiosk`, 0700 | Home of the kiosk user |
| `/etc/default/carheadsup` | root, 0644 | `CARHEADSUP_*` environment for the server |
| `/etc/systemd/system/carheadsup.service` | root | The server |
| `/etc/systemd/system/carheadsup-kiosk.service` | root | The kiosk |
| `/etc/systemd/system/obd-rfcomm@.service` | root | Bluetooth OBD binding, one instance per adapter MAC |
| `/etc/pam.d/carheadsup-kiosk` | root | Session setup for the kiosk |
| `/etc/udev/rules.d/99-carheadsup-backlight.rules` | root | Backlight writable by the `video` group |
| `/etc/avahi/services/carheadsup.service` | root | Static mDNS advertisement, only when `avahi-utils` is missing |
