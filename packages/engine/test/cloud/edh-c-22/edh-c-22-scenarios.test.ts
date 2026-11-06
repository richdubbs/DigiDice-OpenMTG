/**
 * Commander lane edh-c (EDHREC ranks 16,251-16,875), round edh-c-22: the round's readings played through the engine with synthetic cards (invented names), compiled by the game's
 * default compiler, in 4-player games. CR cites checked against the Comprehensive Rules of 2026-09-25 (media.wizards.com).
 *
 *   CR 701.20a, 401.4          "Reveal cards from the top of your library until you reveal a land card. Put that card onto the battlefield and the rest on the bottom of your library in any order."
 *   CR 706.2, 701.20a          "Roll a d8. Reveal cards ... until you reveal a creature card with mana value equal to the result."
 *   CR 115.1, 109.4, 701.9a    "~ deals 3 damage to target player or planeswalker. That player or that planeswalker's controller discards two cards."
 *   CR 205.3m, 613.1d, 613.4c  "Enchanted creature gets +2/+0, has menace, and is a Pirate in addition to its other creature types."
 *   CR 205.1b, 613.1d, 611.2a  "Until end of turn, ~ becomes a 5/5 Human Soldier creature with indestructible that's still a planeswalker."
 *   CR 611.2a, 613.1e, 613.4b  "~ loses defender and gains ..." / "~ becomes blue and has base power and toughness 5/4." (for good)
 *   CR 205.1b, 613.1d, 613.4b  "Nonlegendary creatures enchanted player controls have base power and toughness 3/3 and lose all creature types."
 *   CR 615.1a, 615.5, 119.3    "If noncombat damage would be dealt to you, prevent that damage. You gain life equal to the damage prevented this way."
 *   CR 615.1a, 615.7, 616.1    "If a source would deal damage to a player, you may prevent X of that damage, where X is the number of Clerics you control."
 *   CR 509.1a, 604.1           "As long as <condition>, it has reach and can block an additional two creatures each combat."
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, type CardDef, type GameState, type ObjectId, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, answer, find, findAll, legal } from '../../m3/scenario';
import { mpScenario, namesOn } from '../../m12/rules/helpers';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { maxBlocks } from '../../../src/statics/hooks';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string]; colors?: string[]; loyalty?: string } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}), ...(opts.loyalty ? { loyalty: opts.loyalty } : {}) } as never);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id }) as TargetChoice;
const pl = (id: PlayerId): TargetChoice => ({ kind: 'player', id }) as TargetChoice;
const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;

interface Script { yes?: boolean[]; targets?: TargetChoice[][]; }
/** Answer the decisions that come up until someone has priority. */
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 100 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: script.yes?.shift() ?? false });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: script.targets?.shift() ?? [] });
    else if (p.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: (p as unknown as { options: string[]; min: number }).options.slice(0, Math.max((p as unknown as { min: number }).min, 0)) } as never);
    else throw new Error(`unexpected decision ${p.kind}: ${JSON.stringify(p)}`);
  }
  return s;
}
/** Everyone passes until the stack is empty again, answering what comes up. */
function settle(s0: GameState, script: Script = {}): GameState {
  let s = drive(s0, script);
  for (let guard = 0; s.zones.stack.length > 0 && s.pending?.kind === 'priority' && guard < 60; guard++) s = drive(act(s, { type: 'pass', player: s.pending.player }), script);
  return s;
}
const cast = (s: GameState, name: string, script: Script = {}, player: PlayerId = 'p1'): GameState => settle(drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), script), script);
const activation = (s: GameState, player: PlayerId, source: ObjectId, index = 0) => legal(s, player, 'activate').filter((a) => a.action.type === 'activate' && a.action.source === source)[index]!.action;
const activate = (s: GameState, source: ObjectId, script: Script = {}, player: PlayerId = 'p1'): GameState => settle(drive(act(s, activation(s, player, source)), script), script);
const nameOfId = (s: GameState, id: string): string => s.defs[s.objects[id]!.defId]!.name;
const libNames = (s: GameState, p: PlayerId): string[] => s.zones.library[p]!.map((id) => nameOfId(s, id));
const handNames = (s: GameState, p: PlayerId): string[] => s.zones.hand[p]!.map((id) => nameOfId(s, id));
const count = (s: GameState, p: PlayerId, name: string): number => namesOn(s, p).filter((n) => n === name).length;

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const ELF = card('Test Elf', 'Creature — Elf', '', { pt: ['1', '1'] });
const FOREST = card('Test Forest', 'Basic Land — Forest', '');
const KING = card('Test Legend King', 'Legendary Creature — Human Noble', '', { pt: ['4', '4'] });

