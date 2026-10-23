/**
 * WP21 "never silently wrong" (design 6.4, 6.6, 6.8, 3.1): what the zone templates must NOT automate, and the two lowering corrections WP21 needed
 * (parser/lower/mentions.ts, parser/lower/anaphora.ts; recorded as an interface change of WP17's files):
 *
 *  - design 3.1 rule 4: a reference that ACTS on an object an earlier step moved ("exile target creature, then return it") is bound to the moving step's
 *    `as`, because a target (or `self`) handle never re-bases (CR 400.7) and the binding does (CR 400.7j). Before, "return it" acted on the stale target
 *    handle and silently did nothing. Property reads ("its controller", "its power") still read the target's last known information (CR 608.2h);
 *  - design 6.4: "~" and "enchanted creature" named by a step are mentions, so "tap enchanted creature and remove all +1/+1 counters from it" in a trigger of the
 *    Aura has two candidates for "it" and is manual, instead of binding the Aura (the trigger's subject).
 *
 * Plus guard G10 on a deterministic tenth of the local index: adding the WP21 templates changes no ability that the bootstrap templates already
 * automated. Both sides of that comparison run THIS branch's lowering, so it guards the templates only, not the lowering corrections; a guard for those
 * needs a snapshot taken on main (WP25, G10). They were checked by hand on the whole index (34,466 cards), main's checkout against this branch with the
 * bootstrap templates only: with the corrections above, no JSON changed; the WP21 review fixes (review.test.ts) change two formerly automated abilities,
 * both silently wrong before: Leave No Trace ("each other enchantment" on an instant wrote "other than this spell", now manual) and Wall of Roots (a -0/-1
 * counter, now needs `counter:-0/-1`, CR 122.1a). With the WP21 templates, 4,612 abilities are newly automated (and through the render gate).
 */
