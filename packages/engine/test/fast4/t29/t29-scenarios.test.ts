/**
 * FAST4 T29: the shapes of parser/templates/zz-fast4/t29.json (and the renderer readings that let existing templates read their cards), played through the
 * engine with synthetic cards compiled by the game's default compiler (wordings are invented, design 6.10).
 *
 *   CR 611.3a, 109.4          a static count is live: "~ gets +1/+0 for each other artifact you control" (not itself, not the opponent's), the sum of
 *                             "for each Elf you control and each Elf card in your graveyard", "for each other enchantment on the battlefield"
 *   CR 604.3, 613.4a, 402.1   "~'s power and toughness are each equal to the total number of cards in all players' hands"
 *   CR 611.3a, 500.1          "~ has first strike during your turn" (not during the opponent's)
 *   CR 301.5, 611.3a          "As long as ~ is equipped, it gets +1/+1 and has flying" (an Aura does not equip it)
 *   CR 611.3a                 "As long as you control an artifact creature or a Wizard, ~ has indestructible"
 *   CR 109.4, 613.4c          two lord groups: "other" excludes the source only from its own group
 *   CR 613.1d, 613.1f, 702.21 the job Equipment: +P/+T, keywords (ward {1} with its cost) and a creature type in addition to the others
 *   CR 509.1b, 613.1f         "Equipped creature has shroud and can't be blocked"
 *   CR 205.4a                 "As long as equipped creature is legendary, it has hexproof"
 *   CR 608.2h, 611.2c         resolved pumps: X (or the count) is fixed as the effect begins, and a creature that arrives later is not affected
 *   CR 608.2h, 603.6a         "Whenever another creature you control enters, ~ gets +X/+0 until end of turn, where X is that creature's power"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { act, answer, find, legal, pass, put, scenario } from '../../m3/scenario';
import { declareAttackers, toDeclareAttackers, tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
/** Every ability of the card automated, and the card full (the T29 templates are stable). */
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const kw = (s: GameState, id: ObjectId, k: string): boolean => hasKeyword(getChars(s, id)!, k);

/** Answer the decisions that come up, pay costs automatically, choose `targets` when asked; stop at priority. */
function settle(s0: GameState, targets: TargetChoice[] = []): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 20; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else break;
  }
  return s;
}
/** Both players pass until the stack is empty. */
function resolveAll(s0: GameState): GameState {
  let s = s0;
  for (let guard = 0; s.zones.stack.length > 0 && guard < 30; guard++) s = settle(pass(s));
  return s;
}
const castWith = (s0: GameState, name: string, targets: TargetChoice[] = []): GameState => settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), targets);
function activate(s: GameState, name: string, targets: TargetChoice[] = []): GameState {
  const id = find(s, name, 'battlefield', 'p1');
  const la = legal(s, 'p1', 'activate').find((a) => a.object === id && !a.isMana);
  if (!la) throw new Error(`no activated ability of ${name}`);
  return settle(act(s, la.action), targets);
}
/** An Aura or Equipment of p1 put onto the battlefield attached to `to`. */
const attachNew = (s: GameState, name: string, to: ObjectId): GameState => tweak(s, (t) => { const id = put(t, 'p1', 'battlefield', name); t.objects[id]!.attachedTo = to; });
const ofPlayer = (s: GameState, name: string, player: string): ObjectId[] => s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === name && s.objects[id]!.controller === player);

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2'], '{1}{G}');
const ELF = card('Test Elf', 'Creature — Elf', '', ['1', '1'], '{G}');
const RELIC = card('Test Relic', 'Artifact', '', undefined, '{1}');
const GOLEM = card('Test Golem', 'Artifact Creature — Golem', '', ['2', '2'], '{2}');
const POLE = card('Test Pole', 'Artifact — Equipment', 'Equip {1}', undefined, '{1}');
const CHARM = card('Test Charm', 'Enchantment — Aura', 'Enchant creature', undefined, '{W}');
const SWAMP = card('Test Swamp', 'Land — Swamp', '');

