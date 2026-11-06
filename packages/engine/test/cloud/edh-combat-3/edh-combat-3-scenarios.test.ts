/**
 * Commander lane edh-combat, round edh-combat-3: the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10),
 * compiled by the game's default compiler. Each test is named after the rule it checks, with its negative case. CR cites checked against the Comprehensive Rules text
 * of 2026-09-25 (rules/cr/ is not in the cloud checkout).
 *
 *   CR 510.1b, 510.1c, 609.4   "For each <filter> you control, you may have that creature assign its combat damage as though it weren't blocked.": asked of the attacking
 *                              player only for the creatures the filter matches; yes: all of it to what the creature attacks, the blocker is untouched; no: to the blocker
 *   CR 510.1b, 303.4b, 303.4e, 301.5a  "Equipped creature's controller may have it assign ...": the creature's controller chooses, not the controller of the Equipment
 *   CR 509.1b, 611.2c, 613.1f  "<group> gain first strike and trample until end of turn and can't be blocked by creature tokens this turn": no token may block them, a nontoken may;
 *                              fewer than three attackers do not trigger the battalion
 *   CR 608.2d, 611.2c          "Choose first strike, vigilance, or lifelink. Creatures you control gain that ability until end of turn.": one choice, only the chosen ability, only the
 *                              creatures there as it resolves
 *   CR 700.4, 701.15a          "Whenever a goaded attacking or blocking creature dies, you create a Treasure token.": a goaded blocker that dies makes one; a creature that is not goaded does not
 *   CR 604.1, 613.4c           "Creatures you control also get +1/+0 and have trample as long as you control six or more creatures.": the bonus follows the count of creatures
 *   CR 122.1, 602.2, 608.2c    "{N}, Exile this card from your graveyard: Choose target creature. Put four +1/+1 counters, a flying counter, ... on that creature.": from the graveyard
 *   CR 400.7, 603.7, 122.6     "Exile another target creature you control. You may return that card ... If you don't, at the beginning of the next end step, return that card ... with a
 *                              vigilance counter and a lifelink counter on it.": returned at once without counters; declined, it returns at the end step with both
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, answer, find, legal, pass, scenario } from '../../m3/scenario';
import { declareAttackers, declareBlockers, passUntil, toDeclareAttackers, tweak } from '../../m4/helpers';
import { getChars } from '../../../src/index';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const life = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;

const LORD = card('Test Siege Lord', 'Creature — Giant', "For each non-Giant creature you control, you may have that creature assign its combat damage as though it weren't blocked.", ['1', '1']);
const BEAR = card('Test Bear', 'Creature — Bear', '', ['3', '3']);
const KNIGHT = card('Test Knight', 'Creature — Giant Knight', '', ['3', '3']);
const WALL = card('Test Wall', 'Creature — Wall', '', ['0', '5']);
const GEAR = card('Test Gear', 'Artifact — Equipment', "Equipped creature's controller may have it assign its combat damage as though it weren't blocked.", undefined);
const DEFS: CardDef[] = [LORD, BEAR, KNIGHT, WALL, GEAR];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of [LORD, GEAR]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

/** p1 attacks with `attackers`; p2's walls block the first attacker each (one wall per attacker); stops at the first pending decision after blockers. */
function blockedAttack(s0: GameState, attackers: ObjectId[], walls: ObjectId[]): GameState {
  let s = declareAttackers(toDeclareAttackers(s0), attackers.map((a) => [a] as [ObjectId]));
  s = declareBlockers(passUntil(s, (x) => x.pending?.kind === 'declareBlockers', 'blockers'), walls.map((w, i) => [w, attackers[i]!] as [ObjectId, ObjectId]));
  return passUntil(s, (x) => x.pending?.kind === 'yesNo' || x.turn.step === 'endCombat', 'the damage choice or the end of combat');
}

