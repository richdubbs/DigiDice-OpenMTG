/**
 * Test CLI for two to four processes (on one machine or several):
 *
 *   npm run net -- host [--port 47620] [--address 0.0.0.0] [--name Hana] [--deck deck.txt] [--format casual] [--code XXXX-...] [--seats 3|4] [--auto] [--loss 0.1]
 *   npm run net -- join <ip>:<port> <code> [--name Gus] [--deck deck.txt] [--auto] [--loss 0.1]
 *
 * M12-5a: `--seats 3` or `4` hosts a multiplayer game (m12 design 6): one join code per guest seat (each guest gets its seat's code), the game starts
 * when every seat is taken. Every player answers every other player's manual adjustments (accept / reject); `leave` (host) concedes and keeps running
 * the game for the others.
 *
 * The host needs the local card data (`npm run cards -- refresh`; OPENMTG_CACHE_DIR selects the cache). The guest sends card names only.
 * `--auto` plays automatically (game/autoplay.ts); `--loss` drops that share of this side's datagrams, to watch the link recover.
 * Leave `--code` out: the host then makes a random code. A chosen code is for tests only, and one that is easy to guess is refused (audit m9).
 */
import { readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { createInterface } from 'node:readline';
import { CardDatabase } from '@openmtg/cards';
import { decidingPlayer, type Action, type GameView, type PlayerId } from '@openmtg/engine';
import { NetError } from './errors';
import { autoAction, autoAnswer, type LegalList } from './game/autoplay';
import { deckFromText } from './game/deck';
import { GameGuest } from './game/guest';
import { GameHost } from './game/host';
import { DEFAULT_PORT } from './link/endpoint';
import { FaultInjector } from './link/faults';
import type { DeckSubmission } from './protocol/messages';
import { HELP, renderView } from './cli/render';
import { printable } from './protocol/text';

const DEFAULT_DECK = '20 Forest\n20 Grizzly Bears\n';

interface Args {
  cmd: string;
  positional: string[];
  flags: Record<string, string | true>;
}

function parseArgs(argv: string[]): Args {
  const [cmd = 'help', ...rest] = argv;
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (!a.startsWith('--')) positional.push(a);
    else if (a === '--auto') flags['auto'] = true;
    else flags[a.slice(2)] = rest[++i] ?? '';
  }
  return { cmd, positional, flags };
}

function str(v: string | true | undefined): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function loadDeck(file: string | undefined): DeckSubmission {
  const { deck, errors } = deckFromText(file ? readFileSync(file, 'utf8') : DEFAULT_DECK);
  if (errors.length) throw new Error(`Decklist problems:\n  ${errors.join('\n  ')}`);
  return deck;
}

function faultsFrom(flags: Args['flags']): FaultInjector | undefined {
  const loss = Number(str(flags['loss']) ?? 0);
  return loss > 0 ? new FaultInjector({ loss, seed: Date.now() }) : undefined;
}

/** What the console needs from either side. */
interface Seat {
  me: PlayerId;
  view(): GameView | null;
  legal(): LegalList;
  act(a: Action): Promise<{ ok: boolean; error?: { message: string } }>;
  onView(fn: () => void): void;
  chat(text: string): void;
  close(): Promise<void>;
  /** Commands only this side has (accept / reject manual adjustments; the host: forfeit, leave). True when the word was one of them. */
  command?(word: string, arg: string): boolean;
}

/** M12-5a: print the table of a 3-4 player game. */
function printTable(players: { id: string; name: string; seat: number; connected: boolean; left?: boolean }[]): void {
  console.log(`Table: ${players.map((p) => `${printable(p.name || '(open)')} [${p.id}, seat ${p.seat}${p.left ? ', left' : p.connected ? '' : ', link down'}]`).join(', ')}`);
}

function printProposal(p: { player: string; sourceName: string; lines: string[]; waiting?: string[] }, me: string): void {
  console.log(p.player === me ? `Your manual adjustments wait for ${(p.waiting ?? []).join(', ') || 'nobody'}:` : `${p.player} resolves ${printable(p.sourceName)} by hand and proposes:`);
  for (const l of p.lines) console.log(`  ${printable(l)}`);
  if (p.player !== me) console.log('Answer with: accept   or   reject <reason>');
}

