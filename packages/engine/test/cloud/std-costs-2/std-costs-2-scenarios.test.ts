/**
 * std-costs-2 (lane std-costs, account B): the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10),
 * compiled by the game's default compiler. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 601.2b, 601.2h, 608.2h  "As an additional cost to cast this spell, choose a creature you control or a warped creature card you own in exile. ... damage equal to
 *                              the power of the chosen creature or card": the chosen object's power, as it last existed once it is gone; nothing happens to it
 *   CR 702.185a, 400.7         a warped card is a card in exile that warp's delayed triggered ability exiled; another exiled creature card is not one, and a warped
 *                              card that leaves exile is a new object
 *   CR 700.2, 115.1, 608.2c    "Choose up to two. Return those cards from your graveyard to your hand. • Target artifact card. • ...": the targets of the chosen modes,
 *                              returned together; a mode not chosen returns nothing
 *   CR 601.2b, 601.2c, 702.33d "Choose target creature you own. If this spell was kicked, instead choose any number of target creatures you own. Return each chosen
 *                              creature to your hand.": one target unkicked, any number kicked; never the other set
 *   CR 603.7, 603.7a, 608.2c   "At the beginning of the next upkeep, create ... for each creature returned to your hand this way": the delayed trigger at the next upkeep
 *                              (any player's), counting what the return moved
 *   CR 601.2b, 607.2d, 701.4a  "you may choose a creature type and behold two creatures of that type": offered only with a type of which two can be beheld; "If this
 *   CR 614.15, 608.2c          spell's additional cost was paid and the revealed card is the chosen type, put that card onto the battlefield instead of putting it into
 *                              your hand": both must hold, else the card goes to the hand
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId, TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, find, pass, reject, scenario } from '../../m3/scenario';
import { card, full, settle } from '../cmd3/helpers';

const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const zoneOf = (s: GameState, name: string, player = 'p1'): string[] => Object.values(s.objects).filter((o) => o.defId === name && o.owner === player).map((o) => o.zone);
const stackEmpty = (s0: GameState): GameState => {
  let s = settle(s0);
  for (let i = 0; i < 12 && s.zones.stack.length > 0; i++) s = settle(pass(s));
  return s;
};

// ---- the chosen creature or card ------------------------------------------------------------------------------------------------------------------------------

const ENCOUNTER = card('Test Near Miss', 'Instant', 'As an additional cost to cast this spell, choose a creature you control or a warped creature card you own in exile.\nTest Near Miss deals damage equal to the power of the chosen creature or card to target creature.');
const DRIFTER = card('Test Rift Drifter', 'Creature — Eldrazi', 'Warp {0}', ['4', '4'], '{5}');
const CUB = card('Test Cub', 'Creature — Bear', '', ['2', '2']);
const WALL = card('Test Wall', 'Creature — Wall', '', ['0', '6']);
const BANISH = card('Test Banish', 'Instant', 'Exile target creature.');
const DEFS = [ENCOUNTER, DRIFTER, CUB, WALL, BANISH];

/** Cast Test Near Miss choosing `chosen` for its cost and targeting p2's wall; the state with the spell on the stack. */
function castEncounter(s0: GameState, chosen: ObjectId): GameState {
  let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Near Miss', 'hand') });
  for (let i = 0; i < 10 && s.pending?.kind !== 'priority'; i++) {
    const d = s.pending!;
    if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: [chosen] });
    else if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [obj(find(s0, 'Test Wall', 'battlefield', 'p2'))] });
    else s = settle(s);
  }
  return s;
}
const wallDamage = (s: GameState): number => s.objects[find(s, 'Test Wall', 'battlefield', 'p2')]!.damage;

