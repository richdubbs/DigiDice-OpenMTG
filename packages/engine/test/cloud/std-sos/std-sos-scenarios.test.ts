/**
 * std-sos (docs/CARD_WORK.md, cloud batch 2, slice std-sos): scenarios (synthetic cards, wordings invented, design 6.10) played through the engine.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, ptNumbers, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, answer, find, legal, pass, scenario } from '../../m3/scenario';
import { activate, resolveAll } from '../../m5/cr-examples/helpers';
import { drive, lifeOf as mpLife, mpScenario, resolveStack as mpResolve } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Every ability of the card automated (an experimental template caps the card at partial, never an ability). */
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const ctr = (s: GameState, id: ObjectId, kind = '+1/+1'): number => s.objects[id]?.counters[kind] ?? 0;

/** Answer the decisions that come up: pay costs automatically; stop at priority. */
function settle(s0: GameState, answers: DecisionAnswer[] = []): GameState {
  let s = s0;
  const queue = [...answers];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 30; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (queue.length > 0) s = answer(s, queue.shift()!);
    else break;
  }
  return s;
}
const resolve = (s: GameState, answers: DecisionAnswer[] = []): GameState => settle(pass(pass(s)), answers);
const target = (id: string): DecisionAnswer => ({ kind: 'chooseTargets', targets: [{ kind: 'object', id }] });
const castWith = (s0: GameState, name: string, answers: DecisionAnswer[] = []): GameState =>
  settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), answers);

describe('CR 614.1c, 614.12, 107.3: "~ enters with a number of stun counters on it equal to three minus X. If X is 2 or less, it enters tapped."', () => {
  const TRUDGE = card('Test Trudge', 'Creature — Plant Beast', 'Test Trudge enters with a number of stun counters on it equal to three minus X. If X is 2 or less, it enters tapped.', ['6', '6'], '{X}{G}');
  const play = (x: number): { s: GameState; id: ObjectId } => {
    const s0 = scenario(['Forest'], { p1: { hand: ['Test Trudge'], battlefield: ['Forest', 'Forest', 'Forest', 'Forest', 'Forest'] }, defs: [TRUDGE] });
    const s = resolve(castWith(s0, 'Test Trudge', [{ kind: 'chooseNumber', n: x }]));
    return { s, id: find(s, 'Test Trudge', 'battlefield') };
  };
  it('is automated', () => expect(automated(TRUDGE)).toBe(true));
  it('X = 0: three stun counters, tapped', () => {
    const { s, id } = play(0);
    expect(ctr(s, id, 'stun')).toBe(3);
    expect(s.objects[id]!.tapped).toBe(true);
  });
  it('X = 2: one stun counter, tapped (the boundary)', () => {
    const { s, id } = play(2);
    expect(ctr(s, id, 'stun')).toBe(1);
    expect(s.objects[id]!.tapped).toBe(true);
  });
  it('X = 3: no stun counter, untapped', () => {
    const { s, id } = play(3);
    expect(ctr(s, id, 'stun')).toBe(0);
    expect(s.objects[id]!.tapped).toBe(false);
  });
});

describe('CR 205.1a, 105.3, 611.2a, 613: "Until end of turn, target creature becomes a green and blue Fractal with base power and toughness each equal to X plus 1."', () => {
  const FRACTALIZE = card('Test Fractalize', 'Instant', 'Until end of turn, target creature becomes a green and blue Fractal with base power and toughness each equal to X plus 1.', undefined, '{X}{U}');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  it('X = 2: a 3/3 green and blue Fractal that is no longer a Bear until end of turn', () => {
    expect(automated(FRACTALIZE)).toBe(true);
    const s0 = scenario(['Island'], { p1: { hand: ['Test Fractalize'], battlefield: ['Island', 'Island', 'Island', 'Test Bear'] }, defs: [FRACTALIZE, BEAR] });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const s = resolve(castWith(s0, 'Test Fractalize', [{ kind: 'chooseNumber', n: 2 }, target(bear)]));
    const c = getChars(s, bear);
    expect(ptNumbers(c)).toMatchObject({ power: 3, toughness: 3 });
    expect([...c.subtypes]).toEqual(['Fractal']);
    expect([...c.colors].sort()).toEqual(['G', 'U']);
  });
});

