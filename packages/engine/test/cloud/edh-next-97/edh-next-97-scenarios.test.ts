/**
 * Top-rank second pass 6, edh-next-97 (code edhn97): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (invented names, design 6.10).
 * Each test is named after the rule it checks, with its negative case. CR cites are from memory of the 2026-09-25 text (no rules/cr folder in this session): unverified.
 *
 *   CR 611.2a, 602.5        "Until your next turn, up to one target creature gets -3/-0 and its activated abilities can't be activated." (Dovin Baan)
 *   CR 118.9, 601.2b        "Until end of turn, you may cast spells from your hand without paying their mana costs." (Chandra, Flame's Catalyst)
 */
import { describe, expect, it } from 'vitest';
import { getChars } from '../../../src/index';
import type { GameState } from '../../../src/index';
import { act, answer, card, cast, drive, find, full, legal, obj, resolveAll, scenario } from '../r4-cost/support';
import { pass } from '../../m3/scenario';

/** Passes until the given turn and step, answering the cleanup discard and the combat declarations on the way. */
function advanceTo(s0: GameState, turn: number, step: GameState['turn']['step']): GameState {
  let s = s0;
  for (let guard = 0; !(s.turn.number === turn && s.turn.step === step); guard++) {
    if (guard > 600) throw new Error('could not reach the turn');
    const d = s.pending;
    if (d?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else if (d?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (d?.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: d.options.slice(0, d.min) });
    else s = pass(s);
  }
  return s;
}

const activateOf = (s: GameState, name: string, owner: 'p1' | 'p2' = 'p1', targets: string[] = []): GameState => {
  const a = legal(s, owner, 'activate').find((x) => x.object === find(s, name, 'battlefield', owner) && x.isMana !== true);
  if (a === undefined) throw new Error(`${name}: no activation offered`);
  let t = act(s, a.action);
  for (let i = 0; i < 6; i++) {
    const p = t.pending;
    if (p === null || p.kind === 'priority') break;
    if (p.kind === 'chooseTargets') t = answer(t, { kind: 'chooseTargets', targets: targets.map((n) => obj(find(s, n, 'battlefield', owner))) });
    else if (p.kind === 'payCost') t = answer(t, { kind: 'payCost', auto: true });
    else break;
  }
  return resolveAll(t);
};
const canActivate = (s: GameState, name: string, owner: 'p1' | 'p2'): boolean => legal(s, owner, 'activate').some((x) => x.object === find(s, name, 'battlefield', owner) && x.isMana !== true);
const canCast = (s: GameState, name: string): boolean => legal(s, 'p1', 'cast').some((x) => x.object === find(s, name, 'hand', 'p1'));

// ---- Dovin Baan ----------------------------------------------------------------------------------------------------------------------------------------
describe('CR 611.2a, 602.5: "Until your next turn, up to one target creature gets -3/-0 and its activated abilities can\'t be activated." (the ban lasts as long as the power change, not for good)', () => {
  const BINDER = card('Test Binder', 'Artifact', '{T}: Until your next turn, up to one target creature gets -3/-0 and its activated abilities can\'t be activated.', '{0}');
  const MONK = card('Test Monk', 'Creature — Monk', '{0}: You gain 1 life.', '{0}', ['4', '4']);
  const defs = [BINDER, MONK];
  const board = (): GameState => scenario([], { defs, p1: { battlefield: ['Test Binder', 'Test Monk'] } });
  it('is full', () => expect(full(BINDER), JSON.stringify(BINDER.automation)).toBe(true));
  it('the target creature gets -3/-0 and cannot activate its abilities, and has them back on the activating player\'s next turn', () => {
    const s0 = board();
    expect(canActivate(s0, 'Test Monk', 'p1')).toBe(true);
    const s = activateOf(s0, 'Test Binder', 'p1', ['Test Monk']);
    const monk = find(s, 'Test Monk', 'battlefield', 'p1');
    expect(Number(getChars(s, monk)!.power)).toBe(1);
    expect(canActivate(s, 'Test Monk', 'p1')).toBe(false);
    // the opponent's turn comes first: still bound
    const mid = advanceTo(s, s.turn.number + 1, 'main1');
    expect(mid.turn.activePlayer).toBe('p2');
    expect(Number(getChars(mid, monk)!.power)).toBe(1);
    // the activating player's next turn: both effects have ended
    const later = advanceTo(mid, s.turn.number + 2, 'main1');
    expect(later.turn.activePlayer).toBe('p1');
    expect(Number(getChars(later, monk)!.power)).toBe(4);
    expect(canActivate(later, 'Test Monk', 'p1')).toBe(true);
  });
  it('negative: another creature keeps its abilities', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Binder', 'Test Monk', 'Test Monk'] } });
    const [a, b] = s0.zones.battlefield.filter((id) => s0.objects[id]!.defId === 'Test Monk');
    const act1 = legal(s0, 'p1', 'activate').find((x) => x.object === find(s0, 'Test Binder', 'battlefield', 'p1') && x.isMana !== true)!;
    let t = act(s0, act1.action);
    t = answer(t, { kind: 'chooseTargets', targets: [obj(a!)] });
    if (t.pending?.kind === 'payCost') t = answer(t, { kind: 'payCost', auto: true });
    t = resolveAll(t);
    const open = legal(t, 'p1', 'activate').filter((x) => x.isMana !== true).map((x) => x.object);
    expect(open).toContain(b);
    expect(open).not.toContain(a);
  });
});

