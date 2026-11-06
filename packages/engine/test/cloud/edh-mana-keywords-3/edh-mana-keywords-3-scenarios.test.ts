/**
 * Commander lane edh-mana-keywords, round edh-mana-keywords-3: scenarios with synthetic cards (invented names, design 6.10), compiled by the default compiler.
 * CR cites are from the Comprehensive Rules 2026-09-25 as read from memory in a cloud session (unverified, listed in the record).
 *
 *   CR 601.2g-h, 605.3a-b, 106.7   the automatic payment and the castability check use mana abilities whose types come from the game state: "one mana of any
 *                                  color among legendary creatures you control" (Mox Amber), "one mana of any type that a land you control could produce"
 *                                  (Reflecting Pool), "one mana of any of the exiled card's colors" (Chrome Mox)
 *   CR 706.3a                      a die-roll result row with an "Otherwise" rider of its own, and a flavor word after the result (Treasure Chest)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type Color, type GameState, type OracleCard } from '../../../src/index';
import { act, answer, find, legal, life, passBoth, pool, reject, scenario } from '../../m3/scenario';
import { activatedAbilities, legalActions, type ObjectId, type TargetChoice } from '../../../src/index';
import { Game } from '../../../src/core/game';
import { activateManaAbility } from '../../../src/rules/mana';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: Color[]; supertypes?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}

const AMBER = card('Test Amber', 'Artifact', '{T}: Add one mana of any color among legendary creatures and planeswalkers you control.', { cost: '{0}' });
const POOL = card('Test Reflector', 'Land', '{T}: Add one mana of any type that a land you control could produce.');
const KING = card('Test King', 'Legendary Creature — Human Noble', '', { cost: '{R}{G}', colors: ['R', 'G'], pt: ['2', '2'] });
const COMMONER = card('Test Commoner', 'Creature — Human', '', { cost: '{R}', colors: ['R'], pt: ['1', '1'] });
const RED = card('Test Bolt', 'Instant', 'Draw a card.', { cost: '{R}', colors: ['R'] });
const GREEN = card('Test Growth', 'Instant', 'Draw a card.', { cost: '{G}', colors: ['G'] });
const BIG = card('Test Titan', 'Sorcery', 'Draw a card.', { cost: '{R}{G}', colors: ['R', 'G'] });
const TWIN = card('Test Twin', 'Instant', 'Draw a card.', { cost: '{G}{G}', colors: ['G'] });
const TRIPLE = card('Test Triple', 'Sorcery', 'Draw a card.', { cost: '{R}{G}{G}', colors: ['R', 'G'] });
const VESSEL = card('Test Vessel', 'Artifact', '{T}: Add two mana of different colors.');
const DEFS = [VESSEL, AMBER, POOL, KING, COMMONER, RED, GREEN, BIG, TWIN, TRIPLE];

/** Start casting a p1 card: the state at its payCost decision. */
function toPayment(s: GameState, name: string): GameState {
  const t = act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') });
  expect(t.pending?.kind).toBe('payCost');
  return t;
}
const autoPayable = (s: GameState): boolean => (s.pending as unknown as { autoPayable: boolean }).autoPayable;
const unpayable = (s: GameState, name: string): string => reject(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }).message;
const onStack = (s: GameState, name: string): boolean => s.zones.stack.some((id) => s.defs[s.objects[id]!.defId]!.name === name);