describe('CR 510.1b-c, 609.4: "For each <filter> you control, you may have that creature assign its combat damage as though it weren\'t blocked."', () => {
  const setup = () => scenario([], { p1: { battlefield: ['Test Siege Lord', 'Test Bear', 'Test Knight'] }, p2: { battlefield: ['Test Wall', 'Test Wall'] }, defs: DEFS });
  it('the attacking player is asked for a creature the filter matches; yes sends all the damage to the player and leaves the blocker undamaged', () => {
    const s0 = setup();
    const bear = find(s0, 'Test Bear', 'battlefield');
    const [wall] = s0.zones.battlefield.filter((id) => s0.objects[id]!.controller === 'p2');
    let s = blockedAttack(s0, [bear], [wall!]);
    expect(s.pending?.kind).toBe('yesNo');
    expect(s.pending!.player).toBe('p1');
    s = answer(s, { kind: 'yesNo', yes: true });
    s = passUntil(s, (x) => x.turn.step === 'endCombat', 'end of combat');
    expect(life(s, 'p2')).toBe(17);
    expect(s.objects[wall!]!.damage).toBe(0);
  });
  it('no: the damage goes to the blocker as usual', () => {
    const s0 = setup();
    const bear = find(s0, 'Test Bear', 'battlefield');
    const [wall] = s0.zones.battlefield.filter((id) => s0.objects[id]!.controller === 'p2');
    let s = blockedAttack(s0, [bear], [wall!]);
    s = answer(s, { kind: 'yesNo', yes: false });
    s = passUntil(s, (x) => x.turn.step === 'endCombat', 'end of combat');
    expect(life(s, 'p2')).toBe(20);
    expect(s.objects[wall!]!.damage).toBe(3);
  });
  it('a creature the filter does not match (a Giant) is not asked and assigns to its blocker', () => {
    const s0 = setup();
    const knight = find(s0, 'Test Knight', 'battlefield');
    const [wall] = s0.zones.battlefield.filter((id) => s0.objects[id]!.controller === 'p2');
    const s = blockedAttack(s0, [knight], [wall!]);
    expect(s.pending?.kind).not.toBe('yesNo');
    expect(life(s, 'p2')).toBe(20);
    expect(s.objects[wall!]!.damage).toBe(3);
  });
  it('the opponent\'s creatures are not covered: with the Lord under the other player\'s control, the attacker is not asked', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Siege Lord', 'Test Wall'] }, defs: DEFS });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const wall = find(s0, 'Test Wall', 'battlefield');
    const s = blockedAttack(s0, [bear], [wall]);
    expect(s.pending?.kind).not.toBe('yesNo');
    expect(s.objects[wall]!.damage).toBe(3);
  });
});

describe('CR 510.1b-c, 301.5a: "Equipped creature\'s controller may have it assign its combat damage as though it weren\'t blocked."', () => {
  it('the creature\'s controller is asked even when the Equipment is controlled by another player; an unequipped creature is not asked', () => {
    const s0 = tweak(scenario([], { p1: { battlefield: ['Test Bear', 'Test Knight'] }, p2: { battlefield: ['Test Gear', 'Test Wall', 'Test Wall'] }, defs: DEFS }), (g) => {
      const gear = g.zones.battlefield.find((id) => g.objects[id]!.controller === 'p2' && g.defs[g.objects[id]!.defId]!.name === 'Test Gear')!;
      g.objects[gear]!.attachedTo = g.zones.battlefield.find((id) => g.defs[g.objects[id]!.defId]!.name === 'Test Bear')!;
    });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const knight = find(s0, 'Test Knight', 'battlefield');
    const walls = s0.zones.battlefield.filter((id) => s0.defs[s0.objects[id]!.defId]!.name === 'Test Wall');
    let s = blockedAttack(s0, [bear, knight], walls);
    expect(s.pending?.kind).toBe('yesNo');
    expect(s.pending!.player).toBe('p1');
    s = answer(s, { kind: 'yesNo', yes: true });
    s = passUntil(s, (x) => x.turn.step === 'endCombat', 'end of combat');
    expect(life(s, 'p2')).toBe(17);
    expect(s.objects[walls[0]!]!.damage).toBe(0);
    expect(s.objects[walls[1]!]!.damage).toBe(3);
  });
});