/** Test Rift Drifter cast for its warp cost on turn 1 and exiled by warp at that turn's end step: the board on p1's next turn (turn 3), main phase. */
function warpedDrifter(extra: { battlefield?: string[]; hand?: string[] } = {}): GameState {
  let s = scenario([], { defs: DEFS, p1: { hand: ['Test Rift Drifter', 'Test Near Miss', ...(extra.hand ?? [])], battlefield: extra.battlefield ?? [] }, p2: { battlefield: ['Test Wall'] } });
  s = stackEmpty(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Rift Drifter', 'hand'), method: 'warp' }));
  expect(zoneOf(s, 'Test Rift Drifter')).toEqual(['battlefield']);
  s = advanceTo(s, 3, 'main1');
  expect(zoneOf(s, 'Test Rift Drifter')).toEqual(['exile']);
  return s;
}

describe('std-costs-2: "choose a creature you control or a warped creature card you own in exile" (CR 601.2b, 702.185a)', () => {
  it('the cards are automated', () => {
    for (const d of [ENCOUNTER, DRIFTER]) expect(full(d), JSON.stringify(d.automation)).toBe(true);
  });

  it('CR 601.2b, 608.2c: the chosen 2-power creature deals 2; choosing it does nothing to it', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Near Miss'], battlefield: ['Test Cub'] }, p2: { battlefield: ['Test Wall'] } });
    const s = stackEmpty(castEncounter(s0, find(s0, 'Test Cub', 'battlefield', 'p1')));
    expect(wallDamage(s)).toBe(2);
    expect(zoneOf(s, 'Test Cub')).toEqual(['battlefield']);
    expect(s.objects[find(s, 'Test Cub', 'battlefield', 'p1')]!.tapped).toBe(false);
  });

  it('CR 702.185a: the warped 4-power card in exile can be chosen and deals 4; it stays in exile', () => {
    const s0 = warpedDrifter({ battlefield: ['Test Cub'] });
    const drifter = find(s0, 'Test Rift Drifter', 'exile', 'p1');
    let s1 = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Near Miss', 'hand') });
    if (s1.pending?.kind === 'chooseTargets') s1 = answer(s1, { kind: 'chooseTargets', targets: [obj(find(s0, 'Test Wall', 'battlefield', 'p2'))] }); // targets first (CR 601.2c, 601.2h)
    const d = s1.pending;
    expect(d?.kind).toBe('chooseObjects');
    if (d?.kind === 'chooseObjects') expect([...d.options].sort()).toEqual([drifter, find(s0, 'Test Cub', 'battlefield', 'p1')].sort());
    const s = stackEmpty(castEncounter(s0, drifter));
    expect(wallDamage(s)).toBe(4);
    expect(zoneOf(s, 'Test Rift Drifter')).toEqual(['exile']);
  });

  it('CR 702.185a, 400.7: a creature card exiled another way is not warped; with no creature and no warped card the spell can\'t be cast', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Near Miss', 'Test Banish'], battlefield: ['Test Cub'] }, p2: { battlefield: ['Test Wall'] } });
    s = stackEmpty(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Banish', 'hand') }), { targets: [obj(find(s, 'Test Cub', 'battlefield', 'p1'))] }));
    expect(zoneOf(s, 'Test Cub')).toEqual(['exile']);
    expect(reject(s, { type: 'cast', player: 'p1', card: find(s, 'Test Near Miss', 'hand') }).message).toBeTruthy();
  });

  it('CR 400.7: a warped card cast from exile is a new object; exiled again another way it is not warped', () => {
    let s = warpedDrifter({ hand: ['Test Banish'] });
    s.players.find((p) => p.id === 'p1')!.manaPool.push(...Array.from({ length: 5 }, () => ({ type: 'C' }) as never));
    s = stackEmpty(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Rift Drifter', 'exile', 'p1') }));
    expect(zoneOf(s, 'Test Rift Drifter')).toEqual(['battlefield']);
    s = stackEmpty(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Banish', 'hand') }), { targets: [obj(find(s, 'Test Rift Drifter', 'battlefield', 'p1'))] }));
    expect(zoneOf(s, 'Test Rift Drifter')).toEqual(['exile']);
    expect(reject(s, { type: 'cast', player: 'p1', card: find(s, 'Test Near Miss', 'hand') }).message).toBeTruthy();
  });

  it('CR 601.2b: an opponent\'s creature is no candidate', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Near Miss'], battlefield: ['Test Cub'] }, p2: { battlefield: ['Test Wall', 'Test Rift Drifter'] } });
    const s1 = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Near Miss', 'hand') });
    // one candidate (the cub): chosen without asking, or offered alone
    if (s1.pending?.kind === 'chooseObjects') expect(s1.pending.options).toEqual([find(s0, 'Test Cub', 'battlefield', 'p1')]);
    const s = stackEmpty(castEncounter(s0, find(s0, 'Test Cub', 'battlefield', 'p1')));
    expect(wallDamage(s)).toBe(2);
  });

  it('CR 608.2h: a chosen creature that leaves the battlefield before the spell resolves is read as it last existed', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Near Miss'], battlefield: ['Test Cub'] }, p2: { hand: ['Test Banish'], battlefield: ['Test Wall'] } });
    const cub = find(s0, 'Test Cub', 'battlefield', 'p1');
    let s = pass(castEncounter(s0, cub)); // p1 passes; p2 answers by exiling the chosen cub
    expect(s.pending?.player).toBe('p2');
    s = settle(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Banish', 'hand', 'p2') }), { targets: [obj(cub)] });
    s = stackEmpty(s);
    expect(zoneOf(s, 'Test Cub')).toEqual(['exile']);
    expect(wallDamage(s)).toBe(2);
  });
});

// ---- target-only modes with one shared instruction ------------------------------------------------------------------------------------------------------------

const SALVAGE = card('Test Salvage Order', 'Sorcery', 'Choose up to two. Return those cards from your graveyard to your hand.\n• Target artifact card.\n• Target creature card.\n• Target land card.');
const GEAR = card('Test Gear', 'Artifact', '');
const GOLEM = card('Test Golem', 'Artifact Creature — Golem', '', ['3', '3']);
const SALVAGE_DEFS = [SALVAGE, GEAR, GOLEM, CUB];

function salvage(graveyard: string[], modes: string[], targets: string[][]): GameState {
  const s0 = scenario([], { defs: SALVAGE_DEFS, p1: { hand: ['Test Salvage Order'], graveyard } });
  const id = (name: string): ObjectId => find(s0, name, 'graveyard', 'p1');
  let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Salvage Order', 'hand') });
  const queue = [...targets];
  for (let i = 0; i < 12 && s.pending?.kind !== 'priority'; i++) {
    const d = s.pending!;
    if (d.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: modes });
    else if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: (queue.shift() ?? []).map((n) => obj(id(n))) });
    else s = settle(s);
  }
  return stackEmpty(s);
}

