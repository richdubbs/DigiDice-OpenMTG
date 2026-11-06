/**
 * Must-finish round edh-next-140 (group "mana-costs"): the behaviour it added, played through the engine with synthetic cards (invented names, the printed wordings of the real
 * cards), compiled by the game's default compiler, in four-player games.
 *
 *   CR 700.5, 700.5a, 613.1, 702.26b   Altar of the Pantheon: "Your devotion to each color and each combination of colors is increased by one." (rulings 2020-01-24: a devotion to two
 *                                      colors is increased by one, not two; the bonus stays when the Altar loses its abilities)
 *   CR 603.7, 603.7a, 505.1a, 608.2h,   Plasm Capture: "Counter target spell. At the beginning of your next first main phase, add X mana in any combination of colors, where X is that
 *   202.3b, 106.1b                      spell's mana value." (rulings 2013-04-15: the X of the countered spell counts; only your precombat main phase)
 *   CR 613.1f, 611.2c, 608.2h, 609.4b,  Quicksilver Elemental: "{U}: This creature gains all activated abilities of target creature until end of turn." and "You may spend blue mana as
 *   602.2b                              though it were mana of any color to pay the activation costs of this creature's abilities." (rulings 2004-12-01: only activated abilities, any
 *                                       creature it can target, the gained abilities say "this permanent"; 2004-10-04: several activations collect several sets)
 *   CR 106.12, 614.1a, 616.1, 106.1b     Contamination: "If a land is tapped for mana, it produces {B} instead of any other type and amount." (rulings 2004-10-04: a replacement effect;
 *                                       other effects that add more mana still do; one that multiplies the land's mana affects color, not amount)
 *   CR 105.1, 105.3, 608.2d, 613.1e     Scuttlemutt: "{T}: Target creature becomes the color or colors of your choice until end of turn." (rulings 2019-07-12: one or more of the five
 *                                       colors; only those colors, the earlier ones overwritten)
 *   CR 113.6k, 603.2, 122.1, 122.8,      Mutated Cultist: "When you cast this spell, remove all counters from up to one target permanent or opponent. The next spell you cast this turn costs
 *   601.2f, 118.7                        {1} less to cast for each counter removed this way." (rulings 2024-06-07: the trigger resolves first; any permanent or an opponent, never you; every
 *                                        kind of counter, poison included)
 *   CR 303.4f, 303.4g, 614.1c, 613.1d,   Harold and Bob, First Numens: "When Harold and Bob dies, if it was a creature, return it to the battlefield. It's an Aura enchantment with enchant
 *   613.1f, 603.10a, 122.1               Forest you control and "Enchanted Forest has '{T}: Add three mana of any one color. You get two rad counters.'" Harold and Bob loses all other
 *                                        abilities." (rulings 2024-03-08: you choose the Forest as it returns; nothing to enchant, it stays in the graveyard; an Aura enchantment with no other
 *                                        types or subtypes, its name, colors and supertypes kept)
 *   CR 702.140d, 730.2, 601.2c, 107.3,   Archipelagore: "Whenever this creature mutates, tap up to X target creatures, where X is the number of times this creature has mutated. Those
 *   502.3                                creatures don't untap during their controller's next untap step." (ruling 2020-04-17: a tapped creature may be targeted; it then doesn't untap)
 *   CR 605.3b, 608.2c, 119.3            Altar of the Pantheon: "{T}: Add one mana of any color. If you control a God, a Demigod, or a legendary enchantment, you gain 1 life." (ruling
 *                                      2020-01-24: 1 life however many of them; a mana ability, no stack)
 */
import { describe, expect, it } from 'vitest';
import { activatedAbilities } from '../../../src/rules/abilities';
import { applyAction, compileCard, getChars, type OracleCard, type DecisionAnswer, type GameState, type ObjectId, type PlayerId } from '../../../src/index';
import { act as mact, answer as manswer, mpScenario, pass as mpass } from '../../m12/rules/helpers';
import { card, full } from '../cmd3/helpers';
import { Game } from '../../../src/core/game';
import { activateManaAbility } from '../../../src/rules/mana';
import { mutate as mutateCast, table as mutateTable, ELVES, BEARS } from '../../m6/mutate/support';

const bf = (s: GameState, defId: string, p?: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === defId && (p === undefined || s.objects[id]!.controller === p));
const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;

interface Script { optionIds?: (options: { id: string; label: string }[], prompt: string, min: number, max: number) => string[]; colors?: string[]; stopAt?: (s: GameState) => boolean; number?: number; targets?: ObjectId[]; yes?: (prompt: string) => boolean; option?: (options: { id: string; label: string }[], prompt: string) => string; objects?: (options: ObjectId[], prompt: string, s: GameState) => ObjectId[]; until?: (s: GameState) => boolean }
/** Answers whatever is asked, from the script, and passes priority until the stack is empty (or `until` holds). */
export function run(s0: GameState, sc: Script = {}): GameState {
  let s = s0;
  const targets = [...(sc.targets ?? [])];
  for (let i = 0; i < 400; i++) {
    const p = s.pending;
    if (p === null || p === undefined || s.result) break;
    let a: DecisionAnswer | undefined;
    const d = p as unknown as { min?: number; max?: number; prompt: string; player: PlayerId };
    if (p.kind === 'chooseTargets') {
      const t = p as unknown as { objects?: ObjectId[]; min?: number };
      const next = targets.shift();
      a = { kind: 'chooseTargets', targets: next !== undefined ? [/^p\d$/.test(next) ? { kind: 'player', id: next } : { kind: 'object', id: next }] : (t.objects ?? []).slice(0, t.min ?? 0).map((id) => ({ kind: 'object' as const, id })) } as DecisionAnswer;
    } else if (p.kind === 'payCost') a = { kind: 'payCost', auto: true };
    else if (p.kind === 'yesNo') a = { kind: 'yesNo', yes: sc.yes ? sc.yes(d.prompt) : true };
    else if (p.kind === 'chooseObjects') {
      const o = (p as unknown as { options: ObjectId[] }).options;
      a = { kind: 'chooseObjects', ids: sc.objects ? sc.objects(o, d.prompt, s) : o.slice(0, d.min ?? 0) };
    } else if (p.kind === 'chooseOption') {
      const o = (p as unknown as { options: { id: string; label: string }[] }).options;
      a = { kind: 'chooseOption', ids: sc.optionIds ? sc.optionIds(o, d.prompt, d.min ?? 1, d.max ?? 1) : [sc.option ? sc.option(o, d.prompt) : o[0]!.id] };
    } else if (p.kind === 'chooseNumber') a = { kind: 'chooseNumber', n: sc.number ?? d.min ?? 0 } as DecisionAnswer;
    else if (p.kind === 'order') a = { kind: 'order', ids: (p as unknown as { items: { id: string }[] }).items.map((x) => x.id) };
    else if (p.kind === 'chooseColor') { const o = (p as unknown as { options: string[] }).options; const c = o.includes('U') ? 'U' : o[0]!; sc.colors?.push(c); a = { kind: 'chooseColor', color: c } as DecisionAnswer; }
    else if (p.kind === 'declareAttackers') a = { kind: 'declareAttackers', attacks: [] } as DecisionAnswer;
    else if (p.kind === 'declareBlockers') a = { kind: 'declareBlockers', blocks: [] };
    else if (p.kind === 'priority') { if (sc.stopAt?.(s) === true) break; if (s.zones.stack.length === 0 && (sc.until === undefined || sc.until(s))) break; s = mpass(s); continue; }
    else throw new Error(`unexpected ${p.kind}: ${p.prompt}`);
    s = manswer(s, a);
  }
  return s;
}

