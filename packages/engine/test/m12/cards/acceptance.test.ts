/**
 * M12-3 (docs/design/m12-multiplayer.md 3): the acceptance cards design section 3 gives to M12-3, each played in a 3-4 player game (Free-for-All, CR 806),
 * and the multiplayer card shapes of this package: "the life lost this way" summed over every opponent (CR 119.3), "whenever a player loses the game"
 * (CR 603.9), "the player to your left / right" (CR 101.4, 103.1; m12 design D6), "attacks you or a planeswalker you control" (CR 506.3, 508.1b, 508.5), melee
 * (CR 702.121a), myriad (CR 702.116a), Edric, Bribery (CR 800.4a), Queen Marchesa (CR 724). Real fixture cards, or invented wordings compiled by the default
 * compiler (design 6.10). Goad and votes: goad.test.ts, vote.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { charsOfObject } from '../../../src/rules/characteristics';
import { act, answer, concede, drive, find, lifeOf, logHas, mpScenario, namesOn, pass, passUntil, playerOf, resolveStack } from '../rules/helpers';
import { legal, scenario } from '../../m3/scenario';

const synthetic = (name: string, type: string, cost: string, text: string, pt?: [string, string]): CardDef =>
  compileCard({ name, layout: 'normal', type_line: type, mana_cost: cost, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as unknown as OracleCard);

const VULTURE = synthetic('Test Vulture', 'Creature — Bird', '{2}{B}', 'Whenever a player loses the game, put five +1/+1 counters on this creature.', ['1', '1']);
const MOURNER = synthetic('Test Mourner', 'Enchantment', '{1}{W}', 'Whenever an opponent loses the game, you gain 5 life.');
const ROPE = synthetic('Test Rope', 'Artifact', '{1}', '{1}: The player to your left gains control of this artifact.');
const CORD = synthetic('Test Cord', 'Artifact', '{1}', '{1}: The player to your right gains control of this artifact.');
const WARDEN = synthetic('Test Warden', 'Enchantment', '{2}{B}', "Whenever a creature attacks you or a planeswalker you control, that creature's controller loses 1 life.");
const DEFS = [VULTURE, MOURNER, ROPE, CORD, WARDEN];

const SWAMPS = (n: number): string[] => Array(n).fill('Swamp') as string[];
const counters = (s: GameState, id: ObjectId): number => s.objects[id]!.counters['+1/+1'] ?? 0;

/** Cast `name` from `player`'s hand with the answers (of the cast, then of the resolution), then everyone passes until the stack is empty. */
function castAndResolve(s: GameState, name: string, answers: Parameters<typeof drive>[1] = [], player: PlayerId = 'p1', later: Parameters<typeof drive>[1] = []): GameState {
  return resolveStack(drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), answers), later);
}

/** Pass priority until `player` declares attackers (other players' declarations: none; blocks: none). */
function toAttacks(s: GameState, player: PlayerId): GameState {
  let t = s;
  for (let i = 0; i < 400; i++) {
    if (t.pending?.kind === 'declareAttackers' && t.pending.player === player) return t;
    if (t.pending?.kind === 'declareAttackers') { t = answer(t, { kind: 'declareAttackers', attacks: [] }); continue; }
    if (t.pending?.kind === 'declareBlockers') { t = answer(t, { kind: 'declareBlockers', blocks: [] }); continue; }
    if (t.pending?.kind !== 'priority') throw new Error(`unexpected ${t.pending?.kind}: ${t.pending?.prompt}`);
    t = pass(t);
  }
  throw new Error(`${player} never declared attackers`);
}
const attack = (s: GameState, attacks: { attacker: ObjectId; defender: string }[]): GameState =>
  answer(s, { kind: 'declareAttackers', attacks });

