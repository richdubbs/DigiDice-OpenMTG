/**
 * Commander lane edh-mana-keywords, round edh-mana-keywords-5: scenarios with synthetic cards (invented names, design 6.10), compiled by the default compiler.
 * CR cites are from the Comprehensive Rules 2026-09-25 (https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt) where the round checked them.
 *
 *   CR 602.2, 603.4, 707.10   "Whenever you activate an ability, if it isn't a mana ability, you may pay {2}. If you do, copy that ability." (Rings of Brighthearth): a non-mana
 *                             ability of yours, only when the payment is made; a mana ability is not copied
 *   CR 602.2, 605.1a, 707.10  "Whenever an ability of equipped creature is activated, if it isn't a mana ability, copy that ability." (Illusionist's Bracers): the equipped
 *                             creature's ability, whoever activates it; another creature's is not copied
 */
import { describe, expect, it } from 'vitest';
import { legalActions, type GameState } from '../../../src/index';
import { act, answer, find, life, pass, pool, scenario } from '../../m3/scenario';
import { card, full, settle, type Picks } from '../cmd3/helpers';

const activate = (s: GameState, name: string, player = 'p1'): GameState => {
  const source = find(s, name, 'battlefield', player);
  const a = legalActions(s, player).find((l) => l.kind === 'activate' && l.object === source && l.isMana !== true);
  if (!a) throw new Error(`no activation of ${name}`);
  return settle(act(s, a.action));
};
const drain = (s0: GameState, picks: Picks = {}): GameState => { let s = s0; for (let i = 0; i < 12 && s.zones.stack.length > 0; i++) s = settle(pass(s), picks); return s; };

// ---- Rings of Brighthearth: copy a non-mana ability for {2} ----------------------------------------------------------------------------------------------------
const RINGS = card('Test Rings', 'Artifact', "Whenever you activate an ability, if it isn't a mana ability, you may pay {2}. If you do, copy that ability. You may choose new targets for the copy.");
const WELL = card('Test Well', 'Artifact', '{0}: You gain 1 life.');
const SPRING = card('Test Spring', 'Artifact', '{T}: Add {C}.');
const DEFS = [RINGS, WELL, SPRING];

describe('CR 602.2, 603.4, 707.10: "Whenever you activate an ability, if it isn\'t a mana ability, you may pay {2}. If you do, copy that ability."', () => {
  const board = (): GameState => scenario([], { defs: DEFS, p1: { battlefield: ['Test Rings', 'Test Well', 'Test Spring', 'Test Spring'] } });
  it('the cards are fully automated', () => {
    expect(full(RINGS), JSON.stringify(RINGS.automation)).toBe(true);
  });
  it('with {2} paid the ability resolves twice (two life)', () => {
    const s = drain(activate(board(), 'Test Well'));
    expect(life(s, 'p1')).toBe(22);
  });
  it('negative: declining the payment copies nothing (one life)', () => {
    const s = drain(activate(board(), 'Test Well'), { yes: false });
    expect(life(s, 'p1')).toBe(21);
  });
  it('negative: an ability whose cost sacrifices the Rings is not copied (the Rings is gone when it is activated)', () => {
    const PRIEST = card('Test Priest', 'Creature — Human', 'Sacrifice an artifact: You gain 1 life.', ['1', '1']);
    const only = scenario([], { defs: [RINGS, PRIEST], p1: { battlefield: ['Test Rings', 'Test Priest'] } }); // the Rings is the only artifact: the cost has to sacrifice it
    const b = legalActions(only, 'p1').find((l) => l.kind === 'activate' && l.object === find(only, 'Test Priest', 'battlefield') && l.isMana !== true);
    const s = drain(settle(act(only, b!.action)));
    expect(life(s, 'p1')).toBe(21);
  });
  it('negative: a mana ability is not copied and does not trigger it', () => {
    const s0 = board();
    const a = legalActions(s0, 'p1').find((l) => l.kind === 'activate' && l.object === find(s0, 'Test Spring', 'battlefield'));
    const s = act(s0, a!.action);
    expect(s.zones.stack.length).toBe(0);
    expect(s.pending?.kind).toBe('priority');
  });
});