// ---- Chandra, Flame's Catalyst -------------------------------------------------------------------------------------------------------------------------
describe('CR 118.9, 601.2b: "Until end of turn, you may cast spells from your hand without paying their mana costs."', () => {
  const WAND = card('Test Wand', 'Artifact', '{T}: Until end of turn, you may cast spells from your hand without paying their mana costs.', '{0}');
  const GIANT = card('Test Giant', 'Creature — Giant', '', '{7}', ['7', '7']);
  const defs = [WAND, GIANT];
  const board = (): GameState => scenario([], { defs, p1: { hand: ['Test Giant'], battlefield: ['Test Wand'] } });
  it('is full', () => expect(full(WAND), JSON.stringify(WAND.automation)).toBe(true));
  it('with no mana the spell cannot be cast before the ability, and is cast for free after it', () => {
    const s0 = board();
    expect(canCast(s0, 'Test Giant')).toBe(false);
    const s1 = activateOf(s0, 'Test Wand');
    expect(canCast(s1, 'Test Giant')).toBe(true);
    const free = legal(s1, 'p1', 'cast').find((x) => x.object === find(s1, 'Test Giant', 'hand', 'p1'))!;
    expect(JSON.stringify(free.action)).toContain('grantedCost');
    const s2 = act(s1, free.action);
    const s3 = resolveAll(s2.pending?.kind === 'payCost' ? answer(s2, { kind: 'payCost', auto: true }) : s2);
    expect(s3.zones.battlefield.some((id) => s3.objects[id]!.defId === 'Test Giant')).toBe(true);
  });
  it('negative: the permission ends with the turn', () => {
    const s1 = activateOf(board(), 'Test Wand');
    const next = advanceTo(s1, s1.turn.number + 2, 'main1');
    expect(next.turn.activePlayer).toBe('p1');
    expect(canCast(next, 'Test Giant')).toBe(false);
  });
});

