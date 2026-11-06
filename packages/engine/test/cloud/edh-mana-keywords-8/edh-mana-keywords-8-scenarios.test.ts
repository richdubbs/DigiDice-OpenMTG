/**
 * Commander lane edh-mana-keywords, round edh-mana-keywords-8: scenarios with synthetic cards (invented names, design 6.10), compiled by the default compiler.
 * CR cites are from the Comprehensive Rules 2026-09-25 where the round checked them against the real text.
 *
 *   CR 702.51a, 702.51c, 601.2h  "Each creature that convoked this spell connives." (Lethal Scheme): the creatures tapped to convoke the spell, no others; a copy has none
 *   CR 701.50a-b, 608.2h         a convoker that left the battlefield still connives (Lethal Scheme ruling)
 *   CR 702.51a, 205.3m, 406.2    "Exile all creatures except those that share a creature type with a creature that convoked this spell, all artifacts, and all enchantments."
 *                                (Everything Comes to Dust): the convokers keep their types; with none, every creature goes
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, find, findAll, legal, scenario } from '../../m3/scenario';
import { card, full, settle } from '../cmd3/helpers';

const SCHEME = card('Test Scheme', 'Instant', 'Convoke\nDestroy target creature. Each creature that convoked this spell connives.', undefined, '{3}');
const DUST = card('Test Dust', 'Sorcery', 'Convoke\nExile all creatures except those that share a creature type with a creature that convoked this spell, all artifacts, and all enchantments.', undefined, '{4}');
const TWIN = card('Test Twin', 'Instant', 'Copy target instant spell you control.');
const SMITE = card('Test Smite', 'Instant', 'Destroy target creature.');
const IDEA = card('Test Idea', 'Instant', 'You gain 1 life.');
const squire = (name: string, types: string): ReturnType<typeof card> => card(name, `Creature — ${types}`, '', ['1', '1']);
const HUMAN = squire('Test Human', 'Human');
const HUMAN2 = squire('Test Other Human', 'Human');
const GOBLIN = squire('Test Goblin', 'Goblin');
const KNIGHT = squire('Test Knight', 'Human Knight');
const SHAPER = card('Test Shaper', 'Creature — Shapeshifter', 'Changeling', ['1', '1']);
const ROCK = card('Test Rock', 'Artifact', '');
const AURA = card('Test Wall', 'Enchantment', '');
const BLANK = card('Test Blank', 'Creature', '', ['1', '1']);
const TOUGH = card('Test Tough', 'Creature — Golem', 'Indestructible', ['2', '2']);
const DEFS = [SCHEME, DUST, TWIN, SMITE, IDEA, HUMAN, HUMAN2, GOBLIN, KNIGHT, SHAPER, ROCK, AURA, BLANK, TOUGH];

const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const yard = (s: GameState, p: 'p1' | 'p2'): string[] => s.zones.graveyard[p]!.map((id) => nameOf(s, id));
const onBf = (s: GameState): string[] => s.zones.battlefield.map((id) => nameOf(s, id));
const counters = (s: GameState, id: ObjectId): number => s.objects[id]?.counters['+1/+1'] ?? 0;

/** Cast `name` from p1's hand: the convoke creatures `convoke`, the targets `targets`, every other decision at its first option. */
function castWith(s0: GameState, name: string, convoke: ObjectId[], targets: TargetChoice[] = []): GameState {
  let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') });
  let convoked = false;
  for (let i = 0; i < 40 && s.pending && s.pending.kind !== 'priority'; i++) {
    const d = s.pending as unknown as { kind: string; options?: ObjectId[]; min?: number; prompt?: string };
    if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else if (d.kind === 'chooseObjects' && !convoked && /pay part of/.test(d.prompt ?? '')) { s = answer(s, { kind: 'chooseObjects', ids: convoke }); convoked = true; }
    else s = settle(s);
  }
  return s;
}
/** Both players pass until the stack is empty (a connive's discard is answered with the first card). */
function resolveAll(s0: GameState): GameState {
  let s = settle(s0);
  for (let i = 0; i < 40 && s.zones.stack.length > 0; i++) s = settle(act(s, { type: 'pass', player: s.pending!.player }));
  return s;
}
const aim = (s: GameState, name: string, zone: 'battlefield' | 'stack', owner?: 'p1' | 'p2'): TargetChoice[] => [{ kind: 'object', id: find(s, name, zone, owner) }];

