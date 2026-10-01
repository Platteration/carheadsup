import { existsSync } from 'node:fs';

/**
 * Created by `systemd-timesyncd` once it has synchronised the system clock to network time (it
 * lives in `/run`, so it is gone again at the next boot).
 */
export const TIMESYNC_FLAG = '/run/systemd/timesync/synchronized';

/**
 * Whether the system clock has been synchronised to network time since the boot, by
 * `systemd-timesyncd` (Raspberry Pi OS's default). Other time daemons are not detected: the HUD
 * then only takes the phone's time when the two disagree by more than a couple of seconds, which
 * a synchronised clock never does.
 */
export function systemClockSynchronized(flag: string = TIMESYNC_FLAG): boolean {
  return existsSync(flag);
}
