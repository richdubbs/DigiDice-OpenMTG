/**
 * Standard round 5, slice r5-static: the costs to attack and to block (statics/combat-tax.ts, core/combat-tax.ts), played through the engine with synthetic
 * cards compiled by the game's default compiler (wordings are invented, design 6.10).
 *
 *   CR 508.1h   the total cost of an attack declaration: each taxed attacker, each effect (they add up); only attacks on what the effect protects
 *   CR 508.1i-j the player may decline (declares again) or pay, with mana abilities; a cost they can't pay rejects the declaration (CR 118.3, 733)
 *   CR 508.1f   attackers are tapped first: an attacking mana creature without vigilance can't pay its own tax
 *   CR 509.1d-f the same for blockers ("for each of those creatures": each blocking creature once)
 *   CR 508.1d   a requirement that needs a cost is not counted: with a tax in play the requirements are not checked (said before the choice)
 *   CR 611.2a   "Until your next turn, creatures can't attack you or planeswalkers you control unless ...": a resolved effect
 *   CR 119.4    a cost in life
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { act, answer, find, findAll, pass, put, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string], extra: Partial<OracleCard> = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}), ...extra } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.autoRatio === 1 && (d.automation.faces ?? []).every((f) => f.abilities.every((a) => a.level === 'full')) && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const ELF = card('Test Elf', 'Creature — Elf', '{T}: Add {G}.', ['1', '1']);
const VIGIL_ELF = card('Test Vigil Elf', 'Creature — Elf', 'Vigilance\n{T}: Add {G}.', ['1', '1']);
const PRISON = card('Test Prison', 'Enchantment', "Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you.");
const WARD = card('Test Ward', 'Enchantment', "Creatures can't attack you or planeswalkers you control unless their controller pays {1} for each of those creatures.");
const TITHE = card('Test Tithe Angel', 'Creature — Angel', "As long as ~ is untapped, creatures can't attack you or planeswalkers you control unless their controller pays {1} for each of those creatures.\nAs long as ~ is attacking, creatures can't block unless their controller pays {1} for each of those creatures.", ['3', '5']);
const WALKER = card('Test Walker', 'Legendary Planeswalker — Testa', '+1: You gain 1 life.', undefined, { loyalty: '3' } as Partial<OracleCard>);
const TOLL = card('Test Toll', 'Instant', "Until your next turn, creatures can't attack you or planeswalkers you control unless their controller pays {1} for each of those creatures.");
const BLOOD = card('Test Blood Toll', 'Instant', "Until your next turn, creatures can't attack you or planeswalkers you control unless their controller pays 2 life for each of those creatures.");
const BRUTE = card('Test Brute', 'Creature — Ogre', 'This creature attacks each combat if able.', ['3', '3']);

const DEFS = [BEAR, ELF, VIGIL_ELF, PRISON, WARD, TITHE, WALKER, TOLL, BLOOD, BRUTE];

function until(s0: GameState, kind: string): GameState {
  let s = s0;
  for (let guard = 0; s.pending?.kind !== kind; guard++) {
    if (guard > 40) throw new Error(`no ${kind}`);
    s = pass(s);
  }
  return s;
}
/** Ready creatures of p1 (no summoning sickness, CR 302.6). */
function ready(s: GameState, ...names: string[]): string[] {
  const ids = names.flatMap((n) => findAll(s, n, 'battlefield', 'p1'));
  for (const id of ids) s.objects[id]!.controlledSinceTurn = -1;
  return ids;
}
const tapped = (s: GameState, name: string, owner: string): number => findAll(s, name, 'battlefield', owner).filter((id) => s.objects[id]!.tapped).length;
const attackers = (s: GameState): string[] => (s.combat?.attackers ?? []).map((a) => a.id);
function declare(s: GameState, attacks: { attacker: string; defender: string }[]): ReturnType<typeof applyAction> {
  return applyAction(s, { type: 'answer', player: s.pending!.player, decisionId: s.pending!.id, answer: { kind: 'declareAttackers', attacks } as never });
}

describe('templates: the tax sentences are automated', () => {
  it('attack taxes, the block tax, the conditional statics, the resolved effect and the life cost', () => {
    for (const d of [PRISON, WARD, TITHE, TOLL, BLOOD]) expect(full(d), d.name).toBe(true);
  });
});

