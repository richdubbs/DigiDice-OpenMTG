/**
 * M6-8 (m6 design 3.5, 5 "M6-8"): text-changing effects, layer 3 (CR 612, 613.1c), end to end on the game path with the acceptance cards Sleight of Mind,
 * Magical Hack and Artificial Evolution (section 6): real fixture cards compiled by the default compiler, placed with `scenario`, driven by real actions and
 * answers. Where a fixture card's wording is not automated yet (Urborg, Tomb of Yawgmoth), a card with hand-built JSON of the same behavior (`equivalent`,
 * validated by the schema and the lint).
 */
import { describe, expect, it } from 'vitest';
import { ENGINE_CAPABILITIES, getChars, legalActions, missingCapabilities, type AbilityDef, type GameState } from '../../../src/index';
import { LAYER_TABLE } from '../../../src/statics/layers';
import { equivalent } from '../../m5/cr-examples/helpers';
import { declareAttackers, passUntil, toDeclareAttackers } from '../../m4/helpers';
import { activate, cast, color, drive, find, gamePath, islands, keywordTexts, named, ptOf, resolveTop, scenario, target } from './support';

const pick = (...ids: string[]) => ({ kind: 'chooseObjects' as const, ids });

describe('capabilities (m6 design 7): layer:3 is the table entry LAYER_3 (statics/text-change.ts)', () => {
  it('layer:3 is a capability, and the three acceptance cards are full on the game path with nothing missing', () => {
    expect(Object.hasOwn(LAYER_TABLE, '3')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('layer:3')).toBe(true);
    for (const name of ['Sleight of Mind', 'Magical Hack', 'Artificial Evolution']) {
      const def = gamePath(name);
      expect(def.automation.level, name).toBe('full');
      for (const a of def.faces[0]!.abilities) expect(missingCapabilities(a, ENGINE_CAPABILITIES), name).toEqual([]);
    }
  });
});

