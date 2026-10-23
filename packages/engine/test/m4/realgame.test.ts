/**
 * Combat in real games, end to end: two scripted players with real decks play land, cast creatures, attack, block, assign damage and
 * eventually one of them dies. Everything goes through applyAction with the decisions the engine asks (no state is edited).
 */
import { describe, expect, it } from 'vitest';
import {
  applyAction, createGame, getChars, legalActions, ptNumbers, replay, type Action, type AssignDamageDecision, type DecisionAnswer, type GameConfig, type GameEvent, type GameState, type PlayerId,
} from '../../src/index';
import { compiledDefs } from '../fixtures';

const DECK_A = [['Forest', 8], ['Plains', 8], ['Grizzly Bears', 6], ['Giant Spider', 3], ['Serra Angel', 2], ['Fencing Ace', 3], ['White Knight', 2], ['Alpine Watchdog', 2], ['Colossal Dreadmaw', 1]] as const;
const DECK_B = [['Mountain', 8], ['Swamp', 8], ['Hill Giant', 5], ['Vampire Nighthawk', 2], ['Typhoid Rats', 4], ['Raging Goblin', 3], ['Black Knight', 2], ['Dross Prowler', 2], ['Craw Wurm', 1]] as const;

const expand = (d: readonly (readonly [string, number])[]): string[] => d.flatMap(([n, c]) => Array<string>(c).fill(n));

function config(seed: string): GameConfig {
  return {
    seed,
    players: [{ name: 'Alice', deck: expand(DECK_A), stops: { fullControl: true } }, { name: 'Bob', deck: expand(DECK_B), stops: { fullControl: true } }],
    defs: compiledDefs([...DECK_A, ...DECK_B].map(([n]) => n)),
    options: { startingPlayer: 'p1', skipMulligans: true },
  };
}

/** A simple deterministic player: land, creatures, attack with everything that is safe-ish, trade when it can, divide damage in order. */
function choose(s: GameState): Action {
  const d = s.pending!;
  const answerWith = (answer: DecisionAnswer): Action => ({ type: 'answer', player: d.player, decisionId: d.id, answer });
  switch (d.kind) {
    case 'priority': {
      const la = legalActions(s, d.player).filter((a) => a.kind !== 'pass' && !a.isMana);
      const land = la.find((a) => a.kind === 'playLand');
      if (land) return land.action;
      const cast = la.filter((a) => a.kind === 'cast');
      if (cast.length > 0) return cast[cast.length - 1]!.action; // the most expensive-looking last in hand order is fine
      return { type: 'pass', player: d.player };
    }
    case 'payCost': return answerWith({ kind: 'payCost', auto: true });
    case 'declareAttackers': return answerWith({ kind: 'declareAttackers', attacks: d.candidates.map((c) => ({ attacker: c.id, defender: c.defenders[0]! })) });
    case 'declareBlockers': {
      const used = new Set<string>();
      const blocks: { blocker: string; attacker: string }[] = [];
      for (const c of d.candidates) {
        const me = ptNumbers(getChars(s, c.id));
        const target = c.attackers.find((a) => {
          if (used.has(a) || d.needsMultiple.includes(a)) return false;
          const them = ptNumbers(getChars(s, a));
          return (me.toughness ?? 0) > (them.power ?? 0) || (me.power ?? 0) >= (them.toughness ?? 99);
        });
        if (target) { used.add(target); blocks.push({ blocker: c.id, attacker: target }); }
      }
      return answerWith({ kind: 'declareBlockers', blocks });
    }
    case 'assignDamage': return answerWith({ kind: 'assignDamage', amounts: divide(d) });
    case 'chooseObjects': return answerWith({ kind: 'chooseObjects', ids: d.options.slice(0, d.min) });
    case 'manualResolve': return answerWith({ kind: 'manualResolve', ops: [] });
    default: throw new Error(`The scripted player can't answer ${d.kind}: ${d.prompt}`);
  }
}

