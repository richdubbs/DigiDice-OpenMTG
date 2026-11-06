/**
 * Commander coordinator D, round edh-d-9 (EDHREC ranks 13,751-15,000, third pass): the round's readings played through the engine with synthetic cards (invented names, design
 * 6.10), compiled by the game's default compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case. CR cites
 * checked against the Comprehensive Rules of 2026-09-25 (https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt).
 *
 *   CR 701.20a, 608.2d, 401.4   "Look at the top seven cards of your library. Put up to two land cards from among them onto the battlefield tapped. Put the rest on the bottom ..." (Cartographer's Survey)
 *   CR 701.20a, 608.2d, 404.1   "Reveal the top six cards of your library. You may put any number of snow permanent cards from among them into your hand. Put the rest into your graveyard." (Glacial Revelation)
 *   CR 701.20a, 701.20e         "... You may reveal a creature card or Garruk planeswalker card from among them and put it into your hand. ..." (Garruk's Harbinger)
 *   CR 701.20a, 202.3, 608.2d   "When ~ enters, reveal the top X cards ... put any number of Aura cards with mana value X or less from among them onto the battlefield ..." (Knickknack Ouphe)
 *   CR 701.21a, 701.9a          "When ~ enters, discard your hand. Each opponent sacrifices a creature of their choice for each card discarded this way." (Malfegor)
 *   CR 701.24a, 701.16a, 400.3  "Choose target creature. Its owner shuffles it into their library, then investigates." (Blink)
 *   CR 613.1d, 205.1a           "Whenever an opponent casts a creature spell, this token isn't a creature until end of turn." (Blink)
 *   CR 701.26a, 118.12          "Whenever ~ attacks, you may tap two other untapped creatures you control. If you do, ~ can't be blocked this turn." (Tidal Terror)
 *   CR 702.51a, 400.7d          "When ~ enters, put a +1/+1 counter on each creature that convoked it." (Venerated Loxodon)
 *   CR 701.9a, 404.1            "Discard X cards, then return a card from your graveyard to your hand for each card discarded this way." (Recall)
 *   CR 614.10                   "Skip your next turn." (Magosi, the Waterveil)
 */
import { describe, expect, it } from 'vitest';
import { getChars, type GameState, type ObjectId, type PlayerId } from '../../../src/index';
import { act, activations, advanceTo, answer, card, cast, drive, find, full, obj, passBoth, resolveAll, scenario } from '../r3-cost/support';

const nameOf = (s: GameState, id: string): string => getChars(s, id).name;
const names = (s: GameState, zone: 'hand' | 'graveyard' | 'library', p: PlayerId): string[] => s.zones[zone][p]!.map((id) => nameOf(s, id));
const bf = (s: GameState, p: PlayerId): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p).map((id) => nameOf(s, id)).sort();
const idOn = (s: GameState, name: string, p?: PlayerId): ObjectId => s.zones.battlefield.find((id) => nameOf(s, id) === name && (p === undefined || s.objects[id]!.controller === p))!;
const idIn = (s: GameState, zone: 'hand' | 'graveyard' | 'library', p: PlayerId, name: string): ObjectId => s.zones[zone][p]!.find((id) => nameOf(s, id) === name)!;
/** The options of the pending choice of objects, by name (the decision must be a choice of objects). */
const offered = (s: GameState): string[] => {
  const p = s.pending as unknown as { kind: string; options: ObjectId[] };
  expect(p.kind).toBe('chooseObjects');
  return p.options.map((id) => nameOf(s, id)).sort();
};

const FOREST = card('Test Forest', 'Land', '');
const MOUNTAIN = card('Test Mountain', 'Land', '');
const SNOWFOREST = card('Test Snowforest', 'Snow Land', '');
const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
const SNOWBEAR = card('Test Snowbear', 'Snow Creature — Bear', '', '{0}', ['2', '2']);
const RELIC = card('Test Relic', 'Artifact', '');

