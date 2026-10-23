/**
 * FAST5X E29: impulse-draw permissions played through the engine with synthetic cards compiled by the game's default compiler (wordings are invented,
 * design 6.10).
 *
 *   CR 611.2a, 514.2   "Until the end of your next turn, you may play that card": through the rest of this turn and all of your next one; begun on an
 *                      opponent's turn, it ends at the end of your coming turn (core/durations.ts: `endOfNextTurn` becomes `endOfTurn` as that turn begins)
 *   CR 305.1, 305.2    a land played from exile this way is the turn's land play
 *   CR 611.2a, 500.4   "You may play those cards until your next end step": over as that end step begins
 *   CR 611.2b, 400.7   "for as long as it remains exiled": the permission is gone with the card (a card that leaves exile and comes back is a new object)
 *   CR 609.4b          "..., and mana of any type can be spent to cast it": a red spell paid with white mana; not without the rider
 *   CR 608.2g, 609.4b  "you may cast target creature card from an opponent's graveyard, and mana of any type can be spent to cast that spell" (cast now)
 *                      "you may play that card if you control a Wizard": the condition is read each time the permission is (statics/play-permits.ts)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, battlefieldNames, find, legal, pass, scenario } from '../../m3/scenario';
import { tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

/** Answer the decisions that come up: target groups from `targets`, then `answers`; pay costs automatically; stop at priority. */
function settle(s0: GameState, targets: TargetChoice[][] = [], answers: DecisionAnswer[] = []): GameState {
  let s = s0;
  const groups = [...targets];
  const queue = [...answers];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 20; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'chooseTargets' && groups.length > 0) s = answer(s, { kind: 'chooseTargets', targets: groups.shift()! });
    else if (queue.length > 0) s = answer(s, queue.shift()!);
    else break;
  }
  return s;
}
const resolve = (s: GameState, answers: DecisionAnswer[] = []): GameState => settle(pass(pass(s)), [], answers);
function activate(s: GameState, name: string, player: 'p1' | 'p2' = 'p1', targets: TargetChoice[][] = []): GameState {
  const id = find(s, name, 'battlefield', player);
  const la = legal(s, player, 'activate').find((a) => a.object === id && !a.isMana);
  if (!la) throw new Error(`no activated ability of ${name}`);
  return settle(act(s, la.action), targets);
}
/** May p1 cast (or play) the object now? */
const offered = (s: GameState, id: ObjectId, kind: 'cast' | 'playLand' = 'cast'): boolean => legal(s, 'p1', kind).some((a) => a.object === id);
const exiledId = (s: GameState, name: string): ObjectId => find(s, name, 'exile', 'p1');
/** The durations of the permissions in force. */
const permitDurations = (s: GameState): string[] => s.continuousEffects.filter((e) => e.effect.s === 'permit').map((e) => e.duration.d);

const FLASHER = card('Test Flasher', 'Creature — Faerie', 'Flash', ['1', '1'], '{1}');
const ELF = card('Test Elf', 'Creature — Elf', '', ['2', '2'], '{W}');
const IMP = card('Test Imp', 'Creature — Imp', '', ['2', '2'], '{R}');
const BRUTE = card('Test Brute', 'Creature — Ogre', '', ['3', '3'], '{R}{R}');
const WIZARD = card('Test Wizard', 'Creature — Human Wizard', '', ['1', '1'], '{1}');

