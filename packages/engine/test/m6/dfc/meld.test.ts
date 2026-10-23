/**
 * M6-4 (m6 design 3.6, E18): meld (CR 701.42, 712.4): the native action (effects/handlers/dfc-ops.ts), the melded permanent (core/move-parts/components.ts,
 * rules/base-parts/melded.ts), leaving the battlefield as one permanent and two cards (CR 712.21, 712.21d), what can't be melded (CR 701.42c) and copies of a
 * melded permanent (CR 712.8g). The meld steps are hand-built JSON of the cards' wording (their sentences have no template yet).
 */
import { describe, expect, it } from 'vitest';
import { ENGINE_CAPABILITIES, getChars, type AbilityDef, type CardDef, type GameState } from '../../../src/index';
import { LAYOUT_SUPPORT } from '../../../src/cards/layout-support';
import { answer, cast, equivalent, find, instantOnTarget, looks, pick, put, resolveTop, scenario, target, TRANSFORM, tweak, until } from './support';

const BRUNA = 'Bruna, the Fading Light';
const GISELA = 'Gisela, the Broken Blade';
const BRISELA = 'Brisela, Voice of Nightmares';
const RATS = 'Graf Rats';
const SCAVENGERS = 'Midnight Scavengers';
const HOST = 'Chittering Host';

/** "Exile <a> and <b> you control, then meld them into <result>." (Gisela's and Graf Rats' instruction, as a {0} sorcery) */
const melder = (name: string, a: string, b: string, result: string) => equivalent({ name, type_line: 'Sorcery', mana_cost: '{0}' }, [{
  kind: 'spell', text: `Exile ${a} and ${b}, then meld them into ${result}.`,
  effect: {
    targets: [],
    steps: [
      { op: 'move', what: { ref: 'each', filter: { anyOf: [{ name: a }, { name: b }], controller: 'you' } }, to: { zone: 'exile' }, as: 'them' },
      { op: 'action', action: 'meld', subject: { ref: 'bound', name: 'them' }, who: { ref: 'you' }, arg: result },
    ],
  },
} as AbilityDef]);
const MELD_BRISELA = melder('Test Union of Angels', BRUNA, GISELA, BRISELA);
const MELD_HOST = melder('Test Union of Vermin', RATS, SCAVENGERS, HOST);
const DOOM = instantOnTarget('Test Doom', 'Destroy target creature.', (t) => [{ op: 'destroy', what: t }]);

const melded = (more: string[] = [], hand: string[] = []): GameState => {
  const s = scenario([BRUNA, GISELA, BRISELA, ...more], {
    p1: { battlefield: [BRUNA, GISELA, ...more.filter((n) => n === 'Island')], hand: ['Test Union of Angels', 'Test Doom', 'Test Turnabout', ...hand] }, defs: [MELD_BRISELA, DOOM, TRANSFORM],
  });
  return resolveTop(cast(s, 'Test Union of Angels'));
};
const briselaOf = (s: GameState): string => s.zones.battlefield.find((id) => s.objects[id]!.defId === BRISELA)!;

describe('CR 701.42a, 712.4a, 712.8g: melding', () => {
  it('Bruna and Gisela become one permanent, Brisela, Voice of Nightmares: the combined face\'s characteristics; mana value 11, the sum of the fronts', () => {
    const s = melded();
    const ids = s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]?.layout === 'meld');
    expect(ids).toHaveLength(1);
    const brisela = ids[0]!;
    expect(looks(s, brisela)).toMatchObject({ name: BRISELA, pt: [9, 10] });
    const c = getChars(s, brisela);
    expect(c.manaValue).toBe(11); // {5}{W}{W} + {2}{W}{W}
    expect(c.keywords.map((k) => k.keyword).sort()).toEqual(['first strike', 'flying', 'lifelink', 'vigilance']);
    expect(s.objects[brisela]!.components?.map((x) => x.defId)).toEqual([BRUNA, GISELA]);
    expect(s.zones.exile.filter((id) => [BRUNA, GISELA].includes(s.objects[id]!.defId))).toEqual([]); // the partner card left exile with no object of its own
    expect(s.log.some((l) => /melds them into Brisela, Voice of Nightmares/.test(l.text))).toBe(true);
    expect(ENGINE_CAPABILITIES.has('action:meld') && ENGINE_CAPABILITIES.has('feature:action.native.meld')).toBe(true);
    expect(LAYOUT_SUPPORT.meld).toBe(true);
  });

  it('CR 712.4c: a melded permanent can\'t transform', () => {
    let s = melded();
    const brisela = briselaOf(s);
    s = resolveTop(cast(s, 'Test Turnabout', [target(brisela)]));
    expect(looks(s, brisela)).toMatchObject({ name: BRISELA, face: 0 });
    expect(s.log.some((l) => /doesn't transform: it is not a double-faced permanent/.test(l.text))).toBe(true);
  });

  it('CR 701.42c: a card and a token copy can\'t be melded: the card stays exiled, the token ceases to exist', () => {
    let s = scenario([RATS, SCAVENGERS, HOST], { p1: { battlefield: [SCAVENGERS], hand: ['Test Union of Vermin'] }, defs: [MELD_HOST] });
    s = tweak(s, (x) => {
      const rats = put(x, 'p1', 'battlefield', RATS);
      x.objects[rats]!.kind = 'token'; // a token that is a copy of Graf Rats (its own definition is the card's: CR 111.1, 707.2)
      delete x.objects[rats]!.cardId;
    });
    s = resolveTop(cast(s, 'Test Union of Vermin'));
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === HOST)).toBe(false);
    expect(find(s, SCAVENGERS, 'exile')).toBeDefined();
    expect(Object.values(s.objects).some((o) => o.defId === RATS)).toBe(false); // the token ceased to exist (CR 111.7, 704.5d)
    expect(s.log.some((l) => /can't be melded: a token can't be melded/.test(l.text))).toBe(true);
  });
});

