/**
 * Pending voids (package M13-5, review MAJOR 2): a void the runtime decided (a quarantine, a failed recovery, a commit past the outage bound) is noted
 * here BEFORE the store is asked, and taken off once the store has it. The runtime retries the store until then; if the process stops first, the next
 * `open()` applies the noted voids before it recovers anything, so a quarantined culprit is never placed again and a game its players were told was void
 * never comes back. Kept in a small JSON file (`RuntimeOptions.pendingVoidsFile`, in `DATA_DIR`), replaced atomically; in memory without one.
 */
import { readFile } from 'node:fs/promises';
import type { VoidReason } from '../ledger/types';
import { writeAtomic } from '../store/file';

export interface PendingVoid {
  game: string;
  reason: VoidReason;
  status: 'void' | 'quarantined';
}

export class PendingVoids {
  private readonly entries = new Map<string, PendingVoid>();
  private writing: Promise<void> = Promise.resolve();

  private constructor(private readonly path: string | null) {}

  static async open(path: string | null): Promise<PendingVoids> {
    const p = new PendingVoids(path);
    if (path) {
      try {
        const list = JSON.parse(await readFile(path, 'utf8')) as PendingVoid[];
        if (Array.isArray(list)) for (const e of list) if (e && typeof e.game === 'string') p.entries.set(e.game, e);
      } catch {
        // no file yet (or an unreadable one: nothing pending)
      }
    }
    return p;
  }

  list(): PendingVoid[] {
    return [...this.entries.values()];
  }

  has(game: string): boolean {
    return this.entries.has(game);
  }

  async add(e: PendingVoid): Promise<void> {
    this.entries.set(e.game, e);
    await this.save();
  }

  async remove(game: string): Promise<void> {
    if (!this.entries.delete(game)) return;
    await this.save();
  }

  /** Writes the list (one write at a time, in order). A failed write is thrown to the caller (the store is retried anyway). */
  private save(): Promise<void> {
    if (!this.path) return Promise.resolve();
    const path = this.path;
    const text = JSON.stringify(this.list());
    const next = this.writing.catch(() => undefined).then(() => writeAtomic(path, text));
    this.writing = next;
    return next;
  }
}
