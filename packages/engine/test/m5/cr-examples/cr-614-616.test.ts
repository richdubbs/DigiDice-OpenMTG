/**
 * WP29: the worked examples of CR 614.5, 614.12, 615 and 616 (replacement and prevention effects). Milestone 5 runs an object's replacement effects about
 * itself (`feature:replace.self`: "enters tapped", "as ~ enters", "if ~ would be put into a graveyard"), and shields created by a resolving spell or ability
 * (prevention shields, regeneration); replacement effects of OTHER objects (Gratuitous Violence, Orb of Dreams, Rest in Peace, Doubling Season, static
 * prevention) are milestone 6 (design 14, `feature:replace.foreign`).
 *
 * Two kinds of pin, never applied half or silently:
 *  - "milestone 6" (Rest in Peace, Doubling Season): the card IS compiled and names the missing capability (`requiresEngine`); the M6 packages turn them
 *    into the full examples (design 14.1).
 *  - "no template yet" (Gratuitous Violence, Orb of Dreams, Daunting Defender, Wojek Apothecary; Voice of All's protection line until MX2): no template matches the
 *    sentence, so the compiler names no capability at all; once a template exists, the foreign-replacement ones also need `feature:replace.foreign`
 *    (milestone 6), while Wojek Apothecary's shields (CR 615.11) are milestone 5 scope (design 14, Prevention row) and wait only for a template.
 *
 * Not run here: 614.13a-b (Sutured Ghoul, devour: no template), 616.1f's second example (Essence of the Wild and Rusted Sentinel: "enter as a copy", layer
 * 1a, milestone 6), 616.2 ("If you would gain life, draw that many cards instead": no automated card; foreign replacement, milestone 6).
 */
import { describe, expect, it } from 'vitest';
import { applyAction, type AbilityDef, type CardDef } from '../../../src/index';
import { find, inGraveyard, lifeOf, logHas, onBattlefield, pass, runCombat, scenario } from '../helpers';
import { cast, equivalent, gamePath, resolveTop, target } from './helpers';

/** The reasons of a card's manual spans. */
const reasons = (d: CardDef): string[] => (d.automation.faces ?? []).flatMap((f) => f.abilities.flatMap((a) => a.manual.map((m) => m.reason)));
/** A "no template yet" pin: the card is not automated because no template matches, and it names no engine capability. */
function expectNoTemplate(name: string, level: 'manual' | 'partial', reason: RegExp): void {
  const d = gamePath(name);
  expect(d.automation.level).toBe(level);
  expect(d.automation.requiresEngine).toBeUndefined();
  expect(reasons(d)).toEqual(expect.arrayContaining([expect.stringMatching(reason)]));
}

// CR 614.5: a replacement effect gets only one opportunity to affect an event: M6-0 (m6 design 4.3): moved to test/m6/skeleton/absent-m6-1.test.ts, replaced by M6-1 with the full behavior in test/m6/replace/ (Gratuitous Violence, CR 614.5)

