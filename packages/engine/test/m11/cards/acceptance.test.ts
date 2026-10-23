/**
 * M11-4 (docs/design/m11-commander.md 3): the acceptance cards whose scenario is M11-4's, as the default compiler compiles their real Oracle text (fixture
 * cards) and M11-1's runtime plays them in a two-player Commander game (CR 903.2). Each card is first checked to be fully automated (or partial with the
 * reason the design gives), then played.
 */
import { describe, expect, it } from 'vitest';
import { commanderTax, legalActions, manaSources, type CardDef, type DecisionAnswer, type GameState, type ObjectId } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { compiledDef } from '../../fixtures';
import { castAuto, pool, scenario } from '../../m3/scenario';
import {
  act, answerUntilPriority, card, commanderOnBattlefield, commanderRec, commanderScenario, find, forests, inCommand, legend, pass, runCombat, toStep, tweak,
} from '../rules/helpers';

const def = (name: string): CardDef => compiledDef(name);
const TITANIA = def('Titania, Protector of Argoth');
const KRAUM = def("Kraum, Ludevic's Opus");
const TYMNA = def('Tymna the Weaver');
const BOB = legend('Test Bob Commander', '{G}', ['1', '1'], ['G']);

const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const onBattlefield = (s: GameState, name: string): ObjectId => find(s, name, 'battlefield');
const inHand = (s: GameState, name: string, player = 'p1'): boolean => s.zones.hand[player]!.some((id) => s.defs[s.objects[id]!.defId]!.name === name);

/** Answer what is asked (payment automatic; yes to "may"; the first legal target or object, unless `pick` says otherwise) until priority. */
function drive(s: GameState, pick: (d: NonNullable<GameState['pending']>) => DecisionAnswer | undefined = () => undefined): GameState {
  let t = s;
  for (let i = 0; i < 40 && t.pending && t.pending.kind !== 'priority'; i++) {
    const d = t.pending;
    const a: DecisionAnswer | undefined = pick(d) ?? (d.kind === 'payCost' ? { kind: 'payCost', auto: true }
      : d.kind === 'yesNo' ? { kind: 'yesNo', yes: true }
        : d.kind === 'chooseTargets' ? { kind: 'chooseTargets', targets: d.players.length > 0 ? [{ kind: 'player', id: d.players[0]! }] : [{ kind: 'object', id: d.objects[0]! }] }
          : d.kind === 'chooseObjects' ? { kind: 'chooseObjects', ids: d.options.slice(0, Math.max(d.min, 1)) }
            : d.kind === 'commanderZone' ? { kind: 'commanderZone', command: false }
              : undefined);
    if (!a) throw new Error(`no answer for ${d.kind}`);
    t = answerUntilPriority(t, [a]);
  }
  return t;
}

describe('M11-4 acceptance: the cards compile as the design says (default compiler, CR 903)', () => {
  it.each([
    'Command Tower', 'Arcane Signet', "Commander's Sphere", 'Stormsurge Kraken', "Commander's Insignia", 'Bastion Protector', 'Command Beacon', 'Edgar Markov',
    'Loyal Drake', 'Fierce Guardianship', 'Guardian Augmenter', 'Bloodsworn Steward', "Kraum, Ludevic's Opus", 'Titania, Protector of Argoth',
  ])('%s is fully automated', (name) => {
    expect(def(name).automation.level).toBe('full');
  });

  // std-typechange-1: Yuriko is full since ninjutsu names the returned creature's defender (CR 702.49c, keywords/data/ninjutsu.json)
  it('partial with the reasons the design gives: Opal Palace and Path of Ancestry (the mana is automated, the rider on spending it is manual); Yuriko is full (CR 702.49c)', () => {
    for (const name of ['Opal Palace', 'Path of Ancestry']) {
      const d = def(name);
      expect(d.automation.level, name).toBe('partial');
      expect(JSON.stringify(d.faces[0]!.abilities), name).not.toContain('commanderIdentity'); // the whole mana line is manual: never a mana ability without its rider
    }
    const y = def("Yuriko, the Tiger's Shadow");
    expect(y.automation.level).toBe('full');
    expect(y.faces[0]!.abilities[0]).toMatchObject({ kind: 'keyword', keyword: 'commander ninjutsu' });
  });

  it('CR 702.124j: "Partner with [name]" is the partner with keyword naming the other card (Pir and Toothy)', () => {
    expect(def('Pir, Imaginative Rascal').faces[0]!.abilities[0]).toMatchObject({ kind: 'keyword', keyword: 'partner with', filter: { name: 'Toothy, Imaginary Friend' } });
    expect(def('Toothy, Imaginary Friend').faces[0]!.abilities[0]).toMatchObject({ kind: 'keyword', keyword: 'partner with', filter: { name: 'Pir, Imaginative Rascal' } });
  });

  it('CR 113.6b: the eminence abilities function on the battlefield and in the command zone (Edgar Markov, The Ur-Dragon, Arahbo)', () => {
    expect(def('Edgar Markov').faces[0]!.abilities[0]).toMatchObject({ kind: 'triggered', zone: ['battlefield', 'command'], label: 'Eminence' });
    expect(def('The Ur-Dragon').faces[0]!.abilities[0]).toMatchObject({ kind: 'static', zone: ['battlefield', 'command'], label: 'Eminence' });
    expect(def('Arahbo, Roar of the World').faces[0]!.abilities[0]).toMatchObject({ kind: 'triggered', zone: ['battlefield', 'command'] });
  });
});

