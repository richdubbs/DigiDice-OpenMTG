/**
 * WP29: the worked examples of CR 603 (handling triggered abilities) as scenario tests. Real fixture cards compiled by the default compiler drive a real
 * game through applyAction; nothing is mocked. When the example's own card is not automated, the test names the equivalent card it uses and why.
 *
 * Examples not run here: 603.7a (a delayed "when this creature leaves the battlefield" created after it left: no automated card creates such a delayed
 * trigger), 603.8 (state triggers: "Whenever you have no cards in hand" has no automated card), 603.11 (a static ability linked to a triggered ability: no
 * template). 603.12's own card, Heart-Piercer Manticore, is partial (its reflexive sentence is manual text); the test below pins that and runs the same
 * ability as hand-built JSON.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef, CardDef } from '../../../src/index';
import { act, advanceTo, find, inGraveyard, lifeOf, onBattlefield, pass, runCombat, scenario } from '../helpers';
import { activate, cast, countOn, drive, equivalent, gamePath, handSize, pt, resolveAll, resolveTop, stackNames, target } from './helpers';

describe('CR 603.2c: one event with several occurrences triggers once for each', () => {
  it('CR 603.2c example: Armageddon destroys six lands; Akki Raider ("Whenever a land is put into a graveyard from the battlefield") triggers six times', () => {
    const s0 = scenario(['Armageddon', 'Akki Raider', 'Plains', 'Mountain'], {
      p1: { hand: ['Armageddon'], battlefield: ['Plains', 'Plains', 'Plains', 'Plains'] },
      p2: { battlefield: ['Akki Raider', 'Mountain', 'Mountain'] },
    });
    const raider = find(s0, 'Akki Raider', 'battlefield');
    let s = resolveTop(cast(s0, 'Armageddon'));
    expect(countOn(s, 'Plains') + countOn(s, 'Mountain')).toBe(0);
    expect(stackNames(s)).toEqual(Array(6).fill('ability of Akki Raider'));
    s = resolveAll(s);
    expect(pt(s, raider)).toEqual([8, 1]); // 2/1 with +1/+0 six times (CR 613.4c)
  });
});

describe('CR 603.2e: "becomes tapped" triggers only when the status changes', () => {
  it('CR 603.2e example: Chrome Companion tapped to pay its own {T} cost triggers ("you gain 1 life")', () => {
    const s0 = scenario(['Chrome Companion', 'Grizzly Bears', 'Plains'], { p1: { battlefield: ['Chrome Companion', 'Plains', 'Plains'] }, p2: { graveyard: ['Grizzly Bears'] } });
    let s = activate(s0, find(s0, 'Chrome Companion', 'battlefield'), [target(find(s0, 'Grizzly Bears', 'graveyard'))]);
    expect(stackNames(s)).toEqual(['ability of Chrome Companion', 'ability of Chrome Companion']); // the activated ability, then the trigger above it
    s = resolveAll(s);
    expect(lifeOf(s, 'p1')).toBe(21);
  });

  it('CR 603.2e: a Chrome Companion put onto the battlefield tapped (Gravewaker) does not trigger: it never became tapped on the battlefield', () => {
    const s0 = scenario(['Gravewaker', 'Chrome Companion', 'Swamp'], { p1: { battlefield: ['Gravewaker', ...Array(7).fill('Swamp')], graveyard: ['Chrome Companion'] } });
    let s = activate(s0, find(s0, 'Gravewaker', 'battlefield'), [target(find(s0, 'Chrome Companion', 'graveyard'))]);
    s = resolveTop(s);
    const companion = find(s, 'Chrome Companion', 'battlefield');
    expect(s.objects[companion]!.tapped).toBe(true);
    expect(s.zones.stack).toEqual([]);
    expect(lifeOf(s, 'p1')).toBe(20);
  });
});

describe('CR 603.2g: an event that is prevented triggers nothing', () => {
  const board = (blocker: string) => {
    const s0 = scenario(["Giant's Skewer", 'Isamaru, Hound of Konda', blocker, 'Plains'], {
      p1: { battlefield: ["Giant's Skewer", 'Isamaru, Hound of Konda', 'Plains', 'Plains', 'Plains'] }, p2: { battlefield: [blocker] },
    });
    const isamaru = find(s0, 'Isamaru, Hound of Konda', 'battlefield');
    // Equip {3} (CR 702.6a), then Isamaru is a white 4/3 with "Whenever equipped creature deals combat damage to a creature, create a Food token"
    const s = resolveTop(activate(s0, find(s0, "Giant's Skewer", 'battlefield'), [target(isamaru)], /Equip/));
    expect(pt(s, isamaru)).toEqual([4, 3]);
    return runCombat(s, { attack: [[isamaru]], block: [[find(s, blocker, 'battlefield'), isamaru]] });
  };

  it('control: the equipped creature deals combat damage to a blocking Grizzly Bears and the trigger creates a Food token', () => {
    expect(countOn(board('Grizzly Bears'), 'Food Token')).toBe(1);
  });

  it('CR 603.2g example: its combat damage to Black Knight (protection from white) is all prevented (CR 702.16e), so nothing triggers', () => {
    const s = board('Black Knight');
    expect(onBattlefield(s, 'Black Knight', 'p2')).toBe(true);
    expect(countOn(s, 'Food Token')).toBe(0);
  });
});

describe('CR 603.4: the intervening "if" clause (Felidar Sovereign)', () => {
  const upkeep = (life: number) => advanceTo(scenario(['Felidar Sovereign', 'Lightning Bolt', 'Mountain'], {
    life, p1: { battlefield: ['Felidar Sovereign'] }, p2: { hand: ['Lightning Bolt'], battlefield: ['Mountain'] },
  }), 3, 'upkeep');

  it('CR 603.4 example: with 39 life as the upkeep begins, the ability does not trigger at all', () => {
    expect(upkeep(39).zones.stack).toEqual([]);
  });

  it('CR 603.4 example: with 40 life it triggers and, still 40 as it resolves, its controller wins the game', () => {
    const s = upkeep(40);
    expect(stackNames(s)).toEqual(['ability of Felidar Sovereign']);
    expect(resolveTop(s).result).toMatchObject({ winner: 'p1' });
  });

  it('CR 603.4 example: 40 life when it triggers but 37 when it resolves (Lightning Bolt in response): it is removed from the stack and does nothing', () => {
    let s = pass(upkeep(40)); // p2 gets priority with the trigger on the stack
    s = cast(s, 'Lightning Bolt', [target('p1')], 'p2');
    s = resolveTop(s);
    expect(lifeOf(s, 'p1')).toBe(37);
    s = resolveTop(s);
    expect(s.zones.stack).toEqual([]);
    expect(s.result).toBeFalsy();
  });
});

describe('CR 603.6b: continuous effects apply to a permanent the moment it is on the battlefield', () => {
  it('CR 603.6b example, first half: with "All Forests are 1/1 creatures that are still lands" a Forest played enters as a creature and triggers Soul Warden', () => {
    // Living Lands' sentence has no template (it is manual on the game path); an equivalent card carries hand-built JSON of the same behavior (layers 4, 7b; the render gate does not accept it yet).
    expect(gamePath('Living Lands').automation.level).toBe('manual');
    const lands = equivalent({ name: 'Living Lands', type_line: 'Enchantment', mana_cost: '{3}{G}' }, [{
      kind: 'static', text: 'All Forests are 1/1 creatures that are still lands.',
      effects: [{ s: 'continuous', affects: { ref: 'each', filter: { subtypes: ['Forest'] } }, mods: [{ layer: 4, types: { add: ['Creature'] } }, { layer: '7b', power: 1, toughness: 1 }] }],
    }]);
    const s0 = scenario(['Soul Warden', 'Forest'], { p1: { hand: ['Forest'], battlefield: ['Living Lands', 'Soul Warden'] }, defs: [lands] });
    const s = act(s0, { type: 'playLand', player: 'p1', card: find(s0, 'Forest', 'hand') });
    expect(stackNames(s)).toEqual(['ability of Soul Warden']);
    const played = resolveAll(s);
    expect(pt(played, find(played, 'Forest', 'battlefield'))).toEqual([1, 1]);
    expect(lifeOf(played, 'p1')).toBe(21);
  });

  it('CR 603.6b example, second half: under Humility ("All creatures lose all abilities") a creature with an enters trigger (Helpful Hunter) does not trigger', () => {
    const s0 = scenario(['Humility', 'Helpful Hunter', 'Plains'], { p1: { hand: ['Helpful Hunter'], battlefield: ['Humility', 'Plains', 'Plains'] } });
    const before = handSize(s0, 'p1');
    const s = resolveTop(cast(s0, 'Helpful Hunter'));
    expect(onBattlefield(s, 'Helpful Hunter', 'p1')).toBe(true);
    expect(s.zones.stack).toEqual([]);
    expect(handSize(s, 'p1')).toBe(before - 1); // no card drawn
  });
});

describe('CR 603.7c: a delayed triggered ability affects only the object it refers to, and only where it is expected', () => {
  it('CR 603.7c: Pyric Salamander\'s "Sacrifice this creature at the beginning of the next end step" sacrifices it at the end step', () => {
    const s0 = scenario(['Pyric Salamander', 'Mountain'], { p1: { battlefield: ['Pyric Salamander', 'Mountain'] } });
    const salamander = find(s0, 'Pyric Salamander', 'battlefield');
    let s = resolveTop(activate(s0, salamander));
    expect(pt(s, salamander)).toEqual([2, 1]);
    s = advanceTo(s, 1, 'end');
    expect(stackNames(s)).toEqual(['ability of Pyric Salamander']);
    s = resolveTop(s);
    expect(inGraveyard(s, 'Pyric Salamander', 'p1')).toBe(true);
  });

  it('CR 603.7c example, second half: it does nothing if the permanent left the battlefield before then; the same card cast again is a new object (CR 400.7)', () => {
    const s0 = scenario(['Pyric Salamander', 'Unsummon', 'Mountain', 'Island'], {
      p1: { hand: ['Unsummon'], battlefield: ['Pyric Salamander', 'Mountain', 'Mountain', 'Mountain', 'Island'] },
    });
    const old = find(s0, 'Pyric Salamander', 'battlefield');
    let s = resolveTop(activate(s0, old));
    s = resolveTop(cast(s, 'Unsummon', [target(old)]));
    s = resolveTop(cast(s, 'Pyric Salamander'));
    const again = find(s, 'Pyric Salamander', 'battlefield');
    expect(again).not.toBe(old);
    s = advanceTo(s, 1, 'end');
    s = resolveAll(s);
    expect(s.objects[again]?.zone).toBe('battlefield');
    expect(inGraveyard(s, 'Pyric Salamander', 'p1')).toBe(false);
  });
});

describe('CR 603.10a: leaves-the-battlefield abilities look back in time', () => {
  it('CR 603.10a example: Akroma\'s Vengeance destroys Moonlit Wake ("Whenever a creature dies, you gain 1 life") together with two creatures: it triggers twice', () => {
    const s0 = scenario(["Akroma's Vengeance", 'Moonlit Wake', 'Grizzly Bears', 'Hill Giant', 'Plains'], {
      p1: { hand: ["Akroma's Vengeance"], battlefield: ['Moonlit Wake', 'Grizzly Bears', ...Array(6).fill('Plains')] }, p2: { battlefield: ['Hill Giant'] },
    });
    let s = resolveTop(cast(s0, "Akroma's Vengeance"));
    expect(inGraveyard(s, 'Moonlit Wake', 'p1')).toBe(true);
    expect(stackNames(s)).toEqual(['ability of Moonlit Wake', 'ability of Moonlit Wake']);
    s = resolveAll(s);
    expect(lifeOf(s, 'p1')).toBe(22);
  });
});

describe('CR 603.12: reflexive triggered abilities', () => {
  it('Heart-Piercer Manticore on the game path: fully automated since std-rw8, the reflexive trigger reading the sacrificed creature\'s power (CR 603.12, 608.2h)', () => {
    const def = gamePath('Heart-Piercer Manticore');
    expect(def.automation.level).toBe('full');
    expect(JSON.stringify(def.faces)).toContain('"of":{"ref":"costSacrificed"}');
  });

  // Hand-built JSON of the same behavior (the render gate does not accept it yet) for "When this creature enters, you may sacrifice another creature. When you do, this creature deals damage equal to
  // that creature's power to any target." (design 4: `reflexive` with its own targets, chosen when it is put on the stack, CR 603.12, 603.3d).
  const etb: AbilityDef = {
    kind: 'triggered', text: "When ~ enters, you may sacrifice another creature. When you do, ~ deals damage equal to that creature's power to any target.",
    trigger: { on: [{ ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }] },
    effect: {
      targets: [],
      steps: [
        { op: 'chooseObjects', who: { ref: 'you' }, from: { ref: 'each', filter: { types: ['Creature'], controller: 'you', other: true } }, min: 0, max: 1, as: 'c' },
        { op: 'sacrifice', what: { ref: 'bound', name: 'c' }, as: 'sac' },
        {
          op: 'reflexive', when: { did: 'sac' }, targets: [{ id: 't0', kind: 'anyTarget', min: 1, max: 1, text: 'any target' }],
          do: [{ op: 'damage', source: { ref: 'self' }, to: { ref: 'target', id: 't0' }, amount: { q: 'stat', stat: 'power', of: { ref: 'bound', name: 'c' } } }],
        },
      ],
    },
  };
  const manticore: CardDef = equivalent({ name: 'Heart-Piercer Manticore', type_line: 'Creature — Manticore', mana_cost: '{2}{R}{R}', power: '4', toughness: '3', colors: ['R'] }, [etb]);
  const board = () => scenario(['Hill Giant', 'Mountain'], { p1: { hand: ['Heart-Piercer Manticore'], battlefield: ['Hill Giant', ...Array(4).fill('Mountain')] }, defs: [manticore] });

  it('CR 603.12 example: sacrificing Hill Giant (3 power) to the enters trigger creates the reflexive trigger, which deals 3 damage to its target', () => {
    const s0 = board();
    const giant = find(s0, 'Hill Giant', 'battlefield');
    let s = resolveTop(cast(s0, 'Heart-Piercer Manticore'));
    expect(stackNames(s)).toEqual(['ability of Heart-Piercer Manticore']);
    s = resolveTop(s, [{ kind: 'chooseObjects', ids: [giant] }]);
    s = drive(s, [target('p2')]);
    expect(stackNames(s)).toEqual(['ability of Heart-Piercer Manticore']); // the reflexive trigger, its target chosen as it was put on the stack
    s = resolveTop(s);
    expect(inGraveyard(s, 'Hill Giant', 'p1')).toBe(true);
    expect(lifeOf(s, 'p2')).toBe(17);
  });

  it('CR 603.12 example: choosing not to sacrifice means the reflexive ability never triggers', () => {
    let s = resolveTop(cast(board(), 'Heart-Piercer Manticore'));
    s = resolveTop(s, [{ kind: 'chooseObjects', ids: [] }]);
    expect(s.zones.stack).toEqual([]);
    expect(lifeOf(s, 'p2')).toBe(20);
  });
});
