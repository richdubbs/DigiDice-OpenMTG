/**
 * Commander lane edh-perms, round edh-perms-9: the round's readings played through the engine with synthetic cards (invented names), compiled by the game's default compiler.
 * CR cites from memory, unverified (rules/cr/ is not in the cloud checkout), except where a ruling is named.
 *
 *   CR 608.2, 603.4   "if it wasn't put onto the battlefield with this ability": a permanent a Kodama-like ability put onto the battlefield does not trigger that ability again
 *   CR 202.3, 603.6a  "with equal or lesser mana value" in an enters trigger: at most the mana value of the permanent that entered
 *   CR 701.26b        "untap it and all Dwarves you control" (the attacker and a group, not another player's)
 *   CR 205.1a, 105.3  "Equipped creature gets +2/+2, has trample, and is a green Beast" (creature types and color SET); "Enchanted permanent is a Vehicle artifact with crew N and it loses all other card types"
 *   CR 613.4c, 122.1  "+1/+1 for each creature you control and +1/+1 for each Aura you control"; "for each +1/+1 counter on this Aura"
 *   CR 702.11b, 702.12b, 702.18b, 702.16b, 702.21a, 611.2c   "lose hexproof, indestructible, protection, shroud, and ward until end of turn"
 *   CR 120.10, 608.2c  "if excess damage was dealt to a permanent this way, create that many tapped Treasure tokens"
 *   CR 500.1, 509.1b   "During your turn, equipped creature has hexproof and can't be blocked"
 *   CR 502.3, 604.1    "As long as there are four or more quest counters on this enchantment, untap all creatures you control during each other player's untap step"
 *   CR 205.2a, 111.1   "Destroy all other permanents except for lands and tokens"
 *   CR 611.2c, 613.1  "Until end of turn, each creature target player controls loses all abilities and becomes a blue Frog with base power and toughness 1/1"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, legal, pass, put, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: string[]; keywords?: string[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: opts.keywords ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const chars = (s: GameState, id: ObjectId) => getChars(s, id);
const onField = (s: GameState, name: string): ObjectId[] => s.zones.battlefield.filter((id) => chars(s, id).name === name);
const inHand = (s: GameState, name: string): ObjectId[] => s.zones.hand.p1!.filter((id) => chars(s, id).name === name);

/** Answer every decision: yes/no by `yes`, objects by `pick`, targets in order from `targets`, mana automatically. */
function drive(s0: GameState, o: { yes?: boolean; pick?: (options: ObjectId[], s: GameState) => ObjectId[]; targets?: string[][]; seen?: ObjectId[][] } = {}): GameState {
  let s = s0;
  const tq = [...(o.targets ?? [])];
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'chooseObjects') { o.seen?.push([...p.options]); s = answer(s, { kind: 'chooseObjects', ids: o.pick ? o.pick(p.options, s) : p.options.slice(0, Math.max(p.min, 1)).slice(0, p.max) }); }
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: (tq.shift() ?? []).map((id) => (/^p\d$/.test(id) ? { kind: 'player' as const, id } : { kind: 'object' as const, id })) });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Parameters<typeof drive>[1] = {}): GameState {
  let s = drive(s0, o);
  for (let guard = 0; guard < 40 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, o);
  return s;
}
const cast = (s0: GameState, name: string, o: Parameters<typeof drive>[1] = {}): GameState => resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), o);

const KODAMA = card('Test Kodama', 'Creature — Spirit', 'Whenever another permanent you control enters, if it wasn\'t put onto the battlefield with this ability, you may put a permanent card with equal or lesser mana value from your hand onto the battlefield.', { pt: ['6', '6'] });
const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'], cost: '{2}' });
const CUB = card('Test Cub', 'Creature — Bear', '', { pt: ['1', '1'], cost: '{1}' });
const MITE = card('Test Mite', 'Creature — Insect', '', { pt: ['1', '1'], cost: '{0}' });
const GIANT = card('Test Giant', 'Creature — Giant', '', { pt: ['5', '5'], cost: '{5}' });
const SUMMON = card('Test Summon', 'Sorcery', 'You may put a creature card from your hand onto the battlefield.');
const defs = [KODAMA, BEAR, CUB, MITE, GIANT, SUMMON];
const withMana = (s: GameState, n: number): GameState => { for (let i = 0; i < n; i++) s.players[0]!.manaPool.push({ type: 'C' } as never); return s; };

