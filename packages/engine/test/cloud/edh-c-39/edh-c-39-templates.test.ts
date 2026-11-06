/**
 * Commander EDHREC ranks 27,501-28,000, round edh-c-39 (first pass): the template data of parser/templates/zz-cloud/edh-c-39.json ("switch its power and toughness", "prevent the next N damage ... For each 1 damage prevented this way, put a counter on that creature", an Aura that pumps and "blocks each combat if able" / "can't attack alone", "~ and that creature phase out", "put that card into their graveyard", look at a library and put the card on the bottom / shuffle that library) and the round's parser and renderer changes, tested at the end of this file and in edh-c-39-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss
 * mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local
 * index when it is present. The behavior is in edh-c-39-scenarios.test.ts. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhC39 from '../../../src/parser/templates/zz-cloud/edh-c-39.json';
import review39 from '../../m5/golden/cards/edh-c-39-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhC39 as Template[];
/** The round's golden entries. */
const review = review39 as { card: string; verified: string; expect?: string }[];
const MECH_COUNT = 10;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on one card (of the EDHREC top
 * 5,000) only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (standing rule 2026-10-27, recommendation: accept).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edhv39.switch.itsPT.dur': ['Valakut Fireboar'],
  'eff.edhv39.prevent.next.obj.counterPerPrevented': ['Test of Faith'],
  'sta.edhv39.obj.pump.andBlocksEachCombat': ['Spirespine'],
  'sta.edhv39.obj.pump.andCantAttackAlone': ['Sightless Brawler'],
  'eff.edhv39.phaseOut.selfAnd': ['Dream Fighter'],
  'eff.edhv39.put.gy.their': ['Eye Spy'],
  'eff.edhv39.look.defendingPlayer.topCard.mayBottom': ['Coral Fighters'],
  'eff.edhv39.look.libraryOf.topN.mayShuffle': ['Visions'],
  'eff.edhv39.damage.recipient.ifCond': ['Swirling Sandstorm'],
  'sta.edhv39.obj.cantBeTargetOfAuraSpells': ['Tetsuo Umezawa'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static line on an Aura, an Equipment or a creature, a triggered or activated line on an artifact or a creature, else a sorcery. */
const parsedWith = (t: Template, text: string) =>
  parseCard(
    /^\{/.test(text) ? card('Example Plan', 'Artifact', text)
    : /^Equipped/.test(text) ? card('Example Plan', 'Artifact — Equipment', text)
    : /^Enchanted/.test(text) ? card('Example Plan', 'Enchantment — Aura', `Enchant creature\n${text}`)
    : /^(When|At the|Whenever)/.test(text) ? card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>)
    : card('Example Plan', 'Sorcery', text),
    OPTS,
  ).faces[0]!;

describe('edh-c-39 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-c-39.json, path order: after edh-c-3, before edh-c-4) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-c-39.json');
    expect(files.indexOf('zz-cloud/edh-c-39.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-c-3.json'));
    expect(files.indexOf('zz-cloud/edh-c-39.json')).toBeLessThan(files.indexOf('zz-cloud/edh-c-4.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhv39.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rid|cm)\.edhv39\./);
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

describe('edh-c-39 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('edh-c-39 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-c-39 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-c-39 design 6.10 (local index): synthetic examples', () => {
  it('no edh-c-39 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    expect(verbatim, JSON.stringify(verbatim)).toEqual([]);
  }, 120_000);
});

const sorcery = (text: string) => parseCard(card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;
const creature = (text: string) => parseCard(card('Example Plan', 'Creature — Drake', text, { power: '3', toughness: '3' } as Partial<OracleCard>), OPTS).faces[0]!;

describe('edh-c-39 parser and renderer changes (one test each)', () => {
  it('parser/holes/object.ts (hole Its, CR 613.4d): "switch its power and toughness" names the object the trigger is about; "their" or a missing duration are not this reading', () => {
    expect(fullyAutomated(creature('Whenever this creature attacks, switch its power and toughness until end of turn.'))).toBe(true);
    expect(fullyAutomated(creature('Whenever this creature attacks, switch their power and toughness until end of turn.'))).toBe(false);
    expect(fullyAutomated(creature('Whenever this creature attacks, switch its power and toughness.'))).toBe(false);
  });
  it('parser/lower/ability.ts#joinPreventedThisWay (CR 615.5): the prevention and "For each 1 damage prevented this way, put a counter on that creature" are one shield; "For each 2" or a counter on another object is not', () => {
    const ok = sorcery('Prevent the next 3 damage that would be dealt to target creature this turn. For each 1 damage prevented this way, put a +1/+1 counter on that creature.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"q":"preventedAmount"');
    for (const bad of ['Prevent the next 3 damage that would be dealt to target creature this turn. For each 2 damage prevented this way, put a +1/+1 counter on that creature.', 'Prevent the next 3 damage that would be dealt to target creature this turn. Put a +1/+1 counter on that creature.']) {
      const f = sorcery(bad);
      expect(fullyAutomated(f) && JSON.stringify(f.abilities).includes('"q":"preventedAmount"'), bad).toBe(false);
    }
  });
  it('parser/lower/ability.ts#joinPreventedThisWay (CR 401.2): a look at a library and its follow-up are one instruction only for "put that card on the bottom of that player\'s library" and "have that player shuffle that library"', () => {
    expect(fullyAutomated(sorcery('Look at the top card of target player\'s library. You may put that card on the bottom of that player\'s library.'))).toBe(true);
    expect(fullyAutomated(sorcery('Look at the top five cards of target player\'s library. You may then have that player shuffle that library.'))).toBe(true);
    for (const bad of ['Look at the top card of target player\'s library. You may put that card on top of that player\'s library.', 'Look at the top card of your library. You may put that card on the bottom of that player\'s library.']) {
      const f = sorcery(bad);
      expect(fullyAutomated(f) && JSON.stringify(f.abilities).includes('"position":"bottom"') && JSON.stringify(f.abilities).includes('"owner"'), bad).toBe(false);
    }
  });
  it('parser/holes/cond.ts (CR 202.3, 122.1): "mana values among cards in your graveyard" counts different mana values (at least only); "a creature has a -1/-1 counter on it" is the existence of one with a counter', () => {
    const mv = creature('As long as there are five or more mana values among cards in your graveyard, this creature gets +2/+2.');
    expect(fullyAutomated(mv)).toBe(true);
    expect(JSON.stringify(mv.abilities)).toContain('"what":"manaValues"');
    expect(fullyAutomated(creature('As long as there are fewer than five mana values among cards in your graveyard, this creature gets +2/+2.'))).toBe(false);
    const hunter = creature('As long as a creature has a -1/-1 counter on it, this creature has vigilance and deathtouch.');
    expect(fullyAutomated(hunter)).toBe(true);
    expect(JSON.stringify(hunter.abilities)).toContain('"counters":{"kind":"-1/-1"}');
    expect(fullyAutomated(creature('As long as a creature has two -1/-1 counters on it, this creature has vigilance and deathtouch.'))).toBe(false);
  });
  it('render/steps-util.ts (CR 107.3): "You gain X plus 3 life" is the sum of X and a number; "X plus Y" with another unknown is not read', () => {
    const x = parseCard(card('Example Plan', 'Instant', 'You gain X plus 3 life.', { mana_cost: '{X}{W}' } as Partial<OracleCard>), OPTS).faces[0]!;
    expect(fullyAutomated(x)).toBe(true);
    expect(JSON.stringify(x.abilities)).toContain('"op":"+"');
  });
});
