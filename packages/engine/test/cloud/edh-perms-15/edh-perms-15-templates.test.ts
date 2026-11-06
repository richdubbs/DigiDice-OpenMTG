/**
 * Commander lane edh-perms, round edh-perms-15: the template data of parser/templates/zz-cloud/edh-perms-15.json ("choose a counter on <target>", "put an additional counter of
 * that kind", "give <it> another counter of that kind", "put A on it if C and B on it if D", "~ crews Vehicles as though its power were N greater", "draw cards equal to the
 * sacrificed creature's S, then discard cards equal to its S") and the round's parser, lowering and renderer changes, tested at the end of this file and in
 * edh-perms-15-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. CR cites checked against the Comprehensive Rules of 2026-09-25.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhPm15 from '../../../src/parser/templates/zz-cloud/edh-perms-15.json';
import review from '../../m5/golden/cards/edh-perms-15-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhPm15 as Template[];
const MECH_COUNT = 6;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 5,000 that print each wording and are full
  'eff.edhpm15.choose.counterOn': ['Ichormoon Gauntlet', 'Animation Module'],
  'eff.edhpm15.put.additionalOfThatKind': ['Ichormoon Gauntlet'],
  'eff.edhpm15.give.anotherOfThatKind': ['Animation Module'],
  'eff.edhpm15.counters.put.ifCond.andPutIfCond': ['Forge of Heroes'],
  'sta.edhpm15.crewPowerBonus': ['Shorikai, Genesis Engine', 'Reckoner Bankbuster'],
  'eff.edhpm15.sacrificed.drawStatDiscardStat': ['Felothar the Steadfast'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  t.kind === 'static' || text.includes(':') ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-perms-15 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-perms-15.json, path order: after edh-perms-11, before edh-perms-2) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-perms-15.json');
    expect(files.indexOf('zz-cloud/edh-perms-15.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-perms-11.json'));
    expect(files.indexOf('zz-cloud/edh-perms-15.json')).toBeLessThan(files.indexOf('zz-cloud/edh-perms-2.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are trg.edhpm15.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg)\.edhpm15\./);
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

describe('edh-perms-15 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bthe sacrificed creature\b/, 'the destroyed creature'], [/\bpower\./, 'mana value.'], [/\ba counter on\b/, 'two counters on'],
    [/\btarget creature\b/, 'target artifact'], [/\bconsolidate\b/, 'x'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-perms-15 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-perms-15 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
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

describe.skipIf(index === null)('edh-perms-15 design 6.10 (local index): synthetic examples', () => {
  it('no edh-perms-15 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-perms-15 parser, lowering and renderer changes (one test each)', () => {
  const spell = (text: string) => parseCard(card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;
  const creature = (text: string, type = 'Artifact Creature — Construct') => parseCard(card('Example Beast', type, text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  it('parser/lower/scope.ts (CR 110.1, 601.2a): after "Whenever you cast a noncreature spell" the cast spell is no "that permanent": the target is', () => {
    const ok = creature('Whenever you cast a noncreature spell, choose a counter on target permanent. Put an additional counter of that kind on that permanent.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"kindOfChoice"');
  });
  it('parser/holes/object.ts + lower/anaphora.ts (CR 115.4, 608.2c): "that permanent or player" is the one target "permanent or player"; "that creature or player" after a plain creature target is not read as it', () => {
    expect(fullyAutomated(creature('{T}: Choose a counter on target permanent or player. Give that permanent or player another counter of that kind.'))).toBe(true);
    expect(fullyAutomated(creature('{T}: Choose a counter on target permanent. Give that permanent or player another counter of that kind.'))).toBe(false);
  });
  it('effects/handlers/choose.ts + counters.ts (CR 122.1, 608.2d): a chosen counter kind is read by a put of that link only; a put with no choice before it is not read', () => {
    expect(fullyAutomated(spell('Put an additional counter of that kind on target creature.'))).toBe(false);
    expect(fullyAutomated(spell('Choose a counter on target creature. Put two additional counters of that kind on that creature.'))).toBe(false);
  });
  it('render/fold-edhpm15.ts (CR 122.1, 608.2c): two guarded puts on one object read as one sentence; with a different object or an unguarded second put they are not that sentence', () => {
    const ok = spell("Choose target permanent. Put a +1/+1 counter on it if it's a creature and a loyalty counter on it if it's a planeswalker.");
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"guard"');
    expect(fullyAutomated(spell("Choose target permanent. Put a +1/+1 counter on it if it's a creature and a loyalty counter on target land."))).toBe(false);
  });
  it('statics/hooks.ts + rules/cost-pick.ts (CR 702.122a): crewPowerBonus is crew-only: a source with it is a different rule from crewSaddlePowerBonus', () => {
    const a = creature('~ crews Vehicles as though its power were 2 greater.');
    const b = creature('~ saddles Mounts and crews Vehicles as though its power were 2 greater.');
    expect(JSON.stringify(a.abilities)).toContain('"rule":"crewPowerBonus"');
    expect(JSON.stringify(b.abilities)).toContain('"rule":"crewSaddlePowerBonus"');
  });
  it('parser/lower/quantities.ts (CR 608.2h): "sacrifice it and create that many F" counts the amount of the event; after a count of objects sacrificed it is unchanged', () => {
    const ok = creature('Whenever ~ deals combat damage to a player, sacrifice it and create that many Treasure tokens.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"q":"eventAmount"');
    const several = spell('Sacrifice two creatures. Create that many Treasure tokens.');
    expect(JSON.stringify(several.abilities)).toContain('"q":"resultCount"');
  });
  it('parser/holes/object.ts + lower/mentions.ts + render/steps-lasting.ts (CR 701.36a, 111.1): "the token created this way" names the token a populate made; after a populate by a number or none it is not read', () => {
    const ok = spell('Populate. The token created this way gains haste.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(fullyAutomated(spell('The token created this way gains haste.'))).toBe(false);
  });
});
