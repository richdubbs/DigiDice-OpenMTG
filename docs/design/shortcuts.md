# Shortcuts: repeating a loop of actions (CR 727)

Owner request 2026-10-30: the table must handle loops the way a real table does. A player who can repeat a sequence of
actions (activations, passes, the choices inside them) says "I do this X times"; the other players agree, or name the pass
where they will step in; the game then skips to the result. Before this design the engine had no notion of it: every pass
was clicked through by hand.

Rules (cited from memory in a cloud session, unverified against `rules/cr/`): CR 727.1 (a shortcut skips parts of the
technical play sequence by agreement), 727.2a (the player with priority proposes a sequence of game choices, for all
players, repeated a number of times), 727.2b (each other player, in turn order after the proposer, accepts or shortens it by
naming the point where they will deviate), 727.2c (the shortcut is performed up to that point). A loop with no choices in it
(CR 104.4b, a draw) is a different matter and is not changed here.

## 1. What is recorded

The engine keeps, in the state, the settled actions of the current turn:

```ts
/** CR 727: a settled action of this turn with the answers it took, so a player can propose to repeat a sequence of them. */
export interface TurnActionRec {
  /** A priority action or a pass (never an answer, a cancel, a concession, a stops change or a shortcut). */
  action: Extract<Action, { type: 'pass' | 'playLand' | 'cast' | 'activate' | 'manualTrigger' | 'manualStatic' | 'special' }>;
  /** Every answer the action took, in the order the decisions were asked (whoever answered). */
  answers: DecisionAnswer[];
  /** Multiplayer only, like `Suspension.answeredBy`: who gave each answer. */
  answeredBy?: PlayerId[];
}
// GameState: optional, absent = none (states saved before this still load); cleared when a turn begins; the newest last;
// at most TURN_ACTIONS_KEPT (64) entries, the oldest dropped.
turnActions?: TurnActionRec[];
```

`applyAction` records an entry when an action settles: a priority action or pass whose run ends settled (priority pending
or the game over), or an `answer` that settles a suspended action of those types (the entry is the suspended action with
all its answers). Nothing is recorded for the actions inside a shortcut (they run through the inner runner, below), for a
cancel, a concession or `setStops`. `turnActions` is not read by the layers (`NOT_READ_BY_LAYERS`), is deep-cloned by
`cloneState` through the generic `clone(rest)` path, and never appears in a view: the view derives two public things from it
(section 4). Hidden ids inside recorded answers therefore never leave the engine.

## 2. The proposal: a new action

```ts
/**
 * CR 727.2a: the player with priority proposes to repeat their last `steps` actions of this turn (with every pass and every
 * answer that came with them) `times` times. Each other player is then asked (a `shortcut` decision) before anything runs.
 */
| { type: 'shortcut'; player: PlayerId; steps: number; times: number }
```

Legal when the player has priority (pending priority, nothing suspended, the game not over), `1 <= steps <=
SHORTCUT_MAX_STEPS` (32), `1 <= times <= SHORTCUT_MAX_TIMES` (1000), and the player has at least `steps` own entries in
`turnActions`. **The body** is the span of `turnActions` from the proposer's `steps`-th newest action to the newest entry,
all players' entries included. Every entry of another player inside the span must be a `pass` (their passes are implied by
their agreement and carry the answers that were given while that pass resolved something); any other action of another
player in the span makes the proposal illegal ("another player acted during those steps"). The proposal is rejected with
`IllegalAction`, never half-applied (CR 733).

Constants live in `core/shortcut.ts` and are exported from the engine's index.

## 3. The consent decision

```ts
/** CR 727.2b: another player answers a proposed shortcut. */
export interface ShortcutDecision extends DecisionBase {
  kind: 'shortcut';
  proposer: PlayerId;
  times: number;
  /** The proposer's steps of one pass, in words, in order (public: each is an action everybody saw happen). */
  steps: string[];
}
// Answer: accept as proposed, or name the point where this player wants priority instead of being passed for.
| { kind: 'shortcut'; stop?: { pass: number; step: number } }   // 1 <= pass <= times, 1 <= step <= steps.length
```