function hostSeat(h: GameHost): Seat {
  return {
    me: h.player,
    view: () => h.view(),
    legal: () => h.legal(),
    act: (a) => Promise.resolve(h.act(a)),
    onView: (fn) => void h.on('view', fn),
    chat: (t) => h.chat(t),
    close: () => h.close(),
    command: (word, arg) => {
      const p = h.pendingManual;
      if (word === 'accept' || word === 'reject') {
        if (!p) console.log('No manual adjustments are waiting for you.');
        else {
          const r = h.answerManual(p.id, word === 'accept', arg || undefined);
          console.log(r.ok ? `Manual adjustments ${word}ed.` : `Could not apply them: ${r.error.message}`);
        }
        return true;
      }
      if (word === 'forfeit') {
        const r = h.forfeitGuest(arg || undefined);
        console.log(r.ok ? 'The guest forfeits the game.' : r.error.message);
        return true;
      }
      if (word === 'leave' && h.seats > 2) {
        const r = h.leave();
        console.log(r.ok ? 'You left the game (conceded); this process keeps running it for the others: keep it open.' : r.error.message);
        return true;
      }
      return false;
    },
  };
}

function guestSeat(g: GameGuest): Seat {
  return {
    me: g.player,
    view: () => g.view,
    legal: () => g.legal,
    act: (a) => g.act(a),
    onView: (fn) => void g.on('view', fn),
    chat: (t) => g.chat(t),
    close: () => g.close(),
    command: (word, arg) => {
      if (word !== 'accept' && word !== 'reject') return false;
      const p = g.proposal;
      if (!p || p.player === g.player) console.log('No manual adjustments are waiting for your answer.');
      else console.log(g.vote(p.id, word === 'accept', arg || undefined) ? `Answer sent (${word}).` : 'Not connected to the host.');
      return true;
    },
  };
}

function runConsole(seat: Seat, startAuto: boolean): Promise<void> {
  let auto = startAuto;
  let busy = false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const show = () => {
    const v = seat.view();
    if (v) for (const l of renderView(v, seat.me, seat.legal())) console.log(printable(l)); // names, log lines and card texts come from the network
  };
  const autoStep = async () => {
    if (!auto || busy) return;
    const v = seat.view();
    const a = v ? autoAction(v, seat.legal(), seat.me) : null;
    if (!a) return;
    busy = true;
    const r = await seat.act(a);
    busy = false;
    if (!r.ok) console.log(`(auto) rejected: ${printable(r.error?.message ?? '')}`);
  };
  let finish: (() => void) | null = null;
  let endWhenOver = false;
  seat.onView(() => {
    show();
    if (endWhenOver && seat.view()?.result) setTimeout(() => finish?.(), 500); // let the last view reach the other side
    setImmediate(() => void autoStep());
  });
  const send = async (a: Action) => {
    const r = await seat.act(a);
    if (!r.ok) console.log(`Rejected: ${printable(r.error?.message ?? '')}`);
  };
  console.log(HELP.join('\n'));
  show();
  void autoStep();
  return new Promise((resolve) => {
    finish = () => void seat.close().then(resolve);
    // Without a terminal (stdin at its end) an automatic player plays on until the game is over.
    rl.on('close', () => {
      if (auto && !seat.view()?.result) endWhenOver = true;
      else finish?.();
    });
    rl.on('line', (line) => {
      const [word = '', ...rest] = line.trim().split(/\s+/);
      const arg = line.trim().slice(word.length).trim();
      const v = seat.view();
      const d = v?.pending;
      const actor = d && decidingPlayer(d) === seat.me ? d.player : seat.me; // std-control-3 (CR 723.5): a player this seat controls
      if (/^\d+$/.test(word)) {
        const l = seat.legal()[Number(word) - 1];
        if (l) void send(l.action);
        else console.log('No such action.');
      } else if (word === 'pass') void send({ type: 'pass', player: actor });
      else if (word === 'cancel') void send({ type: 'cancel', player: actor });
      else if (word === 'concede') void send({ type: 'concede', player: seat.me });
      else if (word === 'd' && d && decidingPlayer(d) === seat.me && d.kind !== 'priority') {
        const ans = autoAnswer(d, actor);
        if (ans === 'cancel') void send({ type: 'cancel', player: actor });
        else if (ans) void send({ type: 'answer', player: actor, decisionId: d.id, answer: ans });
        else console.log('No default answer; use a <answer JSON>.');
      } else if (word === 'a' && d) {
        try {
          void send({ type: 'answer', player: actor, decisionId: d.id, answer: JSON.parse(arg) });
        } catch {
          console.log('Not valid JSON.');
        }
      } else if (word === 'auto') {
        auto = !auto;
        console.log(`Automatic play ${auto ? 'on' : 'off'}.`);
        void autoStep();
      } else if (word === 'view') show();
      else if (word === 'chat') seat.chat(arg);
      else if (word === 'quit' || word === 'exit') rl.close();
      else if (seat.command?.(word, arg)) return;
      else if (word) console.log(HELP.join('\n'));
      void rest;
    });
  });
}

