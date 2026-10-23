/**
 * Validation of what the browser sends over the online socket (api.ts, `ClientMessage`). The browser is the player's own, but the server trusts nothing
 * it receives: sizes, nesting, fields and texts are checked here before the bridge looks at a message, and an action must fit the player's current view
 * before it is passed on (the host's engine then decides, CR 733). Pure functions, tested in process.
 */
import { checkAction, checkDeckSubmission, cleanText, jsonTextDepth, LIMITS, normalizeJoinCode } from '@openmtg/net';
import { decidingPlayer, mayActAs, type Action, type GameView, type LegalAction, type PlayerId } from '@openmtg/engine';
import { DEFAULT_GAME_PORT, MAX_CLIENT_MESSAGE_BYTES, type ClientMessage, type OnlineDeck, type OnlineError } from './api';

/** Deepest nesting of a browser message (an action inside `act` is checked against the net limits too). */
export const MAX_CLIENT_DEPTH = 24;

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);
const isStr = (x: unknown, max: number): x is string => typeof x === 'string' && x.length <= max;
const isInt = (x: unknown, min: number, max: number): x is number => Number.isInteger(x) && (x as number) >= min && (x as number) <= max;

const FIELDS: Record<ClientMessage['t'], readonly string[]> = {
  status: ['t', 'id'],
  host: ['t', 'id', 'name', 'deck', 'format', 'port', 'seats'],
  join: ['t', 'id', 'address', 'code', 'name', 'deck'],
  act: ['t', 'id', 'action'],
  manual: ['t', 'id', 'proposal', 'accept', 'reason'],
  forfeit: ['t', 'id', 'player'],
  chat: ['t', 'id', 'text'],
  replayConsent: ['t', 'id', 'agree'],
  leave: ['t', 'id'],
};

export type Parsed = { ok: true; message: ClientMessage } | { ok: false; id?: number; error: string };

