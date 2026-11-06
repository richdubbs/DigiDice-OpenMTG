/**
 * Commander lane edh-c, round edh-c-100 (EDHREC ranks 23,501-24,000, fourth pass): the round's readings played through the engine with synthetic cards (invented names), compiled by the
 * game's default compiler, in 4-player games (Alice p1 is the active player of turn 1). Each test is named after the rule it checks, with its negative case. CR cites checked against the
 * Comprehensive Rules of 2026-09-25 (media.wizards.com).
 *
 *   CR 611.2a, 613.4c, 514.2     "Until your next turn, up to one target creature gets -5/-0." (edh-c-51's template, played here for Mu Yanling)
 *   CR 609.7a, 615.1a, 105.1      "Prevent all damage a red source of your choice would deal this turn." (edh-c-51's template, played here for Burrenton Forge-Tender)
 *   CR 604.1, 613.4c, 202.1       "Each creature you control gets +1/+1 for each white mana symbol in its mana cost."
 *   CR 701.20a, 701.9a, 608.2d    "Choose a color. Target player reveals their hand and discards all cards of that color." (edh-c-51's template, played here for Persecute)
 *   CR 205.3m, 701.8c, 701.19c     "Choose a creature type. ... discards all creature cards of that type. Then destroy all creatures of that type that player controls. They can't be regenerated."
 *   CR 701.17a, 608.2c            "Target player mills four cards. You draw a card for each creature card put into their graveyard this way."
 *   CR 604.3, 613.4a, 202.3       "~'s power is equal to the greatest mana value among noncreature permanents you control and noncreature cards in your graveyard."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, findAll, pass } from '../../m3/scenario';
import { mpScenario, passUntil } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}', colors: string[] = []): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const plr = (id: string): TargetChoice => ({ kind: 'player', id } as TargetChoice);

interface Opts { targets?: TargetChoice[][]; answers?: DecisionAnswer[] }
/** Answer what comes up: targets, then the answers; pay costs automatically; stop at priority. */
function settle(s0: GameState, o: Opts): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets' && o.targets && o.targets.length > 0) s = answer(s, { kind: 'chooseTargets', targets: o.targets.shift()! });
    else if (o.answers && o.answers.length > 0) s = answer(s, o.answers.shift()!);
    else break;
  }
  return s;
}
const queued = (o: Opts): Opts => ({ targets: [...(o.targets ?? [])], answers: [...(o.answers ?? [])] });
function drain(s0: GameState, o: Opts): GameState {
  let s = s0;
  for (let guard = 0; s.pending?.kind === 'priority' && s.zones.stack.length > 0 && guard < 40; guard++) s = settle(pass(s), o);
  return s;
}
/** The player casts a card from their hand, answers what is asked, and lets the stack resolve. */
function cast(s0: GameState, name: string, opts: Opts = {}, player = 'p1'): GameState {
  const q = queued(opts);
  return drain(settle(act(s0, { type: 'cast', player, card: find(s0, name, 'hand', player) } as never), q), q);
}
const stat = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const handNames = (s: GameState, p: string): string[] => s.zones.hand[p]!.map((id) => s.objects[id]!.defId).sort();
const onBattlefield = (s: GameState, id: ObjectId): boolean => s.zones.battlefield.includes(id);

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);

