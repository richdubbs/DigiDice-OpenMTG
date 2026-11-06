/**
 * Commander lane edh-misc, round edh-misc-5, played through the engine with synthetic cards compiled by the game's default compiler (invented names and wordings,
 * design 6.10). CR cites checked against the real Comprehensive Rules text of 2026-09-25 where marked (ruling checks: Scryfall, 2026-10-28).
 *
 *   CR 603.2d, 603.6a, 603.10a   a permanent entering or leaving the battlefield makes a triggered ability of a permanent you control trigger an additional time
 *   CR 120.1, 608.2b, 107.1a    damage divided evenly, rounded down, among the targets or the creatures a spell names
 *   CR 401.4, 400.3            cards put on the bottom of their owner's library in any order
 *   CR 500.8, 500.9, 500.10     an additional beginning phase after the postcombat main phase: untap, upkeep, draw, then the end step
 *   CR 701.40a, 701.40e, 708.2a manifest a card from your hand (face down 2/2 permanent)
 *   CR 707.2, 707.9a, 613.1a   each other creature becomes a copy of a target creature until end of turn, except it isn't legendary
 */
import { describe, expect, it } from 'vitest';
import { activatedAbilities, compileCard, getChars, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, advanceTo, answer, find, findAll, life, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: string[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const chars = (s: GameState, id: ObjectId) => getChars(s, id);
const onField = (s: GameState, name: string, owner?: 'p1' | 'p2'): ObjectId[] => s.zones.battlefield.filter((id) => chars(s, id).name === name && (!owner || s.objects[id]!.controller === owner));

/** Answer every decision: yes/no by `yes`, objects by `pick`, targets in order from `targets`, mana automatically. */
function drive(s0: GameState, o: { yes?: boolean; pick?: (options: ObjectId[], s: GameState) => ObjectId[]; targets?: (ObjectId | 'p1' | 'p2')[][] } = {}): GameState {
  let s = s0;
  const tq = [...(o.targets ?? [])];
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: o.pick ? o.pick(p.options, s) : p.options.slice(0, Math.max(p.min, 1)).slice(0, p.max) });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: (tq.shift() ?? []).map((id) => (id === 'p1' || id === 'p2' ? { kind: 'player' as const, id } : { kind: 'object' as const, id })) });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Parameters<typeof drive>[1] = {}): GameState {
  let s = drive(s0, o);
  for (let guard = 0; guard < 60 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, o);
  return s;
}
const cast = (s0: GameState, name: string, o: Parameters<typeof drive>[1] = {}): GameState => resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), o);

// ---- Gandalf the White: entering or leaving the battlefield -----------------------------------------------------------------------------------------------

