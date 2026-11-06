/**
 * Coordinator D, round edh-d-51 (lane d-rank-1): the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10), compiled by the game's
 * default compiler. Alice (p1) is the active player of turn 1. Each test names the rule it checks, with its negative case. CR cites are from memory (unverified).
 *
 *   CR 613.4b, 608.2h              "you may have ~'s base power and toughness become equal to that creature's power and toughness until end of turn." (Eldrazi Mimic)
 *   CR 406.1, 608.2c, 119.3        "For each creature card exiled this way, you gain 1 life." (The Binding of the Titans)
 *   CR 105.2, 702.35               "Destroy each creature that isn't all colors." (Iridian Maelstrom)
 *   CR 115.1, 701.5a               "Counter up to two target spells and/or abilities." (Katara's Reversal)
 *   CR 700.4, 701.8a               "If that artifact is put into a graveyard this way, ~ deals damage ..." (Tuktuk Scrapper)
 *   CR 702.35b, 118.9              "if its madness cost was paid" (Grave Scrabbler)
 *   CR 608.2d, 601.2, 406.1        "You may cast an Aura spell from among them without paying its mana cost. Then put the rest on the bottom ..." (Herald of Amity)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, hasKeyword, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, battlefieldNames, find, findAll, life, pass, scenario, zoneNames } from '../../m3/scenario';
import { declareAttackers, passUntil, toDeclareAttackers, tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const player = (id: PlayerId): TargetChoice => ({ kind: 'player', id });
const yes: DecisionAnswer = { kind: 'yesNo', yes: true };
const no: DecisionAnswer = { kind: 'yesNo', yes: false };

/** Answer the decisions that come up: targets from `targets`, object choices from `picks`, then `answers`; pay costs automatically; stop at priority. */
function settle(s0: GameState, opts: { targets?: TargetChoice[][]; picks?: ObjectId[][]; answers?: DecisionAnswer[] } = {}): GameState {
  let s = s0;
  const groups = [...(opts.targets ?? [])];
  const picks = [...(opts.picks ?? [])];
  const queue = [...(opts.answers ?? [])];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: [...p.items.map((i: { id: string }) => i.id)] });
    else if (p.kind === 'chooseTargets' && groups.length > 0) s = answer(s, { kind: 'chooseTargets', targets: groups.shift()! });
    else if (p.kind === 'chooseObjects' && picks.length > 0) s = answer(s, { kind: 'chooseObjects', ids: picks.shift()! });
    else if (queue.length > 0) s = answer(s, queue.shift()!);
    else break;
  }
  return s;
}
const cast = (s0: GameState, name: string, opts: Parameters<typeof settle>[1] = {}, who: PlayerId = 'p1'): GameState => settle(act(s0, { type: 'cast', player: who, card: find(s0, name, 'hand', who) }), opts);
/** Both players pass until the stack is empty, answering what comes up. */
function resolveAll(s0: GameState, opts: Parameters<typeof settle>[1] = {}): GameState {
  let s = s0;
  for (let i = 0; i < 12 && s.zones.stack.length > 0; i++) s = settle(pass(pass(s)), opts);
  return s;
}
/** Resolve whatever is on the stack, also triggers that are put on it only when a player would receive priority. */
function drain(s0: GameState, opts: Parameters<typeof settle>[1] = {}): GameState {
  let s = settle(s0, opts);
  for (let i = 0; i < 20; i++) {
    if (s.pending?.kind !== 'priority') { const t = settle(s, opts); if (t === s) break; s = t; continue; }
    if (s.zones.stack.length === 0) { const t = settle(pass(s), opts); if (t.zones.stack.length === 0 && t.turn.step !== s.turn.step) { s = t; break; } s = t; continue; }
    s = settle(pass(pass(s)), opts);
  }
  return s;
}
const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['3', '3'] });
const yard = (s: GameState, p: PlayerId = 'p1'): string[] => zoneNames(s, 'graveyard', p);
const power = (s: GameState, name: string): [number, number] => { const c = getChars(s, find(s, name, 'battlefield')); return [Number(c.power ?? -1), Number(c.toughness ?? -1)]; };
const lifeOf = (s: GameState, p: PlayerId): number => life(s, p);

