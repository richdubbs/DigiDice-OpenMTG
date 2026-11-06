/**
 * Commander lane edh-mana-keywords, round edh-mana-keywords-7: the scenarios that need a Commander game (synthetic cards, design 6.10).
 *
 *   CR 106.6, 603.2, 701.22a, 903.8  "When you spend this mana to cast your commander, scry X, where X is the number of times it's been cast from the command zone this game."
 *                                    (Study Hall): the cast that is happening counts (ruling 2020-11-10 of Opal Palace); other mana, or a spell that is not your commander, scries nothing
 */
import { describe, expect, it } from 'vitest';
import { activatedAbilities, type GameState } from '../../../src/index';
import { act, answer, answerUntilPriority, card as cmdCard, commanderRec, commanderScenario, drive, find, forests, inCommand, legend, pass, tweak } from '../../m11/rules/helpers';

const STUDY = cmdCard('Test Study', '', 'Land', "{1}, {T}: Add one mana of any color. When you spend this mana to cast your commander, scry X, where X is the number of times it's been cast from the command zone this game.");
const TITANIA = legend('Test Titania', '{1}{G}', ['2', '2'], ['G']);
const BOB = legend('Test Bob Commander', '{G}', ['1', '1'], ['G']);
const BEAR = cmdCard('Test Bear', '{G}', 'Creature — Bear', '', ['2', '2']);

describe('CR 106.6, 701.22a, 903.8: "When you spend this mana to cast your commander, scry X, where X is the number of times it\'s been cast from the command zone this game."', () => {
  const setup = (casts: number): GameState => tweak(commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], defs: [STUDY, BEAR], p1: { battlefield: [...forests(8), 'Test Study'], hand: ['Test Bear'] } }), (t) => { commanderRec(t, 'p1', 'Test Titania').casts = casts; });
  /** Activate Study Hall's mana ability (a Forest pays its {1}), choosing green: {G} with the trigger stays in the pool. */
  const makeStudyMana = (s0: GameState): GameState => {
    const id = find(s0, 'Test Study', 'battlefield', 'p1');
    const key = activatedAbilities(s0, s0.objects[id]!).find((i) => i.def.isMana === true && i.def.cost.mana !== undefined)!.key;
    return drive(answer(act(s0, { type: 'activate', player: 'p1', source: id, ability: key }), { kind: 'chooseColor', color: 'G' } as never));
  };
  /** Pass priority until the scry is asked: its prompt, or null when none comes. */
  const scryPrompt = (s0: GameState): string | null => {
    let s = s0;
    for (let i = 0; i < 8 && s.zones.stack.length > 0; i++) {
      s = drive(pass(s));
      const d = s.pending as { kind: string; prompt?: string } | undefined;
      if (d?.kind === 'chooseObjects' && /^Scry/.test(d.prompt ?? '')) return d.prompt!;
    }
    return null;
  };
  it('the card is fully automated', () => {
    expect(STUDY.automation.level).toBe('full');
  });
  it('the first cast of the commander from the command zone with the mana: scry 1 (the cast that is happening counts)', () => {
    const s = makeStudyMana(setup(0));
    expect(scryPrompt(answerUntilPriority(act(s, { type: 'cast', player: 'p1', card: inCommand(s, 'Test Titania') })))).toMatch(/^Scry 1:/);
  });
  it('after two earlier casts, the third scries 3', () => {
    const s = makeStudyMana(setup(2));
    expect(scryPrompt(answerUntilPriority(act(s, { type: 'cast', player: 'p1', card: inCommand(s, 'Test Titania') })))).toMatch(/^Scry 3:/);
  });
  it('negative: a spell that is not your commander scries nothing, and neither does the commander paid with other mana', () => {
    const s = makeStudyMana(setup(2));
    expect(scryPrompt(answerUntilPriority(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Bear', 'hand', 'p1') })))).toBeNull();
    const s0 = setup(2);
    expect(scryPrompt(answerUntilPriority(act(s0, { type: 'cast', player: 'p1', card: inCommand(s0, 'Test Titania') })))).toBeNull();
  });
});
