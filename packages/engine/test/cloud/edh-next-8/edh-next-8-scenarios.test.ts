/**
 * Commander lane edh-next, round edh-next-8: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the game's default compiler, in
 * 4-player games. Each test is named after the rule it checks and the groups have their negative cases. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com).
 *
 *   CR 601.2f, 118.7, 205.3m, 702.73a "This spell costs {1} less to cast for each creature type among creatures you control. This effect can't reduce the amount of mana this spell costs by more than {5}."
 *   CR 601.2f, 122.1                  "This spell costs {1} less to cast for each counter among players and permanents."
 *   CR 102.2, 601.2f, 701.23a, 101.4  "This spell costs {1} less to cast for each opponent you have." and "each player searches their library for up to two basic land cards, puts them onto the battlefield, then shuffles"
 *   CR 701.26a, 109.4                 "Target player untaps all basic lands they control."
 *   CR 701.5, 400.3, 108.3            "Return all artifacts target player owns to their hand."
 *   CR 201.2, 400.1                   "+1/+1 for each other creature on the battlefield named ~"
 *   CR 301.5, 613.4c, 611.3a          "Creatures you control that are equipped get +1/+0." / "During your turn, creatures you control that are equipped have first strike and vigilance."
 *   CR 508.1d, 611.2a                 "{T}: Each creature attacks this turn if able." (creatures that enter later are affected too, ruling 2013-07-01)
 *   CR 205.3m, 115.1                  "Destroy target non-Vampire, non-Werewolf, non-Zombie creature."
 *   CR 509.1a                         "This creature can block an additional seven creatures each combat."
 */
import { describe, expect, it } from 'vitest';
import { getChars, hasKeyword, legalActions, type DecisionAnswer, type GameState, type ObjectId, type PlayerId } from '../../../src/index';
import { act as mact, answer as manswer, find as mfind, mpScenario, pass as mpass, passUntil, reject } from '../../m12/rules/helpers';
import { card, full, pt, tokens } from '../cmd3/helpers';
import { declareAttackers, toDeclareAttackers } from '../../m4/helpers';

const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
const hand = (s: GameState, p: PlayerId): string[] => s.zones.hand[p]!.map((id) => s.objects[id]!.defId).filter((n) => n !== 'Plains');
const yard = (s: GameState, p: PlayerId): string[] => (s.zones.graveyard[p] ?? []).map((id) => s.objects[id]!.defId);
const bf = (s: GameState, defId: string, p?: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === defId && (p === undefined || s.objects[id]!.controller === p));

interface Script {
  targets?: ObjectId[];
  playerTargets?: PlayerId[];
  yes?: boolean | ((prompt: string, who: PlayerId) => boolean);
  objects?: (options: ObjectId[], prompt: string, state: GameState, who: PlayerId) => ObjectId[];
  numbers?: number[];
  /** Keeps passing priority (and declares no blockers) until this holds, as well as emptying the stack. */
  until?: (state: GameState) => boolean;
}
/** Answers whatever is asked, from the script, and passes priority until the stack is empty (or `until` holds). */
function run(s0: GameState, sc: Script = {}): GameState {
  let s = s0;
  const targets = [...(sc.targets ?? [])];
  const players = [...(sc.playerTargets ?? [])];
  const numbers = [...(sc.numbers ?? [])];
  for (let i = 0; i < 300; i++) {
    const p = s.pending;
    if (p === null || p === undefined) break;
    let a: DecisionAnswer | undefined;
    const d = p as unknown as { min?: number; max?: number; prompt: string; player: PlayerId };
    if (p.kind === 'chooseTargets') {
      const t = p as unknown as { objects?: ObjectId[]; min?: number };
      a = { kind: 'chooseTargets', targets: targets.length > 0 ? [{ kind: 'object', id: targets.shift()! }] : players.length > 0 ? [{ kind: 'player', id: players.shift()! }] : (t.objects ?? []).slice(0, t.min ?? 0).map((id) => ({ kind: 'object' as const, id })) } as DecisionAnswer;
    } else if (p.kind === 'payCost') a = { kind: 'payCost', auto: true };
    else if (p.kind === 'yesNo') a = { kind: 'yesNo', yes: typeof sc.yes === 'function' ? sc.yes(d.prompt, d.player) : sc.yes ?? true };
    else if (p.kind === 'chooseObjects') {
      const o = (p as unknown as { options: ObjectId[] }).options;
      a = { kind: 'chooseObjects', ids: sc.objects !== undefined ? sc.objects(o, d.prompt, s, d.player) : o.slice(0, d.min ?? 0) };
    } else if (p.kind === 'chooseOption') a = { kind: 'chooseOption', ids: [(p as unknown as { options: { id: string }[] }).options[0]!.id] };
    else if (p.kind === 'chooseNumber') a = { kind: 'chooseNumber', n: numbers.shift() ?? d.min ?? 0 } as DecisionAnswer;
    else if (p.kind === 'order') a = { kind: 'order', ids: (p as unknown as { items: { id: string }[] }).items.map((x) => x.id) };
    else if (p.kind === 'declareBlockers') a = { kind: 'declareBlockers', blocks: [] };
    else if (p.kind === 'priority') { if (s.zones.stack.length === 0 && (sc.until === undefined || sc.until(s))) break; s = mpass(s); continue; }
    else throw new Error(`unexpected ${p.kind}: ${p.prompt}`);
    s = manswer(s, a);
  }
  return s;
}
/** Passes priority to the main phase of the given turn's active player. */
const toMain = (s: GameState, player: PlayerId): GameState => passUntil(s, (x) => x.turn.activePlayer === player && x.turn.step === 'main1' && x.pending?.kind === 'priority', `${player}'s main phase`);
const attack = (s: GameState, id: ObjectId, defender: PlayerId): GameState => declareAttackers(toDeclareAttackers(s), [[id, defender]]);
const afterDamage = (s: GameState): boolean => s.turn.step === 'endCombat' || s.turn.step === 'main2';


