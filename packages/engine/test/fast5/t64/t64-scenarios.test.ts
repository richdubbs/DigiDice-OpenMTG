/**
 * FAST5 T64: the shapes of parser/templates/zz-fast5/t64.json (and the engine, render and parser support they needed) played through the engine with the
 * real fixture cards they read, compiled by the game's default compiler. Each test is named after the rule it checks.
 *
 *   CR 707.2, 611.2c, 613.2a   Mirrorform: each nonland permanent you control becomes a copy of one permanent, the set fixed as the spell resolves
 *   CR 707.9b, 205.4a          Shuri: becomes a copy of a second target until end of turn, except it isn't legendary; the effect ends at the cleanup step
 *   CR 707.5, 707.9c           Chameleon: enters as a copy of a creature you control, and keeps its own name
 *   CR 707.5, 707.9b, 202.3    Mockingbird: copies a creature whose mana value is at most the mana spent to cast it, and is a Bird with flying
 *   CR 707.5, 614.1c, 707.2    Echoing Deeps: enters tapped as a copy of a land card in a graveyard (a card's copiable values), a Cave too
 *   CR 707.2, 111.1, 603.4     The Notary Hobbits and Ran and Shaw: token copies of the permanent itself, not legendary, behind an intervening "if"
 *   CR 608.2f, 110.5b          Kambal and Doppelgang: one copy per object, tapped or X of them
 *   CR 707.4, 707.9b-c         Taskmaster and Absorbing Man: until your next turn, a copy of a permanent or a graveyard card with a kept name and a new identity
 *   CR 709.5, 707.9b           Mirror Room: a token copy that is a Reflection in addition to its other creature types
 *   CR 607.2a, 608.2d          Lazav: becomes a copy of one of the creature cards exiled with it, chosen as the effect begins
 */
import { describe, expect, it } from 'vitest';
import { getChars, ptNumbers, type GameState, type ObjectId } from '../../../src/index';
import { act, advanceTo, find, pass, passBoth, put, scenario } from '../../m5/helpers';
import { activate, cast, drive, gamePath, resolveAll, resolveTop, target } from '../../m5/cr-examples/helpers';
import { synthetic } from '../../m6/costs/support';
import { answer, looks, pick } from '../../m6/copy/support';

const lands = (n: number, name = 'Island'): string[] => Array(n).fill(name) as string[];
const noManual = (name: string): string[] => gamePath(name).faces.flatMap((f) => f.abilities).filter((a) => a.kind === 'manual').map((a) => a.text);
const onField = (s: GameState, name: string): ObjectId[] => s.zones.battlefield.filter((id) => getChars(s, id).name === name);

describe('the cards of T64 are full on the game path', () => {
  for (const name of ['Mirror Room // Fractured Realm', 'Mirrorform', 'Kambal, Profiteering Mayor', 'Shuri, Wakandan Inventor', 'Taskmaster, Mercenary Mimic', 'Absorbing Man', 'Chameleon, Master of Disguise', 'Mockingbird', 'Echoing Deeps', 'The Notary Hobbits', 'Ran and Shaw', 'Doppelgang', 'Lazav, Wearer of Faces']) {
    it(`${name}: no manual ability, level full`, () => {
      expect(noManual(name)).toEqual([]);
      expect(gamePath(name).automation.level).toBe('full');
    });
  }
});

