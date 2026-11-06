/**
 * edh-players-3 (Commander lane edh-players): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (invented names
 * and wordings, design 6.10). Each test is named after the rule it checks, with its negative case. The cites were checked against the Comprehensive Rules text of 2026-09-25
 * (media.wizards.com, fetched in the cloud session) and the Scryfall rulings of the cards.
 *
 *   CR 614.1c, 205.4a        "Creatures and nonbasic lands your opponents control enter tapped": an opponent's creature or nonbasic land enters tapped; their basic
 *                            land, their artifact and your own creature enter untapped
 *   CR 205.1b, 613.1d, 611.2a "This land becomes a 1/1 Insect artifact creature with flying until end of turn. It's still a land." and the X/X green form
 *   CR 107.3a, 613.4b        "X can't be 0" and the X of the cost is the X of the creature, read once
 *   CR 508.4, 111.1, 702.116a "Whenever you attack, for each opponent, create a 1/1 ... token that's tapped and attacking that player or a planeswalker they control"
 *   CR 104.3, 104.2          "You can't lose the game this turn and your opponents can't win the game this turn"
 *   CR 120.3a, 614.1a        "Until end of turn, damage that would reduce your life total to less than 1 reduces it to 1 instead": damage only, not infect, not other life loss; below 1 life as normal
 *   CR 700.2                 "Choose any number --": none, some or all of the modes
 *   CR 701.10a, 613.4c       "double the power of each Dragon you control until end of turn" and "double its power"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, battlefieldNames, find, legal, life, pass, passBoth, scenario } from '../../m3/scenario';
import { getChars } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as unknown as OracleCard);
}
/** Every ability of the card automated (no manual ability, no manual step). */
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

interface Script { targets?: TargetChoice[][]; numbers?: number[]; yes?: boolean; modes?: number[] }
/** Answer the decisions that come up (targets, numbers, costs paid automatically) until a player has priority or a combat declaration is due. */
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  const q = { targets: [...(script.targets ?? [])], numbers: [...(script.numbers ?? [])] };
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.targets.shift() ?? [] });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: q.numbers.shift() ?? p.max });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: script.yes ?? false });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.min) });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else if (p.kind === 'chooseOption' && script.modes !== undefined) s = answer(s, { kind: 'chooseOption', ids: script.modes.map((i) => p.options[i]!.id) });
    else break;
  }
  return s;
}
const resolveAll = (s0: GameState, script?: Script): GameState => {
  let s = drive(s0, script);
  for (let i = 0; i < 12 && s.zones.stack.length > 0 && s.pending?.kind === 'priority'; i++) s = drive(passBoth(s), script);
  return s;
};
const cast = (s: GameState, name: string, script?: Script, player: 'p1' | 'p2' = 'p1'): GameState => resolveAll(drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), script), script);
const activate = (s: GameState, source: ObjectId, script?: Script, ability = 'p:0:0'): GameState => resolveAll(drive(act(s, { type: 'activate', player: 'p1', source, ability }), script), script);
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const mana = (s: GameState, ...types: string[]): void => { s.players.find((x) => x.id === 'p1')!.manaPool.push(...types.map((type) => ({ type }) as never)); };
const pt = (s: GameState, id: ObjectId): [number, number] => { const c = getChars(s, id); return [Number(c.power), Number(c.toughness)]; };
const has = (s: GameState, id: ObjectId, keyword: string): boolean => getChars(s, id).keywords.some((k) => k.keyword === keyword);
const tokens = (s: GameState, controller: 'p1' | 'p2'): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === controller);

