/**
 * FAST5 T61: resolution riders played through the engine with synthetic cards (wordings invented, design 6.10): "Then draw N cards", "if you control that
 * creature, draw N cards", "Then if you control N or more lands, untap that land", "Then you draw X cards and lose X life, where X is the number of counters on ~",
 * "Then draw a card for each card you've discarded this turn", "Reveal those cards, put them into your hand, then shuffle", "Mill N cards, then put all <types> cards
 * from among them into your hand", "If you do, put a +1/+1 counter on ~ and draw a card", "If you do, return it to the battlefield under its owner's control at the
 * beginning of the next end step", "..., then you may exile a card from your graveyard. If you do, each opponent loses 2 life" and "put a +1/+1 counter on her".
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, battlefieldNames, find, life, pass, scenario, zoneNames } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Every ability of the card automated, and nothing partial. */
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual')) && d.automation.level === 'full';
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const yes: DecisionAnswer = { kind: 'yesNo', yes: true };
const no: DecisionAnswer = { kind: 'yesNo', yes: false };

/** Answer the decisions that come up: targets from `targets`, object choices from `picks`, then `answers`; pay costs automatically; stop at priority. */
function settle(s0: GameState, opts: { targets?: TargetChoice[][]; picks?: ObjectId[][]; answers?: DecisionAnswer[] } = {}): GameState {
  let s = s0;
  const groups = [...(opts.targets ?? [])];
  const picks = [...(opts.picks ?? [])];
  const queue = [...(opts.answers ?? [])];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'chooseTargets' && groups.length > 0) s = answer(s, { kind: 'chooseTargets', targets: groups.shift()! });
    else if (s.pending.kind === 'chooseObjects' && picks.length > 0) s = answer(s, { kind: 'chooseObjects', ids: picks.shift()! });
    else if (queue.length > 0) s = answer(s, queue.shift()!);
    else break;
  }
  return s;
}
const cast = (s0: GameState, name: string, opts: Parameters<typeof settle>[1] = {}): GameState => settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), opts);
/** Cast an instant or sorcery and let it resolve (both players pass). */
const castSpell = (s0: GameState, name: string, opts: Parameters<typeof settle>[1] = {}): GameState => settle(pass(pass(cast(s0, name, opts))), opts);
/** Cast a permanent spell, resolve it, then resolve what it triggered. */
const castAndResolve = (s0: GameState, name: string, opts: Parameters<typeof settle>[1] = {}): GameState => {
  let s = cast(s0, name);
  s = settle(pass(pass(s)), opts);
  if (s.pending?.kind === 'priority' && s.zones.stack.length > 0) s = settle(pass(pass(s)), opts);
  return s;
};
const handSize = (s: GameState, p = 'p1'): number => s.zones.hand[p]!.length;
const counters = (s: GameState, name: string): number => s.objects[find(s, name, 'battlefield')]!.counters['+1/+1'] ?? 0;

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2'], '{1}');
const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '3'], '{1}');
const RIDGE = card('Test Ridge', 'Land', '');
const BOOK = card('Test Book', 'Artifact', '');
const BOLT = card('Test Spark', 'Instant', '');
const GROWL = card('Test Growl', 'Sorcery', '');

