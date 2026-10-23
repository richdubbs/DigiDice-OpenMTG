/**
 * WP7 soak: random bots play synthetic cards that use every new announcement and cost feature (kicker and multikicker statics, an alternative cost, Spree-style
 * mode costs with a kicked override, a divided-damage spell, distinctFrom targets, a crew-style tapPower ability, an "any number of" sacrifice, cycling, collect
 * evidence, a manual cost word, a payment option on every spell). Checks, like the milestone 3 soak:
 *  - the engine never throws,
 *  - every action `legalActions` lists is accepted, and every cast method it lists can be completed (no decision nobody can answer),
 *  - replaying the accepted actions reproduces the final state exactly.
 * A rejected ANSWER (a random pick that breaks a rule, e.g. too little total power) is allowed and must leave the decision open; the bot then tries again or cancels.
 */
import { describe, expect, it } from 'vitest';
import {
  applyAction, createGame, legalActions, replay, type Action, type CardDef, type Decision, type DecisionAnswer, type GameConfig, type GameState,
} from '../../../src/index';
import type { PaymentOption } from '../../../src/keywords/types';
import { compiledDefs } from '../../fixtures';
import { Bot } from '../../m3/bot';
import { describeSlow } from '../../slow';
import { activated, spellAbility, synth, withStatics } from '../helpers';
import { additionalCost, alternativeCost, mana, spec, spellDef, staticAbility } from './support';

const GAMES = 10;
const ACTIONS = 700;

const convoke: PaymentOption = {
  key: 'convoke', describe: 'Tap an untapped creature you control', reduces: { generic: 1, colors: ['W', 'U', 'B', 'R', 'G'] },
  cost: { other: [{ kind: 'tapUntapped', filter: { types: ['Creature'] }, count: 1 }] },
};

function synthetic(): CardDef[] {
  const kicker = staticAbility('Kicker {1}', [additionalCost('kicker', { mana: mana('{1}') }, { optional: true })]);
  const multi = staticAbility('Multikicker {1}', [additionalCost('kicker', { mana: mana('{1}') }, { optional: true, repeatable: true })]);
  const evoke = staticAbility('Evoke {R}', [alternativeCost('evoke', { mana: mana('{R}') })]);
  const entwine = staticAbility('Entwine {1}', [additionalCost('entwine', { mana: mana('{1}') }, { optional: true })]);
  return [
    synth({ name: 'Test S Kicker', cost: '{G}', type: 'Creature — Beast', pt: ['1', '1'], abilities: [kicker] }),
    synth({ name: 'Test S Multi', cost: '{R}', type: 'Creature — Beast', pt: ['1', '1'], abilities: [multi] }),
    synth({ name: 'Test S Evoke', cost: '{2}{R}', type: 'Creature — Elemental', pt: ['3', '2'], abilities: [evoke] }),
    synth({
      name: 'Test S Spree', cost: '{R}', type: 'Instant',
      abilities: [kicker, {
        kind: 'spell', text: 'x',
        effect: {
          targets: [], steps: [],
          modes: {
            min: 1, max: 1, override: { when: { cond: 'wasCast', kicked: true }, min: 1, max: 3 },
            options: [
              { text: 'cheap', program: { targets: [spec({ id: 't0', kind: 'player', filter: undefined, text: 'target player' })], steps: [] }, cost: { mana: mana('{1}') } },
              { text: 'creature', program: { targets: [spec({ id: 't1' })], steps: [] } },
              { text: 'free', program: { targets: [], steps: [] } },
            ],
          },
        },
      }],
    }),
    synth({ name: 'Test S Entwine', cost: '{1}', type: 'Sorcery', abilities: [entwine, { kind: 'spell', text: 'x', effect: { targets: [], steps: [], modes: { min: 1, max: 1, override: { when: { cond: 'wasCast', kicked: 'entwine' }, min: 2, max: 2 }, options: [{ text: 'a', program: { targets: [], steps: [] } }, { text: 'b', program: { targets: [], steps: [] } }] } } }] }),
    synth({ name: 'Test S Divide', cost: '{1}{R}', type: 'Sorcery', abilities: [spellDef('x', [spec({ kind: 'objectOrPlayer', filter: { types: ['Creature'] }, min: 1, max: 3, text: 'up to three targets', divide: { what: 'damage', total: 3 } })])] }),
    synth({ name: 'Test S Distinct', cost: '{R}', type: 'Instant', abilities: [spellDef('x', [spec({ id: 't0' }), spec({ id: 't1', distinctFrom: ['t0'], text: 'another target creature' })])] }),
    synth({ name: 'Test S Group', cost: '{R}', type: 'Instant', abilities: [spellDef('x', [spec({ min: 0, max: 'any', groupLimit: { stat: 'power', cmp: { op: '<=', value: 4 } }, text: 'creatures with total power 4 or less' })])] }),
    synth({ name: 'Test S Crew', cost: '{1}', type: 'Artifact — Vehicle', abilities: [activated('Crew 3', { other: [{ kind: 'tapPower', filter: { types: ['Creature'] }, power: 3 }] }, [], { oncePerTurn: true })] }),
    synth({ name: 'Test S Any', cost: '{1}', type: 'Artifact', abilities: [activated('Sacrifice any number of creatures.', { other: [{ kind: 'sacrifice', filter: { types: ['Creature'] }, count: 'any' }] }, [], { oncePerTurn: true })] }),
    synth({ name: 'Test S Cycler', cost: '{2}', type: 'Creature — Cat', pt: ['1', '1'], abilities: [activated('Cycling {1}', { mana: mana('{1}'), other: [{ kind: 'discard', count: 1, self: true }] }, [], { zone: ['hand'] }, [])] }),
    synth({ name: 'Test S Evidence', cost: '{1}', type: 'Artifact', abilities: [activated('Collect evidence 3.', { other: [{ kind: 'action', action: 'collectEvidence', arg: 3 }] }, [], { oncePerTurn: true })] }),
    synth({ name: 'Test S Confirm', cost: '{1}', type: 'Artifact', abilities: [activated('Do a thing by hand.', { other: [{ kind: 'manual', text: 'Exert Test S Confirm' }] }, [], { oncePerTurn: true })] }),
    synth({ name: 'Test S Flash', cost: '{R}', type: 'Sorcery', abilities: [spellAbility('Nothing.'), staticAbility('Flashback {1}', [alternativeCost('flashback', { mana: mana('{1}') }, { from: 'graveyard' })])] }),
  ];
}