// ---- Taeko, the Patient Avalanche ---------------------------------------------------------------------------------------------------------------------
describe('CR 700.4, 603.4: "Whenever another creature you control leaves the battlefield, if it didn\'t die, put a +1/+1 counter on ~."', () => {
  const WARDEN = card('Test Warden', 'Creature — Turtle', 'Whenever another creature you control leaves the battlefield, if it didn\'t die, put a +1/+1 counter on this creature.', '{1}', ['2', '2']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}', ['2', '2']);
  const BOUNCE = card('Test Bounce', 'Instant', 'Return target creature to its owner\'s hand.', '{0}');
  const EXILE = card('Test Exile', 'Instant', 'Exile target creature.', '{0}');
  const KILL = card('Test Kill', 'Instant', 'Destroy target creature.', '{0}');
  const defs = [WARDEN, BEAR, BOUNCE, EXILE, KILL];
  const run = (spell: string, victim: 'p1' | 'p2'): number => {
    const s0 = scenario([], { defs, p1: { hand: [spell], battlefield: ['Test Warden', ...(victim === 'p1' ? ['Test Bear'] : [])] }, p2: { battlefield: victim === 'p2' ? ['Test Bear'] : [] } });
    const bear = find(s0, 'Test Bear', 'battlefield', victim);
    const s = resolveAll(cast(s0, spell, { targets: [[obj(bear)]] }));
    return s.objects[find(s, 'Test Warden', 'battlefield', 'p1')]!.counters['+1/+1'] ?? 0;
  };
  it('is full', () => expect(full(WARDEN), JSON.stringify(WARDEN.automation)).toBe(true));
  it('a creature returned to its owner\'s hand or exiled did not die: the counter is put', () => {
    expect(run('Test Bounce', 'p1')).toBe(1);
    expect(run('Test Exile', 'p1')).toBe(1);
  });
  it('negative: a creature that died (put into a graveyard from the battlefield) gives nothing', () => {
    expect(run('Test Kill', 'p1')).toBe(0);
  });
  it('negative: a creature an opponent controls leaving gives nothing', () => {
    expect(run('Test Bounce', 'p2')).toBe(0);
  });
});

// ---- Anhelo, the Painter / Ashad, the Lone Cyberman ----------------------------------------------------------------------------------------------------
describe('CR 601.2i, 702.153a, 613.1f: "The first instant or sorcery spell you cast each turn has casualty 2."', () => {
  const PAINTER = card('Test Painter', 'Creature — Human', 'The first instant or sorcery spell you cast each turn has casualty 2.', '{1}', ['1', '1']);
  const TONIC = card('Test Tonic', 'Instant', 'You gain 2 life.', '{0}');
  const STUDY = card('Test Study', 'Sorcery', 'You gain 3 life.', '{0}');
  const GIZMO = card('Test Gizmo', 'Artifact', '', '{0}');
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', '{1}', ['2', '2']);
  const defs = [PAINTER, TONIC, STUDY, GIZMO, OGRE];
  const asksCasualty = (s: GameState): boolean => s.pending?.kind === 'yesNo' && /casualty/i.test((s.pending as unknown as { prompt: string }).prompt);
  const board = (p1: string[], p2: string[] = []): GameState => scenario([], { defs, p1: { hand: p1, battlefield: ['Test Painter', 'Test Ogre', 'Test Ogre'] }, p2: { battlefield: p2 } });
  it('is full', () => expect(full(PAINTER), JSON.stringify(PAINTER.automation)).toBe(true));
  it('the first instant or sorcery of the turn is offered casualty, and paying it copies the spell', () => {
    const s0 = board(['Test Tonic']);
    const before = s0.players[0]!.life;
    const s1 = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Tonic', 'hand', 'p1') });
    expect(asksCasualty(s1)).toBe(true);
    const s = resolveAll(drive(answer(s1, { kind: 'yesNo', yes: true }), { objects: [[find(s0, 'Test Ogre', 'battlefield', 'p1')]] }));
    expect(s.players[0]!.life).toBe(before + 4);
  });
  it('negative: the second instant or sorcery of the turn is not offered casualty', () => {
    const s0 = board(['Test Tonic', 'Test Study']);
    let s = cast(s0, 'Test Tonic', {});
    s = resolveAll(s);
    const s1 = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Study', 'hand', 'p1') });
    expect(asksCasualty(s1)).toBe(false);
  });
  it('negative: a spell of another kind (an artifact) does not count as the first one and gets no casualty', () => {
    const s0 = board(['Test Gizmo', 'Test Tonic']);
    let s = resolveAll(cast(s0, 'Test Gizmo', {}));
    const s1 = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Tonic', 'hand', 'p1') });
    expect(asksCasualty(s1)).toBe(true); // the Gizmo was cast first, but it is no instant or sorcery
  });
  it('negative: the artifact itself is offered nothing', () => {
    const s1 = act(board(['Test Gizmo']), { type: 'cast', player: 'p1', card: find(board(['Test Gizmo']), 'Test Gizmo', 'hand', 'p1') });
    expect(asksCasualty(s1)).toBe(false);
  });
});

