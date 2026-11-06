/**
 * Coordinator D, round edh-d-73 (lane face-down, a concept round): the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by
 * the game's default compiler, in 4-player games. Each group has its negative cases and a check that a face-down card stays hidden from the players who may not look at it.
 * CR cites are from the Comprehensive Rules text of 2026-09-25.
 *
 *   CR 708.2a, 708.3, 708.4, 110.2a  "Whenever ~ deals combat damage to a player, put the top two cards of that player's library onto the battlefield face down under your control. They're 2/2 Cyberman
 *                                    artifact creatures." (Cybership)
 *   CR 701.17a, 608.2c, 708.3        "..., each opponent mills X cards. Put all creature cards milled this way onto the battlefield face down under your control. They're 2/2 Cyberman artifact creatures."
 *                                    (The Cyber-Controller)
 *   CR 607.2a, 406.1, 708.3          "I, II -- Target player mills two cards, then exiles their graveyard. / III -- Put all creature cards exiled with ~ onto the battlefield face down under your control.
 *                                    They're 2/2 Cyberman artifact creatures." (Death in Heaven)
 *   CR 708.3, 110.2a, 400.7          "Whenever another nonartifact creature dies, return it to the battlefield under your control face down and tapped. It's a 2/2 Cyberman artifact creature."
 *                                    + a villainous choice with "chaos ensues" (Missy)
 *   CR 614.12a, 708.2                "As ~ enters, turn all other nontoken creatures face down." (Ixidron)
 *   CR 708.2a, 708.4                 "When ~ enters, turn any number of target tapped nontoken creatures face down. They're 2/2 Horror creatures." + "Tap X target creatures. They don't untap during their
 *                                    controllers' next untap steps." (Illithid Harvester // Plant Tadpoles)
 */
import { describe, expect, it } from 'vitest';
import { canSee, viewFor, type CardDef, type GameState, type ObjectId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find } from '../../m12/rules/helpers';
import { mpScenario } from '../../m12/rules/helpers';
import { advanceTo } from '../../m3/scenario';
import { runCombat } from '../../m4/helpers';
import { card, full, pt, resolveAll, settle } from '../cmd3/helpers';

