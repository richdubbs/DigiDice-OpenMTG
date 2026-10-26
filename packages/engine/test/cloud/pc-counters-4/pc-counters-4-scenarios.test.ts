/**
 * Precon lane pc-counters, round pc-counters-4, played through the engine with synthetic cards compiled by the game's default compiler (invented names, design
 * 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 608.2c, 608.2d   "You may draw a card. Then discard a card.": the "Then" instruction is not inside the "may": it happens whether or not you drew
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, findAll, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: string[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const chars = (s: GameState, id: ObjectId) => getChars(s, id);
/** How many objects of this name are in the zone (an object that changes zone is a new object, CR 400.7: ids do not follow it). */
const inZone = (s: GameState, name: string, zone: 'battlefield' | 'graveyard' | 'exile' | 'hand', who?: PlayerId): number => findAll(s, name, zone, who).length;
const counters = (s: GameState, id: ObjectId): Record<string, number> => s.objects[id]!.counters;

/** Answer every decision: yes/no by `yes`, targets in order from `targets`, mana automatically. */
function drive(s0: GameState, o: { yes?: boolean; targets?: ObjectId[][]; players?: PlayerId[][] } = {}): GameState {
  let s = s0;
  const tq = [...(o.targets ?? [])];
  const pq = [...(o.players ?? [])];
  for (let guard = 0; guard < 80 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, Math.max(p.min, 1)).slice(0, p.max) });
    else if (p.kind === 'chooseTargets') {
      const objs = (tq.shift() ?? []).map((id) => ({ kind: 'object' as const, id }));
      const plrs = (pq.shift() ?? []).map((id) => ({ kind: 'player' as const, id }));
      s = answer(s, { kind: 'chooseTargets', targets: [...objs, ...plrs] });
    } else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Parameters<typeof drive>[1] = {}): GameState {
  let s = drive(s0, o);
  for (let guard = 0; guard < 60 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, o);
  return s;
}
const cast = (s0: GameState, name: string, o: Parameters<typeof drive>[1] = {}, who: PlayerId = 'p1'): GameState =>
  resolveAll(act(s0, { type: 'cast', player: who, card: find(s0, name, 'hand', who) }), o);

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'], colors: ['G'] });

describe('CR 608.2c, 608.2d: "You may put a +1/+1 counter on a creature you control. Then all creatures get -2/-2 until end of turn."', () => {
  const FIN = card('Test Finality', 'Sorcery', 'You may put a +1/+1 counter on a creature you control. Then all creatures get -2/-2 until end of turn.');
  const defs = [FIN, BEAR];
  it('is fully automated', () => expect(full(FIN)).toBe(true));
  it('with "yes" the counter is put and then everything gets -2/-2; with "no" the -2/-2 still happens (the second instruction is not inside the may)', () => {
    for (const yes of [true, false]) {
      let s = scenario([], { defs, p1: { hand: ['Test Finality'], battlefield: ['Test Bear'] } });
      const bear = find(s, 'Test Bear', 'battlefield', 'p1');
      s = cast(s, 'Test Finality', { yes });
      if (yes) {
        expect(s.objects[bear]?.counters['+1/+1']).toBe(1);
        expect(chars(s, bear).power).toBe('1'); // 2 + 1 counter - 2
      } else {
        expect(findAll(s, 'Test Bear', 'graveyard', 'p1').length).toBe(1); // no counter, 2/2 - 2/2: it died, so the "Then" happened
      }
    }
  });
});
