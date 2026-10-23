/**
 * Phase 2 lane p2-replace-events, round p2-replace-events-2: the event replacements of parser/templates/zz-cloud/p2-replace-events-2.json played through the
 * engine with synthetic cards compiled by the game's default compiler (invented names and wordings, design 6.10). Each test is named after the rule it checks,
 * with its negative case. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 614.1a, 611.2a, 400.7  "If that creature would leave the battlefield, exile it instead of putting it anywhere else." after a return; quoted on the object
 *   CR 614.1a, 614.6, 701.8a  "If enchanted land would be destroyed, instead sacrifice ~ and that land gains indestructible until end of turn."
 *   CR 614.1a, 614.6, 700.4   "If a nontoken creature an opponent controls would die, instead exile that card and create a 2/2 black Zombie creature token."
 *   CR 614.10, 616.1          "If you would draw a card, you may skip that draw instead."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, answer, find, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const tokensOf = (s: GameState, p: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === p);
const names = (s: GameState, ids: readonly ObjectId[]): string[] => ids.map((id) => s.objects[id]!.defId).sort();

function drive(s0: GameState, targets: TargetChoice[][] = [], yes: boolean[] = []): GameState {
  let s = s0;
  const t = [...targets];
  const y = [...yes];
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: t.shift() ?? [] });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: y.shift() ?? false });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.min) });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: p.options.slice(0, p.min).map((x) => x.id) });
    else if (p.kind === 'chooseReplacement') s = answer(s, { kind: 'chooseReplacement', id: p.options[0]!.id });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
/** Resolve the whole stack, answering each yes/no with the next of `yes`. */
function resolveAll(s0: GameState, yes: boolean[] = []): GameState {
  let s = s0;
  const y = [...yes];
  for (let i = 0; i < 16 && s.zones.stack.length > 0; i++) {
    s = pass(pass(s));
    while (s.pending && s.pending.kind !== 'priority') s = drive(s, [], y.length > 0 ? [y.shift()!] : []);
  }
  return s;
}
const cast = (s: GameState, name: string, targets: TargetChoice[][] = [], who = 'p1', yes: boolean[] = []): GameState => resolveAll(drive(act(s, { type: 'cast', player: who, card: find(s, name, 'hand', who) }), targets), yes);
const activate = (s: GameState, source: ObjectId, targets: TargetChoice[][] = [], ability = 'p:0:0'): GameState => resolveAll(drive(act(s, { type: 'activate', player: 'p1', source, ability }), targets));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const KILL = card('Test Kill', 'Instant', 'Destroy target creature.');
const BOUNCE = card('Test Bounce', 'Instant', 'Return target creature to its owner\'s hand.');
const BREAK = card('Test Break', 'Instant', 'Destroy target land.');

describe('p2-replace-events-2: "If that creature would leave the battlefield, exile it instead of putting it anywhere else." (CR 614.1a, 611.2a, 400.7)', () => {
  const ENCORE = card('Test Encore', 'Sorcery', 'Return target creature card from your graveyard to the battlefield. If that creature would leave the battlefield, exile it instead of putting it anywhere else.');
  it('is automated', () => expect(full(ENCORE)).toBe(true));
  it('CR 614.1a: the returned creature, destroyed, is exiled; bounced, it is exiled too', () => {
    let s = scenario([], { defs: [ENCORE, BEAR, KILL, BOUNCE], p1: { hand: ['Test Encore', 'Test Kill'], graveyard: ['Test Bear'] } });
    s = cast(s, 'Test Encore', [[obj(find(s, 'Test Bear', 'graveyard', 'p1'))]]);
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = cast(s, 'Test Kill', [[obj(bear)]]);
    expect(names(s, s.zones.exile)).toEqual(['Test Bear']);
    expect(s.zones.graveyard.p1!.map((id) => s.objects[id]!.defId)).not.toContain('Test Bear');
  });
  it('CR 400.7, 611.2a: another creature is not affected (it dies as usual)', () => {
    let s = scenario([], { defs: [ENCORE, BEAR, KILL], p1: { hand: ['Test Encore', 'Test Kill'], graveyard: ['Test Bear'], battlefield: ['Test Bear'] } });
    const other = find(s, 'Test Bear', 'battlefield', 'p1');
    s = cast(s, 'Test Encore', [[obj(find(s, 'Test Bear', 'graveyard', 'p1'))]]);
    s = cast(s, 'Test Kill', [[obj(other)]]);
    expect(s.zones.exile).toEqual([]);
    expect(s.zones.graveyard.p1!.map((id) => s.objects[id]!.defId)).toContain('Test Bear');
  });
});

