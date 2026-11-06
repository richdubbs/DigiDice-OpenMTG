/**
 * Commander lane `rest`, second round edh-next-79 (code edhn79): played scenarios with synthetic cards (design 6.10). CR cites from memory (unverified).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, hasKeyword, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { act, advanceTo, answer, find, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, cost = '{0}', extra: Partial<OracleCard> = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...extra } as OracleCard);
}
const PT = { power: '2', toughness: '2' };
const life = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const nm = (s: GameState, id: string): string => s.defs[s.objects[id]!.defId]?.name ?? '?';
const where = (s: GameState, name: string): string[] => {
  const out: string[] = [];
  for (const id of s.zones.battlefield) if (nm(s, id) === name) out.push('battlefield');
  for (const id of s.zones.exile) if (nm(s, id) === name) out.push('exile');
  for (const p of ['p1', 'p2']) for (const z of ['hand', 'graveyard', 'library'] as const) for (const id of s.zones[z][p] ?? []) if (nm(s, id) === name) out.push(`${z}:${p}`);
  return out;
};
const hasty = (s: GameState, name: string): boolean => hasKeyword(getChars(s, idOnBf(s, name)), 'haste');
const idOnBf = (s: GameState, name: string): string => s.zones.battlefield.find((id) => nm(s, id) === name)!;
/** Answer decisions until the stack is empty and only priority is pending (yes to every may; first option of a choice; the opponent as target when asked). */
function settle(s0: GameState, yes = true, stopAt?: () => boolean): GameState {
  let s = s0;
  for (let guard = 0; guard < 120 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) {
    if (stopAt?.()) break;
    const d = s.pending!;
    if (d.kind === 'priority') s = pass(s);
    else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes });
    else if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: (d as unknown as { options: string[] }).options.slice(0, 1) });
    else if (d.kind === 'chooseTargets') { const t = d as unknown as { objects: string[]; players: string[] }; s = answer(s, { kind: 'chooseTargets', targets: [t.objects.length > 0 ? { kind: 'object', id: t.objects[0]! } : { kind: 'player', id: t.players[0]! }] as never }); }
    else throw new Error(`unexpected decision ${d.kind}`);
  }
  return s;
}
const cast = (s0: GameState, name: string): GameState => settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }));

const TITAN = card('Test Titan', 'Creature — Plant', "When this creature dies, return it to the battlefield tapped under its owner's control at the beginning of their next upkeep.", '{0}', { power: '3', toughness: '3' });
const GHOST = card('Test Ghost', 'Creature — Spirit', "At the beginning of your end step, you may exile ~. If you do, return it to the battlefield under its owner's control at the beginning of your next upkeep. It gains haste.", '{0}', { power: '4', toughness: '4' });
const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', PT);
const SMITE = card('Test Smite', 'Instant', 'Destroy target creature.', '{0}');
const NAHIRI = card('Test Resolve', 'Enchantment', "At the beginning of your end step, exile any number of nontoken artifacts and/or creatures you control. Return those cards to the battlefield under their owner's control at the beginning of your next upkeep.", '{0}');
const LEGION = card('Test Initiative', 'Enchantment', "{0}, Exile this enchantment: Exile all creatures you control. At the beginning of the next combat, return those cards to the battlefield under their owner's control and those creatures gain haste until end of turn.", '{0}');
const PRELATE = card('Test Prelate', 'Creature — Angel', 'As this creature enters, choose a number.\nNoncreature spells with mana value equal to the chosen number can\'t be cast.', '{0}', PT);
const ONE = card('Test One', 'Sorcery', 'You gain 1 life.', '{1}');
const TWO = card('Test Two', 'Sorcery', 'You gain 2 life.', '{2}');
const SHANNA = card('Test Shanna', 'Creature — Human', "~ can't be the target of abilities your opponents control.", '{0}', PT);
const PINGER = card('Test Pinger', 'Creature — Wizard', '{T}: Test Pinger deals 1 damage to target creature.', '{0}', { power: '1', toughness: '1' });
const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 1 damage to target creature.', '{0}');
const DEFS = [TITAN, GHOST, BEAR, SMITE, NAHIRI, LEGION, PRELATE, ONE, TWO, SHANNA, PINGER, BOLT];

describe('edh-next-79: the readings are automated', () => {
  it('every synthetic card compiles without a manual ability', () => {
    for (const d of DEFS) expect(d.faces[0]!.abilities.filter((a) => a.kind === 'manual'), d.name).toEqual([]);
  });
});

describe('CR 603.7, 503.1: "... at the beginning of their next upkeep" (its owner\'s)', () => {
  it('returns tapped at its owner\'s next upkeep, not at the opponent\'s upkeep in between', () => {
    let s = scenario([], { p1: { battlefield: ['Test Titan'], hand: ['Test Smite'] }, defs: DEFS });
    s = cast(s, 'Test Smite');
    expect(where(s, 'Test Titan')).toEqual(['graveyard:p1']);
    s = settle(advanceTo(s, 2, 'upkeep'));
    expect(where(s, 'Test Titan')).toEqual(['graveyard:p1']); // p2's upkeep: not the owner's
    s = settle(advanceTo(s, 3, 'upkeep'));
    expect(where(s, 'Test Titan')).toEqual(['battlefield']);
    expect(s.objects[idOnBf(s, 'Test Titan')]!.tapped).toBe(true);
  });
});