const pendingOf = (s: GameState) => s.pending;
const castIt = (s: GameState, player: PlayerId, name: string): GameState => mact(s, { type: 'cast', player, card: mfind(s, name, 'hand', player) });
const counterOf = (s: GameState, p: PlayerId, kind: string): number => ((s.players.find((x) => x.id === p) as unknown as { counters?: Record<string, number> }).counters ?? {})[kind] ?? 0;
const blocksAnswer = (s: GameState, blocks: [ObjectId, ObjectId][]): GameState => manswer(s, { kind: 'declareBlockers', blocks: blocks.map(([blocker, attacker]) => ({ blocker, attacker })) } as DecisionAnswer);


const kw = (s: GameState, id: ObjectId, name: string): boolean => hasKeyword(getChars(s, id)!, name);
const cardAt = (name: string, type: string, text: string, ptv?: [string, string], cost = '{0}') => card(name, type, text, ptv, cost);
const castable = (s: GameState, p: PlayerId, name: string): boolean => legalActions(s, p).some((l) => l.kind === 'cast' && s.defs[s.objects[l.object!]!.defId]!.name === name);
const plains = (n: number): string[] => Array.from({ length: n }, () => 'Plains');
const objsOf = (s: GameState, name: string): ObjectId[] => s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === name);