describe('CR 608.2h, 121.1: "If you control that creature, draw two cards" reads the earlier target as the ability resolves', () => {
  const FROG = card('Test Frog', 'Creature — Frog', 'When Test Frog enters, tap up to one target creature and put three stun counters on it. If you control that creature, draw two cards.', ['1', '1']);
  it('is automated', () => expect(automated(FROG)).toBe(true));
  it('a creature you control: it is tapped with three stun counters and you draw two cards', () => {
    const s0 = scenario([], { p1: { hand: ['Test Frog'], battlefield: ['Test Bear'] }, defs: [FROG, BEAR] });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const s = castAndResolve(s0, 'Test Frog', { targets: [[obj(bear)]] });
    expect(s.objects[bear]!.tapped).toBe(true);
    expect(s.objects[bear]!.counters['stun']).toBe(3);
    expect(handSize(s)).toBe(2);
  });
  it("a creature an opponent controls: it is tapped with the counters, and you draw nothing (it is not yours)", () => {
    const s0 = scenario([], { p1: { hand: ['Test Frog'] }, p2: { battlefield: ['Test Ogre'] }, defs: [FROG, OGRE] });
    const ogre = find(s0, 'Test Ogre', 'battlefield', 'p2');
    const s = castAndResolve(s0, 'Test Frog', { targets: [[obj(ogre)]] });
    expect(s.objects[ogre]!.tapped).toBe(true);
    expect(s.objects[ogre]!.counters['stun']).toBe(3);
    expect(handSize(s)).toBe(0);
  });
  it('no target chosen ("up to one"): there is no creature to control, so nothing is drawn', () => {
    const s0 = scenario([], { p1: { hand: ['Test Frog'], battlefield: ['Test Bear'] }, defs: [FROG, BEAR] });
    const s = castAndResolve(s0, 'Test Frog', { targets: [[]] });
    expect(handSize(s)).toBe(0);
  });
});

describe('CR 701.23a, 608.2c: "Then if you control three or more lands, untap that land" untaps the land found in the same ability', () => {
  const PASSAGE = card('Test Passage', 'Sorcery', 'Search your library for a basic land card, put it onto the battlefield tapped, then shuffle. Then if you control three or more lands, untap that land.');
  it('is automated', () => expect(automated(PASSAGE)).toBe(true));
  it('with three lands after the search: the land fetched is untapped', () => {
    const s0 = scenario(['Forest'], { p1: { hand: ['Test Passage'], battlefield: ['Plains', 'Plains'], library: ['Forest'] }, defs: [PASSAGE] });
    const s = castSpell(s0, 'Test Passage', { picks: [[s0.zones.library['p1']!.find((id) => s0.objects[id]!.defId === 'Forest')!]] });
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Forest').length).toBe(1);
    expect(s.objects[find(s, 'Forest', 'battlefield', 'p1')]!.tapped).toBe(false);
  });
  it('with fewer: the land fetched stays tapped', () => {
    const s0 = scenario(['Forest'], { p1: { hand: ['Test Passage'], battlefield: ['Plains'], library: ['Forest'] }, defs: [PASSAGE] });
    const s = castSpell(s0, 'Test Passage', { picks: [[s0.zones.library['p1']!.find((id) => s0.objects[id]!.defId === 'Forest')!]] });
    expect(s.objects[find(s, 'Forest', 'battlefield', 'p1')]!.tapped).toBe(true);
  });
  it('another land that was already tapped is never untapped by the rider (only the one found)', () => {
    const s0 = scenario(['Forest'], { p1: { hand: ['Test Passage'], battlefield: [{ name: 'Plains', tapped: true }, 'Plains'], library: ['Forest'] }, defs: [PASSAGE] });
    const s = castSpell(s0, 'Test Passage', { picks: [[s0.zones.library['p1']!.find((id) => s0.objects[id]!.defId === 'Forest')!]] });
    const tapped = s.zones.battlefield.filter((id) => s.objects[id]!.tapped).map((id) => s.objects[id]!.defId);
    expect(tapped).toEqual(['Plains']);
  });
});

describe('CR 121.1, 608.2c: "Then draw three cards" after an instruction that stands alone', () => {
  const HEIST = card('Test Heist', 'Sorcery', 'Surveil 1 if you have no cards in hand. Then draw three cards.');
  it('is automated', () => expect(automated(HEIST)).toBe(true));
  it('the draw happens whether or not the first instruction did', () => {
    const s0 = scenario([], { p1: { hand: ['Test Heist', 'Test Bear'] }, defs: [HEIST, BEAR] });
    const s = castSpell(s0, 'Test Heist');
    expect(handSize(s)).toBe(1 + 3);
  });
});