The `shortcut` action runs like any other action through `run`, so the consent is the ordinary decision model: performing
it asks each other player still in the game, in turn order starting after the proposer, with `g.choose`; the run suspends
on each (the pending decision is theirs; the proposer's client shows "waiting"), and resumes when they answer. The answer
is validated in `core/validate.ts` (ranges above). The decision is not cancellable. An answer with `stop` means: "the first
time I would receive priority at or after step `step` of pass `pass`, give it to me instead of passing for me". Accepting
means passing wherever the shortcut would pass for you.

Step labels (`steps`) are made by the engine from the body's proposer entries against the current state: `pass` ->
"Pass priority" ("Resolve all" when `resolveAll`); `activate` -> "<source name>: <ability text>" (the source by its current
object, else its last known information); `cast` -> "Cast <name>"; `playLand` -> "Play <name>"; `special` -> "<kind>:
<name>"; `manualTrigger` / `manualStatic` -> "<name>: <ability text> (by hand)". Only public facts: every one of these
actions happened in the open. Other players' implied passes are not steps.

## 4. What the view shows

Two additions to `GameView`, computed for a seated viewer (`viewer !== null`), absent for a spectator:

```ts
/** CR 727: the viewer's own settled actions of this turn since another player last did something but pass, in words, oldest first. */
repeatable?: string[];
/** CR 727: when the viewer's last `loop` steps were just done twice in a row (the engine noticed a loop), that number. */
loop?: number;
```

`repeatable` lists the proposer's candidate steps (the same labels as section 3), newest last, at most
`SHORTCUT_MAX_STEPS`. `loop` is the smallest `n` such that the signatures of the viewer's last `n` steps equal the `n`
before them. A step's **signature** is its action and answers with every object id replaced by what the object is (the
card's `cardId` for a card, the definition id for a token or an emblem) so a card that changed zones, or a token made anew,
reads the same. The signature is also what the shortcut runner uses to tell "the same step" apart (section 5.2).

Neither field names an object id, so `blankUnshownIds` has nothing to blank in them.

## 5. Running the shortcut

Once every other player has answered, the same run goes on (it is still inside the proposer's action; the answers are the
consents). It logs the proposal and each answer, then runs passes.

### 5.1 The inner runner

A pass applies the body's entries in order on a working state `cur` (the clone the outer run is working on, after the
consents). Each entry is applied with the inner runner: a clone of `cur`, a `Game` with the entry's recorded answers
(`answeredBy` too), `perform(action)`, the same catch of `NeedDecision` as `run`, but **lenient**: answers left over are not
an engine bug here, they are a sign that the step went differently (5.3). `perform` is exported from `core/apply.ts` for it;
nothing else about `apply.ts` changes except the dispatch of `shortcut` (through `run`, like every priority action) and the
recording of section 1.

Between entries the runner looks at `cur.pending`:

- the proposer's priority -> apply the next body entry of the proposer (skipping any other player's entry that comes first in
  the body: that player was passed for automatically this time);
- another player's priority -> if that player's stop point is reached (5.4), stop there; else, if the next body entry is that
  player's pass, apply it with its recorded answers; else apply a plain `pass` for them (consented);
- the game over -> stop, done;
- anything else cannot happen: the inner runner never leaves an unanswered decision in `cur` (5.3).

When the body's entries are all applied, the pass is complete; the next pass starts from the body's first entry.

### 5.2 Rebinding object ids

The recorded actions and answers name objects by the ids they had then. Before an entry is applied, every object id in it
(`/^o\d+$/` strings, walked generically through the action and its answers; player ids are not object ids) is rebound
against `cur`:

1. the id still names an object -> unchanged;
2. else, if its last known information names a card (`lki[id].object.cardId`) and some object in `cur` has that `cardId` ->
   that object (the same card, wherever it went: a blink, a bounce, a reanimation);
3. else follow `lki[id].newId` while it is defined; an existing object at the end -> that object;
4. else, a token or anything without a card: the object in `cur` with the same `defId`, owner and controller in the zone the
   last known information left (`leftZone`), preferring one with the same tapped state and counters, and not one already
   bound in this entry; ties go to zone order;
5. else the id stays as it was: the engine rejects the step, which stops the shortcut (5.3).

