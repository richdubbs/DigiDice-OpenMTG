/**
 * edh-d-78 (concept lane life-totals): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (invented names and
 * wordings, design 6.10), in four-player games. Each test is named after the rule it checks, with its negative case. Scryfall rulings were fetched in the cloud session;
 * the CR cites are from memory unless the line says they were checked (no rules/cr in a cloud checkout).
 *
 *   CR 119.3, 119.8, 608.2c            "If no life is lost this way, <effect>" (Blitzwing, Cruel Tormentor): the instruction before it made nobody lose life
 *   CR 603.4, 205.2a, 103.4, 104.2b     "At the beginning of your upkeep, if there are five colors among permanents you control, there are six or more card types among permanents you control
 *                                       and/or cards in your graveyard, and your life total is greater than or equal to your starting life total, you win the game." (Happily Ever After)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, answer, find } from '../../m3/scenario';
import { mpScenario, passUntil } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string]; colors?: string[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as never);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const pl = (id: PlayerId): TargetChoice => ({ kind: 'player', id }) as TargetChoice;
const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
const nameOf = (s: GameState, id: string): string => s.defs[s.objects[id]!.defId]!.name;
const inZone = (s: GameState, name: string, zone: 'hand' | 'graveyard' | 'battlefield', p?: PlayerId): number =>
  (zone === 'battlefield' ? s.zones.battlefield : s.zones[zone][p!]!).filter((id) => nameOf(s, id) === name).length;

interface Script { yes?: boolean[]; targets?: TargetChoice[][]; options?: string[][]; objects?: (string[] | ((options: string[], s: GameState) => string[]))[] }
/** Answer the decisions that come up until someone has priority. */
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 100 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: script.yes?.shift() ?? false });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: script.targets?.shift() ?? [] });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: script.options?.shift() ?? p.options.slice(0, p.min).map((o) => o.id) });
    else if (p.kind === 'chooseObjects') { const pick = script.objects?.shift(); s = answer(s, { kind: 'chooseObjects', ids: typeof pick === 'function' ? pick(p.options as string[], s) : pick ?? (p.options as string[]).slice(0, p.min) }); }
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else throw new Error(`unexpected decision ${p.kind}: ${JSON.stringify(p)}`);
  }
  return s;
}
/** Everyone passes until the stack is empty again, answering what comes up. */
function settle(s0: GameState, script: Script = {}): GameState {
  let s = drive(s0, script);
  for (let guard = 0; s.zones.stack.length > 0 && s.pending?.kind === 'priority' && guard < 60; guard++) s = drive(act(s, { type: 'pass', player: s.pending.player }), script);
  return s;
}
const cast = (s: GameState, name: string, script: Script = {}, player: PlayerId = 'p1'): GameState => settle(drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), script), script);

// ---- Blitzwing: "If no life is lost this way" ----------------------------------------------------------------------------------------------------------------------------

const SIPHON = card('Test Siphon', 'Sorcery', 'Target opponent loses life equal to the life that player lost this turn. If no life is lost this way, draw a card.');
const SAP = card('Test Sap', 'Sorcery', 'Target opponent loses 3 life.');
describe('CR 119.3, 608.2c: "If no life is lost this way, draw a card."', () => {
  const setup = (): GameState => mpScenario({ defs: [SIPHON, SAP], zones: { p1: { hand: ['Test Siphon', 'Test Sap'] } } });
  it('is automated', () => expect(full(SIPHON)).toBe(true));
  it('the opponent lost no life this turn: they lose none, so the controller draws', () => {
    const before = setup();
    const s = cast(before, 'Test Siphon', { targets: [[pl('p2')]] });
    expect(lifeOf(s, 'p2')).toBe(20);
    expect(s.zones.hand.p1!.length).toBe(before.zones.hand.p1!.length); // Test Siphon left the hand (-1), one card was drawn (+1)
  });
  it('the opponent lost 3 life this turn: they lose 3 more, so the controller does not draw (the negative case); other opponents are untouched', () => {
    const before = setup();
    let s = cast(before, 'Test Sap', { targets: [[pl('p2')]] });
    expect(lifeOf(s, 'p2')).toBe(17);
    const hand = s.zones.hand.p1!.length;
    s = cast(s, 'Test Siphon', { targets: [[pl('p2')]] });
    expect(lifeOf(s, 'p2')).toBe(14);
    expect(lifeOf(s, 'p3')).toBe(20);
    expect(s.zones.hand.p1!.length).toBe(hand - 1);
  });
});

// ---- Happily Ever After: an intervening "if" with three conditions, one of them over the union of two sets ---------------------------------------------------------------------

