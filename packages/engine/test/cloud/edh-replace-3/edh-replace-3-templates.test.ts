/**
 * edh-replace-3 (Commander lane edh-replace): the template data of parser/templates/zz-cloud/edh-replace-3.json and the parser, lowering and renderer changes of the
 * round. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses
 * to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2); G3: a critical word a
 * pattern spells out is consumed. Examples are synthetic wordings (design 6.10), checked against the local index when it is present, where each template is also read
 * on the real cards that print its sentence. The behavior is in edh-replace-3-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhr3 from '../../../src/parser/templates/zz-cloud/edh-replace-3.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const ER3 = edhr3 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a spell on a sorcery (with {X} in its cost when it reads X), anything else on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  const xCost = /\bX\b/.test(text.replace(/, where X is [^.]*/g, '')) && !text.includes('{X}') ? { mana_cost: '{X}' } : {};
  if (t.kind !== 'static' && !text.includes(':') && !/^(When|Whenever|At)\b/.test(text)) return card('Example Volley', 'Sorcery', text, xCost);
  return card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('edh-replace-3 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-replace-3.json, path order: after edh-replace-1, before edh-zones-1) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-replace-3.json');
    expect(files.indexOf('zz-cloud/edh-replace-3.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-replace-1.json'));
    expect(files.indexOf('zz-cloud/edh-replace-3.json')).toBeLessThan(files.indexOf('zz-cloud/edh-zones-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are <kind>.edhr3.*', () => {
    for (const t of ER3) {
      expect(t.id, t.id).toMatch(/^(eff|sta|trg|rep)\.edhr3\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of ER3) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'twice', 'double', 'prevent']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-replace-3 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of ER3) {
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

describe('edh-replace-3 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of ER3) {
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

describe('edh-replace-3 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of ER3) {
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

/**
 * The real cards that print each template's sentence and read it with the template (taken from the whole-index snapshot with `npm run cards`): FULL ones are fully
 * automated; the others have a sentence another slice owns (backlog/r4-owners.md) and are checked for this template's line only.
 */
const REAL: Readonly<Record<string, { full: readonly string[]; partial?: readonly string[] }>> = {
  'rep.edhr3.enters.choose.player': { full: ['Stuffy Doll'] },
  'eff.edhr3.damage.itself': { full: ['Stuffy Doll'] },
  'eff.edhr3.damage.eachOtherOpponent.ifCond': { full: ['Vincent, Vengeful Atoner'] },
  'rep.edhr3.enters.notCast.exile': { full: ['Containment Priest'] },
  'rep.edhr3.prevent.toSelf.whenPrevented.damageAnyOther': { full: ['Phyrexian Vindicator'] },
  'rep.edhr3.prevent.toFilter.counterPerPrevented': { full: [], partial: ['Vigor'] }, // Vigor's graveyard trigger is edh-zones-3's: full once both rounds are combined
};

describe.skipIf(index === null)('edh-replace-3 design 6.10 (local index): synthetic examples, real cards', () => {
  it('no edh-replace-3 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    // a pattern with no hole is the rule's own words: its sentence alone is the one line an example can't avoid ("Combat damage can't be prevented."); a lone
    // keyword line ("Reach") is no card's text either
    const norm = (x: string): string => x.toLowerCase().replace(/\s+/g, ' ').replace(/ ([',.])/g, '$1').replace(/\.$/, '').trim();
    const own = (t: Template, l: string): boolean => /^[A-Z][a-z]+$/.test(l.trim()) || (!t.pattern.includes('{') && norm(l) === norm(t.pattern));
    const verbatim = ER3.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()) && !own(t, l))).map((x) => `${t.id}: ${x}`));
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
  it('every template of the file has its real cards listed (or is read by none yet, listed here with the reason)', () => {
    const none: Readonly<Record<string, string>> = {
    };
    for (const t of ER3) expect(REAL[t.id] !== undefined || none[t.id] !== undefined, t.id).toBe(true);
  });
});


// ---- the parser, lowering and renderer changes of the round (each with its negative cases) -----------------------------------------------------------------------------

const creatureText = (text: string, extra: Partial<OracleCard> = {}): OracleCard => card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3', ...extra });
const isFull = (c: OracleCard): boolean => compileCard(c).automation.level === 'full';

describe('edh-replace-3: the damagePrevented trigger event (triggers/normalize.ts, triggers/match.ts, parser/holes/event.ts, render/evt.ts; CR 615.13)', () => {
  const put = 'put that many +1/+1 counters on this creature.';
  it('"Whenever damage that would be dealt to you is prevented, ..." is read; the event is a capability and its roles are the damage\'s', () => {
    expect(isFull(creatureText(`Whenever damage that would be dealt to you is prevented, ${put}`))).toBe(true);
    expect(ENGINE_CAPABILITIES.has('ev:damagePrevented')).toBe(true);
    expect(isFull(creatureText('Whenever damage that would be dealt to you is prevented, you gain that much life.'))).toBe(true);
  });
  it('other recipients, a source, "dealt" damage and "one or more" are not read (they stay manual, never a different event)', () => {
    expect(isFull(creatureText(`Whenever damage that would be dealt to an opponent is prevented, ${put}`))).toBe(false);
    expect(isFull(creatureText(`Whenever damage that would be dealt to a creature you control is prevented, ${put}`))).toBe(false);
    expect(isFull(creatureText(`Whenever damage that would be dealt to you by a red source is prevented, ${put}`))).toBe(false);
    // (edh-next-91 reads "Whenever damage is dealt to you" as the damage event "you are dealt damage", a different event from this one, so it is no longer manual; it is not the prevented-damage event)
    expect(JSON.stringify(parseCard(creatureText(`Whenever damage is dealt to you, ${put}`), OPTS).faces[0]!.abilities)).not.toContain('damagePrevented');
    expect(isFull(creatureText(`Whenever one or more instances of damage that would be dealt to you are prevented, ${put}`))).toBe(false);
  });
  it('"that many" counts the damage prevented: the lint accepts the amount of this event, and a trigger without an amount event still refuses it', () => {
    const f = parseCard(creatureText(`Whenever damage that would be dealt to you is prevented, ${put}`), OPTS).faces[0]!;
    expect(JSON.stringify(f.abilities)).toContain('"q":"eventAmount"');
    expect(automated(f.abilities)).toBe(true);
    expect(isFull(creatureText('Whenever this creature attacks, put that many +1/+1 counters on this creature.'))).toBe(false);
  });
});

describe('edh-replace-3: "the chosen player" of "As ~ enters, choose a player" (parser/holes/player.ts, render/refs.ts#isPlayerRef; CR 607.2d, 614.12a)', () => {
  const enters = 'As this creature enters, choose a player.';
  it('is read with exactly one "choose a player" or "choose an opponent" on the face; with none, or two, the reader stays manual', () => {
    expect(isFull(creatureText(`${enters}\nWhenever this creature is dealt damage, it deals that much damage to the chosen player.`))).toBe(true);
    expect(isFull(creatureText('As this creature enters, choose an opponent.\nWhenever this creature is dealt damage, it deals that much damage to the chosen player.'))).toBe(true);
    expect(isFull(creatureText('Whenever this creature is dealt damage, it deals that much damage to the chosen player.'))).toBe(false);
    expect(isFull(creatureText(`${enters}\nAs this creature enters, choose an opponent.\nWhenever this creature is dealt damage, it deals that much damage to the chosen player.`))).toBe(false);
  });
  it('a chosen player is not a chosen creature or a chosen color: "the chosen creature" and "choose two players" are not read', () => {
    expect(isFull(creatureText(`${enters}\nWhenever this creature is dealt damage, it deals that much damage to the chosen creature.`))).toBe(false);
    expect(isFull(creatureText('As this creature enters, choose two players.\nWhenever this creature is dealt damage, it deals that much damage to the chosen player.'))).toBe(false);
  });
});

describe('edh-replace-3: "~ deals 1 damage to itself" (render/steps-life.ts; the template names the number, so no hole competes with the riders that restate a damage step)', () => {
  it('is said with "itself"; another amount, another recipient and a sentence the riders read ("twice that much damage to itself instead") are not this template\'s', () => {
    expect(isFull(creatureText('{T}: This creature deals 1 damage to itself.'))).toBe(true);
    expect(isFull(creatureText('{T}: This creature deals 1 damage to itself.\nIndestructible'))).toBe(true);
    // (edh-c-11: another amount is its weak template eff.edhv11.damage.toItself, so the sentence is full, not by this template)
    expect(isFull(creatureText('{T}: This creature deals 2 damage to itself.'))).toBe(true);
    expect(isFull(creatureText('{T}: This creature deals 1 damage to himself.'))).toBe(false);
    // (edh-c-11: another source is its template too, eff.edhv11.damage.toItself: the target deals the damage to itself)
    expect(isFull(creatureText('{T}: Another target creature deals 1 damage to itself.'))).toBe(true);
  });
  it('Cut Propulsion (rid.r3repl.instead.damageItself.twice) is still read in full next to it', () => {
    const cut = (index ?? []).find((c) => c.name === 'Cut Propulsion');
    if (cut === undefined) return;
    expect(compileCard(cut).automation.level).toBe('full');
  });
});

describe('edh-replace-3: "... one or more creatures you control deal combat damage to one or more players" is one trigger for the whole batch (parser/holes/event.ts, render/evt.ts; CR 603.2c)', () => {
  const t = (what: string): OracleCard => creatureText(`Whenever one or more creatures you control deal ${what}, proliferate.`);
  it('"to one or more players" is read for the creatures of a batch, combat or not, and never for a single creature, an opponent only or a player or planeswalker', () => {
    expect(isFull(t('combat damage to one or more players'))).toBe(true);
    expect(isFull(t('damage to one or more players'))).toBe(true);
    expect(isFull(creatureText('Whenever this creature deals combat damage to one or more players, proliferate.'))).toBe(false);
    expect(isFull(t('combat damage to one or more opponents'))).toBe(false);
    expect(isFull(t('combat damage to one or more players or planeswalkers'))).toBe(false);
  });
  it('the older reading is unchanged: "to a player" is one trigger for each player dealt damage (no wholeBatch flag)', () => {
    const f = parseCard(t('combat damage to a player'), OPTS).faces[0]!;
    expect(JSON.stringify(f.abilities)).not.toContain('wholeBatch');
    const g = parseCard(t('combat damage to one or more players'), OPTS).faces[0]!;
    expect(JSON.stringify(g.abilities)).toContain('wholeBatch');
  });
});

describe('edh-replace-3: "... damage to each other opponent if <condition>" (the guard of the damage step)', () => {
  it('a condition after the recipient is the step\'s guard; "unless" and another recipient are not read', () => {
    expect(isFull(creatureText("Whenever this creature deals combat damage to an opponent, it deals that much damage to each other opponent if this creature's power is 7 or greater."))).toBe(true);
    expect(isFull(creatureText("Whenever this creature deals combat damage to an opponent, it deals that much damage to each other opponent unless this creature's power is 7 or greater."))).toBe(false);
    expect(isFull(creatureText("Whenever this creature deals combat damage to an opponent, it deals that much damage to each opponent if this creature's power is 7 or greater."))).toBe(false);
  });
});

describe('edh-replace-3: a condition of a replacement about the object that would move reads it as the event\'s subject (effects/replacements.ts#holdsFor; CR 614.1a, 601.2a)', () => {
  it('"If a nontoken creature would enter and it wasn\'t cast, exile it instead." is read; "was cast", another destination and a missing condition are not', () => {
    expect(isFull(creatureText("If a nontoken creature would enter and it wasn't cast, exile it instead."))).toBe(true);
    expect(isFull(creatureText('If a nontoken creature would enter and it was cast, exile it instead.'))).toBe(false);
    expect(isFull(creatureText("If a nontoken creature would enter and it wasn't cast, put it into its owner's hand instead."))).toBe(false);
  });
});

describe('edh-replace-3: "prevent that damage. When damage is prevented this way, ~ deals that much damage to any other target." (render/stat.ts#whenPreventedThen; CR 603.12, 615.5)', () => {
  const pre = 'If damage would be dealt to this creature, prevent that damage.';
  it('the reflexive trigger of a named prevention keeps its own target; "If" instead of "When", a fixed amount, or another recipient of the prevention are not read', () => {
    expect(isFull(creatureText(`${pre} When damage is prevented this way, this creature deals that much damage to any other target.`))).toBe(true);
    expect(isFull(creatureText(`${pre} If damage is prevented this way, this creature deals that much damage to any other target.`))).toBe(false);
    expect(isFull(creatureText(`${pre} When damage is prevented this way, this creature deals 2 damage to any other target.`))).toBe(false);
    expect(isFull(creatureText('If damage would be dealt to you, prevent that damage. When damage is prevented this way, this creature deals that much damage to any other target.'))).toBe(false);
  });
});

describe('edh-replace-3: "Put a +1/+1 counter on that creature for each 1 damage prevented this way." (render/stat.ts#counterPerPrevented; CR 615.5, 122.1)', () => {
  const pre = 'If damage would be dealt to another creature you control, prevent that damage.';
  it('follows the prevention of damage to a described creature; other counters and other counts are not read', () => {
    expect(isFull(creatureText(`${pre} Put a +1/+1 counter on that creature for each 1 damage prevented this way.`))).toBe(true);
    expect(isFull(creatureText(`${pre} Put a +1/+1 counter on that creature for each 2 damage prevented this way.`))).toBe(false);
    expect(isFull(creatureText(`${pre} Put a +1/+1 counter on this creature for each 1 damage prevented this way.`))).toBe(false);
    expect(isFull(creatureText(`${pre} Put two +1/+1 counters on that creature for each 1 damage prevented this way.`))).toBe(false);
  });
});