describe('CR 603.2d, 603.6a, 603.10a: "if a legendary permanent or an artifact entering or leaving the battlefield causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time"', () => {
  const WIZARD = card('Test Wizard', 'Legendary Creature — Wizard', 'If a legendary permanent or an artifact entering or leaving the battlefield causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.', { pt: ['3', '3'] });
  const WATCH = card('Test Watcher', 'Creature — Human', 'Whenever a creature enters, you gain 1 life.\nWhenever a creature you control dies, you gain 10 life.', { pt: ['1', '1'] });
  const LEAVER = card('Test Leaver', 'Legendary Creature — Human', 'When this creature leaves the battlefield, you gain 100 life.', { pt: ['1', '1'] });
  const PLAIN = card('Test Plain', 'Creature — Bear', 'When this creature leaves the battlefield, you gain 1000 life.', { pt: ['2', '2'] });
  const KING = card('Test King', 'Legendary Creature — Human Noble', '', { pt: ['3', '3'] });
  const GOLEM = card('Test Golem', 'Artifact Creature — Golem', '', { pt: ['2', '2'] });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const SMITE = card('Test Smite', 'Instant', 'Destroy target creature.');
  const BOUNCE = card('Test Bounce', 'Instant', "Return target creature to its owner's hand.");
  const defs = [WIZARD, WATCH, LEAVER, PLAIN, KING, GOLEM, BEAR, SMITE, BOUNCE];
  const gain = (hand: string[], battlefield: string[], play: (s: GameState) => GameState): number => {
    let s = scenario([], { defs, p1: { hand, battlefield } });
    const before = life(s, 'p1');
    s = play(s);
    return life(s, 'p1') - before;
  };
  it('is fully automated', () => expect(full(WIZARD)).toBe(true));
  it('a legendary creature entering makes the watcher trigger twice; an artifact creature too; a plain creature once', () => {
    expect(gain(['Test King'], ['Test Wizard', 'Test Watcher'], (s) => cast(s, 'Test King'))).toBe(2);
    expect(gain(['Test Golem'], ['Test Wizard', 'Test Watcher'], (s) => cast(s, 'Test Golem'))).toBe(2);
    expect(gain(['Test Bear'], ['Test Wizard', 'Test Watcher'], (s) => cast(s, 'Test Bear'))).toBe(1);
  });
  it('the negative case: without the doubler the legendary creature triggers it once', () => {
    expect(gain(['Test King'], ['Test Watcher'], (s) => cast(s, 'Test King'))).toBe(1);
  });
  it('leaving looks back: a legendary creature that leaves (bounced, no death) triggers its own "leaves the battlefield" ability twice; a plain creature once', () => {
    expect(gain(['Test Bounce'], ['Test Wizard', 'Test Leaver'], (s) => cast(s, 'Test Bounce', { targets: [[find(s, 'Test Leaver', 'battlefield', 'p1')]] }))).toBe(200);
    expect(gain(['Test Bounce'], ['Test Wizard', 'Test Plain'], (s) => cast(s, 'Test Bounce', { targets: [[find(s, 'Test Plain', 'battlefield', 'p1')]] }))).toBe(1000);
  });
  it('a legendary creature dying doubles "whenever a creature you control dies" (dying is leaving the battlefield); a plain one does not', () => {
    expect(gain(['Test Smite'], ['Test Wizard', 'Test Watcher', 'Test Leaver'], (s) => cast(s, 'Test Smite', { targets: [[find(s, 'Test Leaver', 'battlefield', 'p1')]] }))).toBe(2 * 10 + 2 * 100);
    expect(gain(['Test Smite'], ['Test Wizard', 'Test Watcher', 'Test Bear'], (s) => cast(s, 'Test Smite', { targets: [[find(s, 'Test Bear', 'battlefield', 'p1')]] }))).toBe(10);
  });
  it('the doubler leaving itself is doubled by its own look-back (it is legendary)', () => {
    expect(gain(['Test Smite'], ['Test Wizard', 'Test Watcher'], (s) => cast(s, 'Test Smite', { targets: [[find(s, 'Test Wizard', 'battlefield', 'p1')]] }))).toBe(2 * 10);
  });
  it('a doubler that left only doubles what leaves with it: a Treasure created after the Wizard was destroyed (same spell) triggers "whenever an artifact enters" once (CR 603.10a, 603.2)', () => {
    const FATE = card('Test Fate', 'Instant', 'Destroy target creature. Create a Treasure token.');
    const ART = card('Test Artifact Watcher', 'Creature — Human', 'Whenever an artifact enters, you gain 1 life.', { pt: ['1', '1'] });
    const d = [...defs, FATE, ART];
    let s = scenario([], { defs: d, p1: { hand: ['Test Fate'], battlefield: ['Test Wizard', 'Test Artifact Watcher'] } });
    const before = life(s, 'p1');
    s = cast(s, 'Test Fate', { targets: [[find(s, 'Test Wizard', 'battlefield', 'p1')]] });
    expect(life(s, 'p1') - before).toBe(1);
  });
  it('simultaneous leaving still counts the doubler: a wrath that destroys the Wizard, a legendary creature and the watcher doubles the watcher\'s trigger for the legend', () => {
    const WRATH = card('Test Wrath', 'Sorcery', 'Destroy all creatures.');
    const WATCH2 = card('Test Death Watcher', 'Creature — Human', 'Whenever a creature dies, you gain 1 life.', { pt: ['1', '1'] });
    let s = scenario([], { defs: [...defs, WRATH, WATCH2], p1: { hand: ['Test Wrath'], battlefield: ['Test Wizard', 'Test King', 'Test Plain', 'Test Death Watcher'] } });
    const before = life(s, 'p1');
    s = cast(s, 'Test Wrath');
    // Wizard (legendary, 2) + King (legendary, 2) + Plain (1, plus its own leaves ability 1000) + the watcher itself (1)
    expect(life(s, 'p1') - before).toBe(2 + 2 + 1 + 1 + 1000);
  });
  it('sacrificing a legendary permanent or an artifact is leaving the battlefield: "whenever you sacrifice an artifact" triggers twice, for a plain creature once', () => {
    const SAC = card('Test Altar', 'Artifact', '{0}, Sacrifice an artifact: You gain 1 life.');
    const SW = card('Test Sac Watcher', 'Creature — Human', 'Whenever you sacrifice a permanent, you gain 100 life.', { pt: ['1', '1'] });
    const run = (victim: string): number => {
      let s = scenario([], { defs: [...defs, SAC, SW], p1: { battlefield: ['Test Wizard', 'Test Altar', 'Test Sac Watcher', victim] } });
      const before = life(s, 'p1');
      const altar = find(s, 'Test Altar', 'battlefield', 'p1');
      s = act(s, { type: 'activate', player: 'p1', source: altar, ability: activatedAbilities(s, s.objects[altar]!).find((i) => i.def.isMana !== true)!.key });
      s = resolveAll(s, { pick: (opts, st) => [opts.find((id) => st.objects[id]!.defId === victim) ?? opts[0]!] });
      return life(s, 'p1') - before;
    };
    expect(run('Test Golem')).toBe(1 + 200);
  });
  it('the negative case: a permanent an opponent controls is not doubled ("a permanent you control")', () => {
    let s = scenario([], { defs, p1: { hand: ['Test King'], battlefield: ['Test Wizard'] }, p2: { battlefield: ['Test Watcher'] } });
    const before = life(s, 'p2');
    s = cast(s, 'Test King');
    expect(life(s, 'p2') - before).toBe(1);
  });
});