const ALTAR_TEXT = 'Your devotion to each color and each combination of colors is increased by one.\n{T}: Add one mana of any color. If you control a God, a Demigod, or a legendary enchantment, you gain 1 life.';

describe('edh-next-140: Altar of the Pantheon (CR 700.5, 605.3b)', () => {
  const ALTAR = card('Test Pantheon Altar', 'Artifact', ALTAR_TEXT, undefined, '{3}');
  const GOD = card('Test Tide God', 'Legendary Enchantment Creature — God', 'Indestructible\nAs long as your devotion to blue is less than five, Test Tide God isn\'t a creature.', ['5', '5'], '{3}{U}');
  const ADEPT = card('Test Tide Adept', 'Creature — Merfolk Wizard', '', ['2', '2'], '{U}{U}{U}');
  const DUO = card('Test Duo Mystic', 'Creature — Human Wizard', '', ['1', '1'], '{R}{G}');
  const SHRINE = card('Test Devotion Shrine', 'Land', '{T}: Choose a color. Add an amount of mana of that color equal to your devotion to that color.');
  const HARVEST = card('Test Twin Harvest', 'Sorcery', 'You gain life equal to your devotion to red and green.', undefined, '{0}');
  const DEMI = card('Test Field Demigod', 'Enchantment Creature — Demigod', '', ['2', '2'], '{G}');
  const SAGA = card('Test Old Legend', 'Legendary Enchantment', '', undefined, '{1}');
  const RELIC = card('Test Plain Relic', 'Enchantment', '', undefined, '{1}');
  const NULLIFIER = card('Test Rust Field', 'Enchantment', 'Artifacts lose all abilities.', undefined, '{2}');
  const defs = [ALTAR, GOD, ADEPT, DUO, SHRINE, HARVEST, DEMI, SAGA, RELIC, NULLIFIER];

  it('compiles full with the game\'s default compiler (and the synthetic cards it is played with)', () => {
    for (const d of [ALTAR, GOD, SHRINE, HARVEST]) expect(full(d), d.name).toBe(true);
  });

  it('CR 700.5, 613.1: with four blue symbols, a God that needs five is a creature only with the Altar; an opponent\'s Altar adds nothing to your devotion', () => {
    const mine = mpScenario({ defs, zones: { p1: { battlefield: ['Test Tide God', 'Test Tide Adept', 'Test Pantheon Altar'] } } });
    const god = bf(mine, 'Test Tide God')[0]!;
    expect(getChars(mine, god)!.types).toContain('Creature'); // 1 (God) + 3 (Adept) + 1 (Altar) = 5
    const none = mpScenario({ defs, zones: { p1: { battlefield: ['Test Tide God', 'Test Tide Adept'] } } });
    expect(getChars(none, bf(none, 'Test Tide God')[0]!)!.types).not.toContain('Creature'); // 4
    const theirs = mpScenario({ defs, zones: { p1: { battlefield: ['Test Tide God', 'Test Tide Adept'] }, p2: { battlefield: ['Test Pantheon Altar'] } } });
    expect(getChars(theirs, bf(theirs, 'Test Tide God')[0]!)!.types).not.toContain('Creature');
  });

  it('CR 613.1 (ruling 2020-01-24): the Altar keeps adding to your devotion when it loses its abilities; it then has no mana ability', () => {
    const s0 = mpScenario({ defs, zones: { p1: { battlefield: ['Test Tide God', 'Test Tide Adept', 'Test Pantheon Altar', 'Test Rust Field'] } } });
    expect(getChars(s0, bf(s0, 'Test Tide God')[0]!)!.types).toContain('Creature');
    expect(activatedAbilities(s0, s0.objects[bf(s0, 'Test Pantheon Altar')[0]!]!).length).toBe(0);
  });

  it('CR 700.5 (ruling 2020-01-24): a devotion to two colors is increased by one, not two; with no permanent of a color the devotion to it is one', () => {
    const s0 = mpScenario({ defs, zones: { p1: { battlefield: ['Test Duo Mystic', 'Test Pantheon Altar'], hand: ['Test Twin Harvest'] } } });
    const spell = s0.zones.hand['p1']!.find((id) => s0.objects[id]!.defId === 'Test Twin Harvest')!;
    const before = lifeOf(s0, 'p1');
    const s = run(mact(s0, { type: 'cast', player: 'p1', card: spell }));
    expect(lifeOf(s, 'p1') - before).toBe(3); // {R}{G}: 2, plus 1
    // a devotion-counting mana ability: devotion to white (no white symbols) is 1 with the Altar
    const s1 = mpScenario({ defs, zones: { p1: { battlefield: ['Test Devotion Shrine', 'Test Pantheon Altar'] } } });
    const shrine = bf(s1, 'Test Devotion Shrine')[0]!;
    const g = new Game(structuredClone(s1));
    activateManaAbility(g, 'p1', shrine, activatedAbilities(g.s, g.s.objects[shrine]!)[0]!.key, { color: 'W' });
    const pending = g.s.pending as unknown as { kind: string; options?: { id: string }[] } | null;
    let st = g.s;
    if (pending?.kind === 'chooseOption') st = manswer(st, { kind: 'chooseOption', ids: [pending.options!.find((o) => /white|^W$/i.test(o.id))?.id ?? pending.options![0]!.id] } as DecisionAnswer);
    expect(st.players[0]!.manaPool.map((u) => u.type).join('')).toBe('W');
  });

  describe('CR 605.3b, 608.2c: "{T}: Add one mana of any color. If you control a God, a Demigod, or a legendary enchantment, you gain 1 life."', () => {
    const tapAltar = (s0: GameState): GameState => {
      const altar = bf(s0, 'Test Pantheon Altar', 'p1')[0]!;
      const g = new Game(structuredClone(s0));
      activateManaAbility(g, 'p1', altar, activatedAbilities(g.s, g.s.objects[altar]!).find((a) => a.def.kind === 'activated')!.key, { color: 'G' });
      return g.s;
    };
    for (const [what, perm, gain] of [['a God', 'Test Tide God', 1], ['a Demigod', 'Test Field Demigod', 1], ['a legendary enchantment', 'Test Old Legend', 1], ['a nonlegendary enchantment only', 'Test Plain Relic', 0]] as const) {
      it(`with ${what}: the mana, and ${gain} life`, () => {
        const s0 = mpScenario({ defs, zones: { p1: { battlefield: ['Test Pantheon Altar', perm] } } });
        const s = tapAltar(s0);
        expect(s.players[0]!.manaPool.map((u) => u.type).join('')).toBe('G');
        expect(lifeOf(s, 'p1') - lifeOf(s0, 'p1')).toBe(gain);
        expect(s.zones.stack.length).toBe(0); // a mana ability: no stack (CR 605.3a)
      });
    }
    it('ruling 2020-01-24: 1 life however many of them you control; an opponent\'s God does not count', () => {
      const s0 = mpScenario({ defs, zones: { p1: { battlefield: ['Test Pantheon Altar', 'Test Tide God', 'Test Field Demigod', 'Test Old Legend'] } } });
      expect(lifeOf(tapAltar(s0), 'p1') - lifeOf(s0, 'p1')).toBe(1);
      const s1 = mpScenario({ defs, zones: { p1: { battlefield: ['Test Pantheon Altar'] }, p2: { battlefield: ['Test Tide God'] } } });
      expect(lifeOf(tapAltar(s1), 'p1') - lifeOf(s1, 'p1')).toBe(0);
    });
  });
});