describe('CR 612.2: Sleight of Mind changes a color word used as a color word, and nothing else', () => {
  const board = (): GameState => scenario(['Sleight of Mind', 'Crusade', 'White Knight', 'Black Knight', 'Island'], {
    p1: { hand: ['Sleight of Mind'], battlefield: islands(2) }, p2: { battlefield: ['Crusade', 'White Knight', 'Black Knight'] },
  });

  it('CR 612.2, 608.2d: the two words are chosen as it resolves; "White creatures get +1/+1" becomes "Black creatures get +1/+1"', () => {
    let s = board();
    const crusade = find(s, 'Crusade', 'battlefield');
    const white = find(s, 'White Knight', 'battlefield');
    const black = find(s, 'Black Knight', 'battlefield');
    expect([ptOf(s, white), ptOf(s, black)]).toEqual([[3, 3], [2, 2]]);
    s = resolveTop(cast(s, 'Sleight of Mind', [target(crusade)]));
    expect(s.pending).toMatchObject({ kind: 'chooseColor', player: 'p1', options: ['W', 'U', 'B', 'R', 'G'] });
    s = drive(s, [color('W')]);
    // "one color word with another": the second word is another one
    expect(s.pending).toMatchObject({ kind: 'chooseColor', player: 'p1', options: ['U', 'B', 'R', 'G'] });
    s = drive(s, [color('B')]);
    expect([ptOf(s, white), ptOf(s, black)]).toEqual([[2, 2], [3, 3]]);
    expect(getChars(s, crusade).abilities[0]!.def.text).toBe('Black creatures get +1/+1.');
  });

  it('CR 612.2: a mana symbol is not a word (Crusade keeps its mana cost and its color); a card name is never changed (Black Knight)', () => {
    let s = board();
    const crusade = find(s, 'Crusade', 'battlefield');
    s = resolveTop(cast(s, 'Sleight of Mind', [target(crusade)]), [color('W'), color('U')]);
    const before = getChars(board(), find(board(), 'Crusade', 'battlefield'));
    expect(getChars(s, crusade)).toMatchObject({ manaCost: before.manaCost, manaValue: 2, colors: ['W'] });
    // on Black Knight: "Protection from white" becomes "Protection from red", its name stays "Black Knight"
    const t = scenario(['Sleight of Mind', 'Black Knight', 'Island'], { p1: { hand: ['Sleight of Mind'], battlefield: islands(2) }, p2: { battlefield: ['Black Knight'] } });
    const knight = find(t, 'Black Knight', 'battlefield');
    const u = resolveTop(cast(t, 'Sleight of Mind', [target(knight)]), [color('W'), color('R')]);
    expect(getChars(u, knight).name).toBe('Black Knight');
    expect(keywordTexts(u, knight)).toContain('Protection from red');
    expect(getChars(u, knight).keywords.find((k) => k.keyword === 'protection')?.quality).toBe('color:R');
  });

  it('CR 612.2: a word the text does not use changes nothing (Sleight of Mind changing red on Crusade)', () => {
    let s = board();
    const crusade = find(s, 'Crusade', 'battlefield');
    const before = getChars(s, crusade).abilities.map((a) => a.def);
    s = resolveTop(cast(s, 'Sleight of Mind', [target(crusade)]), [color('R'), color('G')]);
    expect(getChars(s, crusade).abilities.map((a) => a.def)).toEqual(before);
  });

  it('CR 612.1, 608.2b: the text of a spell on the stack: "nonblack" becomes "nongreen", so Doom Blade\'s target (a green creature) is illegal and it does nothing', () => {
    let s = scenario(['Sleight of Mind', 'Doom Blade', 'Grizzly Bears', 'Island', 'Swamp'], {
      p1: { hand: ['Sleight of Mind', 'Doom Blade'], battlefield: [...islands(1), 'Swamp', 'Swamp'] }, p2: { battlefield: ['Grizzly Bears'] },
    });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    s = cast(s, 'Doom Blade', [target(bears)]);
    const blade = s.zones.stack[0]!;
    s = cast(s, 'Sleight of Mind', [target(blade)]);
    s = resolveTop(s, [color('B'), color('G')]); // Sleight of Mind
    expect(getChars(s, blade).abilities[0]!.def.text).toBe('Destroy target nongreen creature.');
    s = resolveTop(s); // Doom Blade: its only target is illegal now (CR 608.2b)
    expect(s.zones.battlefield).toContain(bears);
  });

  it('CR 613.7, 613.1c: two text changes apply in timestamp order (white -> black, then black -> red: red creatures get +1/+1)', () => {
    let s = scenario(['Sleight of Mind', 'Crusade', 'Raging Goblin', 'Island'], {
      p1: { hand: ['Sleight of Mind', 'Sleight of Mind'], battlefield: islands(2) }, p2: { battlefield: ['Crusade', 'Raging Goblin'] },
    });
    const crusade = find(s, 'Crusade', 'battlefield');
    const goblin = find(s, 'Raging Goblin', 'battlefield');
    s = resolveTop(cast(s, 'Sleight of Mind', [target(crusade)]), [color('W'), color('B')]);
    s = resolveTop(cast(s, 'Sleight of Mind', [target(crusade)]), [color('B'), color('R')]);
    expect(getChars(s, crusade).abilities[0]!.def.text).toBe('Red creatures get +1/+1.');
    expect(ptOf(s, goblin)).toEqual([2, 2]); // a red 1/1
  });

  it('CR 611.2a, 608.2h: the effect lasts indefinitely, and it stores the two words chosen (never the choice)', () => {
    let s = board();
    const crusade = find(s, 'Crusade', 'battlefield');
    s = resolveTop(cast(s, 'Sleight of Mind', [target(crusade)]), [color('W'), color('B')]);
    const rec = s.continuousEffects.find((r) => r.effect.s === 'continuous' && r.effect.mods.some((m) => m.layer === 3))!;
    expect(rec.duration).toEqual({ d: 'permanent' });
    expect(rec.effect).toMatchObject({ affects: { ref: 'fixed', objects: [{ id: crusade, zone: 'battlefield' }] }, mods: [{ layer: 3, changeWord: { kind: 'color', from: 'W', to: 'B' } }] });
  });
});

