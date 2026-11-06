/**
 * edh-next-109 (concept lane walkers-small): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (invented
 * names and wordings, design 6.10), in four-player games. Each test is named after the rule it checks, with its negative case. CR cites are from memory (unverified:
 * no rules/cr in a cloud checkout); the rulings were fetched from Scryfall in the cloud session.
 *
 *   CR 110.2, 400.7            "each creature that entered the battlefield under your control this turn": entered under YOUR control, not controlled by you now (Shaile)
 *   CR 119.4, 107.3, 608.2h    "you may pay X life, where X is ... If you do, create an X/X token" (Tivash)
 *   CR 120.3, 608.2h           "deals damage to target player equal to N and you gain that much life": the amount stated, not the damage dealt (Kaya, ruling 2019-01-25)
 *   CR 119.4, 118.3            "Whenever you pay life, put that many blood counters" (Font of Agonies)
 *   CR 702.143d, 406.3         "Exile it face down. It becomes foretold." (The Foretold Soldier)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type Action, type CardDef, type GameState, type ObjectId, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, answer, find, findAll } from '../../m3/scenario';
import { mpScenario, passUntil } from '../../m12/rules/helpers';
import { getChars } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string]; colors?: string[]; keywords?: string[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: opts.keywords ?? [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as never);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id }) as TargetChoice;
const pl = (id: PlayerId): TargetChoice => ({ kind: 'player', id }) as TargetChoice;
const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
const tokensOf = (s: GameState, p: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === p);
const counters = (s: GameState, id: ObjectId, kind: string): number => s.objects[id]!.counters[kind] ?? 0;

interface Script { yes?: boolean[]; targets?: TargetChoice[][]; numbers?: number[] }
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 100 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: script.yes?.shift() ?? false });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.min) });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: script.targets?.shift() ?? [] });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: p.options.slice(0, p.min).map((o) => o.id) });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: script.numbers?.shift() ?? p.min });
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
const activate = (s: GameState, name: string, script: Script = {}, player: PlayerId = 'p1'): GameState =>
  settle(drive(act(s, { type: 'activate', player, source: find(s, name, 'battlefield', player), ability: 'p:0:0' } as never), script), script);

// ---- Shaile: entered under your control this turn -------------------------------------------------------------------------------------------------------------------

const RALLY = card('Test Rally Banner', 'Artifact', '{T}: Put a +1/+1 counter on each creature that entered the battlefield under your control this turn.');
const NEWBIE = card('Test Newcomer', 'Creature — Soldier', '', { pt: ['1', '1'] });
const OLDTIMER = card('Test Oldtimer', 'Creature — Soldier', '', { pt: ['1', '1'] });
const GIFT = card('Test Gift Horse', 'Sorcery', 'Each opponent creates a 1/1 white Soldier creature token.');
const THREATEN = card('Test Takeover', 'Sorcery', 'Gain control of target creature.');

describe('CR 110.2, 400.7: "each creature that entered the battlefield under your control this turn"', () => {
  const setup = (): GameState => mpScenario({
    defs: [RALLY, NEWBIE, OLDTIMER, GIFT, THREATEN],
    zones: { p1: { hand: ['Test Newcomer', 'Test Gift Horse', 'Test Takeover'], battlefield: ['Test Rally Banner', 'Test Oldtimer'] }, p2: { battlefield: ['Test Oldtimer'] } },
  });
  it('is automated', () => { expect(full(RALLY)).toBe(true); expect(full(NEWBIE)).toBe(true); });
  it('counts only the creature that entered under your control this turn (not one already there, not an opponent\'s)', () => {
    let s = cast(setup(), 'Test Newcomer');
    const newbie = find(s, 'Test Newcomer', 'battlefield', 'p1');
    const mine = find(s, 'Test Oldtimer', 'battlefield', 'p1');
    const theirs = find(s, 'Test Oldtimer', 'battlefield', 'p2');
    s = activate(s, 'Test Rally Banner');
    expect(counters(s, newbie, '+1/+1')).toBe(1);
    expect(counters(s, mine, '+1/+1')).toBe(0);
    expect(counters(s, theirs, '+1/+1')).toBe(0);
  });
  it('negative: a token that entered under an opponent\'s control gets nothing, even after you gain control of it (entered under THEIR control)', () => {
    let s = cast(setup(), 'Test Gift Horse');
    const token = tokensOf(s, 'p2')[0]!;
    expect(token).toBeDefined();
    s = cast(s, 'Test Takeover', { targets: [[obj(token)]] });
    expect(s.objects[token]!.controller).toBe('p1');
    s = activate(s, 'Test Rally Banner');
    expect(counters(s, token, '+1/+1')).toBe(0);
  });
});

// ---- Tivash: pay X life, where X is ..., then an X/X token ----------------------------------------------------------------------------------------------------------

const DEMON = card('Test Soul Broker', 'Creature — Demon', 'At the beginning of your end step, if you gained life this turn, you may pay X life, where X is the amount of life you gained this turn. If you do, create an X/X black Demon creature token with flying.', { pt: ['1', '1'] });
const SIP = card('Test Sip', 'Sorcery', 'You gain 3 life.');
const toEnd = (s: GameState): GameState => passUntil(s, (x) => x.turn.step === 'end' && x.pending?.kind === 'priority', 'end step');

describe('CR 119.4, 107.3, 608.2h: "you may pay X life, where X is the amount of life you gained this turn. If you do, create an X/X ... token"', () => {
  const setup = (): GameState => mpScenario({ defs: [DEMON, SIP], zones: { p1: { hand: ['Test Sip'], battlefield: ['Test Soul Broker'] } } });
  const tokens = (s: GameState): ObjectId[] => tokensOf(s, 'p1');
  it('is automated', () => expect(full(DEMON)).toBe(true));
  it('paying: life goes down by the life gained and a 3/3 flying Demon token arrives', () => {
    let s = cast(setup(), 'Test Sip');
    expect(lifeOf(s, 'p1')).toBe(23);
    s = drive(toEnd(s), { yes: [true] });
    s = settle(s, { yes: [true] });
    expect(lifeOf(s, 'p1')).toBe(20);
    const [t] = tokens(s);
    expect(t).toBeDefined();
    const c = getChars(s, t!);
    expect([c.power, c.toughness]).toEqual(['3', '3']);
    expect(c.keywords.map((k) => k.keyword)).toContain('flying');
  });
  it('negative: declining pays nothing and makes no token', () => {
    let s = cast(setup(), 'Test Sip');
    s = settle(drive(toEnd(s), { yes: [false] }), { yes: [false] });
    expect(lifeOf(s, 'p1')).toBe(23);
    expect(tokens(s)).toHaveLength(0);
  });
  it('negative: no life gained this turn means the trigger never happens', () => {
    let s = setup();
    s = settle(drive(toEnd(s), { yes: [true] }), { yes: [true] });
    expect(lifeOf(s, 'p1')).toBe(20);
    expect(tokens(s)).toHaveLength(0);
  });
});

// ---- Kaya: the damage dealt is the life gained ----------------------------------------------------------------------------------------------------------------

const SIPHON = card('Test Siphon', 'Sorcery', '~ deals damage to target player equal to the number of cards that player owns in exile and you gain that much life.');
const WARD = card('Test Warding Charm', 'Enchantment', 'Prevent all damage that would be dealt to you.');

describe('CR 120.3, 608.2c: "~ deals damage to target player equal to N and you gain that much life"', () => {
  const setup = (withWard = false): GameState => mpScenario({
    defs: [SIPHON, WARD],
    zones: { p1: { hand: ['Test Siphon'] }, p2: { exile: ['Plains', 'Plains', 'Plains'], battlefield: withWard ? ['Test Warding Charm'] : [] } },
  });
  it('is automated', () => expect(full(SIPHON)).toBe(true));
  it('damage equal to the cards the player owns in exile, and the same much life', () => {
    const s = cast(setup(), 'Test Siphon', { targets: [[pl('p2')]] });
    expect(lifeOf(s, 'p2')).toBe(17);
    expect(lifeOf(s, 'p1')).toBe(23);
  });
  it('cards the player owns in exile only: the caster\'s own exiled cards are not counted', () => {
    const s0 = mpScenario({ defs: [SIPHON], zones: { p1: { hand: ['Test Siphon'], exile: ['Plains', 'Plains'] }, p2: { exile: ['Plains'] } } });
    const s = cast(s0, 'Test Siphon', { targets: [[pl('p2')]] });
    expect(lifeOf(s, 'p2')).toBe(19);
    expect(lifeOf(s, 'p1')).toBe(21);
  });
  it('ruling 2019-01-25: the life gained is the number counted even if the damage is prevented ("that much" = the amount stated, not the damage dealt)', () => {
    expect(full(WARD)).toBe(true);
    const s = cast(setup(true), 'Test Siphon', { targets: [[pl('p2')]] });
    expect(lifeOf(s, 'p2')).toBe(20); // the damage was prevented
    expect(lifeOf(s, 'p1')).toBe(23); // still gains the stated 3
  });
  it('negative: an amount read for each opponent stays manual (no single stated number)', () => {
    expect(full(card('Test Each Siphon', 'Sorcery', "~ deals damage to each opponent equal to the number of cards in that player's hand and you gain that much life."))).toBe(false);
  });
  it('negative: a fixed amount is not read ("deals 3 damage ... and you gain that much life" stays manual)', () => {
    expect(full(card('Test Fixed Siphon', 'Sorcery', '~ deals 3 damage to target player and you gain that much life.'))).toBe(false);
  });
});

// ---- Font of Agonies: whenever you pay life ------------------------------------------------------------------------------------------------------------------------

const FONT = card('Test Blood Font', 'Enchantment', 'Whenever you pay life, put that many blood counters on ~.');
const PRICK = card('Test Pinprick', 'Artifact', 'Pay 2 life: Draw a card.');
const BLEED = card('Test Bleed', 'Sorcery', 'You lose 3 life.');
const FOE_PRICK = card('Test Foe Pinprick', 'Artifact', 'Pay 2 life: Draw a card.');

describe('CR 119.4, 118.3: "Whenever you pay life, put that many blood counters on ~."', () => {
  const setup = (): GameState => mpScenario({ defs: [FONT, PRICK, BLEED, FOE_PRICK], zones: { p1: { hand: ['Test Bleed'], battlefield: ['Test Blood Font', 'Test Pinprick'] }, p2: { battlefield: ['Test Foe Pinprick'] } } });
  it('is automated', () => { expect(full(FONT)).toBe(true); expect(full(PRICK)).toBe(true); });
  it('paying 2 life as a cost puts 2 blood counters on it', () => {
    let s = setup();
    const font = find(s, 'Test Blood Font', 'battlefield', 'p1');
    s = activate(s, 'Test Pinprick');
    expect(lifeOf(s, 'p1')).toBe(18);
    expect(counters(s, font, 'blood')).toBe(2);
  });
  it('negative: losing life is not paying life', () => {
    let s = setup();
    const font = find(s, 'Test Blood Font', 'battlefield', 'p1');
    s = cast(s, 'Test Bleed');
    expect(lifeOf(s, 'p1')).toBe(17);
    expect(counters(s, font, 'blood')).toBe(0);
  });
  it('negative: an opponent paying life does not trigger it (only "you")', () => {
    let s = setup();
    const font = find(s, 'Test Blood Font', 'battlefield', 'p1');
    s = passUntil(s, (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'main1' && x.pending?.kind === 'priority', 'p2 main');
    s = activate(s, 'Test Foe Pinprick', {}, 'p2');
    expect(lifeOf(s, 'p2')).toBe(18);
    expect(counters(s, font, 'blood')).toBe(0);
  });
});

// ---- The Foretold Soldier: it becomes foretold ----------------------------------------------------------------------------------------------------------------

const SOLDIER = card('Test Hidden Vow', 'Creature — Soldier', '{0}: Exile ~ face down. It becomes foretold.\nForetell {1}{G}', { pt: ['2', '2'], keywords: ['Foretell'] });
const SNEAK = card('Test Open Vow', 'Creature — Soldier', '{0}: Exile ~. It becomes foretold.', { pt: ['2', '2'] });

describe('CR 702.143a, 406.3: "Exile it face down. It becomes foretold."', () => {
  const setup = (): GameState => mpScenario({ defs: [SOLDIER, SNEAK], zones: { p1: { battlefield: ['Test Hidden Vow', 'Test Open Vow'] } } });
  it('is automated', () => expect(full(SOLDIER)).toBe(true));
  it('the card exiled face down is foretold (marked with this turn)', () => {
    let s = setup();
    s = activate(s, 'Test Hidden Vow');
    const id = findAll(s, 'Test Hidden Vow', 'exile', 'p1')[0]!;
    expect(id).toBeDefined();
    expect(s.objects[id]!.faceDown).toBe(true);
    expect(s.objects[id]!.chosen?.['foretold']).toBe(s.turn.number);
    expect(s.objects[id]!.revealedTo ?? []).toEqual(['p1']); // CR 702.143d: only its owner may look at it
  });
  it('it can be cast from exile for its foretell cost on a later turn, not the turn it became foretold (CR 702.143a)', () => {
    const castable = (x: GameState): Action | undefined => legalActions(x, 'p1').find((a) => a.kind === 'cast' && a.object !== undefined && x.defs[x.objects[a.object]!.defId]!.name === 'Test Hidden Vow' && (a.action as { method?: string }).method === 'foretell')?.action;
    let s = mpScenario({ defs: [SOLDIER, SNEAK], zones: { p1: { battlefield: ['Test Hidden Vow', 'Forest', 'Forest'] } }, cards: ['Forest'] });
    s = activate(s, 'Test Hidden Vow');
    expect(castable(s)).toBeUndefined();
    s = passUntil(s, (x) => x.turn.activePlayer === 'p1' && x.turn.number > s.turn.number && x.turn.step === 'main1' && x.pending?.kind === 'priority', 'p1 next turn');
    expect(castable(s)).toBeDefined();
  });
  it('negative: a card exiled face UP does not become foretold', () => {
    let s = setup();
    expect(full(SNEAK)).toBe(true);
    s = activate(s, 'Test Open Vow', {}, 'p1');
    const ids = findAll(s, 'Test Open Vow', 'exile', 'p1');
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(s.objects[id]!.chosen?.['foretold']).toBeUndefined();
  });
});

// ---- Basri Ket: a delayed trigger on "one or more creatures attack" with "that many" -------------------------------------------------------------------------------

const MARCH = card('Test Rallying March', 'Sorcery', 'Whenever one or more nontoken creatures attack this turn, create that many 1/1 white Soldier creature tokens that are tapped and attacking.');
const GRUNT = card('Test Grunt', 'Creature — Soldier', '', { pt: ['1', '1'] });
const HASTY = card('Test Hasty Recruit', 'Sorcery', 'Create a 1/1 white Soldier creature token with haste.');

describe('CR 603.7, 603.2c, 508.1: "Whenever one or more nontoken creatures attack this turn, create that many ... tokens that are tapped and attacking."', () => {
  const setup = (): GameState => mpScenario({ defs: [MARCH, GRUNT, HASTY], zones: { p1: { hand: ['Test Rallying March', 'Test Hasty Recruit'], battlefield: ['Test Grunt', 'Test Grunt', 'Test Grunt'] } } });
  const toAttack = (s0: GameState): GameState => {
    let s = s0;
    for (let g = 0; g < 60 && s.pending?.kind !== 'declareAttackers'; g++) s = act(s, { type: 'pass', player: s.pending!.player });
    return s;
  };
  const attackWith = (s: GameState, n: number): GameState => {
    const grunts = findAll(s, 'Test Grunt', 'battlefield', 'p1').slice(0, n);
    return settle(answer(s, { kind: 'declareAttackers', attacks: grunts.map((g) => ({ attacker: g, defender: 'p2' as PlayerId })) }));
  };
  it('is automated', () => expect(full(MARCH)).toBe(true));
  it('two attackers make two tapped, attacking Soldier tokens (as many as the creatures that attacked)', () => {
    let s = cast(setup(), 'Test Rallying March');
    s = attackWith(toAttack(s), 2);
    const tokens = tokensOf(s, 'p1');
    expect(tokens).toHaveLength(2);
    for (const t of tokens) expect(s.objects[t]!.tapped).toBe(true);
    for (const t of tokens) expect(s.combat?.attackers.some((a) => a.id === t)).toBe(true);
  });
  it('one attacker makes one token', () => {
    let s = cast(setup(), 'Test Rallying March');
    s = attackWith(toAttack(s), 1);
    expect(tokensOf(s, 'p1')).toHaveLength(1);
  });
  it('negative: an attacking token is not counted ("nontoken creatures"): two Grunts and one token attacking make two tokens, not three', () => {
    let s = cast(cast(setup(), 'Test Hasty Recruit'), 'Test Rallying March');
    const before = tokensOf(s, 'p1');
    expect(before).toHaveLength(1);
    const grunts = findAll(s, 'Test Grunt', 'battlefield', 'p1').slice(0, 2);
    s = toAttack(s);
    s = settle(answer(s, { kind: 'declareAttackers', attacks: [...grunts, before[0]!].map((g) => ({ attacker: g, defender: 'p2' as PlayerId })) }));
    expect(tokensOf(s, 'p1')).toHaveLength(3); // the haste token that attacked plus two new ones
  });
  it('negative: without the spell, attacking makes no tokens', () => {
    const s = attackWith(toAttack(setup()), 2);
    expect(tokensOf(s, 'p1')).toHaveLength(0);
  });
});
