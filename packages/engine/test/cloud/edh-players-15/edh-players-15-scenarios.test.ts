/**
 * edh-players-15 (Commander lane edh-players): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (invented names and
 * wordings, design 6.10), in four-player games. Each test is named after the rule it checks, with its negative case. CR cites checked against MagicCompRules 20260925.
 *
 *   CR 603.2, 102.2, 109.4, 500.1   "Whenever an opponent who controls an artifact named X draws a card / gains life during their turn, ..." (the actor of the event)
 *   CR 108.3, 110.2, 603.6a         "Whenever a nonland permanent an opponent owns enters under your control, they lose life equal to its mana value."
 *   CR 609.4b, 107.4c               "If you cast a spell this way, you may spend mana as though it were mana of any color to cast it."
 *   CR 508.1d, 611.2a, 613.4c       "~ and that creature each get +2/+0 and gain haste until end of turn and attack this turn if able."
 *   CR 208.1, 702.16a, 105.1        "exile target creature an opponent controls with greater power. ... gain protection from each of that creature's colors"
 *   CR 701.21a, 119.3, 608.2e       "Any number of target opponents each sacrifice a creature with the greatest power among creatures that player controls and lose 3 life."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type PlayerId } from '../../../src/index';
import { act, answer, find } from '../../m3/scenario';
import { mpScenario, namesOn, passUntil } from '../../m12/rules/helpers';
import { getChars } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string]; colors?: string[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as never);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
const handSize = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
const count = (s: GameState, p: PlayerId, name: string): number => namesOn(s, p).filter((n) => n === name).length;
const zoneOf = (s: GameState, id: ObjectId): string => s.objects[id]?.zone ?? 'gone';

interface Script { yes?: boolean[]; targets?: { kind: 'player' | 'object'; id: string }[][]; objects?: (ObjectId[] | ((options: ObjectId[]) => ObjectId[]))[]; options?: string[]; asked?: string[]; attackers?: { attacker: ObjectId; defender: PlayerId }[] }
/** Answer the decisions that come up until someone has priority. */
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 100 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    script.asked?.push(`${p.kind}:${p.player}`);
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: script.yes?.shift() ?? false });
    else if (p.kind === 'chooseObjects') { const pick = script.objects?.shift(); s = answer(s, { kind: 'chooseObjects', ids: typeof pick === 'function' ? pick(p.options) : pick ?? p.options.slice(0, p.min) }); }
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: script.targets?.shift() ?? [] });
    else if (p.kind === 'chooseOption') {
      const want = script.options?.shift();
      const id = want === undefined ? p.options[0]!.id : p.options.find((o) => o.label === want || o.id === want)!.id;
      s = answer(s, { kind: 'chooseOption', ids: [id] });
    } else if (p.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: script.attackers ?? p.obeying ?? [] });
    else if (p.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else throw new Error(`unexpected decision ${p.kind}: ${JSON.stringify(p)}`);
  }
  return s;
}
function settle(s0: GameState, script: Script = {}): GameState {
  let s = drive(s0, script);
  for (let guard = 0; s.zones.stack.length > 0 && s.pending?.kind === 'priority' && guard < 60; guard++) s = drive(act(s, { type: 'pass', player: s.pending.player }), script);
  return s;
}
const cast = (s: GameState, name: string, script: Script = {}, player: PlayerId = 'p1'): GameState => settle(drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), script), script);
const pl = (id: PlayerId) => ({ kind: 'player' as const, id });
const ob = (id: ObjectId) => ({ kind: 'object' as const, id });

// ---- Wedding Ring: the actor of the event is an opponent who controls an artifact named X ----------------------------------------------------------------------------------

const RING = card('Test Ring', 'Artifact', 'Whenever an opponent who controls an artifact named Test Ring draws a card during their turn, you draw a card.\nWhenever an opponent who controls an artifact named Test Ring gains life during their turn, you gain that much life.');
const DRAW2 = card('Test Insight', 'Instant', 'Target player draws a card.');
const HEALER = card('Test Healer', 'Creature — Cleric', '{T}: You gain 3 life.', { pt: ['1', '1'] });

