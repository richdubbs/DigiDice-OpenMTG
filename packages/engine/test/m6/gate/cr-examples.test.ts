/**
 * M6-10 (m6 design 5 "M6-10"): the CR worked examples of the milestone 6 rules, as one suite on the merged milestone 6 tree: 613.8 (re-run with layers 1a, 1b
 * and 3 present), 614.5, 614.12, 614.16, 616.1f-g, 616.2, 707.3, 707.9, 712.21d and 722.3c. Real fixture cards compiled by the default compiler (the game
 * path) in real games driven by real actions. Where an example's own card is not full on the game path (its level and cause: acceptance.test.ts), the test says
 * which part is hand-built JSON of the printed wording (`equivalent`, validated by the schema and the lint) and why; everything else is the real card.
 */
import { describe, expect, it } from 'vitest';
import { getChars, type AbilityDef, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type PlayerId, compileCard } from '../../../src/index';
import { act, advanceTo, answer, find, pass, scenario, tweak } from '../../m5/helpers';
import { cast, drive, equivalent, handSize, resolveAll, resolveTop, target } from '../../m5/cr-examples/helpers';
import { declareAttackers, lifeOf } from '../../m4/helpers';
import { castFaceDown, turnUp, turnUpActions } from '../face-down/support';

const lands = (name: string, n: number): string[] => Array(n).fill(name) as string[];
const pick = (...ids: ObjectId[]): DecisionAnswer => ({ kind: 'chooseObjects', ids });
const on = (s: GameState, name: string, owner: PlayerId = 'p1'): ObjectId => find(s, name, 'battlefield', owner);
const tokens = (s: GameState, p: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === p);
const ptOf = (s: GameState, id: ObjectId): [string | undefined, string | undefined] => [getChars(s, id).power, getChars(s, id).toughness];
const synthetic = (name: string, typeLine: string, cost: string, text: string): CardDef =>
  compileCard({ name, layout: 'normal', type_line: typeLine, mana_cost: cost, oracle_text: text, colors: [] } as OracleCard);
/** Answer every "which replacement first" question with the first effect offered (CR 616.1), then the rest of the decisions with `answers`. */
function chooseFirst(s: GameState, answers: DecisionAnswer[] = []): GameState {
  let t = s;
  for (let i = 0; i < 20 && t.pending && t.pending.kind !== 'priority'; i++) {
    if (t.pending.kind === 'chooseReplacement') t = answer(t, { kind: 'chooseReplacement', id: t.pending.options[0]!.id });
    else t = drive(t, answers.splice(0, 1));
  }
  return t;
}

describe('CR 613.8, 613.7 (re-run on the milestone 6 tree): dependency and timestamps with layers 1a, 1b and 3 present', () => {
  it('CR 613.8 (Blood Moon and Urborg, Tomb of Yawgmoth): Urborg\'s effect depends on Blood Moon\'s, which removes it: no land becomes a Swamp', () => {
    const s = scenario(['Blood Moon', 'Urborg, Tomb of Yawgmoth', 'Forest'], { p1: { battlefield: ['Urborg, Tomb of Yawgmoth', 'Forest'] }, p2: { battlefield: ['Blood Moon'] } });
    expect(getChars(s, on(s, 'Urborg, Tomb of Yawgmoth')).subtypes).toEqual(['Mountain']);
    expect(getChars(s, on(s, 'Forest')).subtypes).toEqual(['Forest']);
  });

  it('CR 613.7 (Humility and Opalescence): with Opalescence newer, Humility is a 4/4 creature; with Humility newer, a 1/1', () => {
    const older = scenario(['Humility', 'Opalescence'], { p1: { battlefield: ['Humility', 'Opalescence'] } });
    expect(ptOf(older, on(older, 'Humility'))).toEqual(['4', '4']);
    const newer = scenario(['Humility', 'Opalescence'], { p1: { battlefield: ['Opalescence', 'Humility'] } });
    expect(ptOf(newer, on(newer, 'Humility'))).toEqual(['1', '1']);
  });

  it('CR 613.2a-b, 613.8: a face-down Grinning Demon is a 2/2 with no name or color (the 1b profile; CR 708.2a)', () => {
    let s = scenario(['Grinning Demon', 'Swamp'], { p1: { hand: ['Grinning Demon'], battlefield: lands('Swamp', 3) } });
    s = resolveTop(castFaceDown(s, 'Grinning Demon'));
    const id = s.zones.battlefield.find((x) => s.objects[x]!.faceDown)!;
    expect(getChars(s, id)).toMatchObject({ name: '', power: '2', toughness: '2', colors: [] });
  });
});