describe('CR 614.1c, 205.4a: "Creatures and nonbasic lands your opponents control enter tapped."', () => {
  const WARDEN = card('Test Frost Warden', 'Creature — Human Soldier', 'First strike\nCreatures and nonbasic lands your opponents control enter tapped.', ['2', '2']);
  const CUB = card('Test Plain Cub', 'Creature — Bear', '', ['1', '1']);
  const GATE = card('Test Odd Gate', 'Land — Gate', '');
  const RUST = card('Test Rust Cup', 'Artifact', '');
  const defs = [WARDEN, CUB, GATE, RUST];
  const tapped = (s: GameState, name: string, owner: 'p1' | 'p2'): boolean => s.objects[find(s, name, 'battlefield', owner)]!.tapped;
  it('is automated', () => expect(full(WARDEN)).toBe(true));
  it('an opponent\'s creature and an opponent\'s nonbasic land enter tapped', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Frost Warden'] }, p2: { hand: ['Test Plain Cub', 'Test Odd Gate'] } });
    s = advanceTo(s, 2, 'main1');
    s = cast(s, 'Test Plain Cub', undefined, 'p2');
    s = act(s, { type: 'playLand', player: 'p2', card: find(s, 'Test Odd Gate', 'hand', 'p2') });
    expect(tapped(s, 'Test Plain Cub', 'p2')).toBe(true);
    expect(tapped(s, 'Test Odd Gate', 'p2')).toBe(true);
  });
  it('an opponent\'s basic land and artifact enter untapped (a basic land is not a nonbasic land; an artifact is neither)', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Frost Warden'] }, p2: { hand: ['Plains', 'Test Rust Cup'] } });
    s = advanceTo(s, 2, 'main1');
    s = cast(s, 'Test Rust Cup', undefined, 'p2');
    s = act(s, { type: 'playLand', player: 'p2', card: find(s, 'Plains', 'hand', 'p2') });
    expect(tapped(s, 'Plains', 'p2')).toBe(false);
    expect(tapped(s, 'Test Rust Cup', 'p2')).toBe(false);
  });
  it('your own creature and your own nonbasic land enter untapped', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Frost Warden'], hand: ['Test Plain Cub', 'Test Odd Gate'] } });
    s = cast(s, 'Test Plain Cub');
    s = act(s, { type: 'playLand', player: 'p1', card: find(s, 'Test Odd Gate', 'hand', 'p1') });
    expect(tapped(s, 'Test Plain Cub', 'p1')).toBe(false);
    expect(tapped(s, 'Test Odd Gate', 'p1')).toBe(false);
  });
});

describe('CR 205.1b, 613.1d, 611.2a: "This land becomes a 1/1 Insect artifact creature with flying until end of turn. It\'s still a land."', () => {
  const HIVE = card('Test Insect Hive', 'Land', '{T}: Add {C}.\n{1}: This land becomes a 1/1 Insect artifact creature with flying and infect until end of turn. It\'s still a land.');
  it('is automated', () => expect(full(HIVE)).toBe(true));
  it('it becomes a 1/1 artifact creature with flying and infect and is still a land; at the end of the turn it is only a land again', () => {
    let s = scenario([], { defs: [HIVE], p1: { battlefield: ['Test Insect Hive', 'Plains'] } });
    const hive = find(s, 'Test Insect Hive', 'battlefield', 'p1');
    expect(getChars(s, hive).types).toEqual(['Land']);
    mana(s, 'C');
    s = activate(s, hive, undefined, 'p:0:1');
    const c = getChars(s, hive);
    expect([...c.types].sort()).toEqual(['Artifact', 'Creature', 'Land']);
    expect(c.subtypes).toEqual(['Insect']);
    expect(pt(s, hive)).toEqual([1, 1]);
    expect(has(s, hive, 'flying') && has(s, hive, 'infect')).toBe(true);
    s = advanceTo(s, 2, 'main1');
    expect(getChars(s, hive).types).toEqual(['Land']);
    expect(has(s, hive, 'flying')).toBe(false);
  });
  it('without paying, nothing changes (the ability is not free)', () => {
    const s = scenario([], { defs: [HIVE], p1: { battlefield: ['Test Insect Hive'] } });
    const hive = find(s, 'Test Insect Hive', 'battlefield', 'p1');
    expect(getChars(s, hive).types).toEqual(['Land']);
  });
});