describe('CR 509.1b, 611.2c, 613.1f: "Creatures you control gain first strike and trample until end of turn and can\'t be blocked by creature tokens this turn." (battalion)', () => {
  const LOYAL = card('Test Loyalist', 'Creature — Goblin', "Battalion — Whenever this creature and at least two other creatures attack, creatures you control gain first strike and trample until end of turn and can't be blocked by creature tokens this turn.", ['2', '2']);
  const PAWN = card('Test Pawn', 'Creature — Goblin', '', ['1', '1']);
  const TOKEN_MAKER = card('Test Maker', 'Creature — Elf', '', ['1', '1']);
  const defs = [LOYAL, PAWN, TOKEN_MAKER, WALL];
  const withToken = (s0: GameState): GameState => tweak(s0, (g) => {
    const wall = g.zones.battlefield.find((id) => g.objects[id]!.controller === 'p2' && g.defs[g.objects[id]!.defId]!.name === 'Test Wall')!;
    g.objects[wall]!.kind = 'token'; // the p2 Wall stands in for a creature token (a token has no card behind it; this is only its kind)
  });
  it('the card is automated', () => expect(full(LOYAL)).toBe(true));
  it('three attackers: every creature of the controller gains first strike and trample and a creature token may not block it; a creature that is not a token may', () => {
    const s0 = withToken(scenario([], { p1: { battlefield: ['Test Loyalist', 'Test Pawn', 'Test Pawn'] }, p2: { battlefield: ['Test Wall', 'Test Maker'] }, defs }));
    const loyal = find(s0, 'Test Loyalist', 'battlefield');
    const pawns = s0.zones.battlefield.filter((id) => s0.defs[s0.objects[id]!.defId]!.name === 'Test Pawn');
    const s1 = passUntil(declareAttackers(toDeclareAttackers(s0), [[loyal], [pawns[0]!], [pawns[1]!]]), (x) => x.pending?.kind === 'declareBlockers', 'blockers');
    for (const id of [loyal, ...pawns]) {
      const c = getChars(s1, id)!;
      expect(c.keywords.map((k) => k.keyword), id).toEqual(expect.arrayContaining(['first strike', 'trample']));
    }
    const d = s1.pending;
    if (d?.kind !== 'declareBlockers') throw new Error('no declareBlockers');
    const wall = s1.zones.battlefield.find((id) => s1.objects[id]!.kind === 'token')!;
    const maker = find(s1, 'Test Maker', 'battlefield');
    // the token may block nothing, the nontoken may block each attacker
    const mayBlock = (b: ObjectId) => (d as { candidates?: { id: string; attackers?: string[] }[] }).candidates?.find((c) => c.id === b);
    expect(JSON.stringify(d)).not.toContain(`"id":"${wall}"`);
    expect(mayBlock(maker)).toBeDefined();
  });
  it('fewer than three attackers: no battalion trigger, no keyword, the token may block', () => {
    const s0 = withToken(scenario([], { p1: { battlefield: ['Test Loyalist', 'Test Pawn'] }, p2: { battlefield: ['Test Wall'] }, defs }));
    const loyal = find(s0, 'Test Loyalist', 'battlefield');
    const pawn = find(s0, 'Test Pawn', 'battlefield');
    const s1 = passUntil(declareAttackers(toDeclareAttackers(s0), [[loyal], [pawn]]), (x) => x.pending?.kind === 'declareBlockers', 'blockers');
    expect(getChars(s1, loyal)!.keywords.map((k) => k.keyword)).not.toContain('trample');
    const wall = s1.zones.battlefield.find((id) => s1.objects[id]!.kind === 'token')!;
    expect(JSON.stringify(s1.pending)).toContain(`"${wall}"`);
  });
});

