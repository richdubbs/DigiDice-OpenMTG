/**
 * FAST5 T65 (T7-C: counter placement and card-draw steps): the shapes of parser/templates/zz-fast5/t65.json (and the hole-grammar, renderer and tokenizer readings the
 * package added) played through the engine with synthetic cards compiled by the game's default compiler (wordings are invented, design 6.10).
 *
 *   CR 122.1b, 608.2c       "put two +1/+1 counters and a flying counter on target creature": both kinds, and the creature has flying
 *   CR 614.1c, 614.12       "If you control two or more untapped lands, ~ enters with two +1/+1 counters and a lifelink counter on it": judged as it enters
 *   CR 509.1b, 611.2a       "put a +1/+1 counter on ~ and it can't be blocked this turn": until the turn ends
 *   CR 601.2d, 701.10e      "distribute three +1/+1 counters among one, two, or three target creatures, then double the number of +1/+1 counters on each of those creatures"
 *   CR 614.1c, 122.6, 603.6a  "each creature you control enters with an additional +1/+1 counter on it for each land that entered the battlefield under your control this turn"
 *   CR 121.1, 119.3, 608.2c "you draw a card, lose 2 life, and put a plan counter on ~"; "sacrifice it, draw a card, and put a +1/+1 counter on each creature you control";
 *                           "each opponent loses 1 life, you gain 1 life, and you draw a card" (the serial comma of the joiner)
 *   CR 122.1, 111.2, 508.4, 608.2h  "put a +1/+1 counter on ~, then create X 1/1 Gnome creature tokens that are tapped and attacking, where X is the number of +1/+1 counters on ~"
 *   CR 700.4, 603.6c        "leaves the battlefield without dying": bounced, exiled, shuffled away; not destroyed
 *   CR 700.4, 603.2         "another creature you control or a land you control is put into a graveyard from the battlefield"
 *   CR 105.1                "draw a card for each color among permanents you control"
 *   CR 701.44a, 107.3       "it explores X times"
 *   CR 701.21a, 121.1, 608.2c  "sacrifice any number of artifacts, enchantments, and/or tokens, then draw that many cards"
 *   CR 107.3, 608.2h        "target player draws 2ˣ cards"
 *   CR 608.2d, 608.2f, 701.24a  "each player may shuffle their hand and graveyard into their library, then each player who does draws three cards"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, hasKeyword, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { ruleDenial } from '../../../src/statics/hooks';
import { advanceTo, answer, declareAttackers, find, findAll, pass, scenario, toDeclareAttackers } from '../../m5/helpers';
import { act } from '../../m3/scenario';
import { activate, cast, resolveAll, resolveTop, target } from '../../m5/cr-examples/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Every ability of the card automated (no manual ability or step) and the card full (the T65 templates are stable). */
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const ctr = (s: GameState, id: ObjectId, kind = '+1/+1'): number => s.objects[id]?.counters[kind] ?? 0;
const ptOf = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const handOf = (s: GameState, p = 'p1'): number => s.zones.hand[p]!.length;
const lifeOf = (s: GameState, p = 'p1'): number => s.players.find((x) => x.id === p)!.life;
const libOf = (s: GameState, p = 'p1'): number => s.zones.library[p]!.length;

const ELF = card('Test Elf', 'Creature — Elf', '', ['2', '2']);
const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '1']);
const KILL = card('Test Kill', 'Instant', 'Destroy target creature.');
const BOUNCE = card('Test Bounce', 'Instant', "Return target creature to its owner's hand.");
const EXILE = card('Test Exile', 'Instant', 'Exile target creature.');
const GOLEM = card('Test Golem', 'Artifact Creature — Golem', '', ['1', '1']);

