/**
 * Every sound effect of the client (docs/design/sound.md): its id, what it is for, when it plays, how often, its loudness and length limits, and its
 * recipe (audio/sounds/*.ts). `renderSound` turns a recipe into the finished, levelled stereo buffer; audio/engine.ts plays it, the tests and
 * scripts/sound/render.ts measure it.
 */
import { hashString, makeCtx, master, type Ctx, type Stereo } from './dsp';
import { CARD_SOUNDS } from './sounds/cards';
import { COMBAT_SOUNDS } from './sounds/combat';
import { FLOW_SOUNDS } from './sounds/flow';
import { MAGIC_SOUNDS } from './sounds/magic';
import { MOMENT_SOUNDS } from './sounds/moments';
import { SPELL_SOUNDS } from './sounds/spells';
import { UI_SOUNDS } from './sounds/ui';
import { ZONE_SOUNDS } from './sounds/zones';

/** The look (and sound) of a spell effect, from its name and colours (board/fx/plan.ts spellStyle). */
export const SPELL_STYLES = ['fire', 'lightning', 'arcane', 'shadow', 'nature', 'radiant', 'force'] as const;
export type SpellStyleId = (typeof SPELL_STYLES)[number];
export const MANA_TYPES = ['W', 'U', 'B', 'R', 'G', 'C'] as const;

/** Volume groups (Settings "Sound"): interface feedback, the game on the table, and the background ambience. */
export type SoundCategory = 'interface' | 'game' | 'ambience';

/** How often a sound plays in a game: it decides how subtle and short it must be. */
export type Frequency = 'constant' | 'very frequent' | 'per turn' | 'per game' | 'rare';

export interface SoundMeta {
  category: SoundCategory;
  frequency: Frequency;
  /** What the sound must tell the player (the purpose its score is judged on). */
  purpose: string;
  /** When exactly it plays (the moment on screen it accompanies). */
  when: string;
  /** Loudness of its loudest 100 ms (LUFS, dsp.ts master): the set's mix. */
  lufs: number;
  /** Longest it may last (s), tail included. */
  maxDur: number;
  /** Renderings with small differences, picked at random so a frequent sound never repeats exactly. */
  variants?: number;
  /** A seamless loop (the ambience). */
  loop?: boolean;
  /**
   * Seconds into the sound of its main accent (a release, a shatter, a landing) when the game starts it ahead of that moment: the board animator lines
   * the accent up with the animation's own beat at any animation speed (Settings, Animation speed).
   */
  accent?: number;
}

export type Recipe = (ctx: Ctx) => Stereo;

const SPELL_LOOK: Record<SpellStyleId, string> = {
  fire: 'red spells and fire-named ones (Fireball, Flame Slash)',
  lightning: 'lightning-named spells (Lightning Bolt, Shock) and blue-red ones',
  arcane: 'blue spells: arcane light',
  shadow: 'black spells: shadow',
  nature: 'green spells: nature',
  radiant: 'white spells: radiance',
  force: 'colourless and artifact spells: raw force',
};

const MANA_LOOK: Record<(typeof MANA_TYPES)[number], string> = {
  W: 'white',
  U: 'blue',
  B: 'black',
  R: 'red',
  G: 'green',
  C: 'colourless',
};

function spellMeta(): Record<string, SoundMeta> {
  const out: Record<string, SoundMeta> = {};
  for (const s of SPELL_STYLES) {
    out[`cast.${s}`] = {
      category: 'game',
      frequency: 'per turn',
      purpose: `A spell is cast and goes on the stack; this one is ${SPELL_LOOK[s]}. Must read as "a spell is launched" and carry its element's flavour in the grid style.`,
      when: 'The card lifts out of the hand and flies to the stack (about 0.45 s), with a flare when it arrives.',
      lufs: -21,
      maxDur: 0.9,
      accent: 0.44,
    };
    out[`impact.${s}`] = {
      category: 'game',
      frequency: 'per turn',
      purpose: `A spell's effect strikes its target (${SPELL_LOOK[s]}). Must feel like a hit of that element, rendered digitally; louder for more damage (the game scales its volume).`,
      when: 'The projectile reaches the card or the player disc: burst of light, the target recoils, the damage number floats up.',
      lufs: -18,
      maxDur: 1.0,
    };
  }
  for (const m of MANA_TYPES) {
    out[`mana.${m}`] = {
      category: 'game',
      frequency: 'very frequent',
      purpose: `Mana is made (${MANA_LOOK[m]}): a small, pleasant confirmation that energy was drawn from a land or source, recognisably ${MANA_LOOK[m]} next to the other five.`,
      when: 'An orb of mana flies from the tapped source to the spell it pays for (several at once are staggered).',
      lufs: -28,
      maxDur: 0.4,
      variants: 2,
    };
  }
  return out;
}

