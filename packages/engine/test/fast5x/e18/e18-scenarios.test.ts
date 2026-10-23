/**
 * FAST5X E18: Storied (the enduring story) and recruit, played through the engine with synthetic cards compiled by the game's default compiler (wordings and
 * names are invented, design 6.10).
 *
 * RULE SOURCE: CR 702.195 (Storied) and 701.70 (recruit), since the 2026-09-25 edition; built first from the reminder text, which says the same:
 *   Storied: "If you control three or more artifacts, legendaries, and/or Sagas, you have an enduring story for the rest of the game." Read like ascend on a
 *            permanent (CR 702.131b: "any time", not a trigger) and the city's blessing (CR 702.131c: kept for the rest of the game); legendary is CR 205.4d,
 *            Saga CR 714.1; a permanent that is several of them counts once.
 *   recruit: "Draw a card, then discard a card. If you discarded a nonland card, create a 1/1 white Human Soldier creature token." (CR 121.1, 701.9, 111.1,
 *            608.2c; the shape of connive, CR 701.50a).
 * Also: "an opponent casts their first noncreature spell each turn" (CR 601.2i: the first of that player's noncreature spells this turn, counted from the
 * game history), "~ doesn't untap during your untap step unless C" (CR 502.3, 611.3a), "as long as C, <filter> have <ability>" (CR 611.3a, 613.1f).
 */
