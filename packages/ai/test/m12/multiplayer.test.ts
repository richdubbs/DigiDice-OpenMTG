/**
 * M12-6 (docs/design/m12-multiplayer.md 7, 9): the minimal AI for 3-4 players. The bot's view of several opponents (`opps`, the focus), attacks spread over
 * them (CR 802, 506.2, 508.1b), targets and the multiplayer choices among them (CR 310.12a, 704.5x, 508.5a, 601.7a, 800.4g; votes CR 701.38a; goad's
 * requirement CR 701.15b), and whole AI-against-AI 3- and 4-player games with players leaving (CR 104.3a, 800.4a) played to a result.
 *
 * Two-player play is unchanged: test/neutrality/two-player-logs.test.ts (OPENMTG_SLOW=1) is that gate.
 */
import { describe, expect, it } from 'vitest';
import {
  applyAction, commanderOptions, compileCard, createGame, viewFor,
  type Action, type OracleCard, type ChooseOptionDecision, type DeclareAttackersDecision, type GameConfig, type GameState, type MultiplayerOptions, type ObjectId, type PlayerId,
} from '@openmtg/engine';
import { compiledDefs } from '../../../engine/test/fixtures';
import { SLOW } from '../../../engine/test/slow';
import { act, put, type PutOptions } from '../../../engine/test/m3/scenario';
import { answer, concede, drive, find, lifeOf, mpScenario, pass, passUntil, resolveStack } from '../../../engine/test/m12/rules/helpers';
import { clone } from '../../../engine/src/util/clone';
import { makeCtx } from '../../src/context';
import { chooseAction } from '../../src/index';
import { DECKS, expand, TEST_STOPS, type DeckList } from '../decks';

const FREE_FOR_ALL: MultiplayerOptions = { variant: 'freeForAll', attack: 'multiple' };
const NAMES = ['Alice', 'Bob', 'Carol', 'Dan'];
const CARDS = ['Plains', 'Forest', 'Grizzly Bears', 'Hill Giant', 'Serra Angel', 'Craw Wurm', 'Garruk Wildspeaker', 'Llanowar Elves'];

type Zones = Partial<Record<PlayerId, { battlefield?: (string | PutOptions)[]; life?: number }>>;

/** A started game of `n` players (p1 first, no mulligans) at p1's first main phase; hands empty, 20 Plains in each library, then `zones`. */
function table(n: number, zones: Zones = {}): GameState {
  const deck = Array<string>(40).fill('Plains');
  const config: GameConfig = {
    seed: 'm12-6-table',
    players: NAMES.slice(0, n).map((name) => ({ name, deck, stops: { fullControl: true } })),
    defs: compiledDefs(CARDS),
    options: { startingPlayer: 'p1', skipMulligans: true, ...(n > 2 ? { multiplayer: FREE_FOR_ALL } : {}) },
  };
  let s = clone(createGame(config));
  for (const p of s.players) {
    for (const z of ['hand', 'library'] as const) {
      for (const id of s.zones[z][p.id]!) delete s.objects[id];
      s.zones[z][p.id] = [];
    }
    for (let i = 0; i < 20; i++) put(s, p.id, 'library', 'Plains');
    for (const name of zones[p.id]?.battlefield ?? []) put(s, p.id, 'battlefield', name);
    if (zones[p.id]?.life !== undefined) p.life = zones[p.id]!.life!;
  }
  while (s.turn.step !== 'main1') s = act(s, { type: 'pass', player: s.pending!.player });
  return s;
}

/** Pass until p1 declares attackers. */
function toAttacks(s: GameState): GameState {
  for (let i = 0; i < 40 && s.pending!.kind !== 'declareAttackers'; i++) s = act(s, { type: 'pass', player: s.pending!.player });
  expect(s.pending).toMatchObject({ kind: 'declareAttackers', player: 'p1' });
  return s;
}

const ai = (s: GameState, decision = s.pending!): Action => chooseAction(viewFor(s, decision.player), decision, 'm12-6');
const attacksOf = (a: Action): { attacker: ObjectId; defender: string }[] =>
  ((a as Extract<Action, { type: 'answer' }>).answer as { attacks: { attacker: ObjectId; defender: string }[] }).attacks;
