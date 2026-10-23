/**
 * WP22 over the local Oracle index (`.cache/scryfall`, git-ignored; skipped when absent, design 6.10). Nothing here is committed card text.
 *
 *  - contract C1: no card raises a parser error with the WP22 templates loaded;
 *  - guard G10 (design 6.8, D27, 10.3): adding the WP22 templates changes no formerly automated unit. Every ability the bootstrap templates alone automate
 *    fully is identical with the WP22 templates loaded, and (WP22 review) no ability they leave partly automated (an automated cost, trigger or target with
 *    a manual step) becomes a whole ManualAbilityDef. Checked on every card where the WP22 set could have had an effect: a WP22 template was used, the gate
 *    or the lint refused a template (the G10 fallback of parser/parse.ts), or a unit became ambiguous or ran out of chart budget. The baseline is this
 *    code with the bootstrap templates alone, so the template set is the only difference (what G10 is about); the review compared the whole index with
 *    the merge base as well (parser output of main), which a test cannot load;
 *  - design 6.9 (whole index only): a template matched by fewer than 20 cards is `experimental` (it caps its cards at partial until reviewed), a `stable`
 *    one has at least 20, and no template is dead.
 *
 * By default a deterministic fifth of the index (every 5th card in file order) is checked, as WP17's corpus test does with a tenth, so the suite stays
 * fast; OPENMTG_CORPUS_FULL=1 checks every card and the template statuses. The statuses of the committed files come from such a full run (34,466 cards).
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef } from '../../../src/types/ability';
import { BOOTSTRAP_TEMPLATES, parseCard } from '../../../src/parser/parse';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { canonicalJson } from '../../../src/parser/holes';
import { SLOW, slowTitle } from '../../slow';
import { WP22_TEMPLATES, localIndex, options } from './support';

// QT: about 18 s; a slow suite (npm run test:all). The index is read only when the suite runs.
const cards = SLOW ? localIndex() : null;
const FULL = (process.env['OPENMTG_CORPUS_FULL'] ?? '') !== '';

/**
 * W3b template review: WP22 templates made stable with fewer than 20 index cards, on reviewed evidence instead (design 6.9: every index match read against
 * its Oracle text, play tests, golden cards in test/m5/golden/cards/w3b-review.json where the review asked for them). Rows citing no three golden cards are
 * deviations recorded, like Path to Exile's.
 */