describe('the synthetic cards are fully automated', () => {
  it('Test Scheme and Test Dust play fully', () => {
    expect(full(SCHEME), JSON.stringify(SCHEME.automation)).toBe(true);
    expect(full(DUST), JSON.stringify(DUST.automation)).toBe(true);
  });
});

describe('CR 702.51a, 701.50a: "Each creature that convoked this spell connives."', () => {
  const board = (extra: string[] = []): GameState =>
    scenario(['Mountain'], { defs: DEFS, p1: { hand: ['Test Scheme', 'Test Idea', ...extra], battlefield: ['Test Human', 'Test Human', 'Test Human', 'Mountain'] }, p2: { battlefield: ['Test Goblin'] } });
  const humans = (s: GameState): ObjectId[] => findAll(s, 'Test Human', 'battlefield', 'p1');

  it('two creatures convoke and the Mountain pays the rest: exactly those two connive (CR 701.50a: draw, discard; a nonland discard earns a counter)', () => {
    const b = board();
    const [a, c, d] = humans(b) as [ObjectId, ObjectId, ObjectId];
    const s = resolveAll(castWith(b, 'Test Scheme', [a, c], aim(b, 'Test Goblin', 'battlefield', 'p2')));
    expect(onBf(s)).not.toContain('Test Goblin');
    expect(s.objects[a]!.tapped && s.objects[c]!.tapped).toBe(true);
    // two connives: two draws and two discards; the hand ends as it started minus the Scheme
    expect(s.zones.hand.p1!.length).toBe(1);
    expect(yard(s, 'p1').length).toBe(1 /* the Scheme */ + 2);
    expect(counters(s, a) + counters(s, c)).toBe(1); // the first discard is Test Idea (a nonland card), the second a Plains
    expect(counters(s, d)).toBe(0); // the creature that did not convoke does not connive
  });
  it('negative: paid with mana alone, nothing convoked it and nothing connives', () => {
    const b = scenario(['Mountain'], { defs: DEFS, p1: { hand: ['Test Scheme', 'Test Idea'], battlefield: ['Test Human', 'Mountain', 'Mountain', 'Mountain'] }, p2: { battlefield: ['Test Goblin'] } });
    const s = resolveAll(castWith(b, 'Test Scheme', [], aim(b, 'Test Goblin', 'battlefield', 'p2')));
    expect(onBf(s)).not.toContain('Test Goblin');
    expect(s.zones.hand.p1!.length).toBe(1); // only Test Idea
    expect(yard(s, 'p1')).toEqual(['Test Scheme']);
    expect(findAll(s, 'Test Human', 'battlefield', 'p1').map((id) => counters(s, id))).toEqual([0]);
  });
  it('CR 701.50b, 608.2h (ruling): a convoker destroyed in response still connives (it draws and discards, no counter)', () => {
    const b = scenario(['Mountain'], { defs: DEFS, p1: { hand: ['Test Scheme', 'Test Idea'], battlefield: ['Test Human', 'Test Human', 'Test Human', 'Mountain'] }, p2: { hand: ['Test Smite'], battlefield: ['Test Goblin'] } });
    const [a, c] = findAll(b, 'Test Human', 'battlefield', 'p1') as [ObjectId, ObjectId];
    let s = castWith(b, 'Test Scheme', [a, c], aim(b, 'Test Goblin', 'battlefield', 'p2'));
    s = settle(act(s, { type: 'pass', player: 'p1' })); // p1 passes; p2 answers by destroying a convoker
    expect(s.pending?.player).toBe('p2');
    s = act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Smite', 'hand', 'p2') });
    s = settle(s, { targets: aim(s, 'Test Human', 'battlefield', 'p1') });
    s = resolveAll(s);
    expect(yard(s, 'p1')).toContain('Test Human');
    expect(yard(s, 'p1').length).toBe(1 /* the Scheme */ + 1 /* the destroyed Human */ + 2 /* two connives, the dead one included */);
  });
  it('CR 707.10: a copy of the spell was not cast, so no creature convoked it: the copy connives nobody, the original connives its two convokers', () => {
    const b = scenario(['Mountain'], { defs: DEFS, p1: { hand: ['Test Scheme', 'Test Twin', 'Test Idea'], battlefield: ['Test Human', 'Test Human', 'Mountain'] }, p2: { battlefield: ['Test Tough'] } });
    const [a, c] = findAll(b, 'Test Human', 'battlefield', 'p1') as [ObjectId, ObjectId];
    let s = castWith(b, 'Test Scheme', [a, c], aim(b, 'Test Tough', 'battlefield', 'p2'));
    s = castWith(s, 'Test Twin', [], aim(s, 'Test Scheme', 'stack'));
    const pass2 = (t: GameState): GameState => settle(act(settle(act(t, { type: 'pass', player: 'p1' })), { type: 'pass', player: 'p2' }));
    s = pass2(s); // the Twin resolves: a copy of the Scheme is on top
    expect(s.zones.stack.map((id) => nameOf(s, id))).toEqual(['Test Scheme', 'Test Scheme']);
    const handBefore = s.zones.hand.p1!.length;
    s = pass2(s); // the copy resolves
    expect(s.zones.stack.map((id) => nameOf(s, id))).toEqual(['Test Scheme']);
    expect(s.zones.hand.p1!.length).toBe(handBefore); // nobody drew
    expect(counters(s, a) + counters(s, c)).toBe(0);
    s = pass2(s); // the original resolves: its two convokers connive
    expect(yard(s, 'p1').filter((n) => n === 'Test Idea' || n === 'Plains').length).toBe(2);
    expect(s.zones.hand.p1!.length).toBe(handBefore);
  });
});

