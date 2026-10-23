/**
 * The AI never loses on its own and never cheats: manual questions, attestations, life payments, decking, manual casting text, harmful triggers, piles,
 * lethal threats and poison. Real fixture cards where the fixture has them; cards compiled from their Oracle text (compileCard) or built from the ability
 * model (synth) otherwise. Driven through the engine with real actions.
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, faceChars, legalActions, viewFor, type Action, type CardDef, type Decision, type GameState, type OracleCard } from '@openmtg/engine';
import { act, castAuto, find, scenario } from '../../engine/test/m3/scenario';
import { synth, targetPlayer } from '../../engine/test/m3/synthetic';
import { chooseAction, explainPriority } from '../src/index';
import { cardValue } from '../src/value';

const ai = (s: GameState, seed = 'safety'): Action => {
  const v = viewFor(s, s.pending!.player);
  return chooseAction(v, v.pending!, seed);
};
const explainPriorityFor = (s: GameState): { label: string; score: number }[] => explainPriority(viewFor(s, s.pending!.player), 'safety');
const answerOf = (a: Action): { ids?: string[] } => (a.type === 'answer' ? (a.answer as { ids?: string[] }) : {});
const names = (s: GameState, ids: readonly string[]): string[] => ids.map((id) => s.defs[s.objects[id]!.defId]!.name);
const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const oracle = (card: Partial<OracleCard> & { name: string }): CardDef => compileCard({ layout: 'normal', ...card } as OracleCard);

/** Keep only the top `keep` cards of a player's library (test setup). */
function trimLibrary(s: GameState, p: string, keep: number): GameState {
  const t = structuredClone(s);
  const lib = t.zones.library[p]!;
  for (const id of lib.slice(keep)) delete t.objects[id];
  t.zones.library[p] = lib.slice(0, keep);
  return t;
}

/** Let the AI answer for `aiPlayers` (everyone else passes and declares nothing) until `stop` holds. */
function drive(s: GameState, aiPlayers: string[], stop: (s: GameState) => boolean, steps = 80): GameState {
  for (let i = 0; i < steps && s.pending && !s.result && !stop(s); i++) {
    const d = s.pending;
    let a: Action;
    if (aiPlayers.includes(d.player)) a = ai(s);
    else if (d.kind === 'priority') a = { type: 'pass', player: d.player };
    else if (d.kind === 'declareAttackers') a = { type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'declareAttackers', attacks: [] } };
    else if (d.kind === 'declareBlockers') a = { type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'declareBlockers', blocks: [] } };
    else a = ai(s);
    s = act(s, a);
  }
  return s;
}

/** A synthetic decision put to the AI on a real view of `s`. */
function askAi(s: GameState, d: Decision): Action {
  const v = viewFor(s, d.player);
  return chooseAction({ ...v, pending: d }, d, 'synthetic');
}

describe('CR 608.2c: questions the engine asks because it does not understand the text are never guessed', () => {
  const hunch = synth({
    name: 'Test Hunch', cost: '{U}', type: 'Sorcery',
    abilities: [{ kind: 'spell', text: 'If you feel lucky, draw two cards.', effect: { targets: [], steps: [{ op: 'if', cond: { cond: 'ask', text: 'you feel lucky' }, then: [{ op: 'draw', who: { ref: 'you' }, count: 2 }] }] } }],
  });
  const tally = synth({
    name: 'Test Tally', cost: '{U}', type: 'Sorcery',
    abilities: [{ kind: 'spell', text: 'Draw cards equal to the number of lucky charms.', effect: { targets: [], steps: [{ op: 'draw', who: { ref: 'you' }, count: { q: 'ask', text: 'the number of lucky charms' } }] } }],
  });

  it('CR 608.2c: a manual condition is answered no and a manual number 0, the values that leave the effect undone', () => {
    const s = scenario(['Island'], { p1: { battlefield: ['Island'] } });
    const base = { id: 'q', player: 'p1' as const, rules: ['CR 608.2c'] };
    expect(askAi(s, { ...base, kind: 'yesNo', prompt: 'you feel lucky' })).toMatchObject({ answer: { kind: 'yesNo', yes: false } });
    expect(askAi(s, { ...base, kind: 'chooseNumber', prompt: 'the damage prevented this way', min: 0, max: 1000 })).toMatchObject({ answer: { kind: 'chooseNumber', n: 0 } });
  });

  it('CR 608.2c: a spell whose effect depends on a manual condition or number is not cast for it, and resolving it the AI draws nothing', () => {
    let s = scenario(['Island'], { defs: [hunch, tally], p1: { hand: ['Test Hunch', 'Test Tally'], battlefield: ['Island', 'Island'] } });
    expect(ai(s)).toEqual({ type: 'pass', player: 'p1' });
    const hand = s.zones.hand['p1']!.length;
    s = castAuto(s, 'Test Hunch');
    s = drive(s, ['p1'], (t) => t.zones.stack.length === 0);
    expect(s.zones.hand['p1']!.length).toBe(hand - 1); // "no": nothing drawn
  });
});