describe('CR 508.1h-j: "Creatures can\'t attack you unless their controller pays {2} for each creature they control that\'s attacking you."', () => {
  const base = (lands: number): GameState => scenario([], { p1: { battlefield: ['Test Bear', 'Test Bear', ...Array(lands).fill('Plains')] }, p2: { battlefield: ['Test Prison'] }, defs: DEFS });

  it('two attackers cost {4}: the player is asked, pays with mana abilities, and the creatures attack', () => {
    let s = base(4);
    const bears = ready(s, 'Test Bear');
    s = until(s, 'declareAttackers');
    expect(s.pending!.kind === 'declareAttackers' && s.pending!.candidates.every((c) => c.taxed === true)).toBe(true);
    s = answer(s, { kind: 'declareAttackers', attacks: bears.map((b) => ({ attacker: b, defender: 'p2' })) });
    expect(s.pending!.kind).toBe('yesNo');
    expect(s.pending!.prompt).toContain('{4}');
    s = answer(s, { kind: 'yesNo', yes: true });
    if (s.pending?.kind === 'payCost') {
      expect(s.pending.cancellable).toBe(false); // a turn-based action: declining is done before paying
      s = answer(s, { kind: 'payCost', auto: true });
    }
    expect(tapped(s, 'Plains', 'p1')).toBe(4);
    expect(attackers(s).sort()).toEqual([...bears].sort());
  });

  it('a cost the player can\'t pay rejects the declaration and the decision stays open (CR 118.3, 733)', () => {
    let s = base(3);
    const bears = ready(s, 'Test Bear');
    s = until(s, 'declareAttackers');
    const r = declare(s, bears.map((b) => ({ attacker: b, defender: 'p2' })));
    expect(r.error?.message).toMatch(/costs \{4\}/);
    expect(r.error?.rules).toContain('CR 508.1h');
    const one = declare(s, [{ attacker: bears[0]!, defender: 'p2' }]);
    expect(one.error).toBeUndefined();
    expect(one.state.pending!.kind).toBe('yesNo');
  });

  it('declining to pay asks for the declaration again; nothing was tapped or paid', () => {
    let s = base(4);
    const bears = ready(s, 'Test Bear');
    s = until(s, 'declareAttackers');
    s = answer(s, { kind: 'declareAttackers', attacks: bears.map((b) => ({ attacker: b, defender: 'p2' })) });
    s = answer(s, { kind: 'yesNo', yes: false });
    expect(s.pending!.kind).toBe('declareAttackers');
    expect(tapped(s, 'Test Bear', 'p1') + tapped(s, 'Plains', 'p1')).toBe(0);
    s = answer(s, { kind: 'declareAttackers', attacks: [] });
    expect(attackers(s)).toEqual([]);
    expect(tapped(s, 'Plains', 'p1')).toBe(0);
  });

  it('two such effects add up (CR 508.1h: the total cost)', () => {
    let s = base(4);
    put(s, 'p2', 'battlefield', 'Test Prison');
    const [b] = ready(s, 'Test Bear');
    s = until(s, 'declareAttackers');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: b!, defender: 'p2' }] });
    expect(s.pending!.prompt).toContain('{4}');
  });
});