// ---- Valiant Changeling ----------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 601.2f, 118.7, 205.3m: "This spell costs {1} less to cast for each creature type among creatures you control. This effect can\'t reduce the amount of mana this spell costs by more than {5}."', () => {
  const CHANGER = cardAt('Test Cap Shifter', 'Creature — Shapeshifter', "This spell costs {1} less to cast for each creature type among creatures you control. This effect can't reduce the amount of mana this spell costs by more than {5}.", ['2', '2'], '{7}');
  const BEAR = cardAt('Test Bear A', 'Creature — Bear', '', ['1', '1']);
  const WIZ = cardAt('Test Wizard A', 'Creature — Human Wizard', '', ['1', '1']);
  const ELF = cardAt('Test Elf A', 'Creature — Elf Druid', '', ['1', '1']);
  const GOB = cardAt('Test Goblin A', 'Creature — Goblin Rogue', '', ['1', '1']);
  const SHIFT = cardAt('Test Shifter A', 'Creature — Shapeshifter', 'Changeling', ['1', '1']);
  const defs = [CHANGER, BEAR, WIZ, ELF, GOB, SHIFT];
  const game = (mine: string[], theirs: string[], lands: number): GameState => toMain(mpScenario({ defs, zones: { p1: { hand: ['Test Cap Shifter'], battlefield: [...mine, ...plains(lands)] }, p2: { battlefield: theirs } } }), 'p1');
  it('is automated', () => expect(full(CHANGER)).toBe(true));
  it('one reduction for each different creature type among MY creatures: Bear, Human and Wizard are three, so {7} costs {4} (not castable with three lands, castable with four)', () => {
    expect(castable(game(['Test Bear A', 'Test Wizard A'], [], 3), 'p1', 'Test Cap Shifter')).toBe(false);
    expect(castable(game(['Test Bear A', 'Test Wizard A'], [], 4), 'p1', 'Test Cap Shifter')).toBe(true);
  });
  it('a type shared by two of my creatures counts once, and an opponent\'s creatures count not at all (the negative case)', () => {
    expect(castable(game(['Test Bear A', 'Test Bear A'], ['Test Wizard A', 'Test Elf A'], 5), 'p1', 'Test Cap Shifter')).toBe(false); // one type: {6}
    expect(castable(game(['Test Bear A', 'Test Bear A'], ['Test Wizard A', 'Test Elf A'], 6), 'p1', 'Test Cap Shifter')).toBe(true);
  });
  it('the reduction stops at {5}: a Changeling (every creature type) makes the spell cost {2}, never less (not castable with one land, castable with two)', () => {
    expect(castable(game(['Test Shifter A'], [], 1), 'p1', 'Test Cap Shifter')).toBe(false);
    expect(castable(game(['Test Shifter A'], [], 2), 'p1', 'Test Cap Shifter')).toBe(true);
    expect(castable(game(['Test Bear A', 'Test Wizard A', 'Test Elf A', 'Test Goblin A'], [], 1), 'p1', 'Test Cap Shifter')).toBe(false); // seven types: capped at {5}, {2}
  });
});

// ---- Lumbering Megasloth ---------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 601.2f, 122.1: "This spell costs {1} less to cast for each counter among players and permanents."', () => {
  const SLOTH = cardAt('Test Counter Sloth', 'Creature — Beast', 'This spell costs {1} less to cast for each counter among players and permanents.', ['2', '2'], '{6}');
  const BEAR = cardAt('Test Bear B', 'Creature — Bear', '', ['1', '1']);
  const defs = [SLOTH, BEAR];
  const game = (mine: object[], theirs: object[], lands: number): GameState => toMain(mpScenario({ defs, zones: { p1: { hand: ['Test Counter Sloth'], battlefield: [...mine as never[], ...plains(lands)] }, p3: { battlefield: theirs as never[] } } }), 'p1');
  it('is automated', () => expect(full(SLOTH)).toBe(true));
  it('counters of every kind on every player\'s permanents count: two +1/+1 on mine and one charge counter on an opponent\'s make {6} cost {3}', () => {
    const mine = [{ name: 'Test Bear B', counters: { '+1/+1': 2 } }];
    const theirs = [{ name: 'Test Bear B', counters: { charge: 1 } }];
    expect(castable(game(mine, theirs, 2), 'p1', 'Test Counter Sloth')).toBe(false);
    expect(castable(game(mine, theirs, 3), 'p1', 'Test Counter Sloth')).toBe(true);
  });
  it('counters the PLAYERS have count too (CR 122.1f): two poison counters on one player and an energy counter on another make {6} cost {3}', () => {
    const s = toMain(mpScenario({
      defs, zones: { p1: { hand: ['Test Counter Sloth'], battlefield: plains(3) } },
      setup: (st) => { st.players.find((x) => x.id === 'p2')!.poison = 2; (st.players.find((x) => x.id === 'p3') as unknown as { counters: Record<string, number> }).counters.energy = 1; },
    }), 'p1');
    expect(castable(s, 'p1', 'Test Counter Sloth')).toBe(true);
    const two = toMain(mpScenario({ defs, zones: { p1: { hand: ['Test Counter Sloth'], battlefield: plains(2) } }, setup: (st) => { st.players.find((x) => x.id === 'p2')!.poison = 2; (st.players.find((x) => x.id === 'p3') as unknown as { counters: Record<string, number> }).counters.energy = 1; } }), 'p1');
    expect(castable(two, 'p1', 'Test Counter Sloth')).toBe(false);
  });
  it('with no counters anywhere nothing is reduced (the negative case: {6} needs six lands)', () => {
    expect(castable(game([{ name: 'Test Bear B' }], [{ name: 'Test Bear B' }], 5), 'p1', 'Test Counter Sloth')).toBe(false);
    expect(castable(game([{ name: 'Test Bear B' }], [{ name: 'Test Bear B' }], 6), 'p1', 'Test Counter Sloth')).toBe(true);
  });
});

