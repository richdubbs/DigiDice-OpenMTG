/**
 * MUST-FINISH round edh-next-134 (group control): the template data of parser/templates/zz-cloud/edh-next-134.json (see the file) and the round's parser, lowering, engine and renderer
 * changes, tested at the end of this file and in edh-next-134-scenarios.test.ts.
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
import edhNext134 from '../../../src/parser/templates/zz-cloud/edh-next-134.json';
import review from '../../m5/golden/cards/edh-next-134-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhNext134 as Template[];
const MECH_COUNT = 8;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 20,000 that print each wording and are full (one each)
  'eff.edhn134.dur.gainControl': ['Grishnákh, Brash Instigator'],
  'eff.edhn134.whileHere.alsoGoaded': ['Hot Pursuit'],
  'eff.edhn134.spellsController.mayChooseNewTargets': ['Sudden Substitution'],
  'eff.edhn134.itsControllerChoosesTarget.sharesCardType.exchangeControl': ['Confusion in the Ranks'],
  'eff.edhn134.villainous.sacrificeOrStealAttacking': ['Midnight Crusader Shuttle'],
  'eff.edhn134.startingWithYou.eachPlayerChoosesA': ['The Horus Heresy'],
  'eff.edhn134.forEachVote.voterChoosesTheyControl': ['Elrond of the White Council'],
  'sta.edhn134.cantAttackOwner': ['Elrond of the White Council'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  t.kind === 'static' || text.includes(':') || /^(When|Whenever|At) /.test(text) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' })
    : card('Example Plan', 'Sorcery', text, /\bX\b/.test(text) ? { mana_cost: '{X}{U}' } : {}), OPTS).faces[0]!;

describe('edh-next-134 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-next-134.json, path order: after edh-next-13, before edh-next-14) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-next-134.json');
    expect(files.indexOf('zz-cloud/edh-next-134.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-next-13.json'));
    expect(files.indexOf('zz-cloud/edh-next-134.json')).toBeLessThan(files.indexOf('zz-cloud/edh-next-14.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are *.edhn134.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|ch|rid|cm|dl)\.edhn134\./);
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

describe('edh-next-134 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bcreature\b/, 'land'], [/\btapped\b/, 'untapped'], [/\bother\b/, 'all'], [/\bartifact\b/, 'enchantment'], [/\bgain control\b/, 'x'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-next-134 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-next-134 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (/^counters?[.,]?$/.test(words[i + 1] ?? '')) return; // a counter's kind is any word (CR 122.1: "a blorfty counter" is a counter of that kind)
          const lead = w.match(/^["\n]+/)?.[0] ?? '';
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    }, 120_000);
  }
});

const index = localIndex();

describe.skipIf(index === null)('edh-next-134 design 6.10 (local index): synthetic examples', () => {
  it('no edh-next-134 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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




describe('edh-next-134 parser, renderer and engine changes (one test each)', () => {
  const spell = (text: string, cost = '{2}') => parseCard(card('Example Plan', 'Sorcery', text, { mana_cost: cost }), OPTS).faces[0]!;
  const relic = (text: string) => parseCard(card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  it('lower/anaphora.ts#resolveSpecs (CR 603.12, 603.3d, 701.47c; Grishnákh): a "When you do" target reads the Army the instruction before amassed; without the reflexive trigger it can\'t', () => {
    const f = relic("When ~ enters, amass Orcs 2. When you do, destroy target creature with power less than or equal to the amassed Army's power.");
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"op":"reflexive"');
    expect(fullyAutomated(relic("When ~ enters, amass Orcs 2. Destroy target creature with power less than or equal to the amassed Army's power."))).toBe(false);
  });
  it('lower/each-other-edhn134.ts + effects/refs.ts (CR 102.1, 608.2c; Oft-Nabbed Goat): "each other player" after a named player is other than THAT player; after "you" nothing changes', () => {
    const f = spell('Target player draws two cards and each other player loses 2 life.');
    expect(JSON.stringify(f.abilities)).toContain('"who":{"ref":"each","who":"otherPlayer","than":{"ref":"target","id":"t0"}}');
    expect(JSON.stringify(spell('You draw two cards and each other player loses 2 life.').abilities)).not.toContain('"than"');
  });
  it('render/qty.ts#countersNamedByTrigger (CR 603.4, 603.10a): "that many" is the counters the intervening "if" named; another kind of counter is not', () => {
    expect(fullyAutomated(relic('When ~ dies, if it had one or more -1/-1 counters on it, draw that many cards.'))).toBe(true);
    expect(fullyAutomated(relic('When ~ dies, if it had one or more -1/-1 counters on it, draw cards equal to the number of +1/+1 counters on it.'))).toBe(true);
  });
  it('parser/holes/filter.ts#controlForms (CR 510.2, 120.1; Admiral Beckett Brass): "controlled by a player who was dealt combat damage by three or more Pirates this turn"; "one or more" is not read so', () => {
    const f = relic('At the beginning of your end step, destroy target nonland permanent controlled by a player who was dealt combat damage by three or more Pirates this turn.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"controllerDealtCombatDamageBy":{"atLeast":3,"by":{"subtypes":["Pirate"]}}');
    expect(JSON.stringify(relic('At the beginning of your end step, destroy target nonland permanent controlled by a player who was dealt combat damage by one or more Pirates this turn.').abilities)).not.toContain('controllerDealtCombatDamageBy');
  });
  it('parser/holes/edhn134.ts + render/cond.ts (CR 104.3, 800.4a; Hot Pursuit): "if two or more players have lost the game"; "one or more" is not this reading', () => {
    const f = relic('At the beginning of your upkeep, if two or more players have lost the game, draw a card.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"interveningIf":{"cond":"compare","left":{"q":"playersLost"},"op":">=","right":2}');
    expect(JSON.stringify(relic('At the beginning of your upkeep, if one or more players have lost the game, draw a card.').abilities)).not.toContain('playersLost');
  });
  it('parser/holes/filter.ts#modAt + render/np.ts (CR 701.15b, 701.60b; Hot Pursuit): "goaded and/or suspected creatures" is either designation; "goaded and/or tapped" is not read so', () => {
    const f = spell('Destroy all goaded and/or suspected creatures.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"anyOf":[{"goaded":true},{"suspected":true}]');
    expect(JSON.stringify(spell('Destroy all goaded and/or tapped creatures.').abilities)).not.toContain('"goaded":true},{"tapped"');
  });
  it('actions/announce-targets.ts#chooserOf + model/forms.ts (CR 603.3d; Confusion in the Ranks): the chooser of a trigger\'s target is the controller of the event\'s object', () => {
    const f = relic('Whenever an artifact or creature enters, its controller chooses target permanent another player controls that shares a card type with it. Exchange control of those permanents.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"chooser":{"ref":"controllerOf","object":{"ref":"event","role":"subject"}}');
  });
  it('effects/handlers/zones-status.ts#tap `attacking` + types (CR 508.4; Midnight Crusader Shuttle): "tap it, and it\'s attacking that player"; without "and it\'s attacking" the creature is only tapped', () => {
    const shuttle = "Whenever ~ attacks, defending player faces a villainous choice — That player sacrifices a creature of their choice, or you gain control of a creature of your choice that player controls until end of turn. If you gain control of a creature this way, tap it, and it's attacking that player.";
    const f = relic(shuttle);
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"op":"tap","what":{"ref":"bound","name":"stolen"},"attacking":{"defender":{"ref":"defending"}}');
    expect(fullyAutomated(relic(shuttle.replace(", tap it, and it's attacking that player.", ', tap it.')))).toBe(false);
  });
  it('lower/targets.ts#STEP_DELAY_TARGET_LEAD_STEP (CR 603.7, 603.3d; Swooping Pteranodon): the next end step lead takes the target of its own sentence; "your next end step" keeps its reading', () => {
    const f = spell('Tap target creature. At the beginning of the next end step, target player draws a card.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toMatch(/"op":"delay","when":\{"at":"step","step":"end","next":true\}.*"targets":\[\{"id":"t1","kind":"player"/);
    expect(fullyAutomated(spell('Tap target creature. At the beginning of your next end step, target player draws a card.'))).toBe(false);
  });
  it('lower/mentions.ts (CR 701.38a, 608.2f; Elrond): what a "for each <word> vote, the voter chooses ..." loop chose is "each creature chosen this way" after it', () => {
    const f = relic('When ~ enters, each player secretly votes for fellowship or aid, then those votes are revealed. For each fellowship vote, the voter chooses a creature they control. Destroy each creature chosen this way.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"op":"destroy","what":{"ref":"bound","name":"votedChosen"}');
  });
});