/** Parse and check one text frame from the browser. Bounded before parsing (size, then nesting depth: audit C4's rule for anything from outside). */
export function parseClientMessage(text: string | Buffer): Parsed {
  const buf = typeof text === 'string' ? Buffer.from(text, 'utf8') : text;
  if (buf.length > MAX_CLIENT_MESSAGE_BYTES) return { ok: false, error: 'message too large' };
  if (jsonTextDepth(buf, MAX_CLIENT_DEPTH) === null) return { ok: false, error: 'message too deeply nested' };
  let x: unknown;
  try {
    x = JSON.parse(buf.toString('utf8'));
  } catch {
    return { ok: false, error: 'not JSON' };
  }
  if (!isRec(x) || typeof x['t'] !== 'string' || !Object.hasOwn(FIELDS, x['t'])) return { ok: false, error: 'unknown message' };
  const t = x['t'] as ClientMessage['t'];
  if (!isInt(x['id'], 1, Number.MAX_SAFE_INTEGER)) return { ok: false, error: 'id missing (a positive integer)' };
  const id = x['id'];
  const bad = (error: string): Parsed => ({ ok: false, id, error });
  const extra = Object.keys(x).find((k) => !FIELDS[t].includes(k));
  if (extra) return bad(`unknown field "${extra}"`);
  const name = (v: unknown): string | null => (isStr(v, 200) ? cleanText(v).trim().slice(0, LIMITS.name) : null);
  switch (t) {
    case 'status':
    case 'leave':
      return { ok: true, message: { t, id } };
    case 'forfeit':
      // M12-5a: which guest of a 3-4 player game (a player id of the table: p2-p4)
      if (x['player'] !== undefined && !(typeof x['player'] === 'string' && /^p[2-4]$/.test(x['player']))) return bad('player must be a guest seat\'s player (p2-p4)');
      return { ok: true, message: { t, id, ...(x['player'] !== undefined ? { player: x['player'] as string } : {}) } };
    case 'host': {
      const n = name(x['name']);
      if (n === null) return bad('name missing');
      const deck = checkDeckSubmission(x['deck']);
      if (deck) return bad(deck);
      if (x['format'] !== undefined && !(isStr(x['format'], 60) && /^[\w .'-]+$/.test(x['format']))) return bad('format malformed');
      if (x['port'] !== undefined && !isInt(x['port'], 0, 65535)) return bad('port must be 0-65535');
      // M12-5a (m12 design 6): a 3- or 4-player game (left out: two players, milestone 9's game)
      if (x['seats'] !== undefined && x['seats'] !== 3 && x['seats'] !== 4) return bad('seats must be 3 or 4 (or left out for two players)');
      return {
        ok: true,
        message: {
          t, id, name: n, deck: deckOf(x['deck']), ...(x['format'] !== undefined ? { format: x['format'] as string } : {}), ...(x['port'] !== undefined ? { port: x['port'] as number } : {}),
          ...(x['seats'] !== undefined ? { seats: x['seats'] as 3 | 4 } : {}),
        },
      };
    }
    case 'join': {
      const n = name(x['name']);
      if (n === null) return bad('name missing');
      if (!isStr(x['address'], 300) || parseGameAddress(x['address']).error) return bad(parseGameAddress(String(x['address'] ?? '')).error ?? 'address malformed');
      if (!isStr(x['code'], 64) || !normalizeJoinCode(x['code'])) return bad('That is not a valid join code (16 letters and digits, like 7KQ2-M9XD-4TRB-HC8P).');
      const deck = checkDeckSubmission(x['deck']);
      if (deck) return bad(deck);
      return { ok: true, message: { t, id, name: n, address: x['address'].trim(), code: x['code'], deck: deckOf(x['deck']) } };
    }
    case 'act': {
      const problem = checkAction(x['action']);
      if (problem) return bad(problem);
      return { ok: true, message: { t, id, action: x['action'] as Action } };
    }
    case 'manual':
      if (!isInt(x['proposal'], 1, Number.MAX_SAFE_INTEGER) || typeof x['accept'] !== 'boolean') return bad('manual answer malformed');
      if (x['reason'] !== undefined && !isStr(x['reason'], 500)) return bad('reason too long');
      return {
        ok: true,
        message: { t, id, proposal: x['proposal'], accept: x['accept'], ...(x['reason'] !== undefined ? { reason: cleanText(x['reason'] as string) } : {}) },
      };
    case 'chat':
      if (!isStr(x['text'], LIMITS.chat)) return bad('chat text too long');
      return { ok: true, message: { t, id, text: cleanText(x['text']) } };
    case 'replayConsent':
      // RPL-3: this player's "Show my cards in replays".
      if (typeof x['agree'] !== 'boolean') return bad('agree must be true or false');
      return { ok: true, message: { t, id, agree: x['agree'] } };
  }
}

/** Only `name` and `count` of each entry (checkDeckSubmission checked them; anything else is dropped). */
function deckOf(x: unknown): OnlineDeck {
  const d = x as OnlineDeck;
  const list = (es: { name: string; count: number }[]) => es.map((e) => ({ name: e.name, count: e.count }));
  // M11-3: the commander section travels on to the host (CR 903.3); absent stays absent, so a deck without one is passed on exactly as before.
  // CMP1: the companion section too (CR 702.139a); absent stays absent
  return { main: list(d.main), sideboard: list(d.sideboard), ...(d.commander ? { commander: list(d.commander) } : {}), ...(d.companion ? { companion: list(d.companion) } : {}) };
}

const HOST_NAME = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * The host's address as the guest types it: "203.0.113.5:47620", "[2001:db8::1]:47620", "example.org:47620", or without the port (47620). The
 * host name is looked up when joining (the player asked for it); nothing here contacts anyone.
 */
export function parseGameAddress(s: string): { host: string; port: number; error?: undefined } | { error: string } {
  const t = s.trim();
  let host: string;
  let portText: string | undefined;
  const v6 = /^\[([0-9a-f:.]+)\](?::(\d+))?$/i.exec(t);
  if (v6) {
    host = v6[1]!;
    portText = v6[2];
  } else {
    const parts = t.split(':');
    if (parts.length > 2) return { error: 'Write an IPv6 address in brackets: [2001:db8::1]:47620.' };
    host = parts[0]!;
    portText = parts[1];
  }
  if (!host) return { error: 'The address is missing: the host\'s IP address and port, like 203.0.113.5:47620.' };
  const port = portText === undefined ? DEFAULT_GAME_PORT : Number(portText);
  if (portText !== undefined && (!/^\d{1,5}$/.test(portText) || port < 1 || port > 65535)) return { error: 'The port must be a number from 1 to 65535.' };
  const ip4 = IPV4.exec(host);
  if (ip4) {
    if (ip4.slice(1).some((n) => Number(n) > 255)) return { error: `"${host}" is not an IPv4 address.` };
  } else if (!v6 && !HOST_NAME.test(host)) return { error: `"${host}" is not an IP address or host name.` };
  return { host, port };
}

/** Priority actions: they need priority and must be one of the legal actions of the view (CR 117.1). */
// M6-11: a special action (CR 116.2b: turning a face-down permanent face up) is taken with priority too, and must be one the view offers.
const PRIORITY: ReadonlySet<Action['type']> = new Set<Action['type']>(['pass', 'playLand', 'cast', 'activate', 'special']);

function sameLegal(a: Action, l: LegalAction): boolean {
  const b = l.action;
  if (a.type !== b.type) return false;
  switch (a.type) {
    case 'pass':
      return true;
    case 'playLand':
    case 'cast':
      return a.card === (b as typeof a).card;
    case 'activate':
      return a.source === (b as typeof a).source && a.ability === (b as typeof a).ability;
    case 'special': {
      // the kind and the permanent; `via` when the browser names one (the engine asks for it when there are several, CR 701.40c-d); X is checked by the engine
      const s = b as typeof a;
      return a.kind === s.kind && a.object === s.object && (a.via === undefined || a.via === s.via) && (a.door === undefined || a.door === s.door) && (a.option === undefined || a.option === s.option); // door: FAST5X E8; option: std-freecast-5
    }
    default:
      return false;
  }
}

/**
 * Whether an action of the browser fits this player's current view: its `player` is this player; a priority action is one of `legal` (by its card, or
 * source and ability; the engine checks the rest: face, method, targets and costs come in later decisions); an answer names the pending decision of
 * this player; a cancel needs a decision of this player, a special action priority and one of `legal` (M6-11). Concede (CR 104.3a: at any time) and stops always fit. Returns the refusal,
 * or null. The host's engine checks every action fully afterwards (the guest's on the host's machine).
 */
export function checkClientAction(action: Action, me: PlayerId, view: GameView | null, legal: readonly LegalAction[]): OnlineError | null {
  // std-control-3 (CR 723.5): while `me` controls another player, that player's actions are `me`'s to send (never their concession or stops)
  if (!('player' in action) || (action.player !== me && (view === null || !mayActAs(view, me, action)))) return { code: 'notYourPlayer', message: `You play ${me}; this action is for another player.` };
  if (action.type === 'concede' || action.type === 'setStops') return null;
  if (!view) return { code: 'notStarted', message: 'The game has not started yet.' };
  if (view.result) return { code: 'illegalAction', message: 'The game is over.', rules: ['CR 104.1'] };
  const d = view.pending;
  if (!d || decidingPlayer(d) !== me) return { code: 'stale', message: 'It is not your decision now; wait for your turn to act.' };
  if (PRIORITY.has(action.type)) {
    if (d.kind !== 'priority') return { code: 'stale', message: 'You do not have priority now: answer the pending decision first.', rules: ['CR 117.1'] };
    if (!legal.some((l) => sameLegal(action, l))) return { code: 'illegalAction', message: 'That is not one of your legal actions now.', rules: ['CR 117.1'] };
    return null;
  }
  if (action.type === 'answer' && action.decisionId !== d.id) return { code: 'stale', message: 'That answers an earlier decision; answer the current one.' };
  return null;
}