const faceDownOf = (s: GameState, p: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.faceDown && s.objects[id]!.controller === p);
const namedOn = (s: GameState, p: string, defId: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === defId && s.objects[id]!.controller === p);
const libCount = (s: GameState, p: string): number => s.zones.library[p]!.length;
const text = (s: GameState, viewer: string): string => JSON.stringify(viewFor(s, viewer).objects);
const GIANT = card('Test Hill Giant', 'Creature — Giant', 'Trample', ['4', '4']);
const WISP = card('Test Wisp', 'Creature — Spirit', 'Flying', ['1', '1']);
const BOLT = card('Test Bolt Rod', 'Artifact', 'Indestructible');
const MECH = card('Test Gear Golem', 'Artifact Creature — Golem', 'Vigilance', ['3', '3']);
const KILL = card('Test Kill', 'Instant', 'Destroy target creature.');
const dies = (s0: GameState, victim: ObjectId): GameState => resolveAll(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Kill', 'hand', 'p1') }), { targets: [{ kind: 'object', id: victim }] }));

describe('Cybership: "put the top two cards of that player\'s library onto the battlefield face down under your control. They\'re 2/2 Cyberman artifact creatures." (CR 708.2a, 708.3, 110.2a)', () => {
  const SHIP = card('Test Cyber Ship', 'Artifact Creature — Construct', "Whenever ~ deals combat damage to a player, put the top two cards of that player's library onto the battlefield face down under your control. They're 2/2 Cyberman artifact creatures.", ['2', '2']);
  const board = (): GameState => mpScenario({ defs: [SHIP, GIANT, WISP, BOLT], zones: {
    p1: { battlefield: ['Test Cyber Ship'] }, p2: { library: ['Test Hill Giant', 'Test Wisp', 'Test Bolt Rod'] }, p3: { library: ['Test Bolt Rod', 'Test Bolt Rod'] } } });
  it('is automated', () => expect(full(SHIP), JSON.stringify(SHIP.automation)).toBe(true));
  it('the two top cards of the damaged player\'s library enter under the attacker\'s control, face down, as 2/2 Cyberman artifact creatures with no name', () => {
    const s0 = board();
    const ship = find(s0, 'Test Cyber Ship', 'battlefield', 'p1');
    let s = runCombat(s0, { attack: [[ship, 'p2']], block: [], until: 'combatDamage' });
    s = resolveAll(s);
    const down = faceDownOf(s, 'p1');
    expect(down).toHaveLength(2);
    expect(down.map((id) => s.objects[id]!.defId).sort()).toEqual(['Test Hill Giant', 'Test Wisp']);
    for (const id of down) {
      const c = getChars(s, id)!;
      expect(s.objects[id]!.owner).toBe('p2');
      expect(c.name).toBe('');
      expect([...c.types].sort()).toEqual(['Artifact', 'Creature']);
      expect(c.subtypes).toEqual(['Cyberman']);
      expect(pt(s, id)).toBe('2/2');
    }
    expect(libCount(s, 'p2')).toBe(libCount(s0, 'p2') - 2);
    expect(libCount(s, 'p3')).toBe(libCount(s0, 'p3'));
  });
  it('hidden information: the other players, even the cards\' owner, are not shown what the face-down cards are; their controller is', () => {
    const s0 = board();
    const ship = find(s0, 'Test Cyber Ship', 'battlefield', 'p1');
    const s = resolveAll(runCombat(s0, { attack: [[ship, 'p2']], block: [], until: 'combatDamage' }));
    const [id] = faceDownOf(s, 'p1');
    expect(canSee(s, s.objects[id!]!, 'p1')).toBe(true);
    for (const p of ['p2', 'p3', 'p4']) {
      expect(canSee(s, s.objects[id!]!, p), p).toBe(false);
      expect(text(s, p), p).not.toMatch(/Test Hill Giant|Test Wisp/);
    }
  });
  it('negative: the cards come from the library of the player who was dealt the damage, not another player', () => {
    const s0 = board();
    const ship = find(s0, 'Test Cyber Ship', 'battlefield', 'p1');
    const s = resolveAll(runCombat(s0, { attack: [[ship, 'p3']], block: [], until: 'combatDamage' }));
    expect(faceDownOf(s, 'p1').map((id) => s.objects[id]!.owner)).toEqual(['p3', 'p3']);
    expect(libCount(s, 'p2')).toBe(libCount(s0, 'p2'));
  });
  it('negative: a blocked attacker deals no combat damage to a player, so nothing is put onto the battlefield', () => {
    const s0 = mpScenario({ defs: [SHIP, GIANT, BOLT], zones: { p1: { battlefield: ['Test Cyber Ship'] }, p2: { battlefield: ['Test Hill Giant'], library: ['Test Bolt Rod', 'Test Bolt Rod'] } } });
    const ship = find(s0, 'Test Cyber Ship', 'battlefield', 'p1');
    const giant = find(s0, 'Test Hill Giant', 'battlefield', 'p2');
    const s = resolveAll(runCombat(s0, { attack: [[ship, 'p2']], block: [[giant, ship]], until: 'combatDamage' }));
    expect(faceDownOf(s, 'p1')).toHaveLength(0);
  });
});

describe('The Cyber-Controller: "each opponent mills X cards. Put all creature cards milled this way onto the battlefield face down under your control. They\'re 2/2 Cyberman artifact creatures." (CR 701.17a, 708.3)', () => {
  const CTRL = card('Test Cyber Overlord', 'Legendary Artifact Creature — Cyberman', "When ~ enters, each opponent mills X cards. Put all creature cards milled this way onto the battlefield face down under your control. They're 2/2 Cyberman artifact creatures.\nOther artifact creatures you control get +1/+1.", ['4', '4'], '{X}');
  const cast = (s0: GameState, x: number): GameState => {
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Cyber Overlord', 'hand', 'p1') });
    if (s.pending?.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: x });
    return resolveAll(s);
  };
  const board = (): GameState => mpScenario({ defs: [CTRL, GIANT, WISP, BOLT], zones: {
    p1: { hand: ['Test Cyber Overlord'], battlefield: ['Plains', 'Plains', 'Plains', 'Plains'], library: ['Test Wisp'] },
    p2: { library: ['Test Hill Giant', 'Test Bolt Rod', 'Test Wisp'] }, p3: { library: ['Test Bolt Rod', 'Test Wisp', 'Test Wisp'] }, p4: { library: ['Test Bolt Rod', 'Test Bolt Rod', 'Test Bolt Rod'] } } });
  it('is automated', () => expect(full(CTRL), JSON.stringify(CTRL.automation)).toBe(true));
  it('X cards are milled from each opponent; only the creature cards among them enter face down under your control, as 2/2 Cyberman artifact creatures', () => {
    const s0 = board();
    const s = cast(s0, 2);
    const down = faceDownOf(s, 'p1');
    expect(down.map((id) => s.objects[id]!.defId).sort()).toEqual(['Test Hill Giant', 'Test Wisp']); // p2 milled Giant and Rod, p3 Rod and Wisp, p4 Rod and Rod
    expect(down.map((id) => s.objects[id]!.owner).sort()).toEqual(['p2', 'p3']);
    expect(libCount(s, 'p2')).toBe(libCount(s0, 'p2') - 2);
    expect(libCount(s, 'p4')).toBe(libCount(s0, 'p4') - 2);
    expect(s.zones.graveyard.p4!.map((id) => s.objects[id]!.defId)).toEqual(['Test Bolt Rod', 'Test Bolt Rod']); // noncreature cards stay in the graveyard
    expect(s.zones.graveyard.p2!.map((id) => s.objects[id]!.defId)).toEqual(['Test Bolt Rod']);
    expect(s.zones.graveyard.p3!.map((id) => s.objects[id]!.defId)).toEqual(['Test Bolt Rod']);
    expect(libCount(s, 'p1')).toBe(libCount(s0, 'p1')); // you mill nothing
    for (const id of down) { expect(pt(s, id)).toBe('3/3'); expect(getChars(s, id)!.subtypes).toEqual(['Cyberman']); } // 2/2, +1/+1 from the Overlord's own anthem: they are artifact creatures
  });
  it('X = 0 mills nothing and puts nothing onto the battlefield', () => {
    const s = cast(board(), 0);
    expect(faceDownOf(s, 'p1')).toHaveLength(0);
  });
  it('hidden information: none of the opponents is shown the face-down cards\' names', () => {
    const s = cast(board(), 2);
    for (const p of ['p2', 'p3', 'p4']) expect(text(s, p), p).not.toMatch(/Test Hill Giant/);
  });
});

