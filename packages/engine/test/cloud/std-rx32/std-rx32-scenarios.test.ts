/**
 * Card wave 2, Standard lane rx32 (std-rx32): the round's engine concepts played through the engine with synthetic cards (invented names and wordings, design
 * 6.10), compiled by the game's default compiler. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 611.2b, 602.5      "Tap target permanent. Its activated abilities can't be activated for as long as it remains tapped.": the duration is about the
 *                         target, not the source (`whileObject`); it ends the moment the target untaps and never begins again
 *   CR 611.2b, 400.7      the same duration ends when the target leaves the battlefield (a new object); an effect whose object is already untapped never begins
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, legalActions, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, life, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** The card is parsed and automated without a manual unit (a template's experimental status caps the level; that is not checked here). */
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

/** Pass priority, answering targets, costs and yes/no, until the stack is empty and p1 has priority again. */
function settle(s0: GameState, targets: (ObjectId | ObjectId[])[] = []): GameState {
  let s = s0;
  const queue = [...targets]; // one target (or a list for one spec) per target decision, in order
  for (let guard = 0; guard < 60 && s.pending && !(s.pending.kind === 'priority' && s.zones.stack.length === 0 && s.pending.player === 'p1'); guard++) {
    const d = s.pending;
    if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: queue.length > 0 ? [queue.shift()!].flat().map((id) => ({ kind: 'object' as const, id })) : [] });
    else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: d.items.map((i) => i.id) });
    else if (d.kind === 'priority') s = pass(s);
    else throw new Error(`unexpected decision ${d.kind}`);
  }
  return s;
}
const canActivate = (s: GameState, source: ObjectId): boolean => !applyAction(s, { type: 'activate', player: 'p1', source, ability: 'p:0:0' }).error;

describe('CR 611.2b, 602.5: "Its activated abilities can\'t be activated for as long as it remains tapped" (duration whileObject)', () => {
  const NET = card('Test Snare Loom', 'Artifact', '{T}: Tap another target nonland permanent. Its activated abilities can\'t be activated for as long as it remains tapped.');
  const ROCK = card('Test Humming Rock', 'Artifact', '{0}: You gain 1 life.');
  const DEFS = [NET, ROCK];
  const setup = (): { s: GameState; net: ObjectId; rock: ObjectId } => {
    const s = scenario([], { p1: { battlefield: ['Test Snare Loom', 'Test Humming Rock'] }, defs: DEFS });
    return { s, net: find(s, 'Test Snare Loom', 'battlefield', 'p1'), rock: find(s, 'Test Humming Rock', 'battlefield', 'p1') };
  };
  it('is parsed and automated, the duration naming the target', () => {
    expect(automated(NET)).toBe(true);
    const json = JSON.stringify(NET.faces[0]!.abilities);
    expect(json).toContain('"duration":{"d":"whileObject","object":{"ref":"target","id":"t0"},"as":"tapped"}');
  });
  it('the tapped target\'s abilities can\'t be activated while it stays tapped; the source\'s own state does not matter', () => {
    let { s, net, rock } = setup();
    expect(canActivate(s, rock)).toBe(true);
    s = settle(act(s, { type: 'activate', player: 'p1', source: net, ability: 'p:0:0' }), [rock]);
    expect(s.objects[rock]!.tapped).toBe(true);
    expect(canActivate(s, rock)).toBe(false);
    s.objects[net]!.tapped = false; // the source untapping ends nothing
    expect(canActivate(s, rock)).toBe(false);
  });
  it('it ends the moment the target untaps, and tapping it again does not restart it', () => {
    let { s, net, rock } = setup();
    s = settle(act(s, { type: 'activate', player: 'p1', source: net, ability: 'p:0:0' }), [rock]);
    s.objects[rock]!.tapped = false;
    expect(canActivate(s, rock)).toBe(true); // judged live (statics/rule-sources.ts)
    s = settle(act(s, { type: 'activate', player: 'p1', source: rock, ability: 'p:0:0' }));
    expect(s.continuousEffects.length).toBe(0); // the record ended (core/durations.ts#endDurations)
    s.objects[rock]!.tapped = true;
    expect(canActivate(s, rock)).toBe(true);
  });
  it('the restriction is about that object only: another permanent of the same name is not affected', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Snare Loom', 'Test Humming Rock', 'Test Humming Rock'] }, defs: DEFS });
    const net = find(s0, 'Test Snare Loom', 'battlefield', 'p1');
    const [a, b] = s0.zones.battlefield.filter((id) => s0.objects[id]!.defId === 'Test Humming Rock');
    const s = settle(act(s0, { type: 'activate', player: 'p1', source: net, ability: 'p:0:0' }), [a!]);
    expect(canActivate(s, a!)).toBe(false);
    expect(canActivate(s, b!)).toBe(true);
  });
});

