/**
 * The classification index (docs/design/m8-client.md, "Server API"): the automation level (full / partial / manual, design 10) of every card of the local
 * index, for search filters, result badges and the coverage numbers of /api/status.
 *
 * Built lazily in the background: the whole pool takes about a minute and a half to compile, so the build runs in time slices of a few dozen
 * milliseconds and yields to the event loop between them (the API stays responsive), and a request a player waits on pauses it (`whilePaused`: a game
 * start's definitions). Levels are cached on disk in
 * `<versionDir>/classification.jsonl` (one `{"k": card key, "l": level}` per line; compiled.ts explains the keys), so later starts only compile cards
 * that changed. A card asked for before the build reaches it is compiled on the spot and recorded. A card the compiler rejects counts as `manual`
 * (its definition request reports the failure itself).
 */
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AutomationLevel, OracleCard } from '@openmtg/engine';
import { cardKey, compileOne, versionDir } from './compiled';

const LEVELS: readonly AutomationLevel[] = ['full', 'partial', 'manual'];
const SLICE_MS = 40;

export interface AutomationProgress {
  done: number;
  total: number;
  complete: boolean;
}

const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

export class AutomationIndex {
  private readonly levels = new Map<string, AutomationLevel>();
  private readonly file: string;
  private pending: string[] = [];
  private writes: Promise<void> = Promise.resolve();
  private build: Promise<void> | undefined;
  private loading: Promise<void> | undefined;
  private stopped = false;
  private complete = false;
  /** Requests running under `whilePaused`; the build waits between its slices while any is. */
  private holds = 0;
  private resume: (() => void) | undefined;
  /** Lines in the file that belong to no current card (rewritten away once the build completes). */
  private stale = 0;

  constructor(
    compiledDir: string,
    private readonly cards: readonly OracleCard[],
  ) {
    this.file = path.join(versionDir(compiledDir), 'classification.jsonl');
  }

  /** The level when already known (never compiles). */
  peek(card: OracleCard): AutomationLevel | undefined {
    return this.levels.get(cardKey(card));
  }

  /** The level of a card, compiling it now when the background build has not reached it yet. */
  levelOf(card: OracleCard): AutomationLevel {
    const known = this.peek(card);
    if (known) return known;
    let level: AutomationLevel;
    try {
      level = compileOne(card).automation.level;
    } catch {
      level = 'manual'; // never reported as automated when the compiler rejects it
    }
    this.record(card, level);
    return level;
  }

  /** Record a level learned elsewhere (a definition compiled for /api/cards/defs or the detail endpoint). */
  record(card: OracleCard, level: AutomationLevel): void {
    const key = cardKey(card);
    if (this.levels.get(key) === level) return;
    this.levels.set(key, level);
    this.pending.push(JSON.stringify({ k: key, l: level }));
    if (this.complete) void this.flush();
  }

  progress(): AutomationProgress {
    let done = 0;
    for (const c of this.cards) if (this.levels.has(cardKey(c))) done++;
    return { done, total: this.cards.length, complete: this.complete };
  }

  /** Coverage of the whole pool (card counts per level), null until the build has classified every card. */
  counts(): { full: number; partial: number; manual: number; total: number } | null {
    if (!this.complete) return null;
    const out = { full: 0, partial: 0, manual: 0, total: this.cards.length };
    for (const c of this.cards) out[this.levels.get(cardKey(c)) ?? 'manual']++;
    return out;
  }

  get isComplete(): boolean {
    return this.complete;
  }

  /** Start (once) and return the background build. */
  start(): Promise<void> {
    this.build ??= this.run().catch((e: unknown) => {
      console.error('[openmtg-server] classification index build failed:', e);
    });
    return this.build;
  }

  /**
   * Resolves once the levels cached on disk are loaded (starting the build if needed), so a request does not compile cards the cache already knows. A
   * few seconds at most on a cold start; immediate afterwards.
   */
  async ready(): Promise<void> {
    void this.start();
    await this.loading;
  }

  /** Stop the background build (tests, shutdown); what is classified so far stays usable. */
  stop(): void {
    this.stopped = true;
    this.wake();
  }

  /**
   * Run `work` with the background build paused between its slices: a request a player waits on (a game start's definitions) would otherwise wait out one
   * slice at each of its awaits (a disk read per card), seconds for a Commander deck.
   */
  async whilePaused<T>(work: () => Promise<T>): Promise<T> {
    this.holds++;
    try {
      return await work();
    } finally {
      if (--this.holds === 0) this.wake();
    }
  }

  private wake(): void {
    const resume = this.resume;
    this.resume = undefined;
    resume?.();
  }

  /** Resolves once no request holds the build paused (or it was stopped). */
  private unpaused(): Promise<void> {
    if (this.holds === 0 || this.stopped) return Promise.resolve();
    return new Promise((resolve) => {
      this.resume = resolve;
    });
  }

  private async load(): Promise<void> {
    let text: string;
    try {
      text = await readFile(this.file, 'utf8');
    } catch {
      return; // first start with this compiler
    }
    const wanted = new Set<string>();
    for (const [i, card] of this.cards.entries()) {
      wanted.add(cardKey(card));
      if (i % 2000 === 1999) await yieldToEventLoop(); // hashing every card takes about a second: stay responsive
    }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const { k, l } = JSON.parse(line) as { k?: unknown; l?: unknown };
        if (typeof k === 'string' && wanted.has(k) && LEVELS.includes(l as AutomationLevel)) this.levels.set(k, l as AutomationLevel);
        else this.stale++;
      } catch {
        this.stale++; // a line cut short by a crash: compiled again
      }
    }
  }

  private flush(): Promise<void> {
    if (this.pending.length === 0) return this.writes;
    const lines = `${this.pending.join('\n')}\n`;
    this.pending = [];
    this.writes = this.writes.then(async () => {
      try {
        await mkdir(path.dirname(this.file), { recursive: true });
        await appendFile(this.file, lines, 'utf8');
      } catch {
        // the cache is an optimization: a read-only disk only costs a rebuild next time
      }
    });
    return this.writes;
  }

  private async rewrite(): Promise<void> {
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const c of this.cards) {
      const k = cardKey(c);
      const l = this.levels.get(k);
      if (l && !seen.has(k)) {
        seen.add(k);
        lines.push(JSON.stringify({ k, l }));
      }
    }
    this.writes = this.writes.then(async () => {
      try {
        const tmp = `${this.file}.${process.pid}.tmp`;
        await writeFile(tmp, `${lines.join('\n')}\n`, 'utf8');
        await rename(tmp, this.file);
      } catch {
        // keep the old file
      }
    });
    await this.writes;
  }

  private async run(): Promise<void> {
    this.loading = this.load().catch(() => undefined);
    await this.loading;
    let sliceStart = performance.now();
    for (const card of this.cards) {
      if (this.stopped) return;
      if (!this.levels.has(cardKey(card))) this.levelOf(card);
      if (performance.now() - sliceStart > SLICE_MS) {
        await this.flush();
        await yieldToEventLoop();
        await this.unpaused();
        sliceStart = performance.now();
      }
    }
    this.complete = true;
    await this.flush();
    // Compact when the file holds lines of cards no longer in the index (a card-data refresh changed them).
    if (this.stale > 0) {
      this.stale = 0;
      await this.rewrite();
    }
  }
}
