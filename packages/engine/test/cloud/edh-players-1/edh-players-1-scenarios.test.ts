/**
 * edh-players-1 (Commander lane edh-players): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (invented names
 * and wordings, design 6.10). Each test is named after the rule it checks, with its negative case.
 *
 *   CR 305.2, 305.2a     "You may play two additional lands on each of your turns": three land plays, never a fourth
 *   CR 121.1, 608.2d     "Its controller may draw up to two cards": the drawing player chooses 0, 1 or 2
 *   CR 603.7, 608.2h     a delayed draw of "its controller" of a countered spell, read with last known information
 *   CR 614.15, 111.2     "create a token. If C, create a token that's a copy of this creature instead": one or the other, never both
 *   CR 603.2, 504.1      "an opponent draws a card except the first one they draw in each of their draw steps"
 *   CR 603.2, 111.1      "you create or sacrifice a token": either event, tokens only
 *   CR 603.2, 500.1      "draws their second card during their turn"; "loses life for the first time during each of their turns"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { act, advanceTo, answer, battlefieldNames, find, findAll, legal, life, pass, reject, scenario, zoneNames } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as unknown as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

type Target = { kind: 'object' | 'player'; id: string };
/** Answer the decisions of what is being done (payment automatic, targets: the given ones, objects: the first ones offered, numbers: `n`, yes/no: `yes`); stop at the next priority. */
function settle(s0: GameState, targets: Target[] = [], yes = true, n = 0): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 30; guard++) {
    const p = s.pending as unknown as { kind: string; options: { id: string }[] & string[]; min: number; max?: number; items?: { id: string }[] };
    if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: (p.options as string[]).slice(0, Math.max(p.min, 0)) });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets } as never);
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: yes ? [p.options[0]!.id] : [] });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items!.map((x) => x.id) });
    else break;
  }
  return s;
}
function resolveAll(s0: GameState, n = 0): GameState {
  let s = settle(s0, [], true, n);
  for (let guard = 0; s.zones.stack.length > 0 && guard < 40; guard++) s = settle(s.pending?.kind === 'priority' ? pass(s) : s, [], true, n);
  return s;
}
const cast = (s: GameState, name: string, opts: { player?: 'p1' | 'p2'; targets?: Target[]; yes?: boolean; n?: number } = {}): GameState =>
  resolveAll(settle(act(s, { type: 'cast', player: opts.player ?? 'p1', card: find(s, name, 'hand', opts.player ?? 'p1') }), opts.targets ?? [], opts.yes ?? true, opts.n ?? 0), opts.n ?? 0);
const handSize = (s: GameState, p: 'p1' | 'p2'): number => s.zones.hand[p]!.length;
const FIELD = card('Test Field', 'Land', '{T}: Add {C}.');
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const SHARE = card('Test Share', 'Sorcery', 'Each player draws a card.');
const SHARE_I = card('Test Whisper', 'Instant', 'Each player draws a card.');

describe('CR 305.2, 305.2a: "You may play two additional lands on each of your turns."', () => {
  const DRYAD = card('Test Dryad', 'Creature — Dryad', 'You may play two additional lands on each of your turns.', ['1', '1']);
  it('is automated', () => expect(full(DRYAD)).toBe(true));
  it('three lands can be played in a turn, the fourth is refused', () => {
    let s = scenario([], { defs: [DRYAD, FIELD], p1: { battlefield: ['Test Dryad'], hand: ['Test Field', 'Test Field', 'Test Field', 'Test Field'] } });
    for (let i = 0; i < 3; i++) s = act(s, { type: 'playLand', player: 'p1', card: find(s, 'Test Field', 'hand', 'p1') });
    reject(s, { type: 'playLand', player: 'p1', card: find(s, 'Test Field', 'hand', 'p1') });
    expect(battlefieldNames(s, 'p1').filter((n) => n === 'Test Field')).toHaveLength(3);
  });
  it('without it, only the one land play of the turn', () => {
    let s = scenario([], { defs: [FIELD], p1: { hand: ['Test Field', 'Test Field'] } });
    s = act(s, { type: 'playLand', player: 'p1', card: find(s, 'Test Field', 'hand', 'p1') });
    reject(s, { type: 'playLand', player: 'p1', card: find(s, 'Test Field', 'hand', 'p1') });
  });
  it('only on your own turns: the permission is not an opponent\'s', () => {
    let s = scenario([], { defs: [DRYAD, FIELD], p1: { battlefield: ['Test Dryad'] }, p2: { hand: ['Test Field', 'Test Field'] } });
    s = advanceTo(s, 2, 'main1');
    s = act(s, { type: 'playLand', player: 'p2', card: find(s, 'Test Field', 'hand', 'p2') });
    reject(s, { type: 'playLand', player: 'p2', card: find(s, 'Test Field', 'hand', 'p2') });
  });
});