The engine checks every rebound action and answer as usual (legality, targets, the decision's options), so a wrong
rebinding can only stop the shortcut, never apply a wrong step.

### 5.3 When a step no longer goes the same way

An entry whose inner run throws `IllegalAction` (or `IllegalAnswer`), ends with a decision pending (a question the recorded
answers did not cover), or ends with recorded answers left over, is **not applied**: `cur` stays as it was before the entry
(CR 733.1, nothing half-applied), the shortcut stops, and a log line says before which pass and step it stopped and why
("the loop no longer goes the same way: <message>"). The proposer then plays on by hand from there. An `EngineBug` is not
caught. A step that moves the game to another turn or step ends the shortcut after it; the step stays applied.

### 5.4 Stop points

While running, the position is (pass number, proposer steps applied in this pass). A player who answered `stop` gets
priority the first time `cur.pending` is their priority at a position `>=` (`stop.pass`, `stop.step`) in that order. The
shortcut ends there with that player holding priority, and a log line names them (CR 727.2b). The engine's own auto-pass is
unchanged inside the inner runs: a player the engine would pass for anyway (nothing to do) never reaches a stop point,
exactly as at a real table a player with no action cannot interrupt.

### 5.5 Log and events

Pass 1 is logged in full and its events are returned. For every later pass that completes, its log lines are removed again
(the log array of the working state is cut back to its length before the pass) and its events are dropped; a stopped pass
was never applied. At the end one line sums up: "Passes 2 to N went the same way (N passes in all)." or, when it ended
early, the stop line of 5.3 or 5.4. `history`, `turnStats`, counters and everything else in the state keep every pass: only
the wording is condensed.

### 5.6 Bounds

`SHORTCUT_MAX_TIMES` = 1000 passes per proposal (measured 2026-10-30: about 1 ms per pass with 40 objects on a small
board; a large board is a few times that, so a proposal stays within a few seconds). The step budget of each resolution
(`STEP_BUDGET`) still applies inside each inner run. A player who wants more proposes again.

### 5.7 What the shortcut never does

It never skips a pass (every pass is really played by the engine, so a threshold that is crossed at pass 37, a trigger that
appears, a player losing, a library running out, all happen exactly where they would), never extrapolates a result, never
answers a question the recorded pass did not answer, and never applies half a step.

## 6. Outside the engine

- **Action shape** (`core/action-shape.ts`): `shortcut: ['type', 'player', 'steps', 'times']`, both positive integers within
  the caps; the answer `shortcut: ['kind', 'stop']`. The replay format version goes to 2 with an identity upgrade (an action
  type was added, action-shape.ts' rule).
- **Hosted and online** (`packages/hosted/src/table/check.ts`, `packages/net`): a `shortcut` needs the player to hold priority;
  the engine decides the rest. Nothing to add to the manual-adjustment consent flow: the consent is a decision.
- **Computer opponent** (`packages/ai`): answers `shortcut` by accepting, unless it has a play it would make right now with a
  positive score (the same scoring as its priority decision, over the legal actions it would have with priority): then it
  stops at pass 1 after the proposer's last step, takes priority and plays.
- **Client**: the priority prompt shows "Repeat..." when `view.repeatable` is not empty; the panel lists the steps, preselects
  the last `view.loop` steps when a loop was noticed (else the last step), takes the number of times (default 10, or 100 for
  a noticed loop, at most `SHORTCUT_MAX_TIMES`) and sends the action. A `ShortcutPrompt` answers the decision: the steps in
  words, "Let it run", or "Stop at pass [n], step [j]". The log carries the outcome.
- **Godot table** (the other repository): one more decision kind, `shortcut`, in its prompt table.

## 7. Tests (engine)

Recording and clearing of `turnActions`; `repeatable` and `loop` in the view (and their absence from the opponent's view); a
free "{0}: You gain 1 life." repeated 50 times with the opponent agreeing (life, the log condensed to pass 1 plus one
summary); the opponent stopping at pass 3 and holding priority with the ability on the stack; a token made and sacrificed
each pass (rebinding by definition); a card that leaves and returns each pass (rebinding by `cardId`); a step that becomes
illegal part-way ("activate only three times each turn") stops the shortcut with the state after the last complete pass; a
loop that wins the game part-way ends the game there; proposals and answers out of range rejected; another player's action
inside the span rejected; three players, the earliest stop wins; a saved game with a shortcut replays to the same digest;
the state-key pin (`NOT_READ_BY_LAYERS`).
