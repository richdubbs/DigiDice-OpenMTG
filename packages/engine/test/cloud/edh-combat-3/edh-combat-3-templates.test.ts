/**
 * Commander lane edh-combat, round edh-combat-3: the template data of parser/templates/zz-cloud/edh-combat-3.json ("for each <filter> you control, you may have that creature assign
 * its combat damage as though it weren't blocked", "enchanted creature's controller may have it assign ...", "<group> gain K until end of turn and can't be blocked by <filter> this
 * turn", "choose K1, K2, or K3. <group> gain that ability until end of turn", "<group> also get +N/+0 and have K as long as C", "put four +1/+1 counters and four more kinds on it",
 * "return it ... under its owner's control with a K counter and a J counter on it") and the parser, renderer and engine readings that came with them.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to
 * different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings
 * (design 6.10), checked against the local index when it is present. The behavior is in edh-combat-3-scenarios.test.ts. CR cites checked against the Comprehensive Rules text of 2026-09-25 (rules/cr/ is not in
 * the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhCombat3 from '../../../src/parser/templates/zz-cloud/edh-combat-3.json';
import review from '../../m5/golden/cards/edh-combat-3-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhCombat3 as Template[];
const MECH_COUNT = 7;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 5,000 that print each wording and are full (held-out ones opened by the owner, commander request 2026-10-27)
  'sta.edhcb3.permit.assignAsUnblocked.eachOfYours': ['Invasion of Ikoria // Zilortha, Apex of Ikoria'],
  'sta.edhcb3.permit.assignAsUnblocked.attachedController': ['Indomitable Might'],
  'eff.edhcb3.grant.untilEot.cantBeBlockedBy': ['Legion Loyalist'],
  'eff.edhcb3.choose3.groupGain.thatAbility': ['Angelic Skirmisher'],
  'sta.edhcb3.pumpgrant.also.aslong': ["Jetmir, Nexus of Revels"],
  'eff.edhcb3.counters.put.fourPlusFiveKinds': ['Scavenged Brawler'],
  'eff.edhcb3.return.bf.owner.counters.twoKinds': ['Gilraen, Dúnedain Protector'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** Templates whose examples are spell text (a sorcery); the Equipment one is an Equipment's; the others are abilities of a creature (static, activated, triggered). */
const SPELL = new Set<string>(['eff.edhcb3.grant.untilEot.cantBeBlockedBy', 'eff.edhcb3.return.bf.owner.counters.twoKinds']);
const GEAR = new Set<string>(['sta.edhcb3.permit.assignAsUnblocked.attachedController']);
/** A synthetic card in which an example is an ability of the right kind. */
const parsedWith = (t: Template, text: string) =>
  (SPELL.has(t.id) ? parseCard(card('Example Plan', 'Sorcery', text), OPTS)
    : GEAR.has(t.id) ? parseCard(card('Example Gear', 'Artifact — Equipment', text), OPTS)
    : parseCard(card('Example Relic', 'Artifact Creature — Golem', text, { power: '2', toughness: '2' }), OPTS)).faces[0]!;

describe('edh-combat-3 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-combat-3.json, path order: after edh-cast-1, before edh-mana-keywords-1) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-combat-3.json');
    expect(files.indexOf('zz-cloud/edh-combat-3.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-cast-1.json'));
    expect(files.indexOf('zz-cloud/edh-combat-3.json')).toBeLessThan(files.indexOf('zz-cloud/edh-mana-keywords-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.edhcb3.* (or sta.)', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rid|kw|cm)\.edhcb3\./);
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

