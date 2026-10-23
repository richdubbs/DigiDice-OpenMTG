/**
 * `MemoryStore` (M13-4, design 8.1): the store of unit tests. Nothing survives the process. It keeps the same rules as the file and PostgreSQL stores
 * (store/rules.ts): rows are copied in and out, records are kept as their JSON text, and the jsonb text rule refuses what PostgreSQL would.
 */
import type { GameRecord } from '../ledger/types';
import type { ReportRow, SessionRow, SnapshotRow } from './api';
import { emptyIndex, IndexedStore, type GameMeta, type IndexedStoreOptions, type Persistence } from './indexed';
import { StoreError } from './rules';

/** The writes a `fault` hook can fail (each is one durable write of the file store). */
export type MemoryWrite = 'putSession' | 'putGame' | 'putStart' | 'appendLog' | 'putSnapshot' | 'deleteSnapshots' | 'putResult' | 'putReport';

export interface MemoryStoreOptions extends IndexedStoreOptions {
  /**
   * Test hook: called before a game's records are appended; throwing fails that game's append (as a disk or database failure would). Lets tests of
   * the runtime (M13-5) make a commit fail.
   */
  failAppend?: (game: string, lines: readonly string[]) => void;
  /** Test hook: called before every durable write with its kind and its row's id; throwing fails that write (a disk failure part-way). */
  fault?: (op: MemoryWrite, id: string) => void;
}

class MemoryPersistence implements Persistence {
  readonly starts = new Map<string, { configJson: string; seed: string }>();
  readonly logs = new Map<string, string[]>();
  readonly snapshots = new Map<string, Map<number, SnapshotRow>>();

  constructor(
    private readonly failAppend?: MemoryStoreOptions['failAppend'],
    private readonly fault?: MemoryStoreOptions['fault'],
  ) {}

  async putSession(s: SessionRow): Promise<void> {
    this.fault?.('putSession', s.id);
  }
  async deleteSession(_id: string): Promise<void> {}
  async putGame(meta: GameMeta): Promise<void> {
    this.fault?.('putGame', meta.id);
  }
  async putStart(id: string, configJson: string, seed: string): Promise<void> {
    this.fault?.('putStart', id);
    this.starts.set(id, { configJson, seed });
  }
  async readStart(id: string): Promise<{ configJson: string; seed: string }> {
    const s = this.starts.get(id);
    if (!s) throw new StoreError('notFound', `game ${id} has no config`);
    return s;
  }
  async appendLog(id: string, lines: string[]): Promise<void> {
    this.fault?.('appendLog', id);
    this.failAppend?.(id, lines);
    const log = this.logs.get(id) ?? [];
    log.push(...lines);
    this.logs.set(id, log);
  }
  async readLog(id: string): Promise<string[]> {
    return [...(this.logs.get(id) ?? [])];
  }
  async putSnapshot(s: SnapshotRow): Promise<void> {
    this.fault?.('putSnapshot', s.game);
    let m = this.snapshots.get(s.game);
    if (!m) this.snapshots.set(s.game, (m = new Map()));
    m.set(s.seq, s);
  }
  async snapshotSeqs(id: string): Promise<number[]> {
    return [...(this.snapshots.get(id)?.keys() ?? [])];
  }
  async readSnapshot(id: string, seq: number): Promise<SnapshotRow> {
    const s = this.snapshots.get(id)?.get(seq);
    if (!s) throw new StoreError('notFound', `no snapshot ${seq} of game ${id}`);
    return { ...s, state: new Uint8Array(s.state), createdAt: new Date(s.createdAt) };
  }
  async deleteSnapshots(id: string): Promise<number> {
    this.fault?.('deleteSnapshots', id);
    const n = this.snapshots.get(id)?.size ?? 0;
    this.snapshots.delete(id);
    return n;
  }
  async deleteGame(id: string): Promise<{ records: number; snapshots: number }> {
    const records = this.logs.get(id)?.length ?? 0;
    const snapshots = this.snapshots.get(id)?.size ?? 0;
    this.snapshots.delete(id);
    this.logs.delete(id);
    this.starts.delete(id);
    return { records, snapshots };
  }
  async putResult(r: GameRecord): Promise<void> {
    this.fault?.('putResult', r.game);
  }
  async putReport(r: ReportRow): Promise<void> {
    this.fault?.('putReport', r.id);
  }
  async close(): Promise<void> {}
}

export class MemoryStore extends IndexedStore {
  private readonly mem: MemoryPersistence;

  constructor(opts: MemoryStoreOptions = {}) {
    const io = new MemoryPersistence(opts.failAppend, opts.fault);
    super(io, emptyIndex(), opts);
    this.mem = io;
  }

  /**
   * Test hook (the contract suite, review 8): stores a snapshot without the committed-seq check of `putSnapshot`, as a crash between a snapshot and
   * its commit could leave one in another store; `loadForRecovery` must ignore it.
   */
  forceSnapshot(s: SnapshotRow): void {
    let m = this.mem.snapshots.get(s.game);
    if (!m) this.mem.snapshots.set(s.game, (m = new Map()));
    m.set(s.seq, { ...s, state: new Uint8Array(s.state), createdAt: new Date(s.createdAt) });
  }

  /** Test hook (the contract suite, review MAJOR): removes a committed record behind the store's back; recovery must refuse the damaged log. */
  dropRecord(game: string, seq: number): void {
    const log = this.mem.logs.get(game);
    if (log) this.mem.logs.set(game, log.filter((l) => (JSON.parse(l) as { seq: number }).seq !== seq));
  }
}