describe('CR 121.1, 608.2d, 603.7, 608.2h: "Counter target spell. Its controller may draw up to two cards at the beginning of the next turn\'s upkeep."', () => {
  const REBUFF = card('Test Rebuff', 'Instant', "Counter target spell. Its controller may draw up to two cards at the beginning of the next turn's upkeep.\nYou draw a card at the beginning of the next turn's upkeep.");
  const defs = [REBUFF, SHARE];
  /** p2 casts Test Share on its own turn and p1 counters it; then play to p1's next draw step, p2 choosing `n` cards. Returns the hands just after the counter and then. */
  function play(n: number): { before: { p1: number; p2: number }; after: { p1: number; p2: number }; s: GameState } {
    let s = scenario([], { defs, p1: { hand: ['Test Rebuff'] }, p2: { hand: ['Test Share'] } });
    s = advanceTo(s, 2, 'main1');
    s = settle(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Share', 'hand', 'p2') }));
    const spell = s.zones.stack[s.zones.stack.length - 1]!;
    s = cast(pass(s), 'Test Rebuff', { targets: [{ kind: 'object', id: spell }] });
    expect(zoneNames(s, 'graveyard', 'p2')).toContain('Test Share');
    const before = { p1: handSize(s, 'p1'), p2: handSize(s, 'p2') };
    for (let guard = 0; !(s.turn.number === 3 && s.turn.step === 'draw') && guard < 80; guard++) {
      if (s.pending && s.pending.kind !== 'priority') s = settle(s, [], true, n);
      else s = pass(s);
    }
    return { before, after: { p1: handSize(s, 'p1'), p2: handSize(s, 'p2') }, s };
  }
  it('is automated', () => expect(full(REBUFF)).toBe(true));
  it('the spell\'s controller (p2, not the caster) draws the number they choose, two; the caster draws one at that upkeep', () => {
    const r = play(2);
    expect(r.after.p2 - r.before.p2).toBe(2);
    expect(r.after.p1 - r.before.p1).toBe(2); // the upkeep card and the draw step's own
  });
  it('"up to": the controller may choose one, or none, and then draws nothing', () => {
    const one = play(1);
    const none = play(0);
    expect(one.after.p2 - one.before.p2).toBe(1);
    expect(none.after.p2 - none.before.p2).toBe(0);
    expect(none.after.p1 - none.before.p1).toBe(2);
  });
  it('a spell that can\'t be countered stays on the stack, and its controller still gets the choice at the upkeep (last known information of a spell on the stack)', () => {
    const SOLID = card('Test Solid', 'Sorcery', "This spell can't be countered.\nEach player draws a card.");
    let s = scenario([], { defs: [REBUFF, SOLID], p1: { hand: ['Test Rebuff'] }, p2: { hand: ['Test Solid'] } });
    s = advanceTo(s, 2, 'main1');
    s = settle(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Solid', 'hand', 'p2') }));
    const spell = s.zones.stack[s.zones.stack.length - 1]!;
    s = cast(pass(s), 'Test Rebuff', { targets: [{ kind: 'object', id: spell }] });
    const before = handSize(s, 'p2');
    for (let guard = 0; !(s.turn.number === 3 && s.turn.step === 'draw') && guard < 80; guard++) {
      if (s.pending && s.pending.kind !== 'priority') s = settle(s, [], true, 2);
      else s = pass(s);
    }
    expect(handSize(s, 'p2') - before).toBe(2);
  });
  it('it is the next turn\'s upkeep, once: no further draw at the upkeep after that', () => {
    const r = play(1);
    let s = r.s;
    const before = handSize(s, 'p1');
    for (let guard = 0; !(s.turn.number === 5 && s.turn.step === 'draw') && guard < 120; guard++) {
      if (s.pending && s.pending.kind !== 'priority') s = settle(s, [], true, 1);
      else s = pass(s);
    }
    // turn 5 is p1's again: only its own draw step's card since turn 3's draw step (turn 4 is p2's)
    expect(handSize(s, 'p1') - before).toBe(1);
  });
});

describe('CR 614.15, 111.2: "Create a token. If you control five or more lands, create a token that\'s a copy of this creature instead."', () => {
  const SWARM = card('Test Swarm', 'Creature — Insect', "Whenever a land you control enters, create a 1/1 green Insect creature token. If you control five or more lands, create a token that's a copy of this creature instead.", ['1', '1']);
  it('is automated', () => expect(full(SWARM)).toBe(true));
  it('with fewer than five lands the described token is created, not the copy', () => {
    let s = scenario([], { defs: [SWARM, FIELD], p1: { battlefield: ['Test Swarm', 'Test Field', 'Test Field', 'Test Field'], hand: ['Test Field'] } });
    s = resolveAll(act(s, { type: 'playLand', player: 'p1', card: find(s, 'Test Field', 'hand', 'p1') }));
    expect(battlefieldNames(s, 'p1').filter((n) => n === 'Test Swarm')).toHaveLength(1);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === 'p1')).toHaveLength(1);
    expect(findAll(s, 'Test Swarm', 'battlefield', 'p1')).toHaveLength(1);
  });
  it('with five or more lands (the land that entered counted) one copy of the creature is created instead of the Insect', () => {
    let s = scenario([], { defs: [SWARM, FIELD], p1: { battlefield: ['Test Swarm', 'Test Field', 'Test Field', 'Test Field', 'Test Field'], hand: ['Test Field'] } });
    s = resolveAll(act(s, { type: 'playLand', player: 'p1', card: find(s, 'Test Field', 'hand', 'p1') }));
    const tokens = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === 'p1');
    expect(tokens).toHaveLength(1);
    expect(s.defs[s.objects[tokens[0]!]!.defId]!.name).toBe('Test Swarm');
  });
});