export const SOUND_META = {
  // ---- interface -----------------------------------------------------------------------------------------------------------------
  'ui.hover': {
    category: 'interface', frequency: 'very frequent', lufs: -40, maxDur: 0.05, variants: 3,
    purpose: 'The pointer is on something you can press: the faintest acknowledgement, never tiring even when sweeping across many buttons.',
    when: 'Pointer enters a button, a card you can act on, or a choice (rate-limited).',
  },
  'ui.click': {
    category: 'interface', frequency: 'very frequent', lufs: -27, maxDur: 0.09, variants: 3,
    purpose: 'A button was pressed: crisp, short, tactile feedback for any ordinary button.',
    when: 'Any button press without a more specific sound.',
  },
  'ui.confirm': {
    category: 'interface', frequency: 'per turn', lufs: -24, maxDur: 0.3,
    purpose: 'A primary action is accepted (OK, Done, Start, Keep, submit): positive, decisive, a step above a click.',
    when: 'The main button of a dialog or prompt is pressed.',
  },
  'ui.cancel': {
    category: 'interface', frequency: 'per turn', lufs: -26, maxDur: 0.25,
    purpose: 'Backing out (Cancel, Back, Close, Clear, Escape): neutral, lower and softer than confirm, clearly "undo / go back".',
    when: 'A cancel, back, close or clear control, or Escape.',
  },
  'ui.toggleOn': {
    category: 'interface', frequency: 'rare', lufs: -27, maxDur: 0.14,
    purpose: 'A switch or checkbox turned on: "engaged", rising.',
    when: 'A checkbox or toggle becomes checked.',
  },
  'ui.toggleOff': {
    category: 'interface', frequency: 'rare', lufs: -27, maxDur: 0.14,
    purpose: 'A switch or checkbox turned off: "disengaged", falling; the mirror of toggle on.',
    when: 'A checkbox or toggle becomes unchecked.',
  },
  'ui.select': {
    category: 'interface', frequency: 'per turn', lufs: -28, maxDur: 0.11,
    purpose: 'An option is picked (radio, select, a chip, a card in a choice): light, precise, distinct from a click.',
    when: 'A radio, select, chip or choosable card is chosen.',
  },
  'ui.tick': {
    category: 'interface', frequency: 'very frequent', lufs: -32, maxDur: 0.04, variants: 2,
    purpose: 'A value steps (slider, number +/-, moving an item up or down): a tiny detent, like a digital dial.',
    when: 'Each step of a slider or a number control, each reorder.',
  },
  'ui.type': {
    category: 'interface', frequency: 'very frequent', lufs: -38, maxDur: 0.035, variants: 4,
    purpose: 'A key typed in a text field: a faint terminal keystroke, never annoying at typing speed.',
    when: 'Each character typed into a text field (rate-limited).',
  },
  'ui.navigate': {
    category: 'interface', frequency: 'rare', lufs: -26, maxDur: 0.4,
    purpose: 'Moving to another screen: a panel of the grid sliding into place.',
    when: 'The screen changes (top navigation, Back to a previous screen, Home).',
  },
  'ui.open': {
    category: 'interface', frequency: 'rare', lufs: -27, maxDur: 0.32,
    purpose: 'A panel, menu or dialog opens: it deploys, rising.',
    when: 'A dialog, menu, card zone viewer or panel appears.',
  },
  'ui.close': {
    category: 'interface', frequency: 'rare', lufs: -28, maxDur: 0.28,
    purpose: 'A panel, menu or dialog closes: it folds away, falling; the mirror of open.',
    when: 'A dialog, menu or panel is dismissed.',
  },
  'ui.error': {
    category: 'interface', frequency: 'rare', lufs: -23, maxDur: 0.4,
    purpose: 'Refused or failed: an unmistakable "denied" that is firm but not harsh or alarming.',
    when: 'An action is not allowed, or an error message appears.',
  },
  'ui.notify': {
    category: 'interface', frequency: 'rare', lufs: -25, maxDur: 0.7,
    purpose: 'A notice appeared: a gentle "incoming message" that draws the eye without urgency.',
    when: 'A status message or notice shows up.',
  },
  'ui.success': {
    category: 'interface', frequency: 'rare', lufs: -23, maxDur: 0.9,
    purpose: 'Something finished well (saved, imported, uploaded, copied, updated): a satisfying, bright completion.',
    when: 'A long or important action completes successfully.',
  },
  'ui.delete': {
    category: 'interface', frequency: 'rare', lufs: -24, maxDur: 0.7,
    purpose: 'Something is erased for good (a deck, stored images): data wiped, final, a little sobering.',
    when: 'A delete is confirmed.',
  },
  'deck.add': {
    category: 'interface', frequency: 'very frequent', lufs: -28, maxDur: 0.16, variants: 2,
    purpose: 'A card goes into the deck: it slots in, rising, satisfying when repeated quickly.',
    when: 'Add to deck / + on a card in the deckbuilder.',
  },
  'deck.remove': {
    category: 'interface', frequency: 'very frequent', lufs: -29, maxDur: 0.16,
    purpose: 'A card comes out of the deck: it slides out, falling; the mirror of add.',
    when: 'Remove / - on a card in the deckbuilder.',
  },
  'deck.legal': {
    category: 'interface', frequency: 'rare', lufs: -24, maxDur: 0.9,
    purpose: 'The deck check passed: "verified", a clean approval chime.',
    when: 'The deck validation reports the deck legal in its format.',
  },
  'deck.illegal': {
    category: 'interface', frequency: 'rare', lufs: -26, maxDur: 0.7,
    purpose: 'The deck check found problems: "needs attention", softer than an error.',
    when: 'The deck validation reports problems.',
  },

  // ---- game flow, turn structure, online --------------------------------------------------------------------------------------------
  'game.start': {
    category: 'game', frequency: 'per game', lufs: -15, maxDur: 3.2,
    purpose: 'A game begins: the grid powers up, energy rising into a strong arrival; sets the tone of the whole game.',
    when: 'The game starts (the table appears and the opening hands are dealt).',
  },
  'game.mulligan': {
    category: 'game', frequency: 'per game', lufs: -21, maxDur: 0.9,
    purpose: 'A player mulligans: the hand is recalled and scrambled, a "rewind and retry".',
    when: 'A player takes a mulligan.',
  },
  'game.keep': {
    category: 'game', frequency: 'per game', lufs: -21, maxDur: 0.8,
    purpose: 'A player keeps their hand: locked in, ready.',
    when: 'A player keeps their opening hand.',
  },
  'game.shuffle': {
    category: 'game', frequency: 'per game', lufs: -23, maxDur: 0.9,
    purpose: 'A library is shuffled: a rapid digital riffle that settles.',
    when: 'A library is shuffled (game start, mulligan, after a search).',
  },
  'turn.mine': {
    category: 'game', frequency: 'per turn', lufs: -18, maxDur: 1.5,
    purpose: 'Your turn begins: the most important recurring cue; warm, bright and instantly recognisable, but welcoming rather than startling (it plays every turn).',
    when: 'The "Your turn" banner sweeps across the table.',
  },
  'turn.theirs': {
    category: 'game', frequency: 'per turn', lufs: -19, maxDur: 1.3,
    purpose: "The opponent's turn begins: clearly not yours (darker, lower, calmer), still a clean turn marker.",
    when: "The opponent's turn banner sweeps across the table.",
  },
  'turn.step': {
    category: 'game', frequency: 'very frequent', lufs: -33, maxDur: 0.12, variants: 2,
    purpose: 'The game moved to the next step of the turn: a quiet tick of the turn clock.',
    when: 'A new step or phase begins where a player gets a decision.',
  },
  'priority.mine': {
    category: 'game', frequency: 'per turn', lufs: -22, maxDur: 0.45,
    purpose: 'The game is waiting for you: a clear, friendly "your move" prompt, noticeable without startling, fine to hear many times a game.',
    when: 'A decision of yours appears in the prompt bar (priority, targets, blockers, ...).',
  },
  'priority.pass': {
    category: 'game', frequency: 'very frequent', lufs: -27, maxDur: 0.16, variants: 2,
    purpose: 'You passed: a soft "acknowledged, moving on".',
    when: 'You pass priority (Pass, OK on an empty stack, Space).',
  },
  'game.handoff': {
    category: 'game', frequency: 'per turn', lufs: -22, maxDur: 0.9,
    purpose: 'Hot-seat: hand the device to the other player; the screen locks behind a cover.',
    when: 'The pass-the-device cover appears.',
  },
  'game.finalBlow': {
    category: 'game', frequency: 'per game', lufs: -13, maxDur: 1.6,
    purpose: 'A player is defeated: the final, heaviest blow of the game, a system crash of their disc.',
    when: "The losing player's disc takes the last hit and the table jolts hard.",
  },
  'game.victory': {
    category: 'game', frequency: 'per game', lufs: -14, maxDur: 4.2,
    purpose: 'You won: triumphant, rewarding, the payoff of the whole game.',
    when: 'The result screen shows your victory.',
  },
  'game.defeat': {
    category: 'game', frequency: 'per game', lufs: -15, maxDur: 4.2,
    purpose: 'You lost: a dignified power-down, sombre but not punishing.',
    when: 'The result screen shows your defeat.',
  },
  'game.drawn': {
    category: 'game', frequency: 'rare', lufs: -17, maxDur: 3.2,
    purpose: 'The game ended with no winner for you (a draw, or a game you watched): neutral, unresolved, final.',
    when: 'The result screen shows a draw or a result that is not yours.',
  },
  'game.coin': {
    category: 'game', frequency: 'rare', lufs: -21, maxDur: 1.1,
    purpose: 'A coin is flipped: spinning, then landing on its result.',
    when: 'A coin flip happens.',
  },
  'game.dice': {
    category: 'game', frequency: 'rare', lufs: -21, maxDur: 1.1,
    purpose: 'A die is rolled: tumbling values that settle on a result.',
    when: 'A die roll happens.',
  },
  'world.day': {
    category: 'game', frequency: 'rare', lufs: -22, maxDur: 1.8,
    purpose: 'It becomes day: light rising over the grid, open and bright.',
    when: 'Night becomes day (or day is first set).',
  },
  'world.night': {
    category: 'game', frequency: 'rare', lufs: -22, maxDur: 1.8,
    purpose: 'It becomes night: light sinking, the grid darkening.',
    when: 'Day becomes night.',
  },
  'world.crown': {
    category: 'game', frequency: 'rare', lufs: -20, maxDur: 1.3,
    purpose: 'Someone becomes the monarch or takes the initiative: a regal, important designation.',
    when: 'The monarch or the initiative changes hands.',
  },
  'net.connected': {
    category: 'game', frequency: 'rare', lufs: -23, maxDur: 1.0,
    purpose: 'Online: the link is up (a clean digital handshake).',
    when: 'The client connects to the online server or the other player.',
  },
  'net.joined': {
    category: 'game', frequency: 'rare', lufs: -20, maxDur: 1.3,
    purpose: 'Online: the opponent joined and the game is on: an arrival, more exciting than connected.',
    when: 'The online game begins (both players are in).',
  },
  'net.lost': {
    category: 'game', frequency: 'rare', lufs: -21, maxDur: 1.1,
    purpose: 'Online: the connection dropped or the opponent left: signal lost, a worried glitch.',
    when: 'The link drops, the opponent leaves or the server closes.',
  },
  'net.restored': {
    category: 'game', frequency: 'rare', lufs: -22, maxDur: 1.0,
    purpose: 'Online: the connection is back or the opponent returned: relief, signal restored.',
    when: 'The link reconnects or the opponent comes back.',
  },
  'net.chat': {
    category: 'game', frequency: 'rare', lufs: -25, maxDur: 0.55,
    purpose: 'Online: a chat message from the opponent: a light "message in".',
    when: 'A chat message from the opponent arrives.',
  },
  'net.waiting': {
    category: 'game', frequency: 'rare', lufs: -31, maxDur: 0.9,
    purpose: 'Online: still waiting for an opponent: a calm radar ping that can repeat every few seconds.',
    when: 'Every few seconds while a hosted game waits for its opponent.',
  },
  'ambient.grid': {
    category: 'ambience', frequency: 'constant', lufs: -36, maxDur: 12.5, loop: true,
    purpose: 'The table ambience: a low, slowly breathing grid hum that makes the table a place, never in the way of the effects.',
    when: 'Loops quietly under the game screen.',
  },

  // ---- spells, abilities, mana ---------------------------------------------------------------------------------------------------
  ...(spellMeta() as Record<`cast.${SpellStyleId}` | `impact.${SpellStyleId}` | `mana.${(typeof MANA_TYPES)[number]}`, SoundMeta>),
  'spell.resolve': {
    category: 'game', frequency: 'per turn', lufs: -23, maxDur: 0.55,
    purpose: 'A spell or ability starts to resolve: "executing", it flares and releases its effect.',
    when: 'The spell rises off the stack, grows and glows before its effect leaves it.',
  },
  'spell.bolt': {
    category: 'game', frequency: 'per turn', lufs: -25, maxDur: 0.55, variants: 2, accent: 0.3,
    purpose: "A spell's effect is in flight toward its target: a fast travelling whoosh that leads into the impact.",
    when: 'The projectile leaves the spell (it lands about 0.35 s later).',
  },
  'spell.touch': {
    category: 'game', frequency: 'per turn', lufs: -24, maxDur: 0.6,
    purpose: 'A spell reaches what it targets without damage (pump, tap, destroy target, ...): the effect is applied, "data written".',
    when: 'The effect lands on its target: light behind the card and a glow pulse.',
  },
  'spell.countered': {
    category: 'game', frequency: 'rare', lufs: -18, maxDur: 1.0,
    purpose: 'A spell or ability is countered: negated, it breaks apart on the stack. A decisive "denied".',
    when: 'The countered spell jolts on the stack and shatters.',
  },
  'spell.copied': {
    category: 'game', frequency: 'rare', lufs: -21, maxDur: 0.8,
    purpose: 'A spell is copied: duplicated, an echo of the original.',
    when: 'A copy of a spell appears on the stack.',
  },
  'ability.activated': {
    category: 'game', frequency: 'per turn', lufs: -24, maxDur: 0.45,
    purpose: 'An activated ability is used: a permanent powers a function, a quick charge.',
    when: 'Its source flares and pulses blue.',
  },
  'ability.triggered': {
    category: 'game', frequency: 'per turn', lufs: -23, maxDur: 0.55,
    purpose: 'A triggered ability fires on its own: an alert "something happened because of this card", golden.',
    when: 'Its source flares and pulses gold.',
  },

  // ---- combat, life, counters ----------------------------------------------------------------------------------------------------
  'combat.attack': {
    category: 'game', frequency: 'per turn', lufs: -17, maxDur: 1.1,
    purpose: 'Attackers are declared: aggressive, charging forward; light cycles revving into the attack.',
    when: 'The attackers move forward and pulse red-orange.',
  },
  'combat.block': {
    category: 'game', frequency: 'per turn', lufs: -18, maxDur: 0.8,
    purpose: 'Blockers are declared: defensive, a digital barrier slamming into place.',
    when: 'The blockers step in front of the attackers and pulse blue.',
  },
  'combat.arm': {
    category: 'game', frequency: 'per turn', lufs: -27, maxDur: 0.16,
    purpose: 'You chose a creature to attack with (or took it back): weapon armed, a quick aggressive select.',
    when: 'Clicking a creature while declaring attackers.',
  },
  'combat.assign': {
    category: 'game', frequency: 'per turn', lufs: -27, maxDur: 0.16,
    purpose: 'You chose a blocker or the attacker it blocks: a defensive assignment click, distinct from arm.',
    when: 'Clicking a blocker or an attacker while declaring blockers.',
  },
  'combat.swing': {
    category: 'game', frequency: 'per turn', lufs: -24, maxDur: 0.5, variants: 3, accent: 0.28,
    purpose: 'A creature rises and lunges at its target: the wind-up whoosh before the hit.',
    when: 'The creature lifts off the table and swings (contact comes about 0.28 s in).',
  },
  'hit.light': {
    category: 'game', frequency: 'per turn', lufs: -21, maxDur: 0.5, variants: 3,
    purpose: 'A blow lands for 1-2 damage: a crisp, light digital hit.',
    when: 'Contact of a creature (or a damage source) with its target.',
  },
  'hit.medium': {
    category: 'game', frequency: 'per turn', lufs: -18, maxDur: 0.65, variants: 2,
    purpose: 'A blow lands for 3-5 damage: a solid, punchy hit.',
    when: 'Contact, with a small screen shake.',
  },
  'hit.heavy': {
    category: 'game', frequency: 'per turn', lufs: -14, maxDur: 1.0, variants: 2,
    purpose: 'A blow lands for 6+ damage: a massive, crunching impact.',
    when: 'Contact, with a strong screen shake and a flash.',
  },
  'hit.player': {
    category: 'game', frequency: 'per turn', lufs: -17, maxDur: 0.85, variants: 2,
    purpose: "Damage hits a player: the player's own system takes the blow, heavier and more alarming than a hit on a card.",
    when: "The blow lands on the player's disc and the life total drops.",
  },
  'life.gain': {
    category: 'game', frequency: 'per turn', lufs: -21, maxDur: 1.0,
    purpose: 'A player gains life: restorative, rising, a healing shimmer.',
    when: 'Healing light on the player disc, a green +N floats up.',
  },
  'life.loss': {
    category: 'game', frequency: 'per turn', lufs: -21, maxDur: 0.9,
    purpose: 'A player loses life without damage (paying life, drain): energy drained away, falling.',
    when: 'A dark burst on the player disc, a red -N floats up.',
  },
  'counter.up': {
    category: 'game', frequency: 'per turn', lufs: -25, maxDur: 0.42,
    purpose: 'Helpful counters are added (+1/+1, loyalty, charge): an upgrade, a level up.',
    when: 'Green motes rise around the card and "+1 +1/+1" floats up.',
  },
  'counter.down': {
    category: 'game', frequency: 'per turn', lufs: -25, maxDur: 0.42,
    purpose: 'Harmful counters are added or counters removed: a downgrade.',
    when: 'Red motes around the card, "-1" floats up.',
  },
  'stat.up': {
    category: 'game', frequency: 'per turn', lufs: -25, maxDur: 0.42,
    purpose: 'A creature gets bigger (pump, anthem): powered up, a quick boost.',
    when: 'The card pulses green and "+2/+2" floats up.',
  },
  'stat.down': {
    category: 'game', frequency: 'per turn', lufs: -25, maxDur: 0.42,
    purpose: 'A creature gets smaller: weakened, a power sag.',
    when: 'The card pulses red and "-2/-2" floats up.',
  },
  'damage.prevented': {
    category: 'game', frequency: 'rare', lufs: -21, maxDur: 0.65,
    purpose: 'Damage is prevented: a shield deflects the blow, a bright ricochet.',
    when: 'A prevention effect stops damage.',
  },

  // ---- cards and zones -------------------------------------------------------------------------------------------------------------
  'card.draw': {
    category: 'game', frequency: 'per turn', lufs: -26, maxDur: 0.32, variants: 3,
    purpose: 'A card is drawn: a quick data pull from the library into the hand; several in a row read as a quick cascade.',
    when: 'The card flies from the library into the hand (several are 90 ms apart).',
  },
  'card.land': {
    category: 'game', frequency: 'per turn', lufs: -20, maxDur: 0.65,
    purpose: 'A land is played: solid, grounded, it locks into the grid and powers up.',
    when: 'The land lands on the table.',
  },
  'card.enter': {
    category: 'game', frequency: 'per turn', lufs: -20, maxDur: 0.75,
    purpose: 'A permanent spell resolves and lands on the battlefield: materialized, arrived, with weight.',
    when: 'The card flies from the stack and lands on the table with dust.',
  },
  'card.enterHeavy': {
    category: 'game', frequency: 'per turn', lufs: -16, maxDur: 1.2,
    purpose: 'A big creature (power 4 or more) lands: a heavy, ground-shaking arrival.',
    when: 'The card lands and the table shakes.',
  },
  'card.token': {
    category: 'game', frequency: 'per turn', lufs: -22, maxDur: 0.65,
    purpose: 'A token is created: it materializes from nothing, a program compiling into the grid; lighter than a card entering.',
    when: 'The token scales up out of a burst of light.',
  },
  'card.destroy': {
    category: 'game', frequency: 'per turn', lufs: -17, maxDur: 1.05, variants: 2, accent: 0.32,
    purpose: 'A permanent is destroyed or dies: it shatters and derezzes into voxels. Dramatic, final, the Tron signature.',
    when: 'The card is struck, cracks and bursts into flying shards.',
  },
  'card.sacrifice': {
    category: 'game', frequency: 'per turn', lufs: -19, maxDur: 0.85, accent: 0.62,
    purpose: 'A permanent is sacrificed: given up, it sinks and is consumed in a dark swirl (not broken like destroy).',
    when: 'The card sinks into the table in purple smoke.',
  },
  'card.exile': {
    category: 'game', frequency: 'per turn', lufs: -19, maxDur: 0.85, accent: 0.5,
    purpose: 'A card is exiled: banished, drawn into a single point of light and gone.',
    when: 'The card flares white and shrinks into a point.',
  },
  'card.bounce': {
    category: 'game', frequency: 'rare', lufs: -22, maxDur: 0.55, accent: 0.295,
    purpose: "A permanent returns to its owner's hand: recalled, a reverse whoosh back.",
    when: 'The card flies back to the hand.',
  },
  'card.toGraveyard': {
    category: 'game', frequency: 'per turn', lufs: -25, maxDur: 0.42, accent: 0.34,
    purpose: 'A card goes to a graveyard (a finished spell, a discard, a mill): filed away, a soft downward swish.',
    when: 'The card flies into the graveyard pile.',
  },
  'card.toLibrary': {
    category: 'game', frequency: 'rare', lufs: -25, maxDur: 0.42, accent: 0.34,
    purpose: 'A card goes into a library: tucked away into the deck.',
    when: 'The card flies into the library pile.',
  },
  'card.tap': {
    category: 'game', frequency: 'very frequent', lufs: -28, maxDur: 0.12, variants: 3,
    purpose: 'A permanent is tapped: a small, crisp mechanical-digital "clack" as it turns sideways.',
    when: 'The card turns sideways.',
  },
  'card.untap': {
    category: 'game', frequency: 'per turn', lufs: -25, maxDur: 0.42,
    purpose: 'Your permanents untap: a quick reset sweep, everything ready again (once for the whole board).',
    when: 'The untap step: the tapped cards turn upright.',
  },
  'card.flip': {
    category: 'game', frequency: 'rare', lufs: -21, maxDur: 0.65, accent: 0.18,
    purpose: 'A card transforms, flips or turns face up or down: a phase shift into another form.',
    when: 'A flash of light and a pop as the new face shows.',
  },
  'card.attach': {
    category: 'game', frequency: 'rare', lufs: -23, maxDur: 0.42,
    purpose: 'An Aura or Equipment is attached: docked and locked on, magnetic.',
    when: 'The attachment moves under the permanent it now enchants or equips.',
  },
  'card.control': {
    category: 'game', frequency: 'rare', lufs: -21, maxDur: 0.75,
    purpose: 'A permanent changes control: hacked and reassigned to the other side.',
    when: 'The card moves to the other player\'s side.',
  },
  'card.phase': {
    category: 'game', frequency: 'rare', lufs: -23, maxDur: 0.65,
    purpose: 'A permanent phases out: it flickers out of existence for a while.',
    when: 'The permanent fades out of play.',
  },
  'card.reveal': {
    category: 'game', frequency: 'rare', lufs: -24, maxDur: 0.65,
    purpose: 'Cards are revealed or looked at (scry, surveil, reveal): a scan exposing data.',
    when: 'A reveal notice shows the cards.',
  },
  'card.search': {
    category: 'game', frequency: 'rare', lufs: -24, maxDur: 0.85,
    purpose: 'A library is searched: scanning through data for a match.',
    when: 'A player searches a library.',
  },
  'card.zoom': {
    category: 'game', frequency: 'very frequent', lufs: -35, maxDur: 0.16, variants: 3,
    purpose: 'A card is enlarged for a closer look: a soft optical zoom-in, unobtrusive.',
    when: 'The card zoom opens (hover or press on a card).',
  },
  'card.pickup': {
    category: 'game', frequency: 'per turn', lufs: -28, maxDur: 0.13,
    purpose: 'You pick up a card from your hand: lifted, ready to be played.',
    when: 'A drag of a hand card starts.',
  },
  'card.drop': {
    category: 'game', frequency: 'per turn', lufs: -26, maxDur: 0.2,
    purpose: 'You let go of a card over the table to play it: released, committed.',
    when: 'A dragged card is dropped past the play line.',
  },
  'card.target': {
    category: 'game', frequency: 'per turn', lufs: -25, maxDur: 0.26,
    purpose: 'You chose a target: target locked, precise and confident.',
    when: 'A card or player is chosen as a target.',
  },
  'card.targeted': {
    category: 'game', frequency: 'per turn', lufs: -24, maxDur: 0.55,
    purpose: 'The opponent targets something of yours: a warning lock-on alert, attention without panic.',
    when: "The opponent's spell or ability targets your card or you (a targeting arrow appears).",
  },
} satisfies Record<string, SoundMeta>;