describe('edh-combat-3 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bfor each\b/, 'for any'], [/\bmay have\b/, 'must have'], [/weren't blocked/, 'were blocked'], [/\bcontroller\b/, 'owner'], [/\bgain\b/, 'lose'], [/\bgains\b/, 'loses'], [/\bblocked by\b/, 'blocked except by'],
    [/\bas long as\b/, 'unless'], [/\bthat ability\b/, 'those abilities'], [/\bchoose\b/, 'choose up to one of'], [/\bunder its owner's control\b/, 'under your control'], [/\band a\b/, 'or a'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-combat-3 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-combat-3 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-combat-3 design 6.10 (local index): synthetic examples', () => {
  it('no edh-combat-3 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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



describe('edh-combat-3 parser, renderer and engine readings (one test each)', () => {
  const face = (text: string, type = 'Artifact Creature — Golem') => parseCard(card('Example Relic', type, text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  it('model/cap-walk.ts, statics/hooks.ts (CR 510.1b-c): `permit assignAsUnblocked` with `of` is an engine form; the capability name is registered', () => {
    expect(ENGINE_CAPABILITIES.has('feature:permit.assignAsUnblocked.of'), 'feature:permit.assignAsUnblocked.of').toBe(true);
    expect(ENGINE_CAPABILITIES.has('permit:assignAsUnblocked')).toBe(true);
  });
  it('render/stat.ts: an unblocked-damage permission for another player\'s creatures has no wording (the card stays partial)', () => {
    expect(fullyAutomated(face("For each creature an opponent controls, you may have that creature assign its combat damage as though it weren't blocked."))).toBe(false);
    expect(fullyAutomated(face("For each creature you control, you may have that creature assign its combat damage as though it weren't blocked."))).toBe(true);
  });
  it('render/stat.ts#sharedEffectSubject (CR 509.1b, 611.2c, 613.1f): a group\'s grant and "can\'t be blocked by <creatures> this turn" are said with the subject once; "except by" is not read as it', () => {
    const f = parseCard(card('Example Plan', 'Sorcery', "Creatures you control gain flying until end of turn and can't be blocked by Walls this turn."), OPTS).faces[0]!;
    expect(fullyAutomated(f)).toBe(true);
    for (const wrong of [
      "Creatures you control gain flying until end of turn and can't be blocked except by Walls this turn.",
      "Creatures you control gain flying until end of turn and can't be blocked by Walls until end of turn.",
    ]) expect(fullyAutomated(parseCard(card('Example Plan', 'Sorcery', wrong), OPTS).faces[0]!), wrong).toBe(false);
  });
  it('parser/lower/ability.ts#joinChooseKeywordGain (CR 608.2d): "Choose K1, K2, or K3." joins only the grant of "that ability" to a group until end of turn; any other next sentence stays apart', () => {
    const ok = face('At the beginning of each combat, choose flying, vigilance, or menace. Creatures you control gain that ability until end of turn.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"op":"chooseValue"');
    for (const wrong of [
      'At the beginning of each combat, choose flying, vigilance, or menace. Creatures you control gain that ability.',
      'At the beginning of each combat, choose flying, vigilance, or menace. Target creature you control gains that ability until end of turn.',
      'At the beginning of each combat, choose flying or menace. Target creature you control gains that ability until end of turn.', // edh-next-40: the two-keyword choice joins the same group grant, so the negative is a target
    ]) expect(fullyAutomated(face(wrong)) && JSON.stringify(face(wrong).abilities).includes('"op":"chooseValue"'), wrong).toBe(false);
  });
  it('render/np.ts (family shared-adjectives-list): "a goaded attacking or blocking creature" is one list; the other order of the words does not read', () => {
    expect(fullyAutomated(face('Whenever a goaded attacking or blocking creature dies, you create a Treasure token.'))).toBe(true);
    expect(fullyAutomated(face('Whenever an attacking goaded or blocking creature dies, you create a Treasure token.'))).toBe(false);
  });
  it('render/fold.ts#fivePuts (CR 122.1, 608.2c): five different kinds of counters on one object are one instruction; the same kind twice is not the template\'s', () => {
    expect(fullyAutomated(parseCard(card('Example Plan', 'Sorcery', 'Put four +1/+1 counters, a reach counter, a menace counter, a deathtouch counter, and a haste counter on target creature.'), OPTS).faces[0]!)).toBe(true);
    expect(fullyAutomated(parseCard(card('Example Plan', 'Sorcery', 'Put four +1/+1 counters, a reach counter, a menace counter, a deathtouch counter, and a reach counter on target creature.'), OPTS).faces[0]!)).toBe(false);
  });
  it('zz-cloud/c3.json (design 6.9 deviation): sta.c3.pumpgrant.aslong is stable on the one card that prints it, Jetmir (golden in edh-combat-3-review.json)', () => {
    const t = TEMPLATE_SET.find((x) => x.id === 'sta.c3.pumpgrant.aslong');
    expect(t?.status).toBe('stable');
    expect((review as { card: string; verified: string }[]).some((g) => g.card === 'Jetmir, Nexus of Revels' && g.verified.includes('sta.c3.pumpgrant.aslong'))).toBe(true);
  });
});