describe('CR 602.5b, 118.3: the AI never attests a restriction or a payment by hand; it cancels instead (CR 733.1)', () => {
  // std-rm: "you created a token this turn" is a condition the engine checks now (parser/holes/cond.ts), so the unchecked restriction is an opponent's token
  const idol = oracle({ name: 'Test Oblivion Idol', type_line: 'Artifact', mana_cost: '{2}', oracle_text: '{T}: Draw a card. Activate only if an opponent created a token this turn.\n{8}, {T}, Sacrifice this artifact: Create a 10/10 colorless Eldrazi creature token.' });
  const exertCost = synth({
    name: 'Test Exerter', cost: '{1}', type: 'Artifact',
    abilities: [{ kind: 'activated', text: 'Exert a creature: Draw a card.', cost: { other: [{ kind: 'manual', text: 'Exert a creature' }] }, effect: { targets: [], steps: [{ op: 'draw', who: { ref: 'you' }, count: 1 }] } }],
  });

  it('CR 602.5b: an "Activate only if" the engine cannot check is not ranked, and the AI\'s answer to "Confirm:" is a cancel the engine accepts', () => {
    let s = scenario(['Island'], { defs: [idol], p1: { battlefield: ['Test Oblivion Idol', 'Island'] } });
    expect(explainPriorityFor(s).map((x) => x.label).filter((l) => l.includes('Idol'))).toEqual([]);
    const activate = legalActions(s, 'p1').find((l) => l.kind === 'activate' && l.label.includes('Draw a card'))!;
    s = act(s, activate.action);
    expect(s.pending).toMatchObject({ kind: 'yesNo', cancellable: true });
    const a = ai(s);
    expect(a).toEqual({ type: 'cancel', player: 'p1' });
    const r = applyAction(s, a);
    expect(r.error).toBeUndefined();
    expect(r.state.zones.stack).toEqual([]);
    expect(r.state.pending).toMatchObject({ kind: 'priority', player: 'p1' });
  });

  it('CR 118.3: "Pay this cost by hand and confirm" is cancelled, not answered no', () => {
    let s = scenario(['Island'], { defs: [exertCost], p1: { battlefield: ['Test Exerter'] } });
    const activate = legalActions(s, 'p1').find((l) => l.kind === 'activate' && l.label.includes('Draw a card'))!;
    s = act(s, activate.action);
    for (let i = 0; i < 5 && s.pending?.kind !== 'yesNo'; i++) s = act(s, ai(s));
    expect(s.pending).toMatchObject({ kind: 'yesNo', yesLabel: 'I paid it' });
    const r = applyAction(s, ai(s));
    expect(r.error).toBeUndefined();
    expect(r.state.zones.stack).toEqual([]);
  });
});

describe('CR 119.4, 107.4f, 104.3b: the AI never pays its last life', () => {
  it('CR 702.34a, 119.4: no flashback whose life payment would bring it to 0 (Deep Analysis at 3 life)', () => {
    const cards = ['Island', 'Deep Analysis'];
    expect(ai(scenario(cards, { p1: { graveyard: ['Deep Analysis'], battlefield: ['Island', 'Island'] }, life: 3 }))).toEqual({ type: 'pass', player: 'p1' });
    expect(ai(scenario(cards, { p1: { graveyard: ['Deep Analysis'], battlefield: ['Island', 'Island'] } }))).toMatchObject({ type: 'cast', method: 'flashback' });
  });

  it('CR 107.4f: no Phyrexian mana paid with its last life (Gitaxian Probe at 2 life, Dismember at 4 life)', () => {
    const probe = (life: number): GameState => scenario(['Plains', 'Gitaxian Probe', 'Grizzly Bears'], { p1: { hand: ['Gitaxian Probe'], battlefield: ['Plains'] }, p2: { hand: ['Grizzly Bears'] }, life });
    expect(ai(probe(2))).toEqual({ type: 'pass', player: 'p1' });
    expect(ai(probe(20))).toMatchObject({ type: 'cast' });
    const dismember = scenario(['Swamp', 'Dismember', 'Serra Angel'], { p1: { hand: ['Dismember'], battlefield: ['Swamp'] }, p2: { battlefield: ['Serra Angel'] }, life: 4 });
    expect(ai(dismember)).toEqual({ type: 'pass', player: 'p1' });
  });

  it('CR 119.4: the payment backstop cancels a cost that would take its last life', () => {
    let s = scenario(['Plains', 'Gitaxian Probe', 'Grizzly Bears'], { p1: { hand: ['Gitaxian Probe'], battlefield: ['Plains'] }, p2: { hand: ['Grizzly Bears'] }, life: 2 });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Gitaxian Probe', 'hand') });
    for (let i = 0; i < 5 && s.pending?.kind !== 'payCost'; i++) s = act(s, ai(s));
    expect(s.pending).toMatchObject({ kind: 'payCost', autoPayable: true });
    expect(ai(s)).toEqual({ type: 'cancel', player: 'p1' });
  });
});