describe('CR 614.5: a replacement effect gets one opportunity per event', () => {
  it('CR 614.5 example: two "deals double that damage" effects (two Furnaces of Rath): 2 damage becomes 8, not 4 and not more', () => {
    let s = scenario(['Furnace of Rath', 'Shock', 'Mountain'], { p1: { hand: ['Shock'], battlefield: ['Furnace of Rath', 'Furnace of Rath', 'Mountain'] } });
    s = resolveTop(cast(s, 'Shock', [target('p2')]));
    s = chooseFirst(s);
    expect(lifeOf(s, 'p2')).toBe(12);
  });

  it('CR 614.5, 121.2: two Thought Reflections: one draw becomes two, each of those becomes two: four cards in the draw step', () => {
    let s = scenario(['Thought Reflection'], { p1: { battlefield: ['Thought Reflection', 'Thought Reflection'] } });
    const before = handSize(s, 'p1');
    s = advanceTo(s, 3, 'draw');
    s = chooseFirst(s);
    expect(handSize(s, 'p1')).toBe(before + 4);
  });
});

describe('CR 614.12: what applies to an entering permanent is judged as it would exist on the battlefield', () => {
  it('CR 614.12 example: Orb of Dreams ("Permanents enter tapped") does not affect itself', () => {
    let s = scenario(['Orb of Dreams', 'Island'], { p1: { hand: ['Orb of Dreams', 'Orb of Dreams'], battlefield: lands('Island', 6) } });
    s = resolveTop(cast(s, 'Orb of Dreams'));
    const first = on(s, 'Orb of Dreams');
    expect(s.objects[first]!.tapped).toBe(false);
    s = resolveTop(cast(s, 'Orb of Dreams'));
    const second = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Orb of Dreams' && id !== first)!;
    expect(s.objects[second]!.tapped).toBe(true);
  });

  it('CR 614.12 example: a token copy of Voice of All chooses its color as it is created (Croaking Counterpart\'s Frog copy)', () => {
    let s = scenario(['Voice of All', 'Croaking Counterpart', 'Island', 'Forest'], { p1: { hand: ['Croaking Counterpart'], battlefield: ['Voice of All', 'Island', 'Forest', 'Forest'] } });
    s = resolveTop(cast(s, 'Croaking Counterpart', [target(on(s, 'Voice of All'))]));
    expect(s.pending?.kind).toBe('chooseColor');
    s = answer(s, { kind: 'chooseColor', color: 'R' });
    const [frog] = tokens(s, 'p1');
    expect(getChars(s, frog!)).toMatchObject({ name: 'Voice of All', subtypes: ['Frog'] });
  });
});