describe('M11-4 acceptance: Command Tower, Arcane Signet, Commander\'s Sphere (CR 903.4, 903.4f, 702.124c)', () => {
  const units = (s: GameState, name: string): string[][] => manaSources(s, 'p1').find((m) => s.defs[s.objects[m.objectId]!.defId]!.name === name)?.modes[0]?.units ?? [];

  it.each(['Command Tower', 'Arcane Signet', "Commander's Sphere"])('CR 702.124c: %s adds one mana of a color of Kraum and Tymna\'s combined identity (W, U, B, R)', (name) => {
    const s = commanderScenario({ p1Commanders: [KRAUM, TYMNA], p2Commanders: [BOB], cards: [name], p1: { battlefield: [name] } });
    expect(units(s, name)).toEqual([['W', 'U', 'B', 'R']]);
    const la = legalActions(s, 'p1').find((a) => a.kind === 'activate' && s.defs[s.objects[a.object!]!.defId]!.name === name && /Add/.test(a.label))!;
    const t = act(s, la.action);
    expect(t.pending).toMatchObject({ kind: 'chooseColor', options: ['W', 'U', 'B', 'R'] });
    expect(pool(answerUntilPriority(t, [{ kind: 'chooseColor', color: 'U' }]), 'p1')).toBe('U');
  });

  it('CR 903.4: with Titania alone the Tower adds {G} only', () => {
    const s = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], cards: ['Command Tower'], p1: { battlefield: ['Command Tower'] } });
    expect(units(s, 'Command Tower')).toEqual([['G']]);
  });

  it('CR 903.4f: outside a Commander game nobody has a commander: Command Tower and Arcane Signet add no mana', () => {
    const s = scenario(['Command Tower', 'Arcane Signet'], { p1: { battlefield: ['Command Tower', 'Arcane Signet'] } });
    expect(units(s, 'Command Tower')).toEqual([]);
    expect(units(s, 'Arcane Signet')).toEqual([]);
  });

  it("Commander's Sphere: sacrificing it draws a card (its second ability, any game)", () => {
    const s = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], cards: ["Commander's Sphere"], p1: { battlefield: ["Commander's Sphere"] } });
    const la = legalActions(s, 'p1').find((a) => a.kind === 'activate' && /Draw/.test(a.label))!;
    const hand = s.zones.hand['p1']!.length;
    const t = drive(pass(pass(drive(act(s, la.action)))));
    expect(t.zones.hand['p1']!.length).toBe(hand + 1);
  });
});