const REVIEWED_UNDER_20: Readonly<Record<string, string>> = {
  'sta.base.obj': 'CR 613.4b: all 3 index matches; golden Reduce in Stature, Illusory Wrappings, Belt of Giant Strength',
  'sta.cda.toughness': 'CR 604.3, 613.4a: all 5 index matches; golden Tymaret, Chosen from Death, People of the Woods, Wintermoor Commander',
  'sta.rule.extrablock': 'CR 509.1a: all 13 index matches; golden Night Market Guard, Spike-Tailed Ceratops, Foriysian Brigade',
  'abl.aslong.pump': 'CR 604.1, 611.3a, 613.4c: all 13 index matches reviewed; deviation (no golden card)',
  'abl.pumpgrant.aslong': 'CR 604.1, 613.4c: both index matches reviewed; deviation (no golden card)',
  'abl.aslong.anthem': 'CR 604.1, 611.3a: all 13 index matches reviewed; deviation (no golden card)',
  'abl.anthem.aslong': 'CR 604.1, 611.3a: all 7 index matches reviewed; deviation (no golden card)',
  'abl.kicked.counters.grant': 'CR 702.33d-e, 614.1c: all 6 index matches; Kavu Titan design 13 golden; deviation (one golden card)',
  'abl.pregame.begin': 'CR 103.6, 103.6a: all 18 index matches; Leyline of the Void design 13 golden; deviation (one golden card)',
  'eff.cont.loseall': 'CR 613.1f, 611.2b: all 5 index matches reviewed; deviation',
  'eff.cont.becomes.creature': 'CR 205.1b, 613.4b: all 4 index matches reviewed; deviation',
  'eff.cont.color': 'CR 105.3, 613.1e: all 8 index matches reviewed, Cerulean Wisps played; deviation',
  'eff.cont.switch': 'CR 613.4d: all 19 index matches reviewed, About Face played; deviation',
  'eff.cont.pump.foreach.power': 'CR 608.2h, 613.4c: all 7 index matches reviewed; deviation',
  'rst.cant.attack': 'CR 508.1c, 604.1: all 9 index matches; golden Demonic Torment, Cessation, Forced Worship',
  'rst.must.block': 'CR 509.1c: all 3 index matches; golden Razorgrass Screen, Watchdog, Spirespine',
  'rst.each.cant.block': 'CR 509.1b: all 5 index matches; golden Frenetic Raptor, Bedlam, Razorjaw Oni',
  'rst.each.cant.attack': 'CR 508.1c: all 6 index matches; golden Moat, Glacial Chasm, Evil Eye of Urborg',
  'eff.rst.each.cant.beblocked': 'CR 509.1b, 611.2c: all 9 index matches; golden Ghostform, Venser, the Sojourner, Tezzeret\'s Gatebreaker',
  'eff.rst.player.cant.cast': 'CR 601.3, 608.2h: the 3 gated index matches; golden Xantid Swarm, Render Silent, Innocuous Researcher',
  'rst.must.beblocked': 'CR 509.1c: all 15 index matches; golden Gaea\'s Protector, Canopy Stalker, Inescapable Brute',
  'cm.spells.more.any': 'CR 601.2f: all 11 index matches reviewed, Thalia and Squeeze played; deviation',
  'cm.spells.less.any': 'CR 601.2f, 118.7a: all 7 index matches reviewed, Helm of Awakening played; deviation',
  'cm.spells.more.you': 'CR 601.2f: all 7 index matches reviewed with the colored-amount fix, Derelor and Geist-Fueled Scarecrow played; deviation',
  'cm.spells.more.opp': 'CR 601.2f: all 5 index matches reviewed, God-Pharaoh\'s Statue and Thalia, the Survivor played; deviation',
  'eff.cm.spells.less.you': 'CR 601.2f, 611.2a: all 4 index matches reviewed; deviation',
  'rep.enters.tappedunless.either': 'CR 614.1d, 614.12: all 15 index matches (the whole class); Glacial Fortress design 13 golden; deviation',
  'rep.enters.choose.opponent': 'CR 614.12a, 607.2d: all 10 index matches reviewed; deviation',
  'rep.enters.choose.cardtype': 'CR 205.2a, 614.12a: both index matches reviewed; deviation',
  'rep.enters.choose.landtype': 'CR 205.3i, 614.12a: all 4 index matches reviewed with the basic-land-type options fix; deviation',
  'rep.enters.copy': 'CR 707.5, 614.1c: all 9 index matches; Clone design 13 golden; deviation',
  'rep.double.tokens': 'CR 614.1a, 616.1: all 3 index matches; Doubling Season design 13 golden; deviation',
  'rep.double.counters': 'CR 614.1a, 614.16: the only index match; Doubling Season design 13 golden; deviation',
  'rep.graveyard.exile.opponent': 'CR 614.1a, 400.3: the only index match; Leyline of the Void design 13 golden; deviation',
  'rep.graveyard.exile.any': 'CR 614.1a: the only index match; Rest in Peace design 13 golden; deviation',
  'rep.dies.exile': 'CR 700.4, 614.1a: all 9 index matches reviewed; deviation',
  // T3 (push wave) template review: every index match read against its Oracle text; golden test/m5/golden/cards/t3-review.json
  'sta.each.pump': 'CR 613.4c: all 4 index matches reviewed; golden Time of Heroes; deviation',
  'sta.loseall.base': 'CR 613.1f, 613.4b: both index matches (Humility, Poppet Factory); golden Humility, Humility and Opalescence played in test/m5/statics/rules-613.test.ts; deviation',
  'sta.loseall.each': 'CR 613.1f: the only index match; golden Dress Down; deviation',
  'sta.loseall.base.obj': 'CR 613.1f, 613.4b: both index matches; golden Utter Insignificance, Kasmina\'s Transmutation; deviation',
  'sta.typeadd.manavalue': 'CR 613.1d, 613.4b: the only index match; golden Opalescence; deviation',
  'eff.cont.pump.foreach': 'CR 608.2h, 611.2c: all 12 index matches reviewed (the amount is fixed on resolution, effects/handlers/lasting-fix.ts); golden Primal Bellow, Might of the Masses, Rampaging Brontodon',
  'eff.cont.elk': 'CR 205.1b, 613.1d-f: both index matches (Lizard, Connors\'s Curse; Oko, Thief of Crowns +1); deviation',
  'eff.cont.becomes.alltypes': 'CR 205.1b, 613.1d, 613.4b: the only index match, Mutavault (design 13 golden, with rid.stillLand); deviation',
  'rst.each.cant.beblocked': 'CR 509.1b: the only index match; golden Deepchannel Mentor; deviation',
};