describe('"Look at the top four cards of your library. Put up to two land cards from among them onto the battlefield tapped. Put the rest on the bottom of your library in a random order." (CR 701.20a, 608.2d, 401.4; Cartographer\'s Survey)', () => {
  const SURVEY = card('Test Survey', 'Sorcery', 'Look at the top four cards of your library. Put up to two land cards from among them onto the battlefield tapped. Put the rest on the bottom of your library in a random order.');
  const defs = [SURVEY, FOREST, MOUNTAIN, BEAR, RELIC];
  const start = () => scenario([], { p1: { hand: ['Test Survey'], library: ['Test Forest', 'Test Bear', 'Test Mountain', 'Test Forest', 'Test Relic'] }, p2: {}, defs });
  it('has no manual part', () => expect(full(SURVEY)).toBe(true));
  it('only land cards among the top four are offered; the two chosen enter tapped, everything else goes to the bottom, and the fifth card is never touched', () => {
    let s = cast(start(), 'Test Survey');
    s = passBoth(s);
    const lands = s.zones.library.p1!.filter((id) => nameOf(s, id).startsWith('Test') && getChars(s, id).types.includes('Land')).slice(0, 3);
    expect(offered(s)).toEqual(['Test Forest', 'Test Forest', 'Test Mountain']);
    s = drive(s, { objects: [[lands[0]!, lands[1]!]] });
    expect(bf(s, 'p1')).toEqual(['Test Forest', 'Test Mountain']);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1').every((id) => s.objects[id]!.tapped)).toBe(true);
    const lib = names(s, 'library', 'p1');
    expect(lib[0]).toBe('Test Relic'); // the fifth card of the library is now on top: it was not looked at
    expect(lib.slice(-2).sort()).toEqual(['Test Bear', 'Test Forest']); // the unchosen land and the creature went to the bottom
  });
  it('the negative case: up to two means two at most, and none is allowed (every card goes to the bottom)', () => {
    let s = cast(start(), 'Test Survey');
    s = passBoth(s);
    s = drive(s, { objects: [[]] });
    expect(bf(s, 'p1')).toEqual([]);
    expect(names(s, 'library', 'p1').slice(-4).sort()).toEqual(['Test Bear', 'Test Forest', 'Test Forest', 'Test Mountain']);
  });
});

describe('"Reveal the top four cards of your library. You may put any number of snow permanent cards from among them into your hand. Put the rest into your graveyard." (CR 701.20a, 608.2d, 404.1; Glacial Revelation)', () => {
  const REVEAL = card('Test Revelation', 'Sorcery', 'Reveal the top four cards of your library. You may put any number of snow permanent cards from among them into your hand. Put the rest into your graveyard.');
  const defs = [REVEAL, FOREST, SNOWFOREST, BEAR, SNOWBEAR];
  const start = () => scenario([], { p1: { hand: ['Test Revelation'], library: ['Test Snowforest', 'Test Forest', 'Test Snowbear', 'Test Bear', 'Test Forest'] }, p2: {}, defs });
  it('has no manual part', () => expect(full(REVEAL)).toBe(true));
  it('only snow permanents are offered; the chosen ones go to the hand, the others (chosen or not) go to the graveyard, the fifth card stays', () => {
    let s = cast(start(), 'Test Revelation');
    s = passBoth(s);
    expect(offered(s)).toEqual(['Test Snowbear', 'Test Snowforest']);
    s = drive(s, { objects: [[idIn(s, 'library', 'p1', 'Test Snowbear'), idIn(s, 'library', 'p1', 'Test Snowforest')]] });
    expect(names(s, 'hand', 'p1').sort()).toEqual(['Test Snowbear', 'Test Snowforest']);
    expect(names(s, 'graveyard', 'p1').sort()).toEqual(['Test Bear', 'Test Forest', 'Test Revelation']);
    expect(names(s, 'library', 'p1')[0]).toBe('Test Forest');
  });
  it('the negative case: choosing none puts all four revealed cards into the graveyard', () => {
    let s = cast(start(), 'Test Revelation');
    s = passBoth(s);
    s = drive(s, { objects: [[]] });
    expect(names(s, 'hand', 'p1')).toEqual([]);
    expect(names(s, 'graveyard', 'p1').sort()).toEqual(['Test Bear', 'Test Forest', 'Test Revelation', 'Test Snowbear', 'Test Snowforest']);
  });
});

