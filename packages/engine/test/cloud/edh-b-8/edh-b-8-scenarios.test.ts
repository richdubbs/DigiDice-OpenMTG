/**
 * Commander lane edh-b, round edh-b-8 (EDHREC ranks 8,001 to 9,000, second pass, fourth pass beside edh-b-5): the round's readings played through the engine with synthetic cards (invented
 * names, design 6.10), compiled by the game's default compiler, in 4-player games (Alice, p1, is the active player of turn 1). Each group has its negative cases. CR cites are from the
 * Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 *
 *   CR 614.1c, 614.12, 122.6     "This creature enters with a +1/+1 counter on it for each other Zombie you control and each Zombie card in your graveyard."
 *   CR 608.2c, 205.2a            "If it's an enchanted creature or enchantment creature, it also gains hexproof and indestructible until end of turn."
 *   CR 502.3, 611.2a-b           "Those creatures don't untap during their controllers' untap steps for as long as you control ~."
 *   CR 122.5, 608.2d             "You may move any number of +1/+1 counters from ~ onto another target creature."
 *   CR 406.1, 708.2              "Put target face-up exiled card into its owner's graveyard."
 *   CR 201.2, 110.1              "Equipped creature gets +1/+1 for each land on the battlefield with the same name as the exiled card."
 *   CR 608.2g, 601.2, 118.9      "You may cast an instant or sorcery spell from your graveyard with mana value 4 or less without paying its mana cost." / "... from that player's graveyard ..."
 *   CR 701.27a, 101.2            "Non-Human Werewolves you control can't transform."
 *   CR 615.1, 122.1              "If ~ would be dealt damage, prevent that damage and remove a +1/+1 counter from it."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { cantDo } from '../../../src/rules/cant';
import { act, answer, find, pass } from '../../m3/scenario';
import { tweak } from '../../m4/helpers';
import { mpScenario } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const plr = (id: string): TargetChoice => ({ kind: 'player', id } as TargetChoice);

interface Opts { targets?: TargetChoice[][]; picks?: ObjectId[][]; answers?: DecisionAnswer[]; options?: string[] }
/** Answer what comes up: targets, object choices, option labels, then the answers; pay costs automatically; stop at priority. */
function settle(s0: GameState, o: Opts): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets' && o.targets && o.targets.length > 0) s = answer(s, { kind: 'chooseTargets', targets: o.targets.shift()! });
    else if (p.kind === 'chooseObjects' && o.picks && o.picks.length > 0) s = answer(s, { kind: 'chooseObjects', ids: o.picks.shift()! });
    else if (p.kind === 'chooseOption' && o.options && o.options.length > 0) {
      const label = o.options.shift()!;
      const opt = p.options.find((x) => x.label === label);
      if (!opt) throw new Error(`no option ${label} among ${p.options.map((x) => x.label).join(', ')}`);
      s = answer(s, { kind: 'chooseOption', ids: [opt.id] });
    } else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: [p.options[0]!.id] });
    else if (o.answers && o.answers.length > 0) s = answer(s, o.answers.shift()!);
    else break;
  }
  return s;
}
const queued = (o: Opts): Opts => ({ ...o, targets: [...(o.targets ?? [])], picks: [...(o.picks ?? [])], answers: [...(o.answers ?? [])], options: [...(o.options ?? [])] });
function drain(s0: GameState, o: Opts): GameState {
  let s = s0;
  for (let guard = 0; s.pending?.kind === 'priority' && s.zones.stack.length > 0 && guard < 40; guard++) s = settle(pass(s), o);
  return s;
}
/** p1 activates an ability of a permanent, answers what is asked, and lets the stack resolve. */
function activate(s0: GameState, source: ObjectId, opts: Opts = {}, ability = 'p:0:0'): GameState {
  const q = queued(opts);
  return drain(settle(act(s0, { type: 'activate', player: 'p1', source, ability } as never), q), q);
}
/** p1 casts a card from their hand, answers what is asked, and lets the stack resolve. */
function cast(s0: GameState, name: string, opts: Opts = {}): GameState {
  const q = queued(opts);
  return drain(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') } as never), q), q);
}
/** Pass (declaring nothing when asked) until the first main phase of turn `n`. */
function toMain(s0: GameState, n: number): GameState {
  let s = s0;
  for (let i = 0; i < 400 && !(s.turn.number === n && s.turn.step === 'main1' && s.pending?.kind === 'priority'); i++) {
    if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (s.pending?.kind === 'priority') s = act(s, { type: 'pass', player: s.pending.player } as never);
    else s = settle(s, {});
  }
  return s;
}
const byName = (s: GameState, name: string, zone: 'battlefield' | 'hand' | 'graveyard' | 'library' | 'exile' = 'battlefield', owner?: string): ObjectId =>
  Object.values(s.objects).find((o) => s.defs[o.defId]?.name === name && o.zone === zone && (owner === undefined || o.owner === owner))!.id;
const stat = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const kw = (s: GameState, id: ObjectId): string[] => getChars(s, id)!.keywords.map((k) => (typeof k === 'string' ? k : (k as { keyword?: string }).keyword ?? ''));
/** The zones the objects with this name are in now (a card that changes zones is a new object, CR 400.7). */
const zonesOf = (s: GameState, name: string, owner?: string): string[] => Object.values(s.objects).filter((o) => s.defs[o.defId]?.name === name && (owner === undefined || o.owner === owner)).map((o) => o.zone);
const countersOf = (s: GameState, id: ObjectId): Record<string, number> => ({ ...s.objects[id]!.counters });
const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;

const HORDE = card('Test Grave Horde', 'Creature — Zombie', 'This creature enters with a +1/+1 counter on it for each other Zombie you control and each Zombie card in your graveyard.', ['0', '0']);
const ZOMBIE = card('Test Zombie', 'Creature — Zombie', '', ['1', '1']);
const ELF = card('Test Elf', 'Creature — Elf', '', ['1', '1']);
const BOON = card('Test Boon', 'Instant', "Target creature gets +2/+2 until end of turn. If it's an enchanted creature or enchantment creature, it also gains hexproof and indestructible until end of turn.");
const AURA = card('Test Wreath', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +0/+1.');
const ENCH_CREATURE = card('Test Spirit', 'Enchantment Creature — Spirit', '', ['1', '1']);
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const KRAKEN = card('Test Warden', 'Creature — Kraken', "When this creature enters, tap up to four target creatures. Those creatures don't untap during their controllers' untap steps for as long as you control this creature.", ['1', '1']);
const SMITE = card('Test Smite', 'Instant', 'Destroy target creature.');
const BANDAR = card('Test Scrounger', 'Creature — Monkey', '{0}: You may move any number of +1/+1 counters from this creature onto another target creature.', ['1', '1']);
const PULL = card('Test Banish Return', 'Instant', "Put target face-up exiled card into its owner's graveyard.");
const SCYTHE = card('Test Scythe', 'Artifact — Equipment', 'When this Equipment enters, search your library for a land card, exile it, then shuffle.\nEquipped creature gets +1/+1 for each land on the battlefield with the same name as the exiled card.\nEquip {0}');
const FOREST = card('Test Forest', 'Basic Land — Forest', '');
const SWAMP = card('Test Swamp', 'Basic Land — Swamp', '');
const MIST = card('Test Mist Diviner', 'Creature — Wizard', 'When this creature enters, you may cast an instant or sorcery spell from your graveyard with mana value 4 or less without paying its mana cost. If that spell would be put into your graveyard, exile it instead.', ['1', '1']);
const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 3 damage to any target.', undefined, '{R}');
const BIGBOLT = card('Test Big Bolt', 'Sorcery', 'Test Big Bolt deals 5 damage to any target.', undefined, '{4}{R}');
const SQUALL = card('Test Squall', 'Sorcery', "Target opponent mills two cards, then you may cast an instant or sorcery spell from that player's graveyard without paying its mana cost. If that spell would be put into a graveyard, exile it instead.");
const WOLFLORD = card('Test Packlord', 'Creature — Werewolf', "Non-Human Werewolves you control can't transform.", ['2', '2']);
const WOLF = card('Test Moonwolf', 'Creature — Werewolf', '', ['2', '2']);
const HUMANWOLF = card('Test Moonhuman', 'Creature — Human Werewolf', '', ['2', '2']);
const ZAP = card('Test Zap', 'Instant', 'Test Zap deals 2 damage to any target.');
const UNDEAD = card('Test Undead', 'Creature — Zombie', 'If ~ would be dealt damage, prevent that damage and remove a +1/+1 counter from it.', ['1', '1']);

const ALL = [HORDE, ZOMBIE, ELF, BOON, AURA, ENCH_CREATURE, BEAR, KRAKEN, SMITE, BANDAR, PULL, SCYTHE, FOREST, SWAMP, MIST, BOLT, BIGBOLT, SQUALL, WOLFLORD, WOLF, HUMANWOLF, ZAP, UNDEAD];
describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of ALL) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 614.1c, 614.12, 122.6: "enters with a +1/+1 counter on it for each other Zombie you control and each Zombie card in your graveyard"', () => {
  const game = (extra: Record<string, { hand?: string[]; battlefield?: string[]; graveyard?: string[] }> = {}) => mpScenario({
    defs: [HORDE, ZOMBIE, ELF],
    zones: { p1: { hand: ['Test Grave Horde'], battlefield: ['Test Zombie', 'Test Zombie', 'Test Elf'], graveyard: ['Test Zombie'] }, ...extra },
  });
  it('counts the other Zombies you control (2) and the Zombie cards in your graveyard (1): three counters', () => {
    const s = cast(game(), 'Test Grave Horde');
    expect(countersOf(s, byName(s, 'Test Grave Horde'))['+1/+1']).toBe(3);
    expect(stat(s, byName(s, 'Test Grave Horde'))).toBe('3/3');
  });
  it('negative: an opponent\'s Zombies and an opponent\'s graveyard do not count, and neither does a non-Zombie in your graveyard', () => {
    const s = cast(game({ p2: { battlefield: ['Test Zombie'], graveyard: ['Test Zombie'] }, p1: { hand: ['Test Grave Horde'], battlefield: ['Test Zombie'], graveyard: ['Test Elf'] } }), 'Test Grave Horde');
    expect(countersOf(s, byName(s, 'Test Grave Horde'))['+1/+1']).toBe(1);
  });
});

