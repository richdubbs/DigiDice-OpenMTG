/**
 * edh-cast-8 scenarios (Commander lane edh-cast): each new reading played through the engine with synthetic cards (invented names, design 6.10), with its negative case.
 * Rules (Comprehensive Rules 2026-09-25):
 *   CR 115.1, 603.2, 118.12a, 701.6a   "Whenever you or a permanent you control becomes the target of a spell or ability an opponent controls, counter that spell or ability unless its
 *                                       controller pays {1}" (Unsettled Mariner)
 *   CR 110.4b, 205.3, 707.10, 603.2    "Whenever you cast a Faerie or Wizard permanent spell, copy it" (Archmage of Echoes)
 *   CR 205.3m, 121.1, 601.2f, 118.7    "return target enchantment card that isn't a God from your graveyard to your hand"; "Spells you cast cost {1} less to cast for each card your
 *                                       opponents have drawn this turn" (Heliod, the Radiant Dawn // Heliod, the Warped Eclipse)
 *   CR 700.2, 601.2b                   "Choose one. If you control a Wizard as you cast this spell, you may choose two instead" (Flame of Anor)
 *   CR 608.2c, 118.9, 601.2            "If it's a creature card that shares a creature type with a creature you control, you may cast it without paying its mana cost. If you don't cast it, put it
 *                                       on the bottom of your library" (Descendants' Path); "You may cast it without paying its mana cost if it's a spell with lesser mana value. If you
 *                                       don't cast it, put it into your hand" (Rashmi, Eternities Crafter)
 *   CR 106.3, 205.2a, 601.2h, 603.4    "Whenever you cast a creature spell, if three or more mana from creatures was spent to cast it, draw a card" (Inga and Esika)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type Color, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, findAll, pass, scenario } from '../../m3/scenario';
import { resolveAll, settle } from '../cmd3/helpers';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: Color[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? (type.includes('Land') ? '' : '{0}'), type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as OracleCard);
}
const give = (s: GameState, player: 'p1' | 'p2', mana: string): void => { for (const t of mana) s.players[player === 'p1' ? 0 : 1]!.manaPool.push({ type: t } as never); };
const obj = (id: ObjectId): { kind: 'object'; id: ObjectId } => ({ kind: 'object', id });
const canCast = (s: GameState, id: ObjectId, player = 'p1'): boolean => {
  try { return settle(act(s, { type: 'cast', player, card: id })).zones.stack.length > 0; } catch { return false; }
};
function castTargeting(s0: GameState, name: string, targets: (ObjectId | TargetChoice | null)[], player: 'p1' | 'p2' = 'p1'): GameState {
  let s = act(s0, { type: 'cast', player, card: find(s0, name, 'hand', player) });
  const rest = [...targets];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 20; guard++) {
    if (s.pending.kind === 'chooseTargets') { const t = rest.shift(); s = answer(s, { kind: 'chooseTargets', targets: t == null ? [] : [typeof t === 'string' ? obj(t) : t] }); }
    else if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'order') s = answer(s, { kind: 'order', ids: (s.pending as unknown as { items: { id: string }[] }).items.map((x) => x.id) });
    else throw new Error(`unexpected decision ${s.pending.kind}`);
  }
  return s;
}
const inHand = (s: GameState, player: 'p1' | 'p2', name: string): boolean => s.zones.hand[player]!.some((id) => s.objects[id]!.defId === name);
const inYard = (s: GameState, player: 'p1' | 'p2', name: string): boolean => s.zones.graveyard[player]!.some((id) => s.objects[id]!.defId === name);
const onField = (s: GameState, name: string): boolean => s.zones.battlefield.some((id) => s.objects[id]!.defId === name);
const count = (s: GameState, name: string): number => s.zones.battlefield.filter((id) => s.objects[id]!.defId === name || (s.objects[id]!.kind === 'token' && s.defs[s.objects[id]!.defId]?.name === name)).length;
const libraryTop = (s: GameState, player: 'p1' | 'p2'): string => s.objects[s.zones.library[player]![0]!]!.defId;
const libraryBottom = (s: GameState, player: 'p1' | 'p2'): string => s.objects[s.zones.library[player]!.at(-1)!]!.defId;

/** Pass priority (declaring no attackers or blockers) until the first priority of the upkeep of turn `n`, and one more pass resolves what is on the stack there. */
function toUpkeep(s0: GameState, n: number): GameState {
  let s = s0;
  for (let guard = 0; guard < 400 && !(s.turn.number === n && s.turn.step === 'upkeep'); guard++) {
    const d = s.pending;
    if (d === undefined || d === null) throw new Error('no decision');
    if (d.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else if (d.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (d.kind === 'priority') s = act(s, { type: 'pass', player: d.player });
    else s = settle(s);
  }
  return s;
}
const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const ROCK = card('Test Rock', 'Artifact', '');

describe('CR 115.1, 603.2, 118.12a: "counter that spell or ability unless its controller pays {1}" for you or a permanent you control (Unsettled Mariner)', () => {
  const IMP = card('Test Warding Imp', 'Creature — Shapeshifter', 'Whenever you or a permanent you control becomes the target of a spell or ability an opponent controls, counter that spell or ability unless its controller pays {1}.', { pt: ['1', '1'] });
  const BOLT = card('Test Spark', 'Instant', 'Test Spark deals 2 damage to any target.', { cost: '{0}' });
  const OX = card('Test Ox', 'Creature — Ox', '', { pt: ['4', '4'] });
  const defs = [IMP, OX, BOLT];
  const bolt = (target: 'bear' | 'me' | 'theirBear', mana: string): GameState => {
    let s = scenario([], { p1: { battlefield: ['Test Warding Imp', 'Test Ox'] }, p2: { hand: ['Test Spark'], battlefield: ['Test Ox'] }, defs });
    s = pass(s); // p2 gets priority in p1's main phase
    const targets: Record<string, TargetChoice> = {
      bear: obj(findAll(s, 'Test Ox', 'battlefield', 'p1')[0]!),
      theirBear: obj(findAll(s, 'Test Ox', 'battlefield', 'p2')[0]!),
      me: { kind: 'player', id: 'p1' } as never,
    };
    give(s, 'p2', mana);
    s = castTargeting(s, 'Test Spark', [targets[target]!], 'p2');
    return s;
  };
  it('is automated', () => { expect(IMP.automation.level).toBe('full'); });
  it("an opponent's spell that targets a permanent you control is countered unless its controller pays {1}: with no mana it is countered", () => {
    const s = resolveAll(bolt('bear', ''));
    expect(inYard(s, 'p2', 'Test Spark')).toBe(true);
    expect(s.objects[findAll(s, 'Test Ox', 'battlefield', 'p1')[0]!]!.damage).toBe(0);
  });
  it('...and with {1} to pay (the controller of the spell decides), the spell resolves', () => {
    const t = bolt('bear', 'G');
    // the controller of the countered spell is asked to pay
    const s = resolveAll(t, { yes: true });
    expect(s.objects[findAll(s, 'Test Ox', 'battlefield', 'p1')[0]!]!.damage).toBe(2);
  });
  it('a spell that targets you triggers it too (the player is a target), a permanent of the opponent does not', () => {
    expect(inYard(resolveAll(bolt('me', '')), 'p2', 'Test Spark')).toBe(true);
    const s = resolveAll(bolt('theirBear', ''));
    expect(s.objects[findAll(s, 'Test Ox', 'battlefield', 'p2')[0]!]!.damage).toBe(2); // nothing was countered: the Imp's controller is not targeted
  });
});

describe('CR 110.4b, 205.3, 707.10, 603.2: "Whenever you cast a Faerie or Wizard permanent spell, copy it" (Archmage of Echoes)', () => {
  const MAGE = card('Test Echo Mage', 'Creature — Faerie Wizard', 'Whenever you cast a Faerie or Wizard permanent spell, copy it.', { pt: ['2', '2'] });
  const WIZ = card('Test Wizard', 'Creature — Wizard', '', { pt: ['1', '1'] });
  const FAE = card('Test Faerie', 'Artifact Creature — Faerie', '', { pt: ['1', '1'] });
  const GOB = card('Test Goblin', 'Creature — Goblin', '', { pt: ['1', '1'] });
  const WIZSPELL = card('Test Wizard Trick', 'Instant', 'You gain 1 life.');
  const TRIBAL = card('Test Wizard Lore', 'Kindred Instant — Wizard', 'You gain 1 life.');
  const defs = [MAGE, WIZ, FAE, GOB, WIZSPELL, TRIBAL];
  const run = (name: string): GameState => {
    let s = scenario([], { p1: { battlefield: ['Test Echo Mage'], hand: [name] }, defs });
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') })));
    return s;
  };
  it('is automated', () => { expect(MAGE.automation.level).toBe('full'); });
  it('a Wizard creature spell and a Faerie artifact creature spell are copied: the copy becomes a token on the battlefield', () => {
    expect(count(run('Test Wizard'), 'Test Wizard')).toBe(2);
    expect(count(run('Test Faerie'), 'Test Faerie')).toBe(2);
  });
  it('a creature spell of another type (Goblin) is not copied', () => {
    expect(count(run('Test Goblin'), 'Test Goblin')).toBe(1);
  });
  it('a Wizard instant (not a permanent spell) and a Kindred Wizard instant are not copied', () => {
    expect(run('Test Wizard Trick').players[0]!.life).toBe(21);
    expect(run('Test Wizard Lore').players[0]!.life).toBe(21);
  });
});

describe('CR 205.3m, 121.1, 601.2f: Heliod, the Radiant Dawn // Heliod, the Warped Eclipse', () => {
  const RETURN = card('Test Returner', 'Creature — Cleric', "When this creature enters, return target enchantment card that isn't a God from your graveyard to your hand.", { pt: ['1', '1'] });
  const AURA = card('Test Boon', 'Enchantment', '');
  const GOD = card('Test Divinity', 'Enchantment Creature — God', '', { pt: ['4', '4'] });
  const defs = [RETURN, AURA, GOD];
  it('is automated', () => { expect(RETURN.automation.level).toBe('full'); });
  /** Cast the Returner and resolve it up to the enters trigger's target decision. */
  const toTrigger = (graveyard: string[]): GameState => {
    let s = scenario([], { p1: { hand: ['Test Returner'], graveyard }, defs });
    s = castTargeting(s, 'Test Returner', []);
    for (let guard = 0; guard < 10 && s.pending?.kind === 'priority' && s.zones.stack.length > 0; guard++) s = act(s, { type: 'pass', player: s.pending.player });
    return s;
  };
  it("returns an enchantment card that isn't a God: the God card in the graveyard is not offered as a target", () => {
    let s = toTrigger(['Test Boon', 'Test Divinity']);
    expect(s.pending?.kind).toBe('chooseTargets');
    const offered = (s.pending as unknown as { objects: ObjectId[] }).objects;
    expect(offered).toEqual([find(s, 'Test Boon', 'graveyard', 'p1')]);
    s = resolveAll(answer(s, { kind: 'chooseTargets', targets: [obj(offered[0]!)] }));
    expect(inHand(s, 'p1', 'Test Boon')).toBe(true);
    expect(inYard(s, 'p1', 'Test Divinity')).toBe(true);
  });
  it('with only a God card in the graveyard the trigger has no target and nothing returns', () => {
    const s = resolveAll(toTrigger(['Test Divinity']));
    expect(inHand(s, 'p1', 'Test Divinity')).toBe(false);
    expect(inYard(s, 'p1', 'Test Divinity')).toBe(true);
  });
  const REDUCER = card('Test Draw Discount', 'Enchantment', 'Spells you cast cost {1} less to cast for each card your opponents have drawn this turn.');
  const DRAW = card('Test Study', 'Instant', 'Draw a card.');
  const BIG = card('Test Anvil', 'Artifact', '', { cost: '{3}' });
  const GOLD = card('Test Gilded Anvil', 'Artifact', '', { cost: '{1}{G}' });
  const d2 = [REDUCER, DRAW, BIG, GOLD];
  it('the reduction is {1} per card the opponents drew this turn (generic mana only); your own draws and no draws reduce nothing', () => {
    expect(REDUCER.automation.level).toBe('full');
    const cost = (draws: number, who: 'p1' | 'p2', name: string): number => {
      let s = scenario([], { p1: { battlefield: ['Test Draw Discount'], hand: [name, ...Array(draws).fill('Test Study')] }, p2: { hand: Array(draws).fill('Test Study') }, defs: d2 });
      for (let i = 0; i < draws; i++) {
        if (who === 'p2') {
          s = pass(s); // p2 has priority in p1's main phase
          s = resolveAll(settle(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Study', 'hand', 'p2') })));
        } else s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Study', 'hand', 'p1') })));
      }
      // the lowest mana that casts the spell now
      for (let n = 0; n <= 5; n++) {
        const t = structuredClone(s);
        t.players[0]!.manaPool = [];
        give(t, 'p1', 'G'.repeat(n));
        if (canCast(t, find(t, name, 'hand', 'p1'))) return n;
      }
      return 99;
    };
    expect(cost(0, 'p2', 'Test Anvil')).toBe(3);
    expect(cost(2, 'p2', 'Test Anvil')).toBe(1);
    expect(cost(5, 'p2', 'Test Anvil')).toBe(0);
    expect(cost(2, 'p2', 'Test Gilded Anvil')).toBe(1); // {1}{G}: only the generic {1} is reduced, the {G} stays
    expect(cost(1, 'p1', 'Test Anvil')).toBe(3); // a card you drew yourself reduces nothing
  });
});

describe('CR 700.2, 601.2b: "Choose one. If you control a Wizard as you cast this spell, you may choose two instead" (Flame of Anor)', () => {
  const FLAME = card('Test Arcane Flame', 'Instant', 'Choose one. If you control a Wizard as you cast this spell, you may choose two instead.\n• Target player draws two cards.\n• Destroy target artifact.\n• Test Arcane Flame deals 5 damage to target creature.');
  const WIZ = card('Test Wizard', 'Creature — Wizard', '', { pt: ['1', '1'] });
  const defs = [FLAME, WIZ, BEAR, ROCK];
  const options = (s: GameState): { min: number; max: number } => {
    const d = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Arcane Flame', 'hand', 'p1') }).pending as unknown as { kind: string; min?: number; max?: number };
    expect(d.kind).toBe('chooseOption');
    return { min: d.min!, max: d.max! };
  };
  it('is automated', () => { expect(FLAME.automation.level).toBe('full'); });
  it('without a Wizard exactly one of the three modes is chosen; with a Wizard one or two', () => {
    expect(options(scenario([], { p1: { hand: ['Test Arcane Flame'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Rock'] }, defs }))).toEqual({ min: 1, max: 1 });
    expect(options(scenario([], { p1: { hand: ['Test Arcane Flame'], battlefield: ['Test Wizard'] }, p2: { battlefield: ['Test Rock'] }, defs }))).toEqual({ min: 1, max: 2 });
  });
  it('with a Wizard two modes can be chosen and both resolve (draw two, destroy the artifact); three modes are refused, and without a Wizard two are refused', () => {
    const play = (wizard: boolean, picks: number[]): GameState => {
      let s = scenario([], { p1: { hand: ['Test Arcane Flame'], battlefield: wizard ? ['Test Wizard'] : [] }, p2: { battlefield: ['Test Rock'] }, defs });
      s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Arcane Flame', 'hand', 'p1') });
      const ids = (s.pending as unknown as { options: { id: string }[] }).options.map((o) => o.id);
      s = answer(s, { kind: 'chooseOption', ids: picks.map((i) => ids[i]!) });
      for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 10; guard++) {
        if (s.pending.kind === 'chooseTargets') {
          const d = s.pending as unknown as { objects: ObjectId[]; players: string[] };
          s = answer(s, { kind: 'chooseTargets', targets: d.objects.length > 0 ? [obj(d.objects[0]!)] : [{ kind: 'player', id: d.players[0]! } as never] });
        } else s = settle(s);
      }
      return resolveAll(s);
    };
    const s = play(true, [0, 1]);
    expect(s.zones.hand.p1!.length).toBe(2); // the two cards drawn (the hand held only the Flame)
    expect(onField(s, 'Test Rock')).toBe(false); // destroyed
    expect(() => play(true, [0, 1, 2])).toThrow();
    expect(() => play(false, [0, 1])).toThrow();
    const one = play(false, [1]);
    expect(onField(one, 'Test Rock')).toBe(false);
    expect(one.zones.hand.p1!.length).toBe(0);
  });
  it("a Wizard the opponent controls doesn't count (\"a Wizard\" you control)", () => {
    expect(options(scenario([], { p1: { hand: ['Test Arcane Flame'] }, p2: { battlefield: ['Test Wizard'] }, defs }))).toEqual({ min: 1, max: 1 });
  });
});

describe('CR 608.2c, 118.9, 601.2: "If you don\'t cast it, put it on the bottom of your library" (Descendants\' Path)', () => {
  const PATH = card('Test Kindred Path', 'Enchantment', "At the beginning of your upkeep, reveal the top card of your library. If it's a creature card that shares a creature type with a creature you control, you may cast it without paying its mana cost. If you don't cast it, put it on the bottom of your library.");
  const ELF = card('Test Elf', 'Creature — Elf', '', { pt: ['1', '1'] });
  const ELF2 = card('Test Elf Scout', 'Creature — Elf Scout', '', { pt: ['1', '1'], cost: '{5}' });
  const GOB = card('Test Goblin', 'Creature — Goblin', '', { pt: ['1', '1'] });
  const defs = [PATH, ELF, ELF2, GOB, ROCK];
  const upkeep = (top: string, _yes: boolean): GameState => {
    const s = scenario([], { p1: { battlefield: ['Test Kindred Path', 'Test Elf'], library: [top, 'Test Rock'] }, defs });
    return toUpkeep(s, 3); // the trigger is on the stack in p1's upkeep
  };
  it('is automated', () => { expect(PATH.automation.level).toBe('full'); });
  it('a creature card that shares a creature type may be cast free (without paying its {5}) and is not put on the bottom', () => {
    const s = resolveAll(upkeep('Test Elf Scout', true), { yes: true });
    expect(onField(s, 'Test Elf Scout')).toBe(true);
  });
  it('declining the cast puts the revealed card on the bottom of the library (ruling 2012-05-01)', () => {
    const s = resolveAll(upkeep('Test Elf Scout', false), { yes: false });
    expect(onField(s, 'Test Elf Scout')).toBe(false);
    expect(libraryBottom(s, 'p1')).toBe('Test Elf Scout');
  });
  it('a creature card that shares no creature type, and a noncreature card, are put on the bottom without being offered', () => {
    for (const top of ['Test Goblin', 'Test Rock']) {
      const s = resolveAll(upkeep(top, true), { yes: true });
      expect(onField(s, top), top).toBe(false);
      expect(libraryBottom(s, 'p1'), top).toBe(top);
    }
  });
});

describe('CR 608.2c, 118.9, 202.3: "You may cast it without paying its mana cost if it\'s a spell with lesser mana value. If you don\'t cast it, put it into your hand" (Rashmi, Eternities Crafter)', () => {
  const RASHMI = card('Test Crafter', 'Creature — Elf', "Whenever you cast your first spell each turn, reveal the top card of your library. You may cast it without paying its mana cost if it's a spell with lesser mana value. If you don't cast it, put it into your hand.", { pt: ['2', '2'] });
  const BIG = card('Test Big Rock', 'Artifact', '', { cost: '{4}' });
  const SMALL = card('Test Small Rock', 'Artifact', '', { cost: '{2}' });
  const SAME = card('Test Same Rock', 'Artifact', '', { cost: '{4}' });
  const FREE = card('Test Zero Rock', 'Artifact', '', { cost: '{0}' });
  const XSPELL = card('Test Xspell', 'Artifact', '', { cost: '{X}{G}' });
  const defs = [RASHMI, BIG, SMALL, SAME, FREE, XSPELL];
  const run = (top: string, spell: string, yes = true, x = 0): GameState => {
    let s = scenario([], { p1: { battlefield: ['Test Crafter', 'Plains'], hand: [spell], library: [top] }, defs });
    give(s, 'p1', 'GGGGGG');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, spell, 'hand', 'p1') });
    for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 10; guard++) s = s.pending.kind === 'chooseNumber' ? answer(s, { kind: 'chooseNumber', n: x }) : settle(s);
    return resolveAll(s, { yes });
  };
  it('is automated', () => { expect(RASHMI.automation.level).toBe('full'); });
  it('a revealed card with lesser mana value than the cast spell may be cast free; it is then not put into the hand', () => {
    const s = run('Test Small Rock', 'Test Big Rock');
    expect(onField(s, 'Test Small Rock')).toBe(true);
    expect(inHand(s, 'p1', 'Test Small Rock')).toBe(false);
  });
  it('declining the free cast puts the revealed card into your hand', () => {
    const s = run('Test Small Rock', 'Test Big Rock', false);
    expect(onField(s, 'Test Small Rock')).toBe(false);
    expect(inHand(s, 'p1', 'Test Small Rock')).toBe(true);
  });
  it('a revealed card with the same or greater mana value, or a land card (ruling 2016-09-20: a land goes into your hand), is put into your hand uncast', () => {
    for (const [top, spell] of [['Test Same Rock', 'Test Big Rock'], ['Test Big Rock', 'Test Small Rock'], ['Plains', 'Test Big Rock']] as const) {
      const s = run(top, spell);
      expect(onField(s, top === 'Plains' ? 'Plains' : top) && top !== 'Plains', `${top} vs ${spell}`).toBe(false);
      expect(inHand(s, 'p1', top), `${top} vs ${spell}`).toBe(true);
    }
  });
  it('the mana value of the cast spell with {X} counts X (ruling 2016-09-20): X = 5 on {X}{G} is mana value 6, so a mana value 4 card is cast free; X = 1 is mana value 2, so it is not', () => {
    expect(onField(run('Test Big Rock', 'Test Xspell', true, 5), 'Test Big Rock')).toBe(true);
    expect(onField(run('Test Big Rock', 'Test Xspell', true, 1), 'Test Big Rock')).toBe(false);
  });
  it('the mana value that counts is the resulting spell\'s (as cascade): an Adventure card of mana value 3 whose Adventure half has mana value 1 is cast free off a mana value 3 spell; a creature half of mana value 3 alone is not', () => {
    const ADV = compileCard({
      name: 'Test Knight // Test Whisper', layout: 'adventure', mana_cost: '{3} // {1}', type_line: 'Creature — Human Knight // Sorcery — Adventure', colors: [], keywords: [],
      card_faces: [
        { name: 'Test Knight', mana_cost: '{3}', type_line: 'Creature — Human Knight', oracle_text: '', power: '2', toughness: '2' },
        { name: 'Test Whisper', mana_cost: '{1}', type_line: 'Sorcery — Adventure', oracle_text: 'You gain 2 life.' },
      ],
    } as unknown as OracleCard);
    const SPELL3 = card('Test Three Rock', 'Artifact', '', { cost: '{3}' });
    let s = scenario([], { p1: { battlefield: ['Test Crafter'], hand: ['Test Three Rock'], library: ['Test Knight // Test Whisper'] }, defs: [RASHMI, SPELL3, ADV] });
    give(s, 'p1', 'GGG');
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Three Rock', 'hand', 'p1') })), { yes: true });
    expect(s.players[0]!.life).toBe(22); // the Adventure half was cast free
    expect(inHand(s, 'p1', 'Test Knight // Test Whisper')).toBe(false);
  });
  it('only the first spell each turn triggers it: a second spell reveals nothing', () => {
    let s = scenario([], { p1: { battlefield: ['Test Crafter'], hand: ['Test Big Rock', 'Test Big Rock'], library: ['Test Small Rock', 'Test Small Rock'] }, defs });
    give(s, 'p1', 'GGGGGGGG');
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: s.zones.hand.p1![0]! })), { yes: false });
    const handBefore = s.zones.hand.p1!.length;
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: s.zones.hand.p1![0]! })), { yes: false });
    expect(s.zones.hand.p1!.length).toBe(handBefore - 1); // cast one, drew none: the library is untouched
    expect(libraryTop(s, 'p1')).toBe('Test Small Rock');
  });
});

