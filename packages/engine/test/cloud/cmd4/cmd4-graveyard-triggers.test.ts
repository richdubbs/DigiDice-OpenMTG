/**
 * Commander batch, slice cmd4: triggered abilities that function only in the graveyard because their effect moves the card out of it (CR 113.6m), played
 * through the engine with synthetic cards compiled by the game's default compiler (invented names and wordings, design 6.10). Each test is named after the
 * rule it checks.
 *
 *   CR 113.6m   "At the beginning of your upkeep, you may return ~ from your graveyard to your hand." triggers from the graveyard only
 *   CR 603.3a   the controller of a triggered ability of a card in a graveyard is its owner ("you may pay {G}. If you do, ...")
 *   CR 400.7    a card that left the graveyard before the ability resolves is a new object: the ability does not move it; the returned permanent is a new
 *               object, and "It gains haste" is about that permanent
 *   CR 303.4    an Aura returned "attached to that creature" enchants it; with the creature gone it stays in the graveyard
 *   CR 603.4    an intervening "if" keeps the ability manual (this parser version automates only the plain shape)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type OracleCard, type PlayerId } from '../../../src/index';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { ENGINE_CAPABILITIES } from '../../../src/model';
import { card as oracle } from '../../m5/templates/support';
import { act, advanceTo, answer, find, legal, pass, scenario } from '../../m3/scenario';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const OPTS = defaultParseOptions({ capabilities: ENGINE_CAPABILITIES });
const faceOf = (type: string, text: string) => parseCard(oracle('Trial Subject', type, text), OPTS).faces[0]!;
const zoneOf = (s: GameState, name: string, owner: PlayerId): string[] => [
  ...(['hand', 'graveyard', 'library'] as const).filter((z) => s.zones[z][owner]!.some((id) => s.objects[id]!.defId === name)),
  ...(s.zones.exile.some((id) => s.objects[id]!.defId === name) ? ['exile'] : []),
  ...(s.zones.battlefield.some((id) => s.objects[id]!.defId === name) ? ['battlefield'] : []),
];

/** Answer the decisions until priority: payments automatic, yes to every "you may", the first options and the given targets. */
function drive(s0: GameState, targets: { kind: 'object'; id: string }[][] = [], yes = true): GameState {
  let s = s0;
  const q = [...targets];
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.shift() ?? [] });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: p.options.slice(0, p.min).map((o) => o.id) });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.max) });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
const resolveTop = (s: GameState, yes = true): GameState => drive(pass(pass(s)), [], yes);