describe('CR 611.2b, 305.7, 613.1d: "It\'s a Swamp in addition to its other types for as long as it has a charge counter on it" (duration whileObject)', () => {
  const ROD = card('Test Brine Rod', 'Artifact', '{T}: Put a charge counter on target land. It\'s a Swamp in addition to its other types for as long as it has a charge counter on it.');
  const FLAT = card('Test Salt Flat', 'Land', '{T}: Add {C}.');
  const DEFS = [ROD, FLAT];
  it('is parsed and automated', () => {
    expect(automated(ROD)).toBe(true);
    expect(JSON.stringify(ROD.faces[0]!.abilities)).toContain('"duration":{"d":"whileObject","object":{"ref":"target","id":"t0"},"as":"counter","counter":"charge"}');
  });
  it('the land is a Swamp while it has the counter, with the Swamp\'s mana ability (CR 305.6); it stops being one when the counter is gone, for good', () => {
    let s = scenario([], { p1: { battlefield: ['Test Brine Rod', 'Test Salt Flat'] }, defs: DEFS });
    const rod = find(s, 'Test Brine Rod', 'battlefield', 'p1');
    const flat = find(s, 'Test Salt Flat', 'battlefield', 'p1');
    s = settle(act(s, { type: 'activate', player: 'p1', source: rod, ability: 'p:0:0' }), [flat]);
    expect(s.objects[flat]!.counters['charge']).toBe(1);
    expect(getChars(s, flat)!.subtypes).toContain('Swamp');
    expect(getChars(s, flat)!.types).toContain('Land');
    s.objects[flat]!.counters = {};
    expect(getChars(s, flat)!.subtypes).not.toContain('Swamp'); // judged live (statics/live.ts)
    s = settle(pass(s));
    s.objects[flat]!.counters = { charge: 1 };
    expect(getChars(s, flat)!.subtypes).not.toContain('Swamp'); // the record ended: a new counter does not restart it (CR 611.2b)
  });
  it('another counter kind does not keep it going', () => {
    let s = scenario([], { p1: { battlefield: ['Test Brine Rod', 'Test Salt Flat'] }, defs: DEFS });
    const rod = find(s, 'Test Brine Rod', 'battlefield', 'p1');
    const flat = find(s, 'Test Salt Flat', 'battlefield', 'p1');
    s = settle(act(s, { type: 'activate', player: 'p1', source: rod, ability: 'p:0:0' }), [flat]);
    s.objects[flat]!.counters = { time: 2 };
    expect(getChars(s, flat)!.subtypes).not.toContain('Swamp');
  });
});

describe('CR 601.2f, 118.7: "The first instant or sorcery spell you cast each turn costs {U} less to cast for each land you control with a charge counter on it"', () => {
  const SEER = card('Test Tidal Seer', 'Creature — Fish', 'The first instant or sorcery spell you cast each turn costs {U} less to cast for each land you control with a charge counter on it.', ['1', '1']);
  const POOL = card('Test Brine Pool', 'Land', '{T}: Add {U}.');
  const IDEA = card('Test Passing Idea', 'Instant', 'You gain 1 life.', undefined, '{2}{U}');
  const DEFS = [SEER, POOL, IDEA];
  const untappedPools = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Brine Pool' && !s.objects[id]!.tapped).length;
  const cast = (s0: GameState): GameState => settle(act(s0, { type: 'cast', player: 'p1', card: s0.zones.hand['p1']!.find((id) => s0.objects[id]!.defId === 'Test Passing Idea')! }));
  const setup = (charged: number): GameState => {
    const pools = Array.from({ length: 6 }, (_, i) => ({ name: 'Test Brine Pool', ...(i < charged ? { counters: { charge: 1 } } : {}) }));
    return scenario([], { p1: { battlefield: ['Test Tidal Seer', ...pools], hand: ['Test Passing Idea', 'Test Passing Idea'] }, defs: DEFS });
  };
  it('is parsed and automated', () => {
    expect(automated(SEER)).toBe(true);
  });
  it('two charged lands: the first spell costs {U} for the colored pip and {1} less generic (CR 118.7b: no more {U} to reduce, so generic); the second pays in full', () => {
    let s = setup(2);
    expect(untappedPools(s)).toBe(6);
    s = cast(s);
    expect(untappedPools(s)).toBe(5); // {2}{U} - {U} - {U}: {1}
    s = cast(s);
    expect(untappedPools(s)).toBe(2); // the second instant this turn: {2}{U}
  });
  it('no charged land: no reduction', () => {
    let s = setup(0);
    s = cast(s);
    expect(untappedPools(s)).toBe(3);
  });
});