describe('CR 113.6m, 603.3a: "Whenever ..., you may pay {1}. If you do, return ~ from your graveyard to your hand." functions in the graveyard', () => {
  const CONFIDENCE = card('Test Confidence', 'Sorcery', 'Draw a card.\nWhenever you gain life, you may pay {1}. If you do, return this card from your graveyard to your hand.', undefined, '{1}');
  const SIPHON = card('Test Siphon', 'Instant', 'You gain 2 life.');
  it('is automated and its trigger is collected from the graveyard', () => {
    expect(automated(CONFIDENCE)).toBe(true);
    const t = CONFIDENCE.faces[0]!.abilities.find((a) => a.kind === 'triggered');
    expect(t).toMatchObject({ zone: ['graveyard'] });
  });
  it('a life gain returns it from the graveyard when its owner pays', () => {
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Siphon'], graveyard: ['Test Confidence'], battlefield: ['Mountain'] }, defs: [CONFIDENCE, SIPHON] });
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Siphon', 'hand', 'p1') }));
    s = pass(pass(s)); // the spell resolves; the trigger goes on the stack
    s = settle(s, [{ kind: 'yesNo', yes: true }]);
    for (let i = 0; i < 6 && s.zones.stack.length > 0; i++) s = settle(pass(pass(s)), [{ kind: 'yesNo', yes: true }]);
    const inHand = s.zones.hand['p1']!.map((id) => s.defs[s.objects[id]!.defId]!.name);
    expect(inHand).toContain('Test Confidence');
    expect(s.zones.graveyard['p1']!.map((id) => s.defs[s.objects[id]!.defId]!.name)).not.toContain('Test Confidence');
  });
  it('it does nothing while the card is on the battlefield side of the table (not in the graveyard)', () => {
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Siphon', 'Test Confidence'], battlefield: ['Mountain'] }, defs: [CONFIDENCE, SIPHON] });
    const s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Siphon', 'hand', 'p1') }));
    const after = pass(pass(s));
    expect(after.zones.stack.length).toBe(0); // no trigger from a card in hand
  });
});

describe('CR 122.6, 603.4, 603.6: "At the beginning of your end step, if you put a counter on this creature this turn, ..."', () => {
  const TENDER = card('Test Tender', 'Creature — Elf Wizard', 'At the beginning of your end step, if you put a counter on this creature this turn, create a 0/0 green and blue Fractal creature token and put three +1/+1 counters on it.\n{0}: Put a charge counter on this creature.', ['1', '1']);
  const toEnd = (s0: GameState): GameState => {
    let s = s0;
    for (let i = 0; i < 400 && !(s.turn.step === 'end' && s.pending?.kind === 'priority'); i++) {
      const p = s.pending!;
      s = p.kind === 'declareAttackers' ? answer(s, { kind: 'declareAttackers', attacks: [] }) : p.kind === 'declareBlockers' ? answer(s, { kind: 'declareBlockers', blocks: [] } as DecisionAnswer) : pass(s);
    }
    return s;
  };
  const fractals = (s: GameState): number => s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === 'Fractal Token').length;
  it('is automated', () => expect(automated(TENDER)).toBe(true));
  it('no counter put this turn: no token', () => {
    const s0 = scenario(['Mountain', 'Mountain', 'Mountain', 'Mountain'], { p1: { battlefield: ['Test Tender'] }, defs: [TENDER] });
    const s = resolveAll(toEnd(s0));
    expect(s.zones.stack.length).toBe(0);
    expect(fractals(s)).toBe(0);
  });
  it('a counter put this turn: one Fractal token with three +1/+1 counters', () => {
    const s0 = scenario(['Mountain', 'Mountain', 'Mountain', 'Mountain'], { p1: { battlefield: ['Test Tender'] }, defs: [TENDER] });
    const tender = find(s0, 'Test Tender', 'battlefield');
    let s = resolveAll(activate(s0, tender));
    expect(ctr(s, tender, 'charge')).toBe(1);
    s = resolveAll(toEnd(s));
    expect(fractals(s)).toBe(1);
    const t = s.zones.battlefield.find((id) => s.defs[s.objects[id]!.defId]!.name === 'Fractal Token')!;
    expect(ctr(s, t)).toBe(3);
  });
});