const optionIds = (a: Action): string[] => ((a as Extract<Action, { type: 'answer' }>).answer as { ids: string[] }).ids;
const named = (s: GameState, name: string, controller: PlayerId): ObjectId[] =>
  s.zones.battlefield.filter((id) => s.objects[id]!.defId === name && s.objects[id]!.controller === controller);

describe('M12-6: the bot\'s opponents (m12 design 7, A1)', () => {
  it('two players: opps is the one opponent, as before (D16)', () => {
    const s = table(2);
    const ctx = makeCtx(viewFor(s, 'p1'), s.pending!, 'x');
    expect(ctx.opps).toEqual(['p2']);
    expect(ctx.opp).toBe('p2');
  });

  it('CR 101.4: the opponents in turn order from the bot; the focus has the most power on the battlefield', () => {
    const s = table(4, { p3: { battlefield: ['Craw Wurm'] }, p4: { battlefield: ['Grizzly Bears'] } });
    const ctx = makeCtx(viewFor(s, 'p2'), { ...s.pending!, player: 'p2' }, 'x');
    expect(ctx.opps).toEqual(['p3', 'p4', 'p1']);
    expect(ctx.opp).toBe('p3');
  });

  it('equal power: the focus is the opponent with the lowest life, then the next in turn order', () => {
    const s = table(4, { p3: { life: 7 } });
    expect(makeCtx(viewFor(s, 'p1'), s.pending!, 'x').opp).toBe('p3');
    const t = table(4);
    expect(makeCtx(viewFor(t, 'p1'), t.pending!, 'x').opp).toBe('p2');
  });

  it('CR 800.4a: a player who left is never an opponent, never the focus', () => {
    let s = table(4, { p2: { battlefield: ['Craw Wurm', 'Craw Wurm'] } });
    s = act(s, { type: 'concede', player: 'p2' });
    expect(s.result).toBeNull();
    const ctx = makeCtx(viewFor(s, 'p1'), s.pending!, 'x');
    expect(ctx.opps).toEqual(['p3', 'p4']);
    expect(ctx.opp).not.toBe('p2');
  });
});