describe('CR 205.3m, 701.23a: "Search your library for a Spider Hero card": a card with both subtypes (filter allSubtypes)', () => {
  const SEEKER = card('Test Web Seeker', 'Creature — Spider', '{2}, Sacrifice this creature: Search your library for a Spider Hero card, reveal it, put it into your hand, then shuffle.', ['1', '1']);
  const BOTH = card('Test Web Champion', 'Creature — Spider Human Hero', '', ['2', '2']);
  const SPIDER = card('Test Plain Spider', 'Creature — Spider', '', ['1', '2']);
  const HERO = card('Test Plain Hero', 'Creature — Human Hero', '', ['2', '1']);
  const DEFS = [SEEKER, BOTH, SPIDER, HERO];
  it('is automated, the filter naming both subtypes', () => {
    expect(automated(SEEKER)).toBe(true);
    expect(JSON.stringify(SEEKER.faces[0]!.abilities)).toContain('"filter":{"allSubtypes":["Spider","Hero"]}');
  });
  it('only the card with both subtypes can be found; a Spider or a Hero alone cannot', () => {
    let s = scenario([], { p1: { battlefield: ['Test Web Seeker', 'Plains', 'Plains'], library: ['Test Web Champion', 'Test Plain Spider', 'Test Plain Hero'] }, defs: DEFS });
    const seeker = find(s, 'Test Web Seeker', 'battlefield', 'p1');
    s = act(s, { type: 'activate', player: 'p1', source: seeker, ability: 'p:0:0' });
    let offered: string[] | undefined;
    for (let guard = 0; guard < 40 && s.pending && !(s.pending.kind === 'priority' && s.zones.stack.length === 0); guard++) {
      const d = s.pending;
      if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (d.kind === 'chooseObjects') {
        offered = d.options.map((id) => s.objects[id]!.defId);
        s = answer(s, { kind: 'chooseObjects', ids: d.options.slice(0, 1) });
      } else if (d.kind === 'priority') s = pass(s);
      else throw new Error(`unexpected decision ${d.kind}`);
    }
    expect(offered).toEqual(['Test Web Champion']);
    expect(s.zones.hand['p1']!.map((id) => s.objects[id]!.defId)).toContain('Test Web Champion');
  });
});

describe('CR 120.1, 608.2h: "The creature you control deals damage equal to its power to the creature an opponent controls" ("its" is the source, a target said again)', () => {
  const BITE = card('Test Fang Clash', 'Sorcery', 'Choose target creature you control and target creature an opponent controls.\nIf there are four or more card types among cards in your graveyard, put two +1/+1 counters on the creature you control.\nThe creature you control deals damage equal to its power to the creature an opponent controls.');
  const BEAR = card('Test Moss Bear', 'Creature — Bear', '', ['2', '2']);
  const OX = card('Test Stone Ox', 'Creature — Ox', '', ['1', '4']);
  const ART = card('Test Rusted Cog', 'Artifact', '');
  const ENCH = card('Test Faded Sigil', 'Enchantment', '');
  const INST = card('Test Quick Spark', 'Instant', 'You gain 1 life.');
  const DEFS = [BITE, BEAR, OX, ART, ENCH, INST];
  const play = (graveyard: string[]): { s: GameState; bear: ObjectId; ox: ObjectId } => {
    const s0 = scenario([], { p1: { battlefield: ['Test Moss Bear'], hand: ['Test Fang Clash'], graveyard }, p2: { battlefield: ['Test Stone Ox'] }, defs: DEFS });
    const bear = find(s0, 'Test Moss Bear', 'battlefield', 'p1');
    const ox = find(s0, 'Test Stone Ox', 'battlefield', 'p2');
    const s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Fang Clash', 'hand', 'p1') }), [bear, ox]);
    return { s, bear, ox };
  };
  it('is automated, the damage source and the power read being the first target', () => {
    expect(automated(BITE)).toBe(true);
    expect(JSON.stringify(BITE.faces[0]!.abilities)).toContain('{"op":"damage","source":{"ref":"target","id":"t0"},"to":{"ref":"target","id":"t1"},"amount":{"q":"stat","stat":"power","of":{"ref":"target","id":"t0"}}}');
  });
  it('without four card types in the graveyard: the 2/2 deals 2 to the 1/4, which survives', () => {
    const { s, ox } = play(['Test Rusted Cog']);
    expect(s.objects[ox]!.zone).toBe('battlefield');
    expect(s.objects[ox]!.damage).toBe(2);
  });
  it('with four (artifact, creature, enchantment, instant): two counters first, then 4 damage, and the 1/4 dies', () => {
    const { s, bear } = play(['Test Rusted Cog', 'Test Faded Sigil', 'Test Quick Spark', 'Test Moss Bear']);
    expect(s.objects[bear]!.counters['+1/+1']).toBe(2);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Stone Ox')).toBe(false);
  });
});

