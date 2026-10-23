/**
 * Standard round 5, slice r5-fxz: one-shot effects on cards, zones and players, played through applyAction with synthetic cards compiled by the game's default
 * compiler (invented wordings, design 6.10). Nothing is mocked. Each describe names the rules it pins.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { act, answer, find, findAll, legal, life, pass, put, scenario } from '../../m3/scenario';
import { getChars } from '../../../src/rules/characteristics';
import { automated, card, cast, drain, obj, onBattlefield, passTo, settle, yes } from './support';
import { declareAttackers, passUntil, toDeclareAttackers } from '../../m4/helpers';

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2'], '{1}{G}');
const WIPE = card('Test Wipe', 'Sorcery', 'Destroy all creatures.');
const SNUFF = card('Test Snuff', 'Instant', 'Destroy target creature.');
const SWEEP = card('Test Sweep', 'Instant', 'Exile target card from a graveyard.');
const RECRUIT = card('Test Recruit', 'Instant', 'Create a 1/1 white Soldier creature token.');

const atCombat = (turn: number) => (x: GameState): boolean => x.turn.number === turn && x.turn.step === 'beginCombat' && x.zones.stack.length > 0;

describe('CR 603.4, 113.6m: a triggered ability that functions in the graveyard checks its intervening "if" when it triggers and again as it resolves', () => {
  const PHOENIX = card('Test Cinderwing', 'Creature — Phoenix', 'Flying\nAt the beginning of combat on your turn, if two or more creatures died this turn, return this card from your graveyard to the battlefield.', ['3', '2']);
  const GHOUL = card('Test Lonely Ghoul', 'Creature — Zombie', 'At the beginning of your upkeep, if you control no creatures, return this card from your graveyard to the battlefield.', ['2', '2']);
  it('is automated (the trigger functions only in the graveyard, the "if" is checked there)', () => {
    expect(automated(PHOENIX)).toBe(true);
    expect(automated(GHOUL)).toBe(true);
    const t = PHOENIX.faces[0]!.abilities.find((a) => a.kind === 'triggered')!;
    expect(t.kind === 'triggered' && t.zone).toEqual(['graveyard']);
    expect(t.kind === 'triggered' && t.interveningIf).toBeDefined();
  });
  it('after two creatures died this turn it returns from the graveyard at the beginning of combat', () => {
    let s = scenario([], { p1: { graveyard: ['Test Cinderwing'], battlefield: ['Test Bear', 'Test Bear'], hand: ['Test Wipe'] }, defs: [PHOENIX, BEAR, WIPE] });
    s = cast(s, 'Test Wipe');
    expect(findAll(s, 'Test Bear', 'graveyard', 'p1')).toHaveLength(2);
    s = passTo(s, atCombat(1));
    s = drain(s);
    expect(onBattlefield(s, 'Test Cinderwing')).toHaveLength(1);
    expect(findAll(s, 'Test Cinderwing', 'graveyard', 'p1')).toHaveLength(0);
  });
  it('after only one creature died it does not trigger', () => {
    let s = scenario([], { p1: { graveyard: ['Test Cinderwing'], battlefield: ['Test Bear'], hand: ['Test Wipe'] }, defs: [PHOENIX, BEAR, WIPE] });
    s = cast(s, 'Test Wipe');
    s = passTo(s, (x) => x.turn.number === 1 && x.turn.step === 'declareAttackers');
    expect(onBattlefield(s, 'Test Cinderwing')).toHaveLength(0);
    expect(findAll(s, 'Test Cinderwing', 'graveyard', 'p1')).toHaveLength(1);
  });
  it('on the battlefield it does not trigger (it functions only in the graveyard)', () => {
    let s = scenario([], { p1: { battlefield: ['Test Cinderwing', 'Test Bear', 'Test Bear'], hand: ['Test Snuff', 'Test Snuff'] }, defs: [PHOENIX, BEAR, SNUFF] });
    for (const b of onBattlefield(s, 'Test Bear')) s = cast(s, 'Test Snuff', { targets: [[obj(b)]] });
    s = passTo(s, (x) => x.turn.number === 1 && x.turn.step === 'declareAttackers');
    expect(onBattlefield(s, 'Test Cinderwing')).toHaveLength(1);
  });
  it('CR 603.4: when the "if" is false on resolution (a creature entered in response), the card stays in the graveyard', () => {
    let s = scenario([], { p1: { graveyard: ['Test Lonely Ghoul'], hand: ['Test Recruit'] }, defs: [GHOUL, RECRUIT] });
    s = passTo(s, (x) => x.turn.number === 3 && x.turn.step === 'upkeep' && x.zones.stack.length > 0);
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Recruit', 'hand', 'p1') }));
    s = drain(s);
    expect(findAll(s, 'Test Lonely Ghoul', 'graveyard', 'p1')).toHaveLength(1);
    expect(onBattlefield(s, 'Test Lonely Ghoul')).toHaveLength(0);
  });
  it('with the "if" still true it returns at your upkeep', () => {
    let s = scenario([], { p1: { graveyard: ['Test Lonely Ghoul'] }, defs: [GHOUL] });
    s = passTo(s, (x) => x.turn.number === 3 && x.turn.step === 'upkeep' && x.zones.stack.length > 0);
    s = drain(s);
    expect(onBattlefield(s, 'Test Lonely Ghoul')).toHaveLength(1);
  });
  it('CR 400.7: a card exiled from the graveyard in response is a new object and does not return', () => {
    let s = scenario([], { p1: { graveyard: ['Test Lonely Ghoul'], hand: ['Test Sweep'] }, defs: [GHOUL, SWEEP] });
    s = passTo(s, (x) => x.turn.number === 3 && x.turn.step === 'upkeep' && x.zones.stack.length > 0);
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Sweep', 'hand', 'p1') }), { targets: [[obj(find(s, 'Test Lonely Ghoul', 'graveyard', 'p1'))]] });
    s = drain(s);
    expect(findAll(s, 'Test Lonely Ghoul', 'exile')).toHaveLength(1);
    expect(onBattlefield(s, 'Test Lonely Ghoul')).toHaveLength(0);
  });
});

describe('CR 400.7f, 704.5m: "When enchanted creature dies, return this card to its owner\'s hand" finds the Aura in its owner\'s graveyard', () => {
  const DESTINY = card('Test Halo Promise', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +2/+2.\nWhen enchanted creature dies, return this card to its owner\'s hand.');
  function enchanted(extra: { p1Hand?: string[] } = {}): GameState {
    const s = scenario([], { p1: { battlefield: ['Test Bear'], hand: extra.p1Hand ?? [] }, p2: { hand: [] }, defs: [DESTINY, BEAR, SNUFF, SWEEP, WIPE] });
    const aura = put(s, 'p1', 'battlefield', 'Test Halo Promise');
    s.objects[aura]!.attachedTo = onBattlefield(s, 'Test Bear')[0]!;
    return s;
  }
  it('is automated; the moved reference is the Aura\'s new object, not the event\'s', () => {
    expect(automated(DESTINY)).toBe(true);
    expect(JSON.stringify(DESTINY.faces[0]!.abilities)).toContain('{"ref":"self","moved":true}');
  });
  it('when the creature dies, the Aura goes to the graveyard as a state-based action and the trigger returns it to its owner\'s hand', () => {
    let s = enchanted({ p1Hand: ['Test Snuff'] });
    s = cast(s, 'Test Snuff', { targets: [[obj(onBattlefield(s, 'Test Bear')[0]!)]] });
    expect(findAll(s, 'Test Halo Promise', 'hand', 'p1')).toHaveLength(1);
    expect(findAll(s, 'Test Halo Promise', 'graveyard', 'p1')).toHaveLength(0);
    expect(findAll(s, 'Test Bear', 'graveyard', 'p1')).toHaveLength(1);
  });
  it('when the Aura and the creature are destroyed at the same time it returns too', () => {
    let s = enchanted({ p1Hand: ['Test Wipe'] });
    s = cast(s, 'Test Wipe');
    expect(findAll(s, 'Test Halo Promise', 'hand', 'p1')).toHaveLength(1);
  });
  it('CR 400.7: an Aura card exiled from the graveyard before the trigger resolves is not found (it stays in exile)', () => {
    let s = enchanted({ p1Hand: ['Test Snuff', 'Test Sweep'] });
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Snuff', 'hand', 'p1') }), { targets: [[obj(onBattlefield(s, 'Test Bear')[0]!)]] });
    // resolve the destroy only: the trigger goes on the stack
    s = settle(act(act(s, { type: 'pass', player: 'p1' }), { type: 'pass', player: 'p2' }));
    expect(s.zones.stack).toHaveLength(1);
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Sweep', 'hand', 'p1') }), { targets: [[obj(find(s, 'Test Halo Promise', 'graveyard', 'p1'))]] });
    s = drain(s);
    expect(findAll(s, 'Test Halo Promise', 'exile')).toHaveLength(1);
    expect(findAll(s, 'Test Halo Promise', 'hand', 'p1')).toHaveLength(0);
  });
  it('an Aura whose host is merely exiled is still found in the graveyard ("leaves the battlefield")', () => {
    const CHARM = card('Test Tether Charm', 'Enchantment — Aura', 'Enchant creature\nWhen enchanted creature leaves the battlefield, return this card to its owner\'s hand.');
    const BANISH = card('Test Banish', 'Instant', 'Exile target creature.');
    expect(automated(CHARM)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Bear'], hand: ['Test Banish'] }, defs: [CHARM, BEAR, BANISH] });
    const aura = put(s, 'p1', 'battlefield', 'Test Tether Charm');
    s.objects[aura]!.attachedTo = onBattlefield(s, 'Test Bear')[0]!;
    s = cast(s, 'Test Banish', { targets: [[obj(onBattlefield(s, 'Test Bear')[0]!)]] });
    expect(findAll(s, 'Test Tether Charm', 'hand', 'p1')).toHaveLength(1);
  });
});

describe('CR 701.25a, 701.22a, 608.2c: "surveil 2. Then for each card you put on top of your library, you draw a card and you lose 3 life" (eff.r5fxz.forEach.keptOnTop)', () => {
  const REVENANT = card('Test Hungry Shade', 'Creature — Spirit', 'When this creature enters, surveil 2. Then for each card you put on top of your library, you draw a card and you lose 3 life.', ['4', '4']);
  const SEER = card('Test Tide Seer', 'Creature — Merfolk', 'When this creature enters, scry 3. Then for each card you put on top of your library, you gain 2 life.', ['1', '1']);
  const top = (s: GameState, n: number): string[] => s.zones.library['p1']!.slice(0, n);
  it('is automated: the repeat counts the cards the surveil left on top (resultCount of the surveil, kept)', () => {
    expect(automated(REVENANT)).toBe(true);
    expect(JSON.stringify(REVENANT.faces[0]!.abilities)).toMatch(/"op":"repeat","times":\{"q":"resultCount","step":"[^"]+","which":\{"owner":"you","isCard":true\}\}/);
  });
  for (const [binned, drawn] of [[0, 2], [1, 1], [2, 0]] as const) {
    it(`with ${binned} of 2 cards put into the graveyard you draw ${drawn} and lose ${3 * drawn} life`, () => {
      let s = scenario([], { p1: { hand: ['Test Hungry Shade'] }, defs: [REVENANT] });
      const looked = top(s, 2);
      const hand0 = s.zones.hand['p1']!.length;
      s = cast(s, 'Test Hungry Shade', { picks: [looked.slice(0, binned)] });
      expect(s.zones.graveyard['p1']!.length).toBe(binned);
      expect(s.zones.hand['p1']!.length).toBe(hand0 - 1 + drawn);
      expect(life(s, 'p1')).toBe(20 - 3 * drawn);
      expect(life(s, 'p2')).toBe(20);
    });
  }
  it('after a scry, the cards kept on top count (those put on the bottom do not)', () => {
    let s = scenario([], { p1: { hand: ['Test Tide Seer'] }, defs: [SEER] });
    const looked = top(s, 3);
    s = cast(s, 'Test Tide Seer', { picks: [looked.slice(0, 1)] });
    expect(life(s, 'p1')).toBe(24);
  });
  it('a "that many" after a surveil is never read as the cards it left on top (a surveil is no "that many" candidate)', () => {
    const ODD = card('Test Odd Shade', 'Creature — Spirit', 'When this creature enters, surveil 2. Then you draw that many cards.', ['1', '1']);
    expect(JSON.stringify(ODD.faces[0]!.abilities)).not.toContain('resultCount');
  });
});

describe('CR 701.9a, 608.2c, 608.2h: "For each of those opponents who didn\'t discard a card with mana value 3 or greater, ..." counts the targets by what each discarded (eff.r5fxz.forEach.thoseWhoDidntDiscard)', () => {
  const MARAUDER = card('Test Gloom Raider', 'Creature — Specter', 'Flying\nWhen this creature enters, any number of target opponents each discard a card. For each of those opponents who didn\'t discard a card with mana value 3 or greater, you gain 3 life.', ['2', '2']);
  const BIG = card('Test Big Spell', 'Sorcery', 'Draw a card.', undefined, '{3}{U}');
  const SMALL = card('Test Small Spell', 'Instant', 'Draw a card.', undefined, '{U}');
  const p2 = { kind: 'player', id: 'p2' } as const;
  const play = (hand: string[], targets: { kind: 'player'; id: string }[]): GameState => {
    let s = scenario([], { p1: { hand: ['Test Gloom Raider'] }, p2: { hand }, defs: [MARAUDER, BIG, SMALL] });
    s = cast(s, 'Test Gloom Raider', { targets: [targets as never] });
    return drain(s, { picks: [[...s.zones.hand['p2']!].slice(0, 1)] });
  };
  it('is automated; the count names the discard step and its description', () => {
    expect(automated(MARAUDER)).toBe(true);
    expect(JSON.stringify(MARAUDER.faces[0]!.abilities)).toMatch(/"q":"countPlayers","of":\{"ref":"target","id":"t0"\},"didNot":\{"op":"discard","step":"[^"]+","which":\{"manaValue"/);
  });
  it('an opponent who discarded a card with mana value 3 or greater is not counted', () => {
    const s = play(['Test Big Spell'], [p2]);
    expect(findAll(s, 'Test Big Spell', 'graveyard', 'p2')).toHaveLength(1);
    expect(life(s, 'p1')).toBe(20);
  });
  it('an opponent who discarded a card with a smaller mana value is counted', () => {
    const s = play(['Test Small Spell'], [p2]);
    expect(findAll(s, 'Test Small Spell', 'graveyard', 'p2')).toHaveLength(1);
    expect(life(s, 'p1')).toBe(23);
  });
  it('an opponent with no card to discard did not discard such a card and is counted', () => {
    expect(life(play([], [p2]), 'p1')).toBe(23);
  });
  it('with no target chosen nobody is counted', () => {
    expect(life(play(['Test Small Spell'], []), 'p1')).toBe(20);
  });
});

describe('CR 608.2d, 709.5f: "return an enchantment card from your graveyard to your hand or unlock a locked door of a Room you control" (eff.r5fxz.instructionChoice, eff.r5fxz.unlock.lockedDoor.roomYouControl)', () => {
  function room(left: [string, string, string], right: [string, string, string]): CardDef {
    return compileCard({
      name: `${left[0]} // ${right[0]}`, layout: 'split', type_line: 'Enchantment — Room // Enchantment — Room', mana_cost: `${left[1]} // ${right[1]}`, colors: [],
      card_faces: [
        { name: left[0], type_line: 'Enchantment — Room', mana_cost: left[1], oracle_text: left[2] },
        { name: right[0], type_line: 'Enchantment — Room', mana_cost: right[1], oracle_text: right[2] },
      ],
    } as unknown as OracleCard);
  }
  const DANCER = card('Test Veiled Dancer', 'Creature — Spirit', 'Flying\nWhen this creature enters, return an enchantment card from your graveyard to your hand or unlock a locked door of a Room you control.', ['2', '2']);
  const STUDY = room(['Test Study', '{W}', 'When you unlock this door, you gain 3 life.'], ['Test Gallery', '{2}{W}', 'When you unlock this door, draw a card.']);
  const CHARM = card('Test Charm', 'Enchantment', '');
  const option = (s: GameState): string[] => ((s.pending as unknown as { options?: { id: string }[] }).options ?? []).map((o) => o.id);
  function enter(p1: { graveyard?: string[]; battlefield?: string[] }, unlocked?: number[]): GameState {
    const s = scenario([], { p1: { hand: ['Test Veiled Dancer'], ...p1 }, defs: [DANCER, STUDY, CHARM] });
    // set up before the first action: the engine replays the actions from this state (a later mutation is lost)
    if (unlocked !== undefined) for (const id of onBattlefield(s, 'Test Study // Test Gallery')) s.objects[id]!.unlocked = unlocked;
    return settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Veiled Dancer', 'hand', 'p1') }));
  }
  /** Resolve the Dancer and stop at its trigger's choice of instruction. */
  function atChoice(s0: GameState): GameState {
    let s = s0;
    for (let guard = 0; s.pending?.kind === 'priority' && guard < 6; guard++) s = settle(pass(pass(s)));
    return s;
  }
  it('is automated: one choice between the two instructions, made as the ability resolves', () => {
    expect(automated(DANCER)).toBe(true);
    const steps = JSON.stringify(DANCER.faces[0]!.abilities);
    expect(steps).toContain('"op":"chooseValue","who":{"ref":"you"},"what":"option","options":["first","second"]');
    expect(steps).toContain('"lockedDoor":true');
  });
  it('choosing the first instruction returns the enchantment card to your hand and unlocks nothing', () => {
    let s = atChoice(enter({ graveyard: ['Test Charm'], battlefield: ['Test Study // Test Gallery'] }));
    expect(s.pending?.kind).toBe('chooseOption');
    expect(option(s)).toHaveLength(2);
    s = answer(s, { kind: 'chooseOption', ids: [option(s)[0]!] });
    s = drain(settle(s));
    expect(findAll(s, 'Test Charm', 'hand', 'p1')).toHaveLength(1);
    expect(s.objects[onBattlefield(s, 'Test Study // Test Gallery')[0]!]!.unlocked ?? []).toEqual([]);
  });
  it('choosing the second instruction unlocks one locked door of your Room (its "when you unlock this door" triggers) and returns nothing', () => {
    let s = atChoice(enter({ graveyard: ['Test Charm'], battlefield: ['Test Study // Test Gallery'] }));
    s = answer(s, { kind: 'chooseOption', ids: [option(s)[1]!] });
    s = settle(s, { answers: [{ kind: 'chooseOption', ids: [option(s)[0] ?? ''] }] as never });
    s = drain(s, { answers: [{ kind: 'chooseOption', ids: ['0'] }] as never });
    const roomId = onBattlefield(s, 'Test Study // Test Gallery')[0]!;
    expect(s.objects[roomId]!.unlocked ?? []).toHaveLength(1);
    expect(findAll(s, 'Test Charm', 'graveyard', 'p1')).toHaveLength(1);
  });
  it('a Room you control with no locked door cannot be chosen (the filter `lockedDoor`): nothing is unlocked', () => {
    let s = atChoice(enter({ battlefield: ['Test Study // Test Gallery'] }, [0, 1]));
    const roomId = onBattlefield(s, 'Test Study // Test Gallery')[0]!;
    if (s.pending?.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: [option(s).at(-1)!] });
    s = drain(settle(s));
    expect(s.objects[roomId]!.unlocked).toEqual([0, 1]);
    expect(s.zones.stack).toHaveLength(0);
  });
  // wave 8 review: CR 608.2d, "The player can't choose an option that's illegal or impossible"
  it('CR 608.2d: with no Room you control that has a locked door, the unlock is impossible and is not offered: the enchantment card returns without a choice', () => {
    let s = atChoice(enter({ graveyard: ['Test Charm'], battlefield: ['Test Study // Test Gallery'] }, [0, 1]));
    expect(s.pending?.kind === 'chooseOption' && option(s).length === 2).toBe(false);
    s = drain(settle(s));
    expect(findAll(s, 'Test Charm', 'hand', 'p1')).toHaveLength(1);
  });
  it('CR 608.2d: with no enchantment card in your graveyard, the return is impossible and is not offered: a door is unlocked without a choice of instruction', () => {
    let s = atChoice(enter({ battlefield: ['Test Study // Test Gallery'] }));
    // the only choice asked is which locked door to unlock (CR 709.5f), never which instruction
    expect(s.pending?.kind).toBe('chooseOption');
    expect(option(s).every((id) => id.startsWith('unlock:'))).toBe(true);
    s = drain(settle(s, { answers: [{ kind: 'chooseOption', ids: [option(s)[0]!] }] as never }), { answers: [{ kind: 'chooseOption', ids: ['0'] }] as never });
    const roomId = onBattlefield(s, 'Test Study // Test Gallery')[0]!;
    expect(s.objects[roomId]!.unlocked ?? []).toHaveLength(1);
  });
  it('CR 608.2d: with both instructions possible, both are offered', () => {
    const s = atChoice(enter({ graveyard: ['Test Charm'], battlefield: ['Test Study // Test Gallery'] }));
    expect(s.pending?.kind).toBe('chooseOption');
    expect(option(s)).toHaveLength(2);
  });
});