const TRIUMPH = card('Test Triumph', 'Enchantment', 'At the beginning of your upkeep, if there are five colors among permanents you control, there are six or more card types among permanents you control and/or cards in your graveyard, and your life total is greater than or equal to your starting life total, you win the game.');
const COLORS = ['W', 'U', 'B', 'R', 'G'];
const CREATURES = COLORS.map((c) => card(`Test Mage ${c}`, 'Creature — Wizard', '', { pt: ['1', '1'], colors: [c], cost: `{${c}}` }));
const RELIC = card('Test Relic', 'Artifact', '');
const FLASH = card('Test Flash', 'Instant', '');
const RITE = card('Test Rite', 'Sorcery', '');
describe('CR 603.4, 205.2a, 103.4, 104.2b: "..., if there are five colors among permanents you control, there are six or more card types among permanents you control and/or cards in your graveyard, and your life total is greater than or equal to your starting life total, you win the game."', () => {
  const mages = COLORS.map((c) => ({ name: `Test Mage ${c}` }));
  const setup = (o: { mine?: string[]; theirs?: string[]; mageColors?: number; life?: number } = {}): GameState => {
    const s = mpScenario({
      defs: [TRIUMPH, ...CREATURES, RELIC, FLASH, RITE],
      zones: {
        p1: { battlefield: [{ name: 'Test Triumph' }, { name: 'Test Relic' }, 'Plains', ...mages.slice(0, o.mageColors ?? 5)], graveyard: o.mine ?? ['Test Flash', 'Test Rite'] },
        p2: { graveyard: o.theirs ?? [] },
      },
      ...(o.life !== undefined ? { setup: (g: GameState) => { g.players[0]!.life = o.life!; } } : {}),
    });
    return passUntil(s, (x) => x.turn.number === 5 && x.turn.step === 'upkeep' && x.pending?.kind === 'priority', 'upkeep of turn 5');
  };
  const resolve = (s0: GameState): GameState => settle(s0);
  it('is automated', () => expect(full(TRIUMPH)).toBe(true));
  it('five colors, six card types (creature, artifact, land, enchantment from the battlefield, instant and sorcery from your graveyard) and 20 life: you win', () => {
    const s = resolve(setup());
    expect(s.result?.winner).toBe('p1');
  });
  it('a card type in both sets counts once: the creature card in your graveyard adds nothing, so five types do not win (the negative case)', () => {
    const s = resolve(setup({ mine: ['Test Flash', 'Test Mage W'] }));
    expect(s.result).toBeNull();
  });
  it('only YOUR graveyard counts: an opponent\'s sorcery card does not make the sixth type (the negative case)', () => {
    const s = resolve(setup({ mine: ['Test Flash'], theirs: ['Test Rite'] }));
    expect(s.result).toBeNull();
  });
  it('four colors do not win, however many types there are (the negative case)', () => {
    const s = resolve(setup({ mageColors: 4 }));
    expect(s.result).toBeNull();
  });
  it('19 life is below the starting life total of 20 (the negative case); 20 wins and a higher total wins too', () => {
    expect(resolve(setup({ life: 19 })).result).toBeNull();
    expect(resolve(setup({ life: 25 })).result?.winner).toBe('p1');
  });
});

// ---- Transmute Artifact: sacrifice, search, compare mana values, pay the difference ---------------------------------------------------------------------------------------

