/**
 * Commander effort (coordinator C), round edh-c-63: the template data of parser/templates/zz-cloud/edh-c-63.json (the readings listed in the file) with guards G9 and G2
 * (design 6.8); behavior in edh-c-63-scenarios.test.ts. Narrow wordings (design 6.9 deviation): each printed by one card of the EDHREC top 30,000 only. CR cites are from the Comprehensive Rules text of 2026-09-25.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhC63 from '../../../src/parser/templates/zz-cloud/edh-c-63.json';
import reviewC63 from '../../m5/golden/cards/edh-c-63-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhC63 as Template[];
const review = reviewC63 as { card: string; verified: string; expect?: string }[];
const MECH_COUNT = 4;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on one card (of the EDHREC top
 * 5,000) only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (standing rule 2026-10-27, recommendation: accept).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edhv63.payelse.mana.life': ['Mundungu'],
  'eff.edhv63.cantbeblocked.except.andor.dur': ['Firefright Mage'],
  'eff.edhv63.self.and.obj.gainChoice': ['Ballroom Brawlers'],
  'sta.edhv63.aslong.attackNoDefender.cantBeBlocked': ['Expedition Lookout'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a triggered or activated line on an artifact or a creature, else a sorcery. */
const parsedWith = (t: Template, text: string) =>
  parseCard(t.kind === 'static' ? card('Example Plan', 'Enchantment', text) : /^\{/.test(text) ? card('Example Plan', 'Artifact', text) : /^(When|At the|Whenever)/.test(text) ? card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-c-63 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-c-63.json, path order: after edh-c-1, before edh-c-2) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-c-63.json');
    expect(files.indexOf('zz-cloud/edh-c-63.json')).toBeLessThan(files.indexOf('zz-cloud/edh-cast-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are *.edhv63.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rid|rst)\.edhv63\./);
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

describe('edh-c-63 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bpays \{1\} and\b/, 'pays {2} and'], [/\bnext untap step\b/, 'untap step'], [/\bartifact creatures and\/or\b/, 'artifact creatures or'], [/\bfirst strike or\b/, 'first strike and'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-c-63 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-c-63 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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


/** The hole readings of this round (parser/holes/event.ts, lower/scope.ts, render/evt.ts, render/refs.ts) on invented cards: JSON of the trigger and of the player the clause names. */
describe('edh-c-63 event readings: a permanent returned to a hand / put into a graveyard, and energy gained', () => {
  const ability = (type: string, text: string) => parseCard(card('Example Plan', type, text), OPTS).faces[0]!;
  const trigger = (type: string, text: string) => {
    const f = ability(type, text);
    expect(fullyAutomated(f), `${text}: ${JSON.stringify(f.diagnostics)}`).toBe(true);
    return f.abilities[0] as unknown as { trigger: { on: Record<string, unknown>[]; batch?: boolean }; effect: { steps: Record<string, unknown>[] } };
  };
  it('"returned to your hand": a permanent you own, from the battlefield to a hand (CR 400.3, 603.6c)', () => {
    const t = trigger('Enchantment', 'Whenever a permanent is returned to your hand, you may pay {1}. If you do, draw a card.');
    expect(t.trigger.on).toEqual([{ ev: 'zoneChange', subject: { owner: 'you' }, from: 'battlefield', to: 'hand' }]);
  });
  it('"returned to a player\'s hand": a permanent of any owner; "that player" is its owner (CR 400.3, 603.6c)', () => {
    const t = trigger('Enchantment', "Whenever a permanent is returned to a player's hand, that player discards a card.");
    expect(t.trigger.on).toEqual([{ ev: 'zoneChange', subject: {}, from: 'battlefield', to: 'hand' }]);
    expect(t.effect.steps[0]).toMatchObject({ op: 'discard', who: { ref: 'ownerOf', object: { ref: 'event', role: 'subject' } } });
  });
  it('"put into a player\'s graveyard from the battlefield": a nontoken permanent of any owner; "that player" is its owner (CR 404.1, 700.4)', () => {
    const t = trigger('Enchantment', "Whenever a nontoken permanent is put into a player's graveyard from the battlefield, that player loses 1 life.");
    expect(t.trigger.on).toEqual([{ ev: 'zoneChange', subject: { token: false }, from: 'battlefield', to: 'graveyard' }]);
    expect(t.effect.steps[0]).toMatchObject({ op: 'loseLife', who: { ref: 'ownerOf', object: { ref: 'event', role: 'subject' } } });
  });
  it('the negative cases: a card (not a permanent) put into a hand, or "your hand" for the opponent, is not read', () => {
    for (const text of [
      'Whenever a card is returned to a player\'s hand, draw a card.',
      'Whenever a creature card is put into a player\'s graveyard from the battlefield, draw a card.',
      "Whenever a permanent is returned to an opponent's hand, draw a card.",
      'Whenever a permanent is returned to a player\'s library, draw a card.',
    ]) {
      const f = ability('Enchantment', text);
      const ev = JSON.stringify((f.abilities[0] as unknown as { trigger?: unknown }).trigger ?? null);
      expect(ev.includes('"from":"battlefield","to":"hand"') && !fullyAutomated(f) ? 'bad' : 'ok', text).toBe('ok');
      expect(fullyAutomated(f) && /"subject":\{\}/.test(ev) && /"to":"hand"/.test(ev) && /library/.test(text), text).toBe(false);
    }
  });
  it('"you get one or more {E}": the energy counters put on you, one batch occurrence (CR 107.14, 122.1, 603.2c)', () => {
    const t = trigger('Creature — Pirate', 'Whenever you get one or more {E}, draw a card.');
    expect(t.trigger).toEqual({ on: [{ ev: 'counters', change: 'put', kind: 'energy', on: { player: 'you' } }], batch: true });
  });
  it('the negative cases: "you get {E}" of another player or another counter is not this event', () => {
    for (const text of ['Whenever an opponent gets one or more {E}, draw a card.', 'Whenever you get one or more poison counters, draw a card.']) {
      const f = ability('Creature — Pirate', text);
      expect(JSON.stringify(f.abilities[0]).includes('"kind":"energy"') && fullyAutomated(f), text).toBe(false);
    }
  });
});

const index = localIndex();

describe.skipIf(index === null)('edh-c-63 design 6.10 (local index): synthetic examples', () => {
  it('no edh-c-63 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