describe('CR 107.3a, 613.4b: "{X}{G}: Until end of turn, this land becomes an X/X green Hydra creature. It\'s still a land. X can\'t be 0."', () => {
  const NEST = card('Test Hydra Nest', 'Land', '{T}: Add {G}.\n{X}{G}: Until end of turn, this land becomes an X/X green Hydra creature. It\'s still a land. X can\'t be 0.');
  it('is automated', () => expect(full(NEST)).toBe(true));
  it('with X = 3 it is a 3/3 green Hydra creature and still a land; the size does not follow mana left over, and it lasts only this turn', () => {
    let s = scenario([], { defs: [NEST], p1: { battlefield: ['Test Hydra Nest'] } });
    const nest = find(s, 'Test Hydra Nest', 'battlefield', 'p1');
    mana(s, 'G', 'G', 'G', 'G');
    s = activate(s, nest, { numbers: [3] }, 'p:0:1');
    const c = getChars(s, nest);
    expect([...c.types].sort()).toEqual(['Creature', 'Land']);
    expect(c.subtypes).toEqual(['Hydra']);
    expect(c.colors).toEqual(['G']);
    expect(pt(s, nest)).toEqual([3, 3]);
    s = advanceTo(s, 2, 'main1');
    expect(getChars(s, nest).types).toEqual(['Land']);
  });
  it('with X = 1 it is a 1/1 (the X is the announced X, not the most that could be paid)', () => {
    let s = scenario([], { defs: [NEST], p1: { battlefield: ['Test Hydra Nest'] } });
    const nest = find(s, 'Test Hydra Nest', 'battlefield', 'p1');
    mana(s, 'G', 'G', 'G', 'G');
    s = activate(s, nest, { numbers: [1] }, 'p:0:1');
    expect(pt(s, nest)).toEqual([1, 1]);
  });
});

describe('CR 508.4, 111.1, 702.116a: "Whenever you attack, for each opponent, create a 1/1 white Human creature token that\'s tapped and attacking that player or a planeswalker they control."', () => {
  const CAPTAIN = card('Test Dawn Captain', 'Creature — Human Knight', "Vigilance\nWhenever you attack, for each opponent, create a 1/1 white Human creature token that's tapped and attacking that player or a planeswalker they control.", ['2', '2']);
  const SCOUT = card('Test Lone Scout', 'Creature — Human Scout', '', ['1', '1']);
  const defs = [CAPTAIN, SCOUT];
  function attack(s0: GameState, who: ObjectId[]): GameState {
    let s = s0;
    for (let guard = 0; guard < 120 && s.turn.number === 1; guard++) {
      const d = s.pending;
      if (d?.kind === 'declareAttackers') {
        s = answer(s, { kind: 'declareAttackers', attacks: who.map((attacker) => ({ attacker, defender: 'p2' })) });
        if (s.zones.stack.length > 0) s = resolveAll(s);
        return s;
      }
      if (d?.kind === 'priority') s = pass(s);
      else if (d) s = drive(s);
      else break;
    }
    return s;
  }
  it('is automated', () => expect(full(CAPTAIN)).toBe(true));
  it('one token for the opponent, tapped and attacking them; the token is not a second attacker of the player\'s choice', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Dawn Captain'] } });
    const captain = find(s0, 'Test Dawn Captain', 'battlefield', 'p1');
    const s = attack(s0, [captain]);
    const made = tokens(s, 'p1');
    expect(made).toHaveLength(1);
    expect(s.objects[made[0]!]!.tapped).toBe(true);
    expect(s.combat?.attackers.some((a) => a.id === made[0] && a.defender === 'p2')).toBe(true);
  });
  it('when the opponent controls a planeswalker the token may attack the player or the planeswalker, its controller\'s choice (CR 508.4: "that player or a planeswalker they control")', () => {
    const WANDERER = compileCard({ name: 'Test Wanderer', layout: 'normal', mana_cost: '{0}', type_line: 'Planeswalker \u2014 Test', oracle_text: '', colors: [], keywords: [], loyalty: '3' } as unknown as OracleCard);
    const run = (pick: number): { token: ObjectId; defender: unknown; walker: ObjectId } => {
      const s0 = scenario([], { defs: [...defs, WANDERER], p1: { battlefield: ['Test Dawn Captain'] }, p2: { battlefield: [{ name: 'Test Wanderer', counters: { loyalty: 3 } }] } });
      const captain = find(s0, 'Test Dawn Captain', 'battlefield', 'p1');
      const walker = find(s0, 'Test Wanderer', 'battlefield', 'p2');
      let s = s0;
      for (let guard = 0; guard < 120 && s.turn.number === 1; guard++) {
        const d = s.pending;
        if (d?.kind === 'declareAttackers') { s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: captain, defender: 'p2' }] }); break; }
        if (d?.kind === 'priority') s = pass(s);
        else if (d) s = drive(s);
        else break;
      }
      s = resolveAll(s, { modes: [pick] });
      const token = tokens(s, 'p1')[0]!;
      return { token, defender: s.combat?.attackers.find((a) => a.id === token)?.defender, walker };
    };
    const atPlayer = run(0);
    expect(atPlayer.defender).toBe('p2');
    const atWalker = run(1);
    expect(atWalker.defender).toBe(atWalker.walker);
  });
  it('no attack, no tokens (the trigger is "whenever you attack")', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Dawn Captain'] } });
    s = advanceTo(s, 2, 'main1');
    expect(tokens(s, 'p1')).toHaveLength(0);
  });
});

