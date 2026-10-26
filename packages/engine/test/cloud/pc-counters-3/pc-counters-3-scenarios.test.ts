/**
 * Precon lane pc-counters, round pc-counters-3, played through the engine with synthetic cards compiled by the game's default compiler (invented names, design
 * 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 107.14, 122.1, 608.2h   "You get {E} for each creature you control": counted as the ability resolves; "you get six {E}"
 *   CR 107.1a, 107.3, 122.1    "Draw X cards, then you get half X rad counters, rounded up."
 *   CR 603.10a, 700.4          "put X +1/+1 counters on target creature you control, where X is the power of the creature that died": the dying creature's last known power
 *   CR 122.1                   "the number of counters among creatures you control"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, findAll, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: string[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const chars = (s: GameState, id: ObjectId) => getChars(s, id);
/** How many objects of this name are in the zone (an object that changes zone is a new object, CR 400.7: ids do not follow it). */
const inZone = (s: GameState, name: string, zone: 'battlefield' | 'graveyard' | 'exile' | 'hand', who?: PlayerId): number => findAll(s, name, zone, who).length;
const counters = (s: GameState, id: ObjectId): Record<string, number> => s.objects[id]!.counters;

/** Answer every decision: yes/no by `yes`, targets in order from `targets`, mana automatically. */
function drive(s0: GameState, o: { yes?: boolean; targets?: ObjectId[][]; players?: PlayerId[][] } = {}): GameState {
  let s = s0;
  const tq = [...(o.targets ?? [])];
  const pq = [...(o.players ?? [])];
  for (let guard = 0; guard < 80 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, Math.max(p.min, 1)).slice(0, p.max) });
    else if (p.kind === 'chooseTargets') {
      const objs = (tq.shift() ?? []).map((id) => ({ kind: 'object' as const, id }));
      const plrs = (pq.shift() ?? []).map((id) => ({ kind: 'player' as const, id }));
      s = answer(s, { kind: 'chooseTargets', targets: [...objs, ...plrs] });
    } else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Parameters<typeof drive>[1] = {}): GameState {
  let s = drive(s0, o);
  for (let guard = 0; guard < 60 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, o);
  return s;
}
const cast = (s0: GameState, name: string, o: Parameters<typeof drive>[1] = {}, who: PlayerId = 'p1'): GameState =>
  resolveAll(act(s0, { type: 'cast', player: who, card: find(s0, name, 'hand', who) }), o);

const energy = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.counters['energy'] ?? 0;
const rad = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.counters['rad'] ?? 0;
const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'], colors: ['G'] });
const BRUTE = card('Test Brute', 'Creature — Ogre', '', { pt: ['5', '4'], colors: ['R'] });

describe('CR 107.14, 122.1, 608.2h: energy per object and number words', () => {
  const SKY = card('Test Sky', 'Sorcery', 'You get {E} for each creature you control.');
  const WHALE = card('Test Whale', 'Creature — Whale', 'When this creature enters, you get six {E}.', { pt: ['1', '1'] });
  const defs = [SKY, WHALE, BEAR];
  it('are fully automated', () => { for (const d of [SKY, WHALE]) expect(full(d)).toBe(true); });
  it('one energy for each creature you control (not the opponent\'s); none with no creature', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Sky'], battlefield: ['Test Bear', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] } });
    s = cast(s, 'Test Sky');
    expect(energy(s, 'p1')).toBe(2);
    let t = scenario([], { defs, p1: { hand: ['Test Sky'] }, p2: { battlefield: ['Test Bear'] } });
    t = cast(t, 'Test Sky');
    expect(energy(t, 'p1')).toBe(0);
  });
  it('"you get six {E}" is six energy counters', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Whale'] } });
    s = cast(s, 'Test Whale');
    expect(energy(s, 'p1')).toBe(6);
    expect(energy(s, 'p2')).toBe(0);
  });
});

describe('CR 107.1a, 107.3, 122.1: "Draw X cards, then you get half X rad counters, rounded up."', () => {
  const DRINK = card('Test Drink', 'Instant', 'Draw X cards, then you get half X rad counters, rounded up.', { cost: '{X}' });
  const defs = [DRINK];
  it('is fully automated', () => expect(full(DRINK)).toBe(true));
  for (const [x, expected] of [[0, 0], [1, 1], [4, 2], [5, 3]] as const) {
    it(`X = ${x}: ${expected} rad counters (half, rounded up)`, () => {
      let s = scenario([], { defs, p1: { hand: ['Test Drink'], battlefield: ['Plains', 'Plains', 'Plains', 'Plains', 'Plains'] } });
      s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Drink', 'hand', 'p1') });
      for (let guard = 0; guard < 20 && s.pending && s.pending.kind !== 'priority'; guard++) {
        if (s.pending.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: x });
        else s = drive(s);
      }
      s = resolveAll(s);
      expect(rad(s, 'p1')).toBe(expected);
      expect(rad(s, 'p2')).toBe(0);
    });
  }
});