describe('CR 113.6m, 603.3a: an upkeep trigger that returns ~ from its owner\'s graveyard functions there', () => {
  const REVENANT = card('Test Revenant', 'Creature — Spirit', 'At the beginning of your upkeep, you may return this card from your graveyard to your hand.', ['1', '1']);
  const nextUpkeep = (s0: GameState): GameState => {
    let s = s0;
    const startTurn = s.turn.number;
    for (let i = 0; i < 600 && !(s.turn.number > startTurn && s.turn.activePlayer === 'p1' && s.turn.step === 'upkeep' && (s.pending?.kind === 'priority' || s.pending?.kind === 'yesNo')); i++) {
      const p = s.pending!;
      s = p.kind === 'declareAttackers' ? answer(s, { kind: 'declareAttackers', attacks: [] }) : p.kind === 'declareBlockers' ? answer(s, { kind: 'declareBlockers', blocks: [] } as DecisionAnswer) : p.kind === 'yesNo' || p.kind === 'payCost' ? settle(s, [{ kind: 'yesNo', yes: false }]) : pass(s);
    }
    return s;
  };
  it('is automated, collected from the graveyard, and returns the card in the owner\'s upkeep', () => {
    expect(automated(REVENANT)).toBe(true);
    expect(REVENANT.faces[0]!.abilities.find((a) => a.kind === 'triggered')).toMatchObject({ zone: ['graveyard'] });
    const s0 = scenario(['Mountain', 'Mountain', 'Mountain'], { p1: { graveyard: ['Test Revenant'], battlefield: ['Mountain'] }, defs: [REVENANT] });
    let s = nextUpkeep(s0);
    for (let i = 0; i < 8 && s.zones.stack.length > 0; i++) s = settle(pass(pass(s)), [{ kind: 'yesNo', yes: true }]);
    const names = (z: string[]): string[] => z.map((id) => s.defs[s.objects[id]!.defId]!.name);
    expect(names(s.zones.hand['p1']!)).toContain('Test Revenant');
    expect(names(s.zones.graveyard['p1']!)).not.toContain('Test Revenant');
  });
});