describe('CR 707.2, 611.2c, 613.2a: Mirrorform (each nonland permanent you control becomes a copy of target non-Aura permanent)', () => {
  const board = (): GameState => scenario(['Mirrorform', 'Grizzly Bears', 'Mulldrifter', 'Island', 'Runeclaw Bear'], {
    p1: { hand: ['Mirrorform'], battlefield: [...lands(6), 'Grizzly Bears', 'Runeclaw Bear'] }, p2: { battlefield: ['Mulldrifter'] },
  });
  it('every nonland permanent of the controller becomes a copy; lands do not; the copied permanent stays as it is', () => {
    let s = board();
    const drifter = find(s, 'Mulldrifter', 'battlefield', 'p2');
    s = resolveTop(cast(s, 'Mirrorform', [target(drifter)]));
    for (const name of ['Grizzly Bears', 'Runeclaw Bear']) {
      expect(looks(s, find(s, name, 'battlefield')).name, name).toBe('Mulldrifter');
    }
    const copies = s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && getChars(s, id).name === 'Mulldrifter');
    expect(copies).toHaveLength(2);
    for (const id of copies) {
      expect(ptNumbers(getChars(s, id))).toMatchObject({ power: 2, toughness: 2 });
      expect(getChars(s, id).keywords.map((k) => k.keyword)).toContain('flying');
    }
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && getChars(s, id).name === 'Island')).toHaveLength(6);
    expect(looks(s, drifter).name).toBe('Mulldrifter');
  });
  it("CR 611.2c: a permanent that comes under the controller's control later is not affected (the set is fixed as the spell resolves)", () => {
    let s = board();
    const drifter = find(s, 'Mulldrifter', 'battlefield', 'p2');
    s = resolveTop(cast(s, 'Mirrorform', [target(drifter)]));
    const t = structuredClone(s);
    const late = put(t, 'p1', 'battlefield', 'Grizzly Bears');
    expect(looks(t, late).name).toBe('Grizzly Bears');
    expect(t.continuousEffects.filter((e) => e.copy !== undefined)).toHaveLength(1);
    expect(t.continuousEffects.find((e) => e.copy !== undefined)!.effect).toMatchObject({ s: 'continuous', affects: { ref: 'fixed' } });
  });
});

describe('CR 707.9b, 205.4a, 611.2a: Shuri (a second target artifact, until end of turn, not legendary)', () => {
  const RELIC = synthetic('Test Legend Relic', 'Legendary Artifact', '{2}', '{T}: Add {C}.');
  const board = (): GameState => scenario(['Shuri, Wakandan Inventor', 'Bonesplitter', 'Island'], {
    p1: { battlefield: ['Shuri, Wakandan Inventor', 'Bonesplitter', 'Test Legend Relic', ...lands(2)] }, defs: [RELIC],
  });
  it('the first artifact becomes a copy of the second until end of turn, and is not legendary', () => {
    let s = board();
    const bone = find(s, 'Bonesplitter', 'battlefield');
    const relic = find(s, 'Test Legend Relic', 'battlefield');
    s = activate(s, find(s, 'Shuri, Wakandan Inventor', 'battlefield'), [target(bone), target(relic)], /becomes a copy/i);
    s = resolveAll(s);
    expect(getChars(s, bone).name).toBe('Test Legend Relic');
    expect(getChars(s, bone).supertypes).not.toContain('Legendary'); // so the legend rule does not apply to the two (CR 704.5j)
    expect(s.zones.battlefield).toContain(relic);
    expect(getChars(s, relic).supertypes).toContain('Legendary');
    expect(s.zones.battlefield).toContain(bone);
  });
  it('CR 514.2: it is Bonesplitter again after the cleanup step', () => {
    let s = board();
    const bone = find(s, 'Bonesplitter', 'battlefield');
    s = activate(s, find(s, 'Shuri, Wakandan Inventor', 'battlefield'), [target(bone), target(find(s, 'Test Legend Relic', 'battlefield'))], /becomes a copy/i);
    s = resolveAll(s);
    s = advanceTo(s, 2, 'upkeep');
    expect(getChars(s, bone).name).toBe('Bonesplitter');
  });
});

describe('CR 707.5, 707.9c: Chameleon (enters as a copy of a creature you control, and keeps its name)', () => {
  const board = (): GameState => scenario(['Chameleon, Master of Disguise', 'Mulldrifter', 'Island'], {
    p1: { hand: ['Chameleon, Master of Disguise'], battlefield: [...lands(4), 'Mulldrifter'] },
  });
  it('is the copied creature in every way but the name, which is its own', () => {
    let s = board();
    s = resolveTop(cast(s, 'Chameleon, Master of Disguise'));
    expect((s.pending as { options: string[] }).options).toEqual([find(s, 'Mulldrifter', 'battlefield')]); // only creatures its controller controls
    s = drive(s, [pick(find(s, 'Mulldrifter', 'battlefield'))]);
    const c = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Chameleon, Master of Disguise')!;
    expect(looks(s, c)).toMatchObject({ name: 'Chameleon, Master of Disguise', pt: [2, 2], colors: ['U'] }); // Mulldrifter's 2/2, Chameleon's own name
    expect(getChars(s, c).keywords.map((k) => k.keyword)).toContain('flying');
  });
  it('CR 707.2: a Clone-style copy of the copy has the kept name too (it is part of the copiable values)', () => {
    let s = board();
    s = drive(resolveTop(cast(s, 'Chameleon, Master of Disguise')), [pick(find(s, 'Mulldrifter', 'battlefield'))]);
    const c = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Chameleon, Master of Disguise')!;
    // the stored copy effect names the copied object's copiable values: name included (statics/copy.ts#copiableOrWhy)
    const rec = s.continuousEffects.find((e) => e.copy !== undefined)!;
    expect(rec.copy!.name).toBe('Chameleon, Master of Disguise');
    expect(getChars(s, c).names).toEqual(['Chameleon, Master of Disguise']);
  });
  it('"you may": it enters as itself when no creature is chosen', () => {
    let s = board();
    s = drive(resolveTop(cast(s, 'Chameleon, Master of Disguise')), [pick()]);
    const c = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Chameleon, Master of Disguise')!;
    expect(looks(s, c)).toMatchObject({ name: 'Chameleon, Master of Disguise', pt: [2, 3] });
  });
});