describe('CR 701.20a, 401.4: "Reveal cards from the top of your library until you reveal a land card. Put that card onto the battlefield and the rest on the bottom of your library in any order."', () => {
  const DIG = card('Test Dig Anyorder', 'Sorcery', 'Reveal cards from the top of your library until you reveal a land card. Put that card onto the battlefield and the rest on the bottom of your library in any order.');
  const start = () => mpScenario({ defs: [DIG, BEAR, ELF, FOREST], zones: { p1: { hand: ['Test Dig Anyorder'], library: ['Plains', 'Test Bear', 'Test Elf', 'Test Forest', 'Test Bear'] } } }); // (the first card is drawn for the turn)
  it('is automated, and the rest go to the bottom in an order the player chooses (order: chosen), not at random', () => {
    expect(full(DIG)).toBe(true);
    const json = JSON.stringify(DIG.faces[0]!.abilities[0]);
    expect(json).toContain('"order":"chosen"');
    expect(json).not.toContain('"order":"random"');
  });
  it('the land the reveal stopped at enters the battlefield; the cards revealed before it go to the bottom; the cards below stay', () => {
    const s0 = start();
    const before = s0.zones.library.p1!.length;
    const s = cast(s0, 'Test Dig Anyorder');
    expect(count(s, 'p1', 'Test Forest')).toBe(1);
    expect(count(s, 'p1', 'Test Bear')).toBe(0);
    expect(s.zones.library.p1!.length).toBe(before - 1);
    const lib = libNames(s, 'p1');
    expect(lib.slice(-2).sort()).toEqual(['Test Bear', 'Test Elf']);
    expect(lib[0]).toBe('Test Bear'); // the card that was below the land is now on top
    expect(lib.slice(0, -2)).not.toContain('Test Elf');
  });
  it('negative: another player\'s library is not touched', () => {
    const s0 = start();
    const s = cast(s0, 'Test Dig Anyorder');
    expect(s.zones.library.p2!.length).toBe(s0.zones.library.p2!.length);
  });
});

describe('CR 706.2, 701.20a: "Roll a d8. Reveal cards from the top of your library until you reveal a creature card with mana value equal to the result. ..."', () => {
  const BAG = card('Test Dice Bag', 'Artifact', '{0}: Roll a d8. Reveal cards from the top of your library until you reveal a creature card with mana value equal to the result. Put that card onto the battlefield and the rest on the bottom of your library in a random order.');
  const dudes = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => card(`Test Dude ${n}`, 'Creature — Dude', '', { cost: `{${n}}`, pt: ['1', '1'] }));
  const START = [8, 7, 6, 5, 4, 3, 2, 1].map((n) => `Test Dude ${n}`);
  const LIB = ['Plains', ...START]; // (the first card is drawn for the turn)
  const roll = (s: GameState): number => { const m = [...s.log].reverse().map((l) => /rolls a d8: (\d+)\./.exec(l.text)).find((x) => x !== null && x !== undefined); return Number(m![1]); };
  it('is automated: the filter reads the result of the roll (q: dieResult)', () => {
    expect(full(BAG)).toBe(true);
    expect(JSON.stringify(BAG.faces[0]!.abilities[0])).toContain('"manaValue":{"op":"==","value":{"q":"dieResult"}}');
  });
  for (const seed of ['a', 'b', 'c', 'd', 'e']) {
    it(`seed ${seed}: the creature whose mana value is the result enters, the revealed cards before it go to the bottom, the ones after it stay`, () => {
      const s0 = mpScenario({ seed, defs: [BAG, ...dudes], zones: { p1: { battlefield: ['Test Dice Bag'], library: LIB } } });
      const s = activate(s0, find(s0, 'Test Dice Bag', 'battlefield', 'p1'));
      const r = roll(s);
      expect(r).toBeGreaterThanOrEqual(1);
      expect(r).toBeLessThanOrEqual(8);
      expect(namesOn(s, 'p1').filter((n) => n.startsWith('Test Dude'))).toEqual([`Test Dude ${r}`]);
      // START lists the library from the top: 8, 7, ..., so the cards above the hit have mana values greater than r
      const above = START.filter((n) => Number(n.slice(-1)) > r);
      const lib = libNames(s, 'p1');
      if (above.length > 0) expect(lib.slice(-above.length).sort()).toEqual([...above].sort());
      expect(lib).not.toContain(`Test Dude ${r}`);
      for (const below of START.filter((n) => Number(n.slice(-1)) < r)) expect(lib).toContain(below);
    });
  }
});

