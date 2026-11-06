/**
 * Commander lane edh-misc, round edh-misc-1: the template data of parser/templates/zz-cloud/edh-misc-1.json ("if a creature dying causes a triggered ability of a
 * permanent you control to trigger, that ability triggers an additional time", a TriggerModDef whose cause looks back, CR 603.10a), and the promotions of this round.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses
 * to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are
 * synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in edh-misc-1-scenarios.test.ts. CR cites from memory,
 * unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import round from '../../../src/parser/templates/zz-cloud/edh-misc-1.json';
import review from '../../m5/golden/cards/edh-misc-1-review.json';
import copyReview from '../../m5/golden/cards/p2-copy-perm-1-review.json';
import t8Review from '../../m5/golden/cards/fast2-t8-review.json';
import c3Review from '../../m5/golden/cards/cloud-c3-review.json';
import rx26Review from '../../m5/golden/cards/cloud-std-rx26-review.json';
import cmd2Review from '../../m5/golden/cards/cloud-cmd2-review.json';
import rx3Review from '../../m5/golden/cards/cloud-std-rx3-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = round as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
const parse = (text: string) => parseCard(card('Example Advisor', 'Creature — Advisor', text, { power: '1', toughness: '1' }), OPTS).faces[0]!;
type Golden = { card: string; verified: string; expect?: string }[];
const golden = review as Golden;

describe('edh-misc-1 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-misc-1.json, after edh-mana-keywords-1, before edh-perms-1) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-misc-1.json');
    expect(files.indexOf('zz-cloud/edh-misc-1.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-mana-keywords-1.json'));
    expect(files.indexOf('zz-cloud/edh-misc-1.json')).toBeLessThan(files.indexOf('zz-cloud/edh-perms-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are sta.edhm1.*', () => {
    expect(MECH.map((t) => t.id)).toEqual(['sta.edhm1.triggerMod.dying']);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^sta\.edhm1\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9 deviation (guide section 5, "Narrow wordings"): sta.edhm1.triggerMod.dying is stable on the two cards of the EDHREC top 5,000 that print it, both golden (Teysa Karlov, Drivnod, Carnage Dominus)', () => {
    const t = MECH[0]!;
    expect(t.status).toBe('stable');
    expect(golden.filter((g) => g.verified.includes(`(${t.id})`)).map((g) => g.card).sort()).toEqual(['Drivnod, Carnage Dominus', 'Teysa Karlov']);
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('the promotions of this round have their golden cards (the template\'s own round files): copyToken.except five, becomeCopy.except two, and the one- and two-card narrow wordings', () => {
    const using = (file: Golden, id: string): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card).sort();
    expect(using(copyReview as Golden, 'eff.p2copyperm1.copyToken.except')).toEqual(["Endless Evil", 'Helm of the Host', "Irenicus's Vile Duplication", 'Miirym, Sentinel Wyrm', 'Ratadrabik of Urborg']);
    expect(using(copyReview as Golden, 'eff.p2copyperm1.becomeCopy.except')).toEqual(['Irma, Part-Time Mutant', 'Saheeli, Sublime Artificer']);
    expect(using(t8Review as Golden, 'eff.t8.gainlife.foreach4')).toEqual(['Shamanic Revelation']);
    expect(using(c3Review as Golden, 'sta.c3.grant.aslong')).toEqual(['Puresteel Paladin']);
    expect(using(rx26Review as Golden, 'eff.stdrx26.nextSpell.has.improvise')).toEqual(['Archway of Innovation']);
    expect(using(cmd2Review as Golden, 'sta.cmd2.aslong.pump.andAnthemGrant')).toEqual(['Thunderfoot Baloth']);
    expect(using(cmd2Review as Golden, 'eff.cmd2.next.cast.copy.forEachCommanderCast')).toEqual(['Thunderclap Drake']);
    expect(using(rx3Review as Golden, 'eff.stdrx3.permit.free.play.group.durFirst')).toEqual(['Fallen Shinobi']);
    expect(using(rx3Review as Golden, 'eff.stdrx3.permit.free.play.obj.durFirst')).toEqual(["Mind's Desire"]);
    expect(using(golden, 'eff.put.bf.owner')).toEqual(['Bilbo, Unexpected Adventurer', 'Kenrith, the Returned King']); // promoted in edh-misc-4 (owner's standing rule 2026-10-27)
    const status = (id: string) => TEMPLATE_SET.find((t) => t.id === id)?.status;
    for (const id of ['eff.p2copyperm1.copyToken.except', 'eff.p2copyperm1.becomeCopy.except', 'eff.t8.gainlife.foreach4', 'sta.c3.grant.aslong', 'eff.stdrx26.nextSpell.has.improvise',
      'sta.cmd2.aslong.pump.andAnthemGrant', 'eff.cmd2.next.cast.copy.forEachCommanderCast', 'eff.stdrx3.permit.free.play.group.durFirst', 'eff.stdrx3.permit.free.play.obj.durFirst', 'eff.put.bf.owner']) expect(status(id), id).toBe('stable');
    expect(status('eff.p2copyperm1.eachOther.becomeCopy.dur.except')).toBe('stable'); // not promoted by this round; edh-misc-5 made it stable on Nanogene Conversion (EDHREC rank 4557, 6.9 narrow wording)
    expect(status('eff.stdrx26.nextSpell.has.convoke')).toBe('stable'); // edh-next-39 promoted it on Wand of the Worldsoul (6.9 narrow wording, owner's standing rule 2026-10-27)
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

describe('edh-misc-1 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bdying\b/, 'entering'], [/\bdying\b/, 'attacking'], [/\bpermanent you control\b/, 'permanent an opponent controls'], [/\ban additional time\b/, 'two additional times'],
    [/\bthat ability\b/, 'it'], [/\bif an?\b/, 'whenever a'], [/\btriggered ability\b/, 'activated ability'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}
describe('edh-misc-1 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-misc-1 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe('edh-misc-1 weak readings (design 6.3 rule 2): the entering and attacking forms keep their own templates', () => {
  it('"If a creature entering causes ..." is still the M6 template\'s, and "attacking" the std-rx2 one', () => {
    expect(parse('If a creature entering causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.').templatesUsed).toContain('sta.m6.triggerMod.entering');
    expect(parse('If a Warrior attacking causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.').templatesUsed).toContain('sta.stdrx2.triggerMod.attacking');
  });
  it('the "of this creature or an emblem you own" form keeps std-typechange-2\'s template', () => {
    const f = parse('Equipped creature has "If a Goblin dying causes a triggered ability of this creature or an emblem you own to trigger, that ability triggers an additional time."');
    expect(f.templatesUsed).toContain('sta.stdtc2.triggerMod.dying.selfOrEmblem');
    expect(f.templatesUsed).not.toContain('sta.edhm1.triggerMod.dying');
  });
});

const index = localIndex();

describe.skipIf(index === null)('edh-misc-1 design 6.10 (local index): synthetic examples', () => {
  it('no edh-misc-1 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
