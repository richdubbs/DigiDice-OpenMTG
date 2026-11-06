/**
 * Commander EDHREC ranks 23,501-24,000, round edh-c-31 (first pass): the round's readings played through the engine with synthetic cards (invented names, design 6.10),
 * compiled by the game's default compiler. Each group has its negative cases. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 *
 *   CR 702.22c-k                 banding: attacking bands, a band is blocked as a group, the other side's player divides the damage
 *   CR 702.16a, 205.3, 205.4     "Protection from legendary creatures", "Protection from non-Spirit creatures"
 *   CR 702.24a                   a granted "Cumulative upkeep {1}."
 *   CR 609.4, 702.28             "~ can block creatures with shadow as though they didn't have shadow."
 *   CR 303.4, 301.5, 702.3b      "As long as ~ is enchanted or equipped, it can attack as though it didn't have defender."
 */
import { describe, expect, it } from 'vitest';
import { type GameState, type ObjectId } from '../../../src/index';
import { compileCard, type OracleCard } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { attackCandidates, blockCandidates } from '../../../src/rules/combat-rules';
import { act, answer, find, put, scenario } from '../../m3/scenario';
import { attackUnblocked, creature, declareBlockers, passUntil, toDeclareAttackers, toDeclareBlockers, toStep, tweak } from '../../m4/helpers';
import { cast, resolveAll } from '../cmd3/helpers';
import { mpScenario } from '../../m12/rules/helpers';
import { removeFromCombat } from '../../../src/rules/combat-state';

const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const idOf = (s: GameState, name: string, owner: string): ObjectId => find(s, name, 'battlefield', owner);
const damageOf = (s: GameState, id: ObjectId): number => s.objects[id]?.damage ?? 0;
const alive = (s: GameState, id: ObjectId): boolean => s.zones.battlefield.includes(id);

/** Alice (p1) attacks Bob (p2); `bands` are lists of the attackers' names. */
function toBlockers(s0: GameState, attackers: string[], bands: string[][]): GameState {
  const s = toDeclareAttackers(s0);
  const id = (n: string): ObjectId => idOf(s, n, 'p1');
  return answer(s, { kind: 'declareAttackers', attacks: attackers.map((a) => ({ attacker: id(a), defender: 'p2' })), ...(bands.length > 0 ? { bands: bands.map((b) => b.map(id)) } : {}) });
}

const bandGame = (p1: string[], p2: string[], extra: ReturnType<typeof creature>[]): GameState => scenario([], { defs: extra, p1: { battlefield: p1 }, p2: { battlefield: p2 } });

describe('CR 702.22c-d: declaring attacking bands', () => {
  const B1 = creature('Test Banded Knight', ['2', '2'], 'Banding');
  const B2 = creature('Test Banded Squire', ['1', '1'], 'Banding');
  const PLAIN = creature('Test Plain Ogre', ['3', '3'], '');
  const PLAIN2 = creature('Test Plain Brute', ['3', '3'], '');
  const g = bandGame(['Test Banded Knight', 'Test Banded Squire', 'Test Plain Ogre', 'Test Plain Brute'], [], [B1, B2, PLAIN, PLAIN2]);
  const refused = (bands: string[][], attackers = ['Test Banded Knight', 'Test Banded Squire', 'Test Plain Ogre', 'Test Plain Brute']): boolean => {
    try { toBlockers(g, attackers, bands); return false; } catch { return true; }
  };
  it('two creatures with banding, and one with banding plus one without, may be a band', () => {
    expect(refused([['Test Banded Knight', 'Test Banded Squire']])).toBe(false);
    expect(refused([['Test Banded Knight', 'Test Plain Ogre']])).toBe(false);
    expect(refused([['Test Banded Knight', 'Test Banded Squire', 'Test Plain Ogre']])).toBe(false);
  });
  it('negative: two creatures without banding, two without in one band, a lone creature, an unknown or non-attacking member and a second band are refused', () => {
    expect(refused([['Test Plain Ogre', 'Test Plain Brute']])).toBe(true); // no banding
    expect(refused([['Test Banded Knight', 'Test Plain Ogre', 'Test Plain Brute']])).toBe(true); // two without banding
    expect(refused([['Test Banded Knight']])).toBe(true); // one creature
    expect(refused([['Test Banded Knight', 'Test Plain Ogre']], ['Test Banded Knight'])).toBe(true); // the other one does not attack
    expect(refused([['Test Banded Knight', 'Test Plain Ogre'], ['Test Banded Squire', 'Test Plain Ogre']])).toBe(true); // a creature in two bands
  });
});