describe('CR 107.3, 608.2h: "Then you draw X cards and lose X life, where X is the number of counters on ~"', () => {
  const DEMON = card('Test Demon', 'Creature — Demon', 'When Test Demon enters, put two +1/+1 counters on Test Demon. Then you draw X cards and lose X life, where X is the number of counters on Test Demon.', ['1', '1']);
  it('is automated', () => expect(automated(DEMON)).toBe(true));
  it('X is read after the counters are put: two cards and two life', () => {
    const s0 = scenario([], { p1: { hand: ['Test Demon'] }, defs: [DEMON] });
    const s = castAndResolve(s0, 'Test Demon');
    expect(counters(s, 'Test Demon')).toBe(2);
    expect(handSize(s)).toBe(2);
    expect(life(s, 'p1')).toBe(18);
  });
});

describe("CR 701.9a, 608.2h: \"Then draw a card for each card you've discarded this turn\" counts the cards this turn, this one included", () => {
  const LOOT = card('Test Loot', 'Sorcery', "Discard a card. Then draw a card for each card you've discarded this turn.");
  it('is automated', () => expect(automated(LOOT)).toBe(true));
  it('the first use draws one, the second use of the turn draws two (two cards were discarded in all)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Loot', 'Test Loot', 'Test Bear', 'Test Bear', 'Test Bear'] }, defs: [LOOT, BEAR] });
    const first = castSpell(s0, 'Test Loot', { picks: [[find(s0, 'Test Bear', 'hand', 'p1')]] });
    expect(handSize(first)).toBe(5 - 1 - 1 + 1);
    const bear = find(first, 'Test Bear', 'hand', 'p1');
    const second = castSpell(first, 'Test Loot', { picks: [[bear]] });
    expect(handSize(second)).toBe(5 - 1 - 1 + 1 - 1 - 1 + 2);
  });
  it("a card the opponent discarded is not counted (only the cards you discarded)", () => {
    const s0 = scenario([], { p1: { hand: ['Test Loot', 'Test Bear'] }, p2: { hand: ['Test Bear'] }, defs: [LOOT, BEAR] });
    const s = castSpell(s0, 'Test Loot', { picks: [[find(s0, 'Test Bear', 'hand', 'p1')]] });
    expect(zoneNames(s, 'graveyard', 'p1')).toContain('Test Bear');
    expect(handSize(s)).toBe(1);
  });
});

describe('CR 701.20a, 701.24a: "Reveal those cards, put them into your hand, then shuffle" after a search for up to two basic land cards', () => {
  const FETCH = card('Test Fetch', 'Sorcery', 'Search your library for up to two basic land cards. Reveal those cards, put them into your hand, then shuffle.');
  it('is automated', () => expect(automated(FETCH)).toBe(true));
  it('the two cards chosen go to the hand, and only those', () => {
    const s0 = scenario(['Forest'], { p1: { hand: ['Test Fetch'], library: ['Forest', 'Forest', 'Forest'] }, defs: [FETCH] });
    const forests = s0.zones.library['p1']!.filter((id) => s0.objects[id]!.defId === 'Forest');
    const s = castSpell(s0, 'Test Fetch', { picks: [forests.slice(0, 2)] });
    expect(zoneNames(s, 'hand', 'p1')).toEqual(['Forest', 'Forest']);
  });
});

