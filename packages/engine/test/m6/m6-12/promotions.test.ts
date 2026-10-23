/**
 * M6-12: the promotion review (design 6.9 of the M5 ability-model design: "experimental until it has 20 reviewed matches or three independently verified golden
 * cards") of the two experimental templates the milestone 6 gate named: `eff.t6.exile.allGraveyards` ("Exile all graveyards.", CR 406.1, 404.1) and `eff.m6.flip`
 * ("flip it", CR 710.4). Every index card the promotion makes full was read against its Oracle text and is a golden card (test/m5/golden/cards/m6-12-review.json:
 * Rest in Peace, Farewell, Scavenger Grounds; Akki Lavarunner, Budoka Pupil, Bushi Tenderfoot, Callow Jushi, Hired Muscle, Orochi Eggwatcher; Morningtide is
 * FAST1 T6's golden card already, t6-review.json).
 * The fixture cards among them are played here and in test/m6/gate/acceptance.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars } from '../../../src/index';
import { TEMPLATE_SET } from '../../../src/parser/template-set';
import { replacementIndex, scanReplacements } from '../../../src/effects/replacement-index';
import { getCard } from '../../fixtures';
import { find, scenario } from '../../m5/helpers';
import { cast, resolveTop, target } from '../../m5/cr-examples/helpers';
import { lifeOf, tweak } from '../../m4/helpers';

describe('design 6.9: the promoted templates', () => {
  for (const id of ['eff.t6.exile.allGraveyards', 'eff.m6.flip']) {
    it(`${id} is stable`, () => {
      expect(TEMPLATE_SET.find((t) => t.id === id)?.status).toBe('stable');
    });
  }

  it('the fixture cards they capped at partial are full: Rest in Peace, Akki Lavarunner, Bushi Tenderfoot', () => {
    for (const n of ['Rest in Peace', 'Akki Lavarunner // Tok-Tok, Volcano Born', 'Bushi Tenderfoot // Kenzo the Hardhearted']) expect(compileCard(getCard(n)).automation.level, n).toBe('full');
  });
});

describe('CR 406.1, 404.1: "Exile all graveyards."', () => {
  it('Rest in Peace entering exiles every card in both graveyards', () => {
    let s = scenario(['Rest in Peace', 'Plains', 'Grizzly Bears', 'Shock'], { p1: { hand: ['Rest in Peace'], graveyard: ['Grizzly Bears', 'Shock'], battlefield: ['Plains', 'Plains'] }, p2: { graveyard: ['Grizzly Bears'] } });
    s = resolveTop(resolveTop(cast(s, 'Rest in Peace')));
    expect([s.zones.graveyard.p1, s.zones.graveyard.p2, s.zones.exile.length]).toEqual([[], [], 3]);
  });
});

describe('CR 710.2, 710.4: flipping, and what the flipped half can do at once', () => {
  it('CR 614.1a: Tok-Tok\'s replacement applies as soon as Akki Lavarunner flips (the replacement index sees the flipped status: M6-12 fix)', () => {
    let s = scenario(['Akki Lavarunner // Tok-Tok, Volcano Born', 'Shock', 'Mountain'], { p1: { battlefield: ['Akki Lavarunner // Tok-Tok, Volcano Born', 'Mountain'], hand: ['Shock'] } });
    const akki = find(s, 'Akki Lavarunner // Tok-Tok, Volcano Born', 'battlefield');
    const before = replacementIndex(s).get('damage') ?? [];
    expect(before).toHaveLength(0);
    s = tweak(s, (t) => { t.objects[akki]!.flipped = true; }); // as the flip op leaves it (CR 710.4; effects/handlers/dfc-ops.ts)
    expect(getChars(s, akki).name).toBe('Tok-Tok, Volcano Born');
    expect((replacementIndex(s).get('damage') ?? []).map((e) => e.object)).toEqual(scanReplacements(s).filter((e) => e.effect.replaces.ev === 'damage').map((e) => e.object));
    expect((replacementIndex(s).get('damage') ?? []).map((e) => e.object)).toEqual([akki]);
    s = resolveTop(cast(s, 'Shock', [target('p2')]));
    expect(lifeOf(s, 'p2')).toBe(17); // 2 + 1
  });
});
