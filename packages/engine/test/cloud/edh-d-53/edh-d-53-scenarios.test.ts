/**
 * Commander coordinator D, lane d-rank-3 (EDHREC ranks 15,001-16,500), round edh-d-53: the round's readings played through the engine with synthetic cards (invented names, design 6.10),
 * compiled by the default compiler, each with its negative case. CR cites are from memory (unverified) unless the record says otherwise.
 *
 *   CR 601.2h, 105.1                 "Whenever a player casts a spell, if no colored mana was spent to cast it, counter that spell." (Void Mirror)
 *   CR 400.7j, 608.2h                "... Put a +2/+2 counter on that creature if the exiled creature was a Thrull." (Soul Exchange)
 *   CR 508.1d, 611.2a                "Whenever ~ deals combat damage to a player, until the end of your next turn, target creature attacks that player each combat if able." (Silver Surfer)
 *   CR 602.2b, 700.9, 608.2h         "... If the modified creature was sacrificed, draw a card." (Lethal Throwdown)
 *   CR 508.1h, 107.3                 "{X}{U}: This turn, creatures can't attack unless their controller pays {X} for each attacking creature they control." (War Tax)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { attackTaxes } from '../../../src/statics/combat-tax';
import { requirementsFor } from '../../../src/rules/requirements';
import { act, advanceTo, answer, find, findAll, legal, pass, scenario } from '../../m3/scenario';
import { declareAttackers, toDeclareAttackers, tweak } from '../../m4/helpers';
import { cast, resolveAll, target } from '../../m5/cr-examples/helpers';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as OracleCard);
}
const noManual = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const life = (s: GameState, p: 'p1' | 'p2'): number => s.players.find((x) => x.id === p)!.life;
const inZone = (s: GameState, zone: 'graveyard' | 'battlefield' | 'exile', name: string, p?: 'p1' | 'p2'): ObjectId[] => {
  const ids = zone === 'battlefield' ? s.zones.battlefield : zone === 'exile' ? s.zones.exile : [...(s.zones.graveyard.p1 ?? []), ...(s.zones.graveyard.p2 ?? [])];
  return ids.filter((id) => nameOf(s, id) === name && (p === undefined || s.objects[id]!.owner === p));
};

// ---- Void Mirror --------------------------------------------------------------------------------------------------------------------------------------------------
const MIRROR = card('Test Dark Glass', 'Artifact', 'Whenever a player casts a spell, if no colored mana was spent to cast it, counter that spell.');
const FREE = card('Test Free Boon', 'Sorcery', 'You gain 3 life.');
const RED = card('Test Red Boon', 'Sorcery', 'You gain 3 life.', { cost: '{R}' });
const GREY = card('Test Grey Boon', 'Sorcery', 'You gain 3 life.', { cost: '{1}' });
const ROCK = card('Test Grey Rock', 'Artifact', '{T}: Add {C}.');
describe('Void Mirror (CR 601.2h, 105.1, 603.4): "if no colored mana was spent to cast it, counter that spell"', () => {
  it('is automated with no manual part', () => { expect(noManual(MIRROR)).toBe(true); });
  const play = (name: string, battlefield: string[]): GameState => {
    const s0 = scenario(['Mountain'], { defs: [MIRROR, FREE, RED, GREY, ROCK], p1: { battlefield: ['Test Dark Glass', ...battlefield], hand: [name] } });
    return resolveAll(cast(s0, name));
  };
  it('a spell cast for no mana is countered (no colored mana was spent)', () => {
    const s = play('Test Free Boon', []);
    expect(life(s, 'p1')).toBe(20);
    expect(inZone(s, 'graveyard', 'Test Free Boon').length).toBe(1);
  });
  it('a spell paid with colorless mana only is countered', () => {
    const s = play('Test Grey Boon', ['Test Grey Rock']);
    expect(life(s, 'p1')).toBe(20);
    expect(inZone(s, 'graveyard', 'Test Grey Boon').length).toBe(1);
  });
  it('negative: a spell paid with red mana resolves', () => {
    const s = play('Test Red Boon', ['Mountain']);
    expect(life(s, 'p1')).toBe(23);
  });
});

// ---- Soul Exchange ------------------------------------------------------------------------------------------------------------------------------------------------
const EXCHANGE = card('Test Soul Swap', 'Sorcery', "As an additional cost to cast this spell, exile a creature you control.\nReturn target creature card from your graveyard to the battlefield. Put a +2/+2 counter on that creature if the exiled creature was a Thrull.");
const THRULL = card('Test Thrull', 'Creature — Thrull', '', { pt: ['1', '1'] });
const BEAR = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const FALLEN = card('Test Fallen Hero', 'Creature — Human', '', { pt: ['3', '3'] });
describe('Soul Exchange (CR 400.7j, 608.2h): "if the exiled creature was a Thrull" reads what the additional cost exiled', () => {
  it('is automated with no manual part', () => { expect(noManual(EXCHANGE)).toBe(true); });
  const play = (exiled: string): GameState => {
    const s0 = scenario([], { defs: [EXCHANGE, THRULL, BEAR, FALLEN], p1: { battlefield: [exiled], hand: ['Test Soul Swap'], graveyard: ['Test Fallen Hero'] } });
    const grave = find(s0, 'Test Fallen Hero', 'graveyard', 'p1');
    return resolveAll(cast(s0, 'Test Soul Swap', [target(grave)]));
  };
  it('a Thrull exiled: the returned creature gets a +2/+2 counter', () => {
    const s = play('Test Thrull');
    const back = inZone(s, 'battlefield', 'Test Fallen Hero', 'p1');
    expect(back.length).toBe(1);
    expect(s.objects[back[0]!]!.counters['+2/+2']).toBe(1);
    expect(inZone(s, 'exile', 'Test Thrull').length).toBe(1);
  });
  it('negative: a Bear exiled: the creature returns with no counter', () => {
    const s = play('Test Plain Bear');
    const back = inZone(s, 'battlefield', 'Test Fallen Hero', 'p1');
    expect(back.length).toBe(1);
    expect(s.objects[back[0]!]!.counters['+2/+2']).toBeUndefined();
  });
});

// ---- Silver Surfer ------------------------------------------------------------------------------------------------------------------------------------------------
const SURFER = card('Test Sky Rider', 'Creature — Alien', "Whenever ~ deals combat damage to a player, until the end of your next turn, target creature attacks that player each combat if able.", { pt: ['2', '2'] });
const PAWN = card('Test Lone Pawn', 'Creature — Soldier', '', { pt: ['1', '1'] });
describe("Silver Surfer (CR 508.1d, 611.2a): \"until the end of your next turn, target creature attacks that player each combat if able\"", () => {
  it('is automated with no manual part', () => { expect(noManual(SURFER)).toBe(true); });
  it('after the combat damage the targeted creature must attack that player in each combat of the next turn; before, it need not', () => {
    const s0 = scenario([], { defs: [SURFER, PAWN], p1: { battlefield: ['Test Sky Rider', 'Test Lone Pawn'] } });
    const pawn = find(s0, 'Test Lone Pawn', 'battlefield', 'p1');
    expect(requirementsFor(toDeclareAttackers(s0), 'attack', 'p1').filter((r) => r.creature === pawn), 'no requirement yet').toEqual([]);
    let s = declareAttackers(toDeclareAttackers(s0), [[find(s0, 'Test Sky Rider', 'battlefield', 'p1'), 'p2']]);
    for (let i = 0; i < 30 && !(s.turn.number === 2); i++) {
      if (s.pending?.kind === 'chooseTargets') s = answer(s, target(pawn));
      else if (s.pending?.kind === 'priority') s = pass(s);
      else s = answer(s, { kind: 'payCost', auto: true });
    }
    expect(life(s, 'p2')).toBe(18);
    // the next turn of p1 (turn 3): the requirement binds the Pawn, to attack p2
    const t3 = toDeclareAttackers(advanceTo(s, 3, 'main1'));
    const req = requirementsFor(t3, 'attack', 'p1').filter((r) => r.creature === find(t3, 'Test Lone Pawn', 'battlefield', 'p1'));
    expect(req.length, JSON.stringify(req)).toBe(1);
    expect(req[0]!.among).toEqual(['p2']);
  });
});

// ---- Lethal Throwdown ---------------------------------------------------------------------------------------------------------------------------------------------
const THROWDOWN = card('Test Hard Landing', 'Sorcery', "As an additional cost to cast this spell, sacrifice a creature or sacrifice a modified creature.\nDestroy target creature or planeswalker. If the modified creature was sacrificed, draw a card.");
const VICTIM = card('Test Victim Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
describe('Lethal Throwdown (CR 602.2b, 700.9, 608.2h): "If the modified creature was sacrificed, draw a card"', () => {
  it('is automated with no manual part', () => { expect(noManual(THROWDOWN)).toBe(true); });
  const play = (modified: boolean): { before: GameState; after: GameState } => {
    const mk = (): GameState => scenario([], { defs: [THROWDOWN, BEAR, VICTIM], p1: { battlefield: ['Test Plain Bear'], hand: ['Test Hard Landing'] }, p2: { battlefield: ['Test Victim Bear'] } });
    const s0 = mk();
    const bear = find(s0, 'Test Plain Bear', 'battlefield', 'p1');
    const start = tweak(s0, (t) => { if (modified) t.objects[bear]!.counters['+1/+1'] = 1; });
    const victim = find(start, 'Test Victim Bear', 'battlefield', 'p2');
    let s = act(start, { type: 'cast', player: 'p1', card: find(start, 'Test Hard Landing', 'hand', 'p1') });
    for (let i = 0; i < 12 && s.pending && s.pending.kind !== 'priority'; i++) {
      const d = s.pending as { kind: string; options?: { id: string }[] };
      if (d.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: [d.options![modified ? 1 : 0]!.id] });
      else if (d.kind === 'chooseTargets') s = answer(s, target(victim));
      else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: [bear] } as never);
      else throw new Error(`unexpected decision ${d.kind}: ${JSON.stringify(d)}`);
    }
    return { before: start, after: resolveAll(s) };
  };
  it('a modified creature (a counter on it) sacrificed: the victim dies and you draw a card', () => {
    const { before, after } = play(true);
    expect(inZone(after, 'graveyard', 'Test Victim Bear').length).toBe(1);
    expect(inZone(after, 'graveyard', 'Test Plain Bear').length).toBe(1);
    expect(after.zones.hand.p1!.length).toBe(before.zones.hand.p1!.length - 1 + 1);
  });
  it('negative: an unmodified creature sacrificed: the victim dies and no card is drawn', () => {
    const { before, after } = play(false);
    expect(inZone(after, 'graveyard', 'Test Victim Bear').length).toBe(1);
    expect(inZone(after, 'graveyard', 'Test Plain Bear').length).toBe(1);
    expect(after.zones.hand.p1!.length).toBe(before.zones.hand.p1!.length - 1);
  });
});

// ---- War Tax ------------------------------------------------------------------------------------------------------------------------------------------------------
const WAR_TAX = card('Test Toll Road', 'Enchantment', '{X}{U}: This turn, creatures can\'t attack unless their controller pays {X} for each attacking creature they control.');
describe('War Tax (CR 508.1h, 107.3, 611.2a): "creatures can\'t attack unless their controller pays {X} for each attacking creature they control"', () => {
  it('is automated with no manual part', () => { expect(noManual(WAR_TAX)).toBe(true); });
  const setup = () => scenario(['Island'], { defs: [WAR_TAX, BEAR], p1: { battlefield: ['Test Toll Road', 'Test Plain Bear', 'Island', 'Island', 'Island'] } });
  const activate = (s: GameState, x: number): GameState => {
    const a = legal(s, 'p1', 'activate').find((l) => l.action.type === 'activate' && l.action.source === find(s, 'Test Toll Road', 'battlefield'));
    expect(a, 'the activation is offered').toBeDefined();
    let t = act(s, a!.action);
    for (let i = 0; i < 12 && t.pending && t.pending.kind !== 'priority'; i++) {
      const d = t.pending as { kind: string };
      if (d.kind === 'chooseNumber' || d.kind === 'chooseX') t = answer(t, { kind: 'chooseNumber', n: x } as never);
      else if (d.kind === 'payCost') t = answer(t, { kind: 'payCost', auto: true });
      else throw new Error(`unexpected decision ${d.kind}`);
    }
    for (let i = 0; i < 6 && t.zones.stack.length > 0; i++) t = pass(t);
    return t;
  };
  it('after X = 2 each attacker costs {2}, whoever it attacks', () => {
    const s = activate(setup(), 2);
    const bear = find(s, 'Test Plain Bear', 'battlefield', 'p1');
    expect(attackTaxes(s, [{ attacker: bear, defender: 'p2' }]).map((x) => x.cost)).toEqual([{ mana: [{ kind: 'generic', amount: 2 }] }]);
  });
  it('negative: before the ability is activated, attacking costs nothing', () => {
    const s0 = setup();
    expect(attackTaxes(s0, [{ attacker: find(s0, 'Test Plain Bear', 'battlefield', 'p1'), defender: 'p2' }])).toEqual([]);
  });
});
void findAll;