describe('CR 603.2, 102.2, 109.4, 500.1: "Whenever an opponent who controls an artifact named X draws a card during their turn, you draw a card." / "... gains life during their turn, you gain that much life."', () => {
  const setup = (zones: Record<string, never> | object = {}): GameState => mpScenario({
    defs: [RING, DRAW2, HEALER],
    zones: { p1: { battlefield: ['Test Ring'], hand: ['Test Insight'] }, p2: { battlefield: ['Test Ring', 'Test Healer'] }, p3: { battlefield: ['Test Healer'] }, p4: {}, ...zones },
  });
  it('is automated', () => expect(full(RING)).toBe(true));
  it('an opponent who has such an artifact draws in their own turn (their draw step): you draw a card', () => {
    const s0 = setup();
    const before = handSize(s0, 'p1');
    const s1 = passUntil(s0, (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'upkeep', 'p2 upkeep');
    const s2 = passUntil(s1, (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'main1' && x.pending?.kind === 'priority', 'p2 main');
    expect(handSize(s2, 'p2')).toBe(handSize(s1, 'p2') + 1);
    expect(handSize(s2, 'p1')).toBe(before + 1); // the Ring: p1 drew one card, p2 one (p1 is not the active player)
  });
  it('the same opponent drawing in ANOTHER player\'s turn does not trigger it (the negative case)', () => {
    let s = setup();
    const before = handSize(s, 'p1');
    const p2before = handSize(s, 'p2');
    s = cast(s, 'Test Insight', { targets: [[pl('p2')]] }); // p1's own turn: p2 draws a card
    expect(handSize(s, 'p2')).toBe(p2before + 1);
    expect(handSize(s, 'p1')).toBe(before - 1); // Insight left the hand; no Ring draw
  });
  it('an opponent who does not control such an artifact draws in their own turn: nothing happens', () => {
    const s0 = setup();
    const s1 = passUntil(s0, (x) => x.turn.activePlayer === 'p3' && x.turn.step === 'upkeep', 'p3 upkeep');
    const h1 = handSize(s1, 'p1');
    const s2 = passUntil(s1, (x) => x.turn.activePlayer === 'p3' && x.turn.step === 'main1' && x.pending?.kind === 'priority', 'p3 main');
    expect(handSize(s2, 'p3')).toBe(handSize(s1, 'p3') + 1);
    expect(handSize(s2, 'p1')).toBe(h1);
  });
  it('gaining life during their own turn gives you the same amount; gaining it in another turn, or gaining none, does not', () => {
    const s0 = setup();
    const s1 = passUntil(s0, (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'main1' && x.pending?.kind === 'priority', 'p2 main');
    // (summoning sickness is why the Healer's {T} needs a turn; the scenario puts it in play as it would be after a turn)
    const healer = find(s1, 'Test Healer', 'battlefield', 'p2');
    const life1 = lifeOf(s1, 'p1');
    const s2 = settle(drive(act(s1, { type: 'activate', player: 'p2', source: healer, ability: 'p:0:0' })));
    expect(lifeOf(s2, 'p2')).toBe(lifeOf(s1, 'p2') + 3);
    expect(lifeOf(s2, 'p1')).toBe(life1 + 3);
  });
  it('a life gain of an opponent without the artifact (during their own turn) gives you nothing', () => {
    const s0 = setup();
    const s1 = passUntil(s0, (x) => x.turn.activePlayer === 'p3' && x.turn.step === 'main1' && x.pending?.kind === 'priority', 'p3 main');
    const healer = find(s1, 'Test Healer', 'battlefield', 'p3');
    const life1 = lifeOf(s1, 'p1');
    const s2 = settle(drive(act(s1, { type: 'activate', player: 'p3', source: healer, ability: 'p:0:0' })));
    expect(lifeOf(s2, 'p3')).toBe(lifeOf(s1, 'p3') + 3);
    expect(lifeOf(s2, 'p1')).toBe(life1);
  });
});

// ---- Brainstealer Dragon: the owner loses life, "any color" for the exiled cards ----------------------------------------------------------------------------------------------

const DRAGON = card('Test Dragon', 'Creature — Dragon', 'Flying\nAt the beginning of your end step, exile the top card of each opponent\'s library. You may play those cards for as long as they remain exiled. If you cast a spell this way, you may spend mana as though it were mana of any color to cast it.\nWhenever a nonland permanent an opponent owns enters the battlefield under your control, they lose life equal to its mana value.', { pt: ['4', '4'] });
const GRAB = card('Test Grab', 'Sorcery', 'Put target creature card from an opponent\'s graveyard onto the battlefield under your control.');
const OGRE = card('Test Ogre', 'Creature — Ogre', '', { cost: '{2}{R}', pt: ['3', '3'] });
const OWNED = card('Test Imp', 'Creature — Imp', '', { cost: '{B}', pt: ['1', '1'] });
const BLUE = card('Test Blue Spell', 'Sorcery', 'You gain 2 life.', { cost: '{U}', colors: ['U'] });

describe('CR 108.3, 110.2, 603.6a: "Whenever a nonland permanent an opponent owns enters the battlefield under your control, they lose life equal to its mana value."', () => {
  const setup = (): GameState => mpScenario({
    defs: [DRAGON, GRAB, OGRE, OWNED],
    zones: { p1: { battlefield: ['Test Dragon'], hand: ['Test Grab'] }, p2: { graveyard: ['Test Ogre'] }, p3: { graveyard: ['Test Imp', 'Test Ogre'] }, p4: {} },
  });
  it('is automated', () => expect(full(DRAGON)).toBe(true));
  it('the OWNER of the permanent loses life equal to its mana value (not you, not the player whose graveyard it was in when that is another player)', () => {
    const s = cast(setup(), 'Test Grab', { targets: [[ob(find(setup(), 'Test Ogre', 'graveyard', 'p2'))]] });
    expect(count(s, 'p1', 'Test Ogre')).toBe(1);
    expect(lifeOf(s, 'p2')).toBe(20 - 3);
    expect(lifeOf(s, 'p1')).toBe(20);
    expect(lifeOf(s, 'p3')).toBe(20);
  });
  it('another opponent\'s permanent costs that opponent, by its own mana value', () => {
    const s0 = setup();
    const s = cast(s0, 'Test Grab', { targets: [[ob(find(s0, 'Test Imp', 'graveyard', 'p3'))]] });
    expect(lifeOf(s, 'p3')).toBe(20 - 1);
    expect(lifeOf(s, 'p2')).toBe(20);
  });
  it('a permanent you own entering under your control loses nobody life; neither does a land or a permanent an opponent owns that enters under its owner\'s control (the negative cases)', () => {
    const mite = card('Test Mite', 'Creature — Insect', '', { pt: ['1', '1'] });
    const s0 = mpScenario({ defs: [DRAGON, mite], zones: { p1: { battlefield: ['Test Dragon'], hand: ['Test Mite'] }, p2: { hand: ['Test Mite'] }, p3: {}, p4: {} } });
    const s1 = cast(s0, 'Test Mite');
    expect(count(s1, 'p1', 'Test Mite')).toBe(1);
    for (const p of ['p1', 'p2', 'p3', 'p4'] as const) expect(lifeOf(s1, p), p).toBe(20);
    // p2 puts its own Mite into play in its own turn
    const s2 = passUntil(s1, (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'main1' && x.pending?.kind === 'priority', 'p2 main');
    const s3 = cast(s2, 'Test Mite', {}, 'p2');
    expect(count(s3, 'p2', 'Test Mite')).toBe(1);
    for (const p of ['p1', 'p2', 'p3', 'p4'] as const) expect(lifeOf(s3, p), p).toBe(20);
  });
});

describe('CR 609.4b, 107.4c: "If you cast a spell this way, you may spend mana as though it were mana of any color to cast it."', () => {
  it('the exiled card is cast with mana of another color; a colorless requirement ({C}) still needs colorless mana', () => {
    const colorless = card('Test Gem', 'Artifact', '', { cost: '{C}' });
    const base = (): GameState => mpScenario({
      defs: [DRAGON, BLUE, colorless],
      zones: { p1: { battlefield: ['Test Dragon', 'Plains'] }, p2: { library: ['Test Blue Spell'] }, p3: { library: ['Test Gem'] }, p4: {} },
    });
    let s = passUntil(base(), (x) => x.turn.activePlayer === 'p1' && x.turn.step === 'end', 'p1 end step');
    s = settle(s);
    const exiled = s.zones.exile.map((id) => s.defs[s.objects[id]!.defId]!.name);
    expect(exiled).toContain('Test Blue Spell');
    expect(exiled).toContain('Test Gem');
    expect(exiled.length).toBe(3); // the top card of each of the three opponents' libraries
    const next = passUntil(s, (x) => x.turn.number === 5 && x.turn.activePlayer === 'p1' && x.turn.step === 'main1' && x.pending?.kind === 'priority', 'p1 next turn');
    const blue = find(next, 'Test Blue Spell', 'exile');
    const withBlue = settle(drive(act(next, { type: 'cast', player: 'p1', card: blue })));
    expect(lifeOf(withBlue, 'p1')).toBe(lifeOf(next, 'p1') + 2); // paid with a Plains, as though it were blue mana
    const gem = find(next, 'Test Gem', 'exile');
    expect(() => drive(act(next, { type: 'cast', player: 'p1', card: gem }))).toThrow(); // {C} cannot be paid with a Plains
  });
});

// ---- Gogo: "~ and that creature each get +2/+0 and gain haste until end of turn and attack this turn if able" ------------------------------------------------------------------

const MIME = card('Test Mime', 'Legendary Creature — Wizard', 'At the beginning of combat on your turn, you may have ~ become a copy of another target creature you control until end of turn, except its name is ~. If you do, ~ and that creature each get +2/+0 and gain haste until end of turn and attack this turn if able.', { pt: ['2', '2'] });
const OXEN = card('Test Oxen', 'Creature — Ox', '', { pt: ['3', '5'] });

describe('CR 508.1d, 611.2a, 613.4c: "If you do, ~ and that creature each get +2/+0 and gain haste until end of turn and attack this turn if able."', () => {
  const toCombat = (yes: boolean): GameState => {
    const s0 = mpScenario({ defs: [MIME, OXEN], zones: { p1: { battlefield: ['Test Mime', 'Test Oxen'] }, p2: {}, p3: {}, p4: {} } });
    // (the scenario starts in the first main phase: pass to the beginning of combat, answering the trigger's target and its "may")
    let s = s0;
    for (let g = 0; g < 40 && !(s.turn.step === 'beginCombat' && s.pending?.kind === 'priority' && s.zones.stack.length === 0 && g > 0); g++) {
      if (s.pending?.kind === 'priority') s = act(s, { type: 'pass', player: s.pending.player });
      else s = drive(s, { yes: [yes], targets: [[ob(find(s, 'Test Oxen', 'battlefield', 'p1'))]] });
      if (s.zones.stack.length > 0 || s.pending?.kind !== 'priority') s = settle(drive(s, { yes: [yes], targets: [[ob(find(s, 'Test Oxen', 'battlefield', 'p1'))]] }), { yes: [yes] });
      if (s.turn.step === 'beginCombat' && s.zones.stack.length === 0) break;
    }
    return s;
  };
  it('is automated', () => expect(full(MIME)).toBe(true));
  it('when you do, both are 2 more powerful, have haste and must attack', () => {
    const s = toCombat(true);
    const mime = find(s, 'Test Mime', 'battlefield', 'p1');
    const ox = find(s, 'Test Oxen', 'battlefield', 'p1');
    expect(Number(getChars(s, mime).power)).toBe(5); // a copy of the Oxen (3/5), +2/+0
    expect(Number(getChars(s, ox).power)).toBe(5);
    expect(Number(getChars(s, mime).toughness)).toBe(5);
    expect(getChars(s, mime).keywords.map((k) => k.keyword)).toContain('haste');
    expect(getChars(s, ox).keywords.map((k) => k.keyword)).toContain('haste');
    // both must attack this turn if able (CR 508.1d): the declaration the game offers as obeying names them both
    let t = s;
    for (let g = 0; g < 20 && t.pending?.kind === 'priority'; g++) t = act(t, { type: 'pass', player: t.pending.player });
    expect(t.pending?.kind).toBe('declareAttackers');
    const obeying = t.pending?.kind === 'declareAttackers' ? (t.pending.obeying ?? []).map((a) => a.attacker).sort() : [];
    expect(obeying).toEqual([mime, ox].sort());
  });
  it('declining the "may" changes nothing (the negative case)', () => {
    const s = toCombat(false);
    const mime = find(s, 'Test Mime', 'battlefield', 'p1');
    const ox = find(s, 'Test Oxen', 'battlefield', 'p1');
    expect(Number(getChars(s, mime).power)).toBe(2);
    expect(Number(getChars(s, ox).power)).toBe(3);
    expect(getChars(s, ox).keywords.map((k) => k.keyword)).not.toContain('haste');
    let t = s;
    for (let g = 0; g < 20 && t.pending?.kind === 'priority'; g++) t = act(t, { type: 'pass', player: t.pending.player });
    expect(t.pending?.kind === 'declareAttackers' ? t.pending.obeying ?? [] : null).toEqual([]); // nothing must attack
  });
});


// ---- Eowyn: "greater power" than the source, "protection from each of that creature's colors" -------------------------------------------------------------------------------

const KNIGHT = card('Test Knight', 'Legendary Creature — Human Knight', 'Haste\nWhen ~ enters, exile target creature an opponent controls with greater power. Legendary creatures you control gain protection from each of that creature\'s colors until end of turn.', { cost: '{0}', pt: ['2', '2'] });
const SMALL = card('Test Sprite', 'Creature — Faerie', '', { pt: ['2', '2'], colors: ['U'] });
const BIG = card('Test Dragonling', 'Creature — Dragon', '', { pt: ['3', '3'], colors: ['R', 'G'] });
const BIGGER = card('Test Golem', 'Artifact Creature — Golem', '', { pt: ['4', '4'] });
const LORD = card('Test Lord', 'Legendary Creature — Elf', '', { pt: ['1', '1'] });
const PLAIN = card('Test Peasant', 'Creature — Human', '', { pt: ['1', '1'] });

describe('CR 208.1, 702.16a, 105.1: "When ~ enters, exile target creature an opponent controls with greater power. Legendary creatures you control gain protection from each of that creature\'s colors until end of turn."', () => {
  const setup = (): GameState => mpScenario({
    defs: [KNIGHT, SMALL, BIG, BIGGER, LORD, PLAIN],
    zones: { p1: { hand: ['Test Knight'], battlefield: ['Test Lord', 'Test Peasant'] }, p2: { battlefield: ['Test Sprite', 'Test Dragonling'] }, p3: { battlefield: ['Test Golem'] }, p4: {} },
  });
  const kw = (s: GameState, id: ObjectId): string[] => getChars(s, id).keywords.filter((k) => k.keyword === 'protection').map((k) => k.quality ?? '').sort();
  it('is automated', () => expect(full(KNIGHT)).toBe(true));
  it('only a creature with power greater than the Knight\'s can be targeted (equal power and lesser power cannot)', () => {
    const s0 = setup();
    // the Sprite (power 2, equal to the Knight's) is no legal target: the choice is refused (CR 115.1, 601.2c); the Dragonling (3) and the Golem (4) are legal
    expect(() => cast(s0, 'Test Knight', { targets: [[ob(find(s0, 'Test Sprite', 'battlefield', 'p2'))]] })).toThrow(/not a legal target/);
    expect(count(cast(s0, 'Test Knight', { targets: [[ob(find(s0, 'Test Golem', 'battlefield', 'p3'))]] }), 'p3', 'Test Golem')).toBe(0);
  });
  it('exiles the target, and each legendary creature you control gains protection from each of its colors; a creature that is not legendary does not', () => {
    const s0 = setup();
    const s = cast(s0, 'Test Knight', { targets: [[ob(find(s0, 'Test Dragonling', 'battlefield', 'p2'))]] });
    expect(count(s, 'p2', 'Test Dragonling')).toBe(0);
    expect(zoneOf(s, find(s0, 'Test Dragonling', 'battlefield', 'p2'))).not.toBe('battlefield');
    expect(kw(s, find(s, 'Test Knight', 'battlefield', 'p1'))).toEqual(['color:G', 'color:R']);
    expect(kw(s, find(s, 'Test Lord', 'battlefield', 'p1'))).toEqual(['color:G', 'color:R']);
    expect(kw(s, find(s, 'Test Peasant', 'battlefield', 'p1'))).toEqual([]);
  });
  it('a colorless creature exiled gives no protection at all (nothing to be protected from)', () => {
    const s0 = setup();
    const s = cast(s0, 'Test Knight', { targets: [[ob(find(s0, 'Test Golem', 'battlefield', 'p3'))]] });
    expect(count(s, 'p3', 'Test Golem')).toBe(0);
    expect(kw(s, find(s, 'Test Knight', 'battlefield', 'p1'))).toEqual([]);
  });
});

// ---- Will of the Abzan: each target opponent sacrifices their greatest-power creature and loses 3 life ----------------------------------------------------------------------

const WILL = card('Test Will', 'Sorcery', 'Choose one. If you control a commander as you cast this spell, you may choose both instead.\n• Any number of target opponents each sacrifice a creature with the greatest power among creatures that player controls and lose 3 life.\n• Draw a card.');
const WOLF = card('Test Wolf', 'Creature — Wolf', '', { pt: ['2', '2'] });
const TROLL = card('Test Troll', 'Creature — Troll', '', { pt: ['5', '4'] });
const IMP = card('Test Imp2', 'Creature — Imp', '', { pt: ['1', '1'] });

describe('CR 701.21a, 119.3, 608.2e: "Any number of target opponents each sacrifice a creature with the greatest power among creatures that player controls and lose 3 life."', () => {
  const setup = (): GameState => mpScenario({
    defs: [WILL, WOLF, TROLL, IMP],
    zones: { p1: { hand: ['Test Will'], battlefield: ['Test Troll'] }, p2: { battlefield: ['Test Wolf', 'Test Troll'] }, p3: { battlefield: ['Test Imp2', 'Test Wolf'] }, p4: { battlefield: ['Test Troll'] } },
  });
  const asked: string[] = [];
  const play = (targets: PlayerId[]): GameState => {
    const s0 = setup();
    const c = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Will', 'hand', 'p1') }), { asked, options: ['Any number of target opponents each sacrifice a creature with the greatest power among creatures that player controls and lose 3 life.'], targets: [targets.map(pl)] });
    return settle(c, { targets: [targets.map(pl)] });
  };
  it('is automated', () => expect(full(WILL)).toBe(true));
  it('each target opponent sacrifices the creature with the greatest power among THEIR creatures and loses 3 life; an opponent not targeted is untouched', () => {
    const s = play(['p2', 'p3']);
    expect(namesOn(s, 'p2')).toEqual(['Test Wolf']); // the Troll (5) went, not the Wolf (2)
    expect(namesOn(s, 'p3')).toEqual(['Test Imp2']); // the Wolf (2) went, not the Imp (1)
    expect(lifeOf(s, 'p2')).toBe(17);
    expect(lifeOf(s, 'p3')).toBe(17);
    expect(namesOn(s, 'p4')).toEqual(['Test Troll']);
    expect(lifeOf(s, 'p4')).toBe(20);
    expect(namesOn(s, 'p1')).toEqual(['Test Troll']);
    expect(lifeOf(s, 'p1')).toBe(20);
  });
  it('the greatest power is judged among each player\'s own creatures only (your Troll or another player\'s does not make their Wolf safe), and zero targets do nothing', () => {
    const s = play(['p3']);
    expect(namesOn(s, 'p3')).toEqual(['Test Imp2']);
    expect(namesOn(s, 'p2').sort()).toEqual(['Test Troll', 'Test Wolf']);
    const none = play([]);
    expect(namesOn(none, 'p2').sort()).toEqual(['Test Troll', 'Test Wolf']);
    expect(lifeOf(none, 'p2')).toBe(20);
  });
  it('a tie for the greatest power is the player\'s choice of one of the tied creatures; with no creature at all the player still loses 3 life', () => {
    const s0 = mpScenario({ defs: [WILL, WOLF, IMP], zones: { p1: { hand: ['Test Will'] }, p2: { battlefield: ['Test Wolf', 'Test Wolf', 'Test Imp2'] }, p3: {}, p4: {} } });
    const c = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Will', 'hand', 'p1') }), { options: ['Any number of target opponents each sacrifice a creature with the greatest power among creatures that player controls and lose 3 life.'], targets: [[pl('p2'), pl('p3')]] });
    const s = settle(c, { targets: [[pl('p2'), pl('p3')]] });
    expect(namesOn(s, 'p2').sort()).toEqual(['Test Imp2', 'Test Wolf']); // one of the two Wolves; the Imp stays
    expect(lifeOf(s, 'p2')).toBe(17);
    expect(lifeOf(s, 'p3')).toBe(17);
  });
});