const SYNTH = ['Test S Kicker', 'Test S Multi', 'Test S Evoke', 'Test S Spree', 'Test S Entwine', 'Test S Divide', 'Test S Distinct', 'Test S Group', 'Test S Crew', 'Test S Any', 'Test S Cycler', 'Test S Evidence', 'Test S Confirm', 'Test S Flash'];

function deck(): string[] {
  const out: string[] = [];
  for (const [n, c] of [['Mountain', 9], ['Forest', 4], ['Grizzly Bears', 4], ['Hill Giant', 3], ['Llanowar Elves', 2], ['Lightning Bolt', 2]] as [string, number][]) for (let i = 0; i < c; i++) out.push(n);
  for (const n of SYNTH) out.push(n, n);
  return out;
}

class Wp7Bot extends Bot {
  override answer(d: Decision): DecisionAnswer {
    if (d.kind === 'chooseDivision') {
      const amounts = d.targets.map(() => 1);
      for (let left = d.total - amounts.length; left > 0; left--) amounts[this.int(amounts.length)]!++;
      return { kind: 'chooseDivision', amounts };
    }
    if (d.kind === 'yesNo') return { kind: 'yesNo', yes: this.chance(80) }; // mostly pay the optional costs
    if (d.kind === 'chooseObjects' && this.chance(50)) return { kind: 'chooseObjects', ids: [...d.options].slice(0, Math.max(d.min, d.max >= d.options.length ? d.options.length : d.max)) };
    return super.answer(d);
  }
}

interface Run { config: GameConfig; actions: Action[]; final: GameState; listed: number; casts: number; activations: number; rejectedAnswers: number; stuck: string[]; seen: Map<string, number> }