describe('M11-4 acceptance: Stormsurge Kraken, lieutenant (CR 903.3d)', () => {
  const setup = (titaniaOut: boolean): GameState => {
    const s = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], cards: ['Stormsurge Kraken', 'Titania, Protector of Argoth'], p1: { battlefield: ['Stormsurge Kraken', ...(titaniaOut ? ['Titania, Protector of Argoth'] : [])] } });
    return titaniaOut ? commanderOnBattlefield(s, 'Titania, Protector of Argoth') : s;
  };

  it('CR 903.3d: +2/+2 and the "becomes blocked" draw while you control your commander; nothing while it is in the command zone', () => {
    const on = setup(true);
    const kraken = onBattlefield(on, 'Stormsurge Kraken');
    expect(pt(on, kraken)).toBe('7/7');
    expect(getChars(on, kraken)!.abilities.some((a) => a.def.kind === 'triggered')).toBe(true);
    const off = setup(false);
    expect(pt(off, onBattlefield(off, 'Stormsurge Kraken'))).toBe('5/5');
    expect(getChars(off, onBattlefield(off, 'Stormsurge Kraken'))!.abilities.some((a) => a.def.kind === 'triggered')).toBe(false);
  });

  it('CR 903.3: a creature card named like your commander that is not the commander card does not count', () => {
    const s = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], cards: ['Stormsurge Kraken', 'Titania, Protector of Argoth'], p1: { battlefield: ['Stormsurge Kraken', 'Titania, Protector of Argoth'] } });
    expect(pt(s, onBattlefield(s, 'Stormsurge Kraken'))).toBe('5/5');
  });

  it('CR 903.3d: your commander under an opponent\'s control is not one you control', () => {
    const s = tweak(setup(true), (t) => { t.objects[onBattlefield(t, 'Titania, Protector of Argoth')]!.controller = 'p2'; });
    expect(pt(s, onBattlefield(s, 'Stormsurge Kraken'))).toBe('5/5');
  });
});

describe('M11-4 acceptance: Bastion Protector, "commander creatures you control" (CR 903.3d)', () => {
  it('CR 903.3d: your commander on the battlefield gets +2/+2 and indestructible; another creature does not', () => {
    let s = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], cards: ['Bastion Protector', 'Titania, Protector of Argoth', 'Loyal Drake'], p1: { battlefield: ['Bastion Protector', 'Titania, Protector of Argoth', 'Loyal Drake'] } });
    s = commanderOnBattlefield(s, 'Titania, Protector of Argoth');
    const titania = onBattlefield(s, 'Titania, Protector of Argoth');
    expect(pt(s, titania)).toBe('7/5');
    expect(hasKeyword(getChars(s, titania)!, 'indestructible')).toBe(true);
    expect(pt(s, onBattlefield(s, 'Loyal Drake'))).toBe('2/2'); // Loyal Drake: 2/2, not a commander
    expect(hasKeyword(getChars(s, onBattlefield(s, 'Bastion Protector'))!, 'indestructible')).toBe(false);
  });
});

describe("M11-4 acceptance: Commander's Insignia (CR 903.8)", () => {
  it('CR 903.8: creatures you control get +1/+1 for each time you have cast your commander from the command zone this game', () => {
    let s = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], cards: ["Commander's Insignia", 'Loyal Drake'], p1: { battlefield: ["Commander's Insignia", 'Loyal Drake', ...forests(5)] } });
    const drake = onBattlefield(s, 'Loyal Drake');
    expect(pt(s, drake)).toBe('2/2');
    // cast Titania from the command zone (M11-1's runtime counts the cast as it becomes cast, CR 601.2i)
    const cast = legalActions(s, 'p1').find((a) => a.kind === 'cast' && a.object === inCommand(s, 'Titania, Protector of Argoth'))!;
    s = drive(act(s, cast.action));
    expect(commanderRec(s, 'p1', 'Titania, Protector of Argoth').casts).toBe(1);
    expect(pt(s, drake)).toBe('3/3');
    s = tweak(s, (t) => { t.players[0]!.commanders![0]!.casts = 3; });
    expect(pt(s, drake)).toBe('5/5');
    // the opponent's casts are theirs
    s = tweak(s, (t) => { t.players[1]!.commanders![0]!.casts = 4; });
    expect(pt(s, drake)).toBe('5/5');
  });
});