describe('CR 707.5, 707.9b, 202.3: Mockingbird (a creature whose mana value is at most the mana spent, a Bird with flying)', () => {
  const board = (): GameState => scenario(['Mockingbird', 'Grizzly Bears', 'Mulldrifter', 'Island'], {
    p1: { hand: ['Mockingbird'], battlefield: lands(8) }, p2: { battlefield: ['Grizzly Bears', 'Mulldrifter'] },
  });
  it('offers only creatures with mana value at most the mana spent to cast it, X included', () => {
    let s = board();
    s = cast(s, 'Mockingbird', [{ kind: 'chooseNumber', n: 2 }]);
    s = resolveTop(s);
    const options = (s.pending as { options: string[] }).options;
    expect(options).toEqual([find(s, 'Grizzly Bears', 'battlefield', 'p2')]); // {X}{U} with X = 2 is 3 mana: Mulldrifter (mana value 5) is out
  });
  it('is the copy, a Bird in addition to its other types, with flying', () => {
    let s = board();
    s = resolveTop(cast(s, 'Mockingbird', [{ kind: 'chooseNumber', n: 2 }]));
    s = drive(s, [pick(find(s, 'Grizzly Bears', 'battlefield', 'p2'))]);
    const m = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Mockingbird')!;
    expect(looks(s, m)).toMatchObject({ name: 'Grizzly Bears', pt: [2, 2], subtypes: ['Bear', 'Bird'] });
    expect(getChars(s, m).keywords.map((k) => k.keyword)).toContain('flying');
  });
  it('X = 5 (six mana) offers both', () => {
    let s = board();
    s = resolveTop(cast(s, 'Mockingbird', [{ kind: 'chooseNumber', n: 5 }]));
    expect((s.pending as { options: string[] }).options.sort()).toEqual([find(s, 'Grizzly Bears', 'battlefield', 'p2'), find(s, 'Mulldrifter', 'battlefield', 'p2')].sort());
  });
});

describe('CR 707.5, 614.1c, 707.2: Echoing Deeps (enters tapped as a copy of a land card in a graveyard, a Cave too)', () => {
  const board = (): GameState => scenario(['Echoing Deeps', 'Forest', 'Island', 'Mountain', 'Grizzly Bears'], {
    p1: { hand: ['Echoing Deeps'], graveyard: ['Forest', 'Grizzly Bears'] }, p2: { graveyard: ['Mountain'] },
  });
  it('offers the land cards of every graveyard, and nothing else', () => {
    let s = board();
    s = act(s, { type: 'playLand', player: 'p1', card: find(s, 'Echoing Deeps', 'hand') });
    expect((s.pending as { options: string[] }).options.sort()).toEqual([find(s, 'Forest', 'graveyard'), find(s, 'Mountain', 'graveyard', 'p2')].sort());
  });
  it('the copy of the card is a tapped Forest Cave named Forest, and the card stays in the graveyard', () => {
    let s = board();
    const forest = find(s, 'Forest', 'graveyard');
    s = act(s, { type: 'playLand', player: 'p1', card: find(s, 'Echoing Deeps', 'hand') });
    s = answer(s, pick(forest));
    const deeps = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Echoing Deeps')!;
    expect(s.objects[deeps]!.tapped).toBe(true);
    expect(looks(s, deeps)).toMatchObject({ name: 'Forest', types: ['Land'] });
    expect(looks(s, deeps).subtypes.sort()).toEqual(['Cave', 'Forest']);
    expect(s.zones.graveyard.p1).toContain(forest); // CR 707.2: a copy of the card is not the card
  });
  it('"you may": declining leaves the untapped Echoing Deeps with its own ability', () => {
    let s = board();
    s = act(s, { type: 'playLand', player: 'p1', card: find(s, 'Echoing Deeps', 'hand') });
    s = answer(s, pick());
    const deeps = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Echoing Deeps')!;
    expect(s.objects[deeps]!.tapped).toBe(false);
    expect(looks(s, deeps)).toMatchObject({ name: 'Echoing Deeps', subtypes: ['Cave'] });
  });
});