describe('CR 608.2, 603.4, 202.3: "Whenever another permanent you control enters, if it wasn\'t put onto the battlefield with this ability, you may put a permanent card with equal or lesser mana value from your hand onto the battlefield."', () => {
  it('is fully automated', () => expect(full(KODAMA)).toBe(true));
  it('a cast Bear (mana value 2) lets you put the Cub (1) and the Mite (0) are not offered a second time, the Giant (5) is never offered', () => {
    const seen: ObjectId[][] = [];
    const s0 = withMana(scenario([], { defs, p1: { hand: ['Test Bear', 'Test Cub', 'Test Mite', 'Test Giant'], battlefield: ['Test Kodama'] } }), 2);
    const s = cast(s0, 'Test Bear', { pick: (opts, st) => opts.filter((id) => chars(st, id).name === 'Test Cub'), seen });
    expect(onField(s, 'Test Bear').length).toBe(1);
    expect(onField(s, 'Test Cub').length).toBe(1);
    expect(seen.length).toBe(1); // asked once: the Cub the ability put onto the battlefield does not trigger it again (it was put there with this ability)
    const names = seen[0]!.map((id) => chars(s0, id).name).sort();
    expect(names).toEqual(['Test Cub', 'Test Mite']); // the Bear itself is on the stack, the Giant has mana value 5 > 2
    expect(inHand(s, 'Test Mite').length).toBe(1);
    expect(inHand(s, 'Test Giant').length).toBe(1);
  });
  it('the negative case: a permanent put onto the battlefield by another spell (not this ability) triggers it', () => {
    const seen: ObjectId[][] = [];
    const s0 = scenario([], { defs, p1: { hand: ['Test Summon', 'Test Bear', 'Test Cub'], battlefield: ['Test Kodama'] } });
    const s = cast(s0, 'Test Summon', { pick: (opts, st) => { const bear = opts.filter((id) => chars(st, id).name === 'Test Bear'); return bear.length > 0 ? bear : opts.filter((id) => chars(st, id).name === 'Test Cub'); }, seen });
    expect(seen.length).toBe(2); // the Summon's own choice, then Kodama's trigger for the Bear it put onto the battlefield
    expect(onField(s, 'Test Bear').length).toBe(1);
    expect(onField(s, 'Test Cub').length).toBe(1);
  });
  it('declining the "may" puts nothing', () => {
    const s0 = withMana(scenario([], { defs, p1: { hand: ['Test Bear', 'Test Cub'], battlefield: ['Test Kodama'] } }), 2);
    const s = cast(s0, 'Test Bear', { yes: false, pick: () => [] });
    expect(onField(s, 'Test Cub').length).toBe(0);
    expect(inHand(s, 'Test Cub').length).toBe(1);
  });
});

// ---- the rest of the round: played with synthetic cards -----------------------------------------------------------------------------------------------------------------------------
const kw = (s: GameState, id: ObjectId): string[] => chars(s, id).keywords.map((k) => k.keyword).sort();
const stats = (s: GameState, id: ObjectId): string => `${chars(s, id).power}/${chars(s, id).toughness}`;
const tapped = (s: GameState, id: ObjectId): boolean => s.objects[id]!.tapped;
const attach = (s: GameState, what: ObjectId, to: ObjectId): void => { s.objects[what]!.attachedTo = to; };
/** An Aura put onto the battlefield attached to `host` (the scenario's own setup would turn an unattached Aura into a state-based action, CR 704.5m). */
const aura = (s: GameState, owner: 'p1' | 'p2', name: string, host: ObjectId, counters: Record<string, number> = {}): ObjectId => { const id = put(s, owner, 'battlefield', { name, counters }); attach(s, id, host); return id; };
/** Activate the first ability of an object that can be activated, paying automatically, and resolve it. */
function activate(s0: GameState, id: ObjectId, o: Parameters<typeof drive>[1] = {}): GameState {
  const a = legal(s0, 'p1', 'activate').find((x) => x.object === id);
  if (a === undefined) throw new Error('nothing to activate');
  return resolveAll(act(s0, a.action), o);
}