describe('CR 400.7, 110.2a, 205.1a, 613.1d: "Put onto the battlefield under your control all creature cards in your opponents\' graveyards that were put there from the battlefield this turn. They are Food artifacts with ..." (eff.r5fxz.put.bf.yourControl.inverted, eff.r5fxz.they.are.subtype.artifacts.with)', () => {
  const SUPPER = card('Test Web Feast', 'Instant', 'Put onto the battlefield under your control all creature cards in your opponents\' graveyards that were put there from the battlefield this turn. They are Food artifacts with "{2}, {T}, Sacrifice this artifact: You gain 3 life."');
  const MILLER = card('Test Grave Push', 'Instant', 'Target player mills two cards.');
  function play(): GameState {
    let s = scenario([], { p1: { hand: ['Test Snuff', 'Test Web Feast'], battlefield: ['Plains', 'Plains'] }, p2: { battlefield: ['Test Bear'], graveyard: ['Test Bear'] }, defs: [SUPPER, SNUFF, BEAR, MILLER] });
    s = cast(s, 'Test Snuff', { targets: [[obj(onBattlefield(s, 'Test Bear')[0]!)]] });
    expect(findAll(s, 'Test Bear', 'graveyard', 'p2')).toHaveLength(2);
    return cast(s, 'Test Web Feast');
  }
  it('is automated; the cards are those put there from the battlefield this turn (putThereFrom)', () => {
    expect(automated(SUPPER)).toBe(true);
    expect(JSON.stringify(SUPPER.faces[0]!.abilities)).toContain('"putThereThisTurn":true,"putThereFrom":"battlefield"');
  });
  it('only the creature that died this turn comes back, under your control, as a Food artifact that is no longer a creature', () => {
    const s = play();
    const mine = onBattlefield(s, 'Test Bear');
    expect(mine).toHaveLength(1);
    expect(s.objects[mine[0]!]!.controller).toBe('p1');
    const c = getChars(s, mine[0]!);
    expect(c.types).toEqual(['Artifact']);
    expect(c.subtypes).toEqual(['Food']);
    expect(findAll(s, 'Test Bear', 'graveyard', 'p2')).toHaveLength(1); // the card that was there before this turn
  });
  it('the Food it became has the granted ability: {2}, {T}, sacrifice it: you gain 3 life', () => {
    let s = play();
    const food = onBattlefield(s, 'Test Bear')[0]!;
    const ab = legal(s, 'p1', 'activate').find((a) => a.action.type === 'activate' && a.action.source === food);
    expect(ab).toBeDefined();
    s = drain(settle(act(s, ab!.action)));
    expect(life(s, 'p1')).toBe(23);
    expect(onBattlefield(s, 'Test Bear')).toHaveLength(0);
    expect(findAll(s, 'Test Bear', 'graveyard', 'p2')).toHaveLength(2); // a sacrificed card goes to its owner's graveyard (CR 404.1)
  });
});

