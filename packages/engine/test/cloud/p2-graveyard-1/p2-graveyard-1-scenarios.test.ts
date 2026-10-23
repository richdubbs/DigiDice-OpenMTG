/**
 * p2-graveyard-1 (Phase 2 lane p2-graveyard): the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10),
 * compiled by the game's default compiler. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 702.152a, 601.3,  "You may cast this card from your graveyard using its blitz ability": from its owner's graveyard the card is cast for its blitz cost only
 *   113.6f, 118.9        (never for its mana cost), and the blitz riders follow (haste, "When this creature dies, draw a card", the sacrifice at the next end step)
 *   CR 702.103a, 601.3,  "You may cast this card from your graveyard using its bestow ability": from its owner's graveyard the card is cast bestowed, an Aura spell
 *   113.6f, 303.4a       that targets the creature it will enchant; a bestow card without the line offers nothing from the graveyard
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, answer, declareAttackers, find, life, pass, put, scenario, tweak } from '../../m5/helpers';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

/** Answer pending decisions (costs, targets, yes to a may, the queued answers) until a player has priority with an empty stack. */
function settle(s0: GameState, answers: DecisionAnswer[] = [], targets: ObjectId[] = []): GameState {
  let s = s0;
  const queue = [...answers];
  for (let guard = 0; guard < 60 && s.pending && !(s.pending.kind === 'priority' && s.zones.stack.length === 0); guard++) {
    const d = s.pending;
    if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: targets.map((id) => ({ kind: 'object' as const, id })) });
    else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: d.items.map((i) => i.id) });
    else if (queue.length > 0 && queue[0]!.kind === d.kind) s = answer(s, queue.shift()!);
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (d.kind === 'priority') s = pass(s);
    else throw new Error(`unexpected decision ${d.kind}: ${d.prompt}`);
  }
  return s;
}
/** Pass (declaring no attackers) until the end step's priority. */
function toEndStep(s0: GameState): GameState {
  let s = s0;
  for (let i = 0; i < 80 && !(s.turn.step === 'end' && s.pending?.kind === 'priority'); i++) s = s.pending?.kind === 'declareAttackers' ? declareAttackers(s, []) : pass(s);
  return s;
}
const castActions = (s: GameState, id: ObjectId) => legalActions(s, 'p1').filter((a) => a.kind === 'cast' && a.object === id);

describe('CR 702.152a, 601.3, 113.6f: "You may cast this card from your graveyard using its blitz ability"', () => {
  const BRAWLER = card('Test Grave Brawler', 'Creature — Zombie Warrior', 'Blitz {1}{B}\nYou may cast this card from your graveyard using its blitz ability.', { pt: ['2', '2'], cost: '{3}{B}' });
  const PLAIN = card('Test Plain Brawler', 'Creature — Zombie Warrior', 'Blitz {1}{B}', { pt: ['2', '2'], cost: '{3}{B}' });
  const board = (): GameState => scenario(['Swamp', 'Island'], {
    p1: { graveyard: ['Test Grave Brawler', 'Test Plain Brawler'], battlefield: ['Swamp', 'Swamp', 'Swamp', 'Swamp'], library: ['Island', 'Island', 'Island'] },
    p2: { library: ['Island', 'Island', 'Island'] },
    defs: [BRAWLER, PLAIN],
  });
  it('is automated', () => expect(full(BRAWLER)).toBe(true));
  it('from the graveyard it is offered for its blitz cost only; a blitz card without the line is not offered there', () => {
    const s = board();
    const gy = find(s, 'Test Grave Brawler', 'graveyard', 'p1');
    expect(castActions(s, gy).map((a) => a.label)).toEqual(['Cast Test Grave Brawler (blitz)']);
    expect(castActions(s, find(s, 'Test Plain Brawler', 'graveyard', 'p1'))).toEqual([]);
  });
  it('cast that way it pays {1}{B}, has haste, is sacrificed at the next end step and its owner draws a card as it dies', () => {
    let s = board();
    const gy = find(s, 'Test Grave Brawler', 'graveyard', 'p1');
    s = settle(act(s, castActions(s, gy)[0]!.action));
    const id = find(s, 'Test Grave Brawler', 'battlefield', 'p1');
    expect(s.objects[id]!.cast?.from).toBe('graveyard');
    expect(s.zones.battlefield.filter((x) => s.objects[x]!.tapped)).toHaveLength(2);
    expect(hasKeyword(getChars(s, id)!, 'haste')).toBe(true); // "As long as its blitz cost was paid" reads the graveyard method too
    const hand = s.zones.hand['p1']!.length;
    s = toEndStep(s);
    s = settle(s);
    expect(s.zones.graveyard['p1']!.map((x) => s.defs[s.objects[x]!.defId]!.name)).toContain('Test Grave Brawler');
    expect(s.zones.hand['p1']!.length).toBe(hand + 1);
  });
});

