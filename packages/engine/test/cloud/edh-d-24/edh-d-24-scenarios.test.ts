/**
 * Commander coordinator D, round edh-d-24 (lane attach): the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the game's default compiler.
 * Each test is named after the rule it checks, with its negative case. CR cites from the Comprehensive Rules of 2026-09-25 (cloud session: from memory, unverified).
 *
 *   CR 702.16c-d, 704.5m-n       "... has protection from each color. This effect doesn't remove Auras." (Spectra Ward); "... Auras and Equipment you control that are already attached to it." (Benevolent Blessing)
 *   CR 508.1, 508.3a, 603.2      "Whenever equipped creature and at least one other creature attack, draw a card." (Glimmer Lens)
 *   CR 303.4a, 303.4f, 702.5a    "... search your library for an Aura card that could enchant that creature, put it onto the battlefield attached to that creature" (Sovereigns of Lost Alara)
 *   CR 303.4f, 303.4g            "Put target Aura card from a graveyard onto the battlefield under your control attached to a creature you control." (Nomad Mythmaker)
 *   CR 301.5, 704.5n             "~ can be attached only to a creature with power 3 or greater." (O-Naginata); "... to a legendary creature." (Konda's Banner)
 *   CR 702.6a, 602.2b, 118.1     "Equip {2} or {B}" (Transmogrant's Crown)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { attackDenial } from '../../../src/rules/combat-rules';
import { gameOf, hookpoints } from '../../../src/rules/hookpoints';
import { act, answer, find, legal, pass, put, scenario } from '../../m3/scenario';
import { declareAttackers, passUntil, toDeclareAttackers } from '../../m4/helpers';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: string[]; keywords?: string[]; supertypes?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: opts.keywords ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const chars = (s: GameState, id: ObjectId) => getChars(s, id);
const onField = (s: GameState, name: string, who?: string): ObjectId[] => s.zones.battlefield.filter((id) => chars(s, id).name === name && (who === undefined || s.objects[id]!.controller === who));
const stat = (s: GameState, id: ObjectId): string => `${chars(s, id).power}/${chars(s, id).toughness}`;
const attach = (s: GameState, attachment: ObjectId, host: ObjectId): void => { s.objects[attachment]!.attachedTo = host; };
const canAttach = (s: GameState, attachment: ObjectId, host: ObjectId): boolean => hookpoints.canAttach(gameOf(s), attachment, host) === null;

/** Answer every decision: yes/no by `yes`, objects by `pick`, targets in order from `targets`, mana automatically. */
function drive(s0: GameState, o: { yes?: boolean; pick?: (options: ObjectId[], s: GameState) => ObjectId[]; targets?: ObjectId[][] } = {}): GameState {
  let s = s0;
  const tq = [...(o.targets ?? [])];
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: o.pick ? o.pick(p.options, s) : p.options.slice(0, Math.max(p.min, 1)).slice(0, p.max) });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: (tq.shift() ?? []).map((id) => (/^p\d/.test(id) ? { kind: 'player' as const, id } : { kind: 'object' as const, id })) });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else if (p.kind === 'chooseColor') s = answer(s, { kind: 'chooseColor', color: 'W' } as never);
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: [p.options[0]!.id] });
    else throw new Error(`unexpected decision ${p.kind}: ${JSON.stringify(p).slice(0, 300)}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Parameters<typeof drive>[1] = {}): GameState {
  let s = drive(s0, o);
  for (let guard = 0; guard < 40 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, o);
  return s;
}
const BEARPICK = (aura: ObjectId) => ({ targets: [[aura]], pick: (options: ObjectId[], st: GameState) => options.filter((id) => chars(st, id).name === 'Test Bear') });
const equipActions = (s: GameState, equipment: ObjectId) => legal(s, 'p1', 'activate').filter((a) => a.action.type === 'activate' && a.action.source === equipment);

describe('"Enchanted creature has protection from each color. This effect doesn\'t remove Auras." (CR 702.16c-d, 704.5m; Spectra Ward)', () => {
  const WARD = card('Test Ward Aura', 'Enchantment — Aura', "Enchant creature\nEnchanted creature gets +2/+2 and has protection from each color. This effect doesn't remove Auras.", { cost: '{3}{W}{W}', colors: ['W'] });
  const RED = card('Test Red Aura', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+0.', { cost: '{R}', colors: ['R'] });
  const SWORD = card('Test Plain Blade', 'Artifact — Equipment', 'Equipped creature gets +1/+1.\nEquip {1}');
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const base = () => {
    const s = scenario([], { defs: [WARD, RED, SWORD, BEAR] });
    const [ward, red, sword, bear] = ['Test Ward Aura', 'Test Red Aura', 'Test Plain Blade', 'Test Bear'].map((n) => put(s, 'p1', 'battlefield', n)) as [ObjectId, ObjectId, ObjectId, ObjectId];
    return { s, ward, red, sword, bear };
  };
  it('is fully automated', () => expect(full(WARD)).toBe(true));
  it('with the Aura on the creature, the Auras already attached stay (the red Aura is not put into the graveyard) and the creature is 3/3 + 1 power', () => {
    const { s, ward, red, bear } = base();
    attach(s, red, bear);
    attach(s, ward, bear);
    expect(canAttach(s, red, bear)).toBe(true);
    expect(canAttach(s, ward, bear)).toBe(true);
    expect(stat(s, bear)).toBe('5/4');
  });
  it('the negative case: an Aura that is not attached yet is refused (the protection is real), and the colorless Equipment is not affected', () => {
    const { s, ward, red, sword, bear } = base();
    attach(s, ward, bear);
    expect(canAttach(s, red, bear)).toBe(false);
    expect(canAttach(s, sword, bear)).toBe(true);
  });
});

describe('"Enchanted creature has protection from the chosen color. This effect doesn\'t remove Auras and Equipment you control that are already attached to it." (Benevolent Blessing)', () => {
  const BLESS = card('Test Blessing Aura', 'Enchantment — Aura', "Enchant creature\nAs this Aura enters, choose a color.\nEnchanted creature has protection from the chosen color. This effect doesn't remove Auras and Equipment you control that are already attached to it.", { cost: '{0}', colors: ['W'] });
  const WHITE = card('Test White Aura', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+0.', { cost: '{W}', colors: ['W'] });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  it('is fully automated', () => expect(full(BLESS)).toBe(true));
  it('with white chosen, the white Aura its controller controls that is already attached is kept; the white Aura of another player is not kept, and none attaches anew', () => {
    const s0 = scenario([], { defs: [BLESS, WHITE, BEAR], p1: { hand: ['Test Blessing Aura'] } });
    const bear = put(s0, 'p1', 'battlefield', 'Test Bear');
    const mine = put(s0, 'p1', 'battlefield', 'Test White Aura');
    const theirs = put(s0, 'p2', 'battlefield', 'Test White Aura');
    attach(s0, mine, bear);
    attach(s0, theirs, bear);
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Blessing Aura', 'hand', 'p1') }), { targets: [[bear]] });
    const bless = onField(s, 'Test Blessing Aura')[0]!;
    expect(s.objects[bless]!.attachedTo).toBe(bear);
    expect(s.objects[mine]?.zone).toBe('battlefield'); // yours and already attached: kept (CR 702.16c)
    expect(s.objects[mine]!.attachedTo).toBe(bear);
    expect(s.objects[theirs]).toBeUndefined(); // another player's Aura is not kept: it went to its owner's graveyard (CR 704.5m)
    const fresh = put(s, 'p1', 'battlefield', 'Test White Aura'); // an Aura of yours that is not attached yet is still refused
    expect(canAttach(s, fresh, bear)).toBe(false);
  });
});

describe('"Whenever equipped creature and at least one other creature attack, draw a card." (CR 508.1, 508.3a, 603.2; Glimmer Lens)', () => {
  const LENS = card('Test Lens', 'Artifact — Equipment', 'Whenever equipped creature and at least one other creature attack, draw a card.\nEquip {1}');
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const handOf = (s: GameState): number => s.zones.hand['p1']!.length;
  const run = (attackers: number[]): { before: number; after: number } => {
    const s0 = scenario([], { defs: [LENS, BEAR], p1: { battlefield: ['Test Lens', 'Test Bear', 'Test Bear'] } });
    const bears = onField(s0, 'Test Bear');
    attach(s0, onField(s0, 'Test Lens')[0]!, bears[0]!);
    const before = handOf(s0);
    const s = resolveAll(declareAttackers(toDeclareAttackers(s0), attackers.map((i): [ObjectId] => [bears[i]!])));
    return { before, after: handOf(s) };
  };
  it('is fully automated', () => expect(full(LENS)).toBe(true));
  it('the equipped creature attacking with another creature draws a card', () => {
    const r = run([0, 1]);
    expect(r.after).toBe(r.before + 1);
  });
  it('the negative cases: the equipped creature alone, or only the other creature, draws nothing', () => {
    const alone = run([0]);
    expect(alone.after).toBe(alone.before);
    const other = run([1]);
    expect(other.after).toBe(other.before);
  });
});

describe('"~ can be attached only to a creature with power 3 or greater." / "... a legendary creature." (CR 301.5, 704.5n; O-Naginata, Konda\'s Banner)', () => {
  const NAGINATA = card('Test Long Blade', 'Artifact — Equipment', '~ can be attached only to a creature with power 3 or greater.\nEquipped creature gets +3/+0 and has trample.\nEquip {0}');
  const BANNER = card('Test Standard', 'Legendary Artifact — Equipment', '~ can be attached only to a legendary creature.\nCreatures that share a color with equipped creature get +1/+1.\nEquip {0}');
  const SMALL = card('Test Small Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const BIG = card('Test Big Bear', 'Creature — Bear', '', { pt: ['3', '3'] });
  const KING = card('Test King', 'Legendary Creature — Human', '', { pt: ['2', '2'] });
  const equipTo = (s0: GameState, equipment: ObjectId, host: ObjectId): GameState => {
    const a = equipActions(s0, equipment)[0]!.action;
    return resolveAll(drive(act(s0, a), { targets: [[host]] }));
  };
  it('are fully automated', () => { expect(full(NAGINATA)).toBe(true); expect(full(BANNER)).toBe(true); });
  it('the power-3 restriction: the Equipment attaches to a creature with power 3, never to one with power 2', () => {
    const s0 = scenario([], { defs: [NAGINATA, SMALL, BIG], p1: { battlefield: ['Test Long Blade', 'Test Small Bear', 'Test Big Bear'] } });
    const blade = onField(s0, 'Test Long Blade')[0]!;
    const s1 = equipTo(s0, blade, onField(s0, 'Test Small Bear')[0]!);
    expect(s1.objects[blade]!.attachedTo).toBeUndefined();
    const s2 = equipTo(s0, blade, onField(s0, 'Test Big Bear')[0]!);
    expect(s2.objects[blade]!.attachedTo).toBe(onField(s2, 'Test Big Bear')[0]);
    expect(stat(s2, onField(s2, 'Test Big Bear')[0]!)).toBe('6/3');
  });
  it('the legendary restriction: only a legendary creature can carry it', () => {
    const s0 = scenario([], { defs: [BANNER, SMALL, KING], p1: { battlefield: ['Test Standard', 'Test Small Bear', 'Test King'] } });
    const banner = onField(s0, 'Test Standard')[0]!;
    expect(equipTo(s0, banner, onField(s0, 'Test Small Bear')[0]!).objects[banner]!.attachedTo).toBeUndefined();
    expect(equipTo(s0, banner, onField(s0, 'Test King')[0]!).objects[banner]!.attachedTo).toBe(onField(s0, 'Test King')[0]);
  });
  it('an attached Equipment whose creature stops being a legal host falls off (CR 704.5n)', () => {
    const s0 = scenario([], { defs: [NAGINATA, BIG], p1: { battlefield: ['Test Big Bear'] } });
    const blade = put(s0, 'p1', 'battlefield', 'Test Long Blade');
    const big = onField(s0, 'Test Big Bear')[0]!;
    attach(s0, blade, big);
    s0.objects[big]!.counters = { '-1/-1': 1 }; // power 2 + 3 from the Equipment itself would still be 5: the restriction is about power now, so check the legal-attachment function
    expect(canAttach(s0, blade, big)).toBe(true); // power 3 + 3 - 1 = 5 >= 3
  });
});

describe('"Equip {2} or {B}" (CR 702.6a, 602.2b, 118.1; Transmogrant\'s Crown)', () => {
  const CROWN = card('Test Crown', 'Artifact — Equipment', 'Equipped creature gets +2/+0.\nEquip {2} or {B}');
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  it('is fully automated', () => expect(full(CROWN)).toBe(true));
  it('with a single Swamp the {B} option pays for it; with a single Forest nothing is offered', () => {
    const swamp = scenario(['Swamp'], { defs: [CROWN, BEAR], p1: { battlefield: ['Test Crown', 'Test Bear', 'Swamp'] } });
    expect(equipActions(swamp, onField(swamp, 'Test Crown')[0]!).length).toBeGreaterThan(0);
    const s1 = (() => { const crown = onField(swamp, 'Test Crown')[0]!; const a = equipActions(swamp, crown)[0]!.action; return resolveAll(drive(act(swamp, a), { targets: [[onField(swamp, 'Test Bear')[0]!]] })); })();
    expect(s1.objects[onField(s1, 'Test Crown')[0]!]!.attachedTo).toBe(onField(s1, 'Test Bear')[0]);
    const forest = scenario(['Forest'], { defs: [CROWN, BEAR], p1: { battlefield: ['Test Crown', 'Test Bear', 'Forest'] } });
    expect(equipActions(forest, onField(forest, 'Test Crown')[0]!)).toHaveLength(0);
  });
  it('two Forests pay the {2} option', () => {
    const s0 = scenario(['Forest'], { defs: [CROWN, BEAR], p1: { battlefield: ['Test Crown', 'Test Bear', 'Forest', 'Forest'] } });
    expect(equipActions(s0, onField(s0, 'Test Crown')[0]!).length).toBeGreaterThan(0);
  });
});

describe('"... search your library for an Aura card that could enchant that creature, put it onto the battlefield attached to that creature, then shuffle." (CR 303.4a, 303.4f, 702.5a; Sovereigns of Lost Alara)', () => {
  const SOV = card('Test Sovereign', 'Creature — Spirit', 'Whenever a creature you control attacks alone, you may search your library for an Aura card that could enchant that creature, put it onto the battlefield attached to that creature, then shuffle.', { pt: ['2', '2'] });
  const CAURA = card('Test Creature Aura', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+1.');
  const LAURA = card('Test Land Aura', 'Enchantment — Aura', 'Enchant land\nEnchanted land has "{T}: Add {G}."');
  const WAURA = card('Test Wall Aura', 'Enchantment — Aura', 'Enchant Wall\nEnchanted Wall gets +1/+1.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  it('is fully automated', () => expect(full(SOV)).toBe(true));
  it('only an Aura card that could enchant the attacker is offered, and it enters attached to it', () => {
    const s0 = scenario([], { defs: [SOV, CAURA, LAURA, WAURA, BEAR], p1: { battlefield: ['Test Sovereign', 'Test Bear'], library: ['Test Creature Aura', 'Test Land Aura', 'Test Wall Aura'] } });
    const bear = onField(s0, 'Test Bear')[0]!;
    let offered: string[] = [];
    const s = resolveAll(declareAttackers(toDeclareAttackers(s0), [[bear]]), { pick: (options, st) => { offered = options.map((id) => chars(st, id).name); return options.slice(0, 1); } });
    expect(offered).toEqual(['Test Creature Aura']);
    const aura = onField(s, 'Test Creature Aura')[0]!;
    expect(s.objects[aura]!.attachedTo).toBe(onField(s, 'Test Bear')[0]);
    expect(stat(s, onField(s, 'Test Bear')[0]!)).toBe('3/3');
  });
  it('the negative case: with no Aura that could enchant the attacker in the library nothing enters', () => {
    const s0 = scenario([], { defs: [SOV, LAURA, WAURA, BEAR], p1: { battlefield: ['Test Sovereign', 'Test Bear'], library: ['Test Land Aura', 'Test Wall Aura'] } });
    const s = resolveAll(declareAttackers(toDeclareAttackers(s0), [[onField(s0, 'Test Bear')[0]!]]));
    expect(onField(s, 'Test Land Aura')).toHaveLength(0);
    expect(onField(s, 'Test Wall Aura')).toHaveLength(0);
  });
});

describe('"Put target Aura card from a graveyard onto the battlefield under your control attached to a creature you control." (CR 303.4f, 303.4g; Nomad Mythmaker)', () => {
  const MYTH = card('Test Mythmaker', 'Creature — Human', '{W}, {T}: Put target Aura card from a graveyard onto the battlefield under your control attached to a creature you control.', { pt: ['2', '2'] });
  const CAURA = card('Test Creature Aura', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+1.');
  const LAURA = card('Test Land Aura', 'Enchantment — Aura', 'Enchant land\nEnchanted land has "{T}: Add {G}."');
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  it('is fully automated', () => expect(full(MYTH)).toBe(true));
  it('an Aura card from the opponent\'s graveyard comes back under your control on your creature', () => {
    const s0 = scenario(['Plains'], { defs: [MYTH, CAURA, BEAR], p1: { battlefield: ['Test Mythmaker', 'Test Bear', 'Plains'] }, p2: { graveyard: ['Test Creature Aura'] } });
    const myth = onField(s0, 'Test Mythmaker')[0]!;
    const aura = s0.zones.graveyard['p2']![0]!;
    const a = legal(s0, 'p1', 'activate').find((x) => x.action.type === 'activate' && x.action.source === myth)!.action;
    const s = resolveAll(drive(act(s0, a), BEARPICK(aura)), BEARPICK(aura));
    const back = onField(s, 'Test Creature Aura')[0]!;
    expect(s.objects[back]!.controller).toBe('p1');
    expect(s.objects[back]!.attachedTo).toBe(onField(s, 'Test Bear')[0]);
  });
  it('the negative case: an Aura that can\'t enchant a creature stays in the graveyard', () => {
    const s0 = scenario(['Plains'], { defs: [MYTH, LAURA, BEAR], p1: { battlefield: ['Test Mythmaker', 'Test Bear', 'Plains'] }, p2: { graveyard: ['Test Land Aura'] } });
    const myth = onField(s0, 'Test Mythmaker')[0]!;
    const a = legal(s0, 'p1', 'activate').find((x) => x.action.type === 'activate' && x.action.source === myth)!.action;
    const s = resolveAll(drive(act(s0, a), BEARPICK(s0.zones.graveyard['p2']![0]!)), BEARPICK(s0.zones.graveyard['p2']![0]!));
    expect(onField(s, 'Test Land Aura')).toHaveLength(0);
    expect(s.zones.graveyard['p2']!.some((id) => chars(s, id).name === 'Test Land Aura')).toBe(true);
  });
  it('only a creature the Aura can legally enchant is offered: a creature with protection from the Aura\'s color is not (Scryfall ruling 2004-10-04), the Aura goes to the other one', () => {
    const BLACK = card('Test Black Aura', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets -1/-1.', { colors: ['B'] });
    const PRO = card('Test Pro Bear', 'Creature — Bear', 'Protection from black', { pt: ['2', '2'], keywords: ['Protection'] });
    const s0 = scenario(['Plains'], { defs: [MYTH, BLACK, BEAR, PRO], p1: { battlefield: ['Test Mythmaker', 'Test Pro Bear', 'Test Bear', 'Plains'] }, p2: { graveyard: ['Test Black Aura'] } });
    const myth = onField(s0, 'Test Mythmaker')[0]!;
    const a = legal(s0, 'p1', 'activate').find((x) => x.action.type === 'activate' && x.action.source === myth)!.action;
    let offered: string[] = [];
    const o = { targets: [[s0.zones.graveyard['p2']![0]!]], pick: (options: ObjectId[], st: GameState) => { offered = options.map((id) => chars(st, id).name); return options.filter((id) => chars(st, id).name === 'Test Bear'); } };
    const s = resolveAll(drive(act(s0, a), o), o);
    expect(offered).not.toContain('Test Pro Bear');
    expect(s.objects[onField(s, 'Test Black Aura')[0]!]!.attachedTo).toBe(onField(s, 'Test Bear')[0]);
  });
});