describe('CR 702.51a, 205.3m, 406.2: "Exile all creatures except those that share a creature type with a creature that convoked this spell, all artifacts, and all enchantments."', () => {
  const board = (): GameState =>
    scenario([], {
      defs: DEFS,
      p1: { hand: ['Test Dust'], battlefield: ['Test Human', 'Test Goblin', 'Test Blank', 'Test Shaper', 'Test Rock', 'Test Wall', 'Plains', 'Plains', 'Plains', 'Plains'] },
      p2: { battlefield: ['Test Other Human', 'Test Knight', 'Test Rock'] },
    });
  it('creatures sharing a type with the convoker stay (the Human, an opposing Human, a Knight that is also a Human, a Changeling); the rest, every artifact and every enchantment go', () => {
    const b = board();
    const human = find(b, 'Test Human', 'battlefield', 'p1');
    const s = resolveAll(castWith(b, 'Test Dust', [human]));
    expect(onBf(s).filter((n) => n.startsWith('Test')).sort()).toEqual(['Test Human', 'Test Knight', 'Test Other Human', 'Test Shaper'].sort());
    expect(s.zones.exile.map((id) => nameOf(s, id)).sort()).toEqual(['Test Blank', 'Test Goblin', 'Test Rock', 'Test Rock', 'Test Wall']);
  });
  it('CR 608.2h: a convoker that was destroyed in response is still "a creature that convoked this spell" (last known information): creatures sharing its type stay', () => {
    const b = scenario([], {
      defs: DEFS,
      p1: { hand: ['Test Dust'], battlefield: ['Test Human', 'Test Goblin', 'Test Rock', 'Plains', 'Plains', 'Plains', 'Plains'] },
      p2: { hand: ['Test Smite'], battlefield: ['Test Other Human'] },
    });
    const human = find(b, 'Test Human', 'battlefield', 'p1');
    let s = castWith(b, 'Test Dust', [human]);
    s = settle(act(s, { type: 'pass', player: 'p1' }));
    s = act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Smite', 'hand', 'p2') });
    s = resolveAll(settle(s, { targets: [{ kind: 'object', id: human }] }));
    expect(yard(s, 'p1')).toContain('Test Human');
    expect(onBf(s).filter((n) => n.startsWith('Test'))).toEqual(['Test Other Human']); // the opposing Human shares Human with the dead convoker; the Goblin and the Rock go
  });
  it('negative: with no creature convoking, every creature is exiled (no creature type is shared with nothing)', () => {
    const b = board();
    const s = resolveAll(castWith(b, 'Test Dust', []));
    expect(onBf(s).filter((n) => n.startsWith('Test'))).toEqual([]);
  });
  it('negative: a convoking Goblin keeps only creatures that share Goblin; the Human is exiled', () => {
    const b = board();
    const goblin = find(b, 'Test Goblin', 'battlefield', 'p1');
    const s = resolveAll(castWith(b, 'Test Dust', [goblin]));
    expect(onBf(s).filter((n) => n.startsWith('Test')).sort()).toEqual(['Test Goblin', 'Test Shaper']);
  });
});