// ---- damage divided evenly, rounded down ----------------------------------------------------------------------------------------------------------------------

describe('CR 120.1, 608.2b, 107.1a: "~ deals N damage divided evenly, rounded down, among ..." (eff.damage.evenly.down; Fireball is played with its real wording in test/m5/lifedamage)', () => {
  const ROLL = card('Test Rolling Blast', 'Sorcery', '~ deals 7 damage divided evenly, rounded down, among all creatures target opponent controls.');
  const SPRAY = card('Test Spray', 'Sorcery', '~ deals 5 damage divided evenly, rounded down, among any number of targets.');
  const G3 = card('Test Giant', 'Creature — Giant', '', { pt: ['3', '9'] });
  const defs = [ROLL, SPRAY, G3];
  const dmg = (s: GameState, id: ObjectId): number => s.objects[id]!.damage;
  it('are fully automated', () => { expect(full(ROLL)).toBe(true); expect(full(SPRAY)).toBe(true); });
  it('7 damage among the three creatures an opponent controls is 2 each (rounded down, the remainder is not dealt); my own creature is not touched', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Rolling Blast'], battlefield: ['Test Giant'] }, p2: { battlefield: ['Test Giant', 'Test Giant', 'Test Giant'] } });
    s = cast(s, 'Test Rolling Blast', { targets: [['p2']] });
    expect(findAll(s, 'Test Giant', 'battlefield', 'p2').map((id) => dmg(s, id))).toEqual([2, 2, 2]);
    expect(dmg(s, find(s, 'Test Giant', 'battlefield', 'p1'))).toBe(0);
  });
  it('the negative case: with more creatures than damage (9 > 7) each is dealt 0', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Rolling Blast'] }, p2: { battlefield: Array(9).fill('Test Giant') } });
    s = cast(s, 'Test Rolling Blast', { targets: [['p2']] });
    expect(findAll(s, 'Test Giant', 'battlefield', 'p2').map((id) => dmg(s, id))).toEqual(Array(9).fill(0));
  });
  it('5 damage among a creature and a player is 2 each; among three targets it is 1 each', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Spray'] }, p2: { battlefield: ['Test Giant'] } });
    const giant = find(s, 'Test Giant', 'battlefield', 'p2');
    s = cast(s, 'Test Spray', { targets: [[giant, 'p2']] });
    expect(dmg(s, giant)).toBe(2);
    expect(life(s, 'p2')).toBe(18);
    let t = scenario([], { defs, p1: { hand: ['Test Spray'] }, p2: { battlefield: ['Test Giant', 'Test Giant'] } });
    const [a, b] = findAll(t, 'Test Giant', 'battlefield', 'p2');
    t = cast(t, 'Test Spray', { targets: [[a!, b!, 'p2']] });
    expect([dmg(t, a!), dmg(t, b!), 20 - life(t, 'p2')]).toEqual([1, 1, 1]);
  });
});

