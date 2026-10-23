/**
 * M6-5 (m6 design 3.8, section 5 "M6-5"): what M6-5a (PUSH1 K1) left: the choice between grouped additional costs (CR 601.2b), "Kicker {A} and/or {B}"
 * (CR 702.33b, 702.33f), the kicks counted (`q:kickCount`, CR 702.33d-e: "for each time it was kicked", "kicked twice"), "If ~ was kicked, it deals N
 * damage instead" (CR 614.15), and escape (CR 702.138: the keyword data, "escapes with", "unless it escaped"). Real fixture cards on the game path and
 * synthetic cards compiled by the same compiler from invented text (design 6.10), driven through applyAction. Nothing is mocked.
 */
import { describe, expect, it } from 'vitest';
import { getChars, legalActions, type CardDef, type GameState, type ObjectId } from '../../../src/index';
import { act } from '../../m5/helpers';
import { answer, castWith, drive, find, gamePath, handSize, namesIn, no, resolveAll, resolveTop, scenario, stackNames, synthetic, target, topPaid, yes } from './support';

const lands = (name: string, n: number): string[] => Array(n).fill(name) as string[];
const counters = (s: GameState, id: ObjectId, kind = '+1/+1'): number => s.objects[id]!.counters?.[kind] ?? 0;
const lifeOf = (s: GameState, p: 'p1' | 'p2'): number => s.players.find((x) => x.id === p)!.life;
const staticNames = (s: GameState, id: ObjectId): (string | undefined)[] =>
  getChars(s, id).abilities.flatMap((a) => (a.def.kind === 'static' ? a.def.effects : [])).map((e) => (e as { name?: string }).name);
/** Cast `id` (a card in any zone) with a method, answering `answers` and paying automatically. */
const castFrom = (s: GameState, id: ObjectId, method: string | undefined, answers: Parameters<typeof drive>[1] = []): GameState =>
  drive(act(s, { type: 'cast', player: 'p1', card: id, ...(method !== undefined ? { method } : {}) }), answers);