describe('CR 205.1a, 303.4, 613.1d-f: "Enchanted permanent is a colorless Food artifact with "..." and loses all other card types and abilities" (sta.r5fxz.enchanted.permanent.colorless.artifact.with.losesOthers)', () => {
  const COAT = card('Test Candy Shell', 'Enchantment — Aura', 'Flash\nEnchant creature or Food\nEnchanted permanent is a colorless Food artifact with "{2}, {T}, Sacrifice this artifact: You gain 3 life" and loses all other card types and abilities.');
  const FLIER = card('Test Red Drake', 'Creature — Drake', 'Flying', ['3', '3'], '{2}{R}', ['R']);
  function coated(): GameState {
    const s = scenario([], { p1: { battlefield: ['Plains', 'Plains'] }, p2: { battlefield: ['Test Red Drake', 'Plains', 'Plains'] }, defs: [COAT, FLIER] });
    const aura = put(s, 'p1', 'battlefield', 'Test Candy Shell');
    s.objects[aura]!.attachedTo = onBattlefield(s, 'Test Red Drake')[0]!;
    return s;
  }
  it('is automated', () => {
    expect(automated(COAT)).toBe(true);
  });
  it('the enchanted creature is a colorless Food artifact only: no creature type, no color, no flying, and the granted ability', () => {
    const s = coated();
    const drake = onBattlefield(s, 'Test Red Drake')[0]!;
    const c = getChars(s, drake);
    expect(c.types).toEqual(['Artifact']);
    expect(c.subtypes).toEqual(['Food']);
    expect(c.colors).toEqual([]);
    expect(c.keywords ?? []).not.toContain('flying');
    expect(c.abilities.filter((a) => a.def.kind === 'activated')).toHaveLength(1);
    expect(onBattlefield(s, 'Test Candy Shell')).toHaveLength(1); // still a legal object to enchant: a Food (CR 303.4d, 704.5m)
  });
  it('its controller can sacrifice it for 3 life; then the Aura goes to the graveyard', () => {
    let s = coated();
    s = passTo(s, (x) => x.turn.number === 2 && x.turn.step === 'main1' && x.pending?.player === 'p2');
    const drake = onBattlefield(s, 'Test Red Drake')[0]!;
    const ab = legal(s, 'p2', 'activate').find((a) => a.action.type === 'activate' && a.action.source === drake);
    expect(ab).toBeDefined();
    s = settle(act(s, ab!.action));
    for (let guard = 0; s.zones.stack.length > 0 && guard < 6; guard++) s = settle(pass(pass(s)));
    expect(life(s, 'p2')).toBe(23);
    expect(findAll(s, 'Test Red Drake', 'graveyard', 'p2')).toHaveLength(1);
    expect(findAll(s, 'Test Candy Shell', 'graveyard', 'p1')).toHaveLength(1);
  });
});

