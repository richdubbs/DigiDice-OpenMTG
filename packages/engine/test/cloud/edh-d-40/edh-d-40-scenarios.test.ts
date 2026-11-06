/**
 * Coordinator D, round edh-d-40 (lane d-leftovers): the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10), compiled by the
 * game's default compiler. Alice (p1) is the active player of turn 1. Each test names the rule it checks, with its negative case. CR cites are from the Comprehensive Rules of
 * 2026-09-25 (media.wizards.com text).
 *
 *   CR 120.1, 400.7, 509.1b, 702.11   "As long as this creature hasn't dealt damage yet, it has hexproof and can't be blocked." (Ratonhnhaké꞉ton)
 *   CR 603.12, 701.3a, 400.7          "... When you do, return target Equipment card from your graveyard to the battlefield, then attach it to that token." (Ratonhnhaké꞉ton)
 *   CR 611.3a, 303.4, 702.89a         "As long as another player controls enchanted creature, it can't attack or block. Otherwise, this Aura has umbra armor." (Dog Umbra)
 *   CR 508.1, 603.2, 109.2            "Whenever equipped creature attacks alone, it gets +1/+1 until end of turn for each other creature you control." (Sigil of Valor)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, hasKeyword, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, find, findAll, life, pass, scenario, zoneNames } from '../../m3/scenario';
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
const yard = (s: GameState, p: PlayerId = 'p1'): string[] => zoneNames(s, 'graveyard', p);
const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['3', '3'] });

// ---- Ratonhnhaké꞉ton ---------------------------------------------------------------------------------------------------------------------------------------------------
const GHOST = card('Test Ghost', 'Creature — Spirit', "As long as this creature hasn't dealt damage yet, it has hexproof and can't be blocked.\nWhenever this creature deals combat damage to a player, create a 1/1 white Spirit creature token with flying. When you do, return target Equipment card from your graveyard to the battlefield, then attach it to that token.", { pt: ['2', '2'] });
const BLADE = card('Test Blade', 'Artifact — Equipment', 'Equipped creature gets +1/+1.\nEquip {1}');
const ghostChars = (s: GameState) => getChars(s, find(s, 'Test Ghost', 'battlefield'));
describe('CR 120.1, 400.7, 509.1b: "As long as this creature hasn\'t dealt damage yet, it has hexproof and can\'t be blocked." (Ratonhnhaké꞉ton)', () => {
  it('is automated', () => { expect(noManual(GHOST)).toBe(true); });
  it('before it has dealt damage it has hexproof and the opponent\'s creature cannot block it', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Ghost'] }, p2: { battlefield: ['Test Bear'] }, defs: [GHOST, BLADE, BEAR] });
    expect(hasKeyword(ghostChars(s0), 'hexproof')).toBe(true);
    let s = declareAttackers(toDeclareAttackers(s0), [[find(s0, 'Test Ghost', 'battlefield')]]);
    s = passUntil(s, (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'combatDamage', 'blockers or damage', 10);
    // Bob has an untapped creature, but the Ghost can't be blocked: no blockers decision comes up
    expect(s.pending?.kind).not.toBe('declareBlockers');
    expect(s.turn.step).toBe('combatDamage');
  });
  it('after its combat damage it loses hexproof and may be blocked; the token comes, the Equipment returns and is attached to the token (CR 603.12, 701.3a)', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Ghost'], graveyard: ['Test Blade'] }, defs: [GHOST, BLADE, BEAR] });
    let s = declareAttackers(toDeclareAttackers(s0), [[find(s0, 'Test Ghost', 'battlefield')]]);
    s = passUntil(s, (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'combatDamage', 'blockers or damage', 10);
    if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    s = drain(s, { targets: [[obj(find(s0, 'Test Blade', 'graveyard', 'p1'))]] });
    expect(life(s, 'p2')).toBe(18);
    expect(hasKeyword(ghostChars(s), 'hexproof')).toBe(false);
    const blade = find(s, 'Test Blade', 'battlefield');
    const token = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token');
    expect(token).toBeDefined();
    expect(s.objects[blade]!.attachedTo).toBe(token);
    expect(s.objects[blade]!.controller).toBe('p1');
    expect(yard(s)).not.toContain('Test Blade');
  });
  it('negative: with no Equipment card in the graveyard only the token is made', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Ghost'] }, defs: [GHOST, BLADE, BEAR] });
    let s = declareAttackers(toDeclareAttackers(s0), [[find(s0, 'Test Ghost', 'battlefield')]]);
    s = passUntil(s, (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'combatDamage', 'blockers or damage', 10);
    if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    s = drain(s);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token').length).toBe(1);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Blade')).toBe(false);
  });
});

// ---- Dog Umbra --------------------------------------------------------------------------------------------------------------------------------------------------------------
const AURA = card('Test Hound Aura', 'Enchantment — Aura', "Enchant creature\nAs long as another player controls enchanted creature, it can't attack or block. Otherwise, this Aura has flying.");
describe('CR 611.3a, 303.4: "As long as another player controls enchanted creature, it can\'t attack or block. Otherwise, this Aura has umbra armor." (Dog Umbra)', () => {
  it('is automated', () => { expect(noManual(AURA)).toBe(true); });
  const setup = (host: PlayerId) => {
    const s0 = scenario([], { p1: { hand: ['Test Hound Aura'], battlefield: host === 'p1' ? ['Test Bear'] : [] }, p2: { battlefield: host === 'p2' ? ['Test Bear'] : [] }, defs: [AURA, BEAR] });
    return resolveAll(cast(s0, 'Test Hound Aura', { targets: [[obj(find(s0, 'Test Bear', 'battlefield', host))]] }));
  };
  it('an opponent\'s creature wearing the Aura cannot attack or block, and the Aura does not have flying', () => {
    const s = setup('p2');
    const aura = getChars(s, find(s, 'Test Hound Aura', 'battlefield'));
    expect(hasKeyword(aura, 'flying')).toBe(false);
    const bear = getChars(s, find(s, 'Test Bear', 'battlefield', 'p2'));
    expect(hasKeyword(bear, 'flying')).toBe(false);
    // on Bob's turn (turn 2) his bear is not a candidate attacker; control: without the Aura it is
    const t = advanceTo(s, 2, 'declareAttackers');
    const cands = (t.pending as unknown as { candidates?: { id: ObjectId }[] }).candidates ?? [];
    expect(cands.map((c) => c.id)).not.toContain(find(t, 'Test Bear', 'battlefield', 'p2'));
  });
  it('control: the same creature without the Aura is a candidate attacker on its controller\'s turn', () => {
    const s0 = scenario([], { p2: { battlefield: ['Test Bear'] }, defs: [AURA, BEAR] });
    const t = advanceTo(s0, 2, 'declareAttackers');
    const cands = (t.pending as unknown as { candidates?: { id: ObjectId }[] }).candidates ?? [];
    expect(cands.map((c) => c.id)).toContain(find(t, 'Test Bear', 'battlefield', 'p2'));
  });
  it('negative: on Alice\'s own creature the Aura itself has flying (the otherwise branch) and the creature may attack', () => {
    const s = setup('p1');
    expect(hasKeyword(getChars(s, find(s, 'Test Hound Aura', 'battlefield')), 'flying')).toBe(true);
    const t = toDeclareAttackers(s);
    expect(t.pending?.kind).toBe('declareAttackers');
    expect((t.pending as unknown as { attackers?: ObjectId[] }).attackers ?? [find(t, 'Test Bear', 'battlefield', 'p1')]).toContain(find(t, 'Test Bear', 'battlefield', 'p1'));
  });
});

// umbra armor through the same wording (CR 702.89a): on the controller's own creature the Aura has it, and a destroy effect removes the Aura instead of the creature
const UMBRA = card('Test Umbra Hound', 'Enchantment — Aura', "Flash\nEnchant creature\nAs long as another player controls enchanted creature, it can't attack or block. Otherwise, this Aura has umbra armor.");
const DOOM = card('Test Doom', 'Sorcery', 'Destroy target creature.');
describe('CR 702.89a, 611.3a: the "Otherwise, this Aura has umbra armor." branch (Dog Umbra)', () => {
  it('is automated', () => { expect(noManual(UMBRA)).toBe(true); });
  it('on Alice\'s own creature, destroying the creature destroys the Aura instead', () => {
    const s0 = scenario([], { p1: { hand: ['Test Umbra Hound', 'Test Doom'], battlefield: ['Test Bear'] }, defs: [UMBRA, DOOM, BEAR] });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const s1 = resolveAll(cast(s0, 'Test Umbra Hound', { targets: [[obj(bear)]] }));
    const s = resolveAll(cast(s1, 'Test Doom', { targets: [[obj(bear)]] }));
    expect(s.zones.battlefield).toContain(bear);
    expect(yard(s)).toContain('Test Umbra Hound');
  });
  it('negative: on an opponent\'s creature the Aura has no umbra armor, so the creature is destroyed (and the Aura goes with it)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Umbra Hound', 'Test Doom'] }, p2: { battlefield: ['Test Bear'] }, defs: [UMBRA, DOOM, BEAR] });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    const s1 = resolveAll(cast(s0, 'Test Umbra Hound', { targets: [[obj(bear)]] }));
    const s = resolveAll(cast(s1, 'Test Doom', { targets: [[obj(bear)]] }));
    expect(s.zones.battlefield).not.toContain(bear);
    expect(yard(s, 'p2')).toContain('Test Bear');
  });
});

// ---- Sigil of Valor ---------------------------------------------------------------------------------------------------------------------------------------------------------
const SIGIL = card('Test Sigil', 'Artifact — Equipment', 'Whenever equipped creature attacks alone, it gets +1/+1 until end of turn for each other creature you control.\nEquip {1}');
describe('CR 508.1, 603.2, 109.2: "Whenever equipped creature attacks alone, it gets +1/+1 until end of turn for each other creature you control." (Sigil of Valor)', () => {
  it('is automated', () => { expect(noManual(SIGIL)).toBe(true); });
  const attackAlone = (bears: number, withSigil = true) => {
    const names = ['Test Bear', ...Array.from({ length: bears }, () => 'Test Bear'), ...(withSigil ? ['Test Sigil'] : [])];
    const s0 = scenario([], { p1: { battlefield: names }, defs: [SIGIL, BEAR] });
    const first = findAll(s0, 'Test Bear', 'battlefield', 'p1')[0]!;
    const s1 = withSigil ? tweak(s0, (g) => { g.objects[find(g, 'Test Sigil', 'battlefield')]!.attachedTo = first; }) : s0;
    let s = declareAttackers(toDeclareAttackers(s1), [[first]]);
    s = drain(s);
    return { s, first };
  };
  it('with three other creatures the equipped attacker gets +3/+3 (not counting itself)', () => {
    const { s, first } = attackAlone(3);
    const c = getChars(s, first);
    expect([Number(c.power), Number(c.toughness)]).toEqual([6, 6]);
  });
  it('the bonus is counted as the ability resolves and does not change when the number of creatures does (ruling 2015-06-22, CR 611.2c)', () => {
    const { s, first } = attackAlone(3);
    const others = findAll(s, 'Test Bear', 'battlefield', 'p1').filter((id) => id !== first);
    const t = tweak(s, (g) => { g.zones.battlefield = g.zones.battlefield.filter((id) => id !== others[0]); });
    const c = getChars(t, first);
    expect([Number(c.power), Number(c.toughness)]).toEqual([6, 6]);
  });
  it('negative: with no other creature it gets +0/+0', () => {
    const { s, first } = attackAlone(0);
    const c = getChars(s, first);
    expect([Number(c.power), Number(c.toughness)]).toEqual([3, 3]);
  });
  it('negative: when two creatures attack the trigger does not happen (attacks alone)', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Bear', 'Test Bear', 'Test Sigil'] }, defs: [SIGIL, BEAR] });
    const [a, b] = findAll(s0, 'Test Bear', 'battlefield', 'p1');
    const s1 = tweak(s0, (g) => { g.objects[find(g, 'Test Sigil', 'battlefield')]!.attachedTo = a!; });
    const s = drain(declareAttackers(toDeclareAttackers(s1), [[a!], [b!]]));
    const c = getChars(s, a!);
    expect([Number(c.power), Number(c.toughness)]).toEqual([3, 3]);
  });
});