describe('CR 601.2b: a choice between grouped additional costs ("sacrifice a creature or pay {3}")', () => {
  const RITE = synthetic('Test Grim Rite', 'Sorcery', '{B}', 'As an additional cost to cast this spell, sacrifice a creature or pay {3}.\nDraw two cards.');
  const board = (swamps: number, creatures: string[] = ['Grizzly Bears']): GameState => scenario(['Swamp', 'Grizzly Bears'], {
    p1: { hand: ['Test Grim Rite'], battlefield: [...lands('Swamp', swamps), ...creatures], library: lands('Grizzly Bears', 4) }, defs: [RITE],
  });

  it('compiles full: two additionalCost statics with one choiceGroup (cm.m6.additional.choice.payMana), and the engine advertises the choice', () => {
    expect(RITE.automation.level).toBe('full');
    expect(RITE.faces[0]!.abilities[0]).toMatchObject({
      kind: 'static', zone: ['stack'],
      effects: [
        { s: 'additionalCost', cost: { other: [{ kind: 'sacrifice', count: 1, filter: { types: ['Creature'] } }] }, choiceGroup: 'cost' },
        { s: 'additionalCost', cost: { mana: [{ kind: 'generic', amount: 3 }] }, choiceGroup: 'cost' },
      ],
    });
  });

  it('CR 601.2b: both payable: the player chooses one before anything else; sacrificing pays only {B}', () => {
    let s = castWith(board(4), 'Test Grim Rite');
    expect(s.pending).toMatchObject({ kind: 'chooseOption', min: 1, max: 1, options: [{ id: '0', label: 'Sacrifice a creature' }, { id: '1', label: '{3}' }], rules: ['CR 601.2b', 'CR 118.8'] });
    s = drive(answer(s, { kind: 'chooseOption', ids: ['0'] }));
    expect(namesIn(s, 'graveyard', 'p1')).toEqual(['Grizzly Bears']);
    expect(topPaid(s).manaSpent).toHaveLength(1);
    s = resolveTop(s);
    expect(handSize(s, 'p1')).toBe(2);
  });

  it('CR 601.2b, 601.2f: choosing to pay {3} keeps the creature and pays {3}{B}', () => {
    let s = castWith(board(4), 'Test Grim Rite');
    s = drive(answer(s, { kind: 'chooseOption', ids: ['1'] }));
    expect(namesIn(s, 'graveyard', 'p1')).toEqual([]);
    expect(topPaid(s).manaSpent).toHaveLength(4);
  });

  it('CR 601.2b, 601.2h: only one cost can be paid: it is paid without a question (no creature: {3}; one land too few for {3}: the sacrifice)', () => {
    const noCreature = castWith(board(4, []), 'Test Grim Rite');
    expect(noCreature.pending?.kind).toBe('priority');
    expect(topPaid(noCreature).manaSpent).toHaveLength(4);
    expect(noCreature.log.some((l) => /pays the only additional cost of Test Grim Rite that can be paid: \{3\}/.test(l.text))).toBe(true);
    const fewLands = castWith(board(1), 'Test Grim Rite');
    expect(fewLands.pending?.kind).toBe('priority');
    expect(namesIn(fewLands, 'graveyard', 'p1')).toEqual(['Grizzly Bears']);
  });

  it('CR 601.2h: neither cost can be paid: the spell is not castable (castCheck, legal actions)', () => {
    const s = board(2, []);
    const id = find(s, 'Test Grim Rite', 'hand');
    expect(legalActions(s, 'p1').some((a) => a.kind === 'cast' && a.object === id)).toBe(false);
    expect(legalActions(board(2), 'p1').some((a) => a.kind === 'cast' && a.object === find(board(2), 'Test Grim Rite', 'hand'))).toBe(true);
  });

  it('CR 601.2b: the grouped cost is announced before targets (Bone Shards style: the target is chosen after the cost)', () => {
    const SHARDS = synthetic('Test Bone Spike', 'Sorcery', '{B}', 'As an additional cost to cast this spell, sacrifice a creature or discard a card.\nDestroy target creature.');
    expect(SHARDS.automation.level).toBe('full');
    let s = scenario(['Swamp', 'Grizzly Bears', 'Hill Giant'], { p1: { hand: ['Test Bone Spike', 'Hill Giant'], battlefield: ['Swamp', 'Grizzly Bears'] }, p2: { battlefield: ['Hill Giant'] }, defs: [SHARDS] });
    const giant = find(s, 'Hill Giant', 'battlefield', 'p2');
    s = castWith(s, 'Test Bone Spike');
    expect(s.pending?.kind).toBe('chooseOption');
    s = answer(s, { kind: 'chooseOption', ids: ['1'] }); // discard a card
    expect(s.pending?.kind).toBe('chooseTargets');
    s = resolveTop(drive(s, [target(giant)]));
    expect(namesIn(s, 'graveyard', 'p1')).toEqual(expect.arrayContaining(['Hill Giant', 'Test Bone Spike']));
    expect(namesIn(s, 'graveyard', 'p2')).toEqual(['Hill Giant']);
  });
});