const DWARF = card('Test Dwarf', 'Creature — Dwarf', '', { pt: ['1', '1'] });
const ELF = card('Test Elf', 'Creature — Elf', '', { pt: ['1', '1'] });
const UNTAPPER = card('Test Untapper', 'Instant', 'Untap target creature and all Dwarves you control.');
const MARCHER = card('Test Marcher', 'Creature — Human', 'Whenever this creature attacks, untap it and all Dwarves you control.', { pt: ['2', '2'] });
const NIM = card('Test Mantle', 'Artifact — Equipment', 'Equipped creature gets +2/+2, has trample, and is a green Beast.');
const BEAR2 = card('Test Cub Bear', 'Creature — Bear Warrior', '', { pt: ['2', '2'], colors: ['U'] });
const SWIFT = card('Test Swift Aura', 'Enchantment — Aura', 'Enchant creature or Vehicle\nEnchanted permanent is a Vehicle artifact with crew 4 and it loses all other card types.');
const EIDOLON = card('Test Eidolon', 'Enchantment Creature — Spirit', 'This creature and enchanted creature each get +1/+1 for each creature you control and +1/+1 for each Aura you control.', { pt: ['2', '2'] });
const PACIFIER = card('Test Pacifier', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature can\'t attack.');
const HYDRA = card('Test Hydra Aura', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+1 for each +1/+1 counter on this Aura and has reach and trample.');
const SHAY = card('Test Shay', 'Creature — Human Rogue', '{1}: Permanents your opponents control lose hexproof, indestructible, protection, shroud, and ward until end of turn.', { pt: ['2', '2'] });
const FORTRESS = card('Test Fortress', 'Creature — Wall', 'Hexproof\nIndestructible\nShroud\nProtection from red\nWard {2}', { pt: ['0', '4'], keywords: ['Hexproof', 'Indestructible', 'Shroud', 'Protection', 'Ward'] });
const BLAST = card('Test Blast', 'Instant', 'Test Blast deals 5 damage to any target. If excess damage was dealt to a permanent this way, create that many tapped Treasure tokens.');
const VECTOR = card('Test Vector', 'Artifact Creature — Construct', 'When this creature enters, put a +1/+1 counter on each of any number of target creatures and a charge counter on each of any number of target artifacts.', { pt: ['1', '1'] });
const RING = card('Test Ring', 'Artifact — Equipment', 'During your turn, equipped creature has hexproof and can\'t be blocked.');
const QUEST = card('Test Quest', 'Enchantment', 'As long as there are four or more quest counters on this enchantment, untap all creatures you control during each other player\'s untap step.');
const WALKER = card('Test Cleanser', 'Artifact', '{T}: Destroy all other permanents except for lands and tokens.');
const SOLDIERS = card('Test Soldiers', 'Sorcery', 'Create a 1/1 white Soldier creature token.');
const OGRE2 = card('Test Big Ogre', 'Creature — Ogre', 'Flying', { pt: ['5', '5'], keywords: ['Flying'] });
const JEST = card('Test Jest', 'Sorcery', 'Until end of turn, each creature target player controls loses all abilities and becomes a blue Frog with base power and toughness 1/1.');
const more = [DWARF, ELF, UNTAPPER, MARCHER, NIM, BEAR2, SWIFT, EIDOLON, PACIFIER, HYDRA, SHAY, FORTRESS, BLAST, VECTOR, RING, QUEST, WALKER, SOLDIERS, OGRE2, JEST];
const defs2 = [...defs, ...more];

describe('CR 701.26b: "untap it and all Dwarves you control"', () => {
  it('is fully automated', () => { expect(full(UNTAPPER)).toBe(true); expect(full(MARCHER)).toBe(true); });
  it('untaps the target and every Dwarf you control, not another player\'s Dwarf or a tapped Elf', () => {
    const s0 = scenario([], { defs: defs2, p1: { hand: ['Test Untapper'], battlefield: [{ name: 'Test Elf', tapped: true }, { name: 'Test Dwarf', tapped: true }, { name: 'Test Dwarf', tapped: true }, { name: 'Test Bear', tapped: true }] }, p2: { battlefield: [{ name: 'Test Dwarf', tapped: true }] } });
    const elf = find(s0, 'Test Elf', 'battlefield');
    const s = cast(s0, 'Test Untapper', { targets: [[elf]] });
    expect(tapped(s, elf)).toBe(false);
    expect(s.zones.battlefield.filter((id) => chars(s, id).name === 'Test Dwarf' && s.objects[id]!.controller === 'p1').map((id) => tapped(s, id))).toEqual([false, false]);
    expect(tapped(s, find(s, 'Test Bear', 'battlefield'))).toBe(true);
    expect(tapped(s, onField(s, 'Test Dwarf').find((id) => s.objects[id]!.controller === 'p2')!)).toBe(true);
  });
  it('an attacker with the trigger untaps itself (vigilance-like) and your Dwarves as it attacks', () => {
    let s = scenario([], { defs: defs2, p1: { battlefield: ['Test Marcher', { name: 'Test Dwarf', tapped: true }] } });
    let guard = 0;
    while (s.pending?.kind !== 'declareAttackers') { if (++guard > 20) throw new Error('no declare attackers'); s = pass(s); }
    const marcher = find(s, 'Test Marcher', 'battlefield');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: marcher, defender: 'p2' }] });
    s = resolveAll(s);
    expect(tapped(s, find(s, 'Test Dwarf', 'battlefield'))).toBe(false);
    expect(tapped(s, marcher)).toBe(false); // tapped as it attacked, untapped by its own trigger
  });
});