describe('CR 104.3, 104.2, 101.2: "You can\'t lose the game this turn and your opponents can\'t win the game this turn."', () => {
  const GRACE = card('Test Hallowed Reprieve', 'Instant', "You can't lose the game this turn and your opponents can't win the game this turn.\nUntil end of turn, damage that would reduce your life total to less than 1 reduces it to 1 instead.", undefined, '{0}');
  const BOLT = card('Test Spark', 'Instant', 'Test Spark deals 7 damage to target player.');
  const SIPHON = card('Test Siphon', 'Instant', 'Target player loses 7 life.');
  const TOXIC = card('Test Venom Imp', 'Creature — Imp', 'Infect\nWhen this creature enters, it deals 5 damage to target player.', ['1', '1']);
  const defs = [GRACE, BOLT, SIPHON, TOXIC];
  it('is automated', () => expect(full(GRACE)).toBe(true));
  it('7 damage to a player at 5 life leaves 1 life: the floor of life, and the player has not lost', () => {
    let s = scenario([], { defs, life: 5, p1: { hand: ['Test Hallowed Reprieve'] }, p2: { hand: ['Test Spark'] } });
    s = cast(s, 'Test Hallowed Reprieve');
    s = advanceTo(s, 1, 'main2');
    s = settleP2Bolt(s, 'p1');
    expect(life(s, 'p1')).toBe(1);
    expect(s.result ?? null).toBeNull();
  });
  it('damage that leaves 1 or more life is not changed (5 life, 3 damage: 2)', () => {
    const THREE = card('Test Small Spark', 'Instant', 'Test Small Spark deals 3 damage to target player.');
    let s = scenario([], { defs: [GRACE, THREE], life: 5, p1: { hand: ['Test Hallowed Reprieve'] }, p2: { hand: ['Test Small Spark'] } });
    s = cast(s, 'Test Hallowed Reprieve');
    s = settleP2Bolt(s, 'p1', 'Test Small Spark');
    expect(life(s, 'p1')).toBe(2);
  });
  it('damage that leaves exactly 1 life or more is as normal; at 1 life further damage changes nothing; at 0 or less life damage lowers it further as normal (ruling of 2021-03-19)', () => {
    const TWO = card('Test Small Spark', 'Instant', 'Test Small Spark deals 2 damage to target player.');
    let s = scenario([], { defs: [GRACE, SIPHON, TWO], life: 5, p1: { hand: ['Test Hallowed Reprieve'] }, p2: { hand: ['Test Siphon', 'Test Small Spark', 'Test Small Spark', 'Test Small Spark', 'Test Small Spark'] } });
    s = cast(s, 'Test Hallowed Reprieve');
    s = settleP2Bolt(s, 'p1', 'Test Small Spark');
    expect(life(s, 'p1')).toBe(3); // 5 - 2
    s = settleP2Bolt(s, 'p1', 'Test Small Spark');
    expect(life(s, 'p1')).toBe(1); // 3 - 2: exactly 1, as normal
    s = settleP2Bolt(s, 'p1', 'Test Small Spark');
    expect(life(s, 'p1')).toBe(1); // 1 - 2 would be -1: it stays 1
    s = settleP2Bolt(s, 'p1', 'Test Siphon'); // life lost by an effect is not damage: 1 - 7
    expect(life(s, 'p1')).toBe(-6);
    s = settleP2Bolt(s, 'p1', 'Test Small Spark'); // already below 1: damage lowers it further as normal
    expect(life(s, 'p1')).toBe(-8);
    expect(s.result ?? null).toBeNull();
  });
  it('without the spell, the same damage is lethal', () => {
    let s = scenario([], { defs, life: 5, p2: { hand: ['Test Spark'] } });
    s = settleP2Bolt(s, 'p1');
    expect(s.result).toMatchObject({ winner: 'p2' });
  });
  it('life lost any other way is not floored (the replacement is for damage): a 7-life loss at 5 life leaves -2, and "can\'t lose the game" keeps the player in the game', () => {
    let s = scenario([], { defs, life: 5, p1: { hand: ['Test Hallowed Reprieve'] }, p2: { hand: ['Test Siphon'] } });
    s = cast(s, 'Test Hallowed Reprieve');
    s = settleP2Bolt(s, 'p1', 'Test Siphon');
    expect(life(s, 'p1')).toBe(-2);
    expect(s.result ?? null).toBeNull();
  });
  it('infect damage is not life loss: it gives poison counters and the floor does not touch them (the replacement is for the life lost because of damage, CR 120.3b)', () => {
    let s = scenario([], { defs, life: 5, p1: { hand: ['Test Hallowed Reprieve'] }, p2: { hand: ['Test Venom Imp'] } });
    s = advanceTo(s, 2, 'main1');
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Venom Imp', 'hand', 'p2') }));
    s = pass(s); // p2 passes; p1 may respond
    s = cast(s, 'Test Hallowed Reprieve', { targets: [[{ kind: 'player', id: 'p1' }]] }, 'p1');
    expect(s.zones.stack).toHaveLength(0);
    expect(s.players.find((p) => p.id === 'p1')!.poison).toBe(5);
    expect(life(s, 'p1')).toBe(5);
  });
  it('it ends with the turn: on the next turn damage is lethal again', () => {
    let s = scenario([], { defs, life: 5, p1: { hand: ['Test Hallowed Reprieve'] }, p2: { hand: ['Test Spark'] } });
    s = cast(s, 'Test Hallowed Reprieve');
    s = advanceTo(s, 2, 'main1');
    s = settleP2Bolt(s, 'p1');
    expect(s.result).toMatchObject({ winner: 'p2' });
  });
  function settleP2Bolt(s0: GameState, target: 'p1' | 'p2', name = 'Test Spark'): GameState {
    let s = s0;
    if (s.turn.number === 1 && s.pending?.player === 'p1') s = pass(s); // p1 passes priority; p2 gets it in the same step (instant speed)
    const castBy = s.pending?.player === 'p2' ? 'p2' : 'p1';
    return resolveAll(drive(act(s, { type: 'cast', player: castBy, card: find(s, name, 'hand', castBy) }), { targets: [[{ kind: 'player', id: target }]] }));
  }
});

