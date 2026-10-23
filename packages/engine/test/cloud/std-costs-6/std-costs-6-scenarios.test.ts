/**
 * std-costs-6 (lane std-costs, account B): "Choose target creature card in your graveyard with mana value 4 or less. If this spell was cast using teamwork, instead
 * choose target creature card in your graveyard. Return the chosen card to the battlefield." (Too Evil to Stay Dead), played through the engine with synthetic cards
 * compiled by the game's default compiler (invented names and wordings, design 6.10). The reading is std-costs-2's "instead choose" (lower/choose.ts#insteadChoose,
 * render/program.ts#chosenInstead) with a teamwork condition (FAST5X E11: `wasCast.kicked: 'teamwork'`); two single targets are one object, "the chosen card"
 * (lower/mentions.ts#insteadChosenGroup, lower/anaphora.ts#resolveAnaphor).
 *   CR 601.2c, 702.194b  without teamwork only a creature card of mana value 4 or less can be chosen; with it, any creature card in your graveyard
 *   CR 608.2c            the one chosen card returns to the battlefield under your control
 * CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, passBoth, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, cost = '{0}', pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}

interface Script { yes?: boolean[]; targets?: TargetChoice[][]; objects?: ObjectId[][] }
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  const q = { yes: [...(script.yes ?? [])], targets: [...(script.targets ?? [])], objects: [...(script.objects ?? [])] };
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: q.yes.shift() ?? false });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.targets.shift() ?? [] });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: q.objects.shift() ?? p.options.slice(0, p.min) });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
const cast = (s: GameState, script?: Script): GameState => drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Grave Rally', 'hand', 'p1') }), script);
function resolveAll(s0: GameState): GameState {
  let s = s0;
  for (let i = 0; i < 12 && s.zones.stack.length > 0; i++) s = drive(passBoth(s));
  return s;
}
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
/** The zones of p1's cards of that name (a card that changed zones is a new object, CR 400.7). */
const zonesOf = (s: GameState, name: string): string[] => Object.values(s.objects).filter((o) => o.defId === name && o.owner === 'p1').map((o) => o.zone);
const onBattlefield = (s: GameState, name: string) => Object.values(s.objects).find((o) => o.defId === name && o.zone === 'battlefield');

const RALLY = card('Test Grave Rally', 'Sorcery', 'Teamwork 4\nChoose target creature card in your graveyard with mana value 4 or less. If this spell was cast using teamwork, instead choose target creature card in your graveyard. Return the chosen card to the battlefield.');
const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}{G}', ['2', '2']);
const OGRE = card('Test Ogre', 'Creature — Ogre', '', '{3}', ['4', '4']);
const TITAN = card('Test Titan', 'Creature — Giant', '', '{6}', ['6', '6']);
const DEFS = [RALLY, BEAR, OGRE, TITAN];

const setup = (p2Graveyard: string[] = []): GameState =>
  scenario([], { defs: DEFS, p1: { hand: ['Test Grave Rally'], battlefield: ['Test Ogre'], graveyard: ['Test Bear', 'Test Titan'] }, p2: { graveyard: p2Graveyard } });