describe('CR 113.6m, 303.4g: "When a creature with mana value 6 or greater enters, you may return this card from your graveyard to the battlefield attached to that creature."', () => {
  const SCALES = card('Test Scales', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+1 and has trample.\nWhen a creature with mana value 6 or greater enters, you may return this card from your graveyard to the battlefield attached to that creature.', undefined, '{1}');
  const GIANT = card('Test Giant', 'Creature — Giant', '', ['6', '6'], '{6}');
  const IMP = card('Test Imp', 'Creature — Imp', '', ['1', '1'], '{1}');
  it('is automated and collected from the graveyard', () => {
    expect(automated(SCALES)).toBe(true);
    expect(SCALES.faces[0]!.abilities.find((a) => a.kind === 'triggered')).toMatchObject({ zone: ['graveyard'] });
  });
  it('a big creature entering brings the Aura back attached to it', () => {
    const s0 = scenario(['Forest'], { p1: { hand: ['Test Giant'], graveyard: ['Test Scales'], battlefield: ['Forest', 'Forest', 'Forest', 'Forest', 'Forest', 'Forest'] }, defs: [SCALES, GIANT] });
    let s = resolve(castWith(s0, 'Test Giant'), [{ kind: 'yesNo', yes: true }]);
    for (let i = 0; i < 8 && s.zones.stack.length > 0; i++) s = settle(pass(pass(s)), [{ kind: 'yesNo', yes: true }]);
    const aura = s.zones.battlefield.find((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Scales');
    expect(aura).toBeDefined();
    const giant = find(s, 'Test Giant', 'battlefield');
    expect(s.objects[aura!]!.attachedTo).toBe(giant);
  });
  it('a small creature entering does nothing', () => {
    const s0 = scenario(['Forest'], { p1: { hand: ['Test Imp'], graveyard: ['Test Scales'], battlefield: ['Forest', 'Forest'] }, defs: [SCALES, IMP] });
    const s = resolve(castWith(s0, 'Test Imp'));
    expect(s.zones.stack.length).toBe(0);
    expect(s.zones.battlefield.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Scales')).toBe(false);
  });
});

describe('CR 603.10a, 113.6m (std-sos review): a graveyard trigger on a leaves-the-battlefield event looks back: the card must already have been in the graveyard', () => {
  const TRAITOR = card('Test Traitor', 'Creature — Spirit', 'Whenever another creature you control dies, return this card from your graveyard to the battlefield.', ['1', '1']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const WRATH = card('Test Wrath', 'Sorcery', 'Destroy all creatures.');
  const play = (zones: { graveyard?: string[]; battlefield: string[] }): GameState => {
    const s0 = scenario(['Swamp'], { p1: { hand: ['Test Wrath'], ...zones }, defs: [TRAITOR, BEAR, WRATH] });
    let s = resolve(castWith(s0, 'Test Wrath'));
    for (let i = 0; i < 6 && s.zones.stack.length > 0; i++) s = resolve(s);
    return s;
  };
  const onBattlefield = (s: GameState): boolean => s.zones.battlefield.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Traitor');
  it('is automated and functions in the graveyard', () => {
    expect(automated(TRAITOR)).toBe(true);
    expect(TRAITOR.faces[0]!.abilities.find((a) => a.kind === 'triggered')).toMatchObject({ zone: ['graveyard'] });
  });
  it('already in the graveyard when another creature dies: it returns', () => expect(onBattlefield(play({ graveyard: ['Test Traitor'], battlefield: ['Test Bear'] }))).toBe(true));
  it('dying at the same time as the other creature: no trigger (the ability did not exist in the graveyard just before the event)', () => {
    expect(onBattlefield(play({ battlefield: ['Test Traitor', 'Test Bear'] }))).toBe(false);
  });
});

describe('CR 102.2, 102.3, 603.4 (std-sos review): "an opponent controls more creatures than you" judges each opponent alone in a multiplayer game', () => {
  const WATCHER = card('Test Watcher', 'Creature — Cat Cleric', 'When this creature enters, if an opponent controls more creatures than you, you gain 3 life.', ['1', '1']);
  const PLEA = card('Test Plea', 'Sorcery', 'Draw a card. Then if an opponent controls more creatures than you, you gain 3 life.');
  const CUB = card('Test Cub', 'Creature — Cat', '', ['1', '1']);
  const cubs = (n: number): string[] => Array(n).fill('Test Cub') as string[];
  /** Alice (p1) controls two creatures when the condition is checked (the Watcher counts itself); Bob (p2) and Carol (p3) control `bob` and `carol` Cubs. Returns Alice's life after `name` resolves. */
  const lifeAfter = (name: string, bob: number, carol: number): number => {
    let s = mpScenario({ players: 3, defs: [WATCHER, PLEA, CUB], zones: { p1: { hand: [name], battlefield: cubs(name === 'Test Watcher' ? 1 : 2) }, p2: { battlefield: cubs(bob) }, p3: { battlefield: cubs(carol) } } });
    s = mpResolve(drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') })));
    return mpLife(s, 'p1');
  };
  it('both are automated', () => { expect(automated(WATCHER)).toBe(true); expect(automated(PLEA)).toBe(true); });
  for (const name of ['Test Watcher', 'Test Plea']) {
    it(`${name}: one opponent controls more creatures than you (3 > 2): 3 life`, () => expect(lifeAfter(name, 3, 0)).toBe(23));
    it(`${name}: each opponent controls fewer creatures than you, though together they control more (2 + 1 > 2): nothing`, () => expect(lifeAfter(name, 2, 1)).toBe(20));
  }
});

describe('CR 602.5b, 102.2, 102.3 (merge line D): "Activate only if an opponent controls more lands than you" is read as the ability is activated, each opponent alone', () => {
  // the activation restriction of Weathered Wayfarer's shape: std-sos's countPlayers.controlsVs, read at announcement (actions/announce-cond.ts#announceQty)
  const WAYFARER = card('Test Wayfarer', 'Creature — Human Nomad', '{0}: You gain 1 life. Activate only if an opponent controls more lands than you.', ['1', '1']);
  const plains = (n: number): string[] => Array(n).fill('Plains') as string[];
  /** Alice (p1) controls the Wayfarer and two Plains; Bob (p2) and Carol (p3) control `bob` and `carol` Plains. Can Alice activate it? */
  const canActivate = (bob: number, carol: number): boolean => {
    const s = mpScenario({ players: 3, defs: [WAYFARER], zones: { p1: { battlefield: ['Test Wayfarer', ...plains(2)] }, p2: { battlefield: plains(bob) }, p3: { battlefield: plains(carol) } } });
    return legal(s, 'p1', 'activate').some((a) => a.label.includes('Test Wayfarer'));
  };
  it('is automated', () => expect(automated(WAYFARER)).toBe(true));
  it('one opponent controls more lands than you (3 > 2): it can be activated', () => expect(canActivate(3, 0)).toBe(true));
  it('each opponent controls no more lands than you, though together they control more (2 + 1 > 2): it cannot', () => expect(canActivate(2, 1)).toBe(false));
  it('no opponent controls more (2, 2): it cannot', () => expect(canActivate(2, 2)).toBe(false));
});