// ---- Avatar of Growth ------------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 102.2, 601.2f, 701.23a, 101.4: "This spell costs {1} less to cast for each opponent you have." and "each player searches their library for up to two basic land cards, puts them onto the battlefield, then shuffles"', () => {
  const AVATAR = cardAt('Test Growth Avatar', 'Creature — Avatar', 'This spell costs {1} less to cast for each opponent you have.\nWhen this creature enters, each player searches their library for up to two basic land cards, puts them onto the battlefield, then shuffles.', ['2', '2'], '{6}');
  const defs = [AVATAR];
  const game = (lands: number, players = 4): GameState => toMain(mpScenario({ defs, players, zones: { p1: { hand: ['Test Growth Avatar'], battlefield: plains(lands) } } }), 'p1');
  it('is automated', () => expect(full(AVATAR)).toBe(true));
  it('in a four-player game it has three opponents: {6} costs {3}; in a three-player game two opponents, {4}', () => {
    expect(castable(game(2), 'p1', 'Test Growth Avatar')).toBe(false);
    expect(castable(game(3), 'p1', 'Test Growth Avatar')).toBe(true);
    expect(castable(game(3, 3), 'p1', 'Test Growth Avatar')).toBe(false);
    expect(castable(game(4, 3), 'p1', 'Test Growth Avatar')).toBe(true);
  });
  it('every player (not only the caster) fetches up to two basic lands onto the battlefield untapped; the choice of how many is theirs (the second player takes one, the third none)', () => {
    let s = game(3);
    const before = (p: PlayerId): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && s.objects[id]!.defId === 'Plains').length;
    const counts0 = ['p1', 'p2', 'p3', 'p4'].map(before);
    const take: Record<string, number> = { p1: 2, p2: 1, p3: 0, p4: 2 };
    s = castIt(s, 'p1', 'Test Growth Avatar');
    s = run(s, { objects: (o, _prompt, _st, who) => o.slice(0, take[who]!) });
    const counts1 = ['p1', 'p2', 'p3', 'p4'].map(before);
    expect(counts1.map((n, i) => n - counts0[i]!)).toEqual([2, 1, 0, 2]);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Plains' && s.objects[id]!.owner !== 'p1' && s.objects[id]!.tapped)).toHaveLength(0);
  });
});

// ---- Early Harvest ---------------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 701.26a, 109.4: "Target player untaps all basic lands they control." (eff.edhn8.player.untaps.all.theyControl)', () => {
  const HARVEST = cardAt('Test Early Rite', 'Sorcery', 'Target player untaps all basic lands they control.');
  const WASTE = cardAt('Test Odd Land', 'Land', '');
  const defs = [HARVEST, WASTE];
  it('is automated', () => expect(full(HARVEST)).toBe(true));
  it('the target player\'s tapped basic lands untap; their nonbasic land and another player\'s basic lands stay tapped', () => {
    let s = toMain(mpScenario({ defs, zones: { p1: { hand: ['Test Early Rite'] }, p3: { battlefield: [{ name: 'Plains', tapped: true }, { name: 'Plains', tapped: true }, { name: 'Test Odd Land', tapped: true }] }, p2: { battlefield: [{ name: 'Plains', tapped: true }] } } }), 'p1');
    s = run(castIt(s, 'p1', 'Test Early Rite'), { playerTargets: ['p3'] });
    const mine = (p: PlayerId, name: string): boolean[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && s.objects[id]!.defId === name).map((id) => s.objects[id]!.tapped);
    expect(mine('p3', 'Plains')).toEqual([false, false]);
    expect(mine('p3', 'Test Odd Land')).toEqual([true]);
    expect(mine('p2', 'Plains')).toEqual([true]);
  });
});

