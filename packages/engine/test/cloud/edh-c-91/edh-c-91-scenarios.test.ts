/**
 * Commander lane edh-c, round edh-c-91 (EDHREC ranks 25,501-26,000, third pass): the round's readings played through the engine with synthetic cards (invented names), compiled by the game's
 * default compiler, in 4-player games (Alice p1 is the active player of turn 1). Each test is named after the rule it checks, with its negative case. CR cites checked against the
 * Comprehensive Rules of 2026-09-25 (media.wizards.com).
 *
 *   CR 614.1c, 601.2h       "~ enters with two +1/+1 counters on it for each color of mana spent to cast it." (zero colors when it was not cast)
 *   CR 700.8, 601.2f, 602.2b "This ability costs {1} less to activate for each creature in your party."
 *   CR 701.43a, 602.2b      "{T}, Exert ~: It deals 1 damage to target creature."
 *   CR 118.12, 603.2        "Whenever a player casts a spell, that player may pay {2}. If the player does, they draw a card."
 *   CR 702.33d, 601.2, 603.2 "Whenever a player kicks a spell, you create a 1/1 Saproling token."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, answer, find, pass, reject } from '../../m3/scenario';
import { drive, mpScenario, resolveStack } from '../../m12/rules/helpers';
import { exertedThisTurn } from '../../../src/rules/history';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}', colors: string[] = []): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });

interface Opts { targets?: TargetChoice[][]; answers?: DecisionAnswer[] }
/** Answer what comes up: targets, then the answers; pay costs automatically; stop at priority. */
function settle(s0: GameState, o: Opts): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets' && o.targets && o.targets.length > 0) s = answer(s, { kind: 'chooseTargets', targets: o.targets.shift()! });
    else if (o.answers && o.answers.length > 0) s = answer(s, o.answers.shift()!);
    else break;
  }
  return s;
}
const queued = (o: Opts): Opts => ({ targets: [...(o.targets ?? [])], answers: [...(o.answers ?? [])] });
function drain(s0: GameState, o: Opts): GameState {
  let s = s0;
  for (let guard = 0; s.pending?.kind === 'priority' && s.zones.stack.length > 0 && guard < 60; guard++) s = settle(pass(s), o);
  return s;
}
/** The player casts a card from their hand, answers what is asked, and lets the stack resolve. */
function cast(s0: GameState, name: string, opts: Opts = {}, player = 'p1'): GameState {
  const q = queued(opts);
  return drain(settle(act(s0, { type: 'cast', player, card: find(s0, name, 'hand', player) } as never), q), q);
}
const stat = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const handSize = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;

describe('CR 614.1c, 601.2h: "~ enters with two +1/+1 counters on it for each color of mana spent to cast it."', () => {
  const VINE = card('Test Prism Vine', 'Creature — Plant', 'Converge — This creature enters with two +1/+1 counters on it for each color of mana spent to cast it.', ['1', '1'], '{1}{G}{W}', ['G', 'W']);
  const RAISE = card('Test Raise Dead', 'Sorcery', 'Return target creature card from your graveyard to the battlefield.');
  it('is automated', () => expect(full(VINE)).toBe(true));
  it('three colors of mana spent: six counters', () => {
    const s0 = mpScenario({ cards: ['Forest', 'Mountain'], defs: [VINE], zones: { p1: { hand: ['Test Prism Vine'], battlefield: ['Forest', 'Plains', 'Mountain'] } } });
    const s = cast(s0, 'Test Prism Vine');
    expect(stat(s, find(s, 'Test Prism Vine', 'battlefield', 'p1'))).toBe('7/7');
  });
  it('two colors of mana spent (a second Forest pays the generic part): four counters', () => {
    const s0 = mpScenario({ cards: ['Forest'], defs: [VINE], zones: { p1: { hand: ['Test Prism Vine'], battlefield: ['Forest', 'Forest', 'Plains'] } } });
    const s = cast(s0, 'Test Prism Vine');
    expect(stat(s, find(s, 'Test Prism Vine', 'battlefield', 'p1'))).toBe('5/5');
  });
  it('put onto the battlefield without being cast: no mana was spent, no counters (rulings 2021-06-18)', () => {
    const s0 = mpScenario({ defs: [VINE, RAISE], zones: { p1: { hand: ['Test Raise Dead'], graveyard: ['Test Prism Vine'] } } });
    const s = cast(s0, 'Test Raise Dead', { targets: [[obj(find(s0, 'Test Prism Vine', 'graveyard', 'p1'))]] });
    expect(stat(s, find(s, 'Test Prism Vine', 'battlefield', 'p1'))).toBe('1/1');
  });
});