const NABOB = card('Test Nabob', 'Creature — Goblin', 'At the beginning of your upkeep, you may return this creature from your graveyard to your hand.', { pt: ['1', '1'], cost: '{2}' });
const ADMIRER = card('Test Admirer', 'Creature — Elf', 'Whenever you cast a creature spell, you may pay {G}. If you do, return this card from your graveyard to your hand.', { pt: ['2', '2'], cost: '{3}' });
const PUP = card('Test Pup', 'Creature — Dog', '', { pt: ['1', '1'] });
const PURGE = card('Test Purge', 'Instant', 'Exile target card from a graveyard.');
const SHROUD = card('Test Shroud', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +2/+2.\nWhenever a Dog you control enters, you may return this card from your graveyard to the battlefield attached to that creature.');
const EMBER = card('Test Ember', 'Creature — Phoenix', 'Whenever you cast a creature spell, you may pay {R}. If you do, return this card from your graveyard to the battlefield. It gains haste until end of turn.', { pt: ['2', '1'], cost: '{3}' });
const SMITE = card('Test Smite', 'Instant', 'Destroy target creature.');
const DEFS = [NABOB, ADMIRER, PUP, PURGE, SHROUD, EMBER, SMITE];

describe('CR 113.6m: a triggered ability whose effect moves ~ out of the graveyard is automated and functions only there', () => {
  it('is understood: a triggered ability with zone graveyard, its move of ~ rendered "from your graveyard" (G6)', () => {
    for (const d of [NABOB, ADMIRER, SHROUD, EMBER]) expect(noManual(d), d.name).toBe(true);
    const f = faceOf('Creature — Goblin', 'At the beginning of your upkeep, you may return ~ from your graveyard to your hand.');
    expect(f.abilities[0]).toMatchObject({ kind: 'triggered', zone: ['graveyard'] });
    expect(f.gate.every((g) => g.ok)).toBe(true);
  });
  // r5-cost (merge wave 8: also r5-fxz's reading, folded into r5-cost's): an intervening "if" of a graveyard trigger is read now (parser/lower/ability.ts; played in test/cloud/r5-cost/graveyard-attack-return.test.ts)
  it('CR 603.4: with an intervening "if" the ability is automated, functions in the graveyard and keeps the condition (r5-cost)', () => {
    const f = faceOf('Creature — Goblin', 'At the beginning of your upkeep, if you control a Forest, you may return ~ from your graveyard to your hand.');
    expect(f.abilities[0]).toMatchObject({ kind: 'triggered', zone: ['graveyard'], interveningIf: { cond: 'exists' } });
  });
  it('CR 113.6m: "This ability also triggers if ~ is in your graveyard" (both zones) is not automated by this reading', () => {
    const f = faceOf('Creature — Goblin', 'When ~ enters, you gain 2 life. This ability also triggers if ~ is in your graveyard.');
    expect(f.abilities.some((a) => a.kind === 'manual')).toBe(true);
  });
});

describe('CR 113.6m, 603.3a: "At the beginning of your upkeep, you may return ~ from your graveyard to your hand."', () => {
  it('CR 113.6m: from its owner\'s graveyard it triggers at its owner\'s upkeep and returns the card', () => {
    const s0 = scenario([], { defs: DEFS, p1: { graveyard: ['Test Nabob'] } });
    let s = advanceTo(s0, 3, 'upkeep');
    expect(s.zones.stack.length).toBe(1);
    s = resolveTop(s);
    expect(zoneOf(s, 'Test Nabob', 'p1')).toEqual(['hand']);
  });
  it('CR 603.3a: it is its owner\'s ability: it triggers at its owner\'s upkeep, controlled by its owner, and not at the other player\'s', () => {
    const s0 = scenario([], { defs: DEFS, p2: { graveyard: ['Test Nabob'] } });
    let s = advanceTo(s0, 2, 'upkeep');
    expect(s.zones.stack.length).toBe(1);
    expect(s.objects[s.zones.stack[0]!]!.controller).toBe('p2');
    s = resolveTop(s, false); // Bob declines
    expect(zoneOf(s, 'Test Nabob', 'p2')).toEqual(['graveyard']);
    s = advanceTo(s, 3, 'upkeep');
    expect(s.zones.stack.length).toBe(0);
  });
  it('CR 113.6m: on the battlefield it does not trigger', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Nabob'] } });
    const s = advanceTo(s0, 3, 'upkeep');
    expect(s.zones.stack.length).toBe(0);
  });
  it('CR 603.5: "you may" lets the owner decline; the card stays in the graveyard', () => {
    const s0 = scenario([], { defs: DEFS, p1: { graveyard: ['Test Nabob'] } });
    const s = resolveTop(advanceTo(s0, 3, 'upkeep'), false);
    expect(zoneOf(s, 'Test Nabob', 'p1')).toEqual(['graveyard']);
  });
});

describe('CR 113.6m, 603.3a, 400.7: "Whenever you cast a creature spell, you may pay {G}. If you do, return ~ from your graveyard to your hand."', () => {
  const castPup = (s: GameState): GameState => drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Pup', 'hand', 'p1') }));
  it('CR 603.3a: casting a creature spell triggers it from the graveyard; its owner pays {G} and gets the card back', () => {
    const s0 = scenario(['Forest'], { defs: DEFS, p1: { graveyard: ['Test Admirer'], hand: ['Test Pup'], battlefield: ['Forest'] } });
    let s = castPup(s0);
    expect(s.zones.stack.length).toBe(2); // the creature spell and the trigger above it
    s = resolveTop(s);
    expect(zoneOf(s, 'Test Admirer', 'p1')).toEqual(['hand']);
    expect(s.objects[find(s, 'Forest', 'battlefield', 'p1')]!.tapped).toBe(true);
  });
  it('CR 113.6m: on the battlefield it does not trigger', () => {
    const s0 = scenario(['Forest'], { defs: DEFS, p1: { battlefield: ['Test Admirer', 'Forest'], hand: ['Test Pup'] } });
    const s = castPup(s0);
    expect(s.zones.stack.length).toBe(1);
  });
  it('CR 400.7: exiled in response, the card is a new object the resolving ability does not return', () => {
    const s0 = scenario(['Forest'], { defs: DEFS, p1: { graveyard: ['Test Admirer'], hand: ['Test Pup', 'Test Purge'], battlefield: ['Forest'] } });
    let s = castPup(s0);
    const gy = find(s, 'Test Admirer', 'graveyard', 'p1');
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Purge', 'hand', 'p1') }), [[{ kind: 'object', id: gy }]]);
    s = resolveTop(s); // the exile spell
    expect(zoneOf(s, 'Test Admirer', 'p1')).toEqual(['exile']);
    s = resolveTop(s); // the trigger: nothing to return
    expect(zoneOf(s, 'Test Admirer', 'p1')).toEqual(['exile']);
    expect(legal(s, 'p1').length).toBeGreaterThan(0);
  });
});

