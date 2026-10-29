/** The board's read model (pure helpers over a GameView). */
import { getChars, isSummoningSick, viewFor, type LegalAction } from '@openmtg/engine';
import { describe, expect, it } from 'vitest';
import { battlefieldRows, playableObjects, seating, stackItems } from '../../src/board';
import { attachmentsOf, charsOf, objectName, permanentInfo, stateOfView } from '../../src/board/model';
import { ALICE, BOB, editable, playGame } from './fixtures';

const game = playGame(5, undefined, (s) => s.zones.stack.length > 0);

describe('board model', () => {
  it('CR 605.3a: objects with only mana abilities are mana sources, not playable', () => {
    const legal: LegalAction[] = [
      { action: { type: 'pass', player: ALICE }, kind: 'pass', label: 'Pass', isMana: false },
      { action: { type: 'activate', player: ALICE, source: 'o1', ability: 'r:basic:G' }, kind: 'activate', label: 'G', isMana: true, object: 'o1' },
      { action: { type: 'cast', player: ALICE, card: 'o2' }, kind: 'cast', label: 'Cast', isMana: false, object: 'o2' },
      { action: { type: 'activate', player: ALICE, source: 'o2', ability: 'p:0:0' }, kind: 'activate', label: 'Mana', isMana: true, object: 'o2' },
    ];
    const { playable, manaOnly } = playableObjects(legal);
    expect([...playable]).toEqual(['o2']);
    expect([...manaOnly]).toEqual(['o1']);
  });

  it('seating: the viewer at the bottom; a spectator view puts the active player at the bottom', () => {
    const c = game.captured.find((x) => x.turn === 2)!;
    expect(seating(viewFor(c.state, ALICE)).bottom.id).toBe(ALICE);
    expect(seating(viewFor(c.state, BOB)).top.map((p) => p.id)).toEqual([ALICE]);
    expect(seating(viewFor(c.state, null)).bottom.id).toBe(c.state.turn.activePlayer);
  });

  it('CR 303.4: an Aura attached to a permanent is listed with its host, not in a row of its own', () => {
    const c = game.captured.find((x) => x.turn === 5 && x.step === 'main1')!;
    const v = editable(c.view);
    const [land, bear] = [v.zones.battlefield.find((id) => v.objects[id]!.controller === ALICE && v.defs[v.objects[id]!.defId]!.name === 'Forest')!,
      v.zones.battlefield.find((id) => v.objects[id]!.controller === ALICE && v.defs[v.objects[id]!.defId]!.name === 'Test Bear')!];
    v.objects[land] = { ...v.objects[land]!, attachedTo: bear };
    const rows = battlefieldRows(v, ALICE);
    expect(rows.lands.map((p) => p.id)).not.toContain(land);
    expect(rows.creatures.find((p) => p.id === bear)!.attachments).toEqual([land]);
  });

  it('CR 405.2: stack items come top first', () => {
    const k = game.kept[0]!;
    const items = stackItems(k.view);
    expect(items.map((i) => i.id)).toEqual([...k.view.zones.stack].reverse());
    expect(items[0]!.kind).toBe('spell');
  });

  // Review 2026-10-26, Finding 19: the read model is kept per view, computed in one engine scope; the answers are the engine's own.
  it('per-view memo: the same answers as asking the engine object by object, once per view', () => {
    let checked = 0;
    for (const c of [...game.captured.filter((_, i) => i % 7 === 0), ...game.kept]) {
      const v = c.view;
      const fresh = stateOfView(editable(v));
      for (const o of Object.values(v.objects)) {
        const chars = charsOf(v, o);
        if (chars === null) continue;
        expect(chars).toEqual(getChars(fresh, o.id));
        expect(charsOf(v, o)).toBe(chars);
        checked++;
        if (o.zone !== 'battlefield') continue;
        const info = permanentInfo(v, o);
        expect(permanentInfo(v, o)).toBe(info);
        expect(info.summoningSick).toBe(isSummoningSick(fresh, fresh.objects[o.id]!, getChars(fresh, o.id)));
        expect(info.name).toBe(objectName(v, o.id));
      }
      expect(stackItems(v)).toBe(stackItems(v));
      expect(battlefieldRows(v, ALICE)).toBe(battlefieldRows(v, ALICE));
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('CR 301.5, 303.4: the attachment index lists what is attached to each permanent, in battlefield order', () => {
    const c = game.captured.find((x) => x.turn === 5 && x.step === 'main1')!;
    const v = editable(c.view);
    const mine = v.zones.battlefield.filter((id) => v.objects[id]!.controller === ALICE);
    const forests = mine.filter((id) => v.defs[v.objects[id]!.defId]!.name === 'Forest');
    const bear = mine.find((id) => v.defs[v.objects[id]!.defId]!.name === 'Test Bear')!;
    for (const f of forests.slice(0, 2)) v.objects[f] = { ...v.objects[f]!, attachedTo: bear };
    expect(attachmentsOf(v, bear)).toEqual(v.zones.battlefield.filter((id) => v.objects[id]?.attachedTo === bear));
    expect(attachmentsOf(v, bear)).toHaveLength(2);
    expect(attachmentsOf(v, forests[0]!)).toEqual([]);
    expect(permanentInfo(v, v.objects[bear]!).attachments).toEqual(forests.slice(0, 2));
  });
});
