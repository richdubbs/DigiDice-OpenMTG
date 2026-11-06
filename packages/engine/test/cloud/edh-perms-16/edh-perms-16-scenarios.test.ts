/**
 * Commander lane edh-perms, round edh-perms-16: the round's readings played through the engine with synthetic cards (invented names), compiled by the game's default
 * compiler. Alice (p1) is the active player. CR cites checked against the Comprehensive Rules of 2026-09-25 (see the round's record).
 *
 *   CR 303.4, 701.3a-b  "You may attach any number of Auras and Equipment you control to target permanent or player." (an Aura that enchants players attaches to a player)
 *   CR 701.3a-b, 608.2d "For each Aura and Equipment you control, you may attach it to a creature you control." (one choice per permanent)
 *   CR 701.37a, 107.3   "When ~ becomes monstrous, create X ... tokens": X is the N of the monstrosity
 *   CR 303.4a, 704.5m   "Enchant creature with another Aura attached to it"
 *   CR 122.1, 608.2d    "Put your choice of a +1/+1 counter or two charge counters on target artifact."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, pass, scenario } from '../../m3/scenario';
import { mpScenario } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const player = (id: string): TargetChoice => ({ kind: 'player', id } as TargetChoice);
const yes: DecisionAnswer = { kind: 'yesNo', yes: true };
const no: DecisionAnswer = { kind: 'yesNo', yes: false };

interface Opts { targets?: TargetChoice[][]; picks?: ObjectId[][]; answers?: DecisionAnswer[]; options?: string[]; x?: number; order?: string[] }
/** Answer what comes up: targets, object choices, option labels, then the answers; pay costs automatically; stop at priority. */
function settle(s0: GameState, o: Opts): { s: GameState; asked: string[] } {
  let s = s0;
  const asked: string[] = [];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    asked.push(s.pending.kind);
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets' && o.targets && o.targets.length > 0) s = answer(s, { kind: 'chooseTargets', targets: o.targets.shift()! });
    else if (p.kind === 'chooseObjects' && o.picks && o.picks.length > 0) s = answer(s, { kind: 'chooseObjects', ids: o.picks.shift()! });
    else if (p.kind === 'chooseOption' && o.options && o.options.length > 0) {
      const label = o.options.shift()!;
      const opt = p.options.find((x) => x.label === label);
      if (!opt) throw new Error(`no option ${label} among ${p.options.map((x) => x.label).join(', ')}`);
      s = answer(s, { kind: 'chooseOption', ids: [opt.id] });
    } else if (p.kind === 'chooseNumber' && o.x !== undefined) s = answer(s, { kind: 'chooseNumber', n: o.x });
    else if (p.kind === 'order') {
      const items = (p as unknown as { items: { id: string; label: string }[] }).items;
      const first = (o.order ?? []).map((n) => items.find((i) => i.label === n)?.id).filter((i): i is string => i !== undefined);
      s = answer(s, { kind: 'order', ids: [...first, ...items.map((i) => i.id).filter((i) => !first.includes(i))] });
    } else if (o.answers && o.answers.length > 0) s = answer(s, o.answers.shift()!);
    else break;
  }
  return { s, asked };
}
const queued = (o: Opts): Opts => ({ ...o, targets: [...(o.targets ?? [])], picks: [...(o.picks ?? [])], answers: [...(o.answers ?? [])], options: [...(o.options ?? [])] });
function drain(s0: GameState, o: Opts, asked: string[]): GameState {
  let s = s0;
  for (let guard = 0; s.pending?.kind === 'priority' && s.zones.stack.length > 0 && guard < 40; guard++) {
    const r = settle(pass(s), o);
    asked.push(...r.asked);
    s = r.s;
  }
  return s;
}
/** Cast a spell p1 holds; returns the state and the kinds of decisions that were asked. */
function cast(s0: GameState, name: string, opts: Opts = {}): { s: GameState; asked: string[] } {
  const q = queued(opts);
  const first = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1'), ...(opts.x !== undefined ? { x: opts.x } : {}) } as never), q);
  const asked = [...first.asked];
  return { s: drain(first.s, q, asked), asked };
}
function activate(s0: GameState, source: ObjectId, opts: Opts = {}, ability = 'p:0:0'): { s: GameState; asked: string[] } {
  const q = queued(opts);
  const first = settle(act(s0, { type: 'activate', player: 'p1', source, ability, ...(opts.x !== undefined ? { x: opts.x } : {}) } as never), q);
  const asked = [...first.asked];
  return { s: drain(first.s, q, asked), asked };
}
/** A 3-player game with the Auras attached before the first state-based check (an unattached Aura goes to the graveyard, CR 704.5m): `attach` maps an Aura's name to the id-finder of its host. */
type Z = Partial<Record<'hand' | 'battlefield', string[]>>;
function game(zones: { p1?: Z; p2?: Z }, defs: CardDef[], attach: Record<string, string | ((s: GameState) => string)> = {}): GameState {
  return mpScenario({ players: 3, defs, zones, setup: (s) => {
    for (const [aura, host] of Object.entries(attach)) {
      const a = Object.values(s.objects).find((o) => s.defs[o.defId]?.name === aura && o.zone === 'battlefield')!;
      a.attachedTo = typeof host === 'function' ? host(s) : host;
    }
  } });
}
const byName = (s: GameState, name: string, owner?: string): ObjectId => Object.values(s.objects).find((o) => s.defs[o.defId]?.name === name && o.zone === 'battlefield' && (owner === undefined || o.owner === owner))!.id;
const counters = (s: GameState, id: ObjectId, kind = '+1/+1'): number => s.objects[id]?.counters[kind] ?? 0;
const attachedTo = (s: GameState, id: ObjectId): string | null => (s.objects[id]?.attachedTo as string | undefined) ?? null;

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['4', '5']);
const SWORD = card('Test Sword', 'Artifact — Equipment', 'Equipped creature gets +1/+1.\nEquip {2}');
const AXE = card('Test Axe', 'Artifact — Equipment', 'Equipped creature gets +2/+0.\nEquip {2}');
const BLESSING = card('Test Blessing', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+1.');
const CURSE = card('Test Curse', 'Enchantment — Aura Curse', 'Enchant player\nAt the beginning of enchanted player\'s upkeep, that player loses 1 life.');
const RIG = card('Test Rig', 'Artifact', '{T}: You may attach any number of Auras and Equipment you control to target permanent or player.');
const FIELD = card('Test Field', 'Land', '');

describe('CR 303.4, 701.3a-b: "You may attach any number of Auras and Equipment you control to target permanent or player."', () => {
  const setup = (extra: string[] = []) => {
    const s = game({ p1: { battlefield: ['Test Rig', 'Test Bear', 'Test Ogre', 'Test Sword', 'Test Axe', 'Test Blessing', 'Test Curse', ...extra] }, p2: { battlefield: ['Test Field', 'Test Ogre'] } }, [RIG, BEAR, OGRE, SWORD, AXE, BLESSING, CURSE, FIELD],
      { 'Test Blessing': (st) => byName(st, 'Test Bear'), 'Test Curse': 'p3' });
    const ids = Object.fromEntries(['Test Rig', 'Test Bear', 'Test Sword', 'Test Axe', 'Test Blessing', 'Test Curse'].map((n) => [n, byName(s, n)]));
    return { s, ids, ogre2: byName(s, 'Test Ogre', 'p2'), field: byName(s, 'Test Field', 'p2') };
  };
  it('is automated, with a target of any permanent or player', () => {
    expect(full(RIG)).toBe(true);
    expect(JSON.stringify(RIG.faces)).toContain('"kind":"objectOrPlayer"');
  });
  it('a creature target: the chosen Equipment and the Aura are attached to it, the one not chosen stays', () => {
    const { s: s0, ids, ogre2 } = setup();
    const { s } = activate(s0, ids['Test Rig']!, { targets: [[obj(ogre2)]], answers: [yes], picks: [[ids['Test Sword']!, ids['Test Blessing']!]] });
    expect(attachedTo(s, ids['Test Sword']!)).toBe(ogre2);
    expect(attachedTo(s, ids['Test Blessing']!)).toBe(ogre2);
    expect(attachedTo(s, ids['Test Axe']!)).toBeNull();
  });
  it('a player target: an Aura that enchants players is attached to them; an Equipment and an Aura that enchants creatures stay where they were', () => {
    const { s: s0, ids } = setup();
    const { s } = activate(s0, ids['Test Rig']!, { targets: [[player('p2')]], answers: [yes], picks: [[ids['Test Curse']!, ids['Test Sword']!, ids['Test Blessing']!]] });
    expect(attachedTo(s, ids['Test Curse']!)).toBe('p2');
    expect(attachedTo(s, ids['Test Sword']!)).toBeNull();
    expect(attachedTo(s, ids['Test Blessing']!)).toBe(ids['Test Bear']!);
    expect(s.zones.battlefield).toContain(ids['Test Blessing']!);
  });
  it('a noncreature permanent target: an Equipment does not attach to it (CR 301.5), an Aura that enchants creatures does not either', () => {
    const { s: s0, ids, field } = setup();
    const { s } = activate(s0, ids['Test Rig']!, { targets: [[obj(field)]], answers: [yes], picks: [[ids['Test Sword']!, ids['Test Blessing']!]] });
    expect(attachedTo(s, ids['Test Sword']!)).toBeNull();
    expect(attachedTo(s, ids['Test Blessing']!)).toBe(ids['Test Bear']!);
  });
  it('any number includes none: declining, or choosing nothing, attaches nothing', () => {
    const { s: s0, ids, ogre2 } = setup();
    const a = activate(s0, ids['Test Rig']!, { targets: [[obj(ogre2)]], answers: [no] });
    expect(attachedTo(a.s, ids['Test Sword']!)).toBeNull();
    const { s: s1, ids: ids1, ogre2: ogre3 } = setup();
    const b = activate(s1, ids1['Test Rig']!, { targets: [[obj(ogre3)]], answers: [yes], picks: [[]] });
    expect(attachedTo(b.s, ids1['Test Axe']!)).toBeNull();
  });
  it('an Equipment of another player is not offered: only those you control', () => {
    const t = game({ p1: { battlefield: ['Test Rig', 'Test Bear'] }, p2: { battlefield: ['Test Sword', 'Test Ogre'] } }, [RIG, BEAR, OGRE, SWORD]);
    const rig = byName(t, 'Test Rig');
    const sword = byName(t, 'Test Sword');
    const bear = byName(t, 'Test Bear');
    const r = activate(t, rig, { targets: [[obj(bear)]], answers: [yes], picks: [[sword]] });
    expect(attachedTo(r.s, sword)).toBeNull();
  });
});

describe('CR 701.3a-b, 608.2d: "For each Aura and Equipment you control, you may attach it to a creature you control."', () => {
  const INVENTORY = card('Test Inventory', 'Instant', 'For each Aura and Equipment you control, you may attach it to a creature you control.');
  const setup = () => {
    const s = game({ p1: { hand: ['Test Inventory'], battlefield: ['Test Bear', 'Test Ogre', 'Test Sword', 'Test Axe', 'Test Blessing'] }, p2: { battlefield: ['Test Ogre'] } }, [INVENTORY, BEAR, OGRE, SWORD, AXE, BLESSING],
      { 'Test Blessing': (st) => byName(st, 'Test Bear') });
    const ids = Object.fromEntries(['Test Bear', 'Test Ogre', 'Test Sword', 'Test Axe', 'Test Blessing'].map((n) => [n, byName(s, n, 'p1')]));
    return { s, ids };
  };
  it('is automated', () => { expect(full(INVENTORY)).toBe(true); });
  it('each permanent has its own "may": attach the first, decline the second, move the Aura to another creature', () => {
    const { s: s0, ids } = setup();
    // the order the permanents are asked in is the battlefield order: Sword, Axe, Blessing
    const { s } = cast(s0, 'Test Inventory', { order: ['Test Sword', 'Test Axe', 'Test Blessing'], answers: [yes, no, yes], picks: [[ids['Test Ogre']!], [ids['Test Ogre']!]] });
    expect(attachedTo(s, ids['Test Sword']!)).toBe(ids['Test Ogre']!);
    expect(attachedTo(s, ids['Test Axe']!)).toBeNull();
    expect(attachedTo(s, ids['Test Blessing']!)).toBe(ids['Test Ogre']!);
  });
  it('declining every one of them changes nothing', () => {
    const { s: s0, ids } = setup();
    const { s } = cast(s0, 'Test Inventory', { answers: [no, no, no] });
    expect(attachedTo(s, ids['Test Sword']!)).toBeNull();
    expect(attachedTo(s, ids['Test Blessing']!)).toBe(ids['Test Bear']!);
  });
  it('only creatures you control can be chosen: an opponent\'s creature is not offered, and neither is an Equipment', () => {
    const { s: s0, ids } = setup();
    const opp = byName(s0, 'Test Ogre', 'p2');
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Inventory', 'hand', 'p1') });
    for (let i = 0; i < 10 && s.pending?.kind !== 'chooseObjects'; i++) {
      if (s.pending?.kind === 'priority') s = pass(s);
      else if (s.pending?.kind === 'order') s = answer(s, { kind: 'order', ids: (s.pending as unknown as { items: { id: string }[] }).items.map((x) => x.id) });
      else if (s.pending?.kind === 'yesNo') s = answer(s, yes);
      else if (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else throw new Error(`unexpected ${s.pending?.kind}`);
    }
    expect(s.pending?.kind).toBe('chooseObjects');
    const offered = (s.pending as unknown as { options: string[] }).options;
    expect(offered).toContain(ids['Test Bear']!);
    expect(offered).toContain(ids['Test Ogre']!);
    expect(offered).not.toContain(opp);
    expect(offered).not.toContain(ids['Test Sword']!);
  });
});

describe('CR 701.37a, 107.3: "When ~ becomes monstrous, create X X/X ..." reads the N of the monstrosity as X', () => {
  const HYDRA = card('Test Hydra', 'Creature — Hydra', '{X}{X}: Monstrosity X.\nWhen this creature becomes monstrous, create X X/X green Hydra creature tokens.', ['3', '3']);
  const PLANT = card('Test Plant', 'Creature — Plant', '{X}: Monstrosity X.\nWhen this creature becomes monstrous, you gain life equal to X.', ['1', '1']);
  const setup = (n = 6) => {
    const s = scenario([], { p1: { battlefield: ['Test Hydra', ...Array(n).fill('Plains')] }, defs: [HYDRA] });
    return { s, hydra: find(s, 'Test Hydra', 'battlefield', 'p1') };
  };
  const tokensOf = (s: GameState) => s.zones.battlefield.filter((id) => s.objects[id]!.defId.startsWith('token:') && s.objects[id]!.controller === 'p1');
  it('is automated', () => { expect(full(HYDRA)).toBe(true); expect(full(PLANT)).toBe(false); });
  it('X = 2: two +1/+1 counters, then two 2/2 Hydra tokens', () => {
    const { s: s0, hydra } = setup();
    const { s } = activate(s0, hydra, { x: 2 });
    expect(counters(s, hydra)).toBe(2);
    expect(s.objects[hydra]!.monstrous).toBe(true);
    expect(tokensOf(s).length).toBe(2);
  });
  it('X = 1: one token (the trigger does not remember an earlier X)', () => {
    const { s: s0, hydra } = setup();
    const { s } = activate(s0, hydra, { x: 1 });
    expect(tokensOf(s).length).toBe(1);
  });
  it('already monstrous: the second monstrosity does nothing and makes no tokens', () => {
    const { s: s0, hydra } = setup();
    const a = activate(s0, hydra, { x: 1 });
    const b = activate(a.s, hydra, { x: 2 });
    expect(tokensOf(b.s).length).toBe(1);
    expect(counters(b.s, hydra)).toBe(1);
  });
});

describe('CR 701.37c, 601.2c: "When ~ becomes monstrous, put a lifelink counter on each of up to X target creatures": the number of targets is the monstrosity N', () => {
  const HUNTER = card('Test Hunter', 'Creature — Nightmare', '{X}: Monstrosity X.\nWhen this creature becomes monstrous, put a lifelink counter on each of up to X target creatures.', ['1', '1']);
  const setup = () => {
    const s = scenario([], { p1: { battlefield: ['Test Hunter', 'Plains', 'Plains', 'Plains', 'Test Bear', 'Test Bear', 'Test Bear'] }, defs: [HUNTER, BEAR] });
    return { s, hunter: find(s, 'Test Hunter', 'battlefield', 'p1'), bears: s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Bear') };
  };
  it('X = 2: two targets are allowed and each gets a lifelink counter', () => {
    const { s: s0, hunter, bears } = setup();
    const { s } = activate(s0, hunter, { x: 2, targets: [[obj(bears[0]!), obj(bears[1]!)]] });
    expect(counters(s, bears[0]!, 'lifelink')).toBe(1);
    expect(counters(s, bears[1]!, 'lifelink')).toBe(1);
    expect(counters(s, bears[2]!, 'lifelink')).toBe(0);
  });
  it('X = 2: a third target is refused', () => {
    const { s: s0, hunter, bears } = setup();
    let s = act(s0, { type: 'activate', player: 'p1', source: hunter, ability: 'p:0:0' } as never);
    s = settle(s, { x: 2 }).s;
    for (let i = 0; i < 6 && !(s.pending?.kind === 'chooseTargets'); i++) s = pass(s);
    expect(s.pending?.kind).toBe('chooseTargets');
    expect(() => answer(s, { kind: 'chooseTargets', targets: bears.map((b) => obj(b)) })).toThrow();
  });
});

describe('CR 303.4a, 704.5m: "Enchant creature with another Aura attached to it"', () => {
  const CORONET = card('Test Coronet', 'Enchantment — Aura', 'Enchant creature with another Aura attached to it\nEnchanted creature gets +3/+3.');
  const setup = () => {
    const s = game({ p1: { hand: ['Test Coronet'], battlefield: ['Test Bear', 'Test Ogre', 'Test Blessing'] } }, [CORONET, BEAR, OGRE, BLESSING], { 'Test Blessing': (st) => byName(st, 'Test Bear') });
    const ids = Object.fromEntries(['Test Bear', 'Test Ogre', 'Test Blessing'].map((n) => [n, byName(s, n, 'p1')]));
    return { s, ids };
  };
  it('is automated, with the restriction on the Aura\'s enchant ability', () => { expect(full(CORONET)).toBe(true); expect(JSON.stringify(CORONET.faces)).toContain('"attachedWithOther":true'); });
  it('a creature with another Aura attached can be enchanted', () => {
    const { s: s0, ids } = setup();
    const { s } = cast(s0, 'Test Coronet', { targets: [[obj(ids['Test Bear']!)]] });
    const coronet = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Coronet');
    expect(coronet).toBeDefined();
    expect(attachedTo(s, coronet!)).toBe(ids['Test Bear']!);
    // it stays: it is not "another Aura" for itself (CR 704.5m)
    expect(s.zones.battlefield).toContain(coronet!);
  });
  it('a creature with no other Aura is not a legal target', () => {
    const { s: s0, ids } = setup();
    const s1 = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Coronet', 'hand', 'p1') });
    expect(s1.pending?.kind).toBe('chooseTargets');
    const legal = (s1.pending as unknown as { targets?: { legal?: { id: string }[] }[] }).targets;
    void legal;
    const ids2 = JSON.stringify(s1.pending);
    expect(ids2).toContain(ids['Test Bear']!);
    expect(ids2).not.toContain(ids['Test Ogre']!);
  });
  it('when the other Aura leaves, the Aura is put into its owner\'s graveyard as a state-based action', () => {
    const { s: s0, ids } = setup();
    const { s: s1 } = cast(s0, 'Test Coronet', { targets: [[obj(ids['Test Bear']!)]] });
    const coronet = s1.zones.battlefield.find((id) => s1.objects[id]!.defId === 'Test Coronet')!;
    const s2 = JSON.parse(JSON.stringify(s1)) as GameState;
    s2.objects[ids['Test Blessing']!]!.attachedTo = ids['Test Ogre']!; // moved away from the Bear
    const s3 = pass(pass(s2));
    expect(s3.zones.battlefield).not.toContain(coronet);
  });
});

describe('CR 122.1, 608.2d: "Put your choice of a +1/+1 counter or two charge counters on target artifact."', () => {
  const MIXER = card('Test Mixer', 'Sorcery', 'Put your choice of a +1/+1 counter or two charge counters on target artifact.');
  const setup = () => {
    const s = scenario([], { p1: { hand: ['Test Mixer'], battlefield: ['Test Sword'] }, defs: [MIXER, SWORD] });
    return { s, sword: find(s, 'Test Sword', 'battlefield', 'p1') };
  };
  it('is automated', () => { expect(full(MIXER)).toBe(true); });
  it('choosing the first: one +1/+1 counter and no charge counter', () => {
    const { s: s0, sword } = setup();
    const { s, asked } = cast(s0, 'Test Mixer', { targets: [[obj(sword)]], options: ['+1/+1'] });
    expect(asked).toContain('chooseOption');
    expect(counters(s, sword)).toBe(1);
    expect(counters(s, sword, 'charge')).toBe(0);
  });
  it('choosing the second: two charge counters and no +1/+1 counter', () => {
    const { s: s0, sword } = setup();
    const { s } = cast(s0, 'Test Mixer', { targets: [[obj(sword)]], options: ['charge'] });
    expect(counters(s, sword)).toBe(0);
    expect(counters(s, sword, 'charge')).toBe(2);
  });
});