// ---- Illusionist's Bracers: the equipped creature's ability is copied ----------------------------------------------------------------------------------------
const BRACERS = card('Test Bracers', 'Artifact — Equipment', "Whenever an ability of equipped creature is activated, if it isn't a mana ability, copy that ability. You may choose new targets for the copy.\nEquip {0}");
const BEARER = card('Test Bearer', 'Creature — Human', '{0}: You gain 1 life.', ['1', '1']);
const BYSTANDER = card('Test Bystander', 'Creature — Human', '{0}: You gain 1 life.', ['1', '1']);

describe('CR 602.2, 605.1a, 707.10: "Whenever an ability of equipped creature is activated, if it isn\'t a mana ability, copy that ability."', () => {
  const equipped = (): GameState => {
    const s0 = scenario([], { defs: [BRACERS, BEARER, BYSTANDER], p1: { battlefield: ['Test Bracers', 'Test Bearer', 'Test Bystander'] } });
    const equip = legalActions(s0, 'p1').find((l) => l.kind === 'activate' && l.object === find(s0, 'Test Bracers', 'battlefield'));
    if (!equip) throw new Error('equip not offered');
    return drain(settle(act(s0, equip.action), { targets: [{ kind: 'object', id: find(s0, 'Test Bearer', 'battlefield') }] }));
  };
  it('the card is fully automated', () => {
    expect(full(BRACERS), JSON.stringify(BRACERS.automation)).toBe(true);
  });
  it("the equipped creature's ability resolves twice (the copy)", () => {
    const s = drain(activate(equipped(), 'Test Bearer'));
    expect(life(s, 'p1')).toBe(22);
  });
  it("negative: another creature's ability is not copied", () => {
    const s = drain(activate(equipped(), 'Test Bystander'));
    expect(life(s, 'p1')).toBe(21);
  });
  it('negative: an ability whose cost sacrifices the equipped creature is not copied (it is no longer equipped when activated)', () => {
    const SAC = card('Test Martyr', 'Creature — Human', 'Sacrifice this creature: You gain 1 life.', ['1', '1']);
    const s0 = scenario([], { defs: [BRACERS, SAC], p1: { battlefield: ['Test Bracers', 'Test Martyr'] } });
    const equip = legalActions(s0, 'p1').find((l) => l.kind === 'activate' && l.object === find(s0, 'Test Bracers', 'battlefield'));
    const s1 = drain(settle(act(s0, equip!.action), { targets: [{ kind: 'object', id: find(s0, 'Test Martyr', 'battlefield') }] }));
    const s = drain(activate(s1, 'Test Martyr'));
    expect(life(s, 'p1')).toBe(21);
  });
});

// ---- "When you spend this mana to cast ..., <effect>" -------------------------------------------------------------------------------------------------------------
const ORB = card('Test Orb', 'Artifact', '{T}: Add {G}. When you spend this mana to cast a Dragon creature spell, you gain 2 life.');
const SCRYER = card('Test Scryer', 'Artifact', '{T}: Add {G}. When you spend this mana to cast a Dragon creature spell, scry 1.');
const STONE = card('Test Stone', 'Artifact', '{T}: Add {C}.');
const DRAKE = card('Test Drake', 'Creature — Dragon', '', ['1', '1'], '{1}');
const BEAR = card('Test Bear', 'Creature — Bear', '', ['1', '1'], '{1}');
const D2 = [ORB, SCRYER, STONE, DRAKE, BEAR];