describe('the melded event (CR 701.42a)', () => {
  it('"whenever a permanent is melded" triggers once, for the melded permanent', () => {
    const WATCH = equivalent({ name: 'Test Meld Watcher', type_line: 'Enchantment' }, [{
      kind: 'triggered', text: 'Whenever a permanent is melded, you gain 1 life.', trigger: { on: [{ ev: 'becomes', what: 'melded', object: {} }] },
      effect: { targets: [], steps: [{ op: 'gainLife', who: { ref: 'you' }, amount: 1 }] },
    } as AbilityDef]);
    let s = scenario([BRUNA, GISELA, BRISELA], { p1: { battlefield: [BRUNA, GISELA, 'Test Meld Watcher'], hand: ['Test Union of Angels'] }, defs: [MELD_BRISELA, WATCH] });
    s = resolveTop(cast(s, 'Test Union of Angels'));
    expect(s.zones.stack).toHaveLength(1);
    s = resolveTop(s);
    expect(s.players[0]!.life).toBe(21);
    expect(ENGINE_CAPABILITIES.has('feature:ev.becomes.melded')).toBe(true);
  });
});

describe('CR 712.21: a melded permanent leaves the battlefield as one permanent and two cards', () => {
  it('the CR 712.21 example: "whenever a creature dies" triggers once, "whenever a card is put into a graveyard from anywhere" twice', () => {
    const watcher = (name: string, text: string, on: unknown, amount: number) => equivalent({ name, type_line: 'Enchantment' }, [{
      kind: 'triggered', text, trigger: { on: [on] }, effect: { targets: [], steps: [{ op: 'gainLife', who: { ref: 'you' }, amount }] },
    } as AbilityDef]);
    const DEATHS = watcher('Test Death Watcher', 'Whenever a creature dies, you gain 10 life.', { ev: 'zoneChange', subject: { types: ['Creature'] }, from: 'battlefield', to: 'graveyard' }, 10);
    const GRAVES = watcher('Test Grave Watcher', 'Whenever a creature card is put into a graveyard from anywhere, you gain 1 life.', { ev: 'zoneChange', subject: { isCard: true, types: ['Creature'] }, to: 'graveyard' }, 1);
    let s = scenario([BRUNA, GISELA, BRISELA], {
      p1: { battlefield: [BRUNA, GISELA, 'Test Death Watcher', 'Test Grave Watcher'], hand: ['Test Union of Angels', 'Test Doom'] }, defs: [MELD_BRISELA, DOOM, DEATHS, GRAVES],
    });
    s = resolveTop(cast(s, 'Test Union of Angels'));
    s = resolveTop(cast(s, 'Test Doom', [target(briselaOf(s))]));
    expect(s.zones.stack).toHaveLength(3); // one dies trigger, two "put into a graveyard" triggers
    while (s.zones.stack.length > 0) s = resolveTop(s);
    expect(s.players[0]!.life).toBe(20 + 10 + 2);
  });

  it('Brisela dies: both cards are put into the graveyard', () => {
    let s = melded();
    const brisela = s.zones.battlefield.find((id) => s.objects[id]!.defId === BRISELA)!;
    s = resolveTop(cast(s, 'Test Doom', [target(brisela)]));
    expect(s.zones.battlefield.some((id) => [BRISELA, BRUNA, GISELA].includes(s.objects[id]!.defId))).toBe(false);
    const yard = (s.zones.graveyard.p1 ?? []).map((id) => s.objects[id]!.defId);
    expect(yard).toEqual(expect.arrayContaining([BRUNA, GISELA]));
    expect((s.zones.graveyard.p1 ?? []).every((id) => s.objects[id]!.components === undefined && s.objects[id]!.cardId !== undefined)).toBe(true);
  });

  it('CR 712.21d: Leyline of the Void (an opponent\'s) applies to the one event: both cards are exiled', () => {
    let s = scenario([BRUNA, GISELA, BRISELA, 'Leyline of the Void'], {
      p1: { battlefield: [BRUNA, GISELA], hand: ['Test Union of Angels', 'Test Doom'] }, p2: { battlefield: ['Leyline of the Void'] }, defs: [MELD_BRISELA, DOOM],
    });
    s = resolveTop(cast(s, 'Test Union of Angels'));
    const brisela = s.zones.battlefield.find((id) => s.objects[id]!.defId === BRISELA)!;
    s = resolveTop(cast(s, 'Test Doom', [target(brisela)]));
    expect((s.zones.graveyard.p1 ?? []).filter((id) => [BRUNA, GISELA].includes(s.objects[id]!.defId))).toEqual([]);
    expect(s.zones.exile.map((id) => s.objects[id]!.defId)).toEqual(expect.arrayContaining([BRUNA, GISELA]));
  });
});