describe('CR 701.10a, 613.4c: "double the power of each Dragon you control until end of turn" and "double its power"', () => {
  const BUTCHER = card('Test Pyre Chief', 'Creature — Orc', 'Whenever this creature attacks, double the power of each Dragon you control until end of turn.', ['2', '2']);
  const DRAKE = card('Test Ember Drake', 'Creature — Dragon', '', ['3', '3']);
  const OGRE = card('Test Cave Ogre', 'Creature — Ogre', '', ['4', '4']);
  const AXE = card('Test Twin Axe', 'Artifact — Equipment', 'Whenever equipped creature attacks, double its power until end of turn.\nEquip {0}');
  const defs = [BUTCHER, DRAKE, OGRE, AXE];
  function attackWith(s0: GameState, who: ObjectId): GameState {
    let s = s0;
    for (let guard = 0; guard < 120 && s.turn.number === 1; guard++) {
      const d = s.pending;
      if (d?.kind === 'declareAttackers') {
        s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: who, defender: 'p2' }] });
        return s.zones.stack.length > 0 ? resolveAll(s) : s;
      }
      if (d?.kind === 'priority') s = pass(s);
      else if (d) s = drive(s);
      else break;
    }
    return s;
  }
  it('are automated', () => { expect(full(BUTCHER)).toBe(true); expect(full(AXE)).toBe(true); });
  it('each Dragon you control gets +N/+0 where N is its own power; another creature and the attacker itself are unchanged', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Pyre Chief', 'Test Ember Drake', 'Test Cave Ogre'] } });
    const drake = find(s0, 'Test Ember Drake', 'battlefield', 'p1');
    const ogre = find(s0, 'Test Cave Ogre', 'battlefield', 'p1');
    const chief = find(s0, 'Test Pyre Chief', 'battlefield', 'p1');
    const s = attackWith(s0, chief);
    expect(pt(s, drake)).toEqual([6, 3]);
    expect(pt(s, ogre)).toEqual([4, 4]);
    expect(pt(s, chief)).toEqual([2, 2]);
  });
  it('an opponent\'s Dragon is not doubled (you control)', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Pyre Chief'] }, p2: { battlefield: ['Test Ember Drake'] } });
    const drake = find(s0, 'Test Ember Drake', 'battlefield', 'p2');
    const s = attackWith(s0, find(s0, 'Test Pyre Chief', 'battlefield', 'p1'));
    expect(pt(s, drake)).toEqual([3, 3]);
  });
  it('"double its power": the equipped creature that attacks has its power doubled, a second creature does not', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Twin Axe', 'Test Ember Drake', 'Test Cave Ogre'] } });
    const axe = find(s, 'Test Twin Axe', 'battlefield', 'p1');
    const drake = find(s, 'Test Ember Drake', 'battlefield', 'p1');
    const ogre = find(s, 'Test Cave Ogre', 'battlefield', 'p1');
    s = activate(s, axe, { targets: [[obj(drake)]] }, 'k:0:1:0');
    s = attackWith(s, drake);
    expect(pt(s, drake)).toEqual([6, 3]);
    expect(pt(s, ogre)).toEqual([4, 4]);
  });
  it('the power doubled is the power as the ability resolves (CR 701.10b): a Dragon that already got +3/+0 this turn doubles 6, not 3', () => {
    const PUMP = card('Test Surge', 'Instant', 'Target creature gets +3/+0 until end of turn.');
    const s0 = scenario([], { defs: [...defs, PUMP], p1: { battlefield: ['Test Pyre Chief', 'Test Ember Drake'], hand: ['Test Surge'] } });
    const drake = find(s0, 'Test Ember Drake', 'battlefield', 'p1');
    let s = cast(s0, 'Test Surge', { targets: [[obj(drake)]] });
    expect(pt(s, drake)).toEqual([6, 3]);
    s = attackWith(s, find(s, 'Test Pyre Chief', 'battlefield', 'p1'));
    expect(pt(s, drake)).toEqual([12, 3]);
  });
});