describe('CR 119.3: "you gain life equal to the life lost this way", summed over every opponent', () => {
  it('Gray Merchant of Asphodel: devotion 2, three opponents lose 2 each, Alice gains 6', () => {
    let s = mpScenario({ cards: ['Gray Merchant of Asphodel', 'Swamp'], zones: { p1: { hand: ['Gray Merchant of Asphodel'], battlefield: SWAMPS(5) } } });
    s = castAndResolve(s, 'Gray Merchant of Asphodel');
    expect([lifeOf(s, 'p1'), lifeOf(s, 'p2'), lifeOf(s, 'p3'), lifeOf(s, 'p4')]).toEqual([26, 18, 18, 18]);
  });

  it('Kokusho, the Evening Star: dies with two opponents left (Carol left the game): Alice gains 10', () => {
    let s = mpScenario({ cards: ['Kokusho, the Evening Star', 'Shock', 'Mountain'], zones: { p1: { battlefield: ['Kokusho, the Evening Star', 'Mountain'], hand: ['Shock'] } } });
    s = concede(s, 'p3').state;
    const kokusho = find(s, 'Kokusho, the Evening Star', 'battlefield', 'p1');
    s.objects[kokusho]!.damage = 4; // marked damage, so Shock's 2 is lethal (CR 704.5g)
    s = castAndResolve(s, 'Shock', [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: kokusho }] }]);
    expect([lifeOf(s, 'p1'), lifeOf(s, 'p2'), lifeOf(s, 'p4')]).toEqual([30, 15, 15]);
  });

  it('Exsanguinate with X = 3: three opponents lose 3 each, Alice gains 9 (only the life actually lost counts)', () => {
    let s = mpScenario({ cards: ['Exsanguinate', 'Swamp'], zones: { p1: { hand: ['Exsanguinate'], battlefield: SWAMPS(5) } }, setup: (x) => { x.players[3]!.life = 2; } });
    s = castAndResolve(s, 'Exsanguinate', [{ kind: 'chooseNumber', n: 3 }]);
    // Dan had 2 life: he loses 3 (life can go below 0, CR 119.3, 107.1b) and the game goes on without him
    expect([lifeOf(s, 'p1'), lifeOf(s, 'p2'), lifeOf(s, 'p3')]).toEqual([29, 17, 17]);
    expect(playerOf(s, 'p4').hasLost).toBe(true);
  });

  it('m12 design D16: in a two-player game Gray Merchant plays as written (one opponent loses 2, you gain 2)', () => {
    let s = scenario(['Gray Merchant of Asphodel', 'Swamp'], { p1: { hand: ['Gray Merchant of Asphodel'], battlefield: SWAMPS(5) } });
    s = resolveStack(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Gray Merchant of Asphodel', 'hand', 'p1') })));
    expect([lifeOf(s, 'p1'), lifeOf(s, 'p2')]).toEqual([22, 18]);
  });
});