export type SoundId = keyof typeof SOUND_META;
export const SOUND_IDS = Object.keys(SOUND_META) as SoundId[];

export function soundMeta(id: SoundId): SoundMeta {
  return SOUND_META[id];
}

/** The recipes, by id. A sound without a recipe yet falls back to a plain placeholder blip (the tests list them). */
export const RECIPES: Partial<Record<SoundId, Recipe>> = {
  ...UI_SOUNDS,
  ...FLOW_SOUNDS,
  ...MOMENT_SOUNDS,
  ...SPELL_SOUNDS,
  ...MAGIC_SOUNDS,
  ...COMBAT_SOUNDS,
  ...CARD_SOUNDS,
  ...ZONE_SOUNDS,
};

/** Which recipe file (audio/sounds/<group>.ts) holds a sound: the review and the render tool work group by group. */
export const SOUND_GROUPS: Record<string, readonly string[]> = {
  ui: ['ui.', 'deck.'],
  flow: ['game.start', 'game.mulligan', 'game.keep', 'game.shuffle', 'turn.', 'priority.', 'game.handoff', 'game.coin', 'game.dice'],
  moments: ['game.finalBlow', 'game.victory', 'game.defeat', 'game.drawn', 'world.', 'net.', 'ambient.'],
  spells: ['cast.', 'impact.'],
  magic: ['mana.', 'spell.', 'ability.'],
  combat: ['combat.', 'hit.', 'life.', 'counter.', 'stat.', 'damage.'],
  cards: ['card.draw', 'card.land', 'card.enter', 'card.token', 'card.destroy', 'card.sacrifice', 'card.exile', 'card.bounce', 'card.to', 'card.tap', 'card.untap'],
  zones: ['card.flip', 'card.attach', 'card.control', 'card.phase', 'card.reveal', 'card.search', 'card.zoom', 'card.pickup', 'card.drop', 'card.target'],
};