// ---- put on the bottom of the library in any order -----------------------------------------------------------------------------------------------------

describe('CR 401.4, 400.3: "put up to N target cards from your graveyard on the bottom of your library in any order" (eff.put.lib.bottom.anyorder)', () => {
  const BOW = card('Test Longbow', 'Artifact', '{T}: Put up to two target cards from your graveyard on the bottom of your library in any order.');
  const A = card('Test Card A', 'Creature — Bear', '', { pt: ['1', '1'] });
  const B = card('Test Card B', 'Creature — Bear', '', { pt: ['1', '1'] });
  const C = card('Test Card C', 'Creature — Bear', '', { pt: ['1', '1'] });
  const defs = [BOW, A, B, C];
  const activate = (s0: GameState, targets: ObjectId[], first?: string): GameState => {
    const src = find(s0, 'Test Longbow', 'battlefield', 'p1');
    let s = act(s0, { type: 'activate', player: 'p1', source: src, ability: activatedAbilities(s0, s0.objects[src]!).find((i) => i.def.isMana !== true)!.key });
    s = drive(s, { targets: [targets] });
    for (let guard = 0; guard < 40 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) {
      const p = s.pending;
      if (p?.kind === 'order') {
        const ids = p.items.map((x) => x.id);
        s = answer(s, { kind: 'order', ids: first === undefined ? ids : [...ids].sort((x, y) => (s.objects[x]!.defId === first ? -1 : s.objects[y]!.defId === first ? 1 : 0)) });
      } else s = p?.kind === 'priority' ? pass(s) : drive(s);
    }
    return s;
  };
  it('is fully automated', () => expect(full(BOW)).toBe(true));
  it('the chosen cards end up as the bottom cards of the library (not the top), in the order the player gives, and leave the graveyard', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Longbow'], graveyard: ['Test Card A', 'Test Card B', 'Test Card C'] } });
    const [a, b] = [find(s0, 'Test Card A', 'graveyard', 'p1'), find(s0, 'Test Card B', 'graveyard', 'p1')];
    const s = activate(s0, [a, b], 'Test Card B');
    const lib = s.zones.library.p1!;
    expect(lib.length).toBe(22);
    expect(lib.slice(-2).map((id) => s.objects[id]!.defId).sort()).toEqual(['Test Card A', 'Test Card B']);
    expect(s.objects[lib[lib.length - 2]!]!.defId).toBe('Test Card B'); // the player ordered it first of the two: higher up of the bottom pair
    expect(s.zones.graveyard.p1!.map((id) => s.objects[id]!.defId)).toEqual(['Test Card C']);
    expect(s.objects[lib[0]!]!.defId).toBe('Plains'); // the top of the library is untouched
  });
  it('the order is the player\'s: giving the other order puts the other card above', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Longbow'], graveyard: ['Test Card A', 'Test Card B'] } });
    const s = activate(s0, [find(s0, 'Test Card A', 'graveyard', 'p1'), find(s0, 'Test Card B', 'graveyard', 'p1')], 'Test Card A');
    const lib = s.zones.library.p1!;
    expect([s.objects[lib[lib.length - 2]!]!.defId, s.objects[lib[lib.length - 1]!]!.defId]).toEqual(['Test Card A', 'Test Card B']);
  });
  it('the negative case: "up to two" lets the player take just one (or none); the rest stay in the graveyard', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Longbow'], graveyard: ['Test Card A', 'Test Card B'] } });
    const s = activate(s0, [find(s0, 'Test Card A', 'graveyard', 'p1')]);
    expect(s.zones.library.p1!.length).toBe(21);
    expect(s.zones.graveyard.p1!.map((id) => s.objects[id]!.defId)).toEqual(['Test Card B']);
  });
});

