/**
 * Precon lane pc-zones, round pc-zones-3 (library and graveyard moves), played through the engine with synthetic cards compiled by the game's default compiler (invented
 * names, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 305.1, 401.5, 604.1   "As long as <condition>, you may play lands from the top of your library" / "... cast creature spells from the top of your library"
 *   CR 702.33d, 603.3d       "... up to X target creature cards ..., where X is the number of times ~ was kicked": the kicks of the cast record, read as the trigger's targets are announced
 *   CR 404.1, 110.2a         "Then you put a creature card from a graveyard onto the battlefield under your control."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { legalActions } from '../../../src/index';
import { act, answer, find, findAll, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const zoneOf = (s: GameState, id: ObjectId): string => s.objects[id]?.zone ?? 'gone';
const namesIn = (s: GameState, zone: 'hand' | 'graveyard' | 'library', who: PlayerId): string[] => s.zones[zone][who]!.map((id) => s.objects[id]!.defId);

/** Answer every decision: yes/no by `yes`, objects by `pick`, targets in order from `targets`, X by `x`, mana automatically. */
function drive(s0: GameState, o: { yes?: boolean; x?: number; pick?: (options: ObjectId[]) => ObjectId[]; targets?: ObjectId[][] } = {}): GameState {
  let s = s0;
  const tq = [...(o.targets ?? [])];
  for (let guard = 0; guard < 80 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: o.x ?? p.min });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: o.pick ? o.pick(p.options) : p.options.slice(0, Math.max(p.min, 1)).slice(0, p.max) });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: (tq.shift() ?? []).map((id) => ({ kind: 'object' as const, id })) });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Parameters<typeof drive>[1] = {}): GameState {
  let s = drive(s0, o);
  for (let guard = 0; guard < 60 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, o);
  return s;
}
const cast = (s0: GameState, name: string, o: Parameters<typeof drive>[1] = {}, who: PlayerId = 'p1'): GameState =>
  resolveAll(act(s0, { type: 'cast', player: who, card: find(s0, name, 'hand', who) }), o);

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const FOREST = card('Test Grove', 'Land — Forest', '');
const RELIC = card('Test Relic', 'Artifact', '');
const AURA = card('Test Boon', 'Enchantment', '');


/** p1's legal actions about the card on top of p1's library. */
const topActions = (s: GameState): string[] => legalActions(s, 'p1').filter((a) => a.object === s.zones.library['p1']![0]).map((a) => a.label);
const FOREST2 = card('Forest', 'Basic Land — Forest', '');

describe('CR 305.1, 401.5, 604.1: "As long as an opponent controls more lands than you, you may play lands from the top of your library."', () => {
  const RANGER = card('Test Ranger', 'Creature — Elf', 'You may look at the top card of your library any time.\nAs long as an opponent controls more lands than you, you may play lands from the top of your library.', { pt: ['1', '1'] });
  const defs = [RANGER, FOREST2, BEAR];
  it('is fully automated', () => expect(full(RANGER)).toBe(true));
  it('an opponent with more lands: the land on top of your library can be played', () => {
    const s = scenario([], { defs, p1: { battlefield: [{ name: 'Test Ranger', since: 1 }], library: ['Forest'] }, p2: { battlefield: [{ name: 'Forest', since: 1 }, { name: 'Forest', since: 1 }] } });
    expect(topActions(s).some((l) => /play/i.test(l))).toBe(true);
  });
  it('equal numbers of lands: the permission is off (the condition is false)', () => {
    const s = scenario([], { defs, p1: { battlefield: [{ name: 'Test Ranger', since: 1 }, { name: 'Forest', since: 1 }], library: ['Forest'] }, p2: { battlefield: [{ name: 'Forest', since: 1 }] } });
    expect(topActions(s).some((l) => /play/i.test(l))).toBe(false);
  });
  it('a nonland on top is never played as a land even when the condition holds', () => {
    const s = scenario([], { defs, p1: { battlefield: [{ name: 'Test Ranger', since: 1 }], library: ['Test Bear'] }, p2: { battlefield: [{ name: 'Forest', since: 1 }, { name: 'Forest', since: 1 }] } });
    expect(topActions(s).some((l) => /play/i.test(l))).toBe(false);
  });
});