/** Declare the given attacks on turn 1 (p1) and let combat run with no blocks; every yes/no is answered with `yes`, every choice of objects with `pick`. Stops in main 2. */
function attack(s0: GameState, attacks: { attacker: ObjectId; defender: string }[], pick: (s: GameState) => ObjectId[] = () => [], yes = true): GameState {
  let s = s0;
  for (let i = 0; i < 40 && s.pending?.kind !== 'declareAttackers'; i++) s = act(s, { type: 'pass', player: s.pending!.player });
  s = answer(s, { kind: 'declareAttackers', attacks });
  for (let i = 0; i < 60 && !(s.turn.step === 'main2' && s.zones.stack.length === 0); i++) {
    const p = s.pending;
    if (p?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (p?.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes });
    else if (p?.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: pick(s) });
    else if (p?.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else if (p?.kind === 'priority') s = act(s, { type: 'pass', player: p.player });
    else throw new Error(`unexpected decision ${p?.kind}`);
  }
  return s;
}

describe('"Whenever ~ deals combat damage to a player or planeswalker, look at that many cards ... You may reveal a creature card or Garruk planeswalker card from among them and put it into your hand." (CR 701.20a, 701.20e, 510.2; Garruk\'s Harbinger)', () => {
  const BRUTE = card('Test Brute', 'Creature — Beast', 'Whenever this creature deals combat damage to a player or planeswalker, look at that many cards from the top of your library. You may reveal a creature card or Garruk planeswalker card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.', '{0}', ['2', '2']);
  const GARRUK = card('Test Garruk', 'Legendary Planeswalker — Garruk', '', '{0}');
  const OTHER = card('Test Teferi', 'Legendary Planeswalker — Teferi', '', '{0}');
  const defs = [BRUTE, GARRUK, OTHER, BEAR, RELIC];
  const start = (lib: string[]) => scenario([], { p1: { battlefield: ['Test Brute'], library: lib }, p2: {}, defs });
  it('has no manual part', () => expect(full(BRUTE)).toBe(true));
  it('two damage dealt looks at two cards: a Garruk planeswalker (or a creature) may be taken, an artifact or another planeswalker may not; the third card is untouched', () => {
    const s0 = start(['Test Relic', 'Test Teferi', 'Test Garruk', 'Test Bear']);
    let seen: string[] = [];
    const s = attack(s0, [{ attacker: idOn(s0, 'Test Brute'), defender: 'p2' }], (st) => { seen = offered(st); return []; });
    expect(seen).toEqual([]); // only a Relic and a Teferi were looked at: nothing may be taken (the choice is skipped or empty)
    expect(names(s, 'hand', 'p1')).toEqual([]);
    expect(names(s, 'library', 'p1').slice(-2).sort()).toEqual(['Test Relic', 'Test Teferi']);
    expect(names(s, 'library', 'p1')[0]).toBe('Test Garruk');
  });
  it('a Garruk planeswalker among the cards looked at is offered, and taking it puts it into the hand while the rest go to the bottom', () => {
    const s0 = start(['Test Relic', 'Test Garruk', 'Test Bear']);
    let seen: string[] = [];
    const s = attack(s0, [{ attacker: idOn(s0, 'Test Brute'), defender: 'p2' }], (st) => { seen = offered(st); return [idIn(st, 'library', 'p1', 'Test Garruk')]; });
    expect(seen).toEqual(['Test Garruk']);
    expect(names(s, 'hand', 'p1')).toEqual(['Test Garruk']);
    expect(names(s, 'library', 'p1')[0]).toBe('Test Bear');
    expect(names(s, 'library', 'p1').slice(-1)).toEqual(['Test Relic']);
  });
  it('the negative case: a creature card looked at may be taken too, and without combat damage to a player nothing is looked at', () => {
    const s0 = start(['Test Bear', 'Test Relic', 'Test Garruk']);
    let seen: string[] = [];
    const s = attack(s0, [{ attacker: idOn(s0, 'Test Brute'), defender: 'p2' }], (st) => { seen = offered(st); return [idIn(st, 'library', 'p1', 'Test Bear')]; });
    expect(seen).toEqual(['Test Bear']);
    expect(names(s, 'hand', 'p1')).toEqual(['Test Bear']);
    const none = attack(start(['Test Bear', 'Test Relic']), [], () => { throw new Error('nothing should be looked at'); });
    expect(names(none, 'hand', 'p1')).toEqual([]);
  });
});

