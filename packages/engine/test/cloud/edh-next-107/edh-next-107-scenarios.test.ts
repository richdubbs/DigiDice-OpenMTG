/**
 * Concept lane attach-r2, edh-next-107: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the
 * game's default compiler, each with its negative case. CR cites are from memory (unverified): 509.1h, 506.3, 120.3, 302.6, 105.2, 602.5b.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, legal, pass, put, scenario } from '../../m3/scenario';
import { declareAttackers, passUntil, tweak, toDeclareAttackers, toDeclareBlockers, declareBlockers, lifeOf } from '../../m4/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], colors: OracleCard['colors'] = []): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors, keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const automated = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');

const BLOCKED = 'Whenever this creature or equipped creature becomes blocked, it deals 1 damage to defending player.';
const STING = card('Test Sting', 'Artifact Creature — Equipment Rat', `Equipped creature gets +1/+1.\n${BLOCKED}\nReconfigure {2}`, ['1', '1']);
const CRAB = card('Test Crab', 'Artifact Creature — Equipment Crab', BLOCKED, ['1', '1']);
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const WALL = card('Test Wall', 'Creature — Wall', '', ['0', '4']);

describe('CR 509.1h, 120.3 (unverified): "Whenever this creature or equipped creature becomes blocked, it deals 1 damage to defending player."', () => {
  it('is automated', () => expect(automated(STING)).toBe(true));
  /** The Sling is attached to the Bear by its own Reconfigure ability (CR 702.151a), played: target the Bear, pay {2}, resolve. */
  const setup = (equipBear: boolean): { s: GameState; bear: ObjectId; sting: ObjectId; wall: ObjectId } => {
    let s = scenario(['Forest', 'Forest'], { defs: [STING, CRAB, BEAR, WALL], p1: { battlefield: ['Test Sting', 'Test Bear', 'Forest', 'Forest'] }, p2: { battlefield: ['Test Wall'] } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    const sting = find(s, 'Test Sting', 'battlefield', 'p1');
    const wall = find(s, 'Test Wall', 'battlefield', 'p2');
    if (equipBear) {
      s = act(s, legal(s, 'p1', 'activate').find((a) => a.label.startsWith('Test Sting: Reconfigure'))!.action);
      for (let g = 0; g < 20 && (s.pending?.kind !== 'priority' || s.zones.stack.length > 0); g++) {
        const d = s.pending!;
        if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: bear }] });
        else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
        else s = pass(s);
      }
      expect(s.objects[sting]!.attachedTo).toBe(bear);
    }
    return { s, bear, sting, wall };
  };
  const block = (s0: GameState, attacker: ObjectId, wall: ObjectId | null): GameState => {
    let s = declareAttackers(toDeclareAttackers(s0), [[attacker]]);
    s = passUntil(s, (x) => x.pending?.kind === 'declareBlockers', 'blockers', 20);
    s = declareBlockers(s, wall === null ? [] : [[wall, attacker]]);
    return passUntil(s, (x) => x.turn.step === 'combatDamage' || x.turn.step === 'endCombat', 'after blocks', 30);
  };
  it('the equipped creature becomes blocked: the defending player takes 1 from the creature that became blocked (once)', () => {
    const { s, bear, wall } = setup(true);
    const t = block(s, bear, wall);
    expect(lifeOf(t, 'p2')).toBe(19);
  });
  it('the creature itself becomes blocked: the defending player takes 1 from it', () => {
    const s0 = scenario(['Forest'], { defs: [CRAB, WALL], p1: { battlefield: ['Test Crab'] }, p2: { battlefield: ['Test Wall'] } });
    const t = block(s0, find(s0, 'Test Crab', 'battlefield', 'p1'), find(s0, 'Test Wall', 'battlefield', 'p2'));
    expect(lifeOf(t, 'p2')).toBe(19);
  });
  it('negative: an unblocked attacker triggers nothing', () => {
    const { s, bear } = setup(true);
    const t = block(s, bear, null);
    expect(lifeOf(t, 'p2')).toBe(20 - 3); // the equipped Bear is 3/3 and unblocked; no trigger damage
  });
  it('negative: a creature that is not equipped and not the Equipment becoming blocked does not trigger', () => {
    const { s, bear, wall } = setup(false);
    const t = block(s, bear, wall);
    expect(lifeOf(t, 'p2')).toBe(20);
  });
});