describe('CR 401.4, 608.2c, 701.20e: "look at the top three cards of your library. You may put those cards on the bottom of your library in any order. If you do, return ~ to its owner\'s hand. Otherwise, draw three cards."', () => {
  const PETALS = card('Test Petals', 'Sorcery', "Look at the top three cards of your library. You may put those cards on the bottom of your library in any order. If you do, return ~ to its owner's hand. Otherwise, draw three cards.");
  const A = card('Test Top A', 'Creature — Bear', '', { pt: ['1', '1'] });
  const B = card('Test Top B', 'Creature — Bear', '', { pt: ['1', '1'] });
  const C = card('Test Top C', 'Creature — Bear', '', { pt: ['1', '1'] });
  const defs = [PETALS, A, B, C];
  const start = (): GameState => scenario([], { defs, p1: { hand: ['Test Petals'], library: ['Test Top A', 'Test Top B', 'Test Top C'] } });
  it('is fully automated', () => expect(full(PETALS)).toBe(true));
  it('yes: the three looked-at cards go to the bottom (the library keeps its size), the spell returns to hand, nothing is drawn', () => {
    const s0 = start();
    const handBefore = s0.zones.hand.p1!.length;
    const s = cast(s0, 'Test Petals', { yes: true });
    expect(s.zones.library.p1!.slice(-3).map((id) => s.objects[id]!.defId).sort()).toEqual(['Test Top A', 'Test Top B', 'Test Top C']);
    expect(s.zones.library.p1!.length).toBe(s0.zones.library.p1!.length);
    expect(s.zones.hand.p1!.map((id) => s.objects[id]!.defId)).toEqual(['Test Petals']);
    expect(s.zones.hand.p1!.length).toBe(handBefore);
    expect(s.zones.graveyard.p1!.length).toBe(0);
  });
  it('the negative case, no: the cards stay on top, three cards are drawn, the spell goes to the graveyard', () => {
    const s0 = start();
    const s = cast(s0, 'Test Petals', { yes: false });
    expect(s.zones.hand.p1!.map((id) => s.objects[id]!.defId).sort()).toEqual(['Test Top A', 'Test Top B', 'Test Top C']);
    expect(s.zones.graveyard.p1!.map((id) => s.objects[id]!.defId)).toEqual(['Test Petals']);
  });
});

// ---- each other creature becomes a copy of a target creature --------------------------------------------------------------------------------------------