function localAddresses(): string[] {
  return Object.values(networkInterfaces()).flatMap((list) => (list ?? []).filter((i) => i.family === 'IPv4' && !i.internal).map((i) => i.address));
}

async function host(a: Args): Promise<number> {
  const cards = await CardDatabase.open();
  const faults = faultsFrom(a.flags);
  const port = Number(str(a.flags['port']) ?? DEFAULT_PORT);
  const seats = Number(str(a.flags['seats']) ?? 2);
  if (seats !== 2 && seats !== 3 && seats !== 4) {
    console.error('--seats must be 2, 3 or 4.');
    return 2;
  }
  const h = await GameHost.start({
    name: str(a.flags['name']) ?? 'Host', deck: loadDeck(str(a.flags['deck'])), cards, format: str(a.flags['format']) ?? 'casual', port,
    address: str(a.flags['address']) ?? '0.0.0.0', ...(str(a.flags['code']) ? { code: str(a.flags['code'])! } : {}), ...(faults ? { faults } : {}), seats,
  });
  const where = `${localAddresses()[0] ?? '127.0.0.1'}:${h.port}`;
  if (seats === 2) {
    console.log(`Hosting on UDP port ${h.port}. Join code: ${h.code}`);
    console.log(`On this machine or network: npm run net -- join ${where} ${h.code}`);
  } else {
    console.log(`Hosting a ${seats}-player game on UDP port ${h.port}. One join code per seat: give each guest their own.`);
    for (const c of h.codes) console.log(`  seat ${c.seat} (${c.player}): npm run net -- join ${where} ${c.code}`);
  }
  console.log(`Over the internet: forward UDP port ${h.port} on your router to this machine and allow it in the firewall; the guest uses your public IP`);
  console.log('(your router\'s status page shows it; OpenMTG does not ask any IP-lookup service).');
  h.on('rejected', (r) => console.log(`Refused a connection: ${printable(r)}`));
  h.on('guestLeft', (r, final) => console.log(final ? `The guest left (${printable(r)}).` : `The guest dropped (${printable(r)}); waiting for them to come back (forfeit: end the game for them)...`));
  h.on('manualProposal', (p) => {
    console.log(`The guest resolves ${printable(p.sourceName)} by hand and proposes:`);
    for (const l of p.lines) console.log(`  ${printable(l)}`);
    if (a.flags['auto'] === true) {
      console.log('(auto) accepted.');
      h.answerManual(p.id, true);
    } else console.log('Answer with: accept   or   reject <reason>');
  });
  h.on('guestResumed', (p) => console.log(seats === 2 ? 'The guest is back.' : `${p} is back.`));
  h.on('chat', (t, from) => console.log(`[${seats === 2 ? 'guest' : from}] ${printable(t)}`));
  // M12-5a: the host's own manual adjustments wait for the other players' answers in a two-player game too.
  h.on('manualPending', (p) => printProposal(p, h.player));
  h.on('manualClosed', (id, outcome, by) => console.log(`Manual adjustments ${id}: ${outcome}${by ? ` (${by})` : ''}.`));
  if (seats > 2) {
    h.on('notice', (_kind, _p, text) => console.log(printable(text)));
    h.on('table', (players) => printTable(players));
    await new Promise<void>((r) => h.on('start', (table) => {
      console.log(`Every seat is taken. The game begins; seating (CR 806.3): ${table.map((p) => printable(p.name)).join(', ')}.`);
      r();
    }));
  } else {
    await new Promise<void>((r) => h.on('guestJoined', (name) => {
      console.log(`${printable(name)} joined. The game begins.`);
      r();
    }));
  }
  await runConsole(hostSeat(h), a.flags['auto'] === true);
  return 0;
}

