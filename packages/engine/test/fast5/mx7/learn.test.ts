/**
 * FAST5 MX7: learn (CR 701.48a) and the cards a player owns outside the game (CR 400.11, 400.11a: the sideboard, `PlayerConfig.sideboard` ->
 * `GameState.outside`). Synthetic cards compiled by the game's default compiler (wordings follow the printed learn cards). Each test is named after its rule.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, ConfigError, createGame, ENGINE_CAPABILITIES, viewFor, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { act, answer, find, passBoth, scenario } from '../../m3/scenario';
import { simpleConfig } from '../../helpers';

function card(name: string, type: string, text: string, cost = '{0}', pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', type_line: type, oracle_text: text, mana_cost: cost, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard as never);
}

const REMINDER = '(You may reveal a Lesson card you own from outside the game and put it into your hand, or discard a card to draw a card.)';
const QUIZ = card('Test Pop Quiz', 'Instant', `Draw a card.\nLearn. ${REMINDER}`, '{0}');
const LESSON = card('Test Lesson Study', 'Sorcery — Lesson', 'Draw two cards.', '{0}');
const LESSON2 = card('Test Lesson Bolt', 'Sorcery — Lesson', 'Test Lesson Bolt deals 2 damage to any target.', '{0}');
const SIDE = card('Test Sideboard Bear', 'Creature — Bear', '', '{1}', ['2', '2']);
const TWITCH = card('Test Eyetwitch', 'Creature — Eye Bat', `Flying\nWhen this creature dies, learn. ${REMINDER}`, '{0}', ['1', '1']);
const PHOENIX = card('Test Retriever Phoenix', 'Creature — Phoenix', 'As long as this card is in your graveyard, if you would learn, you may instead return this card to the battlefield.', '{0}', ['2', '2']);
const KILL = card('Test Kill Spell', 'Instant', 'Destroy target creature.');
const QUIZ_ONLY = card('Test Quiz Only', 'Instant', `Learn. ${REMINDER}`);
const DEFS = [QUIZ, LESSON, LESSON2, SIDE, TWITCH, PHOENIX, KILL, QUIZ_ONLY];

/** A scenario where p1 owns `side` outside the game (as createGame stores a sideboard). */
function withSide(side: string[], p1: NonNullable<Parameters<typeof scenario>[1]>['p1'] = {}): GameState {
  const s = scenario([], { p1, defs: DEFS });
  s.outside = { p1: [...side], p2: [] };
  return s;
}
const cast = (s: GameState, name: string): GameState => {
  let t = act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') });
  while (t.pending?.kind === 'payCost') t = answer(t, { kind: 'payCost', auto: true });
  return t;
};
const names = (s: GameState, ids: readonly string[]): string[] => ids.map((id) => s.defs[s.objects[id]!.defId]!.name).sort();
const handNames = (s: GameState): string[] => names(s, s.zones.hand['p1']!);
const optionIds = (s: GameState): string[] => (s.pending?.kind === 'chooseOption' ? s.pending.options.map((o) => o.id) : []);

describe('CR 701.48a: "Learn." is a keyword action the engine runs', () => {
  it('the template compiles it, the capability exists, and a spell with it is full', () => {
    expect(ENGINE_CAPABILITIES.has('action:learn')).toBe(true);
    expect(QUIZ.automation.level).toBe('full');
    expect(JSON.stringify(QUIZ.faces[0]!.abilities)).toContain('{"op":"action","action":"learn","who":{"ref":"you"}}');
    expect(TWITCH.automation.level).toBe('full');
  });
});

describe('CR 400.11a, 100.4: a sideboard in the game config is the player\'s cards outside the game', () => {
  const cfg = () => {
    const c = simpleConfig();
    return { ...c, defs: [...(Array.isArray(c.defs) ? c.defs : Object.values(c.defs)), LESSON, SIDE] };
  };
  it('createGame stores it per player (no key without a sideboard, so older states are unchanged)', () => {
    expect('outside' in createGame(simpleConfig())).toBe(false);
    const c = cfg();
    const s = createGame({ ...c, players: [{ ...c.players[0]!, sideboard: [LESSON.id, SIDE.id] }, c.players[1]!] });
    expect(s.outside).toEqual({ p1: [LESSON.id, SIDE.id], p2: [] });
  });
  it('an unknown sideboard card is a configuration error', () => {
    const c = cfg();
    expect(() => createGame({ ...c, players: [{ ...c.players[0]!, sideboard: ['No Such Card'] }, c.players[1]!] })).toThrow(ConfigError);
  });
  it('a view shows a player their own sideboard and never another player\'s (hidden information, CR 400.2)', () => {
    const c = cfg();
    const s = createGame({ ...c, players: [{ ...c.players[0]!, sideboard: [LESSON.id] }, { ...c.players[1]!, sideboard: [SIDE.id] }] });
    const v1 = viewFor(s, 'p1');
    expect(v1.outside).toEqual({ p1: [LESSON.id] });
    expect(v1.defs[LESSON.id]).toBeDefined();
    expect(v1.defs[SIDE.id]).toBeUndefined();
    expect(viewFor(s, 'p2').outside).toEqual({ p2: [SIDE.id] });
    expect(viewFor(s, null).outside).toEqual({});
  });
});