describe('CR 603.10a, 700.4: "Whenever a creature you control dies, put X +1/+1 counters on target creature you control, where X is the power of the creature that died."', () => {
  const PRESENCE = card('Test Presence', 'Enchantment', 'Whenever a creature you control dies, put X +1/+1 counters on target creature you control, where X is the power of the creature that died.');
  const SLAY = card('Test Slay', 'Sorcery', 'Destroy target creature.');
  const defs = [PRESENCE, SLAY, BEAR, BRUTE];
  it('is fully automated', () => expect(full(PRESENCE)).toBe(true));
  it('the dying creature\'s power as it was (its own +1/+1 counters included), put on the chosen creature; the target\'s own power does not matter', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Slay'], battlefield: ['Test Presence', 'Test Brute', { name: 'Test Bear', counters: { '+1/+1': 1 } }] } });
    const brute = find(s, 'Test Brute', 'battlefield', 'p1');
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Slay', 'hand', 'p1') });
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: bear }] }); // Slay's target
    s = pass(s);
    s = pass(s); // both players pass: Slay resolves, the Bear dies, Presence triggers
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: brute }] }); // the trigger's target
    s = resolveAll(s);
    expect(findAll(s, 'Test Bear', 'graveyard', 'p1').length).toBe(1);
    expect(counters(s, brute)['+1/+1']).toBe(3); // the Bear was 3/3 with its counter
  });
  it('a creature an opponent controls dying gives nothing ("a creature you control")', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Slay'], battlefield: ['Test Presence', 'Test Brute'] }, p2: { battlefield: ['Test Bear'] } });
    const theirs = find(s, 'Test Bear', 'battlefield', 'p2');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Slay', 'hand', 'p1') });
    s = resolveAll(s, { targets: [[theirs]] });
    expect(counters(s, find(s, 'Test Brute', 'battlefield', 'p1'))['+1/+1'] ?? 0).toBe(0);
  });
});

describe('CR 122.1: "the number of counters among creatures you control"', () => {
  const SIPHON = card('Test Siphon', 'Sorcery', 'You gain life equal to the number of counters among creatures you control.');
  const RELIC = card('Test Relic', 'Artifact', '');
  const defs = [SIPHON, BEAR, RELIC];
  it('is fully automated', () => expect(full(SIPHON)).toBe(true));
  it('counters of every kind on your creatures are added up (not the opponent\'s; the noncreature Relic\'s 3 charge counters are not counted)', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Siphon'], battlefield: [{ name: 'Test Bear', counters: { '+1/+1': 2, flying: 1 } }, { name: 'Test Bear', counters: { shield: 1 } }, { name: 'Test Relic', counters: { charge: 3 } }] }, p2: { battlefield: [{ name: 'Test Bear', counters: { '+1/+1': 4 } }] } });
    const before = s.players.find((x) => x.id === 'p1')!.life;
    s = cast(s, 'Test Siphon');
    expect(s.players.find((x) => x.id === 'p1')!.life - before).toBe(4);
  });
});

describe('CR 506.3, 508.1b: "This spell costs {1} less to cast for each creature attacking you." (Sentry Bot): attacking you, the player', () => {
  const BOT = card('Test Bot', 'Artifact Creature — Robot', 'Flash\nThis spell costs {1} less to cast for each creature attacking you.\nWhen this creature enters, you get {E} for each creature attacking you.', { pt: ['3', '3'], cost: '{2}' });
  const WALKER = compileCard({ name: 'Test Walker', layout: 'normal', mana_cost: '{0}', type_line: 'Legendary Planeswalker — Testa', oracle_text: '+1: You gain 1 life.', loyalty: '3', colors: [] } as OracleCard);
  const defs = [BOT, BEAR, WALKER];
  const run = (mode: 'player' | 'walker' | 'none'): { cast: boolean; energy: number } => {
    let s = scenario([], { defs, p1: { hand: ['Test Bot'], battlefield: ['Plains', { name: 'Test Walker', counters: { loyalty: 3 } }] }, p2: { battlefield: ['Test Bear'] } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    const walker = find(s, 'Test Walker', 'battlefield', 'p1');
    for (let g = 0; g < 300; g++) {
      const d = s.pending;
      if (d?.kind === 'declareAttackers') {
        if (d.player === 'p2') { s = answer(s, { kind: 'declareAttackers', attacks: mode === 'none' ? [] : [{ attacker: bear, defender: mode === 'player' ? 'p1' : walker }] } as never); break; }
        s = answer(s, { kind: 'declareAttackers', attacks: [] });
      } else s = pass(s);
    }
    for (let g = 0; g < 10 && !(s.pending?.kind === 'priority' && s.pending.player === 'p1'); g++) s = pass(s);
    try {
      s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Bot', 'hand', 'p1') });
    } catch { return { cast: false, energy: 0 }; }
    s = resolveAll(s);
    return { cast: findAll(s, 'Test Bot', 'battlefield', 'p1').length === 1, energy: energy(s, 'p1') };
  };
  it('is fully automated', () => expect(full(BOT)).toBe(true));
  it('a creature attacking you: the spell costs {1} less (castable with one land) and you get 1 energy', () => expect(run('player')).toEqual({ cast: true, energy: 1 }));
  it('a creature attacking your planeswalker is not attacking you: no reduction (not castable with one land), nothing', () => expect(run('walker').cast).toBe(false));
  it('no attacker: no reduction', () => expect(run('none').cast).toBe(false));
});