describe('CR 702.33b, 702.33d, 702.33f: two kickers ("Kicker {B} and/or {R}", Archangel of Wrath)', () => {
  const board = (): GameState => scenario(['Archangel of Wrath', 'Swamp', 'Mountain', 'Plains'], {
    p1: { hand: ['Archangel of Wrath'], battlefield: [...lands('Plains', 4), 'Swamp', 'Mountain'] },
  });

  it('CR 702.33b: the line is two kicker abilities with their own words, expanded to "kicker" and "kicker:2"; the card is full', () => {
    const d = gamePath('Archangel of Wrath');
    expect(d.automation.level).toBe('full');
    expect(d.faces[0]!.abilities.slice(0, 2)).toMatchObject([
      { kind: 'keyword', keyword: 'kicker', text: 'Kicker {B}', cost: { mana: [{ kind: 'colored', color: 'B' }] } },
      { kind: 'keyword', keyword: 'kicker', text: 'Kicker {R}', cost: { mana: [{ kind: 'colored', color: 'R' }] } },
    ]);
    const s = board();
    expect(staticNames(s, find(s, 'Archangel of Wrath', 'hand'))).toEqual(['kicker', 'kicker:2']);
  });

  it('CR 702.33d: kickCount = 2 with both kickers: both enters triggers (2 damage each)', () => {
    let s = castWith(board(), 'Archangel of Wrath', [yes, yes]);
    expect(topPaid(s)).toMatchObject({ kicked: 2, additional: ['kicker', 'kicker:2'] });
    s = resolveTop(s, [target('p2'), target('p2')]); // CR 603.3d: each trigger's target is chosen as it is put on the stack
    expect(stackNames(s)).toHaveLength(2);
    s = resolveAll(s);
    expect(lifeOf(s, 'p2')).toBe(16);
  });

  it('CR 702.33d: paying only the second kicker makes it kicked once: only the "if it was kicked" trigger', () => {
    let s = castWith(board(), 'Archangel of Wrath', [no, yes]);
    expect(topPaid(s)).toMatchObject({ kicked: 1, additional: ['kicker:2'] });
    s = resolveTop(s, [target('p2')]);
    expect(stackNames(s)).toHaveLength(1);
    s = resolveAll(s);
    expect(lifeOf(s, 'p2')).toBe(18);
  });

  it('not kicked: no trigger at all (CR 603.4)', () => {
    const s = resolveTop(castWith(board(), 'Archangel of Wrath', [no, no]));
    expect(s.zones.stack).toEqual([]);
  });
});

describe('CR 702.33d-e: "for each time it was kicked" reads q:kickCount (CR 400.7d: the permanent remembers)', () => {
  it('CR 702.33d: multikicker paid three times: Everflowing Chalice enters with three charge counters (none when not kicked)', () => {
    expect(gamePath('Everflowing Chalice').faces[0]!.abilities[1]).toMatchObject({
      kind: 'static', effects: [{ s: 'replace', body: { b: 'enters', counters: [{ kind: 'charge', count: { q: 'kickCount' } }] } }],
    });
    const board = (): GameState => scenario(['Everflowing Chalice', 'Mountain'], { p1: { hand: ['Everflowing Chalice'], battlefield: lands('Mountain', 8) } });
    let s = castWith(board(), 'Everflowing Chalice');
    s = resolveTop(drive(answer(s, { kind: 'chooseNumber', n: 3 })));
    expect(counters(s, find(s, 'Everflowing Chalice', 'battlefield'), 'charge')).toBe(3);
    s = castWith(board(), 'Everflowing Chalice');
    s = resolveTop(drive(answer(s, { kind: 'chooseNumber', n: 0 })));
    expect(counters(s, find(s, 'Everflowing Chalice', 'battlefield'), 'charge')).toBe(0);
  });

  it('CR 702.33d: two +1/+1 counters for each time it was kicked, with two kickers', () => {
    const MIND = synthetic('Test Twin Mindbender', 'Creature — Merfolk', '{2}{U}', 'Kicker {1} and/or {2}\nThis creature enters with two +1/+1 counters on it for each time it was kicked.', { power: '1', toughness: '1' } as never);
    expect(MIND.faces[0]!.abilities[2]).toMatchObject({ effects: [{ body: { counters: [{ kind: '+1/+1', count: { q: 'math', op: '*', args: [2, { q: 'kickCount' }] } }] } }] });
    const board = (): GameState => scenario(['Island'], { p1: { hand: ['Test Twin Mindbender'], battlefield: lands('Island', 6) }, defs: [MIND] });
    const both = resolveTop(castWith(board(), 'Test Twin Mindbender', [yes, yes]));
    expect(counters(both, find(both, 'Test Twin Mindbender', 'battlefield'))).toBe(4);
    const one = resolveTop(castWith(board(), 'Test Twin Mindbender', [yes, no]));
    expect(counters(one, find(one, 'Test Twin Mindbender', 'battlefield'))).toBe(2);
  });

  it('CR 702.33e, 400.7d: "When ~ enters, you gain 3 life for each time it was kicked" reads the permanent\'s cast record', () => {
    const ARENA = synthetic('Test Kick Arena', 'Creature — Elf', '{1}{G}', 'Kicker {1} and/or {2}\nWhen this creature enters, you gain 3 life for each time it was kicked.', { power: '1', toughness: '1' } as never);
    expect(ARENA.faces[0]!.abilities[2]).toMatchObject({ kind: 'triggered', effect: { steps: [{ op: 'gainLife', amount: { q: 'math', op: '*', args: [3, { q: 'kickCount' }] } }] } });
    let s = scenario(['Forest'], { p1: { hand: ['Test Kick Arena'], battlefield: lands('Forest', 6) }, defs: [ARENA] });
    s = resolveAll(resolveTop(castWith(s, 'Test Kick Arena', [yes, yes])));
    expect(lifeOf(s, 'p1')).toBe(26);
  });

  it('CR 400.7d, 702.33e: "If it was kicked, draw a card" in the creature\'s own enters trigger reads its cast record, also after it left (last known information)', () => {
    const ELF = synthetic('Test Kick Scout', 'Creature — Elf', '{G}', 'Kicker {2}\nWhen this creature enters, draw a card. If it was kicked, draw a card.', { power: '1', toughness: '1' } as never);
    expect(ELF.automation.level).toBe('full');
    const board = (): GameState => scenario(['Forest', 'Grizzly Bears'], { p1: { hand: ['Test Kick Scout'], battlefield: lands('Forest', 3), library: lands('Grizzly Bears', 4) }, defs: [ELF] });
    const kicked = resolveAll(resolveTop(castWith(board(), 'Test Kick Scout', [yes])));
    expect(handSize(kicked, 'p1')).toBe(2);
    const plain = resolveAll(resolveTop(castWith(board(), 'Test Kick Scout', [no])));
    expect(handSize(plain, 'p1')).toBe(1);
  });
});

