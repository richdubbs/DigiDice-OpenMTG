/**
 * The AI's heuristics on hand-built boards with real fixture cards (packages/engine/test/m3/scenario.ts), driven through the engine with real actions.
 */
import { describe, expect, it } from 'vitest';
import { viewFor, type Action, type GameState, type ObjectId } from '@openmtg/engine';
import { act, advanceTo, answer, castAuto, find, scenario } from '../../engine/test/m3/scenario';
import { chooseAction } from '../src/index';

const ai = (s: GameState, seed = 'scenario'): Action => {
  const v = viewFor(s, s.pending!.player);
  return chooseAction(v, v.pending!, seed);
};
const aiStep = (s: GameState): GameState => act(s, ai(s));
const nameOfCard = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;

/** Let the AI answer everything for the player who is deciding until that player gets priority again or `stop` holds. */
function aiUntilPriority(s: GameState, player: string): GameState {
  for (let i = 0; i < 20 && s.pending && !(s.pending.kind === 'priority' && s.pending.player === player && s.suspended === null); i++) {
    if (s.pending.player !== player) break;
    s = aiStep(s);
  }
  return s;
}

describe('priority: lands and spells', () => {
  it('CR 305.1: plays a land first in its main phase', () => {
    const s = scenario(['Mountain', 'Grizzly Bears', 'Forest'], { p1: { hand: ['Grizzly Bears', 'Mountain'], battlefield: ['Forest'] } });
    const a = ai(s);
    expect(a.type).toBe('playLand');
  });

  it('CR 601.2: casts the most valuable creature it can pay for (the curve)', () => {
    const s = scenario(['Forest', 'Grizzly Bears', 'Giant Spider', 'Craw Wurm'], {
      p1: { hand: ['Grizzly Bears', 'Giant Spider', 'Craw Wurm'], battlefield: ['Forest', 'Forest', 'Forest', 'Forest'] },
    });
    const a = ai(s);
    expect(a.type).toBe('cast');
    expect(nameOfCard(s, (a as Extract<Action, { type: 'cast' }>).card)).toBe('Giant Spider');
  });

  it('CR 115.1: aims burn at the best creature it kills, not at one it cannot kill', () => {
    let s = scenario(['Mountain', 'Lightning Bolt', 'Grizzly Bears', 'Serra Angel'], {
      p1: { hand: ['Lightning Bolt'], battlefield: ['Mountain'] }, p2: { battlefield: ['Grizzly Bears', 'Serra Angel'] },
    });
    s = aiStep(s);
    expect(s.pending!.kind).toBe('chooseTargets');
    const a = ai(s) as Extract<Action, { type: 'answer' }>;
    const t = (a.answer as { targets: { id: string }[] }).targets[0]!;
    expect(nameOfCard(s, t.id)).toBe('Grizzly Bears');
  });

  it('CR 120.3a, 104.3b, 704.5a: burn goes to the face when it is lethal', () => {
    let s = scenario(['Mountain', 'Lightning Bolt', 'Grizzly Bears'], { p1: { hand: ['Lightning Bolt'], battlefield: ['Mountain'] }, p2: { battlefield: ['Grizzly Bears'] }, life: 3 });
    s = aiStep(s);
    const a = ai(s) as Extract<Action, { type: 'answer' }>;
    expect(a.answer).toEqual({ kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] });
    s = aiUntilPriority(act(s, a), 'p1');
    while (!s.result && s.pending?.kind === 'priority') s = act(s, { type: 'pass', player: s.pending.player });
    expect(s.result?.winner).toBe('p1');
  });

  it('CR 701.6: counters a valuable spell, but lets a cheap one resolve', () => {
    let s = scenario(['Plains', 'Island', 'Serra Angel', 'Grizzly Bears', 'Forest', 'Counterspell'], {
      p1: { hand: ['Serra Angel', 'Grizzly Bears'], battlefield: ['Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Forest', 'Forest'] },
      p2: { hand: ['Counterspell'], battlefield: ['Island', 'Island'] },
    });
    const bears = castAuto(s, 'Grizzly Bears');
    expect(bears.pending).toMatchObject({ kind: 'priority', player: 'p1' });
    const afterBears = act(bears, { type: 'pass', player: 'p1' });
    expect(ai(afterBears)).toEqual({ type: 'pass', player: 'p2' });
    s = castAuto(s, 'Serra Angel');
    s = act(s, { type: 'pass', player: 'p1' });
    const a = ai(s);
    expect(a.type).toBe('cast');
    s = aiUntilPriority(act(s, a), 'p2');
    const top = s.zones.stack[s.zones.stack.length - 1]!;
    expect(nameOfCard(s, top)).toBe('Counterspell');
  });

  it('CR 702.6: equips an unattached Equipment to its best creature', () => {
    let s = scenario(['Mountain', 'Bonesplitter', 'Grizzly Bears', 'Hill Giant'], {
      p1: { battlefield: ['Bonesplitter', 'Grizzly Bears', 'Hill Giant', 'Mountain'] },
    });
    const a = ai(s);
    expect(a).toMatchObject({ type: 'activate', source: find(s, 'Bonesplitter', 'battlefield') });
    s = act(s, a);
    expect(s.pending!.kind).toBe('chooseTargets');
    const t = ai(s) as Extract<Action, { type: 'answer' }>;
    expect(t.answer).toEqual({ kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s, 'Hill Giant', 'battlefield') }] });
    s = aiUntilPriority(act(s, t), 'p1');
    while (s.zones.stack.length > 0) s = act(s, { type: 'pass', player: s.pending!.player });
    expect(s.objects[find(s, 'Bonesplitter', 'battlefield')]!.attachedTo).toBe(find(s, 'Hill Giant', 'battlefield'));
  });

  it('CR 602.2: a {T} damage ability kills a creature it can kill, and otherwise pings the opponent at the end of their turn', () => {
    let s = scenario(['Prodigal Pyromancer', 'Llanowar Elves', 'Mountain'], { p1: { battlefield: ['Prodigal Pyromancer'] }, p2: { battlefield: ['Llanowar Elves'] } });
    s = aiStep(s);
    expect(s.pending!.kind).toBe('chooseTargets');
    const a = ai(s) as Extract<Action, { type: 'answer' }>;
    expect(nameOfCard(s, (a.answer as { targets: { id: string }[] }).targets[0]!.id)).toBe('Llanowar Elves');

    let t = scenario(['Prodigal Pyromancer', 'Mountain'], { p1: { battlefield: ['Prodigal Pyromancer'] } });
    expect(ai(t)).toEqual({ type: 'pass', player: 'p1' }); // on its own turn it keeps the creature untapped to attack or block
    t = advanceTo(t, 2, 'end');
    t = act(t, { type: 'pass', player: 'p2' });
    t = aiStep(t);
    expect(t.pending!.kind).toBe('chooseTargets');
    expect(ai(t)).toMatchObject({ answer: { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] } });
  });

  it('never decks itself on purpose: no card draw from a nearly empty library (CR 704.5b)', () => {
    let s = scenario(['Island', 'Think Twice'], { p1: { hand: ['Think Twice'], battlefield: ['Island', 'Island'] } });
    s = advanceTo(s, 2, 'end');
    s = act(s, { type: 'pass', player: 'p2' });
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p1' });
    expect(ai(s).type).toBe('cast');
    const short = structuredClone(s);
    const lib = short.zones.library['p1']!;
    for (const id of lib.slice(2)) delete short.objects[id];
    short.zones.library['p1'] = lib.slice(0, 2);
    expect(ai(short)).toEqual({ type: 'pass', player: 'p1' });
  });
});

