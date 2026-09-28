import { Workbox } from 'workbox-window';
import { LINES } from '../generated/lines.js';
import { toast } from '../ui/toast.js';

const CHECK_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Auto-update without interrupting play: a new version is downloaded in the
 * background and activated at the next "safe point" (menu, setup and game-over
 * screens). Call `setSafe(true)` whenever the game reaches one.
 */
class Updater {
  private wb: Workbox | null = null;
  private waiting = false;
  private safe = true;
  private applying = false;

  start() {
    if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
    this.wb = new Workbox('/sw.js', { scope: '/' });
    this.wb.addEventListener('waiting', () => {
      this.waiting = true;
      if (!this.safe) toast(LINES['menu.ny_version']);
      this.maybeApply();
    });
    // Reload once the new service worker has taken over (only after an update we triggered).
    this.wb.addEventListener('controlling', (e) => {
      if (e.isUpdate || this.applying) window.location.reload();
    });
    void this.wb.register();

    setInterval(() => this.check(), CHECK_INTERVAL_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.check();
    });
  }

  /** The game tells us whether interrupting now would be OK. */
  setSafe(safe: boolean) {
    this.safe = safe;
    this.maybeApply();
  }

  check() {
    void this.wb?.update().catch(() => undefined);
  }

  /** Server says our protocol is outdated: update right away, whatever the game is doing. */
  async forceUpdate() {
    toast(LINES['menu.opdaterer']);
    if (!this.wb) {
      window.location.reload();
      return;
    }
    await this.wb.update().catch(() => undefined);
    if (this.waiting) this.apply();
    else setTimeout(() => (this.waiting ? this.apply() : window.location.reload()), 3000);
  }

  private maybeApply() {
    if (this.waiting && this.safe) this.apply();
  }

  private apply() {
    if (this.applying || !this.wb) return;
    this.applying = true;
    toast(LINES['menu.opdaterer']);
    this.wb.messageSkipWaiting();
  }
}

export const updater = new Updater();
