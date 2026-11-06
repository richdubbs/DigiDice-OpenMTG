/**
 * Commander lane edh-misc, round edh-misc-3: the template data of parser/templates/zz-cloud/edh-misc-3.json ("return all <things> to their owners' hands except for
 * <creature types>", Whelming Wave and Slinn Voda), the render alternatives the round added (the exception said after the destination; "from the battlefield to your hand";
 * "monstrosity X, where X is ..."), and the promotions of this round. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact
 * render gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an
 * example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in
 * edh-misc-3-scenarios.test.ts. CR cites checked against the Comprehensive Rules of 2026-09-25 (fetched in the round).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/types/card';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import round from '../../../src/parser/templates/zz-cloud/edh-misc-3.json';
import review from '../../m5/golden/cards/edh-misc-3-review.json';
import cmd2Review from '../../m5/golden/cards/cloud-cmd2-review.json';
import cmd5Review from '../../m5/golden/cards/cloud-cmd5-review.json';
import lciReview from '../../m5/golden/cards/cloud-std-lci-review.json';
import mana1Review from '../../m5/golden/cards/cloud-std-mana-1-review.json';
import r5Review from '../../m5/golden/cards/cloud-r5-static-review.json';
import t8Review from '../../m5/golden/cards/fast2-t8-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = round as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
const parse = (text: string, type = 'Sorcery') => parseCard(card('Example Advisor', type, text, type.includes('Creature') ? { power: '1', toughness: '1' } : {}), OPTS).faces[0]!;
type Golden = { card: string; verified: string; expect?: string }[];
const golden = review as Golden;

describe('edh-misc-3 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-misc-3.json, after edh-misc-1, before edh-perms-1) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-misc-3.json');
    expect(files.indexOf('zz-cloud/edh-misc-3.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-misc-1.json'));
    expect(files.indexOf('zz-cloud/edh-misc-3.json')).toBeLessThan(files.indexOf('zz-cloud/edh-perms-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.edhx3.*', () => {
    expect(MECH.map((t) => t.id)).toEqual(['eff.edhx3.return.hand.allExceptFor']);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^eff\.edhx3\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9 deviation (guide section 5, "Narrow wordings"): eff.edhx3.return.hand.allExceptFor is stable on the two cards of the EDHREC top 5,000 that print it, both golden (Whelming Wave, Slinn Voda, the Rising Deep)', () => {
    const t = MECH[0]!;
    expect(t.status).toBe('stable');
    expect(golden.filter((g) => g.verified.includes(`(${t.id})`)).map((g) => g.card).sort()).toEqual(['Slinn Voda, the Rising Deep', 'Whelming Wave']);
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('the promotions of this round have their golden cards (in the template\'s own round file, design 6.9 narrow wordings) and are stable; the ones it left alone are not', () => {
    const using = (file: Golden, id: string): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card).sort();
    expect(using(cmd2Review as Golden, 'sta.cmd2.aslong.pump.andGroupGrant')).toEqual(['Angelic Field Marshal']);
    expect(using(cmd5Review as Golden, 'sta.cmd5.player.cant.cast.combat')).toEqual(['Basandra, Battle Seraph', 'Marisi, Breaker of the Coil']);
    expect(using(lciReview as Golden, 'eff.stdlci.put.anyNumber.bf.tapped')).toEqual(['Wrenn and Seven']);
    expect(using(mana1Review as Golden, 'rid.stdmana1.spent.cantBeCountered')).toEqual(['Boseiju, Who Shelters All']);
    expect(using(r5Review as Golden, 'eff.r5static.attackTax.you.lasting')).toEqual(['Summon: Yojimbo']);
    expect(using(t8Review as Golden, 'eff.t8.gainlife.foreach3')).toEqual(['Crypt Incursion', 'Starlight']);
    expect(using(golden, 'eff.cmd1.token.you.attacking.player')).toEqual(['Soaring Lightbringer']);
    expect(using(golden, 'rep.cmd1.enters.additionalCounter.self')).toEqual(['Master Chef']);
    expect(using(golden, 'rep.cmd1.others.enter.additionalCounter.plural')).toEqual(['Master Chef']);
    const status = (id: string) => TEMPLATE_SET.find((t) => t.id === id)?.status;
    for (const id of ['sta.cmd2.aslong.pump.andGroupGrant', 'sta.cmd5.player.cant.cast.combat', 'eff.stdlci.put.anyNumber.bf.tapped', 'rid.stdmana1.spent.cantBeCountered', 'eff.r5static.attackTax.you.lasting',
      'eff.t8.gainlife.foreach3', 'eff.cmd1.token.you.attacking.player', 'rep.cmd1.enters.additionalCounter.self', 'rep.cmd1.others.enter.additionalCounter.plural']) expect(status(id), id).toBe('stable');
    // demoted on purpose by an earlier review (p2-promote-1 record): not promoted here
    // eff.put.bf.owner: edh-misc-4 made it stable (Kenrith, Bilbo); eff.put.lib.bottom.anyorder and eff.damage.evenly.down: edh-misc-5 made them stable (6.9 narrow
    // wordings, edh-misc-5-review.json, fast3-t11-review.json, t3-review.json); none of the three is promoted here
    expect(status('sta.c3.pumpgrant.goaded')).toBe('stable'); // edh-misc-6: promoted on Ghoulish Impetus (its other sentence is automated now)
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-misc-3 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parse(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parse(e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
      }
      for (const c of t.counterExamples) {
        const f = parse(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`];
  const swaps: [RegExp, string][] = [
    [/\breturn all\b/i, 'Return target'], [/\bexcept for\b/, 'except'], [/\btheir owners' hands\b/, "their owners' graveyards"], [/\bcreatures\b/, 'lands'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}
describe('edh-misc-3 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/if able" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parse(e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parse(m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('edh-misc-3 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parse(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('edh-misc-3 render alternatives (design 6.8 G6): the new wordings pass the gate, their near misses do not', () => {
  it('the exception said after the destination: only for a group, only with "except for", only with the exact destination', () => {
    expect(fullyAutomated(parse("Return all creatures to their owners' hands except for Krakens, Leviathans, Octopuses, and Serpents."))).toBe(true);
    expect(fullyAutomated(parse("Return all creatures to their owners' hands except for Krakens, Leviathans, and Serpents."))).toBe(true);
    expect(fullyAutomated(parse("Return all creatures to their owners' hands except Krakens, Leviathans, Octopuses, and Serpents."))).toBe(false);
    expect(fullyAutomated(parse("Return all creatures to their owners' libraries except for Krakens, Leviathans, Octopuses, and Serpents."))).toBe(false);
  });
  it('"return target commander you own from the battlefield to your hand" is the target\'s zone and the owner\'s hand; another zone or another owner is not', () => {
    const act = (text: string) => parse(`{2}, {T}: ${text}`, 'Artifact');
    expect(fullyAutomated(act('Return target commander you own from the battlefield to your hand.'))).toBe(true);
    expect(fullyAutomated(act('Return target commander you control from the battlefield to your hand.'))).toBe(false); // you may control one you do not own: it goes to its owner's hand
  });
  it('"monstrosity X, where X is ..." is said for a computed amount', () => {
    expect(fullyAutomated(parse('{3}{G}{G}: Monstrosity X, where X is the number of counters among creatures you control.', 'Creature — Wizard'))).toBe(true);
    expect(fullyAutomated(parse('{3}{G}{G}: Monstrosity X, where X is the number of lands you control.', 'Creature — Wizard'))).toBe(true);
    expect(fullyAutomated(parse('{3}{G}{G}: Monstrosity X.', 'Creature — Wizard'))).toBe(false); // an X nothing defines
  });
});

const index = localIndex();

describe.skipIf(index === null)('edh-misc-3 design 6.10 (local index): synthetic examples', () => {
  it('no edh-misc-3 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card|Equipment)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