import { describe, expect, it } from 'vitest';
import { BOOTSTRAP_TEMPLATES, defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { lowerAnaphora, lowerTargets } from '../../../src/parser/lower';
import { A, T, creature, draft, freeze, unit } from '../lower/support';
import { SLOW, slowTitle } from '../../slow';
import { automated, card, face, fake, fullyAutomated, localIndex, NEIGHBORS, options } from './support';

const OPTS = options(NEIGHBORS);
const json = (v: unknown): string => JSON.stringify(v);
const steps = (text: string, type = 'Instant') => {
  const a = face(card('Test Card', type, text), OPTS).abilities;
  const last = a[a.length - 1]!;
  return last.kind === 'spell' || last.kind === 'triggered' || last.kind === 'activated' ? last.effect.steps : null;
};

describe('design 3.1 rule 4, CR 400.7: acting on an object after it moved', () => {
  it('"exile target creature you control, then return it": the return acts on the exile step\'s binding, never on the stale target handle', () => {
    const f = face(card('Test Blink', 'Instant', 'Exile target nonwhite creature you control, then return it to the battlefield under its owner\'s control.'), OPTS);
    const s = json(f.abilities);
    expect(s).not.toContain('{"op":"move","what":{"ref":"target","id":"t0"},"to":{"zone":"battlefield"');
    // FAST2 T10: the renderer names a move's binding ("it", render/steps-zones.ts#bindMoved), so the gate accepts the sentence: the return acts on the
    // exile's binding
    expect(fullyAutomated(f)).toBe(true);
    expect(s).toContain('{"op":"move","what":{"ref":"bound","name":"moved"},"to":{"zone":"battlefield"');
  });

  it('the lowering writes `as` on the moving step and `{ref:"bound"}` where a later step acts on it; a property read keeps the target', () => {
    const it_ = A({ sort: 'object', number: 'singular', text: 'it' });
    const d = lowerAnaphora(lowerTargets(freeze(draft([
      unit(0, 'destroy target creature', [{ op: 'destroy', what: T(creature()) }]),
      unit(1, 'return it to its owner\'s hand', [{ op: 'move', what: it_, to: { zone: 'hand' } }]),
      unit(2, 'its controller draws a card', [{ op: 'draw', who: { ref: 'controllerOf', object: A({ sort: 'object', number: 'singular', text: 'it' }) }, count: 1 }]),
    ]))));
    expect(d.units[0]!.steps).toEqual([{ op: 'destroy', what: { ref: 'target', id: 't0' }, as: 'moved' }]);
    expect(d.units[1]!.steps).toEqual([{ op: 'move', what: { ref: 'bound', name: 'moved' }, to: { zone: 'hand' } }]);
    // a read through the target uses last known information (CR 608.2h): "its controller" is still the target's
    expect(d.units[2]!.manual).toBeUndefined();
    expect(json(d.units[2]!.steps)).toContain('"who":{"ref":"controllerOf","object":{"ref":"target","id":"t0"}}');
  });

  // std-rw9 (CR 400.7, 701.8a; render/steps-zones.ts#destroyedOne): the renderer now names what a destroy of one object put into a graveyard "it", so the sentence
  // that was manual here ("put that object ...") is automated: "it" is the destroy's binding, the card found in the public zone it went to
  it('"Destroy target creature. Return it to its owner\'s hand.": "it" is the card the destroy moved (the destroy\'s binding), named "it" by the renderer', () => {
    const res = parseCard(card('Test Blink', 'Instant', 'Destroy target creature. Return it to its owner\'s hand.'), OPTS).faces[0]!;
    expect(fullyAutomated(res)).toBe(true);
    expect(json(res.abilities)).toContain('{"op":"move","what":{"ref":"bound","name":"moved"},"to":{"zone":"hand"}}');
  });

  it('CR 608.2h: property reads after the move keep the target (last known information): a Swords-like spell reads its controller and power from t0', () => {
    const st = steps('Exile target nonblack creature. Its controller gains life equal to its power.');
    expect(st).toEqual([
      { op: 'move', what: { ref: 'target', id: 't0' }, to: { zone: 'exile' } },
      { op: 'gainLife', who: { ref: 'controllerOf', object: { ref: 'target', id: 't0' } }, amount: { q: 'stat', stat: 'power', of: { ref: 'target', id: 't0' } } },
    ]);
  });

  it('"{1}: Exile ~. Return it ...": "it" is the exiled card, never the stale `self` handle', () => {
    const f = face(card('Test Golem', 'Artifact Creature — Golem', '{1}: Exile ~. Return it to the battlefield under its owner\'s control.'), OPTS);
    expect(json(f.abilities)).not.toContain('{"op":"move","what":{"ref":"self"},"to":{"zone":"battlefield"');
    // the lowering binds "it" to the exile; FAST2 T10: the renderer names that binding "it", so the gate accepts it and the exiled card returns
    expect(fullyAutomated(f)).toBe(true);
    expect(json(f.abilities)).toContain('{"op":"move","what":{"ref":"bound","name":"moved"},"to":{"zone":"battlefield"');
  });

  it('a trigger whose own subject left: "When ~ dies, return it to the battlefield tapped" acts on the event subject in the graveyard (CR 603.10a, 400.7)', () => {
    expect(steps('When ~ dies, return it to the battlefield tapped.', 'Creature — Spirit')).toEqual([
      { op: 'move', what: { ref: 'event', role: 'subject' }, to: { zone: 'battlefield', controller: { ref: 'you' }, tapped: true } },
    ]);
  });
});

describe('design 6.4: "~" and "enchanted creature" are candidates for a pronoun', () => {
  // std-typechange-1 (CR 608.2c): "~" and "enchanted creature" are still both candidates; the focus of the instruction joined by "and" right before the pronoun
  // decides between them (parser/lower/anaphora.ts#focusWithin), so "it" is the tapped creature and never the Aura. Before, this was manual.
  it('"When ~ enters, tap enchanted creature and remove all +1/+1 counters from it": "it" is the enchanted creature, never the Aura', () => {
    const f = face(card('Test Shackle', 'Enchantment — Aura', 'Enchant creature\nWhen ~ enters, tap enchanted creature and remove all +1/+1 counters from it.'), OPTS);
    expect(automated(f.abilities)).toBe(true);
    expect(json(f.abilities)).not.toContain('"from":{"ref":"self"}');
    expect(json(f.abilities)).toContain('"from":{"ref":"attachedTo"}');
  });

  it('with a comma or "then" between the two instructions the focus does not decide: still two candidates, manual', () => {
    const f = face(card('Test Shackle', 'Enchantment — Aura', 'Enchant creature\nWhen ~ enters, tap enchanted creature, then remove all +1/+1 counters from it.'), OPTS);
    expect(json(f.abilities)).not.toContain('"from":{"ref":"self"}');
    expect(json(f.abilities)).not.toContain('"from":{"ref":"attachedTo"}');
  });

  it('with one candidate the pronoun binds it: "{1}: Tap enchanted creature. Put a +1/+1 counter on it."', () => {
    const f = face(card('Test Spur', 'Enchantment — Aura', 'Enchant creature\n{1}: Tap enchanted creature. Put a +1/+1 counter on it.'), OPTS);
    expect(fullyAutomated(f)).toBe(true);
    expect(json(f.abilities)).toContain('{"op":"putCounters","on":{"ref":"attachedTo"},"kind":"+1/+1","count":1}');
  });
});

describe('CR 110.2: an imperative of this package inside another player\'s clause is never automated as "you"', () => {
  it('"Its controller may return target creature card from a graveyard to the battlefield tapped" is not put under your control: the gate refuses it', () => {
    const f = face(card('Test Gift', 'Instant', 'Exile target creature. Its controller may return target creature card from a graveyard to the battlefield tapped.'), OPTS);
    expect(fullyAutomated(f)).toBe(false);
  });
  it('"Its controller may create a Treasure token" is never a token for you', () => {
    const f = face(card('Test Gift', 'Instant', 'Exile target creature. Its controller may create a Treasure token.'), OPTS);
    expect(fullyAutomated(f)).toBe(false);
  });
  it('"Its controller may sacrifice a land" is never your sacrifice', () => {
    const f = face(card('Test Gift', 'Instant', 'Exile target creature. Its controller may sacrifice a land.'), OPTS);
    expect(fullyAutomated(f)).toBe(false);
  });
});

describe('forms the renderer of WP2 cannot say yet stay manual (guard G6)', () => {
  const cases = [
    'Create a tapped Powerstone token.', // "tapped" before the token words
    'Each opponent sacrifices two artifacts of their choice.',
    'Draw a card, then exile target player\'s graveyard.',
    // (FAST2 T8: "Put a +1/+1 counter on each of up to four target creatures." is said now, CR 122.6; test/fast2/t8/t8-render.test.ts)
    'Target creature phases out.',
  ];
  for (const text of cases) it(`"${text}" is not automated`, () => expect(fullyAutomated(face(card('Test Spell', 'Sorcery', text), OPTS))).toBe(false));
});

describe('no template guesses a word it does not know (guard G2)', () => {
  it('an unknown determiner, zone or destination fails the sentence', () => {
    for (const text of ['Exile some target creature.', 'Return target creature to its owner\'s pocket.', 'Put target creature onto the battlefield sideways.', 'Create a 2/2 green Bear creature tokenish.']) {
      expect(fullyAutomated(face(card('Test Spell', 'Sorcery', text), OPTS)), text).toBe(false);
    }
  });
  it('a neighbor template stand-in is only a test fixture (never committed as data)', () => {
    expect(fake('effect', 'x', {}).id).toMatch(/^test\./);
  });
});

// QT: about 11 s; a slow suite (npm run test:all). The index is read only when the suite runs.
const index = SLOW ? localIndex() : null;

describe.skipIf(!SLOW || index === null)(slowTitle('guard G10 on the local Oracle index (every 10th card)'), () => {
  it('adding the WP21 templates changes no ability the bootstrap templates automated, and no face ends in a parser error', () => {
    const before = defaultParseOptions({ templates: [...BOOTSTRAP_TEMPLATES] });
    const after = options();
    // W3 integration: a manual ability nested in an automated one (a Class level, lowered since WP22) is not automated either
    const auto = (a: { kind: string }, ok: boolean): boolean => a.kind !== 'manual' && !json(a).includes('"op":"manual"') && !json(a).includes('"kind":"manual"') && ok;
    const strip = (k: string, v: unknown) => (k === 'src' || k === 'prov' ? undefined : v);
    const problems: string[] = [];
    let gained = 0;
    for (let i = 0; i < index!.length; i += 10) {
      const c = index![i]!;
      const a = parseCard(c, before);
      const b = parseCard(c, after);
      a.faces.forEach((fa, k) => {
        const fb = b.faces[k]!;
        if (fb.diagnostics.some((d) => d.code === 'parser-error')) problems.push(`${c.name}: parser-error`);
        if (fb.abilities.length !== fa.abilities.length) problems.push(`${c.name}: ${fa.abilities.length} -> ${fb.abilities.length} abilities`);
        fa.abilities.forEach((x, j) => {
          const y = fb.abilities[j];
          const was = auto(x, fa.gate[j]?.ok === true);
          if (was && JSON.stringify(x, strip) !== JSON.stringify(y, strip)) problems.push(`${c.name}: ${x.text}`);
          if (!was && y !== undefined && auto(y, fb.gate[j]?.ok === true)) gained++;
        });
      });
    }
    expect(problems.slice(0, 20)).toEqual([]);
    expect(gained).toBeGreaterThan(300);
  }, 180_000);
});