describe('CR 702.11b, 702.21a, 603.2: "Creatures your opponents control can be the targets of spells and abilities as though they didn\'t have hexproof. Ward abilities of those creatures don\'t trigger."', () => {
  const NET = card('Test Hunting Lantern', 'Enchantment', 'Creatures your opponents control can be the targets of spells and abilities as though they didn\'t have hexproof. Ward abilities of those creatures don\'t trigger.');
  const ZAP = card('Test Small Zap', 'Instant', 'Test Small Zap deals 1 damage to target creature.');
  const SLY = card('Test Sly Fox', 'Creature — Fox', 'Hexproof', ['2', '2']);
  const VEILED = card('Test Veiled Owl', 'Creature — Bird', 'Shroud', ['2', '2']);
  const WARDED = card('Test Warded Elk', 'Creature — Elk', 'Ward {3}', ['2', '2']);
  const DEFS = [NET, ZAP, SLY, VEILED, WARDED];
  const castAt = (s0: GameState, target: ObjectId): { s: GameState; error?: string } => {
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Small Zap', 'hand', 'p1') });
    for (let guard = 0; guard < 40 && s.pending && !(s.pending.kind === 'priority' && s.zones.stack.length === 0); guard++) {
      const d = s.pending;
      if (d.kind === 'chooseTargets') {
        const r = applyAction(s, { type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'chooseTargets', targets: [{ kind: 'object', id: target }] } });
        if (r.error) return { s, error: r.error.message };
        s = r.state;
      } else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: false });
      else if (d.kind === 'priority') s = pass(s);
      else throw new Error(`unexpected decision ${d.kind}`);
    }
    return { s };
  };
  const setup = (withNet: boolean): GameState => scenario([], { p1: { battlefield: withNet ? ['Test Hunting Lantern'] : [], hand: ['Test Small Zap'] }, p2: { battlefield: ['Test Sly Fox', 'Test Veiled Owl', 'Test Warded Elk'] }, defs: DEFS });
  it('is parsed and automated', () => {
    expect(automated(NET)).toBe(true);
  });
  it('a hexproof creature of an opponent can be targeted with it, not without it', () => {
    const without = setup(false);
    expect(castAt(without, find(without, 'Test Sly Fox', 'battlefield', 'p2')).error).toBeDefined();
    const s0 = setup(true);
    const fox = find(s0, 'Test Sly Fox', 'battlefield', 'p2');
    const r = castAt(s0, fox);
    expect(r.error).toBeUndefined();
    expect(r.s.objects[fox]!.damage).toBe(1);
  });
  it('shroud still stops it (only hexproof is ignored)', () => {
    const s0 = setup(true);
    expect(castAt(s0, find(s0, 'Test Veiled Owl', 'battlefield', 'p2')).error).toBeDefined();
  });
  it('the ward of an opponent\'s creature does not trigger with it; it does without it', () => {
    const s0 = setup(true);
    const elk = find(s0, 'Test Warded Elk', 'battlefield', 'p2');
    const r = castAt(s0, elk);
    expect(r.s.objects[elk]!.damage).toBe(1); // not countered
    const w0 = setup(false);
    const welk = find(w0, 'Test Warded Elk', 'battlefield', 'p2');
    const w = castAt(w0, welk);
    expect(w.s.objects[welk]!.damage ?? 0).toBe(0); // ward {3} unpaid: countered
  });
});