// ---- Eldrazi Mimic ---------------------------------------------------------------------------------------------------------------------------------------------------
const MIMIC = card('Test Mimic', 'Creature — Eldrazi', "Whenever another colorless creature you control enters, you may have this creature's base power and toughness become equal to that creature's power and toughness until end of turn.", { pt: ['1', '1'] });
const COLOSSUS = card('Test Colossus', 'Creature — Eldrazi', '', { pt: ['4', '5'] });
const REDBEAR = compileCard({ name: 'Test Red Bear', layout: 'normal', mana_cost: '{0}', type_line: 'Creature — Bear', oracle_text: '', colors: ['R'], keywords: [], power: '3', toughness: '3' } as OracleCard);
describe('CR 613.4b, 608.2h: "you may have ~\'s base power and toughness become equal to that creature\'s power and toughness until end of turn." (Eldrazi Mimic)', () => {
  it('is automated', () => { expect(noManual(MIMIC)).toBe(true); });
  it('a colorless creature entering lets the controller set the Mimic to its power and toughness until end of turn, and it ends', () => {
    const s0 = scenario([], { p1: { hand: ['Test Colossus'], battlefield: ['Test Mimic'] }, defs: [MIMIC, COLOSSUS, REDBEAR] });
    let s = cast(s0, 'Test Colossus');
    s = resolveAll(s, { answers: [yes] });
    expect(power(s, 'Test Mimic')).toEqual([4, 5]);
    expect(power(s, 'Test Colossus')).toEqual([4, 5]);
    const t = advanceTo(s, 2, 'main1');
    expect(power(t, 'Test Mimic')).toEqual([1, 1]);
  });
  it('declining leaves it a 1/1; a colored creature entering, or one that enters under the opponent, does not trigger it', () => {
    const s0 = scenario([], { p1: { hand: ['Test Colossus', 'Test Red Bear'], battlefield: ['Test Mimic'] }, defs: [MIMIC, COLOSSUS, REDBEAR] });
    const declined = resolveAll(cast(s0, 'Test Colossus'), { answers: [no] });
    expect(power(declined, 'Test Mimic')).toEqual([1, 1]);
    const colored = resolveAll(cast(s0, 'Test Red Bear'), { answers: [yes] });
    expect(power(colored, 'Test Mimic')).toEqual([1, 1]);
    expect(colored.pending?.kind === 'yesNo').toBe(false);
  });
});

// ---- The Binding of the Titans ----------------------------------------------------------------------------------------------------------------------------------------
const SCOUR = card('Test Scour', 'Sorcery', 'Exile up to two target cards from graveyards. For each creature card exiled this way, you gain 1 life.');
const SCOUR_FWD = card('Test Scour Forward', 'Sorcery', 'Exile up to two target cards from graveyards. You gain 1 life for each creature card exiled this way.');
describe('CR 119.3, 406.1, 608.2c: "For each creature card exiled this way, you gain 1 life." (The Binding of the Titans)', () => {
  it('is automated and is the same as the trailing wording', () => {
    expect(noManual(SCOUR)).toBe(true);
    expect(JSON.stringify(SCOUR.faces[0]!.abilities.map((a) => ({ ...a, text: '' })))).toBe(JSON.stringify(SCOUR_FWD.faces[0]!.abilities.map((a) => ({ ...a, text: '' }))));
  });
  it('two creature cards from different graveyards: 2 life; a land and a creature: 1 life; nothing exiled: 0', () => {
    const base = (): GameState => scenario([], { p1: { hand: ['Test Scour'], graveyard: ['Test Bear', 'Plains'] }, p2: { graveyard: ['Test Bear'] }, defs: [SCOUR, BEAR] });
    const s0 = base();
    const mine = find(s0, 'Test Bear', 'graveyard', 'p1'); const theirs = find(s0, 'Test Bear', 'graveyard', 'p2'); const land = find(s0, 'Plains', 'graveyard', 'p1');
    const two = resolveAll(cast(s0, 'Test Scour', { targets: [[obj(mine), obj(theirs)]] }));
    expect(lifeOf(two, 'p1')).toBe(22);
    expect(two.zones.exile.filter((id) => two.defs[two.objects[id]!.defId]!.name === 'Test Bear').length).toBe(2);
    const mixed = resolveAll(cast(base(), 'Test Scour', { targets: [[obj(find(base(), 'Plains', 'graveyard', 'p1')), obj(find(base(), 'Test Bear', 'graveyard', 'p2'))]] }));
    void land;
    expect(lifeOf(mixed, 'p1')).toBe(21);
    const none = resolveAll(cast(base(), 'Test Scour', { targets: [[]] }));
    expect(lifeOf(none, 'p1')).toBe(20);
  });
});

