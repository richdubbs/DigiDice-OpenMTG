/**
 * W3b: the whole committed template set is the default compiler (parser/template-set.ts), with the precedence that keeps what formerly compiled fully
 * (guard G10 on the game path): a gated native reading of a whole line wins over an experimental template, a stable reading wins over an experimental
 * one that automates less, a refused ability's retry keeps the reading that automates most. Plus the R1 acceptance cards that needed the wiring
 * (Counterspell, Mana Leak, Path to Exile) played through `applyAction`, and the closed subtype vocabulary of protection qualities (G2).
 * Synthetic wordings (design 6.10) except where a real card's own text is the subject; those read the local index and are skipped without it.
 */
import { describe, expect, it } from 'vitest';
import { BOOTSTRAP_TEMPLATES, TEMPLATE_FILES, TEMPLATE_SET, compileCard, defaultCompileSources, parseCard, parseKeywordLine, type OracleCard } from '../../../src/index';
import { act, answer, find, passBoth, scenario } from '../../m3/scenario';
import { localIndex } from '../parser/support';
import { abilities, compile, creature } from './helpers';

const index = localIndex();
const real = (name: string): OracleCard | undefined => index?.find((c) => c.name === name);

describe('W3b: the default compiler parses with every committed template', () => {
  it('defaultCompileSources() and the default parse options hold TEMPLATE_SET (every file of parser/templates, path order)', () => {
    expect(defaultCompileSources().parse.templates.map((t) => t.id)).toEqual(TEMPLATE_SET.map((t) => t.id));
    expect(TEMPLATE_SET.length).toBeGreaterThan(BOOTSTRAP_TEMPLATES.length * 10);
    expect(TEMPLATE_FILES.map((f) => f.file)).toEqual([...TEMPLATE_FILES.map((f) => f.file)].sort());
    expect(new Set(TEMPLATE_SET.map((t) => t.id)).size).toBe(TEMPLATE_SET.length);
  });

  it('design 6.9, G10: eff.mana.C3, made stable by the W3b template review, reads "Add {C}{C}{C}" with the meaning of the native reading (CR 106.1, 605.1a), the card full', () => {
    const { def, report } = compile(creature('{T}: Add {C}{C}{C}.'));
    expect(abilities(def)[0]).toMatchObject({ kind: 'activated', isMana: true, cost: { tap: true }, prov: { by: 'template' } });
    expect((abilities(def)[0] as { effect: { steps: unknown[] } }).effect.steps).toEqual([{ op: 'addMana', who: { ref: 'you' }, units: [['C'], ['C'], ['C']] }]);
    expect(def.automation.level).toBe('full');
    expect(report.faces[0]!.nativeLines).toEqual([]);
  });

  it('design 6.9, G10: a line no template reads keeps the gated native reading: "protection from black and from red" is the native reading, the card full', () => {
    // FAST2 T7: "Add {U}{U}{U}", the line this test read before, is the stable template eff.t7.mana.units' now
    const { def, report } = compile(creature('Protection from black and from red'));
    expect(abilities(def)[0]).toMatchObject({ kind: 'keyword', keyword: 'protection', prov: { by: 'native', id: 'keyword:protection' } });
    expect(def.automation.level).toBe('full');
    expect(report.faces[0]!.nativeLines).toEqual([0]);
  });

  it('design 6.4, 6.7 T2: an "it" with two candidates after a search makes the whole spell manual, never a guessed reading', () => {
    // The second sentence's "it" has two candidates (design 6.4): FAST2 T10's search idiom (parser/lower/anaphora.ts#searchIdiom) binds "it" to the card found
    // only right after the search, and the shuffle comes between them here. This test once showed a stable reading winning over this experimental one
    // (design 6.9); FAST5 PROMO1 made the search template se.library.one stable, so the stable parse now meets the ambiguity and T2 taints the whole effect.
    const text = 'Destroy target creature. Search your library for a basic land card, then shuffle and put it onto the battlefield tapped.';
    const f = parseCard({ name: 'Test Sprout', layout: 'normal', type_line: 'Instant', oracle_text: text, mana_cost: '{1}' } as OracleCard, defaultCompileSources().parse).faces[0]!;
    const steps = (f.abilities[0] as { effect: { steps: { op: string }[] } }).effect.steps;
    expect(steps.every((s) => s.op === 'manual')).toBe(true);
    expect(f.diagnostics.some((d) => d.code === 'unbound-reference' && /2 compatible antecedents/.test(d.message))).toBe(true);
  });

  it('CR 614.1c, 614.12, 616.1e: "enters with X +1/+1 counters" read by the stable template (no self-replacement flag, CR 614.15) still puts X counters on it', () => {
    let s = scenario(['Endless One', 'Forest'], { p1: { hand: ['Endless One'], battlefield: ['Forest', 'Forest', 'Forest'] } });
    const def = s.defs['Endless One']!;
    expect(def.faces[0]!.abilities[0]).toMatchObject({ kind: 'static', prov: { by: 'template' } });
    expect(JSON.stringify(def.faces[0]!.abilities[0])).not.toContain('selfReplacement');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Endless One', 'hand') });
    s = answer(s, { kind: 'chooseNumber', n: 2 });
    s = answer(s, { kind: 'payCost', auto: true });
    s = passBoth(s);
    const one = find(s, 'Endless One', 'battlefield');
    expect(s.objects[one]!.counters['+1/+1']).toBe(2);
  });

  it('design 6.6, G10: a refused ability keeps the retry that automates most (the target of the first sentence stays announced)', () => {
    const text = '{1}{R}: This creature deals 1 damage to target creature. That creature can\'t block this combat.';
    const def = compileCard(creature(text));
    const act0 = abilities(def)[0] as { kind: string; effect: { targets: unknown[] } };
    expect(act0.kind).toBe('activated');
    expect(act0.effect.targets).toHaveLength(1); // CR 601.2c, 602.2b: announced as the ability is activated
  });
});