describe('CR 701.17a, 701.17c: "Mill four cards, then put all creature and land cards from among them into your hand"', () => {
  const DIG = card('Test Dig', 'Sorcery', 'Mill four cards, then put all creature and land cards from among them into your hand.');
  it('is automated', () => expect(automated(DIG)).toBe(true));
  it('every milled creature or land goes to the hand, the rest stays in the graveyard, and no card that was in the graveyard before is taken', () => {
    const s0 = scenario([], { p1: { hand: ['Test Dig'], library: ['Test Bear', 'Test Book', 'Test Ridge', 'Test Spark', 'Test Ogre'], graveyard: ['Test Ogre'] }, defs: [DIG, BEAR, BOOK, RIDGE, BOLT, OGRE] });
    const s = castSpell(s0, 'Test Dig');
    expect(zoneNames(s, 'hand', 'p1').sort()).toEqual(['Test Bear', 'Test Ridge']);
    expect(zoneNames(s, 'graveyard', 'p1').sort()).toEqual(['Test Book', 'Test Dig', 'Test Ogre', 'Test Spark']);
  });
});

describe('CR 608.2c, 118.12: "If you do, put a +1/+1 counter on ~ and draw a card" is one conditional of both instructions', () => {
  const OWL = card('Test Owl', 'Creature — Bird', 'When Test Owl enters, you may pay 2 life. If you do, put a +1/+1 counter on Test Owl and draw a card.', ['1', '1']);
  it('is automated', () => expect(automated(OWL)).toBe(true));
  it('paid: the life is lost, the counter is put and the card is drawn', () => {
    const s0 = scenario([], { p1: { hand: ['Test Owl'] }, defs: [OWL] });
    const s = castAndResolve(s0, 'Test Owl', { answers: [yes] });
    expect(life(s, 'p1')).toBe(18);
    expect(counters(s, 'Test Owl')).toBe(1);
    expect(handSize(s)).toBe(1);
  });
  it('declined: neither the counter nor the card', () => {
    const s0 = scenario([], { p1: { hand: ['Test Owl'] }, defs: [OWL] });
    const s = castAndResolve(s0, 'Test Owl', { answers: [no] });
    expect(life(s, 'p1')).toBe(20);
    expect(counters(s, 'Test Owl')).toBe(0);
    expect(handSize(s)).toBe(0);
  });
});

describe('CR 603.7, 608.2c: "Exile up to one target creature you control. If you do, return it to the battlefield under its owner\'s control at the beginning of the next end step"', () => {
  const FLICKER = card('Test Flicker', 'Instant', "Exile up to one target creature you control. If you do, return it to the battlefield under its owner's control at the beginning of the next end step.");
  it('is automated', () => expect(automated(FLICKER)).toBe(true));
  it('the creature is exiled now and comes back at the next end step', () => {
    const s0 = scenario([], { p1: { hand: ['Test Flicker'], battlefield: ['Test Bear'] }, defs: [FLICKER, BEAR] });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    let s = castSpell(s0, 'Test Flicker', { targets: [[obj(bear)]] });
    expect(battlefieldNames(s, 'p1')).not.toContain('Test Bear');
    expect(s.zones.exile.map((id) => s.objects[id]!.defId)).toContain('Test Bear');
    s = advanceTo(s, 1, 'end');
    s = settle(s);
    if (s.zones.stack.length > 0) s = settle(pass(pass(s)));
    expect(battlefieldNames(s, 'p1')).toContain('Test Bear');
  });
  it('with no target chosen nothing is exiled and nothing comes back', () => {
    const s0 = scenario([], { p1: { hand: ['Test Flicker'], battlefield: ['Test Bear'] }, defs: [FLICKER, BEAR] });
    const s = castSpell(s0, 'Test Flicker', { targets: [[]] });
    expect(battlefieldNames(s, 'p1')).toContain('Test Bear');
    expect(s.zones.exile).toEqual([]);
  });
});

