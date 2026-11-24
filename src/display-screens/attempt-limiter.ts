// ============================================================================
// 📁 src/display-screens/attempt-limiter.ts
// Anti-force-brute du code secret, PAR ÉCRAN (on ne sait pas qui essaie).
// 5 échecs en 10 min → écran verrouillé 2 min. Mémoire du processus : suffisant
// pour une instance ; à passer sur Redis si vous scalez à plusieurs instances.
// ============================================================================
const MAX_FAILS = 5;
const WINDOW_MS = 10 * 60 * 1000;
const LOCK_MS = 2 * 60 * 1000;

interface Entry {
  fails: number;
  firstAt: number;
  lockedUntil: number;
}

export class AttemptLimiter {
  private readonly map = new Map<string, Entry>();

  /** Secondes restantes de verrouillage (0 = libre). */
  lockedFor(key: string): number {
    const e = this.map.get(key);
    if (!e || e.lockedUntil <= Date.now()) return 0;
    return Math.ceil((e.lockedUntil - Date.now()) / 1000);
  }

  fail(key: string): void {
    const now = Date.now();
    this.prune(now);
    let e = this.map.get(key);
    if (!e || now - e.firstAt > WINDOW_MS) {
      e = { fails: 0, firstAt: now, lockedUntil: 0 };
    }
    e.fails += 1;
    if (e.fails >= MAX_FAILS) {
      e.lockedUntil = now + LOCK_MS;
      e.fails = 0;
      e.firstAt = now;
    }
    this.map.set(key, e);
  }

  reset(key: string): void {
    this.map.delete(key);
  }

  private prune(now: number): void {
    if (this.map.size < 500) return;
    for (const [k, e] of this.map) {
      if (e.lockedUntil < now && now - e.firstAt > WINDOW_MS) this.map.delete(k);
    }
  }
}

/**
 * Limiteur « N appels par fenêtre » par clé (ex. par employé). Fenêtre glissante, en mémoire :
 * suffisant pour une instance ; à passer sur Redis si vous lancez plusieurs instances du backend.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  /** true = autorisé (et compté), false = limite atteinte. */
  allow(key: string, max: number, windowMs: number): boolean {
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 2000) this.prune(now, windowMs);
    return true;
  }

  private prune(now: number, windowMs: number): void {
    for (const [k, arr] of this.hits) {
      if (!arr.length || now - arr[arr.length - 1] >= windowMs) this.hits.delete(k);
    }
  }
}