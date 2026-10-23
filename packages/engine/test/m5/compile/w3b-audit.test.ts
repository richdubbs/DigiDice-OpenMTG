/**
 * W3b audit regressions (game path, default compiler). One describe per finding; each pins the card the audit named, with a synthetic wording (design 6.10)
 * and, where the local index is present, the real card's own text (skipped without it).
 *
 *   1. Activated abilities whose cost moves ~ out of the hand or the graveyard function there (CR 113.6j, 113.6m): Adorned Crocodile's Renew, Elemental
 *      Masterpiece's and Magma Opus's discard ability, Wither and Bloom (the fix is parser/lower/activation.ts#activationZone).
 *   2. "Transformed permanent" is any double-faced permanent with its back face up, modal ones included, never a melded one (CR 701.27g, 712.1):
 *      Mutagen Connoisseur, Oculus Whelp.
 *   3. A quoted ability's display text shows the words inside the quotes ("This token can't block."), not a padded "~": Harried Spearguard.
 *   4. An ability that can never function where the engine runs it is manual: "This spell has flash as long as ..." (Crashing Tide, CR 113.6e, 702.8a,
 *      601.3d) and any zoneless ability of a face that is never a permanent (CR 110.4, 113.6, 113.6p).
 *   5. Layer-2 control changes are not advertised until the milestone 3/4 call-sites read the layered controller (CR 108.4, 613.1b): Mind Harness,
 *      Biting Tether, Act of Treason.
 */
import { describe, expect, it } from 'vitest';
import { ENGINE_CAPABILITIES, applyAction, capabilitiesOf, compileCard, getChars, type AbilityDef, type ActivatedAbilityDef, type CardDef, type GameState, type ManualAbilityDef, type ObjectId, type OracleCard } from '../../../src/index';
import { act, advanceTo, find, legal, passBoth, reject, scenario, zoneNames } from '../../m3/scenario';
import { drive, objectTarget } from '../announce/support';
import { localIndex } from '../parser/support';
import { abilities, card, creature } from './helpers';

const index = localIndex();
const real = (name: string): OracleCard | undefined => index?.find((c) => c.name === name);
const offered = (s: GameState, id: ObjectId, player: 'p1' | 'p2' = 'p1'): string[] =>
  legal(s, player, 'activate').filter((a) => a.object === id).map((a) => (a.action as { ability: string }).ability);
const activatedOf = (def: CardDef): ActivatedAbilityDef[] => abilities(def).filter((a): a is ActivatedAbilityDef => a.kind === 'activated');
const manualOf = (def: CardDef, face = 0): ManualAbilityDef[] => abilities(def, face).filter((a): a is ManualAbilityDef => a.kind === 'manual');
const exiled = (s: GameState): string[] => s.zones.exile.map((x) => s.objects[x]!.defId);
const names = (s: GameState): string[] => s.zones.battlefield.map((x) => s.defs[s.objects[x]!.defId]!.name);

/** Every ability nested in a definition (granted by layer 6 or carried by a created token), with the path that reached it. */
function nested(def: CardDef): AbilityDef[] {
  const out: AbilityDef[] = [];
  const walk = (x: unknown, inside: boolean): void => {
    if (Array.isArray(x)) { for (const y of x) walk(y, inside); return; }
    if (typeof x !== 'object' || x === null) return;
    const r = x as Record<string, unknown>;
    if (inside && typeof r['kind'] === 'string' && typeof r['text'] === 'string' && ['static', 'activated', 'triggered'].includes(r['kind'] as string)) out.push(r as unknown as AbilityDef);
    for (const [k, v] of Object.entries(r)) walk(v, inside || k === 'abilities' || k === 'add');
  };
  for (const f of def.faces) for (const a of f.abilities) walk(a, false);
  return out;
}

// ---- 1. CR 113.6j, 113.6m ------------------------------------------------------------------------------------------------------------------------------

