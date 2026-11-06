/**
 * edh-next-100 (concept round emblem-cleave): played through applyAction with synthetic cards compiled by the default compiler (invented names, design 6.10).
 *
 *   CR 114.4, 113.6, 602.2     an activated ability of an emblem functions in the command zone and its controller can activate it
 *   CR 601.3, 105.2            "You may cast red spells from among them this turn": only the cards of that color among the exiled ones
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, answer, castAuto, find, legal, passBoth, scenario } from '../../m3/scenario';
import { lifeOf } from '../../m4/helpers';

function card(name: string, type: string, text: string, cost = '{0}', pt?: [string, string], loyalty?: string, colors: string[] = []): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}), ...(loyalty ? { loyalty } : {}) } as OracleCard);
}
const manual = (d: CardDef): boolean => JSON.stringify(d.faces.map((f) => f.abilities)).includes('"kind":"manual"') || JSON.stringify(d.faces.map((f) => f.abilities)).includes('"op":"manual"');

const SWAMP = card('Swamp', 'Basic Land — Swamp', '{T}: Add {B}.');
const OGRE = card('Test Ogre', 'Creature — Ogre', '', '{1}', ['4', '4']);
const FILLER = card('Test Filler', 'Sorcery', 'You gain 1 life.', '{0}');
const LICH = card('Test Lich Walker', 'Legendary Planeswalker — Testa', '-2: You get an emblem with "{1}{B}, Sacrifice a creature: You gain X life and draw X cards, where X is the sacrificed creature\'s power."', '{3}', undefined, '5');
const SEER = card('Test Seer Walker', 'Legendary Planeswalker — Testa', '-1: Exile the top two cards of your library. You may cast red spells from among them this turn.', '{3}', undefined, '5');
const RED = card('Test Red Bolt', 'Sorcery', 'You gain 2 life.', '{0}', undefined, undefined, ['R']);
const BLUE = card('Test Blue Mist', 'Sorcery', 'You gain 3 life.', '{0}', undefined, undefined, ['U']);

const activatePw = (s: GameState, source: ObjectId): GameState => act(s, legal(s, 'p1', 'activate').find((x) => x.object === source)!.action);
const emblemsOf = (s: GameState): ObjectId[] => s.zones.command.filter((id) => s.objects[id]!.kind === 'emblem');
const settle = (s: GameState): GameState => {
  let x = s;
  for (let i = 0; i < 12 && x.pending && x.pending.kind !== 'priority'; i++) {
    if (x.pending.kind === 'payCost') x = answer(x, { kind: 'payCost', auto: true });
    else break;
  }
  return x;
};

describe('edh-next-100: an emblem\'s activated ability (CR 114.4)', () => {
  it('the cards are understood', () => {
    expect(manual(LICH)).toBe(false);
    expect(manual(SEER)).toBe(false);
  });

  it('CR 114.4, 602.2: its controller can activate the ability of the emblem, paying its cost (a sacrifice), and it resolves with X from the sacrificed creature', () => {
    let s = scenario([], { defs: [LICH, OGRE, SWAMP, FILLER], p1: { battlefield: [{ name: 'Test Lich Walker', counters: { loyalty: 5 } }, 'Test Ogre', 'Swamp', 'Swamp'], library: ['Test Filler', 'Test Filler', 'Test Filler', 'Test Filler', 'Test Filler', 'Test Filler'] } });
    s = passBoth(activatePw(s, find(s, 'Test Lich Walker', 'battlefield', 'p1')));
    const [em] = emblemsOf(s);
    expect(em).toBeDefined();
    const acts = legal(s, 'p1', 'activate').filter((x) => x.object === em);
    expect(acts).toHaveLength(1);
    const handBefore = s.zones.hand['p1']!.length;
    const life = lifeOf(s, 'p1');
    s = settle(act(s, acts[0]!.action));
    for (let i = 0; i < 6 && s.pending && s.pending.kind !== 'priority'; i++) {
      if (s.pending.kind === 'chooseObjects' || (s.pending.kind as string) === 'choose') break;
      s = settle(s);
    }
    s = passBoth(s);
    expect(s.zones.graveyard['p1']!.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Ogre')).toBe(true); // the Ogre was sacrificed (the only creature)
    expect(lifeOf(s, 'p1')).toBe(life + 4); // X = the sacrificed creature's power, last known information (CR 608.2h)
    expect(s.zones.hand['p1']!.length).toBe(handBefore + 4);
    expect(emblemsOf(s)).toHaveLength(1); // the emblem stays (CR 114.4)
  });

  it('negative: the opponent cannot activate it, and without a creature to sacrifice nobody can', () => {
    let s = scenario([], { defs: [LICH, OGRE, SWAMP], p1: { battlefield: [{ name: 'Test Lich Walker', counters: { loyalty: 5 } }, 'Swamp', 'Swamp'] }, p2: { battlefield: ['Test Ogre', 'Swamp', 'Swamp'] } });
    s = passBoth(activatePw(s, find(s, 'Test Lich Walker', 'battlefield', 'p1')));
    const [em] = emblemsOf(s);
    expect(legal(s, 'p1', 'activate').filter((x) => x.object === em)).toHaveLength(0); // p1 controls no creature
    expect(legal(s, 'p2', 'activate').filter((x) => x.object === em)).toHaveLength(0); // the emblem is p1's
  });
});

describe('edh-next-100: "you may cast red spells from among them this turn" (CR 601.3, 105.2)', () => {
  it('only the red card among the exiled ones can be cast', () => {
    let s = scenario([], { defs: [SEER, RED, BLUE], p1: { battlefield: [{ name: 'Test Seer Walker', counters: { loyalty: 5 } }], library: ['Test Red Bolt', 'Test Blue Mist', 'Test Red Bolt'] } });
    s = passBoth(activatePw(s, find(s, 'Test Seer Walker', 'battlefield', 'p1')));
    const castable = legal(s, 'p1', 'cast').map((x) => x.label);
    expect(castable.some((l) => /Test Red Bolt/.test(l))).toBe(true);
    expect(castable.some((l) => /Test Blue Mist/.test(l))).toBe(false);
  });
});

// ---- cleave (CR 702.148) ---------------------------------------------------------------------------------------------------------------------------------

const DOOM = card('Test Cleave Doom', 'Instant', `Cleave {0}\nDestroy target [attacking] creature.`, '{0}');
const SWEEP = card('Test Cleave Sweep', 'Sorcery', `Cleave {0}\nDestroy all creatures [with mana value 2 or less].`, '{0}');
const SMALL = card('Test Small Imp', 'Creature — Imp', '', '{1}', ['1', '1']);
const BIG = card('Test Big Ogre', 'Creature — Ogre', '', '{4}', ['4', '4']);

describe('edh-next-100: cleave (CR 702.148)', () => {
  it('the cards are understood: one spell ability with a cleaved effect, the printed text keeps its brackets', () => {
    expect(manual(DOOM)).toBe(false);
    const spell = DOOM.faces[0]!.abilities.find((a) => a.kind === 'spell')! as { text: string; cleave?: unknown };
    expect(spell.text).toBe('Destroy target [attacking] creature.');
    expect(spell.cleave).toBeDefined();
  });

  it('cast for its mana cost the bracketed words count: "target attacking creature" has no target when nothing attacks; cast for its cleave cost any creature is a target', () => {
    const s0 = scenario([], { defs: [DOOM, BIG], p1: { hand: ['Test Cleave Doom'] }, p2: { battlefield: ['Test Big Ogre'] } });
    expect(legal(s0, 'p1', 'cast').some((x) => /Test Cleave Doom/.test(x.label) && !/cleave/i.test(x.label))).toBe(false);
    let s = castAuto(s0, 'Test Cleave Doom', { method: 'cleave', answers: [] });
    for (let i = 0; i < 4 && s.pending?.kind === 'chooseTargets'; i++) s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s, 'Test Big Ogre', 'battlefield', 'p2') }] });
    s = passBoth(s);
    expect(s.zones.graveyard['p2']!.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Big Ogre')).toBe(true);
  });

  it('cast for its mana cost "all creatures with mana value 2 or less" leaves the big one; cast for its cleave cost every creature dies', () => {
    const base = (): GameState => scenario([], { defs: [SWEEP, SMALL, BIG], p1: { hand: ['Test Cleave Sweep'] }, p2: { battlefield: ['Test Small Imp', 'Test Big Ogre'] } });
    let s = passBoth(castAuto(base(), 'Test Cleave Sweep'));
    const dead = (x: GameState, n: string): boolean => x.zones.graveyard['p2']!.some((id) => x.defs[x.objects[id]!.defId]!.name === n);
    expect(dead(s, 'Test Small Imp')).toBe(true);
    expect(dead(s, 'Test Big Ogre')).toBe(false);
    s = passBoth(castAuto(base(), 'Test Cleave Sweep', { method: 'cleave' }));
    expect(dead(s, 'Test Small Imp')).toBe(true);
    expect(dead(s, 'Test Big Ogre')).toBe(true);
  });
});

describe('edh-next-100: "Counter target spell [that wasn\'t cast from its owner\'s hand]" (CR 601.2a, 702.148)', () => {
  const WASH = card('Test Wash Aside', 'Instant', 'Cleave {0}\nCounter target spell [that wasn\'t cast from its owner\'s hand].', '{0}');
  const ECHO = card('Test Echo Gain', 'Instant', 'Flashback {0}\nYou gain 2 life.', '{0}');
  const targetSpell = (s: GameState, n: string): ObjectId => s.zones.stack.find((id) => s.defs[s.objects[id]!.defId]!.name === n)!;

  it('a spell cast from the hand is no target for the printed reading; cast for its cleave cost the spell counters it', () => {
    // the opponent casts Echo from the hand: not a legal target for the plain reading
    let s = scenario([], { defs: [WASH, ECHO], p1: { hand: ['Test Wash Aside', 'Test Echo Gain'] } });
    s = castAuto(s, 'Test Echo Gain');
    expect(legal(s, 'p1', 'cast').some((x) => /Test Wash Aside/.test(x.label) && !/cleave/i.test(x.label))).toBe(false);
    expect(legal(s, 'p1', 'cast').some((x) => /Test Wash Aside/.test(x.label) && /cleave/i.test(x.label))).toBe(true);
    // cast for its cleave cost it counters the spell cast from the hand
    s = castAuto(s, 'Test Wash Aside', { method: 'cleave' });
    for (let i = 0; i < 4 && s.pending?.kind === 'chooseTargets'; i++) s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: targetSpell(s, 'Test Echo Gain') }] });
    s = passBoth(s);
    expect(s.zones.graveyard['p1']!.filter((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Echo Gain')).toHaveLength(1); // countered, not resolved: no life gained
    expect(lifeOf(s, 'p1')).toBe(20);
    expect(s.zones.stack.length).toBe(0);
  });
});

describe('edh-next-100: review fixes', () => {
  it('CR 114.4, 601.2f (Saheeli\'s emblem): "Artifact spells you cast cost {1} less to cast." works from the command zone', () => {
    const PW = card('Test Rock Walker', 'Legendary Planeswalker — Testa', '-2: You get an emblem with "Artifact spells you cast cost {1} less to cast."', '{3}', undefined, '5');
    const ROCK = card('Test Rock', 'Artifact', '', '{2}');
    let s = scenario([], { defs: [PW, ROCK, SWAMP], p1: { battlefield: [{ name: 'Test Rock Walker', counters: { loyalty: 5 } }, 'Swamp'], hand: ['Test Rock'] } });
    expect(legal(s, 'p1', 'cast').some((x) => /Test Rock/.test(x.label))).toBe(false); // one land: {2} is too much
    s = passBoth(activatePw(s, find(s, 'Test Rock Walker', 'battlefield', 'p1')));
    expect(legal(s, 'p1', 'cast').some((x) => /Test Rock/.test(x.label))).toBe(true); // {1} less
  });

  it('CR 702.148a, 707.10c: a copy of a spell cast for its cleave cost may choose any creature as its target (the bracketed word "attacking" is gone)', () => {
    const COPY = card('Test Mirror Spell', 'Instant', 'Copy target instant or sorcery spell. You may choose new targets for the copy.', '{0}');
    const s0 = scenario([], { defs: [DOOM, COPY, BIG, SMALL], p1: { hand: ['Test Cleave Doom', 'Test Mirror Spell'] }, p2: { battlefield: ['Test Big Ogre', 'Test Small Imp'] } });
    let s = castAuto(s0, 'Test Cleave Doom', { method: 'cleave' });
    for (let i = 0; i < 4 && s.pending?.kind === 'chooseTargets'; i++) s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s, 'Test Big Ogre', 'battlefield', 'p2') }] });
    s = castAuto(s, 'Test Mirror Spell');
    for (let i = 0; i < 4 && s.pending?.kind === 'chooseTargets'; i++) s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: s.zones.stack[0]! }] });
    s = passBoth(s); // the Mirror resolves: the copy's targets may change
    if (s.pending?.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true } as never);
    const p = s.pending as { kind: string; options?: unknown; legal?: unknown } | null | undefined;
    expect(p?.kind).toBe('chooseTargets');
    expect(JSON.stringify(p)).toContain(find(s, 'Test Small Imp', 'battlefield', 'p2')); // the non-attacking Imp is offered
  });
});