describe('CR 205.1a, 105.3: "Equipped creature gets +2/+2, has trample, and is a green Beast."', () => {
  it('is fully automated', () => expect(full(NIM)).toBe(true));
  it('the equipped creature is a 4/4 green Beast with trample: its creature types and color are SET, its card type stays', () => {
    const s = scenario([], { defs: defs2, p1: { battlefield: ['Test Mantle', 'Test Cub Bear'] } });
    const bear = find(s, 'Test Cub Bear', 'battlefield');
    expect(chars(s, bear).subtypes).toEqual(['Bear', 'Warrior']);
    attach(s, find(s, 'Test Mantle', 'battlefield'), bear);
    const c = chars(s, bear);
    expect(c.subtypes).toEqual(['Beast']);
    expect(c.colors).toEqual(['G']);
    expect(c.types).toEqual(['Creature']);
    expect(stats(s, bear)).toBe('4/4');
    expect(kw(s, bear)).toContain('trample');
  });
  it('the negative case: an unequipped creature is not changed, and the Equipment is no creature', () => {
    const s = scenario([], { defs: defs2, p1: { battlefield: ['Test Mantle', 'Test Cub Bear', 'Test Elf'] } });
    attach(s, find(s, 'Test Mantle', 'battlefield'), find(s, 'Test Cub Bear', 'battlefield'));
    const elf = find(s, 'Test Elf', 'battlefield');
    expect([chars(s, elf).subtypes, chars(s, elf).colors, stats(s, elf)]).toEqual([['Elf'], [], '1/1']);
    expect(chars(s, find(s, 'Test Mantle', 'battlefield')).subtypes).toEqual(['Equipment']);
  });
});

describe('CR 205.1a, 613.1d, 702.122a: "Enchanted permanent is a Vehicle artifact with crew 4 and it loses all other card types."', () => {
  it('is fully automated', () => expect(full(SWIFT)).toBe(true));
  it('the enchanted creature is a Vehicle artifact with crew 4 and no longer a creature (or a Bear); the Aura stays on the battlefield', () => {
    const s0 = scenario([], { defs: defs2, p1: { battlefield: ['Test Cub Bear', 'Test Elf'] } });
    const bear = find(s0, 'Test Cub Bear', 'battlefield');
    aura(s0, 'p1', 'Test Swift Aura', bear);
    const c = chars(s0, bear);
    expect([c.types, c.subtypes]).toEqual([['Artifact'], ['Vehicle']]);
    expect(c.keywords.some((k) => k.keyword === 'crew' && k.amount === 4)).toBe(true);
    const s = advanceTo(s0, 1, 'beginCombat');
    expect(onField(s, 'Test Swift Aura').length).toBe(1); // a Vehicle is still a legal object for "Enchant creature or Vehicle" (CR 704.5m)
    expect(chars(s, find(s, 'Test Elf', 'battlefield')).types).toEqual(['Creature']); // the negative case: another creature is untouched
  });
});