function play(index: number): Run {
  const config: GameConfig = {
    seed: `wp7-${index}`,
    players: [{ name: 'Alice', deck: deck(), stops: { fullControl: true } }, { name: 'Bob', deck: deck(), stops: { fullControl: true } }],
    defs: [...compiledDefs(['Mountain', 'Forest', 'Grizzly Bears', 'Hill Giant', 'Llanowar Elves', 'Lightning Bolt']), ...synthetic()],
  };
  const bot = new Wp7Bot(`wp7-${index}`);
  let s = createGame(config);
  const actions: Action[] = [];
  const run: Run = { config, actions, final: s, listed: 0, casts: 0, activations: 0, rejectedAnswers: 0, stuck: [], seen: new Map() };
  for (let i = 0; i < ACTIONS && !s.result; i++) {
    const d = s.pending!;
    if (d.kind === 'priority') {
      for (const la of legalActions(s, d.player)) {
        const r = applyAction(s, la.action);
        if (r.error) throw new Error(`Game ${index}, action ${i}: listed action "${la.label}" was rejected: ${r.error.message} (${r.error.rules.join(', ')})`);
        run.listed++;
      }
    }
    let accepted = false;
    for (let attempt = 0; attempt < 40 && !accepted; attempt++) {
      let action = bot.next(s);
      if (attempt > 25 && d.cancellable) action = { type: 'cancel', player: d.player };
      if (attempt === 39 && d.kind !== 'priority' && !d.cancellable) { run.stuck.push(`game ${index}, action ${i}: ${d.kind} "${d.prompt}" could not be answered`); break; }
      const r = applyAction(s, action);
      if (r.error) {
        if (action.type === 'answer') run.rejectedAnswers++;
        else throw new Error(`Game ${index}, action ${i}: ${JSON.stringify(action)} was rejected: ${r.error.message}`);
        continue;
      }
      if (action.type === 'answer') { const k = d.prompt.includes('kicker') ? `${d.kind}:kicker` : d.prompt.includes('entwine') ? `${d.kind}:entwine` : d.kind; run.seen.set(k, (run.seen.get(k) ?? 0) + 1); }
      if (action.type === 'cast') run.casts++;
      if (action.type === 'activate') run.activations++;
      s = r.state;
      actions.push(action);
      accepted = true;
    }
    if (!accepted) break;
  }
  run.final = s;
  return run;
}

// QT: about 12 s; a slow suite (npm run test:all)
describeSlow('WP7 soak: random bots on cards that use every announcement and cost feature', () => {
  const provider = { paymentOptions: () => [convoke] };
  it('plays without exceptions, every listed action is accepted, no decision is a dead end, and replay is exact', () => {
    withStatics(provider, () => {
      const runs = Array.from({ length: GAMES }, (_, g) => play(g));
      const sum = (f: (r: Run) => number) => runs.reduce((n, r) => n + f(r), 0);
      console.log('wp7 soak:', sum((r) => r.actions.length), 'actions;', sum((r) => r.listed), 'listed actions accepted;', sum((r) => r.casts), 'casts;', sum((r) => r.activations), 'activations;', sum((r) => r.rejectedAnswers), 'rejected random answers');
      const seen = (k: string) => sum((r) => r.seen.get(k) ?? 0);
      console.log('wp7 soak decisions:', [...new Set(runs.flatMap((r) => [...r.seen.keys()]))].sort().map((k) => `${k} ${seen(k)}`).join(', '));
      const logged = (text: string) => sum((r) => r.final.log.filter((l) => l.text.includes(text)).length);
      console.log('wp7 soak log:', ['kicked', 'with evoke', 'with flashback', 'by hand', 'sacrifices', 'pays part of'].map((t) => `${t}: ${logged(t)}`).join('; '));
      expect(runs.flatMap((r) => r.stuck)).toEqual([]);
      for (const k of ['chooseTargets', 'chooseOption', 'chooseNumber', 'chooseObjects', 'yesNo']) expect(seen(k), k).toBeGreaterThan(0);
      expect(sum((r) => r.listed)).toBeGreaterThan(500);
      expect(sum((r) => r.casts)).toBeGreaterThan(50);
      expect(sum((r) => r.activations)).toBeGreaterThan(15);
      for (const [i, r] of runs.entries()) {
        const { state, errors } = replay(r.config, r.actions);
        expect(errors, `game ${i}`).toEqual([]);
        expect(JSON.stringify(state), `game ${i}`).toBe(JSON.stringify(r.final));
      }
    });
  }, 240_000);
});