async function join(a: Args): Promise<number> {
  const [target, code] = a.positional;
  const m = target ? /^\[?([^\]]+?)\]?:(\d+)$/.exec(target) : null;
  if (!m || !code) {
    console.error('Usage: npm run net -- join <ip>:<port> <code> [--name N] [--deck file] [--auto]');
    return 2;
  }
  const faults = faultsFrom(a.flags);
  const g = await GameGuest.join({ host: m[1]!, port: Number(m[2]), code, name: str(a.flags['name']) ?? 'Guest', deck: loadDeck(str(a.flags['deck'])), ...(faults ? { faults } : {}) });
  console.log(`Joined ${printable(g.opponent.name)}'s game (${printable(g.format)}) as ${g.player}${g.seat !== null ? `, seat ${g.seat} of ${g.seats}` : ''}.`);
  for (const w of g.warnings) console.log(`Warning: ${printable(w)}`);
  g.on('disconnected', (r) => console.log(`Connection lost (${r}); reconnecting...`));
  g.on('reconnected', () => console.log('Reconnected.'));
  g.on('chat', (t, from) => console.log(`[${from ?? 'host'}] ${printable(t)}`));
  // M12-5a: the table of a 3-4 player game
  g.on('table', (players) => printTable(players));
  g.on('start', (players) => console.log(`Every seat is taken. The game begins; seating (CR 806.3): ${players.map((p) => printable(p.name)).join(', ')}.`));
  g.on('notice', (_kind, _p, text) => console.log(printable(text)));
  g.on('manualProposal', (p) => {
    printProposal(p, g.player);
    if (a.flags['auto'] === true && p.player !== g.player && p.waiting.includes(g.player)) {
      console.log('(auto) accepted.');
      g.vote(p.id, true);
    }
  });
  g.on('manualClosed', (c) => console.log(`Manual adjustments ${c.proposal}: ${c.outcome}${c.by ? ` (${c.by})` : ''}.`));
  if (g.seats > 2 && !g.started) console.log('Waiting for every seat to be taken...');
  g.on('error', (e) => { if (e.ref === undefined) console.log(`Host: ${printable(e.message)}`); });
  g.on('closed', (r) => {
    console.log(`Game closed: ${printable(r)}`);
    process.exit(0);
  });
  await runConsole(guestSeat(g), a.flags['auto'] === true);
  return 0;
}

async function main(argv: string[]): Promise<number> {
  const a = parseArgs(argv);
  try {
    if (a.cmd === 'host') return await host(a);
    if (a.cmd === 'join') return await join(a);
  } catch (e) {
    if (e instanceof NetError) {
      console.error(`${e.message}${e.details.length ? `\n  ${e.details.join('\n  ')}` : ''}`);
      return 1;
    }
    throw e;
  }
  console.log('Usage:\n  npm run net -- host [--port 47620] [--name N] [--deck file] [--format casual] [--seats 3|4] [--auto]\n  npm run net -- join <ip>:<port> <code> [--name N] [--deck file] [--auto]');
  return a.cmd === 'help' ? 0 : 2;
}

process.exitCode = await main(process.argv.slice(2));