describe('std-costs-6: "instead choose" under teamwork, "the chosen card" (CR 601.2c, 702.194b)', () => {
  it('the card is automated: two single targets, one announced without teamwork and the other with it, and one move of their union', () => {
    expect(RALLY.automation.level, JSON.stringify(RALLY.automation)).toBe('full');
    const spell = RALLY.faces[0]!.abilities.find((a) => a.kind === 'spell') as unknown as { effect: { targets: { onlyIf?: unknown; max: number }[]; steps: unknown[] } };
    expect(spell.effect.targets.map((t) => [t.onlyIf, t.max])).toEqual([[{ cond: 'not', of: { cond: 'wasCast', kicked: 'teamwork' } }, 1], [{ cond: 'wasCast', kicked: 'teamwork' }, 1]]);
    expect(spell.effect.steps).toEqual([{ op: 'move', what: { ref: 'union', of: [{ ref: 'target', id: 't0' }, { ref: 'target', id: 't1' }] }, to: { zone: 'battlefield', controller: { ref: 'you' } } }]);
  });

  it('CR 601.2c, 608.2c: without teamwork, a creature card of mana value 4 or less returns to the battlefield', () => {
    const s0 = setup();
    const bear = find(s0, 'Test Bear', 'graveyard', 'p1');
    const s = resolveAll(cast(s0, { yes: [false], targets: [[obj(bear)]] }));
    expect(zonesOf(s, 'Test Bear')).toEqual(['battlefield']);
    expect(onBattlefield(s, 'Test Bear')?.controller).toBe('p1');
    expect(zonesOf(s, 'Test Titan')).toEqual(['graveyard']);
  });

  it('CR 601.2c: without teamwork, a creature card of mana value 6 is no legal target', () => {
    const s0 = setup();
    const titan = find(s0, 'Test Titan', 'graveyard', 'p1');
    const s1 = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Grave Rally', 'hand', 'p1') });
    expect(() => drive(s1, { yes: [false], targets: [[obj(titan)]] })).toThrow();
  });

  it('CR 702.194a-b, 601.2c, 608.2c: with teamwork (the Ogre tapped), the mana value 6 creature card returns, and only it', () => {
    const s0 = setup();
    const titan = find(s0, 'Test Titan', 'graveyard', 'p1');
    const ogre = find(s0, 'Test Ogre', 'battlefield', 'p1');
    const s = resolveAll(cast(s0, { yes: [true], objects: [[ogre]], targets: [[obj(titan)]] }));
    expect(s.objects[ogre]!.tapped).toBe(true);
    expect(zonesOf(s, 'Test Titan')).toEqual(['battlefield']);
    expect(zonesOf(s, 'Test Bear')).toEqual(['graveyard']);
  });

  it('CR 601.2c: one card is chosen, never two; a creature card in an opponent\'s graveyard is no legal target, with or without teamwork', () => {
    const s0 = setup(['Test Bear']);
    const bear = find(s0, 'Test Bear', 'graveyard', 'p1');
    const titan = find(s0, 'Test Titan', 'graveyard', 'p1');
    const theirs = find(s0, 'Test Bear', 'graveyard', 'p2');
    const ogre = find(s0, 'Test Ogre', 'battlefield', 'p1');
    const start = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Grave Rally', 'hand', 'p1') });
    expect(() => drive(start, { yes: [true], objects: [[ogre]], targets: [[obj(bear), obj(titan)]] })).toThrow();
    expect(() => drive(start, { yes: [true], objects: [[ogre]], targets: [[obj(theirs)]] })).toThrow();
    expect(() => drive(start, { yes: [false], targets: [[obj(theirs)]] })).toThrow();
  });
});

describe('std-costs-6 parser and renderer support (fail closed)', () => {
  const full = (text: string): boolean => {
    const d = card('Example Relic', 'Sorcery', text);
    return d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
  };
  it('CR 601.2c (lower/mentions.ts#insteadChosenGroup, render/program.ts#chosenInstead): "the chosen card" names the one object only when each announcement is one target', () => {
    expect(full('Kicker {1}\nChoose target creature card in your graveyard with mana value 2 or less. If this spell was kicked, instead choose target creature card in your graveyard. Return the chosen card to your hand.')).toBe(true);
    // a group of several objects is not "the chosen card"; nor is a reading with no condition decided at announcement
    expect(full('Kicker {1}\nChoose target creature card in your graveyard. If this spell was kicked, instead choose up to two target creature cards in your graveyard. Return the chosen card to your hand.')).toBe(false);
    expect(full('Choose target creature card in your graveyard with mana value 2 or less. If you control an artifact, instead choose target creature card in your graveyard. Return the chosen card to your hand.')).toBe(false);
  });
  it('CR 601.2c: the std-costs-2 group of several objects still reads "each chosen creature", never "the chosen creature"', () => {
    expect(full('Kicker {1}\nChoose target creature you own. If this spell was kicked, instead choose any number of target creatures you own. Return each chosen creature to your hand.')).toBe(true);
    expect(full('Kicker {1}\nChoose target creature you own. If this spell was kicked, instead choose any number of target creatures you own. Return the chosen creature to your hand.')).toBe(false);
  });
});