// ---- the other keywords of the same wording (convoke, improvise, demonstrate) ------------------------------------------------------------------------------
describe('CR 601.2i, 613.1f: "The first <kind> spell you cast each turn has convoke / improvise / demonstrate."', () => {
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', '{1}', ['2', '2']);
  const FOOT = card('Test Footman', 'Creature — Soldier', '', '{2}', ['1', '1']);
  const ROCK = card('Test Rock', 'Artifact', '', '{0}');
  const WORK = card('Test Work', 'Sorcery', 'You gain 2 life.', '{2}');
  const CONV = card('Test Convoker', 'Creature — Human', 'The first creature spell you cast each turn has convoke.', '{1}', ['1', '1']);
  const IMP = card('Test Improviser', 'Creature — Human', 'The first sorcery spell you cast each turn has improvise.', '{1}', ['1', '1']);
  const defs = [OGRE, FOOT, ROCK, WORK, CONV, IMP];
  const canCastFree = (s: GameState, name: string): boolean => legal(s, 'p1', 'cast').some((x) => x.object === find(s, name, 'hand', 'p1'));
  it('are full (the convoke wording was experimental, capped at partial, until edh-next-117 made it stable)', () => { expect(full(IMP), JSON.stringify(IMP.automation)).toBe(true); expect(CONV.automation.level).toBe('full'); });
  it('convoke: the first creature spell of the turn can be paid by tapping creatures; with no creature to tap it cannot be cast', () => {
    const withCreatures = scenario([], { defs, p1: { hand: ['Test Footman'], battlefield: ['Test Convoker', 'Test Ogre', 'Test Ogre'] } });
    expect(canCastFree(withCreatures, 'Test Footman')).toBe(true);
    const alone = scenario([], { defs, p1: { hand: ['Test Footman'], battlefield: ['Test Convoker'] } });
    expect(canCastFree(alone, 'Test Footman')).toBe(false); // the Convoker itself is the only creature: one tap pays {1}, not {2}
  });
  it('negative: the second creature spell of the turn has no convoke', () => {
    const WISP = card('Test Wisp', 'Creature — Spirit', '', '{0}', ['1', '1']);
    const s0 = scenario([], { defs: [...defs, WISP], p1: { hand: ['Test Wisp', 'Test Footman'], battlefield: ['Test Convoker', 'Test Ogre', 'Test Ogre'] } });
    expect(canCastFree(s0, 'Test Footman')).toBe(true); // first creature spell: convoke
    const s = resolveAll(cast(s0, 'Test Wisp', {}));
    expect(canCastFree(s, 'Test Footman')).toBe(false); // the Wisp was the first one: no convoke for the Footman, and there is no mana
  });
  it('improvise: the first sorcery of the turn can be paid by tapping artifacts', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Work'], battlefield: ['Test Improviser', 'Test Rock', 'Test Rock'] } });
    expect(canCastFree(s0, 'Test Work')).toBe(true);
    const none = scenario([], { defs, p1: { hand: ['Test Work'], battlefield: ['Test Improviser'] } });
    expect(canCastFree(none, 'Test Work')).toBe(false);
  });
});

describe('CR 702.144a, 601.2i: "The first nonlegendary creature spell you cast each turn has demonstrate."', () => {
  const ELDA = card('Test Demonstrator', 'Creature — Human', 'The first nonlegendary creature spell you cast each turn has demonstrate.', '{1}', ['1', '1']);
  const WISP = card('Test Wisp', 'Creature — Spirit', '', '{0}', ['1', '1']);
  const defs = [ELDA, WISP];
  const wisps = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Wisp').length;
  it('is full', () => expect(full(ELDA), JSON.stringify(ELDA.automation)).toBe(true));
  it('the first creature spell of the turn may be copied (demonstrate); the second one is not offered it', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Wisp', 'Test Wisp'], battlefield: ['Test Demonstrator'] } });
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Wisp', 'hand', 'p1') });
    let asked = false;
    for (let i = 0; i < 8 && s.pending && s.pending.kind !== 'priority'; i++) {
      if (s.pending.kind === 'yesNo') { asked = true; s = answer(s, { kind: 'yesNo', yes: true }); } else if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true }); else if (s.pending.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: s.pending.options.slice(0, s.pending.min) }); else s = answer(s, { kind: 'chooseOption', ids: (s.pending as never as { options: { id: string }[] }).options.slice(0, 1).map((o) => o.id) });
    }
    s = resolveAll(s, { yes: [true] });
    expect(wisps(s)).toBe(3); // the Wisp, your copy and the copy of the opponent you chose (each copy of a creature spell becomes a token)
    const s1 = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Wisp', 'hand', 'p1') });
    expect(s1.pending?.kind === 'yesNo').toBe(false);
  });
});

