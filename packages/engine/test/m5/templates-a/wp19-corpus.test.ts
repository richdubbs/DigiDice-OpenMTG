/**
 * WP19 corpus checks on the local Oracle index (git-ignored; skipped when absent; set OPENMTG_CACHE_DIR in a worktree).
 *
 * Guard G10 (design 6.8): "adding a template may change only formerly-manual units". Compared PER UNIT (test/m5/templates-a/g10-units.ts: the ability's
 * kind, its trigger, intervening "if", each cost part, each automated effect step, the whole of an ability without an effect) for EVERY ability of EVERY
 * card of the index (every 10th by default, the whole index on request, see below), fully automated or partial: every unit the bootstrap templates automate must be there, unchanged,
 * when the WP19 templates are added.
 * A partial ability that loses an automated step, trigger, cost or wrapper fails the test (the review found 72 such abilities in the first version).
 */
import { describe, expect, it } from 'vitest';
import { BOOTSTRAP_TEMPLATES, defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { automated, localIndex, options } from './support';
import { g10Losses, g10LossesOf, type G10Loss } from './g10-units';
import { SLOW, slowTitle } from '../../slow';

// QT: about 12 s; a slow suite (npm run test:all). The index is read only when the suite runs.
const index = SLOW ? localIndex() : null;

/**
 * The abilities the review of WP19 found regressed (per unit), by card name: "If you do" contagion (design 6.7), gate mismatches of new trigger readings
 * and of lead-in durations that lost a kept effect, a trigger, a cost, or a loyalty or chapter wrapper. Pinned one by one, so a later change that brings
 * one back fails here by name.
 */
const REVIEWED: readonly string[] = [
  'Tweeze', 'Plasma Cascade', 'Incinerating Blast', 'Fire Prophecy', 'Manhole Missile', 'Volcanic Spite', 'Take Out the Trash',
  'Squealing Devil', 'Nightshade Assassin', 'Wasteland Strangler', 'Daretti, Ingenious Iconoclast', 'Behold the Unspeakable // Vision of the Unspeakable',
  'Commander Mustard', "Firja's Retribution", 'Greater Stone Spirit', 'Herd Heirloom', "The Grim Captain's Locker", 'Jace, the Perfected Mind',
  'Mu Yanling, Celestial Wind', 'Acquisition Octopus', 'Psychic Frog', 'Boggart Prankster', 'Burning Vengeance', 'Kozilek, Butcher of Truth',
  'Minotaur, Roxxon CEO', 'Cabal Paladin', 'Chivalric Alliance', 'Cloaked Cadet', 'Four Knocks', "G'raha Tia", 'Hadran, Naya Sunseeder', 'Hired Claw',
  'Innocuous Insect', 'Jhoira, Weatherlight Captain', 'Jinxed Ring', 'Nighthawk, Dark Defender', 'Nulldrifter', 'Old Fat Spider', 'Omnath, Locus of Rage',
  'Pashalik Mons', 'Seasoned Consultant', 'Secrets of the Dead', 'Serra Disciple', 'Shadow the Hedgehog', 'Surtr, Fiery Jötun', 'The Gitrog Monster',
  'Thopter Shop', 'Tide Skimmer', 'Tui and La, Moon and Ocean', 'Ulamog, the Infinite Gyre', 'Wolfkin Outcast // Wedding Crasher', 'Wretched Gryff',
  'Stiltzkin, Moogle Merchant',
];

const show = (l: G10Loss): string => `${l.card} #${l.ability}: ${l.lost.map((u) => u.slice(0, 100)).join(' | ')}`;

describe.skipIf(!SLOW || index === null)(slowTitle('WP19 guard G10 per unit on the local Oracle index'), () => {
  const before = defaultParseOptions({ templates: [...BOOTSTRAP_TEMPLATES] }); // W3b: the default is the whole template set
  const after = options();

  it('the abilities the review found regressed keep every unit the bootstrap templates automate', () => {
    const byName = new Map(index!.map((c) => [c.name, c]));
    const missing = REVIEWED.filter((n) => !byName.has(n));
    expect(missing.length, `not in this index: ${missing.join(', ')}`).toBeLessThan(REVIEWED.length / 4);
    const losses = REVIEWED.flatMap((n) => (byName.has(n) ? g10Losses(byName.get(n)!, before, after) : []));
    expect(losses.map(show)).toEqual([]);
  });

  // Every STRIDE-th card in file order (default 10: about 3,400 cards, the cost of the first version, so the parallel suite keeps its timing; the
  // REVIEWED list above covers every ability the review found). OPENMTG_G10_STRIDE=1 runs the whole index (about 45 s alone; run for the review fixes:
  // 0 units lost over 34,473 cards).
  const stride = Math.max(1, Number(process.env['OPENMTG_G10_STRIDE'] ?? '10') || 10);
  it(`every ${stride === 1 ? '' : `${stride}th `}card: no automated unit of the bootstrap parse is lost or changed with WP19; WP19 adds automation`, () => {
    const losses: G10Loss[] = [];
    let gained = 0;
    for (let i = 0; i < index!.length; i += stride) {
      const c = index![i]!;
      const a = parseCard(c, before);
      const b = parseCard(c, after);
      losses.push(...g10LossesOf(c.name, a, b));
      // gained: abilities WP19 fully automates (render gate passed) that the bootstrap templates did not
      b.faces.forEach((fb, k) => fb.abilities.forEach((y, j) => {
        const fa = a.faces[k];
        const x = fa?.abilities[j];
        const was = x !== undefined && automated([x]) && fa!.gate[j]?.ok === true;
        if (!was && automated([y]) && fb.gate[j]?.ok === true) gained++;
      }));
    }
    expect(losses.slice(0, 30).map(show)).toEqual([]);
    expect(gained, 'WP19 automates abilities the bootstrap templates leave manual').toBeGreaterThan(1000 / stride);
  }, 600_000);
});