describe('CR 608.2d, 611.2c: "At the beginning of each combat, choose first strike, vigilance, or lifelink. Creatures you control gain that ability until end of turn."', () => {
  const SKIRM = card('Test Skirmisher', 'Creature — Angel', 'At the beginning of each combat, choose first strike, vigilance, or lifelink. Creatures you control gain that ability until end of turn.', ['2', '2']);
  const PAWN = card('Test Pawn', 'Creature — Goblin', '', ['1', '1']);
  const defs = [SKIRM, PAWN, WALL];
  const kwOf = (s: GameState, id: ObjectId): string[] => getChars(s, id)!.keywords.map((k) => k.keyword);
  const toChoice = (s0: GameState): GameState => passUntil(s0, (x) => x.pending?.kind === 'chooseOption', 'the keyword choice');
  it('the card is automated', () => expect(full(SKIRM)).toBe(true));
  it('the controller is offered the three keywords; only the chosen one is gained by their creatures, an opponent\'s creature gains none', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Skirmisher', 'Test Pawn'] }, p2: { battlefield: ['Test Wall'] }, defs });
    let s = toChoice(s0);
    const d = s.pending;
    if (d?.kind !== 'chooseOption') throw new Error('no chooseOption');
    expect(d.player).toBe('p1');
    expect(d.options.map((o) => o.label.toLowerCase()).sort()).toEqual(['first strike', 'lifelink', 'vigilance']);
    const pick = d.options.find((o) => o.label.toLowerCase() === 'lifelink')!;
    s = answer(s, { kind: 'chooseOption', ids: [pick.id] });
    s = passUntil(s, (x) => x.pending?.kind === 'priority' || x.pending?.kind === 'declareAttackers', 'after the trigger');
    for (const id of [find(s, 'Test Skirmisher', 'battlefield'), find(s, 'Test Pawn', 'battlefield')]) {
      expect(kwOf(s, id), id).toContain('lifelink');
      expect(kwOf(s, id), id).not.toContain('vigilance');
      expect(kwOf(s, id), id).not.toContain('first strike');
    }
    expect(kwOf(s, find(s, 'Test Wall', 'battlefield'))).not.toContain('lifelink');
  });
  it('only the creatures there as the ability resolves gain it: a creature that enters later does not', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Skirmisher'], hand: ['Test Pawn'] }, defs });
    let s = toChoice(s0);
    s = answer(s, { kind: 'chooseOption', ids: [(s.pending as { options: { id: string; label: string }[] }).options.find((o) => o.label.toLowerCase() === 'vigilance')!.id] });
    s = passUntil(s, (x) => x.pending?.kind === 'priority' || x.pending?.kind === 'declareAttackers', 'after the trigger');
    expect(kwOf(s, find(s, 'Test Skirmisher', 'battlefield'))).toContain('vigilance');
    const late = tweak(s, (g) => { const id = find(g, 'Test Pawn', 'hand'); g.objects[id]!.zone = 'battlefield'; g.zones.hand['p1'] = g.zones.hand['p1']!.filter((x) => x !== id); g.zones.battlefield.push(id); });
    expect(kwOf(late, find(late, 'Test Pawn', 'battlefield'))).not.toContain('vigilance');
  });
});

describe('CR 700.4, 701.15a: "Whenever a goaded attacking or blocking creature dies, you create a Treasure token."', () => {
  const BAELOTH = card('Test Bard', 'Legendary Creature — Tiefling', "Creatures your opponents control with power less than Test Bard's power are goaded.\nWhenever a goaded attacking or blocking creature dies, you create a Treasure token.", ['3', '3']);
  const SLAYER = card('Test Slayer', 'Creature — Warrior', '', ['4', '4']);
  const PUP = card('Test Pup', 'Creature — Dog', '', ['1', '1']);
  const BRUTE = card('Test Brute', 'Creature — Ogre', '', ['3', '1']);
  const defs = [BAELOTH, SLAYER, PUP, BRUTE];
  const treasures = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && s.objects[id]!.kind === 'token' && s.objects[id]!.defId.includes('Treasure')).length;
  const blockAndDie = (blockerName: string): GameState => {
    const s0 = scenario([], { p1: { battlefield: ['Test Bard', 'Test Slayer'] }, p2: { battlefield: [blockerName] }, defs });
    const slayer = find(s0, 'Test Slayer', 'battlefield');
    // a goaded creature must block if able (CR 701.15b makes it attack, not block): the blocker is declared by choice here
    let s = declareAttackers(toDeclareAttackers(s0), [[slayer]]);
    s = declareBlockers(passUntil(s, (x) => x.pending?.kind === 'declareBlockers', 'blockers'), [[find(s0, blockerName, 'battlefield'), slayer]]);
    return passUntil(s, (x) => x.turn.step === 'endCombat', 'end of combat');
  };
  it('the card is automated', () => expect(full(BAELOTH)).toBe(true));
  it('a goaded creature that blocks and dies makes Baeloth\'s controller a Treasure token', () => {
    const s = blockAndDie('Test Pup');
    expect(s.zones.graveyard['p2']!.length).toBe(1);
    expect(treasures(s)).toBe(1);
  });
  it('a creature that is not goaded (power not less than Test Bard\'s) dies without a Treasure', () => {
    const s = blockAndDie('Test Brute');
    expect(s.zones.graveyard['p2']!.length).toBe(1);
    expect(treasures(s)).toBe(0);
  });
});