// ---- Springjack Pasture --------------------------------------------------------------------------------------------------------------------------------
describe('CR 605.1a, 605.3b, 107.3a, 701.21a: "{T}, Sacrifice X Goats: Add X mana of any one color. You gain X life." (a mana ability: X is announced, no stack)', () => {
  const PASTURE = card('Test Pasture', 'Land', '{T}, Sacrifice X Goats: Add X mana of any one color. You gain X life.', '{0}');
  const GOAT = card('Test Goat', 'Creature — Goat', '', '{0}', ['0', '1']);
  const defs = [PASTURE, GOAT];
  const run = (goats: number, x: number): GameState => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Pasture', ...Array.from({ length: goats }, () => 'Test Goat')] } });
    const a = legal(s0, 'p1', 'activate').find((y) => y.object === find(s0, 'Test Pasture', 'battlefield', 'p1') && y.isMana === true)!;
    let s = act(s0, a.action);
    for (let i = 0; i < 8 && s.pending && s.pending.kind !== 'priority'; i++) {
      const p = s.pending;
      if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: x });
      else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.min) });
      else if (p.kind === 'chooseColor') s = answer(s, { kind: 'chooseColor', color: 'G' });
      else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else break;
    }
    return s;
  };
  it('is full', () => expect(full(PASTURE), JSON.stringify(PASTURE.automation)).toBe(true));
  it('sacrificing two of three Goats adds two mana of one color and gains two life', () => {
    const before = scenario([], { defs, p1: { battlefield: ['Test Pasture', 'Test Goat', 'Test Goat', 'Test Goat'] } }).players[0]!.life;
    const s = run(3, 2);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Goat')).toHaveLength(1);
    expect(s.players[0]!.manaPool.map((u) => u.type)).toEqual(['G', 'G']);
    expect(s.players[0]!.life).toBe(before + 2);
  });
  it('negative: X = 0 sacrifices nothing, adds nothing and gains nothing', () => {
    const before = scenario([], { defs, p1: { battlefield: ['Test Pasture', 'Test Goat'] } }).players[0]!.life;
    const s = run(1, 0);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Goat')).toHaveLength(1);
    expect(s.players[0]!.manaPool).toHaveLength(0);
    expect(s.players[0]!.life).toBe(before);
  });
});

// ---- Osgood, Operation Double ----------------------------------------------------------------------------------------------------------------------
describe('CR 603.2, 707.2, 205.4: "When you cast this spell, create a token that\'s a copy of it, except it isn\'t legendary."', () => {
  const DOUBLE = card('Test Double', 'Legendary Creature — Shapeshifter', 'When you cast this spell, create a token that\'s a copy of it, except it isn\'t legendary.', '{0}', ['2', '3']);
  const defs = [DOUBLE];
  const copies = (s: GameState) => s.zones.battlefield.filter((id) => s.objects[id]!.defId.includes('Test Double') || s.defs[s.objects[id]!.defId]?.name === 'Test Double').map((id) => s.objects[id]!);
  it('is full', () => expect(full(DOUBLE), JSON.stringify(DOUBLE.automation)).toBe(true));
  it('casting it makes a token copy that is not legendary; the real card stays legendary and both stay on the battlefield (no legend rule)', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Double'] } });
    const s = resolveAll(cast(s0, 'Test Double', {}));
    const on = copies(s);
    expect(on).toHaveLength(2);
    const token = on.find((o) => o.kind === 'token')!;
    const real = on.find((o) => o.kind === 'card')!;
    expect(getChars(s, token.id)!.supertypes).not.toContain('Legendary');
    expect(getChars(s, real.id)!.supertypes).toContain('Legendary');
    expect(Number(getChars(s, token.id)!.power)).toBe(2);
  });
});