describe('std-costs-2: "Choose up to two. Return those cards from your graveyard to your hand." over target-only modes (CR 700.2, 608.2c)', () => {
  it('is automated', () => expect(full(SALVAGE), JSON.stringify(SALVAGE.automation)).toBe(true));

  it('CR 700.2, 608.2c: two modes chosen, both targets return to the hand together', () => {
    const s = salvage(['Test Gear', 'Test Cub', 'Plains'], ['0', '1'], [['Test Gear'], ['Test Cub']]);
    expect(zoneOf(s, 'Test Gear')).toEqual(['hand']);
    expect(zoneOf(s, 'Test Cub')).toEqual(['hand']);
    expect(zoneOf(s, 'Plains').filter((z) => z === 'graveyard')).toHaveLength(1); // the land mode was not chosen
  });

  it('CR 700.2: one mode chosen returns only its target', () => {
    const s = salvage(['Test Gear', 'Test Cub'], ['1'], [['Test Cub']]);
    expect(zoneOf(s, 'Test Cub')).toEqual(['hand']);
    expect(zoneOf(s, 'Test Gear')).toEqual(['graveyard']);
  });

  it('CR 115.3: an artifact creature card targeted by both the artifact and the creature mode returns once', () => {
    const s = salvage(['Test Golem'], ['0', '1'], [['Test Golem'], ['Test Golem']]);
    expect(zoneOf(s, 'Test Golem')).toEqual(['hand']);
  });

  it('CR 700.2: a third mode is refused ("up to two")', () => {
    const s0 = scenario([], { defs: SALVAGE_DEFS, p1: { hand: ['Test Salvage Order'], graveyard: ['Test Gear', 'Test Cub', 'Plains'] } });
    const s1 = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Salvage Order', 'hand') });
    expect(s1.pending?.kind).toBe('chooseOption');
    expect(() => answer(s1, { kind: 'chooseOption', ids: ['0', '1', '2'] })).toThrow();
  });
});