describe('CR 603.9: "whenever a player loses the game" triggers on a loss or a leave, whatever the reason', () => {
  it('a concession (CR 104.3a) and a loss for 0 life (CR 704.5a) each trigger it; "an opponent" only for opponents', () => {
    let s = mpScenario({ defs: DEFS, cards: ['Shock', 'Mountain'], zones: { p1: { battlefield: ['Test Vulture', 'Test Mourner', 'Mountain'], hand: ['Shock'] } }, setup: (x) => { x.players[2]!.life = 2; } });
    const vulture = find(s, 'Test Vulture', 'battlefield', 'p1');
    s = resolveStack(drive(concede(s, 'p2').state)); // the two triggers are ordered first (CR 603.3b)
    expect(counters(s, vulture)).toBe(5);
    expect(lifeOf(s, 'p1')).toBe(25);
    s = castAndResolve(s, 'Shock', [{ kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p3' }] }]);
    expect(playerOf(s, 'p3').hasLost).toBe(true);
    expect(counters(s, vulture)).toBe(10);
    expect(lifeOf(s, 'p1')).toBe(30);
  });

  it('CR 800.4a, 800.4d: the permanents of the player who left trigger nothing (they left with their owner)', () => {
    let s = mpScenario({ defs: DEFS, cards: [], zones: { p2: { battlefield: ['Test Vulture', 'Test Mourner'] } } });
    s = resolveStack(concede(s, 'p2').state);
    expect(namesOn(s)).not.toContain('Test Vulture');
    expect(s.zones.stack).toEqual([]);
  });
});

describe('m12 design D6, CR 101.4, 103.1: "the player to your left / right"', () => {
  it('the player to Alice\'s left is Bob, to her right Dan; a player who left has no seat (CR 800.4a): Carol is next', () => {
    let s = mpScenario({ defs: DEFS, cards: ['Plains'], zones: { p1: { battlefield: ['Test Rope', 'Test Cord', 'Plains', 'Plains'] } } });
    const rope = find(s, 'Test Rope', 'battlefield', 'p1');
    const cord = find(s, 'Test Cord', 'battlefield', 'p1');
    s = concede(s, 'p2').state;
    const activate = (t: GameState, id: ObjectId): GameState => {
      const a = legal(t, 'p1', 'activate').find((x) => (x.action as { source?: string }).source === id)!;
      return resolveStack(drive(act(t, a.action)));
    };
    s = activate(s, rope);
    expect(s.objects[rope]!.controller).toBe('p3');
    s = activate(s, cord);
    expect(s.objects[cord]!.controller).toBe('p4');
  });
});

describe('CR 506.3, 508.1b, 508.5: "whenever a creature attacks you or a planeswalker you control"', () => {
  it('an attack on Alice or on her planeswalker triggers it; an attack on another player does not', () => {
    let s = mpScenario({
      defs: DEFS, cards: ['Grizzly Bears', 'Jace Beleren'],
      zones: { p1: { battlefield: ['Test Warden', { name: 'Jace Beleren', counters: { loyalty: 3 } }] }, p2: { battlefield: ['Grizzly Bears', 'Grizzly Bears', 'Grizzly Bears'] } },
    });
    const [a, b, c] = s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2');
    const jace = find(s, 'Jace Beleren', 'battlefield', 'p1');
    s = toAttacks(s, 'p2');
    s = attack(s, [{ attacker: a!, defender: 'p1' }, { attacker: b!, defender: jace }, { attacker: c!, defender: 'p3' }]);
    s = resolveStack(drive(s));
    expect(lifeOf(s, 'p2')).toBe(18); // two triggers: the attack on Alice and the attack on her Jace
    // CR 508.5: the history records Alice as the defending player of the attack on her planeswalker (m12 design E42)
    const onJace = s.history.find((e) => e.ev === 'attacks' && e.facts['defenderKind'] === 'planeswalker');
    expect(onJace?.facts['defendingPlayer']).toBe('p1');
  });
});

describe('CR 702.121a: melee (Adriana, Captain of the Guard)', () => {
  it('each attacker with melee gets +1/+1 for each opponent Alice attacked with a creature this combat; a planeswalker is not its controller', () => {
    let s = mpScenario({
      cards: ['Adriana, Captain of the Guard', 'Grizzly Bears', 'Jace Beleren'],
      zones: { p1: { battlefield: ['Adriana, Captain of the Guard', 'Grizzly Bears', 'Grizzly Bears'] }, p4: { battlefield: [{ name: 'Jace Beleren', counters: { loyalty: 3 } }] } },
    });
    const adriana = find(s, 'Adriana, Captain of the Guard', 'battlefield', 'p1');
    const [bears1, bears2] = s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Grizzly Bears');
    s = toAttacks(s, 'p1');
    s = attack(s, [{ attacker: adriana, defender: 'p2' }, { attacker: bears1!, defender: 'p3' }, { attacker: bears2!, defender: find(s, 'Jace Beleren', 'battlefield', 'p4') }]);
    s = resolveStack(drive(s));
    const pt = (id: ObjectId): string => { const c = charsOfObject(s, s.objects[id]!); return `${c.power}/${c.toughness}`; };
    // two opponents attacked (Bob and Carol; Dan only through his planeswalker, CR 702.121a): +2/+2 from each creature's own melee trigger
    expect([pt(adriana), pt(bears1!), pt(bears2!)]).toEqual(['6/6', '4/4', '4/4']);
  });
});

describe('m12 design D16: the cards that newly play fully, in a two-player game', () => {
  it('melee in a two-player game: one opponent attacked, +1/+1 (CR 702.121a)', () => {
    let s = scenario(['Adriana, Captain of the Guard'], { p1: { battlefield: ['Adriana, Captain of the Guard'] } });
    const adriana = find(s, 'Adriana, Captain of the Guard', 'battlefield', 'p1');
    s = toAttacks(s, 'p1');
    s = resolveStack(drive(attack(s, [{ attacker: adriana, defender: 'p2' }])));
    const c = charsOfObject(s, s.objects[adriana]!);
    expect(`${c.power}/${c.toughness}`).toBe('5/5');
  });

  it("Council's Judgment in a two-player game: both players vote; Bribery searches the opponent's library", () => {
    let s = scenario(["Council's Judgment", 'Grizzly Bears', 'Plains'], { p1: { hand: ["Council's Judgment"], battlefield: ['Plains', 'Plains', 'Plains'] }, p2: { battlefield: ['Grizzly Bears'] } });
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p2');
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, "Council's Judgment", 'hand', 'p1') }));
    for (let i = 0; i < 4 && s.pending?.kind === 'priority'; i++) s = pass(s);
    s = answer(s, { kind: 'chooseObjects', ids: [bears] });
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', player: 'p2' });
    s = answer(s, { kind: 'chooseObjects', ids: [bears] });
    expect(s.zones.exile).toHaveLength(1);
  });
});