describe('"When ~ enters, reveal the top X cards of your library. You may put any number of Aura cards with mana value X or less from among them onto the battlefield. Then put all cards revealed this way that weren\'t put onto the battlefield on the bottom ..." (CR 701.20a, 202.3, 303.4f, 608.2d; Knickknack Ouphe)', () => {
  const OUPHE = card('Test Sprout', 'Creature — Ouphe', 'This creature enters with X +1/+1 counters on it.\nWhen this creature enters, reveal the top X cards of your library. You may put any number of Aura cards with mana value X or less from among them onto the battlefield. Then put all cards revealed this way that weren\'t put onto the battlefield on the bottom of your library in a random order.', '{X}', ['0', '0']);
  const BOON = card('Test Boon', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+1.', '{1}');
  const CURSE = card('Test Hex', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets -1/-1.', '{3}');
  const defs = [OUPHE, BOON, CURSE, BEAR, RELIC];
  const start = () => scenario([], { p1: { hand: ['Test Sprout'], battlefield: ['Plains', 'Plains', 'Test Bear'], library: ['Test Boon', 'Test Hex', 'Test Relic', 'Test Boon'] }, p2: {}, defs });
  it('has no manual part', () => expect(full(OUPHE)).toBe(true));
  it('with X = 2 the top two cards are revealed; only the Aura with mana value 2 or less may enter, the other Aura and the rest go to the bottom, the third card is untouched', () => {
    let s = cast(start(), 'Test Sprout', { x: [2] });
    s = passBoth(s); // the creature spell resolves: it enters with two counters, the trigger goes on the stack
    s = passBoth(s);
    expect(s.pending?.kind).toBe('yesNo'); // "you may"
    s = answer(s, { kind: 'yesNo', yes: true });
    expect(offered(s)).toEqual(['Test Boon']); // the Hex has mana value 3 > X, the Relic is no Aura
    s = drive(s, { objects: [[idIn(s, 'library', 'p1', 'Test Boon')]] });
    s = resolveAll(s);
    expect(bf(s, 'p1')).toEqual(['Plains', 'Plains', 'Test Bear', 'Test Boon', 'Test Sprout'].sort());
    expect(names(s, 'library', 'p1')[0]).toBe('Test Relic');
    expect(names(s, 'library', 'p1').slice(-1)).toEqual(['Test Hex']);
  });
  it('the negative case: declining puts both revealed cards on the bottom', () => {
    let s = cast(start(), 'Test Sprout', { x: [2] });
    s = passBoth(s);
    s = passBoth(s);
    s = drive(s, { yes: [false] }); // declining "you may" leaves both revealed cards for the bottom
    s = resolveAll(s);
    expect(bf(s, 'p1')).toEqual(['Plains', 'Plains', 'Test Bear', 'Test Sprout'].sort());
    expect(names(s, 'library', 'p1')[0]).toBe('Test Relic');
    expect(names(s, 'library', 'p1').slice(-2).sort()).toEqual(['Test Boon', 'Test Hex']);
  });
});

describe('"When ~ enters, discard your hand. Each opponent sacrifices a creature of their choice for each card discarded this way." (CR 701.21a, 701.9a, 608.2c; Malfegor)', () => {
  const DEMON = card('Test Demon', 'Creature — Demon', 'When this creature enters, discard your hand. Each opponent sacrifices a creature of their choice for each card discarded this way.', '{0}', ['3', '3']);
  const defs = [DEMON, BEAR, RELIC];
  const start = (hand: string[], theirs: string[]) => scenario([], { p1: { hand: ['Test Demon', ...hand] }, p2: { battlefield: theirs }, defs });
  it('has no manual part', () => expect(full(DEMON)).toBe(true));
  it('two cards discarded make the opponent sacrifice two creatures of their own choice (one is left of three)', () => {
    let s = cast(start(['Test Relic', 'Test Relic'], ['Test Bear', 'Test Bear', 'Test Bear']), 'Test Demon');
    s = resolveAll(s);
    expect(names(s, 'hand', 'p1')).toEqual([]);
    expect(names(s, 'graveyard', 'p1')).toEqual(['Test Relic', 'Test Relic']);
    expect(bf(s, 'p2')).toEqual(['Test Bear']);
    expect(names(s, 'graveyard', 'p2')).toEqual(['Test Bear', 'Test Bear']);
  });
  it('the negative case: an empty hand discards nothing, so nothing is sacrificed; an opponent with fewer creatures sacrifices all of them', () => {
    const none = resolveAll(cast(start([], ['Test Bear']), 'Test Demon'));
    expect(bf(none, 'p2')).toEqual(['Test Bear']);
    const few = resolveAll(cast(start(['Test Relic', 'Test Relic', 'Test Relic'], ['Test Bear']), 'Test Demon'));
    expect(bf(few, 'p2')).toEqual([]);
    expect(bf(few, 'p1')).toEqual(['Test Demon']); // the controller sacrifices nothing
  });
});

describe('"Choose target creature. Its owner shuffles it into their library, then investigates." (CR 701.24a, 701.16a, 400.3; Blink)', () => {
  const BLINK = card('Test Vanish', 'Sorcery', 'Choose target creature. Its owner shuffles it into their library, then investigates.');
  const defs = [BLINK, BEAR];
  it('has no manual part', () => expect(full(BLINK)).toBe(true));
  it('the owner of the creature (not the caster) shuffles it into their library and gets the Clue', () => {
    const s0 = scenario([], { p1: { hand: ['Test Vanish'] }, p2: { battlefield: ['Test Bear'] }, defs });
    const bear = idOn(s0, 'Test Bear');
    let s = cast(s0, 'Test Vanish', { targets: [[obj(bear)]] });
    s = resolveAll(s);
    expect(bf(s, 'p2')).toEqual(['Clue Token']);
    expect(bf(s, 'p1')).toEqual([]);
    expect(names(s, 'library', 'p2')).toContain('Test Bear');
    expect(s.zones.battlefield.some((id) => nameOf(s, id) === 'Test Bear')).toBe(false);
  });
  it('the negative case: with a creature the caster owns and controls, the caster investigates', () => {
    const s0 = scenario([], { p1: { hand: ['Test Vanish'], battlefield: ['Test Bear'] }, p2: {}, defs });
    let s = cast(s0, 'Test Vanish', { targets: [[obj(idOn(s0, 'Test Bear'))]] });
    s = resolveAll(s);
    expect(bf(s, 'p1')).toEqual(['Clue Token']);
    expect(names(s, 'library', 'p1')).toContain('Test Bear');
  });
});

describe('"Whenever ~ attacks, you may tap two other untapped creatures you control. If you do, ~ can\'t be blocked this turn." (CR 701.26a, 118.12, 509.1; Tidal Terror)', () => {
  const TERROR = card('Test Kraken', 'Creature — Octopus', 'Whenever this creature attacks, you may tap two other untapped creatures you control. If you do, this creature can\'t be blocked this turn.', '{0}', ['4', '4']);
  const defs = [TERROR, BEAR];
  const start = (mine: string[]) => scenario([], { p1: { battlefield: ['Test Kraken', ...mine] }, p2: { battlefield: ['Test Bear'] }, defs });
  /** Attack with the Kraken on turn 1, answer the payment with `yes`, and report whether p2 was asked to declare blockers and how many of p1's Bears are tapped. */
  function attackWith(s0: GameState, yes: boolean): { blockable: boolean; tapped: number; life: number } {
    let s = s0;
    for (let i = 0; i < 40 && s.pending?.kind !== 'declareAttackers'; i++) s = act(s, { type: 'pass', player: s.pending!.player });
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: idOn(s0, 'Test Kraken'), defender: 'p2' }] });
    let blockable = false;
    let tapped = 0;
    for (let i = 0; i < 60 && !(s.turn.step === 'main2' && s.zones.stack.length === 0); i++) {
      const p = s.pending;
      if (p?.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes });
      else if (p?.kind === 'declareBlockers') { blockable = true; s = answer(s, { kind: 'declareBlockers', blocks: [] }); }
      else if (p?.kind === 'priority') s = act(s, { type: 'pass', player: p.player });
      else throw new Error(`unexpected decision ${p?.kind}`);
      if (s.turn.step === 'declareAttackers' && s.zones.stack.length === 0) tapped = Math.max(tapped, s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && nameOf(s, id) === 'Test Bear' && s.objects[id]!.tapped).length);
    }
    return { blockable, tapped, life: s.players.find((x) => x.id === 'p2')!.life };
  }
  it('has no manual part', () => expect(full(TERROR)).toBe(true));
  it('paying by tapping two other untapped creatures makes it unblockable this turn', () => {
    expect(attackWith(start(['Test Bear', 'Test Bear']), true)).toEqual({ blockable: false, tapped: 2, life: 16 });
  });
  it('the negative case: declining the tap leaves it blockable; with only one other creature the cost cannot be paid', () => {
    expect(attackWith(start(['Test Bear', 'Test Bear']), false)).toEqual({ blockable: true, tapped: 0, life: 16 });
    expect(attackWith(start(['Test Bear']), true)).toEqual({ blockable: true, tapped: 0, life: 16 });
  });
});