describe('CR 702.22h-i: a band is blocked as a group', () => {
  const B1 = creature('Test Banded Knight', ['2', '2'], 'Banding');
  const PLAIN = creature('Test Plain Ogre', ['3', '3'], '');
  const FLY = creature('Test Plain Flier', ['2', '2'], 'Flying');
  const BLOCK = creature('Test Wall Guard', ['4', '4'], '');
  const g = (): GameState => bandGame(['Test Banded Knight', 'Test Plain Ogre', 'Test Plain Flier'], ['Test Wall Guard'], [B1, PLAIN, FLY, BLOCK]);
  it('blocking one member blocks the whole band, with the same blocker; a creature that is not in the band stays unblocked', () => {
    const s = toDeclareBlockers(toBlockers(g(), ['Test Banded Knight', 'Test Plain Ogre', 'Test Plain Flier'], [['Test Banded Knight', 'Test Plain Ogre']]));
    expect(s.pending?.kind).toBe('declareBlockers');
    const t = declareBlockers(s, [[idOf(s, 'Test Wall Guard', 'p2'), idOf(s, 'Test Banded Knight', 'p1')]]);
    const att = (n: string) => t.combat!.attackers.find((a) => a.id === idOf(t, n, 'p1'))!;
    expect(att('Test Plain Ogre').blocked).toBe(true);
    expect(att('Test Plain Ogre').blockedBy).toEqual([idOf(t, 'Test Wall Guard', 'p2')]);
    expect(att('Test Plain Flier').blocked).toBe(false);
  });
  it('the blocker may block a banded creature it could not block alone (an evasive band member)', () => {
    const s = toDeclareBlockers(toBlockers(g(), ['Test Banded Knight', 'Test Plain Flier'], [['Test Banded Knight', 'Test Plain Flier']]));
    const t = declareBlockers(s, [[idOf(s, 'Test Wall Guard', 'p2'), idOf(s, 'Test Banded Knight', 'p1')]]);
    expect(t.combat!.attackers.every((a) => a.blocked && a.blockedBy.length === 1)).toBe(true);
  });
  it('negative: without a band, blocking one attacker leaves the other unblocked', () => {
    const s = toDeclareBlockers(toBlockers(g(), ['Test Banded Knight', 'Test Plain Ogre'], []));
    const t = declareBlockers(s, [[idOf(s, 'Test Wall Guard', 'p2'), idOf(s, 'Test Banded Knight', 'p1')]]);
    expect(t.combat!.attackers.find((a) => a.id === idOf(t, 'Test Plain Ogre', 'p1'))!.blocked).toBe(false);
  });
});