describe('CR 608.2c, 205.2a: "If it\'s an enchanted creature or enchantment creature, it also gains hexproof and indestructible until end of turn."', () => {
  const game = (): GameState => mpScenario({
    defs: [BOON, AURA, ENCH_CREATURE, BEAR],
    zones: { p1: { hand: ['Test Boon', 'Test Boon', 'Test Boon'], battlefield: ['Test Bear', 'Test Bear', 'Test Spirit', 'Test Wreath'] } },
    setup: (s) => {
      const bears = Object.values(s.objects).filter((o) => s.defs[o.defId]?.name === 'Test Bear' && o.zone === 'battlefield');
      const wreath = Object.values(s.objects).find((o) => s.defs[o.defId]?.name === 'Test Wreath')!;
      wreath.attachedTo = bears[0]!.id;
      void bears;
    },
  });
  const bears = (s: GameState): ObjectId[] => Object.values(s.objects).filter((o) => s.defs[o.defId]?.name === 'Test Bear' && o.zone === 'battlefield').map((o) => o.id);
  it('an enchanted creature gets +2/+2 and hexproof and indestructible', () => {
    const s0 = game();
    const enchanted = bears(s0).find((id) => Object.values(s0.objects).some((o) => o.attachedTo === id))!;
    const s = cast(s0, 'Test Boon', { targets: [[obj(enchanted)]] });
    expect(stat(s, enchanted)).toBe('4/5');
    expect(kw(s, enchanted)).toEqual(expect.arrayContaining(['hexproof', 'indestructible']));
  });
  it('an enchantment creature gets the keywords too', () => {
    const s0 = game();
    const spirit = byName(s0, 'Test Spirit');
    const s = cast(s0, 'Test Boon', { targets: [[obj(spirit)]] });
    expect(stat(s, spirit)).toBe('3/3');
    expect(kw(s, spirit)).toEqual(expect.arrayContaining(['hexproof', 'indestructible']));
  });
  it('negative: a plain creature (neither enchanted nor an enchantment) only gets +2/+2', () => {
    const s0 = game();
    const plain = bears(s0).find((id) => !Object.values(s0.objects).some((o) => o.attachedTo === id))!;
    const s = cast(s0, 'Test Boon', { targets: [[obj(plain)]] });
    expect(stat(s, plain)).toBe('4/4');
    expect(kw(s, plain)).not.toContain('hexproof');
    expect(kw(s, plain)).not.toContain('indestructible');
  });
});