describe('CR 611.2a, 514.2: "Until the end of your next turn, you may play that card."', () => {
  const ARK = card('Test Next-Turn Ark', 'Artifact', '{T}: Exile the top card of your library. Until the end of your next turn, you may play that card.');

  it('is automated with the duration endOfNextTurn (capability dur:endOfNextTurn)', () => {
    expect(automated(ARK)).toBe(true);
    expect(JSON.stringify(ARK.faces)).toContain('"duration":{"d":"endOfNextTurn","whose":{"ref":"you"}}');
  });

  it('begun during your own turn: usable this turn, on the opponent\'s turn (with flash) and all of your next turn; over in that turn\'s cleanup step', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Next-Turn Ark', 'Plains', 'Plains'], library: ['Test Flasher'] }, defs: [ARK, FLASHER] });
    let s = resolve(activate(s0, 'Test Next-Turn Ark'));
    const flasher = exiledId(s, 'Test Flasher');
    expect(offered(s, flasher)).toBe(true); // turn 1, yours
    expect(permitDurations(s)).toEqual(['endOfNextTurn']);
    s = advanceTo(s, 2, 'main1'); // the opponent's turn: the duration did not end in turn 1's cleanup step (CR 514.2 ends "until end of turn" only)
    s = pass(s); // p2 passes: p1 has priority during p2's main phase
    expect(s.pending?.player).toBe('p1');
    expect(offered(s, flasher)).toBe(true); // flash: cast on the opponent's turn
    expect(permitDurations(s)).toEqual(['endOfNextTurn']);
    s = advanceTo(s, 3, 'main1'); // your next turn began: from now on it lasts until the end of this turn
    expect(permitDurations(s)).toEqual(['endOfTurn']);
    expect(offered(s, flasher)).toBe(true);
    s = advanceTo(s, 4, 'upkeep'); // turn 3's cleanup step ended it
    expect(permitDurations(s)).toEqual([]);
    s = advanceTo(s, 5, 'main1');
    expect(offered(s, flasher)).toBe(false);
    expect(() => act(s, { type: 'cast', player: 'p1', card: flasher })).toThrow(/hand/);
  });

  it('begun during an opponent\'s turn: "your next turn" is your coming turn, and it ends at that turn\'s end', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Next-Turn Ark', 'Plains', 'Plains'], library: ['Test Flasher'] }, defs: [ARK, FLASHER] });
    let s = pass(advanceTo(s0, 2, 'main1')); // p1 has priority on p2's turn (p1 drew no card on turn 1, CR 103.8a)
    expect(s.turn.activePlayer).toBe('p2');
    s = pass(resolve(activate(s, 'Test Next-Turn Ark'))); // resolved; p2 (active) passes, so p1 has priority again
    const flasher = exiledId(s, 'Test Flasher');
    expect(s.pending?.player).toBe('p1');
    expect(offered(s, flasher)).toBe(true);
    s = advanceTo(s, 3, 'main1');
    expect(permitDurations(s)).toEqual(['endOfTurn']);
    expect(offered(s, flasher)).toBe(true);
    s = advanceTo(s, 4, 'main1'); // the end of p1's turn 3 ended it: it does not last through p1's turn 5
    expect(permitDurations(s)).toEqual([]);
    s = pass(s);
    expect(offered(s, flasher)).toBe(false);
  });

  it('a land exiled this way is played from exile on your next turn as that turn\'s land play (CR 305.1, 305.2)', () => {
    const LAND_ARK = card('Test Land Ark', 'Artifact', '{T}: Exile the top card of your library. You may play it until the end of your next turn.');
    expect(automated(LAND_ARK)).toBe(true);
    const s0 = scenario(['Mountain'], { p1: { battlefield: ['Test Land Ark'], library: ['Mountain'] }, defs: [LAND_ARK] });
    let s = resolve(activate(s0, 'Test Land Ark'));
    const mountain = exiledId(s, 'Mountain');
    s = advanceTo(s, 3, 'main1');
    const play = legal(s, 'p1', 'playLand').find((a) => a.object === mountain);
    expect(play).toBeDefined();
    s = act(s, play!.action);
    expect(battlefieldNames(s, 'p1')).toContain('Mountain');
    expect(s.players.find((p) => p.id === 'p1')!.landsPlayedThisTurn).toBe(1);
  });
});