describe('Death in Heaven: "Target player mills two cards, then exiles their graveyard." / "Put all creature cards exiled with ~ onto the battlefield face down under your control." (CR 607.2a, 406.1, 708.3)', () => {
  const SAGA = card('Test Time Saga', 'Enchantment — Saga', "I, II — Target player mills two cards, then exiles their graveyard.\nIII — Put all creature cards exiled with ~ onto the battlefield face down under your control. They're 2/2 Cyberman artifact creatures.");
  const board = (): GameState => mpScenario({ defs: [SAGA, GIANT, WISP, BOLT], zones: {
    p1: { hand: ['Test Time Saga'] }, p2: { graveyard: ['Test Bolt Rod'], library: ['Test Hill Giant', 'Test Bolt Rod', 'Test Wisp', 'Test Wisp'] }, p3: { graveyard: ['Test Hill Giant'] } } });
  it('is automated', () => expect(full(SAGA), JSON.stringify(SAGA.automation)).toBe(true));
  it('chapter I mills two and exiles the whole graveyard of the target player; chapter III puts the creature cards exiled with it onto the battlefield face down, and leaves the others', () => {
    const s0 = board();
    let s = resolveAll(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Time Saga', 'hand', 'p1') }), { targets: [] }), { targets: [{ kind: 'player', id: 'p2' }] });
    expect(s.zones.graveyard.p2).toHaveLength(0);
    expect((s.zones.exile ?? []).map((id) => s.objects[id]!.defId).sort()).toEqual(['Test Bolt Rod', 'Test Bolt Rod', 'Test Hill Giant']);
    expect(libCount(s, 'p2')).toBe(libCount(s0, 'p2') - 2);
    s = resolveAll(advanceTo(s, 5, 'main1'), { targets: [{ kind: 'player', id: 'p3' }] }); // chapter II: p3's graveyard (Test Hill Giant) is exiled too
    expect(s.zones.graveyard.p3).toHaveLength(0);
    s = resolveAll(advanceTo(s, 9, 'main1'));
    const down = faceDownOf(s, 'p1');
    expect(down.map((id) => s.objects[id]!.defId).sort()).toEqual(['Test Hill Giant', 'Test Hill Giant']); // the creature card p2's mill put in the graveyard and the one of p3
    for (const id of down) { expect(getChars(s, id)!.subtypes).toEqual(['Cyberman']); expect(pt(s, id)).toBe('2/2'); }
    expect((s.zones.exile ?? []).map((id) => s.objects[id]!.defId).sort()).toEqual(['Plains', 'Plains', 'Test Bolt Rod', 'Test Bolt Rod']); // the noncreature cards stay in exile (chapter II milled two Plains of p3 first)
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Time Saga')).toBe(false); // sacrificed after III
  });
});

describe('Missy: "return it to the battlefield under your control face down and tapped. It\'s a 2/2 Cyberman artifact creature." and the villainous choice with "chaos ensues" (CR 708.3, 701.55)', () => {
  const MISSY = card('Test Time Lady', 'Legendary Creature — Time Lord', "Whenever another nonartifact creature dies, return it to the battlefield under your control face down and tapped. It's a 2/2 Cyberman artifact creature.\nAt the beginning of your end step, each opponent faces a villainous choice — Each artifact creature you control deals 1 damage to that opponent, or you draw a card and chaos ensues.", ['3', '3']);
  const board = (): GameState => mpScenario({ defs: [MISSY, GIANT, MECH, KILL], zones: { p1: { hand: ['Test Kill'], battlefield: ['Test Time Lady'] }, p2: { battlefield: ['Test Hill Giant', 'Test Gear Golem'] } } });
  it('is automated', () => expect(full(MISSY), JSON.stringify(MISSY.automation)).toBe(true));
  it('another player\'s nonartifact creature that dies returns under your control, face down and tapped, as a 2/2 Cyberman artifact creature', () => {
    const s0 = board();
    const s = dies(s0, find(s0, 'Test Hill Giant', 'battlefield', 'p2'));
    const down = faceDownOf(s, 'p1');
    expect(down).toHaveLength(1);
    const o = s.objects[down[0]!]!;
    expect(o.defId).toBe('Test Hill Giant');
    expect(o.owner).toBe('p2');
    expect(o.tapped).toBe(true);
    expect(getChars(s, o.id)!.subtypes).toEqual(['Cyberman']);
    expect(pt(s, o.id)).toBe('2/2');
    for (const p of ['p2', 'p3', 'p4']) expect(text(s, p), p).not.toMatch(/Test Hill Giant/);
  });
  it('negative: an artifact creature that dies stays in the graveyard', () => {
    const s0 = board();
    const s = dies(s0, find(s0, 'Test Gear Golem', 'battlefield', 'p2'));
    expect(faceDownOf(s, 'p1')).toHaveLength(0);
    expect(s.zones.graveyard.p2!.map((id) => s.objects[id]!.defId)).toEqual(['Test Gear Golem']);
  });
  it('negative: the card itself dying is not "another" creature', () => {
    const s0 = board();
    const s = dies(s0, find(s0, 'Test Time Lady', 'battlefield', 'p1'));
    expect(faceDownOf(s, 'p1')).toHaveLength(0);
  });
});

describe('Ixidron: "As ~ enters, turn all other nontoken creatures face down." (CR 614.12a, 708.2)', () => {
  const IXI = card('Test Mask Wizard', 'Creature — Illusion', "As ~ enters, turn all other nontoken creatures face down.\n~'s power and toughness are each equal to the number of face-down creatures on the battlefield.", ['0', '0']);
  const MAKE = card('Test Spirit Maker', 'Sorcery', 'Create a 1/1 white Spirit creature token.');
  const board = (): GameState => mpScenario({ defs: [IXI, GIANT, WISP, MECH, MAKE], zones: {
    p1: { hand: ['Test Mask Wizard'], battlefield: ['Plains', 'Plains', 'Test Hill Giant'] }, p2: { battlefield: ['Test Wisp', 'Test Gear Golem'] }, p3: { battlefield: ['Test Wisp'] } } });
  const cast = (s0: GameState): GameState => resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Mask Wizard', 'hand', 'p1') }));
  it('is automated', () => expect(full(IXI), JSON.stringify(IXI.automation)).toBe(true));
  it('every other nontoken creature, of every player, is face down as a plain 2/2; the card itself stays face up and is as big as the number of them', () => {
    const s = cast(board());
    const ixi = namedOn(s, 'p1', 'Test Mask Wizard')[0]!;
    expect(s.objects[ixi]!.faceDown).toBe(false);
    const all = s.zones.battlefield.filter((id) => s.objects[id]!.faceDown);
    expect(all).toHaveLength(4);
    for (const id of all) { expect(pt(s, id)).toBe('2/2'); expect(getChars(s, id)!.name).toBe(''); expect(getChars(s, id)!.subtypes).toEqual([]); }
    expect(pt(s, ixi)).toBe('4/4');
    for (const p of ['p2', 'p3', 'p4']) expect(text(s, p), p).not.toMatch(/Test Hill Giant/); // p1's face-down Giant is hidden from the others
  });
  it('negative: a token creature stays face up (a Spirit token made first, then the card cast)', () => {
    const s0 = mpScenario({ defs: [IXI, GIANT, MAKE], zones: { p1: { hand: ['Test Spirit Maker', 'Test Mask Wizard'], battlefield: ['Test Hill Giant'] } } });
    const s1 = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Spirit Maker', 'hand', 'p1') }));
    const token = s1.zones.battlefield.find((id) => s1.objects[id]!.kind === 'token')!;
    expect(token).toBeDefined();
    const s = resolveAll(act(s1, { type: 'cast', player: 'p1', card: find(s1, 'Test Mask Wizard', 'hand', 'p1') }));
    expect(s.objects[token]!.faceDown).toBe(false);
    expect(s.objects[find(s, 'Test Hill Giant', 'battlefield', 'p1')]!.faceDown).toBe(true);
  });
  it('ruling 2006-09-25: a creature that enters at the same time as Ixidron enters face up, whatever the order they enter in', () => {
    const REANIM = card('Test Rising', 'Sorcery', 'Return all creature cards from your graveyard to the battlefield.');
    const s0 = mpScenario({ defs: [IXI, GIANT, WISP, REANIM], zones: { p1: { hand: ['Test Rising'], graveyard: ['Test Hill Giant', 'Test Mask Wizard', 'Test Wisp'] } } });
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Rising', 'hand', 'p1') }));
    expect(faceDownOf(s, 'p1')).toHaveLength(0);
    expect(namedOn(s, 'p1', 'Test Hill Giant')).toHaveLength(1);
    expect(namedOn(s, 'p1', 'Test Wisp')).toHaveLength(1);
  });
});

describe('Illithid Harvester: "turn any number of target tapped nontoken creatures face down. They\'re 2/2 Horror creatures." (CR 708.2a, 708.4)', () => {
  const HARV = card('Test Mind Harvester', 'Creature — Horror', "When ~ enters, turn any number of target tapped nontoken creatures face down. They're 2/2 Horror creatures.", ['3', '3']);
  const TAD = card('Test Tadpoles', 'Sorcery', "Tap X target creatures. They don't untap during their controllers' next untap steps.", undefined, '{X}');
  const board = (): GameState => mpScenario({ defs: [HARV, TAD, GIANT, WISP, MECH], zones: {
    p1: { hand: ['Test Mind Harvester'], battlefield: ['Plains'] }, p2: { battlefield: [{ name: 'Test Hill Giant', tapped: true }, 'Test Wisp'] }, p3: { battlefield: [{ name: 'Test Gear Golem', tapped: true }] } } });
  it('is automated', () => { expect(full(HARV), JSON.stringify(HARV.automation)).toBe(true); expect(full(TAD), JSON.stringify(TAD.automation)).toBe(true); });
  it('the chosen tapped creatures are turned face down as 2/2 Horror creatures; an untapped one is not a legal target', () => {
    const s0 = board();
    const giant = find(s0, 'Test Hill Giant', 'battlefield', 'p2');
    const golem = find(s0, 'Test Gear Golem', 'battlefield', 'p3');
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Mind Harvester', 'hand', 'p1') }));
    s = resolveAll(s, { targets: [{ kind: 'object', id: giant }, { kind: 'object', id: golem }] });
    for (const id of [giant, golem]) {
      expect(s.objects[id]!.faceDown, id).toBe(true);
      expect(s.objects[id]!.tapped).toBe(true);
      expect(getChars(s, id)!.subtypes).toEqual(['Horror']);
      expect([...getChars(s, id)!.types]).toEqual(['Creature']);
      expect(pt(s, id)).toBe('2/2');
    }
    const wisp = find(s0, 'Test Wisp', 'battlefield', 'p2');
    expect(s.objects[wisp]!.faceDown).toBe(false);
  });
  it('zero targets is allowed', () => {
    const s0 = board();
    const s = resolveAll(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Mind Harvester', 'hand', 'p1') })), { targets: [] });
    expect(s.zones.battlefield.some((id) => s.objects[id]!.faceDown)).toBe(false);
  });
  it('Plant Tadpoles: the X target creatures are tapped and do not untap during their controllers\' next untap steps', () => {
    const s0 = mpScenario({ defs: [TAD, GIANT, WISP], zones: { p1: { hand: ['Test Tadpoles'], battlefield: ['Plains', 'Plains'] }, p2: { battlefield: ['Test Hill Giant'] }, p3: { battlefield: ['Test Wisp'] } } });
    const giant = find(s0, 'Test Hill Giant', 'battlefield', 'p2');
    const wisp = find(s0, 'Test Wisp', 'battlefield', 'p3');
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Tadpoles', 'hand', 'p1') });
    if (s.pending?.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: 2 });
    s = resolveAll(settle(s, { targets: [{ kind: 'object', id: giant }, { kind: 'object', id: wisp }] }), { targets: [{ kind: 'object', id: giant }, { kind: 'object', id: wisp }] });
    expect(s.objects[giant]!.tapped).toBe(true);
    expect(s.objects[wisp]!.tapped).toBe(true);
    const toTurn = (s1: GameState, turn: number): GameState => { let t = s1; for (let i = 0; i < 600 && !(t.turn.number === turn && t.turn.step === 'main1'); i++) t = act(t, { type: 'pass', player: t.pending!.player }); return t; };
    const t2 = toTurn(s, 2); // p2's turn: the Giant's controller's untap step passed, and it stayed tapped; the Wisp (p3) is not untapped by p2's untap step anyway
    expect(t2.objects[giant]!.tapped).toBe(true);
    const t3 = toTurn(t2, 3); // p3's turn: the Wisp stays tapped, and the Giant too (nobody untapped it)
    expect(t3.objects[wisp]!.tapped).toBe(true);
    const t5 = toTurn(t3, 5); // p1's turn again: after their next untap steps the effect is over for p2 and p3; the creatures are still tapped (they untap in their own controller's untap step)
    expect(t5.objects[giant]!.tapped).toBe(true);
    const t6 = toTurn(t5, 6); // p2's turn again: the Giant now untaps
    expect(t6.objects[giant]!.tapped).toBe(false);
  });
});
