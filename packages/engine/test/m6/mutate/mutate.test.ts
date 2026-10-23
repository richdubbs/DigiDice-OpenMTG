/**
 * M6-9 (m6 design 3.7, 5 "M6-9"): mutate (CR 702.140) and merged permanents (CR 730.2): casting for the mutate cost, merging over or under as the spell
 * resolves, the merged permanent's characteristics (the topmost component's plus every component's abilities), not a new object, the mutate trigger.
 * The acceptance card is Gemrazer (fixture), on the game path.
 */
import { describe, expect, it } from 'vitest';
import { ENGINE_CAPABILITIES, getChars, legalActions, ptNumbers, type GameState } from '../../../src/index';
import { LAYOUT_SUPPORT } from '../../../src/cards/layout-support';
import { LAYOUT_CAPS } from '../../../src/cards/pipeline';
import { ELVES, ENTER_WATCH, GEMRAZER, LEYLINE, OVER, UNDER, VANGUARD, BEARS, act, answer, find, mutate, resolveTop, table, target, tweak } from './support';

const abilitiesOf = (s: GameState, id: string): string[] => getChars(s, id).abilities.map((a) => a.def.text ?? a.def.kind);
const pt = (s: GameState, id: string): [number | null, number | null] => {
  const n = ptNumbers(getChars(s, id));
  return [n.power, n.toughness];
};

describe('CR 702.140a: casting a spell for its mutate cost', () => {
  it('Gemrazer is offered with the method mutate; its cost is {1}{G}{G} (an alternative cost); the target is a non-Human creature you own', () => {
    const s = table([ELVES, VANGUARD], { theirs: [BEARS] });
    const la = legalActions(s, 'p1').filter((a) => a.kind === 'cast' && a.action.type === 'cast' && a.action.method === 'mutate');
    expect(la).toHaveLength(1);
    const t = act(s, { type: 'cast', player: 'p1', card: find(s, GEMRAZER, 'hand'), method: 'mutate' });
    expect(t.pending?.kind).toBe('chooseTargets');
    const opts = t.pending?.kind === 'chooseTargets' ? t.pending.objects : [];
    expect(t.pending?.kind === 'chooseTargets' && t.pending.targetText).toBe('target non-Human creature you own');
    expect(opts).toContain(find(s, ELVES, 'battlefield'));
    expect(opts).not.toContain(find(s, VANGUARD, 'battlefield')); // a Human
    expect(opts).not.toContain(find(s, BEARS, 'battlefield', 'p2')); // not the same owner
    const cast = mutate(s, find(s, ELVES, 'battlefield'));
    expect(cast.zones.stack).toHaveLength(1);
    expect(cast.objects[cast.zones.stack[0]!]!.stack?.costsPaid.alternative).toBe('mutate');
    expect(cast.zones.battlefield.filter((id) => cast.objects[id]!.tapped)).toHaveLength(3); // {1}{G}{G}, not {3}{G}
  });

  it('the capabilities: keyword:mutate, feature:ev.becomes.mutated, the mutate layout lifted; Gemrazer is full on the game path', () => {
    expect(ENGINE_CAPABILITIES.has('keyword:mutate')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('feature:ev.becomes.mutated')).toBe(true);
    expect(LAYOUT_SUPPORT.mutate).toBe(true);
    expect(Object.keys(LAYOUT_CAPS)).not.toContain('mutate');
    const s = table([]);
    expect(s.defs[GEMRAZER]!.automation.level).toBe('full');
  });
});