describe('W3b audit 1, CR 113.6j, 113.6m: abilities paid with ~ from the hand or the graveyard are offered there, and only there', () => {
  it('Elemental Masterpiece (synthetic wording): "{U/R}{U/R}, Discard this card: Create a Treasure token." on a sorcery is activated from the hand', () => {
    const def = compileCard(card('Create two 4/4 blue and red Elemental creature tokens.\n{U/R}{U/R}, Discard this card: Create a Treasure token.', { name: 'Test Opus', type_line: 'Sorcery', mana_cost: '{5}{U}{R}' }));
    expect(def.automation.level).toBe('full');
    expect(activatedOf(def)[0]).toMatchObject({ zone: ['hand'], cost: { other: [{ kind: 'discard', self: true }] } });
    let s = scenario(['Island', 'Mountain'], { p1: { hand: ['Test Opus'], battlefield: ['Island', 'Mountain'] }, defs: [def] });
    const id = find(s, 'Test Opus', 'hand');
    expect(offered(s, id)).toEqual(['p:0:1']);
    s = drive(act(s, { type: 'activate', player: 'p1', source: id, ability: 'p:0:1' }), []);
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual(['Test Opus']); // discarded as the cost (CR 701.9a, 602.2b)
    s = passBoth(s);
    expect(names(s)).toContain('Treasure Token');
    expect(names(s).filter((n) => n.includes('Elemental'))).toEqual([]); // the spell ability was not cast
  });

  it('Wither and Bloom (synthetic wording): "{1}{B}, Exile this card from your graveyard: ..." on a sorcery works from the graveyard, as a sorcery', () => {
    const def = compileCard(card('Target creature gets -3/-3 until end of turn.\n{1}{B}, Exile this card from your graveyard: Put a +1/+1 counter on target creature you control. Activate only as a sorcery.', { name: 'Test Wither', type_line: 'Sorcery', mana_cost: '{1}{B}' }));
    expect(def.automation.level).toBe('full');
    expect(activatedOf(def)[0]).toMatchObject({ zone: ['graveyard'], sorcerySpeed: true });
    let s = scenario(['Swamp', 'Grizzly Bears'], { p1: { graveyard: ['Test Wither'], battlefield: ['Swamp', 'Swamp', 'Grizzly Bears'] }, defs: [def] });
    const id = find(s, 'Test Wither', 'graveyard');
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    expect(offered(s, id)).toEqual(['p:0:1']);
    s = passBoth(drive(act(s, { type: 'activate', player: 'p1', source: id, ability: 'p:0:1' }), [{ kind: 'chooseTargets', targets: [objectTarget(bears)] }]));
    expect(exiled(s)).toEqual(['Test Wither']);
    expect(s.objects[bears]!.counters['+1/+1']).toBe(1);
  });

  it.skipIf(real('Adorned Crocodile') === undefined)('Adorned Crocodile: Renew is offered and resolves from the graveyard; never from the battlefield', () => {
    const def = compileCard(real('Adorned Crocodile')!);
    expect(def.automation.level).toBe('full');
    expect(activatedOf(def)[0]).toMatchObject({ zone: ['graveyard'], label: 'Renew', sorcerySpeed: true });
    const name = def.name;
    let s = scenario(['Swamp', 'Grizzly Bears'], { p1: { graveyard: [name], battlefield: ['Swamp', 'Swamp', 'Grizzly Bears'] }, defs: [def] });
    const id = find(s, name, 'graveyard');
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    expect(offered(s, id)).toEqual(['p:0:1']);
    s = passBoth(drive(act(s, { type: 'activate', player: 'p1', source: id, ability: 'p:0:1' }), [{ kind: 'chooseTargets', targets: [objectTarget(bears)] }]));
    expect(exiled(s)).toEqual([name]);
    expect(s.objects[bears]!.counters['+1/+1']).toBe(1);
    const onField = scenario(['Swamp'], { p1: { battlefield: [name, 'Swamp', 'Swamp'] }, defs: [def] });
    const there = find(onField, name, 'battlefield');
    expect(offered(onField, there)).toEqual([]);
    expect(reject(onField, { type: 'activate', player: 'p1', source: there, ability: 'p:0:1' }).rules).toContain('CR 113.6');
  });

  it.skipIf(real('Elemental Masterpiece') === undefined || real('Wither and Bloom') === undefined || real('Magma Opus') === undefined)('the real cards: the discard / exile abilities state their zone', () => {
    expect(activatedOf(compileCard(real('Elemental Masterpiece')!))[0]).toMatchObject({ zone: ['hand'] });
    expect(activatedOf(compileCard(real('Magma Opus')!))[0]).toMatchObject({ zone: ['hand'] });
    expect(activatedOf(compileCard(real('Wither and Bloom')!))[0]).toMatchObject({ zone: ['graveyard'] });
  });
});

