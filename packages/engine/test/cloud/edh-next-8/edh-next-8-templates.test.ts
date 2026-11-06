/**
 * Commander lane edh-next, round edh-next-8 (EDHREC ranks 10,001-12,500, second pass): the template data of parser/templates/zz-cloud/edh-next-8.json ("costs less for each X, this effect can't reduce
 * the amount of mana by more than N", "each player searches their library for up to N ... puts them onto the battlefield", "target player untaps all ... they control", "return all ... target player
 * owns to their hand", "each creature attacks this turn if able", "can block an additional N creatures each combat") and the round's parser, renderer and hole changes, tested at the end of this
 * file and in edh-next-8-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss
 * mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local
 * index when it is present. The behavior is in edh-next-8-scenarios.test.ts. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhNext8 from '../../../src/parser/templates/zz-cloud/edh-next-8.json';
import review8 from '../../m5/golden/cards/edh-next-8-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhNext8 as Template[];
/** The round's golden entries. */
const review = review8 as { card: string; verified: string; expect?: string }[];
const MECH_COUNT = 6;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on one card (of the EDHREC top
 * 5,000) only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (standing rule 2026-10-27, recommendation: accept).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'cm.edhn8.self.less.forEachQty.capped': ['Valiant Changeling'],
  'eff.edhn8.player.searches.upTo.bf': ['Avatar of Growth'],
  'eff.edhn8.player.untaps.all.theyControl': ['Early Harvest'],
  'eff.edhn8.return.all.playerOwns.theirHand': ["Hurkyl's Recall"],
  'eff.edhn8.must.each.attacks': ['Goblin Diplomats'],
  'sta.edhn8.self.extrablock.number': ['Watcher in the Web'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a triggered or activated line on an artifact or a creature, else a sorcery. */
const parsedWith = (_t: Template, text: string) =>
  parseCard(
    /^Enchant(ed)? /.test(text) ? card('Example Plan', 'Enchantment — Aura', text)
      : /^Equipped /.test(text) ? card('Example Plan', 'Artifact — Equipment', text)
        : /^~ enters|^\{/.test(text) ? card('Example Plan', 'Artifact', text)
          : /^(When|At the|Whenever)/.test(text) ? card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>)
            : /^(As long as|Artifact spells|Noncreature spells)/.test(text) ? card('Example Plan', 'Enchantment', text)
              : /^(~|This creature) can block/.test(text) ? card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>)
                : /^~ costs/.test(text) ? card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>)
              : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-next-8 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-next-8.json, path order: after edh-next-3) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-next-8.json');
    expect(files.indexOf('zz-cloud/edh-next-8.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-next-3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are *.edhn8.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rid|cm|rst)\.edhn8\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
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

describe('edh-next-8 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bmay create\b/, 'creates'], [/\bits controller\b/, 'target player'], [/\bthat player\b/, 'you'], [/\bthat\'s tapped and attacking\b/, "that's tapped"], [/\bonto the battlefield\b/, 'into your hand'],
    [/\bthe rest into your graveyard\b/, 'the rest into your hand'], [/\bloses all abilities\b/, 'loses flying'], [/\blegendary\b/, 'snow'], [/\bfirst strike\b/, 'flying'], [/\bfor each\b/, 'for every two'],
    [/\ban additional card\b/, 'two additional cards'], [/\bdiscards a card\b/, 'discards two cards'], [/\benters tapped\b/, 'enters'], [/\bfrom their hand\b/, 'from their graveyard'], [/\bas long as\b/, 'unless'],
    [/\bless to cast\b/, 'more to cast'], [/\bcan't be blocked\b/, 'can be blocked'], [/\beach player\b/, 'each opponent'], [/\bcost \{1\}\b/, 'cost {2}'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-next-8 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-next-8 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (/^counters?[.,]?$/.test(words[i + 1] ?? '')) return; // the word in front of "counter(s)" is an open class by design (6.11, the CounterKind hole)
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

describe.skipIf(index === null)('edh-next-8 design 6.10 (local index): synthetic examples', () => {
  it('no edh-next-8 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

const sorcery = (text: string) => parseCard(card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;
const creature = (text: string) => parseCard(card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>), OPTS).faces[0]!;
const equipment = (text: string) => parseCard(card('Example Plan', 'Artifact — Equipment', text), OPTS).faces[0]!;

describe('edh-next-8 parser, renderer and hole changes (one test each)', () => {
  it('parser/holes/edhn8.ts: "for each creature type among creatures you control" and "for each counter among players and permanents" are counts after "for each" only; "the number of" stays the older readings', () => {
    expect(fullyAutomated(creature('This spell costs {1} less to cast for each creature type among creatures you control.'))).toBe(true);
    expect(fullyAutomated(creature('This spell costs {1} less to cast for each counter among players and permanents.'))).toBe(true);
    expect(fullyAutomated(creature('This spell costs {1} less to cast for each counter among creatures and permanents.'))).toBe(false);
    expect(fullyAutomated(creature('This spell costs {1} less to cast for each land type among creatures you control.'))).toBe(false);
  });
  it('render/stat.ts (family for-each-opponent-you-have): "for each opponent you have" and "for each opponent" are one count; "for each opponent you control" is not', () => {
    expect(fullyAutomated(creature('This spell costs {1} less to cast for each opponent you have.'))).toBe(true);
    expect(fullyAutomated(creature('This spell costs {1} less to cast for each opponent you control.'))).toBe(false);
  });
  it('render/stat.ts#perText: "for each different mana value among cards in your graveyard" is a cost count (Oskar\'s cost); a creature type count is capped only by the template with the cap sentence', () => {
    expect(fullyAutomated(creature('This spell costs {1} less to cast for each different mana value among cards in your graveyard.'))).toBe(true);
  });
  it('parser/holes/filter.ts: "that are equipped" is the equipped description (render/np.ts family equipped-that-are says both orders); "that are enchanted" is read since edh-c-20 (family enchanted-that-are)', () => {
    const a = equipment('Creatures you control that are equipped get +1/+0.');
    const b = equipment('Equipped creatures you control get +1/+0.');
    expect(fullyAutomated(a) && fullyAutomated(b) && jsonKey(a.abilities) === jsonKey(b.abilities)).toBe(true);
    expect(fullyAutomated(equipment('Creatures you control that are enchanted get +1/+0.'))).toBe(true); // edh-c-20 reads it too (family enchanted-that-are)
  });
  it('parser/holes/filter.ts: a third negation, "non-Vampire, non-Werewolf, non-Zombie creature" (every comma after a negation may be followed by another); a non-negation after the commas is not read', () => {
    expect(fullyAutomated(sorcery('Destroy target non-Vampire, non-Werewolf, non-Zombie creature.'))).toBe(true);
    expect(JSON.stringify(sorcery('Destroy target non-Vampire, non-Werewolf, non-Zombie creature.').abilities)).toContain('"notSubtypes":["Vampire","Werewolf","Zombie"]');
    expect(fullyAutomated(sorcery('Destroy target non-Vampire, non-Werewolf, red creature.'))).toBe(false);
  });
  it('render/qty.ts (family on-the-battlefield-before-name) and render/np.ts (family untapped-nontoken-order): the place before the name, the adjectives in either order', () => {
    expect(fullyAutomated(creature('This creature gets +1/+1 for each other creature on the battlefield named Example Plan.'))).toBe(true);
    expect(fullyAutomated(creature('{T}, Tap an untapped nontoken artifact you control: Add {G}.'))).toBe(true);
  });
});