describe('M11-4 acceptance: Command Beacon (CR 903.3, 702.124e, 903.9b)', () => {
  const activate = (s: GameState): GameState => {
    const la = legalActions(s, 'p1').find((a) => a.kind === 'activate' && /Put your commander/i.test(a.label) || (a.kind === 'activate' && /Sacrifice/.test(a.label)))!;
    return act(s, la.action);
  };

  it('puts your commander into your hand from the command zone; its owner may let it go there (CR 903.9b: the replacement is optional)', () => {
    const s = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], cards: ['Command Beacon'], p1: { battlefield: ['Command Beacon'] } });
    let asked = false;
    const t = drive(pass(pass(drive(activate(s)))), (d) => (d.kind === 'commanderZone' ? ((asked = true), { kind: 'commanderZone', command: false }) : undefined));
    expect(asked).toBe(true);
    expect(inHand(t, 'Titania, Protector of Argoth')).toBe(true);
    expect(t.zones.command.some((id) => t.defs[t.objects[id]!.defId]!.name === 'Titania, Protector of Argoth')).toBe(false);
    expect(t.zones.graveyard['p1']!.some((id) => t.defs[t.objects[id]!.defId]!.name === 'Command Beacon')).toBe(true);
  });

  it('CR 702.124e: with two commanders in the command zone, you choose which one', () => {
    const s = commanderScenario({ p1Commanders: [KRAUM, TYMNA], p2Commanders: [BOB], cards: ['Command Beacon'], p1: { battlefield: ['Command Beacon'] } });
    let options = 0;
    const t = drive(pass(pass(drive(activate(s)))), (d) => {
      if (d.kind !== 'chooseObjects') return undefined;
      options = d.options.length;
      return { kind: 'chooseObjects', ids: [d.options.find((id) => s.defs[s.objects[id]?.defId ?? '']?.name === 'Tymna the Weaver') ?? d.options[1]!] };
    });
    expect(options).toBe(2);
    expect(inHand(t, 'Tymna the Weaver')).toBe(true);
    expect(inHand(t, "Kraum, Ludevic's Opus")).toBe(false);
  });

  it('CR 903.9b: its owner may put it back into the command zone instead', () => {
    const s = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], cards: ['Command Beacon'], p1: { battlefield: ['Command Beacon'] } });
    const t = drive(pass(pass(drive(activate(s)))), (d) => (d.kind === 'commanderZone' ? { kind: 'commanderZone', command: true } : undefined));
    expect(inHand(t, 'Titania, Protector of Argoth')).toBe(false);
    expect(t.zones.command.some((id) => t.defs[t.objects[id]!.defId]!.name === 'Titania, Protector of Argoth')).toBe(true);
  });
});

describe('M11-4 acceptance: Pir and Toothy, partner with (CR 702.124j)', () => {
  it('CR 702.124j: when Pir enters, target player may search their library for Toothy, reveal it and put it into their hand, then shuffle', () => {
    let s = scenario(['Pir, Imaginative Rascal', 'Toothy, Imaginary Friend', 'Forest'], { p1: { hand: ['Pir, Imaginative Rascal'], library: ['Toothy, Imaginary Friend'], battlefield: ['Forest', 'Forest', 'Forest'] } });
    s = drive(castAuto(s, 'Pir, Imaginative Rascal'));
    s = drive(pass(pass(s))); // Pir resolves; its trigger is put on the stack (target: Alice)
    expect(s.zones.stack.length).toBe(1);
    s = drive(pass(pass(s)));
    expect(inHand(s, 'Toothy, Imaginary Friend')).toBe(true);
  });

  it('the target player may decline: nothing is searched', () => {
    let s = scenario(['Pir, Imaginative Rascal', 'Toothy, Imaginary Friend', 'Forest'], { p1: { hand: ['Pir, Imaginative Rascal'], library: ['Toothy, Imaginary Friend'], battlefield: ['Forest', 'Forest', 'Forest'] } });
    s = drive(castAuto(s, 'Pir, Imaginative Rascal'));
    s = drive(pass(pass(s)));
    s = drive(pass(pass(s)), (d) => (d.kind === 'yesNo' ? { kind: 'yesNo', yes: false } : undefined));
    expect(inHand(s, 'Toothy, Imaginary Friend')).toBe(false);
  });
});