// ---- 2. CR 701.27g ---------------------------------------------------------------------------------------------------------------------------------------

/** A synthetic modal double-faced card: a sorcery front, a land back (CR 712.1, 712.11b). */
const modal = compileCard({
  name: 'Test Rockfall // Test Rockfall Pass', oracle_id: '00000000-0000-4000-8000-0000000000a1', layout: 'modal_dfc', type_line: 'Sorcery // Land', mana_cost: '{R}',
  card_faces: [
    { name: 'Test Rockfall', type_line: 'Sorcery', mana_cost: '{R}', oracle_text: 'Test Rockfall deals 1 damage to any target.' },
    { name: 'Test Rockfall Pass', type_line: 'Land', mana_cost: '', oracle_text: '{T}: Add {R}.' },
  ],
} as unknown as OracleCard);

describe('W3b audit 2, CR 701.27g: a transformed permanent is any double-faced permanent with its back face up (modal ones too), never a melded one', () => {
  const counter = compileCard(creature('This creature gets +1/+0 for each transformed permanent you control.', { name: 'Test Connoisseur', power: '1', toughness: '5' }));
  const whelp = compileCard(creature('As long as you control a transformed permanent, this creature has flying.', { name: 'Test Whelp', power: '1', toughness: '1' }));
  const delver = 'Delver of Secrets // Insectile Aberration';

  it('Mutagen Connoisseur (synthetic wording): a transforming card and a modal card played as its back face both count; front faces do not', () => {
    expect(counter.automation.level).toBe('full');
    const s = scenario([delver], { p1: { battlefield: ['Test Connoisseur', { name: delver, face: 1 }, { name: delver }, { name: modal.name, face: 1 }] }, defs: [counter, modal] });
    const id = find(s, 'Test Connoisseur', 'battlefield');
    expect(getChars(s, id).power).toBe('3'); // Insectile Aberration and Test Rockfall Pass
    const front = scenario([delver], { p1: { battlefield: ['Test Connoisseur', { name: modal.name, face: 0 }] }, defs: [counter, modal] });
    expect(getChars(front, find(front, 'Test Connoisseur', 'battlefield')).power).toBe('1');
  });

  it('a melded permanent is never a transformed permanent (CR 701.27g)', () => {
    const meld: CardDef = { ...modal, id: 'Test Melded', name: 'Test Melded', layout: 'meld' };
    const s = scenario([], { p1: { battlefield: ['Test Connoisseur', { name: 'Test Melded', face: 1 }] }, defs: [counter, meld] });
    expect(getChars(s, find(s, 'Test Connoisseur', 'battlefield')).power).toBe('1');
  });

  it('Oculus Whelp (synthetic wording): "as long as you control a transformed permanent" is true with a modal back face', () => {
    const s = scenario([], { p1: { battlefield: ['Test Whelp', { name: modal.name, face: 1 }] }, defs: [whelp, modal] });
    expect(getChars(s, find(s, 'Test Whelp', 'battlefield')).keywords.map((k) => k.keyword)).toContain('flying');
    const f = scenario([], { p1: { battlefield: ['Test Whelp', { name: modal.name, face: 0 }] }, defs: [whelp, modal] });
    expect(getChars(f, find(f, 'Test Whelp', 'battlefield')).keywords.map((k) => k.keyword)).not.toContain('flying');
  });

  it.skipIf(real('Mutagen Connoisseur') === undefined)('Mutagen Connoisseur: counts a modal double-faced permanent with its back face up', () => {
    const def = compileCard(real('Mutagen Connoisseur')!);
    const s = scenario([delver], { p1: { battlefield: [def.name, { name: delver, face: 1 }, { name: modal.name, face: 1 }] }, defs: [def, modal] });
    const id = find(s, def.name, 'battlefield');
    expect(Number(getChars(s, id).power)).toBe(Number(def.faces[0]!.power) + 2);
  });
});