describe('CR 701.48a, 400.11b: learn puts a Lesson card the player owns from outside the game into their hand', () => {
  it('offers each Lesson card (not other sideboard cards), reveals the chosen one and puts it into the hand; it leaves the sideboard', () => {
    let s = withSide([LESSON.id, SIDE.id, LESSON2.id, LESSON.id], { hand: ['Test Pop Quiz'] });
    s = passBoth(cast(s, 'Test Pop Quiz'));
    expect(s.pending?.kind).toBe('chooseOption');
    expect(s.pending?.player).toBe('p1');
    expect(optionIds(s)).toEqual(['discard', `lesson:${LESSON.id}`, `lesson:${LESSON2.id}`, 'none']); // the drawn card can be discarded
    s = answer(s, { kind: 'chooseOption', ids: [`lesson:${LESSON.id}`] });
    expect(handNames(s)).toEqual(['Plains', 'Test Lesson Study']);
    expect(s.outside!['p1']).toEqual([SIDE.id, LESSON2.id, LESSON.id]); // one copy left the sideboard
    const lesson = find(s, 'Test Lesson Study', 'hand', 'p1');
    expect(s.objects[lesson]!.revealedTo).toContain('p2'); // revealed (CR 701.20a)
    expect(viewFor(s, 'p2').objects[lesson]?.defId).toBe(LESSON.id);
    expect(s.log.some((l) => /reveals Test Lesson Study from outside the game/.test(l.text) && l.rules?.includes('CR 701.48a'))).toBe(true);
    // the Lesson is a card in the game now (CR 400.11b): it can be cast
    s = passBoth(cast(s, 'Test Lesson Study'));
    expect(s.zones.graveyard['p1']!.some((id) => s.objects[id]!.defId === LESSON.id)).toBe(true);
  });
  it('a learn trigger (dies) works the same way', () => {
    let s = withSide([LESSON.id], { battlefield: ['Test Eyetwitch'], hand: ['Test Kill Spell'] });
    const eye = find(s, 'Test Eyetwitch', 'battlefield', 'p1');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Kill Spell', 'hand', 'p1') });
    while (s.pending && s.pending.kind !== 'priority') {
      if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: eye }] });
      else s = answer(s, { kind: 'payCost', auto: true });
    }
    s = passBoth(passBoth(s)); // the spell resolves; the dies trigger goes on the stack and resolves
    expect(optionIds(s)).toEqual([`lesson:${LESSON.id}`, 'none']); // empty hand: nothing to discard
    s = answer(s, { kind: 'chooseOption', ids: [`lesson:${LESSON.id}`] });
    expect(handNames(s)).toEqual(['Test Lesson Study']);
  });
});

describe('CR 701.48a: "You may discard a card. If you do, draw a card."', () => {
  it('discarding a card draws a card, and no Lesson is put into the hand', () => {
    let s = withSide([LESSON.id], { hand: ['Test Pop Quiz', 'Test Sideboard Bear'] });
    s = passBoth(cast(s, 'Test Pop Quiz'));
    s = answer(s, { kind: 'chooseOption', ids: ['discard'] });
    expect(s.pending?.kind).toBe('chooseObjects'); // which card (two in hand: the bear and the drawn Plains)
    s = answer(s, { kind: 'chooseObjects', ids: [find(s, 'Test Sideboard Bear', 'hand', 'p1')] });
    expect(handNames(s)).toEqual(['Plains', 'Plains']);
    expect(names(s, s.zones.graveyard['p1']!)).toContain('Test Sideboard Bear');
    expect(s.outside!['p1']).toEqual([LESSON.id]);
  });
  it('with no sideboard, learn still offers the discard (and doing neither)', () => {
    let s = scenario([], { p1: { hand: ['Test Pop Quiz'] }, defs: DEFS });
    s = passBoth(cast(s, 'Test Pop Quiz'));
    expect(optionIds(s)).toEqual(['discard', 'none']);
    s = answer(s, { kind: 'chooseOption', ids: ['none'] });
    expect(handNames(s)).toEqual(['Plains']);
    expect(s.pending?.kind).toBe('priority');
  });
  it('with an empty hand and no Lesson outside the game nothing is asked', () => {
    let s = withSide([SIDE.id], { hand: ['Test Quiz Only'] });
    s = passBoth(cast(s, 'Test Quiz Only'));
    expect(s.pending?.kind).toBe('priority');
    expect(s.log.some((l) => /no card to discard and no Lesson card/.test(l.text))).toBe(true);
  });
});

