/**
 * Commander lane edh-c, round edh-c-64 (EDHREC ranks 20,501-21,000, second pass): the round's readings played through the engine with synthetic cards (invented names), compiled by
 * the game's default compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case. CR cites checked against the
 * Comprehensive Rules of 2026-09-25 (see the round's record).
 *
 *   CR 110.1, 400.7j, 122.1     "Return target creature or Vehicle card from your graveyard to the battlefield. Then put two +1/+1 counters on that permanent if you control an artifact and an enchantment." (Okiba Salvage)
 *   CR 601.2i, 603.2            "Whenever you cast a Doctor spell or creature spell with doctor's companion, draw a card." (Rose Noble)
 *   CR 603.2c, 406.1           "Whenever one or more cards are put into exile during your turn, put a +1/+1 counter on ~. This ability triggers only once each turn." (Stonebinder's Familiar)
 *   CR 702.33d, 614.1c, 122.6   "If this creature was kicked, it enters with three additional time counters on it." (Ravaging Riftwurm)
 *   CR 608.2d, 121.1, 603.4     "You may draw an additional card if ~ is enchanted." (Rayne, Academy Chancellor)
 *   CR 701.20a, 111.1, 608.2h   "Each player reveals the top card of their library. For each nonland card revealed this way, you create a 1/1 ... Then each player draws a card." (Rousing of Souls)
 *   CR 701.40a, 608.2c          "Manifest the top card of your library, then put X +1/+1 counters on it." (Wildcall)
 */
import { describe, expect, it } from 'vitest';
import { getChars, type GameState, type ObjectId } from '../../../src/index';
import { act, card, cast, find, full, lifeOf, obj, resolveAll, scenario } from '../r3-cost/support';
import { pass } from '../../m3/scenario';
import { tweak } from '../../m4/helpers';

const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['3', '3']);
const GOBLIN = card('Test Goblin', 'Creature — Goblin', '', '{0}', ['2', '2']);
const TRINKET = card('Test Trinket', 'Artifact', '', '{0}');
const RUNE = card('Test Rune', 'Enchantment', '', '{0}');
const handCount = (s: GameState, owner: string): number => Object.values(s.objects).filter((o) => o.zone === 'hand' && o.owner === owner).length;
const counters = (s: GameState, id: ObjectId, kind: string): number => s.objects[id]!.counters[kind] ?? 0;

const SALVAGE = card('Test Salvage', 'Sorcery', 'Return target creature or Vehicle card from your graveyard to the battlefield. Then put two +1/+1 counters on that permanent if you control an artifact and an enchantment.');
describe('CR 110.1, 400.7j, 122.1: "Return target creature or Vehicle card from your graveyard to the battlefield. Then put two +1/+1 counters on that permanent if you control an artifact and an enchantment." (Okiba Salvage)', () => {
  const game = (bf: string[]) => scenario([], { defs: [SALVAGE, BEAR, TRINKET, RUNE], p1: { hand: ['Test Salvage'], graveyard: ['Test Bear'], battlefield: bf } });
  const play = (bf: string[]) => { const s0 = game(bf); return resolveAll(cast(s0, 'Test Salvage', { targets: [[obj(find(s0, 'Test Bear', 'graveyard', 'p1'))]] })); };
  it('is automated', () => { expect(full(SALVAGE)).toBe(true); });
  it('with an artifact and an enchantment the returned creature gets two +1/+1 counters', () => {
    const s = play(['Test Trinket', 'Test Rune']);
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    expect(counters(s, bear, '+1/+1')).toBe(2);
    expect(Number(getChars(s, bear)!.power)).toBe(5);
  });
  it('negative: with only an artifact, or only an enchantment, or neither, the creature returns without counters', () => {
    for (const bf of [['Test Trinket'], ['Test Rune'], []]) {
      const s = play(bf);
      expect(counters(s, find(s, 'Test Bear', 'battlefield', 'p1'), '+1/+1')).toBe(0);
    }
  });
});

