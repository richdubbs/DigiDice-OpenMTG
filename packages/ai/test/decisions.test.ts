/**
 * The AI answers every decision kind the engine can pend (types/decisions.ts):
 *  - real decisions, harvested from games of random play with a wide mix of fixture cards (every pending decision, whoever's it is, is also put to the AI
 *    and its action applied to the state through `applyAction`): the engine accepts every answer;
 *  - every kind the games did not produce, as a synthetic decision on a real mid-game view: the answer passes the engine's answer validator (a shape check;
 *    tests/safety.test.ts applies the AI's answers to the rarer real decisions through `applyAction`).
 * The AI reads the view through the engine's functions as if it were a state (context.ts): during the harvested games, `legalActions` on the view is checked
 * to list exactly what it lists on the state.
 */
import { describe, expect, it } from 'vitest';
import { applyAction, legalActions, viewFor, type Decision, type GameState, type ObjectId } from '@openmtg/engine';
import { DECISION_KINDS, validateAnswer } from '../../engine/src/core/validate';
import { chooseAction } from '../src/index';
import { gameConfig, type DeckList } from './decks';
import { aiAgent, randomAgent, type Agent } from './harness';
import { createGame } from '@openmtg/engine';

// M6-1: Fog is automated since milestone 6 runs prevention effects of resolved spells; M6-10: so is Fatigue (zz-m6/gate.json), and p2-attack-block-1 Beseech the Queen (its
// comparison with "the number of lands you control"), so Order of Succession (a manual sorcery with no target) keeps a manualResolve decision in the games
const MIX: DeckList = [
  ['Plains', 5], ['Island', 5], ['Swamp', 5], ['Mountain', 5], ['Forest', 5], ['Birds of Paradise', 2], ['Soul Warden', 3], ["Ajani's Pridemate", 2],
  ['Fire // Ice', 3], ['Fireball', 2], ["Kolaghan's Command", 2], ['Fog', 1], ['Order of Succession', 2], ['Lightning Bolt', 2], ['Giant Growth', 2], ['Counterspell', 2],
  ['Mana Leak', 2], ['Doom Blade', 2], ['Raise the Alarm', 1], ['Gravedigger', 2], ['Garruk Wildspeaker', 1], ['Pacifism', 1], ['Serra Angel', 1],
  ['Grizzly Bears', 2], ['Craw Wurm', 1],
];

interface Harvest { kinds: Map<string, number>; checked: number; rejected: string[]; sample: GameState | null; viewChecks: number; viewDiffs: string[] }

const listing = (s: GameState, p: string): string => JSON.stringify(legalActions(s, p).map((l) => [l.kind, l.label, l.isMana, l.action]));

function harvest(seed: string, agents: Record<string, Agent>, maxActions: number, out: Harvest): void {
  const cfg = gameConfig(seed, MIX, MIX);
  let s = createGame(cfg);
  for (let i = 0; i < maxActions && !s.result; i++) {
    const d = s.pending!;
    const view = viewFor(s, d.player);
    if (d.kind === 'priority') {
      out.viewChecks++;
      const onView = listing(view as unknown as GameState, d.player);
      if (onView !== listing(s, d.player)) out.viewDiffs.push(`${seed} turn ${s.turn.number} ${s.turn.step}: ${onView.slice(0, 200)}`);
    }
    const mine = chooseAction(view, view.pending!, `h:${seed}`);
    const r = applyAction(s, mine);
    out.checked++;
    if (r.error) out.rejected.push(`${d.kind}: ${r.error.message} (${JSON.stringify(mine).slice(0, 160)})`);
    else out.kinds.set(d.kind, (out.kinds.get(d.kind) ?? 0) + 1);
    if (!out.sample && s.turn.number >= 6 && d.kind === 'priority' && s.zones.battlefield.length >= 6) out.sample = s;
    const next = agents[d.player]!(s);
    const n = applyAction(s, next);
    if (n.error) {
      if (d.cancellable) s = applyAction(s, { type: 'cancel', player: d.player }).state;
      else if (d.kind === 'priority') s = applyAction(s, { type: 'pass', player: d.player }).state;
      else break;
      continue;
    }
    s = n.state;
  }
}