describe('CR 707.2, 707.9a, 613.1a, 611.2c: "choose target creature you control. Each other creature becomes a copy of that creature until end of turn, except it isn\'t legendary" (eff.p2copyperm1.eachOther.becomeCopy.dur.except)', () => {
  const WAVE = card('Test Mimic Wave', 'Sorcery', "Choose target creature you control. Each other creature becomes a copy of that creature until end of turn, except it isn't legendary.");
  const KING = card('Test Copy King', 'Legendary Creature — Human Noble', 'Flying', { pt: ['3', '3'] });
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const GIANT = card('Test Big Giant', 'Creature — Giant', '', { pt: ['5', '5'] });
  const defs = [WAVE, KING, BEAR, GIANT];
  const start = (): GameState => scenario([], { defs, p1: { hand: ['Test Mimic Wave'], battlefield: ['Test Copy King', 'Test Plain Bear'] }, p2: { battlefield: ['Test Big Giant'] } });
  const flies = (s: GameState, id: ObjectId): boolean => chars(s, id).keywords.some((k) => k.keyword === 'flying');
  it('is fully automated', () => expect(full(WAVE)).toBe(true));
  it('every other creature (an opponent\'s too) becomes a nonlegendary 3/3 flying King copy; the target stays legendary and the legend rule does not apply', () => {
    let s = start();
    const king = find(s, 'Test Copy King', 'battlefield', 'p1');
    const bear = find(s, 'Test Plain Bear', 'battlefield', 'p1');
    const giant = find(s, 'Test Big Giant', 'battlefield', 'p2');
    s = cast(s, 'Test Mimic Wave', { targets: [[king]] });
    for (const id of [bear, giant]) {
      expect(chars(s, id).name).toBe('Test Copy King');
      expect([chars(s, id).power, chars(s, id).toughness]).toEqual(['3', '3']);
      expect(flies(s, id)).toBe(true);
      expect(chars(s, id).supertypes).not.toContain('Legendary');
    }
    expect(chars(s, king).supertypes).toContain('Legendary');
    expect(s.zones.battlefield.length).toBe(3); // nothing died to the legend rule
  });
  it('it lasts until end of turn only: on the next turn they are a Bear and a Giant again', () => {
    let s = start();
    const bear = find(s, 'Test Plain Bear', 'battlefield', 'p1');
    s = cast(s, 'Test Mimic Wave', { targets: [[find(s, 'Test Copy King', 'battlefield', 'p1')]] });
    s = advanceTo(s, 2, 'upkeep');
    expect(chars(s, bear).name).toBe('Test Plain Bear');
    expect(chars(s, find(s, 'Test Big Giant', 'battlefield', 'p2')).name).toBe('Test Big Giant');
  });
  it('the negative case: a creature that enters after the spell resolved is not copied (the affected set is fixed, CR 611.2c)', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Mimic Wave', 'Test Plain Bear'], battlefield: ['Test Copy King'] } });
    s = cast(s, 'Test Mimic Wave', { targets: [[find(s, 'Test Copy King', 'battlefield', 'p1')]] });
    s = cast(s, 'Test Plain Bear');
    expect(chars(s, find(s, 'Test Plain Bear', 'battlefield', 'p1')).name).toBe('Test Plain Bear');
  });
});

// ---- manifest a card from your hand -------------------------------------------------------------------------------------------------------------------