describe('CR 201.5a, 201.5c, 613.1f: a quoted trigger that names the object by its short name, granted by the object to itself', () => {
  const RIDER = card('Test Vell, Lane Scout', 'Legendary Creature — Faerie Scout', '{1}{R}: If Test Vell is a Scout, it becomes a Human Faerie Detective and gains "Whenever Test Vell deals combat damage to a player, exile the top card of your library. You may play that card this turn."', ['2', '1']);
  const DEFS = [RIDER];
  it('is parsed and automated: the name in the quote is the object that has the ability, the object itself', () => {
    expect(automated(RIDER)).toBe(true);
    expect(JSON.stringify(RIDER.faces[0]!.abilities)).toContain('"source":{"self":true}');
  });
  it('after the activation, its combat damage to a player exiles the top card of its controller\'s library', () => {
    let s = scenario(['Mountain'], { p1: { battlefield: ['Test Vell, Lane Scout', 'Mountain', 'Mountain'], library: ['Plains'] }, defs: DEFS });
    const rider = find(s, 'Test Vell, Lane Scout', 'battlefield', 'p1');
    s = settle(act(s, { type: 'activate', player: 'p1', source: rider, ability: 'p:0:0' }));
    expect(getChars(s, rider)!.subtypes).toEqual(expect.arrayContaining(['Human', 'Faerie', 'Detective']));
    const exiledBefore = s.zones.exile.length;
    for (let guard = 0; guard < 200 && !(s.turn.step === 'end' && s.turn.number === 1); guard++) {
      const d = s.pending;
      if (!d) break;
      if (d.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: rider, defender: 'p2' }] });
      else if (d.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: d.items.map((i) => i.id) });
      else if (d.kind === 'priority') s = pass(s);
      else throw new Error(`unexpected decision ${d.kind}`);
    }
    expect(s.zones.exile.length).toBe(exiledBefore + 1);
  });
});

describe('CR 613.4b, 201.5a: "Until end of turn, ~ gains "~\'s base power is equal to the number of cards in your hand."" (a granted static, by its short name)', () => {
  const KIRA = card('Test Kira, Bright Fist', 'Legendary Creature — Human Hero', '{0}: Until end of turn, Test Kira gains "Test Kira\'s base power is equal to the number of cards in your hand."', ['2', '3']);
  const DEFS = [KIRA];
  it('is parsed and automated', () => {
    expect(automated(KIRA)).toBe(true);
    expect(JSON.stringify(KIRA.faces[0]!.abilities)).toContain('"affects":{"ref":"self"},"mods":[{"layer":"7b"');
  });
  it('its power follows the hand size while the effect lasts, the toughness unchanged; it ends with the turn', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Kira, Bright Fist'], hand: ['Plains', 'Plains', 'Plains', 'Plains', 'Plains'] }, defs: DEFS });
    const kira = find(s, 'Test Kira, Bright Fist', 'battlefield', 'p1');
    expect(Number(getChars(s, kira)!.power)).toBe(2);
    s = settle(act(s, { type: 'activate', player: 'p1', source: kira, ability: 'p:0:0' }));
    const hand = s.zones.hand['p1']!.length;
    expect(Number(getChars(s, kira)!.power)).toBe(hand);
    expect(Number(getChars(s, kira)!.toughness)).toBe(3);
    s = act(s, { type: 'playLand', player: 'p1', card: s.zones.hand['p1']![0]! });
    expect(Number(getChars(s, kira)!.power)).toBe(hand - 1);
    for (let guard = 0; guard < 100 && s.turn.number === 1; guard++) {
      const d = s.pending!;
      if (d.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
      else if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: d.options.slice(0, d.min) });
      else s = pass(s);
    }
    expect(Number(getChars(s, kira)!.power)).toBe(2);
  });
});