// ---- Iridian Maelstrom ------------------------------------------------------------------------------------------------------------------------------------------------
const MAELSTROM = card('Test Maelstrom', 'Sorcery', "Destroy each creature that isn't all colors.");
const RAINBOW = compileCard({ name: 'Test Rainbow', layout: 'normal', mana_cost: '{W}{U}{B}{R}{G}', type_line: 'Creature — Dragon', oracle_text: '', colors: ['W', 'U', 'B', 'R', 'G'], keywords: [], power: '5', toughness: '5' } as OracleCard);
const FOURCOLOR = compileCard({ name: 'Test Fourcolor', layout: 'normal', mana_cost: '{W}{U}{B}{R}', type_line: 'Creature — Dragon', oracle_text: '', colors: ['W', 'U', 'B', 'R'], keywords: [], power: '4', toughness: '4' } as OracleCard);
describe('CR 105.2: "Destroy each creature that isn\'t all colors." (Iridian Maelstrom)', () => {
  it('is automated', () => { expect(noManual(MAELSTROM)).toBe(true); });
  it('a five-color creature of either player lives; a four-color, a one-color and a colorless creature die', () => {
    const s0 = scenario([], { p1: { hand: ['Test Maelstrom'], battlefield: ['Test Rainbow', 'Test Fourcolor', 'Test Red Bear'] }, p2: { battlefield: ['Test Rainbow', 'Test Bear'] }, defs: [MAELSTROM, RAINBOW, FOURCOLOR, REDBEAR, BEAR] });
    const s = resolveAll(cast(s0, 'Test Maelstrom'));
    expect(battlefieldNames(s, 'p1')).toEqual(['Test Rainbow']);
    expect(battlefieldNames(s, 'p2')).toEqual(['Test Rainbow']);
    expect(yard(s)).toEqual(expect.arrayContaining(['Test Fourcolor', 'Test Red Bear']));
  });
});