describe('combat', () => {
  function toAttack(cards: string[], p1: string[], p2: string[], life?: number): GameState {
    let s = scenario(cards, { p1: { battlefield: p1 }, p2: { battlefield: p2 }, ...(life !== undefined ? { life } : {}) });
    while (s.pending?.kind !== 'declareAttackers') s = act(s, { type: 'pass', player: s.pending!.player });
    return s;
  }
  const attackers = (a: Action): string[] => ((a as Extract<Action, { type: 'answer' }>).answer as { attacks: { attacker: string }[] }).attacks.map((x) => x.attacker);

  it('CR 508.1: attacks when nothing can block profitably', () => {
    const s = toAttack(['Grizzly Bears'], ['Grizzly Bears'], []);
    expect(attackers(ai(s))).toHaveLength(1);
  });

  it('CR 508.1: does not attack a 2/2 into an untapped 4/4 blocker', () => {
    const s = toAttack(['Grizzly Bears', 'Craw Wurm'], ['Grizzly Bears'], ['Craw Wurm']);
    expect(attackers(ai(s))).toHaveLength(0);
  });

  it('CR 508.1: attacks with everything when the attack is lethal through the best blocks', () => {
    const s = toAttack(['Grizzly Bears', 'Hill Giant', 'Craw Wurm'], ['Grizzly Bears', 'Grizzly Bears', 'Hill Giant'], ['Craw Wurm'], 4);
    expect(attackers(ai(s))).toHaveLength(3);
  });

  function toBlock(cards: string[], p1: string[], p2: string[], life?: number): GameState {
    let s = toAttack(cards, p1, p2, life);
    s = answer(s, { kind: 'declareAttackers', attacks: s.pending!.kind === 'declareAttackers' ? s.pending!.candidates.map((c) => ({ attacker: c.id, defender: 'p2' })) : [] });
    while (s.pending?.kind !== 'declareBlockers') s = act(s, { type: 'pass', player: s.pending!.player });
    return s;
  }
  const blocks = (a: Action): { blocker: string; attacker: string }[] => ((a as Extract<Action, { type: 'answer' }>).answer as { blocks: { blocker: string; attacker: string }[] }).blocks;

  it('CR 509.1: blocks when its blocker kills the attacker and survives', () => {
    const s = toBlock(['Grizzly Bears', 'Hill Giant'], ['Grizzly Bears'], ['Hill Giant']);
    expect(blocks(ai(s))).toHaveLength(1);
  });

  it('CR 509.1, 704.5a: chump blocks only when the damage would be lethal', () => {
    const cards = ['Craw Wurm', 'Raging Goblin'];
    expect(blocks(ai(toBlock(cards, ['Craw Wurm'], ['Raging Goblin'])))).toHaveLength(0);
    expect(blocks(ai(toBlock(cards, ['Craw Wurm'], ['Raging Goblin'], 6)))).toHaveLength(1);
  });

  it('CR 702.19b: a trampler assigns lethal damage to its blocker and the rest to the player', () => {
    let s = scenario(['Rancor', 'Craw Wurm', 'Grizzly Bears', 'Forest'], {
      p1: { hand: ['Rancor'], battlefield: ['Craw Wurm', 'Forest'] }, p2: { battlefield: ['Grizzly Bears'] },
    });
    s = aiUntilPriority(aiStep(s), 'p1'); // Rancor on the Wurm
    while (s.zones.stack.length > 0) s = act(s, { type: 'pass', player: s.pending!.player });
    while (s.pending?.kind !== 'declareAttackers') s = act(s, { type: 'pass', player: s.pending!.player });
    s = aiStep(s);
    while (s.pending?.kind !== 'declareBlockers') s = act(s, { type: 'pass', player: s.pending!.player });
    s = answer(s, { kind: 'declareBlockers', blocks: [{ blocker: find(s, 'Grizzly Bears', 'battlefield'), attacker: find(s, 'Craw Wurm', 'battlefield') }] });
    for (let i = 0; i < 10 && s.pending?.kind !== 'assignDamage'; i++) s = act(s, { type: 'pass', player: s.pending!.player });
    expect(s.pending!.kind).toBe('assignDamage');
    const a = ai(s) as Extract<Action, { type: 'answer' }>;
    const amounts = (a.answer as { amounts: { id: string; amount: number }[] }).amounts;
    expect(amounts.find((x) => x.id === 'p2')?.amount).toBe(6 + 2 - 2);
  });

  it('CR 509.2: pumps a blocked attacker so it survives and kills the blocker', () => {
    let s = scenario(['Grizzly Bears', 'Hill Giant', 'Giant Growth', 'Forest'], {
      p1: { hand: ['Giant Growth'], battlefield: ['Grizzly Bears', 'Forest'] }, p2: { battlefield: ['Hill Giant'] },
    });
    while (s.pending?.kind !== 'declareAttackers') s = act(s, { type: 'pass', player: s.pending!.player });
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Grizzly Bears', 'battlefield'), defender: 'p2' }] });
    while (s.pending?.kind !== 'declareBlockers') s = act(s, { type: 'pass', player: s.pending!.player });
    s = answer(s, { kind: 'declareBlockers', blocks: [{ blocker: find(s, 'Hill Giant', 'battlefield'), attacker: find(s, 'Grizzly Bears', 'battlefield') }] });
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p1' });
    const a = ai(s);
    expect(a.type).toBe('cast');
    expect(nameOfCard(s, (a as Extract<Action, { type: 'cast' }>).card)).toBe('Giant Growth');
  });
});