describe('CR 702.103a, 601.3, 113.6f: "You may cast this card from your graveyard using its bestow ability"', () => {
  const EMBER = card('Test Ember Wisp', 'Enchantment Creature — Elemental', 'Bestow {R}\nFlying\nEnchanted creature gets +1/+1 and has flying.\nYou may cast this card from your graveyard using its bestow ability.', { pt: ['1', '1'], cost: '{1}{R}' });
  const DIM = card('Test Dim Wisp', 'Enchantment Creature — Elemental', 'Bestow {R}\nFlying\nEnchanted creature gets +1/+1 and has flying.', { pt: ['1', '1'], cost: '{1}{R}' });
  const BEAR = card('Test Ground Bear', 'Creature — Bear', '', { pt: ['2', '2'], cost: '{1}{G}' });
  const board = (): GameState => scenario(['Mountain'], {
    p1: { graveyard: ['Test Ember Wisp', 'Test Dim Wisp'], battlefield: ['Mountain', 'Mountain', 'Test Ground Bear'] },
    defs: [EMBER, DIM, BEAR],
  });
  it('is automated', () => expect(full(EMBER)).toBe(true));
  it('from the graveyard it is offered bestowed only (never for its mana cost); a bestow card without the line is not offered there', () => {
    const s = board();
    expect(castActions(s, find(s, 'Test Ember Wisp', 'graveyard', 'p1')).map((a) => a.label)).toEqual(['Cast Test Ember Wisp (bestow)']);
    expect(castActions(s, find(s, 'Test Dim Wisp', 'graveyard', 'p1'))).toEqual([]);
  });
  it('cast bestowed from the graveyard for {R}, it enters attached to the target creature, which gets +1/+1 and flying', () => {
    let s = board();
    const bear = find(s, 'Test Ground Bear', 'battlefield', 'p1');
    const gy = find(s, 'Test Ember Wisp', 'graveyard', 'p1');
    const p1Life = life(s, 'p1');
    s = settle(act(s, castActions(s, gy)[0]!.action), [], [bear]);
    const id = find(s, 'Test Ember Wisp', 'battlefield', 'p1');
    expect(s.objects[id]!.attachedTo).toBe(bear);
    expect(s.zones.battlefield.filter((x) => s.objects[x]!.tapped)).toHaveLength(1);
    const c = getChars(s, bear)!;
    expect(`${c.power}/${c.toughness}`).toBe('3/3');
    expect(hasKeyword(c, 'flying')).toBe(true);
    expect(life(s, 'p1')).toBe(p1Life);
  });
});