describe('CR 121.4, 704.5b: the AI never decks itself', () => {
  it('CR 121.4: a targeted draw-X spell is not cast into a nearly empty library, and X leaves cards in it', () => {
    const stroke = (library: number): GameState => trimLibrary(scenario(['Island', 'Stroke of Genius'], {
      p1: { hand: ['Stroke of Genius'], battlefield: ['Island', 'Island', 'Island', 'Island', 'Island', 'Island'] },
    }), 'p1', library);
    expect(ai(stroke(1))).toEqual({ type: 'pass', player: 'p1' });
    let s = stroke(5);
    expect(ai(s)).toMatchObject({ type: 'cast' });
    s = drive(s, ['p1'], (t) => t.zones.graveyard['p1']!.length > 0 && t.zones.stack.length === 0);
    expect(s.zones.library['p1']!.length).toBeGreaterThan(2);
    expect(s.result).toBeNull();
  });

  it('CR 121.4: no planeswalker draw ("each player draws", "target player draws") with an empty library (Jace Beleren)', () => {
    const s = trimLibrary(scenario(['Island', 'Jace Beleren'], { p1: { battlefield: ['Island', { name: 'Jace Beleren', counters: { loyalty: 3 } }] } }), 'p1', 0);
    expect(ai(s)).toEqual({ type: 'pass', player: 'p1' });
  });

  it('CR 608.2d, 121.4: an optional draw is declined when the library is nearly empty', () => {
    const maybe = synth({
      name: 'Test Maybe', cost: '{U}', type: 'Sorcery',
      abilities: [{ kind: 'spell', text: 'You may draw a card.', effect: { targets: [], steps: [{ op: 'may', who: { ref: 'you' }, do: [{ op: 'draw', who: { ref: 'you' }, count: 1 }] }] } }],
    });
    const at = (library: number): GameState => {
      let s = trimLibrary(scenario(['Island'], { defs: [maybe], p1: { hand: ['Test Maybe'], battlefield: ['Island'] } }), 'p1', library);
      s = castAuto(s, 'Test Maybe');
      return drive(s, [], (t) => t.pending?.kind === 'yesNo');
    };
    expect(ai(at(2))).toMatchObject({ answer: { kind: 'yesNo', yes: false } });
    expect(ai(at(20))).toMatchObject({ answer: { kind: 'yesNo', yes: true } });
  });
});

describe('CR 601.2f: manual casting text is never skipped', () => {
  it('CR 601.2f: a spell whose additional cost is manual text is not cast (a cost no template reads yet)', () => {
    // M6-5a: Tormenting Voice's "discard a card" is a real additional cost now (static:additionalCost), and M6-5 reads "sacrifice a creature or
    // discard a card" as a grouped cost (CR 601.2b), so the manual case is a cost the parser can't state
    const voice = oracle({ name: 'Test Manual Voice', type_line: 'Sorcery', mana_cost: '{1}{R}', oracle_text: 'As an additional cost to cast this spell, put a card from your hand on top of your library.\nDraw two cards.' });
    expect(voice.faces[0]!.abilities[0]!.kind).toBe('manual');
    const s = scenario(['Mountain', 'Grizzly Bears'], { defs: [voice], p1: { hand: ['Test Manual Voice', 'Grizzly Bears'], battlefield: ['Mountain', 'Mountain'] } });
    expect(explainPriorityFor(s).map((x) => x.label).filter((l) => l.includes('Test Manual Voice'))).toEqual([]);
  });
});