describe('CR 508.1f: attacking creatures are tapped before the cost is paid', () => {
  it('a mana creature without vigilance can\'t pay its own tax; with vigilance it can', () => {
    let s = scenario([], { p1: { battlefield: ['Test Elf'] }, p2: { battlefield: ['Test Ward'] }, defs: DEFS });
    const [elf] = ready(s, 'Test Elf');
    s = until(s, 'declareAttackers');
    expect(declare(s, [{ attacker: elf!, defender: 'p2' }]).error?.message).toMatch(/can't pay/);

    let v = scenario([], { p1: { battlefield: ['Test Vigil Elf'] }, p2: { battlefield: ['Test Ward'] }, defs: DEFS });
    const [ve] = ready(v, 'Test Vigil Elf');
    v = until(v, 'declareAttackers');
    v = answer(v, { kind: 'declareAttackers', attacks: [{ attacker: ve!, defender: 'p2' }] });
    v = answer(v, { kind: 'yesNo', yes: true });
    if (v.pending?.kind === 'payCost') v = answer(v, { kind: 'payCost', auto: true });
    expect(attackers(v)).toEqual([ve]);
    expect(v.objects[ve!]!.tapped).toBe(true); // tapped for the mana it paid with
  });
});

describe('CR 508.1h: what the effect protects', () => {
  it('"you or planeswalkers you control": an attack on the planeswalker is taxed; "you" alone: it is not', () => {
    for (const [prison, taxedWalker] of [['Test Ward', true], ['Test Prison', false]] as const) {
      let s = scenario([], { p1: { battlefield: ['Test Bear', 'Plains', 'Plains'] }, p2: { battlefield: [prison, { name: 'Test Walker', counters: { loyalty: 3 } }] }, defs: DEFS });
      const [b] = ready(s, 'Test Bear');
      const w = find(s, 'Test Walker', 'battlefield', 'p2');
      s = until(s, 'declareAttackers');
      s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: b!, defender: w }] });
      expect(s.pending?.kind === 'yesNo', prison).toBe(taxedWalker);
    }
  });

  it('the controller\'s own attacks are free: the tax protects "you", the effect\'s controller', () => {
    let s = scenario([], { p1: { battlefield: ['Test Bear', 'Test Prison'] }, defs: DEFS });
    const [b] = ready(s, 'Test Bear');
    s = until(s, 'declareAttackers');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: b!, defender: 'p2' }] });
    expect(attackers(s)).toEqual([b]);
  });
});

describe('CR 604.1, 611.3a: "As long as ~ is untapped, creatures can\'t attack you ..." / "As long as ~ is attacking, creatures can\'t block unless ..."', () => {
  it('the attack tax applies only while the Angel is untapped', () => {
    for (const isTapped of [false, true]) {
      let s = scenario([], { p1: { battlefield: ['Test Bear', 'Plains'] }, p2: { battlefield: [{ name: 'Test Tithe Angel', tapped: isTapped }] }, defs: DEFS });
      const [b] = ready(s, 'Test Bear');
      s = until(s, 'declareAttackers');
      s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: b!, defender: 'p2' }] });
      expect(s.pending?.kind === 'yesNo').toBe(!isTapped);
    }
  });

  it('CR 509.1d-f: while it attacks, each blocking creature costs {1}; while it does not, blocking is free', () => {
    let s = scenario([], { p1: { battlefield: ['Test Tithe Angel', 'Test Bear'] }, p2: { battlefield: ['Test Bear', 'Plains'] }, defs: DEFS });
    const [angel, bear] = ready(s, 'Test Tithe Angel', 'Test Bear');
    s = until(s, 'declareAttackers');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: angel!, defender: 'p2' }, { attacker: bear!, defender: 'p2' }] });
    s = until(s, 'declareBlockers');
    const foe = find(s, 'Test Bear', 'battlefield', 'p2');
    s = answer(s, { kind: 'declareBlockers', blocks: [{ blocker: foe, attacker: bear! }] });
    expect(s.pending!.kind).toBe('yesNo');
    s = answer(s, { kind: 'yesNo', yes: true });
    if (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    expect(tapped(s, 'Plains', 'p2')).toBe(1);
    expect(s.combat!.blockers.map((x) => x.id)).toEqual([foe]);

    let t = scenario([], { p1: { battlefield: ['Test Tithe Angel', 'Test Bear'] }, p2: { battlefield: ['Test Bear', 'Plains'] }, defs: DEFS });
    const [, bear2] = ready(t, 'Test Tithe Angel', 'Test Bear');
    t = until(t, 'declareAttackers');
    t = answer(t, { kind: 'declareAttackers', attacks: [{ attacker: bear2!, defender: 'p2' }] });
    t = until(t, 'declareBlockers');
    t = answer(t, { kind: 'declareBlockers', blocks: [{ blocker: find(t, 'Test Bear', 'battlefield', 'p2'), attacker: bear2! }] });
    expect(t.pending?.kind).not.toBe('yesNo');
    expect(tapped(t, 'Plains', 'p2')).toBe(0);
  });
});

