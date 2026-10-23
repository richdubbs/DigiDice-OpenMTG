/**
 * FAST5 T70: the shapes of parser/templates/zz-fast5/t70.json played through the engine with synthetic cards compiled by the game's default compiler
 * (wordings are invented, design 6.10).
 *
 *   CR 611.2a, 611.2c, 601.2a, 305.1, 400.7   "Exile the top two cards of your library. You may play those cards this turn." / "Exile the top card of your
 *                                             library. Until end of turn, you may play that card." (cast spells and play lands from exile, those cards only,
 *                                             this turn only)
 *   CR 107.3a, 608.2h, 202.3                  "Exile the top X cards of your library, where X is one plus the mana value of the sacrificed artifact."
 *   CR 722.3a, 608.2c                         "Then if an opponent controls more creatures than you, ~ becomes prepared."
 *   CR 601.2a, 603.4                          "Then if ~ was cast from anywhere other than your hand, put a +1/+1 counter on each Spirit you control."
 *   CR 107.1a, 122.1                          "put a +1/+1 counter on each of them for every three cards in your graveyard"
 *   CR 122.1, 701.27a, 111.4                  "Then if there are three or more landmark counters on it, remove those counters, transform ~, and create three Treasure tokens."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, battlefieldNames, find, legal, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Every ability of the card automated (experimental templates cap the card at partial, never an ability). */
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

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
function activate(s: GameState, name: string, zone: 'battlefield' | 'graveyard' = 'battlefield', targets: TargetChoice[][] = [], answers: DecisionAnswer[] = []): GameState {
  const id = find(s, name, zone, 'p1');
  const la = legal(s, 'p1', 'activate').find((a) => a.object === id && !a.isMana);
  if (!la) throw new Error(`no activated ability of ${name}`);
  return settle(act(s, la.action), targets, answers);
}
const exiled = (s: GameState): string[] => s.zones.exile.map((id) => s.objects[id]!.defId);
/** The cards of `name` in exile that the player may cast now. */
const castable = (s: GameState, id: ObjectId): boolean => legal(s, 'p1', 'cast').some((a) => a.object === id);

const ELF = card('Test Elf', 'Creature — Elf', '', ['2', '2'], '{W}');
const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '3'], '{3}');
const BIRD = card('Test Bird', 'Creature — Bird', '', ['1', '1'], '{1}');
const FREE = card('Test Free Spirit', 'Creature — Spirit', '', ['1', '1'], '{0}');

describe('CR 611.2a, 611.2c, 305.1, 400.7: "Exile the top two cards of your library. You may play those cards this turn."', () => {
  const WILD = card('Test Wild Ark', 'Artifact', '{T}: Exile the top two cards of your library. You may play those cards this turn.');
  it('is automated: both exiled cards can be cast from exile this turn with their normal cost, and no other exiled card can', () => {
    expect(automated(WILD)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Wild Ark', 'Plains', 'Plains', 'Plains', 'Plains'], library: ['Test Elf', 'Test Bird', 'Test Ogre'], exile: ['Test Free Spirit'] }, defs: [WILD, ELF, BIRD, OGRE, FREE] });
    let s = resolve(activate(s0, 'Test Wild Ark'));
    expect(exiled(s).sort()).toEqual(['Test Bird', 'Test Elf', 'Test Free Spirit']);
    const elf = find(s, 'Test Elf', 'exile', 'p1');
    const bird = find(s, 'Test Bird', 'exile', 'p1');
    const spirit = find(s, 'Test Free Spirit', 'exile', 'p1');
    expect(castable(s, elf)).toBe(true);
    expect(castable(s, bird)).toBe(true);
    expect(castable(s, spirit)).toBe(false); // exiled by something else: not named by the permission (CR 400.7)
    // the opponent never gets the permission (CR 611.2a: "you")
    expect(legal(s, 'p2').some((a) => a.object === elf || a.object === bird)).toBe(false);
    s = resolve(settle(act(s, legal(s, 'p1', 'cast').find((a) => a.object === bird)!.action)));
    expect(battlefieldNames(s, 'p1')).toContain('Test Bird');
    expect(castable(s, elf)).toBe(true);
  });
  it('a land exiled this way is played from exile and uses the land play of the turn (CR 305.2)', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Wild Ark'], library: ['Plains', 'Plains'] }, defs: [WILD] });
    let s = resolve(activate(s0, 'Test Wild Ark'));
    const lands = legal(s, 'p1', 'playLand');
    expect(lands.length).toBe(2);
    s = act(s, lands[0]!.action);
    expect(s.players.find((p) => p.id === 'p1')!.landsPlayedThisTurn).toBe(1);
    expect(legal(s, 'p1', 'playLand').length).toBe(0); // one land play per turn
  });
  it('the permission ends with the turn (CR 611.2a)', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Wild Ark', 'Plains'], library: ['Test Elf', 'Test Bird'] }, defs: [WILD, ELF, BIRD] });
    let s = resolve(activate(s0, 'Test Wild Ark'));
    const elf = find(s, 'Test Elf', 'exile', 'p1');
    const bird = find(s, 'Test Bird', 'exile', 'p1');
    s = advanceTo(s, 3, 'main1');
    expect(castable(s, elf)).toBe(false);
    expect(castable(s, bird)).toBe(false);
  });
  it('"them" is the same permission as "those cards"', () => {
    const THEM = card('Test Them Ark', 'Artifact', '{T}: Exile the top three cards of your library. You may play them this turn.');
    expect(automated(THEM)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Them Ark', 'Plains', 'Plains', 'Plains', 'Plains'], library: ['Test Elf', 'Test Bird', 'Test Ogre'] }, defs: [THEM, ELF, BIRD, OGRE] });
    const s = resolve(activate(s0, 'Test Them Ark'));
    for (const n of ['Test Elf', 'Test Bird', 'Test Ogre']) expect(castable(s, find(s, n, 'exile', 'p1')), n).toBe(true);
  });
});