describe('CR 609.4, 702.3b, 613.1f: "Until end of turn, target creature you control gets +1/+0, gains "...," and can attack as though it didn\'t have defender"', () => {
  const CLADE = card('Test Kelp Elder', 'Creature — Elemental', 'Defender\n{0}: Until end of turn, target creature you control gets +1/+0, gains "Whenever this creature deals combat damage to a player, draw cards equal to its toughness," and can attack as though it didn\'t have defender.', ['2', '4']);
  const DEFS = [CLADE];
  it('is parsed and automated: one continuous effect and a permission for the target', () => {
    expect(automated(CLADE)).toBe(true);
    expect(JSON.stringify(CLADE.faces[0]!.abilities)).toContain('{"s":"permit","who":{"ref":"you"},"action":"attackAsThoughNoDefender","of":{"is":{"ref":"target","id":"t0"}}}');
  });
  it('the defender creature attacks, deals 3, and its controller draws 4 (its toughness)', () => {
    let s = scenario([], { p1: { battlefield: ['Test Kelp Elder'] }, defs: DEFS });
    const elder = find(s, 'Test Kelp Elder', 'battlefield', 'p1');
    s = settle(act(s, { type: 'activate', player: 'p1', source: elder, ability: 'p:0:1' }), [elder]);
    const hand = s.zones.hand['p1']!.length;
    const before = life(s, 'p2');
    for (let guard = 0; guard < 200 && !(s.turn.step === 'end' && s.turn.number === 1); guard++) {
      const d = s.pending;
      if (!d) break;
      if (d.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: elder, defender: 'p2' }] });
      else if (d.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else if (d.kind === 'priority') s = pass(s);
      else throw new Error(`unexpected decision ${d.kind}`);
    }
    expect(life(s, 'p2')).toBe(before - 3);
    expect(s.zones.hand['p1']!.length).toBe(hand + 4);
  });
  it('without the activation it can\'t attack (defender, CR 702.3b)', () => {
    let s = scenario([], { p1: { battlefield: ['Test Kelp Elder'] }, defs: DEFS });
    const elder = find(s, 'Test Kelp Elder', 'battlefield', 'p1');
    let attacked = false;
    for (let guard = 0; guard < 100 && !(s.turn.step === 'end'); guard++) {
      const d = s.pending!;
      if (d.kind === 'declareAttackers') {
        const r = applyAction(s, { type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'declareAttackers', attacks: [{ attacker: elder, defender: 'p2' }] } });
        attacked = !r.error;
        s = answer(s, { kind: 'declareAttackers', attacks: [] });
      } else s = pass(s);
    }
    expect(attacked).toBe(false);
  });
});

describe('CR 109.2, 111.1, 608.2c: "Create a token that\'s a copy of it, except it\'s a Nightmare ... Then exile all other Nightmare tokens you control."', () => {
  const REAPER = card('Test Dusk Reaper', 'Creature — Elf Warlock', '{T}: Exile target creature card from a graveyard. Create a token that\'s a copy of it, except it\'s a Nightmare in addition to its other types. Then exile all other Nightmare tokens you control.', ['1', '1']);
  const BEAR = card('Test Grave Bear', 'Creature — Bear', '', ['2', '2']);
  const DEFS = [REAPER, BEAR];
  it('is parsed and automated, the group leaving out the token just made', () => {
    expect(automated(REAPER)).toBe(true);
    expect(JSON.stringify(REAPER.faces[0]!.abilities)).toContain('"not":{"is":{"ref":"bound","name":"made"}}');
  });
  it('the second activation keeps the new Nightmare token and exiles the first one', () => {
    let s = scenario([], { p1: { battlefield: ['Test Dusk Reaper'], graveyard: ['Test Grave Bear', 'Test Grave Bear'] }, defs: DEFS });
    const reaper = find(s, 'Test Dusk Reaper', 'battlefield', 'p1');
    const tokens = (x: GameState): ObjectId[] => x.zones.battlefield.filter((id) => x.objects[id]!.kind === 'token');
    const gy = (x: GameState): ObjectId[] => x.zones.graveyard['p1']!;
    s = settle(act(s, { type: 'activate', player: 'p1', source: reaper, ability: 'p:0:0' }), [gy(s)[0]!]);
    const first = tokens(s);
    expect(first.length).toBe(1);
    expect(getChars(s, first[0]!)!.subtypes).toEqual(expect.arrayContaining(['Bear', 'Nightmare']));
    s.objects[reaper]!.tapped = false;
    s = settle(act(s, { type: 'activate', player: 'p1', source: reaper, ability: 'p:0:0' }), [gy(s)[0]!]);
    const second = tokens(s);
    expect(second.length).toBe(1);
    expect(second[0]).not.toBe(first[0]);
  });
});

describe('CR 608.2f, 603.7c: "For each creature card exiled this way, create a token that\'s a copy of it. At the beginning of your next end step, sacrifice those tokens."', () => {
  const FOG = card('Test Mire Echoes', 'Sorcery', 'Exile up to two target creature cards from graveyards. For each creature card exiled this way, create a token that\'s a copy of it. At the beginning of your next end step, sacrifice those tokens.');
  const BEAR = card('Test Bog Bear', 'Creature — Bear', '', ['2', '2']);
  const KEEPER = card('Test Bog Keeper', 'Creature — Human', '', ['1', '1']);
  const DEFS = [FOG, BEAR, KEEPER];
  it('is parsed and automated: the loop gathers the tokens it made', () => {
    expect(automated(FOG)).toBe(true);
    const json = JSON.stringify(FOG.faces[0]!.abilities);
    expect(json).toContain('"gather":"made"');
    expect(json).toContain('"as":"made"');
  });
  it('both tokens are sacrificed at the end step; a token made otherwise is not', () => {
    let s = scenario([], { p1: { battlefield: ['Test Bog Keeper'], hand: ['Test Mire Echoes'], graveyard: ['Test Bog Bear', 'Test Bog Bear'] }, defs: DEFS });
    const [a, b] = s.zones.graveyard['p1']!;
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Mire Echoes', 'hand', 'p1') }), [[a!, b!]]);
    const tokens = (x: GameState): ObjectId[] => x.zones.battlefield.filter((id) => x.objects[id]!.kind === 'token');
    expect(tokens(s).length).toBe(2);
    for (let guard = 0; guard < 100 && !(s.turn.step === 'cleanup' || s.turn.number > 1); guard++) {
      const d = s.pending!;
      if (d.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
      else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: d.items.map((i) => i.id) });
      else s = pass(s);
    }
    expect(tokens(s).length).toBe(0);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Bog Keeper')).toBe(true);
  });
});