export function soundGroup(id: string): string {
  for (const [g, prefixes] of Object.entries(SOUND_GROUPS)) if (prefixes.some((p) => id.startsWith(p))) return g;
  return 'other';
}

function placeholder(ctx: Ctx): Stereo {
  const n = Math.round(ctx.sr * 0.06);
  const l = new Float32Array(n);
  for (let i = 0; i < n; i++) l[i] = Math.sin((2 * Math.PI * 880 * i) / ctx.sr) * Math.exp(-i / (ctx.sr * 0.015));
  return { l, r: l.slice() };
}

/** The sounds that have no recipe yet. */
export function missingRecipes(): SoundId[] {
  return SOUND_IDS.filter((id) => !RECIPES[id]);
}

export function variantCount(id: SoundId): number {
  return (SOUND_META[id] as SoundMeta).variants ?? 1;
}

/** The finished sound: the recipe rendered at `sr` for `variant`, then levelled to its loudness (dsp.ts master). Deterministic. */
export function renderSound(id: SoundId, sr: number, variant = 0): Stereo {
  const meta = SOUND_META[id] as SoundMeta;
  const ctx = makeCtx(sr, hashString(id), variant);
  const recipe = RECIPES[id] ?? placeholder;
  const raw = recipe(ctx);
  if (meta.loop) return master(ctx, raw, { lufs: meta.lufs, loop: true });
  return master(ctx, raw, { lufs: meta.lufs });
}