import { describe, expect, it } from 'vitest';
import { charsOfObject, compileCard, hasKeyword, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { act, advanceTo, answer, castAuto, find, pass, passBoth, scenario } from '../../m3/scenario';
import { tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const STORIED = 'Storied (If you control three or more artifacts, legendaries, and/or Sagas, you have an enduring story for the rest of the game.)';
const RECRUIT = '(Draw a card, then discard a card. If you discarded a nonland card, create a 1/1 white Human Soldier creature token.)';

const BARD = card('Test Bard', 'Creature — Dwarf Bard', `${STORIED}\nAs long as you have an enduring story, this creature gets +1/+0 and has vigilance.`, ['2', '2']);
const DREAMER = card('Test Dreamer', 'Creature — Dwarf', `${STORIED}\nThis creature doesn't untap during your untap step unless you have an enduring story.`, ['4', '4']);
const WARDEN = card('Test Warden', 'Creature — Dwarf', `${STORIED}\nAs long as you have an enduring story, artifacts and creatures you control have ward {1}.`, ['2', '2']);
const HERALD = card('Test Herald', 'Creature — Dwarf', 'When this creature enters, if you have an enduring story, you gain 3 life.', ['1', '1']);
const SINGER = card('Test Singer', 'Creature — Dwarf', 'When this creature enters, draw a card. If you have an enduring story, you gain 2 life.', ['1', '1']);
const TRINKET = card('Test Trinket', 'Artifact', '');
const RELIC = card('Test Relic', 'Legendary Artifact', '');
const RELIC2 = card('Test Second Relic', 'Legendary Artifact', '');
const TALE = card('Test Tale', 'Enchantment — Saga', '(As this Saga enters and after your draw step, add a lore counter. Sacrifice after II.)\nI — You gain 1 life.\nII — You gain 1 life.');
const ENLISTER = card('Test Enlister', 'Creature — Human', `When this creature enters, recruit. ${RECRUIT}`, ['1', '1']);
const TRUMPET = card('Test Trumpet', 'Instant', `Counter target spell. If that spell's mana value was 2 or less, recruit. ${RECRUIT}`);
const CHEAP = card('Test Cheap', 'Creature — Bear', '', ['1', '1'], '{1}');
const PRICEY = card('Test Pricey', 'Creature — Bear', '', ['3', '3'], '{3}');
const MATRON = card('Test Matron', 'Legendary Creature — Human Noble', `Whenever an opponent casts their first noncreature spell each turn, you recruit. ${RECRUIT}`, ['2', '2']);
const ZAP = card('Test Zap', 'Instant', 'You gain 1 life.');
const ZAP2 = card('Test Second Zap', 'Instant', 'You gain 1 life.');
const AMBUSHER = card('Test Ambusher', 'Creature — Bear', 'Flash', ['2', '2']);
// review fix (Zenith Chronicler): "each other player" in a trigger on ANY player's spell is the players other than the CASTER (CR 603.2, 608.2), which the
// engine's {ref:'each', who:'otherPlayer'} (the players other than the ability's controller) is not: such a trigger stays below full
const CHRONICLER = card('Test Chronicler', 'Creature — Human Wizard', 'Whenever a player casts their first noncreature spell each turn, each other player draws a card.', ['2', '2']);
const SCRIBE = card('Test Scribe', 'Creature — Human Wizard', 'Whenever you cast your first noncreature spell each turn, each other player draws a card.', ['2', '2']);
const DEFS = [BARD, DREAMER, WARDEN, HERALD, SINGER, TRINKET, RELIC, RELIC2, TALE, ENLISTER, TRUMPET, CHEAP, PRICEY, MATRON, ZAP, ZAP2, AMBUSHER, CHRONICLER, SCRIBE];
const CARDS = ['Plains', 'Hill Giant'];

const story = (s: GameState, p: string): boolean => s.designations.enduringStory?.includes(p) === true;
const nameOf = (s: GameState, id: string): string => s.defs[s.objects[id]!.defId]!.name;
const handOf = (s: GameState, p: string): string[] => s.zones.hand[p]!.map((id) => nameOf(s, id)).sort();
const tokens = (s: GameState, p: string) => s.zones.battlefield.map((id) => s.objects[id]!).filter((o) => o.kind === 'token' && o.controller === p);
const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;

/** Resolve the whole stack; each discard is answered with the named card of the asked player's hand. */
function resolveAll(s0: GameState, discard?: string): GameState {
  let s = s0;
  for (let i = 0; i < 30 && (s.zones.stack.length > 0 || s.pending?.kind !== 'priority'); i++) {
    const d = s.pending;
    if (d?.kind === 'chooseObjects') {
      if (discard === undefined) throw new Error('a discard is asked but the test named no card');
      s = answer(s, { kind: 'chooseObjects', ids: [find(s, discard, 'hand', d.player)] });
    } else s = pass(s);
  }
  return s;
}

describe('the cards compile to full automation', () => {
  it('Storied, the enduring-story statics and conditions, recruit and the first-noncreature-spell trigger are automated', () => {
    for (const d of [BARD, DREAMER, WARDEN, HERALD, SINGER, ENLISTER, TRUMPET, MATRON]) expect(d.automation.level, d.name).toBe('full');
  });
  it('recruit is one action step; the trigger counts the opponent\'s noncreature spells (nthMatching)', () => {
    const steps = (ENLISTER.faces[0]!.abilities[0] as { effect: { steps: unknown[] } }).effect.steps;
    expect(steps).toEqual([{ op: 'action', action: 'recruit', who: { ref: 'you' } }]);
    const on = (MATRON.faces[0]!.abilities[0] as { trigger: { on: unknown[] } }).trigger.on;
    expect(on).toEqual([{ ev: 'cast', player: 'opponent', spell: { notTypes: ['Creature'] }, nth: 1, nthMatching: true }]);
  });
});

describe('Storied (reminder text; CR 702.131b-c analogue): the enduring story', () => {
  it('a player who controls a Storied permanent and three artifacts, legendaries and/or Sagas gets an enduring story; the other player does not', () => {
    const s = scenario(CARDS, { defs: DEFS, p1: { battlefield: ['Test Bard', 'Test Trinket', 'Test Relic', 'Test Tale'] } });
    expect(story(s, 'p1')).toBe(true);
    expect(story(s, 'p2')).toBe(false);
    expect(s.log.some((l) => /enduring story for the rest of the game/.test(l.text) && l.rules?.includes('Storied (reminder text)'))).toBe(true);
  });
  it('two permanents are not three (a legendary artifact counts once, CR 205.4d); a third one gives it at once', () => {
    const s0 = scenario(CARDS, { defs: DEFS, p1: { battlefield: ['Test Bard', 'Test Relic', 'Test Second Relic'], hand: ['Test Trinket'] } });
    expect(story(s0, 'p1')).toBe(false);
    const s = passBoth(castAuto(s0, 'Test Trinket'));
    expect(story(s, 'p1')).toBe(true);
  });
  it('without a Storied permanent there is no enduring story; an opponent\'s Storied permanent does not give you one', () => {
    expect(story(scenario(CARDS, { defs: DEFS, p1: { battlefield: ['Test Trinket', 'Test Relic', 'Test Tale'] } }), 'p1')).toBe(false);
    const s = scenario(CARDS, { defs: DEFS, p1: { battlefield: ['Test Trinket', 'Test Relic', 'Test Tale'] }, p2: { battlefield: ['Test Bard'] } });
    expect(story(s, 'p1')).toBe(false);
    expect(story(s, 'p2')).toBe(false);
  });
  it('the Storied permanent counts when it is itself an artifact, a legendary or a Saga (it is one of the three)', () => {
    const LEGEND = card('Test Legend', 'Legendary Creature — Dwarf', STORIED, ['2', '2']);
    const s = scenario(CARDS, { defs: [...DEFS, LEGEND], p1: { battlefield: ['Test Legend', 'Test Trinket', 'Test Relic'] } });
    expect(story(s, 'p1')).toBe(true);
  });
  it('the enduring story is kept for the rest of the game: it stays when the Storied permanent and the artifacts leave', () => {
    const s0 = scenario(CARDS, { defs: DEFS, p1: { battlefield: ['Test Bard', 'Test Trinket', 'Test Relic', 'Test Tale'] } });
    const cleared = tweak(s0, (t) => {
      for (const id of [...t.zones.battlefield]) {
        t.zones.battlefield = t.zones.battlefield.filter((x) => x !== id);
        t.zones.graveyard[t.objects[id]!.owner]!.push(id);
        t.objects[id]!.zone = 'graveyard';
      }
    });
    expect(story(passBoth(cleared), 'p1')).toBe(true);
  });
});

describe('what an enduring story does (conditions read the designation)', () => {
  it('"as long as you have an enduring story, this creature gets +1/+0 and has vigilance" (CR 611.3a)', () => {
    const without = scenario(CARDS, { defs: DEFS, p1: { battlefield: ['Test Bard', 'Test Trinket'] } });
    const c0 = charsOfObject(without, without.objects[find(without, 'Test Bard', 'battlefield')]!);
    expect([Number(c0.power), hasKeyword(c0, 'vigilance')]).toEqual([2, false]);
    const withStory = scenario(CARDS, { defs: DEFS, p1: { battlefield: ['Test Bard', 'Test Trinket', 'Test Relic', 'Test Second Relic'] } });
    const c1 = charsOfObject(withStory, withStory.objects[find(withStory, 'Test Bard', 'battlefield')]!);
    expect([Number(c1.power), Number(c1.toughness), hasKeyword(c1, 'vigilance')]).toEqual([3, 2, true]);
  });
  it('"as long as you have an enduring story, artifacts and creatures you control have ward {1}" (CR 613.1f)', () => {
    const s = scenario(CARDS, { defs: DEFS, p1: { battlefield: ['Test Warden', 'Test Trinket', 'Test Relic', 'Test Tale'] }, p2: { battlefield: ['Test Second Relic'] } });
    const has = (name: string): boolean => hasKeyword(charsOfObject(s, s.objects[find(s, name, 'battlefield')]!), 'ward');
    expect([has('Test Warden'), has('Test Trinket'), has('Test Tale'), has('Test Second Relic')]).toEqual([true, true, false, false]);
  });
  it('an intervening "if you have an enduring story" (CR 603.4) and an "if" of the effect (CR 608.2c)', () => {
    // (no Saga here: its chapter I would trigger at the first main phase, CR 714.3b)
    const base = { battlefield: ['Test Bard', 'Test Trinket', 'Test Relic', 'Test Second Relic'], hand: ['Test Herald', 'Test Singer'] };
    const s = resolveAll(castAuto(resolveAll(castAuto(scenario(CARDS, { defs: DEFS, p1: base }), 'Test Herald')), 'Test Singer'));
    expect(lifeOf(s, 'p1')).toBe(25);
    const t = resolveAll(castAuto(resolveAll(castAuto(scenario(CARDS, { defs: DEFS, p1: { hand: base.hand } }), 'Test Herald')), 'Test Singer'));
    expect(lifeOf(t, 'p1')).toBe(20);
  });
  it('"this creature doesn\'t untap during your untap step unless you have an enduring story" (CR 502.3)', () => {
    const tapped = { name: 'Test Dreamer', tapped: true };
    const stuck = advanceTo(scenario(CARDS, { defs: DEFS, p1: { battlefield: [tapped, 'Test Trinket'] } }), 3, 'main1');
    expect(stuck.objects[find(stuck, 'Test Dreamer', 'battlefield')]!.tapped).toBe(true);
    const free = advanceTo(scenario(CARDS, { defs: DEFS, p1: { battlefield: [tapped, 'Test Trinket', 'Test Relic', 'Test Tale'] } }), 3, 'main1');
    expect(free.objects[find(free, 'Test Dreamer', 'battlefield')]!.tapped).toBe(false);
  });
});

describe('recruit (reminder text; connive\'s shape, CR 701.50a)', () => {
  it('draws a card, then discards a card; a nonland card discarded creates a 1/1 white Human Soldier creature token (CR 111.1, 608.2c)', () => {
    const s0 = scenario(CARDS, { defs: DEFS, p1: { hand: ['Test Enlister', 'Hill Giant'] } });
    const asked = resolveAll(castAuto(s0, 'Test Enlister'), 'Hill Giant');
    expect(handOf(asked, 'p1')).toEqual(['Plains']); // drew a Plains (CR 121.1), discarded the giant (CR 701.9)
    expect(asked.zones.graveyard['p1']!.map((id) => nameOf(asked, id))).toEqual(['Hill Giant']);
    const made = tokens(asked, 'p1');
    expect(made).toHaveLength(1);
    const c = charsOfObject(asked, made[0]!);
    expect([Number(c.power), Number(c.toughness), c.colors, c.types, c.subtypes]).toEqual([1, 1, ['W'], ['Creature'], ['Human', 'Soldier']]);
  });
  it('a land card discarded creates no token', () => {
    const s = resolveAll(castAuto(scenario(CARDS, { defs: DEFS, p1: { hand: ['Test Enlister', 'Hill Giant'] } }), 'Test Enlister'), 'Plains');
    expect(handOf(s, 'p1')).toEqual(['Hill Giant']);
    expect(tokens(s, 'p1')).toHaveLength(0);
  });
  it('"Counter target spell. If that spell\'s mana value was 2 or less, recruit." reads the countered spell\'s mana value (CR 608.2h)', () => {
    const lands = ['Plains', 'Plains', 'Plains', 'Plains'];
    const run = (victim: string): GameState => {
      const s0 = scenario(CARDS, { defs: DEFS, p1: { hand: [victim, 'Test Trumpet', 'Hill Giant'], battlefield: lands } });
      const onStack = castAuto(s0, victim);
      const spell = onStack.zones.stack[0]!;
      return resolveAll(castAuto(onStack, 'Test Trumpet', { answers: [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: spell }] }] }), 'Hill Giant');
    };
    const cheap = run('Test Cheap');
    expect(cheap.zones.graveyard['p1']!.map((id) => nameOf(cheap, id)).sort()).toEqual(['Hill Giant', 'Test Cheap', 'Test Trumpet']);
    expect(tokens(cheap, 'p1')).toHaveLength(1);
    const pricey = run('Test Pricey');
    expect(handOf(pricey, 'p1')).toEqual(['Hill Giant']); // no recruit: nothing drawn, nothing discarded
    expect(tokens(pricey, 'p1')).toHaveLength(0);
  });
});