describe('CR 603.2, 504.1: "Whenever an opponent draws a card except the first one they draw in each of their draw steps, ..."', () => {
  const ARCHER = card('Test Archer', 'Creature — Orc', 'Whenever an opponent draws a card except the first one they draw in each of their draw steps, you gain 1 life.', ['1', '1']);
  const defs = [ARCHER, SHARE, SHARE_I];
  it('is automated', () => expect(full(ARCHER)).toBe(true));
  it('the card of the opponent\'s draw step does not trigger it; an extra draw in that step does; your own draws never do', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Archer'], hand: ['Test Whisper'] } });
    s = advanceTo(s, 2, 'draw');
    expect(life(s, 'p1')).toBe(20); // the draw step's card
    s = cast(pass(s), 'Test Whisper'); // p1 draws too (no trigger for its own draw), p2 draws a second card of the step
    expect(life(s, 'p1')).toBe(21);
  });
  it('a draw outside the opponent\'s draw step triggers it, and the draw step\'s card after an upkeep draw still does not', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Archer'], hand: ['Test Whisper'] } });
    s = advanceTo(s, 2, 'upkeep');
    s = cast(pass(s), 'Test Whisper'); // p2 draws in its upkeep: triggers
    expect(life(s, 'p1')).toBe(21);
    s = advanceTo(s, 2, 'draw'); // p2's draw step card is the first drawn IN the draw step (though its second of the turn): no trigger
    expect(life(s, 'p1')).toBe(21);
  });
  it('a draw during your own turn by the opponent triggers it', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Archer'], hand: ['Test Share'] } });
    s = cast(s, 'Test Share'); // turn 1, p1's: p2 draws a card outside its draw step
    expect(life(s, 'p1')).toBe(21);
  });
});

