/**
 * Phase 2 lane p2-replace-damage, round p2-replace-damage-1: the template data of parser/templates/zz-cloud/p2-replace-damage-1.json (damage prevention: "If a
 * <source> would deal damage to <recipient>, prevent N of that damage.", "Prevent all [combat] damage that would be dealt to <a target / a group / you> [this turn]
 * [by <sources>]", "Prevent all damage <an object / a source of your choice> would deal this turn.", "Prevent the next N combat damage ...", "... where X is ...")
 * and the round's renderer changes (render/evt.ts: "a source would deal damage to"; render/stat.ts: "prevent X of that damage, where X is", the object as the subject
 * of "would deal", "to players", the duration before the recipients, "by sources you don't control", combat damage "to and dealt by" a group; render/fold-p2rd1.ts:
 * the choice of a source that all its damage is prevented).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in p2-replace-damage-1-scenarios.test.ts. CR cites from
 * memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { ALT_SITES, EQUIVALENCE_FAMILIES } from '../../../src/render/equivalence';
import p2rd1 from '../../../src/parser/templates/zz-cloud/p2-replace-damage-1.json';
import review from '../../m5/golden/cards/p2-replace-damage-1-review.json';
import w3bReview from '../../m5/golden/cards/w3b-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = p2rd1 as Template[];
const MECH_COUNT = 28;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because the tuning half and
 * Standard print the wording on one or two cards only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner.
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'rep.p2rd1.prevent.n.toYou.opponentSource': ["Protection of the Hekma", "Guardian Seraph"],
  'rep.p2rd1.prevent.n.toObj': ["Shield of the Realm"],
  'rep.p2rd1.prevent.n.toFilter': ["Djeru, With Eyes Open", "Daunting Defender"],
  'rep.p2rd1.prevent.n.byFilter.toYou': ["Sphere of Purity"],
  'rep.p2rd1.prevent.x.toObj.whereX': ["Shield of the Avatar"],
  'eff.p2rd1.prevent.all.objWouldDeal.dur': ["Dromoka's Command", "Inquisitor's Snare"],
  'eff.p2rd1.prevent.combat.objWouldDeal.dur': ["Zealot il-Vec", "Resistance Fighter"],
  'sta.p2rd1.prevent.combat.toSelf.byFilter': ["Enchanted Being"],
  'eff.p2rd1.prevent.toYou.dur.byFilter': ["Scarecrow"],
  'eff.p2rd1.prevent.all.sourceOfChoice.dur': ["Pay No Heed"],
  'eff.p2rd1.prevent.all.sourceOfChoice.toYou.dur': ["Consulate Surveillance", "Auriok Replica"],
  'sta.p2rd1.prevent.toYou.bySourcesNotYours': ["Energy Field"],
  'eff.p2rd1.prevent.combat.creatureOfChoice.dur': ["Ajani's Aid"],
  'sta.p2rd1.prevent.combat.to.filter': ["Losheel, Clockwork Scholar"],
  'sta.p2rd1.prevent.combat.to.attached': ["General's Kabuto"],
  'sta.p2rd1.prevent.noncombat.to.attached': ["Magebane Armor"],
  'sta.p2rd1.prevent.combat.by.attached': ["Demonic Torment"],
  'eff.p2rd1.prevent.combat.toYou.dur': ["Druid's Deliverance"],
  'eff.p2rd1.prevent.combat.toPlayers.dur': ["Commencement of Festivities"],
  'eff.p2rd1.prevent.all.durFirst.to.filter': ["Sivvi's Ruse"],
  'eff.p2rd1.prevent.all.toYouAnd.dur': ["Safe Passage", "Endure"],
  'sta.p2rd1.prevent.noncombat.toYouAnd': ["The Wanderer"],
  'sta.p2rd1.prevent.combat.toAndBy.filter': ["Statecraft"],
  'eff.p2rd1.prevent.next.combat.player': ["Decorated Griffin"],
  'eff.p2rd1.prevent.next.x.obj.whereX': ["Samite Pilgrim"],
};
/** Templates kept experimental (no golden card of the tuning half or Standard prints them; design 6.9). */
const EXPERIMENTAL: readonly string[] = [];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** The type line an example needs: an Equipment or an Aura when it names the equipped or enchanted creature, a creature when it names ~ or has an activated or triggered ability, else an enchantment or an instant. */
function typeFor(t: Template, text: string): { type: string; pt?: boolean } {
  if (/\bequipped (creature|permanent)\b/.test(text)) return { type: 'Artifact — Equipment' };
  if (/\benchanted (creature|permanent)\b/.test(text)) return { type: 'Enchantment — Aura' };
  if (t.kind === 'static') return /~|^(Flying|Vigilance|Haste|Trample)$/m.test(text) ? { type: 'Creature — Spirit', pt: true } : { type: 'Enchantment' };
  return /^(When|Whenever|At)\b/.test(text) || text.includes(': ') ? { type: 'Creature — Spirit', pt: true } : { type: 'Instant' };
}
const parsedWith = (t: Template, text: string) => {
  const { type, pt } = typeFor(t, text);
  return parseCard(card('Example Warden', type, text, pt ? { power: '2', toughness: '2' } : {}), OPTS).faces[0]!;
};