const TRANSMUTE = card('Test Transmute', 'Sorcery', "Sacrifice an artifact. If you do, search your library for an artifact card. If that card's mana value is less than or equal to the sacrificed artifact's mana value, put it onto the battlefield. If it's greater, you may pay {X}, where X is the difference. If you do, put it onto the battlefield. If you don't, put it into its owner's graveyard. Then shuffle.");
const gizmo = (n: number) => card(`Test Gizmo ${n}`, 'Artifact', '', { cost: `{${n}}` });
describe('CR 701.21a, 701.23, 608.2c, 118.12, 202.3: "Sacrifice an artifact. If you do, search ... If it\'s greater, you may pay {X}, where X is the difference. If you do, ... If you don\'t, ..."', () => {
  const defs = [TRANSMUTE, gizmo(1), gizmo(2), gizmo(4)];
  const setup = (lands = 0, extraBf: string[] = ['Test Gizmo 2']): GameState => mpScenario({
    defs,
    zones: { p1: { hand: ['Test Transmute'], battlefield: [...extraBf.map((name) => ({ name })), ...Array.from({ length: lands }, () => ({ name: 'Plains' }))], library: ['Plains', 'Test Gizmo 1', 'Test Gizmo 2', 'Test Gizmo 4'] } },
  });
  // the sacrifice is asked only when there is a choice; the search picks the named card from the library (the sacrificed card is already in the graveyard)
  const pickNamed = (name: string) => (options: string[], st: GameState): string[] => [options.find((id) => nameOf(st, id) === name && st.objects[id]!.zone === 'library') ?? options[0]!];
  const run = (s: GameState, yes: boolean[], found: string): GameState => cast(s, 'Test Transmute', { yes, objects: [pickNamed(found), pickNamed(found)] });
  it('is automated', () => expect(full(TRANSMUTE)).toBe(true));
  it('a cheaper artifact (mana value 1 against 2) goes straight onto the battlefield and the sacrificed one is in the graveyard; nothing is paid', () => {
    const s = run(setup(), [], 'Test Gizmo 1');
    expect(inZone(s, 'Test Gizmo 1', 'battlefield')).toBe(1);
    expect(inZone(s, 'Test Gizmo 2', 'graveyard', 'p1')).toBe(1);
  });
  it('an equal one (2 against 2) goes onto the battlefield too (less than OR EQUAL)', () => {
    const s = run(setup(), [], 'Test Gizmo 2');
    expect(inZone(s, 'Test Gizmo 2', 'battlefield')).toBe(1); // the one from the library; the sacrificed copy is in the graveyard
    expect(inZone(s, 'Test Gizmo 2', 'graveyard', 'p1')).toBe(1);
  });
  it('a dearer one (4 against 2): paying the difference of 2 puts it onto the battlefield (two Plains tapped)', () => {
    const s = run(setup(2), [true], 'Test Gizmo 4');
    expect(inZone(s, 'Test Gizmo 4', 'battlefield')).toBe(1);
    expect(s.zones.battlefield.filter((id) => nameOf(s, id) === 'Plains' && s.objects[id]!.tapped).length).toBe(2);
  });
  it('a dearer one, not paying (the negative case): it goes to its owner\'s graveyard, not the battlefield', () => {
    const s = run(setup(2), [false], 'Test Gizmo 4');
    expect(inZone(s, 'Test Gizmo 4', 'battlefield')).toBe(0);
    expect(inZone(s, 'Test Gizmo 4', 'graveyard', 'p1')).toBe(1);
  });
  it('a dearer one with too little mana (1 Plains for a difference of 2): it cannot be paid, so it goes to the graveyard', () => {
    const s = run(setup(1), [true], 'Test Gizmo 4');
    expect(inZone(s, 'Test Gizmo 4', 'battlefield')).toBe(0);
    expect(inZone(s, 'Test Gizmo 4', 'graveyard', 'p1')).toBe(1);
  });
  it('the comparison is made once (review of edh-d-78): a found artifact that enters as a copy of a dearer one is not tested again, so it stays on the battlefield and nothing is paid', () => {
    const MIMIC = card('Test Mimic', 'Artifact', 'You may have this artifact enter as a copy of any artifact on the battlefield.', { cost: '{2}' });
    const s0 = mpScenario({
      defs: [TRANSMUTE, gizmo(2), gizmo(4), MIMIC],
      zones: { p1: { hand: ['Test Transmute'], battlefield: [{ name: 'Test Gizmo 2' }, { name: 'Plains' }, { name: 'Plains' }, { name: 'Plains' }, { name: 'Plains' }], library: ['Plains', 'Test Mimic'] }, p2: { battlefield: [{ name: 'Test Gizmo 4' }] } },
    });
    const copyIt = (o: string[], st: GameState): string[] => [o.find((id) => nameOf(st, id) === 'Test Gizmo 4' && st.objects[id]!.zone === 'battlefield') ?? o[0]!];
    const s = cast(s0, 'Test Transmute', { yes: [true, true], objects: [pickNamed('Test Mimic'), pickNamed('Test Mimic'), copyIt, copyIt] });
    expect(s.zones.battlefield.some((id) => s.objects[id]!.controller === 'p1' && s.objects[id]!.owner === 'p1' && s.objects[id]!.defId === 'Test Mimic')).toBe(true);
    expect(s.zones.graveyard.p1!.some((id) => nameOf(s, id) === 'Test Mimic')).toBe(false);
    expect(s.zones.battlefield.filter((id) => nameOf(s, id) === 'Plains' && s.objects[id]!.tapped).length).toBe(0);
  });
  it('no artifact to sacrifice (the negative case): nothing is searched, nothing enters', () => {
    const s = cast(setup(0, []), 'Test Transmute', {});
    expect(inZone(s, 'Test Gizmo 1', 'battlefield') + inZone(s, 'Test Gizmo 4', 'battlefield')).toBe(0);
    expect(s.zones.library.p1!.filter((id) => nameOf(s, id).startsWith('Test Gizmo')).length).toBe(3);
  });
});

// ---- Sin, Unending Cataclysm: counters removed as it enters, counters moved when it dies, shuffled away -------------------------------------------------------------------