describe('M12-6: attacks with several opponents (CR 802, 506.2, 508.1b; A2-A5)', () => {
  it('the attackers group on the opponent who can\'t block them well, not on the one with a big blocker', () => {
    let s = table(3, { p1: { battlefield: ['Grizzly Bears', 'Grizzly Bears', 'Hill Giant'] }, p2: { battlefield: ['Serra Angel'] }, p3: { battlefield: ['Llanowar Elves'] } });
    s = toAttacks(s);
    const attacks = attacksOf(ai(s));
    expect(attacks.length).toBe(3);
    expect(new Set(attacks.map((x) => x.defender))).toEqual(new Set(['p3']));
  });

  it('a lethal split: the fewest attackers that finish the opponent at low life go there, the rest at another opponent', () => {
    let s = table(4, { p1: { battlefield: ['Grizzly Bears', 'Grizzly Bears', 'Hill Giant', 'Hill Giant'] }, p3: { life: 5 } });
    s = toAttacks(s);
    const attacks = attacksOf(ai(s));
    const at = (p: string): ObjectId[] => attacks.filter((x) => x.defender === p).map((x) => x.attacker);
    expect(at('p3').length).toBe(2); // two Hill Giants: 6 >= 5
    expect(at('p3').every((id) => s.objects[id]!.defId === 'Hill Giant')).toBe(true);
    expect(attacks.length).toBe(4);
    expect(new Set(attacks.map((x) => x.defender)).size).toBe(2);
    // and it is lethal: the game goes on without p3
    s = act(s, ai(s));
    for (let i = 0; i < 80 && !s.players.find((p) => p.id === 'p3')!.hasLost; i++) s = act(s, s.pending!.player === 'p1' ? ai(s) : { type: 'pass', player: s.pending!.player });
    expect(s.players.find((p) => p.id === 'p3')!.hasLost).toBe(true);
    expect(s.result).toBeNull();
  });

  it('CR 306.4, 508.1b: a planeswalker whose loyalty its damage removes, when its controller has nothing to block with', () => {
    let s = table(3, { p1: { battlefield: ['Hill Giant'] }, p2: { battlefield: [{ name: 'Garruk Wildspeaker', counters: { loyalty: 3 } }] }, p3: { battlefield: ['Serra Angel'] } });
    const garruk = named(s, 'Garruk Wildspeaker', 'p2')[0]!;
    s = toAttacks(s);
    expect(attacksOf(ai(s))).toEqual([{ attacker: named(s, 'Hill Giant', 'p1')[0]!, defender: garruk }]);
  });

  it('crack-back: enough creatures stay home that the strongest single opponent can\'t kill the bot', () => {
    let s = table(3, { p1: { battlefield: ['Grizzly Bears', 'Grizzly Bears'], life: 4 }, p2: { battlefield: ['Hill Giant', 'Grizzly Bears'] }, p3: { battlefield: [] } });
    s = toAttacks(s);
    expect(attacksOf(ai(s)).length).toBeLessThan(2);
  });

  it('CR 701.15b: a goaded creature attacks a player other than its goader (the requirement\'s `among`)', () => {
    let s = table(4, { p1: { battlefield: ['Grizzly Bears'] }, p2: { battlefield: ['Craw Wurm'] }, p4: { battlefield: ['Craw Wurm'] } });
    s = toAttacks(s);
    const d = s.pending as DeclareAttackersDecision;
    const bear = named(s, 'Grizzly Bears', 'p1')[0]!;
    // without the requirement it attacks p3 (no blockers there); goaded by p3 it must attack p2 or p4
    expect(attacksOf(ai(s))).toEqual([{ attacker: bear, defender: 'p3' }]);
    const goaded: DeclareAttackersDecision = {
      ...d,
      candidates: d.candidates.map((c) => (c.id === bear ? { ...c, mustAttack: true } : c)),
      requirements: [
        { id: `req:attack:goad.0.p3.each:${bear}`, creature: bear, kind: 'attack', sourceName: "Carol's goad", text: 'attacks each combat if able' },
        { id: `req:attack:goad.0.p3.other:${bear}`, creature: bear, kind: 'attack', among: ['p2', 'p4'], sourceName: "Carol's goad", text: 'attacks a player other than Carol if able' },
      ],
    };
    const attacks = attacksOf(ai(s, goaded));
    expect(attacks.length).toBe(1);
    expect(['p2', 'p4']).toContain(attacks[0]!.defender);
  });
});