// ---- equip: "first equip ability you activate each turn" for {0}, and equip at instant speed ------------------------------------------------------------------------
const BRUENOR = card('Test Dwarf Captain', 'Creature — Dwarf', 'You may pay {0} rather than pay the equip cost of the first equip ability you activate each turn.', ['2', '2']);
const ANEW = card('Test Anew', 'Enchantment', 'During your turn, you may activate equip abilities any time you could cast an instant.\nYou may pay {0} rather than pay the equip cost of the first equip ability you activate during each of your turns.');
const AXE = card('Test Axe', 'Artifact — Equipment', 'Equipped creature gets +1/+0.\nEquip {2}', undefined, '{1}');
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const EQUIP_DEFS = [BRUENOR, ANEW, AXE, BEAR, IDEA];
const equips = (s: GameState, player: 'p1' | 'p2' = 'p1'): ObjectId[] => legal(s, player, 'activate').flatMap((a) => (a.object !== undefined && nameOf(s, a.object) === 'Test Axe' ? [a.object] : []));
const doEquip = (s: GameState, axe: ObjectId, onto: ObjectId, player: 'p1' | 'p2' = 'p1'): GameState =>
  resolveAll(settle(act(s, legal(s, player, 'activate').find((a) => a.object === axe)!.action), { targets: [{ kind: 'object', id: onto }] }));

describe('CR 702.6a, 602.2b, 118.9: "You may pay {0} rather than pay the equip cost of the first equip ability you activate each turn."', () => {
  it('the cards are fully automated', () => {
    expect(full(BRUENOR), JSON.stringify(BRUENOR.automation)).toBe(true);
    expect(full(ANEW), JSON.stringify(ANEW.automation)).toBe(true);
  });
  it('the first equip of the turn costs nothing with no mana at all; the second one needs its {2}', () => {
    const s0 = scenario([], { defs: EQUIP_DEFS, p1: { battlefield: ['Test Dwarf Captain', 'Test Axe', 'Test Axe', 'Test Bear'] } });
    const [a1, a2] = findAll(s0, 'Test Axe', 'battlefield', 'p1') as [ObjectId, ObjectId];
    expect(equips(s0).sort()).toEqual([a1, a2].sort());
    const s1 = doEquip(s0, a1, find(s0, 'Test Bear', 'battlefield', 'p1'));
    expect(s1.objects[a1]!.attachedTo).toBe(find(s0, 'Test Bear', 'battlefield', 'p1'));
    expect(equips(s1)).not.toContain(a2); // the second equip costs {2} and there is no mana
  });
  it('negative: without the Captain the equip cost is paid as usual', () => {
    const s0 = scenario([], { defs: EQUIP_DEFS, p1: { battlefield: ['Test Axe', 'Test Bear'] } });
    expect(equips(s0)).toEqual([]);
  });
  it("negative: an opponent's equip abilities are not free (played on their own main phase, with and without mana)", () => {
    const mk = (lands: string[]): GameState => advanceTo(scenario(['Mountain'], { defs: EQUIP_DEFS, p1: { battlefield: ['Test Dwarf Captain'] }, p2: { battlefield: ['Test Axe', 'Test Bear', ...lands] } }), 2, 'main1');
    expect(equips(mk([]), 'p2')).toEqual([]); // the Captain is not theirs: the {2} must be paid
    expect(equips(mk(['Mountain', 'Mountain']), 'p2').length).toBe(1); // control: with the mana it is offered
  });
});