describe('CR 201.2, 115.1: "target enchantment you control that doesn\'t have the same name as another permanent you control"', () => {
  const REGENT = card('Test Ivy Regent', 'Creature — Elf Druid', '{0}, {T}: Choose target enchantment you control that doesn\'t have the same name as another permanent you control. Create a token that\'s a copy of it, except it isn\'t legendary. If the token is an Aura, untap this creature, then scry 2.', ['2', '2']);
  const SIGIL = card('Test Plain Sigil', 'Enchantment', '');
  const DEFS = [REGENT, SIGIL];
  it('is parsed and automated', () => {
    expect(automated(REGENT)).toBe(true);
    expect(JSON.stringify(REGENT.faces[0]!.abilities)).toContain('"sharesWith":{"with":{"ref":"each","filter":{"controller":"you"}},"quality":"name","other":true}');
  });
  it('a lone enchantment can be the target (it is not compared with itself); after the copy, neither one can', () => {
    let s = scenario([], { p1: { battlefield: ['Test Ivy Regent', 'Test Plain Sigil'] }, defs: DEFS });
    const regent = find(s, 'Test Ivy Regent', 'battlefield', 'p1');
    const sigil = find(s, 'Test Plain Sigil', 'battlefield', 'p1');
    s = settle(act(s, { type: 'activate', player: 'p1', source: regent, ability: 'p:0:0' }), [sigil]);
    expect(s.zones.battlefield.filter((id) => getChars(s, id)!.name === 'Test Plain Sigil').length).toBe(2);
    s.objects[regent]!.tapped = false;
    // both Sigils now share a name with another permanent: no legal target, so the ability can't be activated (CR 601.2c, 602.2b)
    expect(applyAction(s, { type: 'activate', player: 'p1', source: regent, ability: 'p:0:0' }).error?.message).toMatch(/no legal one/);
  });
});

describe('CR 613.1f, 607.2a, 609.4b: a creature with a +1/+1 counter has the activated abilities of the creature cards exiled with ~, payable with mana of any color', () => {
  const POT = card('Test Soul Kettle', 'Artifact', 'You may spend mana as though it were mana of any color to activate abilities of creatures you control.\nCreatures you control with +1/+1 counters on them have all activated abilities of all creature cards exiled with this artifact.\n{T}: Exile target card from a graveyard. When a creature card is exiled this way, put a +1/+1 counter on target creature you control.');
  const SAGE = card('Test Ember Sage', 'Creature — Human Wizard', '{R}: You gain 2 life.', ['1', '1']);
  const BEAR = card('Test Field Bear', 'Creature — Bear', '', ['2', '2']);
  const DEFS = [POT, SAGE, BEAR];
  it('is parsed and automated', () => {
    expect(automated(POT)).toBe(true);
  });
  it('after the exile and the counter, the Bear has "{R}: You gain 2 life." and pays it with a Plains; a creature without a counter does not have it', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Soul Kettle', 'Test Field Bear', 'Plains'], graveyard: ['Test Ember Sage'] }, p2: { battlefield: ['Test Field Bear'] }, defs: DEFS });
    const pot = find(s, 'Test Soul Kettle', 'battlefield', 'p1');
    const bear = find(s, 'Test Field Bear', 'battlefield', 'p1');
    const sage = find(s, 'Test Ember Sage', 'graveyard', 'p1');
    s = settle(act(s, { type: 'activate', player: 'p1', source: pot, ability: 'p:0:2' }), [sage, bear]);
    expect(s.objects[bear]!.counters['+1/+1']).toBe(1);
    const a = legalActions(s, 'p1').find((x) => x.kind === 'activate' && x.object === bear);
    expect(a).toBeDefined();
    const before = life(s, 'p1');
    s = settle(act(s, a!.action as never));
    expect(life(s, 'p1')).toBe(before + 2);
    const theirs = find(s, 'Test Field Bear', 'battlefield', 'p2');
    expect(getChars(s, theirs)!.abilities.some((x) => x.def.kind === 'activated')).toBe(false);
  });
});