describe('M12-6: the multiplayer choices among players (D13) and votes', () => {
  const choice = (s: GameState, rules: string[], ids: string[], extra: Partial<ChooseOptionDecision> = {}): ChooseOptionDecision => ({
    kind: 'chooseOption', id: 'd-m12-6', player: 'p1', prompt: 'Choose.', min: 1, max: 1, rules,
    options: ids.map((id) => ({ id, label: s.players.find((p) => p.id === id)?.name ?? id })), ...extra,
  });

  it('CR 310.12a, 704.5x: a Siege\'s protector is the opponent with the least to block with', () => {
    const s = table(4, { p2: { battlefield: ['Serra Angel'] }, p3: { battlefield: ['Grizzly Bears'] }, p4: { battlefield: ['Craw Wurm'] } });
    expect(optionIds(ai(s, choice(s, ['CR 310.9a', 'CR 310.12a'], ['p2', 'p3', 'p4'])))).toEqual(['p3']);
    expect(optionIds(ai(s, choice(s, ['CR 704.5x', 'CR 310.12a'], ['p2', 'p4'])))).toEqual(['p2']);
  });

  it('CR 508.5a, 601.7a, 800.4g: the defending player, "an opponent" and another opponent are the focus, never the bot', () => {
    const s = table(4, { p4: { battlefield: ['Craw Wurm'] } });
    for (const rules of [['CR 508.5a', 'CR 802.2a'], ['CR 601.7a'], ['CR 800.4g']]) {
      expect(optionIds(ai(s, choice(s, rules, ['p2', 'p3', 'p4'])))).toEqual(['p4']);
    }
    // the bot is offered (a defending player chosen on another player's turn): an opponent anyway
    expect(optionIds(ai(s, choice(s, ['CR 508.5a', 'CR 802.2a'], ['p1', 'p2'])))).toEqual(['p2']);
  });

  it('CR 701.38a-b: votes for words take the first word; votes for players take an opponent, or the bot for a helpful result', () => {
    const s = table(4, { p3: { battlefield: ['Craw Wurm'] } });
    const words = choice(s, ['CR 701.38a'], [], { prompt: 'Vote for one of these (carnage or homage).', options: [{ id: 'carnage', label: 'carnage' }, { id: 'homage', label: 'homage' }] });
    expect(optionIds(ai(s, words))).toEqual(['carnage']);
    // CR 701.38d: two votes it must cast (the same choice allowed more than once)
    expect(optionIds(ai(s, { ...words, min: 2, max: 3, allowRepeat: true, rules: ['CR 701.38a', 'CR 701.38d'] }))).toEqual(['carnage', 'carnage']);
    const players = ['p1', 'p2', 'p3', 'p4'];
    expect(optionIds(ai(s, choice(s, ['CR 701.38a'], players, { prompt: 'Vote for a player (each player with the most votes sacrifices a creature).' })))).toEqual(['p3']);
    expect(optionIds(ai(s, choice(s, ['CR 701.38a'], players, { prompt: 'Vote for a player (each player with the most votes draws two cards).' })))).toEqual(['p1']);
  });
});

describe('M12-6: the multiplayer choices on the real engine (M12-2\'s decisions, answered and accepted)', () => {
  const SIEGE = 'Invasion of Tarkir // Defiant Thundermaw';
  const aiAnswers = (s: GameState): GameState => act(s, ai(s));

  it('CR 310.12a: the AI casts nothing by hand: its Siege\'s protector is the opponent with the least to block with', () => {
    let s = mpScenario({
      cards: [SIEGE, 'Mountain', 'Serra Angel', 'Grizzly Bears'],
      zones: { p1: { hand: [SIEGE], battlefield: ['Mountain', 'Mountain'] }, p2: { battlefield: ['Serra Angel'] }, p4: { battlefield: ['Grizzly Bears'] } },
    });
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, SIEGE, 'hand', 'p1') }));
    s = resolveStack(s);
    expect(s.pending).toMatchObject({ kind: 'chooseOption', player: 'p1', rules: ['CR 310.9a', 'CR 310.12a'] });
    s = aiAnswers(s);
    expect(s.objects[find(s, SIEGE, 'battlefield', 'p1')]!.protector).toBe('p3');
  });

  it('CR 704.5x: the protector leaves the game (CR 800.4a): the AI chooses a new one among the opponents left', () => {
    const s = mpScenario({
      cards: [SIEGE, 'Grizzly Bears'], zones: { p1: { battlefield: [{ name: SIEGE, counters: { defense: 5 } }] }, p3: { battlefield: ['Grizzly Bears'] } },
      setup: (x) => { x.objects[find(x, SIEGE, 'battlefield', 'p1')]!.protector = 'p2'; },
    });
    let t = concede(s, 'p2').state;
    expect(t.pending).toMatchObject({ kind: 'chooseOption', player: 'p1', rules: ['CR 704.5x', 'CR 310.12a'] });
    t = aiAnswers(t);
    expect(t.objects[find(t, SIEGE, 'battlefield', 'p1')]!.protector).toBe('p4');
  });

  it('CR 508.5a: "defending player" of the AI\'s spell on another player\'s turn: an opponent, never itself', () => {
    const jab = compileCard({ name: 'Defender Jab', layout: 'normal', mana_cost: '{R}', type_line: 'Instant', oracle_text: 'Defending player loses 1 life.' } as OracleCard);
    let s = mpScenario({ cards: ['Grizzly Bears', 'Mountain', 'Craw Wurm'], defs: [jab], zones: { p1: { battlefield: ['Grizzly Bears'] }, p2: { hand: ['Defender Jab'], battlefield: ['Mountain'] }, p4: { battlefield: ['Craw Wurm'] } } });
    s = passUntil(s, (x) => x.pending?.kind === 'declareAttackers', 'the attack');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Grizzly Bears', 'battlefield', 'p1'), defender: 'p3' }] });
    s = pass(s);
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Defender Jab', 'hand', 'p2') }));
    s = resolveStack(s);
    expect(s.pending).toMatchObject({ kind: 'chooseOption', player: 'p2', rules: ['CR 508.5a', 'CR 802.2a'] });
    s = aiAnswers(s);
    expect(lifeOf(s, 'p2')).toBe(20);
    expect(lifeOf(s, 'p4')).toBe(19); // Dan (the Craw Wurm: the most power) is Bob's focus
  });
});