describe('CR 601.2i: "whenever an opponent casts their first noncreature spell each turn, you recruit"', () => {
  /** p1 passes priority in its main phase; p2 casts the named spell. */
  const p2Casts = (s: GameState, name: string): GameState => castAuto(s.pending?.player === 'p1' ? pass(s) : s, name, { player: 'p2' });
  const board = (): GameState => scenario(CARDS, { defs: DEFS, p1: { battlefield: ['Test Matron'], hand: ['Hill Giant'] }, p2: { hand: ['Test Zap', 'Test Second Zap', 'Test Ambusher'] } });
  const triggered = (s: GameState): boolean => s.log.some((l) => /Test Matron triggers/.test(l.text));

  it('the opponent\'s first noncreature spell of the turn triggers it; the second does not', () => {
    const first = p2Casts(board(), 'Test Zap');
    const s1 = resolveAll(pass(first), 'Hill Giant');
    expect(triggered(s1)).toBe(true);
    expect(tokens(s1, 'p1')).toHaveLength(1);
    const before = s1.log.length;
    const s2 = resolveAll(p2Casts(s1, 'Test Second Zap'), 'Hill Giant');
    expect(s2.log.slice(before).some((l) => /Test Matron triggers/.test(l.text))).toBe(false);
    expect(tokens(s2, 'p1')).toHaveLength(1);
  });
  it('a creature spell cast first does not count: the first NONCREATURE spell after it still triggers it', () => {
    const s1 = resolveAll(p2Casts(board(), 'Test Ambusher'));
    expect(triggered(s1)).toBe(false);
    const s2 = resolveAll(p2Casts(s1, 'Test Zap'), 'Hill Giant');
    expect(triggered(s2)).toBe(true);
    expect(tokens(s2, 'p1')).toHaveLength(1);
  });
  it('your own spells never trigger it', () => {
    const s = resolveAll(castAuto(scenario(CARDS, { defs: DEFS, p1: { battlefield: ['Test Matron'], hand: ['Test Zap'] } }), 'Test Zap'));
    expect(triggered(s)).toBe(false);
  });
  it('it counts from the game history: a noncreature spell the opponent cast before it was on the battlefield makes the next one the second', () => {
    const s0 = scenario(CARDS, { defs: DEFS, p1: { hand: ['Test Matron', 'Hill Giant'] }, p2: { hand: ['Test Zap', 'Test Second Zap'] } });
    const zapped = resolveAll(p2Casts(s0, 'Test Zap'));
    // p1 gets priority back (main phase, empty stack) and casts the matron at sorcery speed
    const withMatron = resolveAll(castAuto(zapped.pending?.player === 'p1' ? zapped : act(zapped, { type: 'pass', player: zapped.pending!.player }), 'Test Matron'));
    const s = resolveAll(p2Casts(withMatron, 'Test Second Zap'));
    expect(triggered(s)).toBe(false);
  });
});