describe('CR 608.2c, 608.2d: "Mill three cards, then you may exile an Elf card from your graveyard. If you do, each opponent loses 2 life"', () => {
  const CULLER = card('Test Culler', 'Creature — Vampire', 'When Test Culler enters, mill three cards, then you may exile an Elf card from your graveyard. If you do, each opponent loses 2 life.', ['2', '2']);
  const ELF = card('Test Elf', 'Creature — Elf', '', ['1', '1']);
  it('is automated', () => expect(automated(CULLER)).toBe(true));
  it('with an Elf in the graveyard, exiling it makes each opponent lose 2 life', () => {
    const s0 = scenario([], { p1: { hand: ['Test Culler'], graveyard: ['Test Elf'] }, defs: [CULLER, ELF] });
    const s = castAndResolve(s0, 'Test Culler', { answers: [yes] });
    expect(life(s, 'p2')).toBe(18);
    expect(s.zones.exile.map((id) => s.objects[id]!.defId)).toEqual(['Test Elf']);
  });
  it('declined: nobody loses life', () => {
    const s0 = scenario([], { p1: { hand: ['Test Culler'], graveyard: ['Test Elf'] }, defs: [CULLER, ELF] });
    const s = castAndResolve(s0, 'Test Culler', { answers: [no] });
    expect(life(s, 'p2')).toBe(20);
  });
});

describe('CR 201.5, 122.1: "put a +1/+1 counter on her" puts the counter on the card itself', () => {
  const MAGE = card('Test Mage', 'Legendary Creature — Human', 'When Test Mage enters, if Test Mage is untapped, put a +1/+1 counter on her.', ['1', '1']);
  it('is automated', () => expect(automated(MAGE)).toBe(true));
  it('the counter lands on the creature', () => {
    const s0 = scenario([], { p1: { hand: ['Test Mage'] }, defs: [MAGE] });
    const s = castAndResolve(s0, 'Test Mage');
    expect(counters(s, 'Test Mage')).toBe(1);
  });
});

describe('CR 205.2a: "Put a +1/+1 counter on each artifact creature and/or Vehicle you control"', () => {
  const PRESS = card('Test Press', 'Sorcery', 'Put a +1/+1 counter on each artifact creature and/or Vehicle you control.');
  const GOLEM = card('Test Golem', 'Artifact Creature — Golem', '', ['1', '1']);
  const CART = card('Test Cart', 'Artifact — Vehicle', '');
  it('is automated', () => expect(automated(PRESS)).toBe(true));
  it('artifact creatures and Vehicles get one, other creatures and other artifacts do not', () => {
    const s0 = scenario([], { p1: { hand: ['Test Press'], battlefield: ['Test Golem', 'Test Cart', 'Test Bear', 'Test Book'] }, p2: { battlefield: ['Test Ogre'] }, defs: [PRESS, GOLEM, CART, BEAR, BOOK, OGRE] });
    const s = castSpell(s0, 'Test Press');
    const n = (name: string, owner: 'p1' | 'p2' = 'p1'): number => s.objects[find(s, name, 'battlefield', owner)]!.counters['+1/+1'] ?? 0;
    expect([n('Test Golem'), n('Test Cart'), n('Test Bear'), n('Test Book'), n('Test Ogre', 'p2')]).toEqual([1, 1, 0, 0, 0]);
  });
});

describe('CR 109.2, 608.2h: "Put a +1/+1 counter on it for each Mount and/or Vehicle you control other than this Vehicle"', () => {
  const CYCLE = card('Test Cycle', 'Artifact — Vehicle', 'Haste\n{0}: Put a +1/+1 counter on Test Cycle for each Mount and/or Vehicle you control other than Test Cycle.', ['2', '2']);
  const CART = card('Test Cart', 'Artifact — Vehicle', '');
  it('is automated', () => expect(automated(CYCLE)).toBe(true));
  it('counts the others, never the vehicle itself', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Cycle', 'Test Cart', 'Test Cart'] }, defs: [CYCLE, CART] });
    const id = find(s0, 'Test Cycle', 'battlefield', 'p1');
    let s = act(s0, { type: 'activate', player: 'p1', source: id, ability: 'p:0:1' } as never);
    s = settle(pass(pass(s)));
    expect(s.objects[id]!.counters['+1/+1']).toBe(2);
  });
});