// ---- whole games ------------------------------------------------------------------------------------------------------------------------------------

/** `player` concedes from `turn` on; `own`: while their own decision waits (else another player's); `midAction`: a decision other than priority. */
interface Leave { player: PlayerId; turn: number; midAction: boolean; own?: boolean }

interface GameRun {
  state: GameState;
  actions: number;
  rejected: string[];
  /** Per attacking player, the players they attacked (or whose planeswalkers they attacked). */
  attacked: Map<PlayerId, Set<PlayerId>>;
  problems: string[];
}

/**
 * AI-against-AI: every seat is the AI on its own view (CR 400.2). At `leave.turn`, `leave.player` concedes: at once while another player holds priority,
 * or (midAction) while another player's action waits for a decision (m12 design D11). Every AI action must be accepted.
 */
function playMulti(seed: string, decks: DeckList[], leave: Leave | null, commanders?: string[], budget = 30000): GameRun {
  const names = [...new Set([...decks.flatMap((d) => d.map(([n]) => n)), ...(commanders ?? [])])];
  const config: GameConfig = {
    seed,
    players: decks.map((d, i) => ({ name: NAMES[i]!, deck: expand(d), stops: TEST_STOPS, ...(commanders ? { commanders: [commanders[i]!] } : {}) })),
    defs: compiledDefs(names),
    options: { multiplayer: FREE_FOR_ALL, ...(commanders ? { commander: commanderOptions('commander') } : {}) },
  };
  let s = createGame(config);
  const rejected: string[] = [];
  const problems: string[] = [];
  const attacked = new Map<PlayerId, Set<PlayerId>>();
  let left = leave === null;
  let n = 0;
  for (; n < budget && !s.result; n++) {
    const d = s.pending!;
    if (s.players.find((p) => p.id === d.player)!.hasLost) problems.push(`action ${n}: a ${d.kind} decision is pending for ${d.player}, who left the game`);
    if (!left && s.turn.number >= leave!.turn && (d.player === leave!.player) === (leave!.own === true) && (leave!.midAction ? d.kind !== 'priority' : d.kind === 'priority')) {
      const r = applyAction(s, { type: 'concede', player: leave!.player });
      if (r.error) problems.push(`the concession was rejected: ${r.error.message}`);
      else s = r.state;
      left = true;
      continue;
    }
    const view = viewFor(s, d.player);
    const a = chooseAction(view, view.pending!, `${seed}-${d.player}`);
    if (d.kind === 'declareAttackers' && a.type === 'answer' && a.answer.kind === 'declareAttackers') {
      for (const x of a.answer.attacks) {
        const target = s.players.some((p) => p.id === x.defender) ? x.defender : s.objects[x.defender]?.controller;
        if (target === undefined) continue;
        if (s.players.find((p) => p.id === target)?.hasLost) problems.push(`action ${n}: ${d.player} attacks ${target}, who left the game`);
        if (!attacked.has(d.player)) attacked.set(d.player, new Set());
        attacked.get(d.player)!.add(target);
      }
    }
    const r = applyAction(s, a);
    if (r.error) {
      rejected.push(`action ${n} (${d.player}, ${d.kind}): ${JSON.stringify(a)}: ${r.error.message}`);
      if (rejected.length > 5) break;
      continue;
    }
    s = r.state;
  }
  return { state: s, actions: n, rejected, attacked, problems };
}