describe('CR 712.21c: an effect that finds the new object a melded permanent became finds both cards', () => {
  /** "Exile target creature. Return that card to the battlefield under its owner's control." (a flicker, hand-built) */
  const FLICKER = instantOnTarget('Test Blink', "Exile target creature. Return that card to the battlefield under its owner's control.", (t) => [
    { op: 'move', what: t, to: { zone: 'exile' }, as: 'gone' },
    { op: 'move', what: { ref: 'bound', name: 'gone' }, to: { zone: 'battlefield', controller: 'owner' } },
  ]);
  /** Otherworldly Journey (the CR 712.21c example), hand-built: "Exile target creature. At the beginning of the next end step, return that card to the
   * battlefield under its owner's control with a +1/+1 counter on it." */
  const JOURNEY = instantOnTarget('Test Journey', "Exile target creature. At the beginning of the next end step, return that card to the battlefield under its owner's control with a +1/+1 counter on it.", (t) => [
    { op: 'move', what: t, to: { zone: 'exile' }, as: 'gone' },
    { op: 'delay', when: { at: 'step', step: 'end', next: true }, capture: ['gone'], do: [{ op: 'move', what: { ref: 'bound', name: 'gone' }, to: { zone: 'battlefield', controller: 'owner', counters: [{ kind: '+1/+1', count: 1 }] } }] },
  ]);
  const meldThen = (spell: CardDef): GameState => {
    const s = scenario([BRUNA, GISELA, BRISELA], { p1: { battlefield: [BRUNA, GISELA], hand: ['Test Union of Angels', spell.name] }, defs: [MELD_BRISELA, spell] });
    const m = resolveTop(cast(s, 'Test Union of Angels'));
    return resolveTop(cast(m, spell.name, [target(briselaOf(m))]));
  };
  const fieldCards = (s: GameState): string[] => s.zones.battlefield.map((id) => s.objects[id]!.defId).filter((d) => [BRUNA, GISELA, BRISELA].includes(d)).sort();
  const exiled = (s: GameState): string[] => s.zones.exile.map((id) => s.objects[id]!.defId).filter((d) => [BRUNA, GISELA].includes(d)).sort();

  it('a flicker of Brisela returns both Bruna and Gisela; neither stays in exile', () => {
    const s = meldThen(FLICKER);
    expect(fieldCards(s)).toEqual([BRUNA, GISELA]);
    expect(exiled(s)).toEqual([]);
  });

  it('the Otherworldly Journey example: at the next end step both cards return, each with a +1/+1 counter', () => {
    let s = meldThen(JOURNEY);
    expect(exiled(s)).toEqual([BRUNA, GISELA]);
    s = until(s, (t) => t.zones.stack.length > 0);
    s = resolveTop(s);
    expect(fieldCards(s)).toEqual([BRUNA, GISELA]);
    expect(exiled(s)).toEqual([]);
    for (const name of [BRUNA, GISELA]) expect(s.objects[find(s, name, 'battlefield')]!.counters['+1/+1']).toBe(1);
  });

  it('"its power" after exiling Brisela reads the one melded permanent it was (9), not each card (CR 608.2h, 712.21e)', () => {
    const SWORDS = instantOnTarget('Test Banish', 'Exile target creature. You gain life equal to its power.', (t) => [
      { op: 'move', what: t, to: { zone: 'exile' }, as: 'gone' },
      { op: 'gainLife', who: { ref: 'you' }, amount: { q: 'stat', stat: 'power', of: { ref: 'bound', name: 'gone' } } },
    ]);
    const s = meldThen(SWORDS);
    expect(exiled(s)).toEqual([BRUNA, GISELA]);
    expect(s.players[0]!.life).toBe(20 + 9);
  });

  it('the False Demise example: "when it dies, return that card" returns both cards; "its power" is the melded permanent\'s', () => {
    const DEMISE = equivalent({ name: 'Test Second Chance', type_line: 'Enchantment' }, [{
      kind: 'triggered', text: 'Whenever a creature you control dies, you gain life equal to its power, then return that card to the battlefield under your control.',
      trigger: { on: [{ ev: 'zoneChange', subject: { types: ['Creature'], controller: 'you' }, from: 'battlefield', to: 'graveyard' }] },
      effect: { targets: [], steps: [
        { op: 'gainLife', who: { ref: 'you' }, amount: { q: 'stat', stat: 'power', of: { ref: 'event', role: 'subject' } } },
        { op: 'move', what: { ref: 'event', role: 'subject' }, to: { zone: 'battlefield', controller: { ref: 'you' } } },
      ] },
    } as AbilityDef]);
    let s = scenario([BRUNA, GISELA, BRISELA], { p1: { battlefield: [BRUNA, GISELA, 'Test Second Chance'], hand: ['Test Union of Angels', 'Test Doom'] }, defs: [MELD_BRISELA, DOOM, DEMISE] });
    s = resolveTop(cast(s, 'Test Union of Angels'));
    s = resolveTop(cast(s, 'Test Doom', [target(briselaOf(s))]));
    expect(s.zones.stack).toHaveLength(1); // one creature died (CR 712.21)
    s = resolveTop(s);
    expect(fieldCards(s)).toEqual([BRUNA, GISELA]);
    expect(s.players[0]!.life).toBe(20 + 9);
  });
});