describe('design 10, CR 614.1a, 113.6b: text the engine does not run that replaces learning', () => {
  const WARDEN = card('Test Learn Warden', 'Enchantment', 'If you would learn, you draw a card instead.');
  const DEFS2 = [...DEFS, WARDEN];
  const replaceIds = (s: GameState): string[] => optionIds(s).filter((id) => id.startsWith('replace:'));

  it('Retriever Phoenix in the learner\'s graveyard: the regular choice plus "apply the replacement by hand" (one option per card, CR 616.1)', () => {
    expect(PHOENIX.faces[0]!.abilities.some((a) => a.kind === 'manual')).toBe(true);
    let s = withSide([LESSON.id], { hand: ['Test Pop Quiz'], graveyard: ['Test Retriever Phoenix'] });
    const phoenix = find(s, 'Test Retriever Phoenix', 'graveyard', 'p1');
    s = passBoth(cast(s, 'Test Pop Quiz'));
    expect(s.pending?.kind).toBe('chooseOption');
    expect(optionIds(s)).toEqual(['discard', `lesson:${LESSON.id}`, `replace:${phoenix}`, 'none']);
    // the Lesson half of learn can still be done: the sideboard is offered (CR 701.48a)
    const t = answer(s, { kind: 'chooseOption', ids: [`lesson:${LESSON.id}`] });
    expect(handNames(t)).toEqual(['Plains', 'Test Lesson Study']);
    // choosing the replacement resolves it by hand for the learner (the move op returns the card)
    const r = answer(s, { kind: 'chooseOption', ids: [`replace:${phoenix}`] });
    expect(r.pending?.kind).toBe('manualResolve');
    expect(r.pending?.player).toBe('p1');
    expect(r.pending?.kind === 'manualResolve' ? r.pending.text : '').toMatch(/would learn/);
  });
  it('with an empty hand and no Lesson, the Phoenix in the graveyard is still offered', () => {
    let s = withSide([], { hand: ['Test Quiz Only'], graveyard: ['Test Retriever Phoenix'] });
    s = passBoth(cast(s, 'Test Quiz Only'));
    expect(replaceIds(s)).toHaveLength(1);
    expect(optionIds(s)).not.toContain('discard');
  });
  it('Retriever Phoenix anywhere else does nothing (CR 113.6b): battlefield, exile, an opponent\'s graveyard', () => {
    for (const where of ['battlefield', 'exile', 'opp-graveyard'] as const) {
      const s0 = scenario([], {
        p1: { hand: ['Test Pop Quiz'], ...(where === 'battlefield' ? { battlefield: ['Test Retriever Phoenix'] } : where === 'exile' ? { exile: ['Test Retriever Phoenix'] } : {}) },
        ...(where === 'opp-graveyard' ? { p2: { graveyard: ['Test Retriever Phoenix'] } } : {}),
        defs: DEFS,
      });
      s0.outside = { p1: [LESSON.id], p2: [] };
      const s = passBoth(cast(s0, 'Test Pop Quiz'));
      expect(s.pending?.kind, where).toBe('chooseOption');
      expect(optionIds(s), where).toEqual(['discard', `lesson:${LESSON.id}`, 'none']);
    }
  });
  it('a Phoenix cast and resolved this turn does not make a later learn manual', () => {
    let s = withSide([LESSON.id], { hand: ['Test Retriever Phoenix', 'Test Pop Quiz'] });
    s = passBoth(cast(s, 'Test Retriever Phoenix'));
    while (s.pending?.kind === 'chooseOption' || s.pending?.kind === 'manualResolve') s = s.pending.kind === 'chooseOption' ? answer(s, { kind: 'chooseOption', ids: ['none'] }) : answer(s, { kind: 'manualResolve', ops: [] } as never);
    expect(find(s, 'Test Retriever Phoenix', 'battlefield', 'p1')).toBeDefined();
    s = passBoth(cast(s, 'Test Pop Quiz'));
    expect(s.pending?.kind).toBe('chooseOption');
    expect(replaceIds(s)).toEqual([]);
  });
  it('unrun "would learn" text that works on the battlefield still makes the whole learn manual (fail closed)', () => {
    expect(WARDEN.faces[0]!.abilities.some((a) => a.kind === 'manual')).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Pop Quiz'], battlefield: ['Test Learn Warden'] }, defs: DEFS2 });
    s = passBoth(cast(s, 'Test Pop Quiz'));
    expect(s.pending?.kind).toBe('manualResolve');
  });
});
