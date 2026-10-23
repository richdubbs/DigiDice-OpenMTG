/**
 * p2-c-dieroll-2 (Phase 2 lane p2-c-dieroll): the round's readings played through the engine with synthetic cards (invented names, design 6.10). Rolls come from the
 * game's seeded generator; each test reads the result from the log and checks the outcome against it over several seeds. CR cites from memory, unverified.
 *
 *   CR 706.2, 608.2h          "Roll a d20. If the result is 10 or less, you lose that much life.": the loss is the result, and nothing above 10
 *   CR 601.2c, 706.3a         "Choose target creature an opponent controls, then roll a d20." over rows: the target is chosen as the spell is cast, the row acts on it
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { answer, find, life, pass, scenario } from '../../m3/scenario';
import { castCard } from '../../m5/announce/support';

function card(name: string, type: string, text: string, pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as unknown as OracleCard);
}
function settle(s0: GameState, targets: { kind: 'object' | 'player'; id: string }[] = []): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 30; guard++) {
    const p = s.pending as unknown as { kind: string; options: string[]; min: number };
    if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, Math.max(p.min, 0)) });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets } as never);
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: false });
    else break;
  }
  return s;
}
function resolveAll(s0: GameState): GameState {
  let s = s0;
  for (let guard = 0; s.zones.stack.length > 0 && guard < 30; guard++) s = settle(s.pending?.kind === 'priority' ? pass(s) : s);
  return s;
}
const cast = (s: GameState, name: string, targets: { kind: 'object' | 'player'; id: string }[] = []): GameState => resolveAll(settle(castCard(s, name), targets));
const rolled = (s: GameState): number[] => s.log.flatMap((l) => { const m = /rolls a d\d+: (\d+)\./.exec(l.text); return m ? [Number(m[1])] : []; });
const SEEDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'];

describe('CR 706.2, 608.2h: "If the result is 10 or less, you lose that much life."', () => {
  const GRUMBLE = card('Test Grumble', 'Instant', 'Roll a d20. If the result is 10 or less, you lose that much life.');
  it('is automated; the life lost is the result when it is 10 or less, none otherwise', () => {
    expect(GRUMBLE.automation.level).toBe('full');
    const seen = new Set<boolean>();
    for (const seed of SEEDS) {
      const s0 = scenario([], { defs: [GRUMBLE], p1: { hand: ['Test Grumble'] }, seed });
      const s = cast(s0, 'Test Grumble');
      const [r] = rolled(s);
      expect(r, seed).toBeDefined();
      expect(life(s0, 'p1') - life(s, 'p1'), `${seed}: rolled ${r}`).toBe(r! <= 10 ? r! : 0);
      seen.add(r! <= 10);
    }
    expect(seen.size).toBe(2); // both branches were played
  });
});

describe('CR 601.2c, 706.3a: "Choose target creature an opponent controls, then roll a d20." over result rows', () => {
  const VERDICT = card('Test Verdict', 'Instant', 'Choose target creature an opponent controls, then roll a d20.\n1—10 | Tap that creature.\n11—20 | Destroy that creature.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  it('is automated; the chosen creature is tapped or destroyed by the row of the result; the caster\'s own creature is not a legal target', () => {
    expect(VERDICT.automation.level).toBe('full');
    for (const seed of SEEDS.slice(0, 8)) {
      const s0 = scenario([], { defs: [VERDICT, BEAR], p1: { hand: ['Test Verdict'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Bear'] }, seed });
      const theirs = find(s0, 'Test Bear', 'battlefield', 'p2');
      const mine = find(s0, 'Test Bear', 'battlefield', 'p1');
      const s = cast(s0, 'Test Verdict', [{ kind: 'object', id: theirs }]);
      const [r] = rolled(s);
      if (r! <= 10) expect(s.objects[theirs]!.tapped, `${seed}: rolled ${r}`).toBe(true);
      else expect(s.zones.battlefield.includes(theirs), `${seed}: rolled ${r}`).toBe(false);
      expect(s.zones.battlefield.includes(mine) && !s.objects[mine]!.tapped, seed).toBe(true);
    }
    const s0 = scenario([], { defs: [VERDICT, BEAR], p1: { hand: ['Test Verdict'], battlefield: ['Test Bear'] } });
    expect(() => castCard(s0, 'Test Verdict')).toThrow(/no legal one/); // the caster's own creature is no legal target (CR 601.2c, 115.1)
  });
});
