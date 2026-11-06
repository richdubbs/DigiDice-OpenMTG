/**
 * Commander EDHREC ranks 29,501-30,000, second pass, round edh-c-56: the template data of parser/templates/zz-cloud/edh-c-56.json (an Aura that loses a keyword, a player exiles all cards of a type from their graveyard, loses life then reveals a card at random, "you lose N life if C", "Unless target player pays C, that player loses N life and you gain N life", bounce enchanted creature and the Aura, exactly N tide counters, loses protection from black, destroy if another permanent has the same name) and the round's parser, engine and renderer changes, tested at the end of this file and in edh-c-56-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss
 * mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local
 * index when it is present. The behavior is in edh-c-56-scenarios.test.ts. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhC56 from '../../../src/parser/templates/zz-cloud/edh-c-56.json';
import review56 from '../../m5/golden/cards/edh-c-56-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhC56 as Template[];
/** The round's golden entries. */
const review = review56 as { card: string; verified: string; expect?: string }[];
const MECH_COUNT = 9;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on one card (of the EDHREC top
 * 5,000) only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (standing rule 2026-10-27, recommendation: accept).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'sta.edhv56.attached.loses': ['Grounded'],
  'eff.edhv56.loseLife.if': ['Scourge of Numai'],
  'eff.edhv56.player.exiles.allTypeFromGraveyard': ['Mudhole'],
  'eff.edhv56.player.loses.thenRevealsAtRandom': ['Hired Torturer'],
  'eff.edhv56.unless.player.pays.thatLosesYouGain': ['Rhystic Syphon'],
  'eff.edhv56.attached.andSelf.bounce': ['Disappear'],
  'sta.edhv56.aslong.exactlyTide.pt': ['Homarid'],
  'eff.edhv56.obj.loses.protectionFromBlack.dur': ['Cephalid Snitch'],
  'eff.edhv56.destroy.ifAnotherSameName': ['Winnow'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: an Aura for "Enchanted creature ...", else a creature (a static line, with the Oracle's own "~" for the object itself). */
const parsedWith = (t: Template, text: string) =>
  parseCard(
    /^Enchanted creature/.test(text) || /enchanted creature and ~/.test(text) ? card('Example Plan', 'Enchantment — Aura', `Enchant creature
${text}`)
    : /^Equipped creature/.test(text) ? card('Example Plan', 'Artifact — Equipment', `${text}
Equip {1}`)
    : /^(Unless|Target|Destroy)/.test(text) ? card('Example Plan', 'Instant', text)
    : card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>),
    OPTS,
  ).faces[0]!;

describe('edh-c-56 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-c-56.json, path order: after edh-c-5, before edh-c-6) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-c-56.json');
    expect(files.indexOf('zz-cloud/edh-c-56.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-c-5.json'));
    expect(files.indexOf('zz-cloud/edh-c-56.json')).toBeLessThan(files.indexOf('zz-cloud/edh-c-6.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhv56.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rid|cm)\.edhv56\./);
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

describe('edh-c-56 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('edh-c-56 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-c-56 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-c-56 design 6.10 (local index): synthetic examples', () => {
  it('no edh-c-56 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

const creature = (text: string) => parseCard(card('Example Plan', 'Creature — Drake', text, { power: '3', toughness: '3' } as Partial<OracleCard>), OPTS).faces[0]!;
const sorcery = (text: string) => parseCard(card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-c-56 parser, engine and renderer changes (one test each)', () => {
  it('parser/holes/cond.ts, render/cond.ts (CR 122.1, 604.1): "there are exactly three charge counters on ~" compares the counters of that kind on the object itself for equality; "three or more", other kinds of object and other words are other readings', () => {
    const ok = creature('As long as there are exactly three charge counters on this creature, it gets +1/+1.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"op":"==","right":3');
    const more = creature('As long as there are three or more charge counters on this creature, it gets +1/+1.');
    expect(JSON.stringify(more.abilities)).not.toContain('"op":"==","right":3');
    for (const bad of [
      'As long as there are exactly three charge counters on target creature, it gets +1/+1.',
      'As long as there are exactly three counters on this creature, it gets +1/+1.',
      'As long as there are exactly three charge counters among creatures you control, it gets +1/+1.',
    ]) expect(fullyAutomated(creature(bad)) && JSON.stringify(creature(bad).abilities).includes('"op":"==","right":3'), bad).toBe(false);
  });
  it('render/np.ts (CR 205.3i, 305.6): a permanent described by a basic land type alone is "that land"; a creature type alone is not', () => {
    const ok = sorcery("Destroy target Mountain. ~ deals 3 damage to that land's controller.");
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"subtypes":["Mountain"]');
    for (const bad of ["Destroy target Elf. ~ deals 3 damage to that land's controller.", "Destroy target Mountain. ~ deals 3 damage to that creature's controller."]) expect(fullyAutomated(sorcery(bad)), bad).toBe(false);
  });
  it('render/steps-flow.ts (CR 118.12a; family unless-pays): the payer, a target player, may be named first: "Unless target player pays {3}, that player loses 5 life and you gain 5 life."; the usual order, a different payer or a different branch is not this reading', () => {
    const ok = sorcery('Unless target player pays {3}, that player loses 5 life and you gain 5 life.');
    expect(fullyAutomated(ok)).toBe(true);
    for (const bad of ['Unless you pay {3}, that player loses 5 life and you gain 5 life.']) { // edh-c-106: "that player gains 5 life and you lose 5 life" is now read by the general prefix template (eff.edhv106.unlessPay.prefix); that reading is right, the old negative is dropped
      const f = sorcery(bad);
      expect(fullyAutomated(f) && JSON.stringify(f.abilities).includes('"op":"pay"'), bad).toBe(false);
    }
  });
  it('statics/mods.ts#removalNames, render/mods.ts (CR 702.16b, 613.1f): "protection:color:B" removes the one quality; "loses protection from red" and "loses protection" are not it', () => {
    const ok = creature('Sacrifice this creature: Target creature loses protection from black until end of turn.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"remove":["protection:color:B"]');
    for (const bad of ['Sacrifice this creature: Target creature loses protection from red until end of turn.', 'Sacrifice this creature: Target creature loses protection until end of turn.']) {
      const f = creature(bad);
      expect(fullyAutomated(f) && JSON.stringify(f.abilities).includes('protection:color:B'), bad).toBe(false);
    }
  });
});