describe('CR 702.116a: myriad (Blade of Selves) in a 4-player game', () => {
  it('for each opponent other than the defending player, a token copy that is tapped and attacking that player', () => {
    let s = mpScenario({
      cards: ['Blade of Selves', 'Grizzly Bears'],
      zones: { p1: { battlefield: ['Blade of Selves', 'Grizzly Bears'] } },
      setup: (x) => { x.objects[find(x, 'Blade of Selves', 'battlefield', 'p1')]!.attachedTo = find(x, 'Grizzly Bears', 'battlefield', 'p1'); },
    });
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p1');
    s = toAttacks(s, 'p1');
    s = attack(s, [{ attacker: bears, defender: 'p2' }]);
    for (let i = 0; i < 40 && (s.zones.stack.length > 0 || s.pending?.kind !== 'priority'); i++) {
      if (s.pending?.kind === 'yesNo') { s = answer(s, { kind: 'yesNo', yes: true }); continue; }
      if (s.pending?.kind === 'priority') { s = pass(s); continue; }
      s = drive(s);
      if (s.pending?.kind !== 'priority' && s.pending?.kind !== 'yesNo') break;
    }
    const attackers = s.combat?.attackers ?? [];
    expect(attackers.map((a) => a.defendingPlayer).sort()).toEqual(['p2', 'p3', 'p4']);
  });
});

describe('Edric, Spymaster of Trest: "deals combat damage to one of your opponents, its controller may draw a card"', () => {
  it('Bob\'s creature deals combat damage to Carol (Alice\'s opponent): Bob may draw; damage to Alice herself does not trigger it', () => {
    let s = mpScenario({ cards: ['Edric, Spymaster of Trest', 'Grizzly Bears'], zones: { p1: { battlefield: ['Edric, Spymaster of Trest'] }, p2: { battlefield: ['Grizzly Bears', 'Grizzly Bears'] } } });
    const [a, b] = s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2');
    s = toAttacks(s, 'p2');
    s = attack(s, [{ attacker: a!, defender: 'p3' }, { attacker: b!, defender: 'p1' }]);
    const hand = s.zones.hand['p2']!.length;
    s = passUntil(s, (x) => x.pending?.kind === 'yesNo', 'the Edric question');
    expect(s.pending).toMatchObject({ kind: 'yesNo', player: 'p2' });
    s = answer(s, { kind: 'yesNo', yes: true });
    s = resolveStack(s);
    expect(s.zones.hand['p2']!.length).toBe(hand + 1);
    expect(s.zones.stack).toEqual([]);
  });
});

describe('Bribery (m12 design 3; CR 701.23a, 800.4a)', () => {
  const cast = () => {
    const s = mpScenario({ cards: ['Bribery', 'Island', 'Grizzly Bears'], zones: { p1: { hand: ['Bribery'], battlefield: ['Island', 'Island', 'Island', 'Island', 'Island'] }, p2: { library: ['Grizzly Bears'] } } });
    return castAndResolve(s, 'Bribery', [{ kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] }], 'p1', [{ kind: 'chooseObjects', ids: [find(s, 'Grizzly Bears', 'library', 'p2')] }]);
  };

  it("searches the target opponent's library: the creature enters under Alice's control, owned by Bob; then Bob shuffles", () => {
    const s = cast();
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    expect(s.objects[bears]).toMatchObject({ owner: 'p2', controller: 'p1' });
    expect(s.log.some((l) => /Bob shuffles/.test(l.text))).toBe(true);
  });

  it('CR 800.4a: when Bob (its owner) leaves, the creature leaves the game with him; when Alice leaves instead, it is exiled', () => {
    const s = cast();
    const gone = concede(s, 'p2').state;
    expect(namesOn(gone)).not.toContain('Grizzly Bears');
    const exiled = concede(s, 'p1').state;
    expect(exiled.zones.exile.map((id) => exiled.objects[id]!.defId)).toContain('Grizzly Bears');
  });
});

describe('Queen Marchesa: "if an opponent is the monarch" (CR 724.1, 603.4)', () => {
  it('Bob is the monarch at Alice\'s upkeep: she creates the Assassin; when she is the monarch, nothing', () => {
    let s = mpScenario({ cards: ['Queen Marchesa'], zones: { p1: { battlefield: ['Queen Marchesa'] } }, setup: (x) => { x.designations.monarch = 'p2'; } });
    s = passUntil(s, (x) => x.turn.number === 5 && x.turn.step === 'upkeep' && x.zones.stack.length > 0, 'the trigger at Alice\'s next upkeep', 600);
    s = resolveStack(s);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && s.objects[id]!.kind === 'token')).toHaveLength(1);
  });
});
