/**
 * The board's animator (ui/arena): plays one change's plan (plan.ts) on the real board, MTG Arena style.
 *
 * Part A, on the board as it was: spells cast and finished inside the change fly from the hand to the stack; resolving spells and abilities flare and send
 * their effect at their targets (fire, lightning, arcane light, shadow, leaves, radiance: vfx.ts); in combat every creature that deals damage rises off the
 * table and swings into what it hits (CR 510.2: all at once), with a hit-stop, a recoil of the target and a screen shake scaled by the damage (shake.ts).
 * Then the new view is shown. Part B: cards that left play their exit from where they were (destroyed cards shatter, exiled ones vanish into light,
 * returned ones fly to the hand, finished spells to the graveyard), cards that arrived fly in from where they came (cast to the stack, played or resolved
 * onto the table with a landing, drawn from the library), the rest slide to their new places, life totals pop, and a banner marks a new turn.
 *
 * Card pictures are only ever moved, turned or scaled, never filtered or covered: glows are box shadows outside the picture, impacts on cards are drawn on
 * the canvas behind the cards, and a card drawn with a Scryfall image never shatters (its exits keep the whole picture, ARCHITECTURE.md "Card images").
 *
 * Only transforms and opacity are animated, so the browser moves layers it already painted instead of painting again on every frame. A shadow or a glow
 * is painted once on a layer of its own behind the picture (dom.ts glowLayer) and fades in and out; a ghost's shadow growing as it rises is its rest,
 * lift and high shadows crossfading (animateGhost). Everything is measured in one pass before anything is written (a measurement after a write makes the
 * browser lay the page out again at once): at the start of a change, and one frame after the new view is committed.
 *
 * Sound (docs/design/sound.md): each beat makes its sound (sounds.ts names them), panned to where it happens and timed with the animation's own delays;
 * what the change did without a visual (taps, shuffles, a lock-on ...) sounds when the new view is shown. A sound problem never breaks or delays a change,
 * and nothing more sounds once a change is cut short.
 */
import type { GameEvent, GameObject, GameView, ObjectId, PlayerId } from '@openmtg/engine';
import { SOUND_META, type SoundId, type SoundMeta } from '../../audio/catalog';
import type { SoundPlayer } from '../../audio/engine';
import { soundClock, type SoundCue } from '../../game/sound';
import type { EventBatch } from '../../connection/GameConnection';
import type { BoardAnimator } from '../../connection/PacedConnection';
import type { StagedStack } from '../GameBoard';
import { charsOf } from '../model';
import { creditElement } from '../../cards/ArtistCredit';
import {
  chunkPolygons, dropGlows, ghostUnder, glowHost, glowLayer, makeGhost, pictureArtist, picturePending, snapshotBoard, targetBox, type Box, type BoardSnapshot,
  type CardEntry,
} from './dom';
import { planBatch, planIsEmpty, spellStyle, totalDamage, type Hit, type LifeChange, type Move, type Plan, type SpellStyle, type StepA } from './plan';
import { recoilFor, shakeFor, shakeKeyframes, shakeLevel } from './shake';
import { stackDepths, stackPace } from './stackPace';
import {
  alignAccent, arrivalSound, bannerSound, castSound, counterGood, damageGain, eventCues, exitCue, hitSound, impactSound, landsPlayed, manaSound, panFor,
} from './sounds';
import type { Vfx } from './vfx';

export interface AnimatorParts {
  /** The `.game-board`. */
  root: HTMLElement;
  /** What shakes: the table with its cards (`[data-fx="arena"]`). */
  arena: HTMLElement;
  /** Where ghosts, floating numbers and banners go (covers the whole board). */
  layer: HTMLElement;
  /** Canvas behind the cards (impacts on cards, dust) and above everything (flights, discs). */
  under: Vfx;
  over: Vfx;
  /** Animation time scale (Settings: fast < 1 < slow), read at every change. */
  scale: () => number;
  /** Where the sounds go (game/sound.ts gamePlayer); without it the animation is silent. */
  sound?: SoundPlayer;
  /** Draw these objects on the board's stack over the view on screen (GameBoard StagedStack); resolves once they are drawn. */
  stage?: (s: StagedStack | null) => Promise<void>;
}

const SHADOW_REST = '0 4px 8px rgba(0,0,0,0.55)';
const SHADOW_LIFT = '0 26px 34px rgba(0,0,0,0.6), 0 0 22px rgba(255,255,255,0.18)';
/** A card high off the table: a long, soft shadow far below it. */
const SHADOW_HIGH = '0 46px 50px rgba(0,0,0,0.62), 0 0 26px rgba(255,255,255,0.22)';
type Shadow = 'rest' | 'lift' | 'high';
const SHADOWS: Readonly<Record<Shadow, string>> = { rest: SHADOW_REST, lift: SHADOW_LIFT, high: SHADOW_HIGH };

/**
 * One keyframe of a ghost (animateGhost): its transform (and opacity), which shadow lies under it, and how strongly each of its glows shows (0 to 1, by
 * the glow's key). A shadow or glow a frame does not name is out at that frame.
 */
interface GhostFrame {
  transform?: string;
  opacity?: number;
  offset?: number;
  easing?: string;
  shadow?: Shadow;
  glow?: Readonly<Record<string, number>>;
}

/** How long the animator waits for the frame after the new view is committed before measuring it anyway (ms; a hidden page draws no frames). */
const FRAME_LIMIT_MS = 100;

/** Pixels a card must have moved to slide to its new place. */
const MOVED_PX = 3;
/**
 * A card the viewer draws is shown large before it goes into the hand: the whole flight (ms, before the speed setting), about
 * 0.6 s of it held still to be read; the next drawn card follows this much later. A change that draws more than a few cards (an opening hand) just deals them.
 */
const SHOWN_DRAW_MS = 1500;
const SHOWN_DRAW_GAP_MS = 520;
const MAX_SHOWN_DRAWS = 3;

/**
 * A card drawn into the hand fanned along the bottom edge (the viewer's own; in a replay's open view, the bottom seat's), face up there. Another
 * player's draw arrives as a card back (zone 'back'), or in the open view face up in their hand at their own edge, and is not shown large.
 */
function isOwnDraw(m: Move, after: BoardSnapshot): boolean {
  if (m.from !== 'library' || m.to !== 'hand' || m.newId === null) return false;
  const dest = after.cards.get(m.newId);
  return dest?.zone === 'hand' && dest.el.closest('.hand-own') !== null;
}
/**
 * How long a spell or ability that came and went inside one change (every player passed at once: the smart auto-pass) stands on the stack before it
 * resolves (ms, before the speed setting): the player's own a beat, another player's long enough to read it and see what it targets.
 */
const OWN_DWELL_MS = 450;
const THEIR_DWELL_MS = 1300;
/** The glow on what a spell on the stack targets while it waits there. */
const TARGET_GLOW = 'rgba(255,92,92,0.95)';

function center(b: Box): { x: number; y: number } {
  return { x: b.x, y: b.y };
}

export class Animator implements BoardAnimator {
  private gen = 0;
  private readonly anims = new Set<Animation>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly wakers = new Set<() => void>();
  private readonly hidden = new Set<HTMLElement>();
  private readonly ghosts = new Set<HTMLElement>();
  /** Ghost cards standing in for spells that came and went inside this change (cast, then resolved). */
  private readonly transient = new Map<ObjectId, { ghost: HTMLElement; box: Box }>();
  /** The resolving spell's card while it lets its effect go (it flares as the effect leaves it). */
  private launcher: HTMLElement | null = null;
  /** The player looking at the board in the change being played. */
  private viewer: PlayerId | null = null;
  /** The views before and after the change being played. */
  private views: readonly [GameView, GameView] | null = null;
  /** What this change stood on the stack for a moment (stageOnStack). */
  private staged: GameObject[] = [];
  /** Card backs taken out of a hidden hand while their spell stood on the stack: the new view draws that hand itself. */
  private stagedBacks: HTMLElement[] = [];
  private k = 1;
  /** The player's animation speed for this change (Settings, `scale()`); `k` is this times the stack's pace (stackPace.ts). */
  private base = 1;
  /** The change whose sounds may still play (finish() makes it stale). */
  private soundGen = -1;
  /** The table's span on screen, for panning. */
  private arenaSpan = { left: 0, width: 0 };
  /**
   * The boxes of the fx layer and of the table, measured once per half of a change (not per ghost, floating number or burst): a measurement right after
   * a ghost was added to the page forces a layout every time, which is what stuttered a board wipe. They are forgotten when the view changes and when a change ends.
   */
  private lr: DOMRect | null = null;
  private ar: DOMRect | null = null;
  /** The frame play() waits for after the new view is committed (finish() cancels it). */
  private frame = 0;
  /** Glows lit on the board's own elements (pulse, impact) and how many of their animations are running: each leaves when its last one ends. */
  private readonly lit = new Map<HTMLElement, number>();

  constructor(private readonly p: AnimatorParts) {}

  // ---- plumbing -------------------------------------------------------------------------------------------------------------------

  private ms(n: number): number {
    return Math.round(n * this.k);
  }

  /**
   * Stack acceleration (stackPace.ts): the time scale for what is played next, from the player's speed and how many objects
   * are on the stack now. Above 5 every animation and pause gets shorter with the pile; at 5 or fewer it is the player's speed exactly.
   */
  private pace(stackSize: number): void {
    this.k = Math.max(0.2, this.base * stackPace(stackSize));
    this.p.under.scale = this.k;
    this.p.over.scale = this.k;
  }

  private layerRect(): DOMRect {
    return (this.lr ??= this.p.layer.getBoundingClientRect());
  }

  private arenaRect(): DOMRect {
    return (this.ar ??= this.p.arena.getBoundingClientRect());
  }

  /**
   * A sound at a beat: `delay` animation ms from now (scaled like the animation), panned to the screen x it happens at. Never throws. A sound whose accent
   * comes after its start (catalog `accent`: a release, a shatter) is lined up with the animation's beat (`beat`, seconds at normal speed; by default the
   * accent itself) at any animation speed: started part-way in when the animation is faster, later when it is slower.
   */
  private sound(id: SoundId, at: { delay?: number; gain?: number; x?: number | undefined; beat?: number } = {}): void {
    const cue: SoundCue = { id };
    let delay = at.delay ? this.ms(at.delay) / 1000 : 0;
    const accent = (SOUND_META[id] as SoundMeta).accent;
    if (accent !== undefined && (this.k !== 1 || at.beat !== undefined)) {
      const a = alignAccent(accent, at.beat ?? accent, this.k);
      if (a.offset > 0) cue.offset = a.offset;
      delay += a.delay;
    }
    if (delay > 0) cue.delay = delay;
    if (at.gain !== undefined) cue.gain = at.gain;
    if (at.x !== undefined) cue.pan = panFor(at.x, this.arenaSpan);
    this.cue(cue);
  }

  private cue(c: SoundCue): void {
    if (!this.p.sound || this.gen !== this.soundGen) return;
    try {
      const { id, ...opts } = c;
      this.p.sound.play(id, opts);
    } catch {
      /* a sound must never break an animation */
    }
  }