describe('CR 509.1d-f: a block tax on blockers that can block', () => {
  const NET = card('Test Net', 'Enchantment', "As long as ~ is untapped, creatures can't block unless their controller pays {1} for each blocking creature they control.");
  it('is automated', () => expect(full(NET)).toBe(true));
  it('two blockers and one land: rejected; one blocker: the land pays; a creature blocking two attackers counts once', () => {
    let s = scenario([], { p1: { battlefield: ['Test Bear', 'Test Bear', 'Test Net'] }, p2: { battlefield: ['Test Bear', 'Test Bear', 'Plains'] }, defs: [...DEFS, NET] });
    const mine = ready(s, 'Test Bear');
    s = until(s, 'declareAttackers');
    s = answer(s, { kind: 'declareAttackers', attacks: mine.map((b) => ({ attacker: b, defender: 'p2' })) });
    s = until(s, 'declareBlockers');
    const [b1, b2] = findAll(s, 'Test Bear', 'battlefield', 'p2');
    const blocks = (bl: { blocker: string; attacker: string }[]) => applyAction(s, { type: 'answer', player: s.pending!.player, decisionId: s.pending!.id, answer: { kind: 'declareBlockers', blocks: bl } as never });
    expect(blocks([{ blocker: b1!, attacker: mine[0]! }, { blocker: b2!, attacker: mine[1]! }]).error?.rules).toContain('CR 509.1d');
    let ok = blocks([{ blocker: b1!, attacker: mine[0]! }]).state;
    expect(ok.pending!.kind).toBe('yesNo');
    ok = answer(ok, { kind: 'yesNo', yes: true });
    if (ok.pending?.kind === 'payCost') ok = answer(ok, { kind: 'payCost', auto: true });
    expect(tapped(ok, 'Plains', 'p2')).toBe(1);
    expect(ok.combat!.blockers.map((x) => x.id)).toEqual([b1]);
  });
});

/** p2 casts an instant in p1's first main phase and it resolves. */
function opponentCasts(s0: GameState, name: string): GameState {
  let s = pass(s0); // p1 passes: p2 has priority
  s = act(s, { type: 'cast', player: 'p2', card: find(s, name, 'hand', 'p2') });
  if (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
  for (let guard = 0; guard < 10 && s.zones.stack.length > 0; guard++) s = pass(s);
  return s;
}

describe('CR 611.2a: "Until your next turn, creatures can\'t attack you or planeswalkers you control unless their controller pays {1} for each of those creatures."', () => {
  it('after it resolves, an attack on its caster costs {1} per attacker', () => {
    let s = scenario([], { p1: { battlefield: ['Test Bear', 'Plains'] }, p2: { hand: ['Test Toll'], battlefield: ['Plains'] }, defs: DEFS });
    const [b] = ready(s, 'Test Bear');
    s = opponentCasts(s, 'Test Toll');
    s = until(s, 'declareAttackers');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: b!, defender: 'p2' }] });
    expect(s.pending!.kind).toBe('yesNo');
    expect(s.pending!.prompt).toContain('{1}');
  });
});

describe('CR 119.4: a cost in life ("... pays 2 life for each of those creatures")', () => {
  it('is paid in life', () => {
    let s = scenario([], { p1: { battlefield: ['Test Bear'] }, p2: { hand: ['Test Blood Toll'], battlefield: ['Plains'] }, defs: DEFS });
    const [b] = ready(s, 'Test Bear');
    s = opponentCasts(s, 'Test Blood Toll');
    s = until(s, 'declareAttackers');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: b!, defender: 'p2' }] });
    s = answer(s, { kind: 'yesNo', yes: true });
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(18);
    expect(attackers(s)).toEqual([b]);
  });
});

describe('CR 508.1d: a requirement that needs a cost is not counted', () => {
  it('with a tax in play, "attacks each combat if able" is not enforced, and the decision says why', () => {
    let s = scenario([], { p1: { battlefield: ['Test Brute'] }, p2: { battlefield: ['Test Prison'] }, defs: DEFS });
    ready(s, 'Test Brute');
    s = until(s, 'declareAttackers');
    expect(s.pending!.kind === 'declareAttackers' && s.pending!.mustObey).toBeUndefined();
    expect(s.pending!.kind === 'declareAttackers' && (s.pending!.unchecked ?? []).some((n) => /puts a cost or a limit on declarations/.test(n.text))).toBe(true);
    s = answer(s, { kind: 'declareAttackers', attacks: [] });
    expect(attackers(s)).toEqual([]);
  });
});