describe('CR 702.6a, 602.5d, 117.1a: "During your turn, you may activate equip abilities any time you could cast an instant." and "... the first equip ability you activate during each of your turns"', () => {
  const board = (): GameState => scenario([], { defs: EQUIP_DEFS, p1: { hand: ['Test Idea'], battlefield: ['Test Anew', 'Test Axe', 'Test Axe', 'Test Bear'] } });
  const withSpellOnStack = (s: GameState): GameState => settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Idea', 'hand', 'p1') }));
  it('with a spell on the stack the equip is still offered, and the first one is free', () => {
    const s0 = board();
    const [a1] = findAll(s0, 'Test Axe', 'battlefield', 'p1') as [ObjectId, ObjectId];
    const s1 = withSpellOnStack(s0);
    expect(s1.zones.stack.length).toBe(1);
    expect(equips(s1)).toContain(a1);
    const bear = find(s1, 'Test Bear', 'battlefield', 'p1');
    const s2 = settle(act(s1, legal(s1, 'p1', 'activate').find((a) => a.object === a1)!.action), { targets: [{ kind: 'object', id: bear }] });
    expect(s2.zones.stack.length).toBe(2); // the equip ability is on the stack above the spell: nothing sorcery-like about it
  });
  it('negative: without the Anew the equip is not offered while a spell is on the stack', () => {
    const s0 = scenario([], { defs: EQUIP_DEFS, p1: { hand: ['Test Idea'], battlefield: ['Test Dwarf Captain', 'Test Axe', 'Test Bear'] } });
    expect(equips(s0).length).toBe(1);
    expect(equips(withSpellOnStack(s0))).toEqual([]);
  });
  it("negative: during an opponent's turn the permission does not apply (the player has priority and the mana to pay)", () => {
    const s0 = scenario(['Mountain'], { defs: EQUIP_DEFS, p1: { battlefield: ['Test Anew', 'Test Axe', 'Test Bear', 'Mountain', 'Mountain', 'Mountain'] } });
    let s = advanceTo(s0, 2, 'upkeep');
    s = act(s, { type: 'pass', player: s.pending!.player }); // the active player (p2) passes: p1 holds priority in p2's upkeep
    expect(s.turn.activePlayer).toBe('p2');
    expect(s.pending?.player).toBe('p1');
    expect(equips(s)).toEqual([]);
  });
});

// ---- Throne of Eldraine: mana of the chosen color for monocolored spells of that color; "Spend only mana of the chosen color to activate this ability" --------------
const THRONE = card('Test Throne', 'Artifact', 'As this artifact enters, choose a color.\n{T}: Add four mana of the chosen color. Spend this mana only to cast monocolored spells of that color.\n{3}, {T}: Draw two cards. Spend only mana of the chosen color to activate this ability.', undefined, '{5}');
const hued = (name: string, type: string, cost: string, colors: string[]) =>
  compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: '', colors, power: '2', toughness: '2' } as OracleCard);
const RED_BEAR = hued('Test Red Bear', 'Creature — Bear', '{3}{R}', ['R']);
const GREEN_BEAR = hued('Test Green Bear', 'Creature — Bear', '{3}{G}', ['G']);
const GOLD_DRAKE = hued('Test Gold Drake', 'Creature — Drake', '{2}{R}{G}', ['R', 'G']);
const PRISM = card('Test Prism', 'Artifact', '', undefined, '{4}');
const THRONE_DEFS = [THRONE, RED_BEAR, GREEN_BEAR, GOLD_DRAKE, PRISM];
const chosen = (s: GameState, color: string): GameState => {
  const t = structuredClone(s);
  t.objects[find(t, 'Test Throne', 'battlefield', 'p1')]!.links = { color: { values: [color] } };
  return t;
};
const castable = (s: GameState, name: string): boolean => legal(s, 'p1', 'cast').some((a) => a.object !== undefined && nameOf(s, a.object) === name);
/** Tap the Throne for mana (a mana ability whose mana is decided as it resolves is activated first; the mana waits in the pool). */
const tapThrone = (s: GameState): GameState => {
  const a = legal(s, 'p1', 'activate').find((x) => x.object === find(s, 'Test Throne', 'battlefield', 'p1') && x.isMana === true);
  return a === undefined ? s : settle(act(s, a.action));
};

describe('CR 106.6, 105.2: "Spend this mana only to cast monocolored spells of that color." (Throne of Eldraine)', () => {
  it('the card is fully automated', () => expect(full(THRONE), JSON.stringify(THRONE.automation)).toBe(true));
  const board = (): GameState => scenario([], { defs: THRONE_DEFS, p1: { hand: ['Test Red Bear', 'Test Green Bear', 'Test Gold Drake', 'Test Prism'], battlefield: ['Test Throne'] } });
  it('with red chosen, the four red mana cast the red creature only: not the green one, the red-green one or the colorless artifact', () => {
    const s = tapThrone(chosen(board(), 'red'));
    expect(castable(s, 'Test Red Bear')).toBe(true);
    expect(castable(s, 'Test Green Bear')).toBe(false);
    expect(castable(s, 'Test Gold Drake')).toBe(false); // multicolored (CR 105.2c)
    expect(castable(s, 'Test Prism')).toBe(false); // colorless
  });
  it('with green chosen it is the green creature', () => {
    const s = tapThrone(chosen(board(), 'green'));
    expect(castable(s, 'Test Green Bear')).toBe(true);
    expect(castable(s, 'Test Red Bear')).toBe(false);
  });
  it('negative: with no color chosen (the link is empty) the mana pays for nothing', () => {
    expect(castable(tapThrone(board()), 'Test Red Bear')).toBe(false);
  });
});