describe('CR 614.12: replacement effects that modify how a permanent enters the battlefield', () => {
  it('Scarwood Treefolk ("This creature enters tapped") returned from the graveyard (Zombify) enters tapped', () => {
    const s0 = scenario(['Zombify', 'Scarwood Treefolk', 'Swamp'], { p1: { hand: ['Zombify'], battlefield: ['Swamp', 'Swamp', 'Swamp', 'Swamp'], graveyard: ['Scarwood Treefolk'] } });
    const s = resolveTop(cast(s0, 'Zombify', [target(find(s0, 'Scarwood Treefolk', 'graveyard'))]));
    expect(s.objects[find(s, 'Scarwood Treefolk', 'battlefield')]!.tapped).toBe(true);
  });

  it('CR 614.12 example: with "Cards in graveyards lose all abilities" (Yixlid Jailer) Scarwood Treefolk still enters tapped: its characteristics as it would exist on the battlefield are checked', () => {
    // Yixlid Jailer's sentence has no template (manual on the game path); the equivalent card carries hand-built layer-6 JSON of the same behavior (the render gate does not accept it yet).
    expect(gamePath('Yixlid Jailer').automation.level).toBe('manual');
    const jailer = equivalent({ name: 'Yixlid Jailer', type_line: 'Creature — Zombie Wizard', mana_cost: '{1}{B}', power: '2', toughness: '1', colors: ['B'] }, [{
      kind: 'static', text: 'Cards in graveyards lose all abilities.',
      effects: [{ s: 'continuous', affects: { ref: 'each', filter: { zone: 'graveyard', isCard: true } }, mods: [{ layer: 6, removeAll: true }] }],
    }] as AbilityDef[]);
    const s0 = scenario(['Zombify', 'Scarwood Treefolk', 'Swamp'], {
      p1: { hand: ['Zombify'], battlefield: ['Swamp', 'Swamp', 'Swamp', 'Swamp'], graveyard: ['Scarwood Treefolk'] }, p2: { battlefield: ['Yixlid Jailer'] }, defs: [jailer],
    });
    const s = resolveTop(cast(s0, 'Zombify', [target(find(s0, 'Scarwood Treefolk', 'graveyard'))]));
    expect(s.objects[find(s, 'Scarwood Treefolk', 'battlefield')]!.tapped).toBe(true);
  });

  it('CR 614.12: a continuous effect that would apply on the battlefield is taken into account: under Humility Scarwood Treefolk enters untapped', () => {
    const s0 = scenario(['Humility', 'Scarwood Treefolk', 'Forest'], { p1: { hand: ['Scarwood Treefolk'], battlefield: ['Humility', 'Forest', 'Forest', 'Forest', 'Forest'] } });
    const s = resolveTop(cast(s0, 'Scarwood Treefolk'));
    expect(s.objects[find(s, 'Scarwood Treefolk', 'battlefield')]!.tapped).toBe(false);
  });

  // M6-0 (m6 design 4.3): moved to test/m6/skeleton/absent-m6-1.test.ts, replaced by M6-1 with the full behavior in test/m6/replace/ (Orb of Dreams, CR 614.12)

  it('MX2: Voice of All\'s own "protection from the chosen color" line is automated (quality chosen:color; scenarios: test/mx2/protection.test.ts)', () => {
    expect(gamePath('Voice of All').automation.level).toBe('full');
    expect(gamePath('Voice of All').automation.unsupported).toEqual([]);
  });
});

describe('CR 615: prevention effects', () => {
  // PUSH1 T2: Healing Salve's second mode ("Prevent the next 3 damage that would be dealt to any target this turn", the shield of design 8.5, CR 615.7) is
  // read by the template eff.prevent.next.any (parser/templates/zz-push/t2.json), so the real card is played here (until then an equivalent instant carried
  // hand-built JSON of the same behavior). Its mode is chosen as it is cast (CR 700.2a): '1' is the prevention mode.
  const board = (creature = 'Grizzly Bears') => scenario(['Lightning Bolt', creature, 'Mountain', 'Plains', 'Healing Salve'], {
    p1: { hand: ['Lightning Bolt', 'Lightning Bolt'], battlefield: ['Mountain', 'Mountain'] }, p2: { hand: ['Healing Salve'], battlefield: [creature, 'Plains'] },
  });
  const PREVENT = { kind: 'chooseOption' as const, ids: ['1'] };

  it('the game path automates both modes of Healing Salve (PUSH1 T2: the prevention mode has a template)', () => {
    expect(gamePath('Healing Salve').automation.level).toBe('full');
    expect(gamePath('Healing Salve').automation.unsupported).toEqual([]);
  });

  it('CR 615.4 example: a prevention effect created in response to Lightning Bolt prevents its damage (CR 615.7: the shield of 3 is used up by the 3 damage)', () => {
    const s0 = board();
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    let s = pass(cast(s0, 'Lightning Bolt', [target(bears)]));
    s = resolveTop(cast(s, 'Healing Salve', [PREVENT, target(bears)], 'p2'));
    s = resolveTop(s);
    expect(onBattlefield(s, 'Grizzly Bears', 'p2')).toBe(true);
    expect(s.objects[bears]!.damage).toBe(0);
    expect(logHas(s, /prevented/, 'CR 615.7')).toBe(true);
    // the shield is spent: a second Bolt the same turn kills the Bears
    s = resolveTop(cast(s, 'Lightning Bolt', [target(bears)]));
    expect(inGraveyard(s, 'Grizzly Bears', 'p2')).toBe(true);
  });

  it('CR 615.4 example, second half: once Lightning Bolt has resolved it is too late: a shield created afterwards does not remove the 3 damage already dealt', () => {
    // Blessed Orator (1/4) survives the Bolt, so the prevention spell still has its target after the damage event
    const s0 = board('Blessed Orator');
    const orator = find(s0, 'Blessed Orator', 'battlefield');
    let s = resolveTop(cast(s0, 'Lightning Bolt', [target(orator)]));
    expect(s.objects[orator]!.damage).toBe(3);
    s = pass(s); // p1 passes priority: p2 may now cast an instant
    s = resolveTop(cast(s, 'Healing Salve', [PREVENT, target(orator)], 'p2'));
    expect(inGraveyard(s, 'Healing Salve', 'p2')).toBe(true); // it resolved, with its target
    expect(s.objects[orator]!.damage).toBe(3); // the damage stays marked (CR 615.4: no going back in time)
    expect(logHas(s, /prevented/, 'CR 615.7')).toBe(false);
  });

  // M6-0 (m6 design 4.3): moved to test/m6/skeleton/absent-m6-1.test.ts, replaced by M6-1 with the full behavior in test/m6/replace/ (Daunting Defender, CR 615.10)

  it('no template yet (milestone 5 scope, design 14 Prevention row): CR 615.11 example (Wojek Apothecary, shields for the target and each creature sharing a color) is a manual card', () => {
    const d = gamePath('Wojek Apothecary');
    expect(d.automation.level).toBe('manual');
    expect(d.automation.requiresEngine).toBeUndefined();
    expect(d.automation.unsupported).toEqual(['Prevent the next 1 damage that would be dealt to target creature and each other creature that shares a color with it this turn.']);
  });
});