// ---- 3. quoted ability display text -------------------------------------------------------------------------------------------------------------------

describe('W3b audit 3: a quoted ability shows the words inside the quotes, never a padded "~" (display only; `self` is unchanged)', () => {
  it('Harried Spearguard (synthetic wording): the Rat token\'s ability reads "This token can\'t block." and still restricts the token itself', () => {
    const def = compileCard(creature('Haste\nWhen this creature dies, create a 1/1 black Rat creature token with "This token can\'t block."', { name: 'Test Spearguard' }));
    expect(def.automation.level).toBe('full');
    const tok = nested(def);
    expect(tok).toHaveLength(1);
    expect(tok[0]).toMatchObject({ kind: 'static', text: "This token can't block.", effects: [{ s: 'restrict', subject: { ref: 'self' }, mode: 'cant', action: 'block' }] });
  });

  it('a granted quoted ability names "this creature" in its own text (Oculus Whelp\'s wording)', () => {
    const def = compileCard(creature('As long as you control an artifact, this creature has "When this creature dies, draw a card."', { name: 'Test Whelpling' }));
    expect(nested(def).map((a) => a.text)).toEqual(['When this creature dies, draw a card.']);
  });

  it.skipIf(real('Harried Spearguard') === undefined || real('Oculus Whelp') === undefined)('the real cards: no nested ability text starts with blanks or shows "~"', () => {
    for (const n of ['Harried Spearguard', 'Oculus Whelp']) {
      const texts = nested(compileCard(real(n)!)).map((a) => a.text);
      expect(texts.length, n).toBeGreaterThan(0);
      for (const t of texts) {
        expect(t, n).toBe(t.trim());
        expect(t, n).not.toContain('~');
      }
    }
  });
});

// ---- 4. abilities that cannot function where the engine runs them -------------------------------------------------------------------------------------

