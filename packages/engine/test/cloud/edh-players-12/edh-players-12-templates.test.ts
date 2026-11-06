/**
 * edh-players-12 (Commander lane edh-players): the template data of parser/templates/zz-cloud/edh-players-12.json and the parser, lowering, renderer and engine changes of the
 * round. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses
 * to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2); G3: a critical word a
 * pattern spells out is consumed. Examples are synthetic wordings (design 6.10), checked against the local index when it is present, where each template is also read
 * on the real cards that print its sentence. The behavior is in edh-players-12-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhp12 from '../../../src/parser/templates/zz-cloud/edh-players-12.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const EP12 = edhp12 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a spell on a sorcery (with {X} in its cost when it reads X), anything else on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  const xCost = /\bX\b/.test(text.replace(/, where X is [^.]*/g, '')) && !text.includes('{X}') ? { mana_cost: '{X}' } : {};
  // a ~ that "is still a land" is a land (the rider's type word is the object's own)
  if (/\bstill a land\b/.test(text) && text.includes('~')) return card('Example Nexus', 'Land', text);
  if (t.kind !== 'static' && !text.includes(':') && !/^(When|Whenever|At)\b/.test(text)) return card('Example Volley', 'Sorcery', text, xCost);
  return card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('edh-players-12 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-players-12.json, path order: after edh-players-10, before edh-players-2) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-players-12.json');
    expect(files.indexOf('zz-cloud/edh-players-12.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-players-10.json'));
    expect(files.indexOf('zz-cloud/edh-players-12.json')).toBeLessThan(files.indexOf('zz-cloud/edh-players-2.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are <kind>.edhp12.*', () => {
    for (const t of EP12) {
      expect(t.id, t.id).toMatch(/^(eff|sta|trg)\.edhp12\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of EP12) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'twice', 'double', 'prevent']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-players-12 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of EP12) {
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

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} at random.`, `${body} if able.`];
  const swaps: [RegExp, string][] = [
    [/\binstead\b/, 'also'], [/\btwice\b/, 'three times'], [/\bdouble\b/, 'triple'], [/\bplus\b/, 'minus'], [/\byou control\b/, 'an opponent controls'],
    [/\bexile it\b/, 'destroy it'], [/\byour graveyard\b/, 'your hand'], [/\bwould\b/, 'could'], [/\bone or more\b/, 'exactly one'], [/\bcreature spell\b/, 'artifact spell'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-players-12 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of EP12) {
    it(`${t.id}: an appended "unless/at random/if able" or a swapped key word never gives the example's JSON`, () => {
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

describe('edh-players-12 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of EP12) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || w === '~,' || w === "~'s" || /^"?\{/.test(w) || w.includes('\n')) return;
          // a counter's kind is an open class (design 6.11: the word before "counter(s)" is any word, weak when it is not in the lexicon): not a G2 word here
          if (/^counters?[.,]?$/.test(words[i + 1] ?? '')) return;
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const start = w.startsWith('"') ? '"' : '';
          const mutated = [...words.slice(0, i), `${start}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

/** The real cards that print each template's sentence and read it with the template (taken from the whole-index snapshot with `npm run cards`). */
const REAL: Readonly<Record<string, { full: readonly string[]; partial?: readonly string[] }>> = {
  'eff.edhp12.if.player.alsoDiscard': { full: ["Liliana's Triumph"] },
};

describe.skipIf(index === null)('edh-players-12 design 6.10 (local index): synthetic examples, real cards', () => {
  it('no edh-players-12 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card|Vehicle|Saga)\b/gi, '~').trim());
        }
      }
    }
    // a pattern with no hole is the rule's own words: its sentence alone is the one line an example can't avoid ("Players can't lose life this turn and ..."); a lone keyword line is no card's text either
    const norm = (x: string): string => x.toLowerCase().replace(/\s+/g, ' ').replace(/ ([',.])/g, '$1').replace(/\.$/, '').trim();
    const own = (t: Template, l: string): boolean => /^[A-Z][a-z]+$/.test(l.trim()) || (!t.pattern.includes('{') && norm(l) === norm(t.pattern));
    const verbatim = EP12.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()) && !own(t, l))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);

  for (const [id, { full, partial }] of Object.entries(REAL)) {
    it(`${id}: ${[...full, ...(partial ?? [])].join(', ')} read the line with it and pass the render gate${full.length > 0 ? ' (and the first are fully automated)' : ''}`, () => {
      for (const name of [...full, ...(partial ?? [])]) {
        const oracle = (index ?? []).find((c) => c.name === name);
        expect(oracle, name).toBeDefined();
        const parsed = parseCard(oracle!, OPTS);
        expect(parsed.faces.flatMap((f) => f.templatesUsed), name).toContain(id);
        if (full.includes(name)) {
          expect(compileCard(oracle!).automation.level, name).toBe('full');
          expect(parsed.faces.every((f) => f.gate.every((g) => g.ok)), name).toBe(true);
        }
      }
    }, 60_000);
  }
  it('every template of the file has its real cards listed', () => {
    for (const t of EP12) expect(REAL[t.id] !== undefined, t.id).toBe(true);
  });
});



// ---- the parser, lowering, renderer and engine changes of the round (each with its negative cases) ------------------------------------------------------------------------

const spell = (text: string, extra: Record<string, unknown> = {}): OracleCard => card('Example Volley', 'Sorcery', text, extra);
const creatureText = (text: string, extra: Record<string, unknown> = {}): OracleCard => card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3', ...extra });
const enchantment = (text: string): OracleCard => card('Example Aegis', 'Enchantment', text);
const isFull = (c: OracleCard): boolean => compileCard(c).automation.level === 'full';

describe('edh-players-12: a player pronoun in the amount of a step of a group is each of those players (parser/lower/anaphora.ts#groupChooser; CR 608.2e, 101.4, 107.1a)', () => {
  it('reads "creatures attacking them", "cards in their hand", "creatures they control" and "cards that player has drawn this turn" for lose life, damage and draw of each opponent / each player', () => {
    expect(isFull(enchantment('Whenever you attack, each opponent loses life equal to the number of creatures attacking them.'))).toBe(true);
    expect(isFull(creatureText('At the beginning of your upkeep, each opponent loses life equal to the number of creatures that player controls.'))).toBe(true);
    expect(isFull(creatureText('At the beginning of your upkeep, each opponent loses life equal to the number of cards in their hand.'))).toBe(true);
    expect(isFull(creatureText('At the beginning of your upkeep, each player gains life equal to the number of creatures they control.'))).toBe(true);
    expect(isFull(spell('Metalcraft — If you control three or more artifacts, ~ deals damage to each opponent equal to the number of cards that player has drawn this turn.'))).toBe(true);
    expect(isFull(creatureText('At the beginning of your upkeep, each opponent draws cards equal to the number of creatures they control.'))).toBe(true);
  });
  it('the amount is JSON-read with the iterating player (not a fixed or event player)', () => {
    const f = compileCard(enchantment('Whenever you attack, each opponent loses life equal to the number of creatures attacking them.')).faces[0]!;
    const text = JSON.stringify(f.abilities);
    expect(text).toContain('"defender":{"ref":"iterating"}');
    expect(text).not.toContain('"op":"manual"');
  });
  it('negative: with another player the pronoun could mean (a target, the player of the trigger) it stays ambiguous; "you", other groups and singular steps are not read this way', () => {
    // a target player is also "that player" / "their"
    expect(isFull(spell('Target player draws a card. Each opponent loses life equal to the number of cards in that player\'s hand.'))).toBe(false);
    expect(isFull(spell('Target opponent draws a card. Each opponent loses life equal to the number of creatures that player controls.'))).toBe(false);
    // "that player" names the player of the trigger's event too ("Whenever you attack": the defending player): more than one candidate
    expect(isFull(enchantment('Whenever you attack, each opponent loses life equal to the number of creatures that are attacking that player.'))).toBe(false);
    expect(isFull(creatureText('Whenever an opponent casts a spell, each opponent loses life equal to the number of cards that player has drawn this turn.'))).toBe(false);
    // not a group of players: "each creature" and "each opponent who ..." are other texts
    expect(isFull(creatureText('At the beginning of your upkeep, each creature loses life equal to the number of cards in their hand.'))).toBe(false);
  });
});

describe('edh-players-12: "damage to each opponent equal to ..." is read for each player (effects/handlers/lifedamage.ts, model/lint-nodes.ts, model/cap-walk.ts; CR 120.2b, 608.2e)', () => {
  it('advertises the form it needs', () => {
    expect(ENGINE_CAPABILITIES.has('op:damage.perPlayerAmount')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('op:loseLife.perPlayerAmount')).toBe(true);
  });
  it('a divided or excess version of it is not read (the handler asks instead)', () => {
    expect(isFull(spell('Example Volley deals damage to each opponent equal to the number of cards that player has drawn this turn. Divide that damage as you choose among them.'))).toBe(false);
  });
});

describe('edh-players-12: "each of that player\'s opponents" (parser/holes/player.ts, render/refs.ts; CR 102.3, 608.2d)', () => {
  const T = "Whenever a player casts a noncreature spell, each of that player's opponents may draw a card.";
  it('is read, said back, and lowered to the `may` of the other players with the draw of the one who chose', () => {
    expect(isFull(creatureText(T))).toBe(true);
    expect(isFull(creatureText('Whenever a player casts a noncreature spell, each opponent may draw a card.'))).toBe(true);
    expect(isFull(creatureText('Whenever a player casts a noncreature spell, each player may draw a card.'))).toBe(true);
    const text = JSON.stringify(compileCard(creatureText(T)).faces[0]!.abilities);
    expect(text).toContain('"ref":"otherOf"');
    expect(text).toContain('"who":{"ref":"iterating"}');
  });
  it('another noun, another player word, a plural "players" and a singular verb are other texts', () => {
    expect(isFull(creatureText(T.replace("opponents", 'allies')))).toBe(false);
    expect(isFull(creatureText(T.replace("that player's", "target player's")))).toBe(false);
    expect(isFull(creatureText(T.replace('may draw a card', 'may draws a card')))).toBe(false);
    expect(isFull(creatureText(T.replace('that player\'s', 'those players\'')))).toBe(false);
  });
});

describe('edh-players-12: "each other creature that\'s attacking one of your opponents" on an attack trigger of a described attacker (parser/lower/targets.ts#otherNotSource; CR 508.1, 109.2)', () => {
  it('is other than the attacking creature of the event', () => {
    expect(isFull(enchantment("Whenever a creature you control attacks, each other creature that's attacking one of your opponents gets +1/+1 until end of turn."))).toBe(true);
    expect(isFull(enchantment("Whenever a creature you control attacks, each other attacking creature gets +1/+1 until end of turn."))).toBe(true);
  });
  it('negative: a creature itself, or a batch event, keeps its other meaning (manual or other-than-self)', () => {
    expect(isFull(enchantment("Whenever one or more creatures you control attack, each other creature that's attacking one of your opponents gets +1/+1 until end of turn."))).toBe(false);
    // (a creature that could itself be the other creature keeps "other than this object")
    const own = JSON.stringify(compileCard(creatureText("Whenever ~ attacks, each other creature that's attacking one of your opponents gets +1/+1 until end of turn.")).faces[0]!.abilities);
    expect(own).toContain('"other":true');
    expect(own).not.toContain('"role":"subject"');
  });
});

describe('edh-players-12: "an artifact is put into an opponent\'s graveyard from the battlefield" (render/evt.ts; CR 404.1, 700.4)', () => {
  const T = "Whenever an artifact is put into an opponent's graveyard from the battlefield, you may draw a card.";
  it('is read and said back, for you and for an opponent', () => {
    expect(isFull(enchantment(T))).toBe(true);
    expect(isFull(enchantment(T.replace("an opponent's", 'your')))).toBe(true);
  });
  it("another graveyard word, the hand and a controller are other texts", () => {
    // edh-c-63 (Liability): "a player's graveyard" is now read (the permanent's owner, any player): that text is full; another graveyard word is still not
    expect(isFull(enchantment(T.replace("an opponent's graveyard", "a player's graveyard")))).toBe(true);
    expect(isFull(enchantment(T.replace("an opponent's graveyard", "each player's graveyard")))).toBe(false);
    expect(isFull(enchantment(T.replace('graveyard', 'hand')))).toBe(false);
  });
});
