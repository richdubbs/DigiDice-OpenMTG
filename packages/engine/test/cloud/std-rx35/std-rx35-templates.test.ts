/**
 * EDH lane rx35 (std-rx35): the template data of parser/templates/zz-cloud/std-rx35.json ("Draw N cards, then put a card from your hand on the bottom of your
 * library"; "The next time a source of your choice would deal damage to you / <object> / any target this turn, prevent that damage[. You gain life equal to the
 * damage prevented this way.]") and the round's parser and renderer changes (the trigger "attacks and isn't blocked", Qty "for each <card> milled this way", the
 * sentence join of a shield and its additional instruction).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in std-rx35-scenarios.test.ts. CR cites from memory,
 * unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdRx35 from '../../../src/parser/templates/zz-cloud/std-rx35.json';
import review from '../../m5/golden/cards/cloud-std-rx35-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = stdRx35 as Template[];
const MECH_COUNT = 5;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on one card only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner.
 */
const NARROW: Readonly<Record<string, string>> = {
  'eff.stdrx35.draw.thenPutOneBottom': 'Amass the Components', // Jace, Multiverse Architect and Mordenkainen print it too but stay partial on other abilities
  'eff.stdrx35.prevent.nextSourceOfChoice.you': 'Righteous Aura', // the other tuning-half or Standard printings are held-out or New Way Forward (claimed elsewhere)
  'eff.stdrx35.prevent.nextSourceOfChoice.you.gainLife': 'Intervention Pact', // and Cho-Arrim Alchemist
  'eff.stdrx35.prevent.nextSourceOfChoice.obj': 'Charm Peddler', // and Kithkin Armor
  'eff.stdrx35.prevent.nextSourceOfChoice.any': 'Circle of Despair',
};
/** Templates kept experimental (none: each has its golden evidence). */
const EXPERIMENTAL: readonly string[] = [];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a creature (triggered and activated abilities). */
const parsedWith = (_t: Template, text: string) => parseCard(card('Example Shaman', 'Creature — Goblin Shaman', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
const face = (type: string, text: string, pt?: [string, string]) => parseCard(card('Example Monk', type, text, pt ? { power: pt[0], toughness: pt[1] } : {}), OPTS).faces[0]!;
const fullFace = (f: ReturnType<typeof face>): boolean => fullyAutomated(f) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual');

describe('std-rx35 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-rx35.json, after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-rx35.json');
    expect(files.indexOf('zz-cloud/std-rx35.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/std-rx35.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.stdrx35.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^eff\.stdrx35\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.status, t.id).toBe(EXPERIMENTAL.includes(t.id) ? 'experimental' : 'stable');
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the one card that prints the wording', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      if (NARROW[t.id] !== undefined) expect(cards, t.id).toContain(NARROW[t.id]);
      else expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
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

describe('std-rx35 guard G9 (design 6.8): examples and counter-examples', () => {
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
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`, `${body} during combat.`];
  const swaps: [RegExp, string][] = [[/\bbottom\b/, 'top'], [/\byour hand\b/, 'your graveyard'], [/\byour choice\b/, "an opponent's choice"], [/\bto you\b/, 'to each player'], [/\bthis turn\b/, 'this combat'], [/\bgain life\b/, 'lose life'], [/\bprevent that damage\b/, 'prevent half that damage'], [/\bany target\b/, 'any other target'], [/\bnext time\b/, 'first time']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-rx35 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/if able/during combat" or a swapped key word never gives the example's JSON`, () => {
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

describe('std-rx35 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^\{/.test(w)) return;
          const end = w.match(/[.,:]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('std-rx35 design 6.10 (local index): synthetic examples', () => {
  it('no std-rx35 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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




// ---- parser/holes/event.ts, render/evt.ts: "Whenever <object> attacks and isn't blocked" ----------------------------------------------------------------------

describe('std-rx35 Event (CR 509.1h): "<object> attacks and isn\'t blocked" is the event attacksUnblocked', () => {
  it('of ~ and of a group: full, writing ev attacksUnblocked with the attacker\'s filter; "defending player" in its effect is automated', () => {
    for (const [text, on] of [
      ["Whenever this creature attacks and isn't blocked, draw a card.", '{"ev":"attacksUnblocked","attacker":{"self":true}}'],
      ["Whenever a Rogue you control attacks and isn't blocked, it gets +2/+1 until end of turn.", '{"ev":"attacksUnblocked","attacker":{"subtypes":["Rogue"],"controller":"you"}}'],
      ["Whenever this creature attacks and isn't blocked, defending player gets a poison counter.", '{"ev":"attacksUnblocked","attacker":{"self":true}}'],
    ] as [string, string][]) {
      const f = face('Creature — Human Rogue', text, ['2', '2']);
      expect(fullFace(f), `${text}: ${JSON.stringify(f.diagnostics)}`).toBe(true);
      expect(JSON.stringify(f.abilities), text).toContain(`"on":[${on}]`);
    }
  });
  it('"attacks" alone, "becomes blocked" and "attacks and isn\'t blocked this combat" are not read so', () => {
    expect(JSON.stringify(face('Creature — Human Rogue', 'Whenever this creature attacks, draw a card.', ['2', '2']).abilities)).not.toContain('attacksUnblocked');
    expect(JSON.stringify(face('Creature — Human Rogue', 'Whenever this creature becomes blocked, draw a card.', ['2', '2']).abilities)).not.toContain('attacksUnblocked');
    expect(fullFace(face('Creature — Human Rogue', "Whenever a creature attacks and isn't blocked this combat, draw a card.", ['2', '2']))).toBe(false);
  });
});

// ---- parser/holes/qty.ts#milledThisWayCount, render/qty.ts: "for each <card> milled this way" -----------------------------------------------------------------

describe('std-rx35 Qty (CR 701.17a, 608.2c): "for each creature card milled this way" counts the described cards among those an earlier mill step milled', () => {
  it('after a mill: full, a count of the milled group (`is` the mill step\'s binding, zone any) with the description', () => {
    const f = face('Creature — Bird', 'When this creature enters, mill four cards. You gain 1 life for each creature card milled this way.', ['2', '2']);
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    const s = JSON.stringify(f.abilities);
    expect(s).toContain('"as":"them"');
    expect(s).toContain('"amount":{"q":"count","of":{"ref":"each","filter":{"types":["Creature"],"isCard":true,"is":{"ref":"bound","name":"them"},"zone":"any"}}}');
  });
  it('without an earlier mill, or with a controller in the description, it is not read (fail closed)', () => {
    expect(fullFace(face('Creature — Bird', 'When this creature enters, you gain 1 life for each creature card milled this way.', ['2', '2']))).toBe(false);
    expect(fullFace(face('Creature — Bird', 'When this creature enters, mill four cards. You gain 1 life for each creature card you control milled this way.', ['2', '2']))).toBe(false);
  });
});

// ---- parser/lower/ability.ts#joinPreventedThisWay: a shield and "You gain life equal to the damage prevented this way." -------------------------------------------

describe('std-rx35 sentence join (CR 615.5): the shield sentence and its additional instruction are one instruction', () => {
  it('joined only for "the next time a source of your choice would deal damage to you" followed by exactly the gain-life sentence', () => {
    const f = face('Instant', 'The next time a source of your choice would deal damage to you this turn, prevent that damage. You gain life equal to the damage prevented this way.');
    expect(fullFace(f)).toBe(true);
    expect(f.templatesUsed).toContain('eff.stdrx35.prevent.nextSourceOfChoice.you.gainLife');
    const g = face('Instant', 'The next time a source of your choice would deal damage to you this turn, prevent that damage. You gain 2 life.');
    expect(g.templatesUsed).not.toContain('eff.stdrx35.prevent.nextSourceOfChoice.you.gainLife');
    expect(JSON.stringify(g.abilities)).not.toContain('preventedAmount');
  });
  it('the colored FAST5 T36 shield keeps its own template and rendering', () => {
    const f = face('Enchantment', '{1}: The next time a red source of your choice would deal damage to you this turn, prevent that damage.');
    expect(fullFace(f)).toBe(true);
    expect(f.templatesUsed).toContain('eff.t36.prevent.nextSourceOfChoice.you');
  });
});
