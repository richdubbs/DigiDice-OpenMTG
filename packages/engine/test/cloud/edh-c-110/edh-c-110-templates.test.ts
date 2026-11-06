/**
 * Commander EDHREC ranks 23,001-23,500, round edh-c-110 (fourth pass): the template data of parser/templates/zz-cloud/edh-c-110.json (a creature's "return ~ to ~'s owner's hand", a permanent
 * "becomes a 0/0 <subtype> artifact creature with <keyword>" for good, "protection from the color of its controller's choice", an attack-and-block tax on ~ per +1/+1 counter) and the round's
 * parser, renderer and engine changes, tested at the end of this file and in edh-c-110-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss
 * mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local
 * index when it is present. The behavior is in edh-c-110-scenarios.test.ts. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhC110 from '../../../src/parser/templates/zz-cloud/edh-c-110.json';
import review110 from '../../m5/golden/cards/edh-c-110-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhC110 as Template[];
/** The round's golden entries. */
const review = review110 as { card: string; verified: string; expect?: string }[];
const MECH_COUNT = 4;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on one card (of the EDHREC top
 * 5,000) only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (standing rule 2026-10-27, recommendation: accept).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edhv110.return.self.ownerHand': ['Bob, Reluctant HYDRA Agent'],
  'eff.edhv110.becomes.basept.subtype.artifactCreature.permanent': ['Kenku Artificer'],
  'eff.edhv110.protection.controllersChoice': ['Wishmonger'],
  'sta.edhv110.self.cantAttackOrBlock.unlessPay.perCounter': ['Myr Prototype'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static line on an Aura, an Equipment or a creature, a triggered or activated line on an artifact or a creature, else a sorcery. */
const parsedWith = (t: Template, text: string) =>
  parseCard(
    /^\{/.test(text) ? card('Example Plan', 'Artifact', text)
    : /^(When|At the|Whenever)/.test(text) && /enchanted creature/.test(text) ? card('Example Plan', 'Enchantment — Aura', `Enchant creature\n${text}`)
    : /^(When|At the|Whenever)/.test(text) ? card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>)
    : t.id.startsWith('sta.') && /enchanted creature/.test(text) ? card('Example Plan', 'Enchantment — Aura', `Enchant creature\n${text}`)
    : t.id.startsWith('sta.') ? card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>)
    : card('Example Plan', 'Sorcery', text),
    OPTS,
  ).faces[0]!;