// ---- Katara's Reversal ------------------------------------------------------------------------------------------------------------------------------------------------
const BOON = card('Test Boon', 'Instant', 'You gain 3 life.');
const NEGATE = card('Test Negate', 'Instant', 'Counter up to two target spells and/or abilities.');
describe('CR 115.1, 701.5a: "Counter up to two target spells and/or abilities." (Katara\'s Reversal)', () => {
  it('is automated', () => { expect(noManual(NEGATE)).toBe(true); });
  it('counters both chosen spells but not a third one on the stack', () => {
    const s0 = scenario([], { p1: { hand: ['Test Boon', 'Test Boon', 'Test Boon', 'Test Negate'] }, defs: [BOON, NEGATE] });
    let s = s0;
    for (let i = 0; i < 3; i++) s = settle(act(s, { type: 'cast', player: 'p1', card: findAll(s, 'Test Boon', 'hand', 'p1')[0]! }));
    const boons = s.zones.stack.filter((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Boon');
    expect(boons.length).toBe(3);
    s = cast(s, 'Test Negate', { targets: [[obj(boons[0]!), obj(boons[1]!)]] });
    s = resolveAll(s);
    expect(lifeOf(s, 'p1')).toBe(23);
    expect(yard(s).filter((n) => n === 'Test Boon').length).toBe(3);
  });
});

// ---- Tuktuk Scrapper -----------------------------------------------------------------------------------------------------------------------------------------------
const SCRAPPER = card('Test Scrapper', 'Creature — Goblin Ally', 'Whenever this creature or another Ally you control enters, you may destroy target artifact. If that artifact is put into a graveyard this way, this creature deals damage to that artifact\'s controller equal to the number of Allies you control.', { pt: ['2', '2'] });
const TRINKET = card('Test Trinket', 'Artifact', '');
const IRON = card('Test Ironclad', 'Artifact', 'Indestructible');
describe('CR 700.4, 701.8a: "If that artifact is put into a graveyard this way, ~ deals damage to that artifact\'s controller equal to the number of Allies you control." (Tuktuk Scrapper)', () => {
  it('is automated', () => { expect(noManual(SCRAPPER)).toBe(true); });
  it('destroying an opponent\'s artifact deals damage to that player equal to the Allies you control (with the Scrapper itself)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Scrapper'] }, p2: { battlefield: ['Test Trinket'] }, defs: [SCRAPPER, TRINKET, IRON] });
    const s = resolveAll(cast(s0, 'Test Scrapper'), { targets: [[obj(find(s0, 'Test Trinket', 'battlefield'))]], answers: [yes] });
    expect(zoneNames(s, 'graveyard', 'p2')).toContain('Test Trinket');
    expect(lifeOf(s, 'p2')).toBe(19);
    expect(lifeOf(s, 'p1')).toBe(20);
  });
  it('an indestructible artifact is not put into a graveyard: no damage; declining the destroy: no damage', () => {
    const s0 = scenario([], { p1: { hand: ['Test Scrapper'] }, p2: { battlefield: ['Test Ironclad'] }, defs: [SCRAPPER, TRINKET, IRON] });
    const kept = resolveAll(cast(s0, 'Test Scrapper'), { targets: [[obj(find(s0, 'Test Ironclad', 'battlefield'))]], answers: [yes] });
    expect(battlefieldNames(kept, 'p2')).toContain('Test Ironclad');
    expect(lifeOf(kept, 'p2')).toBe(20);
    const t0 = scenario([], { p1: { hand: ['Test Scrapper'] }, p2: { battlefield: ['Test Trinket'] }, defs: [SCRAPPER, TRINKET, IRON] });
    const declined = resolveAll(cast(t0, 'Test Scrapper'), { targets: [[obj(find(t0, 'Test Trinket', 'battlefield'))]], answers: [no] });
    expect(battlefieldNames(declined, 'p2')).toContain('Test Trinket');
    expect(lifeOf(declined, 'p2')).toBe(20);
  });
});