function divide(d: AssignDamageDecision): { id: string; amount: number }[] {
  let left = d.amount;
  const out = d.recipients.map((r) => {
    const n = r.trampleTarget ? 0 : Math.min(left, r.lethal);
    left -= n;
    return { id: r.id, amount: n };
  });
  const last = d.recipients.find((r) => r.trampleTarget) ?? d.recipients[d.recipients.length - 1]!;
  out.find((x) => x.id === last.id)!.amount += left;
  return out;
}

interface Played { s: GameState; actions: Action[]; events: GameEvent[] }

function play(seed: string, max = 1500): Played {
  const cfg = config(seed);
  let s = createGame(cfg);
  const actions: Action[] = [];
  const events: GameEvent[] = [];
  for (let i = 0; i < max && !s.result; i++) {
    const a = choose(s);
    const r = applyAction(s, a);
    if (r.error) throw new Error(`Action ${i} ${JSON.stringify(a)} rejected: ${r.error.message}`);
    s = r.state;
    actions.push(a);
    events.push(...r.events);
  }
  return { s, actions, events };
}

describe("combat end to end in real games", () => {
  const games: Played[] = [];
  for (let i = 0; i < 8; i++) games.push(play(`m4-real-${i}`));

  it('attackers are declared, blockers are declared, damage is dealt, creatures die and players lose: every game ends with a winner', () => {
    for (const [i, g] of games.entries()) {
      expect(g.s.result, `game ${i} ended`).not.toBeNull();
      expect(g.s.result!.winner, `game ${i} has a winner`).not.toBeNull();
      const loser = g.s.players.find((p) => p.id !== g.s.result!.winner)!;
      expect(loser.hasLost).toBe(true);
      expect(loser.life <= 0 || loser.poison >= 10 || loser.lostReason !== undefined).toBe(true);
    }
    const all = games.flatMap((g) => g.events);
    const count = (f: (e: GameEvent) => boolean) => all.filter(f).length;
    expect(count((e) => e.type === 'attackersDeclared' && e.attackers.length > 0)).toBeGreaterThan(20);
    expect(count((e) => e.type === 'blockersDeclared' && e.blocks.length > 0)).toBeGreaterThan(5);
    expect(count((e) => e.type === 'damageDealt' && e.combat)).toBeGreaterThan(40);
    expect(count((e) => e.type === 'zoneChanged' && e.from === 'battlefield' && e.to === 'graveyard' && e.cause === 'destroy')).toBeGreaterThan(5);
    expect(count((e) => e.type === 'playerLost')).toBe(games.length);
  });

  it('the player who lost was dealt combat damage; the winner is the last player remaining (CR 104.2a)', () => {
    for (const g of games) {
      const winner = g.s.result!.winner as PlayerId;
      expect(g.s.result!.reason).toMatch(/last player remaining|won the game/);
      const loserId = g.s.players.find((p) => p.id !== winner)!.id;
      expect(g.events.some((e) => e.type === 'damageDealt' && e.combat && e.target === loserId)).toBe(true);
    }
  });

  it('replaying the actions of each game reproduces its final state exactly', () => {
    for (const [i, g] of games.entries()) {
      const r = replay(config(`m4-real-${i}`), g.actions);
      expect(r.errors).toEqual([]);
      expect(JSON.stringify(r.state)).toBe(JSON.stringify(g.s));
    }
  });

  it('no creature with lethal damage or toughness 0 is ever on the battlefield when a player has priority (state-based actions)', () => {
    let checked = 0;
    for (let i = 0; i < 3; i++) {
      let s = createGame(config(`m4-real-${i}`));
      for (let n = 0; n < 1500 && !s.result; n++) {
        if (s.pending!.kind === 'priority') {
          for (const id of s.zones.battlefield) {
            const c = getChars(s, id);
            if (!c.types.includes('Creature')) continue;
            const t = ptNumbers(c).toughness;
            if (t === null) continue;
            expect(t, `${c.name} toughness`).toBeGreaterThan(0);
            if (!c.keywords.some((k) => k.keyword === 'indestructible')) expect(s.objects[id]!.damage, `${c.name} damage`).toBeLessThan(t);
            checked++;
          }
        }
        s = applyAction(s, choose(s)).state;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});