describe('CR 115.1, 109.4, 701.9a: "That player or that planeswalker\'s controller discards two cards."', () => {
  const BLIGHT = card('Test Blight Bolt', 'Sorcery', "~ deals 3 damage to target player or planeswalker. That player or that planeswalker's controller discards two cards.");
  const WALKER = card('Test Walker', 'Legendary Planeswalker — Testa', '', { loyalty: '5' });
  const FILLER = card('Test Filler', 'Artifact', '');
  const start = () => mpScenario({ defs: [BLIGHT, WALKER, FILLER], zones: { p1: { hand: ['Test Blight Bolt'] }, p2: { hand: ['Test Filler', 'Test Filler', 'Test Filler'] }, p3: { hand: ['Test Filler', 'Test Filler', 'Test Filler'], battlefield: [{ name: 'Test Walker', counters: { loyalty: 5 } }] }, p4: { hand: ['Test Filler', 'Test Filler', 'Test Filler'] } } });
  it('is automated, as two discards (the target if it is a player, the controller of the target if it is a planeswalker)', () => {
    expect(full(BLIGHT)).toBe(true);
    const json = JSON.stringify(BLIGHT.faces[0]!.abilities[0]);
    expect(json).toContain('"op":"discard","who":{"ref":"target","id":"t0"},"count":2');
    expect(json).toContain('"op":"discard","who":{"ref":"controllerOf","object":{"ref":"target","id":"t0"}},"count":2');
  });
  it('a player target takes 3 damage and discards two cards; nobody else discards', () => {
    const s0 = start();
    const s = cast(s0, 'Test Blight Bolt', { targets: [[pl('p2')]] });
    expect(lifeOf(s, 'p2')).toBe(lifeOf(s0, 'p2') - 3);
    expect(handNames(s, 'p2')).toEqual(['Test Filler']);
    expect(handNames(s, 'p3')).toHaveLength(3);
    expect(handNames(s, 'p4')).toHaveLength(3);
  });
  it('a planeswalker target is dealt 3 damage and ITS CONTROLLER discards two cards (the planeswalker is not a player; the caster does not discard)', () => {
    const s0 = start();
    const walker = find(s0, 'Test Walker', 'battlefield', 'p3');
    const s = cast(s0, 'Test Blight Bolt', { targets: [[obj(walker)]] });
    expect(handNames(s, 'p3')).toEqual(['Test Filler']);
    expect(handNames(s, 'p2')).toHaveLength(3);
    expect(lifeOf(s, 'p3')).toBe(lifeOf(s0, 'p3'));
    expect(s.objects[walker]?.counters?.['loyalty'] ?? 0).toBeLessThanOrEqual(2);
  });
});

describe('CR 115.1, 109.4: Blightning-like spell aimed at the caster\'s own planeswalker', () => {
  const BLIGHT = card('Test Blight Bolt', 'Sorcery', "~ deals 3 damage to target player or planeswalker. That player or that planeswalker's controller discards two cards.");
  const WALKER = card('Test Walker', 'Legendary Planeswalker — Testa', '', { loyalty: '5' });
  const FILLER = card('Test Filler', 'Artifact', '');
  it('only the controller of the planeswalker (the caster here) discards; opponents do not', () => {
    const s0 = mpScenario({ defs: [BLIGHT, WALKER, FILLER], zones: { p1: { hand: ['Test Blight Bolt', 'Test Filler', 'Test Filler'], battlefield: [{ name: 'Test Walker', counters: { loyalty: 5 } }] }, p2: { hand: ['Test Filler', 'Test Filler'] } } });
    const s = cast(s0, 'Test Blight Bolt', { targets: [[obj(find(s0, 'Test Walker', 'battlefield', 'p1'))]] });
    expect(handNames(s, 'p1')).toEqual(['Plains']); // (the card drawn for the turn; Test Filler x2 were discarded)
    expect(handNames(s, 'p2')).toHaveLength(2);
  });
});