describe('CR 701.40a, 701.40e, 708.2a: "{T}: Manifest a card from your hand." (eff.edhx5.manifest.fromHand)', () => {
  const SCROLL = card('Test Scroll', 'Artifact', '{T}: Manifest a card from your hand.');
  const BEAR = card('Test Hand Bear', 'Creature — Bear', '', { pt: ['4', '4'] });
  const SPELL = card('Test Hand Spell', 'Instant', 'Draw a card.');
  const defs = [SCROLL, BEAR, SPELL];
  const key = (s: GameState): string => activatedAbilities(s, s.objects[find(s, 'Test Scroll', 'battlefield', 'p1')]!).find((i) => i.def.isMana !== true)!.key;
  const run = (s0: GameState, pick?: string): GameState => {
    let s = act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Scroll', 'battlefield', 'p1'), ability: key(s0) });
    for (let guard = 0; guard < 30 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) {
      const p = s.pending;
      if (p?.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: [pick === undefined ? p.options[0]! : p.options.find((id) => s.objects[id]!.defId === pick) ?? p.options[0]!] });
      else s = p?.kind === 'priority' ? pass(s) : drive(s);
    }
    return s;
  };
  it('is fully automated', () => expect(full(SCROLL)).toBe(true));
  it('the player chooses one card of their hand: it becomes a face-down 2/2 nameless creature they control, the other card stays in hand (an instant can be manifested too)', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Scroll'], hand: ['Test Hand Bear', 'Test Hand Spell'] } });
    const s = run(s0, 'Test Hand Spell');
    const down = s.zones.battlefield.filter((id) => s.objects[id]!.faceDown);
    expect(down.length).toBe(1);
    expect(s.objects[down[0]!]!.defId).toBe('Test Hand Spell');
    expect(s.objects[down[0]!]!.controller).toBe('p1');
    expect([chars(s, down[0]!).name, chars(s, down[0]!).power, chars(s, down[0]!).toughness, chars(s, down[0]!).types]).toEqual(['', '2', '2', ['Creature']]);
    expect(s.zones.hand.p1!.map((id) => s.objects[id]!.defId)).toEqual(['Test Hand Bear']);
    expect(s.objects[find(s, 'Test Scroll', 'battlefield', 'p1')]!.tapped).toBe(true);
  });
  it('the negative case: with an empty hand nothing is manifested and nothing breaks (the top of the library is not touched)', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Scroll'] } });
    const lib = s0.zones.library.p1!.length;
    const s = run(s0);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.faceDown)).toEqual([]);
    expect(s.zones.library.p1!.length).toBe(lib);
  });
  it('the negative case: the opponent\'s hand is not touched', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Scroll'], hand: ['Test Hand Bear'] }, p2: { hand: ['Test Hand Spell'] } });
    const s = run(s0);
    expect(s.zones.hand.p2!.map((id) => s.objects[id]!.defId)).toEqual(['Test Hand Spell']);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.faceDown).map((id) => s.objects[id]!.defId)).toEqual(['Test Hand Bear']);
  });
});

// ---- an additional beginning phase ----------------------------------------------------------------------------------------------------------------------

