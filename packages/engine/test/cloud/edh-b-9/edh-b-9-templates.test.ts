/**
 * Commander coordinator B, round edh-b-9: the template data of parser/templates/zz-cloud/edh-b-9.json (see the file) and the round's parser, lowering,
 * engine and renderer changes, tested at the end of this file and in edh-b-9-scenarios.test.ts.
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
import edhB9 from '../../../src/parser/templates/zz-cloud/edh-b-9.json';
import review from '../../m5/golden/cards/edh-b-9-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhB9 as Template[];
const MECH_COUNT = 6;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 20,000 that print each wording and are full
  'eff.edhb9.attach.all': ['Balan, Wandering Knight'],
  'eff.edhb9.player.gets.additionalCounter': ['Necrogen Rotpriest'],
  'eff.edhb9.putCounters.eachOfUpTo': ['SOLDIER Military Program'],
  'eff.edhb9.eachPlayer.lifeTotalBecomes.countTheyControl': ['Shaman of Forgotten Ways'],
  'eff.edhb9.damage.eachOpponentAndTheirs.whereX': ['Cavalier of Flame'],
  'eff.edhb9.mana.additional.forEach': ['Elvish Guidance'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  /enchanted land/.test(text) ? card('Example Blessing', 'Enchantment — Aura', `Enchant land\n${text}`)
    : t.kind === 'static' ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' })
    : /^(Look|Reveal|Mill)/.test(text) ? card('Example Plan', 'Sorcery', text)
    : text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-b-9 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-b-9.json, path order: after edh-b-7, before edh-c-1) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-b-9.json');
    expect(files.indexOf('zz-cloud/edh-b-9.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-b-7.json'));
    expect(files.indexOf('zz-cloud/edh-b-9.json')).toBeLessThan(files.indexOf('zz-cloud/edh-c-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhb9.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|ch|rid)\.edhb9\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(9);
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

describe('edh-b-9 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bGoblin\b/, 'Goblins'], [/\bhaste\b/, 'x'], [/\bflying\b/, 'x'], [/\bloses\b/, 'gains'], [/\bcounter\b/, 'x'], [/\bthree\b/, 'x'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-b-9 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-b-9 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w) || /^counters?\b/.test(words[i + 1] ?? '')) return; // a counter kind is an open class (design 6.11)
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

describe.skipIf(index === null)('edh-b-9 design 6.10 (local index): synthetic examples', () => {
  it('no edh-b-9 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    // a pattern with no slot ("~ is all colors. This ability doesn't affect its color identity.") is one fixed sentence: its examples can only be that sentence, so they are exempt (as cloud c2)
    const withSlots = MECH.filter((t) => /\{[a-z0-9]+:/.test(t.pattern) || !t.pattern.startsWith('~ is all colors'));
    const verbatim = withSlots.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});

describe('edh-b-9 parser, lowering and renderer changes (one test each)', () => {
  const spell = (text: string, type = 'Instant') => parseCard(card('Example Plan', type, text), OPTS).faces[0]!;
  const creature = (text: string, type = 'Creature — Wizard') => parseCard(card('Example Beast', type, text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  const equipment = (text: string) => parseCard(card('Example Blade', 'Artifact — Equipment', text), OPTS).faces[0]!;
  it('parser/lower/anaphora.ts#attachHostWindow (CR 701.3a, 201.5): "it" of "attach target Equipment to it" is the object itself in a disjunction of its own events; "attach it to target creature" stays manual', () => {
    expect(fullyAutomated(creature('Whenever ~ enters or attacks, you may attach any number of target Equipment to it.'))).toBe(true);
    expect(fullyAutomated(creature('Whenever ~ enters or attacks, attach it to target creature you control.'))).toBe(false);
    // the trigger names another object the pronoun could mean: stays manual
    expect(fullyAutomated(creature('Whenever ~ enters or becomes blocked by a creature, you may attach target Aura you control to it.'))).toBe(false);
  });
  it('parser/lower/anaphora.ts#attachesSelf (CR 701.3a, 608.2c): "create a Food token, then create a 1/1 Halfling token and attach this Equipment to it" attaches to the second token; "attach it to it" stays manual', () => {
    const f = equipment('When this Equipment enters, create a Food token, then create a 1/1 white Halfling creature token and attach this Equipment to it.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"op":"attach","what":{"ref":"self"},"to":{"ref":"bound","name":"token"}');
    expect(fullyAutomated(equipment('When this Equipment enters, create a Food token, then create a 1/1 white Halfling creature token and attach it to it.'))).toBe(false);
  });
  it('parser/holes/qty.ts + render/qty.ts (CR 119.1, 608.2c): "the difference between those players\' life totals" needs two target players named before; with none it stays manual', () => {
    expect(fullyAutomated(spell("Two target players exchange life totals. You create an X/X colorless Horror artifact creature token, where X is the difference between those players' life totals.", 'Sorcery'))).toBe(true);
    expect(fullyAutomated(spell("You create an X/X colorless Horror artifact creature token, where X is the difference between those players' life totals.", 'Sorcery'))).toBe(false);
  });
  it('render/steps-life.ts (CR 120.2b, 107.3): "X damage to each opponent and each planeswalker they control, where X is ..." next to "damage equal to ..." and the plain number; another recipient stays manual', () => {
    expect(fullyAutomated(creature('When ~ dies, it deals X damage to each opponent and each planeswalker they control, where X is the number of land cards in your graveyard.'))).toBe(true);
    expect(fullyAutomated(creature('When ~ dies, it deals 3 damage to each opponent and each planeswalker they control.'))).toBe(true);
    expect(fullyAutomated(creature('When ~ dies, it deals X damage to each player and each planeswalker they control, where X is the number of land cards in your graveyard.'))).toBe(false);
  });
  it('render/steps-life.ts (CR 122.1, 702.164c): "that player gets an additional poison counter" is the one counter; two additional counters stay manual', () => {
    expect(fullyAutomated(creature('Whenever a creature you control deals combat damage to a player, that player gets an additional poison counter.'))).toBe(true);
    expect(fullyAutomated(creature('Whenever a creature you control deals combat damage to a player, that player gets two additional poison counters.'))).toBe(false);
  });
  it('render/fold-edhb9.ts (CR 608.2d): "put a +1/+1 counter on each of up to two Soldiers you control" chooses up to two as the ability resolves; a count of one, or "target", is another sentence', () => {
    expect(fullyAutomated(creature('At the beginning of combat on your turn, put a +1/+1 counter on each of up to two Soldiers you control.'))).toBe(true);
    expect(fullyAutomated(creature('At the beginning of combat on your turn, put a +1/+1 counter on each of up to one Soldiers you control.'))).toBe(false);
  });
  it('render/steps-flow.ts (CR 119.5, 608.2f): "each player\'s life total becomes the number of creatures they control" (priority 1 over the generic life-total reading); "each opponent\'s" stays manual', () => {
    expect(fullyAutomated(creature("When ~ enters, each player's life total becomes the number of creatures they control."))).toBe(true);
    expect(fullyAutomated(creature("When ~ enters, each opponent's life total becomes the number of creatures they control."))).toBe(false);
  });
  it('render/text.ts + parser/holes/vocab.ts (CR 205.3m): "Spawns" is the plural of the creature type Spawn, as "Scions" of Scion', () => {
    expect(fullyAutomated(creature('{W}: Scions and Spawns you control gain indestructible until end of turn.'))).toBe(true);
    expect(fullyAutomated(creature('{W}: Scions and Spawnses you control gain indestructible until end of turn.'))).toBe(false);
  });
  it('render/steps-zones.ts (CR 111.4, 608.2c): "create a number of ... tokens equal to ... They have \"...\"" gives the counted tokens the ability; without the sentence the tokens have none', () => {
    const t = 'At the beginning of your end step, create a number of 1/1 black and green Pest creature tokens equal to the number of +1/+1 counters on this creature.';
    expect(fullyAutomated(creature(`${t} They have "When this token dies, you gain 1 life."`))).toBe(true);
    expect(fullyAutomated(creature(`${t} They have "When this token dies, you gain 1 life or draw a card."`))).toBe(false);
  });
});