describe('CR 611.2a: "You may play those cards until your next end step."', () => {
  const ARK = card('Test End-Step Ark', 'Artifact', '{T}: Exile the top two cards of your library. You may play those cards until your next end step.');
  it('both cards may be played until your end step begins, and not after', () => {
    expect(automated(ARK)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test End-Step Ark', 'Plains', 'Plains'], library: ['Test Flasher', 'Test Elf'] }, defs: [ARK, FLASHER, ELF] });
    let s = resolve(activate(s0, 'Test End-Step Ark'));
    const flasher = exiledId(s, 'Test Flasher');
    const elf = exiledId(s, 'Test Elf');
    expect(offered(s, flasher)).toBe(true);
    expect(offered(s, elf)).toBe(true);
    s = advanceTo(s, 1, 'main2');
    expect(offered(s, flasher)).toBe(true);
    s = advanceTo(s, 1, 'end'); // "until your next end step": over as it begins (CR 611.2a)
    expect(permitDurations(s)).toEqual([]);
    expect(offered(s, flasher)).toBe(false);
  });
});

describe('CR 611.2b, 400.7, 609.4b: "You may cast that card for as long as it remains exiled, and mana of any type can be spent to cast it."', () => {
  const THIEF = card('Test Mind Thief', 'Artifact', '{T}: Exile the top card of target opponent\'s library. You may cast that card for as long as it remains exiled, and mana of any type can be spent to cast it.');
  const PLAIN = card('Test Plain Thief', 'Artifact', '{T}: Exile the top card of target opponent\'s library. You may cast that card this turn.');
  const opp: TargetChoice[][] = [[{ kind: 'player', id: 'p2' }]];

  it('a red spell of the opponent\'s is cast with white mana (CR 609.4b), turns later (CR 611.2b)', () => {
    expect(automated(THIEF)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Mind Thief', 'Plains', 'Plains'] }, p2: { library: ['Test Brute'] }, defs: [THIEF, BRUTE] });
    let s = resolve(activate(s0, 'Test Mind Thief', 'p1', opp));
    const brute = find(s, 'Test Brute', 'exile', 'p2');
    expect(permitDurations(s)).toEqual(['remainsExiled']);
    s = advanceTo(s, 3, 'main1');
    expect(offered(s, brute)).toBe(true);
    s = resolve(settle(act(s, { type: 'cast', player: 'p1', card: brute })));
    expect(battlefieldNames(s, 'p1')).toContain('Test Brute'); // {R}{R} paid with two Plains
  });

  it('without the rider, the same red spell can\'t be paid with white mana', () => {
    expect(automated(PLAIN)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Plain Thief', 'Plains', 'Plains'] }, p2: { library: ['Test Imp'] }, defs: [PLAIN, IMP] });
    const s = resolve(activate(s0, 'Test Plain Thief', 'p1', opp));
    const imp = find(s, 'Test Imp', 'exile', 'p2');
    expect(offered(s, imp)).toBe(false);
  });

  it('the permission ends when the card leaves exile, and does not come back with a new object (CR 400.7)', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Mind Thief', 'Plains', 'Plains'] }, p2: { library: ['Test Imp'] }, defs: [THIEF, IMP] });
    let s = resolve(activate(s0, 'Test Mind Thief', 'p1', opp));
    const imp = find(s, 'Test Imp', 'exile', 'p2');
    expect(offered(s, imp)).toBe(true);
    // the card leaves exile for its owner's graveyard and comes back (each move is a new object, CR 400.7)
    s = tweak(s, (t) => {
      t.zones.exile = t.zones.exile.filter((id) => id !== imp);
      t.zones.graveyard['p2']!.push(imp);
      t.objects[imp]!.zone = 'graveyard';
    });
    expect(offered(s, imp)).toBe(false);
    s = advanceTo(s, 1, 'main2'); // a player received priority: the record is deleted (core/durations.ts#endDurations)
    expect(permitDurations(s)).toEqual([]);
  });
});

describe('CR 400.7, 601.3: the permission names the card where the earlier instruction put it (a target, a chosen card)', () => {
  const SCRIBE = card('Test Scribe', 'Artifact', '{T}: Exile target creature card from your graveyard. Until the end of your next turn, you may cast that card.');
  const PICKER = card('Test Picker', 'Artifact', '{T}: Target opponent exiles a card from their hand. You may play that card for as long as it remains exiled.');
  it('"exile target creature card from your graveyard ... you may cast that card": the card in exile is offered, on your next turn too', () => {
    expect(automated(SCRIBE)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Scribe', 'Plains', 'Plains'], graveyard: ['Test Elf'] }, defs: [SCRIBE, ELF] });
    const elfInYard = find(s0, 'Test Elf', 'graveyard', 'p1');
    let s = resolve(activate(s0, 'Test Scribe', 'p1', [[{ kind: 'object', id: elfInYard }]]));
    const elf = exiledId(s, 'Test Elf');
    expect(offered(s, elf)).toBe(true);
    s = advanceTo(s, 3, 'main1');
    expect(offered(s, elf)).toBe(true);
    s = resolve(settle(act(s, { type: 'cast', player: 'p1', card: elf })));
    expect(battlefieldNames(s, 'p1')).toContain('Test Elf');
  });
  it('"target opponent exiles a card from their hand. You may play that card for as long as it remains exiled": the card the opponent chose', () => {
    expect(automated(PICKER)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Picker', 'Plains', 'Plains'] }, p2: { hand: ['Test Elf'] }, defs: [PICKER, ELF] });
    const elfInHand = find(s0, 'Test Elf', 'hand', 'p2');
    let s = pass(pass(activate(s0, 'Test Picker', 'p1', [[{ kind: 'player', id: 'p2' }]])));
    if (s.pending?.kind !== 'priority') s = settle(s, [], [{ kind: 'chooseObjects', ids: [elfInHand] } as DecisionAnswer]); // the opponent's choice (CR 608.2d)
    const elf = find(s, 'Test Elf', 'exile', 'p2');
    expect(s.pending?.player).toBe('p1');
    expect(offered(s, elf)).toBe(true);
  });
});

describe('CR 608.2g, 609.4b: "you may cast target creature card from an opponent\'s graveyard, and mana of any type can be spent to cast that spell"', () => {
  const RAIDER = card('Test Grave Raider', 'Creature — Human Rogue', 'When Test Grave Raider enters, you may cast target creature card from an opponent\'s graveyard, and mana of any type can be spent to cast that spell.', ['1', '1'], '{1}');
  it('the card is cast as the trigger resolves, paid with mana of another type', () => {
    expect(automated(RAIDER)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Grave Raider'], battlefield: ['Plains', 'Plains', 'Plains'] }, p2: { graveyard: ['Test Brute'] }, defs: [RAIDER, BRUTE] });
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Grave Raider', 'hand', 'p1') }));
    s = resolve(s); // the creature resolves; its trigger goes on the stack
    const brute = find(s, 'Test Brute', 'graveyard', 'p2');
    s = settle(s, [[{ kind: 'object', id: brute }]]);
    s = resolve(s, [{ kind: 'yesNo', yes: true }]); // the trigger resolves: "Cast it", paid with two Plains
    s = resolve(s); // the spell resolves
    expect(battlefieldNames(s, 'p1')).toContain('Test Brute');
  });
});

describe('"For as long as it remains exiled, you may play it if you control a Wizard." (the condition read each time)', () => {
  const ARK = card('Test Wizard Ark', 'Artifact', '{T}: Exile the top card of your library. Until the end of your next turn, you may play that card if you control a Wizard.');
  it('the card is offered only while you control a Wizard', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Wizard Ark', 'Plains', 'Plains'], library: ['Test Elf'], hand: ['Test Wizard'] }, defs: [ARK, ELF, WIZARD] });
    let s = resolve(activate(s0, 'Test Wizard Ark'));
    const elf = exiledId(s, 'Test Elf');
    expect(offered(s, elf)).toBe(false);
    s = resolve(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Wizard', 'hand', 'p1') })));
    expect(battlefieldNames(s, 'p1')).toContain('Test Wizard');
    expect(offered(s, elf)).toBe(true);
  });
});