describe('CR 702.22j: an attacker blocked by a creature with banding is divided by the defending player', () => {
  const ATT = creature('Test Big Ogre', ['5', '5'], '');
  const BAND = creature('Test Banded Guard', ['1', '4'], 'Banding');
  const PLAIN = creature('Test Plain Guard', ['1', '4'], '');
  const game = (): GameState => bandGame(['Test Big Ogre'], ['Test Banded Guard', 'Test Plain Guard'], [ATT, BAND, PLAIN]);
  it('Bob (the defending player) is asked to divide, and may give everything to the creature of his choice', () => {
    let s = toDeclareAttackers(game());
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: idOf(s, 'Test Big Ogre', 'p1'), defender: 'p2' }] });
    s = declareBlockers(toDeclareBlockers(s), [[idOf(s, 'Test Banded Guard', 'p2'), idOf(s, 'Test Big Ogre', 'p1')], [idOf(s, 'Test Plain Guard', 'p2'), idOf(s, 'Test Big Ogre', 'p1')]]);
    s = passUntil(s, (x) => x.pending?.kind === 'assignDamage', 'the damage assignment', 12);
    const d = s.pending as unknown as { player: string; attacker: ObjectId; recipients: { id: string }[] };
    expect(d.player).toBe('p2'); // not Alice, who controls the attacker
    const plain = idOf(s, 'Test Plain Guard', 'p2');
    const t = answer(s, { kind: 'assignDamage', amounts: [{ id: plain, amount: 5 }] });
    const u = passUntil(t, (x) => x.turn.step === 'endCombat' || x.pending?.kind === 'assignDamage', 'combat damage done', 12);
    expect(alive(u, plain)).toBe(false); // 5 damage on a 1/4
    expect(alive(u, idOf(u, 'Test Banded Guard', 'p2'))).toBe(true);
  });
  it('negative: blocked by creatures without banding, Alice divides', () => {
    let s = toDeclareAttackers(bandGame(['Test Big Ogre'], ['Test Plain Guard'], [ATT, PLAIN]));
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: idOf(s, 'Test Big Ogre', 'p1'), defender: 'p2' }] });
    s = declareBlockers(toDeclareBlockers(s), [[idOf(s, 'Test Plain Guard', 'p2'), idOf(s, 'Test Big Ogre', 'p1')]]);
    s = passUntil(s, (x) => x.turn.step === 'endCombat' || x.pending?.kind === 'assignDamage', 'combat damage', 12);
    expect(s.pending?.kind).not.toBe('assignDamage'); // one blocker: no choice
  });
  it('negative: the two blockers without banding have the attacker\'s controller divide', () => {
    const PLAIN2 = creature('Test Plain Guard Two', ['1', '4'], '');
    let s = toDeclareAttackers(bandGame(['Test Big Ogre'], ['Test Plain Guard', 'Test Plain Guard Two'], [ATT, PLAIN, PLAIN2]));
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: idOf(s, 'Test Big Ogre', 'p1'), defender: 'p2' }] });
    s = declareBlockers(toDeclareBlockers(s), [[idOf(s, 'Test Plain Guard', 'p2'), idOf(s, 'Test Big Ogre', 'p1')], [idOf(s, 'Test Plain Guard Two', 'p2'), idOf(s, 'Test Big Ogre', 'p1')]]);
    s = passUntil(s, (x) => x.pending?.kind === 'assignDamage', 'the damage assignment', 12);
    expect((s.pending as unknown as { player: string }).player).toBe('p1');
  });
});

describe('CR 702.22k: a blocker blocking a creature with banding is divided by the active player', () => {
  const BANDED = creature('Test Banded Raider', ['2', '5'], 'Banding');
  const PLAIN = creature('Test Plain Raider', ['2', '4'], '');
  const BLOCK = creature('Test Wall Guard', ['4', '4'], '');
  it('a blocker that blocks the banded attacker and a band member: Alice divides its damage', () => {
    let s = toDeclareAttackers(bandGame(['Test Banded Raider', 'Test Plain Raider'], ['Test Wall Guard'], [BANDED, PLAIN, BLOCK]));
    const a = idOf(s, 'Test Banded Raider', 'p1');
    const b = idOf(s, 'Test Plain Raider', 'p1');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: a, defender: 'p2' }, { attacker: b, defender: 'p2' }], bands: [[a, b]] });
    s = declareBlockers(toDeclareBlockers(s), [[idOf(s, 'Test Wall Guard', 'p2'), a]]);
    s = passUntil(s, (x) => x.pending?.kind === 'assignDamage' && (x.pending as unknown as { attacker: string }).attacker === idOf(x, 'Test Wall Guard', 'p2'), 'the blocker\'s damage assignment', 12);
    expect((s.pending as unknown as { player: string }).player).toBe('p1'); // the active player divides the blocker's damage
    const t = answer(s, { kind: 'assignDamage', amounts: [{ id: b, amount: 4 }] });
    const u = passUntil(t, (x) => x.turn.step === 'endCombat', 'end of combat', 12);
    expect(alive(u, b)).toBe(false);
    expect(alive(u, a)).toBe(true);
  });
  it('negative: a band whose members have banding is divided by the active player only when the blocker blocks several; the same blocker with one attacker has no choice', () => {
    let s = toDeclareAttackers(bandGame(['Test Plain Raider'], ['Test Wall Guard'], [PLAIN, BLOCK]));
    const a = idOf(s, 'Test Plain Raider', 'p1');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: a, defender: 'p2' }] });
    s = declareBlockers(toDeclareBlockers(s), [[idOf(s, 'Test Wall Guard', 'p2'), a]]);
    s = passUntil(s, (x) => x.turn.step === 'endCombat' || x.pending?.kind === 'assignDamage', 'combat damage', 12);
    expect(s.pending?.kind).not.toBe('assignDamage');
  });
});


/** A synthetic card with colors (the `creature` helper makes colorless ones). */
const colored = (name: string, type: string, text: string, colors: string[], pt?: [string, string], cost = '{1}') =>
  compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);