/** No manual node anywhere in the ability (whole ability, step, cost part, nested ability). */
const fullyAutomated = (a: AbilityDef): boolean => {
  const json = JSON.stringify(a);
  return a.kind !== 'manual' && !json.includes('"op":"manual"') && !json.includes('"kind":"manual"');
};
const key = (a: AbilityDef): string => canonicalJson(JSON.parse(JSON.stringify(a, (k, v: unknown) => (k === 'prov' || k === 'src' ? undefined : v))) as unknown);

describe.skipIf(!SLOW || cards === null)(slowTitle('WP22 over the local Oracle index'), () => {
  it(`C1 and guard G10 on ${FULL ? 'every card' : 'every 5th card'}: no parser error; formerly automated units are unchanged and no partly automated ability becomes manual${FULL ? '; design 6.9: template statuses match corpus use' : ''}`, () => {
    const all = options([], { capabilities: ENGINE_CAPABILITIES });
    const boot = options([], { capabilities: ENGINE_CAPABILITIES, templates: [...BOOTSTRAP_TEMPLATES] });
    const ids = new Set(WP22_TEMPLATES.map((t) => t.id));
    const uses = new Map<string, number>();
    const errors: string[] = [];
    const changed: string[] = [];
    const demoted: string[] = [];
    let checked = 0;
    for (let i = 0; i < cards!.length; i += FULL ? 1 : 5) {
      const c = cards![i]!;
      checked++;
      const r = parseCard(c, all);
      let touched = false;
      for (const f of r.faces) {
        for (const d of f.diagnostics) {
          if (d.code === 'parser-error') errors.push(`${c.name}: ${d.message}`);
          if (d.code === 'ambiguous' || d.code === 'budget' || d.code === 'gate-mismatch' || d.code === 'lint') touched = true;
        }
        for (const id of f.templatesUsed) if (ids.has(id)) { uses.set(id, (uses.get(id) ?? 0) + 1); touched = true; }
      }
      if (!touched) continue;
      const b = parseCard(c, boot);
      b.faces.forEach((bf, fi) => {
        const now = new Set((r.faces[fi]?.abilities ?? []).map(key));
        for (const a of bf.abilities) if (fullyAutomated(a) && !now.has(key(a))) changed.push(`${c.name}: ${a.text}`);
        const after = new Map((r.faces[fi]?.abilities ?? []).map((a) => [a.text, a]));
        for (const a of bf.abilities) if (a.kind !== 'manual' && after.get(a.text)?.kind === 'manual') demoted.push(`${c.name}: ${a.text}`);
      });
    }
    expect(checked).toBeGreaterThan(FULL ? 30_000 : 6_000);
    expect(errors).toEqual([]);
    expect(changed).toEqual([]);
    expect(demoted, 'abilities that were not manual with the bootstrap templates and are a ManualAbilityDef with WP22 (G10, design 10.3)').toEqual([]);
    expect(uses.size, 'WP22 templates used at all').toBeGreaterThan(FULL ? WP22_TEMPLATES.length - 1 : 50);
    if (!FULL) return;
    const report = WP22_TEMPLATES.map((t) => ({ id: t.id, status: t.status, uses: uses.get(t.id) ?? 0 }));
    expect(report.filter((t) => t.uses === 0).map((t) => t.id), 'templates no real card uses').toEqual([]);
    expect(report.filter((t) => t.status === 'stable' && t.uses < 20 && !(t.id in REVIEWED_UNDER_20)).map((t) => `${t.id} (${t.uses})`), 'stable templates with fewer than 20 cards (design 6.9)').toEqual([]);
    expect(report.filter((t) => t.status === 'experimental' && t.uses >= 20).map((t) => `${t.id} (${t.uses})`), 'experimental templates that could be reviewed and made stable').toEqual([]);
  }, 900_000);
});