describe('CR 707.2, 603.4, 111.1: The Notary Hobbits (when they enter, if they are not a token, two tokens that are copies, not legendary)', () => {
  it('creates two nonlegendary token copies; the copies do not do it again (they are tokens)', () => {
    let s = scenario(['The Notary Hobbits', 'Forest'], { p1: { hand: ['The Notary Hobbits'], battlefield: lands(5, 'Forest') } });
    s = resolveAll(resolveTop(cast(s, 'The Notary Hobbits')));
    const all = onField(s, 'The Notary Hobbits');
    expect(all).toHaveLength(3);
    expect(all.filter((id) => s.objects[id]!.kind === 'token')).toHaveLength(2);
    for (const id of all.filter((x) => s.objects[x]!.kind === 'token')) expect(getChars(s, id).supertypes).not.toContain('Legendary');
    expect(getChars(s, all.find((x) => s.objects[x]!.kind === 'card')!).supertypes).toContain('Legendary');
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token')).toHaveLength(2); // the tokens\' own triggers did nothing (CR 603.4)
  });
});

describe('CR 603.4, 601.2a, 707.2: Ran and Shaw (if you cast them and there are three or more Dragon and/or Lesson cards in your graveyard)', () => {
  const DRAGON = synthetic('Test Dragon Card', 'Creature — Dragon', '{1}{R}', 'Flying');
  const LESSON = synthetic('Test Lesson Card', 'Sorcery — Lesson', '{R}', 'Draw a card.');
  const board = (graveyard: string[]): GameState => scenario(['Ran and Shaw', 'Mountain'], { p1: { hand: ['Ran and Shaw'], battlefield: lands(5, 'Mountain'), graveyard }, defs: [DRAGON, LESSON] });
  it('with three such cards, the cast permanent makes one nonlegendary token copy of itself', () => {
    let s = board(['Test Dragon Card', 'Test Dragon Card', 'Test Lesson Card']);
    s = resolveAll(resolveTop(cast(s, 'Ran and Shaw')));
    const all = onField(s, 'Ran and Shaw');
    expect(all).toHaveLength(2);
    const token = all.find((id) => s.objects[id]!.kind === 'token')!;
    expect(token).toBeDefined();
    expect(getChars(s, token).supertypes).not.toContain('Legendary');
    expect(getChars(s, all.find((id) => id !== token)!).supertypes).toContain('Legendary');
  });
  it('with only two such cards (the condition is checked as it triggers and as it resolves), no token', () => {
    let s = board(['Test Dragon Card', 'Test Lesson Card']);
    s = resolveAll(resolveTop(cast(s, 'Ran and Shaw')));
    expect(onField(s, 'Ran and Shaw')).toHaveLength(1);
  });
  it('"cast them": a copy that enters without being cast does not trigger the token', () => {
    const s0 = board(['Test Dragon Card', 'Test Dragon Card', 'Test Lesson Card']);
    const s = structuredClone(s0);
    put(s, 'p1', 'battlefield', 'Ran and Shaw'); // put there, not cast
    expect(s.zones.stack).toEqual([]);
  });
});

describe('CR 608.2f, 110.5b: Kambal (for each token an opponent\'s tokens that entered, a tapped token that is a copy of it)', () => {
  it("copies each of the tokens that entered together, tapped, under Kambal's controller; the copies drain the opponent", () => {
    let s = scenario(['Kambal, Profiteering Mayor', 'Raise the Alarm', 'Plains'], {
      p1: { battlefield: ['Kambal, Profiteering Mayor'] }, p2: { hand: ['Raise the Alarm'], battlefield: lands(2, 'Plains') },
    });
    const life = [s.players[0]!.life, s.players[1]!.life];
    s = pass(s); // p1 passes priority: p2 may cast an instant
    s = resolveTop(cast(s, 'Raise the Alarm', [], 'p2'));
    // two Soldier tokens entered under p2's control at once: Kambal's trigger, then the copies' trigger of its second ability
    s = resolveAll(s);
    const mine = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === 'p1');
    expect(mine).toHaveLength(2);
    for (const id of mine) {
      expect(s.objects[id]!.tapped).toBe(true);
      expect(looks(s, id)).toMatchObject({ name: 'Soldier Token', pt: [1, 1], colors: ['W'] });
    }
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === 'p2')).toHaveLength(2);
    // the second ability: one or more tokens entered under p1's control (the copies, at once): each opponent loses 1 life and p1 gains 1
    expect([s.players[0]!.life, s.players[1]!.life]).toEqual([life[0]! + 1, life[1]! - 1]);
  });
});