describe('CR 614.15, 702.33e: "If ~ was kicked, it deals 4 damage instead" (Burst Lightning)', () => {
  const board = (): GameState => scenario(['Burst Lightning', 'Mountain'], { p1: { hand: ['Burst Lightning'], battlefield: lands('Mountain', 5) } });

  it('parses to one damage instruction with a kicked replacement of its amount (rid.m6.instead.damage)', () => {
    const d = gamePath('Burst Lightning');
    expect(d.faces[0]!.abilities[1]).toMatchObject({
      kind: 'spell',
      effect: {
        targets: [{ id: 't0' }],
        steps: [{
          op: 'if', cond: { cond: 'wasCast', kicked: true },
          then: [{ op: 'damage', source: { ref: 'self' }, to: { ref: 'target', id: 't0' }, amount: 4 }],
          else: [{ op: 'damage', source: { ref: 'self' }, to: { ref: 'target', id: 't0' }, amount: 2 }],
        }],
      },
    });
  });

  it('kicked: 4 damage; not kicked: 2 damage', () => {
    const kicked = resolveTop(castWith(board(), 'Burst Lightning', [yes, target('p2')]));
    expect(lifeOf(kicked, 'p2')).toBe(16);
    const plain = resolveTop(castWith(board(), 'Burst Lightning', [no, target('p2')]));
    expect(lifeOf(plain, 'p2')).toBe(18);
  });
});