function expectGood(g: GameRun, players: number, spread: boolean): void {
  expect(g.rejected).toEqual([]);
  expect(g.problems).toEqual([]);
  expect(g.state.result).not.toBeNull();
  expect(g.state.players.length).toBe(players);
  // the attacks spread over several opponents during the game (m12 design 7): more than one player is attacked, and (unless a player left early, which
  // makes it a two-player game) at least one AI attacks two or more different opponents
  const all = new Set([...g.attacked.values()].flatMap((x) => [...x]));
  expect(all.size).toBeGreaterThanOrEqual(2);
  if (spread) expect([...g.attacked.values()].some((x) => x.size >= 2)).toBe(true);
}

const COMMANDERS = ['Isamaru, Hound of Konda', 'Kitchen Finks', 'Isamaru, Hound of Konda', 'Kitchen Finks'];

const GAMES: { seed: string; decks: DeckList[]; leave: Leave | null; slow?: boolean; commanders?: string[] }[] = [
  { seed: 'm12-6-ai-3p-0', decks: [DECKS[0]!, DECKS[1]!, DECKS[2]!], leave: null },
  { seed: 'm12-6-ai-4p-0', decks: [DECKS[0]!, DECKS[1]!, DECKS[2]!, DECKS[0]!], leave: { player: 'p3', turn: 6, midAction: true } },
  { seed: 'm12-6-ai-3p-1', decks: [DECKS[1]!, DECKS[2]!, DECKS[0]!], leave: { player: 'p1', turn: 4, midAction: false }, slow: true },
  { seed: 'm12-6-ai-4p-1', decks: [DECKS[2]!, DECKS[0]!, DECKS[1]!, DECKS[1]!], leave: null, slow: true },
  { seed: 'm12-6-ai-4p-2', decks: [DECKS[1]!, DECKS[1]!, DECKS[0]!, DECKS[2]!], leave: { player: 'p2', turn: 8, midAction: false }, slow: true },
  { seed: 'm12-6-ai-3p-2', decks: [DECKS[0]!, DECKS[0]!, DECKS[1]!], leave: { player: 'p2', turn: 5, midAction: true }, slow: true },
  { seed: 'm12-6-ai-4p-3', decks: [DECKS[0]!, DECKS[2]!, DECKS[1]!, DECKS[0]!], leave: { player: 'p4', turn: 7, midAction: true, own: true }, slow: true },
  // multiplayer Commander (CR 903.2, 903.7: 40 life; 903.10a: 21 combat damage from one commander)
  { seed: 'm12-6-ai-cmd-4p', decks: [DECKS[1]!, DECKS[0]!, DECKS[1]!, DECKS[0]!], leave: { player: 'p1', turn: 9, midAction: false, own: true }, slow: true, commanders: COMMANDERS },
];

describe('M12-6: AI-against-AI games with 3 and 4 players (m12 design 7, 9)', () => {
  for (const g of GAMES) {
    const run = g.slow && !SLOW ? it.skip : it;
    run(`${g.seed}: ${g.decks.length} players${g.leave ? `, ${g.leave.player} concedes ${g.leave.midAction ? 'mid-action' : 'mid-round'} on turn ${g.leave.turn}` : ''}: played to a result, every AI action accepted`, () => {
      const r = playMulti(g.seed, g.decks, g.leave, g.commanders);
      console.log(`${g.seed}: ${r.actions} actions, ${r.state.turn.number} turns, winner ${r.state.result?.winner ?? 'none'}, attacked ${[...r.attacked].map(([p, x]) => `${p}->${[...x].join('/')}`).join(' ')}`);
      expectGood(r, g.decks.length, g.decks.length === 4 || g.leave === null);
      if (g.leave) expect(r.state.players.find((p) => p.id === g.leave!.player)!.hasLost).toBe(true);
    }, 600_000);
  }
});
