/**
 * M6-12: "that ability triggers an additional time" (CR 603.2d) for the cause the collector applies exactly (triggers/collect.ts#TRIGGER_MOD_CAPABILITIES): a
 * permanent entering the battlefield (CR 603.6a). Template zz-m6/triggers.json ("If <a permanent> entering [the battlefield] causes a triggered ability of a
 * permanent you control to trigger, that ability triggers an additional time."), reviewed on every index card it makes full (golden m6-12-review.json:
 * Panharmonicon, Yarok, the Desecrated, Naban, Dean of Iteration). Real fixture cards: Panharmonicon, Mulldrifter ("When this creature enters, draw two
 * cards."), Elvish Visionary ("When this creature enters, draw a card."), Soul Warden ("Whenever another creature enters, you gain 1 life."), Rest in Peace.
 */
import { describe, expect, it } from 'vitest';
import { capabilitiesOf, compileCard, ENGINE_CAPABILITIES, type AbilityDef, type GameState } from '../../../src/index';
import { getCard } from '../../fixtures';
import { scenario } from '../../m5/helpers';
import { cast, resolveAll, stackNames } from '../../m5/cr-examples/helpers';
import { lifeOf } from '../../m4/helpers';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { TEMPLATE_FILES } from '../../../src/parser/template-set';
import triggers from '../../../src/parser/templates/zz-m6/triggers.json';
import { exampleCard, fullyAutomated } from '../../m5/templates/support';

const hand = (s: GameState): number => s.zones.hand.p1!.length;

describe('CR 603.2d: static:triggerMod for a permanent entering', () => {
  it('static:triggerMod and feature:triggerMod.enters are capabilities; Panharmonicon is full', () => {
    expect(ENGINE_CAPABILITIES.has('static:triggerMod')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('feature:triggerMod.enters')).toBe(true);
    expect(compileCard(getCard('Panharmonicon')).automation.level).toBe('full');
  });

  // std-typechange-2: a creature DYING is registered since the collector judges it looking back (feature:triggerMod.dies, CR 603.10a; test/cloud/std-typechange-2);
  // a leave-the-battlefield cause of another kind (to exile) is still not
  it('the shapes not reviewed stay unregistered: a leave-the-battlefield cause other than dying (CR 603.10a look-back), another cause, a computed number', () => {
    const mod = (cause: object, additional: unknown): AbilityDef => ({ kind: 'static', text: 'x', effects: [{ s: 'triggerMod', cause, abilitiesOf: { controller: 'you' }, additional }] } as unknown as AbilityDef);
    expect(capabilitiesOf(mod({ ev: 'zoneChange', subject: { types: ['Creature'] }, from: 'battlefield', to: 'graveyard' }, 1))).toContain('feature:triggerMod.dies');
    const exiled = capabilitiesOf(mod({ ev: 'zoneChange', subject: { types: ['Creature'] }, from: 'battlefield', to: 'exile' }, 1));
    expect(exiled).toContain('feature:triggerMod.cause.zoneChange');
    // std-rx2: a bare attacker filter is registered (`feature:triggerMod.attacks`, Isshin); an attack cause with more to it (alone, a defender) is not
    expect(capabilitiesOf(mod({ ev: 'attacks', attacker: {}, alone: true }, 1))).toContain('feature:triggerMod.cause.attacks');
    expect(capabilitiesOf(mod({ ev: 'zoneChange', subject: {}, to: 'battlefield' }, { q: 'X' }))).toContain('feature:triggerMod.computed');
    for (const c of ['feature:triggerMod.cause.zoneChange', 'feature:triggerMod.cause.attacks', 'feature:triggerMod.computed']) expect(ENGINE_CAPABILITIES.has(c), c).toBe(false);
  });

  it('CR 603.2d: with Panharmonicon, Mulldrifter\'s enters trigger triggers an additional time (four cards)', () => {
    let s = scenario(['Panharmonicon', 'Mulldrifter', 'Island'], { p1: { hand: ['Mulldrifter'], battlefield: ['Panharmonicon', ...Array(5).fill('Island') as string[]] } });
    const before = hand(s);
    s = cast(s, 'Mulldrifter');
    s = resolveAll(s);
    expect(hand(s)).toBe(before - 1 + 4);
  });

  it('CR 603.2d: two Panharmonicons: three times (Elvish Visionary draws three)', () => {
    let s = scenario(['Panharmonicon', 'Elvish Visionary', 'Forest'], { p1: { hand: ['Elvish Visionary'], battlefield: ['Panharmonicon', 'Panharmonicon', 'Forest', 'Forest'] } });
    const before = hand(s);
    s = cast(s, 'Elvish Visionary');
    s = resolveAll(s);
    expect(hand(s)).toBe(before - 1 + 3);
  });

  it('CR 603.2d: an enchantment entering is not "an artifact or creature": Rest in Peace\'s enters trigger triggers once', () => {
    let s = scenario(['Panharmonicon', 'Rest in Peace', 'Plains'], { p1: { hand: ['Rest in Peace'], battlefield: ['Panharmonicon', 'Plains', 'Plains'] } });
    s = cast(s, 'Rest in Peace');
    s = resolveAll(s);
    expect(s.log.filter((l) => /Rest in Peace triggers/.test(l.text))).toHaveLength(1);
  });

  it('CR 603.2d: only abilities of permanents its controller controls: the opponent\'s Soul Warden triggers once, Alice\'s twice', () => {
    let s = scenario(['Panharmonicon', 'Soul Warden', 'Grizzly Bears', 'Forest'], { p1: { hand: ['Grizzly Bears'], battlefield: ['Panharmonicon', 'Soul Warden', 'Forest', 'Forest'] }, p2: { battlefield: ['Soul Warden'] } });
    s = cast(s, 'Grizzly Bears');
    s = resolveAll(s);
    expect([lifeOf(s, 'p1'), lifeOf(s, 'p2')]).toEqual([22, 21]);
    expect(stackNames(s)).toEqual([]);
  });
});

describe('zz-m6/triggers.json (guard G9, design 6.8; CONTRIBUTING "Adding a template")', () => {
  const T = triggers as Template[];
  const OPTS = defaultParseOptions();
  const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

  it('is loaded by the default compiler, each template stable with CR citations, two examples and three counter-examples', () => {
    expect(TEMPLATE_FILES.map((f) => f.file)).toContain('zz-m6/triggers.json');
    for (const t of T) {
      expect(t.cr, t.id).toContain('CR 603.2d');
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(3);
      expect(t.status, t.id).toBe('stable');
    }
  });

  it('every example lowers to one automated triggerMod for a permanent entering (fixed number 1, abilities of permanents you control)', () => {
    for (const t of T) {
      for (const ex of t.examples) {
        const f = parsedWith(t, ex.text);
        expect(fullyAutomated(f), `${t.id}: ${ex.text}`).toBe(true);
        const e = f.abilities[0]!.kind === 'static' ? f.abilities[0]!.effects[0]! : undefined;
        expect(e && e.s === 'triggerMod' ? [e.cause?.ev, (e.cause as { to?: string } | undefined)?.to, e.abilitiesOf, e.additional] : e, ex.text).toEqual(['zoneChange', 'battlefield', { controller: 'you' }, 1]);
      }
    }
  });

  it('every counter-example does not parse to that ability', () => {
    for (const t of T) {
      for (const text of t.counterExamples) {
        const f = parsedWith(t, text);
        expect(fullyAutomated(f) && JSON.stringify(f.abilities).includes('"triggerMod"'), `${t.id}: ${text}`).toBe(false);
      }
    }
  });
});