describe('CR 602.5b, 105.2, 302.6 (unverified): "Activate only if enchanted creature is white and untapped"', () => {
  const AURA = card('Test Chosen', 'Enchantment — Aura', 'Enchant creature you control\nTap enchanted creature: You gain 3 life. Activate only if enchanted creature is white and untapped and only once each turn.');
  const WHITE = card('Test Knight', 'Creature — Knight', '', ['2', '2'], ['W']);
  const GREEN = card('Test Elf', 'Creature — Elf', '', ['1', '1'], ['G']);
  it('is automated', () => expect(automated(AURA)).toBe(true));
  const setup = (host: string): { s: GameState; aura: ObjectId; host: ObjectId } => {
    const s0 = scenario(['Forest'], { defs: [AURA, WHITE, GREEN], p1: { battlefield: [host] } });
    const h = find(s0, host, 'battlefield', 'p1');
    const aura = put(s0, 'p1', 'battlefield', 'Test Chosen');
    const s = tweak(s0, (t) => { t.objects[aura]!.attachedTo = h; });
    return { s, aura, host: h };
  };
  const canActivate = (s: GameState, aura: ObjectId): boolean => legal(s, 'p1', 'activate').some((a) => a.label.includes('Test Chosen') || (a as unknown as { source?: string }).source === aura);
  it('a white untapped host: the ability can be activated', () => {
    const { s, aura } = setup('Test Knight');
    expect(canActivate(s, aura)).toBe(true);
  });
  it('negative: a green host cannot', () => {
    const { s, aura } = setup('Test Elf');
    expect(canActivate(s, aura)).toBe(false);
  });
  it('negative: a tapped white host cannot', () => {
    const { s, aura, host } = setup('Test Knight');
    const t = tweak(s, (x) => { x.objects[host]!.tapped = true; });
    expect(canActivate(t, aura)).toBe(false);
  });
  void getChars; void act;
});

describe('CR 601.2c, 601.2f, 602.2b (unverified): "Activated abilities of Equipment you control that target this creature cost {1} less to activate."', () => {
  const ASPIRANT = card('Test Aspirant', 'Creature — Warrior', 'Activated abilities of Equipment you control that target this creature cost {1} less to activate.', ['2', '2']);
  const BLADE = card('Test Blade', 'Artifact — Equipment', 'Equipped creature gets +1/+1.\nEquip {2}', undefined);
  it('is automated', () => expect(automated(ASPIRANT)).toBe(true));
  const untappedForests = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && getChars(s, id).name === 'Forest' && !s.objects[id]!.tapped).length;
  const equipTo = (host: string): GameState => {
    let s = scenario(['Forest', 'Forest'], { defs: [ASPIRANT, BLADE, BEAR], p1: { battlefield: ['Test Aspirant', 'Test Blade', 'Test Bear', 'Forest', 'Forest'] } });
    const blade = find(s, 'Test Blade', 'battlefield', 'p1');
    const target = find(s, host, 'battlefield', 'p1');
    s = act(s, legal(s, 'p1', 'activate').find((a) => a.label.startsWith('Test Blade: Equip'))!.action);
    for (let g = 0; g < 20 && (s.pending?.kind !== 'priority' || s.zones.stack.length > 0); g++) {
      const d = s.pending!;
      if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: target }] });
      else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else s = pass(s);
    }
    expect(s.objects[blade]!.attachedTo).toBe(target);
    return s;
  };
  it('equipping the Aspirant costs {1}: one Forest stays untapped', () => expect(untappedForests(equipTo('Test Aspirant'))).toBe(1));
  it('negative: equipping another creature costs the full {2}', () => expect(untappedForests(equipTo('Test Bear'))).toBe(0));
});

describe('CR 601.2i, 500.1, 707.10 (unverified): "Whenever enchanted player casts a spell other than the first spell they cast each turn or copies a spell, this Aura deals 2 damage to them."', () => {
  const HEX = card('Test Hex', 'Enchantment — Aura Curse', 'Enchant player\nWhenever enchanted player casts a spell other than the first spell they cast each turn or copies a spell, this Aura deals 2 damage to them.');
  const SIP = card('Test Sip', 'Instant', 'You gain 1 life.');
  it('is automated', () => expect(automated(HEX)).toBe(true));
  const play = (casts: number): GameState => {
    let s = scenario(['Forest'], { defs: [HEX, SIP], p1: { hand: ['Test Sip', 'Test Sip', 'Test Sip'] } });
    s.objects[put(s, 'p1', 'battlefield', 'Test Hex')]!.attachedTo = 'p1'; // test setup: the Curse enchants its controller (CR 303.4)
    for (let i = 0; i < casts; i++) {
      s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Sip', 'hand', 'p1') });
      for (let g = 0; g < 30 && (s.pending?.kind !== 'priority' || s.zones.stack.length > 0); g++) s = s.pending?.kind === 'payCost' ? answer(s, { kind: 'payCost', auto: true }) : pass(s);
    }
    return s;
  };
  it('the first spell of the turn does nothing', () => expect(lifeOf(play(1), 'p1')).toBe(21));
  it('the second spell costs the enchanted player 2 life (the Aura is the source)', () => expect(lifeOf(play(2), 'p1')).toBe(20)); // +1 +1 -2
  it('the third spell costs 2 more', () => expect(lifeOf(play(3), 'p1')).toBe(19)); // +3 -4
});