describe('"Discard X cards, then return a card from your graveyard to your hand for each card discarded this way." (CR 701.9a, 404.1, 608.2c; Recall)', () => {
  const RECALL = card('Test Recollect', 'Sorcery', 'Discard X cards, then return a card from your graveyard to your hand for each card discarded this way. Exile this spell.', '{X}');
  const defs = [RECALL, BEAR, RELIC, FOREST];
  const start = () => scenario([], { p1: { hand: ['Test Recollect', 'Test Relic', 'Test Relic', 'Test Relic'], graveyard: ['Test Bear', 'Test Forest'], battlefield: ['Plains', 'Plains', 'Plains'] }, p2: {}, defs });
  it('has no manual part', () => expect(full(RECALL)).toBe(true));
  it('discarding two cards returns two cards of your graveyard (any of them, the discarded ones included) and the spell is exiled', () => {
    let s = cast(start(), 'Test Recollect', { x: [2] });
    s = resolveAll(s);
    expect(names(s, 'hand', 'p1').length).toBe(1 + 2); // one card was not discarded, two came back
    expect(names(s, 'graveyard', 'p1').length).toBe(2 + 2 - 2); // two original + two discarded - two returned
    expect(s.zones.exile.some((id) => nameOf(s, id) === 'Test Recollect')).toBe(true);
    expect(names(s, 'graveyard', 'p1')).not.toContain('Test Recollect');
  });
  it('the negative case: X = 0 discards nothing and returns nothing', () => {
    let s = cast(start(), 'Test Recollect', { x: [0] });
    s = resolveAll(s);
    expect(names(s, 'hand', 'p1').length).toBe(3);
    expect(names(s, 'graveyard', 'p1').sort()).toEqual(['Test Bear', 'Test Forest']);
  });
});

