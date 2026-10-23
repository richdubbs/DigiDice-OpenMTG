/**
 * Lane p2-group-actions, round p2-group-actions-2, played through the engine with synthetic cards compiled by the game's default compiler (invented names and
 * wordings, design 6.10). CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 101.4, 608.2d, 110.2a   "each opponent may put a creature card from their hand onto the battlefield": the opponent chooses from their own hand, the card is
 *                              theirs on the battlefield; not you; declining puts nothing
 *   CR 701.22a, 608.2d         "then each opponent may scry 1"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { answer, castAuto, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
function resolve(s0: GameState, o: { take?: boolean; asked?: string[] } = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 100 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) {
    const p = s.pending!;
    if (p.kind === 'priority') s = pass(s);
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseObjects') { o.asked?.push(p.player); s = answer(s, { kind: 'chooseObjects', ids: o.take === false ? [] : p.options.slice(0, Math.max(1, p.min)).slice(0, p.max) }); }
    else if (p.kind === 'yesNo') { o.asked?.push(p.player); s = answer(s, { kind: 'yesNo', yes: o.take !== false }); }
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else if (p.kind === 'chooseOption' || p.kind === 'scry' as string) s = answer(s, { kind: 'chooseOption', ids: [] } as never);
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}

const GIFT = card('Test Gift', 'Sorcery', 'Each opponent may put a creature card from their hand onto the battlefield.');
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const defs = [GIFT, BEAR];
const onField = (s: GameState, owner: string) => s.zones.battlefield.filter((id) => s.objects[id]!.owner === owner && s.objects[id]!.defId === 'Test Bear');

describe('CR 101.4, 608.2d, 110.2a: "each opponent may put a creature card from their hand onto the battlefield"', () => {
  it('is fully automated', () => expect(GIFT.automation.level).toBe('full'));
  it('the opponent puts their Bear onto the battlefield under their control; your own Bear in hand stays', () => {
    const asked: string[] = [];
    let s = scenario([], { defs, p1: { hand: ['Test Gift', 'Test Bear'] }, p2: { hand: ['Test Bear'] } });
    s = resolve(castAuto(s, 'Test Gift'), { asked });
    expect(asked.every((p) => p === 'p2')).toBe(true);
    expect(onField(s, 'p2').length).toBe(1);
    expect(s.objects[onField(s, 'p2')[0]!]!.controller).toBe('p2');
    expect(onField(s, 'p1').length).toBe(0);
  });
  it('the negative case: an opponent who declines puts nothing', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Gift'] }, p2: { hand: ['Test Bear'] } });
    s = resolve(castAuto(s, 'Test Gift'), { take: false });
    expect(onField(s, 'p2').length).toBe(0);
  });
});