describe('CR 604.1, 613.4c: "Creatures you control also get +1/+0 and have trample as long as you control six or more creatures." (three static abilities of one card)', () => {
  const JET = card('Test Nexus', 'Legendary Creature — Dragon', 'Creatures you control get +1/+0 and have vigilance as long as you control three or more creatures.\nCreatures you control also get +1/+0 and have trample as long as you control six or more creatures.\nCreatures you control also get +1/+0 and have double strike as long as you control nine or more creatures.', ['3', '3']);
  const PAWN = card('Test Pawn', 'Creature — Goblin', '', ['1', '1']);
  const board = (n: number): GameState => scenario([], { p1: { battlefield: ['Test Nexus', ...Array.from({ length: n - 1 }, () => 'Test Pawn')] }, defs: [JET, PAWN] });
  const view = (s: GameState) => { const id = s.zones.battlefield.find((x) => s.defs[s.objects[x]!.defId]!.name === 'Test Pawn')!; const c = getChars(s, id)!; return { p: c.power, k: c.keywords.map((x) => x.keyword).sort() }; };
  it('the card is automated', () => expect(full(JET)).toBe(true));
  it('two creatures: nothing; three: +1/+0 and vigilance; six: +2/+0 with trample too; nine: +3/+0 with double strike too', () => {
    expect(view(board(2))).toEqual({ p: '1', k: [] });
    expect(view(board(3))).toEqual({ p: '2', k: ['vigilance'] });
    expect(view(board(5))).toEqual({ p: '2', k: ['vigilance'] });
    expect(view(board(6))).toEqual({ p: '3', k: ['trample', 'vigilance'] });
    expect(view(board(9))).toEqual({ p: '4', k: ['double strike', 'trample', 'vigilance'] });
  });
  it('an opponent\'s creatures are not affected, whatever the count', () => {
    const s = scenario([], { p1: { battlefield: ['Test Nexus', 'Test Pawn', 'Test Pawn'] }, p2: { battlefield: ['Test Pawn'] }, defs: [JET, PAWN] });
    const theirs = s.zones.battlefield.find((id) => s.objects[id]!.controller === 'p2')!;
    expect(getChars(s, theirs)!.power).toBe('1');
  });
});

describe('CR 122.1, 602.2, 608.2c: "{0}, Exile this card from your graveyard: Choose target creature. Put four +1/+1 counters, a flying counter, a vigilance counter, a trample counter, and a lifelink counter on that creature. Activate only as a sorcery."', () => {
  const BRAWL = card('Test Brawler', 'Creature — Human', '{0}, Exile this card from your graveyard: Choose target creature. Put four +1/+1 counters, a flying counter, a vigilance counter, a trample counter, and a lifelink counter on that creature. Activate only as a sorcery.', ['1', '1']);
  const PAWN = card('Test Pawn', 'Creature — Goblin', '', ['1', '1']);
  it('the card is automated', () => expect(full(BRAWL)).toBe(true));
  it('from the graveyard, at sorcery speed: the target gets the five kinds of counters and the card is exiled; from the hand the ability is not offered', () => {
    const s0 = scenario([], { p1: { graveyard: ['Test Brawler'], battlefield: ['Test Pawn'], hand: [] }, defs: [BRAWL, PAWN] });
    const brawl = find(s0, 'Test Brawler', 'graveyard');
    const pawn = find(s0, 'Test Pawn', 'battlefield');
    let s = act(s0, { type: 'activate', player: 'p1', source: brawl, ability: 'p:0:0' });
    for (let i = 0; i < 6 && s.pending && s.pending.kind !== 'priority'; i++) {
      if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: pawn }] });
      else if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else break;
    }
    s = pass(pass(s));
    const o = s.objects[pawn]!;
    expect(o.counters['+1/+1']).toBe(4);
    for (const k of ['flying', 'vigilance', 'trample', 'lifelink']) expect(o.counters[k], k).toBe(1);
    expect(s.zones.graveyard['p1']).not.toContain(brawl);
    expect(s.zones.exile.some((id) => s.objects[id]!.defId === 'Test Brawler')).toBe(true);
    // the ability works from the graveyard only (zone: graveyard): the same card in the hand has no such action
    const inHand = scenario([], { p1: { hand: ['Test Brawler'], battlefield: ['Test Pawn'] }, defs: [BRAWL, PAWN] });
    expect(legal(inHand, 'p1', 'activate').some((a) => JSON.stringify(a).includes(find(inHand, 'Test Brawler', 'hand')))).toBe(false);
  });
});