describe('CR 613.4c: "This creature and enchanted creature each get +1/+1 for each creature you control and +1/+1 for each Aura you control."', () => {
  it('is fully automated', () => expect(full(EIDOLON)).toBe(true));
  it('counts creatures and Auras you control, each once, and not an opponent\'s Aura', () => {
    const s = scenario([], { defs: defs2, p1: { battlefield: ['Test Eidolon', 'Test Cub Bear'] }, p2: { battlefield: ['Test Elf'] } });
    const eid = find(s, 'Test Eidolon', 'battlefield');
    expect(stats(s, eid)).toBe('4/4'); // two creatures, no Aura yet: 2/2 +2/+2
    aura(s, 'p2', 'Test Pacifier', find(s, 'Test Elf', 'battlefield'));
    expect(stats(s, eid)).toBe('4/4'); // the opponent's Aura is not counted
    aura(s, 'p1', 'Test Pacifier', find(s, 'Test Cub Bear', 'battlefield'));
    expect(stats(s, eid)).toBe('5/5'); // + one Aura you control
    expect(stats(s, find(s, 'Test Cub Bear', 'battlefield'))).toBe('2/2'); // not enchanted by the Eidolon: unchanged
  });
  it('attached as an Aura it also pumps the enchanted creature (the same amount)', () => {
    const s = scenario([], { defs: defs2, p1: { battlefield: ['Test Eidolon', 'Test Cub Bear'] } });
    const bear = find(s, 'Test Cub Bear', 'battlefield');
    attach(s, find(s, 'Test Eidolon', 'battlefield'), bear);
    expect(stats(s, bear)).toBe('4/4'); // two creatures: +2/+2
  });
});

describe('CR 613.4c, 122.1: "Enchanted creature gets +1/+1 for each +1/+1 counter on this Aura and has reach and trample."', () => {
  it('is fully automated', () => expect(full(HYDRA)).toBe(true));
  it('three +1/+1 counters on the Aura: +3/+3, reach and trample; other counters do not count', () => {
    const s = scenario([], { defs: defs2, p1: { battlefield: ['Test Cub Bear'] } });
    const bear = find(s, 'Test Cub Bear', 'battlefield');
    aura(s, 'p1', 'Test Hydra Aura', bear, { '+1/+1': 3, charge: 5 });
    expect(stats(s, bear)).toBe('5/5');
    expect(kw(s, bear)).toEqual(expect.arrayContaining(['reach', 'trample']));
  });
});

describe('CR 702.11b, 702.12b, 702.18b, 702.16b, 702.21a: "Permanents your opponents control lose hexproof, indestructible, protection, shroud, and ward until end of turn."', () => {
  it('is fully automated', () => expect(full(SHAY)).toBe(true));
  it('the opponent\'s Fortress loses all five; your own copy keeps them', () => {
    const s0 = scenario([], { defs: defs2, p1: { battlefield: ['Test Shay', 'Test Fortress'] }, p2: { battlefield: ['Test Fortress'] } });
    s0.players[0]!.manaPool.push({ type: 'C' } as never);
    const mine = onField(s0, 'Test Fortress').find((id) => s0.objects[id]!.controller === 'p1')!;
    const theirs = onField(s0, 'Test Fortress').find((id) => s0.objects[id]!.controller === 'p2')!;
    expect(kw(s0, theirs)).toEqual(expect.arrayContaining(['hexproof', 'indestructible', 'shroud', 'protection', 'ward']));
    const s = activate(s0, find(s0, 'Test Shay', 'battlefield'));
    for (const k of ['hexproof', 'indestructible', 'shroud', 'protection', 'ward']) expect(kw(s, theirs), k).not.toContain(k);
    expect(kw(s, mine)).toEqual(expect.arrayContaining(['hexproof', 'indestructible', 'shroud', 'protection', 'ward']));
  });
});