describe('W3b, guard G2 (closed vocabulary): a protection quality is a subtype of the lexicon or nothing', () => {
  it('"Protection from Zorblaxine" is no keyword the engine implements; "Protection from Goblins" is', () => {
    expect(parseKeywordLine('Protection from Zorblaxine')).toBeNull();
    expect(compileCard(creature('Protection from Zorblaxine')).automation.level).toBe('manual');
    expect(compileCard(creature('Protection from Goblins')).automation.level).toBe('full');
    // a subtype printed in the singular ("Protection from Kavu", CR 205.3: the lexicon writes the plural "Kavus") is still the subtype
    expect(parseKeywordLine('Protection from Kavu')!.abilities).toMatchObject([{ keyword: 'protection', quality: 'subtype:kavu' }]);
  });
});

describe('W3b: R1 acceptance cards on the game path (design 15.5)', () => {
  it('CR 701.6a: Counterspell counters a spell (eff.counter, stable since W3b)', () => {
    let s = scenario(['Counterspell', 'Island', 'Grizzly Bears', 'Forest'], { p1: { hand: ['Grizzly Bears'], battlefield: ['Forest', 'Forest'] }, p2: { hand: ['Counterspell'], battlefield: ['Island', 'Island'] } });
    expect(s.defs['Counterspell']!.automation.level).toBe('full');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Grizzly Bears', 'hand') });
    s = answer(s, { kind: 'payCost', auto: true });
    s = act(s, { type: 'pass', player: 'p1' });
    const bears = s.zones.stack[0]!;
    s = act(s, { type: 'cast', player: 'p2', card: find(s, 'Counterspell', 'hand', 'p2') });
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: bears }] });
    s = answer(s, { kind: 'payCost', auto: true });
    s = passBoth(s);
    expect(s.pending?.kind).toBe('priority');
    expect(s.zones.graveyard.p1!.map((id) => s.objects[id]!.defId)).toEqual(['Grizzly Bears']);
    expect(s.zones.graveyard.p2!.map((id) => s.objects[id]!.defId)).toEqual(['Counterspell']);
  });

  it.skipIf(real('Path to Exile') === undefined)('CR 110.2, 701.23: Path to Exile exiles the creature; ITS CONTROLLER may search, the land enters tapped under their control', () => {
    const path = compileCard(real('Path to Exile')!);
    expect(path.automation.level).toBe('full');
    let s = scenario(['Grizzly Bears', 'Plains'], { p1: { hand: ['Path to Exile'], battlefield: ['Plains'] }, p2: { battlefield: ['Grizzly Bears'] }, defs: [path] });
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p2');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Path to Exile', 'hand') });
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: bears }] });
    s = answer(s, { kind: 'payCost', auto: true });
    s = passBoth(s);
    expect(s.pending).toMatchObject({ kind: 'yesNo', player: 'p2' }); // "Its controller may ..." (CR 608.2d): the exiled creature's controller decides
    s = answer(s, { kind: 'yesNo', yes: true });
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', player: 'p2' });
    const pick = (s.pending as { options: string[] }).options[0]!;
    s = answer(s, { kind: 'chooseObjects', ids: [pick] });
    expect(s.zones.exile.map((id) => s.objects[id]!.defId)).toEqual(['Grizzly Bears']);
    const lands = s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2');
    expect(lands.map((id) => [s.objects[id]!.defId, s.objects[id]!.tapped])).toEqual([['Plains', true]]);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1')).toHaveLength(1); // only p1's own Plains
  });
});