describe('CR 611.2a, 613.4c, 514.2: "Until your next turn, up to one target creature gets -5/-0."', () => {
  const SPELL = card('Test Weakening', 'Sorcery', 'Until your next turn, up to one target creature gets -5/-0.');
  const start = () => mpScenario({ defs: [SPELL, BEAR], zones: { p1: { hand: ['Test Weakening'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Bear'] } } });
  it('is automated', () => expect(full(SPELL)).toBe(true));
  it('the target gets -5/-0 through the opponents\' turns and the effect ends as the caster\'s next turn begins', () => {
    let s = start();
    const enemy = find(s, 'Test Bear', 'battlefield', 'p2');
    s = cast(s, 'Test Weakening', { targets: [[obj(enemy)]] });
    expect(stat(s, enemy)).toBe('-3/2');
    s = passUntil(s, (t) => t.turn.activePlayer === 'p2', 'the next player\'s turn');
    expect(stat(s, enemy)).toBe('-3/2');
    s = passUntil(s, (t) => t.turn.activePlayer === 'p1' && t.turn.number > 1, 'the caster\'s next turn');
    expect(stat(s, enemy)).toBe('2/2');
  });
  it('"up to one": it can be cast with no target and then changes nothing; the caster\'s own creature is untouched', () => {
    let s = start();
    const mine = find(s, 'Test Bear', 'battlefield', 'p1');
    s = cast(s, 'Test Weakening', { targets: [[]] });
    expect(stat(s, mine)).toBe('2/2');
    expect(stat(s, find(s, 'Test Bear', 'battlefield', 'p2'))).toBe('2/2');
  });
});

describe('CR 609.7a, 615.1a, 105.1: "Sacrifice ~: Prevent all damage a red source of your choice would deal this turn."', () => {
  const FORGE = card('Test Forge-Tender', 'Creature — Human Cleric', 'Sacrifice ~: Prevent all damage a red source of your choice would deal this turn.', ['1', '1'], '{W}', ['W']);
  const RED = card('Test Red Ogre', 'Creature — Ogre', '', ['3', '3'], '{2}{R}', ['R']);
  const GREEN = card('Test Green Ogre', 'Creature — Ogre', '', ['3', '3'], '{2}{G}', ['G']);
  const BITE = card('Test Bite', 'Sorcery', "Target creature you control deals damage equal to its power to target creature you don't control.");
  const start = () => mpScenario({ defs: [FORGE, RED, GREEN, BITE, BEAR], zones: { p1: { hand: ['Test Bite'], battlefield: ['Test Forge-Tender', 'Test Red Ogre', 'Test Green Ogre'] }, p2: { battlefield: ['Test Bear', 'Test Bear', 'Test Red Ogre'] } } });
  it('is automated', () => expect(full(FORGE)).toBe(true));
  const shield = (s0: GameState, chosen: ObjectId): GameState => {
    const q: Opts = { answers: [{ kind: 'chooseObjects', ids: [chosen] }] };
    const s1 = settle(act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Forge-Tender', 'battlefield', 'p1'), ability: 'p:0:0' }), q);
    return drain(s1, q);
  };
  it('the red source chosen deals no damage this turn (the Forge-Tender is sacrificed)', () => {
    const s0 = start();
    const red = find(s0, 'Test Red Ogre', 'battlefield', 'p1');
    const [e1] = findAll(s0, 'Test Bear', 'battlefield', 'p2');
    let s = shield(s0, red);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Forge-Tender')).toBe(false);
    s = cast(s, 'Test Bite', { targets: [[obj(red)], [obj(e1!)]] });
    expect(s.objects[e1!]!.damage).toBe(0);
    expect(onBattlefield(s, e1!)).toBe(true);
  });
  it('negative: a source that is not red can\'t be chosen, and a source that was not chosen still deals damage', () => {
    const s0 = start();
    const red = find(s0, 'Test Red Ogre', 'battlefield', 'p1');
    const green = find(s0, 'Test Green Ogre', 'battlefield', 'p1');
    const [e1, e2] = findAll(s0, 'Test Bear', 'battlefield', 'p2');
    let act0 = act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Forge-Tender', 'battlefield', 'p1'), ability: 'p:0:0' });
    for (let i = 0; i < 8 && act0.pending?.kind === 'priority' && act0.zones.stack.length > 0; i++) act0 = pass(act0); // every player passes, the ability resolves and asks
    expect(act0.pending?.kind).toBe('chooseObjects');
    const options = (act0.pending as unknown as { options: ObjectId[] }).options;
    expect(options).toContain(red);
    expect(options).toContain(find(s0, 'Test Red Ogre', 'battlefield', 'p2')); // any red source, an opponent's too
    expect(options).not.toContain(green);
    let s = shield(s0, red);
    s = cast(s, 'Test Bite', { targets: [[obj(green)], [obj(e2!)]] });
    expect(onBattlefield(s, e2!)).toBe(false);
    expect(onBattlefield(s, e1!)).toBe(true);
  });
});

describe('CR 701.20a, 701.9a, 608.2d: "Choose a color. Target player reveals their hand and discards all cards of that color."', () => {
  const PERSECUTE = card('Test Persecution', 'Sorcery', 'Choose a color. Target player reveals their hand and discards all cards of that color.', undefined, '{0}', ['B']);
  const RED_A = card('Test Red Bolt', 'Instant', 'Test Red Bolt deals 1 damage to any target.', undefined, '{R}', ['R']);
  const RED_B = card('Test Red Ogre', 'Creature — Ogre', '', ['3', '3'], '{2}{R}', ['R']);
  const GREEN_A = card('Test Green Growth', 'Instant', 'You gain 1 life.', undefined, '{G}', ['G']);
  const GOLD = card('Test Gold Dragon', 'Creature — Dragon', '', ['4', '4'], '{R}{G}', ['R', 'G']);
  const RELIC = card('Test Relic', 'Artifact', '', undefined, '{2}');
  const start = () => mpScenario({ defs: [PERSECUTE, RED_A, RED_B, GREEN_A, GOLD, RELIC], zones: { p1: { hand: ['Test Persecution'] }, p2: { hand: ['Test Red Bolt', 'Test Red Ogre', 'Test Green Growth', 'Test Gold Dragon', 'Test Relic'] } } });
  it('is automated', () => expect(full(PERSECUTE)).toBe(true));
  it('discards every card of the chosen color (a multicolored card too) and nothing else', () => {
    const s = cast(start(), 'Test Persecution', { targets: [[plr('p2')]], answers: [{ kind: 'chooseColor', color: 'R' as never }] });
    expect(handNames(s, 'p2')).toEqual(['Test Green Growth', 'Test Relic']);
    expect(s.zones.graveyard.p2!.length).toBe(3);
  });
  it('another color: the red cards stay', () => {
    const s = cast(start(), 'Test Persecution', { targets: [[plr('p2')]], answers: [{ kind: 'chooseColor', color: 'G' as never }] });
    expect(handNames(s, 'p2')).toEqual(['Test Red Bolt', 'Test Red Ogre', 'Test Relic']);
  });
  it('negative: a color nobody in the hand has discards nothing (colorless cards have no color)', () => {
    const s = cast(start(), 'Test Persecution', { targets: [[plr('p2')]], answers: [{ kind: 'chooseColor', color: 'W' as never }] });
    expect(handNames(s, 'p2').length).toBe(5);
  });
});

describe('CR 205.3m, 701.8c: "Choose a creature type. Target player reveals their hand and discards all creature cards of that type. Then destroy all creatures of that type that player controls. They can\'t be regenerated."', () => {
  const DECREE = card('Test Decree', 'Sorcery', "Choose a creature type. Target player reveals their hand and discards all creature cards of that type. Then destroy all creatures of that type that player controls. They can't be regenerated.", undefined, '{0}', ['B']);
  const ELF = card('Test Elf', 'Creature — Elf', '', ['1', '1']);
  const ELF_SPELL = card('Test Elf Song', 'Kindred Sorcery — Elf', 'You gain 1 life.');
  const regen = card('Test Regenerator', 'Creature — Elf', '', ['2', '2']);
  const SHIELD = card('Test Shield Spell', 'Instant', 'Regenerate target creature.');
  const SMITE = card('Test Smite', 'Sorcery', 'Destroy target creature.');
  const start = () => mpScenario({ defs: [DECREE, ELF, ELF_SPELL, regen, BEAR, SHIELD, SMITE], zones: { p1: { hand: ['Test Decree', 'Test Shield Spell', 'Test Smite'], battlefield: ['Test Elf'] }, p2: { hand: ['Test Elf', 'Test Bear', 'Test Elf Song'], battlefield: ['Test Elf', 'Test Regenerator', 'Test Bear'] } } });
  it('is automated', () => expect(full(DECREE)).toBe(true));
  it('discards the creature cards of the type from the hand and destroys that player\'s creatures of the type (regeneration can\'t save them); the caster\'s Elf and other creatures stay', () => {
    const s0 = start();
    const mineElf = find(s0, 'Test Elf', 'battlefield', 'p1');
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    const s = cast(s0, 'Test Decree', { targets: [[plr('p2')]], answers: [{ kind: 'chooseName', name: 'Elf' }] });
    expect(handNames(s, 'p2')).toEqual(['Test Bear', 'Test Elf Song']);
    expect(onBattlefield(s, mineElf)).toBe(true);
    expect(onBattlefield(s, bear)).toBe(true);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2').map((id) => s.objects[id]!.defId)).toEqual(['Test Bear']);
  });
  it("\"They can't be regenerated\": an Elf with a regeneration shield is destroyed anyway, while the same shield does save it from an ordinary destroy (control)", () => {
    const s0 = start();
    const elf = s0.zones.battlefield.find((id) => s0.objects[id]!.controller === 'p2' && s0.objects[id]!.defId === 'Test Regenerator')!;
    const shielded = cast(s0, 'Test Shield Spell', { targets: [[obj(elf)]] });
    const control = cast(shielded, 'Test Smite', { targets: [[obj(elf)]] });
    expect(onBattlefield(control, elf)).toBe(true);
    const s = cast(shielded, 'Test Decree', { targets: [[plr('p2')]], answers: [{ kind: 'chooseName', name: 'Elf' }] });
    expect(onBattlefield(s, elf)).toBe(false);
  });
  it('negative: a type that is not in the hand or on the table changes nothing', () => {
    const s = cast(start(), 'Test Decree', { targets: [[plr('p2')]], answers: [{ kind: 'chooseName', name: 'Goblin' }] });
    expect(handNames(s, 'p2').length).toBe(3);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2').length).toBe(3);
  });
});

describe('CR 701.17a, 608.2c: "Target player mills four cards. You draw a card for each creature card put into their graveyard this way."', () => {
  const CONFESSION = card('Test Confession', 'Instant', 'Target player mills four cards. You draw a card for each creature card put into their graveyard this way.', undefined, '{0}', ['U']);
  const SPELL = card('Test Idea', 'Sorcery', '');
  const start = () => mpScenario({
    defs: [CONFESSION, BEAR, SPELL],
    zones: { p1: { hand: ['Test Confession'] }, p2: { library: ['Test Bear', 'Test Idea', 'Test Bear', 'Test Idea'] } },
  });
  it('is automated', () => expect(full(CONFESSION)).toBe(true));
  it('draws one card for each creature card among the four milled, not for the others', () => {
    const s0 = start();
    const s = cast(s0, 'Test Confession', { targets: [[plr('p2')]] });
    expect(s.zones.graveyard.p2!.length).toBe(4);
    expect(s.zones.hand.p1!.length).toBe(s0.zones.hand.p1!.length - 1 + 2);
  });
  it('negative: milling yourself is not the pattern of "their": drawing for the creature cards put into the target\'s graveyard only', () => {
    const s0 = start();
    const s = cast(s0, 'Test Confession', { targets: [[plr('p1')]] });
    expect(s.zones.hand.p1!.length).toBe(s0.zones.hand.p1!.length - 1 + 0 + (s.zones.graveyard.p1!.filter((id) => s.objects[id]!.defId === 'Test Bear').length));
  });
});

describe('CR 604.3, 613.4a, 202.3: "~\'s power is equal to the greatest mana value among noncreature permanents you control and noncreature cards in your graveyard."', () => {
  const ROBOT = card('Test Robot', 'Creature — Robot', "~'s power is equal to the greatest mana value among noncreature permanents you control and noncreature cards in your graveyard.", ['*', '4'], '{3}');
  const RELIC = card('Test Relic', 'Artifact', '', undefined, '{2}');
  const SPELL = card('Test Big Spell', 'Sorcery', '', undefined, '{4}{R}');
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '3'], '{6}');
  const start = (o: { gy?: string[]; bf?: string[]; oppGy?: string[] } = {}) => mpScenario({
    defs: [ROBOT, RELIC, SPELL, OGRE],
    zones: { p1: { battlefield: ['Test Robot', ...(o.bf ?? [])], graveyard: o.gy ?? [] }, p2: { graveyard: o.oppGy ?? [] } },
  });
  it('is automated', () => expect(full(ROBOT)).toBe(true));
  it('counts the noncreature permanents on the battlefield and the noncreature cards in your graveyard (5 from the sorcery beats 2 from the artifact)', () => {
    const s = start({ bf: ['Test Relic'], gy: ['Test Big Spell'] });
    expect(stat(s, find(s, 'Test Robot', 'battlefield', 'p1'))).toBe('5/4');
  });
  it('the artifact alone counts too (2), without the graveyard', () => {
    const s = start({ bf: ['Test Relic'] });
    expect(stat(s, find(s, 'Test Robot', 'battlefield', 'p1'))).toBe('2/4');
  });
  it('negative: creature cards in your graveyard, an opponent\'s graveyard and the creature itself (mana value 3) do not count', () => {
    const s = start({ gy: ['Test Ogre'], oppGy: ['Test Big Spell'] });
    expect(stat(s, find(s, 'Test Robot', 'battlefield', 'p1'))).toBe('0/4');
  });
});

describe('CR 604.1, 613.4c, 202.1: "Each creature you control gets +1/+1 for each white mana symbol in its mana cost."', () => {
  const LIGHT = card('Test Inner Light', 'Enchantment', 'Each creature you control gets +1/+1 for each white mana symbol in its mana cost.', undefined, '{0}', ['W']);
  const KNIGHT = card('Test White Knight', 'Creature — Knight', '', ['2', '2'], '{1}{W}{W}', ['W']);
  const SOLDIER = card('Test Soldier', 'Creature — Soldier', '', ['1', '1'], '{W}', ['W']);
  const OGRE = card('Test Red Ogre', 'Creature — Ogre', '', ['3', '3'], '{2}{R}', ['R']);
  const start = () => mpScenario({ defs: [LIGHT, KNIGHT, SOLDIER, OGRE], zones: { p1: { hand: ['Test Inner Light'], battlefield: ['Test White Knight', 'Test Soldier', 'Test Red Ogre'] }, p2: { battlefield: ['Test White Knight'] } } });
  it('is automated', () => expect(full(LIGHT)).toBe(true));
  it('each creature you control counts the white symbols of its own mana cost: {1}{W}{W} gets +2/+2, {W} +1/+1, a red creature +0/+0; the opponent\'s creature is untouched', () => {
    let s = start();
    const knight = find(s, 'Test White Knight', 'battlefield', 'p1');
    const soldier = find(s, 'Test Soldier', 'battlefield', 'p1');
    const ogre = find(s, 'Test Red Ogre', 'battlefield', 'p1');
    const enemy = find(s, 'Test White Knight', 'battlefield', 'p2');
    s = cast(s, 'Test Inner Light');
    expect(stat(s, knight)).toBe('4/4');
    expect(stat(s, soldier)).toBe('2/2');
    expect(stat(s, ogre)).toBe('3/3');
    expect(stat(s, enemy)).toBe('2/2');
  });
  it('negative: before the enchantment is on the battlefield nothing changes', () => {
    const s = start();
    expect(stat(s, find(s, 'Test White Knight', 'battlefield', 'p1'))).toBe('2/2');
  });
});