// ---- kicked "instead choose", each chosen creature, the next upkeep -------------------------------------------------------------------------------------------

const EAGLES = card('Test Eagle Call', 'Instant', 'Kicker {0}\nChoose target creature you own. If this spell was kicked, instead choose any number of target creatures you own. Return each chosen creature to your hand. At the beginning of the next upkeep, create a 2/2 white Bird creature token with flying for each creature returned to your hand this way.');
const RECALL = card('Test Recall Order', 'Sorcery', 'Choose any number of target creatures you own. Return each chosen creature to your hand.');
const EAGLE_DEFS = [EAGLES, RECALL, CUB, WALL];

/** Cast Test Eagle Call (kicked or not) targeting these creatures; the state once it has resolved. */
function eagles(s0: GameState, kicked: boolean, targets: ObjectId[]): GameState {
  let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Eagle Call', 'hand') });
  for (let i = 0; i < 10 && s.pending?.kind !== 'priority'; i++) {
    const d = s.pending!;
    if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: kicked });
    else if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: targets.map(obj) });
    else s = settle(s);
  }
  return stackEmpty(s);
}
const birds = (s: GameState, player = 'p1'): number => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === player).length;

describe('std-costs-2: kicked "instead choose any number of target creatures you own" and the next upkeep (CR 601.2c, 603.7)', () => {
  it('the cards are automated', () => {
    for (const d of [EAGLES, RECALL]) expect(full(d), JSON.stringify(d.automation)).toBe(true);
  });

  it('CR 601.2c, 603.7a: unkicked, one creature returns; at the next upkeep (the opponent\'s) one bird is created, not before', () => {
    const s0 = scenario([], { defs: EAGLE_DEFS, p1: { hand: ['Test Eagle Call'], battlefield: ['Test Cub', 'Test Cub'] } });
    const [a] = s0.zones.battlefield.filter((id) => s0.objects[id]!.defId === 'Test Cub');
    let s = eagles(s0, false, [a!]);
    expect(zoneOf(s, 'Test Cub').sort()).toEqual(['battlefield', 'hand']);
    expect(birds(s)).toBe(0);
    s = stackEmpty(advanceTo(s, 2, 'upkeep'));
    expect(birds(s)).toBe(1);
    expect(birds(s, 'p2')).toBe(0);
  });

  it('CR 601.2c: unkicked, a second target is refused', () => {
    const s0 = scenario([], { defs: EAGLE_DEFS, p1: { hand: ['Test Eagle Call'], battlefield: ['Test Cub', 'Test Cub'] } });
    const ids = s0.zones.battlefield.filter((id) => s0.objects[id]!.defId === 'Test Cub');
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Eagle Call', 'hand') });
    s = answer(s, { kind: 'yesNo', yes: false });
    expect(s.pending?.kind).toBe('chooseTargets');
    expect(() => answer(s, { kind: 'chooseTargets', targets: ids.map(obj) })).toThrow();
  });

  it('CR 702.33d, 608.2c: kicked, both creatures return and two birds come at the next upkeep', () => {
    const s0 = scenario([], { defs: EAGLE_DEFS, p1: { hand: ['Test Eagle Call'], battlefield: ['Test Cub', 'Test Cub'] } });
    const ids = s0.zones.battlefield.filter((id) => s0.objects[id]!.defId === 'Test Cub');
    let s = eagles(s0, true, ids);
    expect(zoneOf(s, 'Test Cub')).toEqual(['hand', 'hand']);
    s = stackEmpty(advanceTo(s, 2, 'upkeep'));
    expect(birds(s)).toBe(2);
  });

  it('CR 601.2c: a creature you don\'t own is no legal target, kicked or not', () => {
    const s0 = scenario([], { defs: EAGLE_DEFS, p1: { hand: ['Test Eagle Call'], battlefield: ['Test Cub'] }, p2: { battlefield: ['Test Wall'] } });
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Eagle Call', 'hand') });
    s = answer(s, { kind: 'yesNo', yes: true });
    expect(() => answer(s, { kind: 'chooseTargets', targets: [obj(find(s0, 'Test Wall', 'battlefield', 'p2'))] })).toThrow();
  });

  it('CR 608.2c: kicked with no creature chosen, nothing returns and no bird comes', () => {
    const s0 = scenario([], { defs: EAGLE_DEFS, p1: { hand: ['Test Eagle Call'], battlefield: ['Test Cub'] } });
    let s = eagles(s0, true, []);
    expect(zoneOf(s, 'Test Cub')).toEqual(['battlefield']);
    s = stackEmpty(advanceTo(s, 2, 'upkeep'));
    expect(birds(s)).toBe(0);
  });

  it('CR 115.1, 608.2c: "Choose any number of target creatures you own. Return each chosen creature to your hand." returns every chosen one, no other', () => {
    const s0 = scenario([], { defs: EAGLE_DEFS, p1: { hand: ['Test Recall Order'], battlefield: ['Test Cub', 'Test Cub', 'Test Wall'] } });
    const cubs = s0.zones.battlefield.filter((id) => s0.objects[id]!.defId === 'Test Cub');
    const s = stackEmpty(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Recall Order', 'hand') }), { targets: cubs.map(obj) }));
    expect(zoneOf(s, 'Test Cub')).toEqual(['hand', 'hand']);
    expect(zoneOf(s, 'Test Wall')).toEqual(['battlefield']);
  });
});

// ---- choose a creature type and behold two of it; the revealed card onto the battlefield instead ----------------------------------------------------------------

const REUNION = card('Test Kin Summons', 'Sorcery', "As an additional cost to cast this spell, you may choose a creature type and behold two creatures of that type.\nSearch your library for a creature card with mana value X or less, reveal it, put it into your hand, then shuffle. If this spell's additional cost was paid and the revealed card is the chosen type, put that card onto the battlefield instead of putting it into your hand.", undefined, '{X}');
const ELF = card('Test Elf', 'Creature — Elf', '', ['1', '1'], '{1}');
const GOBLIN = card('Test Goblin', 'Creature — Goblin', '', ['1', '1'], '{1}');
const REUNION_DEFS = [REUNION, ELF, GOBLIN];

interface ReunionPlay { pay: boolean; type?: string; find: string; x?: number; asked?: string[] }
/** Cast Test Kin Summons with X (default 1), paying the cost or not, and find `find` in the library; records the decisions asked in `asked`. */
function reunion(s0: GameState, p: ReunionPlay): GameState {
  let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Kin Summons', 'hand') });
  for (let i = 0; i < 20 && (s.pending?.kind !== 'priority' || s.zones.stack.length > 0); i++) {
    const d = s.pending!;
    p.asked?.push(d.kind === 'chooseName' ? `chooseName:${(d as { options?: string[] }).options?.join(',') ?? ''}` : d.kind);
    if (d.kind === 'priority') s = pass(s);
    else if (d.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: p.x ?? 1 });
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: p.pay });
    else if (d.kind === 'chooseName') s = answer(s, { kind: 'chooseName', name: p.type ?? 'Elf' });
    else if (d.kind === 'chooseObjects' && d.options.some((id) => s.objects[id]?.zone === 'library')) s = answer(s, { kind: 'chooseObjects', ids: d.options.filter((id) => s.objects[id]!.defId === p.find).slice(0, 1) });
    else s = settle(s);
  }
  return s;
}