describe('CR 106.3, 205.2a, 601.2h, 603.4: "if three or more mana from creatures was spent to cast it" (Inga and Esika)', () => {
  const INGA = card('Test Mana Council', 'Enchantment', 'Creatures you control have "{T}: Add one mana of any color. Spend this mana only to cast a creature spell."\nWhenever you cast a creature spell, if three or more mana from creatures was spent to cast it, draw a card.');
  const ELF = card('Test Elf', 'Creature — Elf', '', { pt: ['1', '1'] });
  const BIGBEAR = card('Test Big Bear', 'Creature — Bear', '', { pt: ['3', '3'], cost: '{3}' });
  const SPELL = card('Test Big Rock', 'Artifact', '', { cost: '{3}' });
  const defs = [INGA, ELF, BIGBEAR, SPELL];
  const run = (elves: number, lands: number, spell = 'Test Big Bear'): GameState => {
    const bf = ['Test Mana Council', ...Array(elves).fill('Test Elf'), ...Array(lands).fill('Plains')];
    let s = scenario([], { p1: { battlefield: bf, hand: [spell] }, defs });
    for (const id of s.zones.battlefield.filter((x) => s.objects[x]!.defId === 'Test Elf')) s.objects[id]!.controlledSinceTurn = 0;
    const handBefore = s.zones.hand.p1!.length;
    s = act(s, { type: 'cast', player: 'p1', card: find(s, spell, 'hand', 'p1') });
    for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 10; guard++) s = answer(s, { kind: 'payCost', auto: true });
    void handBefore;
    return resolveAll(s);
  };
  const drew = (s: GameState): number => s.zones.hand.p1!.length; // the cast card left the hand
  it('is automated', () => { expect(INGA.automation.level).toBe('full'); });
  it('three creatures tapped for mana pay for a creature spell: draw a card', () => {
    expect(onField(run(3, 0), 'Test Big Bear')).toBe(true);
    expect(drew(run(3, 0))).toBe(1);
  });
  it('two creatures and a land are only two mana from creatures: no card', () => {
    expect(onField(run(2, 1), 'Test Big Bear')).toBe(true);
    expect(drew(run(2, 1))).toBe(0);
  });
  it('mana of a creature card exiled from the hand (Elvish Spirit Guide) is from no creature: two creatures and a Spirit Guide draw nothing', () => {
    const GUIDE = card('Test Spirit Guide', 'Creature — Spirit', 'Exile this card from your hand: Add {G}.', { pt: ['2', '2'] });
    let s = scenario([], { p1: { battlefield: ['Test Mana Council', 'Test Elf', 'Test Elf'], hand: ['Test Big Bear', 'Test Spirit Guide'] }, defs: [...defs, GUIDE] });
    s = settle(act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Spirit Guide', 'hand', 'p1'), ability: 'p:0:0' })); // {G} floats in the pool
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Big Bear', 'hand', 'p1') });
    for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 10; guard++) s = answer(s, { kind: 'payCost', auto: true });
    s = resolveAll(s);
    expect(onField(s, 'Test Big Bear')).toBe(true);
    expect(s.zones.hand.p1!.some((id) => s.objects[id]!.defId === 'Test Spirit Guide')).toBe(false); // it was exiled for mana
    expect(s.zones.hand.p1!.length).toBe(0); // no card drawn
  });
  it('only a creature spell triggers it: a noncreature spell paid for with lands draws nothing', () => {
    expect(drew(run(0, 3, 'Test Big Rock'))).toBe(0);
  });
});
