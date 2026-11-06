/**
 * edh-players-15 (Commander lane edh-players): the template data of parser/templates/zz-cloud/edh-players-15.json and the parser, lowering, renderer and engine changes of the
 * round. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses
 * to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2); G3: a critical word a
 * pattern spells out is consumed. Examples are synthetic wordings (design 6.10), checked against the local index when it is present, where each template is also read
 * on the real cards that print its sentence. The behavior is in edh-players-15-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhp15 from '../../../src/parser/templates/zz-cloud/edh-players-15.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const EP15 = edhp15 as Template[];
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

describe('edh-players-15 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-players-15.json, path order: after edh-players-13, before edh-players-2) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-players-15.json');
    expect(files.indexOf('zz-cloud/edh-players-15.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-players-13.json'));
    expect(files.indexOf('zz-cloud/edh-players-15.json')).toBeLessThan(files.indexOf('zz-cloud/edh-players-2.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are <kind>.edhp15.*', () => {
    for (const t of EP15) {
      expect(t.id, t.id).toMatch(/^(eff|sta|trg|rid)\.edhp15./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of EP15) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'twice', 'double', 'prevent']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-players-15 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of EP15) {
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

describe('edh-players-15 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of EP15) {
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

describe('edh-players-15 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of EP15) {
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
  'rid.edhp15.castThisWay.spendAnyColor': { full: ['Brainstealer Dragon'] },
  'eff.edhp15.selfAndObj.pumpgrant.mustAttack': { full: ['Gogo, Mysterious Mime'] },
  'eff.edhp15.grant.protectionFromColorsOf': { full: ['Éowyn, Fearless Knight'] },
  'eff.edhp15.sacrifice.andLoseLife': { full: ['Will of the Abzan'] },
};

describe.skipIf(index === null)('edh-players-15 design 6.10 (local index): synthetic examples, real cards', () => {
  it('no edh-players-15 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const norm = (x: string): string => x.toLowerCase().replace(/\s+/g, ' ').replace(/ ([',.])/g, '$1').replace(/\.$/, '').trim();
    const own = (t: Template, l: string): boolean => /^[A-Z][a-z]+$/.test(l.trim()) || (!t.pattern.includes('{') && norm(l) === norm(t.pattern));
    const verbatim = EP15.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()) && !own(t, l))).map((x) => `${t.id}: ${x}`));
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
    for (const t of EP15) expect(REAL[t.id] !== undefined, t.id).toBe(true);
  });
});

// ---- the parser, lowering, renderer and engine changes of the round (each with its negative cases) ------------------------------------------------------------------------

const spell = (text: string, extra: Record<string, unknown> = {}): OracleCard => card('Example Volley', 'Sorcery', text, extra);
const artifactText = (text: string, extra: Record<string, unknown> = {}): OracleCard => card('Example Ring', 'Artifact', text, extra);
const creatureText = (text: string, extra: Record<string, unknown> = {}): OracleCard => card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3', ...extra });
const isFull = (c: OracleCard): boolean => compileCard(c).automation.level === 'full';

describe('edh-players-15: "an opponent who controls <a description> draws a card / gains life / loses life during their turn" (parser/holes/event.ts, triggers/filters.ts, triggers/match.ts, render/evt.ts; CR 603.2, 102.2, 109.4, 500.1)', () => {
  const T = 'Whenever an opponent who controls an artifact named Example Ring draws a card during their turn, you draw a card.';
  it('is read and said back for a draw, a life gain and a life loss, and for any plain description of the permanent', () => {
    expect(isFull(artifactText(T))).toBe(true);
    expect(isFull(artifactText(T.replace('draws a card', 'gains life').replace('you draw a card', 'you gain that much life')))).toBe(true);
    expect(isFull(artifactText(T.replace('draws a card', 'loses life').replace('you draw a card', 'you gain that much life')))).toBe(true);
    expect(isFull(artifactText(T.replace('an artifact named Example Ring', 'a Goblin')))).toBe(true);
    expect(isFull(artifactText(T.replace('draws a card during their turn', 'draws a card')))).toBe(true); // the same actor, in any turn
  });
  it('the actor is in the data (controlsAny with opponents) and the turn is the existing trigger condition (turnOf the event\'s player; trg.stdcombat1.when.duringTheirTurn)', () => {
    const json = JSON.stringify(compileCard(artifactText(T)).faces[0]!.abilities);
    expect(json).toContain('"ref":"controlsAny"');
    expect(json).toContain('"opponents":true');
    expect(json).toContain('"cond":"turnOf"');
    expect(JSON.stringify(compileCard(artifactText(T.replace(' during their turn', ''))).faces[0]!.abilities)).not.toContain('turnOf');
  });
  it('you, a player, or "during your turn" are other texts (fail closed); so is an open description with a controller of its own', () => {
    expect(isFull(artifactText(T.replace('an opponent who controls', 'a player who controls')))).toBe(false);
    // "during your turn" is the turn of the ability's controller (a condition of its own): another reading, never the actor's turn
    expect(JSON.stringify(compileCard(artifactText(T.replace('during their turn', 'during your turn'))).faces[0]!.abilities)).not.toBe(JSON.stringify(compileCard(artifactText(T)).faces[0]!.abilities));
    expect(isFull(artifactText(T.replace('an artifact named Example Ring', 'an artifact you control')))).toBe(false);
    expect(isFull(artifactText(T.replace('an opponent who controls an artifact named Example Ring draws', 'you draw')))).toBe(false);
    expect(isFull(artifactText(T.replace('an artifact named Example Ring', 'a card')))).toBe(false);
  });
});

describe('edh-players-15: "enters under your control" of a permanent an opponent owns, and "they" is its owner (parser/lower/scope.ts, render/evt.ts; CR 108.3, 110.2, 603.6a)', () => {
  const T = 'Whenever a nonland permanent an opponent owns enters the battlefield under your control, they lose life equal to its mana value.';
  it('is read and said back', () => expect(isFull(creatureText(T))).toBe(true));
  it('the loser is the permanent\'s owner (ownerOf the entering permanent), never the event player', () => {
    const json = JSON.stringify(compileCard(creatureText(T)).faces[0]!.abilities);
    expect(json).toContain('"ref":"ownerOf","object":{"ref":"event","role":"subject"}');
  });
  it('a permanent you own, an opponent\'s under their own control, or "you lose" are other texts', () => {
    expect(isFull(creatureText(T.replace('an opponent owns', 'you own')))).toBe(false);
    expect(isFull(creatureText(T.replace('under your control', 'under an opponent\'s control')))).toBe(false);
    expect(JSON.stringify(compileCard(creatureText(T.replace('they lose', 'you lose'))).faces[0]!.abilities)).not.toContain('"ownerOf"');
  });
});

describe('edh-players-15: "with greater power" is more power than this object\'s own (parser/holes/filter.ts, render/np.ts; CR 208.1)', () => {
  const T = 'When ~ enters, exile target creature an opponent controls with greater power.';
  it('is read and said back, and means the source\'s power', () => {
    expect(isFull(creatureText(T))).toBe(true);
    expect(JSON.stringify(compileCard(creatureText(T)).faces[0]!.abilities)).toContain('"power":{"op":">","value":{"q":"stat","stat":"power","of":{"ref":"self"}}}');
  });
  it('only in a triggered ability of a creature: an Equipment\'s equipped creature, a spell and an activated ability name no creature to compare with (fail closed)', () => {
    expect(isFull(card('Example Blade', 'Artifact — Equipment', 'Equipped creature can\'t be blocked by creatures with greater power.'))).toBe(false);
    expect(isFull(spell('Destroy target creature with greater power.'))).toBe(false);
    expect(isFull(spell('Target creature you control fights target creature with greater power.'))).toBe(false);
    expect(isFull(creatureText('{T}: Destroy target creature with greater power.'))).toBe(false);
  });
  it('"than" after it, a power or toughness, or "lesser" are other texts', () => {
    expect(isFull(creatureText(T.replace('greater power.', 'greater power than ~.')))).toBe(true); // the longer reading, as before
    expect(isFull(creatureText(T.replace('greater power', 'greater toughness')))).toBe(false);
    expect(isFull(creatureText(T.replace('greater power', 'lesser power')))).toBe(true); // edh-c-86: "lesser power" is now read too (the event's subject, as "lesser mana value"; right for this object's own trigger, the negative is outdated)
  });
});

describe('edh-players-15: a group of target players that does an instruction "each" is also "that player" in it (parser/lower/mentions.ts, anaphora.ts, targets.ts#sacrificeOfEachTarget, effects/handlers/zones-remove.ts#asChooser; CR 608.2c, 101.4, 701.21a)', () => {
  const T = 'Any number of target opponents each sacrifice a creature with the greatest power among creatures that player controls and lose 3 life.';
  it('is read and said back: one sacrifice step by all the target players (each reads its own board, iterating), then their life loss', () => {
    expect(isFull(spell(T))).toBe(true);
    const json = JSON.stringify(compileCard(spell(T)).faces[0]!.abilities);
    expect(json).not.toContain('"op":"forEach"');
    expect(json).toContain('"op":"sacrificeChoice"');
    expect(json).toContain('{"ref":"iterating"}');
    expect(json).toContain('"op":"loseLife"');
  });
  it('one target player, a loss before the sacrifice, or another player\'s board are other readings or texts', () => {
    expect(isFull(spell(T.replace('Any number of target opponents each sacrifice', 'Target opponent sacrifices').replace('lose 3 life', 'loses 3 life')))).toBe(true);
    // "creatures you control" is the other reading of the filter (your board, not theirs): the same words, other data
    expect(JSON.stringify(compileCard(spell(T.replace('creatures that player controls', 'creatures you control'))).faces[0]!.abilities)).not.toBe(JSON.stringify(compileCard(spell(T)).faces[0]!.abilities));
    expect(isFull(spell(T.replace('lose 3 life', 'gain 3 life')))).toBe(true); // the same players, another plain instruction after the sacrifice
    expect(compileCard(spell(T.replace('creatures that player controls', 'creatures target player controls'))).faces[0]!.abilities[0]).toHaveProperty('effect.targets.1.id', 't1'); // "target player" is a second target, never the iterating player
    expect(isFull(spell(T.replace('Any number of target opponents each sacrifice', 'Any number of target opponents each exile').replace('lose 3 life', 'lose 3 life')))).toBe(false); // only a sacrifice reads each player\'s own board this way
  });
});

describe('edh-players-15: "protection from each of that creature\'s colors" is one protection for each color the object has (types Modification.protectionFromColorsOf, effects/handlers/lasting.ts#expandVariants, render/mods.ts; CR 702.16a, 105.1)', () => {
  const T = 'Exile target creature. Elves you control gain protection from each of that creature\'s colors until end of turn.';
  it('is read and said back', () => expect(isFull(spell(T))).toBe(true));
  it('hexproof, "the colors of", a missing duration or a group with the protection of one color are other texts', () => {
    expect(isFull(spell(T.replace('protection', 'hexproof')))).toBe(false);
    expect(isFull(spell(T.replace('each of that creature\'s colors', 'that creature\'s colors')))).toBe(false);
    expect(isFull(spell(T.replace(' until end of turn', '')))).toBe(false);
    expect(isFull(spell(T.replace('each of that creature\'s colors', 'red')))).toBe(true); // the plain keyword, read as before
  });
});

describe('edh-players-15: "the engine advertises what the round needs"', () => {
  it('the protection of an object\'s colors is a capability (a resolved effect\'s only)', () => {
    expect(ENGINE_CAPABILITIES.has('feature:mod.protectionFromColorsOf')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('feature:mod.protectionFromColorsOf.static')).toBe(false);
  });
});