describe('CR 700.2, 700.2b: "Choose any number --" on a triggered ability (none, some or all of the modes); a spell with that header stays manual', () => {
  const RAKE = card('Test Prank Rake', 'Creature \u2014 Imp', 'Whenever this creature deals combat damage to a player, choose any number --\n\u2022 You gain 2 life.\n\u2022 Each opponent loses 3 life.\n\u2022 You draw a card.', ['2', '2']);
  const hand = (s: GameState): number => s.zones.hand.p1!.length;
  function hit(modes: number[]): GameState {
    const s0 = scenario([], { defs: [RAKE], p1: { battlefield: ['Test Prank Rake'] } });
    const rake = find(s0, 'Test Prank Rake', 'battlefield', 'p1');
    let s = s0;
    for (let guard = 0; guard < 160 && s.turn.number === 1; guard++) {
      const d = s.pending;
      if (d?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: rake, defender: 'p2' }] });
      else if (d?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else if (d?.kind === 'priority') s = s.zones.stack.length > 0 ? resolveAll(s, { modes }) : s.turn.step === 'combatDamage' || s.turn.step === 'endCombat' || s.turn.step === 'main2' ? s : pass(s);
      else if (d) s = drive(s, { modes });
      else break;
      if (s.turn.step === 'main2') break;
    }
    return resolveAll(s, { modes });
  }
  it('is automated; a spell with the same header is not', () => {
    expect(full(RAKE)).toBe(true);
    expect(full(card('Test Prank Feast', 'Sorcery', 'Choose any number --\n\u2022 You gain 2 life.\n\u2022 You draw a card.'))).toBe(false);
  });
  it('none of the modes may be chosen: nothing happens besides the combat damage', () => {
    const s = hit([]);
    expect([life(s, 'p1'), life(s, 'p2'), hand(s)]).toEqual([20, 18, 0]);
  });
  it('two of the three modes: those two are done, the third is not', () => {
    const s = hit([0, 1]);
    expect([life(s, 'p1'), life(s, 'p2'), hand(s)]).toEqual([22, 15, 0]);
  });
  it('all three modes may be chosen', () => {
    const s = hit([0, 1, 2]);
    expect([life(s, 'p1'), life(s, 'p2'), hand(s)]).toEqual([22, 15, 1]);
  });
});

describe('CR 608.2h: a lasting effect of a triggered ability still reads "that much" as it begins (the event amount is kept unevaluated only inside a replacement)', () => {
  it('"Whenever you gain life, ~ gets +X/+X until end of turn" with X the life gained: 3 life gained is +3/+3 (review finding C1 of edh-players-3)', () => {
    const pan = card('Test Pan', 'Creature — Bear', 'Whenever you gain life, this creature gets +2/+2 until end of turn.', ['1', '1']);
    const m = (pan.faces[0]!.abilities[0] as unknown as { effect: { steps: { effects: { mods: Record<string, unknown>[] }[] }[] } }).effect.steps[0]!.effects[0]!.mods[0]!;
    m['power'] = { q: 'eventAmount' };
    m['toughness'] = { q: 'eventAmount' };
    const soul = card('Test Soul', 'Sorcery', 'You gain 3 life.');
    let s = scenario([], { defs: [pan, soul], p1: { battlefield: ['Test Pan'], hand: ['Test Soul'] } });
    s = cast(s, 'Test Soul');
    expect(pt(s, find(s, 'Test Pan', 'battlefield', 'p1'))).toEqual([4, 4]);
  });
});