describe('CR 608.2f, 601.2c, 107.3: Doppelgang (for each of X target permanents, X tokens that are copies of that permanent)', () => {
  it('X = 2: two targets, two token copies of each (four tokens), the permanents themselves stay', () => {
    let s = scenario(['Doppelgang', 'Grizzly Bears', 'Mulldrifter', 'Island', 'Forest'], {
      p1: { hand: ['Doppelgang'], battlefield: [...lands(4), ...lands(4, 'Forest'), 'Grizzly Bears'] }, p2: { battlefield: ['Mulldrifter'] },
    });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const drifter = find(s, 'Mulldrifter', 'battlefield', 'p2');
    s = cast(s, 'Doppelgang', [{ kind: 'chooseNumber', n: 2 }, target(bears, drifter)]);
    s = resolveAll(s);
    const tokens = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(tokens.map((id) => getChars(s, id).name).sort()).toEqual(['Grizzly Bears', 'Grizzly Bears', 'Mulldrifter', 'Mulldrifter']);
    expect(tokens.every((id) => s.objects[id]!.controller === 'p1')).toBe(true);
  });
  it('X = 0: nothing is targeted and nothing is created', () => {
    let s = scenario(['Doppelgang', 'Island', 'Forest'], { p1: { hand: ['Doppelgang'], battlefield: [...lands(2), ...lands(2, 'Forest')] } });
    s = resolveAll(cast(s, 'Doppelgang', [{ kind: 'chooseNumber', n: 0 }]));
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token')).toEqual([]);
  });
});

/** The scenario starts as the first main phase of turn 1 begins: the "first main phase" trigger is already waiting for its target. */
const toFirstMain = (s: GameState): GameState => {
  if (s.pending?.kind !== 'chooseTargets') throw new Error(`expected the trigger's targets, found ${s.pending?.kind}`);
  return s;
};

describe('CR 707.4, 707.9b-c, 611.2a: Taskmaster (until your next turn, a copy of a creature or a creature card in a graveyard, named Taskmaster, a legendary Human Mercenary Villain creature)', () => {
  const board = (): GameState => scenario(['Taskmaster, Mercenary Mimic', 'Mulldrifter', 'Grizzly Bears', 'Island'], {
    p1: { battlefield: ['Taskmaster, Mercenary Mimic'], graveyard: ['Grizzly Bears'] }, p2: { battlefield: ['Mulldrifter'] },
  });
  it('offers the creatures on the battlefield and the creature cards in graveyards (up to one)', () => {
    const s = toFirstMain(board());
    expect(s.pending).toMatchObject({ kind: 'chooseTargets', player: 'p1', min: 0, max: 1 });
    const p = s.pending as { objects: string[] };
    expect([...p.objects].sort()).toEqual([find(s, 'Taskmaster, Mercenary Mimic', 'battlefield'), find(s, 'Mulldrifter', 'battlefield', 'p2'), find(s, 'Grizzly Bears', 'graveyard')].sort());
  });
  it('a copy of a creature card in a graveyard: its P/T and abilities, its own name, a legendary Human Mercenary Villain creature; the card stays', () => {
    let s = toFirstMain(board());
    const bears = find(s, 'Grizzly Bears', 'graveyard');
    s = drive(s, [target(bears)]);
    s = resolveAll(s);
    const t = find(s, 'Taskmaster, Mercenary Mimic', 'battlefield');
    expect(looks(s, t)).toMatchObject({ name: 'Taskmaster, Mercenary Mimic', pt: [2, 2], types: ['Creature'], colors: ['G'] });
    expect(looks(s, t).subtypes.sort()).toEqual(['Human', 'Mercenary', 'Villain']);
    expect(getChars(s, t).supertypes).toEqual(['Legendary']);
    expect(s.zones.graveyard.p1).toContain(bears);
  });
  it('CR 611.2a: it is Taskmaster again as your next turn begins, not before', () => {
    let s = toFirstMain(board());
    s = resolveAll(drive(s, [target(find(s, 'Mulldrifter', 'battlefield', 'p2'))]));
    const t = find(s, 'Taskmaster, Mercenary Mimic', 'battlefield');
    expect(looks(s, t).pt).toEqual([2, 2]);
    expect(getChars(s, t).keywords.map((k) => k.keyword)).toContain('flying');
    s = advanceTo(s, 2, 'end');
    expect(looks(s, t).pt).toEqual([2, 2]); // still the copy during the opponent's turn
    s = advanceTo(s, 3, 'upkeep');
    expect(looks(s, t)).toMatchObject({ name: 'Taskmaster, Mercenary Mimic', pt: [3, 5] });
  });
  it('"up to one": with no target it stays Taskmaster', () => {
    let s = toFirstMain(board());
    s = resolveAll(drive(s, [target()]));
    expect(looks(s, find(s, 'Taskmaster, Mercenary Mimic', 'battlefield')).pt).toEqual([3, 5]);
  });
});

