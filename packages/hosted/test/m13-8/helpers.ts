/**
 * Test helpers for the lobby browser and passwords (M13-8): fixed listings, a gateway wired with the real lobby browser, the real word filter and the
 * real scrypt hook (cheap settings), all on the fake clock of the gateway harness. Fixed inputs only; no randomness, no network.
 */
import type { LobbyListing } from '../../src/api';
import type { GatewayOptions } from '../../src/gateway/gateway';
import { LobbyBrowser, ScryptPasswords, type LobbyBrowserOptions, type ScryptSettings } from '../../src/lobby';
import { WordModeration } from '../../src/moderation';
import { makeGateway, type TestGateway } from '../m13-6/harness';

export const SEC = 1_000;
export const MIN = 60_000;

export const CLOCK = { bankMs: 900_000, delayMs: 5_000, dropMs: 300_000 };

/** scrypt at the smallest cost the hook accepts: the tests are about what the hook does, not about how long a derivation takes. */
export const CHEAP_SCRYPT: ScryptSettings = { ln: 4, r: 1, p: 1 };

/** A listing with the given fields over a plain 1-of-2 casual table made at an arbitrary fixed time. */
export function listing(table: string, o: Partial<LobbyListing> = {}): LobbyListing {
  return {
    table, title: `Table ${table}`, format: 'casual', variant: null, seats: 2, filled: 1, locked: false, clock: { ...CLOCK }, creator: 'Alice', ranked: false,
    createdAt: 1_800_000_000_000, ...o,
  };
}

/** `n` listings named `T001`, `T002`, ..., each created a second after the one before (so the order by newest is the reverse of the numbering). */
export function listings(n: number, o: (i: number) => Partial<LobbyListing> = () => ({})): LobbyListing[] {
  return Array.from({ length: n }, (_, k) => {
    const i = k + 1;
    return listing(`T${String(i).padStart(3, '0')}`, { createdAt: 1_800_000_000_000 + i * SEC, ...o(i) });
  });
}

export const ids = (xs: readonly LobbyListing[]): string[] => xs.map((l) => l.table);

export interface LobbyRig extends TestGateway {
  lobby: LobbyBrowser;
  passwords: ScryptPasswords;
  moderation: WordModeration;
}

/**
 * The gateway of the harness with M13-8's services wired as main.ts wires them (the browser is both the listing sink and `hooks.lobby`), on the fake
 * clock. `tick()` moves the lobby browser's batches along with the gateway's clock.
 */
export function lobbyGateway(o: Partial<GatewayOptions> & { env?: Record<string, string>; lobby?: LobbyBrowserOptions; words?: string | null } = {}): LobbyRig {
  const { lobby: lobbyOptions, words, ...rest } = o;
  let rig: TestGateway | null = null;
  const lobby = new LobbyBrowser({ now: () => rig!.clock.now(), ...lobbyOptions });
  const passwords = new ScryptPasswords({ scrypt: CHEAP_SCRYPT, random: counterRandom() });
  const moderation = new WordModeration(words ?? null);
  rig = makeGateway({ hooks: { lobby }, listings: lobby, passwords, moderation, ...rest });
  return Object.assign(rig, { lobby, passwords, moderation });
}

/** Moves the fake clock on and lets the lobby browser send what is due. */
export function advance(t: LobbyRig, ms: number): void {
  t.clock.advance(ms);
  t.lobby.tick(t.clock.now());
}

/** Bytes from a counter instead of the system's random source: the hook's salts and dummy values are then the same in every run. */
export function counterRandom(): (n: number) => Buffer {
  let call = 0;
  return (n) => {
    call++;
    return Buffer.from(Array.from({ length: n }, (_, j) => (call * 17 + j * 29 + 5) & 0xff));
  };
}
