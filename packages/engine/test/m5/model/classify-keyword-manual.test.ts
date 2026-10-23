/**
 * M5Z review: a keyword whose expansion (keywords/data/<name>.json) contains a manual step is not `full` (design 10.3: "a full card has no manual
 * node"). Ninjutsu (CR 702.49) was the case: its expansion asked the player to name the defender of the returned creature by hand (CR 702.49c).
 * std-typechange-1: the expansion now puts the card onto the battlefield attacking what the returned creature attacked (Destination `attacking:
 * { asReturned: true }`, the reading sneak's CR 702.190b already had, rules/status.ts#entersAttackingAsReturned), so ninjutsu is full and raises no manual
 * prompt in play. No keyword expansion has a manual step any more; the classification rule itself is model/classify.ts's (a manual node is never full).
 * CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import { classifyAbility, compileCard, ENGINE_CAPABILITIES, legalActions, type GameState, type OracleCard } from '../../../src/index';
import { act, answer, find, pass, runCombat, scenario } from '../helpers';

const THROAT_SLITTER: OracleCard = {
  oracle_id: '56f782b7-d46c-4aa1-ae16-66d6401c72ae',
  name: 'Throat Slitter',
  layout: 'normal',
  mana_cost: '{4}{B}',
  cmc: 5,
  type_line: 'Creature — Rat Ninja',
  oracle_text: 'Ninjutsu {2}{B} ({2}{B}, Return an unblocked attacker you control to hand: Put this card onto the battlefield from your hand tapped and attacking.)\n'
    + 'Whenever this creature deals combat damage to a player, destroy target nonblack creature that player controls.',
  power: '2',
  toughness: '2',
  colors: ['B'],
  color_identity: ['B'],
  keywords: ['Ninjutsu'],
} as OracleCard;

describe('CR 702.49c: ninjutsu names the defender of the returned creature itself (std-typechange-1)', () => {
  it('the ninjutsu keyword ability is full, with no manual span', () => {
    const a = classifyAbility({ kind: 'keyword', keyword: 'ninjutsu', text: 'Ninjutsu {2}{B}', cost: { mana: [] } } as never, ENGINE_CAPABILITIES);
    expect(a.level).toBe('full');
    expect(a.manual).toEqual([]);
  });

  it('CR 702.49c: Throat Slitter compiles as full', () => {
    const def = compileCard(THROAT_SLITTER);
    expect(def.automation.level).toBe('full');
    expect(def.automation.unsupported ?? []).toEqual([]);
  });

  it('CR 702.49c, 508.4: activated through applyAction, Throat Slitter enters tapped and attacking the player the returned Grizzly Bears attacked, with no manual prompt', () => {
    const def = compileCard(THROAT_SLITTER);
    const s0 = scenario(['Grizzly Bears', 'Swamp'], { p1: { hand: ['Throat Slitter'], battlefield: ['Grizzly Bears', 'Swamp', 'Swamp', 'Swamp'] }, defs: [def] });
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    let s: GameState = runCombat(s0, { attack: [[bears]], until: 'declareBlockers' });
    const ninjutsu = legalActions(s, 'p1').find((x) => x.kind === 'activate' && x.object === find(s, 'Throat Slitter', 'hand'));
    expect(ninjutsu).toBeDefined();
    s = act(s, ninjutsu!.action);
    for (let i = 0; i < 10 && s.pending && s.pending.kind !== 'priority'; i++) {
      const d = s.pending;
      if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: [bears] });
      else throw new Error(`unexpected ${d.kind}: ${d.prompt}`);
    }
    s = pass(pass(s));
    expect(s.pending?.kind).not.toBe('manualResolve');
    const slitter = find(s, 'Throat Slitter', 'battlefield');
    expect(s.objects[slitter]!.tapped).toBe(true);
    const attacker = s.combat?.attackers.find((a) => a.id === slitter);
    expect(attacker).toMatchObject({ defender: 'p2', defendingPlayer: 'p2', blocked: false });
    expect(find(s, 'Grizzly Bears', 'hand')).toBeDefined();
  });
});
