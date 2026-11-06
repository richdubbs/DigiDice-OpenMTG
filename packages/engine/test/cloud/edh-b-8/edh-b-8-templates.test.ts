/**
 * Commander lane edh-b, round edh-b-8: the template data of parser/templates/zz-cloud/edh-b-8.json ("enters with a counter for each X and each Y", "if it's an enchanted creature or enchantment creature, it also gains",
 * "those creatures don't untap ... for as long as you control ~", "move any number of counters onto a target", "cast ... from your graveyard with mana value N or less", "from that player's graveyard",
 * "can't transform" of a group, "prevent damage from a spell to you or another permanent you control", the once-per-batch prevent-and-remove-a-counter) and the round's parser and renderer changes.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss
 * mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local
 * index when it is present (one named exception below). The behavior is in edh-b-8-scenarios.test.ts. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhB8 from '../../../src/parser/templates/zz-cloud/edh-b-8.json';
import reviewB8 from '../../m5/golden/cards/edh-b-8-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhB8 as Template[];
/** The round's golden entries. */
const review = reviewB8 as { card: string; verified: string; expect?: string }[];
const MECH_COUNT = 8;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on one card (of the EDHREC top
 * 5,000) only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (standing rule 2026-10-27, recommendation: accept).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'sta.edhb8.enters.counter.forEach.and': ['Unbreathing Horde'],
  'eff.edhb8.if.itIs.enchantedOrEnchantmentCreature.also.grant': ["Karametra's Blessing"],
  'eff.edhb8.untapstep.whileControlled.they': ['Shipbreaker Kraken'],
  'eff.edhb8.counters.move.anyNumber.target': ['Scrounging Bandar'],
  'eff.edhb8.cast.fromGraveyard.mvOrLess.free': ['Diviner of Mist'],
  'eff.edhb8.cast.fromThatPlayerGraveyard.free': ['Sorcerous Squall'],
  'sta.edhb8.group.cantTransform': ['Immerwolf'],
  'sta.edhb8.damageToSelf.prevent.removeCounter.once': ['Unbreathing Horde'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or replacement on a creature, a triggered or activated line on an artifact or a creature, else a sorcery. */
const parsedWith = (t: Template, text: string) =>
  /^(sta|rep)\./.test(t.id) ? parseCard(card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>), OPTS).faces[0]!
  : parseCard(/^\{/.test(text) ? card('Example Plan', 'Artifact', text) : /^(When|At the|Whenever)/.test(text) ? card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-b-8 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-b-8.json, path order: after cmd2, before edh-cast-1) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-b-8.json');
    expect(files.indexOf('zz-cloud/edh-b-8.json')).toBeLessThan(files.indexOf('zz-cloud/edh-cast-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhb8.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rid|cm)\.edhb8\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(9);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the cards that print the wording', () => {
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

describe('edh-b-8 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/half/, 'a third of'], [/rounded up/, 'rounded down'], [/round up/, 'round down'], [/your/, 'their'], [/first/, 'second'], [/an opponent/, 'you'], [/less/, 'more'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-b-8 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-b-8 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-b-8 design 6.10 (local index): synthetic examples', () => {
  it('no edh-b-8 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    // design 6.9 deviation: Unbreathing Horde's one-sentence replacement is the only printing of its wording ("If ~ would be dealt damage, prevent that damage and remove a +1/+1 counter from it."),
    // so that example line IS Oracle's line (the other lines of the examples are invented); recorded in the round's record
    const SAME_SENTENCE = new Set(['If ~ would be dealt damage, prevent that damage and remove a +1/+1 counter from it.']);
    const verbatim = MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()) && !(t.id === 'sta.edhb8.damageToSelf.prevent.removeCounter.once' && SAME_SENTENCE.has(l.trim())))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});

const sorcery = (text: string) => parseCard(card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;
const creature = (text: string) => parseCard(card('Example Plan', 'Creature — Drake', text, { power: '3', toughness: '3' } as Partial<OracleCard>), OPTS).faces[0]!;

describe('edh-b-8 parser and renderer changes (one test each)', () => {
  it('parser/holes/object.ts and render/np.ts (family exiled-card): "target face-up exiled card" and "target face-down exiled card" read and say so; an unknown status word does not', () => {
    for (const text of ["Put target face-up exiled card into its owner's graveyard.", "Return target face-down exiled card to its owner's hand.", "Return target face-up exiled card to its owner's hand."]) {
      expect(fullyAutomated(sorcery(text)), text).toBe(true);
    }
    const up = JSON.stringify(sorcery("Put target face-up exiled card into its owner's graveyard.").abilities);
    expect(up).toContain('"faceDown":false');
    expect(up).toContain('"zone":"exile"');
    expect(JSON.stringify(sorcery("Return target face-down exiled card to its owner's hand.").abilities)).toContain('"faceDown":true');
    for (const bad of ["Put target face-sideways exiled card into its owner's graveyard.", "Put target face-up exiled card into its owner's graveyard unless it is blue."]) expect(fullyAutomated(sorcery(bad)), bad).toBe(false);
  });
  it('render/np.ts (family same-name, "on the battlefield"): "for each land on the battlefield with the same name as the exiled card" reads after an imprint, and says nothing about a card no ability exiled', () => {
    const scythe = (body: string) => parseCard(card('Example Scythe', 'Artifact — Equipment', `When this Equipment enters, search your library for a land card, exile it, then shuffle.\n${body}\nEquip {1}`), OPTS).faces[0]!;
    expect(fullyAutomated(scythe('Equipped creature gets +1/+1 for each land on the battlefield with the same name as the exiled card.'))).toBe(true);
    expect(fullyAutomated(scythe('Equipped creature gets +1/+1 for each land you control with the same name as the exiled card.'))).toBe(true);
    const plain = parseCard(card('Example Scythe', 'Artifact — Equipment', 'Equipped creature gets +1/+1 for each land on the battlefield with the same name as the exiled card.\nEquip {1}'), OPTS).faces[0]!;
    expect(fullyAutomated(plain)).toBe(false);
  });
  it('render/stat.ts (family enters-computed-counters): the sum of two counts is said "for each X and each Y" and a lone count keeps its older wordings', () => {
    expect(fullyAutomated(creature('This creature enters with a +1/+1 counter on it for each other Goblin you control and each Goblin card in your graveyard.'))).toBe(true);
    expect(fullyAutomated(creature('This creature enters with a +1/+1 counter on it for each other Goblin you control.'))).toBe(true);
    expect(fullyAutomated(creature('This creature enters with a +1/+1 counter on it for each other Goblin you control and each Elf card in your hand and each Goblin card in your graveyard.'))).toBe(false);
  });
  it('render/cond.ts and render/fold.ts: "an enchanted creature or enchantment creature" is said with its article, and a free cast with a mana value limit keeps "from your graveyard" before the limit', () => {
    const out = JSON.stringify(parseCard(card('Example Boon', 'Instant', "Target creature gets +1/+1 until end of turn. If it's an enchanted creature or enchantment creature, it also gains trample until end of turn."), OPTS).faces[0]!.abilities);
    expect(out).toContain('"enchanted":true');
    expect(fullyAutomated(creature('Whenever this creature attacks, you may cast an instant or sorcery spell from your graveyard with mana value 3 or less without paying its mana cost.'))).toBe(true);
    expect(fullyAutomated(creature('Whenever this creature attacks, you may cast an instant or sorcery spell from your graveyard with mana value 3 or more without paying its mana cost.'))).toBe(false);
  });
});