describe('CR 303.4f, 303.4g, 301.5c: "Return target Aura or Equipment card from your graveyard to the battlefield attached to a creature you control" (eff.r5fxz.return.targets.bf.attachedTo.creatureYouControl)', () => {
  const RAISE = card('Test Rearm', 'Sorcery', 'Return target Aura or Equipment card from your graveyard to the battlefield attached to a creature you control.');
  const WARD = card('Test Warm Cloak', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+1.');
  const BLADE = card('Test Short Blade', 'Artifact — Equipment', 'Equipped creature gets +2/+0.\nEquip {2}');
  function play(gy: string, bears: number, pick = true): GameState {
    let s = scenario([], { p1: { hand: ['Test Rearm'], graveyard: [gy], battlefield: Array(bears).fill('Test Bear') }, p2: { battlefield: ['Test Bear'] }, defs: [RAISE, WARD, BLADE, BEAR] });
    const mine = s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Bear' && s.objects[id]!.controller === 'p1');
    s = cast(s, 'Test Rearm', { targets: [[obj(find(s, gy, 'graveyard', 'p1'))]], picks: pick && mine.length > 0 ? [[mine[0]!]] : [] });
    return s;
  }
  it('is automated; the creature is chosen as the card enters, not targeted', () => {
    expect(automated(RAISE)).toBe(true);
    expect(RAISE.faces[0]!.abilities[0]!.kind === 'spell' && RAISE.faces[0]!.abilities[0]!.effect.targets).toHaveLength(1);
  });
  it('an Aura returns attached to the creature you chose', () => {
    const s = play('Test Warm Cloak', 1);
    const aura = onBattlefield(s, 'Test Warm Cloak')[0]!;
    expect(s.objects[s.objects[aura]!.attachedTo!]!.controller).toBe('p1');
    expect(Number(getChars(s, s.objects[aura]!.attachedTo!).power)).toBe(3);
  });
  it('an Equipment returns attached to the creature you chose', () => {
    const s = play('Test Short Blade', 1);
    const eq = onBattlefield(s, 'Test Short Blade')[0]!;
    expect(s.objects[eq]!.attachedTo).toBeDefined();
    expect(s.objects[s.objects[eq]!.attachedTo!]!.controller).toBe('p1');
  });
  it('CR 303.4g: with no creature you control the Aura stays in your graveyard (an opponent\'s creature is not a choice)', () => {
    const s = play('Test Warm Cloak', 0);
    expect(findAll(s, 'Test Warm Cloak', 'graveyard', 'p1')).toHaveLength(1);
  });
  it('CR 301.5c: with no creature you control the Equipment enters unattached', () => {
    const s = play('Test Short Blade', 0);
    const eq = onBattlefield(s, 'Test Short Blade')[0]!;
    expect(s.objects[eq]!.attachedTo).toBeUndefined();
  });
});

describe('CR 702.171c, 608.2d: "Then you may return any number of creatures that saddled it this turn to their owner\'s hand" (eff.r5fxz.return.anyNumber.filter.ownersHand)', () => {
  const POSSUM = card('Test Rover Possum', 'Creature — Possum Mount', 'Whenever this creature attacks while saddled, it gets +1/+1 until end of turn. Then you may return any number of creatures that saddled it this turn to their owner\'s hand.\nSaddle 1', ['2', '2']);
  const MOUSE = card('Test Mouse', 'Creature — Mouse', '', ['1', '1']);
  function saddledAttack(returnIds: (ids: { bear: string; mouse: string }) => string[]): { s: GameState; bear: string; mouse: string; possum: string } {
    let s = scenario([], { p1: { battlefield: ['Test Rover Possum', 'Test Bear', 'Test Mouse'] }, defs: [POSSUM, BEAR, MOUSE] });
    const possum = find(s, 'Test Rover Possum', 'battlefield');
    const bear = find(s, 'Test Bear', 'battlefield');
    const mouse = find(s, 'Test Mouse', 'battlefield');
    const la = legal(s, 'p1', 'activate').find((a) => a.object === possum && !a.isMana)!;
    s = drain(settle(act(s, la.action), { picks: [[bear]] }));
    expect(s.objects[possum]!.saddled).toBe(true);
    s = passUntil(declareAttackers(toDeclareAttackers(s), [[possum]]), (x) => x.zones.stack.length > 0, 'the attack trigger');
    s = drain(s, { answers: [yes], picks: [returnIds({ bear, mouse })] });
    return { s, bear, mouse, possum };
  }
  it('is automated', () => {
    expect(automated(POSSUM)).toBe(true);
  });
  it('the creature that saddled it can be returned to its owner\'s hand; the one that did not is not offered', () => {
    const { s } = saddledAttack(({ bear }) => [bear]);
    expect(findAll(s, 'Test Bear', 'hand', 'p1')).toHaveLength(1);
    expect(onBattlefield(s, 'Test Mouse')).toHaveLength(1);
  });
  it('returning none of them is allowed ("any number")', () => {
    const { s } = saddledAttack(() => []);
    expect(onBattlefield(s, 'Test Bear')).toHaveLength(1);
  });
});

describe('CR 608.2d, 608.2f, 101.4: "each opponent chooses a creature they control and exiles it" (eff.r5fxz.eachOpponent.chooses.theyControl.exilesIt)', () => {
  const VOID = card('Test Hollow Star', 'Creature — Horror', 'When this creature enters, each opponent chooses a creature they control and exiles it.', ['3', '3']);
  const OX = card('Test Ox', 'Creature — Ox', '', ['2', '4']);
  it('is automated; the opponent chooses among their own creatures and the chosen one is exiled', () => {
    expect(automated(VOID)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Hollow Star'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Bear', 'Test Ox'] }, defs: [VOID, BEAR, OX] });
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Hollow Star', 'hand', 'p1') }));
    for (let guard = 0; s.pending?.kind === 'priority' && s.zones.stack.length > 0 && guard < 6; guard++) s = settle(pass(pass(s)));
    expect(s.pending?.kind).toBe('chooseObjects');
    expect(s.pending?.player).toBe('p2');
    const options = (s.pending as unknown as { options: string[] }).options;
    expect(options.every((id) => s.objects[id]!.controller === 'p2')).toBe(true);
    expect(options).toHaveLength(2);
    s = drain(answer(s, { kind: 'chooseObjects', ids: [onBattlefield(s, 'Test Ox')[0]!] }));
    expect(findAll(s, 'Test Ox', 'exile')).toHaveLength(1);
    expect(onBattlefield(s, 'Test Bear')).toHaveLength(2);
  });
  it('an opponent with no creature exiles nothing', () => {
    let s = scenario([], { p1: { hand: ['Test Hollow Star'], battlefield: ['Test Bear'] }, defs: [VOID, BEAR] });
    s = cast(s, 'Test Hollow Star');
    expect(onBattlefield(s, 'Test Bear')).toHaveLength(1);
    expect(s.zones.exile).toHaveLength(0);
  });
});