// ---- Hurkyl's Recall -------------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 701.5, 400.3, 108.3: "Return all artifacts target player owns to their hand." (eff.edhn8.return.all.playerOwns.theirHand; ruling 2004-10-04)', () => {
  const RECALL = cardAt('Test Recall Rite', 'Instant', 'Return all artifacts target player owns to their hand.');
  const TRINKET = cardAt('Test Trinket B', 'Artifact', '');
  const defs = [RECALL, TRINKET];
  it('is automated', () => expect(full(RECALL)).toBe(true));
  it('returns the artifacts the player OWNS whoever controls them (a stolen one too); an artifact they control but do not own stays; a creature or another owner\'s artifact stays', () => {
    let s = toMain(mpScenario({
      defs,
      zones: { p1: { hand: ['Test Recall Rite'] }, p3: { battlefield: ['Test Trinket B', 'Test Trinket B'] }, p2: { battlefield: ['Test Trinket B'] } },
      setup: (st) => {
        const t3 = st.zones.battlefield.filter((id) => st.objects[id]!.owner === 'p3');
        st.objects[t3[1]!]!.controller = 'p2'; // stolen from p3: p3 still owns it
        const t2 = st.zones.battlefield.find((id) => st.objects[id]!.owner === 'p2')!;
        st.objects[t2]!.controller = 'p3'; // p3 controls it but does not own it
      },
    }), 'p1');
    s = run(castIt(s, 'p1', 'Test Recall Rite'), { playerTargets: ['p3'] });
    expect(s.zones.hand.p3!.filter((id) => s.objects[id]!.defId === 'Test Trinket B')).toHaveLength(2);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Trinket B' && s.objects[id]!.owner === 'p2')).toHaveLength(1);
    expect(s.zones.hand.p2!.filter((id) => s.objects[id]!.defId === 'Test Trinket B')).toHaveLength(0);
  });
});

// ---- Relentless Rats -------------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 201.2, 400.1: "This creature gets +1/+1 for each other creature on the battlefield named ~."', () => {
  const RAT = cardAt('Test Pack Rat', 'Creature — Rat', 'This creature gets +1/+1 for each other creature on the battlefield named Test Pack Rat.', ['2', '2']);
  const OTHER = cardAt('Test Not Rat', 'Creature — Rat', '', ['2', '2']);
  const defs = [RAT, OTHER];
  it('is automated', () => expect(full(RAT)).toBe(true));
  it('each Rat counts the OTHER creatures with its name of every player: three Rats are 4/4 each, a creature with another name adds nothing, a lone Rat is 2/2', () => {
    const s = toMain(mpScenario({ defs, zones: { p1: { battlefield: ['Test Pack Rat', 'Test Pack Rat', 'Test Not Rat'] }, p2: { battlefield: ['Test Pack Rat'] } } }), 'p1');
    for (const id of objsOf(s, 'Test Pack Rat')) expect(pt(s, id)).toBe('4/4');
    const lone = toMain(mpScenario({ defs, zones: { p1: { battlefield: ['Test Pack Rat', 'Test Not Rat'] } } }), 'p1');
    expect(pt(lone, objsOf(lone, 'Test Pack Rat')[0]!)).toBe('2/2');
  });
});

