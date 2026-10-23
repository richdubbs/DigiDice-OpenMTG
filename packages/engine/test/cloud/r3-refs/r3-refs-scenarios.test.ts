/**
 * Standard round 3, slice r3-refs (references and durations, tuning half): the shapes of this slice played through applyAction with synthetic cards compiled by
 * the game's default compiler (invented wordings, design 6.10). Nothing is mocked. The templates' evidence is these plays and the hand-verified golden cards of
 * test/m5/golden/cards/cloud-r3-refs-review.json.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, findAll, pass, scenario } from '../../m3/scenario';
import { getChars } from '../../../src/rules/characteristics';
import { declareAttackers, toDeclareAttackers } from '../../m4/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Every ability of the card automated (no manual node). */
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });

type Opts = { targets?: TargetChoice[][]; picks?: ObjectId[][]; answers?: DecisionAnswer[] };
/** Answer the decisions that come up, in order, until priority (or nothing scripted is left). */
function settle(s0: GameState, opts: Opts = {}): GameState {
  let s = s0;
  const groups = opts.targets ?? [];
  const picks = opts.picks ?? [];
  const queue = opts.answers ?? [];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'order') s = answer(s, { kind: 'order', ids: (s.pending as unknown as { items: { id: string }[] }).items.map((x) => x.id) });
    else if (s.pending.kind === 'chooseTargets' && groups.length > 0) s = answer(s, { kind: 'chooseTargets', targets: groups.shift()! });
    else if (s.pending.kind === 'chooseObjects' && picks.length > 0) s = answer(s, { kind: 'chooseObjects', ids: picks.shift()! });
    else if (queue.length > 0) s = answer(s, queue.shift()!);
    else break;
  }
  return s;
}
/** Pass priority until the stack is empty, answering what comes up. */
function drain(s0: GameState, opts: Opts = {}): GameState {
  let s = s0;
  for (let guard = 0; s.pending?.kind === 'priority' && s.zones.stack.length > 0 && guard < 12; guard++) s = settle(pass(pass(s)), opts);
  return s;
}
function cast(s0: GameState, name: string, opts: Opts = {}): GameState {
  const q = { targets: [...(opts.targets ?? [])], picks: [...(opts.picks ?? [])], answers: [...(opts.answers ?? [])] };
  return drain(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), q), q);
}
function activate(s0: GameState, source: ObjectId, opts: Opts = {}, ability = 'p:0:0'): GameState {
  const q = { targets: [...(opts.targets ?? [])], picks: [...(opts.picks ?? [])], answers: [...(opts.answers ?? [])] };
  return drain(settle(act(s0, { type: 'activate', player: 'p1', source, ability }), q), q);
}
/** Pass priority (declaring no attackers and no blockers) until `done`. */
function passTo(s0: GameState, done: (s: GameState) => boolean, opts: Opts = {}, max = 300): GameState {
  let s = s0;
  for (let guard = 0; guard < max && !done(s); guard++) {
    if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (s.pending?.kind === 'priority') s = pass(s);
    else s = settle(s, opts);
  }
  if (!done(s)) throw new Error(`never reached (turn ${s.turn.number} ${s.turn.step}, pending ${s.pending?.kind})`);
  return s;
}
const tokensOf = (s: GameState, sub: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && (getChars(s, id).subtypes ?? []).includes(sub));
const keywords = (s: GameState, id: ObjectId): string[] => getChars(s, id).abilities.map((a) => (a.def as { keyword?: string }).keyword ?? '');

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2'], '{1}{G}');