describe('CR 120.10, 608.2c: "Test Blast deals 5 damage to any target. If excess damage was dealt to a permanent this way, create that many tapped Treasure tokens."', () => {
  it('is fully automated', () => expect(full(BLAST)).toBe(true));
  const treasures = (s: GameState): ObjectId[] => s.zones.battlefield.filter((id) => chars(s, id).name === 'Treasure Token' && s.objects[id]!.controller === 'p1');
  it('5 damage to a 2/2: 3 excess, so three tapped Treasures', () => {
    const s0 = scenario([], { defs: defs2, p1: { hand: ['Test Blast'] }, p2: { battlefield: ['Test Cub Bear'] } });
    const s = cast(s0, 'Test Blast', { targets: [[find(s0, 'Test Cub Bear', 'battlefield')]] });
    expect(onField(s, 'Test Cub Bear').length).toBe(0);
    expect(treasures(s).length).toBe(3);
    expect(treasures(s).every((id) => tapped(s, id))).toBe(true);
  });
  it('the negative cases: exactly lethal damage (5 to a 5/5), a bigger creature and a player have no excess: no Treasure', () => {
    const lethal = scenario([], { defs: defs2, p1: { hand: ['Test Blast'] }, p2: { battlefield: ['Test Big Ogre'] } });
    expect(treasures(cast(lethal, 'Test Blast', { targets: [[find(lethal, 'Test Big Ogre', 'battlefield')]] })).length).toBe(0);
    const t = cast(scenario([], { defs: defs2, p1: { hand: ['Test Blast'] } }), 'Test Blast', { targets: [['p2']] });
    expect(treasures(t).length).toBe(0);
    expect(t.players.find((p) => p.id === 'p2')!.life).toBe(15);
  });
});

describe('CR 115.1, 122.1: "put a +1/+1 counter on each of any number of target creatures and a charge counter on each of any number of target artifacts"', () => {
  it('is fully automated', () => expect(full(VECTOR)).toBe(true));
  it('any number of each: two creatures and an artifact get their counters, an untargeted creature does not', () => {
    const s0 = scenario([], { defs: defs2, p1: { hand: ['Test Vector'], battlefield: ['Test Cub Bear', 'Test Elf', 'Test Mantle'] }, p2: { battlefield: ['Test Dwarf'] } });
    const bear = find(s0, 'Test Cub Bear', 'battlefield');
    const elf = find(s0, 'Test Elf', 'battlefield');
    const mantle = find(s0, 'Test Mantle', 'battlefield');
    const s = cast(s0, 'Test Vector', { targets: [[bear, elf], [mantle]] });
    expect(s.objects[bear]!.counters['+1/+1']).toBe(1);
    expect(s.objects[elf]!.counters['+1/+1']).toBe(1);
    expect(s.objects[mantle]!.counters['charge']).toBe(1);
    expect(s.objects[find(s, 'Test Dwarf', 'battlefield')]!.counters['+1/+1'] ?? 0).toBe(0);
  });
  it('the negative case: zero targets (any number includes none) is legal and puts nothing anywhere', () => {
    const s0 = scenario([], { defs: defs2, p1: { hand: ['Test Vector'], battlefield: ['Test Cub Bear'] } });
    const s = cast(s0, 'Test Vector', { targets: [[], []] });
    expect(s.objects[find(s, 'Test Cub Bear', 'battlefield')]!.counters['+1/+1'] ?? 0).toBe(0);
    expect(onField(s, 'Test Vector').length).toBe(1);
  });
});

describe('CR 500.1, 509.1b, 702.11b: "During your turn, equipped creature has hexproof and can\'t be blocked."', () => {
  it('is fully automated', () => expect(full(RING)).toBe(true));
  it('hexproof only during your turn', () => {
    const s = scenario([], { defs: defs2, p1: { battlefield: ['Test Ring', 'Test Cub Bear'] } });
    const bear = find(s, 'Test Cub Bear', 'battlefield');
    attach(s, find(s, 'Test Ring', 'battlefield'), bear);
    expect(kw(s, bear)).toContain('hexproof');
    s.turn.activePlayer = 'p2';
    expect(kw(s, bear)).not.toContain('hexproof');
  });
  it('an equipped attacker cannot be blocked on your turn; the same attacker unequipped can be', () => {
    const attackWith = (equipped: boolean): GameState => {
      let s = scenario([], { defs: defs2, p1: { battlefield: ['Test Ring', 'Test Cub Bear'] }, p2: { battlefield: ['Test Elf'] } });
      const bear = find(s, 'Test Cub Bear', 'battlefield');
      if (equipped) attach(s, find(s, 'Test Ring', 'battlefield'), bear);
      let guard = 0;
      while (s.pending?.kind !== 'declareAttackers') { if (++guard > 20) throw new Error('no declare attackers'); s = pass(s); }
      s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: bear, defender: 'p2' }] });
      for (let g = 0; g < 10 && s.pending?.kind === 'priority' && s.turn.step === 'declareAttackers'; g++) s = pass(s);
      return s;
    };
    expect(attackWith(false).pending?.kind).toBe('declareBlockers');
    expect(attackWith(true).pending?.kind).not.toBe('declareBlockers');
  });
});

