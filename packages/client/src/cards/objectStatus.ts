/**
 * M6-11 (docs/design/m6-replacement-copy-faces.md section 5 "M6-11", 3.4, 3.6, 3.7): what a player may read about a game object beyond its card picture, from
 * a `GameView` only (the client never sees a raw state): how a face-down permanent or spell is shown (CR 708), which face of a double-faced card is up
 * (CR 712), what a melded permanent is (CR 712.4a), a Saga's chapter (CR 714), a Class's level (CR 716), a leveler's level (CR 711), a Case's solved state
 * (CR 719.3b), a prototyped permanent (CR 718.3b) and a prepared one (CR 722.3). Pure functions, shared by the board (markers, zoom, stack) and the prompts
 * (names), so both say the same thing.
 *
 * Face down (CR 708.5): a viewer who may not look at a face-down permanent or spell gets it with one of the engine's pseudo-definitions
 * (`FACE_DOWN_DEF_IDS`: a nameless 2/2 creature, ward {2} for disguise and cloak) and `faceDownInfo.by` = the public method (a megamorph is announced as a
 * morph, CR 702.37b-c). Nothing here can name the hidden card: the view does not have it. The controller's view has the real definition, so the real name is
 * shown to them (and to everybody once the engine reveals it, CR 708.9).
 */
import { FACE_DOWN_DEF_IDS, formatManaCost, type AbilityDef, type CardDef, type FaceDownInfo, type GameObject, type GameView } from '@openmtg/engine';

const PSEUDO: ReadonlySet<string> = new Set(Object.values(FACE_DOWN_DEF_IDS));

/** CR 708.5, m6 design D7: the object is shown with a face-down pseudo-definition (the viewer may not look at it): its real card is not in the view. */
export const isFaceDownProfile = (o: Pick<GameObject, 'defId'>): boolean => PSEUDO.has(o.defId);

/** A face-down permanent or spell (CR 708.2): face-down status means nothing in a hand or library (CR 708.2a), and a card exiled face down is no permanent. */
export const isFaceDownObject = (o: Pick<GameObject, 'faceDown' | 'zone'>): boolean => o.faceDown === true && (o.zone === 'battlefield' || o.zone === 'stack');

const HOW: Record<FaceDownInfo['by'], { text: string; rule: string }> = {
  morph: { text: 'morph', rule: 'CR 702.37' },
  megamorph: { text: 'megamorph', rule: 'CR 702.37b' },
  disguise: { text: 'disguise', rule: 'CR 702.168' },
  manifest: { text: 'manifested', rule: 'CR 701.40' },
  cloak: { text: 'cloaked', rule: 'CR 701.58' },
  effect: { text: 'turned face down', rule: 'CR 708.2' },
};

/** How it came to be face down (CR 708.6: public), as the viewer's view says it: "morph", "disguise", "manifested", "cloaked"; null when the view does not say. */
export function faceDownHow(o: Pick<GameObject, 'faceDownInfo'>): string | null {
  const by = o.faceDownInfo?.by;
  return by ? (HOW[by]?.text ?? null) : null;
}

/** The rule behind `faceDownHow` (for a tooltip). */
export function faceDownRule(o: Pick<GameObject, 'faceDownInfo'>): string {
  const by = o.faceDownInfo?.by;
  return by ? (HOW[by]?.rule ?? 'CR 708') : 'CR 708';
}

/** The real card's name of a face-down object the viewer may look at (their own, or one revealed, CR 708.5, 708.9); null for a pseudo-definition. */
export function faceDownRealName(view: GameView, o: GameObject): string | null {
  if (isFaceDownProfile(o)) return null;
  const def = view.defs[o.defId];
  if (!def) return null;
  return def.faces[o.face]?.name || def.name || null;
}

/**
 * The display name of a face-down permanent or spell (CR 708.2a: it has no name): "Face-down 2/2 creature (morph)" for another player's, "Face-down 2/2
 * creature (Grinning Demon, megamorph)" for the viewer's own, "Face-down creature spell (disguise)" on the stack. `pt` is its power and toughness after the
 * layers when the caller knows them (a face-down creature under an anthem is a 3/3).
 */