describe('CR 603.3d, 608.2d: harmful triggers never hit the AI\'s own things', () => {
  it('CR 603.3d: a mandatory "deals 4 damage to target creature" ETB with no other creature around is not cast (Flametongue Kavu)', () => {
    const cards = ['Mountain', 'Flametongue Kavu', 'Grizzly Bears'];
    const alone = scenario(cards, { p1: { hand: ['Flametongue Kavu'], battlefield: ['Mountain', 'Mountain', 'Mountain', 'Mountain'] } });
    expect(ai(alone)).toEqual({ type: 'pass', player: 'p1' });
    const facing = scenario(cards, { p1: { hand: ['Flametongue Kavu'], battlefield: ['Mountain', 'Mountain', 'Mountain', 'Mountain'] }, p2: { battlefield: ['Grizzly Bears'] } });
    expect(ai(facing)).toMatchObject({ type: 'cast' });
  });

  it('CR 608.2d: "you may exile another target creature" is declined when the target is its own (Fiend Hunter)', () => {
    let s = scenario(['Plains', 'Fiend Hunter', 'Serra Angel'], { p1: { hand: ['Fiend Hunter'], battlefield: ['Plains', 'Plains', 'Plains', 'Serra Angel'] } });
    s = castAuto(s, 'Fiend Hunter');
    let asked = false;
    s = drive(s, ['p1'], (t) => {
      if (t.pending?.kind === 'yesNo') { asked = true; expect(ai(t)).toMatchObject({ answer: { yes: false } }); }
      return t.zones.stack.length === 0 && asked;
    });
    expect(asked).toBe(true);
    expect(names(s, s.zones.exile)).toEqual([]);
    expect(names(s, s.zones.battlefield)).toContain('Serra Angel');
  });
});

describe('CR 608.2d: piles (Fact or Fiction)', () => {
  const fof = oracle({ name: 'Fact or Fiction', type_line: 'Instant', mana_cost: '{3}{U}', oracle_text: 'Reveal the top five cards of your library. An opponent separates those cards into two piles. Put one pile into your hand and the other into your graveyard.' });

  it('CR 608.2d: the AI separates into two piles of similar value and, as chooser, takes the pile worth more', () => {
    let s = scenario(['Island', 'Serra Angel', 'Lightning Bolt', 'Craw Wurm', 'Counterspell', 'Grizzly Bears'], {
      defs: [fof],
      p1: { hand: ['Fact or Fiction'], battlefield: ['Island', 'Island', 'Island', 'Island'], library: ['Serra Angel', 'Lightning Bolt', 'Craw Wurm', 'Counterspell', 'Grizzly Bears'] },
    });
    s = castAuto(s, 'Fact or Fiction');
    const hand = s.zones.hand['p1']!.length;
    let separated: string[] = [];
    let options: { id: string; label: string }[] = [];
    let chosen = '';
    s = drive(s, ['p1', 'p2'], (t) => {
      const d = t.pending;
      if (d?.kind === 'chooseObjects' && /two piles/.test(d.prompt)) separated = answerOf(ai(t)).ids ?? [];
      if (d?.kind === 'chooseOption' && d.prompt === 'Choose a pile.') { options = d.options; chosen = answerOf(ai(t)).ids?.[0] ?? ''; }
      return t.zones.stack.length === 0;
    });
    expect(separated.length).toBeGreaterThan(0);
    expect(separated.length).toBeLessThan(5);
    const cardsOf = (label: string): string[] => (/no cards/.test(label) ? [] : label.replace(/^Pile \d: /, '').split(', '));
    const worth = (label: string): number => cardsOf(label).reduce((n, name) => n + cardValue(faceChars(s.defs[name]!, 0)), 0);
    const taken = options.find((o) => o.id === chosen)!;
    const other = options.find((o) => o.id !== chosen)!;
    expect(s.zones.hand['p1']!.length).toBe(hand + cardsOf(taken.label).length);
    expect(worth(taken.label)).toBeGreaterThanOrEqual(worth(other.label));
  });
});