describe('CR 122.1b, 608.2c: "Put two +1/+1 counters and a flying counter on target creature."', () => {
  const RENEW = card('Test Renewal', 'Sorcery', 'Put two +1/+1 counters and a flying counter on target creature.');
  const MENTOR = card('Test Mentor', 'Creature — Human', '{0}: Put three +1/+1 counters and a lifelink counter on target creature you control.', ['1', '1']);
  it('both kinds of counter, and the creature has flying (a sorcery)', () => {
    expect(full(RENEW)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Renewal'], battlefield: ['Test Ogre'] }, defs: [RENEW, OGRE] });
    const ogre = find(s, 'Test Ogre', 'battlefield');
    s = resolveAll(cast(s, 'Test Renewal', [target(ogre)]));
    expect([ctr(s, ogre), ctr(s, ogre, 'flying')]).toEqual([2, 1]);
    expect(ptOf(s, ogre)).toBe('5/3');
    expect(hasKeyword(getChars(s, ogre)!, 'flying')).toBe(true);
  });
  it('an activated ability does the same with other numbers and kinds', () => {
    expect(full(MENTOR)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Mentor', 'Test Elf'] }, defs: [MENTOR, ELF] });
    const elf = find(s, 'Test Elf', 'battlefield');
    s = resolveTop(activate(s, find(s, 'Test Mentor', 'battlefield'), [target(elf)]));
    expect([ctr(s, elf), ctr(s, elf, 'lifelink')]).toEqual([3, 1]);
    expect(hasKeyword(getChars(s, elf)!, 'lifelink')).toBe(true);
  });
});

describe('CR 614.1c, 614.12: "If you control two or more untapped lands, ~ enters with two +1/+1 counters and a lifelink counter on it."', () => {
  const HOUND = card('Test Skyhound', 'Creature — Dog', 'If you control two or more untapped lands, ~ enters with two +1/+1 counters and a lifelink counter on it.', ['1', '1']);
  it('with two untapped lands it enters with the counters (and lifelink), with one it enters plain', () => {
    expect(full(HOUND)).toBe(true);
    let s = scenario(['Plains'], { p1: { hand: ['Test Skyhound'], battlefield: ['Plains', 'Plains'] }, defs: [HOUND] });
    s = resolveAll(cast(s, 'Test Skyhound'));
    const hound = find(s, 'Test Skyhound', 'battlefield');
    expect([ctr(s, hound), ctr(s, hound, 'lifelink')]).toEqual([2, 1]);
    expect(ptOf(s, hound)).toBe('3/3');
    expect(hasKeyword(getChars(s, hound)!, 'lifelink')).toBe(true);
    let t = scenario(['Plains'], { p1: { hand: ['Test Skyhound'], battlefield: ['Plains', { name: 'Plains', tapped: true }] }, defs: [HOUND] });
    t = resolveAll(cast(t, 'Test Skyhound'));
    const plain = find(t, 'Test Skyhound', 'battlefield');
    expect([ctr(t, plain), ctr(t, plain, 'lifelink')]).toEqual([0, 0]);
  });
});

describe('CR 509.1b, 611.2a: "put a +1/+1 counter on ~ and it can\'t be blocked this turn"', () => {
  const MAGE = card('Test Glider', 'Creature — Wizard', "Whenever you cast a noncreature spell, if at least two mana was spent to cast it, put a +1/+1 counter on ~ and it can't be blocked this turn.", ['1', '1']);
  const CHARM = card('Test Charm', 'Instant', 'You gain 1 life.', undefined, '{2}');
  const FLICKER = card('Test Cheap Charm', 'Instant', 'You gain 1 life.', undefined, '{1}');
  it('the counter and the evasion come with a spell that cost enough, and last until the end of the turn', () => {
    expect(full(MAGE)).toBe(true);
    let s = scenario(['Plains'], { p1: { hand: ['Test Charm'], battlefield: ['Test Glider', 'Plains', 'Plains'] }, defs: [MAGE, CHARM] });
    const mage = find(s, 'Test Glider', 'battlefield');
    expect(ruleDenial(s, { action: 'beBlocked', subject: mage })).toBeNull();
    s = resolveAll(cast(s, 'Test Charm'));
    expect(ctr(s, mage)).toBe(1);
    expect(ptOf(s, mage)).toBe('2/2');
    expect(ruleDenial(s, { action: 'beBlocked', subject: mage })).not.toBeNull();
    s = advanceTo(s, 3, 'main1');
    expect(ruleDenial(s, { action: 'beBlocked', subject: mage })).toBeNull();
    expect(ctr(s, mage)).toBe(1);
  });
  it('a spell that cost less does nothing (the intervening "if", CR 603.4)', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Cheap Charm'], battlefield: ['Test Glider', 'Plains'] }, defs: [MAGE, FLICKER] });
    const mage = find(s, 'Test Glider', 'battlefield');
    s = resolveAll(cast(s, 'Test Cheap Charm'));
    expect(ctr(s, mage)).toBe(0);
    expect(ruleDenial(s, { action: 'beBlocked', subject: mage })).toBeNull();
  });
});

describe('CR 601.2d, 701.10e: "Distribute three +1/+1 counters among one, two, or three target creatures, then double the number of +1/+1 counters on each of those creatures."', () => {
  const UPGRADE = card('Test Upgrade', 'Sorcery', 'Distribute three +1/+1 counters among one, two, or three target creatures, then double the number of +1/+1 counters on each of those creatures.');
  it('the division announced on casting, then each target has as many again: 1 and 2 give 2 and 4, and a creature with counters already doubles those too', () => {
    expect(full(UPGRADE)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Upgrade', 'Test Upgrade'], battlefield: ['Test Elf', 'Test Ogre'] }, defs: [UPGRADE, ELF, OGRE] });
    const elf = find(s, 'Test Elf', 'battlefield');
    const ogre = find(s, 'Test Ogre', 'battlefield');
    s = cast(s, 'Test Upgrade', [target(elf, ogre)]);
    expect(s.pending).toMatchObject({ kind: 'chooseDivision', what: 'counters', total: 3 });
    s = answer(s, { kind: 'chooseDivision', amounts: [1, 2] });
    s = resolveAll(s);
    expect([ctr(s, elf), ctr(s, ogre)]).toEqual([2, 4]);
    s = cast(s, 'Test Upgrade', [target(elf)]);
    s = resolveAll(s);
    expect(ctr(s, elf)).toBe(10); // 2 + 3 = 5, doubled
    expect(ctr(s, ogre)).toBe(4); // not a target
  });
});

describe('CR 614.1c, 122.6, 603.6a: "Each creature you control enters with an additional +1/+1 counter on it for each land that entered the battlefield under your control this turn."', () => {
  const FUTURE = card('Test Growth Sign', 'Enchantment', 'Each creature you control enters with an additional +1/+1 counter on it for each land that entered the battlefield under your control this turn.');
  it('counts the lands you put onto the battlefield this turn: none before the land, one after it; not last turn\'s', () => {
    expect(full(FUTURE)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Elf', 'Test Elf', 'Test Elf', 'Plains'], battlefield: ['Test Growth Sign'] }, defs: [FUTURE, ELF] });
    s = resolveAll(cast(s, 'Test Elf'));
    expect(ctr(s, find(s, 'Test Elf', 'battlefield'))).toBe(0);
    s = act(s, { type: 'playLand', player: 'p1', card: find(s, 'Plains', 'hand', 'p1') });
    s = resolveAll(cast(s, 'Test Elf'));
    const elves = findAll(s, 'Test Elf', 'battlefield', 'p1').map((id) => ctr(s, id)).sort();
    expect(elves).toEqual([0, 1]);
    s = advanceTo(s, 3, 'main1');
    s = resolveAll(cast(s, 'Test Elf'));
    expect(findAll(s, 'Test Elf', 'battlefield', 'p1').map((id) => ctr(s, id)).sort()).toEqual([0, 0, 1]);
  });
  it('an opponent\'s land is not counted, and an opponent\'s creature is not given the counter', () => {
    let s = scenario([], { p1: { hand: ['Test Elf'], battlefield: ['Test Growth Sign'] }, p2: { hand: ['Test Elf'] }, defs: [FUTURE, ELF] });
    s = resolveAll(cast(s, 'Test Elf'));
    expect(ctr(s, find(s, 'Test Elf', 'battlefield', 'p1'))).toBe(0);
  });
});

describe('CR 121.1, 119.3, 608.2c: three instructions joined by commas', () => {
  const DOMINATION = card('Test Plan Table', 'Enchantment', 'Whenever one or more creature cards are put into your graveyard from anywhere, you draw a card, lose 2 life, and put a plan counter on ~.');
  const TRIUMPH = card('Test Triumph', 'Enchantment', 'When the third plan counter is put on ~, sacrifice it, draw a card, and put a +1/+1 counter on each creature you control.');
  const CAMPAIGN = card('Test Campaign', 'Enchantment', 'When ~ enters, each opponent loses 3 life, you gain 3 life, and you draw a card.');
  it('"you draw a card, lose 2 life, and put a plan counter on ~"', () => {
    expect(full(DOMINATION)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Kill'], battlefield: ['Test Plan Table', 'Test Elf'] }, defs: [DOMINATION, ELF, KILL] });
    const hand = handOf(s);
    s = resolveAll(cast(s, 'Test Kill', [target(find(s, 'Test Elf', 'battlefield'))]));
    const table = find(s, 'Test Plan Table', 'battlefield');
    expect(ctr(s, table, 'plan')).toBe(1);
    expect(lifeOf(s)).toBe(18);
    expect(handOf(s)).toBe(hand - 1 + 1); // the Kill left the hand, a card was drawn
  });
  it('"sacrifice it, draw a card, and put a +1/+1 counter on each creature you control": the third plan counter sacrifices the enchantment, draws, and grows every creature', () => {
    const PLAN = card('Test Plan Wall', 'Enchantment', 'Whenever a creature you control enters, put a plan counter on ~.\nWhen the third plan counter is put on ~, sacrifice it, draw a card, and put a +1/+1 counter on each creature you control.');
    expect(full(PLAN)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Elf', 'Test Elf', 'Test Elf'], battlefield: ['Test Plan Wall'] }, p2: { battlefield: ['Test Ogre'] }, defs: [PLAN, ELF, OGRE] });
    const hand = handOf(s);
    for (let i = 0; i < 3; i++) s = resolveAll(cast(s, 'Test Elf'));
    expect(findAll(s, 'Test Plan Wall', 'battlefield', 'p1').length).toBe(0);
    expect(findAll(s, 'Test Plan Wall', 'graveyard', 'p1').length).toBe(1);
    expect(handOf(s)).toBe(hand - 3 + 1);
    expect(findAll(s, 'Test Elf', 'battlefield', 'p1').map((id) => ctr(s, id))).toEqual([1, 1, 1]);
    expect(ctr(s, find(s, 'Test Ogre', 'battlefield', 'p2'))).toBe(0);
  });
  it('"each opponent loses 3 life, you gain 3 life, and you draw a card"', () => {
    expect(full(CAMPAIGN)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Campaign'] }, defs: [CAMPAIGN] });
    const hand = handOf(s);
    s = resolveAll(cast(s, 'Test Campaign'));
    expect([lifeOf(s, 'p1'), lifeOf(s, 'p2')]).toEqual([23, 17]);
    expect(handOf(s)).toBe(hand - 1 + 1);
  });
});

describe('CR 122.1, 111.2, 508.4, 608.2h: "put a +1/+1 counter on ~, then create X 1/1 tokens that are tapped and attacking, where X is the number of +1/+1 counters on ~"', () => {
  const MOON = card('Test Moon Guide', 'Creature — Human', 'Whenever you attack, put a +1/+1 counter on ~, then create X 1/1 white Soldier creature tokens that are tapped and attacking, where X is the number of +1/+1 counters on ~.', ['1', '1']);
  it('the counter comes first, so X counts it: one token the first attack; they enter tapped and attacking', () => {
    expect(full(MOON)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Moon Guide'] }, defs: [MOON] });
    const guide = find(s, 'Test Moon Guide', 'battlefield');
    s = declareAttackers(toDeclareAttackers(s), [[guide]]);
    s = resolveAll(s);
    expect(ctr(s, guide)).toBe(1);
    const tokens = s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && id !== guide && s.objects[id]!.kind === 'token');
    expect(tokens.length).toBe(1);
    expect(s.objects[tokens[0]!]!.tapped).toBe(true);
    expect(s.combat!.attackers.map((a) => a.id)).toContain(tokens[0]);
    expect(ptOf(s, tokens[0]!)).toBe('1/1');
  });
  it('with counters already on it, X is the number after the new counter', () => {
    let s = scenario([], { p1: { battlefield: [{ name: 'Test Moon Guide', counters: { '+1/+1': 2 } }] }, defs: [MOON] });
    const guide = find(s, 'Test Moon Guide', 'battlefield');
    s = resolveAll(declareAttackers(toDeclareAttackers(s), [[guide]]));
    expect(ctr(s, guide)).toBe(3);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token').length).toBe(3);
  });
});

describe('CR 700.4, 603.6c: "leaves the battlefield without dying"', () => {
  const SCRIBE = card('Test Frog Scribe', 'Creature — Frog', 'Whenever ~ or another creature you control leaves the battlefield without dying, put a +1/+1 counter on target creature you control.', ['1', '1']);
  const MAGE = card('Test Port Mage', 'Creature — Wizard', 'Whenever one or more other creatures you control leave the battlefield without dying, draw a card.', ['1', '1']);
  it('a bounced creature triggers it; a destroyed one does not (it died)', () => {
    expect(full(SCRIBE)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Bounce', 'Test Kill'], battlefield: ['Test Frog Scribe', 'Test Ogre'] }, defs: [SCRIBE, OGRE, BOUNCE, KILL] });
    const scribe = find(s, 'Test Frog Scribe', 'battlefield');
    const ogre = find(s, 'Test Ogre', 'battlefield');
    s = resolveAll(cast(s, 'Test Kill', [target(ogre)]), [target(scribe)]);
    expect(ctr(s, scribe)).toBe(0);
    expect(findAll(s, 'Test Ogre', 'graveyard', 'p1').length).toBe(1);
    // the Scribe itself bounced: it triggers (a leaves-the-battlefield trigger looks back, CR 603.10a) and the counter goes on the target
    let t = scenario([], { p1: { hand: ['Test Bounce'], battlefield: ['Test Frog Scribe', 'Test Ogre'] }, defs: [SCRIBE, OGRE, BOUNCE] });
    const scribe2 = find(t, 'Test Frog Scribe', 'battlefield');
    const ogre2 = find(t, 'Test Ogre', 'battlefield');
    t = resolveAll(cast(t, 'Test Bounce', [target(scribe2)]), [target(ogre2)]);
    expect(ctr(t, ogre2)).toBe(1);
    expect(findAll(t, 'Test Frog Scribe', 'hand', 'p1').length).toBe(1);
  });
  it('an exiled creature of another player does not trigger it (only yours)', () => {
    let s = scenario([], { p1: { hand: ['Test Exile'], battlefield: ['Test Frog Scribe', 'Test Elf'] }, p2: { battlefield: ['Test Ogre'] }, defs: [SCRIBE, ELF, OGRE, EXILE] });
    const elf = find(s, 'Test Elf', 'battlefield');
    s = resolveAll(cast(s, 'Test Exile', [target(find(s, 'Test Ogre', 'battlefield', 'p2'))]));
    expect(ctr(s, elf)).toBe(0);
    s = scenario([], { p1: { hand: ['Test Exile'], battlefield: ['Test Frog Scribe', 'Test Elf'] }, defs: [SCRIBE, ELF, EXILE] });
    const elf2 = find(s, 'Test Elf', 'battlefield');
    s = resolveAll(cast(s, 'Test Exile', [target(elf2)]), [target(find(s, 'Test Frog Scribe', 'battlefield'))]);
    expect(ctr(s, find(s, 'Test Frog Scribe', 'battlefield'))).toBe(1);
  });
  it('"one or more" is one trigger for creatures that leave together', () => {
    expect(full(MAGE)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Bounce'], battlefield: ['Test Port Mage', 'Test Elf'] }, defs: [MAGE, ELF, BOUNCE] });
    const hand = handOf(s);
    s = resolveAll(cast(s, 'Test Bounce', [target(find(s, 'Test Elf', 'battlefield'))]));
    expect(handOf(s)).toBe(hand - 1 + 1 + 1); // the Bounce left, the Elf came back, a card was drawn
  });
});

describe('CR 700.4, 603.2: "Whenever another creature you control or a land you control is put into a graveyard from the battlefield, put a +1/+1 counter on target creature you control."', () => {
  const FENG = card('Test Secretary', 'Creature — Advisor', 'Whenever another creature you control or a land you control is put into a graveyard from the battlefield, put a +1/+1 counter on target creature you control.', ['1', '1']);
  const SMASH = card('Test Land Smash', 'Instant', 'Destroy target land.');
  it('is automated and triggers for a creature and for a land that go to the graveyard', () => {
    expect(full(FENG)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Kill', 'Test Land Smash'], battlefield: ['Test Secretary', 'Test Elf', 'Plains'] }, defs: [FENG, ELF, KILL, SMASH] });
    const boss = find(s, 'Test Secretary', 'battlefield');
    s = resolveAll(cast(s, 'Test Kill', [target(find(s, 'Test Elf', 'battlefield'))]), [target(boss)]);
    expect(ctr(s, boss)).toBe(1);
    s = resolveAll(cast(s, 'Test Land Smash', [target(find(s, 'Plains', 'battlefield', 'p1'))]), [target(boss)]);
    expect(ctr(s, boss)).toBe(2);
  });
});

describe('CR 105.1: "draw a card for each color among other artifacts you control"', () => {
  const GUARDIAN = card('Test Prism Guard', 'Artifact Creature — Golem', 'When ~ enters, draw a card for each color among other artifacts you control.', ['2', '2']);
  const RED_GEM = compileCard({ name: 'Test Red Gem', layout: 'normal', mana_cost: '', type_line: 'Artifact', oracle_text: '', colors: ['R'] } as OracleCard);
  const BLUE_GEM = compileCard({ name: 'Test Blue Gem', layout: 'normal', mana_cost: '', type_line: 'Artifact', oracle_text: '', colors: ['U'] } as OracleCard);
  it('counts the colors the other artifacts have between them (colorless is none, one color counts once)', () => {
    expect(full(GUARDIAN)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Prism Guard'], battlefield: ['Test Red Gem', 'Test Red Gem', 'Test Blue Gem', 'Test Golem'] }, defs: [GUARDIAN, RED_GEM, BLUE_GEM, GOLEM] });
    const hand = handOf(s);
    s = resolveAll(cast(s, 'Test Prism Guard'));
    expect(handOf(s)).toBe(hand - 1 + 2);
  });
});

describe('CR 701.44a, 107.3: "it explores X times"', () => {
  const SPELUNKER = card('Test Delver', 'Creature — Merfolk Scout', 'When ~ enters, it explores X times.', ['1', '1'], '{X}');
  it('explores once for each X: a land goes to the hand, a nonland card is a +1/+1 counter (and may go to the graveyard)', () => {
    expect(full(SPELUNKER)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Delver'], battlefield: ['Plains', 'Plains', 'Plains'], library: ['Test Ogre', 'Plains', 'Test Ogre'] }, defs: [SPELUNKER, OGRE] });
    const hand = handOf(s);
    s = resolveAll(cast(s, 'Test Delver', [{ kind: 'chooseNumber', n: 3 }]), [{ kind: 'yesNo', yes: true }, { kind: 'yesNo', yes: false }]);
    const delver = find(s, 'Test Delver', 'battlefield');
    expect(ctr(s, delver)).toBe(2); // two nonland cards
    expect(handOf(s)).toBe(hand - 1 + 1); // the Delver left, one land came in
    expect(findAll(s, 'Test Ogre', 'graveyard', 'p1').length).toBe(1); // the first was binned, the second kept on top
  });
  it('with X = 0 it does not explore at all', () => {
    let s = scenario([], { p1: { hand: ['Test Delver'], library: ['Test Ogre'] }, defs: [SPELUNKER, OGRE] });
    s = resolveAll(cast(s, 'Test Delver', [{ kind: 'chooseNumber', n: 0 }]));
    expect(ctr(s, find(s, 'Test Delver', 'battlefield'))).toBe(0);
  });
});

describe('CR 701.21a, 121.1, 608.2c: "sacrifice any number of artifacts, enchantments, and/or tokens, then draw that many cards"', () => {
  const KITE = card('Test Dragon Kite', 'Creature — Dragon', 'When ~ enters, sacrifice any number of artifacts, enchantments, and/or tokens, then draw that many cards.', ['1', '1']);
  const RED_GEM = compileCard({ name: 'Test Red Gem', layout: 'normal', mana_cost: '', type_line: 'Artifact', oracle_text: '', colors: ['R'] } as OracleCard);
  const SIGN = card('Test Sign', 'Enchantment', '');
  it('offers only your artifacts, enchantments and tokens, sacrifices the ones chosen and draws as many cards', () => {
    expect(full(KITE)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Dragon Kite'], battlefield: ['Test Golem', 'Test Red Gem', 'Test Sign', 'Test Elf'] }, p2: { battlefield: ['Test Red Gem'] }, defs: [KITE, RED_GEM, SIGN, GOLEM, ELF] });
    const hand = handOf(s);
    s = resolveTop(resolveTop(cast(s, 'Test Dragon Kite')));
    expect(s.pending?.kind).toBe('chooseObjects');
    const pending = s.pending as unknown as { options: string[] };
    const golem = find(s, 'Test Golem', 'battlefield');
    const gem = find(s, 'Test Red Gem', 'battlefield', 'p1');
    const sign = find(s, 'Test Sign', 'battlefield');
    const elf = find(s, 'Test Elf', 'battlefield');
    expect([...pending.options].sort()).toEqual([golem, gem, sign].sort());
    expect(pending.options).not.toContain(find(s, 'Test Red Gem', 'battlefield', 'p2'));
    expect(pending.options).not.toContain(elf);
    s = answer(s, { kind: 'chooseObjects', ids: [golem, gem] });
    s = resolveAll(s);
    expect(findAll(s, 'Test Golem', 'graveyard', 'p1').length).toBe(1);
    expect(findAll(s, 'Test Red Gem', 'graveyard', 'p1').length).toBe(1);
    expect(findAll(s, 'Test Sign', 'battlefield', 'p1').length).toBe(1);
    expect(handOf(s)).toBe(hand - 1 + 2);
  });
  it('choosing none sacrifices nothing and draws nothing', () => {
    let s = scenario([], { p1: { hand: ['Test Dragon Kite'], battlefield: ['Test Golem'] }, defs: [KITE, GOLEM] });
    const hand = handOf(s);
    s = resolveTop(resolveTop(cast(s, 'Test Dragon Kite')));
    expect(s.pending?.kind).toBe('chooseObjects');
    s = resolveAll(answer(s, { kind: 'chooseObjects', ids: [] }));
    expect(findAll(s, 'Test Golem', 'battlefield', 'p1').length).toBe(1);
    expect(handOf(s)).toBe(hand - 1);
  });
});

describe('CR 107.3, 608.2h: "target player draws 2ˣ cards"', () => {
  const MATH = card('Test Math Spell', 'Sorcery', 'Target player draws 2ˣ cards.', undefined, '{X}{W}');
  it('2 to the X: X = 3 draws eight, X = 0 draws one; the target player draws them', () => {
    expect(full(MATH)).toBe(true);
    let s = scenario(['Plains'], { p1: { hand: ['Test Math Spell'], battlefield: ['Plains', 'Plains', 'Plains', 'Plains'] }, defs: [MATH] });
    const mine = handOf(s, 'p1');
    const theirs = handOf(s, 'p2');
    s = resolveAll(cast(s, 'Test Math Spell', [{ kind: 'chooseNumber', n: 3 }, target('p2')]));
    expect(handOf(s, 'p2')).toBe(theirs + 8);
    expect(handOf(s, 'p1')).toBe(mine - 1);
    let t = scenario(['Plains'], { p1: { hand: ['Test Math Spell'], battlefield: ['Plains'] }, defs: [MATH] });
    const base = handOf(t, 'p1');
    t = resolveAll(cast(t, 'Test Math Spell', [target('p1')]));
    expect(handOf(t, 'p1')).toBe(base - 1 + 1);
  });
});

describe('CR 608.2d, 608.2f, 701.24a: "each player may shuffle their hand and graveyard into their library, then each player who does draws three cards"', () => {
  const REWIND = card('Test Rewind', 'Sorcery', 'Each player may shuffle their hand and graveyard into their library, then each player who does draws three cards.');
  it('every player decides; those who say yes put hand and graveyard into the library and draw three, the others keep what they have', () => {
    expect(full(REWIND)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Rewind', 'Test Elf', 'Test Ogre'], graveyard: ['Test Elf'] }, p2: { hand: ['Test Elf', 'Test Elf'], graveyard: ['Test Ogre'] }, defs: [REWIND, ELF, OGRE] });
    const lib1 = libOf(s, 'p1');
    const lib2 = libOf(s, 'p2');
    s = resolveTop(cast(s, 'Test Rewind'));
    // p1 decides first (APNAP), then p2
    expect(s.pending).toMatchObject({ kind: 'yesNo', player: 'p1' });
    s = answer(s, { kind: 'yesNo', yes: true });
    expect(s.pending).toMatchObject({ kind: 'yesNo', player: 'p2' });
    s = answer(s, { kind: 'yesNo', yes: false });
    s = resolveAll(s);
    expect(handOf(s, 'p1')).toBe(3);
    expect(libOf(s, 'p1')).toBe(lib1 + 2 + 1 - 3);
    expect(s.zones.graveyard['p1']!.map((id) => s.defs[s.objects[id]!.defId]!.name)).toEqual(['Test Rewind']);
    expect(handOf(s, 'p2')).toBe(2);
    expect(libOf(s, 'p2')).toBe(lib2);
    expect(s.zones.graveyard['p2']!.length).toBe(1);
  });
});