describe('CR 106.6, 603.2: "When you spend this mana to cast <spells>, <effect>" (the mana carries a triggered ability)', () => {
  const tap = (s: GameState, name: string): GameState => {
    const a = legalActions(s, 'p1').find((x) => x.kind === 'activate' && x.isMana === true && x.object === find(s, name, 'battlefield', 'p1'));
    return act(s, a!.action);
  };
  const cast = (s0: GameState, name: string): GameState => {
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') });
    for (let g = 0; g < 40 && s.pending && !(s.pending.kind === 'priority' && s.zones.stack.length === 0 && s.pending.player === 'p1'); g++) s = s.pending.kind === 'payCost' ? answer(s, { kind: 'payCost', auto: true }) : pass(s);
    return s;
  };
  it('the synthetic cards are fully automated', () => {
    for (const d of [ORB, SCRYER]) expect(full(d), JSON.stringify(d.automation)).toBe(true);
  });
  it('you gain 2 life when the mana pays for a Dragon creature spell', () => {
    const s = cast(tap(scenario([], { defs: D2, p1: { hand: ['Test Drake'], battlefield: ['Test Orb'] } }), 'Test Orb'), 'Test Drake');
    expect(life(s, 'p1')).toBe(22);
  });
  it('negative: a creature spell that is not a Dragon gains nothing', () => {
    const s = cast(tap(scenario([], { defs: D2, p1: { hand: ['Test Bear'], battlefield: ['Test Orb'] } }), 'Test Orb'), 'Test Bear');
    expect(life(s, 'p1')).toBe(20);
  });
  it('negative: a Dragon paid for with other mana gains nothing', () => {
    const s = cast(tap(scenario([], { defs: D2, p1: { hand: ['Test Drake'], battlefield: ['Test Orb', 'Test Stone'] } }), 'Test Stone'), 'Test Drake');
    expect(life(s, 'p1')).toBe(20);
  });
});

// ---- "For each creature destroyed / exiled this way, its controller ..." ---------------------------------------------------------------------------------------
const JUDGMENT = card('Test Judgment', 'Sorcery', 'Destroy all creatures. For each creature destroyed this way, its controller creates a 2/2 green Wolf creature token.', undefined, '{0}');
const BANISH = card('Test Banish', 'Sorcery', 'Exile up to two target creatures. For each creature exiled this way, its controller creates a 1/1 white Spirit creature token.', undefined, '{0}');
const GUARD = card('Test Guard', 'Creature — Soldier', 'Indestructible', ['1', '1']);
const MARCH = card('Test March', 'Sorcery', "Destroy all creatures. They can't be regenerated. For each creature destroyed this way, its controller creates a 1/1 white Spirit creature token with flying.", undefined, '{0}');
const PALE = card('Test Pale', 'Creature — Soldier', '', ['1', '1']);
const D3 = [JUDGMENT, BANISH, GUARD, MARCH, PALE];
const tokensOf = (s: GameState, player: string): number => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === player).length;

describe('CR 608.2c, 608.2h, 701.8a: "For each creature destroyed this way, its controller creates a ..." (each object as it last existed)', () => {
  const play = (name: string, p1: string[], p2: string[], defs = D3, targets: string[] = []): GameState => {
    const s0 = scenario([], { defs, p1: { hand: [name], battlefield: p1 }, p2: { battlefield: p2 } });
    return drain(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), { targets: targets.map((n) => ({ kind: 'object' as const, id: find(s0, n, 'battlefield', 'p2') })) }));
  };
  it('the cards are fully automated', () => {
    for (const d of [JUDGMENT, BANISH, MARCH]) expect(full(d), JSON.stringify(d.automation)).toBe(true);
  });
  it("each creature's own controller gets the token: two of mine, one of theirs", () => {
    const s = play('Test Judgment', ['Test Pale', 'Test Pale'], ['Test Pale']);
    expect(tokensOf(s, 'p1')).toBe(2);
    expect(tokensOf(s, 'p2')).toBe(1);
  });
  it('negative: a creature that is not destroyed (indestructible) gives its controller nothing', () => {
    const s = play('Test Judgment', ['Test Guard'], ['Test Pale', 'Test Guard']);
    expect(tokensOf(s, 'p1')).toBe(0);
    expect(tokensOf(s, 'p2')).toBe(1);
  });
  it('"They can\'t be regenerated" beside it: the token follows the destroyed creature\'s controller', () => {
    const s = play('Test March', [], ['Test Pale']);
    expect(tokensOf(s, 'p1')).toBe(0);
    expect(tokensOf(s, 'p2')).toBe(1);
  });
  it("exile: the exiled creature's controller (not the caster) gets the token, one per creature exiled", () => {
    const s = play('Test Banish', ['Test Guard'], ['Test Pale', 'Test Pale'], D3, ['Test Pale']);
    expect(tokensOf(s, 'p1')).toBe(0);
    expect(tokensOf(s, 'p2')).toBe(1); // only the one creature that was targeted
  });
});