describe('the other decisions', () => {
  it('CR 103.5: keeps a hand with lands and spells, mulligans a hand without lands', () => {
    const s = scenario(['Forest', 'Grizzly Bears', 'Giant Spider'], {
      p1: { hand: ['Forest', 'Forest', 'Forest', 'Grizzly Bears', 'Grizzly Bears', 'Giant Spider', 'Giant Spider'] },
      p2: { hand: ['Grizzly Bears', 'Grizzly Bears', 'Grizzly Bears', 'Grizzly Bears', 'Giant Spider', 'Giant Spider', 'Giant Spider'] },
    });
    const ask = (player: 'p1' | 'p2'): Action => {
      const v = viewFor(s, player);
      const d = { kind: 'mulligan' as const, id: 'm', player, prompt: 'Keep?', handSize: 6, mulligans: 0 };
      return chooseAction({ ...v, pending: d }, d, 'm');
    };
    expect(ask('p1')).toMatchObject({ answer: { kind: 'mulligan', keep: true } });
    expect(ask('p2')).toMatchObject({ answer: { kind: 'mulligan', keep: false } });
  });

  it('CR 608.2: an effect the engine does not understand is left undone, with a note in the log (never resolved by guessing)', () => {
    let s = scenario(['Mountain', 'Lightning Bolt'], { p1: { hand: ['Lightning Bolt'], battlefield: ['Mountain'] }, manual: ['Lightning Bolt'] });
    expect(ai(s)).toEqual({ type: 'pass', player: 'p1' }); // a spell that is only manual text is never cast by the AI
    s = castAuto(s, 'Lightning Bolt');
    while (s.pending?.kind !== 'manualResolve') s = act(s, { type: 'pass', player: s.pending!.player });
    const a = ai(s) as Extract<Action, { type: 'answer' }>;
    expect(a.answer).toMatchObject({ kind: 'manualResolve', ops: [{ op: 'note' }] });
    const after = act(s, a);
    expect(after.players.map((p) => p.life)).toEqual([20, 20]);
    expect(after.log.some((e) => e.level === 'manual' && /left undone/.test(e.text))).toBe(true);
  });

  it('is deterministic: the same view, decision and seed give the same action', () => {
    const s = scenario(['Mountain', 'Lightning Bolt', 'Grizzly Bears', 'Hill Giant'], {
      p1: { hand: ['Lightning Bolt'], battlefield: ['Mountain'] }, p2: { battlefield: ['Grizzly Bears', 'Hill Giant'] },
    });
    expect(ai(s, 'x')).toEqual(ai(s, 'x'));
  });

  it('refuses a decision that is not its player\'s', () => {
    const s = scenario(['Mountain'], { p1: { battlefield: ['Mountain'] } });
    const v = viewFor(s, 'p2');
    expect(() => chooseAction(v, s.pending!, 'x')).toThrow(/belongs to p1/);
  });
});