describe('CR 614.16: "if an effect would put counters" applies to the counters a replacement effect puts, not to a rule\'s', () => {
  it('CR 614.16 (m6 ruling 9.1 #1): Doubling Season and a kicked Kavu Titan: it enters with six +1/+1 counters', () => {
    let s = scenario(['Kavu Titan', 'Doubling Season', 'Forest'], { p1: { hand: ['Kavu Titan'], battlefield: ['Doubling Season', ...lands('Forest', 5)] } });
    s = resolveTop(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Kavu Titan', 'hand') }), [{ kind: 'yesNo', yes: true }]));
    expect(s.objects[on(s, 'Kavu Titan')]!.counters['+1/+1']).toBe(6);
  });

  it('CR 614.16, 714.3a, 714.3c: History of Benalia enters with two lore counters under Doubling Season, but the turn-based lore counter is one', () => {
    let s = scenario(['History of Benalia', 'Doubling Season', 'Plains'], { p1: { hand: ['History of Benalia'], battlefield: ['Doubling Season', ...lands('Plains', 3)] } });
    s = resolveAll(cast(s, 'History of Benalia'));
    const id = on(s, 'History of Benalia');
    expect(s.objects[id]!.counters.lore).toBe(2);
    expect(tokens(s, 'p1')).toHaveLength(4); // chapters I and II, each Knight doubled
    s = advanceTo(s, 3, 'main1');
    expect(s.objects[id]!.counters.lore).toBe(3);
  });
});

describe('CR 616.1f-g: the order of replacement effects', () => {
  it('CR 616.1f example 2: Essence of the Wild and Rusted Sentinel: the copy effect first, so it enters untapped as an Essence of the Wild', () => {
    let s = scenario(['Essence of the Wild', 'Rusted Sentinel', 'Island'], { p1: { hand: ['Rusted Sentinel'], battlefield: ['Essence of the Wild', ...lands('Island', 4)] } });
    s = resolveAll(cast(s, 'Rusted Sentinel'));
    const sentinel = on(s, 'Rusted Sentinel');
    expect(getChars(s, sentinel)).toMatchObject({ name: 'Essence of the Wild', power: '6', toughness: '6' });
    expect(s.objects[sentinel]!.tapped).toBe(false);
  });

  it('CR 616.1g example: Doubling Season and a token copy of Voice of All: the doubling first, then each token chooses its own color', () => {
    let s = scenario(['Voice of All', 'Croaking Counterpart', 'Doubling Season', 'Island', 'Forest'], { p1: { hand: ['Croaking Counterpart'], battlefield: ['Voice of All', 'Doubling Season', 'Island', 'Forest', 'Forest'] } });
    s = resolveTop(cast(s, 'Croaking Counterpart', [target(on(s, 'Voice of All'))]));
    let asked = 0;
    for (const c of ['R', 'G'] as const) {
      if (s.pending?.kind !== 'chooseColor') break;
      s = answer(s, { kind: 'chooseColor', color: c });
      asked++;
    }
    expect(asked).toBe(2);
    expect(tokens(s, 'p1')).toHaveLength(2);
  });
});

describe('CR 616.2: an effect can become applicable as the result of another', () => {
  // No fixture card has either wording: the two statics as hand-built JSON on invented enchantments (the CR example's own text, no card)
  const lifeToDraw = equivalent({ name: 'Test Life Into Cards', type_line: 'Enchantment', mana_cost: '{2}{U}' }, [{
    kind: 'static', text: 'If you would gain life, draw that many cards instead.',
    effects: [{ s: 'replace', replaces: { ev: 'life', change: 'gain', player: 'you' }, body: { b: 'instead', do: [{ op: 'draw', who: { ref: 'you' }, count: { q: 'eventAmount' } }] } }],
  } as AbilityDef]);
  const drawToReturn = equivalent({ name: 'Test Return Instead', type_line: 'Enchantment', mana_cost: '{2}{B}' }, [{
    kind: 'static', text: 'If you would draw a card, return a card from your graveyard to your hand instead.',
    effects: [{ s: 'replace', replaces: { ev: 'draw', player: 'you' }, body: { b: 'instead', do: [{ op: 'move', what: { ref: 'each', filter: { zone: 'graveyard', owner: 'you', isCard: true } }, to: { zone: 'hand' } }] } }],
  } as AbilityDef]);

  it('CR 616.2 example: instead of gaining 1 life (Soul Warden\'s trigger), the player puts a card from their graveyard into their hand', () => {
    let s = scenario(['Soul Warden', 'Elite Vanguard', 'Grizzly Bears', 'Plains'], { p1: { hand: ['Elite Vanguard'], battlefield: ['Soul Warden', 'Test Life Into Cards', 'Test Return Instead', 'Plains'], graveyard: ['Grizzly Bears'] }, defs: [lifeToDraw, drawToReturn] });
    const library = s.zones.library.p1!.length;
    s = resolveAll(cast(s, 'Elite Vanguard'));
    expect(lifeOf(s, 'p1')).toBe(20);
    expect(s.zones.hand.p1!.map((id) => s.objects[id]!.defId)).toEqual(['Grizzly Bears']);
    expect(s.zones.library.p1!.length).toBe(library); // no card was drawn
  });
});

describe('CR 707.3: the copy\'s copiable values become the copied information', () => {
  // Vesuvan Doppelganger is manual on the game path (its granted, self-referencing upkeep ability has no template): its enters-as-a-copy part as hand-built JSON
  const vesuvan = (): CardDef => equivalent({ name: 'Vesuvan Doppelganger', type_line: 'Creature — Shapeshifter', mana_cost: '{3}{U}{U}', power: '0', toughness: '0', colors: ['U'] }, [{
    kind: 'static', text: 'You may have this creature enter as a copy of any creature on the battlefield, except it doesn\'t copy that creature\'s color.', zone: ['stack', 'battlefield'],
    effects: [{ s: 'replace', replaces: { ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }, body: { b: 'enters', copy: { of: { types: ['Creature'] }, optional: true, except: [{ retain: ['colors'] }] } } }],
  } as AbilityDef]);

  it('CR 707.3 example 1: Vesuvan Doppelganger copying Runeclaw Bear stays blue; a Clone of it is a blue Bear named Runeclaw Bear', () => {
    let s = scenario(['Clone', 'Runeclaw Bear', 'Island'], { p1: { hand: ['Vesuvan Doppelganger', 'Clone'], battlefield: lands('Island', 9) }, p2: { battlefield: ['Runeclaw Bear'] }, defs: [vesuvan()] });
    s = drive(resolveTop(cast(s, 'Vesuvan Doppelganger')), [pick(on(s, 'Runeclaw Bear', 'p2'))]);
    const v = on(s, 'Vesuvan Doppelganger');
    expect(getChars(s, v)).toMatchObject({ name: 'Runeclaw Bear', colors: ['U'] });
    s = drive(resolveTop(cast(s, 'Clone')), [pick(v)]);
    expect(getChars(s, on(s, 'Clone'))).toMatchObject({ name: 'Runeclaw Bear', colors: ['U'], subtypes: ['Bear'] });
  });

  it('CR 707.3 examples 3-4: a face-down Grinning Demon that becomes a copy of Branchsnap Lorian stays a 2/2 and is turned up for {G} as Branchsnap Lorian', () => {
    let s = scenario(['Grinning Demon', 'Branchsnap Lorian', 'Swamp', 'Forest'], { p1: { hand: ['Grinning Demon'], battlefield: [...lands('Swamp', 3), 'Forest'] } });
    s = resolveTop(castFaceDown(s, 'Grinning Demon'));
    const id = s.zones.battlefield.find((x) => s.objects[x]!.faceDown)!;
    // Cytoshape ("... becomes a copy of that creature") is manual on the game path: the resolved copy effect it would create, recorded as M6-2's beginCopy records it
    s = tweak(s, (t) => {
      t.continuousEffects.push({
        id: `e${t.counters.effect++}`, source: null, sourceName: 'a copy effect', controller: 'p1', timestamp: t.counters.timestamp++, startedTurn: t.turn.number, duration: { d: 'permanent' },
        effect: { s: 'continuous', affects: { ref: 'fixed', objects: [{ id, zone: 'battlefield' }] }, mods: [{ layer: '1a', copyOf: { ref: 'fixed', objects: [{ id, zone: 'battlefield' }] } }] },
        copy: { defId: 'Branchsnap Lorian', face: 0, except: [] },
      } as never);
    });
    expect(getChars(s, id)).toMatchObject({ name: '', power: '2', toughness: '2' });
    expect(turnUpActions(s).map((a) => a.label)).toEqual(['Turn Grinning Demon face up (morph {G})']);
    s = turnUp(s, id);
    expect(getChars(s, id)).toMatchObject({ name: 'Branchsnap Lorian', power: '4', toughness: '1' });
  });
});

describe('CR 707.9: exceptions to the copying process', () => {
  it('CR 707.9d example: Quicksilver Gargantuan copying Tarmogoyf is 7/7: the P/T-defining ability is not copied', () => {
    let s = scenario(['Quicksilver Gargantuan', 'Tarmogoyf', 'Island'], { p1: { hand: ['Quicksilver Gargantuan'], battlefield: lands('Island', 7) }, p2: { battlefield: ['Tarmogoyf'] } });
    s = drive(resolveTop(cast(s, 'Quicksilver Gargantuan')), [pick(on(s, 'Tarmogoyf', 'p2'))]);
    const q = on(s, 'Quicksilver Gargantuan');
    expect(getChars(s, q).name).toBe('Tarmogoyf');
    expect(ptOf(s, q)).toEqual(['7', '7']);
    expect(getChars(s, q).abilities).toHaveLength(0);
  });

  it('CR 707.9a-b: Phantasmal Image is an Illusion in addition and has the sacrifice trigger as part of its copiable values (a Clone of it has them too)', () => {
    let s = scenario(['Phantasmal Image', 'Clone', 'Hill Giant', 'Island'], { p1: { hand: ['Phantasmal Image', 'Clone'], battlefield: lands('Island', 6) }, p2: { battlefield: ['Hill Giant'] } });
    s = drive(resolveTop(cast(s, 'Phantasmal Image')), [pick(on(s, 'Hill Giant', 'p2'))]);
    s = drive(resolveTop(cast(s, 'Clone')), [pick(on(s, 'Phantasmal Image'))]);
    const clone = on(s, 'Clone');
    expect(getChars(s, clone)).toMatchObject({ name: 'Hill Giant', subtypes: ['Giant', 'Illusion'] });
    expect(getChars(s, clone).abilities.some((a) => a.def.kind === 'triggered')).toBe(true);
  });

  it('CR 707.9e: Altered Ego\'s X counters are an additional effect: copying a Clone that then copies something else, it gets none', () => {
    const anthem = synthetic('Test Anthem', 'Enchantment', '{1}{W}', 'Creatures you control get +1/+1.');
    let s = scenario(['Clone', 'Grizzly Bears', 'Altered Ego', 'Island', 'Forest'], {
      p1: { hand: ['Altered Ego'], battlefield: [...lands('Island', 4), ...lands('Forest', 4)] }, p2: { battlefield: ['Test Anthem', 'Clone', 'Grizzly Bears'] }, defs: [anthem],
    });
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Altered Ego', 'hand') }), [{ kind: 'chooseNumber', n: 2 }]);
    s = drive(resolveTop(s), [pick(on(s, 'Clone', 'p2')), pick(on(s, 'Grizzly Bears', 'p2'))]);
    const ego = on(s, 'Altered Ego');
    expect(getChars(s, ego).name).toBe('Grizzly Bears');
    expect(s.objects[ego]!.counters['+1/+1']).toBeUndefined();
  });

  it('CR 707.9e: Spark Double copying a planeswalker you control gets a loyalty counter, not a +1/+1 counter, and is not legendary', () => {
    let s = scenario(['Spark Double', 'Jace Beleren', 'Island'], { p1: { hand: ['Spark Double'], battlefield: [{ name: 'Jace Beleren', counters: { loyalty: 3 } }, ...lands('Island', 4)] } });
    s = drive(resolveTop(cast(s, 'Spark Double')), [pick(on(s, 'Jace Beleren'))]);
    const pw = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Spark Double')!;
    expect(getChars(s, pw).name).toBe('Jace Beleren');
    expect(s.objects[pw]!.counters.loyalty).toBe(4); // printed 3 + 1 (CR 306.5b, 707.9e)
    expect(s.objects[pw]!.counters['+1/+1']).toBeUndefined();
    expect(getChars(s, pw).supertypes).not.toContain('Legendary');
  });
});

describe('CR 712.21d: one replacement effect applied to a melded permanent leaving affects both cards', () => {
  // Graf Rats' meld trigger is manual on the game path (its intervening "if you both own and control ..." cannot be stated): the meld as hand-built JSON
  const MELD = equivalent({ name: 'Test Union of Vermin', type_line: 'Sorcery', mana_cost: '{0}' }, [{
    kind: 'spell', text: 'Exile Graf Rats and Midnight Scavengers, then meld them into Chittering Host.',
    effect: {
      targets: [],
      steps: [
        { op: 'move', what: { ref: 'each', filter: { anyOf: [{ name: 'Graf Rats' }, { name: 'Midnight Scavengers' }], controller: 'you' } }, to: { zone: 'exile' }, as: 'them' },
        { op: 'action', action: 'meld', subject: { ref: 'bound', name: 'them' }, who: { ref: 'you' }, arg: 'Chittering Host' },
      ],
    },
  } as AbilityDef]);

  it('CR 712.21d example: with Leyline of the Void and Rest in Peace, Chittering Host\'s controller chooses one effect and both cards go to exile', () => {
    let s = scenario(['Graf Rats', 'Midnight Scavengers', 'Chittering Host', 'Leyline of the Void', 'Rest in Peace', 'Murder', 'Swamp'], {
      p1: { battlefield: ['Graf Rats', 'Midnight Scavengers'], hand: ['Test Union of Vermin'] }, p2: { battlefield: ['Leyline of the Void', 'Rest in Peace', ...lands('Swamp', 3)], hand: ['Murder'] }, defs: [MELD],
    });
    s = chooseFirst(resolveTop(cast(s, 'Test Union of Vermin'))); // the sorcery itself goes to the graveyard: Leyline or Rest in Peace (CR 616.1)
    const host = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Chittering Host')!;
    expect(host).toBeDefined();
    s = pass(s);
    s = chooseFirst(resolveTop(cast(s, 'Murder', [target(host)], 'p2')));
    expect(s.zones.graveyard.p1!.map((id) => s.objects[id]!.defId)).toEqual([]);
    expect(s.zones.exile.map((id) => s.objects[id]!.defId)).toEqual(expect.arrayContaining(['Graf Rats', 'Midnight Scavengers']));
  });
});

describe('CR 722.3c: the exile copy of a prepared permanent has only the prepare spell\'s characteristics', () => {
  it('CR 722.3c example: Croaking Counterpart\'s 1/1 green Frog copy of Encouraging Aviator attacks, becomes prepared, and the exile copy is a blue instant named Jump', () => {
    let s = scenario(['Encouraging Aviator // Jump', 'Croaking Counterpart', 'Island', 'Forest'], { p1: { hand: ['Croaking Counterpart'], battlefield: ['Encouraging Aviator // Jump', ...lands('Island', 2), 'Forest'] } });
    s = resolveTop(cast(s, 'Croaking Counterpart', [target(on(s, 'Encouraging Aviator // Jump'))]));
    const [frog] = tokens(s, 'p1');
    expect(getChars(s, frog!)).toMatchObject({ name: 'Encouraging Aviator', power: '1', toughness: '1', colors: ['G'], subtypes: ['Frog'] });
    for (let i = 0; i < 200 && !(s.turn.number === 3 && s.pending?.kind === 'declareAttackers'); i++) {
      const d = s.pending!;
      if (d.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
      else if (d.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else s = pass(s);
    }
    s = declareAttackers(s, [[frog!, 'p2']]);
    s = resolveTop(drive(s));
    expect(s.objects[frog!]!.prepared).toBe(true);
    const copies = s.zones.exile.filter((id) => s.objects[id]!.kind !== 'card');
    expect(copies.map((c) => getChars(s, c))).toEqual([expect.objectContaining({ name: 'Jump', types: ['Instant'], colors: ['U'] })]);
  });
});