describe('review fix: "each other player" in a trigger on another player\'s spell (CR 603.2, 608.2)', () => {
  it('"whenever a player casts their first noncreature spell each turn, each other player draws a card" is not full (the others are the caster\'s)', () => {
    expect(CHRONICLER.automation.level).not.toBe('full');
  });
  it('an opponent casting the spell never makes that opponent draw for it (p1 controls it, p2 casts)', () => {
    const s0 = scenario(CARDS, { defs: DEFS, p1: { battlefield: ['Test Chronicler'] }, p2: { hand: ['Test Zap'] } });
    const before = s0.zones.hand['p2']!.length;
    const s = resolveAll(castAuto(s0.pending?.player === 'p1' ? pass(s0) : s0, 'Test Zap', { player: 'p2' }));
    expect(s.zones.hand['p2']!.length).toBe(before - 1); // the Zap left; no card drawn
  });
  it('"whenever you cast your first noncreature spell each turn, each other player draws a card": the caster is the controller, so it is full and plays', () => {
    expect(SCRIBE.automation.level).toBe('full');
    const s0 = scenario(CARDS, { defs: DEFS, p1: { battlefield: ['Test Scribe'], hand: ['Test Zap'] } });
    const p1 = s0.zones.hand['p1']!.length, p2 = s0.zones.hand['p2']!.length;
    const s = resolveAll(castAuto(s0, 'Test Zap'));
    expect(s.zones.hand['p1']!.length).toBe(p1 - 1);
    expect(s.zones.hand['p2']!.length).toBe(p2 + 1);
  });
});