describe('CR 701.3a-b, 603.12: "attach any number of target Equipment you control to target creature you control. When one or more Equipment become attached to that creature this way, ..."', () => {
  const KING = card('Test Hill Thane', 'Creature — Dwarf Noble', '{0}: Attach any number of target Equipment you control to target creature you control. When one or more Equipment become attached to that creature this way, that creature deals damage equal to its power to up to one target creature.', ['2', '2']);
  const AXE = card('Test Short Axe', 'Artifact — Equipment', 'Equipped creature gets +2/+0.\nEquip {3}');
  const OX = card('Test Plain Ox', 'Creature — Ox', '', ['1', '5']);
  const DEFS = [KING, AXE, OX];
  it('is parsed and automated', () => {
    expect(automated(KING)).toBe(true);
  });
  it('two Equipment are attached; the creature, now 6/2, deals 6 damage to the target', () => {
    let s = scenario([], { p1: { battlefield: ['Test Hill Thane', 'Test Short Axe', 'Test Short Axe'] }, p2: { battlefield: ['Test Plain Ox'] }, defs: DEFS });
    const king = find(s, 'Test Hill Thane', 'battlefield', 'p1');
    const axes = s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Short Axe');
    const ox = find(s, 'Test Plain Ox', 'battlefield', 'p2');
    s = settle(act(s, { type: 'activate', player: 'p1', source: king, ability: 'p:0:0' }), [axes, king, ox]);
    expect(axes.every((a) => s.objects[a]!.attachedTo === king)).toBe(true);
    expect(s.zones.battlefield.includes(ox)).toBe(false); // 6 damage to a 1/5
  });
  it('with no Equipment chosen nothing becomes attached and the reflexive trigger does not trigger', () => {
    let s = scenario([], { p1: { battlefield: ['Test Hill Thane'] }, p2: { battlefield: ['Test Plain Ox'] }, defs: DEFS });
    const king = find(s, 'Test Hill Thane', 'battlefield', 'p1');
    const ox = find(s, 'Test Plain Ox', 'battlefield', 'p2');
    s = settle(act(s, { type: 'activate', player: 'p1', source: king, ability: 'p:0:0' }), [king, ox]);
    expect(s.objects[ox]!.damage ?? 0).toBe(0);
  });
});

describe('CR 603.7c, 603.4, 701.3d, 514.2: "Gain control of that Equipment until end of turn. Attach it to the chosen creature. When you lose control of that Equipment this turn, if it\'s attached to a creature you control, unattach it."', () => {
  const COAT = card('Test Borrowed Coat', 'Instant', 'Choose target creature you control and target Equipment. Gain control of that Equipment until end of turn. Attach it to the chosen creature. When you lose control of that Equipment this turn, if it\'s attached to a creature you control, unattach it.');
  const BEAR = card('Test Wool Bear', 'Creature — Bear', '', ['2', '2']);
  const SWORD = card('Test Plain Sword', 'Artifact — Equipment', 'Equipped creature gets +1/+1.\nEquip {2}');
  const DEFS = [COAT, BEAR, SWORD];
  it('is parsed and automated', () => {
    expect(automated(COAT)).toBe(true);
  });
  it('the opponent\'s Equipment is attached to your creature this turn and comes back unattached when control returns at end of turn', () => {
    let s = scenario([], { p1: { battlefield: ['Test Wool Bear'], hand: ['Test Borrowed Coat'] }, p2: { battlefield: ['Test Plain Sword'] }, defs: DEFS });
    const bear = find(s, 'Test Wool Bear', 'battlefield', 'p1');
    const sword = find(s, 'Test Plain Sword', 'battlefield', 'p2');
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Borrowed Coat', 'hand', 'p1') }), [bear, sword]);
    expect(s.objects[sword]!.attachedTo).toBe(bear);
    expect(getChars(s, sword)!.controller).toBe('p1');
    for (let guard = 0; guard < 200 && s.turn.number === 1; guard++) {
      const d = s.pending!;
      if (d.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
      else if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: d.options.slice(0, d.min) });
      else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: d.items.map((i) => i.id) });
      else s = pass(s);
    }
    expect(getChars(s, sword)!.controller).toBe('p2');
    expect(s.objects[sword]!.attachedTo).toBeUndefined();
  });
});