describe('CR 601.2g-h, 605.3b: the automatic payment uses "one mana of any color among legendary creatures you control"', () => {
  it('a red-green legend and the Amber pay {R} automatically (no tap by hand first), the Amber tapped, nothing left floating', () => {
    const s = scenario([], { p1: { hand: ['Test Bolt'], battlefield: ['Test Amber', 'Test King'] }, defs: DEFS });
    const pay = toPayment(s, 'Test Bolt');
    expect(autoPayable(pay)).toBe(true);
    const t = answer(pay, { kind: 'payCost', auto: true });
    expect(onStack(t, 'Test Bolt')).toBe(true);
    expect(t.objects[find(t, 'Test Amber', 'battlefield')]!.tapped).toBe(true);
    expect(pool(t, 'p1')).toBe('');
  });
  it('the same Amber pays {G} too: the legend is red and green', () => {
    const s = scenario([], { p1: { hand: ['Test Growth'], battlefield: ['Test Amber', 'Test King'] }, defs: DEFS });
    const t = answer(toPayment(s, 'Test Growth'), { kind: 'payCost', auto: true });
    expect(onStack(t, 'Test Growth')).toBe(true);
  });
  it('negative: with no legendary creature the Amber adds nothing, so a spell that needs it can\'t be cast', () => {
    const s = scenario([], { p1: { hand: ['Test Bolt'], battlefield: ['Test Amber', 'Test Commoner'] }, defs: DEFS });
    expect(unpayable(s, 'Test Bolt')).toMatch(/can't pay/);
  });
  it('negative: one Amber makes one mana, so {R}{G} is not payable with it alone', () => {
    const s = scenario([], { p1: { hand: ['Test Titan'], battlefield: ['Test Amber', 'Test King'] }, defs: DEFS });
    expect(unpayable(s, 'Test Titan')).toMatch(/can't pay/);
  });
});

describe('CR 106.7, 601.2g-h: the automatic payment uses "one mana of any type that a land you control could produce"', () => {
  it('a Forest and the Reflector pay {G}{G}: the Reflector makes the second {G} because of the Forest', () => {
    const s = scenario(['Forest'], { p1: { hand: ['Test Twin'], battlefield: ['Test Reflector', 'Forest'] }, defs: DEFS });
    const pay = toPayment(s, 'Test Twin');
    expect(autoPayable(pay)).toBe(true);
    const t = answer(pay, { kind: 'payCost', auto: true });
    expect(onStack(t, 'Test Twin')).toBe(true);
    expect(pool(t, 'p1')).toBe('');
  });
  it('a Mountain, a Forest and the Reflector pay {R}{G}{G} together', () => {
    const s = scenario(['Forest', 'Mountain'], { p1: { hand: ['Test Triple'], battlefield: ['Test Reflector', 'Forest', 'Mountain'] }, defs: DEFS });
    const t = answer(toPayment(s, 'Test Triple'), { kind: 'payCost', auto: true });
    expect(onStack(t, 'Test Triple')).toBe(true);
  });
  it('negative: the Reflector alone (no other land) makes nothing, so it can\'t pay for anything', () => {
    const s = scenario([], { p1: { hand: ['Test Growth'], battlefield: ['Test Reflector'] }, defs: DEFS });
    expect(unpayable(s, 'Test Growth')).toMatch(/can't pay/);
  });
  it('negative: a Forest and the Reflector can\'t pay {R}{G}{G}: one {G} source twice, no red anywhere', () => {
    const s = scenario(['Forest'], { p1: { hand: ['Test Triple'], battlefield: ['Test Reflector', 'Forest'] }, defs: DEFS });
    expect(unpayable(s, 'Test Triple')).toMatch(/can't pay/);
  });
  it('negative: a Forest and the Reflector can\'t pay {R}: nothing here could make red', () => {
    const s = scenario(['Forest'], { p1: { hand: ['Test Bolt'], battlefield: ['Test Reflector', 'Forest'] }, defs: DEFS });
    expect(unpayable(s, 'Test Bolt')).toMatch(/can't pay/);
  });
});

/** Activate `source`'s mana ability, answering each color question from `colors` in turn; the options of each question are returned. */
function tapFor(s0: GameState, source: ObjectId, colors: string[]): { s: GameState; asked: string[][] } {
  const a = legalActions(s0, 'p1').find((l) => l.kind === 'activate' && l.isMana === true && l.object === source);
  if (!a) throw new Error('not offered');
  const asked: string[][] = [];
  let s = act(s0, a.action);
  for (let guard = 0; guard < 10 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const d = s.pending as unknown as { kind: string; options?: string[] };
    if (d.kind !== 'chooseColor') throw new Error(`unexpected decision ${d.kind}`);
    asked.push([...(d.options ?? [])].sort());
    s = answer(s, { kind: 'chooseColor', color: colors[asked.length - 1] as never });
  }
  return { s, asked };
}

describe('CR 105.1, 105.4, 106.1: "Add two mana of different colors" (Firemind Vessel, Component Pouch)', () => {
  it('asks for the first color among five, then the second among the four left; the pool holds the two different colors', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Vessel'] }, defs: DEFS });
    const r = tapFor(s0, find(s0, 'Test Vessel', 'battlefield', 'p1'), ['R', 'G']);
    expect(r.asked).toEqual([['B', 'G', 'R', 'U', 'W'], ['B', 'G', 'U', 'W']]);
    expect(pool(r.s, 'p1')).toBe('GR');
  });
  it('negative: the first color is never offered again, and colorless is not a color of the choice', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Vessel'] }, defs: DEFS });
    const r = tapFor(s0, find(s0, 'Test Vessel', 'battlefield', 'p1'), ['W', 'U']);
    expect(r.asked[1]).not.toContain('W');
    expect(r.asked[0]).not.toContain('C');
    expect(pool(r.s, 'p1')).toBe('UW');
  });
  it('the two mana pay for a two-color spell; the Vessel is tapped', () => {
    const s0 = scenario([], { p1: { hand: ['Test Titan'], battlefield: ['Test Vessel'] }, defs: DEFS });
    const r = tapFor(s0, find(s0, 'Test Vessel', 'battlefield', 'p1'), ['R', 'G']);
    const t = answer(toPayment(r.s, 'Test Titan'), { kind: 'payCost', auto: true });
    expect(onStack(t, 'Test Titan')).toBe(true);
    expect(t.objects[find(t, 'Test Vessel', 'battlefield')]!.tapped).toBe(true);
  });
  it('negative: the automatic payment does not plan it (one choice across both units): the Vessel alone is not offered as a source', () => {
    const s0 = scenario([], { p1: { hand: ['Test Titan'], battlefield: ['Test Vessel'] }, defs: DEFS });
    expect(unpayable(s0, 'Test Titan')).toMatch(/can't pay/);
  });
});

/* ------------------------------------------------------------------------------------------------------------------------------------------------------ */
/* CR 706.3a: a die-roll table row with an "Otherwise" rider of its own, and a flavor word after the result                                                 */

const automatedDef = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const LOOKER = card('Test Looking Glass', 'Sorcery', "Roll a d20.\n1-9 | Look at the top card of your library. If it's a land card, put it onto the battlefield. Otherwise, put it into your hand.\n10-20 | Lucky Day -- You gain 2 life.");
const BAD_ROW = card('Test Bad Rows', 'Sorcery', 'Roll a d20.\n1-9 | You gain 1 life.\n10-20 | Otherwise, you lose 1 life.');
const rolled = (s: GameState): number => Number(/rolls a d20: (\d+)\./.exec(s.log.map((l) => l.text).find((t) => /rolls a d20/.test(t)) ?? '')?.[1]);

describe('CR 706.3a: a die-roll result row may hold an "Otherwise" sentence of its own and a flavor word', () => {
  it('is automated: the rows keep their own instructions, the flavor word is not an instruction', () => {
    expect(automatedDef(LOOKER)).toBe(true);
    const json = JSON.stringify(LOOKER.faces[0]!.abilities[0]);
    expect(json).toContain('"table":[{"min":1,"max":9,');
    expect(json).toContain('{"min":10,"max":20,"do":[{"op":"gainLife","who":{"ref":"you"},"amount":2}]}');
  });
  it('negative: an "Otherwise" that opens a row would patch the step of another row, so the card stays manual', () => {
    expect(automatedDef(BAD_ROW)).toBe(false);
  });
  it('"If it\'s a land card, you may put it onto the battlefield. Otherwise, put it into your hand." in a row: a land the player declines to put onto the battlefield goes to the hand (Treasure Chest ruling 2021-07-23: "otherwise" also covers declining; manual until edh-misc-4 made the lowering read it)', () => {
    const MAYBE = card('Test Maybe Glass', 'Sorcery', "Roll a d20.\n1-9 | Look at the top card of your library. If it's a land card, you may put it onto the battlefield. Otherwise, put it into your hand.\n10-20 | You gain 2 life.");
    expect(automatedDef(MAYBE)).toBe(true);
    for (const yes of [true, false]) {
      let low = 0;
      for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p']) {
        // the library is the Plains the scenario fills it with: the top card is a land
        const s0 = scenario(['Grizzly Bears'], { defs: [MAYBE], p1: { hand: ['Test Maybe Glass'] }, seed });
        let t = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Maybe Glass', 'hand', 'p1') });
        for (let guard = 0; t.pending && guard < 20; guard++) {
          if (t.pending.kind === 'payCost') t = answer(t, { kind: 'payCost', auto: true });
          else if (t.pending.kind === 'yesNo') t = answer(t, { kind: 'yesNo', yes });
          else if (t.pending.kind === 'priority') { if (t.zones.stack.length === 0) break; t = passBoth(t); }
          else break;
        }
        if (rolled(t) >= 10) continue;
        low++;
        const handUp = t.zones.hand['p1']!.length - s0.zones.hand['p1']!.length + 1; // the cast card left the hand
        const fieldUp = t.zones.battlefield.length - s0.zones.battlefield.length;
        expect([handUp, fieldUp], `${seed}, ${yes ? 'put' : 'declined'}`).toEqual(yes ? [0, 1] : [1, 0]);
      }
      expect(low).toBeGreaterThan(0);
    }
  });
  it('plays: the high rows gain 2 life; the low rows put a land onto the battlefield and any other card into the hand', () => {
    let low = 0, high = 0, lands = 0, others = 0;
    for (const [i, seed] of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p'].entries()) {
      // an odd seed starts with a Grizzly Bears on top of the library (index 0), an even one with the Plains the scenario fills it with
      const s0 = scenario(['Grizzly Bears'], { defs: [LOOKER], p1: { hand: ['Test Looking Glass'], ...(i % 2 === 1 ? { library: ['Grizzly Bears'] } : {}) }, seed });
      let t = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Looking Glass', 'hand', 'p1') });
      for (let guard = 0; t.pending && guard < 20; guard++) {
        if (t.pending.kind === 'payCost') t = answer(t, { kind: 'payCost', auto: true });
        else if (t.pending.kind === 'priority') { if (t.zones.stack.length === 0) break; t = passBoth(t); }
        else break;
      }
      const r = rolled(t);
      expect(r, seed).toBeGreaterThanOrEqual(1);
      if (r >= 10) {
        high++;
        expect(life(t, 'p1') - life(s0, 'p1'), seed).toBe(2);
      } else {
        low++;
        expect(life(t, 'p1'), seed).toBe(life(s0, 'p1'));
        const top = s0.zones.library['p1']![0]!;
        const topName = s0.defs[s0.objects[top]!.defId]!.name;
        const handUp = t.zones.hand['p1']!.length - s0.zones.hand['p1']!.length + 1; // the cast card left the hand
        const fieldUp = t.zones.battlefield.length - s0.zones.battlefield.length;
        const isLand = /^(Forest|Plains|Island|Swamp|Mountain)$/.test(topName);
        if (isLand) lands++; else others++;
        expect([handUp, fieldUp], `${seed}: ${topName}`).toEqual(isLand ? [0, 1] : [1, 0]); // a new object each time a card changes zone (CR 400.7)
      }
    }
    expect(low).toBeGreaterThan(0);
    expect(high).toBeGreaterThan(0);
    expect(lands).toBeGreaterThan(0);
    expect(others).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------------------------------------------------------------------------------------------ */
/* CR 601.2f, 602.2b, 702.6a: "Equip abilities you activate cost {2} less to activate" (Fighter Class, Bureau Headmaster)                                  */

const SMITH = card('Test Smith', 'Creature — Human Artificer', 'Equip abilities you activate cost {2} less to activate.', { cost: '{0}', pt: ['1', '1'] });
const BANNER = card('Test Banner', 'Artifact — Equipment', 'Equipped creature gets +1/+1.\nEquip {3}');
const LAMP = card('Test Lamp', 'Artifact', '{3}, {T}: You gain 1 life.');
const EQ_DEFS = [SMITH, BANNER, LAMP, COMMONER];
const untapped = (s: GameState, p: string): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && s.objects[id]!.defId === 'Plains' && !s.objects[id]!.tapped).length;
/** p's activation of `name`'s ability, the equip target chosen from the script, every payment automatic. */
function activateAbility(s0: GameState, player: string, name: string, target?: ObjectId): GameState | 'not offered' {
  const a = legal(s0, player, 'activate').find((x) => x.object === find(s0, name, 'battlefield', player as 'p1') && !x.isMana);
  if (!a) return 'not offered';
  let s: GameState;
  try {
    s = act(s0, a.action);
  } catch {
    return 'not offered';
  }
  for (let guard = 0; guard < 20 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending as unknown as { kind: string; options?: string[]; min?: number };
    if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: target ? [{ kind: 'object', id: target } as TargetChoice] : [] } as never);
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: (p.options ?? []).slice(0, p.min ?? 0) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}

describe('CR 601.2f, 602.2b, 702.6a: "Equip abilities you activate cost {2} less to activate"', () => {
  const board = (extra: string[] = [], p2?: string[]): GameState => scenario(['Plains'], { defs: EQ_DEFS, p1: { battlefield: ['Test Banner', 'Test Commoner', 'Plains', ...extra] }, p2: { battlefield: p2 ?? [] } });
  it('is automated and plays: with the Smith the equip costs {1} (one Plains), without it {3} (not payable with one Plains)', () => {
    expect(EQ_DEFS.every((d) => d.automation.level === 'full')).toBe(true);
    const withSmith = board(['Test Smith']);
    const t = activateAbility(withSmith, 'p1', 'Test Banner', find(withSmith, 'Test Commoner', 'battlefield'));
    expect(t).not.toBe('not offered');
    expect(untapped(t as GameState, 'p1')).toBe(0);
    const without = board();
    const u = activateAbility(without, 'p1', 'Test Banner', find(without, 'Test Commoner', 'battlefield'));
    expect(u === 'not offered' || untapped(u, 'p1') === 1 && (u.zones.stack.length === 0)).toBe(true); // not payable: no ability on the stack
  });
  it('negative: it reduces only generic mana down to {0} (two Smiths make a {3} equip free, never negative)', () => {
    const s = board(['Test Smith', 'Test Smith']);
    const t = activateAbility(s, 'p1', 'Test Banner', find(s, 'Test Commoner', 'battlefield'));
    expect(t).not.toBe('not offered');
    expect(untapped(t as GameState, 'p1')).toBe(1); // {3} - {2} - {2} floors at {0}
  });
  it('negative: it does not reduce an activated ability that is not an equip ability ({3} stays {3})', () => {
    const s = scenario(['Plains'], { defs: EQ_DEFS, p1: { battlefield: ['Test Smith', 'Test Lamp', 'Plains', 'Plains'] } });
    const t = activateAbility(s, 'p1', 'Test Lamp');
    expect(t === 'not offered' || t.zones.stack.length === 0).toBe(true);
  });
  it('negative: it reduces only the equip abilities its controller activates, not an opponent\'s (the Smith is p2\'s, the equip is p1\'s)', () => {
    const s = board([], ['Test Smith']);
    const t = activateAbility(s, 'p1', 'Test Banner', find(s, 'Test Commoner', 'battlefield'));
    expect(t === 'not offered' || t.zones.stack.length === 0).toBe(true);
  });
});

/* ------------------------------------------------------------------------------------------------------------------------------------------------------ */
/* CR 205.3i, 605.1a: "Add {C} for each Urza's land you control. Activate only if you control three or more artifacts." (Urza's Workshop)                    */

const SHOP = card('Test Urza Shop', "Land — Urza's", "{T}: Add {C} for each Urza's land you control. Activate only if you control three or more artifacts.");
const OTHER_LAND = card('Test Plain Land', 'Land', '{T}: Add {C}.');

describe('CR 205.3i: "for each Urza\'s land you control" counts the lands of the Urza\'s land type', () => {
  const manaOf = (s: GameState, name: string): string => {
    const a = legal(s, 'p1', 'activate').find((x) => x.object === find(s, name, 'battlefield', 'p1') && x.isMana === true);
    return a === undefined ? 'not offered' : pool(act(s, a.action), 'p1');
  };
  it('is automated (the render gate reads "Urza\'s land", not "Urza\'ses")', () => {
    expect(SHOP.automation.level).toBe('full');
  });
  it('two Urza\'s lands and three artifacts: one Shop adds {C}{C}', () => {
    const s = scenario([], { defs: [SHOP, LAMP, OTHER_LAND], p1: { battlefield: ['Test Urza Shop', 'Test Urza Shop', 'Test Lamp', 'Test Lamp', 'Test Lamp', 'Test Plain Land'] } });
    expect(manaOf(s, 'Test Urza Shop')).toBe('CC');
  });
  it('negative: a land that is not an Urza\'s land is not counted, and two artifacts are too few to activate', () => {
    const one = scenario([], { defs: [SHOP, LAMP, OTHER_LAND], p1: { battlefield: ['Test Urza Shop', 'Test Plain Land', 'Test Lamp', 'Test Lamp', 'Test Lamp'] } });
    expect(manaOf(one, 'Test Urza Shop')).toBe('C');
    const few = scenario([], { defs: [SHOP, LAMP, OTHER_LAND], p1: { battlefield: ['Test Urza Shop', 'Test Lamp', 'Test Lamp'] } });
    expect(manaOf(few, 'Test Urza Shop')).toBe('not offered');
  });
});

/* ------------------------------------------------------------------------------------------------------------------------------------------------------ */
/* CR 305.1, 603.4, 605.3b: "{T}: Add {U}. If you played a land this turn, add {B} instead." (River of Tears)                                              */

const TIDES = card('Test Tides', 'Land', '{T}: Add {U}. If you played a land this turn, add {B} instead.');

describe('CR 305.1: "If you played a land this turn, add {B} instead" reads the land plays of the turn', () => {
  const tapTides = (s: GameState): string => {
    const a = legal(s, 'p1', 'activate').find((x) => x.object === find(s, 'Test Tides', 'battlefield', 'p1') && x.isMana === true);
    if (a === undefined) throw new Error('not offered');
    return pool(act(s, a.action), 'p1');
  };
  it('is automated', () => {
    expect(TIDES.automation.level).toBe('full');
  });
  it('no land played this turn: {U}', () => {
    const s = scenario(['Forest'], { defs: [TIDES], p1: { battlefield: ['Test Tides'], hand: ['Forest'] } });
    expect(tapTides(s)).toBe('U');
  });
  it('after playing a land from the hand: {B} instead of {U}', () => {
    const s0 = scenario(['Forest'], { defs: [TIDES], p1: { battlefield: ['Test Tides'], hand: ['Forest'] } });
    const s = act(s0, { type: 'playLand', player: 'p1', card: find(s0, 'Forest', 'hand') });
    expect(tapTides(s)).toBe('B');
  });
  it('negative: a land that is on the battlefield without having been played this turn does not count (CR 305.1: playing a land is the special action)', () => {
    const put = scenario(['Forest'], { defs: [TIDES], p1: { battlefield: ['Test Tides', 'Forest'], hand: [] } });
    expect(tapTides(put)).toBe('U'); // a Forest that is simply on the battlefield: no land was played this turn
  });
});

/* review fix: a color given for a source (the client always sends one) never overrides a unit that has a single option */
describe('CR 106.1: "For each color among permanents you control, add one mana of that color" keeps each unit its own color when a color is given', () => {
  const VIVID = card('Test Vivid Relic', 'Artifact', '{T}: For each color among permanents you control, add one mana of that color.');
  const PAIR = card('Test Pair', 'Creature — Elf', '', { cost: '{G}{W}', colors: ['G', 'W'], pt: ['1', '1'] });
  it('a manual activation with color G adds {G}{W}, not {G}{G}', () => {
    const s = scenario([], { defs: [VIVID, PAIR], p1: { battlefield: ['Test Vivid Relic', 'Test Pair'] } });
    const id = find(s, 'Test Vivid Relic', 'battlefield', 'p1');
    const g = new Game(structuredClone(s));
    activateManaAbility(g, 'p1', id, activatedAbilities(g.s, g.s.objects[id]!)[0]!.key, { color: 'G' });
    expect(g.s.players[0]!.manaPool.map((u) => u.type).sort().join('')).toBe('GW');
  });
});
