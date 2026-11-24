// ============================================================================
// 📁 chat/chat-signal.service.ts — Le "faux temps réel" à coût quasi nul
// ----------------------------------------------------------------------------
// Idée : le client interroge GET /chat/poll?v=<version>. Le serveur garde en
// MÉMOIRE un compteur de version par utilisateur, incrémenté seulement quand
// quelque chose change pour lui (message reçu, lu). Si la version du client est
// à jour → réponse { changed:false } SANS AUCUNE REQUÊTE SQL. La base n'est
// sollicitée que lorsqu'il y a vraiment du nouveau.
//
// Ce service gère aussi :
//   • la "présence" (dernier poll) → pas de push hors-app si la personne est
//     déjà en ligne et va voir le message via le poll ;
//   • l'anti-spam des push (1 push / conversation / 15 s) ;
//   • un petit limiteur de débit par utilisateur (fenêtre fixe, en mémoire).
//
// ⚠️ État en mémoire = valable pour UNE instance du backend (cas d'un VPS
// Coolify mono-conteneur). Si un jour tu passes à plusieurs réplicas, remplace
// ces Map par Redis (même interface) — le reste du module ne change pas.
// Au redémarrage, bootId change → chaque client refait UN fetch complet, c'est tout.
// ============================================================================
import { Injectable, OnModuleDestroy } from '@nestjs/common';

const ONLINE_WINDOW_MS = 40_000;
const PUSH_COOLDOWN_MS = 15_000;
const VERSION_TTL_MS = 6 * 60 * 60 * 1000;

@Injectable()
export class ChatSignalService implements OnModuleDestroy {
  private readonly bootId = Date.now().toString(36);
  private counter = 0; // global, strictement croissant → jamais de collision de version
  private readonly versions = new Map<string, { v: number; at: number }>();
  private readonly lastPoll = new Map<string, number>();
  private readonly lastPush = new Map<string, number>();
  private readonly windows = new Map<string, { n: number; resetAt: number }>();
  private readonly sweeper: NodeJS.Timeout;

  constructor() {
    this.sweeper = setInterval(() => this.sweep(), 10 * 60_000);
    this.sweeper.unref();
  }

  onModuleDestroy() {
    clearInterval(this.sweeper);
  }

  // ─── Versions ──────────────────────────────────────────────────────────────
  version(userId: string): string {
    return `${this.bootId}.${this.versions.get(userId)?.v ?? 0}`;
  }

  bump(userId: string): void {
    this.versions.set(userId, { v: ++this.counter, at: Date.now() });
  }

  // ─── Présence ──────────────────────────────────────────────────────────────
  touch(userId: string): void {
    this.lastPoll.set(userId, Date.now());
  }

  away(userId: string): void {
    this.lastPoll.delete(userId);
  }

  isOnline(userId: string): boolean {
    const t = this.lastPoll.get(userId);
    return t !== undefined && Date.now() - t < ONLINE_WINDOW_MS;
  }

  // ─── Push hors application ─────────────────────────────────────────────────
  shouldPush(recipientId: string, conversationId: string): boolean {
    if (this.isOnline(recipientId)) return false;
    const key = `${recipientId}:${conversationId}`;
    const last = this.lastPush.get(key);
    if (last !== undefined && Date.now() - last < PUSH_COOLDOWN_MS) return false;
    this.lastPush.set(key, Date.now());
    return true;
  }

  // ─── Limiteur de débit (fenêtre fixe) ──────────────────────────────────────
  /** @returns true si l'action est autorisée, false si la limite est dépassée */
  hit(key: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    const w = this.windows.get(key);
    if (!w || now >= w.resetAt) {
      this.windows.set(key, { n: 1, resetAt: now + windowMs });
      return true;
    }
    w.n += 1;
    return w.n <= limit;
  }

  private sweep() {
    const now = Date.now();
    for (const [k, v] of this.versions) if (now - v.at > VERSION_TTL_MS) this.versions.delete(k);
    for (const [k, t] of this.lastPoll) if (now - t > 60 * 60_000) this.lastPoll.delete(k);
    for (const [k, t] of this.lastPush) if (now - t > 10 * 60_000) this.lastPush.delete(k);
    for (const [k, w] of this.windows) if (now >= w.resetAt) this.windows.delete(k);
  }
}