describe('CR 700.8, 601.2f, 602.2b: "This ability costs {1} less to activate for each creature in your party."', () => {
  const HUNTER = card('Test Reef Hunter', 'Creature — Merfolk', '{4}{U}: This creature gets +1/+0 until end of turn. This ability costs {1} less to activate for each creature in your party.', ['1', '1']);
  const CLERIC = card('Test Cleric', 'Creature — Human Cleric', '', ['1', '1']);
  const ROGUE = card('Test Rogue', 'Creature — Human Rogue', '', ['1', '1']);
  const CLERIC2 = card('Test Cleric Two', 'Creature — Human Cleric', '', ['1', '1']);
  const base = (extra: string[]) => mpScenario({ cards: ['Island'], defs: [HUNTER, CLERIC, ROGUE, CLERIC2], zones: { p1: { battlefield: ['Test Reef Hunter', 'Island', 'Island', 'Island', ...extra] } } });
  const activate = (s: GameState): GameState => settle(act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Reef Hunter', 'battlefield', 'p1'), ability: 'p:0:0' }), {});
  it('is automated', () => expect(full(HUNTER)).toBe(true));
  it('a party of two (a Cleric and a Rogue) makes it {2}{U}: three Islands pay it', () => {
    const s0 = base(['Test Cleric', 'Test Rogue']);
    const s = drain(activate(s0), {});
    expect(stat(s, find(s, 'Test Reef Hunter', 'battlefield', 'p1'))).toBe('2/1');
  });
  it('two Clerics are one party member (a creature counts for one role only): {3}{U}, three Islands are not enough', () => {
    const s0 = base(['Test Cleric', 'Test Cleric Two']);
    expect(reject(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Reef Hunter', 'battlefield', 'p1'), ability: 'p:0:0' }).message).toMatch(/can't pay/);
  });
  it('no party: the full {4}{U} is needed', () => {
    const s0 = base([]);
    expect(reject(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Reef Hunter', 'battlefield', 'p1'), ability: 'p:0:0' }).message).toMatch(/can't pay/);
  });
});

describe('CR 701.43a, 602.2b: "{T}, Exert ~: It deals 1 damage to target creature."', () => {
  const MAGE = card('Test Spark Mage', 'Creature — Human Wizard', '{T}, Exert this creature: It deals 1 damage to target creature.', ['1', '1']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  it('is automated', () => expect(full(MAGE)).toBe(true));
  it('taps and exerts the creature itself and it deals the damage', () => {
    const s0 = mpScenario({ defs: [MAGE, BEAR], zones: { p1: { battlefield: ['Test Spark Mage'] }, p2: { battlefield: ['Test Bear'] } } });
    const mage = find(s0, 'Test Spark Mage', 'battlefield', 'p1');
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    // summoning sickness: the mage was put onto the battlefield by the scenario at the start of turn 1; the {T} cost needs it under control since the turn began
    const s1 = drain(settle(act(s0, { type: 'activate', player: 'p1', source: mage, ability: 'p:0:0' }), { targets: [[obj(bear)]] }), {});
    expect(s1.objects[bear]!.damage).toBe(1);
    expect(s1.objects[mage]!.tapped).toBe(true);
    expect(exertedThisTurn(s1, mage)).toBe(true);
  });
});

describe('CR 118.12, 603.2, 608.2c: "Whenever a player casts a spell, that player may pay {2}. If the player does, they draw a card."', () => {
  const THEORY = card('Test Study Rule', 'Enchantment', 'Whenever a player casts a spell, that player may pay {2}. If the player does, they draw a card.');
  const SPELL = card('Test Cantrip', 'Instant', 'You gain 1 life.');
  const lib = (s: GameState, p: PlayerId): number => s.zones.library[p]!.length;
  it('is automated', () => expect(full(THEORY)).toBe(true));
  const casterPays = (answers: DecisionAnswer[]): { s0: GameState; s: GameState } => {
    const s0 = mpScenario({ defs: [THEORY, SPELL], zones: { p1: { hand: ['Test Cantrip'], battlefield: ['Plains', 'Plains'] }, p2: { battlefield: ['Test Study Rule'] } } });
    const s = resolveStack(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Cantrip', 'hand', 'p1') } as never), answers), answers);
    return { s0, s };
  };
  it('the caster pays {2}: the CASTER draws (not the controller of the enchantment)', () => {
    const { s0, s } = casterPays([{ kind: 'yesNo', yes: true } as never]);
    expect(lib(s, 'p1')).toBe(lib(s0, 'p1') - 1);
    expect(lib(s, 'p2')).toBe(lib(s0, 'p2'));
    expect(handSize(s, 'p1')).toBe(handSize(s0, 'p1')); // the spell left the hand, one card was drawn
  });
  it('the caster declines to pay: nobody draws', () => {
    const { s0, s } = casterPays([{ kind: 'yesNo', yes: false } as never]);
    expect(lib(s, 'p1')).toBe(lib(s0, 'p1'));
    expect(lib(s, 'p2')).toBe(lib(s0, 'p2'));
    expect(handSize(s, 'p1')).toBe(handSize(s0, 'p1') - 1);
  });
});

describe('CR 702.33d, 601.2, 603.2: "Whenever a player kicks a spell, you create a 1/1 green Saproling creature token."', () => {
  const INFEST = card('Test Spore Cult', 'Enchantment', 'Whenever a player kicks a spell, you create a 1/1 green Saproling creature token.');
  const KICKER = card('Test Kicked Bolt', 'Instant', 'Kicker {1}\nYou gain 1 life.');
  const PLAIN = card('Test Plain Bolt', 'Instant', 'You gain 1 life.');
  const saprolings = (s: GameState, p: PlayerId): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && /Saproling/.test(s.defs[s.objects[id]!.defId]!.name)).length;
  it('is automated', () => expect(full(INFEST)).toBe(true));
  it('a spell cast with its kicker paid triggers it, whoever casts it; a spell cast without kicker does not', () => {
    const yes = { kind: 'yesNo', yes: true } as never;
    const no = { kind: 'yesNo', yes: false } as never;
    const mk = () => mpScenario({ defs: [INFEST, KICKER, PLAIN], zones: { p1: { hand: ['Test Kicked Bolt'], battlefield: ['Plains', 'Plains'] }, p2: { battlefield: ['Test Spore Cult'], hand: ['Test Plain Bolt'] } } });
    const start = (name: string, answers: DecisionAnswer[]): GameState => { const s0 = mk(); return resolveStack(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') } as never), answers), answers); };
    const unkicked = start('Test Kicked Bolt', [no]);
    expect(saprolings(unkicked, 'p2')).toBe(0);
    const kicked = start('Test Kicked Bolt', [yes]);
    expect(saprolings(kicked, 'p2')).toBe(1); // p1 kicked it; p2 controls the enchantment, so p2 ("you") makes the token
    expect(saprolings(kicked, 'p1')).toBe(0);
  });
});
