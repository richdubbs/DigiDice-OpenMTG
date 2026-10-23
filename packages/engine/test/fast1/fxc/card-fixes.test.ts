/**
 * FXC: audit C1 (regression: the Jitte class) and m2 (granted quoted abilities are displayed with "this creature", not the granting card's name).
 * Synthetic cards with invented names (design 6.10: committed tests carry no Wizards text).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, renderAbility, type CardDef, type OracleCard } from '../../../src/index';
import { find, runCombat, scenario } from '../../m4/helpers';

const card = (name: string, type_line: string, oracle_text: string, mana_cost = '{2}'): CardDef =>
  compileCard({ name, layout: 'normal', mana_cost, type_line, oracle_text } as OracleCard);

const shown = (d: CardDef): string[] => d.faces[0]!.abilities.map((a) => renderAbility(a, { selfNames: [d.faces[0]!.name], selfTypes: [], oracleLines: (a.text ?? '').split('\n') }).join(' '));

describe('audit C1 (CR 510.2, 603.2c): "Whenever equipped creature deals combat damage" triggers once per combat damage step', () => {
  const rod = card('Test Charge Rod', 'Artifact — Equipment', 'Whenever equipped creature deals combat damage, put two charge counters on this Equipment.\nEquip {2}');

  const fight = (attacker: string, amounts: (b1: string, b2: string) => { id: string; amount: number }[]): Record<string, number> => {
    const s0 = scenario([attacker, 'Grizzly Bears'], { p1: { battlefield: [attacker, rod.name] }, p2: { battlefield: ['Grizzly Bears', 'Grizzly Bears'] }, defs: [rod] });
    const me = find(s0, attacker, 'battlefield');
    const r = find(s0, rod.name, 'battlefield');
    s0.objects[r]!.attachedTo = me;
    const [b1, b2] = s0.zones.battlefield.filter((id) => s0.objects[id]!.defId === 'Grizzly Bears');
    const s = runCombat(s0, { attack: [[me]], block: [[b1!, me], [b2!, me]], assign: { [me]: () => amounts(b1!, b2!) } });
    return s.objects[r]!.counters as Record<string, number>;
  };

  it('compiles full', () => expect(rod.automation.level).toBe('full'));

  it('double-blocked, damage split between both blockers: two counters, not four', () => {
    expect(fight('Craw Wurm', (b1, b2) => [{ id: b1, amount: 3 }, { id: b2, amount: 3 }])).toEqual({ charge: 2 });
  });

  it('a double-blocked trampler dealing damage to both blockers and the player: two counters, not six', () => {
    expect(fight('Colossal Dreadmaw', (b1, b2) => [{ id: b1, amount: 2 }, { id: b2, amount: 2 }, { id: 'p2', amount: 2 }])).toEqual({ charge: 2 });
  });
});

describe('audit m2 (CR 113.7a): a quoted ability is displayed for the object that has it', () => {
  it('Equipment: "Whenever this creature deals combat damage to a player", not the Equipment\'s name', () => {
    const d = card('Test Strike Bracers', 'Artifact — Equipment', 'Equipped creature gets +1/+0 and has "Whenever this creature deals combat damage to a player, draw a card."\nEquip {3}');
    expect(d.automation.level).toBe('full');
    const text = shown(d).join(' ');
    expect(text).toContain('"Whenever this creature deals combat damage to a player, draw a card."');
    expect(text).not.toMatch(/"[^"]*Test Strike Bracers[^"]*"/);
  });

  it('two self references in one quoted ability', () => {
    const d = card('Test Spark Whip', 'Artifact — Equipment', 'Equipped creature has "Whenever this creature becomes the target of a spell, this creature deals 2 damage to any target."\nEquip {2}');
    expect(shown(d).join(' ')).toContain('"Whenever this creature becomes the target of a spell, this creature deals 2 damage to any target."');
  });

  it('an Aura on a land: "this land"', () => {
    const d = card('Test Thorn Ward', 'Enchantment — Aura', 'Enchant land\nEnchanted land has "{T}: This land deals 1 damage to any target."');
    const text = shown(d).join(' ');
    expect(text).toContain('"{T}: This land deals 1 damage to any target."');
    expect(text).not.toContain('Test Thorn Ward deals');
  });

  it('"Artifact creatures you control have ...": "this creature"', () => {
    const d = card('Test Drone Hub', 'Artifact', 'Artifact creatures you control have "Whenever this creature attacks, you gain 1 life."');
    expect(shown(d).join(' ')).toContain('"Whenever this creature attacks, you gain 1 life."');
  });

  it('a token\'s ability: "this token"', () => {
    const d = card('Test Rat Caller', 'Creature — Human', 'When this creature enters, create a 1/1 black Rat creature token with "This token can\'t block."', '{1}{B}');
    const text = shown(d).join(' ');
    expect(text).toContain('"This token can\'t block."');
    expect(text).not.toMatch(/"Test Rat Caller/);
  });
});