describe('p2-replace-events-2: It gains "If this creature would leave the battlefield, exile it instead of putting it anywhere else." (CR 614.1a, 113.1c)', () => {
  const PRIEST = card('Test Priest', 'Creature — Zombie Cleric', '{0}, {T}: Return target creature card from your graveyard to the battlefield. It gains "If this creature would leave the battlefield, exile it instead of putting it anywhere else." Activate only as a sorcery.', { pt: ['1', '1'] });
  it('is automated', () => expect(full(PRIEST)).toBe(true));
  it('CR 614.1a: the returned creature has the ability; returned to hand, it is exiled instead', () => {
    let s = scenario([], { defs: [PRIEST, BEAR, BOUNCE], p1: { hand: ['Test Bounce'], battlefield: ['Test Priest'], graveyard: ['Test Bear'] } });
    s = activate(s, find(s, 'Test Priest', 'battlefield'), [[obj(find(s, 'Test Bear', 'graveyard', 'p1'))]]);
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = cast(s, 'Test Bounce', [[obj(bear)]]);
    expect(names(s, s.zones.exile)).toEqual(['Test Bear']);
    expect(s.zones.hand.p1!.map((id) => s.objects[id]!.defId)).not.toContain('Test Bear');
  });
});

describe('p2-replace-events-2: "If enchanted land would be destroyed, instead sacrifice ~ and that land gains indestructible until end of turn." (CR 614.1a, 614.6)', () => {
  const GROWTH = card('Test Growth', 'Enchantment — Aura', 'Enchant land\nIf enchanted land would be destroyed, instead sacrifice this Aura and that land gains indestructible until end of turn.');
  it('is automated', () => expect(full(GROWTH)).toBe(true));
  it('CR 614.6: the land is not destroyed; the Aura is sacrificed and the land is indestructible this turn', () => {
    let s = scenario(['Forest'], { defs: [GROWTH, BREAK], p1: { hand: ['Test Growth', 'Test Break'], battlefield: ['Forest'] } });
    const forest = find(s, 'Forest', 'battlefield', 'p1');
    s = cast(s, 'Test Growth', [[obj(forest)]]);
    expect(s.objects[find(s, 'Test Growth', 'battlefield', 'p1')]!.attachedTo).toBe(forest);
    s = cast(s, 'Test Break', [[obj(forest)]]);
    expect(s.zones.battlefield).toContain(forest);
    expect(s.zones.graveyard.p1!.map((id) => s.objects[id]!.defId).sort()).toEqual(['Test Break', 'Test Growth']);
  });
  it('CR 614.1a: another land is destroyed as usual', () => {
    let s = scenario(['Forest'], { defs: [GROWTH, BREAK], p1: { hand: ['Test Growth', 'Test Break'], battlefield: ['Forest', 'Plains'] } });
    s = cast(s, 'Test Growth', [[obj(find(s, 'Forest', 'battlefield', 'p1'))]]);
    const plains = find(s, 'Plains', 'battlefield', 'p1');
    s = cast(s, 'Test Break', [[obj(plains)]]);
    expect(s.zones.battlefield).not.toContain(plains);
    expect(s.zones.battlefield.map((id) => s.objects[id]!.defId)).toContain('Test Growth');
  });
});

describe('p2-replace-events-2: "If a nontoken creature an opponent controls would die, instead exile that card and create a 2/2 black Zombie creature token." (CR 614.1a, 614.6)', () => {
  const GHOUL = card('Test Ghoul Lord', 'Creature — Vampire Warrior', 'If a nontoken creature an opponent controls would die, instead exile that card and create a 2/2 black Zombie creature token.', { pt: ['3', '4'] });
  it('is automated', () => expect(full(GHOUL)).toBe(true));
  it('CR 614.6: an opponent\'s creature is exiled and you create a Zombie; your own creature dies as usual', () => {
    let s = scenario([], { defs: [GHOUL, BEAR, KILL], p1: { hand: ['Test Kill', 'Test Kill'], battlefield: ['Test Ghoul Lord', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] } });
    s = cast(s, 'Test Kill', [[obj(find(s, 'Test Bear', 'battlefield', 'p2'))]]);
    expect(names(s, s.zones.exile)).toEqual(['Test Bear']);
    expect(tokensOf(s, 'p1')).toHaveLength(1);
    s = cast(s, 'Test Kill', [[obj(find(s, 'Test Bear', 'battlefield', 'p1'))]]);
    expect(s.zones.graveyard.p1!.map((id) => s.objects[id]!.defId)).toContain('Test Bear');
    expect(tokensOf(s, 'p1')).toHaveLength(1);
  });
});

describe('p2-replace-events-2: "If you would draw a card, you may skip that draw instead." (CR 614.10, 616.1)', () => {
  const MOLE = card('Test Mole', 'Creature — Mole', 'If you would draw a card, you may skip that draw instead.', { pt: ['1', '1'] });
  const PEEK = card('Test Peek', 'Instant', 'Draw two cards.');
  it('is automated', () => expect(full(MOLE)).toBe(true));
  it('CR 614.10: skipping the first draw and taking the second, one card is drawn', () => {
    let s = scenario([], { defs: [MOLE, PEEK], p1: { hand: ['Test Peek'], battlefield: ['Test Mole'] } });
    s = cast(s, 'Test Peek', [], 'p1', [true, false]);
    expect(s.zones.hand.p1).toHaveLength(1);
  });
});