describe('every decision kind', () => {
  const h: Harvest = { kinds: new Map(), checked: 0, rejected: [], sample: null, viewChecks: 0, viewDiffs: [] };
  for (let g = 0; g < 6; g++) {
    // Random play on both sides, or the AI against random play, to reach both kinds of positions.
    const agents = g % 2 === 0 ? { p1: randomAgent(`a${g}`), p2: randomAgent(`b${g}`) } : { p1: aiAgent(`a${g}`), p2: randomAgent(`b${g}`) };
    harvest(`decisions-${g}`, agents, 1500, h);
  }

  it('real decisions from games: the engine accepts every AI answer', () => {
    expect(h.rejected).toEqual([]);
    expect(h.checked).toBeGreaterThan(500);
    for (const k of ['priority', 'chooseTargets', 'payCost', 'declareAttackers', 'declareBlockers', 'chooseObjects', 'manualResolve']) {
      expect(h.kinds.get(k) ?? 0, `${k} decisions seen`).toBeGreaterThan(0);
    }
    console.log(`AI1 decisions harvested: ${h.checked}; kinds: ${[...h.kinds].map(([k, n]) => `${k} ${n}`).join(', ')}`);
  });

  it('CR 117.1, 400.2: legalActions on the player\'s view lists exactly what it lists on the state, at every priority of the games', () => {
    expect(h.viewDiffs).toEqual([]);
    expect(h.viewChecks).toBeGreaterThan(500);
  });

  it('synthetic decisions of every kind on a real view: the answer passes the engine\'s answer validator (a shape check)', () => {
    const s = h.sample!;
    expect(s).not.toBeNull();
    const me = s.pending!.player;
    const opp = s.players.find((p) => p.id !== me)!.id;
    const bf = (pid: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === pid);
    const creature = (pid: string): ObjectId | undefined => bf(pid).find((id) => s.defs[s.objects[id]!.defId]?.faces[0]!.types.includes('Creature'));
    const oppThing = creature(opp) ?? bf(opp)[0] ?? bf(me)[0]!;
    const hand = s.zones.hand[me]!;
    const base = { id: 'synthetic', player: me, prompt: '' };
    const decisions: Decision[] = [
      { ...base, kind: 'playFirst', options: [me, opp] },
      { ...base, kind: 'mulligan', handSize: 6, mulligans: 0 },
      { ...base, kind: 'chooseObjects', prompt: 'Discard a card.', options: hand.length ? hand : bf(me), min: 1, max: 1 },
      { ...base, kind: 'chooseObjects', prompt: 'Choose any number of creatures.', options: bf(me), min: 0, max: bf(me).length },
      { ...base, kind: 'yesNo', prompt: 'You may draw a card.' },
      { ...base, kind: 'yesNo', prompt: 'Pay this cost by hand and confirm: Exert a creature.', yesLabel: 'I paid it', noLabel: 'I did not', cancellable: true },
      { ...base, kind: 'yesNo', prompt: 'Confirm: you created a token this turn', cancellable: true, rules: ['CR 602.5b'] },
      { ...base, kind: 'yesNo', prompt: 'you feel lucky', rules: ['CR 608.2c'] },
      { ...base, kind: 'chooseNumber', prompt: 'the number of lucky charms', min: 0, max: 1000, rules: ['CR 608.2c'] },
      { ...base, kind: 'chooseOption', prompt: 'Choose one.', options: [{ id: '0', label: 'first' }, { id: '1', label: 'second', disabled: 'no' }], min: 1, max: 1 },
      { ...base, kind: 'chooseOption', prompt: 'Choose an opponent.', options: [{ id: opp, label: 'them' }], min: 1, max: 1 },
      { ...base, kind: 'chooseNumber', prompt: 'Choose a value for X for Fireball.', min: 0, max: 5 },
      { ...base, kind: 'chooseNumber', prompt: 'Choose a number.', min: 1, max: 9 },
      { ...base, kind: 'chooseColor', options: ['R', 'G', 'W'] },
      { ...base, kind: 'order', items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }] },
      { ...base, kind: 'chooseTargets', targetText: 'any target', objects: s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]?.faces[0]!.types.includes('Creature')), players: [me, opp], min: 1, max: 1 },
      { ...base, kind: 'payCost', costText: '{1}', manaSources: [], autoPayable: true },
      // (A payment the engine can't make is always cancellable when the engine asks for it: the bot cancels it.)
      { ...base, kind: 'payCost', costText: '{9}', manaSources: [], autoPayable: false, cancellable: true },
      { ...base, kind: 'declareAttackers', candidates: (bf(me)).filter((id) => creature(me) === id).map((id) => ({ id, defenders: [opp] })) },
      { ...base, kind: 'declareBlockers', candidates: [], needsMultiple: [] },
      { ...base, kind: 'assignDamage', attacker: creature(me) ?? oppThing, amount: 5, recipients: [{ id: oppThing, lethal: 2 }, { id: opp, lethal: 20, trampleTarget: true }], canTrample: true },
      { ...base, kind: 'chooseReplacement', options: [{ id: 'r1', label: 'one' }, { id: 'r2', label: 'two' }] },
      { ...base, kind: 'manualResolve', sourceName: 'Something', text: 'Do something the engine does not understand.' },
      { ...base, kind: 'chooseDivision', what: 'damage', total: 5, targets: [{ id: oppThing, label: 'it' }, { id: opp, label: 'them' }] },
      { ...base, kind: 'chooseDivision', what: 'counters', total: 3, targets: [{ id: bf(me)[0]!, label: 'mine' }] },
      { ...base, kind: 'chooseName', what: 'cardName' },
      { ...base, kind: 'chooseName', what: 'creatureType', options: ['Elf', 'Goblin', 'Human'] },
      { ...base, kind: 'commanderZone', object: bf(me)[0]!, card: 'c1', rule: '903.9b', zone: 'hand' }, // M11-0: CR 903.9b
    ];
    const covered = new Set<string>();
    for (const d of decisions) {
      const view = { ...viewFor(s, me), pending: d };
      const a = chooseAction(view, d, 'synthetic');
      if (a.type === 'cancel') {
        expect(d.cancellable, `${d.kind} cancel only when allowed`).toBe(true);
      } else {
        expect(a.type, d.kind).toBe('answer');
        if (a.type !== 'answer') continue;
        expect(() => validateAnswer(s, d, a.answer), `${d.kind}: ${JSON.stringify(a.answer)}`).not.toThrow();
      }
      covered.add(d.kind);
    }
    for (const k of h.kinds.keys()) covered.add(k);
    expect([...DECISION_KINDS].filter((k) => !covered.has(k))).toEqual([]);
  });
});
