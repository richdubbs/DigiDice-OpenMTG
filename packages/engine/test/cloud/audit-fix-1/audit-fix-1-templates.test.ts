/**
 * audit-fix-1: the round's parser, renderer and capability changes (no template added). One test per change; the behavior is in audit-fix-1-scenarios.test.ts.
 * CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 * - parser/lower/targets.ts: "another <card> from your graveyard" after "each player sacrifices ..." excludes only what you sacrificed (`which`), after a
 *   sacrifice by "you" what you sacrificed, and after any other sacrificer nothing is read (manual).
 * - render/fold-stdlibrary2.ts#returnAnotherThanSacrificed: prints "another" only for those two shapes (the old every-player exclusion is refused, G6);
 *   render/refs.ts refuses a `which` anywhere else.
 * - the source-choice templates (zz-fast5/t36.json, zz-cloud/std-rx35.json, zz-cloud/std-library-2.json): the choice is a `damageSource` choice among the
 *   battlefield, the stack and the command zone (CR 609.7a); render/fold.ts#sourceOfChoiceShield and fold-stdlibrary2.ts refuse a choice without `damageSource`.
 * - model/cap-walk.ts: `feature:ref.bound.which` and `op:chooseObjects.damageSource` are registered and emitted.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, renderGate, type CardDef, type OracleCard } from '../../../src/index';
import type { AbilityDef } from '../../../src/types/ability';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';

function card(name: string, type: string, text: string): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], keywords: [] } as OracleCard);
}
const json = (d: CardDef): string => JSON.stringify(d.faces);
const spellOf = (d: CardDef): AbilityDef => d.faces[0]!.abilities[0]!;
const ctx = { selfNames: ['Test Card'], selfTypes: ['Sorcery'] };
/** The ability with one replacement made by `edit` on its JSON text, as the gate sees it against the card's own Oracle text. */
const gateWith = (d: CardDef, edit: (s: string) => string): boolean => {
  const def = JSON.parse(edit(JSON.stringify(spellOf(d)))) as AbilityDef;
  return renderGate(def, [d.faces[0]!.oracleText.replace(new RegExp(d.name, 'g'), 'Test Card')], { ...ctx, selfNames: [d.name, 'Test Card'] }).ok;
};

describe('parser/lower/targets.ts (CR 701.21a, 608.2h, 109.2): "another" after a sacrifice', () => {
  it('after each player\'s sacrifice: only the one you controlled as it was sacrificed (`which: {controller: you}`), and it is full', () => {
    const d = card('Test Bone Draught', 'Sorcery', 'Each player sacrifices a creature of their choice. If you sacrificed a creature this way, you may return another creature card from your graveyard to your hand.');
    expect(d.automation.level).toBe('full');
    expect(json(d)).toContain('"not":{"is":{"ref":"bound","name":"sacrificed","which":{"controller":"you"}}}');
  });
  it('after a sacrifice by you alone: what you sacrificed, with no `which`', () => {
    const d = card('Test Lone Draught', 'Sorcery', 'You sacrifice a creature of your choice. If you sacrificed a creature this way, you may return another creature card from your graveyard to your hand.');
    if (d.automation.level === 'full') expect(json(d)).toContain('"not":{"is":{"ref":"bound","name":"sacrificed"}}');
    expect(json(d)).not.toContain('"which"');
  });
  it('the negative case: after an opponent\'s sacrifice, "another" is not read (the sentence is manual)', () => {
    const d = card('Test Foe Draught', 'Sorcery', 'Each opponent sacrifices a creature of their choice. You may return another creature card from your graveyard to your hand.');
    expect(d.automation.level).not.toBe('full');
    expect(json(d)).not.toContain('"name":"sacrificed"}}');
  });
});

describe('render/fold-stdlibrary2.ts, render/refs.ts (G6): "another" is printed only for what you sacrificed', () => {
  const d = card('Test Bone Draught', 'Sorcery', 'Each player sacrifices a creature of their choice. If you sacrificed a creature this way, you may return another creature card from your graveyard to your hand.');
  it('the compiled JSON passes the gate', () => {
    expect(gateWith(d, (s) => s)).toBe(true);
  });
  it('the negative case: the old JSON, every player\'s sacrificed card left out, fails the gate', () => {
    expect(gateWith(d, (s) => s.replace(',"which":{"controller":"you"}', ''))).toBe(false);
  });
  it('the negative case: another `which` than your own sacrifice fails the gate', () => {
    expect(gateWith(d, (s) => s.replace('"which":{"controller":"you"}', '"which":{"controller":"opponent"}'))).toBe(false);
  });
});

describe('the source-choice templates and folds (CR 609.7a): a `damageSource` choice among the battlefield, the stack and the command zone', () => {
  const shield = card('Test Bright Ward', 'Instant', 'The next time a source of your choice would deal damage to you this turn, prevent that damage.');
  const red = card('Test Ruby Ward', 'Instant', 'The next time a red source of your choice would deal damage to you this turn, prevent that damage.');
  const rebuke = card('Test Mirror Rebuke', 'Instant', "The next time a source of your choice would deal damage to you this turn, prevent that damage. When damage is prevented this way, Test Mirror Rebuke deals that much damage to that source's controller and you draw that many cards.");
  it('each compiles to the marked choice and is full', () => {
    for (const d of [shield, red, rebuke]) {
      expect(d.automation.level, d.name).toBe('full');
      expect(json(d), d.name).toContain('"damageSource":true');
      expect(json(d), d.name).toContain('"zone":["battlefield","stack","command"]');
    }
  });
  it('the negative case: a choice without `damageSource` fails the gate (render/fold.ts#sourceOfChoiceShield, fold-stdlibrary2.ts#sourceOfChoiceWhenPrevented)', () => {
    for (const d of [shield, red, rebuke]) {
      expect(gateWith(d, (s) => s), d.name).toBe(true);
      expect(gateWith(d, (s) => s.replace('"damageSource":true,', '')), d.name).toBe(false);
    }
  });
});

describe('model/capabilities.ts: the two new forms are registered', () => {
  it('feature:ref.bound.which and op:chooseObjects.damageSource (not the .other form, fail closed)', () => {
    expect(ENGINE_CAPABILITIES.has('feature:ref.bound.which')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('op:chooseObjects.damageSource')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('op:chooseObjects.damageSource.other')).toBe(false);
  });
});