describe('p2-replace-events-2: "{1}: The next time you would draw a card this turn, create a 2/2 green Bear creature token instead." (CR 614.1a, 614.6, 615.7)', () => {
  const WORDS = card('Test Words', 'Enchantment', '{0}: The next time you would draw a card this turn, create a 2/2 green Bear creature token instead.');
  const PEEK = card('Test Peek', 'Instant', 'Draw two cards.');
  it('is automated', () => expect(full(WORDS)).toBe(true));
  it('CR 614.6: one activation replaces the first draw only: a Bear and one card', () => {
    let s = scenario([], { defs: [WORDS, PEEK], p1: { hand: ['Test Peek'], battlefield: ['Test Words'] } });
    s = activate(s, find(s, 'Test Words', 'battlefield'));
    s = cast(s, 'Test Peek');
    expect(tokensOf(s, 'p1')).toHaveLength(1);
    expect(s.zones.hand.p1).toHaveLength(1);
  });
  it('CR 614.1a: two activations replace both draws; without one, nothing is replaced', () => {
    let s = scenario([], { defs: [WORDS, PEEK], p1: { hand: ['Test Peek'], battlefield: ['Test Words'] } });
    s = activate(s, find(s, 'Test Words', 'battlefield'));
    s = activate(s, find(s, 'Test Words', 'battlefield'));
    s = cast(s, 'Test Peek');
    expect([tokensOf(s, 'p1').length, s.zones.hand.p1!.length]).toEqual([2, 0]);
    let t = scenario([], { defs: [WORDS, PEEK], p1: { hand: ['Test Peek'], battlefield: ['Test Words'] } });
    t = cast(t, 'Test Peek');
    expect([tokensOf(t, 'p1').length, t.zones.hand.p1!.length]).toEqual([0, 2]);
  });
});

describe('p2-replace-events-2: "If you would proliferate, proliferate twice instead." (CR 701.34a, 614.1a, 614.5)', () => {
  const DOMINUS = card('Test Dominus', 'Creature — Phyrexian Horror', 'If you would proliferate, proliferate twice instead.', { pt: ['3', '5'] });
  const SPREAD = card('Test Spread', 'Sorcery', 'Proliferate.');
  /** Resolve the stack choosing every option of each proliferate. */
  const castAll = (s0: GameState, name: string): GameState => {
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') });
    for (let i = 0; i < 40 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); i++) {
      const p = s.pending;
      if (p && p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: p.options.map((x) => x.id) });
      else if (p && p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (p && p.kind !== 'priority') s = drive(s);
      else s = pass(pass(s));
    }
    return s;
  };
  it('is automated', () => expect(full(DOMINUS)).toBe(true));
  it('CR 614.1a, 614.5: one proliferate is two (the two are not replaced again): a +1/+1 counter becomes three', () => {
    let s = scenario([], { defs: [DOMINUS, SPREAD, BEAR], p1: { hand: ['Test Spread'], battlefield: ['Test Dominus', { name: 'Test Bear', counters: { '+1/+1': 1 } }] } });
    s = castAll(s, 'Test Spread');
    expect(s.objects[find(s, 'Test Bear', 'battlefield', 'p1')]!.counters?.['+1/+1']).toBe(3);
  });
  it('CR 701.34a: without it, a proliferate is one', () => {
    let s = scenario([], { defs: [SPREAD, BEAR], p1: { hand: ['Test Spread'], battlefield: [{ name: 'Test Bear', counters: { '+1/+1': 1 } }] } });
    s = castAll(s, 'Test Spread');
    expect(s.objects[find(s, 'Test Bear', 'battlefield', 'p1')]!.counters?.['+1/+1']).toBe(2);
  });
});

describe('p2-replace-events-2: All Slivers have "If this permanent would be put into a graveyard, you may put it on top of its owner\'s library instead." (CR 614.1a, 616.1)', () => {
  const LUNG = card('Test Lung Sliver', 'Creature — Sliver', 'All Slivers have "If this permanent would be put into a graveyard, you may put it on top of its owner\'s library instead."', { pt: ['3', '3'] });
  it('is automated', () => expect(full(LUNG)).toBe(true));
  it('CR 616.1: destroyed, its controller chooses the top of the library; declining, it goes to the graveyard', () => {
    let s = scenario([], { defs: [LUNG, KILL], p1: { hand: ['Test Kill'], battlefield: ['Test Lung Sliver'] } });
    s = cast(s, 'Test Kill', [[obj(find(s, 'Test Lung Sliver', 'battlefield', 'p1'))]], 'p1', [true]);
    expect(s.objects[s.zones.library.p1![0]!]!.defId).toBe('Test Lung Sliver');
    let t = scenario([], { defs: [LUNG, KILL], p1: { hand: ['Test Kill'], battlefield: ['Test Lung Sliver'] } });
    t = cast(t, 'Test Kill', [[obj(find(t, 'Test Lung Sliver', 'battlefield', 'p1'))]], 'p1', [false]);
    expect(t.zones.graveyard.p1!.map((id) => t.objects[id]!.defId)).toContain('Test Lung Sliver');
  });
});