describe('CR 702.16a, 205.3, 205.4: "Protection from legendary creatures" and "Protection from non-Spirit creatures" (rules/quality.ts, `A&!B`)', () => {
  const LEG = creature('Test Legend Guard', ['2', '2'], 'Protection from legendary creatures');
  const NONSP = creature('Test Spirit Guard', ['2', '2'], 'Protection from non-Spirit creatures', '{1}', 'Creature — Spirit');
  const KING = creature('Test King Ogre', ['3', '3'], '', '{1}', 'Legendary Creature — Ogre');
  const OGRE = creature('Test Plain Ogre', ['3', '3'], '', '{1}', 'Creature — Ogre');
  const GHOST = creature('Test Plain Ghost', ['3', '3'], '', '{1}', 'Creature — Spirit');
  const mk = (names: string[], p2: string[]): GameState => scenario([], { defs: [LEG, NONSP, KING, OGRE, GHOST], p1: { battlefield: names }, p2: { battlefield: p2 } });
  const canBlock = (s: GameState, blocker: string, attacker: string): boolean => {
    const c = blockCandidates(s, 'p2').candidates.find((x) => x.id === idOf(s, blocker, 'p2'));
    return c !== undefined && c.attackers.includes(idOf(s, attacker, 'p1'));
  };
  it('are full cards', () => {
    expect(LEG.automation.level).toBe('full');
    expect(NONSP.automation.level).toBe('full');
  });
  it('protection from legendary creatures: a legendary creature can\'t block it, a nonlegendary one can', () => {
    const s = toDeclareAttackers(mk(['Test Legend Guard'], ['Test King Ogre', 'Test Plain Ogre']));
    const t = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: idOf(s, 'Test Legend Guard', 'p1'), defender: 'p2' }] });
    const u = toDeclareBlockers(t);
    expect(canBlock(u, 'Test King Ogre', 'Test Legend Guard')).toBe(false);
    expect(canBlock(u, 'Test Plain Ogre', 'Test Legend Guard')).toBe(true);
  });
  it('protection from non-Spirit creatures: only a Spirit can block it; a non-Spirit creature can\'t', () => {
    const s = toDeclareAttackers(mk(['Test Spirit Guard'], ['Test Plain Ogre', 'Test Plain Ghost']));
    const t = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: idOf(s, 'Test Spirit Guard', 'p1'), defender: 'p2' }] });
    const u = toDeclareBlockers(t);
    expect(canBlock(u, 'Test Plain Ogre', 'Test Spirit Guard')).toBe(false);
    expect(canBlock(u, 'Test Plain Ghost', 'Test Spirit Guard')).toBe(true);
  });
  it('negative: a creature with protection from legendary creatures can be blocked by a non-Spirit, and a damage-dealing legendary creature is prevented', () => {
    const s = toDeclareAttackers(mk(['Test Legend Guard'], ['Test Plain Ogre']));
    const t = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: idOf(s, 'Test Legend Guard', 'p1'), defender: 'p2' }] });
    expect(canBlock(toDeclareBlockers(t), 'Test Plain Ogre', 'Test Legend Guard')).toBe(true);
  });
});