describe('CR 205.3m, 613.1d, 613.4c: "Enchanted creature gets +2/+0, has menace, and is a Pirate in addition to its other creature types."', () => {
  const HOOK = card('Test Hook Aura', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +2/+0, has menace, and is a Pirate in addition to its other creature types.');
  it('is automated; the enchanted creature is 4/2 with menace and keeps Bear besides Pirate; another creature is unchanged', () => {
    expect(full(HOOK)).toBe(true);
    const s = mpScenario({ defs: [HOOK, BEAR], zones: { p1: { hand: ['Test Hook Aura'], battlefield: ['Test Bear', 'Test Bear'] } } });
    const [a, b] = findAll(s, 'Test Bear', 'battlefield', 'p1');
    const t = cast(s, 'Test Hook Aura', { targets: [[obj(a!)]] });
    const c = getChars(t, a!);
    expect([Number(c.power), Number(c.toughness)]).toEqual([4, 2]);
    expect(hasKeyword(c, 'menace')).toBe(true);
    expect(c.subtypes).toEqual(expect.arrayContaining(['Bear', 'Pirate']));
    const o = getChars(t, b!);
    expect([Number(o.power), Number(o.toughness)]).toEqual([2, 2]);
    expect(hasKeyword(o, 'menace')).toBe(false);
    expect(o.subtypes).not.toContain('Pirate');
  });
});

describe('CR 205.1b, 613.1d, 611.2a: "Until end of turn, ~ becomes a 5/5 Human Soldier creature with indestructible that\'s still a planeswalker."', () => {
  const GID = card('Test Paragon', 'Legendary Planeswalker — Testb', '0: Until end of turn, ~ becomes a 5/5 Human Soldier creature with indestructible that\'s still a planeswalker.', { loyalty: '5' });
  it('is automated; it is a 5/5 indestructible creature and still a planeswalker; the effect ends with the turn', () => {
    expect(full(GID)).toBe(true);
    const s0 = mpScenario({ defs: [GID], zones: { p1: { battlefield: [{ name: 'Test Paragon', counters: { loyalty: 5 } }] } } });
    const id = find(s0, 'Test Paragon', 'battlefield', 'p1');
    const before = getChars(s0, id);
    expect(before.types).not.toContain('Creature');
    const s = activate(s0, id);
    const c = getChars(s, id);
    expect(c.types).toEqual(expect.arrayContaining(['Creature', 'Planeswalker']));
    expect([Number(c.power), Number(c.toughness)]).toEqual([5, 5]);
    expect(c.subtypes).toEqual(expect.arrayContaining(['Human', 'Soldier']));
    expect(hasKeyword(c, 'indestructible')).toBe(true);
    // negative: "until end of turn" - after the turn it is no creature again
    let t = s;
    for (let guard = 0; guard < 120 && t.turn.number === s.turn.number && t.pending; guard++) t = drive(act(t, { type: 'pass', player: t.pending.kind === 'priority' ? t.pending.player : 'p1' }));
    expect(getChars(t, id).types).not.toContain('Creature');
  });
});

describe('CR 611.2a, 613.1e, 613.4b: "~ loses defender and gains ..." and "~ becomes blue and has base power and toughness 5/4." (no duration: for good)', () => {
  const ENGINE = card('Test Surge', 'Artifact Creature — Construct', 'Defender\n{0}: This creature loses defender and gains "This creature can\'t be blocked."\n{0}: This creature becomes blue and has base power and toughness 5/4. Activate only if this creature doesn\'t have defender.', { pt: ['0', '4'] });
  it('is automated', () => { expect(full(ENGINE)).toBe(true); });
  it('the first ability removes defender and keeps it removed; the second is refused while it has defender, then makes it a blue 5/4 for good', () => {
    const s0 = mpScenario({ defs: [ENGINE], zones: { p1: { battlefield: ['Test Surge'] } } });
    const id = find(s0, 'Test Surge', 'battlefield', 'p1');
    expect(hasKeyword(getChars(s0, id), 'defender')).toBe(true);
    // negative: with defender the second ability can't be activated (only the first is offered)
    expect(legal(s0, 'p1', 'activate').filter((a) => a.action.type === 'activate' && a.action.source === id)).toHaveLength(1);
    const s1 = activate(s0, id);
    expect(hasKeyword(getChars(s1, id), 'defender')).toBe(false);
    const second = legal(s1, 'p1', 'activate').filter((a) => a.action.type === 'activate' && a.action.source === id);
    expect(second.length).toBeGreaterThanOrEqual(1);
    const s2 = settle(drive(act(s1, second[second.length - 1]!.action)));
    const c = getChars(s2, id);
    expect([Number(c.power), Number(c.toughness)]).toEqual([5, 4]);
    expect(c.colors).toEqual(['U']);
    expect(hasKeyword(c, 'defender')).toBe(false);
  });
});

describe('CR 205.1b, 613.1d, 613.4b: "Nonlegendary creatures enchanted player controls have base power and toughness 3/3 and lose all creature types."', () => {
  const CURSE = card('Test Conform Curse', 'Enchantment — Aura Curse', 'Enchant player\nNonlegendary creatures enchanted player controls have base power and toughness 3/3 and lose all creature types.');
  it('is automated; the enchanted player\'s nonlegendary creatures are 3/3 with no creature types; their legendary creature and other players\' creatures are unchanged', () => {
    expect(full(CURSE)).toBe(true);
    const s = mpScenario({ defs: [CURSE, BEAR, ELF, KING], zones: { p1: { hand: ['Test Conform Curse'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Elf', 'Test Legend King'] } } });
    const t = cast(s, 'Test Conform Curse', { targets: [[pl('p2')]] });
    const elf = getChars(t, find(t, 'Test Elf', 'battlefield', 'p2'));
    expect([Number(elf.power), Number(elf.toughness)]).toEqual([3, 3]);
    expect(elf.subtypes).toEqual([]);
    const king = getChars(t, find(t, 'Test Legend King', 'battlefield', 'p2'));
    expect([Number(king.power), Number(king.toughness)]).toEqual([4, 4]);
    expect(king.subtypes).toEqual(expect.arrayContaining(['Human', 'Noble']));
    const bear = getChars(t, find(t, 'Test Bear', 'battlefield', 'p1'));
    expect([Number(bear.power), Number(bear.toughness)]).toEqual([2, 2]);
    expect(bear.subtypes).toContain('Bear');
  });
});

describe('CR 615.1a, 615.5, 119.3: "If noncombat damage would be dealt to you, prevent that damage. You gain life equal to the damage prevented this way."', () => {
  const PURE = card('Test Pure Spirit', 'Creature — Elemental Incarnation', 'If noncombat damage would be dealt to you, prevent that damage. You gain life equal to the damage prevented this way.', { pt: ['2', '2'] });
  const BOLT = card('Test Plain Bolt', 'Instant', '~ deals 3 damage to target player.');
  it('is automated', () => { expect(full(PURE)).toBe(true); });
  it('3 noncombat damage to its controller is prevented and they gain 3 life (net life +3); damage to another player is not prevented', () => {
    const s0 = mpScenario({ defs: [PURE, BOLT], zones: { p1: { battlefield: ['Test Pure Spirit'], hand: ['Test Plain Bolt', 'Test Plain Bolt'] } } });
    const mine = cast(s0, 'Test Plain Bolt', { targets: [[pl('p1')]] });
    expect(lifeOf(mine, 'p1')).toBe(lifeOf(s0, 'p1') + 3);
    const theirs = cast(s0, 'Test Plain Bolt', { targets: [[pl('p2')]] });
    expect(lifeOf(theirs, 'p2')).toBe(lifeOf(s0, 'p2') - 3);
    expect(lifeOf(theirs, 'p1')).toBe(lifeOf(s0, 'p1'));
  });
  it('negative: an opponent\'s Spirit does not protect its controller\'s opponents - damage to p1 with the Spirit under p2\'s control is dealt', () => {
    const s0 = mpScenario({ defs: [PURE, BOLT], zones: { p2: { battlefield: ['Test Pure Spirit'] }, p1: { hand: ['Test Plain Bolt'] } } });
    const s = cast(s0, 'Test Plain Bolt', { targets: [[pl('p1')]] });
    expect(lifeOf(s, 'p1')).toBe(lifeOf(s0, 'p1') - 3);
    expect(lifeOf(s, 'p2')).toBe(lifeOf(s0, 'p2'));
  });
});

describe('CR 615.1a, 615.7, 616.1: "If a source would deal damage to a player, you may prevent X of that damage, where X is the number of Clerics you control."', () => {
  const CLERIC = card('Test Soft Cleric', 'Creature — Kithkin Cleric', 'If a source would deal damage to a player, you may prevent X of that damage, where X is the number of Clerics you control.', { pt: ['2', '2'] });
  const ACOLYTE = card('Test Acolyte', 'Creature — Human Cleric', '', { pt: ['1', '1'] });
  const BOLT = card('Test Plain Bolt', 'Instant', '~ deals 3 damage to target player.');
  const start = () => mpScenario({ defs: [CLERIC, ACOLYTE, BOLT], zones: { p1: { battlefield: ['Test Soft Cleric', 'Test Acolyte', 'Test Acolyte'], hand: ['Test Plain Bolt'] } } });
  it('is automated and optional', () => {
    expect(full(CLERIC)).toBe(true);
    expect(JSON.stringify(CLERIC.faces[0]!.abilities[0])).toContain('"optional":true');
  });
  it('yes: 3 Clerics prevent X = 3 of 3 damage to any player (even to another player than its controller)', () => {
    const s0 = start();
    const s = cast(s0, 'Test Plain Bolt', { targets: [[pl('p2')]], yes: [true] });
    expect(lifeOf(s, 'p2')).toBe(lifeOf(s0, 'p2'));
  });
  it('no: the damage is dealt in full', () => {
    const s0 = start();
    const s = cast(s0, 'Test Plain Bolt', { targets: [[pl('p2')]], yes: [false] });
    expect(lifeOf(s, 'p2')).toBe(lifeOf(s0, 'p2') - 3);
  });
  it('negative: damage to a creature is not prevented and no question is asked (it says "a player")', () => {
    const CBOLT = card('Test Creature Bolt', 'Instant', '~ deals 3 damage to target creature.');
    const s0 = mpScenario({ defs: [CLERIC, BEAR, CBOLT], zones: { p1: { battlefield: ['Test Soft Cleric'], hand: ['Test Creature Bolt'] }, p2: { battlefield: ['Test Bear'] } } });
    const s = cast(s0, 'Test Creature Bolt', { targets: [[obj(find(s0, 'Test Bear', 'battlefield', 'p2'))]], yes: [true] });
    expect(namesOn(s, 'p2')).not.toContain('Test Bear');
  });
  it('X counts the Clerics its controller controls now: with only the one Cleric it prevents 1 of the 3', () => {
    const s0 = mpScenario({ defs: [CLERIC, BOLT], zones: { p1: { battlefield: ['Test Soft Cleric'], hand: ['Test Plain Bolt'] } } });
    const s = cast(s0, 'Test Plain Bolt', { targets: [[pl('p2')]], yes: [true] });
    expect(lifeOf(s, 'p2')).toBe(lifeOf(s0, 'p2') - 2);
  });
});

describe('CR 509.1a, 604.1: "As long as <condition>, it has reach and can block an additional two creatures each combat."', () => {
  const HAND = card('Test Many Hands', 'Creature — Giant', '{0}: Monstrosity 1.\nAs long as this creature is monstrous, it has reach and can block an additional two creatures each combat.', { pt: ['3', '3'] });
  it('is automated; before it is monstrous it has no reach and blocks one creature; once monstrous, reach and three', () => {
    expect(full(HAND)).toBe(true);
    const off = mpScenario({ defs: [HAND], zones: { p1: { battlefield: ['Test Many Hands'] } } });
    const id = find(off, 'Test Many Hands', 'battlefield', 'p1');
    expect(hasKeyword(getChars(off, id), 'reach')).toBe(false);
    expect(maxBlocks(off, id)).toBe(1);
    const on = activate(off, id);
    expect(hasKeyword(getChars(on, id), 'reach')).toBe(true);
    expect(maxBlocks(on, id)).toBe(3);
    expect(Number(getChars(on, id).power)).toBe(4);
  });
});

void applyAction;
