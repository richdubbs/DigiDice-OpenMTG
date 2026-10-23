/**
 * p2-cost-statics-2 (lane p2-cost-statics): cost changes by what a spell or an ability targets, played through the engine with synthetic cards compiled by the
 * game's default compiler (invented names and wordings, design 6.10). CR cites from memory, unverified.
 *
 *   CR 601.2c, 601.2f, 115.9b  "Spells your opponents cast that target a Goblin you control cost {2} more to cast": the targets are chosen, then the total cost
 *   CR 602.2b, 601.2f          "Abilities your opponents activate that target a Goblin you control cost {2} more to activate": the same for an activated ability
 *   CR 303.4, 601.2f           "Aura spells you cast that target enchanted creature cost {3} less to cast": the creature the source is attached to
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, legal, scenario } from '../../m3/scenario';
import { tweak } from '../../m4/helpers';
import { passBoth } from '../../m3/scenario';

function card(name: string, type: string, text: string, cost = '{0}', pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}

interface Script { targets?: TargetChoice[][] }
/** Answer every decision but priority from the script (defaults: no, the minimum, no targets, the first `min` options). */
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  const q = { targets: [...(script.targets ?? [])] };
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: false });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: p.min });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.targets.shift() ?? [] });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.min) });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
const pass = (s: GameState): GameState => drive(act(s, { type: 'pass', player: s.pending!.player }));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const castBy = (s: GameState, name: string, player: string, script?: Script): GameState => drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), script);
/** Casting succeeds (the spell is on the stack) or the cast is refused (an error, or the spell never reaches the stack). */
const casts = (s: GameState, name: string, player: string, script: Script): boolean => {
  try {
    return castBy(s, name, player, script).zones.stack.length > s.zones.stack.length;
  } catch {
    return false;
  }
};
const untappedLands = (s: GameState, p: string): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && s.objects[id]!.defId === 'Plains' && !s.objects[id]!.tapped).length;

const GOBLIN = card('Test Goblin', 'Creature — Goblin', '', '{0}', ['1', '1']);
const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
const WARDEN = card('Test Warden', 'Creature — Merfolk', 'Spells your opponents cast that target a Goblin you control cost {2} more to cast.\nAbilities your opponents activate that target a Goblin you control cost {2} more to activate.', '{0}', ['1', '1']);
const ZAP = card('Test Zap', 'Instant', 'Target creature gets -1/-0 until end of turn.');
const PINGER = card('Test Pinger', 'Artifact', '{T}: Target creature gets -1/-0 until end of turn.');
const CHARM = card('Test Strong Charm', 'Enchantment — Aura', 'Enchant creature\nAura spells you cast that target enchanted creature cost {3} less to cast.');
const MANTLE = card('Test Mantle', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+1.', '{3}');
const DEFS = [GOBLIN, BEAR, WARDEN, ZAP, PINGER, CHARM, MANTLE];

describe('p2-cost-statics-2: the synthetic cards are automated', () => {
  it('every card plays fully', () => {
    for (const d of DEFS) expect(d.automation.level, `${d.name}: ${JSON.stringify(d.automation)}`).toBe('full');
  });
});

describe('CR 601.2c, 601.2f, 115.9b: "Spells your opponents cast that target a Goblin you control cost {2} more to cast"', () => {
  const board = (): GameState => scenario(['Plains'], { defs: DEFS, p1: { battlefield: ['Test Warden', 'Test Goblin', 'Test Bear'] }, p2: { hand: ['Test Zap'], battlefield: ['Plains', 'Plains', 'Plains'] } });
  it('CR 601.2f: targeting the Goblin costs the opponent {2}; targeting the Bear costs nothing', () => {
    const s = pass(board());
    const goblin = find(s, 'Test Goblin', 'battlefield');
    const bear = find(s, 'Test Bear', 'battlefield');
    expect(untappedLands(castBy(s, 'Test Zap', 'p2', { targets: [[obj(goblin)]] }), 'p2')).toBe(1);
    expect(untappedLands(castBy(s, 'Test Zap', 'p2', { targets: [[obj(bear)]] }), 'p2')).toBe(3);
  });
  it('CR 601.2h: without the {2} the opponent cannot target the Goblin', () => {
    const s = pass(tweak(board(), (x) => { for (const id of x.zones.battlefield) if (x.objects[id]!.defId === 'Plains') x.objects[id]!.tapped = true; }));
    expect(casts(s, 'Test Zap', 'p2', { targets: [[obj(find(s, 'Test Goblin', 'battlefield'))]] })).toBe(false);
    expect(casts(s, 'Test Zap', 'p2', { targets: [[obj(find(s, 'Test Bear', 'battlefield'))]] })).toBe(true);
  });
});

describe('CR 602.2b, 601.2f: "Abilities your opponents activate that target a Goblin you control cost {2} more to activate"', () => {
  const board = (): GameState => scenario(['Plains'], { defs: DEFS, p1: { battlefield: ['Test Warden', 'Test Goblin', 'Test Bear'] }, p2: { battlefield: ['Test Pinger', 'Plains', 'Plains'] } });
  const activate = (s: GameState, target: ObjectId): GameState => {
    const pinger = find(s, 'Test Pinger', 'battlefield');
    const a = legal(s, 'p2', 'activate').find((x) => x.object === pinger && !x.isMana);
    if (!a) throw new Error('the pinger is not offered');
    return drive(act(s, a.action), { targets: [[obj(target)]] });
  };
  it('CR 602.2b, 605.1a: targeting the Goblin costs {2} more; targeting the Bear costs only {T}; the lands\' mana abilities (no targets) cost what they did', () => {
    const s = pass(board());
    expect(untappedLands(activate(s, find(s, 'Test Goblin', 'battlefield')), 'p2')).toBe(0);
    expect(untappedLands(activate(s, find(s, 'Test Bear', 'battlefield')), 'p2')).toBe(2);
  });
});

describe('CR 303.4, 601.2f: "Aura spells you cast that target enchanted creature cost {3} less to cast"', () => {
  /** The Charm is cast for {0} and enchants the Bear (CR 303.4a); then p1 holds the Mantle, with no lands. */
  const board = (): GameState => {
    const s = scenario(['Plains'], { defs: DEFS, p1: { hand: ['Test Mantle', 'Test Strong Charm'], battlefield: ['Test Bear', 'Test Goblin'] } });
    let t = castBy(s, 'Test Strong Charm', 'p1', { targets: [[obj(find(s, 'Test Bear', 'battlefield'))]] });
    for (let i = 0; i < 6 && t.zones.stack.length > 0; i++) t = pass(pass(t));
    return t;
  };
  it('CR 303.4: an Aura spell targeting the enchanted Bear costs {0}; targeting the Goblin it costs {3}, which p1 cannot pay', () => {
    const s = board();
    expect(casts(s, 'Test Mantle', 'p1', { targets: [[obj(find(s, 'Test Bear', 'battlefield'))]] })).toBe(true);
    expect(casts(s, 'Test Mantle', 'p1', { targets: [[obj(find(s, 'Test Goblin', 'battlefield'))]] })).toBe(false);
  });
});