describe('CR 702.140c, 702.140e, 730.2a: the spell merges over or under the creature', () => {
  it('on top: one creature, Gemrazer 4/4 with reach and trample, and the Elves\' mana ability; the mutate trigger destroys the opponent\'s enchantment', () => {
    let s = table([ELVES], { theirs: [LEYLINE] });
    const elves = find(s, ELVES, 'battlefield');
    s = resolveTop(mutate(s, elves), [OVER, target(find(s, LEYLINE, 'battlefield', 'p2'))]);
    expect(s.zones.battlefield.filter((id) => [GEMRAZER, ELVES].includes(s.objects[id]!.defId))).toEqual([elves]); // one object, the same one (CR 730.2c)
    const o = s.objects[elves]!;
    expect(o.defId).toBe(GEMRAZER);
    expect(o.components?.map((c) => c.defId)).toEqual([GEMRAZER, ELVES]);
    expect(getChars(s, elves).name).toBe(GEMRAZER);
    expect(pt(s, elves)).toEqual([4, 4]);
    expect(getChars(s, elves).keywords.map((k) => k.keyword).sort()).toEqual(['mutate', 'reach', 'trample']);
    expect(abilitiesOf(s, elves).some((t) => /Add \{G\}/.test(t))).toBe(true); // CR 702.140e: the Elves' "{T}: Add {G}."
    expect(s.zones.stack).toHaveLength(1); // the mutate trigger (CR 702.140d)
    s = resolveTop(s);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === LEYLINE)).toBe(false);
    expect(s.zones.graveyard.p2!.some((id) => s.objects[id]!.defId === LEYLINE)).toBe(true);
    expect(s.log.some((l) => /mutates onto Llanowar Elves/.test(l.text))).toBe(true);
  });

  it('underneath: it stays Llanowar Elves 1/1 and has Gemrazer\'s reach, trample and mutate trigger', () => {
    let s = table([ELVES], { theirs: [LEYLINE] });
    const elves = find(s, ELVES, 'battlefield');
    s = resolveTop(mutate(s, elves), [UNDER, target(find(s, LEYLINE, 'battlefield', 'p2'))]);
    const o = s.objects[elves]!;
    expect(o.defId).toBe(ELVES);
    expect(o.components?.map((c) => c.defId)).toEqual([ELVES, GEMRAZER]);
    expect(getChars(s, elves).name).toBe(ELVES);
    expect(pt(s, elves)).toEqual([1, 1]);
    expect(getChars(s, elves).keywords.map((k) => k.keyword)).toEqual(expect.arrayContaining(['reach', 'trample']));
    expect(s.zones.stack).toHaveLength(1); // the trigger of the component under it (CR 702.140e)
    s = resolveTop(s);
    expect(s.zones.graveyard.p2!.some((id) => s.objects[id]!.defId === LEYLINE)).toBe(true);
  });

  it('CR 702.140e: the merged permanent can use the mana ability it got from a component', () => {
    let s = table([ELVES]);
    const elves = find(s, ELVES, 'battlefield');
    s = resolveTop(mutate(s, elves), [OVER]);
    const la = legalActions(s, 'p1').find((a) => a.kind === 'activate' && a.object === elves);
    expect(la).toBeDefined();
  });
});

describe('CR 730.2b-c: a merged permanent is the same object', () => {
  it('no enters triggers; it keeps its counters, damage and the turn it came under its controller\'s control (summoning sickness)', () => {
    let s = table([ELVES, 'Test Arrival Watcher'], { defs: [ENTER_WATCH] });
    const elves = find(s, ELVES, 'battlefield');
    s = tweak(s, (x) => {
      x.objects[elves]!.counters['+1/+1'] = 2;
      x.objects[elves]!.damage = 1;
      x.objects[elves]!.controlledSinceTurn = x.turn.number; // it came under p1's control this turn
    });
    const life = s.players[0]!.life;
    s = resolveTop(mutate(s, elves), [OVER]);
    expect(s.players[0]!.life).toBe(life); // nothing entered the battlefield (CR 730.2b)
    expect(s.zones.stack).toHaveLength(0); // Gemrazer's trigger has no legal target (CR 603.3d); no enters trigger
    const o = s.objects[elves]!;
    expect([o.counters['+1/+1'], o.damage, o.controlledSinceTurn]).toEqual([2, 1, s.turn.number]);
    expect(pt(s, elves)).toEqual([6, 6]);
    expect(legalActions(s, 'p1').some((a) => a.kind === 'activate' && a.object === elves)).toBe(false); // still summoning sick: no {T} ability (CR 302.6)
  });

  it('CR 730.2c: an effect that affected it continues to: Giant Growth before the merge, Gemrazer on top is a 7/7', () => {
    let s = table([ELVES], { hand: ['Giant Growth'] });
    const elves = find(s, ELVES, 'battlefield');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Giant Growth', 'hand') });
    s = resolveTop(answerTargets(s, elves));
    expect(pt(s, elves)).toEqual([4, 4]);
    s = resolveTop(mutate(s, elves), [OVER]);
    expect(pt(s, elves)).toEqual([7, 7]);
  });
});

describe('CR 702.140b: an illegal target', () => {
  it('the target left: Gemrazer resolves as a creature spell, enters the battlefield (enters triggers see it) as its own 4/4', () => {
    let s = table([ELVES, 'Test Arrival Watcher'], { defs: [ENTER_WATCH] });
    const elves = find(s, ELVES, 'battlefield');
    s = mutate(s, elves);
    s = tweak(s, (x) => { // the Elves left the battlefield in response
      x.zones.battlefield.splice(x.zones.battlefield.indexOf(elves), 1);
      x.objects[elves]!.zone = 'graveyard';
      x.zones.graveyard.p1!.push(elves);
    });
    const life = s.players[0]!.life;
    s = resolveTop(s);
    const gem = find(s, GEMRAZER, 'battlefield');
    expect(s.objects[gem]!.components).toBeUndefined();
    expect(pt(s, gem)).toEqual([4, 4]);
    expect(s.log.some((l) => l.rules?.includes('CR 702.140b'))).toBe(true);
    s = resolveTop(s); // the watcher's trigger (no mutate trigger: it did not mutate)
    expect(s.players[0]!.life).toBe(life + 1);
  });
});

function answerTargets(s: GameState, id: string): GameState {
  let t = s;
  while (t.pending && t.pending.kind !== 'priority') t = t.pending.kind === 'payCost' ? answer(t, { kind: 'payCost', auto: true }) : answer(t, target(id));
  return t;
}