describe('CR 612.3: abilities granted by effects are not text of the object; copied abilities are', () => {
  it('CR 612.3, 707.2a: Sleight of Mind changes a Clone\'s copied color word (White Knight\'s protection from black) but not a granted protection', () => {
    let s = scenario(['Sleight of Mind', 'Clone', 'White Knight', 'Goblin Wizard', 'Raging Goblin', 'Island', 'Mountain'], {
      p1: { hand: ['Clone', 'Sleight of Mind', 'Sleight of Mind'], battlefield: [...islands(6), 'Mountain', 'Goblin Wizard', 'Raging Goblin'] },
      p2: { battlefield: ['White Knight'] },
    });
    const knight = find(s, 'White Knight', 'battlefield');
    s = drive(resolveTop(cast(s, 'Clone')), [pick(knight)]);
    const clone = find(s, 'Clone', 'battlefield');
    expect(keywordTexts(s, clone)).toContain('Protection from black');
    s = resolveTop(cast(s, 'Sleight of Mind', [target(clone)]), [color('B'), color('R')]);
    expect(keywordTexts(s, clone)).toContain('Protection from red');
    expect(getChars(s, clone).keywords.some((k) => k.keyword === 'protection' && k.quality === 'color:B')).toBe(false);
    expect(keywordTexts(s, knight)).toContain('Protection from black'); // the original is not affected
    // Goblin Wizard grants "protection from white" to a Goblin (a layer 6 effect): a text change on that Goblin leaves the granted ability alone
    const goblin = find(s, 'Raging Goblin', 'battlefield');
    s = resolveTop(activate(s, find(s, 'Goblin Wizard', 'battlefield'), [target(goblin)], /\{R\}/));
    expect(getChars(s, goblin).keywords.some((k) => k.keyword === 'protection' && k.quality === 'color:W')).toBe(true);
    s = resolveTop(cast(s, 'Sleight of Mind', [target(goblin)]), [color('W'), color('U')]);
    expect(getChars(s, goblin).keywords.some((k) => k.keyword === 'protection' && k.quality === 'color:W')).toBe(true);
    expect(getChars(s, goblin).keywords.some((k) => k.keyword === 'protection' && k.quality === 'color:U')).toBe(false);
  });

  it('CR 707.2, 613.2c: copiable values are layer 1 only: a Clone of a text-changed White Knight has the printed protection from black', () => {
    let s = scenario(['Sleight of Mind', 'Clone', 'White Knight', 'Island'], {
      p1: { hand: ['Sleight of Mind', 'Clone'], battlefield: islands(6) }, p2: { battlefield: ['White Knight'] },
    });
    const knight = find(s, 'White Knight', 'battlefield');
    s = resolveTop(cast(s, 'Sleight of Mind', [target(knight)]), [color('B'), color('G')]);
    expect(keywordTexts(s, knight)).toContain('Protection from green');
    s = drive(resolveTop(cast(s, 'Clone')), [pick(knight)]);
    expect(keywordTexts(s, find(s, 'Clone', 'battlefield'))).toContain('Protection from black');
  });

  it('CR 612.3 (Magical Hack): a printed swampwalk becomes islandwalk, and the creature is unblockable against an Island, not a Swamp', () => {
    const run = (p2Land: string): boolean => {
      let s = scenario(['Magical Hack', 'Bog Raiders', 'Grizzly Bears', 'Island', 'Swamp'], {
        p1: { hand: ['Magical Hack'], battlefield: [...islands(1), 'Bog Raiders'] }, p2: { battlefield: ['Grizzly Bears', p2Land] },
      });
      const raiders = find(s, 'Bog Raiders', 'battlefield');
      s = resolveTop(cast(s, 'Magical Hack', [target(raiders)]), [named('Swamp'), named('Island')]);
      expect(keywordTexts(s, raiders)).toEqual(['Islandwalk']);
      expect(getChars(s, raiders).keywords[0]).toMatchObject({ keyword: 'landwalk', quality: 'island' });
      s = declareAttackers(toDeclareAttackers(s), [[raiders]]);
      s = passUntil(s, (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'combatDamage', 'blockers', 10);
      return s.pending?.kind === 'declareBlockers' && s.pending.candidates.some((c) => c.attackers.includes(raiders));
    };
    expect(run('Island')).toBe(false);
    expect(run('Swamp')).toBe(true);
  });

  it('CR 612.2: Magical Hack offers the five basic land types, and the second is another one', () => {
    let s = scenario(['Magical Hack', 'Bog Raiders', 'Island'], { p1: { hand: ['Magical Hack'], battlefield: [...islands(1), 'Bog Raiders'] } });
    s = resolveTop(cast(s, 'Magical Hack', [target(find(s, 'Bog Raiders', 'battlefield'))]));
    expect(s.pending).toMatchObject({ kind: 'chooseName', what: 'landType', options: ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'] });
    s = drive(s, [named('Forest')]);
    expect(s.pending).toMatchObject({ kind: 'chooseName', what: 'landType', options: ['Plains', 'Island', 'Swamp', 'Mountain'] });
  });
});

describe('CR 612.2a, 612.4: creature types (Artificial Evolution)', () => {
  it('CR 612.2a: the creature type of a token-creating spell changes, and so does the tokens\' name (Dragon Fodder makes Elves)', () => {
    let s = scenario(['Artificial Evolution', 'Dragon Fodder', 'Island', 'Mountain'], {
      p1: { hand: ['Dragon Fodder', 'Artificial Evolution'], battlefield: [...islands(1), 'Mountain', 'Mountain'] },
    });
    s = cast(s, 'Dragon Fodder');
    const fodder = s.zones.stack[0]!;
    s = cast(s, 'Artificial Evolution', [target(fodder)]);
    s = resolveTop(s, [named('Goblin'), named('Elf')]);
    s = resolveTop(s);
    const tokens = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(tokens).toHaveLength(2);
    for (const id of tokens) {
      expect(getChars(s, id)).toMatchObject({ subtypes: ['Elf'], colors: ['R'], types: ['Creature'] });
      expect(getChars(s, id).name).not.toMatch(/Goblin/);
    }
  });

  it('CR 612.1, 612.4: the words of the type line change too: a token Soldier becomes an Elf; Raging Goblin becomes an Elf Berserker', () => {
    let s = scenario(['Artificial Evolution', 'Raise the Alarm', 'Raging Goblin', 'Island', 'Plains'], {
      p1: { hand: ['Raise the Alarm', 'Artificial Evolution', 'Artificial Evolution'], battlefield: [...islands(4), 'Plains', 'Plains'] },
      p2: { battlefield: ['Raging Goblin'] },
    });
    s = resolveTop(cast(s, 'Raise the Alarm'));
    const soldier = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token')!;
    s = resolveTop(cast(s, 'Artificial Evolution', [target(soldier)]), [named('Soldier'), named('Elf')]);
    expect(getChars(s, soldier).subtypes).toEqual(['Elf']);
    const goblin = find(s, 'Raging Goblin', 'battlefield');
    s = resolveTop(cast(s, 'Artificial Evolution', [target(goblin)]), [named('Goblin'), named('Elf')]);
    expect(getChars(s, goblin).subtypes).toEqual(['Elf', 'Berserker']);
    expect(getChars(s, goblin).name).toBe('Raging Goblin'); // CR 612.2: never the name
  });

  it('CR 612.2: "The new creature type can\'t be Wall": the second choice offers neither Wall nor the first word', () => {
    let s = scenario(['Artificial Evolution', 'Raging Goblin', 'Island'], { p1: { hand: ['Artificial Evolution'], battlefield: islands(1) }, p2: { battlefield: ['Raging Goblin'] } });
    s = resolveTop(cast(s, 'Artificial Evolution', [target(find(s, 'Raging Goblin', 'battlefield'))]));
    const first = s.pending as { kind: string; options: string[] };
    expect(first.kind).toBe('chooseName');
    expect(first.options).toContain('Wall'); // the word replaced may be Wall
    s = drive(s, [named('Goblin')]);
    const second = s.pending as { kind: string; options: string[] };
    expect(second.options).not.toContain('Wall');
    expect(second.options).not.toContain('Goblin');
    expect(second.options).toContain('Elf');
  });
});

describe('CR 613.1c: layer 3 before layer 4: a type change reads the changed text', () => {
  /** Urborg, Tomb of Yawgmoth's static ability as hand-built JSON (its wording is not automated yet). */
  const urborg = equivalent({ name: 'Urborg, Tomb of Yawgmoth', type_line: 'Legendary Land' }, [{
    kind: 'static', text: 'Each land is a Swamp in addition to its other land types.',
    effects: [{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Land'] } }, mods: [{ layer: 4, subtypes: { add: ['Swamp'] } }] }],
  } as AbilityDef]);

  it('CR 613.1c, 305.6: Magical Hack (Swamp -> Island) on Urborg: each land is an Island, and taps for {U}', () => {
    let s = scenario(['Magical Hack', 'Plains', 'Island'], { p1: { hand: ['Magical Hack'], battlefield: islands(1) }, p2: { battlefield: ['Plains', 'Urborg, Tomb of Yawgmoth'] }, defs: [urborg] });
    const tomb = find(s, 'Urborg, Tomb of Yawgmoth', 'battlefield');
    const plains = find(s, 'Plains', 'battlefield', 'p2');
    expect(getChars(s, plains).subtypes).toEqual(['Plains', 'Swamp']);
    s = resolveTop(cast(s, 'Magical Hack', [target(tomb)]), [named('Swamp'), named('Island')]);
    expect(getChars(s, plains).subtypes).toEqual(['Plains', 'Island']);
    expect(getChars(s, tomb).subtypes).toEqual(['Island']);
    expect(getChars(s, plains).abilities.map((a) => a.key).sort()).toEqual(['r:basic:U', 'r:basic:W']);
  });
});

describe('CR 400.7a, 113.7a: where the changed text is read', () => {
  it('CR 400.7a: a text change of a permanent spell applies to the permanent it becomes (Black Knight resolves with protection from green)', () => {
    let s = scenario(['Sleight of Mind', 'Black Knight', 'Island', 'Swamp'], { p1: { hand: ['Black Knight', 'Sleight of Mind'], battlefield: [...islands(1), 'Swamp', 'Swamp'] } });
    s = cast(s, 'Black Knight');
    const spell = s.zones.stack[0]!;
    s = resolveTop(cast(s, 'Sleight of Mind', [target(spell)]), [color('W'), color('G')]);
    expect(keywordTexts(s, spell)).toContain('Protection from green');
    s = resolveTop(s);
    const knight = find(s, 'Black Knight', 'battlefield');
    expect(keywordTexts(s, knight)).toContain('Protection from green');
  });

  it('CR 113.7a: an activated ability activated after the change does what the changed text says (Goblin Wizard grants protection from blue)', () => {
    let s = scenario(['Sleight of Mind', 'Goblin Wizard', 'Raging Goblin', 'Island', 'Mountain'], {
      p1: { hand: ['Sleight of Mind'], battlefield: [...islands(1), 'Mountain', 'Goblin Wizard', 'Raging Goblin'] },
    });
    const wizard = find(s, 'Goblin Wizard', 'battlefield');
    const goblin = find(s, 'Raging Goblin', 'battlefield');
    s = resolveTop(cast(s, 'Sleight of Mind', [target(wizard)]), [color('W'), color('U')]);
    const label = legalActions(s, 'p1').find((a) => a.kind === 'activate' && a.object === wizard && /\{R\}/.test(a.label));
    expect(label).toBeDefined();
    s = activate(s, wizard, [target(goblin)], /\{R\}/);
    expect(s.objects[s.zones.stack[0]!]!.stack?.inline).toBeDefined(); // it carries its changed text (CR 113.7a)
    s = resolveTop(s);
    expect(getChars(s, goblin).keywords.some((k) => k.keyword === 'protection' && k.quality === 'color:U')).toBe(true);
    expect(getChars(s, goblin).keywords.some((k) => k.keyword === 'protection' && k.quality === 'color:W')).toBe(false);
  });

  it('CR 113.7a, 603.3: a triggered ability of a text-changed permanent does what the changed text says (Doomed Traveler makes a black Spirit)', () => {
    let s = scenario(['Sleight of Mind', 'Doomed Traveler', 'Shock', 'Island', 'Mountain'], {
      p1: { hand: ['Sleight of Mind', 'Shock'], battlefield: [...islands(1), 'Mountain'] }, p2: { battlefield: ['Doomed Traveler'] },
    });
    const traveler = find(s, 'Doomed Traveler', 'battlefield');
    s = resolveTop(cast(s, 'Sleight of Mind', [target(traveler)]), [color('W'), color('B')]);
    s = resolveTop(cast(s, 'Shock', [target(traveler)]));
    while (s.zones.stack.length > 0) s = resolveTop(s);
    const spirit = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token')!;
    expect(spirit).toBeDefined();
    expect(getChars(s, spirit)).toMatchObject({ colors: ['B'], subtypes: ['Spirit'] });
  });
});