const SINLIKE = card('Test Leviathan', 'Creature — Leviathan', "As this creature enters, remove all counters from any number of artifacts, creatures, and enchantments. This creature enters with X +1/+1 counters on it, where X is twice the number of counters removed this way.\nWhen this creature dies, put its counters on target creature you control, then shuffle this card into its owner's library.", { pt: ['1', '1'] });
const SLAY = card('Test Slay', 'Instant', 'Destroy target creature.');
const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const IDOL = card('Test Idol', 'Artifact', '');
const AURA = card('Test Aura', 'Enchantment', '');
const LAND = card('Test Pond', 'Land', '');
describe('CR 614.12a, 122.1, 122.5, 701.24a, 603.10a: "As ~ enters, remove all counters from any number of artifacts, creatures, and enchantments. ~ enters with X +1/+1 counters ... twice the number of counters removed this way. When ~ dies, put its counters on target creature you control, then shuffle ~ into its owner\'s library."', () => {
  const defs = [SINLIKE, SLAY, BEAR, IDOL, AURA, LAND];
  const counters = (s: GameState, name: string): Record<string, number> => s.objects[s.zones.battlefield.find((id) => nameOf(s, id) === name)!]?.counters ?? {};
  const setup = (): GameState => mpScenario({
    defs,
    zones: {
      p1: { hand: ['Test Leviathan', 'Test Slay'], battlefield: [{ name: 'Test Bear', counters: { '+1/+1': 3, charge: 1 } }, { name: 'Test Pond', counters: { depletion: 5 } }] },
      p2: { battlefield: [{ name: 'Test Idol', counters: { charge: 2 } }, { name: 'Test Aura', counters: { shield: 1 } }, { name: 'Test Bear', counters: { '+1/+1': 2 } }] },
    },
  });
  const all = (o: string[]): string[] => o;
  it('is automated', () => expect(full(SINLIKE)).toBe(true));
  it('choosing everything: all counters of every kind come off artifacts, creatures and enchantments of ANY controller, and it enters with twice as many +1/+1 counters; a land keeps its counters', () => {
    const s = cast(setup(), 'Test Leviathan', { objects: [all] });
    // removed: bear 3 + 1, idol 2, aura 1, bear (p2) 2 = 9; the land is not an artifact, creature or enchantment
    expect(counters(s, 'Test Leviathan')['+1/+1']).toBe(18);
    expect(counters(s, 'Test Idol')).toEqual({});
    expect(counters(s, 'Test Aura')).toEqual({});
    expect(counters(s, 'Test Pond')).toEqual({ depletion: 5 });
  });
  it('choosing only some (the negative case): only those lose counters, and it counts only those', () => {
    const s = cast(setup(), 'Test Leviathan', { objects: [(o, st) => o.filter((id) => nameOf(st, id) === 'Test Idol')] });
    expect(counters(s, 'Test Leviathan')['+1/+1']).toBe(4);
    expect(counters(s, 'Test Aura')).toEqual({ shield: 1 });
  });
  it('choosing none: it enters with no counters', () => {
    const s = cast(setup(), 'Test Leviathan', { objects: [() => []] });
    expect(counters(s, 'Test Leviathan')['+1/+1'] ?? 0).toBe(0);
  });
  it('when it dies, every counter it had (all kinds) goes onto target creature you control and the card is shuffled into its owner\'s library, not left in the graveyard', () => {
    let s = cast(setup(), 'Test Leviathan', { objects: [(o, st) => o.filter((id) => ['Test Idol', 'Test Aura'].includes(nameOf(st, id)))] }); // 2 + 1 = 3 counters -> 6
    const sin = s.zones.battlefield.find((id) => nameOf(s, id) === 'Test Leviathan')!;
    s.objects[sin]!.counters['charge'] = 1; // a second kind
    s = cast(s, 'Test Slay', { targets: [[{ kind: 'object', id: sin } as TargetChoice], [{ kind: 'object', id: s.zones.battlefield.find((id) => nameOf(s, id) === 'Test Bear' && s.objects[id]!.controller === 'p1')! } as TargetChoice]] });
    const bear = s.objects[s.zones.battlefield.find((id) => nameOf(s, id) === 'Test Bear' && s.objects[id]!.controller === 'p1')!]!;
    expect(bear.counters['+1/+1']).toBe(9); // 3 it had + 6 from Sin
    expect(bear.counters['charge']).toBe(2); // 1 it had + 1 from Sin
    expect(inZone(s, 'Test Leviathan', 'graveyard', 'p1')).toBe(0);
    expect(s.zones.library.p1!.some((id) => nameOf(s, id) === 'Test Leviathan')).toBe(true);
  });
});