describe('CR 603.7c, 400.7: "If you do, return it ... at the beginning of your next upkeep. It gains haste."', () => {
  it('the returned object has haste; declining leaves it alone', () => {
    let s = scenario([], { p1: { battlefield: ['Test Ghost'] }, defs: DEFS });
    s = settle(advanceTo(s, 1, 'end'));
    expect(where(s, 'Test Ghost')).toEqual(['exile']);
    s = settle(advanceTo(s, 3, 'upkeep'));
    expect(where(s, 'Test Ghost')).toEqual(['battlefield']);
    expect(hasty(s, 'Test Ghost')).toBe(true);
    let n = scenario([], { p1: { battlefield: ['Test Ghost'] }, defs: DEFS });
    n = settle(advanceTo(n, 1, 'end'), false);
    expect(where(n, 'Test Ghost')).toEqual(['battlefield']);
    expect(hasty(n, 'Test Ghost')).toBe(false);
  });
});

describe('CR 603.7: "exile any number of ... you control. Return those cards ... at the beginning of your next upkeep."', () => {
  it('the chosen creature leaves at your end step and is back at your next upkeep; the unchosen stays', () => {
    let s = scenario([], { p1: { battlefield: ['Test Resolve', 'Test Bear', 'Test Titan'] }, defs: DEFS });
    s = advanceTo(s, 1, 'end');
    for (let guard = 0; guard < 30 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) {
      const d = s.pending!;
      if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: [s.zones.battlefield.find((id) => nm(s, id) === 'Test Bear')!] });
      else s = d.kind === 'priority' ? pass(s) : settle(s);
    }
    expect(where(s, 'Test Bear')).toEqual(['exile']);
    expect(where(s, 'Test Titan')).toEqual(['battlefield']);
    s = settle(advanceTo(s, 3, 'upkeep'));
    expect(where(s, 'Test Bear')).toEqual(['battlefield']);
  });
});

describe('CR 603.7, 506.1: "At the beginning of the next combat, return those cards ... and those creatures gain haste"', () => {
  it('exiled now, back at the beginning of combat with haste', () => {
    let s = scenario([], { p1: { battlefield: ['Test Initiative', 'Test Bear'] }, defs: DEFS });
    s = settle(act(s, { type: 'activate', player: 'p1', source: idOnBf(s, 'Test Initiative'), ability: 'p:0:0' } as never));
    expect(where(s, 'Test Bear')).toEqual(['exile']);
    s = settle(advanceTo(s, 1, 'beginCombat'));
    expect(where(s, 'Test Bear')).toEqual(['battlefield']);
    expect(hasty(s, 'Test Bear')).toBe(true);
  });
});

describe('CR 614.12a, 607.2d: "As ~ enters, choose a number." + "Noncreature spells with mana value equal to the chosen number can\'t be cast."', () => {
  const start = (n: number): GameState => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Prelate', 'Test One', 'Test Two'], battlefield: ['Plains', 'Plains'] }, defs: DEFS });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Prelate', 'hand', 'p1') });
    for (let g = 0; g < 20 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); g++) {
      const d = s.pending!;
      if (d.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n } as never);
      else s = d.kind === 'priority' ? pass(s) : settle(s);
    }
    return s;
  };
  it('mana value 1 chosen: the {1} sorcery can\'t be cast, the {2} one can', () => {
    const s = start(1);
    expect(where(s, 'Test Prelate')).toEqual(['battlefield']);
    const ok = (name: string): boolean => { try { act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }); return true; } catch { return false; } };
    expect(ok('Test One')).toBe(false);
    expect(ok('Test Two')).toBe(true);
  });
});

describe('CR 115.1, 113.7a: "~ can\'t be the target of abilities your opponents control."', () => {
  it('an opponent\'s ability can\'t target it; an opponent\'s spell can', () => {
    const s = scenario([], { p1: { battlefield: ['Test Shanna'] }, p2: { battlefield: ['Test Pinger'], hand: ['Test Bolt'] }, defs: DEFS });
    const t = advanceTo(s, 2, 'main1');
    const targetable = (a: { kind: string }): boolean => a.kind !== undefined;
    void targetable;
    const abilityTargets = (): boolean => {
      try {
        let u = act(t, { type: 'activate', player: 'p2', source: idOnBf(t, 'Test Pinger'), ability: 'p:0:0' } as never);
        while (u.pending && u.pending.kind === 'payCost') u = answer(u, { kind: 'payCost', auto: true });
        return u.pending?.kind === 'chooseTargets' && (u.pending as unknown as { objects: string[] }).objects.includes(idOnBf(t, 'Test Shanna'));
      } catch { return false; }
    };
    expect(abilityTargets()).toBe(false);
    let u = act(t, { type: 'cast', player: 'p2', card: find(t, 'Test Bolt', 'hand', 'p2') });
    expect(u.pending?.kind).toBe('chooseTargets');
    expect((u.pending as unknown as { objects: string[] }).objects).toContain(idOnBf(t, 'Test Shanna'));
    void u;
  });
});


describe('review of edh-next-79 (CR 603.7c, 400.7): a sentence after a delayed return of ~ that still acts on ~ is not automated', () => {
  it('"Exile ~. Return ~ ... at the beginning of your next upkeep. ~ gains haste." stays partial (the haste would go to the old object)', () => {
    const c = card('Test Wisp', 'Creature — Spirit', "At the beginning of your end step, exile ~. Return ~ to the battlefield under its owner's control at the beginning of your next upkeep. ~ gains haste.", '{0}', PT);
    expect(c.automation.level).toBe('partial');
  });
});