describe('CR 601.3, 401.5, 604.1: "As long as this Equipment is attached to a creature, you may cast creature spells from the top of your library."', () => {
  const MATERIA = card('Test Materia', 'Artifact — Equipment', 'You may look at the top card of your library any time.\nAs long as this Equipment is attached to a creature, you may cast creature spells from the top of your library.');
  const defs = [MATERIA, BEAR];
  it('is fully automated', () => expect(full(MATERIA)).toBe(true));
  it('unattached: the creature on top cannot be cast from the library', () => {
    const s = scenario([], { defs, p1: { battlefield: [{ name: 'Test Materia', since: 1 }], library: ['Test Bear'] } });
    expect(topActions(s).some((l) => /cast/i.test(l))).toBe(false);
  });
  it('attached to a creature: it can', () => {
    const s = scenario([], { defs, p1: { battlefield: [{ name: 'Test Materia', since: 1 }, { name: 'Test Bear', since: 1 }], library: ['Test Bear'] } });
    const eq = find(s, 'Test Materia', 'battlefield', 'p1');
    s.objects[eq]!.attachedTo = find(s, 'Test Bear', 'battlefield', 'p1');
    expect(topActions(s).some((l) => /cast/i.test(l))).toBe(true);
  });
});

describe('CR 702.33d, 603.3d, 601.2c: "When this enchantment enters, return up to X target creature cards from your graveyard to the battlefield, where X is the number of times this enchantment was kicked."', () => {
  const ANTHEM = card('Test Anthem', 'Enchantment', 'Multikicker {1}\nWhen this enchantment enters, return up to X target creature cards from your graveyard to the battlefield, where X is the number of times this enchantment was kicked.', { cost: '{W}' });
  const defs = [ANTHEM, BEAR];
  it('is fully automated', () => expect(full(ANTHEM)).toBe(true));
  it('kicked twice: the trigger offers at most two targets (a third is refused) and two creature cards come back', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Anthem'], graveyard: ['Test Bear', 'Test Bear', 'Test Bear'], battlefield: [{ name: 'Plains', since: 1 }, { name: 'Plains', since: 1 }, { name: 'Plains', since: 1 }, { name: 'Plains', since: 1 }] } });
    const yard = s.zones.graveyard['p1']!.filter((id) => s.objects[id]!.defId === 'Test Bear');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Anthem', 'hand', 'p1') });
    for (let g = 0; g < 10 && s.pending && s.pending.kind !== 'chooseTargets' && s.pending.kind !== 'priority'; g++) {
      s = s.pending.kind === 'chooseNumber' ? answer(s, { kind: 'chooseNumber', n: 2 }) : s.pending.kind === 'payCost' ? answer(s, { kind: 'payCost', auto: true }) : drive(s);
    }
    s = pass(s); // the permanent resolves; its trigger is put on the stack with its targets
    for (let g = 0; g < 10 && s.pending && s.pending.kind !== 'chooseTargets'; g++) s = s.pending.kind === 'priority' ? pass(s) : drive(s);
    expect(s.pending?.kind).toBe('chooseTargets');
    const p = s.pending as unknown as { max?: number; min?: number };
    expect(p.max).toBe(2);
    expect(p.min).toBe(0);
    s = resolveAll(answer(s, { kind: 'chooseTargets', targets: yard.slice(0, 2).map((id) => ({ kind: 'object' as const, id })) }));
    expect(findAll(s, 'Test Bear', 'battlefield', 'p1').length).toBe(2);
    expect(findAll(s, 'Test Bear', 'graveyard', 'p1').length).toBe(1);
  });
  it('not kicked: the trigger has no target to choose and nothing returns (X = 0)', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Anthem'], graveyard: ['Test Bear'], battlefield: [{ name: 'Plains', since: 1 }] } });
    s = cast(s, 'Test Anthem', { x: 0 });
    expect(findAll(s, 'Test Bear', 'battlefield', 'p1').length).toBe(0);
    expect(findAll(s, 'Test Bear', 'graveyard', 'p1').length).toBe(1);
  });
  it('the same enchantment put onto the battlefield from the graveyard (never cast) has X = 0 and returns nothing', () => {
    const REANIM = card('Test Reanimate', 'Sorcery', 'Return target enchantment card from your graveyard to the battlefield.');
    let s = scenario([], { defs: [...defs, REANIM], p1: { hand: ['Test Reanimate'], graveyard: ['Test Anthem', 'Test Bear'] } });
    const ench = find(s, 'Test Anthem', 'graveyard', 'p1');
    s = cast(s, 'Test Reanimate', { targets: [[ench]] });
    expect(findAll(s, 'Test Anthem', 'battlefield', 'p1').length).toBe(1);
    expect(findAll(s, 'Test Bear', 'battlefield', 'p1').length).toBe(0);
  });
  it('the kick count survives when the permanent dies before its trigger is put on the stack (last known information, CR 603.10a)', () => {
    const DRAKE = card('Test Drake', 'Creature — Drake', 'Multikicker {1}\nWhen this creature enters, up to X target creatures gain flying until end of turn, where X is the number of times this creature was kicked.', { pt: ['1', '1'], cost: '{W}' });
    const CHILL = card('Test Chill', 'Enchantment', 'Creatures your opponents control get -3/-3.');
    let s = scenario([], { defs: [DRAKE, CHILL, BEAR], p1: { hand: ['Test Drake'], battlefield: [{ name: 'Plains', since: 1 }, { name: 'Plains', since: 1 }, { name: 'Plains', since: 1 }] }, p2: { battlefield: [{ name: 'Test Chill', since: 1 }, { name: 'Test Bear', since: 1 }, { name: 'Test Bear', since: 1 }] } });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Drake', 'hand', 'p1') });
    for (let g = 0; g < 10 && s.pending && s.pending.kind !== 'priority'; g++) s = s.pending.kind === 'chooseNumber' ? answer(s, { kind: 'chooseNumber', n: 2 }) : s.pending.kind === 'payCost' ? answer(s, { kind: 'payCost', auto: true }) : drive(s);
    s = pass(s);
    for (let g = 0; g < 10 && s.pending && s.pending.kind !== 'chooseTargets'; g++) s = s.pending.kind === 'priority' ? pass(s) : drive(s);
    expect(s.pending?.kind).toBe('chooseTargets');
    expect((s.pending as unknown as { max?: number }).max).toBe(2);
  });
});

describe('CR 404.1, 110.2a, 608.2c: "Each player mills two cards. Then you put a creature card from a graveyard onto the battlefield under your control."', () => {
  const EXTRACT = card('Test Extract', 'Sorcery', 'Each player mills two cards. Then you put a creature card from a graveyard onto the battlefield under your control.');
  const defs = [EXTRACT, BEAR];
  it('is fully automated', () => expect(full(EXTRACT)).toBe(true));
  it('a creature card milled from the OPPONENT\'s library can be put onto the battlefield under YOUR control', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Extract'], library: ['Plains', 'Plains'] }, p2: { library: ['Test Bear', 'Plains'] } });
    s = cast(s, 'Test Extract', { pick: (options) => [options.find((id) => s.objects[id]?.defId === 'Test Bear') ?? options[0]!] });
    const bear = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Bear');
    expect(bear).toBeDefined();
    expect(s.objects[bear!]!.controller).toBe('p1');
  });
  it('no creature card in any graveyard: nothing enters', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Extract'], library: ['Plains', 'Plains'] }, p2: { library: ['Plains', 'Plains'] } });
    s = cast(s, 'Test Extract');
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Bear').length).toBe(0);
  });
});