// ---- Hexgold Hoverwings / Long-Lost Lances ---------------------------------------------------------------------------------------------------------------------------------
describe('CR 301.5, 613.4c, 611.3a: "Creatures you control that are equipped get +1/+0." and "During your turn, creatures you control that are equipped have first strike and vigilance."', () => {
  const WINGS = cardAt('Test Wing Gear', 'Artifact — Equipment', 'Equipped creature has flying.\nCreatures you control that are equipped get +1/+0.\nEquip {2}');
  const LANCE = cardAt('Test Lance Gear', 'Artifact — Equipment', 'During your turn, creatures you control that are equipped have first strike and vigilance.\nEquip {2}');
  const BEAR = cardAt('Test Bear C', 'Creature — Bear', '', ['2', '2']);
  const defs = [WINGS, LANCE, BEAR];
  const game = (): GameState => toMain(mpScenario({
    defs,
    zones: { p1: { battlefield: ['Test Wing Gear', 'Test Lance Gear', 'Test Bear C', 'Test Bear C', 'Test Bear C'] }, p2: { battlefield: ['Test Bear C'] } },
    setup: (st) => {
      const bears = st.zones.battlefield.filter((id) => st.objects[id]!.defId === 'Test Bear C');
      st.objects[st.zones.battlefield.find((id) => st.objects[id]!.defId === 'Test Wing Gear')!]!.attachedTo = bears[0]!; // p1's first Bear: wings
      st.objects[st.zones.battlefield.find((id) => st.objects[id]!.defId === 'Test Lance Gear')!]!.attachedTo = bears[1]!; // p1's second Bear: lance
    },
  }), 'p1');
  it('are automated', () => { for (const d of [WINGS, LANCE]) expect(full(d)).toBe(true); });
  it('every creature I control that is equipped (with any Equipment) gets +1/+0 while the Wings are on the battlefield; the unequipped Bear and the opponent\'s Bear do not', () => {
    const s = game();
    const bears = objsOf(s, 'Test Bear C').filter((id) => s.objects[id]!.controller === 'p1');
    expect(bears.map((id) => pt(s, id))).toEqual(['3/2', '3/2', '2/2']);
    expect(pt(s, objsOf(s, 'Test Bear C').find((id) => s.objects[id]!.controller === 'p2')!)).toBe('2/2');
    expect(kw(s, bears[0]!, 'flying')).toBe(true); // the Wings\' own "equipped creature has flying"
    expect(kw(s, bears[1]!, 'flying')).toBe(false);
  });
  it('first strike and vigilance only during my turn, only on equipped creatures I control', () => {
    const s = game();
    const bears = objsOf(s, 'Test Bear C').filter((id) => s.objects[id]!.controller === 'p1');
    expect(bears.map((id) => kw(s, id, 'first strike'))).toEqual([true, true, false]);
    const theirTurn = toMain(passUntil(s, (x) => x.turn.activePlayer === 'p2', 'the next turn'), 'p2');
    expect(bears.map((id) => kw(theirTurn, id, 'first strike'))).toEqual([false, false, false]);
  });
});

// ---- Goblin Diplomats ------------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 508.1d, 611.2a: "{T}: Each creature attacks this turn if able." (eff.edhn8.must.each.attacks; ruling 2013-07-01)', () => {
  const DIPLOMAT = cardAt('Test Rabble Envoy', 'Creature — Goblin', '{T}: Each creature attacks this turn if able.', ['1', '1']);
  const BEAR = cardAt('Test Bear D', 'Creature — Bear', '', ['2', '2']);
  const LATE = cardAt('Test Late Bear', 'Creature — Bear', 'Haste', ['2', '2']);
  const defs = [DIPLOMAT, BEAR, LATE];
  it('is automated', () => expect(full(DIPLOMAT)).toBe(true));
  it('creatures of every player must attack when able: an attack declaration that leaves out the untapped Bear is refused (CR 508.1d); a creature that enters after the ability resolved is affected too', () => {
    let s = toMain(mpScenario({ defs, zones: { p1: { hand: ['Test Late Bear'], battlefield: ['Test Rabble Envoy', 'Test Bear D'] }, p2: { battlefield: ['Test Bear D'] } } }), 'p1');
    const envoy = mfind(s, 'Test Rabble Envoy', 'battlefield', 'p1');
    s = run(mact(s, legalActions(s, 'p1').find((a) => a.kind === 'activate' && a.object === envoy)!.action));
    s = run(castIt(s, 'p1', 'Test Late Bear'));
    s = passUntil(s, (x) => x.pending?.kind === 'declareAttackers', 'declare attackers');
    const bear = bf(s, 'Test Bear D', 'p1')[0]!;
    const late = bf(s, 'Test Late Bear', 'p1')[0]!;
    const bad = reject(s, { kind: 'declareAttackers', attacks: [{ attacker: bear, defender: 'p2' }] } as never);
    expect(bad).toBeDefined();
    const ok = manswer(s, { kind: 'declareAttackers', attacks: [{ attacker: bear, defender: 'p2' }, { attacker: late, defender: 'p2' }] } as never);
    expect(ok.turn).toBeDefined(); // accepted (manswer throws on a refused answer)
  });
  it('the negative case: without the ability a creature may stay home', () => {
    let s = toMain(mpScenario({ defs, zones: { p1: { battlefield: ['Test Rabble Envoy', 'Test Bear D'] } } }), 'p1');
    s = passUntil(s, (x) => x.pending?.kind === 'declareAttackers', 'declare attackers');
    const ok = manswer(s, { kind: 'declareAttackers', attacks: [] } as never);
    expect(ok.turn).toBeDefined(); // accepted (manswer throws on a refused answer)
  });
});