describe('CR 400.7, 603.7, 122.6: "Exile another target creature you control. You may return that card ... If you don\'t, at the beginning of the next end step, return that card ... with a vigilance counter and a lifelink counter on it."', () => {
  const GIL = card('Test Ranger', 'Legendary Creature — Human', "{0}, {T}: Exile another target creature you control. You may return that card to the battlefield under its owner's control. If you don't, at the beginning of the next end step, return that card to the battlefield under its owner's control with a vigilance counter and a lifelink counter on it.", ['2', '2']);
  const PAWN = card('Test Pawn', 'Creature — Goblin', '', ['1', '1']);
  const run = (yes: boolean): { s: GameState; names: string[] } => {
    const s0 = scenario([], { p1: { battlefield: ['Test Ranger', 'Test Pawn'] }, defs: [GIL, PAWN] });
    const ranger = find(s0, 'Test Ranger', 'battlefield');
    const pawn = find(s0, 'Test Pawn', 'battlefield');
    let s = act(s0, { type: 'activate', player: 'p1', source: ranger, ability: 'p:0:0' });
    for (let i = 0; i < 8 && s.pending && s.pending.kind !== 'priority'; i++) {
      if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: pawn }] });
      else if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else break;
    }
    s = pass(pass(s));
    expect(s.pending?.kind).toBe('yesNo');
    s = answer(s, { kind: 'yesNo', yes });
    return { s, names: s.zones.battlefield.map((id) => s.defs[s.objects[id]!.defId]!.name) };
  };
  it('the card is automated', () => expect(full(GIL)).toBe(true));
  it('yes: the card is back at once under its owner\'s control, with no counters, and nothing returns later', () => {
    const { s, names } = run(true);
    expect(names.filter((n) => n === 'Test Pawn').length).toBe(1);
    const pawn = s.zones.battlefield.find((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Pawn')!;
    expect(s.objects[pawn]!.controller).toBe('p1');
    expect(s.objects[pawn]!.counters['vigilance'] ?? 0).toBe(0);
    expect(s.zones.stack.length).toBe(0);
    const later = passUntil(s, (x) => x.turn.step === 'end' && x.pending?.kind === 'priority', 'the end step');
    expect(later.zones.battlefield.filter((id) => later.defs[later.objects[id]!.defId]!.name === 'Test Pawn').length).toBe(1);
  });
  it('no: it stays exiled until the beginning of the next end step, then returns under its owner\'s control with a vigilance counter and a lifelink counter', () => {
    const { s, names } = run(false);
    expect(names).not.toContain('Test Pawn');
    const end = passUntil(s, (x) => x.turn.step === 'end', 'the end step', 30);
    const back = passUntil(end, (x) => x.zones.battlefield.some((id) => x.defs[x.objects[id]!.defId]!.name === 'Test Pawn') && x.pending?.kind === 'priority', 'the return', 10);
    const pawn = back.zones.battlefield.find((id) => back.defs[back.objects[id]!.defId]!.name === 'Test Pawn')!;
    expect(back.objects[pawn]!.controller).toBe('p1');
    expect(back.objects[pawn]!.counters['vigilance']).toBe(1);
    expect(back.objects[pawn]!.counters['lifelink']).toBe(1);
  });
});