describe('CR 502.3, 611.2a-b: "Those creatures don\'t untap during their controllers\' untap steps for as long as you control ~."', () => {
  const game = (): GameState => mpScenario({
    defs: [KRAKEN, BEAR, SMITE],
    zones: { p1: { hand: ['Test Warden', 'Test Smite'] }, p2: { battlefield: ['Test Bear', 'Test Bear'] } },
  });
  it('the tapped creatures stay tapped through their controller\'s untap step while you control the source; an untargeted one untaps', () => {
    const s0 = game();
    const [a, b] = Object.values(s0.objects).filter((o) => s0.defs[o.defId]?.name === 'Test Bear').map((o) => o.id);
    let s = cast(s0, 'Test Warden', { targets: [[obj(a!)]] });
    expect(s.objects[a!]!.tapped).toBe(true);
    s = tweak(s, (t) => { t.objects[b!]!.tapped = true; });
    s = toMain(s, 2);
    expect(s.objects[a!]!.tapped).toBe(true);
    expect(s.objects[b!]!.tapped).toBe(false);
  });
  it('negative: once the source is gone the creature untaps as normal', () => {
    const s0 = game();
    const a = Object.values(s0.objects).find((o) => s0.defs[o.defId]?.name === 'Test Bear')!.id;
    let s = cast(s0, 'Test Warden', { targets: [[obj(a)]] });
    s = cast(s, 'Test Smite', { targets: [[obj(byName(s, 'Test Warden'))]] });
    expect(zonesOf(s, 'Test Warden')).toEqual(['graveyard']);
    s = toMain(s, 2);
    expect(s.objects[a]!.tapped).toBe(false);
  });
});

