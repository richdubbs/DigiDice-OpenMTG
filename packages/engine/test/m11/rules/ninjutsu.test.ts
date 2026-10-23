/**
 * M11-1: commander ninjutsu's runtime (CR 702.49d): an activated ability that functions in the command zone too, whose cost reveals "this card from your
 * hand or from the command zone"; putting the commander onto the battlefield this way is not casting it (CR 903.8: no tax, no cast counted). The keyword data
 * (keywords/data/commander-ninjutsu.json) and its lexicon line are M11-4's; the ability here is hand-built in the shape of ninjutsu's expansion
 * (keywords/data/ninjutsu.json) with the zones ['hand', 'command'] (M11-4 writes it with the manual CR 702.49c step as ninjutsu has it).
 */
import { describe, expect, it } from 'vitest';
import { commanderTax, legalActions, type AbilityDef, type DecisionAnswer, type GameState } from '../../../src/index';
import { act, answerUntilPriority, commanderRec, commanderScenario, forests, inCommand, legend, pass, runCombat, withAbilities } from './helpers';

const COMMANDER_NINJUTSU: AbilityDef = {
  kind: 'activated', text: 'Commander ninjutsu {1}', zone: ['hand', 'command'],
  cost: {
    mana: [{ kind: 'generic', amount: 1 }],
    other: [
      { kind: 'reveal', zone: 'hand', count: 1, self: true },
      { kind: 'returnToHand', filter: { types: ['Creature'], controller: 'you', attacking: true, blocked: false }, count: 1 },
    ],
  },
  onlyIf: { cond: 'turnOf', whose: 'you', step: ['declareBlockers', 'combatDamage', 'endCombat'] },
  effect: { targets: [], steps: [{ op: 'move', what: { ref: 'self' }, to: { zone: 'battlefield', controller: { ref: 'you' }, tapped: true, attacking: true } }] },
} as AbilityDef;
const YURIKO = withAbilities(legend('Test Yuriko', '{2}{G}', ['1', '3'], ['U', 'B'], '', 'Legendary Creature — Human Ninja'), [COMMANDER_NINJUTSU]);
const BEAR = legend('Test Sneaky Bear', '{1}', ['1', '1'], ['G'], '', 'Creature — Bear');
const BOB = legend('Test Bob Commander', '{G}', ['1', '1'], ['G']);

/** Answer what is asked with the first legal choice (payment automatic) until priority. */
function firstChoices(s: GameState): GameState {
  let t = s;
  for (let i = 0; i < 20 && t.pending && t.pending.kind !== 'priority'; i++) {
    const d = t.pending;
    const a: DecisionAnswer | undefined = d.kind === 'payCost' ? { kind: 'payCost', auto: true }
      : d.kind === 'chooseObjects' ? { kind: 'chooseObjects', ids: d.options.slice(0, Math.max(d.min, 1)) }
        : d.kind === 'chooseOption' ? { kind: 'chooseOption', ids: d.options.slice(0, Math.max(d.min, 1)).map((o) => o.id) } : undefined;
    if (!a) break;
    t = answerUntilPriority(t, [a]);
  }
  return t;
}

describe('M11-1: commander ninjutsu (CR 702.49d)', () => {
  it('CR 702.49d: activated from the command zone after blockers: the attacker returns, the commander enters tapped and attacking; no tax, no cast counted (CR 903.8)', () => {
    let s = commanderScenario({ p1Commanders: [YURIKO], p2Commanders: [BOB], defs: [BEAR], p1: { battlefield: [...forests(1), 'Test Sneaky Bear'] } });
    const bear = s.zones.battlefield.find((id) => s.objects[id]!.defId === BEAR.id)!;
    s = runCombat(s, { attack: [[bear]], until: 'declareBlockers' });
    const la = legalActions(s, 'p1').find((a) => a.kind === 'activate' && a.object === inCommand(s, 'Test Yuriko'));
    expect(la).toBeDefined();
    s = firstChoices(act(s, la!.action));
    s = firstChoices(pass(pass(s)));
    const yuriko = s.zones.battlefield.find((id) => s.objects[id]!.defId === YURIKO.id);
    expect(yuriko).toBeDefined();
    expect(s.objects[yuriko!]!.tapped).toBe(true);
    expect(s.combat?.attackers.some((a) => a.id === yuriko)).toBe(true);
    expect(s.zones.hand['p1']!.some((id) => s.objects[id]!.defId === BEAR.id)).toBe(true);
    expect(commanderRec(s, 'p1', 'Test Yuriko').casts).toBe(0);
    expect(commanderTax(s, commanderRec(s, 'p1', 'Test Yuriko').card)).toBe(0);
  });
});