describe('CR 611.3a, 109.4: live counts of a static ability', () => {
  const SMITH = card('Test Gear Smith', 'Artifact Creature — Golem', 'Test Gear Smith gets +1/+0 for each other artifact you control.', ['1', '3']);
  const WARDEN = card('Test Grove Warden', 'Creature — Elf Druid', 'Test Grove Warden gets +1/+1 for each Elf you control and each Elf card in your graveyard.', ['0', '0']);
  const MASK = card('Test Mask', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +2/+2 for each other enchantment on the battlefield.');
  const GLOW = card('Test Glow', 'Enchantment', '');
  it('"for each other artifact you control" counts the other artifacts of its controller, as they come and go, never itself', () => {
    expect(full(SMITH)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Gear Smith', 'Test Relic', 'Test Golem'] }, p2: { battlefield: ['Test Relic'] }, defs: [SMITH, RELIC, GOLEM] });
    const smith = find(s0, 'Test Gear Smith', 'battlefield');
    expect(pt(s0, smith)).toBe('3/3');
    const s1 = tweak(s0, (t) => { put(t, 'p1', 'battlefield', 'Test Relic'); });
    expect(pt(s1, smith)).toBe('4/3');
  });
  it('"for each Elf you control and each Elf card in your graveyard" adds both counts (itself an Elf; not the opponent\'s graveyard)', () => {
    expect(full(WARDEN)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Grove Warden', 'Test Elf'], graveyard: ['Test Elf', 'Test Elf', 'Test Bear'] }, p2: { graveyard: ['Test Elf'], battlefield: ['Test Elf'] }, defs: [WARDEN, ELF, BEAR] });
    expect(pt(s0, find(s0, 'Test Grove Warden', 'battlefield'))).toBe('4/4');
  });
  it('"+2/+2 for each other enchantment on the battlefield": every player\'s enchantments but the Aura itself', () => {
    expect(full(MASK)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Bear', 'Test Glow'] }, p2: { battlefield: ['Test Glow'] }, defs: [MASK, BEAR, GLOW] });
    const bear = find(s0, 'Test Bear', 'battlefield');
    expect(pt(attachNew(s0, 'Test Mask', bear), bear)).toBe('6/6');
  });
});

describe('CR 604.3, 613.4a, 402.1: "~\'s power and toughness are each equal to the total number of cards in all players\' hands"', () => {
  const SAGE = card('Test Hand Sage', 'Creature — Human', "Test Hand Sage's power and toughness are each equal to the total number of cards in all players' hands.", ['*', '*']);
  it('counts both hands, as they change', () => {
    expect(full(SAGE)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Hand Sage'], hand: ['Test Bear', 'Test Bear'] }, p2: { hand: ['Test Bear', 'Test Bear', 'Test Bear'] }, defs: [SAGE, BEAR] });
    const sage = find(s0, 'Test Hand Sage', 'battlefield');
    expect(pt(s0, sage)).toBe('5/5');
    expect(pt(tweak(s0, (t) => { put(t, 'p2', 'hand', 'Test Bear'); }), sage)).toBe('6/6');
  });
});

describe('CR 611.3a, 500.1: "~ has first strike during your turn"', () => {
  const NEEDLE = card('Test Needle', 'Creature — Human', 'Test Needle has first strike during your turn.', ['2', '1']);
  it('has first strike on its controller\'s turn only', () => {
    expect(full(NEEDLE)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Needle'] }, defs: [NEEDLE] });
    const needle = find(s0, 'Test Needle', 'battlefield');
    expect(s0.turn.activePlayer).toBe('p1');
    expect(kw(s0, needle, 'first strike')).toBe(true);
    expect(kw(tweak(s0, (t) => { t.turn.activePlayer = 'p2'; }), needle, 'first strike')).toBe(false);
  });
});

describe('CR 301.5, 611.3a: "As long as ~ is equipped, it gets +1/+1 and has flying"', () => {
  const CUB = card('Test Sky Cub', 'Creature — Cat Knight', 'As long as Test Sky Cub is equipped, it gets +1/+1 and has flying.', ['2', '2']);
  it('only while an Equipment is attached to it; an Aura does not equip it', () => {
    expect(full(CUB)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Sky Cub'] }, defs: [CUB, POLE, CHARM] });
    const cub = find(s0, 'Test Sky Cub', 'battlefield');
    expect(pt(s0, cub)).toBe('2/2');
    expect(kw(s0, cub, 'flying')).toBe(false);
    const aura = attachNew(s0, 'Test Charm', cub);
    expect(pt(aura, cub)).toBe('2/2');
    const eq = attachNew(s0, 'Test Pole', cub);
    expect(pt(eq, cub)).toBe('3/3');
    expect(kw(eq, cub, 'flying')).toBe(true);
    const off = tweak(eq, (t) => { const p = find(t, 'Test Pole', 'battlefield'); delete t.objects[p]!.attachedTo; });
    expect(pt(off, cub)).toBe('2/2');
  });
});

describe('CR 611.3a: "As long as you control an artifact creature or a Wizard, ~ has indestructible"', () => {
  const DOOM = card('Test Iron Tyrant', 'Legendary Creature — Human', 'As long as you control an artifact creature or a Wizard, Test Iron Tyrant has indestructible.', ['3', '3']);
  const WIZ = card('Test Wizard', 'Creature — Wizard', '', ['1', '1']);
  it('either description of yours is enough; a noncreature artifact or an opponent\'s artifact creature is not', () => {
    expect(full(DOOM)).toBe(true);
    const at = (p1: string[], p2: string[] = []): boolean => {
      const s = scenario([], { p1: { battlefield: ['Test Iron Tyrant', ...p1] }, p2: { battlefield: p2 }, defs: [DOOM, WIZ, GOLEM, RELIC] });
      return kw(s, find(s, 'Test Iron Tyrant', 'battlefield'), 'indestructible');
    };
    expect(at([])).toBe(false);
    expect(at(['Test Relic'], ['Test Golem'])).toBe(false);
    expect(at(['Test Golem'])).toBe(true);
    expect(at(['Test Wizard'])).toBe(true);
  });
});

describe('CR 109.4, 613.4c: "Elves you control and other Druids you control get +1/+1 and have reach"', () => {
  const BARON = card('Test Druid Baron', 'Creature — Druid', 'Elves you control and other Druids you control get +1/+1 and have reach.', ['1', '1']);
  const ELF_BARON = card('Test Elf Baron', 'Creature — Elf Druid', 'Elves you control and other Druids you control get +1/+1 and have reach.', ['1', '1']);
  const DRUID = card('Test Druid', 'Creature — Druid', '', ['1', '1']);
  it('"other" leaves out the source from the second group only: an Elf source is pumped by the first group', () => {
    expect(full(BARON)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Druid Baron', 'Test Elf', 'Test Druid', 'Test Bear'] }, p2: { battlefield: ['Test Elf'] }, defs: [BARON, ELF, DRUID, BEAR] });
    expect(pt(s0, find(s0, 'Test Druid Baron', 'battlefield'))).toBe('1/1');
    expect(pt(s0, ofPlayer(s0, 'Test Elf', 'p1')[0]!)).toBe('2/2');
    expect(kw(s0, ofPlayer(s0, 'Test Elf', 'p1')[0]!, 'reach')).toBe(true);
    expect(pt(s0, find(s0, 'Test Druid', 'battlefield'))).toBe('2/2');
    expect(pt(s0, find(s0, 'Test Bear', 'battlefield'))).toBe('2/2');
    expect(pt(s0, ofPlayer(s0, 'Test Elf', 'p2')[0]!)).toBe('1/1');
    const s1 = scenario([], { p1: { battlefield: ['Test Elf Baron'] }, defs: [ELF_BARON] });
    expect(pt(s1, find(s1, 'Test Elf Baron', 'battlefield'))).toBe('2/2');
  });
});

describe('CR 613.1d, 613.1f, 702.21a: the job Equipment ("... and is a Samurai in addition to its other types")', () => {
  const KATANA = card('Test Katana', 'Artifact — Equipment', 'Equipped creature gets +2/+2, has trample and haste, and is a Samurai in addition to its other types.\nEquip {5}', undefined, '{2}{R}');
  const ARMS = card('Test Arms', 'Artifact — Equipment', 'Equipped creature gets +2/+1, has ward {1}, and is a Knight in addition to its other types.\nEquip {4}', undefined, '{2}{W}');
  it('the creature gets the bonus, the keywords and the type, and keeps its own types', () => {
    expect(full(KATANA)).toBe(true);
    expect(full(ARMS)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Bear'] }, defs: [BEAR, KATANA, ARMS] });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const s = attachNew(s0, 'Test Katana', bear);
    const c = getChars(s, bear)!;
    expect(`${c.power}/${c.toughness}`).toBe('4/4');
    expect(c.subtypes).toEqual(expect.arrayContaining(['Bear', 'Samurai']));
    expect(c.types).toContain('Creature');
    expect(kw(s, bear, 'trample') && kw(s, bear, 'haste')).toBe(true);
    const w = attachNew(s0, 'Test Arms', bear);
    const ward = getChars(w, bear)!.keywords.find((k) => k.keyword === 'ward');
    expect(ward).toBeDefined();
    expect(JSON.stringify(ward)).toContain('"amount":1');
    expect(getChars(w, bear)!.subtypes).toContain('Knight');
    expect(pt(w, bear)).toBe('4/3');
  });
});

describe('CR 509.1b, 613.1f: "Equipped creature has shroud and can\'t be blocked"', () => {
  const CLOAK = card('Test Silk Cloak', 'Artifact — Equipment', "Equipped creature has shroud and can't be blocked.\nEquip {2}", undefined, '{2}');
  const VEIL = card('Test Silk Veil', 'Artifact — Equipment', "Equipped creature can't be blocked and has hexproof.\nEquip {2}", undefined, '{2}');
  function blockTry(eq: string | null): { s: GameState; denied: boolean; bear: ObjectId } {
    let s0 = scenario([], { p1: { battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Bear'] }, defs: [BEAR, CLOAK, VEIL] });
    const bear = ofPlayer(s0, 'Test Bear', 'p1')[0]!;
    if (eq) s0 = attachNew(s0, eq, bear);
    let s = declareAttackers(toDeclareAttackers(s0), [[bear]]);
    for (let g = 0; g < 20 && s.pending?.kind !== 'declareBlockers' && s.turn.step !== 'endCombat' && s.turn.step !== 'main2'; g++) s = pass(s);
    if (s.pending?.kind !== 'declareBlockers') return { s: s0, denied: true, bear };
    const cands = (s.pending as unknown as { candidates: { attackers: string[] }[] }).candidates;
    return { s: s0, denied: !cands.some((c) => c.attackers.includes(bear)), bear };
  }
  it('the equipped creature has the keyword and no creature may block it; without the Equipment it may be blocked', () => {
    expect(full(CLOAK)).toBe(true);
    expect(full(VEIL)).toBe(true);
    const cloak = blockTry('Test Silk Cloak');
    expect(cloak.denied).toBe(true);
    expect(kw(cloak.s, cloak.bear, 'shroud')).toBe(true);
    const veil = blockTry('Test Silk Veil');
    expect(veil.denied).toBe(true);
    expect(kw(veil.s, veil.bear, 'hexproof')).toBe(true);
    expect(blockTry(null).denied).toBe(false);
  });
});

describe('CR 205.4a: "As long as equipped creature is legendary, it has hexproof"', () => {
  const HELM = card('Test Crown Helm', 'Artifact — Equipment', 'Equipped creature gets +2/+2.\nAs long as equipped creature is legendary, it has hexproof.\nEquip {1}', undefined, '{3}');
  const LORD = card('Test Lord', 'Legendary Creature — Human', '', ['2', '2']);
  it('a legendary equipped creature has hexproof, another does not', () => {
    expect(full(HELM)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Bear', 'Test Lord'] }, defs: [BEAR, LORD, HELM] });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const lord = find(s0, 'Test Lord', 'battlefield');
    expect(kw(attachNew(s0, 'Test Crown Helm', lord), lord, 'hexproof')).toBe(true);
    const b = attachNew(s0, 'Test Crown Helm', bear);
    expect(kw(b, bear, 'hexproof')).toBe(false);
    expect(pt(b, bear)).toBe('4/4');
  });
});

describe('CR 608.2h, 611.2c: resolved pumps fix X (and the affected set) as the effect begins', () => {
  const HOOF = card('Test Stampede', 'Sorcery', 'Creatures you control gain trample and get +X/+X until end of turn, where X is the number of creatures you control.');
  const WAR = card('Test War Song', 'Sorcery', 'Creatures you control get +X/+0 until end of turn, where X is the number of artifacts you control.');
  const CAPTAIN = card('Test Captain', 'Creature — Human Soldier', "{0}: Each other Soldier you control gets +X/+X until end of turn, where X is Test Captain's toughness.", ['1', '3']);
  const SOLDIER = card('Test Soldier', 'Creature — Soldier', '', ['1', '1']);
  const ANIMIST = card('Test Animist', 'Creature — Lizard', "{0}: Another target creature you control gains trample and gets +X/+X until end of turn, where X is Test Animist's power.", ['3', '3']);
  const ARMADILLO = card('Test Shell Beast', 'Creature — Armadillo', '{0}: Test Shell Beast gets +X/+0 until end of turn, where X is its toughness.', ['1', '4']);
  const OCHU = card('Test Ochu', 'Creature — Plant', '{0}: Until end of turn, Test Ochu gets +1/+1 for each creature card in your graveyard.', ['1', '1']);
  const DEFILE = card('Test Defile', 'Instant', 'Target creature gets -1/-1 until end of turn for each Swamp you control.');
  const MUTILATE = card('Test Mutilate', 'Sorcery', 'All creatures get -1/-1 until end of turn for each Swamp you control.');
  it('"creatures you control gain trample and get +X/+X": X is counted once; a creature that arrives later gets nothing', () => {
    expect(full(HOOF)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Stampede'], battlefield: ['Test Bear', 'Test Elf'] }, defs: [HOOF, BEAR, ELF] });
    s = resolveAll(castWith(s, 'Test Stampede'));
    const bear = find(s, 'Test Bear', 'battlefield');
    expect(pt(s, bear)).toBe('4/4');
    expect(kw(s, bear, 'trample')).toBe(true);
    s = tweak(s, (t) => { put(t, 'p1', 'battlefield', 'Test Bear'); });
    const late = ofPlayer(s, 'Test Bear', 'p1').find((id) => id !== bear)!;
    expect(pt(s, late)).toBe('2/2');
    expect(kw(s, late, 'trample')).toBe(false);
    expect(pt(s, bear)).toBe('4/4');
  });
  it('"creatures you control get +X/+0" with X the artifacts you control', () => {
    expect(full(WAR)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test War Song'], battlefield: ['Test Bear', 'Test Relic', 'Test Relic'] }, p2: { battlefield: ['Test Bear'] }, defs: [WAR, BEAR, RELIC] });
    s = resolveAll(castWith(s, 'Test War Song'));
    expect(pt(s, ofPlayer(s, 'Test Bear', 'p1')[0]!)).toBe('4/2');
    expect(pt(s, ofPlayer(s, 'Test Bear', 'p2')[0]!)).toBe('2/2');
  });
  it('"each other Soldier you control gets +X/+X, where X is ~\'s toughness"; "another target creature ... where X is ~\'s power"; "where X is its toughness"', () => {
    expect(full(CAPTAIN)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Captain', 'Test Soldier'] }, defs: [CAPTAIN, SOLDIER] });
    s = resolveAll(activate(s, 'Test Captain'));
    expect(pt(s, find(s, 'Test Soldier', 'battlefield'))).toBe('4/4');
    expect(pt(s, find(s, 'Test Captain', 'battlefield'))).toBe('1/3');
    expect(full(ANIMIST)).toBe(true);
    let a = scenario([], { p1: { battlefield: ['Test Animist', 'Test Bear'] }, defs: [ANIMIST, BEAR] });
    const bear = find(a, 'Test Bear', 'battlefield');
    a = resolveAll(activate(a, 'Test Animist', [obj(bear)]));
    expect(pt(a, bear)).toBe('5/5');
    expect(kw(a, bear, 'trample')).toBe(true);
    expect(full(ARMADILLO)).toBe(true);
    let d = scenario([], { p1: { battlefield: ['Test Shell Beast'] }, defs: [ARMADILLO] });
    d = resolveAll(activate(d, 'Test Shell Beast'));
    expect(pt(d, find(d, 'Test Shell Beast', 'battlefield'))).toBe('5/4');
  });
  it('"Until end of turn, ~ gets +1/+1 for each creature card in your graveyard": the count as it resolves', () => {
    expect(full(OCHU)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Ochu'], graveyard: ['Test Bear', 'Test Bear', 'Test Relic'] }, defs: [OCHU, BEAR, RELIC] });
    s = resolveAll(activate(s, 'Test Ochu'));
    const ochu = find(s, 'Test Ochu', 'battlefield');
    expect(pt(s, ochu)).toBe('3/3');
    expect(pt(tweak(s, (t) => { put(t, 'p1', 'graveyard', 'Test Bear'); }), ochu)).toBe('3/3');
  });
  it('"-1/-1 until end of turn for each Swamp you control", one target or all creatures', () => {
    expect(full(DEFILE)).toBe(true);
    expect(full(MUTILATE)).toBe(true);
    const golem3 = card('Test Big Golem', 'Creature — Golem', '', ['4', '4']);
    let s = scenario([], { p1: { hand: ['Test Defile'], battlefield: ['Test Swamp', 'Test Swamp', 'Test Swamp'] }, p2: { battlefield: ['Test Big Golem', 'Test Swamp'] }, defs: [DEFILE, SWAMP, golem3] });
    const g = find(s, 'Test Big Golem', 'battlefield');
    s = resolveAll(castWith(s, 'Test Defile', [obj(g)]));
    expect(pt(s, g)).toBe('1/1');
    let m = scenario([], { p1: { hand: ['Test Mutilate'], battlefield: ['Test Swamp', 'Test Swamp', 'Test Big Golem'] }, p2: { battlefield: ['Test Big Golem', 'Test Bear'] }, defs: [MUTILATE, SWAMP, golem3, BEAR] });
    m = resolveAll(castWith(m, 'Test Mutilate'));
    for (const id of ofPlayer(m, 'Test Big Golem', 'p1').concat(ofPlayer(m, 'Test Big Golem', 'p2'))) expect(pt(m, id)).toBe('2/2');
    expect(ofPlayer(m, 'Test Bear', 'p2')).toEqual([]); // 0/0: put into its owner's graveyard (CR 704.5f)
  });
});

describe('CR 608.2h, 603.6a: "Whenever another creature you control enters, ~ gets +X/+0 until end of turn, where X is that creature\'s power"', () => {
  const CHAMP = card('Test Champion', 'Creature — Human Berserker', 'Whenever another creature you control enters, Test Champion gets +X/+0 until end of turn, where X is that creature\'s power.', ['1', '5']);
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '1'], '{0}');
  it('X is the power of the creature that entered', () => {
    expect(full(CHAMP)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Ogre'], battlefield: ['Test Champion'] }, defs: [CHAMP, OGRE] });
    s = resolveAll(castWith(s, 'Test Ogre'));
    expect(pt(s, find(s, 'Test Champion', 'battlefield'))).toBe('4/5');
  });
});