describe('CR 608.2c, 400.3: "... Put the rest into your hand." after a look at the top cards (eff.r5fxz.dig.rest.hand)', () => {
  const SCOUT = card('Test Burrow Scout', 'Sorcery', 'Look at the top three cards of your library. You may put a creature card from among them onto the battlefield. Put the rest into your hand.');
  it('is automated; the cards not put onto the battlefield go to your hand, the library loses the three', () => {
    expect(automated(SCOUT)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Burrow Scout'], library: ['Test Bear', 'Plains', 'Plains'] }, defs: [SCOUT, BEAR] });
    const lib0 = s.zones.library['p1']!.length;
    const top = s.zones.library['p1']!.slice(0, 3);
    const bear = top.find((id) => s.objects[id]!.defId === 'Test Bear')!;
    s = cast(s, 'Test Burrow Scout', { picks: [[bear]], answers: [yes] });
    expect(onBattlefield(s, 'Test Bear')).toHaveLength(1);
    expect(s.zones.hand['p1']!.filter((id) => s.objects[id]!.defId === 'Plains')).toHaveLength(2);
    expect(s.zones.library['p1']!.length).toBe(lib0 - 3);
  });
});

describe('CR 401.2, 608.2c, 406.1: "Look at the top two cards of your library. Exile one of them and put the other into your hand." (eff.r5fxz.dig.exileOne.otherHand)', () => {
  const SEER = card('Test Split Seer', 'Sorcery', 'Look at the top two cards of your library. Exile one of them and put the other into your hand.');
  it('is automated; the card you choose is exiled and the other goes to your hand', () => {
    expect(automated(SEER)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Split Seer'], library: ['Test Bear', 'Plains'] }, defs: [SEER, BEAR] });
    const [first, second] = s.zones.library['p1']!.slice(0, 2);
    const bear = [first, second].find((id) => s.objects[id!]!.defId === 'Test Bear')!;
    s = cast(s, 'Test Split Seer', { picks: [[bear]] });
    expect(findAll(s, 'Test Bear', 'exile')).toHaveLength(1);
    expect(s.zones.hand['p1']!.map((id) => s.objects[id]!.defId)).toEqual(['Plains']);
  });
});