describe('CR 113.6m, 303.4: "Whenever a Dog you control enters, you may return ~ from your graveyard to the battlefield attached to that creature."', () => {
  const castPup = (s: GameState): GameState => drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Pup', 'hand', 'p1') }));
  it('CR 303.4: the Aura returns attached to the creature that entered', () => {
    const s0 = scenario([], { defs: DEFS, p1: { graveyard: ['Test Shroud'], hand: ['Test Pup'] } });
    let s = resolveTop(castPup(s0)); // the Dog resolves and enters; the trigger goes on the stack
    expect(s.zones.stack.length).toBe(1);
    s = resolveTop(s);
    const aura = find(s, 'Test Shroud', 'battlefield', 'p1');
    expect(s.objects[aura]!.attachedTo).toBe(find(s, 'Test Pup', 'battlefield', 'p1'));
  });
  it('CR 303.4: with the creature gone before the ability resolves, the Aura stays in the graveyard', () => {
    const s0 = scenario([], { defs: DEFS, p1: { graveyard: ['Test Shroud'], hand: ['Test Pup', 'Test Smite'] } });
    let s = resolveTop(castPup(s0));
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Smite', 'hand', 'p1') }), [[{ kind: 'object', id: find(s, 'Test Pup', 'battlefield', 'p1') }]]);
    s = resolveTop(s); // the Dog is destroyed
    s = resolveTop(s); // the trigger
    expect(zoneOf(s, 'Test Shroud', 'p1')).toEqual(['graveyard']);
  });
});

describe('CR 113.6m, 400.7: "you may pay {R}. If you do, return ~ from your graveyard to the battlefield. It gains haste until end of turn."', () => {
  it('CR 400.7: "it" is the permanent the card became: the returned creature has haste', () => {
    const s0 = scenario(['Mountain'], { defs: DEFS, p1: { graveyard: ['Test Ember'], hand: ['Test Pup'], battlefield: ['Mountain'] } });
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Pup', 'hand', 'p1') }));
    s = resolveTop(s);
    const ember = find(s, 'Test Ember', 'battlefield', 'p1');
    expect(hasKeyword(getChars(s, ember)!, 'haste')).toBe(true);
  });
});

describe('CR 603.10a, 603.6c: "Whenever another creature dies, you may return ~ from your graveyard to your hand." looks back in time', () => {
  const GHOUL = card('Test Ghoul', 'Creature — Zombie', 'Whenever another creature dies, you may return this card from your graveyard to your hand.', { pt: ['1', '1'] });
  const WRATH = card('Test Wrath', 'Sorcery', 'Destroy all creatures.');
  const wrath = (p1: { battlefield: string[]; graveyard?: string[] }): GameState => {
    const s0 = scenario([], { defs: [GHOUL, PUP, WRATH], p1: { hand: ['Test Wrath'], ...p1 } });
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Wrath', 'hand', 'p1') }));
    for (let i = 0; i < 6 && s.zones.stack.length > 0; i++) s = resolveTop(s);
    return s;
  };
  it('is understood: a triggered ability that functions in the graveyard', () => expect(GHOUL.faces[0]!.abilities[0]).toMatchObject({ kind: 'triggered', zone: ['graveyard'] }));
  it('CR 603.10a: in the graveyard as another creature dies, it triggers and returns the card', () => {
    expect(zoneOf(wrath({ battlefield: ['Test Pup'], graveyard: ['Test Ghoul'] }), 'Test Ghoul', 'p1')).toEqual(['hand']);
  });
  it('CR 603.10a: dying at the same time as the other creature, it does not trigger (before the event its ability was on the battlefield, where it does not function)', () => {
    expect(zoneOf(wrath({ battlefield: ['Test Ghoul', 'Test Pup'] }), 'Test Ghoul', 'p1')).toEqual(['graveyard']);
  });
});
