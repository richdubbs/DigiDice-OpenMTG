/**
 * WP29: the worked examples of CR 608 (resolving spells and abilities) that milestone 5 runs through the interpreter, on real fixture cards compiled by the
 * default compiler; nothing is mocked. The milestone 3 file (test/m3/cr-examples.test.ts) has the 608 examples of casting and the stack; this one adds the
 * effects the interpreter now performs.
 *
 * Not run here: 608.2f (Blatant Thievery and Soulfire Eruption: control changes are fail-closed, `feature:control.layered`; "for each of them, exile
 * the top card" has no template), 608.2i (Search Party Captain's cost reduction with a type-changing effect: no automated type-removing card), 608.2d's own
 * wording ("You may sacrifice a creature. If you don't, you lose 4 life": no template; Pact of the Titan in cr-118-607.test.ts shows the same rule).
 */
import { describe, expect, it } from 'vitest';
import { find, inGraveyard, lifeOf, logHas, onBattlefield, pass, runCombat, scenario } from '../helpers';
import { cast, gamePath, resolveTop, target } from './helpers';

describe('CR 608.2b: targets are checked again on resolution', () => {
  it('CR 608.2b example: Sorin\'s Thirst whose creature left the battlefield (Unsummon in response) does not resolve; its controller gains no life', () => {
    const s0 = scenario(["Sorin's Thirst", 'Unsummon', 'Grizzly Bears', 'Swamp', 'Island'], {
      p1: { hand: ["Sorin's Thirst"], battlefield: ['Swamp', 'Swamp'] }, p2: { hand: ['Unsummon'], battlefield: ['Grizzly Bears', 'Island'] },
    });
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    let s = pass(cast(s0, "Sorin's Thirst", [target(bears)]));
    s = resolveTop(cast(s, 'Unsummon', [target(bears)], 'p2'));
    expect(onBattlefield(s, 'Grizzly Bears')).toBe(false);
    s = resolveTop(s);
    expect(s.zones.stack).toEqual([]);
    expect(lifeOf(s, 'p1')).toBe(20);
    expect(inGraveyard(s, "Sorin's Thirst", 'p1')).toBe(true);
    expect(logHas(s, /Sorin's Thirst/, 'CR 608.2b')).toBe(true);
  });

  it('CR 608.2b example: Plague Spores targets one creature land as both the nonblack creature and the land; turned black (Singe) it is still destroyed as the land', () => {
    // Dryad Arbor (a green land creature) with a +1/+1 counter survives Singe's 1 damage; Singe makes it black until end of turn (CR 613.1e)
    const s0 = scenario(['Plague Spores', 'Singe', 'Dryad Arbor', 'Swamp', 'Mountain'], {
      p1: { hand: ['Plague Spores'], battlefield: ['Swamp', 'Swamp', 'Swamp', 'Swamp', 'Mountain', 'Mountain'] },
      p2: { hand: ['Singe'], battlefield: [{ name: 'Dryad Arbor', counters: { '+1/+1': 1 } }, 'Mountain'] },
    });
    const arbor = find(s0, 'Dryad Arbor', 'battlefield');
    let s = pass(cast(s0, 'Plague Spores', [target(arbor), target(arbor)]));
    s = resolveTop(cast(s, 'Singe', [target(arbor)], 'p2'));
    expect(s.objects[arbor]!.zone).toBe('battlefield');
    s = resolveTop(s);
    expect(inGraveyard(s, 'Dryad Arbor', 'p2')).toBe(true); // "destroy target land" still happens: the spell resolved
    expect(inGraveyard(s, 'Plague Spores', 'p1')).toBe(true);
    expect(logHas(s, /Dryad Arbor is destroyed/, 'CR 701.8a')).toBe(true);
  });

  it('CR 608.2b example: Plague Spores on a nonblack creature and a different land; the creature turned black (Singe) is an illegal target and survives, the land is destroyed', () => {
    const s0 = scenario(['Plague Spores', 'Singe', 'Grizzly Bears', 'Forest', 'Swamp', 'Mountain'], {
      p1: { hand: ['Plague Spores'], battlefield: ['Swamp', 'Swamp', 'Swamp', 'Swamp', 'Mountain', 'Mountain'] },
      p2: { hand: ['Singe'], battlefield: ['Grizzly Bears', 'Forest', 'Mountain'] },
    });
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    const forest = find(s0, 'Forest', 'battlefield', 'p2');
    let s = pass(cast(s0, 'Plague Spores', [target(bears), target(forest)]));
    s = resolveTop(cast(s, 'Singe', [target(bears)], 'p2'));
    expect(s.objects[bears]!.zone).toBe('battlefield'); // a 2/2 survives Singe's 1 damage and is black until end of turn
    s = resolveTop(s);
    expect(onBattlefield(s, 'Grizzly Bears', 'p2')).toBe(true); // no longer a "nonblack creature": not destroyed (CR 608.2b)
    expect(inGraveyard(s, 'Forest', 'p2')).toBe(true); // the spell still resolves for its legal target
    expect(logHas(s, /Forest is destroyed/, 'CR 701.8a')).toBe(true);
    expect(logHas(s, /Grizzly Bears is destroyed/)).toBe(false);
  });
});

describe('CR 608.2j: an effect checks only the characteristic it names', () => {
  const board = (spell: string) => scenario([spell, 'Chief of the Scale', 'Grizzly Bears', 'Swamp', 'Plains'], {
    p1: { hand: [spell], battlefield: ['Swamp', 'Swamp', 'Swamp', 'Plains', 'Plains', 'Plains', 'Plains'] }, p2: { battlefield: ['Chief of the Scale', 'Grizzly Bears'] },
  });

  it('CR 608.2j example (colors exchanged): "Destroy all white creatures" (Virtue\'s Ruin) destroys a white-and-black creature (Chief of the Scale)', () => {
    const s = resolveTop(cast(board("Virtue's Ruin"), "Virtue's Ruin"));
    expect(inGraveyard(s, 'Chief of the Scale', 'p2')).toBe(true);
    expect(onBattlefield(s, 'Grizzly Bears', 'p2')).toBe(true);
  });

  it('CR 608.2j example (colors exchanged): "Destroy all nonwhite creatures" (Mass Calcify) does not destroy it', () => {
    const s = resolveTop(cast(board('Mass Calcify'), 'Mass Calcify'));
    expect(onBattlefield(s, 'Chief of the Scale', 'p2')).toBe(true);
    expect(inGraveyard(s, 'Grizzly Bears', 'p2')).toBe(true);
  });
});

describe('CR 608.2k: an untargeted object named by the trigger condition (Wall of Tears)', () => {
  it('FAST2 T10 (CR 603.7c): the delayed "return that creature ... at end of combat" is automated; the blocked creature it fixed as it was created returns', () => {
    expect(gamePath('Wall of Tears').automation.unsupported).toEqual([]);
    const s0 = scenario(['Wall of Tears', 'Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] }, p2: { battlefield: ['Wall of Tears'] } });
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    const s = runCombat(s0, { attack: [[bears]], block: [[find(s0, 'Wall of Tears', 'battlefield'), bears]] });
    let t = s;
    for (let i = 0; i < 6 && t.zones.stack.length > 0 && t.pending?.kind === 'priority'; i++) t = pass(t);
    expect(t.pending?.kind).not.toBe('manualResolve');
    expect(t.zones.hand['p1']!.map((id) => t.objects[id]!.defId)).toContain('Grizzly Bears');
  });
});

// CR 608.3e: a permanent spell that cannot be put onto the battlefield: M6-0 (m6 design 4.3): moved to test/m6/skeleton/absent-m6-2.test.ts (Clone, CR 608.3e)