describe('edh-c-110 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-c-110.json, path order: before edh-cast-1) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-c-110.json');
    expect(files.indexOf('zz-cloud/edh-c-110.json')).toBeLessThan(files.indexOf('zz-cloud/edh-cast-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are *.edhv110.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rid|cm)\.edhv110\./);
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

describe('edh-c-110 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('edh-c-110 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-c-110 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-c-110 design 6.10 (local index): synthetic examples', () => {
  it('no edh-c-110 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    // a narrow wording of fixed words (Myr Prototype, Phyrexian Marauder): the tax line itself is the wording, so its examples carry it
    const fixed = (l: string): boolean => /^~ can't attack( or block)? unless you pay \{1\} for each \+1\/\+1 counter on it\.$/.test(l);
    const verbatim = MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => !fixed(l.trim()) && lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});

const sorcery = (text: string) => parseCard(card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;
const creature = (text: string) => parseCard(card('Example Plan', 'Creature — Drake', text, { power: '3', toughness: '3' } as Partial<OracleCard>), OPTS).faces[0]!;
const artifact = (text: string) => parseCard(card('Example Plan', 'Artifact', text), OPTS).faces[0]!;

describe('edh-c-110 parser, renderer and engine changes (one test each)', () => {
  it('render/steps-zones.ts and steps-util.ts (CR 201.5, 400.3; family self-by-name): the object itself goes "to ~\'s owner\'s hand" (a character card\'s "return him to his owner\'s hand"); another object keeps "its owner\'s hand"', () => {
    const ok = creature('Whenever ~ attacks alone, return ~ to ~\'s owner\'s hand. If you do, each opponent loses 2 life and you gain 2 life.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"to":{"zone":"hand"}');
    expect(fullyAutomated(creature('Whenever ~ attacks alone, return ~ to ~\'s controller\'s hand. If you do, each opponent loses 2 life and you gain 2 life.'))).toBe(false);
    expect(fullyAutomated(creature('Whenever ~ attacks alone, return target creature to ~\'s owner\'s hand.'))).toBe(false);
  });
  it('render/stat.ts#choiceGrant-neighbour (render/fold.ts, CR 109.4, 608.2d): "the color of its controller\'s choice" is the controller of the target choosing; "your choice" and "the opponent\'s choice" stay their own templates', () => {
    const ok = artifact('{2}: Target creature gains protection from the color of its controller\'s choice until end of turn.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"controllerOf"');
    expect(fullyAutomated(artifact('{2}: Target creature gains protection from the color of an opponent\'s choice until end of turn.'))).toBe(false);
    expect(JSON.stringify(artifact('{2}: Target creature you control gains protection from the color of your choice until end of turn.').abilities)).not.toContain('"controllerOf"');
  });
  it('render/stat.ts#combatTax (CR 508.1h, 509.1d, 122.1): "~ can\'t attack or block unless you pay {1} for each +1/+1 counter on it" is the tax on ~ itself for both; attack only, another counter kind and {2} are other texts', () => {
    const ok = creature('~ can\'t attack or block unless you pay {1} for each +1/+1 counter on it.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"rule":"attackTax"');
    expect(JSON.stringify(ok.abilities)).toContain('"rule":"blockTax"');
    for (const bad of ['~ can\'t attack unless you pay {1} for each +1/+1 counter on it.', '~ can\'t attack or block unless you pay {1} for each -1/-1 counter on it.', '~ can\'t attack or block unless you pay {2} for each +1/+1 counter on it.']) {
      expect(fullyAutomated(creature(bad)) && JSON.stringify(creature(bad).abilities).includes('"blockTax"'), bad).toBe(false);
    }
  });
  it('parser/holes/spend.ts and types/ability.ts (CR 702.193a, 106.6): "Spend this mana only to activate power-up abilities" restricts the mana to abilities of the power-up keyword; equip abilities and plain abilities are other restrictions', () => {
    const ok = creature('{T}: Add {R}{R}. Spend this mana only to activate power-up abilities.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"abilityKeyword":"power-up"');
    expect(JSON.stringify(creature('{T}: Add {R}{R}. Spend this mana only to activate equip abilities.').abilities)).toContain('"abilityKeyword":"equip"');
    expect(JSON.stringify(creature('{T}: Add {R}{R}. Spend this mana only to activate abilities.').abilities)).not.toContain('abilityKeyword');
    expect(fullyAutomated(creature('{T}: Add {R}{R}. Spend this mana only to activate flash-up abilities.'))).toBe(false);
  });
  it('parser/holes/edhv110.ts, effects/eval.ts and actions/announce-cond.ts (CR 302.6, 400.7, 602.5b): "Activate only if you\'ve controlled ~ continuously since the beginning of your most recent turn" is the condition controlledSinceTurnStart; "your last upkeep", "an opponent\'s most recent turn" and another object are not read', () => {
    const ok = artifact('{2}: ~ deals 1 damage to any target. Activate only if you\'ve controlled ~ continuously since the beginning of your most recent turn.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"cond":"controlledSinceTurnStart"');
    for (const bad of [
      '{2}: ~ deals 1 damage to any target. Activate only if you\'ve controlled ~ continuously since the beginning of the turn.',
      '{2}: ~ deals 1 damage to any target. Activate only if you\'ve controlled ~ continuously since the beginning of an opponent\'s most recent turn.',
      '{2}: ~ deals 1 damage to any target. Activate only if you\'ve controlled a creature continuously since the beginning of your most recent turn.',
    ]) expect(JSON.stringify(artifact(bad).abilities).includes('controlledSinceTurnStart') && fullyAutomated(artifact(bad)), bad).toBe(false);
  });
  it('render/stat.ts (CR 702.3b, 609.4): "It can attack this turn as though it didn\'t have defender" after a pump of ~ is the permission for ~ itself', () => {
    const ok = parseCard(card('Example Plan', 'Artifact Creature — Wall', 'Defender\n{7}: ~ gets +2/+0 and gains trample until end of turn. It can attack this turn as though it didn\'t have defender.', { power: '0', toughness: '6' } as Partial<OracleCard>), OPTS).faces[0]!;
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"action":"attackAsThoughNoDefender"');
  });
  it('templates/effect/cards.json (CR 701.24a): eff.shuffle.player is stable (6.9 narrow wording: Soldier of Fortune and Boggart Forager, edh-c-110-review.json, t3-review.json)', () => {
    expect(TEMPLATE_SET.find((t) => t.id === 'eff.shuffle.player')?.status).toBe('stable');
    const boggart = parseCard(card('Example Plan', 'Creature — Goblin', '{R}, Sacrifice this creature: Target player shuffles their library.', { power: '1', toughness: '1' } as Partial<OracleCard>), OPTS).faces[0]!;
    expect(fullyAutomated(boggart)).toBe(true);
    expect(fullyAutomated(sorcery('Target player shuffles their graveyard.'))).toBe(false);
  });
});