describe('std-costs-2: "you may choose a creature type and behold two creatures of that type" and the revealed card onto the battlefield instead (CR 601.2b, 614.15)', () => {
  it('is automated', () => expect(full(REUNION), JSON.stringify(REUNION.automation)).toBe(true));

  it('CR 601.2b, 701.4a, 614.15: Elf chosen and two Elves beheld (one in hand, one on the battlefield): the Elf found enters the battlefield', () => {
    const s0 = scenario([], { defs: REUNION_DEFS, p1: { hand: ['Test Kin Summons', 'Test Elf'], battlefield: ['Test Elf', 'Plains'], library: ['Test Elf', 'Test Goblin'] } });
    const asked: string[] = [];
    const s = reunion(s0, { pay: true, find: 'Test Elf', asked });
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Elf')).toHaveLength(2);
    expect(asked).toContain('yesNo');
    expect(zoneOf(s, 'Test Elf').sort()).toEqual(['battlefield', 'battlefield', 'hand']); // the revealed hand Elf stays in the hand
  });

  it('CR 614.15: Elf chosen and paid, but the card found is a Goblin: it goes to the hand', () => {
    const s0 = scenario([], { defs: REUNION_DEFS, p1: { hand: ['Test Kin Summons', 'Test Elf'], battlefield: ['Test Elf', 'Plains'], library: ['Test Goblin'] } });
    const s = reunion(s0, { pay: true, find: 'Test Goblin' });
    expect(zoneOf(s, 'Test Goblin')).toEqual(['hand']);
  });

  it('CR 601.2b: the cost not paid, the Elf found goes to the hand', () => {
    const s0 = scenario([], { defs: REUNION_DEFS, p1: { hand: ['Test Kin Summons', 'Test Elf'], battlefield: ['Test Elf', 'Plains'], library: ['Test Elf'] } });
    const s = reunion(s0, { pay: false, find: 'Test Elf' });
    expect(zoneOf(s, 'Test Elf').sort()).toEqual(['battlefield', 'hand', 'hand']);
  });

  it('CR 601.2b, 118.3: with one Elf and one Goblin no type has two creatures: the cost is not offered', () => {
    const s0 = scenario([], { defs: REUNION_DEFS, p1: { hand: ['Test Kin Summons', 'Test Goblin'], battlefield: ['Test Elf', 'Plains'], library: ['Test Elf'] } });
    const asked: string[] = [];
    const s = reunion(s0, { pay: true, find: 'Test Elf', asked });
    expect(asked).not.toContain('yesNo');
    expect(zoneOf(s, 'Test Elf').sort()).toEqual(['battlefield', 'hand']);
  });

  it('CR 601.2b: only the types two creatures share are offered (two Elves and two Goblins: both; the chosen Goblin decides)', () => {
    const s0 = scenario([], { defs: REUNION_DEFS, p1: { hand: ['Test Kin Summons', 'Test Goblin', 'Test Elf'], battlefield: ['Test Elf', 'Test Goblin', 'Plains'], library: ['Test Elf'] } });
    const asked: string[] = [];
    const s = reunion(s0, { pay: true, type: 'Goblin', find: 'Test Elf', asked });
    expect(asked).toContain('chooseName:Elf,Goblin');
    expect(zoneOf(s, 'Test Elf').filter((z) => z === 'hand')).toHaveLength(2); // a Goblin was chosen: the Elf found goes to the hand
  });

  it('CR 107.3, 701.23a: the creature card found has mana value X or less', () => {
    const s0 = scenario([], { defs: REUNION_DEFS, p1: { hand: ['Test Kin Summons', 'Test Elf'], battlefield: ['Test Elf'], library: ['Test Elf'] } });
    const s = reunion(s0, { pay: true, find: 'Test Elf', x: 0 });
    expect(zoneOf(s, 'Test Elf').sort()).toEqual(['battlefield', 'hand', 'library']);
  });
});