  private sleep(n: number): Promise<void> {
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        this.timers.delete(t);
        this.wakers.delete(resolve);
        resolve();
      }, this.ms(n));
      this.timers.add(t);
      this.wakers.add(resolve);
    });
  }

  /** Wait for `p`, but never longer than `limit` ms (a hidden tab stops drawing frames; the change must still go on). */
  private within(p: Promise<unknown>, limit: number): Promise<void> {
    return Promise.race([p.then(() => undefined, () => undefined), this.sleep(limit)]);
  }

  private animate(el: Element, frames: Keyframe[], opts: KeyframeAnimationOptions): Promise<void> {
    const opt = { ...opts, duration: this.ms(Number(opts.duration ?? 300)), delay: this.ms(Number(opts.delay ?? 0)) };
    let a: Animation;
    try {
      a = el.animate(frames, opt);
    } catch {
      return Promise.resolve();
    }
    this.anims.add(a);
    return a.finished.then(
      () => {
        this.anims.delete(a);
      },
      () => {
        this.anims.delete(a);
      },
    );
  }

  private hide(el: HTMLElement): void {
    el.style.visibility = 'hidden';
    this.hidden.add(el);
  }

  private show(el: HTMLElement): void {
    el.style.visibility = '';
    el.style.display = '';
    this.hidden.delete(el);
  }

  /** Take an element out of the layout until the change ends (React removes it with the new view; finish() puts it back if not). */
  private collapse(el: HTMLElement): void {
    el.style.display = 'none';
    this.hidden.add(el);
  }

  /**
   * Animate a ghost: the frames' transforms (and opacity) on the ghost, and each of its shadows and glows (dom.ts glowLayer) fading in and out with them,
   * at the same offsets, easings and timing. `glows` paints the glows these frames use (by key); the rest, rest/lift/high, are the shadows.
   */
  private animateGhost(g: HTMLElement, frames: readonly GhostFrame[], opts: KeyframeAnimationOptions, glows: Readonly<Record<string, string>> = {}): Promise<void> {
    const under = ghostUnder(g);
    for (const f of frames) if (f.shadow) glowLayer(under, f.shadow, SHADOWS[f.shadow]);
    for (const [key, shadow] of Object.entries(glows)) glowLayer(under, key, shadow);
    const jobs: Promise<void>[] = [];
    for (const layer of under.querySelectorAll<HTMLElement>(':scope > .fx-glow')) {
      const key = layer.dataset.glow!;
      const fade = frames.map((f) => {
        const k: Keyframe = { opacity: f.shadow === key ? 1 : (f.glow?.[key] ?? 0) };
        if (f.offset !== undefined) k.offset = f.offset;
        if (f.easing !== undefined) k.easing = f.easing;
        return k;
      });
      jobs.push(this.animate(layer, fade, opts));
    }
    if (frames.some((f) => f.transform !== undefined || f.opacity !== undefined)) {
      const own = frames.map((f) => {
        const k: Keyframe = {};
        if (f.transform !== undefined) k.transform = f.transform;
        if (f.opacity !== undefined) k.opacity = f.opacity;
        if (f.offset !== undefined) k.offset = f.offset;
        if (f.easing !== undefined) k.easing = f.easing;
        return k;
      });
      jobs.push(this.animate(g, own, opts));
    }
    return Promise.all(jobs).then(() => undefined);
  }

  /**
   * A glow around an element on the board (a card, a disc, a ghost): `shadow` painted once on a layer behind it (dom.ts glowHost, glowLayer), only its
   * opacity and size animated. The layer leaves the board when its last animation ends.
   */
  private glow(el: HTMLElement, key: string, shadow: string, frames: Keyframe[], opts: KeyframeAnimationOptions): Promise<void> {
    const layer = glowLayer(glowHost(el), key, shadow);
    this.lit.set(layer, (this.lit.get(layer) ?? 0) + 1);
    return this.animate(layer, frames, opts).then(() => {
      const n = (this.lit.get(layer) ?? 1) - 1;
      if (n > 0) this.lit.set(layer, n);
      else {
        this.lit.delete(layer);
        layer.remove();
      }
    });
  }

  /**
   * A text's glow (a life total, a commander damage line): a copy of the text laid over it, its letters clear and only their shadow drawn (painted once),
   * fading in and out while the text itself pops (a text shadow animated on the text was painted again on every frame).
   */
  private textGlow(el: HTMLElement, shadow: string, frames: Keyframe[], opts: KeyframeAnimationOptions): Promise<void> {
    const copy = el.cloneNode(true) as HTMLElement;
    for (const old of copy.querySelectorAll('.fx-text-glow')) old.remove();
    for (const a of [...copy.attributes]) copy.removeAttribute(a.name);
    copy.className = 'fx-text-glow';
    copy.setAttribute('aria-hidden', 'true');
    copy.style.textShadow = shadow;
    el.appendChild(copy);
    this.lit.set(copy, 1);
    return this.animate(copy, frames, opts).then(() => {
      this.lit.delete(copy);
      copy.remove();
    });
  }

  /** One frame (play: after the new view is committed), at most FRAME_LIMIT_MS; at once when the board is not on a visible page. finish() ends it. */
  private nextFrame(): Promise<void> {
    if (!this.p.root.isConnected || typeof requestAnimationFrame !== 'function' || document.visibilityState === 'hidden') return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        if (this.frame) cancelAnimationFrame(this.frame);
        this.frame = 0;
        clearTimeout(t);
        this.timers.delete(t);
        this.wakers.delete(done);
        resolve();
      };
      const t = setTimeout(done, FRAME_LIMIT_MS);
      this.timers.add(t);
      this.wakers.add(done);
      this.frame = requestAnimationFrame(done);
    });
  }

  private ghost(e: CardEntry, at: Box = e, reuse = false): HTMLElement {
    const g = makeGhost(this.p.layer, e, at, reuse, this.layerRect());
    this.ghosts.add(g);
    return g;
  }

  private drop(g: HTMLElement): void {
    g.remove();
    this.ghosts.delete(g);
  }

  finish(): void {
    this.gen++;
    for (const a of [...this.anims]) {
      try {
        a.cancel();
      } catch {
        /* already gone */
      }
    }
    this.anims.clear();
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    for (const w of [...this.wakers]) w();
    this.wakers.clear();
    for (const el of [...this.hidden]) this.show(el);
    for (const g of [...this.ghosts]) this.drop(g);
    for (const l of this.lit.keys()) l.remove();
    this.lit.clear();
    if (this.staged.length > 0) void this.p.stage?.(null);
    this.staged = [];
    this.transient.clear();
    this.launcher = null;
    this.p.under.clear();
    this.p.over.clear();
    delete this.p.root.dataset.fxActive;
    delete this.p.root.dataset.fxPlaying;
    this.lr = this.ar = null;
  }

  // ---- the change ---------------------------------------------------------------------------------------------------------------

  async play(batch: EventBatch, from: GameView, to: GameView, commit: () => Promise<void>): Promise<void> {
    const gen = ++this.gen;
    if (typeof this.p.root.animate !== 'function') {
      await commit();
      return;
    }
    this.base = Math.max(0.2, this.p.scale());
    this.pace(from.zones.stack.length);
    this.lr = this.ar = null;
    this.soundGen = gen;
    // One read pass before anything is written: the table, the fx layer, the canvases (fit only measures; vfx.ts sizes a canvas when it next draws) and
    // the board.
    const span = this.arenaRect();
    this.layerRect();
    for (const v of [this.p.under, this.p.over]) v.fit();
    const before = snapshotBoard(this.p.root);
    this.arenaSpan = { left: span.left, width: span.width };
    const plan = planBatch(batch.events, from, to);
    this.viewer = to.viewer;
    this.views = [from, to];
    this.staged = [];
    this.stagedBacks = [];
    const live = () => this.gen === gen;
    const early: HTMLElement[] = [];
    // M12-4a: the shared table's camera holds still while a change plays (its paths are measured once, m12 design 5.1).
    if (!planIsEmpty(plan)) this.p.root.dataset.fxPlaying = '';
    if (!planIsEmpty(plan)) {
      const depths = stackDepths(plan.a, from.zones.stack.length);
      for (const [i, step] of plan.a.entries()) {
        if (!live()) return;
        this.pace(depths[i]!);
        await this.stepA(step, before, plan);
      }
      if (!live()) return;
      await this.exitsInPlace(plan, before, early);
    }
    if (!live()) return;
    await commit();
    for (const el of this.stagedBacks) this.show(el);
    this.stagedBacks = [];
    delete this.p.root.dataset.fxActive;
    this.lr = this.ar = null;
    // What the change did without a visual of its own sounds as the new view shows it (a tap as the card turns sideways).
    for (const c of eventCues(batch.events, from, to, to.viewer, plan)) this.cue(c);
    // A card that played its exit in place but is still on the table (a replacement kept it there) shows again.
    for (const el of early) if (el.isConnected) this.show(el);
    if (!live()) return;
    // The new view is measured at the next frame, in one read pass before part B writes anything (its ghosts, hidden cards): the layout measured there is
    // the one that frame lays out anyway, and the ghosts are in place before it is drawn, so no arriving card shows at its new place first.
    await this.nextFrame();
    if (!live()) return;
    for (const v of [this.p.under, this.p.over]) v.fit();
    const after = snapshotBoard(this.p.root);
    this.layerRect();
    this.arenaRect();
    this.pace(to.zones.stack.length);
    await this.partB(plan, batch.events, before, after, from, to);
    if (!live()) return;
    for (const { ghost } of this.transient.values()) this.drop(ghost);
    this.transient.clear();
    delete this.p.root.dataset.fxPlaying;
  }

  // ---- part A ---------------------------------------------------------------------------------------------------------------------

  private async stepA(step: StepA, before: BoardSnapshot, plan: Plan): Promise<void> {
    switch (step.kind) {
      case 'cast':
        return this.castTransient(step, before, plan);
      case 'ability':
        return this.abilityFlare(step, before, plan);
      case 'resolve':
        return this.resolve(step, before, plan);
      case 'combat':
        return this.combat(step.hits, step.life, before);
      case 'damage':
        return this.effects(step.hits, step.life, [], step.style, null, before, false);
      case 'life':
        return this.lifeEffects(step.life, before);
      case 'countered':
        return this.countered(step.stackId, before);
      case 'counters':
        return this.counterEffects(step.counters, before);
    }
  }

  /** A spell that came and went inside this change: it flies from where it was cast to the stack and waits there for its resolution. */
  private async castTransient(step: Extract<StepA, { kind: 'cast' }>, before: BoardSnapshot, plan: Plan): Promise<void> {
    const from = step.origin ? before.cards.get(step.origin) : undefined;
    // Another player's hand card is one of their card backs (plan.ts placeUnseen): a copy of it flying to the stack showed a small card back there instead
    // of the spell, so the spell itself is stood on the stack, its card face up.
    const origin = from?.zone === 'back' ? undefined : from;
    const anchor = before.stackAnchor;
    this.sound(castSound(step.style), { x: (from ?? anchor)?.x });
    // From a hand the viewer cannot see (another player's), or from anywhere not on screen: there is no card to fly, so the spell stands on the stack.
    if (!origin || !anchor) {
      // A trail from that player's hand to the stack shows where it was cast from; the card appears on the stack as the trail arrives.
      if (from && anchor) {
        this.p.over.castTrail(step.style, center(from), center(anchor), 460);
        await this.sleep(320);
      }
      if (await this.stageOnStack(step.stackId, step.controller, before, step.style)) await this.dwell(step.stackId, step.controller, before, plan);
      return;
    }
    const g = this.ghost(origin);
    this.hide(origin.image);
    const dx = anchor.x - origin.x;
    const dy = anchor.y - origin.y;
    const s = Math.min(1.6, Math.max(0.8, anchor.w / Math.max(1, origin.w)));
    const end = `translate(${dx}px, ${dy}px) scale(${s}) rotate(0deg)`;
    await this.within(
      this.animateGhost(g, [
        { transform: 'translate(0,0) scale(1)', shadow: 'rest' },
        { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - 60}px) scale(${s * 1.15}) rotate(-4deg)`, shadow: 'lift', offset: 0.55 },
        { transform: end, shadow: 'lift' },
      ], { duration: 420, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'forwards' }),
      1200,
    );
    // Its place on the stack is its own style: what plays on it next (countered, sent to a pile) starts from there.
    this.settle(g, end, { shadow: 'lift' });
    this.transient.set(step.stackId, { ghost: g, box: { x: anchor.x, y: anchor.y, w: origin.w * s, h: origin.h * s } });
    this.p.over.flare(center(anchor), anchor.w, step.style);
    await this.dwell(step.stackId, step.controller, before, plan);
  }

  /** The object as it was on the stack, from the views around this change. */
  private lastKnown(stackId: ObjectId): GameObject | undefined {
    for (const v of this.views ?? []) {
      const o = v.lki[stackId]?.object ?? v.objects[stackId];
      if (o) return o;
    }
    return undefined;
  }

  /**
   * Stand a spell or ability that came and went inside this change on the board's stack (the table's pile and the rail) over the view on screen, and
   * measure it there, so it resolves from the stack like any other. Another player's spell from their hand takes a card back
   * out of that hand. False when it cannot be drawn (no board hook, nothing known about it).
   */
  private async stageOnStack(stackId: ObjectId, controller: PlayerId | null, before: BoardSnapshot, style: SpellStyle): Promise<boolean> {
    const o = this.lastKnown(stackId);
    if (!o || !this.p.stage || !this.views) return false;
    const [from, to] = this.views;
    this.staged.push(o);
    const defs: GameView['defs'] = {};
    for (const s of this.staged) {
      const def = to.defs[s.defId] ?? from.defs[s.defId];
      if (def) defs[s.defId] = def;
    }
    await this.within(this.p.stage({ base: from, objects: [...this.staged], defs }), 400);
    const e = snapshotBoard(this.p.root).stack.get(stackId);
    if (!e) return false;
    before.stack.set(stackId, e);
    if (o.kind !== 'ability' && controller !== null && controller !== this.viewer) {
      const back = [...this.p.root.querySelectorAll<HTMLElement>(`.hand-hidden[data-player-id="${controller}"] .hand-back`)].find((el) => !this.hidden.has(el));
      if (back) {
        this.hide(back);
        this.stagedBacks.push(back);
      }
    }
    this.p.over.flare(center(e), e.w, style);
    this.pulse(e.el, styleGlow(style));
    return true;
  }

  /** A spell or ability that came and went waits on the stack for a moment, what it targets glowing (see OWN_DWELL_MS). */
  private async dwell(stackId: ObjectId, controller: PlayerId | null, before: BoardSnapshot, plan: Plan): Promise<void> {
    const resolving = plan.a.find((x): x is Extract<StepA, { kind: 'resolve' }> => x.kind === 'resolve' && x.stackId === stackId);
    for (const id of resolving?.targets ?? []) {
      const el = before.cards.get(id)?.el ?? before.avatars.get(id)?.el;
      if (el) void this.pulse(el, TARGET_GLOW, 0.6);
    }
    await this.sleep(controller !== null && controller === this.viewer ? OWN_DWELL_MS : THEIR_DWELL_MS);
  }

  /** An ability put on the stack: its source flares and pulses (a triggered one in gold). */
  private async abilityFlare(step: Extract<StepA, { kind: 'ability' }>, before: BoardSnapshot, plan: Plan): Promise<void> {
    const src = step.source ? before.cards.get(step.source) : undefined;
    this.sound(step.triggered ? 'ability.triggered' : 'ability.activated', { x: src?.x });
    if (src) {
      this.p.under.flare(center(src), Math.max(src.w, src.h), step.triggered ? 'trigger' : step.style);
      this.pulse(src.el, step.triggered ? 'rgba(255,214,110,0.95)' : 'rgba(31,184,255,0.95)');
    }
    // One that came and went stands on the stack like a spell: another player's long enough to see its source and what it targets.
    if (step.transient) {
      const controller = this.lastKnown(step.stackId)?.controller ?? null;
      if (await this.stageOnStack(step.stackId, controller, before, step.style)) await this.dwell(step.stackId, controller, before, plan);
    } else if (src) await this.sleep(180);
  }

  /** Glow ring (a box shadow outside the picture, behind it: glow()) and a small pop on a card. */
  private pulse(el: HTMLElement, color: string, strength = 1): Promise<void> {
    // The ring grows out from behind the picture as it lights up.
    void this.glow(el, 'pulse', `0 0 0 3px ${color}, 0 0 26px 6px ${color}`, [
      { opacity: 0, transform: 'scale(0.96)' },
      { opacity: 1, transform: 'scale(1)', offset: 0.35 },
      { opacity: 0, transform: 'scale(1)' },
    ], { duration: 520, easing: 'ease-out' });
    // A ghost pops where it stands (its own transform holds its place).
    const at = el.matches('.fx-ghost') ? `${el.style.transform} ` : '';
    return this.animate(el, [{ transform: `${at}scale(1)` }, { transform: `${at}scale(${1 + 0.09 * strength})`, offset: 0.35 }, { transform: `${at}scale(1)` }], { duration: 420, easing: 'cubic-bezier(.3,1.6,.5,1)' });
  }

  /** The resolving object's element on the stack (or the ghost of a spell that came and went). */
  private resolvingBox(stackId: ObjectId, before: BoardSnapshot): { box: Box; el: HTMLElement | null } | null {
    const t = this.transient.get(stackId);
    if (t) return { box: t.box, el: t.ghost };
    const e = before.stack.get(stackId);
    return e ? { box: e, el: e.el } : null;
  }

  private async resolve(step: Extract<StepA, { kind: 'resolve' }>, before: BoardSnapshot, plan: Plan): Promise<void> {
    // Its targeting arrows fade while it resolves: the spell itself now shows what it does (arena.css).
    if (step.targets.length > 0) this.p.root.dataset.fxActive = '';
    const becomesPermanent = plan.b.moves.some((m) => m.oldId === step.stackId && m.to === 'battlefield');
    // "Executing": an instant, sorcery or ability rising off the stack (a permanent spell is heard landing on the table instead).
    if (!becomesPermanent) this.sound('spell.resolve', { x: this.resolvingBox(step.stackId, before)?.box.x });
    // Arena's resolving spell: an instant or sorcery leaves the stack for the edge of the table, larger and glowing, and its effects come out of it there. A
    // permanent spell flies straight to the table in part B.
    const shown = step.spell && !becomesPermanent ? await this.present(step.stackId, before, step.style) : null;
    const r = shown ?? this.resolvingBox(step.stackId, before);
    if (r?.el && !shown) await this.within(this.pulse(r.el, styleGlow(step.style), 1.2), 600);
    // Effects come out of the source permanent for an ability, out of the spell for a spell.
    const src = step.source ? before.cards.get(step.source) : undefined;
    const origin = src ?? r?.box ?? null;
    if (step.hits.length + step.life.length + step.counters.length + step.targets.length === 0) {
      if (r?.box) this.p.over.flare(center(r.box), r.box.w, step.style);
      await this.sleep(shown ? 280 : 140);
      return;
    }
    await this.effects(step.hits, step.life, step.counters, step.style, origin, before, step.spell, step.targets);
    this.launcher = null;
  }

  /**
   * A spell resolving (CR 608.2): its card comes out of the stack to the edge of the table, grows and glows in its colours, like Arena's resolving spell. Its
   * ghost stays there (as a transient) until part B sends it to its graveyard.
   */
  private async present(stackId: ObjectId, before: BoardSnapshot, style: SpellStyle): Promise<{ box: Box; el: HTMLElement } | null> {
    if (this.transient.has(stackId)) return null;
    const e = before.stack.get(stackId);
    // Spells only (an ability's tile stays where it is): the rail's card or the pile's picture on the table.
    if (!e || e.el.matches('.ability-tile') || e.el.querySelector('.ability-tile')) return null;
    const arena = this.arenaRect();
    // On the pile on the table it rises and grows where it stands, in front of the rest of the stack (Arena); from the rail it comes out to the table's
    // right edge.
    const inPile = e.el.closest('[data-table-stack-id]') !== null;
    // The pile's cards are large already (twice the near creatures' width, board.css): it rises only a little larger.
    const w = inPile ? e.w * 1.12 : Math.min(260, Math.max(e.w * 1.3, arena.width * 0.16));
    const s = w / Math.max(1, e.w);
    const h = e.h * s;
    const to = inPile
      ? { x: e.x - w * 0.1, y: Math.min(arena.bottom - h / 2 - 8, Math.max(arena.top + h / 2 + 8, e.y - 12)) }
      : {
          x: arena.right - w / 2 - Math.max(16, arena.width * 0.03),
          y: Math.min(arena.bottom - h / 2 - 12, Math.max(arena.top + h / 2 + 12, arena.top + arena.height * 0.5)),
        };
    const g = this.ghost(e);
    // It leaves the pile on the table, and its row leaves the rail's list with it (no empty slot left behind).
    this.hide(e.el.closest<HTMLElement>('[data-table-stack-id], [data-stack-id]') ?? e.el);
    const row = this.p.root.querySelector<HTMLElement>(`[data-stack-id="${stackId}"]`);
    if (row) this.collapse(row);
    const glow = styleGlow(style);
    const dx = to.x - e.x;
    const dy = to.y - e.y;
    const end = `translate(${dx}px, ${dy}px) scale(${s})`;
    // Its glow in its colours: brightest as it rises (spellPeak), then the steady one it keeps (spell).
    const glows = { spell: `0 0 0 2px ${glow}, 0 0 30px 8px ${glow}`, spellPeak: `0 0 0 3px ${glow}, 0 0 46px 16px ${glow}` };
    await this.within(
      this.animateGhost(g, [
        { transform: 'translate(0px, 0px) scale(1)', shadow: 'rest' },
        { transform: `translate(${dx}px, ${dy - 18}px) scale(${s * 1.08}) rotate(-2deg)`, shadow: 'high', glow: { spellPeak: 1 }, offset: 0.65 },
        { transform: end, shadow: 'high', glow: { spell: 1 } },
      ], { duration: 380, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'forwards' }, glows),
      900,
    );
    this.settle(g, end, { shadow: 'high', glow: { spell: 1 } });
    this.p.over.flare(to, w, style);
    const box = { x: to.x, y: to.y, w, h };
    this.transient.set(stackId, { ghost: g, box });
    this.launcher = g;
    await this.sleep(140);
    return { box, el: g };
  }

  /**
   * Make the end of a finished animation the element's own style, so the next animation of it starts from there: its transform and, for a ghost, which of
   * its shadows and glows show (`lit`, as in a GhostFrame).
   */
  private settle(el: HTMLElement, transform: string, lit?: GhostFrame): void {
    el.style.transform = transform;
    const layers = el.matches('.fx-ghost') ? [...ghostUnder(el).querySelectorAll<HTMLElement>(':scope > .fx-glow')] : [];
    if (lit) {
      for (const l of layers) {
        const key = l.dataset.glow!;
        l.style.opacity = String(lit.shadow === key ? 1 : (lit.glow?.[key] ?? 0));
      }
    }
    for (const x of [el, ...layers]) {
      for (const a of x.getAnimations?.() ?? []) {
        try {
          a.cancel();
        } catch {
          /* gone */
        }
      }
    }
  }

  /** A spell landing on what it targets without damage: light in its colours behind the card (on top of a disc or a stack entry) and a glow pulse. */
  private touch(id: string, style: SpellStyle, before: BoardSnapshot): void {
    const card = before.cards.get(id);
    const disc = before.avatars.get(id);
    const box = card ?? disc;
    if (!box) return;
    (card && card.zone !== 'stack' ? this.p.under : this.p.over).touch(style, center(box), Math.max(box.w, box.h));
    void this.pulse(card ? card.el : disc!.el, styleGlow(style), 1);
  }

  /**
   * Damage, life and counters coming out of one resolution (or a source): a creature that fights rises and strikes; otherwise each hit is a spell effect
   * flying from `origin` to its target. Impacts land together and shake the table once, by the total damage.
   */
  private async effects(hits: readonly Hit[], life: readonly LifeChange[], counters: readonly { target: string; counter: string; delta: number }[], style: SpellStyle, origin: Box | null, before: BoardSnapshot, spell: boolean, targets: readonly string[] = []): Promise<void> {
    const flights: Promise<void>[] = [];
    const swings: Hit[] = [];
    // The spell flares in its colours as it lets its effect go (its glows only: its ghost keeps its place).
    if (this.launcher && hits.length + targets.length > 0) {
      const glow = styleGlow(style);
      void this.animateGhost(this.launcher, [
        { shadow: 'high', glow: { spell: 1 } },
        { shadow: 'high', glow: { flare: 1 }, offset: 0.25 },
        { shadow: 'high', glow: { spell: 1 } },
      ], { duration: 520, easing: 'ease-out' }, { flare: `0 0 0 4px rgba(255,250,230,0.95), 0 0 70px 26px ${glow}` });
    }
    hits.forEach((h, i) => {
      const src = before.cards.get(h.source);
      // A creature dealing damage because a spell made it (fight, bite): it swings like in combat.
      if (spell && src && src.zone === 'battlefield') {
        swings.push(h);
        return;
      }
      const from = src && src.zone !== 'stack' ? src : (origin ?? src);
      const to = targetBox(before, h.target);
      if (!to) return;
      if (!from) {
        this.impact(h, style, before);
        return;
      }
      // A player's disc is struck at its rim facing the blow, so the life total in its middle stays readable.
      const disc = before.avatars.get(h.target);
      const aim = disc ? this.rimPoint(disc, center(from)) : center(to);
      flights.push(
        this.sleep(i * 70).then(() => {
          this.sound('spell.bolt', { x: from.x });
          return this.within(this.p.over.projectile(style, center(from), aim, shakeLevel(h.amount)), 900).then(() => {
            this.impact(h, style, before, disc ? aim : undefined);
          });
        }),
      );
    });
    // What it targets but does not damage (destroyed, exiled, returned, pumped, tapped, a countered spell): the effect still flies there and lands.
    const struck = new Set(hits.map((h) => h.target));
    targets.forEach((id, i) => {
      const to = targetBox(before, id);
      if (struck.has(id) || !to || !origin) return;
      flights.push(
        this.sleep((hits.length + i) * 70).then(() => {
          this.sound('spell.bolt', { x: origin.x, gain: 0.8 });
          return this.within(this.p.over.projectile(style, center(origin), center(to), 0.15), 900).then(() => {
            this.sound('spell.touch', { x: to.x });
            this.touch(id, style, before);
          });
        }),
      );
    });
    if (swings.length) flights.push(this.combat(swings, [], before, false));
    const total = totalDamage(hits.filter((h) => !swings.includes(h)));
    await Promise.all(flights);
    if (total > 0) this.shake(total);
    await this.lifeEffects(life.filter((l) => !l.byDamage), before);
    await this.counterEffects(counters, before);
    if (flights.length) await this.sleep(160);
  }

  /** A hit landing: the target recoils, light bursts behind it, the damage floats above it. */
  private impact(h: Hit, style: SpellStyle | 'physical', before: BoardSnapshot, at?: { x: number; y: number }): void {
    const card = before.cards.get(h.target);
    const disc = before.avatars.get(h.target);
    const box = card ?? disc;
    // Heard by its weight: a creature's contact hits light to heavy, a spell's effect strikes in its element (and the player's disc takes the blow).
    const onPlayer = !card && disc !== undefined;
    const gain = damageGain(h.amount);
    if (style === 'physical') this.sound(hitSound(h.amount, onPlayer), { gain, x: box?.x });
    else {
      this.sound(impactSound(style), { gain, x: box?.x });
      // The player's own "you were hit" under the spell's element: loud enough to read in a burn spell's sequence (the set review mixed it).
      if (onPlayer) this.sound('hit.player', { gain: 0.75 * gain, x: box?.x });
    }
    if (!box) return;
    const power = shakeLevel(h.amount);
    // On a card: the burst goes on the canvas behind the cards, so it never covers the picture; on a disc (our own art) it goes on top. A blow lands where
    // the two meet (`at`), so its light spills out between them.
    // A disc sits at an edge of the table: its burst is centred a little toward the table, so it is not cut off by the window. The blast goes behind the
    // cards (it spills over the floor, never over a card picture); on a disc (our own art) its heart is drawn on top as well.
    const spot = at ?? (card ? center(box) : this.towardTable(box));
    this.p.under.impact(style, card ? spot : this.inside(spot, 56), power);
    if (!card) this.p.over.core(style, spot, Math.max(box.w, box.h));
    const el = card ? card.el : disc!.el;
    const amp = recoilFor(h.amount);
    // A disc (our own art) is knocked back and swells with the blow; a card only recoils.
    const pop = card ? 1 : 1.1 + power * 0.12;
    void this.animate(el, [
      { transform: 'translate(0,0) scale(1)' },
      { transform: `translate(${amp}px, ${-amp * 0.4}px) rotate(${amp * 0.25}deg) scale(${pop})`, offset: 0.15 },
      { transform: `translate(${-amp * 0.7}px, ${amp * 0.3}px) rotate(${-amp * 0.18}deg) scale(${1 + (pop - 1) * 0.4})`, offset: 0.35 },
      { transform: `translate(${amp * 0.35}px, 0) rotate(0deg) scale(1)`, offset: 0.6 },
      { transform: 'translate(0,0) scale(1)' },
    ], { duration: card ? 300 : 380, easing: 'ease-out' });
    // A red glow flashes around it (behind the picture: glow()).
    void this.glow(card ? card.image : disc!.el, 'hit', '0 0 0 3px rgba(255,90,60,0.95), 0 0 30px 8px rgba(255,70,40,0.75)', [
      { opacity: 0, transform: 'scale(0.96)' },
      { opacity: 1, transform: 'scale(1)', offset: 0.2 },
      { opacity: 0, transform: 'scale(1)' },
    ], { duration: 520, easing: 'ease-out' });
    this.floater(box, `-${h.amount}`, 'damage', h.amount, card !== undefined);
  }

  /** Combat damage: every creature that deals damage rises and swings into its target at once (CR 510.2); the table shakes by the total. */
  private async combat(hits: readonly Hit[], life: readonly LifeChange[], before: BoardSnapshot, shake = true): Promise<void> {
    // The attack and block arrows fade: the creatures themselves now show who hits whom (arena.css).
    this.p.root.dataset.fxActive = '';
    const bySource = new Map<string, Hit[]>();
    for (const h of hits) bySource.set(h.source, [...(bySource.get(h.source) ?? []), h]);
    const swings: Promise<void>[] = [];
    let i = 0;
    let contactAt = 0;
    // A lone creature rises high; in a crowded clash each rises less, one after another, so who hits whom stays readable.
    const crowd = bySource.size;
    const lift = crowd >= 3 ? { up: 1.18, hit: 1.22 } : crowd === 2 ? { up: 1.27, hit: 1.32 } : { up: 1.34, hit: 1.4 };
    for (const [source, list] of bySource) {
      const src = before.cards.get(source);
      const main = [...list].sort((a, b) => b.amount - a.amount)[0]!;
      const tgt = targetBox(before, main.target);
      if (!src || !tgt) {
        for (const h of list) this.impact(h, 'physical', before);
        continue;
      }
      const delay = i++ * 70;
      const dur = 560;
      this.sound('combat.swing', { delay, x: src.x });
      contactAt = Math.max(contactAt, delay + dur * 0.5);
      swings.push(this.swing(src, tgt, delay, dur, lift, (contact) => list.forEach((h) => this.impact(h, 'physical', before, h.target === main.target ? contact : undefined))));
    }
    if (shake) {
      const total = totalDamage(hits);
      void this.sleep(contactAt).then(() => this.shake(total));
    }
    await this.within(Promise.all(swings), 2200);
    await this.lifeEffects(life.filter((l) => !l.byDamage), before);
  }

  /** One creature rising off the table and striking: wind-up, lunge, a short hit-stop at contact, and back to its place. */
  private async swing(src: CardEntry, tgt: Box, delay: number, dur: number, lift: { up: number; hit: number }, onContact: (at: { x: number; y: number }) => void): Promise<void> {
    const g = this.ghost(src);
    g.classList.add('fx-lifted');
    this.hide(src.image);
    const dx = tgt.x - src.x;
    const dy = tgt.y - src.y;
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist;
    const uy = dy / dist;
    const { up, hit } = lift;
    // Half a box's size along the line of the swing.
    const ext = (b: Box, s: number) => (Math.abs(ux) * b.w + Math.abs(uy) * b.h) * 0.5 * s;
    // It stops where its edge meets the target's (a little overlap: contact), so both cards stay in sight.
    const reach = Math.max(0, dist - ext(tgt, 0.85) - ext(src, hit));
    const side = dx >= 0 ? 1 : -1;
    // Where the two meet: the target's edge facing the blow, so the burst spills out between them.
    const contact = { x: tgt.x - ux * ext(tgt, 0.85), y: tgt.y - uy * ext(tgt, 0.85) };
    void this.sleep(delay + dur * 0.5).then(() => onContact(contact));
    await this.animateGhost(g, [
      { transform: 'translate(0px,0px) scale(1) rotate(0deg)', shadow: 'rest', offset: 0 },
      { transform: `translate(${-ux * 22}px, ${-uy * 22 - 28}px) scale(${up}) rotate(${-side * 9}deg)`, shadow: 'high', offset: 0.32, easing: 'cubic-bezier(.6,0,.9,.4)' },
      { transform: `translate(${ux * reach}px, ${uy * reach}px) scale(${hit}) rotate(${side * 10}deg)`, shadow: 'lift', offset: 0.5 },
      { transform: `translate(${ux * (reach - 10)}px, ${uy * (reach - 10)}px) scale(${hit - 0.03}) rotate(${side * 7}deg)`, shadow: 'lift', offset: 0.62, easing: 'cubic-bezier(.25,.8,.3,1)' },
      { transform: 'translate(0px,0px) scale(1) rotate(0deg)', shadow: 'rest', offset: 1 },
    ], { duration: dur, delay, fill: 'both' });
    this.drop(g);
    this.show(src.image);
  }

  /** The point of a disc's rim (a little inside it) facing `from`. */
  private rimPoint(box: Box, from: { x: number; y: number }): { x: number; y: number } {
    const dx = from.x - box.x;
    const dy = from.y - box.y;
    const len = Math.hypot(dx, dy) || 1;
    const r = Math.min(box.w, box.h) * 0.34;
    return { x: box.x + (dx / len) * r, y: box.y + (dy / len) * r };
  }

  /** A point kept at least `margin` px inside the table, so a blast is never cut off by the window's edge. */
  private inside(p: { x: number; y: number }, margin: number): { x: number; y: number } {
    const a = this.arenaRect();
    return { x: Math.min(a.right - margin, Math.max(a.left + margin, p.x)), y: Math.min(a.bottom - margin, Math.max(a.top + margin, p.y)) };
  }

  /** A point of a box (a disc) moved a third of its height toward the middle of the table. */
  private towardTable(box: Box): { x: number; y: number } {
    const arena = this.arenaRect();
    const mid = arena.top + arena.height / 2;
    return { x: box.x, y: box.y + Math.sign(mid - box.y) * box.h * 0.35 };
  }

  private shake(amount: number): void {
    const s = shakeFor(amount);
    if (s.amplitude <= 0) return;
    void this.animate(this.p.arena, shakeKeyframes(s, Math.round(amount * 97)), { duration: s.duration, easing: 'linear' });
    const level = shakeLevel(amount);
    if (level > 0.25) {
      const flash = this.p.root.querySelector('.arena-flash');
      if (flash) void this.animate(flash, [{ opacity: 0 }, { opacity: 0.25 + level * 0.55, offset: 0.12 }, { opacity: 0 }], { duration: 160 + 260 * level, easing: 'ease-out' });
    }
  }

  /** Numbers floating up from what changed: just above a card (never over its picture), above a disc (under one at the top edge). */
  private floater(box: Box, text: string, tone: 'damage' | 'heal' | 'buff' | 'debuff' | 'info', amount = 1, onCard = false): void {
    const lr = this.layerRect();
    const el = document.createElement('div');
    el.className = `fx-float fx-float-${tone}`;
    el.textContent = text;
    // Above a disc, or under one at the top edge of the table (where above would be cut off).
    const under = !onCard && box.y - box.h / 2 - lr.top < 64;
    // A hit on a player (a disc) reads bigger than a hit on a card.
    const size = Math.round(onCard ? 26 + Math.min(20, amount) * 1.3 : 44 + Math.min(20, amount) * 2.2);
    el.style.left = `${box.x - lr.left}px`;
    // Over a disc it stands clear of the blast on it.
    el.style.top = onCard ? `${box.y - lr.top - box.h / 2 - size - 2}px` : under ? `${box.y - lr.top + box.h / 2 + 46}px` : `${box.y - lr.top - box.h / 2 - size * 0.9}px`;
    el.style.fontSize = `${size}px`;
    const tx = '-50%';
    this.p.layer.appendChild(el);
    this.ghosts.add(el);
    void this.animate(el, [
      { transform: `translate(${tx}, 6px) scale(0.6)`, opacity: 0 },
      { transform: `translate(${tx}, -10px) scale(1.15)`, opacity: 1, offset: 0.18 },
      { transform: `translate(${tx}, -22px) scale(1)`, opacity: 1, offset: 0.6 },
      { transform: `translate(${tx}, -40px) scale(0.95)`, opacity: 0 },
    ], { duration: 1000, easing: 'ease-out', fill: 'forwards' }).then(() => this.drop(el));
  }

  private async lifeEffects(life: readonly LifeChange[], before: BoardSnapshot): Promise<void> {
    if (life.length === 0) return;
    const heard = new Set<SoundId>();
    for (const l of life) {
      const disc = before.avatars.get(l.player);
      const id: SoundId | null = l.delta > 0 ? 'life.gain' : l.delta < 0 ? 'life.loss' : null;
      if (id && !heard.has(id)) {
        heard.add(id);
        this.sound(id, { x: disc?.x });
      }
      if (!disc) continue;
      if (l.delta > 0) {
        this.p.over.heal(center(disc), disc.w / 2);
        this.floater(disc, `+${l.delta}`, 'heal', l.delta);
      } else if (l.delta < 0) {
        this.p.over.impact('shadow', center(disc), shakeLevel(-l.delta) * 0.6);
        this.floater(disc, `${l.delta}`, 'damage', -l.delta);
        this.shake(Math.max(1, Math.round(-l.delta / 2)));
      }
    }
    await this.sleep(260);
  }

  private async counterEffects(counters: readonly { target: string; counter: string; delta: number }[], before: BoardSnapshot): Promise<void> {
    if (counters.length === 0) return;
    const heard = new Set<SoundId>();
    for (const c of counters) {
      const box = targetBox(before, c.target);
      const good = counterGood(c.counter, c.delta);
      const id: SoundId = good ? 'counter.up' : 'counter.down';
      if (!heard.has(id)) {
        heard.add(id);
        this.sound(id, { x: box?.x });
      }
      if (!box) continue;
      this.p.under.motes(center(box), Math.max(box.w, box.h), good);
      const card = before.cards.get(c.target);
      if (card) void this.pulse(card.el, good ? 'rgba(130,240,120,0.9)' : 'rgba(240,80,120,0.9)', 0.8);
      this.floater(box, `${c.delta > 0 ? '+' : ''}${c.delta} ${c.counter}`, good ? 'buff' : 'debuff', 1, card !== undefined);
    }
    await this.sleep(240);
  }

  /** A countered spell or ability (CR 701.6): it jolts on the stack and breaks apart. */
  private async countered(stackId: ObjectId, before: BoardSnapshot): Promise<void> {
    const t = this.transient.get(stackId);
    const e = before.stack.get(stackId);
    this.sound('spell.countered', { x: (t?.box ?? e)?.x });
    if (t) {
      // Its place on the stack is its own style (castTransient, present settle it there).
      const at = t.ghost.style.transform;
      await this.animate(t.ghost, [{ transform: at || 'none' }, { transform: `${at} scale(0)`.trim() }], { duration: 300, fill: 'forwards' });
      this.drop(t.ghost);
      this.transient.delete(stackId);
      return;
    }
    if (!e) return;
    this.p.over.impact('force', center(e), 0.3);
    await this.destroyCard(e, e, false);
  }

  /**
   * Permanents destroyed, sacrificed or exiled in this change play their exit where they stand, on the table as it was (after the blow or the spell that
   * caused it); only then does the new view close the gap. Each is marked shown so part B skips it.
   */
  private async exitsInPlace(plan: Plan, before: BoardSnapshot, early: HTMLElement[]): Promise<void> {
    const jobs: Promise<void>[] = [];
    const leaving = plan.b.moves.filter((m) => !m.shownInA && m.from === 'battlefield' && (m.kind === 'die' || m.kind === 'sacrifice' || m.kind === 'exile'));
    // Several at once break one after another (and each a little less brightly), so a crowded clash never melts into one blur.
    const crowd = leaving.length >= 3;
    let n = 0;
    for (const m of leaving) {
      const old = before.cards.get(m.oldId);
      if (!old || old.zone !== 'battlefield' || !old.el.isConnected) continue;
      m.shownInA = true;
      early.push(old.el);
      const delay = n++ * 110;
      jobs.push(
        (async () => {
          if (delay > 0) await this.sleep(delay);
          // One after another, the later ones a little softer: a board wipe is a cascade, not a wall of noise.
          // A Scryfall picture is never cut: it breaks at 0.22 s instead of 0.32 s (destroyCard), so the shatter comes sooner too.
          this.sound(exitCue(m).id, { x: old.x, gain: delay > 0 ? 0.75 : 1, ...(m.kind === 'die' && old.scryfall ? { beat: 0.22 } : {}) });
          const job = m.kind === 'die' ? this.destroyCard(old, old, false, crowd) : m.kind === 'sacrifice' ? this.consume(old) : this.banish(old);
          // The whole card (with its status strip) leaves; its place stays empty until the new view.
          this.hide(old.el);
          await job;
        })(),
      );
    }
    if (jobs.length > 0) await this.within(Promise.all(jobs), 2000);
  }

  // ---- part B ---------------------------------------------------------------------------------------------------------------------

  private async partB(plan: Plan, events: readonly GameEvent[], before: BoardSnapshot, after: BoardSnapshot, from: GameView, to: GameView): Promise<void> {
    const jobs: Promise<void>[] = [];
    const arriving = new Set<string>();
    const consumedOld = new Set<string>();
    let castTarget: Box | null = null;

    // Arrivals: anything shown now that was not on the board before, flying in from where its card was.
    let drawIndex = 0;
    // The viewer's own draws are each shown large on the way to the hand, unless the change draws a whole hand at once.
    const ownDraws = plan.b.moves.filter((m) => isOwnDraw(m, after) && !before.cards.has(m.newId!)).length;
    // Where they are shown is measured here, still in play()'s read pass: the arrivals below add ghosts to the page, and a measurement after that would
    // lay the page out again for every card.
    const room = ownDraws > 0 && ownDraws <= MAX_SHOWN_DRAWS ? this.showcaseRoom() : null;
    let shown = 0;
    const lands = landsPlayed(events);
    for (const m of plan.b.moves) {
      if (m.newId === null) continue;
      const dest = after.cards.get(m.newId);
      if (!dest || before.cards.has(m.newId)) continue;
      const origin = this.originOf(m, before);
      arriving.add(m.newId);
      if (origin) consumedOld.add(m.oldId);
      if (m.to === 'stack') castTarget = dest;
      const spot = origin && room && isOwnDraw(m, after) ? this.showcaseSpot(room, dest, shown) : null;
      const delay = spot ? shown++ * SHOWN_DRAW_GAP_MS : m.to === 'hand' && m.from === 'library' ? drawIndex++ * 90 : 0;
      // A card flying to the table is heard as it lands (0.82 of its 620 ms flight); the other player's draws are softer.
      const heard = arrivalSound(m, to, lands);
      const landing = m.to === 'battlefield' && origin ? 508 : 0;
      if (heard) this.sound(heard, { delay: delay + landing, x: dest.x, ...(m.to === 'hand' && m.owner !== to.viewer ? { gain: 0.6 } : {}) });
      jobs.push(spot && origin ? this.showDraw(dest, origin, spot, delay) : this.arrive(m, dest, origin, delay, to));
    }
    // Mana paid for a spell: orbs from the tapped sources to what they paid for (CR 106.4, 601.2g-h).
    let orbs = 0;
    for (const e of events) {
      if (e.type !== 'manaAdded' || !e.sourceId) continue;
      const src = after.cards.get(e.sourceId) ?? before.cards.get(e.sourceId);
      const dest = castTarget ?? after.avatars.get(e.player) ?? null;
      if (!src || !dest) continue;
      if (orbs < 6) this.sound(manaSound(e.mana[0]), { delay: orbs * 45, x: src.x });
      orbs++;
      jobs.push(this.within(this.p.over.manaOrb(center(src), center(dest), e.mana[0] ?? 'C'), 800));
    }
    // Departures: cards that are gone, playing their exit where they were.
    const departing = plan.b.moves.filter((m) => !m.shownInA && !consumedOld.has(m.oldId) && !(m.newId !== null && after.cards.has(m.newId) && !arriving.has(m.newId)));
    // Three or more breaking at once (a board wipe) take the light exit (destroyCard).
    const breaking = departing.filter((m) => m.kind === 'die' && !this.transient.has(m.oldId) && before.cards.get(m.oldId)?.el.isConnected === false).length;
    for (const m of departing) {
      const old = before.cards.get(m.oldId);
      const t = this.transient.get(m.oldId);
      if (t) {
        const c = exitCue(m, true);
        this.sound(c.id, { x: t.box.x, ...(c.gain !== undefined ? { gain: c.gain } : {}) });
        jobs.push(this.flyGhostTo(t.ghost, t.box, this.pileBox(after, m.owner, m.to), m.token));
        this.transient.delete(m.oldId);
        continue;
      }
      if (!old || old.el.isConnected) continue;
      const c = exitCue(m);
      // The beats of the exits played here: a Scryfall picture breaks at 0.22 s (destroyCard), a vanishing token is gone at 0.36 s (flyGhostTo).
      const beat = m.kind === 'die' && old.scryfall ? 0.22 : c.id === 'card.exile' && m.token && m.kind !== 'exile' ? 0.36 : undefined;
      this.sound(c.id, { x: old.x, ...(c.gain !== undefined ? { gain: c.gain } : {}), ...(beat !== undefined ? { beat } : {}) });
      jobs.push(this.depart(m, old, after, breaking >= 3));
    }
    // Tokens created straight onto the battlefield (CR 111.1): they materialize.
    for (const id of plan.b.tokens) {
      const dest = after.cards.get(id);
      if (!dest || arriving.has(id) || before.cards.has(id)) continue;
      arriving.add(id);
      this.sound('card.token', { x: dest.x });
      jobs.push(this.materialize(dest));
    }
    // Everything else slides to its new place (rows close up after a card left, the hand opens for a drawn card).
    for (const [id, now] of after.cards) {
      if (arriving.has(id)) continue;
      const was = before.cards.get(id);
      if (!was || (now.zone !== 'battlefield' && now.zone !== 'hand' && now.zone !== 'back')) continue;
      const dx = was.x - now.x;
      const dy = was.y - now.y;
      if (Math.abs(dx) < MOVED_PX && Math.abs(dy) < MOVED_PX) continue;
      // FLIP: the card is drawn at its old place from the first frame (`fill: 'backwards'` holds the first keyframe through the delay; without it the card
      // showed at its new place for 120 ms and then jumped back to start its slide).
      jobs.push(this.animate(now.el, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0,0)' }], { duration: 340, delay: 120, easing: 'cubic-bezier(.25,.8,.3,1)', fill: 'backwards' }));
    }
    // Power and toughness changed without counters (pumps, shrinks, anthems: CR 613.4c).
    const countered = new Set(events.filter((e): e is Extract<GameEvent, { type: 'countersChanged' }> => e.type === 'countersChanged').map((e) => e.target));
    // One sound per direction for the whole change (an anthem pumps a whole board at once).
    const stat = new Set<SoundId>();
    for (const [id, now] of after.cards) {
      const o1 = to.objects[id];
      const o0 = from.objects[id];
      if (!o1 || !o0 || now.zone !== 'battlefield' || countered.has(id)) continue;
      const c0 = charsOf(from, o0);
      const c1 = charsOf(to, o1);
      if (!c0 || !c1 || c0.power === undefined || c1.power === undefined || c0.toughness === undefined || c1.toughness === undefined) continue;
      const dp = Number(c1.power) - Number(c0.power);
      const dt = Number(c1.toughness) - Number(c0.toughness);
      if (!Number.isFinite(dp) || !Number.isFinite(dt) || (dp === 0 && dt === 0)) continue;
      const good = dp + dt > 0;
      const statId: SoundId = good ? 'stat.up' : 'stat.down';
      if (!stat.has(statId)) {
        stat.add(statId);
        this.sound(statId, { x: now.x });
      }
      void this.pulse(now.el, good ? 'rgba(130,240,120,0.9)' : 'rgba(240,80,120,0.9)', 1.1);
      this.p.under.motes(center(now), Math.max(now.w, now.h), good);
      this.floater(now, `${dp >= 0 ? '+' : ''}${dp}/${dt >= 0 ? '+' : ''}${dt}`, good ? 'buff' : 'debuff', 1, true);
    }
    // Life totals pop when they change (the hit or the light already showed why).
    for (const p1 of to.players) {
      const p0 = from.players.find((p) => p.id === p1.id);
      const disc = after.avatars.get(p1.id);
      if (!p0 || !disc || p0.life === p1.life) continue;
      const life = disc.el.querySelector<HTMLElement>('.stat-life');
      const color = p1.life > p0.life ? 'rgba(140,255,170,1)' : 'rgba(255,90,90,1)';
      if (life) {
        const pop = { duration: 520, easing: 'cubic-bezier(.3,1.5,.5,1)' };
        void this.animate(life, [{ transform: 'scale(1)' }, { transform: 'scale(1.45)', offset: 0.25 }, { transform: 'scale(1)' }], pop);
        void this.textGlow(life, `0 0 18px ${color}`, [{ opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 0 }], pop);
      }
    }
    // M11-2 (CR 903.10a): combat damage from a commander: its line on the damaged player's disc pops with the new total (PlayerPanel.tsx).
    for (const e of events) {
      if (e.type !== 'commanderDamage') continue;
      const line = [...this.p.root.querySelectorAll<HTMLElement>('[data-fx="avatar"] [data-commander-damage]')].find(
        (el) => el.dataset.commanderDamage === e.commander && el.closest<HTMLElement>('[data-fx="avatar"]')?.dataset.playerId === e.player,
      );
      if (line) {
        const pop = { duration: 620, easing: 'cubic-bezier(.3,1.5,.5,1)' };
        void this.animate(line, [{ transform: 'scale(1)' }, { transform: 'scale(1.35)', offset: 0.3 }, { transform: 'scale(1)' }], pop);
        void this.textGlow(line, '0 0 14px rgba(255,120,60,1)', [{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 0 }], pop);
      }
    }
    // A face turned or a card transformed in place (same object, CR 701.28, 702.37e).
    let flipped = false;
    for (const e of events) {
      if (e.type !== 'transformed' && e.type !== 'turnedFaceUp') continue;
      const now = after.cards.get(e.objectId);
      if (!now || arriving.has(e.objectId)) continue;
      if (!flipped) this.sound('card.flip', { x: now.x });
      flipped = true;
      void this.flip(now);
    }
    // Attackers charge, blockers step in (the board's classes move them; this adds the jolt). One sound for the whole declaration (CR 508.1, 509.1).
    if (plan.b.attackers.length > 0) this.sound('combat.attack');
    if (plan.b.blocks.length > 0) this.sound('combat.block');
    for (const id of plan.b.attackers) {
      const e = after.cards.get(id);
      if (e) void this.pulse(e.el, 'rgba(255,120,60,0.9)', 0.9);
    }
    for (const b of plan.b.blocks) {
      const e = after.cards.get(b.blocker);
      if (e) void this.pulse(e.el, 'rgba(120,170,255,0.9)', 0.9);
    }
    // M12-4a: players who left a multiplayer game that goes on: what they owned fades where it was (CR 800.4a; their face-down cards are named first,
    // CR 708.9); the exiled ones already flew to exile above as ordinary moves.
    for (const l of plan.b.left) jobs.push(this.leaveTable(l, before));
    if (plan.b.gameOver) jobs.push(this.gameOver(plan.b.gameOver.winner, plan.b.lost, after, to));
    else {
      // M12-4a: a player lost and the game goes on (a multiplayer game, CR 104.5): their disc takes the final blow and their seat dims.
      if (plan.b.lost.length > 0) jobs.push(this.eliminated(plan.b.lost, after));
      if (plan.b.turn) {
        const id = bannerSound(plan.b.turn, to.viewer, soundClock.since('game.start'));
        if (id) this.sound(id);
        void this.banner(plan.b.turn.player === to.viewer ? 'Your turn' : `${to.players.find((p) => p.id === plan.b.turn!.player)?.name ?? 'Another player'}'s turn`, plan.b.turn.player === to.viewer ? 'mine' : 'theirs');
      }
    }
    await this.within(Promise.all(jobs), 2600);
  }

  /** Where a moving card was: its card, its stack entry, a pile, or another player's hand. */
  private originOf(m: Move, before: BoardSnapshot): Box | null {
    const t = this.transient.get(m.oldId);
    if (t) {
      this.drop(t.ghost);
      this.transient.delete(m.oldId);
      return t.box;
    }
    const old = before.cards.get(m.oldId) ?? before.stack.get(m.oldId);
    if (old) return old;
    if (m.from === 'library' || m.from === 'graveyard' || m.from === 'exile') return before.piles.get(`${m.owner}:${m.from}`) ?? null;
    if (m.from === 'hand') return before.hands.get(m.owner) ?? null;
    return null;
  }

  private pileBox(snap: BoardSnapshot, owner: string, zone: string): Box | null {
    if (zone === 'hand') return snap.hands.get(owner) ?? null;
    return snap.piles.get(`${owner}:${zone}`) ?? null;
  }

  /** A card arriving at `dest`: a copy of its new picture flies there from `origin` while the real one waits hidden, then lands. */
  private async arrive(m: Move, dest: CardEntry, origin: Box | null, delay: number, to: GameView): Promise<void> {
    if (!origin) {
      if (m.to === 'battlefield') return this.materialize(dest);
      return;
    }
    // The picture may still be on its way (a card's first look-up, an image still loading): the real card waits hidden and the copy is made once the picture
    // shows, so what flies is never the text frame that would change into the art on landing (ARCHITECTURE.md "Card images").
    if (picturePending(dest.el)) {
      const gen = this.gen;
      this.hide(dest.image);
      await this.pictureReady(dest.el);
      if (this.gen !== gen) return;
    }
    const g = this.ghost(dest, origin);
    this.hide(dest.image);
    const s0 = Math.max(0.15, Math.min(2, origin.w / Math.max(1, dest.w)));
    const dx = dest.x - origin.x;
    const dy = dest.y - origin.y;
    const toTable = m.to === 'battlefield';
    const lift = toTable ? -70 : m.to === 'stack' ? -50 : -24;
    const frames: GhostFrame[] = toTable
      ? [
          { transform: `translate(0,0) scale(${s0})`, shadow: 'rest' },
          { transform: `translate(${dx * 0.55}px, ${dy * 0.55 + lift}px) scale(1.32) rotate(${dx > 0 ? 6 : -6}deg)`, shadow: 'lift', offset: 0.55 },
          { transform: `translate(${dx}px, ${dy}px) scale(1.12) rotate(0deg)`, shadow: 'lift', offset: 0.82, easing: 'cubic-bezier(.7,0,1,.6)' },
          { transform: `translate(${dx}px, ${dy}px) scale(0.96)`, shadow: 'rest', offset: 0.9 },
          { transform: `translate(${dx}px, ${dy}px) scale(1)`, shadow: 'rest' },
        ]
      : [
          { transform: `translate(0,0) scale(${s0})`, shadow: 'rest' },
          { transform: `translate(${dx * 0.5}px, ${dy * 0.5 + lift}px) scale(${(s0 + 1) / 2 + 0.12})`, shadow: 'lift', offset: 0.5 },
          { transform: `translate(${dx}px, ${dy}px) scale(1)`, shadow: 'rest' },
        ];
    const dur = toTable ? 620 : m.to === 'stack' ? 460 : 420;
    if (m.to === 'stack') this.p.over.castTrail(spellStyle([to], m.newId!), center(origin), center(dest), dur, lift);
    await this.within(this.animateGhost(g, frames, { duration: dur, delay, easing: toTable ? 'linear' : 'cubic-bezier(.3,.7,.3,1)', fill: 'both' }), dur * 2 + delay + 400);
    this.drop(g);
    this.show(dest.image);
    if (toTable) {
      const o = to.objects[m.newId!];
      const power = o ? Number(charsOf(to, o)?.power ?? 0) : 0;
      const heavy = Math.max(0, Math.min(1, (power - 2) / 6));
      this.p.under.dust({ x: dest.x, y: dest.y + dest.h / 2 }, dest.w, heavy);
      if (power >= 4) this.shake(Math.round(power * 0.8));
    } else if (m.to === 'stack') {
      void this.pulse(dest.el, 'rgba(31,184,255,0.9)', 0.6);
    }
  }

  /**
   * Where a card the viewer draws is shown on its way to the hand (Arena style): on the viewer's half of the table at the right,
   * above the action buttons, as large as the room above the hand allows (at least hand size, at most 1.8 times it). The `i`-th card of the change sits a
   * little to the left of and below the one before. Null when the board has no such place.
   */
  private showcaseSpot(r: { side: DOMRect; main: DOMRect; handTop: number }, dest: CardEntry, i: number): { x: number; y: number; s: number } | null {
    if (dest.w <= 0 || dest.h <= 0) return null;
    const b = r.side;
    const m = r.main;
    const room = r.handTop - b.top - 16;
    const s = Math.max(1, Math.min(1.8, room / dest.h));
    const w = dest.w * s;
    return { x: Math.min(m.right - w / 2 - 16, m.right - m.width * 0.13) - i * 28, y: b.top + 8 + (dest.h * s) / 2 + i * 10, s };
  }

  /** The boxes showcaseSpot places the viewer's drawn cards by, measured once per change; null when the board has no such place. */
  private showcaseRoom(): { side: DOMRect; main: DOMRect; handTop: number } | null {
    // M12-4a: on the shared table the viewer's half is marked out for it (its HUD strip is apart from the table).
    const side = this.p.root.querySelector('[data-fx="showcase"]') ?? this.p.root.querySelector('.side-bottom');
    const hand = this.p.root.querySelector('.hand-own');
    const main = this.p.root.querySelector('.board-main');
    if (!side || !hand || !main) return null;
    return { side: side.getBoundingClientRect(), main: main.getBoundingClientRect(), handTop: hand.getBoundingClientRect().top };
  }

  /** A card the viewer draws: out of the library, up to `spot` to be read, then down into its place in the hand. */
  private async showDraw(dest: CardEntry, origin: Box, spot: { x: number; y: number; s: number }, delay: number): Promise<void> {
    if (picturePending(dest.el)) {
      const gen = this.gen;
      this.hide(dest.image);
      await this.pictureReady(dest.el);
      if (this.gen !== gen) return;
    }
    const g = this.ghost(dest, origin);
    this.hide(dest.image);
    const s0 = Math.max(0.15, Math.min(2, origin.w / Math.max(1, dest.w)));
    const at = `translate(${spot.x - origin.x}px, ${spot.y - origin.y}px)`;
    const frames: GhostFrame[] = [
      { transform: `translate(0,0) scale(${s0})`, shadow: 'rest', easing: 'cubic-bezier(.2,.7,.3,1)' },
      { transform: `${at} scale(${spot.s * 1.04})`, shadow: 'high', offset: 0.24, easing: 'ease-out' },
      { transform: `${at} scale(${spot.s})`, shadow: 'high', offset: 0.32 },
      { transform: `${at} scale(${spot.s})`, shadow: 'high', offset: 0.74, easing: 'cubic-bezier(.5,0,.3,1)' },
      { transform: `translate(${dest.x - origin.x}px, ${dest.y - origin.y}px) scale(1)`, shadow: 'rest' },
    ];
    // A Scryfall picture's artist: the credit line under the copy (never on the picture) while it is held up to be read. It
    // scales with the copy, so its type is set to read like every other credit line at the held size.
    const artist = pictureArtist(dest.image);
    if (artist) {
      const credit = creditElement(artist, 'fx-ghost-credit');
      credit.style.fontSize = `${(0.8 / Math.max(0.5, spot.s)).toFixed(3)}rem`;
      g.appendChild(credit);
      const shown: Keyframe[] = [{ opacity: 0 }, { opacity: 0, offset: 0.24 }, { opacity: 1, offset: 0.32 }, { opacity: 1, offset: 0.74 }, { opacity: 0, offset: 0.8 }, { opacity: 0 }];
      void this.animate(credit, shown, { duration: SHOWN_DRAW_MS, delay, fill: 'both' });
    }
    await this.within(this.animateGhost(g, frames, { duration: SHOWN_DRAW_MS, delay, fill: 'both' }), SHOWN_DRAW_MS * 2 + delay + 400);
    this.drop(g);
    this.show(dest.image);
  }

  /** Wait until a card's picture is no longer on its way (`picturePending`), at most `limit` ms: a failed look-up or a slow network never holds the change. */
  private async pictureReady(el: HTMLElement, limit = 450): Promise<void> {
    const t0 = performance.now();
    while (picturePending(el) && performance.now() - t0 < limit) await this.sleep(30);
  }

  private async materialize(dest: CardEntry): Promise<void> {
    this.p.under.materialize(center(dest), Math.max(dest.w, dest.h));
    await this.animate(dest.el, [{ transform: 'scale(0.3)' }, { transform: 'scale(1.1)', offset: 0.65 }, { transform: 'scale(1)' }], { duration: 480, easing: 'cubic-bezier(.3,1.4,.5,1)' });
  }

  /** A card that left: its exit, played on its own picture where it was (`crowd`: one of three or more breaking at once). */
  private async depart(m: Move, old: CardEntry, after: BoardSnapshot, crowd: boolean): Promise<void> {
    switch (m.kind) {
      case 'die':
        return this.destroyCard(old, old, true, crowd);
      case 'sacrifice':
        return this.consume(old);
      case 'exile':
        return this.banish(old);
      case 'bounce':
      case 'toLibrary':
      case 'toGraveyard':
      case 'toHand': {
        const g = this.ghost(old, old, true);
        return this.flyGhostTo(g, old, this.pileBox(after, m.owner, m.to), m.token);
      }
      default: {
        const g = this.ghost(old, old, true);
        return this.flyGhostTo(g, old, null, true);
      }
    }
  }

  /** A ghost flying into a pile (shrinking to its size), or vanishing where it is when there is no pile (tokens cease to exist, CR 111.7). */
  private async flyGhostTo(g: HTMLElement, from: Box, pile: Box | null, vanish: boolean): Promise<void> {
    const base = g.style.transform || '';
    if (!pile || vanish) {
      await this.within(this.animate(g, [{ transform: `${base} scale(1)` }, { transform: `${base} scale(1.08)`, offset: 0.3 }, { transform: `${base} scale(0)` }], { duration: 360, easing: 'ease-in', fill: 'forwards' }), 900);
      this.drop(g);
      return;
    }
    const dx = pile.x - from.x;
    const dy = pile.y - from.y;
    const s = Math.max(0.12, pile.w / Math.max(1, from.w));
    // The move comes first (screen pixels), then the ghost's own transform (a resolved spell's place at the edge of the table), then the shrink.
    await this.within(
      this.animateGhost(g, [
        { transform: `translate(0px,0px) ${base} scale(1)`, shadow: 'rest' },
        { transform: `translate(${dx * 0.4}px, ${dy * 0.4 - 46}px) ${base} scale(${0.6 + s * 0.4}) rotate(${dx > 0 ? 10 : -10}deg)`, shadow: 'lift', offset: 0.45 },
        { transform: `translate(${dx}px, ${dy}px) ${base} scale(${s}) rotate(0deg)`, shadow: 'rest' },
      ], { duration: 520, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' }),
      1200,
    );
    this.drop(g);
  }

  /**
   * Destroyed (CR 701.8) or put into the graveyard from the battlefield: our own frames and uploaded pictures shatter into shards that fly apart; a Scryfall
   * picture is never cut, so it is struck, tumbles and falls away whole into the dark. `crowd`: one of three or more breaking at once (a board wipe),
   * which breaks more softly and, our own frames, falls away whole instead of in pieces (each piece is a copy of the whole card: ten cards in nine pieces
   * each were some ten thousand elements).
   */
  private async destroyCard(e: CardEntry, at: Box, reuse: boolean, crowd = false): Promise<void> {
    const size = Math.max(at.w, at.h);
    if (e.scryfall) {
      // A Scryfall picture is never cut: it is struck up off the table, shudders in a white-hot rim, and tumbles away whole into the dark.
      const g = this.ghost(e, at, reuse);
      if (!reuse) this.hide(e.image);
      void this.sleep(220).then(() => {
        (e.zone === 'stack' ? this.p.over : this.p.under).destroy(center(at), size * 1.4);
        this.shake(4);
      });
      // The rim (painted once at its widest) shows a little less while it builds.
      await this.within(
        this.animateGhost(g, [
          { transform: 'translate(0,0) rotate(0deg) scale(1)', shadow: 'rest' },
          { transform: 'translate(-5px, -14px) rotate(-4deg) scale(1.24)', shadow: 'high', glow: { rim: 0.85 }, offset: 0.2 },
          { transform: 'translate(5px, -12px) rotate(5deg) scale(1.22)', shadow: 'high', glow: { rim: 1 }, offset: 0.32 },
          { transform: 'translate(16px, 50px) rotate(34deg) scale(0.62)', shadow: 'rest', offset: 0.75 },
          { transform: 'translate(22px, 90px) rotate(48deg) scale(0)', shadow: 'rest' },
        ], { duration: 900, easing: 'cubic-bezier(.45,0,.7,.2)', fill: 'forwards' }, { rim: '0 0 0 3px rgba(255,244,214,0.95), 0 0 40px 18px rgba(255,120,50,0.9)' }),
        1500,
      );
      this.drop(g);
      return;
    }
    // Our own frames and uploaded pictures break apart. 1. Struck: the card jumps up off the table, swells and shudders while a white-hot rim builds around
    // it (a glow behind it, outside the picture). 2. Cracked: big pieces (copies of the picture, each clipped to one piece) part along the cracks. 3. They
    // burst apart from the point of impact, spin, and fall away, over flame, smoke and embers where the card stood.
    const lr = this.layerRect();
    // The copy is made before the card is hidden; a copy of a hidden element would be hidden too.
    const source = reuse && !e.image.isConnected ? e.image : (e.image.cloneNode(true) as HTMLElement);
    dropGlows(source);
    if (!reuse) this.hide(e.image);
    source.style.visibility = '';
    source.style.transform = '';
    source.style.transition = 'none';
    source.style.width = `${e.w}px`;
    source.style.height = `${e.h}px`;
    source.classList.add('fx-shard');
    const holder = document.createElement('div');
    holder.className = 'fx-shatter';
    holder.style.left = `${at.x - lr.left - e.w / 2}px`;
    holder.style.top = `${at.y - lr.top - e.h / 2}px`;
    holder.style.width = `${e.w}px`;
    holder.style.height = `${e.h}px`;
    const base = e.transform;
    holder.style.transform = base;
    // The whole card while it is struck; it becomes the last piece.
    holder.appendChild(source);
    const swell = 1.3;
    const rim = crowd ? '0 0 0 2px rgba(255,248,226,0.95), 0 0 18px 6px rgba(255,124,48,0.85)' : '0 0 0 3px rgba(255,248,226,0.98), 0 0 38px 16px rgba(255,124,48,0.92)';
    const struck = glowLayer(holder, 'rim', `0 24px 30px rgba(0,0,0,0.55), ${rim}`);
    this.p.layer.appendChild(holder);
    this.ghosts.add(holder);
    const lifted = `translate(0px, -16px) ${base} scale(${swell})`;
    const strike = { duration: 320, easing: 'cubic-bezier(.2,.9,.3,1)', fill: 'forwards' } as const;
    void this.animate(struck, [{ opacity: 0 }, { opacity: 1, offset: 0.4 }, { opacity: 1, offset: 0.7 }, { opacity: 1 }], strike);
    await this.within(
      this.animate(holder, [
        { transform: `translate(0px, 0px) ${base} scale(1)` },
        { transform: `translate(-4px, -13px) ${base} scale(${swell - 0.04}) rotate(-3.5deg)`, offset: 0.4 },
        { transform: `translate(4px, -16px) ${base} scale(${swell - 0.01}) rotate(3deg)`, offset: 0.7 },
        { transform: lifted },
      ], strike),
      800,
    );
    this.settle(holder, lifted);
    struck.remove();
    // Directions on screen, turned into the holder's own frame (it is lifted, swollen, and turned when the card was tapped): the matrix of the transform
    // just set (read back from the page, it made the browser lay the page out again).
    let m: DOMMatrix | null = null;
    try {
      m = typeof DOMMatrix === 'function' ? new DOMMatrix(lifted) : null;
    } catch {
      m = null;
    }
    const inv = m?.inverse() ?? null;
    const linear = (mx: DOMMatrix | null, x: number, y: number) => {
      if (!mx) return { x, y };
      const p = mx.transformPoint(new DOMPoint(x, y));
      const o = mx.transformPoint(new DOMPoint(0, 0));
      return { x: p.x - o.x, y: p.y - o.y };
    };
    // A countered spell breaks in the stack, beside the table: its burst goes on the canvas that covers the rail too.
    (e.zone === 'stack' ? this.p.over : this.p.under).destroy(center(at), size * 1.35);
    // The instant it breaks: a white-hot flash and sparks, gone in a blink.
    this.p.over.breakFlash(center(at), size);
    this.shake(4);
    let flights: Promise<void>[];
    if (crowd) {
      // In a crowd the card falls away whole, tumbling, shrinking and fading over the flames, as long as the pieces would.
      const side = Math.random() < 0.5 ? -1 : 1;
      const fall = linear(inv, side * size * 0.35, size * 1.3);
      const mid = linear(inv, side * size * 0.12, size * 0.2);
      flights = [
        this.animate(source, [
          { transform: 'translate(0px,0px) rotate(0deg) scale(1)', opacity: 1, easing: 'cubic-bezier(.45,0,.85,.55)' },
          { transform: `translate(${mid.x}px, ${mid.y}px) rotate(${side * 14}deg) scale(0.9)`, opacity: 1, offset: 0.38 },
          { transform: `translate(${fall.x}px, ${fall.y}px) rotate(${side * 40}deg) scale(0.55)`, opacity: 0 },
        ], { duration: 1050, delay: 40, fill: 'forwards' }),
      ];
    } else {
      const impact = { x: 42 + Math.random() * 16, y: 38 + Math.random() * 20 };
      // Six big pieces at most: each is a copy of the whole card.
      const pieces = chunkPolygons(2, 3, Math.round(Math.random() * 1000) + 1, 6);
      flights = pieces.map((piece, i) => {
        // The others are copied from the whole card before it becomes the last piece.
        const el = i === pieces.length - 1 ? source : (source.cloneNode(true) as HTMLElement);
        el.style.clipPath = piece.clip;
        el.style.transformOrigin = `${piece.cx}% ${piece.cy}%`;
        if (el !== source) holder.appendChild(el);
        // Outward on screen from the point of impact, then gravity.
        const out = linear(m, ((piece.cx - impact.x) / 100) * e.w, ((piece.cy - impact.y) / 100) * e.h);
        const len = Math.hypot(out.x, out.y) || 1;
        const ux = out.x / len;
        const uy = out.y / len;
        const dist = (0.9 + Math.random() * 0.9) * size;
        const fall = (0.8 + Math.random() * 0.8) * size;
        const crack = linear(inv, ux * 4, uy * 4);
        const mid = linear(inv, ux * dist * 0.6, uy * dist * 0.6 - size * 0.3);
        const low = linear(inv, ux * dist, uy * dist * 0.7 + fall);
        const end = linear(inv, ux * dist * 1.08, uy * dist * 0.7 + fall * 1.35);
        const spin = (Math.random() < 0.5 ? -1 : 1) * (160 + Math.random() * 380);
        const dur = 950 + Math.random() * 320;
        return this.animate(el, [
          { transform: 'translate(0px,0px) rotate(0deg) scale(1)', opacity: 1, easing: 'ease-out' },
          { transform: `translate(${crack.x}px, ${crack.y}px) rotate(${spin * 0.015}deg) scale(1)`, opacity: 1, offset: 0.1, easing: 'cubic-bezier(.15,.75,.4,1)' },
          { transform: `translate(${mid.x}px, ${mid.y}px) rotate(${spin * 0.45}deg) scale(0.95)`, opacity: 1, offset: 0.38, easing: 'cubic-bezier(.45,0,.85,.55)' },
          { transform: `translate(${low.x}px, ${low.y}px) rotate(${spin}deg) scale(0.8)`, opacity: 0.9, offset: 0.82 },
          { transform: `translate(${end.x}px, ${end.y}px) rotate(${spin * 1.12}deg) scale(0.74)`, opacity: 0 },
        ], { duration: dur, delay: 40, fill: 'forwards' });
      });
    }
    const done = Promise.all(flights).then(() => {
      holder.remove();
      this.ghosts.delete(holder);
    });
    // The pieces are clear of the card's place well before they land: the change goes on while they fall.
    await this.within(Promise.race([done, this.sleep(560)]), 1900);
  }

  /** Sacrificed (CR 701.21): its controller gives it up, so it is not broken but consumed: it sinks into the table in a swirl of dark smoke. */
  private async consume(e: CardEntry): Promise<void> {
    const g = this.ghost(e, e, true);
    this.p.under.impact('shadow', center(e), 0.5);
    const base = g.style.transform || '';
    await this.within(
      this.animateGhost(g, [
        { transform: `${base} translate(0,0) scale(1) rotate(0deg)` },
        { transform: `${base} translate(0,-8px) scale(1.06) rotate(-3deg)`, glow: { consume: 1 }, offset: 0.3 },
        { transform: `${base} translate(0,18px) scale(0.35) rotate(25deg)` },
      ], { duration: 640, easing: 'cubic-bezier(.55,0,.8,.3)', fill: 'forwards' }, { consume: '0 0 0 2px rgba(200,120,255,0.9), 0 0 26px 8px rgba(120,20,180,0.8)' }),
      1300,
    );
    this.drop(g);
  }

  /** Transformed or turned face up (CR 701.28, 702.37e): a flash of light and a pop as the new face shows. */
  private flip(e: CardEntry): Promise<void> {
    this.p.under.flare(center(e), Math.max(e.w, e.h), 'radiant');
    return this.animate(e.el, [{ transform: 'scale(1)' }, { transform: 'scale(0.82) rotate(-4deg)', offset: 0.35 }, { transform: 'scale(1.12) rotate(2deg)', offset: 0.7 }, { transform: 'scale(1)' }], { duration: 520, easing: 'ease-out' });
  }

  /** Exiled (CR 406): the card flares white and is drawn into a point of light. */
  private async banish(e: CardEntry): Promise<void> {
    const g = this.ghost(e, e, true);
    this.p.under.banish(center(e), Math.max(e.w, e.h));
    const base = g.style.transform || '';
    await this.within(
      this.animateGhost(g, [
        { transform: `${base} scale(1)` },
        { transform: `${base} scale(1.1)`, glow: { banish: 1 }, offset: 0.35 },
        { transform: `${base} scale(0) rotate(0deg)` },
      ], { duration: 520, easing: 'cubic-bezier(.6,0,.8,.4)', fill: 'forwards' }, { banish: '0 0 0 4px rgba(235,240,255,0.95), 0 0 40px 14px rgba(200,220,255,0.85)' }),
      1100,
    );
    this.drop(g);
  }

  /** "Your turn" across the middle of the table, Arena style. */
  private banner(text: string, tone: 'mine' | 'theirs' | 'win' | 'lose'): Promise<void> {
    // One banner at a time: a quick turn (the computer passing through its turn) replaces the last one.
    for (const old of this.p.layer.querySelectorAll<HTMLElement>('.fx-banner')) this.drop(old);
    const el = document.createElement('div');
    el.className = `fx-banner fx-banner-${tone}`;
    el.textContent = text;
    const arena = this.arenaRect();
    const lr = this.layerRect();
    el.style.left = `${arena.left - lr.left + arena.width / 2}px`;
    el.style.top = `${arena.top - lr.top + arena.height / 2}px`;
    this.p.layer.appendChild(el);
    this.ghosts.add(el);
    // It opens wide and closes wider: its width, which letter spacing used to grow (laid out again on every frame), is now a horizontal scale.
    return this.animate(el, [
      { transform: 'translate(-50%,-50%) scaleX(0.28) scaleY(0.6)', opacity: 0 },
      { transform: 'translate(-50%,-50%) scaleX(1.06) scaleY(1)', opacity: 1, offset: 0.18 },
      { transform: 'translate(-50%,-50%) scaleX(1) scaleY(1)', opacity: 1, offset: 0.78 },
      { transform: 'translate(-50%,-50%) scaleX(1.65) scaleY(0.4)', opacity: 0 },
    ], { duration: tone === 'win' || tone === 'lose' ? 2200 : 760, easing: 'ease-out', fill: 'forwards' }).then(() => this.drop(el));
  }

  /**
   * M12-4a (m12 design 5.1): a player lost a multiplayer game that goes on (CR 104.5, 800.4a): their disc takes the final blow and the table jolts; the
   * seat dims with the new view (its plate shows their place).
   */
  private async eliminated(lost: readonly string[], after: BoardSnapshot): Promise<void> {
    this.sound('game.finalBlow', { x: lost.map((id) => after.avatars.get(id)?.x).find((x) => x !== undefined), gain: 0.8 });
    for (const id of lost) {
      const disc = after.avatars.get(id);
      if (!disc) continue;
      this.p.under.impact('fire', center(disc), 0.8);
      this.p.over.core('fire', center(disc), Math.max(disc.w, disc.h));
      void this.animate(disc.el, [{ transform: 'scale(1)' }, { transform: 'scale(1.22)', offset: 0.2 }, { transform: 'scale(0.9)', offset: 0.6 }, { transform: 'scale(1)' }], { duration: 760, easing: 'cubic-bezier(.3,1.4,.5,1)' });
    }
    this.shake(12);
    await this.sleep(600);
  }

  /**
   * M12-4a (m12 design 5.1, D9): the objects a player who left owned leave the game with them (CR 800.4a): each vanishes where it was, a few at a time; a
   * face-down card revealed by the leave (CR 708.9) is named over its place first. At most 48 are animated; the rest are simply gone.
   */
  private async leaveTable(l: { player: string; removed: readonly string[]; revealed: readonly { id: string; name: string }[] }, before: BoardSnapshot): Promise<void> {
    const gone = l.removed
      .map((id) => [id, before.cards.get(id)] as const)
      .filter((x): x is readonly [string, CardEntry] => x[1] !== undefined && !x[1].el.isConnected)
      .slice(0, 48);
    if (gone.length === 0) return;
    this.sound('card.exile', { x: gone[0]![1].x });
    const jobs: Promise<void>[] = [];
    gone.forEach(([id, e], i) => {
      const shown = l.revealed.find((r) => r.id === id);
      if (shown) this.floater(e, shown.name, 'info', 1, true);
      jobs.push(
        (async () => {
          await this.sleep((shown ? 420 : 0) + Math.min(i, 16) * 40);
          await this.banish(e);
        })(),
      );
    });
    await this.within(Promise.all(jobs), 2400);
  }

  /** The end (CR 104): the loser's disc takes a final blow and the table jolts hard. */
  private async gameOver(winner: string | null, lost: readonly string[], after: BoardSnapshot, to: GameView): Promise<void> {
    this.sound('game.finalBlow', { x: lost.map((id) => after.avatars.get(id)?.x).find((x) => x !== undefined) });
    for (const id of lost) {
      const disc = after.avatars.get(id);
      if (!disc) continue;
      this.p.under.impact('fire', center(disc), 1);
      this.p.over.core('fire', center(disc), Math.max(disc.w, disc.h));
      void this.animate(disc.el, [{ transform: 'scale(1)' }, { transform: 'scale(1.25)', offset: 0.2 }, { transform: 'scale(0.82)' }], { duration: 700, easing: 'cubic-bezier(.3,1.4,.5,1)', fill: 'forwards' });
    }
    this.shake(20);
    // The result itself crosses the table on the board's end screen (GameBoard ResultScreen), which comes in with the new view.
    await this.sleep(700);
  }
}

function styleGlow(style: SpellStyle): string {
  switch (style) {
    case 'fire':
      return 'rgba(255,140,50,0.95)';
    case 'lightning':
      return 'rgba(170,200,255,0.95)';
    case 'arcane':
      return 'rgba(90,190,255,0.95)';
    case 'shadow':
      return 'rgba(190,80,255,0.95)';
    case 'nature':
      return 'rgba(120,230,100,0.95)';
    case 'radiant':
      return 'rgba(255,225,140,0.95)';
    default:
      return 'rgba(220,230,245,0.95)';
  }
}
