/**
 * std-rx28 (wave 2, Standard lane rx28: trigger filters and linked choices): the template data of parser/templates/zz-cloud/std-rx28.json and the round's parser,
 * lowering and renderer support (the Filter reading "with equal or lesser mana value", the damage events "equal to that creature's toughness" and "to that
 * creature", "a spell that targets one or more creatures" and its group "those creatures", "an ability that targets a creature or player", the references
 * costBeheld and costReturned, land and nonland card-name choices of the face, and the render families equal-or-lesser-mana-value, targets-one-or-more,
 * targeted-group, self-again-enters, targets-or-player). Guard G9 (design 6.8): every example lowers with its template and passes the exact render gate (G6);
 * every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never
 * leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in
 * std-rx28-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, renderAbility } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, faceChoices, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { lintCard } from '../../../src/model/lint-card';
import stdRx28 from '../../../src/parser/templates/zz-cloud/std-rx28.json';
import review from '../../m5/golden/cards/cloud-std-rx28-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const RX = stdRx28 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card).sort();

/** The type line of an example: a sentence that starts with an instruction is a sorcery; "this creature" a creature (with kicker for "was kicked"); else an artifact. */
const typeOf = (text: string): string =>
  (/^Choose/.test(text) ? 'Sorcery' : /this enchantment/.test(text) ? 'Enchantment' : /this Background/.test(text) ? 'Legendary Enchantment — Background'
    : /this Fortification/.test(text) ? 'Artifact — Fortification' : /~|this creature/.test(text) ? 'Creature — Spider' : 'Artifact');
const face = (text: string, typeLine?: string) => {
  const type = typeLine ?? typeOf(text);
  const body = /was kicked/.test(text) ? `Kicker {1}\n${text}` : text;
  return parseCard(card('Example Relic', type, body, type.startsWith('Creature') ? { power: '1', toughness: '1' } : undefined), OPTS).faces[0]!;
};
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');
const EXPERIMENTAL = new Set(['eff.stdrx28.choose.nonlandCardName']);