// ---- Victim of Night -------------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 205.3m, 115.1: "Destroy target non-Vampire, non-Werewolf, non-Zombie creature."', () => {
  const VICTIM = cardAt('Test Night Rite', 'Instant', 'Destroy target non-Vampire, non-Werewolf, non-Zombie creature.');
  const BEAR = cardAt('Test Bear E', 'Creature — Bear', '', ['2', '2']);
  const VAMP = cardAt('Test Vamp E', 'Creature — Vampire', '', ['2', '2']);
  const WOLF = cardAt('Test Wolf E', 'Creature — Werewolf', '', ['2', '2']);
  const ZOMB = cardAt('Test Zomb E', 'Creature — Zombie Knight', '', ['2', '2']);
  const defs = [VICTIM, BEAR, VAMP, WOLF, ZOMB];
  it('is automated', () => expect(full(VICTIM)).toBe(true));
  it('only the Bear is a legal target: a Vampire, a Werewolf and a Zombie Knight (any one of the three types) are not', () => {
    const s = toMain(mpScenario({ defs, zones: { p1: { hand: ['Test Night Rite'] }, p2: { battlefield: ['Test Bear E', 'Test Vamp E', 'Test Wolf E', 'Test Zomb E'] } } }), 'p1');
    const cast0 = castIt(s, 'p1', 'Test Night Rite');
    const p = cast0.pending as unknown as { objects?: ObjectId[]; options?: ObjectId[] };
    const legal = (p.objects ?? p.options ?? []).map((id) => cast0.defs[cast0.objects[id]!.defId]!.name);
    expect(legal).toEqual(['Test Bear E']);
    const done = run(cast0, { targets: [bf(s, 'Test Bear E')[0]!] });
    expect(bf(done, 'Test Bear E')).toHaveLength(0);
    expect(bf(done, 'Test Vamp E')).toHaveLength(1);
  });
});

// ---- Watcher in the Web ----------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 509.1a: "This creature can block an additional seven creatures each combat." (sta.edhn8.self.extrablock.number)', () => {
  const WATCHER = cardAt('Test Web Watcher', 'Creature — Spider', 'Reach\nThis creature can block an additional seven creatures each combat.', ['1', '5']);
  const RAIDER = cardAt('Test Raider F', 'Creature — Bear', '', ['1', '1']);
  const WALL = cardAt('Test Plain Wall', 'Creature — Wall', '', ['1', '9']);
  const defs = [WATCHER, RAIDER, WALL];
  it('is automated', () => expect(full(WATCHER)).toBe(true));
  it('it blocks up to eight attackers; another creature without the ability still blocks one (the negative case), and a ninth attacker is refused', () => {
    let s = toMain(mpScenario({ defs, zones: { p1: { battlefield: Array.from({ length: 9 }, () => 'Test Raider F') }, p2: { battlefield: ['Test Web Watcher', 'Test Plain Wall'] } } }), 'p1');
    const raiders = bf(s, 'Test Raider F', 'p1');
    s = declareAttackers(toDeclareAttackers(s), raiders.map((r) => [r, 'p2'] as [ObjectId, string]));
    s = passUntil(s, (x) => x.pending?.kind === 'declareBlockers', 'the declare blockers decision');
    const watcher = bf(s, 'Test Web Watcher', 'p2')[0]!;
    const wall = bf(s, 'Test Plain Wall', 'p2')[0]!;
    const blocks = (ids: ObjectId[], by: ObjectId) => ids.map((attacker) => ({ blocker: by, attacker }));
    expect(reject(s, { kind: 'declareBlockers', blocks: blocks(raiders.slice(0, 9), watcher) } as never)).toBeDefined();
    expect(reject(s, { kind: 'declareBlockers', blocks: blocks(raiders.slice(0, 2), wall) } as never)).toBeDefined();
    const ok = manswer(s, { kind: 'declareBlockers', blocks: [...blocks(raiders.slice(0, 8), watcher), ...blocks([raiders[8]!], wall)] } as never);
    expect(ok.turn).toBeDefined(); // accepted (manswer throws on a refused answer)
  });
});