// ---- Caged Sun / Gauntlet of Power: an additional mana of the chosen color ---------------------------------------------------------------------------------------
const SUN = card('Test Sun', 'Artifact', "As this artifact enters, choose a color.\nWhenever a land's ability causes you to add one or more mana of the chosen color, add an additional one mana of that color.");
const GAUNTLET = card('Test Gauntlet', 'Artifact', 'As this artifact enters, choose a color.\nWhenever a basic land is tapped for mana of the chosen color, its controller adds an additional one mana of that color.');
const TWIN = card('Test Twin', 'Land', '{T}: Add {G}{G}.');
const GLADE = card('Test Glade', 'Land', '{T}: Add {G}.');
const IDOL = card('Test Idol', 'Artifact', '{T}: Add {G}.');
const D4 = [SUN, GAUNTLET, TWIN, GLADE, IDOL];

describe('CR 605.1b, 106.4, 607.2d: "Whenever a land\'s ability causes you to add one or more mana of the chosen color, add an additional one mana of that color."', () => {
  const withCard = (name: string, extra: string[]): GameState => {
    let s = scenario(['Forest', 'Mountain'], { defs: D4, p1: { hand: [name], battlefield: extra } });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') });
    for (let g = 0; g < 20 && (s.zones.stack.length > 0 || s.pending?.kind !== 'priority'); g++) {
      s = s.pending?.kind === 'chooseColor' ? answer(s, { kind: 'chooseColor', color: 'G' as never }) : s.pending?.kind === 'payCost' ? answer(s, { kind: 'payCost', auto: true }) : pass(s);
    }
    return s;
  };
  const tap = (s: GameState, name: string): GameState => {
    const a = legalActions(s, 'p1').find((x) => x.kind === 'activate' && x.isMana === true && x.object === find(s, name, 'battlefield', 'p1'));
    let t = act(s, a!.action);
    for (let g = 0; g < 5 && t.pending && t.pending.kind === 'chooseColor'; g++) t = answer(t, { kind: 'chooseColor', color: 'G' as never });
    return t;
  };
  it('the cards are fully automated', () => {
    expect(full(SUN), JSON.stringify(SUN.automation)).toBe(true);
    expect(full(GAUNTLET), JSON.stringify(GAUNTLET.automation)).toBe(true);
  });
  it('a land that makes mana of the chosen color makes one more (two in all)', () => {
    expect(pool(tap(withCard('Test Sun', ['Forest']), 'Forest'), 'p1')).toBe('GG');
  });
  it('negative: a land that makes mana of another color makes no more', () => {
    expect(pool(tap(withCard('Test Sun', ['Mountain']), 'Mountain'), 'p1')).toBe('R');
  });
  it('one additional mana only, however much of the chosen color the land made (two make three)', () => {
    expect(pool(tap(withCard('Test Sun', ['Test Twin']), 'Test Twin'), 'p1')).toBe('GGG');
  });
  it('negative: a permanent that is not a land is not a land\'s ability', () => {
    expect(pool(tap(withCard('Test Sun', ['Test Idol']), 'Test Idol'), 'p1')).toBe('G');
  });
  it('Gauntlet of Power: a basic land tapped for the chosen color gives its controller one more; a nonbasic land does not', () => {
    expect(pool(tap(withCard('Test Gauntlet', ['Forest']), 'Forest'), 'p1')).toBe('GG');
    expect(pool(tap(withCard('Test Gauntlet', ['Test Glade']), 'Test Glade'), 'p1')).toBe('G');
    expect(pool(tap(withCard('Test Gauntlet', ['Mountain']), 'Mountain'), 'p1')).toBe('R');
  });
});