describe('CR 603.2, 111.1, 701.21a: "Whenever you create or sacrifice a token, ..."', () => {
  const MOTH = card('Test Moth', 'Creature — Insect', 'Whenever you create or sacrifice a token, you gain 2 life.', ['1', '1']);
  const MAKER = card('Test Maker', 'Sorcery', 'Create a 1/1 green Insect creature token.');
  const SAC = card('Test Sacrificer', 'Sorcery', 'Sacrifice a creature.');
  it('is automated', () => expect(full(MOTH)).toBe(true));
  it('creating a token triggers it', () => {
    const s0 = scenario([], { defs: [MOTH, MAKER], p1: { battlefield: ['Test Moth'], hand: ['Test Maker'] } });
    expect(life(cast(s0, 'Test Maker'), 'p1')).toBe(22);
  });
  it('sacrificing a token triggers it, sacrificing a nontoken creature does not', () => {
    // Test Moth is the only creature: sacrificing it is a nontoken sacrifice
    const s0 = scenario([], { defs: [MOTH, SAC, BEAR], p1: { battlefield: ['Test Moth'], hand: ['Test Sacrificer'] } });
    expect(life(cast(s0, 'Test Sacrificer'), 'p1')).toBe(20);
  });
  it('a token sacrificed triggers it (the sacrifice half of the reading): created +2, then sacrificed with the creature that is not a token +2 only for the token', () => {
    const PURGE = card('Test Purge', 'Sorcery', 'Sacrifice all creatures you control.');
    const s0 = scenario([], { defs: [MOTH, MAKER, PURGE], p1: { battlefield: ['Test Moth'], hand: ['Test Maker', 'Test Purge'] } });
    const s1 = cast(s0, 'Test Maker');
    expect(life(s1, 'p1')).toBe(22);
    expect(life(cast(s1, 'Test Purge'), 'p1')).toBe(24);
  });
  it('an opponent\'s token does not trigger it', () => {
    const s0 = scenario([], { defs: [MOTH, MAKER], p1: { battlefield: ['Test Moth'] }, p2: { hand: ['Test Maker'] } });
    const s1 = advanceTo(s0, 2, 'main1');
    expect(life(cast(s1, 'Test Maker', { player: 'p2' }), 'p1')).toBe(20);
  });
});

describe('CR 603.2, 500.1: trigger events said with the turn they happen in', () => {
  const FIRST = card('Test First Wound', 'Enchantment', 'Whenever an opponent loses life for the first time during each of their turns, you gain 3 life.');
  const SECOND = card('Test Second Wind', 'Enchantment', 'Whenever a player draws their second card during their turn, you gain 2 life.');
  const SECOND_C = card('Test Second Cast', 'Enchantment', 'Whenever a player casts their second spell during their turn, you gain 2 life.');
  const BLEED = card('Test Bleed', 'Sorcery', 'You lose 1 life.');
  const PRICK = card('Test Prick', 'Sorcery', 'Target player loses 1 life.');
  const defs = [FIRST, SECOND, SECOND_C, SHARE, BLEED, PRICK];
  it('the cards are automated', () => {
    for (const d of [FIRST, SECOND, SECOND_C]) expect(full(d), d.name).toBe(true);
  });
  it('"an opponent loses life for the first time during each of their turns": once on their turn however often; never for life lost on your turn', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test First Wound'], hand: ['Test Prick'] }, p2: { hand: ['Test Bleed', 'Test Bleed'] } });
    expect(life(cast(s0, 'Test Prick', { targets: [{ kind: 'player', id: 'p2' }] }), 'p1')).toBe(20);
    let s = advanceTo(s0, 2, 'main1');
    s = cast(s, 'Test Bleed', { player: 'p2' });
    s = cast(s, 'Test Bleed', { player: 'p2' });
    expect(life(s, 'p2')).toBe(18);
    expect(life(s, 'p1')).toBe(23);
  });
  it('a loss on your own turn is not their first on their turn: the first loss on their turn still triggers it', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test First Wound'], hand: ['Test Prick'] }, p2: { hand: ['Test Bleed'] } });
    s = cast(s, 'Test Prick', { targets: [{ kind: 'player', id: 'p2' }] });
    s = advanceTo(s, 2, 'main1');
    s = cast(s, 'Test Bleed', { player: 'p2' });
    expect(life(s, 'p1')).toBe(23);
  });
  it('"a player draws their second card during their turn": the second card of the player\'s own turn triggers it, the first does not, another player\'s second card on this turn does not', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Second Wind'], hand: ['Test Share', 'Test Share'] } });
    const s1 = cast(s0, 'Test Share'); // p1's first card (p2's first card is not on p2's turn)
    expect(life(s1, 'p1')).toBe(20);
    const s2 = cast(s1, 'Test Share'); // p1's second card on p1's turn: +2; p2's second card is not on p2's turn: nothing
    expect(life(s2, 'p1')).toBe(22);
  });
  it('"a player casts their second spell during their turn": the second spell of a turn triggers it, the first does not', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Second Cast'], hand: ['Test Bleed', 'Test Bleed'] } });
    const s1 = cast(s0, 'Test Bleed');
    expect(life(s1, 'p1')).toBe(19);
    expect(life(cast(s1, 'Test Bleed'), 'p1')).toBe(20); // 19 - 1 + 2
  });
});

void legal;