// ---- Coffin Queen ------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 603.7, 502.3, 108.4: "When this creature becomes untapped or you lose control of this creature, exile that creature."', () => {
  const REAPER = card('Test Reaper', 'Creature — Zombie', 'You may choose not to untap this creature during your untap step.\n{0}, {T}: Put target creature card from a graveyard onto the battlefield under your control. When this creature becomes untapped or you lose control of this creature, exile that creature.', '{0}', ['1', '1']);
  const CORPSE = card('Test Corpse', 'Creature — Ogre', '', '{0}', ['3', '3']);
  const defs = [REAPER, CORPSE];
  const board = (): GameState => scenario([], { defs, p1: { battlefield: ['Test Reaper'], graveyard: ['Test Corpse'] } });
  const reanimate = (): GameState => {
    const s0 = board();
    const a = legal(s0, 'p1', 'activate').find((x) => x.object === find(s0, 'Test Reaper', 'battlefield', 'p1') && x.isMana !== true)!;
    let t = act(s0, a.action);
    for (let i = 0; i < 6 && t.pending && t.pending.kind !== 'priority'; i++) {
      if (t.pending.kind === 'chooseTargets') t = answer(t, { kind: 'chooseTargets', targets: [obj(find(s0, 'Test Corpse', 'graveyard', 'p1'))] });
      else if (t.pending.kind === 'payCost') t = answer(t, { kind: 'payCost', auto: true });
      else break;
    }
    return resolveAll(t);
  };
  const onBattlefield = (s: GameState): boolean => s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Corpse');
  const toNextUntap = (s: GameState, keepTapped: boolean): GameState => {
    let t = s;
    for (let guard = 0; guard < 600 && !(t.turn.number >= s.turn.number + 2 && t.turn.step === 'main1'); guard++) {
      const d = t.pending;
      if (d?.kind === 'declareAttackers') t = answer(t, { kind: 'declareAttackers', attacks: [] });
      else if (d?.kind === 'declareBlockers') t = answer(t, { kind: 'declareBlockers', blocks: [] });
      else if (d?.kind === 'chooseObjects' && d.rules?.includes('CR 502.3')) t = answer(t, { kind: 'chooseObjects', ids: keepTapped ? d.options.slice(0, 1) : [] }); // the permanents to keep tapped
      else if (d?.kind === 'chooseObjects') t = answer(t, { kind: 'chooseObjects', ids: d.options.slice(0, d.min) });
      else if (d?.kind === 'yesNo') t = answer(t, { kind: 'yesNo', yes: true });
      else t = pass(t);
    }
    return t;
  };
  it('is full', () => expect(full(REAPER), JSON.stringify(REAPER.automation)).toBe(true));
  it('the reanimated creature is exiled when the Reaper untaps', () => {
    const s = reanimate();
    expect(onBattlefield(s)).toBe(true);
    const next = resolveAll(toNextUntap(s, false));
    expect(onBattlefield(next)).toBe(false);
    expect(next.zones.exile.some((id) => next.objects[id]!.defId === 'Test Corpse')).toBe(true);
  });
  it('negative: while the Reaper stays tapped (its controller chose not to untap it) the creature stays', () => {
    const s = reanimate();
    const next = toNextUntap(s, true);
    expect(onBattlefield(next)).toBe(true);
  });
});

describe('review fix (fail closed): a "first <description> spell" with a field the cast history cannot answer stays manual', () => {
  it('flying and mana value descriptions are not automated; type descriptions are', () => {
    const make = (t: string) => card('Test Judge', 'Creature — Human', t, '{1}', ['1', '1']);
    expect(full(make('The first spell with flying you cast each turn has improvise.'))).toBe(false);
    expect(full(make('The first creature spell with mana value 3 or greater you cast each turn has improvise.'))).toBe(false);
    expect(full(make('The first creature spell you cast each turn has improvise.'))).toBe(true);
  });
});