describe('W3b audit 4, CR 113.6, 113.6e: an ability that can never function where the engine runs it is manual, never full', () => {
  const tide = compileCard(card('This spell has flash as long as you control a Wizard.\nReturn target creature to its owner\'s hand.\nDraw a card.', { name: 'Test Tide', type_line: 'Sorcery', mana_cost: '{1}{U}' }));

  // r3-static (Standard round 3): "This spell has flash as long as ..." is read now: the static states the zones the card is cast from and the stack (CR 113.6e),
  // and the casting rules read it as the card is cast (statics/hooks.ts#ownFlashGrant, rules/timing.ts); before, the line was manual and the card cast at sorcery speed
  it('Crashing Tide (synthetic wording): "This spell has flash as long as ..." on a sorcery is a static ability that functions where the card is cast from', () => {
    expect(manualOf(tide)).toEqual([]);
    const flash = abilities(tide).find((a) => a.kind === 'static');
    expect(flash).toMatchObject({ kind: 'static', zone: ['hand', 'graveyard', 'exile', 'library', 'stack'] });
  });

  it('play: with a Wizard the sorcery is cast in an opponent\'s upkeep (CR 702.8a); without one it still casts at sorcery speed only', () => {
    const wizard = compileCard(creature('', { name: 'Test Wizard', type_line: 'Creature — Human Wizard' }));
    for (const [battlefield, flash] of [[['Island', 'Island', 'Grizzly Bears'], false], [['Island', 'Island', 'Grizzly Bears', 'Test Wizard'], true]] as const) {
      let s = scenario(['Island', 'Grizzly Bears'], { p1: { hand: ['Test Tide'], battlefield: [...battlefield] }, defs: [tide, wizard] });
      s = advanceTo(s, 2, 'upkeep');
      while (s.pending?.player !== 'p1') s = act(s, { type: 'pass', player: s.pending!.player });
      if (flash) expect(applyAction(s, { type: 'cast', player: 'p1', card: find(s, 'Test Tide', 'hand') }).error).toBeUndefined();
      else expect(reject(s, { type: 'cast', player: 'p1', card: find(s, 'Test Tide', 'hand') }).message).toMatch(/sorcery/i);
    }
    let s = scenario(['Island', 'Grizzly Bears'], { p1: { hand: ['Test Tide'], battlefield: ['Island', 'Island'] }, p2: { battlefield: ['Grizzly Bears'] }, defs: [tide] });
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p2');
    s = passBoth(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Tide', 'hand') }), [{ kind: 'chooseTargets', targets: [objectTarget(bears)] }]));
    expect(zoneNames(s, 'hand', 'p2')).toContain('Grizzly Bears');
  });

  it('the same line on a permanent card (Colossal Rattlewurm, Supernatural Rescue) is read the same way; a static of a permanent that grants itself another keyword works on the battlefield', () => {
    const def = compileCard(creature('This spell has flash as long as you control a Desert.\nTrample', { name: 'Test Wurm' }));
    expect(manualOf(def)).toEqual([]);
    expect(compileCard(creature('This creature has flying as long as you control a Plains.', { name: 'Test Glider' })).automation.level).toBe('full');
  });

  it('CR 113.6p: a Hero card\'s activated ability (it functions in the command zone, never on the battlefield) is manual', () => {
    const def = compileCard(card('{T}: Target creature you control gets +1/+1 until end of turn.', { name: 'Test Hero', type_line: 'Hero', mana_cost: '' }));
    expect(abilities(def)[0]).toMatchObject({ kind: 'manual', shape: 'activated' });
    expect(def.automation.level).toBe('manual');
  });

  it.skipIf(real('Crashing Tide') === undefined || real('Mutual Destruction') === undefined || real('Supernatural Rescue') === undefined)('the real cards: the flash line is the static ability (r3-static)', () => {
    for (const n of ['Crashing Tide', 'Mutual Destruction', 'Supernatural Rescue']) expect(abilities(compileCard(real(n)!))[0], n).toMatchObject({ kind: 'static' });
  });
});

// ---- 5. CR 613.1b layer 2 -----------------------------------------------------------------------------------------------------------------------------

describe('W3b audit 5, CR 108.4, 613.1b: a layer-2 control change needs feature:control.layered (MX2: advertised; the stored controller is the controller after layer 2)', () => {
  // MX2 (core/control.ts): the call-sites the audit named (attackers and blockers, activations, the untap step, the legend rule) read the stored controller,
  // which is now kept equal to the controller after layer 2. Behavior: test/mx2/control.test.ts (Act of Treason, Control Magic, CR 302.6, 502.3, 506.4).
  it('the capability walker asks for it and ENGINE_CAPABILITIES has it', () => {
    const mod = { kind: 'static' as const, text: 'x', effects: [{ s: 'continuous' as const, affects: { ref: 'attachedTo' as const }, mods: [{ layer: 2 as const, controller: { ref: 'you' as const } }] }] };
    expect(capabilitiesOf(mod as unknown as AbilityDef)).toContain('feature:control.layered');
    expect(ENGINE_CAPABILITIES.has('feature:control.layered')).toBe(true);
  });

  it('Mind Harness and Biting Tether (synthetic wording): "You control enchanted creature." is automated', () => {
    const def = compileCard(card('Enchant creature\nYou control enchanted creature.', { name: 'Test Harness', type_line: 'Enchantment — Aura', mana_cost: '{2}{U}' }));
    expect(def.automation.level).toBe('full');
    expect(manualOf(def)).toEqual([]);
  });

  it('Act of Treason (synthetic wording): "Gain control of target creature until end of turn." is automated', () => {
    const def = compileCard(card('Gain control of target creature until end of turn. Untap that creature. It gains haste until end of turn.', { name: 'Test Treason', type_line: 'Sorcery', mana_cost: '{2}{R}' }));
    expect(def.automation.level).toBe('full');
    expect(JSON.stringify(def.faces[0]!.abilities)).not.toMatch(/feature:control\.layered/);
  });

  it.skipIf(['Mind Harness', 'Biting Tether', 'Act of Treason', 'Control Magic'].some((n) => real(n) === undefined))('the real cards are full', () => {
    for (const n of ['Mind Harness', 'Biting Tether', 'Act of Treason', 'Control Magic']) expect(compileCard(real(n)!).automation.level, n).toBe('full');
  });
});