export function faceDownName(view: GameView, o: GameObject, pt?: { power?: number | string; toughness?: number | string } | null): string {
  const bits = [faceDownRealName(view, o), faceDownHow(o)].filter((b): b is string => !!b);
  const what =
    o.zone === 'stack'
      ? 'Face-down creature spell'
      : pt && pt.power !== undefined && pt.toughness !== undefined
        ? `Face-down ${pt.power}/${pt.toughness} creature`
        : 'Face-down creature';
  return bits.length > 0 ? `${what} (${bits.join(', ')})` : what;
}

// ---- layouts and double-faced cards ------------------------------------------------------------------------------------------------------

/** One line of status about an object (a marker on the board, a line in the zoom). `rule`: the rule it follows, for the tooltip. */
export interface StatusLine {
  key: string;
  text: string;
  rule: string;
}

/** Layouts with two printed sides whose back face can be up on the battlefield or the stack (CR 712.1). */
const DOUBLE_FACED: ReadonlySet<string> = new Set(['transform', 'modal_dfc', 'double_faced_token']);

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
/** Chapter numbers as printed on Sagas (CR 714.2a: roman numerals). */
export const roman = (n: number): string => ROMAN[n] ?? String(n);

/** The face of a visible object that is up (the engine's `faceIndexOf`): the cast face on the stack, the face up on the battlefield, the front face elsewhere. */
export function faceUp(def: CardDef, o: Pick<GameObject, 'zone' | 'face' | 'flipped' | 'stack'>): number {
  const last = Math.max(0, def.faces.length - 1);
  if (o.zone === 'stack') return Math.min(o.stack?.face ?? o.face, last);
  if (o.zone === 'battlefield') return def.layout === 'flip' ? (o.flipped && last >= 1 ? 1 : 0) : Math.min(o.face, last);
  return 0;
}

/** True for a double-faced card whose other face a player may want to look at (CR 712.1, 712.8): transforming and modal double-faced cards. */
export const hasOtherFace = (def: CardDef): boolean => DOUBLE_FACED.has(def.layout) && def.faces.length === 2;

function abilitiesOf(def: CardDef, face: number): AbilityDef[] {
  return def.faces[face]?.abilities ?? [];
}

/** CR 714.2a: the highest chapter number among a Saga face's chapter abilities (0 when it has none the engine knows). */
export function finalChapter(def: CardDef, face: number): number {
  let n = 0;
  for (const a of abilitiesOf(def, face)) if (a.kind === 'chapter') for (const c of a.chapters) n = Math.max(n, c);
  return n;
}

/**
 * The names of the cards and tokens a melded (or merged) permanent is represented by (CR 712.4a, 730.2), or null when the view does not carry every one's
 * definition (the engine's view sends the definitions of visible objects; a component's own definition is not one of them unless another visible object
 * uses it). A face-down component is never named (CR 730.2e, 708.5).
 */
function componentNames(view: GameView, o: GameObject): string[] | null {
  const names = (o.components ?? []).map((c) => (c.faceDown ? 'a face-down card' : view.defs[c.defId]?.name));
  return names.every((n): n is string => n !== undefined) ? names : null;
}

/**
 * The layout and double-faced states of a visible object on the battlefield or the stack (m6 design 3.6, 3.7). A face-down object has none (CR 708.2a: a
 * nameless 2/2 with no abilities, whatever its card is).
 */