describe('CR 611.2a, 611.2c, 400.7: "Exile the top card of your library. Until end of turn, you may play that card."', () => {
  const EMBER = card('Test Ember Hound', 'Creature — Hound', '{T}: Exile the top card of your library. Until end of turn, you may play that card.', ['1', '1']);
  it('is automated: the exiled card can be cast this turn and only it', () => {
    expect(automated(EMBER)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Ember Hound', 'Plains'], library: ['Test Elf'], exile: ['Test Ogre'] }, defs: [EMBER, ELF, OGRE] });
    let s = resolve(activate(s0, 'Test Ember Hound'));
    const elf = find(s, 'Test Elf', 'exile', 'p1');
    expect(castable(s, elf)).toBe(true);
    expect(castable(s, find(s, 'Test Ogre', 'exile', 'p1'))).toBe(false);
    s = advanceTo(s, 3, 'main1');
    expect(castable(s, elf)).toBe(false);
  });
});

describe('CR 107.3a, 202.3, 608.2h: "Exile the top X cards of your library, where X is one plus the mana value of the sacrificed artifact."', () => {
  const VAULT = card('Test Vault', 'Artifact', '{T}, Sacrifice another artifact: Exile the top X cards of your library, where X is one plus the mana value of the sacrificed artifact. You may play those cards this turn.');
  const ROCK = card('Test Rock', 'Artifact', '', undefined, '{1}');
  const BIG_ROCK = card('Test Big Rock', 'Artifact', '', undefined, '{3}');
  const LIB = ['Test Elf', 'Test Bird', 'Test Ogre', 'Test Free Spirit', 'Test Elf', 'Test Bird'];
  it('is automated: X is one more than the mana value of the artifact the cost sacrificed (read from its last known information)', () => {
    expect(automated(VAULT)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Vault', 'Test Big Rock', 'Plains'], library: LIB }, defs: [VAULT, BIG_ROCK, ELF, BIRD, OGRE, FREE] });
    const s = resolve(activate(s0, 'Test Vault'));
    expect(exiled(s).length).toBe(4); // 1 + 3
    expect(battlefieldNames(s, 'p1')).not.toContain('Test Big Rock');
    for (const id of s.zones.exile) expect(castable(s, id) || s.objects[id]!.defId === 'Test Ogre', s.objects[id]!.defId).toBe(true); // the Ogre costs {3}: one Plains is not enough
  });
  it('a one-mana artifact gives two cards', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Vault', 'Test Rock', 'Plains'], library: LIB }, defs: [VAULT, ROCK, ELF, BIRD, OGRE, FREE] });
    const s = resolve(activate(s0, 'Test Vault'));
    expect(exiled(s).length).toBe(2);
  });
});

// ---- the real cards (fixture list fast5-t70-cards.txt), compiled by the default compiler ----------------------------------------------------------
import { getCard } from '../../fixtures';
const real = (name: string): CardDef => compileCard(getCard(name));
const castFrom = (s: GameState, name: string, zone: 'hand' | 'graveyard'): GameState => {
  const id = find(s, name, zone, 'p1');
  const la = legal(s, 'p1', 'cast').find((a) => a.object === id);
  if (!la) throw new Error(`cannot cast ${name} from ${zone}`);
  return settle(act(s, la.action));
};
const countersOf = (s: GameState, id: ObjectId): number => s.objects[id]!.counters['+1/+1'] ?? 0;

describe('CR 601.2a, 608.2c: "Then if this spell was cast from anywhere other than your hand, put a +1/+1 counter on each Spirit you control." (Antiquities on the Loose)', () => {
  const ANT = real('Antiquities on the Loose');
  const tokens = (s: GameState): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
  it('is automated, and cast from the hand the Spirits get no counters', () => {
    expect(automated(ANT)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Antiquities on the Loose'], battlefield: ['Plains', 'Plains', 'Plains'] }, defs: [ANT] });
    const s = resolve(castFrom(s0, 'Antiquities on the Loose', 'hand'));
    expect(tokens(s).length).toBe(2);
    for (const t of tokens(s)) expect(countersOf(s, t)).toBe(0);
  });
  it('cast with flashback from the graveyard, each Spirit you control gets a counter', () => {
    const s0 = scenario([], { p1: { graveyard: ['Antiquities on the Loose'], battlefield: ['Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains'] }, defs: [ANT] });
    const s = resolve(castFrom(s0, 'Antiquities on the Loose', 'graveyard'));
    expect(tokens(s).length).toBe(2);
    for (const t of tokens(s)) expect(countersOf(s, t)).toBe(1);
  });
  it('a copy of the spell was not cast from anywhere (CR 707.10): no counters, even though it was not cast from the hand', () => {
    const ECHO = card('Test Echo', 'Instant', 'Copy target sorcery spell you control.', undefined, '{0}');
    const s0 = scenario([], { p1: { hand: ['Antiquities on the Loose', 'Test Echo'], battlefield: ['Plains', 'Plains', 'Plains'] }, defs: [ANT, ECHO] });
    let s = castFrom(s0, 'Antiquities on the Loose', 'hand');
    const spell = s.zones.stack[s.zones.stack.length - 1]!;
    const echo = find(s, 'Test Echo', 'hand', 'p1');
    const la = legal(s, 'p1', 'cast').find((a) => a.object === echo)!;
    s = settle(act(s, la.action), [[{ kind: 'object', id: spell }]]);
    s = resolve(resolve(resolve(s)));
    expect(tokens(s).length).toBe(4);
    expect(tokens(s).map((t) => countersOf(s, t)), JSON.stringify(s.log?.slice(-12))).toEqual([0, 0, 0, 0]);
  });
});

describe('CR 722.3a, 608.2c: "Then if an opponent controls more creatures than you, ~ becomes prepared." (Emeritus of Truce)', () => {
  const EM = real('Emeritus of Truce // Swords to Plowshares');
  const run = (opponentElves: number, target: 'p1' | 'p2'): { prepared: boolean; s: GameState } => {
    const s0 = scenario([], {
      p1: { hand: ['Emeritus of Truce // Swords to Plowshares'], battlefield: ['Plains', 'Plains', 'Plains'] },
      p2: { battlefield: Array.from({ length: opponentElves }, () => 'Test Elf') },
      defs: [EM, ELF],
    });
    const cast = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Emeritus of Truce // Swords to Plowshares', 'hand', 'p1') }));
    const s = resolve(settle(pass(pass(cast)), [[{ kind: 'player', id: target }]])); // the creature spell resolves; its enters trigger asks for a target player; then it resolves
    const id = s.zones.battlefield.find((x) => s.objects[x]!.defId === 'Emeritus of Truce // Swords to Plowshares')!;
    return { prepared: s.objects[id]!.prepared === true, s };
  };
  it('is automated', () => {
    expect(automated(EM)).toBe(true);
  });
  it('becomes prepared when an opponent controls more creatures than you do after the token (the token goes to the chosen player)', () => {
    expect(run(3, 'p1').prepared).toBe(true); // you: Emeritus + Inkling = 2; the opponent: 3
  });
  it('does not become prepared when the creatures are equal or fewer', () => {
    expect(run(2, 'p1').prepared).toBe(false); // 2 against 2
    expect(run(1, 'p1').prepared).toBe(false);
  });
  it('the token can be given to the opponent: then the opponent controls more still', () => {
    const r = run(2, 'p2'); // you: Emeritus = 1; the opponent: 2 Elves + Inkling = 3
    expect(r.prepared).toBe(true);
  });
});

describe('CR 601.2a, 122.1, 107.1a: "If this spell was cast from a graveyard, put a +1/+1 counter on each of them for every three cards in your graveyard." (Recursive Recruitment)', () => {
  const RR = real('Recursive Recruitment');
  const ISLAND = card('Test Island', 'Land', '{T}: Add {U}.');
  const SWAMP = card('Test Swamp', 'Land', '{T}: Add {B}.');
  const lands = ['Test Island', 'Test Swamp', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains'];
  const cadets = (s: GameState): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
  it('is automated; cast from the hand it puts no counters', () => {
    expect(automated(RR)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Recursive Recruitment'], battlefield: lands, graveyard: ['Test Elf', 'Test Elf', 'Test Elf'] }, defs: [RR, ISLAND, SWAMP, ELF] });
    const s = resolve(castFrom(s0, 'Recursive Recruitment', 'hand'));
    expect(cadets(s).map((t) => countersOf(s, t))).toEqual([0, 0]);
  });
  it('with flashback, each token gets one counter for every three cards in the graveyard (rounded down)', () => {
    const gy = (n: number): string[] => ['Recursive Recruitment', ...Array.from({ length: n }, () => 'Test Elf')];
    const run = (others: number): number[] => {
      const s0 = scenario([], { p1: { graveyard: gy(others), battlefield: lands }, defs: [RR, ISLAND, SWAMP, ELF] });
      const s = resolve(castFrom(s0, 'Recursive Recruitment', 'graveyard'));
      return cadets(s).map((t) => countersOf(s, t));
    };
    expect(run(2)).toEqual([0, 0]);
    expect(run(3)).toEqual([1, 1]);
    expect(run(8)).toEqual([2, 2]);
    expect(run(9)).toEqual([3, 3]);
  });
});

describe('CR 122.1, 701.27a, 111.4: "Then if there are three or more landmark counters on it, remove those counters, transform ~, and create three Treasure tokens." (Treasure Map)', () => {
  const MAP = real('Treasure Map // Treasure Cove');
  const treasures = (s: GameState): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
  it('is automated', () => {
    expect(automated(MAP)).toBe(true);
  });
  it('with two counters the third makes it transform, drops the counters and makes three Treasures', () => {
    const s0 = scenario([], { p1: { battlefield: [{ name: 'Treasure Map // Treasure Cove', counters: { landmark: 2 } }, 'Plains'], library: ['Test Elf', 'Test Bird'] }, defs: [MAP, ELF, BIRD] });
    const id0 = find(s0, 'Treasure Map // Treasure Cove', 'battlefield', 'p1');
    const s = resolve(activate(s0, 'Treasure Map // Treasure Cove'), [{ kind: 'chooseObjects', ids: [] }]);
    const id = s.zones.battlefield.find((x) => s.objects[x]!.defId === 'Treasure Map // Treasure Cove')!;
    expect(id).toBeDefined();
    expect(s.objects[id]!.face).toBe(1); // transformed (CR 701.27a)
    expect(s.objects[id]!.counters['landmark'] ?? 0).toBe(0);
    expect(treasures(s).length).toBe(3);
    expect(id0).toBeDefined();
  });
  it('with fewer counters it only adds one', () => {
    const s0 = scenario([], { p1: { battlefield: [{ name: 'Treasure Map // Treasure Cove', counters: { landmark: 1 } }, 'Plains'], library: ['Test Elf', 'Test Bird'] }, defs: [MAP, ELF, BIRD] });
    const s = resolve(activate(s0, 'Treasure Map // Treasure Cove'), [{ kind: 'chooseObjects', ids: [] }]);
    const id = s.zones.battlefield.find((x) => s.objects[x]!.defId === 'Treasure Map // Treasure Cove')!;
    expect(s.objects[id]!.face).toBe(0);
    expect(s.objects[id]!.counters['landmark']).toBe(2);
    expect(treasures(s).length).toBe(0);
  });
});

describe('CR 608.2d, 611.2c: "Whenever you cast a noncreature spell, you may exile the top card of your library. Until end of turn, you may play that card." (the optional exile and its permission)', () => {
  const OTTER = card('Test Storm Otter', 'Creature — Otter', 'Whenever you cast a noncreature spell, you may exile the top card of your library. Until end of turn, you may play that card.', ['1', '1']);
  const BOLT = card('Test Spark', 'Instant', 'You gain 1 life.', undefined, '{0}');
  const cast = (answers: DecisionAnswer[]): GameState => {
    const s0 = scenario([], { p1: { hand: ['Test Spark'], battlefield: ['Test Storm Otter', 'Plains', 'Plains'], library: ['Test Elf', 'Test Bird'] }, defs: [OTTER, BOLT, ELF, BIRD] });
    return settle(pass(pass(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Spark', 'hand', 'p1') })))), [], answers);
  };
  it('is automated', () => {
    expect(automated(OTTER)).toBe(true);
  });
  it('when the controller exiles the card they may play it this turn, and only it', () => {
    let s = cast([{ kind: 'yesNo', yes: true }]);
    if (s.zones.stack.length > 0) s = resolve(s);
    const elf = find(s, 'Test Elf', 'exile', 'p1');
    expect(castable(s, elf)).toBe(true);
    expect(exiled(s)).toEqual(['Test Elf']);
    const next = advanceTo(s, 3, 'main1');
    expect(castable(next, elf)).toBe(false);
  });
  it('when the controller declines, nothing is exiled and nothing can be played', () => {
    let s = cast([{ kind: 'yesNo', yes: false }]);
    if (s.zones.stack.length > 0) s = resolve(s);
    expect(exiled(s)).toEqual([]);
    expect(s.zones.library['p1']!.some((id) => s.objects[id]!.defId === 'Test Elf')).toBe(true);
  });
});

describe('CR 611.2a, 513.1, 400.7: "Until your next end step, you may play those cards."', () => {
  const DRUID = card('Test Druid Totem', 'Artifact', '{T}: Exile the top two cards of your library. Until your next end step, you may play those cards.');
  it('is automated; the permission lasts until that end step begins (not through it) and is for those cards only', () => {
    expect(automated(DRUID)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Druid Totem', 'Plains', 'Plains'], library: ['Test Elf', 'Test Bird'], exile: ['Test Ogre'] }, defs: [DRUID, ELF, BIRD, OGRE] });
    const s = resolve(activate(s0, 'Test Druid Totem'));
    const elf = find(s, 'Test Elf', 'exile', 'p1');
    const bird = find(s, 'Test Bird', 'exile', 'p1');
    expect(castable(s, elf)).toBe(true);
    expect(castable(s, bird)).toBe(true);
    expect(castable(s, find(s, 'Test Ogre', 'exile', 'p1'))).toBe(false);
    const later = advanceTo(s, 1, 'main2');
    expect(castable(later, elf)).toBe(true);
    const end = advanceTo(s, 1, 'end');
    expect(castable(end, elf)).toBe(false);
    expect(castable(end, bird)).toBe(false);
  });
  it('the single card ("it" / "that card") is the same permission', () => {
    const ONE = card('Test Druid Idol', 'Artifact', '{T}: Exile the top card of your library. Until your next end step, you may play that card.');
    expect(automated(ONE)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Druid Idol', 'Plains'], library: ['Test Elf'] }, defs: [ONE, ELF] });
    const s = resolve(activate(s0, 'Test Druid Idol'));
    expect(castable(s, find(s, 'Test Elf', 'exile', 'p1'))).toBe(true);
    expect(castable(advanceTo(s, 1, 'end'), find(s, 'Test Elf', 'exile', 'p1'))).toBe(false);
  });
});

describe('CR 608.2h, 202.3: "Draw cards equal to the mana value of the sacrificed permanent." (the wording the new reading of a sacrificed object opened)', () => {
  const CURIOSITY = card('Test Curiosity', 'Sorcery', 'As an additional cost to cast this spell, sacrifice an artifact or creature.\nDraw cards equal to the mana value of the sacrificed permanent.');
  const BIG_ROCK = card('Test Big Rock', 'Artifact', '', undefined, '{3}');
  it('is automated and draws as many cards as the mana value of what the additional cost sacrificed', () => {
    expect(automated(CURIOSITY)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Curiosity'], battlefield: ['Test Big Rock'], library: ['Test Elf', 'Test Bird', 'Test Ogre', 'Test Free Spirit', 'Test Elf'] }, defs: [CURIOSITY, BIG_ROCK, ELF, BIRD, OGRE, FREE] });
    const before = s0.zones.hand['p1']!.length;
    const s = resolve(castFrom(s0, 'Test Curiosity', 'hand'));
    expect(battlefieldNames(s, 'p1')).not.toContain('Test Big Rock');
    expect(s.zones.hand['p1']!.length).toBe(before - 1 + 3); // the spell left the hand, three cards were drawn
  });
});
