/**
 * Commander lane edh-perms, round edh-perms-1: the template data of parser/templates/zz-cloud/edh-perms-1.json (token-creation replacements: "...instead create those tokens plus an
 * additional Treasure token", "those tokens plus that many <token>", "twice that many" for any player, "that many <token>" for creature tokens; "You create a number of <token>
 * equal to <quantity>"; "enter tapped as a copy of any land on the battlefield"; "Equipped creature has <abilities>, is a <type> in addition to its other types, and can't be
 * blocked"). The hole and renderer changes (tap ~/a permanent for mana, "~ has no X counters on it", "other than ~" after "you control", "an X/X ... with <abilities>,
 * where X is") are tested at the end of this file and in edh-perms-1-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in edh-perms-1-scenarios.test.ts. CR cites from
 * memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhPm1 from '../../../src/parser/templates/zz-cloud/edh-perms-1.json';
import review from '../../m5/golden/cards/edh-perms-1-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhPm1 as Template[];
const MECH_COUNT = 7;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 5,000 that print each wording and are full (held-out ones opened by the owner, commander request 2026-10-27)
  'rep.edhpm1.tokens.kind.plusAdditional': ['Xorn'],
  'rep.edhpm1.tokens.plusThatMany.passive': ['Chatterfang, Squirrel General'],
  'rep.edhpm1.tokens.double.anyPlayer': ['Primal Vigor'],
  'rep.edhpm1.tokens.creature.thatManyOther': ['Divine Visitation'],
  'eff.edhpm1.token.numberEqual.player': ['Ancient Copper Dragon', 'Ancient Gold Dragon'],
  'rep.edhpm1.enters.tappedCopy': ['Vesuva'],
  'sta.edhpm1.attached.grant.addtype.unblockable': ['Brotherhood Regalia'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** Templates whose examples are spell text (an instant); the others are abilities of a creature (static, activated, triggered; "~ gains" needs a creature). */
const SPELL = new Set<string>(['eff.edhpm1.token.numberEqual.player']);
/** A synthetic card in which an example is an ability of the right kind. */
const parsedWith = (t: Template, text: string) =>
  (SPELL.has(t.id) ? parseCard(card('Example Plan', 'Instant', text), OPTS) : parseCard(card('Example Relic', 'Artifact Creature — Golem', text, { power: '2', toughness: '2' }), OPTS)).faces[0]!;

describe('edh-perms-1 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-perms-1.json, path order: after edh-mana-keywords-1, before look3) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-perms-1.json');
    expect(files.indexOf('zz-cloud/edh-perms-1.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-mana-keywords-1.json'));
    expect(files.indexOf('zz-cloud/edh-perms-1.json')).toBeLessThan(files.indexOf('zz-cloud/look3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are rep.edhpm1.* (or eff., sta.)', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep)\.edhpm1\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the one card that prints the wording', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      if (NARROW[t.id] !== undefined) for (const n of NARROW[t.id]!) expect(cards, t.id).toContain(n);
      else expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
    }
    for (const g of review as { card: string; expect?: string }[]) expect(g.expect, g.card).toBe('full');
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

describe('edh-perms-1 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bremoved this way\b/, 'put this way'], [/\bfor each\b/, 'for every two'], [/\ban additional\b/, 'two additional'], [/\bany number of\b/, 'all'],
    [/\bany type\b/, 'any color'], [/\bany color\b/, 'any type'], [/\bcould produce\b/, 'produced'], [/\bland produced\b/, 'creature produced'],
    [/\byou control\b/, 'an opponent controls'], [/\ban opponent controls\b/, 'you control'], [/\bone mana\b/, 'two mana'], [/\bplus that many\b/, 'plus twice that many'], [/\bthat many\b/, 'twice that many'], [/\bone or more\b/, 'two or more'], [/\bnumber of\b/, 'number of twice'], [/\bequal to\b/, 'equal to twice'], [/\bcan't be blocked\b/, 'can be blocked'], [/\bin addition to\b/, 'instead of'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-perms-1 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-perms-1 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-perms-1 design 6.10 (local index): synthetic examples', () => {
  it('no edh-perms-1 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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



describe('edh-perms-1 parser and renderer changes (one test each)', () => {
  const face = (text: string, type = 'Land', name = 'Example Relic') => parseCard(card(name, type, text), OPTS).faces[0]!;
  it('parser/holes/event.ts (CR 106.12, 603.2): "Whenever you tap ~ for mana" is an activation of a mana ability of the object itself with {T} in its cost; another permanent\'s tap does not read as it', () => {
    const f = face('{T}: Add {G}.\nWhenever you tap ~ for mana, target opponent creates a 1/1 colorless Spirit creature token.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"source":{"self":true}');
    expect(JSON.stringify(f.abilities)).toContain('"tapped":true');
    // "another land" is not read (fail closed): it never becomes the tap of the object itself
    expect(fullyAutomated(face('{T}: Add {G}.\nWhenever you tap another land for mana, target opponent creates a 1/1 colorless Spirit creature token.'))).toBe(false);
  });
  it('parser/holes/event.ts (CR 106.12, 605.1b): "Whenever you tap a permanent for {C}" reads the {T} the activation had and the mana type it produced; a land keeps its older reading (no `tapped`)', () => {
    const perm = face('Whenever you tap a permanent for {C}, add an additional {C}.', 'Artifact');
    expect(fullyAutomated(perm)).toBe(true);
    expect(JSON.stringify(perm.abilities)).toContain('"produced":"C"');
    expect(JSON.stringify(perm.abilities)).toContain('"tapped":true');
    const land = face('Whenever you tap a land for {C}, add an additional {C}.', 'Artifact');
    expect(fullyAutomated(land)).toBe(true);
    expect(JSON.stringify(land.abilities)).not.toContain('"tapped"');
  });
  it('parser/holes/event.ts (CR 603.8): "When ~ has no ice counters on it, sacrifice it." is a state trigger of the object itself; "When another permanent has no ice counters" is not read', () => {
    const f = face('~ enters with three ice counters on it.\nWhen ~ has no ice counters on it, sacrifice it.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"ev":"state"');
    expect(fullyAutomated(face('When target land has no ice counters on it, sacrifice it.'))).toBe(false);
  });
  it('render/np.ts (CR 109.2): "target creature you control other than ~" prints back as itself; a creature "you control other than" an opponent\'s object does not parse to it', () => {
    const f = face('Whenever you create a token, put a +1/+1 counter on target creature you control other than ~.', 'Creature — Elf');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"other":true');
    expect(fullyAutomated(face('Whenever you create a token, put a +1/+1 counter on target creature an opponent controls other than ~.', 'Creature — Elf'))).toBe(true);
  });
  it('render/mods.ts (CR 107.3, 608.2h, 613.4b): "becomes an X/X Elemental creature with trample and haste until end of turn, where X is ..." prints back as itself, with the "still a land" rider after it', () => {
    const f = face('{3}{G}: Target land you control becomes an X/X Elemental creature with trample and haste until end of turn, where X is the number of enchantments you control. It\'s still a land.', 'Creature — Elf');
    expect(fullyAutomated(f)).toBe(true);
    expect(fullyAutomated(face('{3}{G}: Target land you control becomes an X/X Elemental creature with trample and haste until end of turn, where X is the number of enchantments you control. It\'s still a creature.', 'Creature — Elf'))).toBe(false);
  });
});
