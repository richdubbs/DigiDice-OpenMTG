/**
 * Commander lane edh-next, round edh-next-44 (EDHREC ranks 16,251-17,500, second pass): the template data of parser/templates/zz-cloud/edh-next-44.json and the round's parser,
 * lowering and renderer changes, tested at the end of this file and in edh-next-44-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different
 * JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings
 * (design 6.10), checked against the local index when it is present. CR cites from memory, unverified (cloud session).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhNext44 from '../../../src/parser/templates/zz-cloud/edh-next-44.json';
import review from '../../m5/golden/cards/edh-next-44-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhNext44 as Template[];
const MECH_COUNT = 6;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 20,000 that print each wording and are full
  'sta.edhn44.obj.noAttackBlockCrew.andNoActivate.exceptMana': ['Bound in Gold'],
  'trg.edhn44.cast.ifSecondOfKind': ['Vengevine'],
  'eff.edhn44.sacrifice.half.youControl.roundedUp': ['Rakdos the Defiler'],
  'eff.edhn44.mayHave.basePowerBecomes.dur': ['Arni Brokenbrow'],
  'eff.edhn44.search.differentNames.putBattlefield': ['Deathbellow War Cry'],
  'cm.edhn44.alternative.free.flash.if': ['Qasali Ambusher'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  text.startsWith('Equip ') ? card('Example Plate', 'Artifact — Equipment', text) : t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) || (text.startsWith('~') && !text.includes('as you cast ~')) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-next-44 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-next-44.json, path order: after edh-next-40.json, before edh-next-5.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-next-44.json');
    expect(files.indexOf('zz-cloud/edh-next-44.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-next-40.json'));
    expect(files.indexOf('zz-cloud/edh-next-44.json')).toBeLessThan(files.indexOf('zz-cloud/edh-next-5.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhn44.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|ch|rid|cm|kw)\.edhn44\./);
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

describe('edh-next-44 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bElf\b/, 'Elves'], [/\bsecond\b/, 'third'], [/\bhalf\b/, 'a third'], [/\bdifferent\b/, 'same'], [/\bflash\b/, 'haste'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-next-44 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-next-44 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (/^counters?[.,]?$/.test(words[i + 1] ?? '')) return; // a counter kind is any word (CR 122.1b: a counter with a name no rule defines is allowed)
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

describe.skipIf(index === null)('edh-next-44 design 6.10 (local index): synthetic examples', () => {
  it('no edh-next-44 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const fixed = (_l: string): boolean => false;
    const verbatim = MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => !fixed(l.trim()) && lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});

describe('edh-next-44 renderer, lowering and engine changes (one test each)', () => {
  const creature = (text: string, type = 'Artifact Creature — Construct', name = 'Example Beast') => parseCard(card(name, type, text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  const spell = (text: string, type = 'Sorcery') => parseCard(card('Example Plan', type, text), OPTS).faces[0]!;
  it('parser/lower/scope.ts + render/refs.ts (CR 120.3, 608.2c; Sosuke): in a damage trigger whose recipient is a creature, "that creature" is the creature dealt damage, never the source; "it" for the source stays ambiguous', () => {
    expect(fullyAutomated(creature('Whenever a Warrior you control deals combat damage to a creature, destroy that creature at end of combat.'))).toBe(true);
    expect(fullyAutomated(creature('Whenever a creature you control deals combat damage to a creature, tap that creature.'))).toBe(true);
    // the source is named by its type here and the effect says "it": two candidates, not understood
    expect(fullyAutomated(creature('Whenever a Warrior you control deals combat damage to a creature, put a +1/+1 counter on it.'))).toBe(false);
    // a damage trigger on a player: "that creature" is the source, as before (the creature dealt damage is a player here)
    const toPlayer = creature('Whenever a Warrior you control deals combat damage to a player, destroy that creature at end of combat.');
    expect(JSON.stringify(toPlayer.abilities)).toContain('"role":"source"');
    const a = creature('Whenever a Warrior you control deals combat damage to a creature, destroy that creature at end of combat.');
    expect(JSON.stringify(a.abilities)).toContain('"role":"object"');
    // a recipient of several types (a creature or planeswalker): "that creature" stays ambiguous
    expect(fullyAutomated(creature('Whenever a creature you control deals combat damage to a creature or planeswalker, put a +1/+1 counter on that creature.'))).toBe(false);
  });
  it('render/mods.ts (CR 613.4b; Arni Brokenbrow): "become 1 plus ..." says a sum without "equal to"; a plain number or a non-sum keeps its old wording', () => {
    expect(fullyAutomated(creature('{1}: You may have ~\'s base power become 1 plus the number of creatures you control until end of turn.'))).toBe(true);
    expect(fullyAutomated(creature('{1}: You may have ~\'s base power become equal to the number of creatures you control until end of turn.'))).toBe(true);
    expect(fullyAutomated(creature('{1}: You may have ~\'s base power become the number of creatures you control until end of turn.'))).toBe(false);
  });
  it('render/evt.ts (CR 601.2i, 603.4; Vengevine): "if it\'s the second creature spell" and "your second creature spell each turn" give one cast pattern; the first is not the second', () => {
    const a = creature("Whenever you cast a spell, if it's the second creature spell you cast this turn, draw a card.");
    const b = creature('Whenever you cast your second creature spell each turn, draw a card.');
    expect(automated(a.abilities)).toBe(true);
    expect(jsonKey(a.abilities)).toBe(jsonKey(b.abilities));
    expect(jsonKey(a.abilities)).not.toBe(jsonKey(creature("Whenever you cast a spell, if it's the third creature spell you cast this turn, draw a card.").abilities));
  });
  it('render/steps-zones.ts (CR 701.21a, 107.1a; Rakdos the Defiler): your own "sacrifice half the <group> you control, rounded up"; rounded down and another player stay out', () => {
    expect(fullyAutomated(spell('Sacrifice half the creatures you control, rounded up.'))).toBe(true);
    expect(fullyAutomated(spell('Sacrifice half the creatures you control, rounded down.'))).toBe(false);
    expect(fullyAutomated(spell('Sacrifice half the creatures your opponents control, rounded up.'))).toBe(false);
  });
  it('render/stat.ts (CR 118.9, 601.3b; Qasali Ambusher): the free cast at instant speed is said only with its condition; sneak and the plain free cast keep their wordings', () => {
    expect(fullyAutomated(creature("If you control a Wizard, you may cast ~ without paying its mana cost and as though it had flash."))).toBe(true);
    expect(fullyAutomated(creature("You may cast ~ without paying its mana cost and as though it had flash."))).toBe(false);
  });
});