describe('CR 104.3b, 701.6: lethal threats on the stack', () => {
  it('CR 104.3b, 701.6: counters a burn spell that would be lethal, lets a harmless one resolve', () => {
    const at = (life: number): GameState => {
      let s = scenario(['Mountain', 'Island', 'Lightning Bolt', 'Counterspell'], { p1: { hand: ['Lightning Bolt'], battlefield: ['Mountain'] }, p2: { hand: ['Counterspell'], battlefield: ['Island', 'Island'] }, life });
      s = castAuto(s, 'Lightning Bolt', { answers: [{ kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] }] });
      return act(s, { type: 'pass', player: 'p1' });
    };
    expect(ai(at(3))).toMatchObject({ type: 'cast' });
    expect(ai(at(20))).toEqual({ type: 'pass', player: 'p2' });
  });
});

describe('CR 704.5c: poison', () => {
  it('CR 702.90b, 704.5c: chump blocks an infect attacker that would give it its tenth poison counter', () => {
    let s = scenario(['Plains', 'Phyrexian Digester', 'Ornithopter'], { p1: { battlefield: ['Phyrexian Digester'] }, p2: { battlefield: ['Ornithopter'] } });
    s.players.find((p) => p.id === 'p2')!.poison = 9;
    while (s.pending?.kind !== 'declareAttackers') s = act(s, { type: 'pass', player: s.pending!.player });
    s = act(s, { type: 'answer', player: 'p1', decisionId: s.pending.id, answer: { kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Phyrexian Digester', 'battlefield'), defender: 'p2' }] } });
    while (s.pending?.kind !== 'declareBlockers') s = act(s, { type: 'pass', player: s.pending!.player });
    expect(ai(s)).toMatchObject({ answer: { kind: 'declareBlockers', blocks: [{ blocker: find(s, 'Ornithopter', 'battlefield') }] } });
  });
});

describe('CR 701.21a, 701.9a: harm aimed at a player who has nothing to lose', () => {
  it('CR 701.21a: no "target player sacrifices a creature" at an opponent without creatures (Liliana of the Veil)', () => {
    const s = scenario(['Swamp', 'Liliana of the Veil', 'Grizzly Bears'], {
      p1: { battlefield: ['Swamp', { name: 'Liliana of the Veil', counters: { loyalty: 3 } }], hand: ['Grizzly Bears'] }, p2: { hand: ['Grizzly Bears', 'Grizzly Bears'] },
    });
    expect(explainPriorityFor(s).map((x) => x.label).filter((l) => l.includes('sacrifices'))).toEqual([]);
  });

  it('CR 701.9a: no "target player discards a card" at an opponent with an empty hand', () => {
    const rot = synth({
      name: 'Test Rot', cost: '{B}', type: 'Sorcery',
      abilities: [{ kind: 'spell', text: 'Target player discards a card.', effect: { targets: [targetPlayer], steps: [{ op: 'discard', who: { ref: 'target', id: 't0' }, count: 1 }] } }],
    });
    const empty = scenario(['Swamp'], { defs: [rot], p1: { hand: ['Test Rot'], battlefield: ['Swamp'] } });
    expect(ai(empty)).toEqual({ type: 'pass', player: 'p1' });
    const full = scenario(['Swamp', 'Grizzly Bears'], { defs: [rot], p1: { hand: ['Test Rot'], battlefield: ['Swamp'] }, p2: { hand: ['Grizzly Bears'] } });
    expect(ai(full)).toMatchObject({ type: 'cast' });
  });
});

describe('the seed', () => {
  it('orders equally good plays: different seeds can cast different copies, the same seed always the same one', () => {
    const s = scenario(['Forest', 'Grizzly Bears'], { p1: { hand: ['Grizzly Bears', 'Grizzly Bears'], battlefield: ['Forest', 'Forest'] } });
    const cards = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const a = ai(s, `seed-${i}`);
      expect(a).toEqual(ai(s, `seed-${i}`));
      cards.add((a as Extract<Action, { type: 'cast' }>).card);
    }
    expect(cards.size).toBe(2);
  });

  it('CR 733.1: after a cancel the next play is a different one, whatever the seed', () => {
    const s = scenario(['Forest', 'Grizzly Bears'], { p1: { hand: ['Grizzly Bears', 'Grizzly Bears'], battlefield: ['Forest', 'Forest'] } });
    for (let i = 0; i < 6; i++) {
      const first = ai(s, `seed-${i}`) as Extract<Action, { type: 'cast' }>;
      const cancelled = applyAction(act(s, first), { type: 'cancel', player: 'p1' }).state;
      const next = ai(cancelled, `seed-${i}`) as Extract<Action, { type: 'cast' }>;
      expect(next.card).not.toBe(first.card);
    }
  });
});