// ---- Atraxa's Skitterfang ---------------------------------------------------------------------------------------------------------------------------------------------
const OILBOT = card('Test Oilbot', 'Artifact Creature — Insect', 'This creature enters with three oil counters on it.\nAt the beginning of combat on your turn, you may remove an oil counter from this creature. When you do, target creature you control gains your choice of flying, vigilance, deathtouch, or lifelink until end of turn.', { pt: ['1', '1'] });
/** Beginning of combat on turn 1: pass priority with the trigger on the stack, answer its yes/no, target and keyword choice; `pick` is the index of the option chosen. */
function oilCombat(opts: { remove: boolean; pick: number }): GameState {
  const s0 = scenario([], { p1: { battlefield: [{ name: 'Test Oilbot', counters: { oil: 3 } }, 'Test Bear'] }, defs: [OILBOT, BEAR] });
  let s = advanceTo(s0, 1, 'beginCombat');
  for (let i = 0; i < 16 && s.pending; i++) {
    const p = s.pending;
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: opts.remove });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [obj(find(s, 'Test Bear', 'battlefield'))] });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: [p.options[opts.pick]!.id] } as DecisionAnswer);
    else if (p.kind === 'priority' && s.zones.stack.length > 0) s = pass(s);
    else break;
  }
  return s;
}
describe('CR 603.12, 608.2d: "you may remove an oil counter ... When you do, target creature you control gains your choice of flying, vigilance, deathtouch, or lifelink until end of turn." (Atraxa\'s Skitterfang)', () => {
  it('is automated', () => { expect(noManual(OILBOT)).toBe(true); });
  it('removing a counter lets the creature gain the keyword chosen (the third of four), and only that one', () => {
    const s = oilCombat({ remove: true, pick: 2 });
    const bear = getChars(s, find(s, 'Test Bear', 'battlefield'));
    expect(hasKeyword(bear, 'deathtouch')).toBe(true);
    for (const k of ['flying', 'vigilance', 'lifelink']) expect(hasKeyword(bear, k), k).toBe(false);
    expect(s.objects[find(s, 'Test Oilbot', 'battlefield')]!.counters['oil']).toBe(2);
  });
  it('the fourth option is lifelink; declining the removal gives nothing and keeps all three counters', () => {
    const s = oilCombat({ remove: true, pick: 3 });
    expect(hasKeyword(getChars(s, find(s, 'Test Bear', 'battlefield')), 'lifelink')).toBe(true);
    const n = oilCombat({ remove: false, pick: 0 });
    expect(hasKeyword(getChars(n, find(n, 'Test Bear', 'battlefield')), 'flying')).toBe(false);
    expect(n.objects[find(n, 'Test Oilbot', 'battlefield')]!.counters['oil']).toBe(3);
  });
});

// ---- Herald of Amity ---------------------------------------------------------------------------------------------------------------------------------------------------
const HERALD = card('Test Herald', 'Creature — Griffin', 'When this creature enters, exile the top eight cards of your library. You may cast an Aura spell from among them without paying its mana cost. Then put the rest on the bottom of your library in a random order.', { pt: ['2', '2'] });
const AURA = card('Test Aura', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +2/+2.');
function heraldGame(take: boolean): GameState {
  const s0 = scenario([], { p1: { hand: ['Test Herald'], battlefield: ['Test Bear'], library: ['Test Aura', 'Test Bear', 'Test Bear', 'Test Bear', 'Test Bear', 'Test Bear', 'Test Bear', 'Test Bear'] }, defs: [HERALD, AURA, BEAR] });
  let s = cast(s0, 'Test Herald');
  for (let i = 0; i < 20 && (s.pending || s.zones.stack.length > 0); i++) {
    const p = s.pending;
    if (!p) break;
    if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: take ? [p.options.find((o: string) => s.defs[s.objects[o]!.defId]!.name === 'Test Aura') ?? p.options[0]!] : [] });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [obj(find(s, 'Test Bear', 'battlefield'))] });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: take });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'priority' && s.zones.stack.length > 0) s = pass(s);
    else break;
  }
  return s;
}
describe('CR 608.2d, 118.9, 406.1: "exile the top eight cards ... You may cast an Aura spell from among them without paying its mana cost. Then put the rest on the bottom of your library in a random order." (Herald of Amity)', () => {
  it('is automated', () => { expect(noManual(HERALD)).toBe(true); });
  it('casting the Aura puts it onto the battlefield on a creature; the other seven exiled cards go to the bottom of the library, none stays in exile', () => {
    const s = heraldGame(true);
    expect(s.zones.exile.length).toBe(0);
    expect(battlefieldNames(s, 'p1')).toContain('Test Aura');
    const lib = s.zones.library.p1!.map((id) => s.defs[s.objects[id]!.defId]!.name);
    expect(lib.filter((n) => n === 'Test Bear').length).toBe(7);
    expect(lib.slice(-7)).toEqual(Array(7).fill('Test Bear'));
  });
  it('review: an Aura that is chosen but cannot be cast (no legal target) stays in exile no longer: it goes to the bottom with the rest', () => {
    const ART = card('Test Art Aura', 'Enchantment — Aura', 'Enchant artifact\nEnchanted artifact gets +1/+1.');
    const s0 = scenario([], { p1: { hand: ['Test Herald'], battlefield: ['Test Bear'], library: ['Test Art Aura', 'Test Bear', 'Test Bear', 'Test Bear', 'Test Bear', 'Test Bear', 'Test Bear', 'Test Bear'] }, defs: [HERALD, ART, BEAR] });
    let s = cast(s0, 'Test Herald');
    for (let i = 0; i < 20 && s.pending; i++) {
      const p = s.pending;
      if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: [p.options.find((o: string) => s.defs[s.objects[o]!.defId]!.name === 'Test Art Aura') ?? p.options[0]!] });
      else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
      else if (p.kind === 'priority' && s.zones.stack.length > 0) s = pass(s);
      else break;
    }
    expect(s.zones.exile.length).toBe(0);
    expect(s.zones.library.p1!.map((id) => s.defs[s.objects[id]!.defId]!.name).filter((n) => n === 'Test Art Aura').length).toBe(1);
  });
  it('not casting it: all eight exiled cards (the Aura too) go to the bottom of the library', () => {
    const s = heraldGame(false);
    expect(s.zones.exile.length).toBe(0);
    expect(battlefieldNames(s, 'p1')).not.toContain('Test Aura');
    expect(s.zones.library.p1!.map((id) => s.defs[s.objects[id]!.defId]!.name).filter((n) => n === 'Test Aura').length).toBe(1);
  });
});