describe('edh-next-140: Plasm Capture (CR 603.7a, 505.1a, 608.2h)', () => {
  const CAPTURE = card('Test Plasm Snare', 'Instant', 'Counter target spell. At the beginning of your next first main phase, add X mana in any combination of colors, where X is that spell\'s mana value.', undefined, '{0}');
  const BLAST = card('Test Sun Blast', 'Sorcery', 'Test Sun Blast deals X damage to target player.', undefined, '{X}{W}');
  const defs = [CAPTURE, BLAST];
  it('compiles full', () => { expect(full(CAPTURE)).toBe(true); expect(full(BLAST)).toBe(true); });

  /** p1 casts the X spell (X = 3) with four Plains, then counters it with the instant. */
  const play = (): GameState => {
    const s0 = mpScenario({ defs, zones: { p1: { battlefield: ['Plains', 'Plains', 'Plains', 'Plains'], hand: ['Test Sun Blast', 'Test Plasm Snare'] } } });
    const blast = s0.zones.hand['p1']!.find((id) => s0.objects[id]!.defId === 'Test Sun Blast')!;
    let s = run(mact(s0, { type: 'cast', player: 'p1', card: blast }), { number: 3, targets: ['p2'], stopAt: (x) => x.zones.stack.length > 0 && x.pending?.player === 'p1' });
    expect(s.zones.stack.length).toBe(1);
    const snare = s.zones.hand['p1']!.find((id) => s.objects[id]!.defId === 'Test Plasm Snare')!;
    const spellOnStack = s.zones.stack[0]!;
    s = mact(s, { type: 'cast', player: 'p1', card: snare });
    s = run(s, { targets: [spellOnStack] });
    return s;
  };
  const pool = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.manaPool.length;

  it('rulings 2013-04-15: the spell is countered; at the beginning of your NEXT precombat main phase you add its mana value with X (3 + 1 = 4) in any combination of colors', () => {
    let s = play();
    expect(s.zones.graveyard['p1']!.some((id) => s.objects[id]!.defId === 'Test Sun Blast')).toBe(true);
    expect(pool(s, 'p1')).toBe(0); // not this main phase
    // this turn's second main phase: nothing (only a first main phase, CR 505.1a)
    s = run(s, { until: (x) => x.turn.step === 'main2' && x.turn.activePlayer === 'p1' });
    expect(s.turn.step).toBe('main2');
    expect(pool(s, 'p1')).toBe(0);
    // the opponents' first main phases: nothing ("your")
    s = run(s, { until: (x) => x.turn.step === 'main1' && x.turn.activePlayer === 'p2' });
    expect(pool(s, 'p1')).toBe(0);
    const colors: string[] = [];
    s = run(s, { colors, until: (x) => x.turn.step === 'main1' && x.turn.activePlayer === 'p1' && x.turn.number > 1 && x.zones.stack.length === 0 && x.pending?.kind === 'priority' });
    expect(s.turn.activePlayer).toBe('p1');
    expect(pool(s, 'p1')).toBe(4);
    expect(colors.length).toBe(4); // each mana of a color of the player's choice (CR 106.1b)
    expect(s.players.find((x) => x.id === 'p1')!.manaPool.every((u) => u.type === 'U')).toBe(true);
    // a delayed trigger fires once (CR 603.7c): the next turns, nothing more
    const later: string[] = [];
    const turn = s.turn.number;
    s = run(s, { colors: later, until: (x) => x.turn.number > turn + 4 && x.turn.step === 'main2' });
    expect(later.length).toBe(0);
  });
});

