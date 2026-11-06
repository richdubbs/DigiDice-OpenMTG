/**
 * Commander lane edh-perms, round edh-perms-5: the round's parser readings played through the engine with synthetic cards (invented names and wordings, design 6.10),
 * compiled by the game's default compiler. CR cites from memory unless noted (the CR text of 2026-09-25 was read for 707.9, 608.2h, 700.4, 107.1a, 111).
 *
 *   CR 608.2f, 707.2, 707.9a, 111.1    "Choose any number of target creatures you control. For each of them, create a token that's a copy of that creature, except it has haste.
 *                                      Exile those tokens at the beginning of the next end step." (a copy per target; only those tokens are exiled)
 *   CR 700.4, 701.8a, 707.9b, 107.1a   "Destroy target creature. If that creature dies this way, its controller creates two tokens that are copies of that creature, except their power is
 *                                      half that creature's power and their toughness is half that creature's toughness. Round up each time." (last known information, rounded up)
 *   CR 111.4, 107.3, 608.2h            "... create an X/1 ... creature token, where X is the number of <kind> counters on this artifact." (power worked out as the token is made)
 *   CR 122.1, 608.2c                   "... put a +1/+1 counter on each creature you control and a charge counter on each artifact you control." (two groups, only yours)
 *   CR 613.4b, 509.1b                  "Equipped creature has base power and toughness 6/6 and can't be blocked by creatures with power 2 or less." (base values, the blocker's power)
 *   CR 205.3m, 613.4c                  "Other Ninja and Rogue creatures you control get +1/+1." (each creature that is either, not the source, not an opponent's)
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, type CardDef, type Color, type GameState, type ObjectId, type TargetChoice } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, pass, scenario } from '../../m3/scenario';
import { declareAttackers, declareBlockers, passUntil, toDeclareAttackers } from '../../m4/helpers';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: Color[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as never);
}
const automated = (d: CardDef): boolean => d.automation.level === 'full';
const chars = (s: GameState, id: ObjectId) => getChars(s, id);
void applyAction;

interface Picks { yes?: boolean; targets?: TargetChoice[][] }
/** Answer every decision until a player has priority: yes/no by `yes`, targets in order from `targets`, mana automatically. */
function drive(s0: GameState, o: Picks = {}): GameState {
  let s = s0;
  const tq = [...(o.targets ?? [])];
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending as unknown as { kind: string; options?: ObjectId[]; min?: number; max?: number };
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options!.slice(0, Math.max(p.min ?? 0, 1)).slice(0, p.max) });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: (s.pending as unknown as { items: { id: string }[] }).items.map((i) => i.id) });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: tq.shift() ?? [] });
    else throw new Error(`unexpected decision ${JSON.stringify(s.pending)}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Picks = {}): GameState {
  let s = drive(s0, o);
  for (let guard = 0; guard < 40 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, o);
  return s;
}
/** Cast the card `name` from p1's hand, paying with `mana` put in the pool, and resolve everything. */
function castAndResolve(s0: GameState, name: string, o: Picks = {}, mana: string[] = ['C']): GameState {
  for (const m of mana) s0.players[0]!.manaPool.push({ type: m } as never);
  return resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), o);
}
const onBf = (s: GameState, name: string, controller: 'p1' | 'p2'): ObjectId[] =>
  s.zones.battlefield.filter((id) => s.objects[id]!.controller === controller && chars(s, id).name === name);
const target = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const pt = (s: GameState, id: ObjectId): [number, number] => [Number(chars(s, id).power), Number(chars(s, id).toughness)];

describe('CR 608.2f, 707.2, 707.9a, 111.1: "Choose any number of target creatures you control. For each of them, create a token that\'s a copy of that creature, except it has haste. Exile those tokens at the beginning of the next end step."', () => {
  const TWIN = card('Test Twin Rite', 'Sorcery', 'Choose any number of target creatures you control. For each of them, create a token that\'s a copy of that creature, except it has haste. Exile those tokens at the beginning of the next end step.', { cost: '{1}' });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', { pt: ['4', '4'] });
  const defs = [TWIN, BEAR, OGRE];
  const hasHaste = (s: GameState, id: ObjectId): boolean => chars(s, id).keywords.some((k) => k.keyword === 'haste');
  it('is automated; each chosen creature gets its own token copy with haste, the originals are untouched', () => {
    expect(automated(TWIN)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Bear', 'Test Ogre'], hand: ['Test Twin Rite'] }, defs });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const ogre = find(s0, 'Test Ogre', 'battlefield', 'p1');
    const r = castAndResolve(s0, 'Test Twin Rite', { targets: [[target(bear), target(ogre)]] });
    const bears = onBf(r, 'Test Bear', 'p1');
    const ogres = onBf(r, 'Test Ogre', 'p1');
    expect(bears).toHaveLength(2);
    expect(ogres).toHaveLength(2);
    for (const id of [...bears, ...ogres]) expect(r.objects[id]!.kind === 'token' || id === bear || id === ogre).toBe(true);
    const bearToken = bears.find((id) => id !== bear)!;
    const ogreToken = ogres.find((id) => id !== ogre)!;
    expect(r.objects[bearToken]!.kind).toBe('token');
    expect(pt(r, bearToken)).toEqual([2, 2]);
    expect(pt(r, ogreToken)).toEqual([4, 4]);
    expect(hasHaste(r, bearToken)).toBe(true);
    expect(hasHaste(r, ogreToken)).toBe(true);
    expect(hasHaste(r, bear)).toBe(false); // the exception is the token's, not the original's
    expect(hasHaste(r, ogre)).toBe(false);
  });
  it('CR 608.2f: "any number" includes none: with no target nothing is created', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Bear'], hand: ['Test Twin Rite'] }, defs });
    const r = castAndResolve(s0, 'Test Twin Rite', { targets: [[]] });
    expect(onBf(r, 'Test Bear', 'p1')).toHaveLength(1);
  });
  it('one target: exactly one token (a single creature is not copied twice), and only that creature is copied', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Bear', 'Test Ogre'], hand: ['Test Twin Rite'] }, defs });
    const r = castAndResolve(s0, 'Test Twin Rite', { targets: [[target(find(s0, 'Test Ogre', 'battlefield', 'p1'))]] });
    expect(onBf(r, 'Test Ogre', 'p1')).toHaveLength(2);
    expect(onBf(r, 'Test Bear', 'p1')).toHaveLength(1);
  });
  it('the tokens are exiled at the beginning of the next end step (CR 603.7): the originals and tokens made by anything else stay', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Bear', 'Test Ogre'], hand: ['Test Twin Rite'] }, defs });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const ogre = find(s0, 'Test Ogre', 'battlefield', 'p1');
    const r = castAndResolve(s0, 'Test Twin Rite', { targets: [[target(bear), target(ogre)]] });
    expect(onBf(r, 'Test Bear', 'p1')).toHaveLength(2);
    const end = resolveAll(advanceTo(r, 1, 'end'));
    expect(onBf(end, 'Test Bear', 'p1')).toEqual([bear]);
    expect(onBf(end, 'Test Ogre', 'p1')).toEqual([ogre]);
  });
});

describe('CR 700.4, 701.8a, 707.9b, 107.1a: "Destroy target creature. If that creature dies this way, its controller creates two tokens that are copies of that creature, except their power is half ... Round up each time."', () => {
  const SAW = card('Test Halving Saw', 'Instant', 'Destroy target creature. If that creature dies this way, its controller creates two tokens that are copies of that creature, except their power is half that creature\'s power and their toughness is half that creature\'s toughness. Round up each time.', { cost: '{1}' });
  const ANTHEM = card('Test Banner', 'Enchantment', 'Creatures you control get +1/+1.', { cost: '{1}' });
  const GRAVEYARD_EXILE = card('Test Void Veil', 'Enchantment', 'If a creature would die, exile it instead.', { cost: '{1}' });
  const GIANT = card('Test Giant', 'Creature — Giant', '', { pt: ['5', '4'] });
  const HIDE = card('Test Hide', 'Creature — Beast', 'Indestructible', { pt: ['5', '5'] });
  const defs = [SAW, ANTHEM, GRAVEYARD_EXILE, GIANT, HIDE];
  const save = (s0: GameState, id: ObjectId): GameState => castAndResolve(s0, 'Test Halving Saw', { targets: [[target(id)]] });
  it('is automated; the opponent\'s 5/4 dies, its controller (not the caster) creates two copies with half power and half toughness rounded up (3/2)', () => {
    expect(automated(SAW)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Halving Saw'] }, p2: { battlefield: ['Test Giant'] }, defs });
    const giant = find(s0, 'Test Giant', 'battlefield', 'p2');
    const r = save(s0, giant);
    expect(r.zones.graveyard.p2!.some((id) => chars(r, id).name === 'Test Giant')).toBe(true);
    const mine = onBf(r, 'Test Giant', 'p1');
    const theirs = onBf(r, 'Test Giant', 'p2');
    expect(mine).toHaveLength(0);
    expect(theirs).toHaveLength(2);
    for (const id of theirs) {
      expect(r.objects[id]!.kind).toBe('token');
      expect(pt(r, id)).toEqual([3, 2]);
    }
  });
  it('CR 608.2h: the numbers are the creature\'s as it last existed (a +1/+1 bonus counts): a 5/4 with a +1/+1 anthem is 6/5, so the copies\'s base is 3/3 (4/4 with the anthem)', () => {
    const s0 = scenario([], { p2: { battlefield: ['Test Giant', 'Test Banner'] }, p1: { hand: ['Test Halving Saw'] }, defs });
    const giant = find(s0, 'Test Giant', 'battlefield', 'p2');
    expect(pt(s0, giant)).toEqual([6, 5]);
    const r = save(s0, giant);
    const theirs = onBf(r, 'Test Giant', 'p2');
    expect(theirs).toHaveLength(2);
    // half of the 6/5 it had (3 and 3), set as the tokens' base; the anthem then adds +1/+1 to each token (without last known information it would be 3/2 + 1/+1 = 4/3)
    for (const id of theirs) expect(pt(r, id)).toEqual([4, 4]);
  });
  it('an indestructible creature does not die: no tokens', () => {
    const s0 = scenario([], { p1: { hand: ['Test Halving Saw'] }, p2: { battlefield: ['Test Hide'] }, defs });
    const hide = find(s0, 'Test Hide', 'battlefield', 'p2');
    const r = save(s0, hide);
    expect(onBf(r, 'Test Hide', 'p2')).toHaveLength(1);
  });
  it('CR 614.6, 700.4: a replacement that exiles the creature instead means it did not die: no tokens', () => {
    const s0 = scenario([], { p1: { hand: ['Test Halving Saw'], battlefield: ['Test Void Veil'] }, p2: { battlefield: ['Test Giant'] }, defs });
    const giant = find(s0, 'Test Giant', 'battlefield', 'p2');
    const r = save(s0, giant);
    expect(r.zones.exile.some((id) => chars(r, id).name === 'Test Giant')).toBe(true);
    expect(onBf(r, 'Test Giant', 'p2')).toHaveLength(0);
  });
  it('the caster\'s own creature: its controller is the caster, who gets the two tokens', () => {
    const s0 = scenario([], { p1: { hand: ['Test Halving Saw'], battlefield: ['Test Giant'] }, defs });
    const giant = find(s0, 'Test Giant', 'battlefield', 'p1');
    const r = save(s0, giant);
    expect(onBf(r, 'Test Giant', 'p1')).toHaveLength(2);
  });
});

describe('CR 111.4, 107.3, 608.2h: "..., then create an X/1 green Beast creature token, where X is the number of gear counters on this artifact."', () => {
  const ENGINE = card('Test Gear Engine', 'Artifact', 'At the beginning of your upkeep, put a gear counter on this artifact, then create an X/1 green Beast creature token, where X is the number of gear counters on this artifact.', { cost: '{1}' });
  const defs = [ENGINE];
  it('is automated; the token\'s power is the number of counters after the counter is put on (1, then 2), its toughness stays 1', () => {
    expect(automated(ENGINE)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Gear Engine'] }, defs });
    const up1 = resolveAll(advanceTo(s0, 3, 'upkeep'));
    const beasts = up1.zones.battlefield.filter((id) => chars(up1, id).subtypes.includes('Beast'));
    expect(beasts.map((id) => pt(up1, id))).toEqual([[1, 1]]);
    const up2 = resolveAll(advanceTo(up1, 5, 'upkeep'));
    const later = up2.zones.battlefield.filter((id) => chars(up2, id).subtypes.includes('Beast')).map((id) => pt(up2, id)).sort();
    expect(later).toEqual([[1, 1], [2, 1]]);
  });
});

describe('CR 122.1, 608.2c: "At the beginning of your end step, put a +1/+1 counter on each creature you control and a charge counter on each artifact you control."', () => {
  const SHRINE = card('Test Growth Shrine', 'Enchantment', 'At the beginning of your end step, put a +1/+1 counter on each creature you control and a charge counter on each artifact you control.', { cost: '{1}' });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const COG = card('Test Cog', 'Artifact', '', { cost: '{1}' });
  const defs = [SHRINE, BEAR, COG];
  const counters = (st: GameState, id: ObjectId, kind: string): number => st.objects[id]!.counters[kind] ?? 0;
  it('is automated; at your end step each creature you control gets a +1/+1 counter and each artifact you control a charge counter; the opponent\'s permanents get none', () => {
    expect(automated(SHRINE)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Growth Shrine', 'Test Bear', 'Test Bear', 'Test Cog'] }, p2: { battlefield: ['Test Bear', 'Test Cog'] }, defs });
    const r = resolveAll(advanceTo(s0, 1, 'end'));
    for (const id of onBf(r, 'Test Bear', 'p1')) expect(counters(r, id, '+1/+1')).toBe(1);
    expect(counters(r, onBf(r, 'Test Cog', 'p1')[0]!, 'charge')).toBe(1);
    expect(counters(r, onBf(r, 'Test Cog', 'p1')[0]!, '+1/+1')).toBe(0); // the artifact is no creature
    expect(counters(r, onBf(r, 'Test Bear', 'p1')[0]!, 'charge')).toBe(0); // the creature is no artifact
    expect(counters(r, onBf(r, 'Test Bear', 'p2')[0]!, '+1/+1')).toBe(0);
    expect(counters(r, onBf(r, 'Test Cog', 'p2')[0]!, 'charge')).toBe(0);
  });
  it('only at the beginning of YOUR end step: not on the opponent\'s turn', () => {
    const s0 = scenario([], { p2: { battlefield: ['Test Growth Shrine', 'Test Bear'] }, p1: { battlefield: ['Test Bear'] }, defs });
    const r = resolveAll(advanceTo(s0, 1, 'end'));
    expect(counters(r, onBf(r, 'Test Bear', 'p2')[0]!, '+1/+1')).toBe(0);
    expect(counters(r, onBf(r, 'Test Bear', 'p1')[0]!, '+1/+1')).toBe(0);
  });
});

describe('CR 613.4b, 509.1b: "Equipped creature has base power and toughness 6/6 and can\'t be blocked by creatures with power 2 or less."', () => {
  const ARM = card('Test Heavy Arm', 'Artifact — Equipment', 'Equipped creature has base power and toughness 6/6 and can\'t be blocked by creatures with power 2 or less.\nEquip {1}');
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const BRUTE = card('Test Brute', 'Creature — Ogre', '', { pt: ['3', '3'] });
  const defs = [ARM, BEAR, BRUTE];
  const attach = (st: GameState, to: ObjectId): void => { st.objects[find(st, 'Test Heavy Arm', 'battlefield', 'p1')]!.attachedTo = to; };
  it('is automated; the equipped 2/2 is a 6/6, the unequipped one stays 2/2', () => {
    expect(automated(ARM)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Heavy Arm', 'Test Bear', 'Test Bear'] }, defs });
    const [a, b] = onBf(s0, 'Test Bear', 'p1') as [ObjectId, ObjectId];
    attach(s0, a);
    expect(pt(s0, a)).toEqual([6, 6]);
    expect(pt(s0, b)).toEqual([2, 2]);
  });
  /** Attack with the equipped Bear into a lone `blocker`; was the defending player asked to declare blockers (a blocker that can't block leaves nothing to declare)? */
  const askedToBlock = (blocker: string): { asked: boolean; s: GameState; bear: ObjectId } => {
    const s0 = scenario([], { p1: { battlefield: ['Test Heavy Arm', 'Test Bear'] }, p2: { battlefield: [blocker] }, defs });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    attach(s0, bear);
    const s1 = passUntil(declareAttackers(toDeclareAttackers(advanceTo(s0, 3, 'main1')), [[bear]]), (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'combatDamage', 'blockers or damage', 10);
    return { asked: s1.pending?.kind === 'declareBlockers', s: s1, bear };
  };
  it('a creature with power 2 or less can\'t block it (no block can be declared); a 3-power creature can', () => {
    expect(askedToBlock('Test Bear').asked).toBe(false);
    const ok = askedToBlock('Test Brute');
    expect(ok.asked).toBe(true);
    const blocked = declareBlockers(ok.s, [[find(ok.s, 'Test Brute', 'battlefield', 'p2'), ok.bear]]);
    expect(blocked.combat).toBeDefined();
  });
});

describe('CR 205.3m, 613.4c: "Other Ninja and Rogue creatures you control get +1/+1."', () => {
  const LORD = card('Test Shade Lord', 'Creature — Ninja Rogue', 'Other Ninja and Rogue creatures you control get +1/+1.', { pt: ['2', '2'] });
  const NINJA = card('Test Ninja', 'Creature — Ninja', '', { pt: ['1', '1'] });
  const ROGUE = card('Test Rogue', 'Creature — Rogue', '', { pt: ['1', '1'] });
  const ELF = card('Test Elf', 'Creature — Elf', '', { pt: ['1', '1'] });
  const defs = [LORD, NINJA, ROGUE, ELF];
  it('is automated; a Ninja and a Rogue you control get +1/+1, an Elf, the Lord itself and an opponent\'s Ninja do not', () => {
    expect(automated(LORD)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Shade Lord', 'Test Ninja', 'Test Rogue', 'Test Elf'] }, p2: { battlefield: ['Test Ninja'] }, defs });
    expect(pt(s0, onBf(s0, 'Test Ninja', 'p1')[0]!)).toEqual([2, 2]);
    expect(pt(s0, onBf(s0, 'Test Rogue', 'p1')[0]!)).toEqual([2, 2]);
    expect(pt(s0, onBf(s0, 'Test Elf', 'p1')[0]!)).toEqual([1, 1]);
    expect(pt(s0, onBf(s0, 'Test Shade Lord', 'p1')[0]!)).toEqual([2, 2]);
    expect(pt(s0, onBf(s0, 'Test Ninja', 'p2')[0]!)).toEqual([1, 1]);
  });
});