describe('CR 106.6, 602.2b: "Spend only mana of the chosen color to activate this ability."', () => {
  const deckOf = (lands: string[], color?: string): GameState => {
    const s = scenario(['Mountain', 'Forest'], { defs: THRONE_DEFS, p1: { battlefield: ['Test Throne', ...lands] } });
    return color === undefined ? s : chosen(s, color);
  };
  const activations = (s: GameState): number => legal(s, 'p1', 'activate').filter((a) => a.object === find(s, 'Test Throne', 'battlefield', 'p1') && !a.isMana).length;
  it('with red chosen, three Mountains pay the {3}', () => {
    const s = deckOf(['Mountain', 'Mountain', 'Mountain'], 'red');
    expect(activations(s)).toBe(1);
    const a = legal(s, 'p1', 'activate').find((x) => x.object === find(s, 'Test Throne', 'battlefield', 'p1') && !x.isMana)!;
    const t = resolveAll(settle(act(s, a.action)));
    expect(t.zones.hand.p1!.length).toBe(2);
  });
  it('negative: with red chosen, three Forests (mana of another color) cannot pay it', () => {
    expect(activations(deckOf(['Forest', 'Forest', 'Forest'], 'red'))).toBe(0);
  });
  it('negative: two Mountains and a Forest cannot pay it either (every mana spent must be red)', () => {
    expect(activations(deckOf(['Mountain', 'Mountain', 'Forest'], 'red'))).toBe(0);
  });
  it('negative: with no color chosen the ability is not offered', () => {
    expect(activations(deckOf(['Mountain', 'Mountain', 'Mountain']))).toBe(0);
  });
});

describe('CR 601.2f-h, 106.6: "Spend only mana of the chosen color" covers the total cost, after the cost changes of other objects', () => {
  const TAX = card('Test Tax', 'Enchantment', 'As this enchantment enters, choose any card name.\nActivated abilities of sources with the chosen name cost {1} more to activate.');
  const BOON = card('Test Boon', 'Enchantment', 'Activated abilities of artifacts you control cost {2} less to activate.');
  const mk = (extra: string, lands: string[]): GameState => {
    const s = scenario(['Mountain', 'Forest'], { defs: [...THRONE_DEFS, TAX, BOON], p1: { battlefield: ['Test Throne', extra, ...lands] } });
    const t = chosen(s, 'red');
    if (extra === 'Test Tax') t.objects[find(t, 'Test Tax', 'battlefield', 'p1')]!.links = { cardName: { values: ['Test Throne'] } };
    return t;
  };
  const activations = (s: GameState): number => legal(s, 'p1', 'activate').filter((a) => a.object === find(s, 'Test Throne', 'battlefield', 'p1') && !a.isMana).length;
  it('the cards are automated', () => {
    expect(full(TAX), JSON.stringify(TAX.automation)).toBe(true);
    expect(full(BOON), JSON.stringify(BOON.automation)).toBe(true);
  });
  it('a {1} increase is red mana too: three Mountains and a Forest do not pay {3}+{1}; four Mountains do', () => {
    expect(activations(mk('Test Tax', ['Mountain', 'Mountain', 'Mountain', 'Forest']))).toBe(0);
    expect(activations(mk('Test Tax', ['Mountain', 'Mountain', 'Mountain', 'Mountain']))).toBe(1);
  });
  it('a {2} reduction leaves {1}: one Mountain pays it, a Forest does not, and only one Mountain is tapped', () => {
    expect(activations(mk('Test Boon', ['Forest']))).toBe(0);
    const s = mk('Test Boon', ['Mountain', 'Mountain', 'Mountain']);
    expect(activations(s)).toBe(1);
    const t = resolveAll(settle(act(s, legal(s, 'p1', 'activate').find((x) => x.object === find(s, 'Test Throne', 'battlefield', 'p1') && !x.isMana)!.action)));
    expect(findAll(t, 'Mountain', 'battlefield', 'p1').filter((id) => t.objects[id]!.tapped).length).toBe(1);
  });
});
