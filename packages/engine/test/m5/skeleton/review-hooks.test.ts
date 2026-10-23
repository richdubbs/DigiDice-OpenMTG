/**
 * WP0 review: every call-site that a rule hook can veto really asks the hookpoints (design 5.3: "WP0 rewires every call-site once"), so a statics provider
 * filled by WP16 cannot claim coverage the call-sites don't give. A fake statics provider is installed on the engine's real one (`withStatics`).
 */
import { describe, expect, it } from 'vitest';
import { applyAction, manaSources, type GameState } from '../../../src/index';
import { deny } from '../../../src/rules/denial';
import { targetOptions } from '../../../src/rules/targets';
import { act, find, legal, pool, reject, scenario, withStatics } from '../helpers';

const veto = (why: string, ...rules: string[]) => deny(why, ...rules);

describe('CR 602.5, 605.1a: "can\'t activate" restrictions stop mana abilities too (Null Rod, Cursed Totem, Collector Ouphe)', () => {
  const board = (): GameState => scenario(['Llanowar Elves', 'Sol Ring', 'Grizzly Bears'], { p1: { hand: ['Grizzly Bears'], battlefield: ['Llanowar Elves', 'Sol Ring'] } });
  const noActivation = { canActivate: () => veto("Test: abilities can't be activated.", 'CR 602.5') };

  it('without a veto the mana abilities are listed, offered to the auto-payer and activatable (baseline)', () => {
    const s = board();
    expect(legal(s, 'p1', 'activate').filter((a) => a.isMana)).toHaveLength(2);
    expect(manaSources(s, 'p1').map((m) => m.name).sort()).toEqual(['Llanowar Elves', 'Sol Ring']);
  });

  it('the activation list, the mana-source discovery of the auto-payer and the activate action itself all respect the veto', () => {
    const s = board();
    withStatics(noActivation, () => {
      expect(legal(s, 'p1', 'activate')).toEqual([]);
      expect(manaSources(s, 'p1')).toEqual([]);
      const err = reject(s, { type: 'activate', player: 'p1', source: find(s, 'Sol Ring', 'battlefield'), ability: 'p:0:0' });
      expect(err.rules).toContain('CR 602.5');
      expect(legal(s, 'p1', 'cast')).toEqual([]); // Grizzly Bears ({1}{G}) can't be paid for with mana abilities that can't be activated
    });
    expect(legal(s, 'p1', 'cast').map((a) => a.label)).toEqual(['Cast Grizzly Bears']);
  });

  it('the provider is asked with the ability key and the activating player, and can veto one source only', () => {
    const s = board();
    const asked: string[] = [];
    const elves = find(s, 'Llanowar Elves', 'battlefield');
    withStatics(
      {
        canActivate: (_g, source, key, player) => {
          asked.push(`${source}|${key}|${player}`);
          return source === elves ? veto('Test: not the Elves.', 'CR 602.5') : null;
        },
      },
      () => {
        expect(manaSources(s, 'p1').map((m) => m.name)).toEqual(['Sol Ring']);
        expect(asked).toContain(`${elves}|p:0:0|p1`);
        expect(legal(s, 'p1', 'cast')).toEqual([]); // only Sol Ring is left: {C}{C} can't pay {1}{G}
      },
    );
  });

  it("a mana ability the engine can't run (Gaea's Cradle, activated by hand) is vetoed as well", () => {
    const s = scenario(["Gaea's Cradle"], { p1: { battlefield: ["Gaea's Cradle"] } });
    expect(legal(s, 'p1', 'activate')).toHaveLength(1);
    withStatics(noActivation, () => {
      expect(legal(s, 'p1', 'activate')).toEqual([]);
      expect(reject(s, { type: 'activate', player: 'p1', source: find(s, "Gaea's Cradle", 'battlefield'), ability: 'p:0:0' }).rules).toContain('CR 602.5');
    });
  });

  it('the veto does not leak: after the provider is removed the same state activates normally', () => {
    const s = board();
    withStatics(noActivation, () => legal(s, 'p1', 'activate'));
    const t = act(s, { type: 'activate', player: 'p1', source: find(s, 'Sol Ring', 'battlefield'), ability: 'p:0:0' });
    expect(pool(t, 'p1')).toBe('CC');
    expect(applyAction(t, { type: 'pass', player: 'p1' }).error).toBeUndefined();
  });
});

describe('CR 115, 702.11b, 702.18a: players and non-battlefield objects go through the canBeTargeted hook (Leyline of Sanctity, Witchbane Orb, Ivory Mask)', () => {
  const s = scenario(['Grizzly Bears', 'Gladecover Scout'], { p1: { battlefield: ['Grizzly Bears'] }, p2: { graveyard: ['Grizzly Bears', 'Gladecover Scout'] } });
  const anyTarget = { id: 't0', kind: 'objectOrPlayer' as const, min: 1, max: 1, text: 'target creature or player', filter: { types: ['Creature'] } };
  const graveyardCreature = { id: 't1', kind: 'object' as const, min: 1, max: 1, text: 'target creature card in a graveyard', filter: { zone: 'graveyard' as const, types: ['Creature'] } };

  it('baseline: both players are offered', () => {
    expect(targetOptions(s, anyTarget, 'p1').players).toEqual(['p1', 'p2']);
  });

  it('a veto on one player removes that player from the options, and the hook is asked with the player id, the source and the controller', () => {
    const asked: string[] = [];
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    withStatics(
      {
        canBeTargeted: (_g, target, source, controller) => {
          asked.push(`${target}|${source}|${controller}`);
          return target === 'p2' ? veto('Test: you have hexproof.', 'CR 702.11b') : null;
        },
      },
      () => {
        expect(targetOptions(s, anyTarget, 'p1', bears).players).toEqual(['p1']);
        expect(asked).toContain(`p2|${bears}|p1`);
      },
    );
  });

  it("objects in other zones (a graveyard card) are asked too; the keyword provider gives a hexproof card in a graveyard no protection (CR 113.6)", () => {
    const scout = find(s, 'Gladecover Scout', 'graveyard');
    const bears = find(s, 'Grizzly Bears', 'graveyard');
    expect(targetOptions(s, graveyardCreature, 'p1').objects.sort()).toEqual([bears, scout].sort());
    withStatics({ canBeTargeted: (_g, target) => (target === bears ? veto("Test: can't be the target.", 'CR 115') : null) }, () => {
      expect(targetOptions(s, graveyardCreature, 'p1').objects).toEqual([scout]);
    });
  });
});