describe('"When ~ enters, put a +1/+1 counter on each creature that convoked it." (CR 702.51a, 400.7d, 122.1; Venerated Loxodon)', () => {
  const LOX = card('Test Pachyderm', 'Creature — Elephant', 'Convoke\nWhen this creature enters, put a +1/+1 counter on each creature that convoked it.', '{4}{W}', ['4', '4'], ['W']);
  const defs = [LOX, BEAR];
  it('has no manual part', () => expect(full(LOX)).toBe(true));
  const counters = (st: GameState, id: ObjectId): number => st.objects[id]?.counters['+1/+1'] ?? 0;
  /** Cast the Pachyderm from p1's hand, convoking with `convoke`; every other decision at its first option. */
  function castConvoking(s0: GameState, convoke: ObjectId[]): GameState {
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Pachyderm', 'hand', 'p1') });
    let convoked = false;
    for (let k = 0; k < 40 && s.pending && s.pending.kind !== 'priority'; k++) {
      const d = s.pending as unknown as { kind: string; options?: ObjectId[]; min?: number; prompt?: string };
      if (d.kind === 'chooseObjects' && !convoked && /pay part of/.test(d.prompt ?? '')) { s = answer(s, { kind: 'chooseObjects', ids: convoke }); convoked = true; }
      else s = drive(s);
    }
    return resolveAll(s);
  }
  const game = () => scenario([], { p1: { hand: ['Test Pachyderm'], battlefield: ['Plains', 'Plains', 'Plains', 'Test Bear', 'Test Bear', 'Test Bear'] }, p2: {}, defs });
  const game2 = () => scenario([], { p1: { hand: ['Test Pachyderm'], battlefield: ['Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Test Bear'] }, p2: {}, defs });
  it('the creatures tapped to convoke it get a counter when it enters; a creature that did not convoke does not (the Pachyderm itself gets none)', () => {
    const s0 = game();
    const [a, b, c] = s0.zones.battlefield.filter((id) => nameOf(s0, id) === 'Test Bear') as [ObjectId, ObjectId, ObjectId];
    const s = castConvoking(s0, [a, b, c]);
    expect([counters(s, a), counters(s, b), counters(s, c)]).toEqual([1, 1, 1]);
    expect(counters(s, idOn(s, 'Test Pachyderm'))).toBe(0);
    const t = castConvoking(game(), [a, b]);
    expect([counters(t, a), counters(t, b), counters(t, c)]).toEqual([1, 1, 0]);
  });
  it('the negative case: with only two of the three creatures convoking, the third is not marked, and with none convoking nobody is', () => {
    const s0 = game();
    const [a, b, c] = s0.zones.battlefield.filter((id) => nameOf(s0, id) === 'Test Bear') as [ObjectId, ObjectId, ObjectId];
    const s = castConvoking(s0, [b, c]);
    expect([counters(s, a), counters(s, b), counters(s, c)]).toEqual([0, 1, 1]);
    const none = castConvoking(game2(), []);
    expect(counters(none, idOn(none, 'Test Bear'))).toBe(0);
  });
});

describe('"Skip your next turn." (CR 614.10, 500.7; Magosi, the Waterveil)', () => {
  const IDOL = card('Test Eon Idol', 'Artifact', '{T}: Put an eon counter on this artifact. Skip your next turn.');
  const defs = [IDOL];
  it('has no manual part', () => expect(full(IDOL)).toBe(true));
  it('after p1\'s activation the next turn of p1 is skipped: p2 takes turn 2 and turn 3 and p1 is back on turn 4; an unused idol skips nothing', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Eon Idol'] }, p2: {}, defs });
    const idol = idOn(s0, 'Test Eon Idol');
    const used = resolveAll(act(s0, activations(s0, 'Test Eon Idol')[0]!.action));
    expect(used.objects[idol]!.counters['eon']).toBe(1);
    const turn4 = advanceTo(used, 4, 'upkeep');
    expect(turn4.turn.activePlayer).toBe('p1');
    expect(advanceTo(used, 3, 'upkeep').turn.activePlayer).toBe('p2');
    const fresh = advanceTo(scenario([], { p1: { battlefield: ['Test Eon Idol'] }, p2: {}, defs }), 3, 'upkeep');
    expect(fresh.turn.activePlayer).toBe('p1');
  });
});