const NOBLE = card('Test Noble', 'Creature — Human', 'Whenever you cast a Doctor spell or creature spell with flying, draw a card.');
const DOCTOR = card('Test Doctor', 'Creature — Time Lord Doctor', '', '{0}', ['1', '1']);
const FLYER = card('Test Flyer', 'Creature — Bird', 'Flying', '{0}', ['1', '1']);
describe('CR 601.2i, 603.2: "Whenever you cast a Doctor spell or creature spell with <quality>, draw a card." (Rose Noble: the second description without its article)', () => {
  const game = () => scenario([], { defs: [NOBLE, DOCTOR, FLYER, BEAR], p1: { hand: ['Test Doctor', 'Test Flyer', 'Test Bear'], battlefield: ['Test Noble'] } });
  const after = (name: string) => { const s0 = game(); const s = resolveAll(cast(s0, name)); return handCount(s, 'p1') - (handCount(s0, 'p1') - 1); };
  it('is automated', () => { expect(full(NOBLE)).toBe(true); });
  it('casting a Doctor spell draws a card; so does a creature spell with the quality', () => {
    expect(after('Test Doctor')).toBe(1);
    expect(after('Test Flyer')).toBe(1);
  });
  it('negative: a creature spell without the quality draws nothing; an opponent casting a Doctor draws nothing for you', () => {
    expect(after('Test Bear')).toBe(0);
    const TRICK = card('Test Trick', 'Instant — Doctor', '');
    const s0 = scenario([], { defs: [NOBLE, TRICK], p1: { battlefield: ['Test Noble'] }, p2: { hand: ['Test Trick'] } });
    const s = resolveAll(cast(pass(s0), 'Test Trick', {}, 'p2'));
    expect(handCount(s, 'p1')).toBe(handCount(s0, 'p1'));
  });
});

const FAMILIAR = card('Test Familiar', 'Creature — Spirit Dog', 'Whenever one or more cards are put into exile during your turn, put a +1/+1 counter on ~. This ability triggers only once each turn.', '{0}', ['1', '1']);
const BANISH = card('Test Banish', 'Instant', 'Exile target creature an opponent controls.');
const SMITE = card('Test Smite', 'Sorcery', 'Destroy target creature an opponent controls.');
describe('CR 603.2c, 406.1: "Whenever one or more cards are put into exile during your turn, put a +1/+1 counter on ~. This ability triggers only once each turn." (Stonebinder\'s Familiar)', () => {
  const game = () => scenario([], { defs: [FAMILIAR, BANISH, SMITE, BEAR, GOBLIN], p1: { hand: ['Test Banish', 'Test Banish', 'Test Smite'], battlefield: ['Test Familiar'] }, p2: { battlefield: ['Test Bear', 'Test Goblin'] } });
  const exile = (s: GameState, victim: string) => resolveAll(cast(s, 'Test Banish', { targets: [[obj(find(s, victim, 'battlefield', 'p2'))]] }));
  it('is automated', () => { expect(full(FAMILIAR)).toBe(true); });
  it('a card put into exile on your turn (cast during it) gives a counter; a second exile the same turn gives none (once each turn)', () => {
    const s1 = exile(game(), 'Test Bear');
    const fam = find(s1, 'Test Familiar', 'battlefield', 'p1');
    expect(counters(s1, fam, '+1/+1')).toBe(1);
    const s2 = exile(s1, 'Test Goblin');
    expect(counters(s2, fam, '+1/+1')).toBe(1);
  });
  it('negative: a token put into exile is not a card', () => {
    const s0 = game();
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    const tok = tweak(s0, (t) => { t.objects[bear]!.kind = 'token'; });
    const a = resolveAll(cast(tok, 'Test Banish', { targets: [[obj(bear)]] }));
    expect(counters(a, find(a, 'Test Familiar', 'battlefield', 'p1'), '+1/+1')).toBe(0);
  });
  it('negative: a card put into a graveyard is not put into exile', () => {
    const s0 = game();
    const s = resolveAll(cast(s0, 'Test Smite', { targets: [[obj(find(s0, 'Test Bear', 'battlefield', 'p2'))]] }));
    expect(counters(s, find(s, 'Test Familiar', 'battlefield', 'p1'), '+1/+1')).toBe(0);
  });
});

const WURM = card('Test Wurm', 'Creature — Wurm', 'Kicker {1}\nVanishing 2\nIf this creature was kicked, it enters with three additional time counters on it.', '{0}', ['3', '3']);
describe('CR 702.33d, 614.1c, 122.6: "If this creature was kicked, it enters with three additional time counters on it." (Ravaging Riftwurm: besides the two of vanishing)', () => {
  const play = (kicked: boolean) => { const s0 = scenario([], { defs: [WURM], p1: { hand: ['Test Wurm'], battlefield: ['Plains'] } }); return resolveAll(cast(s0, 'Test Wurm', { yes: [kicked] })); };
  it('is automated', () => { expect(full(WURM)).toBe(true); });
  it('kicked, it enters with the two time counters of vanishing and three more', () => {
    const s = play(true);
    expect(counters(s, find(s, 'Test Wurm', 'battlefield', 'p1'), 'time')).toBe(5);
  });
  it('negative: not kicked, only the two time counters of vanishing', () => {
    const s = play(false);
    expect(counters(s, find(s, 'Test Wurm', 'battlefield', 'p1'), 'time')).toBe(2);
  });
});

