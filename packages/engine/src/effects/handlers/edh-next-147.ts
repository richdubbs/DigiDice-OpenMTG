/**
 * edh-next-147 (must-finish round, group "other"): op handlers in a table of their own (design 5.2: `op:<op>` is a capability because it has a handler here AND a renderer).
 * Ops: putSticker (CR 123.3, 123.6; _____ Goblin: "you may put a name sticker on it").
 */
import { charsOfObject } from '../../rules/characteristics';
import { nameWords, stickeredName, uniqueVowels } from '../../statics/stickers';
import type { OpHandlers } from '../api';
import { STICKER_VOWELS_VAR } from '../eval';
import { resolveObjs, resolvePlayers } from '../refs';
import { did, NOTHING } from './zones-util';

export const EDH_N147_HANDLERS: OpHandlers = {
  /**
   * CR 123.3, 123.3a-b, 123.6b: the player chooses one of the name stickers they have access to (CR 123.2c) that is on no object they own, and puts it on the object: its
   * controller chooses after how many of the words of its name the sticker's words go (the beginning, after any number of words, CR 123.6b), and the new name is announced.
   * Nothing happens when the player does not own the object (CR 123.3b), it is no longer where the reference found it, or no sticker is left. The sticker's unique vowels
   * are kept for `{q:'stickerVowels'}` (CR 123.6e).
   */
  putSticker: (cx, step) => {
    const g = cx.g;
    cx.vars.set(STICKER_VOWELS_VAR, 0);
    const [p] = resolvePlayers(cx, step.who);
    const targets = resolveObjs(cx, step.on);
    if (p === undefined || targets.length !== 1) return NOTHING;
    const h = targets[0]!;
    const o = g.s.objects[h.id];
    if (o === undefined || o.zone !== h.zone || o.kind === 'ability') return NOTHING;
    if (o.owner !== p) {
      g.log(`${g.player(p).name} can't put a sticker on ${g.nameOf(o.id)}, which they don't own.`, { rules: ['CR 123.3b'], level: 'info' });
      return NOTHING;
    }
    const used = new Set(Object.values(g.s.objects).filter((x) => x.owner === p).flatMap((x) => (x.nameStickers ?? []).map((st) => st.id)));
    const free = (g.player(p).stickers ?? []).filter((st) => !used.has(st.id));
    if (free.length === 0) {
      g.log(`${g.player(p).name} has no name sticker left to put on ${g.nameOf(o.id)}.`, { rules: ['CR 123.3', 'CR 123.2c'], level: 'info' });
      return NOTHING;
    }
    const pick = free.length === 1 ? [free[0]!.id] : g.choose({
      kind: 'chooseOption', player: p, prompt: `Choose a name sticker to put on ${g.nameOf(o.id)}.`, min: 1, max: 1, rules: ['CR 123.3', 'CR 123.3a'],
      options: free.map((st) => ({ id: st.id, label: `${st.text} (${uniqueVowels(st.text)} unique vowel${uniqueVowels(st.text) === 1 ? '' : 's'})` })),
    }).ids;
    const sticker = free.find((st) => st.id === pick[0]) ?? free[0]!;
    const name = charsOfObject(g.s, o).name;
    const n = nameWords(name);
    const positions = Array.from({ length: n + 1 }, (_, at) => at);
    const chooser = o.zone === 'battlefield' || o.zone === 'stack' ? o.controller : o.owner;
    const at = positions.length === 1 ? 0 : Number(g.choose({
      kind: 'chooseOption', player: chooser, prompt: `Where in the name of ${name} does "${sticker.text}" go?`, min: 1, max: 1, rules: ['CR 123.6b'],
      options: positions.map((k) => ({ id: String(k), label: stickeredName(name, sticker.text, k) })),
    }).ids[0] ?? 0);
    o.nameStickers = [...(o.nameStickers ?? []), { id: sticker.id, text: sticker.text, at: Number.isInteger(at) && at >= 0 && at <= n ? at : 0 }];
    cx.vars.set(STICKER_VOWELS_VAR, uniqueVowels(sticker.text));
    g.log(`${g.player(p).name} puts the name sticker "${sticker.text}" on ${name}: it is now named ${charsOfObject(g.s, o).name}.`, { rules: ['CR 123.3', 'CR 123.6', 'CR 123.6b'], level: 'action' });
    return did(1);
  },
};