describe('CR 700.4, 603.6c, 603.10a, 400.7: "When enchanted permanent dies or is put into exile, return that card to the battlefield under your control"', () => {
  const VEIL = card('Test Ghost Veil', 'Enchantment — Aura', 'Enchant creature or planeswalker you control\nWhen enchanted permanent dies or is put into exile, return that card to the battlefield under your control.', { cost: '{1}' });
  const BEAR = card('Test Ground Bear', 'Creature — Bear', '', { pt: ['2', '2'], cost: '{1}{G}' });
  const SLAY = card('Test Slaying Word', 'Instant', 'Destroy target creature.');
  const BANISH = card('Test Banishing Word', 'Instant', 'Exile target creature.');
  const BOUNCE = card('Test Bouncing Word', 'Instant', "Return target creature to its owner's hand.");
  /** p1's Bear enchanted by the Veil (put directly onto the battlefield attached, CR 303.4f). */
  const enchanted = (): { s: GameState; bear: ObjectId; veil: ObjectId } => {
    const s0 = scenario([], { p1: { battlefield: ['Test Ground Bear'], hand: ['Test Slaying Word', 'Test Banishing Word', 'Test Bouncing Word'] }, defs: [VEIL, BEAR, SLAY, BANISH, BOUNCE] });
    const bear = find(s0, 'Test Ground Bear', 'battlefield', 'p1');
    let veil = '' as ObjectId;
    const s = tweak(s0, (x) => { veil = put(x, 'p1', 'battlefield', 'Test Ghost Veil'); x.objects[veil]!.attachedTo = bear; });
    return { s, bear, veil };
  };
  it('is automated', () => expect(full(VEIL)).toBe(true));
  it('the enchanted creature dies: the card comes back from the graveyard under your control (the Aura itself goes to the graveyard)', () => {
    const { s: s0, bear } = enchanted();
    const s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Slaying Word', 'hand', 'p1') }), [], [bear]);
    expect(s.zones.battlefield.map((x) => s.defs[s.objects[x]!.defId]!.name)).toContain('Test Ground Bear');
    expect(s.zones.graveyard['p1']!.map((x) => s.defs[s.objects[x]!.defId]!.name)).toContain('Test Ghost Veil');
  });
  it('the enchanted creature is exiled: the card comes back from exile', () => {
    const { s: s0, bear } = enchanted();
    const s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Banishing Word', 'hand', 'p1') }), [], [bear]);
    expect(s.zones.battlefield.map((x) => s.defs[s.objects[x]!.defId]!.name)).toContain('Test Ground Bear');
    expect(s.zones.exile).toEqual([]);
  });
  it('the enchanted creature is returned to its owner\'s hand: nothing triggers, it stays in the hand', () => {
    const { s: s0, bear } = enchanted();
    const s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Bouncing Word', 'hand', 'p1') }), [], [bear]);
    expect(s.zones.battlefield.map((x) => s.defs[s.objects[x]!.defId]!.name)).not.toContain('Test Ground Bear');
    expect(s.zones.hand['p1']!.map((x) => s.defs[s.objects[x]!.defId]!.name)).toContain('Test Ground Bear');
  });
});

describe('CR 400.7, 110.2, 400.3: "Return to the battlefield / to your hand all <cards> in your graveyard that were put there from the battlefield this turn"', () => {
  const REWARD = card('Test Dawn Recall', 'Instant', 'Return to the battlefield all creature cards in your graveyard that were put there from the battlefield this turn.', { cost: '{0}' });
  const RECALL = card('Test Dusk Recall', 'Instant', 'Return to your hand all creature cards in your graveyard that were put there from the battlefield this turn.', { cost: '{0}' });
  const BEAR = card('Test Ground Bear', 'Creature — Bear', '', { pt: ['2', '2'], cost: '{1}{G}' });
  const OLD = card('Test Old Bones', 'Creature — Skeleton', '', { pt: ['1', '1'], cost: '{B}' });
  const SLAY = card('Test Slaying Word', 'Instant', 'Destroy target creature.');
  const board = (spell: string): GameState => scenario([], { p1: { battlefield: ['Test Ground Bear'], graveyard: ['Test Old Bones'], hand: ['Test Slaying Word', spell] }, p2: { battlefield: ['Test Ground Bear'] }, defs: [REWARD, RECALL, BEAR, OLD, SLAY] });
  const names = (s: GameState, ids: readonly ObjectId[]): string[] => ids.map((x) => s.defs[s.objects[x]!.defId]!.name).sort();
  /** p1 destroys their own Bear and p2's Bear, then casts `spell`. */
  const play = (spell: string): GameState => {
    let s = board(spell);
    for (const owner of ['p1', 'p2'] as const) {
      const bear = s.zones.battlefield.find((x) => s.objects[x]!.owner === owner && s.defs[s.objects[x]!.defId]!.name === 'Test Ground Bear')!;
      if (owner === 'p2') s = tweak(s, (x) => { put(x, 'p1', 'hand', 'Test Slaying Word'); });
      s = settle(act(s, { type: 'cast', player: 'p1', card: s.zones.hand['p1']!.find((x) => s.defs[s.objects[x]!.defId]!.name === 'Test Slaying Word')! }), [], [bear]);
    }
    return settle(act(s, { type: 'cast', player: 'p1', card: find(s, spell, 'hand', 'p1') }));
  };
  it('both are automated', () => { expect(full(REWARD)).toBe(true); expect(full(RECALL)).toBe(true); });
  it('to the battlefield: only your creature card that died this turn returns; a card that was already in your graveyard and an opponent\'s card stay', () => {
    const s = play('Test Dawn Recall');
    expect(names(s, s.zones.battlefield)).toEqual(['Test Ground Bear']);
    expect(s.objects[s.zones.battlefield[0]!]!.controller).toBe('p1');
    expect(names(s, s.zones.graveyard['p1']!)).toContain('Test Old Bones');
    expect(names(s, s.zones.graveyard['p2']!)).toEqual(['Test Ground Bear']);
  });
  it('to your hand: the same card goes to your hand', () => {
    const s = play('Test Dusk Recall');
    expect(names(s, s.zones.hand['p1']!)).toEqual(['Test Ground Bear']);
    expect(names(s, s.zones.graveyard['p1']!)).toContain('Test Old Bones');
  });
});