describe('CR 500.8, 500.9, 500.10: "at the beginning of each of your postcombat main phases, there is an additional beginning phase after this phase" (eff.edhx5.extraBeginningPhase)', () => {
  const SPHINX = card('Test Second Sphinx', 'Creature — Sphinx', 'Flying\nAt the beginning of each of your postcombat main phases, there is an additional beginning phase after this phase.', { pt: ['6', '6'] });
  const WATCH = card('Test Upkeep Watcher', 'Creature — Human', 'At the beginning of your upkeep, you gain 1 life.', { pt: ['1', '1'] });
  const defs = [SPHINX, WATCH];
  /** Pass priority until `until` is true, listing the step of every priority stop. */
  const run = (s0: GameState, until: (s: GameState) => boolean): { s: GameState; steps: string[] } => {
    let s = s0;
    const steps: string[] = [];
    for (let guard = 0; guard < 80 && !until(s); guard++) {
      if (s.pending?.kind !== 'priority') throw new Error(`unexpected decision ${s.pending?.kind}`);
      if (steps[steps.length - 1] !== s.turn.step) steps.push(s.turn.step);
      s = pass(s);
    }
    if (steps[steps.length - 1] !== s.turn.step) steps.push(s.turn.step);
    return { s, steps };
  };
  it('is fully automated', () => expect(full(SPHINX)).toBe(true));
  it('after the postcombat main phase come an untap step (the active player untaps), an upkeep step ("at the beginning of your upkeep" triggers), a draw step (a card is drawn), then the end step', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Second Sphinx', 'Test Upkeep Watcher', { name: 'Plains', tapped: true }] } });
    s = advanceTo(s, 1, 'main2');
    const hand = s.zones.hand.p1!.length;
    const plains = find(s, 'Plains', 'battlefield', 'p1');
    expect(s.objects[plains]!.tapped).toBe(true);
    const before = life(s, 'p1');
    const { s: end, steps } = run(s, (x) => x.turn.step === 'end' && x.pending?.kind === 'priority' && x.zones.stack.length === 0);
    expect(steps).toEqual(['main2', 'upkeep', 'draw', 'end']); // the untap step gives no priority
    expect(end.turn.number).toBe(1);
    expect(end.objects[plains]!.tapped).toBe(false); // the additional untap step untapped it
    expect(life(end, 'p1') - before).toBe(1); // the additional upkeep step
    expect(end.zones.hand.p1!.length - hand).toBe(1); // the additional draw step
  });
  it('CR 614.10: "skip your draw step" skips the additional draw step too (the untap and upkeep steps still happen, no card is drawn)', () => {
    const FREEZE = card('Test Dry Spell', 'Enchantment', 'Skip your draw step.');
    let s = scenario([], { defs: [...defs, FREEZE], p1: { battlefield: ['Test Second Sphinx', 'Test Dry Spell', { name: 'Plains', tapped: true }] } });
    s = advanceTo(s, 1, 'main2');
    const hand = s.zones.hand.p1!.length;
    const { s: end, steps } = run(s, (x) => x.turn.step === 'end' && x.pending?.kind === 'priority' && x.zones.stack.length === 0);
    expect(steps).toEqual(['main2', 'upkeep', 'end']);
    expect(end.objects[find(end, 'Plains', 'battlefield', 'p1')]!.tapped).toBe(false); // the additional untap step happened
    expect(end.zones.hand.p1!.length).toBe(hand); // the additional draw step was skipped
  });
  it('CR 500.8: a combat phase and a main phase added after the Sphinx\'s trigger come BEFORE its beginning phase (it was created first), and the added main phase triggers the Sphinx again', () => {
    const EXTRA = card('Test Extra Combat', 'Sorcery', 'After this main phase, there is an additional combat phase followed by an additional main phase.');
    let s = scenario([], { defs: [...defs, EXTRA], p1: { hand: ['Test Extra Combat'], battlefield: ['Test Second Sphinx', { name: 'Plains', tapped: true }] } });
    s = advanceTo(s, 1, 'main2');
    s = resolveAll(s); // the Sphinx's trigger
    s = cast(s, 'Test Extra Combat');
    const seen: string[] = [];
    for (let guard = 0; guard < 120 && !(s.turn.step === 'end' && s.pending?.kind === 'priority' && s.zones.stack.length === 0); guard++) {
      if (s.pending?.kind === 'priority') { if (seen[seen.length - 1] !== s.turn.step) seen.push(s.turn.step); s = pass(s); } else if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] }); else s = drive(s);
    }
    seen.push(s.turn.step);
    const iUpkeep = seen.indexOf('upkeep');
    const iCombat = seen.indexOf('beginCombat');
    expect(iCombat).toBeGreaterThan(-1);
    expect(iCombat).toBeLessThan(iUpkeep); // the added combat phase is first
    expect(seen.filter((x) => x === 'upkeep').length).toBe(2); // two Sphinx triggers (the original and the added main phase's)
    expect(seen[seen.length - 1]).toBe('end');
  });
  it('the negative case: without the Sphinx the postcombat main phase is followed directly by the end step (no extra card, the land stays tapped)', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Upkeep Watcher', { name: 'Plains', tapped: true }] } });
    s = advanceTo(s, 1, 'main2');
    const hand = s.zones.hand.p1!.length;
    const { s: end, steps } = run(s, (x) => x.turn.step === 'end' && x.pending?.kind === 'priority');
    expect(steps).toEqual(['main2', 'end']);
    expect(end.zones.hand.p1!.length).toBe(hand);
    expect(end.objects[find(end, 'Plains', 'battlefield', 'p1')]!.tapped).toBe(true);
  });
  it('the negative case: it is only "your" postcombat main phase: on the opponent\'s turn nothing is added', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Second Sphinx'] } });
    s = advanceTo(s, 2, 'main2');
    const { steps } = run(s, (x) => x.turn.step === 'end' && x.pending?.kind === 'priority');
    expect(steps).toEqual(['main2', 'end']);
  });
});