describe("M11-4 acceptance: Yuriko, the Tiger's Shadow, commander ninjutsu (CR 702.49d)", () => {
  const YURIKO = def("Yuriko, the Tiger's Shadow");
  const BEAR = card('Test Sneaky Bear', '{1}', 'Creature — Bear', '', ['1', '1']);

  it('CR 702.49d: listed from the command zone once an unblocked attacker exists; the commander enters tapped and attacking, no cast is counted (CR 903.8)', () => {
    let s = commanderScenario({ p1Commanders: [YURIKO], p2Commanders: [BOB], cards: ['Island', 'Swamp'], defs: [BEAR], p1: { battlefield: ['Island', 'Swamp', 'Test Sneaky Bear'] } });
    const yurikoCard = inCommand(s, "Yuriko, the Tiger's Shadow");
    expect(legalActions(s, 'p1').some((a) => a.kind === 'activate' && a.object === yurikoCard)).toBe(false); // CR 702.49a: only after blockers are declared
    const bear = onBattlefield(s, 'Test Sneaky Bear');
    s = runCombat(s, { attack: [[bear]], until: 'declareBlockers' });
    const la = legalActions(s, 'p1').find((a) => a.kind === 'activate' && a.object === inCommand(s, "Yuriko, the Tiger's Shadow"));
    expect(la).toBeDefined();
    s = drive(act(s, la!.action));
    s = drive(pass(pass(s))); // CR 702.49c: attacking what the returned creature attacked (no manual step since std-typechange-1)
    const yuriko = s.zones.battlefield.find((id) => s.defs[s.objects[id]!.defId]!.name === "Yuriko, the Tiger's Shadow");
    expect(yuriko).toBeDefined();
    expect(s.objects[yuriko!]!.tapped).toBe(true);
    expect(commanderRec(s, 'p1', "Yuriko, the Tiger's Shadow").casts).toBe(0);
    expect(commanderTax(s, commanderRec(s, 'p1', "Yuriko, the Tiger's Shadow").card)).toBe(0);
  });
});

describe('M11-4 acceptance: eminence from the command zone (CR 113.6b; Edgar Markov, The Ur-Dragon)', () => {
  const VAMPIRE = card('Test Vampire', '{G}', 'Creature — Vampire', '', ['1', '1']);
  const DRAGON = card('Test Dragon', '{2}{G}', 'Creature — Dragon', '', ['3', '3']);

  it('Edgar Markov: casting another Vampire spell while Edgar is in the command zone creates a 1/1 black Vampire', () => {
    let s = commanderScenario({ p1Commanders: [def('Edgar Markov')], p2Commanders: [BOB], defs: [VAMPIRE], p1: { hand: ['Test Vampire'], battlefield: forests(1) } });
    s = drive(castAuto(s, 'Test Vampire'));
    expect(s.zones.stack.length).toBe(2); // the spell and the eminence trigger above it
    s = drive(pass(pass(s)));
    const tokens = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(tokens.length).toBe(1);
    const c = getChars(s, tokens[0]!)!;
    expect([String(c.power), String(c.toughness), c.subtypes, c.colors]).toEqual(['1', '1', ['Vampire'], ['B']]);
  });

  it('The Ur-Dragon: other Dragon spells cost {1} less while it is in the command zone (a {2}{G} Dragon with two Forests)', () => {
    const s = commanderScenario({ p1Commanders: [def('The Ur-Dragon')], p2Commanders: [BOB], defs: [DRAGON], p1: { hand: ['Test Dragon'], battlefield: forests(2) } });
    expect(legalActions(s, 'p1').some((a) => a.kind === 'cast' && a.label === 'Cast Test Dragon')).toBe(true);
    const plain = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], defs: [DRAGON], p1: { hand: ['Test Dragon'], battlefield: forests(2) } });
    expect(legalActions(plain, 'p1').some((a) => a.kind === 'cast' && a.label === 'Cast Test Dragon')).toBe(false);
  });
});

describe('M11-4 acceptance: Loyal Drake, a lieutenant trigger (CR 903.3d, 603.4)', () => {
  it('at the beginning of combat on your turn, if you control your commander, draw a card; not when it is in the command zone', () => {
    const run = (out: boolean): number => {
      let s = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], cards: ['Loyal Drake', 'Titania, Protector of Argoth'], p1: { battlefield: ['Loyal Drake', ...(out ? ['Titania, Protector of Argoth'] : [])] } });
      if (out) s = commanderOnBattlefield(s, 'Titania, Protector of Argoth');
      const before = s.zones.hand['p1']!.length;
      s = toStep(s, 'beginCombat');
      if (s.zones.stack.length > 0) s = drive(pass(pass(s)), (d) => (d.kind === 'declareAttackers' ? { kind: 'declareAttackers', attacks: [] } : undefined));
      return s.zones.hand['p1']!.length - before;
    };
    expect(run(true)).toBe(1);
    expect(run(false)).toBe(0);
  });
});