export function statusLines(view: GameView, o: GameObject): StatusLine[] {
  if (o.faceDown || (o.zone !== 'battlefield' && o.zone !== 'stack')) return [];
  const def = view.defs[o.defId];
  if (!def) return [];
  const face = faceUp(def, o);
  const out: StatusLine[] = [];
  if (hasOtherFace(def)) {
    const other = def.faces[1 - face]?.name ?? '';
    out.push(
      face === 1
        ? { key: 'dfc', text: `Back face up (front: ${other})`, rule: 'CR 712.8e: its back face\'s characteristics apply; point at it to see both faces' }
        : { key: 'dfc', text: `Front face up (back: ${other})`, rule: 'CR 712.8d: its front face\'s characteristics apply; point at it to see both faces' },
    );
  }
  if (o.components && o.components.length > 1) {
    const names = componentNames(view, o);
    const melded = def.meld?.isResult === true || def.layout === 'meld';
    out.push({
      key: 'components',
      text: names
        ? `${melded ? 'Melded' : 'Merged'} from ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
        : `${melded ? 'Melded' : 'Merged'}: one permanent, ${o.components.length} cards`,
      rule: melded ? 'CR 712.4a, 712.8g: one permanent represented by both cards' : 'CR 730.2: one permanent represented by all of its cards',
    });
  }
  if (o.zone === 'battlefield') {
    const final = finalChapter(def, face);
    if (final > 0) {
      const lore = o.counters['lore'] ?? 0;
      out.push({
        key: 'saga',
        text: lore > 0 ? `Chapter ${roman(Math.min(lore, final))} of ${roman(final)}` : `No chapter yet (final: ${roman(final)})`,
        rule: 'CR 714.2-714.4: a chapter ability triggers when lore counters reach its number; a lore counter is added in each of your precombat main phases; the Saga is sacrificed after its final chapter (CR 704.5s)',
      });
    }
    const classLevels = abilitiesOf(def, face).filter((a): a is Extract<AbilityDef, { kind: 'classLevel' }> => a.kind === 'classLevel');
    if (classLevels.length > 0 || def.layout === 'class') {
      const top = Math.max(1, ...classLevels.map((a) => a.level));
      out.push({ key: 'class', text: `Level ${o.classLevel ?? 1} of ${top}`, rule: 'CR 716.2: a Class gains its next level with its level-up ability, at sorcery speed (CR 716.2a); level 1 without one (CR 716.2d)' });
    }
    const brackets = abilitiesOf(def, face).filter((a): a is Extract<AbilityDef, { kind: 'levelBracket' }> => a.kind === 'levelBracket');
    if (brackets.length > 0) {
      const level = o.counters['level'] ?? 0;
      const b = brackets.find((x) => level >= x.min && (x.max === null || level <= x.max));
      out.push({
        key: 'leveler',
        text: `Level ${level}${b ? ` (LEVEL ${b.min}${b.max === null ? '+' : `-${b.max}`})` : ''}`,
        rule: 'CR 711.2: the bracket its level counters are in gives its power, toughness and abilities',
      });
    }
    if (def.layout === 'case' || abilitiesOf(def, face).some((a) => a.kind === 'case')) {
      out.push(o.solved ? { key: 'case', text: 'Solved', rule: 'CR 719.3b-c: its "Solved" abilities work' } : { key: 'case', text: 'Not solved', rule: 'CR 719.3a: checked at the beginning of your end step' });
    }
    if (o.prepared) out.push({ key: 'prepared', text: 'Prepared', rule: 'CR 722.3a: its controller may cast the copy of its prepare spell in exile' });
    // FAST5X E3: the saddled designation (CR 702.171b)
    if (o.saddled) out.push({ key: 'saddled', text: 'Saddled', rule: 'CR 702.171b: saddled until end of turn or until it leaves the battlefield' });
    // FAST5X E8: the doors of a Room (CR 709.5c): which halves are unlocked; a locked door has no name, mana cost or rules text on the battlefield (CR 709.5)
    if (def.layout === 'split' && def.faces.length > 1 && def.faces.every((f) => f.subtypes.includes('Room')) && !o.faceDown) {
      const open = new Set(o.unlocked ?? []);
      const doors = def.faces.map((f, i) => `${f.name} ${open.has(i) ? 'unlocked' : 'locked'}`);
      out.push({
        key: 'room',
        text: open.size >= def.faces.length ? 'Fully unlocked' : doors.join(', '),
        rule: 'CR 709.5c-e: a locked door has no name, mana cost or rules text; as a sorcery, its controller may pay the mana cost of a locked door to unlock it',
      });
    }
    // FAST5X E12: the suspected designation (CR 701.60a-c)
    if (o.suspected !== undefined) out.push({ key: 'suspected', text: 'Suspected', rule: 'CR 701.60c: it has menace and "This creature can\'t block" for as long as it\'s suspected' });
  }
  if (o.prototyped) {
    const p = def.faces[0]?.prototype;
    out.push({
      key: 'prototype',
      text: p ? `Prototyped (${formatManaCost(p.manaCost)} ${p.power}/${p.toughness})` : 'Prototyped',
      rule: 'CR 718.3b: it has the prototype\'s mana cost, power, toughness and colors',
    });
  }
  return out;
}

/** CR 722.3c: a card in exile that is the copy of a prepared permanent's prepare spell, with that permanent's name; null for any other object. */
export function preparedCopyOf(view: GameView, o: GameObject): string | null {
  if (!o.preparedFor) return null;
  const p = view.objects[o.preparedFor];
  const def = p ? view.defs[p.defId] : undefined;
  return def?.name ?? 'a prepared permanent';
}