describe('CR 603.7, 603.7c, 608.2c: the sentence after "Whenever ... this turn, X." whose pronoun names only what that delayed trigger made or was triggered by is more of its instructions', () => {
  const POST = card('Test Outpost', 'Land', '{T}: Whenever you attack this turn, create two 1/1 white Soldier creature tokens that are tapped and attacking. Sacrifice them at the beginning of the next end step.');
  const RALLY = card('Test Rally', 'Sorcery', 'Whenever a creature you control attacks this turn, put a +1/+1 counter on it. It gains trample until end of turn.');
  it('is automated, and the second sentence is inside the delayed trigger', () => {
    expect(automated(POST)).toBe(true);
    expect(automated(RALLY)).toBe(true);
    const steps = (POST.faces[0]!.abilities[0] as unknown as { effect: { steps: { op: string; do?: { op: string }[] }[] } }).effect.steps;
    expect(steps.map((x) => x.op)).toEqual(['delay']);
    expect(steps[0]!.do!.map((x) => x.op)).toEqual(['createToken', 'delay']);
  });
  it('the tokens are created attacking when you attack, and the same tokens are sacrificed at the beginning of the next end step', () => {
    let s = scenario([], { p1: { battlefield: ['Test Outpost', 'Test Bear'] }, defs: [POST, BEAR] });
    s = activate(s, find(s, 'Test Outpost', 'battlefield', 'p1'));
    expect(tokensOf(s, 'Soldier')).toHaveLength(0);
    s = declareAttackers(toDeclareAttackers(s), [[find(s, 'Test Bear', 'battlefield', 'p1')]]);
    s = drain(settle(s));
    const made = tokensOf(s, 'Soldier');
    expect(made).toHaveLength(2);
    expect(made.every((id) => s.objects[id]!.tapped && s.combat?.attackers.some((a) => a.id === id))).toBe(true);
    s = passTo(s, (x) => x.turn.step === 'end' && x.zones.stack.length > 0);
    s = drain(s);
    expect(tokensOf(s, 'Soldier')).toHaveLength(0);
    expect(find(s, 'Test Bear', 'battlefield', 'p1')).toBeDefined();
  });
  it('"it" of the second sentence is the creature that attacked: it gets the counter and trample, the other creature nothing', () => {
    let s = scenario([], { p1: { hand: ['Test Rally'], battlefield: ['Test Bear', { name: 'Test Bear' }] }, defs: [RALLY, BEAR] });
    s = cast(s, 'Test Rally');
    const [a, b] = findAll(s, 'Test Bear', 'battlefield', 'p1');
    s = declareAttackers(toDeclareAttackers(s), [[a!]]);
    s = drain(settle(s));
    expect(s.objects[a!]!.counters['+1/+1']).toBe(1);
    expect(keywords(s, a!)).toContain('trample');
    expect(s.objects[b!]!.counters['+1/+1'] ?? 0).toBe(0);
    expect(keywords(s, b!)).not.toContain('trample');
  });
});

const pendingOptions = (s: GameState): ObjectId[] => (s.pending?.kind === 'chooseObjects' ? (s.pending as unknown as { options: ObjectId[] }).options : []);
const FOREST = card('Test Forest', 'Basic Land — Forest', '({T}: Add {G}.)');
const VAULT = card('Test Vault', 'Land', '{T}: Add {C}.');
const RELIC = card('Test Relic', 'Artifact', '');

