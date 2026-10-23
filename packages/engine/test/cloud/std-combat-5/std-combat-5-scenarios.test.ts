/**
 * std-combat-5 (lane std-combat): a secret choice and the cost that reveals it, three tokens in one instruction, and "if <target> is the chosen type", played through
 * the engine with synthetic cards compiled by the game's default compiler (wordings invented, design 6.10). Each test is named after the rule it checks, with its
 * negative case. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 608.2d, 607.2d   "Then secretly choose Elf, Dwarf, or Orc.": the value is the chooser's to know; every other player's view leaves it out
 *   CR 118.3, 608.2d    "Sacrifice this enchantment, Reveal the creature type you chose: ...": paid with the source sacrificed first; the type is revealed
 *   CR 607.2d, 608.2c   "If target attacking creature token is the chosen type, ...": the type chosen by the face's other ability, read after the source left
 *   CR 111.1            "create A, B, and C": three tokens
 */
import { describe, expect, it } from 'vitest';
import type { CardDef, GameState, ObjectId } from '../../../src/index';
import { viewFor } from '../../../src/index';
import { act, advanceTo, answer, pass, scenario } from '../../m3/scenario';
import { declareAttackers, toDeclareAttackers } from '../../m4/helpers';
import { card, counters, full, resolveAll, settle } from '../cmd3/helpers';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';

const PLOT = card('Test Hidden Plot', 'Enchantment', 'When this enchantment enters, create a 1/1 green Elf creature token, a 1/1 red Dwarf creature token, and a 1/1 black Orc creature token. Then secretly choose Elf, Dwarf, or Orc.\nSacrifice this enchantment, Reveal the creature type you chose: If target attacking creature token is the chosen type, put two +1/+1 counters on it and it gains deathtouch until end of turn.');
const DEFS: CardDef[] = [PLOT];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

const plot = (s: GameState): ObjectId => s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Hidden Plot')!;

/** Cast the enchantment, resolve it and its trigger, secretly choosing `type`. */
function enter(type: string): GameState {
  let s = scenario(['Plains'], { p1: { hand: ['Test Hidden Plot'] }, defs: DEFS });
  s = act(s, { type: 'cast', player: 'p1', card: s.zones.hand.p1!.find((id) => s.objects[id]!.defId === 'Test Hidden Plot')! });
  for (let k = 0; k < 20 && s.pending?.kind !== 'chooseName'; k++) s = s.pending?.kind === 'priority' ? pass(s) : settle(s);
  expect(s.pending?.kind).toBe('chooseName');
  expect((s.pending as { options?: string[] }).options).toEqual(['Elf', 'Dwarf', 'Orc']);
  return resolveAll(answer(s, { kind: 'chooseName', name: type }));
}

describe('CR 608.2d, 607.2d: "Then secretly choose Elf, Dwarf, or Orc."', () => {
  it('CR 111.1: the three tokens are created; CR 608.2d: the chooser\'s view holds the type, the opponent\'s view does not', () => {
    const s = enter('Dwarf');
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token')).toHaveLength(3);
    const id = plot(s);
    expect(s.objects[id]!.links?.['type']?.values).toEqual(['Dwarf']);
    expect(viewFor(s, 'p1').objects[id]!.links?.['type']?.values).toEqual(['Dwarf']);
    expect(viewFor(s, 'p2').objects[id]!.links?.['type']?.values).toBeUndefined();
    expect(JSON.stringify(viewFor(s, 'p2').log)).not.toContain('chooses Dwarf');
  });
});

describe('CR 118.3, 607.2d: "Sacrifice this enchantment, Reveal the creature type you chose: If target attacking creature token is the chosen type, ..."', () => {
  const attackWithAll = (s0: GameState): GameState => {
    let s = advanceTo(s0, 3, 'main1');
    s = toDeclareAttackers(s);
    const tokens = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    return declareAttackers(s, tokens.map((t) => [t, 'p2'] as [ObjectId, string]));
  };
  const activate = (s: GameState, target: ObjectId): GameState =>
    resolveAll(act(s, { type: 'activate', player: 'p1', source: plot(s), ability: 'p:0:1' }), { targets: [{ kind: 'object', id: target }] });

  it('CR 607.2d: the target is the chosen type: two +1/+1 counters and deathtouch; CR 608.2d: the type is revealed in the log', () => {
    let s = attackWithAll(enter('Dwarf'));
    const dwarf = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token' && JSON.stringify(s.defs[s.objects[id]!.defId] ?? s.objects[id]).includes('Dwarf'))!;
    s = activate(s, dwarf);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Hidden Plot')).toBe(false);
    expect(counters(s, dwarf, '+1/+1')).toBe(2);
    expect(hasKeyword(getChars(s, dwarf)!, 'deathtouch')).toBe(true);
    expect(JSON.stringify(viewFor(s, 'p2').log)).toContain('reveals the chosen creature type: Dwarf');
  });

  it('CR 607.2d: a target of another type: nothing happens (the enchantment is still sacrificed, the type still revealed)', () => {
    let s = attackWithAll(enter('Dwarf'));
    const elf = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token' && JSON.stringify(s.defs[s.objects[id]!.defId] ?? s.objects[id]).includes('Elf'))!;
    s = activate(s, elf);
    expect(counters(s, elf, '+1/+1')).toBe(0);
    expect(hasKeyword(getChars(s, elf)!, 'deathtouch')).toBe(false);
  });
});