// ---- Grave Scrabbler ---------------------------------------------------------------------------------------------------------------------------------------------------
const SCRABBLER = card('Test Scrabbler', 'Creature — Zombie', 'Madness {0}\nWhen this creature enters, if its madness cost was paid, you may return target creature card from a graveyard to its owner\'s hand.', { pt: ['2', '2'] });
describe('CR 702.35b, 603.4: "When this creature enters, if its madness cost was paid, you may return target creature card from a graveyard to its owner\'s hand." (Grave Scrabbler)', () => {
  it('is automated', () => { expect(noManual(SCRABBLER)).toBe(true); });
  const start = (): GameState => scenario(['Faithless Looting', 'Mountain'], { p1: { hand: ['Faithless Looting', 'Test Scrabbler', 'Plains'], battlefield: ['Mountain'] }, p2: { graveyard: ['Test Bear'] }, defs: [SCRABBLER, BEAR] });
  it('discarded and cast for its madness cost, its enter trigger returns a creature card of any graveyard to its owner\'s hand', () => {
    const s0 = start();
    const bear = find(s0, 'Test Bear', 'graveyard', 'p2');
    const picks = [find(s0, 'Test Scrabbler', 'hand'), find(s0, 'Plains', 'hand')];
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Faithless Looting', 'hand') }), {});
    s = resolveAll(s, { picks: [picks], answers: [yes], targets: [[obj(bear)]] });
    s = drain(s, { answers: [yes], targets: [[obj(bear)]] });
    expect(battlefieldNames(s, 'p1')).toContain('Test Scrabbler');
    expect(zoneNames(s, 'hand', 'p2')).toContain('Test Bear');
  });
  it('cast from the hand for its mana cost instead, the trigger does not happen (no intervening-if: CR 603.4)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Scrabbler'] }, p2: { graveyard: ['Test Bear'] }, defs: [SCRABBLER, BEAR] });
    const s = drain(cast(s0, 'Test Scrabbler'), { answers: [yes], targets: [[obj(find(s0, 'Test Bear', 'graveyard', 'p2'))]] });
    expect(battlefieldNames(s, 'p1')).toContain('Test Scrabbler');
    expect(zoneNames(s, 'graveyard', 'p2')).toContain('Test Bear');
    expect(zoneNames(s, 'hand', 'p2')).not.toContain('Test Bear');
  });
});