describe('CR 702.138: escape', () => {
  const WOLF = synthetic('Test Ash Wolf', 'Creature — Wolf', '{2}{R}', 'Escape—{R}{R}, Exile two other cards from your graveyard.\nThis creature escapes with a +1/+1 counter on it.', { power: '2', toughness: '2' } as never);
  const TITAN = synthetic('Test Ember Titan', 'Creature — Giant', '{1}{R}', 'When this creature enters, sacrifice it unless it escaped.\nEscape—{R}{R}, Exile three other cards from your graveyard.', { power: '6', toughness: '6' } as never);
  const SPARK = synthetic('Test Spark Lash', 'Sorcery', '{R}', 'Test Spark Lash deals 2 damage to any target.\nEscape—{1}{R}, Exile two other cards from your graveyard.');
  const DEFS: CardDef[] = [WOLF, TITAN, SPARK];
  const board = (graveyard: string[], others: number, hand: string[] = []): GameState => scenario(['Mountain', 'Grizzly Bears'], {
    p1: { hand, graveyard: [...graveyard, ...lands('Grizzly Bears', others)], battlefield: lands('Mountain', 4) }, defs: DEFS,
  });

  it('keyword:escape is advertised (keywords/data/escape.json: an alternative cost from the graveyard, CR 702.138a); the three cards are full', () => {
    expect(WOLF.automation.level).toBe('full');
    expect(SPARK.automation.level).toBe('full');
    expect(TITAN.faces[0]!.abilities[0]).toMatchObject({ kind: 'triggered', effect: { steps: [{ op: 'if', cond: { cond: 'not', of: { cond: 'wasCast', via: 'escape' } }, then: [{ op: 'sacrifice', what: { ref: 'self' } }] }] } });
    const s = board(['Test Ash Wolf'], 2);
    const wolf = find(s, 'Test Ash Wolf', 'graveyard');
    expect(legalActions(s, 'p1').filter((a) => a.kind === 'cast' && a.object === wolf).map((a) => (a.action as { method?: string }).method)).toEqual(['escape']);
  });

  it('CR 702.138a, 702.138c: escaped from the graveyard: {R}{R} paid, two other cards exiled, it enters with a +1/+1 counter', () => {
    let s = board(['Test Ash Wolf'], 2);
    s = castFrom(s, find(s, 'Test Ash Wolf', 'graveyard'), 'escape');
    expect(topPaid(s)).toMatchObject({ alternative: 'escape' });
    expect(topPaid(s).manaSpent).toHaveLength(2);
    expect(namesIn(s, 'exile', 'p1')).toEqual(['Grizzly Bears', 'Grizzly Bears']);
    s = resolveTop(s);
    const wolf = find(s, 'Test Ash Wolf', 'battlefield');
    expect(counters(s, wolf)).toBe(1);
    expect(s.objects[wolf]!.cast).toMatchObject({ from: 'graveyard', via: 'escape' });
  });

  it('CR 702.138c: cast from the hand it did not escape: no counter', () => {
    const s = resolveTop(castWith(board([], 2, ['Test Ash Wolf']), 'Test Ash Wolf'));
    expect(counters(s, find(s, 'Test Ash Wolf', 'battlefield'))).toBe(0);
  });

  it('CR 702.138a, 601.2h: escape needs enough OTHER cards in the graveyard; it is not offered from the hand', () => {
    const s = board(['Test Ash Wolf'], 1);
    const wolf = find(s, 'Test Ash Wolf', 'graveyard');
    expect(legalActions(s, 'p1').some((a) => a.kind === 'cast' && a.object === wolf)).toBe(false);
    const h = board([], 3, ['Test Ash Wolf']);
    const inHand = find(h, 'Test Ash Wolf', 'hand');
    expect(legalActions(h, 'p1').filter((a) => a.kind === 'cast' && a.object === inHand).map((a) => (a.action as { method?: string }).method)).toEqual([undefined]);
  });

  it('CR 702.138b: "sacrifice it unless it escaped": cast from the hand it is sacrificed, escaped it stays', () => {
    let s = resolveAll(resolveTop(castWith(board([], 3, ['Test Ember Titan']), 'Test Ember Titan')));
    expect(namesIn(s, 'graveyard', 'p1')).toContain('Test Ember Titan');
    s = board(['Test Ember Titan'], 3);
    s = resolveAll(resolveTop(castFrom(s, find(s, 'Test Ember Titan', 'graveyard'), 'escape')));
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Ember Titan')).toBe(true);
  });

  it('CR 702.138a: an escaped sorcery resolves and goes to the graveyard as usual (escape is not flashback: no exile)', () => {
    let s = board(['Test Spark Lash'], 2);
    s = castFrom(s, find(s, 'Test Spark Lash', 'graveyard'), 'escape', [target('p2')]);
    s = resolveTop(s);
    expect(lifeOf(s, 'p2')).toBe(18);
    expect(namesIn(s, 'graveyard', 'p1')).toEqual(['Test Spark Lash']);
  });
});