describe('edh-next-140: Quicksilver Elemental (CR 613.1f, 611.2c, 609.4b)', () => {
  const MIMIC = card('Test Quicksilver Mimic', 'Creature — Elemental', '{U}: This creature gains all activated abilities of target creature until end of turn. (If any of the abilities use that creature\'s name, use this creature\'s name instead.)\nYou may spend blue mana as though it were mana of any color to pay the activation costs of this creature\'s abilities.', ['3', '4'], '{3}{U}{U}');
  const HUSK = card('Test Husk Fiend', 'Creature — Insect', 'Flying\nWhenever Test Husk Fiend attacks, you gain 1 life.\nSacrifice a creature: Test Husk Fiend gets +2/+2 until end of turn.\n{G}: Test Husk Fiend gets +1/+1 until end of turn.', ['1', '1'], '{2}{G}');
  const defs = [MIMIC, HUSK];
  it('compiles full', () => { expect(full(MIMIC)).toBe(true); expect(full(HUSK)).toBe(true); });
  const islands = (n: number): string[] => Array.from({ length: n }, () => 'Island');
  const ptOf = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
  const abilityOf = (s: GameState, id: ObjectId, re: RegExp) => activatedAbilities(s, s.objects[id]!).find((a) => re.test(a.def.text ?? ''));
  const activate = (s: GameState, id: ObjectId, re: RegExp, sc: Parameters<typeof run>[1] = {}): GameState => {
    const ab = abilityOf(s, id, re);
    if (ab === undefined) throw new Error(`no ability ${re} on ${id}`);
    return run(mact(s, { type: 'activate', player: 'p1', source: id, ability: ab.key } as never), sc);
  };
  /** p1: the Mimic and Islands; the Husk is p2's (or p1's with `own`). The Mimic's ability resolves targeting the Husk. */
  const gain = (n: number, own = false): { s: GameState; mimic: ObjectId; husk: ObjectId } => {
    const s0 = mpScenario({ defs, cards: ['Island', 'Mountain'], zones: own ? { p1: { battlefield: ['Test Quicksilver Mimic', 'Test Husk Fiend', ...islands(n), 'Mountain'] } } : { p1: { battlefield: ['Test Quicksilver Mimic', ...islands(n), 'Mountain'] }, p2: { battlefield: ['Test Husk Fiend'] } } });
    const mimic = bf(s0, 'Test Quicksilver Mimic')[0]!;
    const husk = bf(s0, 'Test Husk Fiend')[0]!;
    return { s: activate(s0, mimic, /gains all activated abilities/, { targets: [husk] }), mimic, husk };
  };

  it('ruling 2004-12-01: it gains the activated abilities of an opponent\'s creature only (no flying, no triggered ability); "Test Husk Fiend" in them is the Mimic', () => {
    const { s, mimic, husk } = gain(3);
    const c = getChars(s, mimic)!;
    expect(c.keywords).not.toContain('flying');
    expect(c.abilities.some((a) => a.def.kind === 'triggered')).toBe(false);
    expect(abilityOf(s, mimic, /Sacrifice a creature/)).toBeDefined();
    // sacrifice a creature (the Mountain is no creature: sacrifice the Mimic? no, nothing else: use the +1/+1 one, paid with blue mana)
    const t = activate(s, mimic, /\{G\}:/);
    expect(ptOf(t, mimic)).toBe('4/5'); // the Mimic gets +1/+1, not the Husk
    expect(ptOf(t, husk)).toBe('1/1');
  });

  it('CR 609.4b: blue mana pays the {G} of a gained ability; red mana cannot (only blue as though it were any color)', () => {
    const { s, mimic } = gain(1); // one Island taps for the {U} of the Mimic; then only the Mountain is left
    const ab = abilityOf(s, mimic, /\{G\}:/)!;
    const r = applyAction(s, { type: 'activate', player: 'p1', source: mimic, ability: ab.key } as never);
    const blocked = r.error !== undefined || (r.state.pending?.kind === 'payCost' && (r.state.pending as unknown as { autoPayable?: boolean }).autoPayable === false);
    expect(blocked).toBe(true);
    const { s: s2, mimic: m2 } = gain(2); // a second Island pays the {G}
    expect(ptOf(activate(s2, m2, /\{G\}:/), m2)).toBe('4/5');
  });

  it('CR 611.2c, 608.2h: the abilities are those the creature had as the ability resolved: the Mimic keeps them when that creature leaves the battlefield; they end with the turn', () => {
    const { s, mimic, husk } = gain(2, true);
    // the gained "Sacrifice a creature" ability, sacrificing the Husk itself
    let t = activate(s, mimic, /Sacrifice a creature/, { objects: (o) => (o.includes(husk) ? [husk] : o.slice(0, 1)) });
    expect(t.zones.battlefield).not.toContain(husk);
    expect(ptOf(t, mimic)).toBe('5/6');
    expect(abilityOf(t, mimic, /\{G\}:/)).toBeDefined(); // still there with the Husk gone
    t = run(t, { until: (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'main1' });
    expect(abilityOf(t, mimic, /\{G\}:/)).toBeUndefined(); // CR 514.2: "until end of turn"
  });

  it('ruling 2004-10-04: a non-blue creature of yours can\'t spend blue mana as though it were green (only the Mimic\'s abilities)', () => {
    const s0 = mpScenario({ defs, cards: ['Island'], zones: { p1: { battlefield: ['Test Quicksilver Mimic', 'Test Husk Fiend', 'Island'] } } });
    const husk = bf(s0, 'Test Husk Fiend')[0]!;
    const ab = abilityOf(s0, husk, /\{G\}:/)!;
    const r = applyAction(s0, { type: 'activate', player: 'p1', source: husk, ability: ab.key } as never);
    const blocked = r.error !== undefined || (r.state.pending?.kind === 'payCost' && (r.state.pending as unknown as { autoPayable?: boolean }).autoPayable === false);
    expect(blocked).toBe(true);
  });
});

describe('edh-next-140: Contamination (CR 106.12, 614.1a)', () => {
  const BLIGHT = card('Test Ash Blight', 'Enchantment', 'At the beginning of your upkeep, sacrifice this enchantment unless you sacrifice a creature.\nIf a land is tapped for mana, it produces {B} instead of any other type and amount.', undefined, '{2}{B}');
  const TEMPLE = card('Test Twin Temple', 'Land', '{T}: Add {C}{C}.');
  const PRISM = card('Test Rainbow Flat', 'Land', '{T}: Add one mana of any color.');
  const ROCK = card('Test Green Stone', 'Artifact', '{T}: Add {G}.', undefined, '{1}');
  const ECHO = card('Test Echo Basin', 'Enchantment', 'If you tap a permanent for mana, it produces twice as much of that mana instead.', undefined, '{4}{G}');
  const BEAR = card('Test Pale Bear', 'Creature — Bear', '', ['2', '2'], '{1}{G}');
  const defs = [BLIGHT, TEMPLE, PRISM, ROCK, ECHO, BEAR];
  it('compiles full', () => { for (const d of [BLIGHT, TEMPLE, PRISM, ECHO]) expect(full(d), d.name).toBe(true); });
  const tap = (s0: GameState, name: string, p: PlayerId = 'p1', color?: string): GameState => {
    const id = bf(s0, name, p)[0]!;
    const g = new Game(structuredClone(s0));
    activateManaAbility(g, p, id, activatedAbilities(g.s, g.s.objects[id]!).find((a) => a.def.kind === 'activated')!.key, color !== undefined ? { color: color as never } : undefined as never);
    return g.s;
  };
  const poolOf = (s: GameState, p: PlayerId = 'p1'): string => s.players.find((x) => x.id === p)!.manaPool.map((u) => u.type).sort().join('');

  it('CR 614.1a: a Forest, a land for two {C} and a land of any color each produce one {B}; every player\'s lands', () => {
    const s0 = mpScenario({ defs, cards: ['Forest'], zones: { p1: { battlefield: ['Test Ash Blight', 'Forest', 'Test Twin Temple', 'Test Rainbow Flat'] }, p2: { battlefield: ['Forest'] } } });
    expect(poolOf(tap(s0, 'Forest'))).toBe('B');
    expect(poolOf(tap(s0, 'Test Twin Temple'))).toBe('B');
    expect(poolOf(tap(s0, 'Test Rainbow Flat', 'p1', 'W'))).toBe('B');
    const opp = s0.zones.battlefield.find((id) => s0.objects[id]!.controller === 'p2')!;
    const g = new Game(structuredClone(s0));
    activateManaAbility(g, 'p2', opp, activatedAbilities(g.s, g.s.objects[opp]!)[0]!.key);
    expect(poolOf(g.s, 'p2')).toBe('B');
  });

  it('negative: a nonland mana source is not affected; without the enchantment a Forest makes {G}', () => {
    const s0 = mpScenario({ defs, cards: ['Forest'], zones: { p1: { battlefield: ['Test Ash Blight', 'Test Green Stone'] } } });
    expect(poolOf(tap(s0, 'Test Green Stone'))).toBe('G');
    const s1 = mpScenario({ defs, cards: ['Forest'], zones: { p1: { battlefield: ['Forest', 'Test Twin Temple'] } } });
    expect(poolOf(tap(s1, 'Forest'))).toBe('G');
    expect(poolOf(tap(s1, 'Test Twin Temple'))).toBe('CC');
  });

  it('ruling 2004-10-04, CR 616.1: with a doubler of the mana a permanent is tapped for, the land produces two {B} (color changed, amount not)', () => {
    const s0 = mpScenario({ defs, cards: ['Forest'], zones: { p1: { battlefield: ['Test Ash Blight', 'Test Echo Basin', 'Forest'] } } });
    expect(poolOf(tap(s0, 'Forest'))).toBe('BB');
  });

  it('CR 601.2g: the automatic payment plans a Forest as {B}: a {B} spell is castable, a {G} one is not', () => {
    const SHADE = card('Test Night Shade', 'Creature — Shade', '', ['1', '1'], '{B}');
    const s0 = mpScenario({ defs: [...defs, SHADE], cards: ['Forest'], zones: { p1: { battlefield: ['Test Ash Blight', 'Forest'], hand: ['Test Night Shade', 'Test Pale Bear'] } } });
    const shade = s0.zones.hand['p1']!.find((id) => s0.objects[id]!.defId === 'Test Night Shade')!;
    const s = run(mact(s0, { type: 'cast', player: 'p1', card: shade }));
    expect(bf(s, 'Test Night Shade').length).toBe(1);
    const bear = s0.zones.hand['p1']!.find((id) => s0.objects[id]!.defId === 'Test Pale Bear')!;
    const r = applyAction(s0, { type: 'cast', player: 'p1', card: bear });
    const blocked = r.error !== undefined || (r.state.pending?.kind === 'payCost' && (r.state.pending as unknown as { autoPayable?: boolean }).autoPayable === false);
    expect(blocked).toBe(true);
  });

  it('review: a filter land is planned as one {B} too (the automatic payment never offers a {B}{B} spell it cannot pay)', () => {
    const FILTER = card('Test Ash Filter', 'Land', '{B/R}, {T}: Add {B}{B}, {B}{R}, or {R}{R}.');
    const TWIN = card('Test Twin Shade', 'Creature — Shade', '', ['2', '2'], '{B}{B}');
    const s0 = mpScenario({ defs: [...defs, FILTER, TWIN], cards: ['Mountain'], zones: { p1: { battlefield: ['Test Ash Blight', 'Mountain', 'Test Ash Filter'], hand: ['Test Twin Shade'] } } });
    const twin = s0.zones.hand['p1']!.find((id) => s0.objects[id]!.defId === 'Test Twin Shade')!;
    const r = applyAction(s0, { type: 'cast', player: 'p1', card: twin });
    const blocked = r.error !== undefined || (r.state.pending?.kind === 'payCost' && (r.state.pending as unknown as { autoPayable?: boolean }).autoPayable === false);
    expect(blocked).toBe(true); // Mountain: {B}; the filter ability paid with it gives one {B}: never {B}{B}
    const s1 = mpScenario({ defs: [...defs, FILTER, TWIN], cards: ['Mountain'], zones: { p1: { battlefield: ['Mountain', 'Test Ash Filter'], hand: ['Test Twin Shade'] } } });
    const ok = applyAction(s1, { type: 'cast', player: 'p1', card: s1.zones.hand['p1']!.find((id) => s1.objects[id]!.defId === 'Test Twin Shade')! });
    expect(ok.error).toBeUndefined(); // without the enchantment the filter land pays {B}{B}
  });

  it('upkeep: sacrifice it unless you sacrifice a creature (ruling 2004-10-04: chosen as the ability resolves)', () => {
    const s0 = mpScenario({ defs, zones: { p1: { battlefield: ['Test Ash Blight', 'Test Pale Bear'] } } });
    let s = run(s0, { yes: () => true, objects: (o) => o.slice(0, 1), until: (x) => x.turn.activePlayer === 'p1' && x.turn.number > 1 && x.turn.step === 'main1' });
    expect(bf(s, 'Test Ash Blight').length).toBe(1);
    expect(bf(s, 'Test Pale Bear').length).toBe(0);
    s = run(s, { yes: () => true, until: (x) => x.turn.activePlayer === 'p1' && x.turn.number > 5 && x.turn.step === 'main1' });
    expect(bf(s, 'Test Ash Blight').length).toBe(0); // no creature left: the enchantment is sacrificed
  });
});

describe('edh-next-140: Scuttlemutt (CR 105.3, 608.2d, 613.1e)', () => {
  const SCARECROW = card('Test Patch Scarecrow', 'Artifact Creature — Scarecrow', '{T}: Add one mana of any color.\n{T}: Target creature becomes the color or colors of your choice until end of turn.', ['2', '2'], '{3}');
  const OGRE = compileCard({ name: 'Test Red Ogre', layout: 'normal', mana_cost: '{2}{R}', type_line: 'Creature — Ogre', oracle_text: '', colors: ['R'], power: '3', toughness: '3' } as OracleCard);
  const defs = [SCARECROW, OGRE];
  it('compiles full', () => { expect(full(SCARECROW)).toBe(true); });
  const paint = (pick: (o: { id: string; label: string }[], min: number, max: number) => string[], seen: { o: string[]; min: number; max: number }[] = []): { s: GameState; ogre: ObjectId } => {
    const s0 = mpScenario({ defs, zones: { p1: { battlefield: ['Test Patch Scarecrow'] }, p2: { battlefield: ['Test Red Ogre'] } } });
    const ogre = bf(s0, 'Test Red Ogre')[0]!;
    const crow = bf(s0, 'Test Patch Scarecrow')[0]!;
    const ab = activatedAbilities(s0, s0.objects[crow]!).find((a) => /color or colors/.test(a.def.text ?? ''))!;
    const s = run(mact(s0, { type: 'activate', player: 'p1', source: crow, ability: ab.key } as never), { targets: [ogre], optionIds: (o, _p, min, max) => { seen.push({ o: o.map((x) => x.id), min, max }); return pick(o, min, max); } });
    return { s, ogre };
  };
  it('ruling 2019-07-12: two colors chosen: the creature is exactly those (its red overwritten); one or more of the five colors are offered, never colorless', () => {
    const red = mpScenario({ defs, zones: { p2: { battlefield: ['Test Red Ogre'] } } });
    expect(getChars(red, bf(red, 'Test Red Ogre')[0]!)!.colors).toEqual(['R']);
    const seen: { o: string[]; min: number; max: number }[] = [];
    const { s, ogre } = paint(() => ['W', 'U'], seen);
    expect([...getChars(s, ogre)!.colors].sort()).toEqual(['U', 'W']);
    expect(seen[0]).toEqual({ o: ['W', 'U', 'B', 'R', 'G'], min: 1, max: 5 });
  });
  it('one color, or all five; it ends with the turn (CR 514.2)', () => {
    const one = paint(() => ['G']);
    expect(getChars(one.s, one.ogre)!.colors).toEqual(['G']);
    const all = paint((o) => o.map((x) => x.id));
    expect([...getChars(all.s, all.ogre)!.colors].sort()).toEqual(['B', 'G', 'R', 'U', 'W']);
    const later = run(one.s, { until: (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'main1' });
    expect(getChars(later, one.ogre)!.colors).toEqual(['R']);
  });
});

describe('edh-next-140: Mutated Cultist (CR 113.6k, 122.1, 601.2f)', () => {
  const CULTIST = card('Test Void Cultist', 'Creature — Eldrazi Horror', 'Devoid (This card has no color.)\nWhen you cast this spell, remove all counters from up to one target permanent or opponent. The next spell you cast this turn costs {1} less to cast for each counter removed this way.\nDeathtouch', ['2', '2'], '{0}');
  const BIG = card('Test Heavy Wurm', 'Creature — Wurm', '', ['5', '5'], '{3}{G}');
  const SMALL = card('Test Light Elk', 'Creature — Elk', '', ['1', '1'], '{1}{G}');
  const defs = [CULTIST, BIG, SMALL];
  it('compiles full', () => { expect(full(CULTIST)).toBe(true); });
  const handId = (s: GameState, name: string): ObjectId => s.zones.hand['p1']!.find((id) => s.objects[id]!.defId === name)!;
  const canCast = (s: GameState, name: string): boolean => {
    const r = applyAction(s, { type: 'cast', player: 'p1', card: handId(s, name) });
    return r.error === undefined && !(r.state.pending?.kind === 'payCost' && (r.state.pending as unknown as { autoPayable?: boolean }).autoPayable === false);
  };
  /** p1 casts the Cultist; its trigger targets `target` (a player id or the name of a permanent). */
  const castCultist = (s0: GameState, target?: string): GameState => {
    const t = target === undefined ? [] : /^p\d$/.test(target) ? [target] : [bf(s0, target)[0]!];
    return run(mact(s0, { type: 'cast', player: 'p1', card: handId(s0, 'Test Void Cultist') }), { targets: t });
  };

  it('ruling 2024-06-07: an opponent\'s three poison counters are removed; the next spell costs {3} less', () => {
    const s0 = mpScenario({ defs, cards: ['Forest'], zones: { p1: { battlefield: ['Forest'], hand: ['Test Void Cultist', 'Test Heavy Wurm', 'Test Light Elk'] } }, setup: (s) => { s.players.find((p) => p.id === 'p2')!.poison = 3; } });
    expect(canCast(s0, 'Test Heavy Wurm')).toBe(false);
    const s = castCultist(s0, 'p2');
    expect(s.players.find((p) => p.id === 'p2')!.poison).toBe(0);
    expect(bf(s, 'Test Void Cultist').length).toBe(1);
    expect(canCast(s, 'Test Heavy Wurm')).toBe(true); // {3}{G} - {3}: one Forest
    const after = run(mact(s, { type: 'cast', player: 'p1', card: handId(s, 'Test Heavy Wurm') }));
    expect(bf(after, 'Test Heavy Wurm').length).toBe(1);
  });

  it('CR 122.8: every kind of counter on a permanent counts (two +1/+1 and one charge: {3} less); the reduction is for the next spell only', () => {
    const BOX = card('Test Charged Box', 'Artifact', '', undefined, '{1}');
    const s0 = mpScenario({ defs: [...defs, BOX], cards: ['Forest'], zones: { p1: { battlefield: ['Forest', 'Forest'], hand: ['Test Void Cultist', 'Test Heavy Wurm', 'Test Light Elk'] }, p3: { battlefield: [{ name: 'Test Charged Box', counters: { charge: 1, '+1/+1': 2 } } as never] } } });
    const box = bf(s0, 'Test Charged Box')[0]!;
    expect(Object.values(s0.objects[box]!.counters).reduce((a, b) => a + b, 0)).toBe(3);
    const s = castCultist(s0, 'Test Charged Box');
    expect(Object.values(s.objects[box]!.counters).reduce((a, b) => a + (b ?? 0), 0)).toBe(0);
    const elk = run(mact(s, { type: 'cast', player: 'p1', card: handId(s, 'Test Light Elk') })); // the next spell: {1}{G} - {3} = {G}
    expect(bf(elk, 'Test Light Elk').length).toBe(1);
    expect(canCast(elk, 'Test Heavy Wurm')).toBe(false); // one Forest left, full cost
  });

  it('negative: no target, or a target with no counters: no reduction; you are not a legal target (ruling 2024-06-07)', () => {
    const s0 = mpScenario({ defs, cards: ['Forest'], zones: { p1: { battlefield: ['Forest'], hand: ['Test Void Cultist', 'Test Light Elk'] } }, setup: (s) => { s.players.find((p) => p.id === 'p1')!.poison = 2; } });
    let offered: unknown = null;
    const cast = mact(s0, { type: 'cast', player: 'p1', card: handId(s0, 'Test Void Cultist') });
    let st = cast;
    for (let i = 0; i < 20 && st.pending?.kind !== 'chooseTargets'; i++) st = st.pending?.kind === 'priority' ? mpass(st) : run(st, { stopAt: (x) => x.pending?.kind === 'chooseTargets' });
    offered = st.pending;
    const players = ((offered as { players?: PlayerId[] } | null)?.players ?? []) as PlayerId[];
    expect(players).not.toContain('p1');
    expect(players).toEqual(expect.arrayContaining(['p2', 'p3', 'p4']));
    const s = run(cast);
    expect(s.players.find((p) => p.id === 'p1')!.poison).toBe(2);
    expect(canCast(s, 'Test Light Elk')).toBe(false);
  });
});

describe('edh-next-140: Harold and Bob, First Numens (CR 303.4f, 303.4g, 614.1c, 613.1d)', () => {
  const NUMENS = compileCard({ name: 'Test Twin Numens', layout: 'normal', mana_cost: '{2}{G}', type_line: 'Legendary Creature — Treefolk Mutant', colors: ['G'], power: '4', toughness: '4',
    oracle_text: 'Reach, vigilance\nWhen Test Twin Numens dies, if it was a creature, return it to the battlefield. It\'s an Aura enchantment with enchant Forest you control and "Enchanted Forest has \'{T}: Add three mana of any one color. You get two rad counters.\'" Test Twin Numens loses all other abilities.' } as OracleCard);
  const SLAY = card('Test Quick Slaying', 'Instant', 'Destroy target creature.', undefined, '{0}');
  const SHATTER = card('Test Quick Shatter', 'Instant', 'Destroy target enchantment.', undefined, '{0}');
  const defs = [NUMENS, SLAY, SHATTER];
  it('compiles full', () => { expect(full(NUMENS)).toBe(true); });
  const handId = (s: GameState, name: string): ObjectId => s.zones.hand['p1']!.find((id) => s.objects[id]!.defId === name)!;
  const kill = (s0: GameState, spell: string, target: ObjectId, sc: Parameters<typeof run>[1] = {}): GameState => run(mact(s0, { type: 'cast', player: 'p1', card: handId(s0, spell) }), { targets: [target], ...sc });

  it('rulings 2024-03-08: it dies and returns as an Aura on the Forest you choose: only Enchantment and Aura, legendary and green kept, no other ability', () => {
    const s0 = mpScenario({ defs, cards: ['Forest'], zones: { p1: { battlefield: ['Test Twin Numens', 'Forest', 'Forest'], hand: ['Test Quick Slaying'] } } });
    const forests = bf(s0, 'Forest');
    const asked: ObjectId[][] = [];
    const s = kill(s0, 'Test Quick Slaying', bf(s0, 'Test Twin Numens')[0]!, { objects: (o) => { asked.push(o); return [forests[1]!]; } });
    const aura = bf(s, 'Test Twin Numens')[0]!;
    expect(aura).toBeDefined();
    const c = getChars(s, aura)!;
    expect(c.types).toEqual(['Enchantment']);
    expect(c.subtypes).toEqual(['Aura']);
    expect(c.supertypes).toContain('Legendary');
    expect(c.colors).toEqual(['G']);
    expect(c.keywords.map((k) => k.keyword)).toEqual(['enchant']); // no reach, no vigilance
    expect(c.abilities.some((a) => a.def.kind === 'triggered')).toBe(false);
    expect(s.objects[aura]!.attachedTo).toBe(forests[1]);
    expect(asked[0]).toEqual(expect.arrayContaining(forests));
  });

  it('the enchanted Forest has "{T}: Add three mana of any one color. You get two rad counters."', () => {
    const s0 = mpScenario({ defs, cards: ['Forest'], zones: { p1: { battlefield: ['Test Twin Numens', 'Forest'], hand: ['Test Quick Slaying'] } } });
    const forest = bf(s0, 'Forest')[0]!;
    const s = kill(s0, 'Test Quick Slaying', bf(s0, 'Test Twin Numens')[0]!, { objects: () => [forest] });
    const ab = activatedAbilities(s, s.objects[forest]!).find((a) => /three mana/.test(a.def.text ?? ''));
    expect(ab).toBeDefined();
    const g = new Game(structuredClone(s));
    activateManaAbility(g, 'p1', forest, ab!.key, { color: 'R' } as never);
    expect(g.s.players[0]!.manaPool.map((u) => u.type).join('')).toBe('RRR');
    expect(g.s.players[0]!.counters?.['rad'] ?? 0).toBe(2);
  });

  it('CR 303.4g (ruling 2024-03-08): with no Forest you control (only an opponent\'s), it stays in the graveyard', () => {
    const s0 = mpScenario({ defs, cards: ['Forest'], zones: { p1: { battlefield: ['Test Twin Numens'], hand: ['Test Quick Slaying'] }, p2: { battlefield: ['Forest'] } } });
    const s = kill(s0, 'Test Quick Slaying', bf(s0, 'Test Twin Numens')[0]!);
    expect(bf(s, 'Test Twin Numens').length).toBe(0);
    expect(s.zones.graveyard['p1']!.some((id) => s.objects[id]!.defId === 'Test Twin Numens')).toBe(true);
  });

  it('as an Aura it has no dies trigger: destroyed again, it stays in the graveyard', () => {
    const s0 = mpScenario({ defs, cards: ['Forest'], zones: { p1: { battlefield: ['Test Twin Numens', 'Forest'], hand: ['Test Quick Slaying', 'Test Quick Shatter'] } } });
    const forest = bf(s0, 'Forest')[0]!;
    const s1 = kill(s0, 'Test Quick Slaying', bf(s0, 'Test Twin Numens')[0]!, { objects: () => [forest] });
    const aura = bf(s1, 'Test Twin Numens')[0]!;
    const s2 = kill(s1, 'Test Quick Shatter', aura, { objects: () => [forest] });
    expect(bf(s2, 'Test Twin Numens').length).toBe(0);
    expect(s2.zones.graveyard['p1']!.some((id) => s2.objects[id]!.defId === 'Test Twin Numens')).toBe(true);
  });
});

describe('edh-next-140: Archipelagore (CR 702.140d, 730.2, 601.2c, 502.3)', () => {
  const LEVIATHAN = card('Test Isle Leviathan', 'Creature — Leviathan', 'Mutate {0} (If you cast this spell for its mutate cost, put it over or under target non-Human creature you own. They mutate into the creature on top plus all abilities from under it.)\nWhenever this creature mutates, tap up to X target creatures, where X is the number of times this creature has mutated. Those creatures don\'t untap during their controller\'s next untap step.', ['7', '7'], '{5}{U}{U}');
  const LEVIATHAN2 = card('Test Reef Leviathan', 'Creature — Leviathan', 'Mutate {0}', ['6', '6'], '{4}{U}{U}');
  it('compiles full', () => { expect(full(LEVIATHAN)).toBe(true); });
  const offered: number[] = [];
  /** Answers the targets with up to `want` of the given creatures, recording how many the spec allows at most. */
  const pickTargets = (s0: GameState, ids: ObjectId[], want: number): GameState => {
    let s = s0;
    for (let i = 0; i < 300; i++) {
      const p = s.pending as unknown as { kind: string; max?: number; options?: { id: string }[] } | null;
      if (p === null || (p.kind === 'priority' && s.zones.stack.length === 0)) break;
      if (p.kind === 'chooseTargets') { offered.push(p.max ?? -1); s = manswer(s, { kind: 'chooseTargets', targets: ids.slice(0, Math.min(want, p.max ?? want)).map((id) => ({ kind: 'object' as const, id })) } as DecisionAnswer); }
      else if (p.kind === 'chooseOption') s = manswer(s, { kind: 'chooseOption', ids: [p.options!.find((o) => o.id === 'over')?.id ?? p.options![0]!.id] } as DecisionAnswer);
      else if (p.kind === 'priority') s = mpass(s);
      else s = run(s, { stopAt: () => true });
    }
    return s;
  };
  it('the first mutate taps up to one target creature; the second (two merges) up to two, and they skip their controller\'s next untap step', () => {
    offered.length = 0;
    const s0 = mutateTable([ELVES], { hand: ['Test Isle Leviathan', 'Test Reef Leviathan'], theirs: [BEARS, BEARS], defs: [LEVIATHAN, LEVIATHAN2] });
    const bears = s0.zones.battlefield.filter((id) => s0.objects[id]!.controller === 'p2');
    const elf = s0.zones.battlefield.find((id) => s0.defs[s0.objects[id]!.defId]!.name === ELVES)!;
    let s = pickTargets(mutateCast(s0, elf, 'Test Isle Leviathan'), bears, 2);
    expect(offered[offered.length - 1]).toBe(1); // X = 1: one merge
    expect(bears.filter((id) => s.objects[id]!.tapped).length).toBe(1);
    const merged = s.zones.battlefield.find((id) => s.objects[id]!.controller === 'p1' && getChars(s, id)!.types.includes('Creature') && (s.objects[id]!.components ?? []).length > 0)!;
    s = pickTargets(mutateCast(s, merged, 'Test Reef Leviathan'), bears, 2);
    expect(offered[offered.length - 1]).toBe(2); // X = 2: two merges
    expect(bears.every((id) => s.objects[id]!.tapped)).toBe(true); // ruling 2020-04-17: the tapped one may be targeted again
    // CR 502.3: p2's next untap step: they stay tapped
    s = run(s, { until: (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'main1' });
    expect(bears.every((id) => s.objects[id]!.tapped)).toBe(true);
    s = run(s, { until: (x) => x.turn.activePlayer === 'p1' && x.turn.step === 'main1' });
    s = run(s, { until: (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'main1' });
    expect(bears.every((id) => !s.objects[id]!.tapped)).toBe(true); // only the next one
  });
});