describe('CR 707.4, 707.9b-c, 613.4b: Absorbing Man (until your next turn, a copy of an artifact, non-Aura enchantment or land, a legendary 4/4 Human Villain creature too, with vigilance)', () => {
  const board = (): GameState => scenario(['Absorbing Man', 'Forest', 'Bonesplitter', 'Grizzly Bears', 'Island'], {
    p1: { battlefield: ['Absorbing Man'] }, p2: { battlefield: ['Forest', 'Bonesplitter', 'Grizzly Bears'] },
  });
  it('offers artifacts, enchantments that are not Auras and lands, and no creature that is none of them', () => {
    const s = toFirstMain(board());
    const p = s.pending as { objects: string[] };
    expect([...p.objects].sort()).toEqual([find(s, 'Forest', 'battlefield', 'p2'), find(s, 'Bonesplitter', 'battlefield', 'p2')].sort());
  });
  it('a copy of a Forest: a land creature named Absorbing Man, 4/4, legendary, Forest Human Villain, with vigilance, in addition to its other types', () => {
    let s = toFirstMain(board());
    s = resolveAll(drive(s, [target(find(s, 'Forest', 'battlefield', 'p2'))]));
    const a = find(s, 'Absorbing Man', 'battlefield');
    expect(looks(s, a)).toMatchObject({ name: 'Absorbing Man', pt: [4, 4] });
    expect(looks(s, a).types.sort()).toEqual(['Creature', 'Land']);
    expect(looks(s, a).subtypes.sort()).toEqual(['Forest', 'Human', 'Villain']);
    expect([...getChars(s, a).supertypes].sort()).toEqual(['Basic', 'Legendary']); // the copied Forest is basic, and legendary in addition to its other types
    expect(getChars(s, a).keywords.map((k) => k.keyword)).toContain('vigilance');
    s = advanceTo(s, 3, 'upkeep');
    expect(looks(s, a)).toMatchObject({ name: 'Absorbing Man', pt: [4, 4], types: ['Creature'], subtypes: ['Human', 'Villain'] });
  });
  it('a copy of Bonesplitter: an artifact creature, 4/4 (the copied Equipment has no power or toughness of its own)', () => {
    let s = toFirstMain(board());
    s = resolveAll(drive(s, [target(find(s, 'Bonesplitter', 'battlefield', 'p2'))]));
    const a = find(s, 'Absorbing Man', 'battlefield');
    expect(looks(s, a).types.sort()).toEqual(['Artifact', 'Creature']);
    expect(looks(s, a).pt).toEqual([4, 4]);
  });
});

describe('CR 709.5, 707.9b: Mirror Room (when you unlock this door, a token copy of a creature you control that is a Reflection too)', () => {
  it('the token has the creature types of the copied creature and Reflection', () => {
    let s = scenario(['Mirror Room // Fractured Realm', 'Grizzly Bears', 'Island'], { p1: { hand: ['Mirror Room // Fractured Realm'], battlefield: [...lands(3), 'Grizzly Bears'] } });
    s = cast(s, 'Mirror Room // Fractured Realm');
    s = resolveTop(s);
    s = drive(s, [target(find(s, 'Grizzly Bears', 'battlefield'))]);
    s = resolveAll(s);
    const tokens = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(tokens).toHaveLength(1);
    expect(looks(s, tokens[0]!)).toMatchObject({ name: 'Grizzly Bears', pt: [2, 2] });
    expect(looks(s, tokens[0]!).subtypes.sort()).toEqual(['Bear', 'Reflection']);
  });
});