const RAYNE = card('Test Rayne', 'Creature — Wizard', 'Whenever you or a permanent you control becomes the target of a spell or ability an opponent controls, you may draw a card. You may draw an additional card if this creature is enchanted.', '{0}', ['1', '1']);
const VEIL = card('Test Veil', 'Enchantment — Aura', 'Enchant creature');
const ZAP = card('Test Zap', 'Instant', 'Test Zap deals 1 damage to target creature.');
describe('CR 608.2d, 121.1, 603.4: "You may draw an additional card if ~ is enchanted." (Rayne, Academy Chancellor)', () => {
  const play = (enchanted: boolean, yes: boolean[]) => {
    const s0 = scenario([], { defs: [RAYNE, VEIL, ZAP, BEAR], p1: { hand: ['Test Veil'], battlefield: ['Test Rayne'] }, p2: { hand: ['Test Zap'] } });
    const rayne = find(s0, 'Test Rayne', 'battlefield', 'p1');
    const s1 = enchanted ? resolveAll(cast(s0, 'Test Veil', { targets: [[obj(rayne)]] })) : s0;
    const passed = pass(s1); // Alice passes: Bob has priority in her main phase
    const cast2 = cast(passed, 'Test Zap', { targets: [[obj(rayne)]] }, 'p2');
    return { before: handCount(s1, 'p1'), after: handCount(resolveAll(cast2, { yes }), 'p1') };
  };
  it('is automated', () => { expect(full(RAYNE)).toBe(true); });
  it('enchanted: both draws are offered (two cards); not enchanted: only the first (one card)', () => {
    const a = play(true, [true, true]);
    expect(a.after - a.before).toBe(2);
    const b = play(false, [true, true]);
    expect(b.after - b.before).toBe(1);
  });
  it('negative: both draws are optional', () => {
    const a = play(true, [false, false]);
    expect(a.after - a.before).toBe(0);
    const b = play(true, [true, false]);
    expect(b.after - b.before).toBe(1);
    const c = play(true, [false, true]);
    expect(c.after - c.before).toBe(1);
  });
});

const ROUSING = card('Test Rousing', 'Sorcery', 'Parley — Each player reveals the top card of their library. For each nonland card revealed this way, you create a 1/1 white Spirit creature token with flying. Then each player draws a card.');
describe('CR 701.20a, 111.1, 608.2h: "Each player reveals the top card of their library. For each nonland card revealed this way, you create a 1/1 white Spirit creature token with flying. Then each player draws a card." (Rousing of Souls)', () => {
  const play = (p1Top: string, p2Top: string) => { const s0 = scenario([], { defs: [ROUSING, BEAR, GOBLIN], p1: { hand: ['Test Rousing'], library: [p1Top] }, p2: { library: [p2Top] } }); return { s0, s: resolveAll(cast(s0, 'Test Rousing')) }; };
  const spirits = (s: GameState) => Object.values(s.objects).filter((o) => o.zone === 'battlefield' && o.kind === 'token' && o.controller === 'p1').length;
  it('is automated', () => { expect(full(ROUSING)).toBe(true); });
  it('counts the nonland cards revealed by every player (both nonland: two Spirits, all for you) and each player draws', () => {
    const { s0, s } = play('Test Bear', 'Test Goblin');
    expect(spirits(s)).toBe(2);
    expect(handCount(s, 'p1')).toBe(handCount(s0, 'p1') - 1 + 1);
    expect(handCount(s, 'p2')).toBe(handCount(s0, 'p2') + 1);
  });
  it('negative: lands make no Spirit (one nonland: one Spirit; two lands: none)', () => {
    expect(spirits(play('Test Bear', 'Plains').s)).toBe(1);
    expect(spirits(play('Plains', 'Plains').s)).toBe(0);
  });
});

const WILDCALL = card('Test Wildcall', 'Sorcery', 'Manifest the top card of your library, then put X +1/+1 counters on it.', '{X}');
describe('CR 701.40a, 608.2c, 122.1: "Manifest the top card of your library, then put X +1/+1 counters on it." (Wildcall)', () => {
  const play = (x: number) => { const s0 = scenario([], { defs: [WILDCALL, BEAR], p1: { hand: ['Test Wildcall'], battlefield: ['Plains', 'Plains', 'Plains'], library: ['Test Bear'] } }); return resolveAll(cast(s0, 'Test Wildcall', { x: [x] })); };
  const manifested = (s: GameState): ObjectId => Object.values(s.objects).find((o) => o.zone === 'battlefield' && o.faceDown && o.controller === 'p1')!.id;
  it('is automated', () => { expect(full(WILDCALL)).toBe(true); });
  it('the top card becomes a face-down 2/2 and gets X +1/+1 counters (X = 3: a 5/5)', () => {
    const s = play(3);
    const m = manifested(s);
    expect(counters(s, m, '+1/+1')).toBe(3);
    expect(Number(getChars(s, m)!.power)).toBe(5);
  });
  it('negative: X = 0 puts no counters on the manifested card', () => {
    const s = play(0);
    expect(counters(s, manifested(s), '+1/+1')).toBe(0);
  });
});