describe('CR 608.2c, 701.23a: "Search your library for an artifact or land card and reveal it. Put it onto the battlefield tapped if it\'s a land card. Otherwise, put it into your hand. Then shuffle."', () => {
  const CHARM = card('Test Charm', 'Sorcery', "Search your library for an artifact or land card and reveal it. Put it onto the battlefield tapped if it's a land card. Otherwise, put it into your hand. Then shuffle.");
  it('is automated; a land card found goes onto the battlefield tapped', () => {
    expect(automated(CHARM)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Charm'], library: ['Test Vault', 'Test Relic', 'Test Bear'] }, defs: [CHARM, VAULT, RELIC, BEAR] });
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Charm', 'hand', 'p1') }));
    s = settle(pass(pass(s)));
    const offered = pendingOptions(s).map((id) => s.objects[id]!.defId);
    expect(offered).toEqual(expect.arrayContaining(['Test Relic', 'Test Vault']));
    expect(offered).not.toContain('Test Bear'); // the creature card is no artifact or land card
    s = drain(settle(s, { picks: [[find(s, 'Test Vault', 'library', 'p1')]] }));
    const v = find(s, 'Test Vault', 'battlefield', 'p1');
    expect(s.objects[v]!.tapped).toBe(true);
  });
  it('a card that is not a land card goes into your hand ("Otherwise")', () => {
    let s = scenario([], { p1: { hand: ['Test Charm'], library: ['Test Vault', 'Test Relic'] }, defs: [CHARM, VAULT, RELIC] });
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Charm', 'hand', 'p1') }));
    s = settle(pass(pass(s)));
    s = drain(settle(s, { picks: [[find(s, 'Test Relic', 'library', 'p1')]] }));
    expect(findAll(s, 'Test Relic', 'hand', 'p1')).toHaveLength(1);
    expect(findAll(s, 'Test Vault', 'library', 'p1')).toHaveLength(1);
  });
});

describe('CR 701.23a, 205.4a: "search your library for a creature or basic land card, reveal it, ..." (a basic land, or a creature of any kind)', () => {
  const CALL = card('Test Call', 'Sorcery', 'Search your library for a creature or basic land card, reveal it, put it into your hand, then shuffle.');
  it('is automated; a nonbasic land is not offered, a basic land and a creature are', () => {
    expect(automated(CALL)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Call'], library: ['Test Vault', 'Test Forest', 'Test Bear'] }, defs: [CALL, VAULT, FOREST, BEAR] });
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Call', 'hand', 'p1') }));
    s = settle(pass(pass(s)));
    const offered = pendingOptions(s).map((id) => s.objects[id]!.defId);
    expect(offered).toEqual(expect.arrayContaining(['Test Bear', 'Test Forest']));
    expect(offered).not.toContain('Test Vault');
    s = drain(settle(s, { picks: [[find(s, 'Test Forest', 'library', 'p1')]] }));
    expect(findAll(s, 'Test Forest', 'hand', 'p1')).toHaveLength(1);
  });
});

describe('CR 110.1, 400.7j: "You may put an artifact or creature card from your hand onto the battlefield. That permanent gains haste and ..."', () => {
  const VELOCITY = card('Test Velocity', 'Sorcery', 'You may put an artifact or creature card from your hand onto the battlefield. That permanent gains haste and "At the beginning of your end step, sacrifice this permanent."');
  it('is automated; the permanent put onto the battlefield has haste and is sacrificed at the beginning of your end step', () => {
    expect(automated(VELOCITY)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Velocity', 'Test Bear'] }, defs: [VELOCITY, BEAR] });
    s = cast(s, 'Test Velocity', { picks: [[find(s, 'Test Bear', 'hand', 'p1')]] });
    const b = find(s, 'Test Bear', 'battlefield', 'p1');
    expect(keywords(s, b)).toContain('haste');
    s = passTo(s, (x) => x.turn.step === 'end' && x.zones.stack.length > 0);
    s = drain(s);
    expect(findAll(s, 'Test Bear', 'graveyard', 'p1')).toHaveLength(1);
  });
});

describe('CR 607.2a, 608.2d, 400.3: "Put a card exiled with ~ into its owner\'s hand." (the card another ability of the object exiled)', () => {
  const VAULTKEEP = card('Test Keeper', 'Artifact', "When ~ enters, exile up to two target cards from graveyards.\n{T}: Put a card exiled with ~ into its owner's hand.", undefined, '{0}');
  it('is automated; you choose one of the linked cards, and it goes to its owner\'s hand', () => {
    expect(automated(VAULTKEEP)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Keeper'] }, p2: { graveyard: ['Test Bear', 'Test Relic'] }, defs: [VAULTKEEP, BEAR, RELIC] });
    const bear = find(s, 'Test Bear', 'graveyard', 'p2');
    const relic = find(s, 'Test Relic', 'graveyard', 'p2');
    s = cast(s, 'Test Keeper', { targets: [[obj(bear), obj(relic)]] });
    expect(findAll(s, 'Test Bear', 'exile', 'p2')).toHaveLength(1);
    s = activate(s, find(s, 'Test Keeper', 'battlefield', 'p1'), { picks: [[find(s, 'Test Bear', 'exile', 'p2')]] }, 'p:0:1');
    expect(findAll(s, 'Test Bear', 'hand', 'p2')).toHaveLength(1);
    expect(findAll(s, 'Test Relic', 'exile', 'p2')).toHaveLength(1);
  });
});

describe('CR 122.1, 608.2d, 205.1b: "Put two +1/+1 counters on a Forest you control. It becomes a 0/0 Elemental creature with haste. It\'s still a land." (a choice as it resolves, no target)', () => {
  const WAKE = card('Test Wake', 'Sorcery', "Put two +1/+1 counters on a Forest you control. It becomes a 0/0 Elemental creature with haste. It's still a land.");
  it('is automated; the chosen Forest is a 2/2 land creature with haste, the other Forest is unchanged', () => {
    expect(automated(WAKE)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Wake'], battlefield: ['Test Forest', 'Test Forest', 'Test Vault'] }, defs: [WAKE, FOREST, VAULT] });
    const [f1, f2] = findAll(s, 'Test Forest', 'battlefield', 'p1');
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Wake', 'hand', 'p1') }));
    s = settle(pass(pass(s)));
    expect(pendingOptions(s).sort()).toEqual([f1!, f2!].sort()); // only Forests you control
    s = drain(settle(s, { picks: [[f1!]] }));
    expect(s.objects[f1!]!.counters['+1/+1']).toBe(2);
    expect(getChars(s, f1!)).toMatchObject({ power: '2', toughness: '2' });
    expect(getChars(s, f1!).types).toEqual(expect.arrayContaining(['Land', 'Creature']));
    expect(keywords(s, f1!)).toContain('haste');
    expect(getChars(s, f2!).types).not.toContain('Creature');
  });
});

describe('CR 401.3, 608.2d: "The owner of target creature puts it into their library second from the top or on the bottom." (the owner chooses)', () => {
  const TRICK = card('Test Trick', 'Instant', 'The owner of target creature puts it into their library second from the top or on the bottom.');
  const optionAnswer = (s: GameState, want: string): DecisionAnswer => {
    const p = s.pending as unknown as { options: { id: string; label?: string }[] };
    const o = p.options.find((x) => x.id === want || x.label === want)!;
    return { kind: 'chooseOption', ids: [o.id] } as DecisionAnswer;
  };
  it('is automated; "second from the top" puts the card under the top card, "on the bottom" at the bottom; its owner chooses', () => {
    expect(automated(TRICK)).toBe(true);
    for (const [place, at] of [['second from the top', 1], ['bottom', -1]] as const) {
      let s = scenario([], { p1: { hand: ['Test Trick'] }, p2: { battlefield: ['Test Bear'], library: ['Test Relic', 'Test Vault'] }, defs: [TRICK, BEAR, RELIC, VAULT] });
      s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Trick', 'hand', 'p1') }), { targets: [[obj(find(s, 'Test Bear', 'battlefield', 'p2'))]] });
      s = settle(pass(pass(s)));
      expect(s.pending?.player).toBe('p2');
      s = drain(settle(answer(s, optionAnswer(s, place))));
      const lib = s.zones.library['p2']!.map((id) => s.objects[id]!.defId);
      expect(lib.at(at)).toBe('Test Bear');
      expect(lib.filter((n) => n === 'Test Bear')).toHaveLength(1);
    }
  });
});

describe('CR 701.23a, 201.2: "search your graveyard, hand and/or library for a card named A and/or a card named B and put them onto the battlefield"', () => {
  const SCOUT = card('Test Scout', 'Creature — Human', 'When this creature enters, you may search your graveyard, hand and/or library for a card named Test Relic and/or a card named Test Vault and put them onto the battlefield. If you search your library this way, shuffle.', ['1', '1']);
  const zonesAnswer = (s: GameState, zones: string[]): DecisionAnswer => ({ kind: 'chooseOption', ids: (s.pending as unknown as { options: { id: string }[] }).options.filter((o) => zones.includes(o.id)).map((o) => o.id) }) as DecisionAnswer;
  it('is automated; one card of each name at most, from the zones the player chooses; both go onto the battlefield', () => {
    expect(automated(SCOUT)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Scout', 'Test Relic'], graveyard: ['Test Vault', 'Test Relic'] }, defs: [SCOUT, RELIC, VAULT] });
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Scout', 'hand', 'p1') }));
    s = drain(settle(s));
    s = settle(s, { answers: [{ kind: 'yesNo', yes: true }] });
    expect(s.pending?.kind).toBe('chooseOption');
    s = settle(answer(s, zonesAnswer(s, ['graveyard', 'hand'])));
    // the first pick: a Relic (from the hand); the other Relics are no longer offered, the Vault is
    const handRelic = find(s, 'Test Relic', 'hand', 'p1');
    expect(pendingOptions(s)).toContain(handRelic);
    s = settle(answer(s, { kind: 'chooseObjects', ids: [handRelic] }));
    expect(pendingOptions(s).map((id) => s.objects[id]!.defId)).toEqual(['Test Vault']);
    s = drain(settle(answer(s, { kind: 'chooseObjects', ids: pendingOptions(s) })));
    expect(findAll(s, 'Test Relic', 'battlefield', 'p1')).toHaveLength(1);
    expect(findAll(s, 'Test Vault', 'battlefield', 'p1')).toHaveLength(1);
    expect(findAll(s, 'Test Relic', 'graveyard', 'p1')).toHaveLength(1);
  });
});

describe('CR 701.21a, 205.3m, 608.2c, 101.4: "For each player, you choose a creature that player controls. Then each player sacrifices all other creatures they control that don\'t share a creature type with the chosen creature they control."', () => {
  const WINNOW = card('Test Winnow', 'Sorcery', "For each player, you choose a creature that player controls. Then each player sacrifices all other creatures they control that don't share a creature type with the chosen creature they control.");
  const ELF = card('Test Elf', 'Creature — Elf Warrior', '', ['1', '1']);
  const ARCHER = card('Test Archer', 'Creature — Elf Archer', '', ['1', '1']);
  const GOBLIN = card('Test Goblin', 'Creature — Goblin Warrior', '', ['1', '1']);
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '3']);
  it('is automated; each player keeps the chosen creature and their creatures that share a creature type with it, and sacrifices the rest', () => {
    expect(automated(WINNOW)).toBe(true);
    let s = scenario([], {
      p1: { hand: ['Test Winnow'], battlefield: ['Test Elf', 'Test Archer', 'Test Ogre'] },
      p2: { battlefield: ['Test Goblin', 'Test Elf', 'Test Ogre'] },
      defs: [WINNOW, ELF, ARCHER, GOBLIN, OGRE],
    });
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Winnow', 'hand', 'p1') }));
    s = settle(pass(pass(s)));
    // p1's own creatures first (APNAP), then p2's: the Elf for p1, the Goblin for p2
    s = settle(answer(s, { kind: 'chooseObjects', ids: [find(s, 'Test Elf', 'battlefield', 'p1')] }));
    s = drain(settle(answer(s, { kind: 'chooseObjects', ids: [find(s, 'Test Goblin', 'battlefield', 'p2')] })));
    // p1 keeps the Elf and the Elf Archer (an Elf), sacrifices the Ogre; p2 keeps the Goblin, and the Elf (a Warrior, like the Goblin), sacrifices the Ogre
    expect(findAll(s, 'Test Elf', 'battlefield', 'p1')).toHaveLength(1);
    expect(findAll(s, 'Test Archer', 'battlefield', 'p1')).toHaveLength(1);
    expect(findAll(s, 'Test Ogre', 'graveyard', 'p1')).toHaveLength(1);
    expect(findAll(s, 'Test Goblin', 'battlefield', 'p2')).toHaveLength(1);
    expect(findAll(s, 'Test Elf', 'battlefield', 'p2')).toHaveLength(1);
    expect(findAll(s, 'Test Ogre', 'graveyard', 'p2')).toHaveLength(1);
  });
});

describe('CR 118.12a, 701.9a: "each opponent discards two cards unless they discard a nonland card"; CR 504.1, 402.1: "draw an additional card for each opponent who has one or fewer cards in hand"', () => {
  const RAID = card('Test Raid', 'Sorcery', 'Each opponent discards two cards unless they discard a nonland card.');
  const LOOT = card('Test Loot', 'Enchantment', 'At the beginning of your draw step, draw an additional card for each opponent who has one or fewer cards in hand.');
  it('is automated; an opponent who discards a nonland card discards only that card', () => {
    expect(automated(RAID)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Raid'] }, p2: { hand: ['Test Bear', 'Test Vault', 'Test Forest'] }, defs: [RAID, BEAR, VAULT, FOREST] });
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Raid', 'hand', 'p1') }));
    s = settle(pass(pass(s)), { answers: [{ kind: 'yesNo', yes: true }] });
    if (s.pending?.kind === 'chooseObjects') s = settle(answer(s, { kind: 'chooseObjects', ids: [find(s, 'Test Bear', 'hand', 'p2')] }));
    s = drain(settle(s));
    expect(findAll(s, 'Test Bear', 'graveyard', 'p2')).toHaveLength(1);
    expect(s.zones.hand['p2']).toHaveLength(2);
  });
  it('an opponent with no nonland card discards two cards', () => {
    let s = scenario([], { p1: { hand: ['Test Raid'] }, p2: { hand: ['Test Vault', 'Test Forest', 'Test Vault'] }, defs: [RAID, VAULT, FOREST] });
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Raid', 'hand', 'p1') }));
    s = settle(pass(pass(s)));
    if (s.pending?.kind === 'chooseObjects') s = settle(answer(s, { kind: 'chooseObjects', ids: (s.pending as unknown as { options: ObjectId[] }).options.slice(0, 2) }));
    s = drain(settle(s));
    expect(s.zones.hand['p2']).toHaveLength(1);
    expect(s.zones.graveyard['p2']).toHaveLength(2);
  });
  it('the draw step trigger draws one card for each opponent with one or fewer cards in hand, none otherwise', () => {
    expect(automated(LOOT)).toBe(true);
    // (the opponent draws a card in their own turn first: an empty hand is one card at your next draw step, one card is two)
    for (const [hand, extra] of [[[], 1], [['Test Vault'], 0]] as const) {
      let s = scenario([], { p1: { battlefield: ['Test Loot'] }, p2: { hand: [...hand] }, defs: [LOOT, VAULT, FOREST] });
      s = passTo(s, (x) => x.turn.number === 3 && x.turn.step === 'draw' && x.zones.stack.length > 0);
      const before = s.zones.hand['p1']!.length;
      s = drain(s);
      expect(s.zones.hand['p1']!.length - before).toBe(extra);
    }
  });
});

describe('CR 701.23a, 122.6, 614.1c: "Search your library and/or graveyard for an artifact creature card with mana value X or less and put it onto the battlefield with X additional +1/+1 counters on it. If X is 4 or greater, it gains haste until end of turn."', () => {
  const QUEST = card('Test Quest', 'Sorcery', 'Search your library and/or graveyard for an artifact creature card with mana value X or less and put it onto the battlefield with X additional +1/+1 counters on it. If X is 4 or greater, it gains haste until end of turn. If you search your library this way, shuffle.', undefined, '{X}');
  const BOT = card('Test Bot', 'Artifact Creature — Construct', '', ['1', '1'], '{2}');
  it('is automated; the card enters with X +1/+1 counters, and with haste only when X is 4 or greater', () => {
    expect(automated(QUEST)).toBe(true);
    for (const [x, haste] of [[2, false], [4, true]] as const) {
      let s = scenario([], { p1: { hand: ['Test Quest'], graveyard: ['Test Bot'], battlefield: ['Test Forest', 'Test Forest', 'Test Forest', 'Test Forest'] }, defs: [QUEST, BOT, FOREST] });
      s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Quest', 'hand', 'p1') }), { answers: [{ kind: 'chooseNumber', n: x }] });
      s = settle(pass(pass(s)));
      if (s.pending?.kind === 'chooseOption') s = settle(answer(s, { kind: 'chooseOption', ids: ['graveyard'] } as DecisionAnswer));
      if (s.pending?.kind === 'chooseObjects') s = settle(answer(s, { kind: 'chooseObjects', ids: [find(s, 'Test Bot', 'graveyard', 'p1')] }));
      s = drain(s);
      const b = find(s, 'Test Bot', 'battlefield', 'p1');
      expect(s.objects[b]!.counters['+1/+1']).toBe(x);
      expect(keywords(s, b).includes('haste')).toBe(haste);
    }
  });
});

describe('CR 608.2c, 400.7: "Exile any number of creatures you control, then return them to the battlefield under their owner\'s control. Then repeat this process X more times."', () => {
  const ROUND = card('Test Round', 'Sorcery', "Exile any number of creatures you control, then return them to the battlefield under their owner's control. Then repeat this process X more times.", undefined, '{X}');
  const HERALD = card('Test Herald', 'Creature — Human', '', ['1', '1']);
  it('is automated; with X = 2 the creatures chosen are exiled and returned three times, a new choice each time', () => {
    expect(automated(ROUND)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Round'], battlefield: ['Test Herald', 'Test Bear', 'Test Forest', 'Test Forest'] }, defs: [ROUND, HERALD, BEAR, FOREST] });
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Round', 'hand', 'p1') }), { answers: [{ kind: 'chooseNumber', n: 2 }] });
    s = settle(pass(pass(s)));
    const chosen: string[] = [];
    for (const name of ['Test Herald', 'Test Bear', 'Test Herald']) {
      expect(s.pending?.kind).toBe('chooseObjects');
      const id = find(s, name, 'battlefield', 'p1');
      chosen.push(id);
      s = settle(answer(s, { kind: 'chooseObjects', ids: [id] }));
    }
    s = drain(s);
    expect(s.pending?.kind).toBe('priority'); // no fourth choice
    const exiled = (s.log as unknown as { text?: string }[]).filter((l) => /is put into exile/.test(l.text ?? '')).length;
    expect(exiled).toBe(3);
    // each return made a new object (CR 400.7): the Herald on the battlefield is not the one first chosen
    expect(find(s, 'Test Herald', 'battlefield', 'p1')).not.toBe(chosen[0]);
    expect(findAll(s, 'Test Bear', 'battlefield', 'p1')).toHaveLength(1);
  });
});

describe('CR 608.2c, 608.2d: "You may X. If you do, Y. If you don\'t, Z." (the third sentence answers the same option as the second)', () => {
  const OFFER = card('Test Offer', 'Sorcery', "You may sacrifice a creature. If you do, draw two cards. If you don't, you lose 2 life.");
  it('is automated; sacrificing draws two cards and loses no life, declining loses 2 life and draws nothing', () => {
    expect(automated(OFFER)).toBe(true);
    for (const yes of [true, false]) {
      let s = scenario([], { p1: { hand: ['Test Offer'], battlefield: ['Test Bear'] }, defs: [OFFER, BEAR] });
      const hand = s.zones.hand['p1']!.length;
      const life = s.players.find((p) => p.id === 'p1')!.life;
      s = cast(s, 'Test Offer', { answers: [{ kind: 'yesNo', yes }], picks: [[find(s, 'Test Bear', 'battlefield', 'p1')]] });
      expect(findAll(s, 'Test Bear', 'graveyard', 'p1')).toHaveLength(yes ? 1 : 0);
      expect(s.zones.hand['p1']!.length).toBe(hand - 1 + (yes ? 2 : 0));
      expect(s.players.find((p) => p.id === 'p1')!.life).toBe(life - (yes ? 0 : 2));
    }
  });
});

describe('CR 201.2, 205.1a, 613.1d, 613.1f: "you may have ~ become a legendary Equipment artifact named Everflame, Heroes\' Legacy. If you do, it gains equip {3} and "Equipped creature gets +3/+3" and loses all other abilities."', () => {
  const CRAG = card('Test Crag', 'Legendary Artifact', '{T}: Add {C}.\nWhenever a legendary creature you control enters, you may have ~ become a legendary Equipment artifact named Everflame, Heroes\' Legacy. If you do, it gains equip {3} and "Equipped creature gets +3/+3" and loses all other abilities.');
  const HERO = card('Test Hero', 'Legendary Creature — Human Knight', '', ['2', '2'], '{0}');
  it('is automated; answered yes, it is an Equipment named Everflame with equip and no mana ability; answered no, nothing changes', () => {
    expect(automated(CRAG)).toBe(true);
    for (const yes of [true, false]) {
      let s = scenario([], { p1: { hand: ['Test Hero'], battlefield: ['Test Crag'] }, defs: [CRAG, HERO] });
      s = cast(s, 'Test Hero', { answers: [{ kind: 'yesNo', yes }] });
      const crag = find(s, 'Test Crag', 'battlefield', 'p1');
      const ch = getChars(s, crag);
      if (yes) {
        expect(ch.names).toEqual(["Everflame, Heroes' Legacy"]);
        expect(ch.subtypes).toEqual(['Equipment']);
        expect(ch.supertypes).toContain('Legendary');
        const defs = ch.abilities.map((a) => a.def as { kind: string; keyword?: string; isMana?: boolean });
        expect(defs.map((d) => d.keyword)).toContain('equip');
        expect(defs.some((d) => d.isMana === true)).toBe(false); // the mana ability is gone
        expect(defs.some((d) => d.kind === 'triggered')).toBe(false); // and so is the trigger
        expect(defs.some((d) => d.kind === 'static')).toBe(true); // "Equipped creature gets +3/+3"
      } else {
        expect(ch.names).toEqual(['Test Crag']);
        expect(ch.subtypes ?? []).not.toContain('Equipment');
      }
    }
  });
});