describe('p2-replace-damage-1 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/p2-replace-damage-1.json, after zz-cloud/look3.json, before zz-cloud/r3-choose.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/p2-replace-damage-1.json');
    expect(files.indexOf('zz-cloud/p2-replace-damage-1.json')).toBeGreaterThan(files.indexOf('zz-cloud/look3.json'));
    expect(files.indexOf('zz-cloud/p2-replace-damage-1.json')).toBeLessThan(files.indexOf('zz-cloud/r3-choose.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are <kind>.p2rd1.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(rep|eff|sta)\.p2rd1\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.status, t.id).toBe(EXPERIMENTAL.includes(t.id) ? 'experimental' : 'stable');
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the one or two cards that print the wording', () => {
    // Demonic Torment's entry is W3b's, updated by this round (guide section 6: an earlier round's entry of the card is updated, not doubled)
    const golden = [...(review as { card: string; verified: string; expect?: string }[]), ...(w3bReview as { card: string; verified: string }[]).filter((g) => g.verified.includes('p2-replace-damage-1 review'))];
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      if (NARROW[t.id] !== undefined) for (const c of NARROW[t.id]!) expect(cards, t.id).toContain(c);
      else expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
    }
    for (const g of review as { card: string; expect?: string }[]) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during', 'choice', 'prevent']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('p2-replace-damage-1 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
      }
      for (const c of t.counterExamples) {
        const f = parsedWith(t, c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`, `${body} during combat.`];
  const swaps: [RegExp, string][] = [[/\bto you\b/, 'to each player'], [/\bthis turn\b/, 'this combat'], [/\bcombat damage\b/, 'noncombat damage'], [/\bwould deal\b/, 'would be dealt'],
    [/\byour choice\b/, "an opponent's choice"], [/\bprevent all\b/i, 'Prevent half'], [/\bprevent (\d)\b/i, 'prevent all but $1'], [/\bthe next\b/i, 'the first'], [/\byou control\b/, 'you own'],
    [/\ban opponent controls\b/, 'you control'], [/\bdealt by\b/, 'dealt to'], [/\bto players\b/, 'to opponents'], [/\bwhere X is\b/, 'where Y is']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('p2-replace-damage-1 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/if able/during combat" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parsedWith(t, e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parsedWith(t, m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('p2-replace-damage-1 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~,' || w === '~.' || /^\{/.test(w)) return;
          const end = w.match(/[.,:]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('p2-replace-damage-1 design 6.10 (local index): synthetic examples', () => {
  it('no p2-replace-damage-1 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

// ---- the renderer changes -------------------------------------------------------------------------------------------------------------------------------------

const face = (type: string, text: string) => parseCard(card('Example Monk', type, text, /Creature/.test(type) ? { power: '2', toughness: '2' } : {}), OPTS).faces[0]!;
const fullFace = (f: ReturnType<typeof face>): boolean => fullyAutomated(f) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual');

describe('p2-replace-damage-1 renderer (design 6.8 G6): the new readings are reviewed families and the alt() sites are counted', () => {
  it('every family the round adds is in the equivalence table', () => {
    const ids = EQUIVALENCE_FAMILIES.map((f) => f.id);
    for (const id of ['a-source-would-deal', 'prevent-x-where', 'prevent-object-would-deal', 'prevent-by-sources', 'prevent-to-players', 'combat-to-and-by-group', 'prevent-all-source-of-choice']) expect(ids, id).toContain(id);
    expect(ALT_SITES['fold-p2rd1.ts']).toBe(1);
  });
  it('CR 615.1a: the generic "if" sentence of a prevention says "a source" for damage of any source; a described source keeps its words', () => {
    expect(fullFace(face('Enchantment', 'If a source would deal damage to a Knight creature you control, prevent 2 of that damage.'))).toBe(true);
    expect(fullFace(face('Enchantment', 'If a red source would deal damage to you, prevent 3 of that damage.'))).toBe(true);
    // the source's description is not dropped: a red source is not "a source"
    const f = face('Enchantment', 'If a red source would deal damage to you, prevent 3 of that damage.');
    expect(JSON.stringify(f.abilities)).toContain('"colors":["R"]');
  });
  it('fail closed: "prevent X of that damage" with no "where X is" is not read; a computed amount on a shield says "the next X"', () => {
    expect(fullFace(face('Enchantment', 'If a source would deal damage to you, prevent X of that damage.'))).toBe(false);
    expect(fullFace(face('Creature — Human Cleric', '{T}: Prevent the next X damage that would be dealt to target creature this turn, where X is the number of Clerics you control.'))).toBe(true);
  });
  it('a static pair "to and dealt by" a group is one sentence; a pair of different groups is not read so', () => {
    expect(fullFace(face('Enchantment', 'Prevent all combat damage that would be dealt to and dealt by Walls you control.'))).toBe(true);
    expect(fullFace(face('Enchantment', 'Prevent all combat damage that would be dealt to Walls you control and dealt by Elves you control.'))).toBe(false);
  });
});