describe('CR 616: interaction of replacement and prevention effects', () => {
  // The example's creature: "If this creature would die, instead shuffle it into its owner's library." (a replacement effect of the creature about itself,
  // `feature:replace.self`; Darksteel Colossus's wording of it has no template yet, so the equivalent card carries hand-built JSON of the same behavior; the
  // render gate does not accept it yet). In a replacement body, the library destination `position: 'random'` is the model's "shuffle it into its owner's
  // library": effects/replace-bodies.ts turns it into a shuffle of that library (CR 701.24a, 701.24c), checked below.
  const shuffler = equivalent({ name: 'Test Shuffler', type_line: 'Creature — Golem', mana_cost: '{3}', power: '3', toughness: '3' }, [{
    kind: 'static', text: "If ~ would die, instead shuffle it into its owner's library.",
    effects: [{ s: 'replace', replaces: { ev: 'zoneChange', subject: { self: true }, from: 'battlefield', to: 'graveyard' }, body: { b: 'modify', destination: { zone: 'library', position: 'random' } } }],
  }] as AbilityDef[]);
  const board = (extra: string[]) => scenario(['Mass Calcify', 'Plains', ...extra], {
    p1: { hand: ['Mass Calcify'], battlefield: [...Array(7).fill('Plains'), ...extra] }, p2: { battlefield: ['Test Shuffler'] }, defs: [shuffler],
  });
  const libraryHas = (s: ReturnType<typeof board>, name: string) => s.zones.library.p2!.some((id) => s.defs[s.objects[id]!.defId]!.name === name);

  it('a creature\'s own "if it would die" replacement: destroyed (Mass Calcify), it is shuffled into its owner\'s library instead of the graveyard', () => {
    const s = resolveTop(cast(board([]), 'Mass Calcify'));
    expect(inGraveyard(s, 'Test Shuffler', 'p2')).toBe(false);
    expect(libraryHas(s, 'Test Shuffler')).toBe(true);
  });

  it('CR 701.24a: the replaced zone change shuffles the owner\'s library (it is not merely put at a random position)', () => {
    const t = pass(cast(board([]), 'Mass Calcify'));
    const r = applyAction(t, { type: 'pass', player: t.pending!.player });
    expect(r.error).toBeUndefined();
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'shuffled', player: 'p2' }));
  });

  // M6-0 (m6 design 4.3): moved to test/m6/skeleton/absent-m6-1.test.ts, replaced by M6-1 with the full behavior in test/m6/replace/ (Rest in Peace, CR 616.1f)

  // M6-0 (m6 design 4.3): moved to test/m6/skeleton/absent-m6-1.test.ts, replaced by M6-1 with the full behavior in test/m6/replace/ (Doubling Season, CR 616.1g)
});