describe('CR 502.3, 604.1: "As long as there are four or more quest counters on this enchantment, untap all creatures you control during each other player\'s untap step."', () => {
  it('is fully automated', () => expect(full(QUEST)).toBe(true));
  const afterOpponentsUntap = (counters: number): GameState => {
    const s0 = scenario([], { defs: defs2, p1: { battlefield: [{ name: 'Test Quest', counters: { quest: counters } }, { name: 'Test Cub Bear', tapped: true }] } });
    return advanceTo(s0, 2, 'upkeep');
  };
  it('with four counters your tapped creature untaps in the other player\'s untap step', () => {
    const s = afterOpponentsUntap(4);
    expect(tapped(s, find(s, 'Test Cub Bear', 'battlefield'))).toBe(false);
  });
  it('the negative case: with three counters it stays tapped', () => {
    const s = afterOpponentsUntap(3);
    expect(tapped(s, find(s, 'Test Cub Bear', 'battlefield'))).toBe(true);
  });
});

describe('CR 205.2a, 111.1: "Destroy all other permanents except for lands and tokens."', () => {
  it('is fully automated', () => expect(full(WALKER)).toBe(true));
  it('destroys the nonland nontoken permanents of every player but the source; lands, tokens and the source stay', () => {
    const s0 = scenario([], { defs: defs2, p1: { hand: ['Test Soldiers'], battlefield: ['Test Cleanser', 'Test Cub Bear', 'Plains'] }, p2: { battlefield: ['Test Big Ogre', 'Test Mantle', 'Plains'] } });
    const s1 = cast(s0, 'Test Soldiers');
    expect(s1.zones.battlefield.filter((id) => s1.objects[id]!.kind === 'token').length).toBe(1);
    const s = activate(s1, find(s1, 'Test Cleanser', 'battlefield'));
    expect(onField(s, 'Test Cleanser').length).toBe(1);
    expect(onField(s, 'Test Cub Bear').length + onField(s, 'Test Big Ogre').length + onField(s, 'Test Mantle').length).toBe(0);
    expect(onField(s, 'Plains').length).toBe(2);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token').length).toBe(1);
  });
});

describe('CR 611.2c, 613.1, 205.1a: "Until end of turn, each creature target player controls loses all abilities and becomes a blue Frog with base power and toughness 1/1."', () => {
  it('is fully automated', () => expect(full(JEST)).toBe(true));
  it('the target player\'s creatures are 1/1 blue Frogs without abilities; your own creature is untouched', () => {
    const s0 = scenario([], { defs: defs2, p1: { hand: ['Test Jest'], battlefield: ['Test Big Ogre'] }, p2: { battlefield: ['Test Big Ogre', 'Test Cub Bear'] } });
    const s = cast(s0, 'Test Jest', { targets: [['p2']] });
    const theirs = onField(s, 'Test Big Ogre').find((id) => s.objects[id]!.controller === 'p2')!;
    const mine = onField(s, 'Test Big Ogre').find((id) => s.objects[id]!.controller === 'p1')!;
    expect([stats(s, theirs), chars(s, theirs).colors, chars(s, theirs).subtypes, kw(s, theirs)]).toEqual(['1/1', ['U'], ['Frog'], []]);
    expect([stats(s, mine), chars(s, mine).subtypes, kw(s, mine)]).toEqual(['5/5', ['Ogre'], ['flying']]);
    expect(stats(s, onField(s, 'Test Cub Bear')[0]!)).toBe('1/1');
  });
});
