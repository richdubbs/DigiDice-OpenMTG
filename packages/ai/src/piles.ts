/**
 * "Separate those cards into two piles; [a player] chooses one" (Fact or Fiction): the choices are made while the spell resolves (CR 608.2d), the separator
 * first (engine effects/handlers/cards-reveal.ts). The separator splits so that the chooser's best pile is as small as it can be; the chooser takes the
 * pile worth more (or less, when the chosen pile is lost: sacrificed, put into the graveyard).
 */
import { faceChars, type ChooseObjectsDecision, type ChooseOptionDecision, type EffectStep, type ObjectId, type PlayerRef } from '@openmtg/engine';
import { controller, stackTop, type Ctx } from './context';
import { programOf } from './intent';
import { chosenTargets, stackAbility } from './source';
import { cardValue, value } from './value';

export const isPilesSeparation = (d: ChooseObjectsDecision): boolean => (d.rules ?? []).includes('CR 608.2d') && /separate .*two piles/i.test(d.prompt);

export const isPileChoice = (d: ChooseOptionDecision): boolean => d.options.length === 2 && d.options.every((o) => /^pile[12]$/.test(o.id));

interface PileStep { chooserIsMe: boolean | null; chosenIsGood: boolean }

/** The `piles` step of the resolving spell or ability (on top of the stack, CR 608.2n), read for who chooses and what happens to the chosen pile. */
function pileStep(ctx: Ctx): PileStep {
  const top = stackTop(ctx);
  const program = top !== null ? programOf(stackAbility(ctx, top)) : undefined;
  if (top === null || !program) return { chooserIsMe: null, chosenIsGood: true };
  const steps = flatten(program.steps);
  const i = steps.findIndex((s) => s.op === 'piles');
  const st = steps[i];
  if (!st || st.op !== 'piles') return { chooserIsMe: null, chosenIsGood: true };
  const mine = controller(ctx, top) === ctx.me;
  const chooserIsMe = isMe(ctx, st.chooser, mine, top);
  // What the later steps do with the chosen pile: to a hand or the battlefield is a gain; anything else (graveyard, exile, sacrifice) a loss.
  let chosenIsGood = true;
  for (const later of steps.slice(i + 1)) {
    if (!JSON.stringify(later).includes(`"name":"${st.chosen}"`)) continue;
    chosenIsGood = later.op === 'move' && (later.to.zone === 'hand' || later.to.zone === 'battlefield');
    break;
  }
  return { chooserIsMe, chosenIsGood };
}

function flatten(steps: readonly EffectStep[]): EffectStep[] {
  return steps.flatMap((s) => {
    const nested = [s.op === 'if' ? [...s.then, ...(s.else ?? [])] : [], s.op === 'may' ? s.do : []].flat();
    return [s, ...flatten(nested)];
  });
}

function isMe(ctx: Ctx, ref: PlayerRef, controllerIsMe: boolean, top: ObjectId): boolean | null {
  switch (ref.ref) {
    case 'you': return controllerIsMe;
    case 'anOpponent': return !controllerIsMe;
    case 'each': return ref.who === 'player' ? null : !controllerIsMe;
    case 'target': {
      const t = chosenTargets(ctx, top, ref.id)[0];
      return t?.kind === 'player' ? t.id === ctx.me : null;
    }
    default: return null;
  }
}

/** The separator's answer: the cards of pile 1. Against another chooser, two piles of value as equal as possible (largest first into the lighter pile). */
export function separatePiles(ctx: Ctx, options: readonly ObjectId[]): ObjectId[] {
  if (pileStep(ctx).chooserIsMe === true) return [...options]; // the bot chooses too: everything in one pile, then it picks the pile it wants
  const sorted = [...options].map((id) => ({ id, v: ctx.chars(id) ? value(ctx, id) : 4 })).sort((a, b) => b.v - a.v);
  const piles: { ids: ObjectId[]; v: number }[] = [{ ids: [], v: 0 }, { ids: [], v: 0 }];
  for (const c of sorted) {
    const lighter = piles[0]!.v <= piles[1]!.v ? piles[0]! : piles[1]!;
    lighter.ids.push(c.id);
    lighter.v += c.v;
  }
  return piles[0]!.ids;
}

/** The chooser's answer: the pile worth more, read from the option labels ("Pile 1: Serra Angel, Lightning Bolt"; the engine names the cards in them). */
export function choosePile(ctx: Ctx, options: ChooseOptionDecision['options']): string {
  const good = pileStep(ctx).chosenIsGood;
  const scored = options.map((o) => ({ id: o.id, v: pileValue(ctx, o.label) }));
  scored.sort((a, b) => (good ? b.v - a.v : a.v - b.v));
  return scored[0]!.id;
}

/** The value of the cards a pile label names, matched against the game's card definitions (a name may itself contain ", "). */
export function pileValue(ctx: Ctx, label: string): number {
  const text = label.replace(/^Pile \d+:\s*/i, '');
  if (/^no cards$/i.test(text)) return 0;
  const defs = new Map(Object.values(ctx.view.defs).map((d) => [d.name, d]));
  let v = 0;
  let pending: string[] = [];
  for (const part of text.split(', ')) {
    pending.push(part);
    const whole = defs.get(pending.join(', '));
    const alone = whole ? undefined : defs.get(part);
    if (whole) { v += cardValue(faceChars(whole, 0)); pending = []; }
    else if (alone) { v += cardValue(faceChars(alone, 0)) + (pending.length - 1) * 3; pending = []; }
  }
  return v + pending.length * 3; // names the bot can't place: an average card each
}