describe('CR 122.5, 608.2d: "You may move any number of +1/+1 counters from ~ onto another target creature."', () => {
  const game = (): GameState => mpScenario({
    defs: [BANDAR, BEAR],
    zones: { p1: { battlefield: ['Test Scrounger', 'Test Bear'] } },
    setup: (s) => { const o = Object.values(s.objects).find((x) => s.defs[x.defId]?.name === 'Test Scrounger')!; o.counters['+1/+1'] = 3; },
  });
  it('moves the number chosen (2 of 3) onto the target', () => {
    const s0 = game();
    const src = byName(s0, 'Test Scrounger');
    const bear = byName(s0, 'Test Bear');
    const s = activate(s0, src, { targets: [[obj(bear)]], answers: [{ kind: 'yesNo', yes: true }, { kind: 'chooseNumber', n: 2 } as DecisionAnswer] });
    expect(countersOf(s, src)['+1/+1']).toBe(1);
    expect(countersOf(s, bear)['+1/+1']).toBe(2);
  });
  it('negative: it can move none (the source keeps all its counters)', () => {
    const s0 = game();
    const src = byName(s0, 'Test Scrounger');
    const bear = byName(s0, 'Test Bear');
    const s = activate(s0, src, { targets: [[obj(bear)]], answers: [{ kind: 'yesNo', yes: false }] });
    expect(countersOf(s, src)['+1/+1']).toBe(3);
    expect(countersOf(s, bear)['+1/+1'] ?? 0).toBe(0);
  });
});