describe('std-rx28 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-rx28.json, after zz-cloud/std-rx19.json, before zz-cloud/std-rx3.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files.indexOf('zz-cloud/std-rx28.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-rx19.json'));
    expect(files.indexOf('zz-cloud/std-rx28.json')).toBeLessThan(files.indexOf('zz-cloud/std-rx3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(RX.map((t) => t.id)).toEqual([
      'rep.stdrx28.enters.lookHand.choose.cardType.otherThanCreature', 'rep.stdrx28.enters.counters.whereX.ifCond', 'rep.stdrx28.enters.choose.nonlandCardName',
      'eff.stdrx28.choose.landCardName', 'eff.stdrx28.choose.nonlandCardName', 'sta.stdrx28.costMod.chosenName.more',
    ]);
    for (const t of RX) {
      expect(t.id, t.id).toMatch(/^(rep|sta|eff)\.stdrx28\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.since, t.id).toBe(8);
      expect(t.status, t.id).toBe(EXPERIMENTAL.has(t.id) ? 'experimental' : 'stable');
    }
    for (const g of review as Golden) expect(g.expect, g.card).toBe('full');
    // narrow wordings, each printed on one Standard card: stable on that hand-verified golden card plus these tests and the scenarios (a 6.9 deviation named in the
    // round record and the PR)
    expect(goldenUsing('rep.stdrx28.enters.lookHand.choose.cardType.otherThanCreature')).toEqual(['Arachne, Psionic Weaver']);
    expect(goldenUsing('rep.stdrx28.enters.counters.whereX.ifCond')).toEqual(['Scarlet Spider, Ben Reilly']);
    expect(goldenUsing('rep.stdrx28.enters.choose.nonlandCardName')).toEqual(["Skyseer's Chariot"]);
    expect(goldenUsing('sta.stdrx28.costMod.chosenName.more')).toEqual(["Skyseer's Chariot"]);
    expect(goldenUsing('eff.stdrx28.choose.landCardName')).toEqual(['Petrified Hamlet']);
    // no Standard card prints the one-shot "Choose a nonland card name." in this round: experimental, no golden card
    expect(goldenUsing('eff.stdrx28.choose.nonlandCardName')).toEqual([]);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of RX) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'next', 'then', 'when', 'also']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-rx28 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of RX) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = face(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = face(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(understood(f), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)} ${JSON.stringify(f.gate)}`).toBe(true);
        if (!EXPERIMENTAL.has(t.id)) expect(fullyAutomated(f), e.text).toBe(true);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = face(c);
        expect(understood(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/\bother than creature\b/, 'other than land'], [/\ban opponent's hand\b/, "an opponent's library"], [/\bnonland card name\b/, 'creature card name'],
    [/\bland card name\b/, 'creature card name'], [/\bmore to activate\b/, 'less to activate'], [/\bthe chosen name\b/, 'the chosen color'], [/\+1\/\+1 counters\b/, '-1/-1 creatures'],
    [/\bwhere X is\b/, 'where Y is'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-rx28 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of RX) {
    it(`${t.id}: an appended condition, or a swapped key word, never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = face(e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = face(m);
          expect(understood(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('std-rx28 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of RX) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not understood`, () => {
      for (const e of t.examples) {
        const lines = e.text.split('\n');
        const last = lines.length - 1; // the line of the template (an earlier line is the choice it reads)
        const words = lines[last]!.split(' ');
        words.forEach((w, i) => {
          if (words[i + 1]?.startsWith('counter')) return; // a counter kind is an open class (CR 122.1): an invented kind is still a counter kind
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [...lines.slice(0, last), [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ')].join('\n');
          expect(understood(face(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const compiled = (name: string, type: string, text: string, pt?: [string, string]) => compileCard(card(name, type, text, pt ? { power: pt[0], toughness: pt[1] } : undefined));
const triggerOf = (d: ReturnType<typeof compiled>): unknown => (d.faces[0]!.abilities.find((a) => a.kind === 'triggered') as { trigger?: unknown } | undefined)?.trigger;

describe('std-rx28 parser support (fail closed)', () => {
  it('CR 202.3, 601.2i: "with equal or lesser mana value" reads the cast event\'s spell; in a dies trigger (no spell role) the sentence is never automated', () => {
    const cast = compiled('Example Imp', 'Creature — Imp', 'Whenever you cast a spell from your graveyard, you may cast a creature spell with equal or lesser mana value from your hand without paying its mana cost.', ['1', '1']);
    expect(JSON.stringify(cast.faces)).toContain('"manaValue":{"op":"<=","value":{"q":"stat","stat":"manaValue","of":{"ref":"event","role":"spell"}}}');
    const dies = compiled('Example Imp', 'Creature — Imp', 'Whenever another creature you control dies, you may cast a creature spell with equal or lesser mana value from your hand without paying its mana cost.', ['1', '1']);
    expect(dies.automation.level).not.toBe('full');
  });
  it('CR 120.1, 208.1: "equal to that creature\'s toughness" is read only after a creature recipient', () => {
    const t = compiled('Example Archer', 'Creature — Elf Archer', "Whenever a source you control deals noncombat damage to a creature equal to that creature's toughness, you gain 1 life.", ['1', '1']);
    expect(triggerOf(t)).toEqual({ on: [{ ev: 'damage', source: { controller: 'you' }, combat: false, recipient: { object: { types: ['Creature'] } }, amountIsToughness: true }] });
    const p = compiled('Example Archer', 'Creature — Elf Archer', "Whenever a source you control deals noncombat damage to a player equal to that creature's toughness, you gain 1 life.", ['1', '1']);
    expect(p.automation.level).not.toBe('full');
  });
  it('CR 115.9b, 120.1: "deals damage to that creature" needs a subject that targets only a single creature', () => {
    const ok = compiled('Example Smith', 'Creature — Human', 'Whenever an instant spell you control that targets only a single creature deals damage to that creature, you gain 1 life.', ['1', '1']);
    expect(JSON.stringify(triggerOf(ok))).toContain('"toSourceTarget":true');
    const no = compiled('Example Smith', 'Creature — Human', 'Whenever an instant spell you control deals damage to that creature, you gain 1 life.', ['1', '1']);
    expect(no.automation.level).not.toBe('full');
  });
  it('CR 115.9b, 608.2c: "those creatures" after "a spell that targets one or more creatures" is the group the spell targets; after "a spell" it names nothing', () => {
    const ok = compiled('Example Sage', 'Creature — Human', 'Whenever you cast a spell that targets one or more creatures, those creatures get +1/+0 until end of turn.', ['1', '1']);
    expect(JSON.stringify(ok.faces)).toContain('"targetedBy":{"ref":"event","role":"spell"}');
    const no = compiled('Example Sage', 'Creature — Human', 'Whenever you cast a spell, those creatures get +1/+0 until end of turn.', ['1', '1']);
    expect(no.automation.level).not.toBe('full');
  });
  it('CR 602.2: "you activate an ability that targets a creature or player" describes the ability; "you activate an ability" alone is no form here', () => {
    const ok = compiled('Example Sage', 'Creature — Human', 'Whenever you activate an ability that targets a creature or player, you gain 1 life.', ['1', '1']);
    expect(JSON.stringify(triggerOf(ok))).toContain('"activated":{"anyOf":[{"targets":{"ref":"each","filter":{"types":["Creature"]}}},{"targets":{"ref":"each","who":"player"}}]}');
    expect(compiled('Example Sage', 'Creature — Human', 'Whenever you activate an ability, you gain 1 life.', ['1', '1']).automation.level).not.toBe('full');
  });
  it('CR 701.4a, 702.188a (model/lint-card.ts): "the creature you chose or the card you revealed" and "the returned creature" need the cost that makes them', () => {
    expect(compiled('Example Bolt', 'Sorcery', 'Example Bolt deals damage equal to the power of the creature you chose or the card you revealed to target creature.').automation.level).not.toBe('full');
    expect(compiled('Example Spider', 'Creature — Spider', 'If Example Spider was kicked, Example Spider enters with X +1/+1 counters on it, where X is the mana value of the returned creature.', ['1', '1']).automation.level).not.toBe('full');
    expect(lintCard([{ abilities: [{ kind: 'spell', text: '', effect: { targets: [], steps: [{ op: 'gainLife', who: { ref: 'you' }, amount: { q: 'stat', stat: 'power', of: { ref: 'costBeheld' } } }] } }] }] as never).map((i) => i.message).join(' ')).toMatch(/beholds/);
  });
  it('CR 607.2d (parser/parse.ts#faceChoices): a nonland name chosen as it enters and a land name chosen when it enters are "the chosen name" of the face', () => {
    const seg = (text: string) => ({ text }) as never;
    const reader = seg('Activated abilities of sources with the chosen name cost {2} more to activate.');
    expect(faceChoices(reader, [reader, seg('As ~ enters, choose a nonland card name.')])).toEqual([{ link: 'cardName', what: 'cardName' }]);
    expect(faceChoices(reader, [reader, seg('As ~ enters, choose any nonland card name.')])).toEqual([{ link: 'cardName', what: 'cardName' }]);
    expect(faceChoices(reader, [reader, seg('When ~ enters, choose a land card name.')])).toEqual([{ link: 'cardName', what: 'cardName' }]);
    expect(faceChoices(reader, [reader, seg('When ~ enters, choose a land card name and draw a card.')])).toEqual([]);
    expect(faceChoices(reader, [reader, seg("As ~ enters, look at an opponent's hand, then choose a card type other than creature.")])).toEqual([{ link: 'cardType', what: 'cardType' }]);
  });
});

describe('std-rx28 renderer support', () => {
  const render = (def: object): string => renderAbility(def as never, { selfNames: ['Test Card'], selfTypes: ['Creature'] }).join(' ');
  it('CR 120.1, 208.1: damage equal to the toughness has words only for one creature recipient (fails closed)', () => {
    const trig = (ev: object) => render({ kind: 'triggered', text: '', trigger: { on: [ev] }, effect: { targets: [], steps: [{ op: 'draw', who: { ref: 'you' }, count: 1 }] } });
    expect(trig({ ev: 'damage', source: { controller: 'you' }, recipient: { object: { types: ['Creature'] } }, amountIsToughness: true })).toMatch(/to a creature equal to that creature's toughness/);
    expect(trig({ ev: 'damage', source: { controller: 'you' }, recipient: { player: 'opponent' }, amountIsToughness: true })).toMatch(/cannot render/);
  });
  it('CR 115.9b: the objects a spell targets are never said as a description of their own (fails closed)', () => {
    expect(render({ kind: 'spell', text: '', effect: { targets: [], steps: [{ op: 'destroy', what: { ref: 'each', filter: { types: ['Creature'], targetedBy: { ref: 'event', role: 'spell' } } } }] } })).toMatch(/cannot render/);
  });
  it('CR 201.3: the card-name choices say their kind', () => {
    expect(render({ kind: 'spell', text: '', effect: { targets: [], steps: [{ op: 'chooseValue', who: { ref: 'you' }, what: 'cardName', as: 'n', link: 'cardName', cardKind: 'land' }] } })).toMatch(/choose a land card name/i);
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-rx28 design 6.10 (local index): synthetic examples', () => {
  it('no std-rx28 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|Equipment|spell|card|Saga|Vehicle)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = RX.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