describe('CR 607.2a, 608.2d, 707.4: Lazav, Wearer of Faces (you may have Lazav become a copy of a creature card exiled with it until end of turn)', () => {
  const board = (): GameState => scenario(['Lazav, Wearer of Faces', 'Mulldrifter', 'Grizzly Bears', 'Island', 'Forest'], {
    p1: { battlefield: ['Lazav, Wearer of Faces', ...lands(4)], graveyard: ['Mulldrifter', 'Forest'] }, p2: { graveyard: ['Grizzly Bears'] },
  });
  /** Lazav attacks in `turn`, exiling `exiled` (a card of a graveyard) and investigating. */
  function attack(s0: GameState, turn: number, exiled: ObjectId): GameState {
    let s = advanceTo(s0, turn, 'declareAttackers');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Lazav, Wearer of Faces', 'battlefield'), defender: 'p2' }] });
    return resolveAll(drive(s, [target(exiled)]));
  }
  /** A Clue is sacrificed (its own ability): Lazav's second ability triggers and its controller answers `answers`. */
  function sacrificeClue(s0: GameState, answers: Parameters<typeof drive>[1]): GameState {
    const clue = s0.zones.battlefield.find((id) => s0.objects[id]!.kind === 'token' && getChars(s0, id).subtypes.includes('Clue'))!;
    return drive(resolveTop(activate(s0, clue, [], /sacrifice/i)), answers);
  }
  it('the one exiled creature card: after the yes, Lazav is a copy of it until end of turn (and no longer Lazav)', () => {
    let s = attack(board(), 1, find(board(), 'Mulldrifter', 'graveyard'));
    s = sacrificeClue(s, [{ kind: 'yesNo', yes: true }]);
    const lazav = find(s, 'Lazav, Wearer of Faces', 'battlefield');
    expect(looks(s, lazav)).toMatchObject({ name: 'Mulldrifter', pt: [2, 2] });
    expect(getChars(s, lazav).keywords.map((k) => k.keyword)).toContain('flying');
    expect(looks(advanceTo(s, 2, 'upkeep'), lazav).name).toBe('Lazav, Wearer of Faces');
  });
  it('"you may": declining changes nothing', () => {
    let s = attack(board(), 1, find(board(), 'Mulldrifter', 'graveyard'));
    s = sacrificeClue(s, [{ kind: 'yesNo', yes: false }]);
    expect(looks(s, find(s, 'Lazav, Wearer of Faces', 'battlefield')).name).toBe('Lazav, Wearer of Faces');
  });
  it('only a creature card counts: with a land card exiled with it, nothing becomes a copy', () => {
    let s = attack(board(), 1, find(board(), 'Forest', 'graveyard'));
    s = sacrificeClue(s, [{ kind: 'yesNo', yes: true }]);
    expect(looks(s, find(s, 'Lazav, Wearer of Faces', 'battlefield')).name).toBe('Lazav, Wearer of Faces');
    expect(s.log.some((l) => /nothing to become a copy of/.test(l.text))).toBe(true);
  });
  it('several creature cards exiled with it (on different attacks): its controller chooses one', () => {
    const s0 = board();
    let s = attack(s0, 1, find(s0, 'Mulldrifter', 'graveyard'));
    s = attack(s, 3, find(s, 'Grizzly Bears', 'graveyard', 'p2'));
    const clue = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token' && getChars(s, id).subtypes.includes('Clue'))!;
    s = resolveTop(activate(s, clue, [], /sacrifice/i));
    s = answer(s, { kind: 'yesNo', yes: true });
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', player: 'p1', min: 1, max: 1 });
    const options = (s.pending as { options: string[] }).options;
    expect(options).toHaveLength(2);
    const bears = options.find((id) => s.defs[s.objects[id]!.defId]!.name === 'Grizzly Bears')!;
    s = answer(s, pick(bears));
    expect(looks(s, find(s, 'Lazav, Wearer of Faces', 'battlefield'))).toMatchObject({ name: 'Grizzly Bears', pt: [2, 2] });
  });
});
