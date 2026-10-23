/**
 * Cloud std-fin: the parser readings this slice added beside its templates (parser/lower/anaphora.ts, mentions.ts, conditions.ts, chart.ts; model/focus.ts, lint-flow.ts;
 * render/refs.ts), on invented wordings (design 6.10): what each binds, and the neighbors each must leave alone (design 6.4: a pronoun with two candidates stays manual).
 *
 *   CR 608.2c   instructions in order; a pronoun names what an earlier instruction of its own list produced, never what a later one did
 *   CR 400.7    a moved card is a new object; "it" after "exile ~, then return" is the card in exile
 *   CR 701.20e  the one card looked at is "it" for the instructions after the look; beside the trigger's object it is the focus (LOOK1, reviewed:
 *               this slice's last-resort rule, which kept the old reading for guard G10, is gone with that reviewed fix)
 *   CR 701.3d   "unattach it" moves an attached Equipment or Aura, never a creature
 *   CR 118.12   "if you do" reads the option; under it, what the option bound is known
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { bare, card, fullyAutomated } from '../../m5/templates/support';

const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });
const face = (type: string, text: string) => parseCard(card('Test Card', type, text) as OracleCard, OPTS).faces[0]!;
const steps = (f: ReturnType<typeof face>, k = 0): unknown[] => ((bare(f.abilities)[k] as { effect?: { steps?: unknown[] } }).effect?.steps ?? []);
const json = (x: unknown): string => JSON.stringify(x);

describe('a pronoun inside a list of instructions (lower/mentions.ts#mentionsInside)', () => {
  it('"If you do, create a 1/1 white Soldier creature token, then attach ~ to it.": the token the branch created', () => {
    const f = face('Artifact — Equipment', 'When this Equipment enters, you may pay {2}. If you do, create a 1/1 white Soldier creature token, then attach this Equipment to it.');
    expect(fullyAutomated(f)).toBe(true);
    const [pay] = steps(f) as { op: string; then: { op: string; as?: string; to?: unknown }[] }[];
    expect(pay!.op).toBe('pay');
    expect(pay!.then[0]!.op).toBe('createToken');
    expect(pay!.then[1]).toMatchObject({ op: 'attach', what: { ref: 'self' }, to: { ref: 'bound', name: pay!.then[0]!.as } });
  });
  it('a pronoun said before the instructions it would look back to is no antecedent of theirs: "Its controller may search ..., put it onto the battlefield tapped, then shuffle." stays the target\'s controller', () => {
    const f = face('Instant', 'Exile target creature. Its controller may search their library for a basic land card, put it onto the battlefield tapped, then shuffle.');
    expect(fullyAutomated(f)).toBe(true);
    expect(json(steps(f))).toContain('"who":{"ref":"controllerOf","object":{"ref":"target","id":"t0"}}');
  });
  it('the search idiom inside a branch: "If you do, search your library for an enchantment card, put that card onto the battlefield, then shuffle." moves the card found', () => {
    const f = face('Creature — Human', 'When this creature dies, you may exile it. If you do, search your library for an enchantment card, put that card onto the battlefield, then shuffle.');
    expect(fullyAutomated(f)).toBe(true);
    const branch = (steps(f)[1] as { then: { op: string; as?: string; what?: unknown }[] }).then;
    expect(branch[1]).toMatchObject({ op: 'move', what: { ref: 'bound', name: branch[0]!.as } });
  });
});

describe('the one card looked at (lower/mentions.ts, model/focus.ts)', () => {
  it('"At the beginning of your upkeep, look at the top card of your library. If it\'s a land card, you may put it onto the battlefield tapped.": the card, the one candidate', () => {
    const f = face('Enchantment', "At the beginning of your upkeep, look at the top card of your library. If it's a land card, you may put it onto the battlefield tapped.");
    expect(fullyAutomated(f)).toBe(true);
    const s = steps(f) as { op: string; as?: string; cond?: unknown; then?: { do: { what: unknown }[] }[] }[];
    expect(s[1]!.cond).toMatchObject({ cond: 'matches', object: { ref: 'bound', name: s[0]!.as } });
    expect(s[1]!.then![0]!.do[0]!.what).toEqual({ ref: 'bound', name: s[0]!.as });
  });
  it('beside the attacker the card is the focus after the look (LOOK1, CR 701.20b, 701.20e, 608.2c): "it" is the card looked at, never the attacking Vehicle', () => {
    // Before LOOK1 this slice kept the attacker here (a last resort for the card, guard G10): looking moves nothing (CR 701.20b), so the card is still on top of the
    // library and is what the next sentence's "it" names (CR 701.20e); its "if" is read as the ability resolves, after the look (CR 608.2c).
    const f = face('Artifact — Vehicle', 'Whenever this Vehicle attacks, look at the top card of your library. If it\'s a land card, you may put it onto the battlefield tapped.\nCrew 2');
    expect(fullyAutomated(f)).toBe(true);
    const s = steps(f) as { op: string; as?: string; cond?: unknown; then?: { do: { what: unknown }[] }[] }[];
    expect(json(s)).not.toContain('"role":"attacker"');
    expect(json(s)).not.toContain('"ref":"event"');
    expect(s[0]!.as).toBe('seen');
    expect(s[1]!.cond).toMatchObject({ cond: 'matches', object: { ref: 'bound', name: 'seen' } });
    expect(s[1]!.then![0]!.do[0]!.what).toEqual({ ref: 'bound', name: 'seen' });
  });
  it('"look at the top card of target opponent\'s library, then exile it face down": "it" is the card looked at (the instruction right before made it; the target is a player)', () => {
    const f = face('Artifact', "{T}: Look at the top card of target opponent's library, then exile it face down. You may play that card for as long as it remains exiled.");
    expect(fullyAutomated(f)).toBe(true);
    const s = steps(f) as { op: string; as?: string; what?: unknown }[];
    expect(s[1]).toMatchObject({ op: 'move', what: { ref: 'bound', name: s[0]!.as }, to: { zone: 'exile', faceDown: true } });
  });
  it('"If you don\'t put the card into your hand, put it on the bottom of your library.": the card that was not put there (the name it had before that move)', () => {
    const f = face('Artifact', '{3}: Look at the top card of your library. If it\'s a creature card, you may reveal it and put it into your hand. If you don\'t put the card into your hand, put it on the bottom of your library.');
    expect(fullyAutomated(f)).toBe(true);
    const s = steps(f) as { op: string; as?: string; cond?: unknown; then?: { what?: unknown }[] }[];
    expect(s[2]!.cond).toMatchObject({ cond: 'did', not: true, to: 'hand' });
    expect(s[2]!.then![0]!.what).toEqual({ ref: 'bound', name: s[0]!.as });
  });
  it('"Exile the top card of your library. You may cast it.": the exiled card, named or not (the attacker is the other candidate)', () => {
    const f = face('Creature — Pirate', 'Whenever this creature attacks, exile the top card of your library. You may cast it.');
    expect(fullyAutomated(f)).toBe(true);
    const s = steps(f) as { op: string; as?: string; what?: unknown }[];
    expect(s[1]).toMatchObject({ op: 'cast', what: { ref: 'bound', name: s[0]!.as } });
  });
});

describe('the focus within a sentence (lower/anaphora.ts#focusWithin) and its limits', () => {
  it('"Exile ~, then return it to the battlefield under its owner\'s control." after a destroy: the card exiled (CR 400.7), not the destroyed target', () => {
    const f = face('Creature — Spirit', "{2}: Destroy target artifact. Exile this creature, then return it to the battlefield under its owner's control.");
    expect(fullyAutomated(f)).toBe(true);
    const s = steps(f) as { op: string; as?: string; what?: unknown }[];
    expect(s[1]).toMatchObject({ op: 'move', what: { ref: 'self' } });
    expect(s[2]).toMatchObject({ op: 'move', what: { ref: 'bound', name: s[1]!.as } });
  });
  // merge of lines C and D: "Exile target creature you control, then return it to the battlefield under its owner's control." is now one template of std-tla
  // (eff.stdtla.flicker.it, whose "it" is the creature it exiled, CR 608.2c), so the rule is checked on a sentence no template reads whole
  it('a sentence that names a target of its own keeps the unique-candidate rule: "Exile target creature you control, then return it ..." after a destroy is manual', () => {
    const f = face('Sorcery', "Destroy target artifact. Exile target creature you control, then return it to its owner's hand.");
    expect(json(f.abilities)).toContain('manual');
  });
  // std-typechange-1 (DECIDED BY DEFAULT, owner instruction 2026-10-21; CR 608.2c): the creature tapped by the instruction joined by a bare "and" is the focus, so "it" is that creature, never the Aura; with "then" the unique-candidate rule still applies
  it('an object tapped where it is: "tap enchanted creature and remove all +1/+1 counters from it" names the enchanted creature; "..., then remove ..." stays manual', () => {
    const f = face('Enchantment — Aura', 'Enchant creature\nWhen this Aura enters, tap enchanted creature and remove all +1/+1 counters from it.');
    expect(json(f.abilities)).toContain('"from":{"ref":"attachedTo"}');
    expect(json(f.abilities)).not.toContain('"from":{"ref":"self"}');
    const g = face('Enchantment — Aura', 'Enchant creature\nWhen this Aura enters, tap enchanted creature, then remove all +1/+1 counters from it.');
    expect(json(g.abilities)).toContain('"op":"manual"');
  });
});

describe('"unattach it" (CR 701.3d) and "if you do" after an option that bound something', () => {
  it('the Equipment the option chose, never the creature it was attached to', () => {
    const f = face('Sorcery', 'Gain control of target creature until end of turn. You may attach an Equipment you control to that creature. If you do, unattach it at the beginning of the next end step.');
    expect(fullyAutomated(f)).toBe(true);
    const s = steps(f) as { op: string; as?: string; do?: { as?: string }[]; then?: { do: { what: unknown; to: unknown }[] }[] }[];
    const chosen = s[1]!.do![0]!.as;
    expect(s[2]!.then![0]!.do[0]).toEqual({ op: 'attach', what: { ref: 'bound', name: chosen }, to: null });
  });
});