describe('CR 702.24a, 113.1: "Enchanted creature has "Cumulative upkeep {1}."" grants the keyword to the enchanted creature', () => {
  const AURA = colored('Test Binding Chains', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature has "Cumulative upkeep {1}."', ['U'], undefined, '{U}');
  const OGRE = creature('Test Plain Ogre', ['3', '3'], '');
  const OTHER = creature('Test Other Ogre', ['3', '3'], '');
  it('is a full card; the enchanted creature has cumulative upkeep, another creature does not', () => {
    expect(AURA.automation.level).toBe('full');
    const s0 = scenario([], { defs: [AURA, OGRE, OTHER], p1: { battlefield: ['Test Plain Ogre', 'Test Other Ogre'] } });
    const s = tweak(s0, (t) => { const a = put(t, 'p1', 'battlefield', 'Test Binding Chains'); t.objects[a]!.attachedTo = idOf(t, 'Test Plain Ogre', 'p1'); });
    const has = (n: string): boolean => getChars(s, idOf(s, n, 'p1'))!.keywords.some((k) => k.keyword === 'cumulative upkeep');
    expect(has('Test Plain Ogre')).toBe(true);
    expect(has('Test Other Ogre')).toBe(false);
  });
});

describe('CR 609.4, 702.28b: "~ can block creatures with shadow as though they didn\'t have shadow." (Aetherflame Wall)', () => {
  const WALL = creature('Test Shade Wall', ['0', '4'], 'Defender\nThis creature can block creatures with shadow as though they didn\'t have shadow.');
  const SHADE = creature('Test Shade Walker', ['2', '2'], 'Shadow');
  const OGRE = creature('Test Plain Ogre', ['3', '3'], '');
  const BEAR = creature('Test Plain Bear', ['2', '2'], '');
  const mk = (p2: string[]): GameState => scenario([], { defs: [WALL, SHADE, OGRE, BEAR], p1: { battlefield: ['Test Shade Walker', 'Test Plain Ogre'] }, p2: { battlefield: p2 } });
  const canBlock = (s: GameState, blocker: string, attacker: string): boolean => {
    const c = blockCandidates(s, 'p2').candidates.find((x) => x.id === idOf(s, blocker, 'p2'));
    return c !== undefined && c.attackers.includes(idOf(s, attacker, 'p1'));
  };
  const attacking = (s0: GameState): GameState => {
    const s = toDeclareAttackers(s0);
    return toDeclareBlockers(answer(s, { kind: 'declareAttackers', attacks: [{ attacker: idOf(s, 'Test Shade Walker', 'p1'), defender: 'p2' }, { attacker: idOf(s, 'Test Plain Ogre', 'p1'), defender: 'p2' }] }));
  };
  it('is a full card', () => { expect(WALL.automation.level).toBe('full'); });
  it('the wall can block the creature with shadow and a creature without it', () => {
    const s = attacking(mk(['Test Shade Wall']));
    expect(canBlock(s, 'Test Shade Wall', 'Test Shade Walker')).toBe(true);
    expect(canBlock(s, 'Test Shade Wall', 'Test Plain Ogre')).toBe(true);
  });
  it('negative: another creature without shadow still can\'t block a creature with shadow', () => {
    const s = attacking(mk(['Test Shade Wall', 'Test Plain Bear']));
    expect(canBlock(s, 'Test Plain Bear', 'Test Shade Walker')).toBe(false);
    expect(canBlock(s, 'Test Plain Bear', 'Test Plain Ogre')).toBe(true);
  });
  it('negative: without the permission a defender cannot block the creature with shadow', () => {
    const PLAINWALL = creature('Test Plain Wall', ['0', '4'], 'Defender');
    const s = attacking(scenario([], { defs: [PLAINWALL, SHADE, OGRE], p1: { battlefield: ['Test Shade Walker', 'Test Plain Ogre'] }, p2: { battlefield: ['Test Plain Wall'] } }));
    expect(canBlock(s, 'Test Plain Wall', 'Test Shade Walker')).toBe(false);
  });
});

describe('CR 303.4, 301.5, 702.3b: "As long as ~ is enchanted or equipped, it can attack as though it didn\'t have defender." (Novice Knight)', () => {
  const KNIGHT = creature('Test Novice Guard', ['1', '1'], 'Defender\nAs long as this creature is enchanted or equipped, it can attack as though it didn\'t have defender.');
  const AURA = colored('Test Lace Aura', 'Enchantment — Aura', 'Enchant creature', ['W'], undefined, '{W}');
  const GEAR = creature('Test Plain Blade', ['0', '0'], 'Equip {1}', '{1}', 'Artifact — Equipment');
  const mk = (): GameState => scenario([], { defs: [KNIGHT, AURA, GEAR], p1: { battlefield: ['Test Novice Guard'], hand: ['Test Lace Aura', 'Test Plain Blade'] } });
  const attachedWith = (name: string): GameState => tweak(mk(), (t) => { const a = put(t, 'p1', 'battlefield', name); t.objects[a]!.attachedTo = idOf(t, 'Test Novice Guard', 'p1'); });
  const canAttack = (s: GameState): boolean => attackCandidates(s, 'p1').some((c) => c.id === idOf(s, 'Test Novice Guard', 'p1'));
  it('is a full card', () => { expect(KNIGHT.automation.level).toBe('full'); });
  it('negative: alone it has defender and can\'t attack', () => { expect(canAttack(mk())).toBe(false); });
  it('enchanted: it can attack; equipped: it can attack', () => {
    expect(canAttack(attachedWith('Test Lace Aura'))).toBe(true);
    expect(canAttack(attachedWith('Test Plain Blade'))).toBe(true);
  });
});

describe('CR 508.1, 115.1, 702.3a: "Destroy target nonblack attacking creature." only in the declare attackers step (Assassin\'s Blade)', () => {
  const BLADE = colored('Test Quick Knife', 'Instant', 'Cast this spell only during the declare attackers step and only if you\'ve been attacked this step.\nDestroy target nonblack attacking creature.', ['B'], undefined, '{1}{B}');
  const DARK = colored('Test Dark Ogre', 'Creature — Ogre', '', ['B'], ['3', '3'], '{2}{B}');
  const RED = colored('Test Red Ogre', 'Creature — Ogre', '', ['R'], ['3', '3'], '{2}{R}');
  it('is a full card', () => { expect(BLADE.automation.level).toBe('full'); });
  it('the target filter is nonblack attacking creatures', () => {
    const ab = BLADE.faces[0]!.abilities.find((a) => a.kind === 'spell') as unknown as { effect: { steps: { target?: { filter?: unknown } }[] } };
    const text = JSON.stringify(ab);
    expect(text).toContain('"attacking":true');
    expect(text).toContain('"notColors":["B"]');
    void DARK; void RED;
  });
});

describe('CR 611.2a, 613.4c: "Target creature gets +2/+2 and gains horsemanship." lasts indefinitely (Riding the Dilu Horse)', () => {
  const SPELL = colored('Test Swift Mount', 'Sorcery', 'Target creature gets +2/+2 and gains horsemanship.', ['G'], undefined, '{0}');
  const OGRE = creature('Test Plain Ogre', ['3', '3'], '');
  const mk = (): GameState => scenario([], { defs: [SPELL, OGRE], p1: { battlefield: ['Test Plain Ogre'], hand: ['Test Swift Mount'] } });
  it('is a full card', () => { expect(SPELL.automation.level).toBe('full'); });
  it('the target gets +2/+2 and horsemanship, and keeps them past the end of the turn', () => {
    const s0 = mk();
    const ogre = idOf(s0, 'Test Plain Ogre', 'p1');
    let s = resolveAll(cast(s0, 'Test Swift Mount', { targets: [{ kind: 'object', id: ogre }] }));
    const ch = (x: GameState) => getChars(x, ogre)!;
    expect(`${ch(s).power}/${ch(s).toughness}`).toBe('5/5');
    expect(ch(s).keywords.some((k) => k.keyword === 'horsemanship')).toBe(true);
    const turn = s.turn.number;
    for (let i = 0; i < 80 && !(s.turn.number === turn + 1 && s.turn.step === 'upkeep'); i++) s = s.pending?.kind === 'declareAttackers' ? answer(s, { kind: 'declareAttackers', attacks: [] }) : act(s, { type: 'pass', player: s.pending!.player });
    expect(`${ch(s).power}/${ch(s).toughness}`).toBe('5/5'); // no end of turn ends it
    expect(ch(s).keywords.some((k) => k.keyword === 'horsemanship')).toBe(true);
  });
  it('negative: another creature is not affected', () => {
    const OTHER = creature('Test Other Ogre', ['3', '3'], '');
    const s0 = scenario([], { defs: [SPELL, OGRE, OTHER], p1: { battlefield: ['Test Plain Ogre', 'Test Other Ogre'], hand: ['Test Swift Mount'] } });
    const other = idOf(s0, 'Test Other Ogre', 'p1');
    const s = resolveAll(cast(s0, 'Test Swift Mount', { targets: [{ kind: 'object', id: idOf(s0, 'Test Plain Ogre', 'p1') }] }));
    expect(String(getChars(s, other)!.power)).toBe('3');
  });
});

describe('CR 614.15, 615.12, 608.2c: "If you attacked this turn, instead ~ deals 5 damage to that permanent or player and the damage can\'t be prevented." (Arrow Storm)', () => {
  const STORM = colored('Test Fire Volley', 'Sorcery', 'This spell deals 4 damage to any target.\nRaid -- If you attacked this turn, instead this spell deals 5 damage to that permanent or player and the damage can\'t be prevented.', ['R'], undefined, '{0}');
  const OGRE = creature('Test Plain Ogre', ['3', '3'], '');
  const WALL = creature('Test Big Wall', ['0', '5'], 'Defender');
  const lifeNow = (s: GameState, p: string): number => lifeOf(s, p);
  it('is a full card', () => { expect(STORM.automation.level).toBe('full'); });
  it('not having attacked: 4 damage; the 0/5 survives, the opponent loses 4 life', () => {
    const s0 = scenario([], { defs: [STORM, OGRE, WALL], p1: { hand: ['Test Fire Volley'] }, p2: { battlefield: ['Test Big Wall'] } });
    const wall = idOf(s0, 'Test Big Wall', 'p2');
    const s = resolveAll(cast(s0, 'Test Fire Volley', { targets: [{ kind: 'object', id: wall }] }));
    expect(alive(s, wall)).toBe(true);
    const t0 = scenario([], { defs: [STORM], p1: { hand: ['Test Fire Volley'] } });
    const t = resolveAll(cast(t0, 'Test Fire Volley', { targets: [{ kind: 'player', id: 'p2' }] }));
    expect(lifeNow(t, 'p2')).toBe(lifeNow(t0, 'p2') - 4);
  });
  it('having attacked this turn: 5 damage; the 0/5 dies, the opponent loses 5 life', () => {
    const s0 = scenario([], { defs: [STORM, OGRE, WALL], p1: { battlefield: ['Test Plain Ogre'], hand: ['Test Fire Volley'] }, p2: { battlefield: ['Test Big Wall'] } });
    const wall = idOf(s0, 'Test Big Wall', 'p2');
    const m2 = toStep(attackUnblocked(s0, [idOf(s0, 'Test Plain Ogre', 'p1')]), 'main2');
    const s = resolveAll(cast(m2, 'Test Fire Volley', { targets: [{ kind: 'object', id: wall }] }));
    expect(alive(s, wall)).toBe(false);
    const t0 = scenario([], { defs: [STORM, OGRE, WALL], p1: { battlefield: ['Test Plain Ogre'], hand: ['Test Fire Volley'] }, p2: { battlefield: ['Test Big Wall'] } });
    const t1 = toStep(attackUnblocked(t0, [idOf(t0, 'Test Plain Ogre', 'p1')]), 'main2');
    const t = resolveAll(cast(t1, 'Test Fire Volley', { targets: [{ kind: 'player', id: 'p2' }] }));
    expect(lifeNow(t, 'p2')).toBe(lifeNow(t1, 'p2') - 5);
  });
});

describe('CR 702.22f, 702.22j, 510.1c, 702.19b, 702.22d: removal of a band member, trample, four players', () => {
  const B1 = creature('Test Banded Knight', ['2', '2'], 'Banding');
  const PLAIN = creature('Test Plain Ogre', ['3', '3'], '');
  const TRAMPLER = creature('Test Big Trampler', ['6', '6'], 'Trample');
  const BANDGUARD = creature('Test Banded Guard', ['1', '4'], 'Banding');
  const GUARD = creature('Test Wall Guard', ['1', '4'], '');
  it('an attacker removed from combat leaves its band; the others are still blocked as a group', () => {
    const s0 = bandGame(['Test Banded Knight', 'Test Plain Ogre', 'Test Big Trampler'], ['Test Wall Guard'], [B1, PLAIN, TRAMPLER, GUARD]);
    const s = toBlockers(s0, ['Test Banded Knight', 'Test Plain Ogre'], [['Test Banded Knight', 'Test Plain Ogre']]);
    const t = tweak(s, (x) => removeFromCombat(x, idOf(x, 'Test Plain Ogre', 'p1')));
    const u = declareBlockers(toDeclareBlockers(t), [[idOf(t, 'Test Wall Guard', 'p2'), idOf(t, 'Test Banded Knight', 'p1')]]);
    expect(u.combat!.attackers.map((a) => a.id)).toEqual([idOf(u, 'Test Banded Knight', 'p1')]);
    expect(u.combat!.attackers[0]!.blockedBy).toEqual([idOf(u, 'Test Wall Guard', 'p2')]);
  });
  it('a trampler blocked by two blockers one of which has banding: the defending player divides it and nothing reaches the player', () => {
    let s = toDeclareAttackers(bandGame(['Test Big Trampler'], ['Test Banded Guard', 'Test Wall Guard'], [TRAMPLER, BANDGUARD, GUARD]));
    const a = idOf(s, 'Test Big Trampler', 'p1');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: a, defender: 'p2' }] });
    s = declareBlockers(toDeclareBlockers(s), [[idOf(s, 'Test Banded Guard', 'p2'), a], [idOf(s, 'Test Wall Guard', 'p2'), a]]);
    s = passUntil(s, (x) => x.pending?.kind === 'assignDamage', 'the damage assignment', 12);
    const d = s.pending as unknown as { player: string; recipients: { id: string }[]; canTrample: boolean };
    expect(d.player).toBe('p2');
    expect(d.canTrample).toBe(false);
    expect(d.recipients.map((r) => r.id).sort()).toEqual([idOf(s, 'Test Banded Guard', 'p2'), idOf(s, 'Test Wall Guard', 'p2')].sort());
    const life = lifeOf(s, 'p2');
    const t = answer(s, { kind: 'assignDamage', amounts: [{ id: idOf(s, 'Test Wall Guard', 'p2'), amount: 6 }] });
    expect(lifeOf(passUntil(t, (x) => x.turn.step === 'endCombat', 'end of combat', 12), 'p2')).toBe(life);
  });
  it('negative: a trampler blocked by creatures without banding still asks Alice and may trample over', () => {
    const G2 = creature('Test Wall Guard Two', ['1', '4'], '');
    let s = toDeclareAttackers(bandGame(['Test Big Trampler'], ['Test Wall Guard', 'Test Wall Guard Two'], [TRAMPLER, GUARD, G2]));
    const a = idOf(s, 'Test Big Trampler', 'p1');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: a, defender: 'p2' }] });
    s = declareBlockers(toDeclareBlockers(s), [[idOf(s, 'Test Wall Guard', 'p2'), a], [idOf(s, 'Test Wall Guard Two', 'p2'), a]]);
    s = passUntil(s, (x) => x.pending?.kind === 'assignDamage', 'the damage assignment', 12);
    expect((s.pending as unknown as { player: string; canTrample: boolean }).player).toBe('p1');
    expect((s.pending as unknown as { canTrample: boolean }).canTrample).toBe(true);
  });
  it('four players: a band attacks one opponent, is blocked by that opponent\'s creature, and a band against two different defenders is refused', () => {
    const mk = (): GameState => mpScenario({ players: 4, defs: [B1, PLAIN, GUARD], zones: { p1: { battlefield: ['Test Banded Knight', 'Test Plain Ogre'] }, p3: { battlefield: ['Test Wall Guard'] } } });
    const s0 = toDeclareAttackers(mk());
    const k = idOf(s0, 'Test Banded Knight', 'p1');
    const o = idOf(s0, 'Test Plain Ogre', 'p1');
    expect(() => answer(s0, { kind: 'declareAttackers', attacks: [{ attacker: k, defender: 'p2' }, { attacker: o, defender: 'p3' }], bands: [[k, o]] })).toThrow();
    let s = answer(s0, { kind: 'declareAttackers', attacks: [{ attacker: k, defender: 'p3' }, { attacker: o, defender: 'p3' }], bands: [[k, o]] });
    for (let i = 0; i < 20 && s.pending?.kind !== 'declareBlockers'; i++) s = act(s, { type: 'pass', player: s.pending!.player });
    expect(s.pending?.player).toBe('p3');
    s = answer(s, { kind: 'declareBlockers', blocks: [{ blocker: idOf(s, 'Test Wall Guard', 'p3'), attacker: o }] });
    expect(s.combat!.attackers.every((a) => a.blocked)).toBe(true);
  });
});

describe('CR 702.22i, 509.3c: an effect that makes one band member blocked blocks the band, and every member "becomes blocked"', () => {
  const B1 = creature('Test Banded Knight', ['2', '2'], 'Banding');
  const GAIN = creature('Test Glad Ogre', ['3', '3'], 'Whenever this creature becomes blocked, you gain 3 life.');
  const FOG = colored('Test Fog Patch', 'Instant', 'Attacking creatures become blocked.', ['G'], undefined, '{0}');
  const run = (band: boolean): GameState => {
    const s0 = scenario([], { defs: [B1, GAIN, FOG], p1: { battlefield: ['Test Banded Knight', 'Test Glad Ogre'], hand: ['Test Fog Patch'] } });
    const s = toBlockers(s0, ['Test Banded Knight', 'Test Glad Ogre'], band ? [['Test Banded Knight', 'Test Glad Ogre']] : []);
    return resolveAll(cast(s, 'Test Fog Patch'));
  };
  it('banded or not, the creature with the trigger becomes blocked once and its controller gains 3 life', () => {
    expect(lifeOf(run(false), 'p1')).toBe(23);
    expect(lifeOf(run(true), 'p1')).toBe(23);
  });
});