describe('CR 404.1, 110.2a, 110.5: "put a land card from a graveyard onto the battlefield tapped under your control"', () => {
  const DIGGER = card('Test Grave Digger', 'Creature — Elemental', 'When this creature enters, put a land card from a graveyard onto the battlefield tapped under your control.', { pt: ['2', '2'] });
  const DUNE = card('Test Dune', 'Land', '{T}: Add {C}.');
  it('is automated', () => expect(full(DIGGER)).toBe(true));
  it('takes a land card from an opponent\'s graveyard; it enters tapped and under your control (its owner keeps owning it)', () => {
    let s = scenario([], { p1: { hand: ['Test Grave Digger'] }, p2: { graveyard: ['Test Dune'] }, defs: [DIGGER, DUNE] });
    const dune = find(s, 'Test Dune', 'graveyard', 'p2');
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Grave Digger', 'hand', 'p1') }), [{ kind: 'chooseObjects', ids: [dune] } as unknown as DecisionAnswer]);
    const land = find(s, 'Test Dune', 'battlefield');
    expect(s.objects[land]!.controller).toBe('p1');
    expect(s.objects[land]!.owner).toBe('p2');
    expect(s.objects[land]!.tapped).toBe(true);
  });
});

describe('CR 604.1, 105.3, 613.1e: "As long as there are seven or more cards in your graveyard, ~ gets +1/+1, is black, and has "..."', () => {
  const HOST = card('Test Haunted Host', 'Creature — Human', 'Vigilance\nAs long as there are seven or more cards in your graveyard, this creature gets +1/+1, is black, and has "{2}{B}, {T}: Destroy target white creature."', { pt: ['2', '2'], cost: '{2}{W}' });
  const DUST = card('Test Dust', 'Instant', 'You gain 1 life.');
  const board = (n: number): GameState => scenario([], { p1: { battlefield: ['Test Haunted Host'], graveyard: Array.from({ length: n }, () => 'Test Dust') }, defs: [HOST, DUST] });
  it('is automated', () => expect(full(HOST)).toBe(true));
  it('with seven cards in your graveyard it is a black 3/3 with the destroy ability (its own colors are replaced); with six it is not black, a 2/2 without it', () => {
    let s = board(7);
    let c = getChars(s, find(s, 'Test Haunted Host', 'battlefield', 'p1'))!;
    expect(c.colors).toEqual(['B']);
    expect(`${c.power}/${c.toughness}`).toBe('3/3');
    expect(c.abilities.some((a) => a.def.kind === 'activated')).toBe(true);
    s = board(6);
    c = getChars(s, find(s, 'Test Haunted Host', 'battlefield', 'p1'))!;
    expect(c.colors).not.toContain('B');
    expect(`${c.power}/${c.toughness}`).toBe('2/2');
    expect(c.abilities.some((a) => a.def.kind === 'activated')).toBe(false);
  });
});
