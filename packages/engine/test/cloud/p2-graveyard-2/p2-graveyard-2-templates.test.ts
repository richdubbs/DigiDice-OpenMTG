/**
 * p2-graveyard-2 (Phase 2 lane p2-graveyard: graveyard hate): the template data of parser/templates/zz-cloud/p2-graveyard-2.json ("<cards> in graveyards [and
 * libraries] can't enter the battlefield", "Players can't cast spells from graveyards [or libraries]", "Players can't cast <spells> from graveyards or exile"), and the
 * round's renderer changes (a castFromZone restriction with its zones and spells, "in graveyards and libraries").
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in p2-graveyard-2-scenarios.test.ts. CR cites from
 * memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import gy2 from '../../../src/parser/templates/zz-cloud/p2-graveyard-2.json';
import ownReview from '../../m5/golden/cards/p2-graveyard-2-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = gy2 as Template[];
const MECH_COUNT = 6;
const review = ownReview as { card: string; verified: string; expect?: string }[];
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because the tuning half prints the
 * wording on one or two cards only, with their template tests (G9, G2) and played scenarios. Listed in the round's record (DECIDED BY DEFAULT, owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, string>> = {
  'rst.p2gy2.cards.inGraveyards.cantEnter': 'Soulless Jailer',
  'rst.p2gy2.cards.inGraveyardsAndLibraries.cantEnter': "Grafdigger's Cage",
  'rst.p2gy2.players.cantCast.fromGraveyards': 'Kunoros, Hound of Athreos',
  'rst.p2gy2.players.cantCast.fromGraveyardsOrLibraries': "Grafdigger's Cage",
  'rst.p2gy2.players.cantCast.kind.fromGraveyardsOrExile': 'Soulless Jailer',
  'sta.p2gy2.once.cast.graveyard.exileInstead': 'Kess, Dissident Mage',
};
/**
 * design 6.10 (DECIDED BY DEFAULT, owner instruction 2026-10-21): the two plain cast bans are one fixed Oracle sentence with no hole each, so no synthetic wording of them
 * exists; the check below skips only that sentence (a bare keyword line is a real line too).
 */
const FIXED_WORDING: Readonly<Record<string, string>> = {
  'rst.p2gy2.players.cantCast.fromGraveyards': "Players can't cast spells from graveyards.",
  'rst.p2gy2.players.cantCast.fromGraveyardsOrLibraries': "Players can't cast spells from graveyards or libraries.",
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic artifact whose static ability the example is. */
const parsedWith = (_t: Template, text: string) => parseCard(card('Example Lock', 'Artifact', text), OPTS).faces[0]!;

describe('p2-graveyard-2 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/p2-graveyard-2.json, after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/p2-graveyard-2.json');
    expect(files.indexOf('zz-cloud/p2-graveyard-2.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/p2-graveyard-2.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are (rst|sta).p2gy2.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(rst|sta)\.p2gy2\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) a card that prints the wording', () => {
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = review.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      if (NARROW[t.id] !== undefined) expect(cards, t.id).toContain(NARROW[t.id]);
      else expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
    }
    for (const g of review) expect(g.expect, g.card).toBe('full');
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

describe('p2-graveyard-2 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
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
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`, `${body} until end of turn.`];
  const swaps: [RegExp, string][] = [
    [/\bmay\b/, 'must'], [/\bremains tapped\b/, 'remains untapped'], [/\bcharge counter\b/, 'charge counters'], [/\bfirst\b/, 'second'], [/\bless\b/, 'more'],
    [/\bhexproof\b/, 'shroud'], [/\bdon't trigger\b/, 'trigger'], [/\bpower\b/, 'toughness'], [/\battack as though\b/, 'block as though'],
    [/\bactivated abilities of all\b/, 'triggered abilities of all'], [/\bany color\b/, 'any type'], [/\byou control\b/, 'an opponent controls'],
    [/\bany number of\b/, 'all'], [/\bin addition to\b/, 'instead of'], [/\blose control\b/, 'gain control'],
    [/\bface down\b/, 'face up'], [/\bturned face up\b/, 'turned face down'], [/\bloses all abilities\b/, 'loses flying'], [/\bartifact creature\b/, 'enchantment creature'],
    [/\bcreature spells you control\b/, 'creature spells you own'], [/\bcreature cards you own\b/, 'creature cards you control'], [/\baren't on the battlefield\b/, 'are on the battlefield'],
    [/\bnamed\b/, 'called'], [/\bis tapped\b/, 'is untapped'],
    [/\bblitz ability\b/, 'dash ability'], [/\bbestow ability\b/, 'flashback ability'], [/\byour graveyard using\b/, 'your hand using'], [/\bfrom a graveyard\b/, 'from your hand'],
    [/\bthis turn\b/, 'last turn'], [/\bfrom the battlefield\b/, 'from anywhere'], [/\btapped under\b/, 'untapped under'], [/\bis green\b/, 'is blue'], [/\bis black\b/, 'is white'],
    [/\byour hand all\b/, 'your library all'],
    [/\bgraveyards or libraries\b/, 'graveyards or hands'], [/\bcan't enter\b/, "can't leave"], [/\bcan't cast\b/, 'can cast'], [/\bor exile\b/, 'or libraries'],
    [/\bgraveyards and libraries\b/, 'graveyards and hands'], [/\bPlayers\b/, 'Your opponents'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('p2-graveyard-2 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/if able/until end of turn" or a swapped key word never gives the example's JSON`, () => {
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

describe('p2-graveyard-2 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (/^counters?\b/.test(words[i + 1] ?? '')) return; // a counter's kind is any word (CR 122.1): "a blorfty counter" is a counter kind, not nonsense
          const lead = w.match(/^["\n]+/)?.[0] ?? '';
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('p2-graveyard-2 design 6.10 (local index): synthetic examples', () => {
  it('no p2-graveyard-2 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    // a fixed wording with no hole (the castWith lines, as zz-fast5x/e2.json's warp line) has no synthetic form: only its keyword line and its other lines are checked
    const fixed = (t: Template, l: string): boolean => FIXED_WORDING[t.id] === l.trim();
    const verbatim = MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()) && !fixed(t, l) && !/^[A-Z][a-z]+$/.test(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});


const lock = (text: string) => parseCard(card('Example Lock', 'Artifact', text), OPTS).faces[0]!;

describe('p2-graveyard-2 renderer (render/stat.ts, render/np.ts; CR 601.3, 614.17d): the zones of a cast ban and of an entering ban', () => {
  it('"Players can\'t cast spells from libraries or exile" (zones no template reads) is not automated', () => {
    expect(fullyAutomated(lock("Players can't cast spells from libraries or exile."))).toBe(false);
  });
  it('"Creature cards in libraries and graveyards can\'t enter the battlefield" (another order) is not automated', () => {
    expect(fullyAutomated(lock("Creature cards in libraries and graveyards can't enter the battlefield."))).toBe(false);
  });
  it('the cast bans name the zones they build: graveyard and library; graveyard and exile', () => {
    expect(JSON.stringify(lock("Players can't cast spells from graveyards or libraries.").abilities)).toContain('"fromZones":["graveyard","library"]');
    expect(JSON.stringify(lock("Players can't cast artifact spells from graveyards or exile.").abilities)).toContain('"fromZones":["graveyard","exile"]');
  });
});