/** "If a card you own would be put into your graveyard from anywhere, put it on the bottom of your library instead." (Wheel of Sun and Moon's effect, hand-built) */
const WHEEL = equivalent({ name: 'Test Wheel of Tides', type_line: 'Enchantment' }, [{
  kind: 'static', text: 'If a card you own would be put into your graveyard from anywhere, put it on the bottom of your library instead.', zone: ['battlefield'],
  effects: [{ s: 'replace', replaces: { ev: 'zoneChange', subject: { isCard: true, owner: 'you' }, to: 'graveyard' }, body: { b: 'modify', destination: { zone: 'library', position: 'bottom' } } }],
} as AbilityDef]);

describe('CR 712.21d: with Leyline of the Void and a Wheel of Sun and Moon effect, one choice applies to both cards', () => {
  it('the owner chooses the library: both cards go to the bottom of the library; nothing is exiled', () => {
    let s = scenario([BRUNA, GISELA, BRISELA, 'Leyline of the Void'], {
      p1: { battlefield: [BRUNA, GISELA, 'Test Wheel of Tides'], hand: ['Test Union of Angels', 'Test Doom'] }, p2: { battlefield: ['Leyline of the Void'] }, defs: [MELD_BRISELA, DOOM, WHEEL],
    });
    // every card of p1's going to the graveyard has both effects: the affected player (its owner) chooses the Wheel each time (CR 616.1)
    const settle = (t: GameState): GameState => {
      let u = t;
      for (let i = 0; i < 6 && u.pending?.kind === 'chooseReplacement'; i++) u = answer(u, { kind: 'chooseReplacement', id: u.pending.options.find((o) => /Test Wheel of Tides/.test(o.label))!.id });
      return u;
    };
    s = settle(resolveTop(cast(s, 'Test Union of Angels')));
    s = settle(resolveTop(cast(s, 'Test Doom', [target(briselaOf(s))])));
    const lib = s.zones.library.p1!.map((id) => s.objects[id]!.defId);
    expect(lib.slice(-3)).toEqual([BRUNA, GISELA, 'Test Doom']); // both cards on the bottom, then Test Doom (the Wheel put it there as it resolved)
    expect(s.zones.exile.filter((id) => [BRUNA, GISELA].includes(s.objects[id]!.defId))).toEqual([]);
  });
});

describe('CR 712.8g: a copy of a melded permanent', () => {
  it('a Clone that copies Brisela is Brisela with mana value 0', () => {
    let s = melded(['Clone', 'Island'], ['Clone']);
    s = tweak(s, (x) => { for (let i = 0; i < 3; i++) put(x, 'p1', 'battlefield', 'Island'); });
    const brisela = s.zones.battlefield.find((id) => s.objects[id]!.defId === BRISELA)!;
    s = resolveTop(cast(s, 'Clone'), [pick(brisela)]);
    const clone = find(s, 'Clone', 'battlefield');
    expect(looks(s, clone)).toMatchObject({ name: BRISELA, pt: [9, 10] });
    expect(getChars(s, clone).manaValue).toBe(0);
  });
});

