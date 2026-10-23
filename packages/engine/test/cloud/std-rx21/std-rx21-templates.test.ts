/**
 * EDH lane rx21 (std-rx21): the template data of parser/templates/zz-cloud/std-rx21.json ("<player> can't cast <spells>" with or without a duration, "<player> can't play
 * lands"; "gains protection from colorless / artifacts or from the color of your choice"; "<object> can't be the target of spells or abilities your opponents
 * control" with or without a duration) and the round's parser and renderer changes (Cond "an opponent has N or more cards in their graveyard").
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in std-rx21-scenarios.test.ts. CR cites from memory,
 * unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdRx21 from '../../../src/parser/templates/zz-cloud/std-rx21.json';
import review from '../../m5/golden/cards/cloud-std-rx21-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = stdRx21 as Template[];
const MECH_COUNT = 7;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on one card only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner.
 */
const NARROW: Readonly<Record<string, string>> = {
  'sta.stdrx21.player.cantCast.filter': 'Grid Monitor', // and Steel Golem: the two tuning-half printings that become full
  'sta.stdrx21.player.cantPlayLands': 'Aggressive Mining',
  'eff.stdrx21.player.cantCast.filter.dur': 'Permission Denied',
  'eff.stdrx21.gains.protection.colorless.orChosenColor': 'Giver of Runes',
  'eff.stdrx21.gains.protection.artifacts.orChosenColor': "Apostle's Blessing", // and Jeweled Spirit
  'sta.stdrx21.obj.cantBeTargeted.byOpponents': 'Canopy Cover',
  'eff.stdrx21.obj.cantBeTargeted.byOpponents.dur': 'Vines of Vastwood',
};
/** Templates kept experimental (none: each has its golden evidence). */
const EXPERIMENTAL: readonly string[] = [];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a creature (triggered and activated abilities). */
const parsedWith = (_t: Template, text: string) => parseCard(card('Example Shaman', 'Creature — Goblin Shaman', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
const face = (type: string, text: string, pt?: [string, string]) => parseCard(card('Example Monk', type, text, pt ? { power: pt[0], toughness: pt[1] } : {}), OPTS).faces[0]!;
const fullFace = (f: ReturnType<typeof face>): boolean => fullyAutomated(f) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual');

describe('std-rx21 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-rx21.json, after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-rx21.json');
    expect(files.indexOf('zz-cloud/std-rx21.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/std-rx21.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are sta|eff.stdrx21.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(sta|eff)\.stdrx21\./);
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

describe('std-rx21 guard G9 (design 6.8): examples and counter-examples', () => {
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
  const swaps: [RegExp, string][] = [[/\bcan't\b/, 'can'], [/\bopponents\b/, 'teammates'], [/\bcolorless\b/, 'multicolored'], [/\bartifacts or\b/, 'enchantments or'], [/\bor from\b/, 'and from'], [/\bspells or abilities\b/, 'spells'], [/\blands\b/, 'creatures']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-rx21 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('std-rx21 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('std-rx21 design 6.10 (local index): synthetic examples', () => {
  it('no std-rx21 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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



// ---- parser/holes/cond.ts#opponentHasLife, render/cond.ts: "an opponent has N or more cards in their graveyard" -------------------------------------------------

describe('std-rx21 Cond (CR 404.1, 102.3): "an opponent has eight or more cards in their graveyard" (countPlayers.sizeIs over each opponent)', () => {
  it('a cost reduction, a static P/T change and an activation restriction with it are full and write sizeIs (graveyard, >= N) over each opponent', () => {
    for (const [type, text, p] of [
      ['Sorcery', 'This spell costs {2} less to cast if an opponent has six or more cards in their graveyard.\nDraw a card.', undefined],
      ['Creature — Zombie Rogue', 'This creature gets +2/+0 as long as an opponent has eight or more cards in their graveyard.', ['2', '2']],
      ['Creature — Merfolk Rogue', '{1}, Sacrifice this creature: Draw a card. Activate only if an opponent has eight or more cards in their graveyard.', ['1', '1']],
    ] as [string, string, [string, string] | undefined][]) {
      const f = face(type, text, p);
      expect(fullFace(f), `${text}: ${JSON.stringify(f.diagnostics)}`).toBe(true);
      expect(JSON.stringify(f.abilities), text).toContain('"q":"countPlayers","of":{"ref":"each","who":"opponent"},"sizeIs":{"zone":"graveyard","op":">=","n":');
    }
  });
  it('"or fewer", a hand, "your graveyard" or a player other than an opponent is not read so', () => {
    expect(JSON.stringify(face('Sorcery', 'This spell costs {2} less to cast if an opponent has six or fewer cards in their graveyard.\nDraw a card.').abilities)).not.toContain('"sizeIs":{"zone":"graveyard"');
    expect(JSON.stringify(face('Sorcery', 'This spell costs {2} less to cast if an opponent has six or more cards in their hand.\nDraw a card.').abilities)).not.toContain('"sizeIs":{"zone":"graveyard"');
    expect(JSON.stringify(face('Sorcery', 'This spell costs {2} less to cast if an opponent has six or more cards in your graveyard.\nDraw a card.').abilities)).not.toContain('"sizeIs"');
    expect(JSON.stringify(face('Sorcery', 'This spell costs {2} less to cast if a teammate has six or more cards in their graveyard.\nDraw a card.').abilities)).not.toContain('"sizeIs"');
  });
});

// ---- render/fold.ts#choiceGrant: "protection from colorless or from the color of your choice" ----------------------------------------------------------------

describe('std-rx21 renderer (CR 702.16a, 608.2d): the option choice "colorless|artifacts, white, blue, black, red, green" with one protection grant per answer', () => {
  it('renders only when the six answers and the six grants are exactly that (another order or another first answer is refused)', () => {
    const f = face('Instant', 'Target creature gains protection from colorless or from the color of your choice until end of turn.');
    expect(fullFace(f)).toBe(true);
    const s = JSON.stringify(f.abilities);
    expect(s).toContain('"options":["colorless","white","blue","black","red","green"]');
    expect(s).toContain('"quality":"colorless"');
    expect(s).toContain('"quality":"color:G"');
    const g = face('Instant', 'Target creature gains protection from artifacts or from the color of your choice until end of turn.');
    expect(JSON.stringify(g.abilities)).toContain('"quality":"type:Artifact"');
  });
});

// ---- render/stat.ts: "can't be the target of spells or abilities your opponents control" -----------------------------------------------------------------------

describe('std-rx21 renderer (CR 115.1, 702.11b): a targeting ban whose `other` is exactly {controller: opponent}', () => {
  it('the static and the effect write restrict beTargeted with other {controller: opponent}; "your opponents" is not the hexproof keyword', () => {
    const f = face('Enchantment — Aura', "Enchant creature\nEnchanted creature can't be the target of spells or abilities your opponents control.");
    expect(fullFace(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"s":"restrict","subject":{"ref":"attachedTo"},"mode":"cant","action":"beTargeted","other":{"controller":"opponent"}');
    expect(JSON.stringify(f.abilities)).not.toContain('"keyword":"hexproof"');
  });
});