describe('CR 406.1, 708.2: "Put target face-up exiled card into its owner\'s graveyard."', () => {
  const game = (): GameState => mpScenario({
    defs: [PULL, ELF, ZOMBIE],
    zones: { p1: { hand: ['Test Banish Return'] }, p2: { exile: ['Test Elf', 'Test Zombie'] } },
    setup: (s) => { const z = Object.values(s.objects).find((x) => s.defs[x.defId]?.name === 'Test Zombie')!; z.faceDown = true; },
  });
  it('puts a face-up exiled card into its OWNER\'s graveyard', () => {
    const s0 = game();
    const elf = byName(s0, 'Test Elf', 'exile');
    const s = cast(s0, 'Test Banish Return', { targets: [[obj(elf)]] });
    expect(zonesOf(s, 'Test Elf')).toEqual(['graveyard']);
    expect(s.zones.graveyard['p2']!.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Elf')).toBe(true);
  });
  it('negative: a face-down exiled card is not a legal target', () => {
    const s0 = game();
    const zombie = byName(s0, 'Test Zombie', 'exile');
    const r = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Banish Return', 'hand', 'p1') } as never);
    const legal = (r.pending as { kind: string; specs?: { options?: { id: string }[] }[] } | undefined);
    expect(JSON.stringify(legal)).not.toContain(zombie);
    expect(JSON.stringify(legal)).toContain(byName(s0, 'Test Elf', 'exile'));
  });
});

describe('CR 201.2, 110.1: "Equipped creature gets +1/+1 for each land on the battlefield with the same name as the exiled card."', () => {
  const game = (): GameState => mpScenario({
    defs: [SCYTHE, FOREST, SWAMP, BEAR],
    zones: { p1: { hand: ['Test Scythe'], battlefield: ['Test Bear', 'Test Forest'], library: ['Plains', 'Test Forest', 'Test Swamp', 'Plains'] }, p2: { battlefield: ['Test Forest', 'Test Swamp'] } },
  });
  it('counts the lands of every controller with the exiled card\'s name (not just yours), and no other land', () => {
    // the search is the player's choice: take a Forest
    let s: GameState;
    const sf = game();
    const forestInLib = (x: GameState): ObjectId => x.zones.library['p1']!.find((id) => x.defs[x.objects[id]!.defId]!.name === 'Test Forest')!;
    s = cast(sf, 'Test Scythe', { picks: [[forestInLib(sf)]] });
    const bear = byName(s, 'Test Bear');
    const scythe = byName(s, 'Test Scythe');
    s = tweak(s, (t) => { t.objects[scythe]!.attachedTo = bear; });
    expect(s.objects[byName(s, 'Test Forest', 'exile')]).toBeDefined();
    // Forests on the battlefield: p1's one and p2's one
    expect(stat(s, bear)).toBe('4/4');
  });
});

describe('CR 608.2g, 601.2, 118.9: "You may cast an instant or sorcery spell from your graveyard with mana value 4 or less without paying its mana cost."', () => {
  const game = (): GameState => mpScenario({
    defs: [MIST, BOLT, BIGBOLT, BEAR],
    zones: { p1: { hand: ['Test Mist Diviner'], graveyard: ['Test Bolt', 'Test Big Bolt'] }, p2: { battlefield: ['Test Bear'] } },
  });
  it('casts the mana value 3 spell for free and exiles it afterwards instead of putting it into the graveyard', () => {
    const s0 = game();
    const bolt = byName(s0, 'Test Bolt', 'graveyard');
    const bear = byName(s0, 'Test Bear');
    const s = cast(s0, 'Test Mist Diviner', { picks: [[bolt]], answers: [{ kind: 'yesNo', yes: true }], targets: [[obj(bear)]] });
    expect(zonesOf(s, 'Test Bear')).toEqual(['graveyard']);
    expect(zonesOf(s, 'Test Bolt')).toEqual(['exile']);
  });
  it('negative: the mana value 5 spell is not offered', () => {
    const s0 = game();
    const big = byName(s0, 'Test Big Bolt', 'graveyard');
    const r = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Mist Diviner', 'hand', 'p1') } as never), {});
    const s = drain(r, {});
    expect(s.pending?.kind).toBe('chooseObjects');
    const pending = JSON.stringify(s.pending ?? null);
    expect(pending).toContain(byName(s0, 'Test Bolt', 'graveyard'));
    expect(pending).not.toContain(big);
  });
});

/** Cast Test Squall at p2 and let the stack resolve until the first decision of the resolution (or priority with an empty stack). */
function squallDecision(s0: GameState): GameState {
  let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Squall', 'hand', 'p1') } as never), { targets: [[plr('p2')]] });
  for (let i = 0; i < 6 && s.pending?.kind === 'priority' && s.zones.stack.length > 0; i++) s = settle(pass(s), {});
  return s;
}

describe('CR 701.17a, 404.1, 118.9: "Target opponent mills two cards, then you may cast an instant or sorcery spell from that player\'s graveyard without paying its mana cost."', () => {
  const game = (): GameState => mpScenario({
    defs: [SQUALL, BOLT, BEAR],
    zones: { p1: { hand: ['Test Squall'], graveyard: ['Test Bolt'] }, p2: { library: ['Test Bolt', 'Test Bear', 'Plains'], battlefield: ['Test Bear'] } },
  });
  it('casts the milled instant from the opponent\'s graveyard and exiles it afterwards', () => {
    const s0 = game();
    const s2 = squallDecision(s0);
    expect(s2.pending?.kind).toBe('chooseObjects');
    const pend = s2.pending as { options?: ObjectId[] };
    const opts = (pend.options ?? []).map((id) => `${s2.defs[s2.objects[id]!.defId]!.name}:${s2.objects[id]!.owner}`);
    expect(opts).toEqual(['Test Bolt:p2']);
    const s3 = drain(settle(answer(s2, { kind: 'chooseObjects', ids: pend.options! }), { targets: [[plr('p3')]] }), { targets: [[plr('p3')]] });
    expect(lifeOf(s3, 'p3')).toBe(17);
    expect(zonesOf(s3, 'Test Bolt', 'p2')).toEqual(['exile']);
  });
  it('negative: your own graveyard\'s spell is never offered', () => {
    const s0 = game();
    const own = byName(s0, 'Test Bolt', 'graveyard', 'p1');
    const s2 = squallDecision(s0);
    expect(JSON.stringify(s2.pending ?? null)).not.toContain(own);
    expect(JSON.stringify(s2.pending ?? null)).toContain('chooseObjects');
  });
});

describe('CR 701.27a, 101.2: "Non-Human Werewolves you control can\'t transform."', () => {
  const game = (): GameState => mpScenario({
    defs: [WOLFLORD, WOLF, HUMANWOLF, BEAR],
    zones: { p1: { battlefield: ['Test Packlord', 'Test Moonwolf', 'Test Moonhuman', 'Test Bear'] }, p2: { battlefield: ['Test Moonwolf'] } },
  });
  it('your non-Human Werewolves can\'t transform', () => {
    const s = game();
    expect(cantDo(s, 'transform', byName(s, 'Test Moonwolf', 'battlefield', 'p1'))).not.toBeNull();
  });
  it('negative: a Human Werewolf, a non-Werewolf and an opponent\'s Werewolf still can', () => {
    const s = game();
    expect(cantDo(s, 'transform', byName(s, 'Test Moonhuman'))).toBeNull();
    expect(cantDo(s, 'transform', byName(s, 'Test Bear'))).toBeNull();
    expect(cantDo(s, 'transform', byName(s, 'Test Moonwolf', 'battlefield', 'p2'))).toBeNull();
  });
});

describe('CR 615.1, 122.1: "If ~ would be dealt damage, prevent that damage and remove a +1/+1 counter from it."', () => {
  const game = (counters: number): GameState => mpScenario({
    defs: [UNDEAD, ZAP],
    zones: { p1: { hand: ['Test Zap'], battlefield: ['Test Undead'] } },
    setup: (s) => { const o = Object.values(s.objects).find((x) => s.defs[x.defId]?.name === 'Test Undead')!; if (counters > 0) o.counters['+1/+1'] = counters; },
  });
  it('prevents the damage and removes one counter', () => {
    const s0 = game(2);
    const u = byName(s0, 'Test Undead');
    const s = cast(s0, 'Test Zap', { targets: [[obj(u)]] });
    expect(zonesOf(s, 'Test Undead')).toEqual(['battlefield']);
    expect(s.objects[u]!.damage ?? 0).toBe(0);
    expect(countersOf(s, u)['+1/+1']).toBe(1);
  });
  it('negative: with no counter the damage is still prevented and no counter is removed (ruling 2011-09-22)', () => {
    const s0 = game(0);
    const u = byName(s0, 'Test Undead');
    const s = cast(s0, 'Test Zap', { targets: [[obj(u)]] });
    expect(zonesOf(s, 'Test Undead')).toEqual(['battlefield']);
    expect(s.objects[u]!.damage ?? 0).toBe(0);
    expect(countersOf(s, u)['+1/+1'] ?? 0).toBe(0);
  });
});
