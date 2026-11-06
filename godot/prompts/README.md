# Prompt scenes: the contract

One scene per decision kind of the engine (`packages/engine/src/types/decisions.ts` in the TypeScript source). The Table's prompt
layer (`scenes/PromptLayer.gd`) shows the scene for the pending decision when the player at this screen has to answer it,
and turns what the scene emits into the engine's `Action` (`types/actions.ts`). This file is the whole contract; nothing
else in the project depends on how a prompt is built inside.

## File names

`prompts/<Kind>.tscn`, where `<Kind>` is the decision kind with its first letter upper-cased:

| kind | scene |
|---|---|
| `priority` | `prompts/Priority.tscn` |
| `playFirst` | `prompts/PlayFirst.tscn` |
| `mulligan` | `prompts/Mulligan.tscn` |
| `chooseObjects` | `prompts/ChooseObjects.tscn` |
| `yesNo` | `prompts/YesNo.tscn` |
| `chooseOption` | `prompts/ChooseOption.tscn` |
| `chooseNumber` | `prompts/ChooseNumber.tscn` |
| `chooseColor` | `prompts/ChooseColor.tscn` |
| `order` | `prompts/Order.tscn` |
| `chooseTargets` | `prompts/ChooseTargets.tscn` |
| `payCost` | `prompts/PayCost.tscn` |
| `declareAttackers` | `prompts/DeclareAttackers.tscn` |
| `declareBlockers` | `prompts/DeclareBlockers.tscn` |
| `assignDamage` | `prompts/AssignDamage.tscn` |
| `chooseReplacement` | `prompts/ChooseReplacement.tscn` |
| `manualResolve` | `prompts/ManualResolve.tscn` |
| `chooseDivision` | `prompts/ChooseDivision.tscn` |
| `chooseName` | `prompts/ChooseName.tscn` |
| `commanderZone` | `prompts/CommanderZone.tscn` |

The layer also accepts `prompts/<kind>.tscn` (the kind exactly as written). A kind with no scene gets
`prompts/Fallback.tscn` when it exists, else `scenes/FallbackPrompt.tscn` (a developer panel: legal actions as buttons for
`priority`, a JSON box otherwise), so a missing scene never blocks a game. Keep each scene's script next to it
(`prompts/ChooseObjects.gd`).

## The root node

The root is a `Control` (any Control type: `PanelContainer` is the usual one) with a script that has:

```gdscript
extends PanelContainer

signal answered(answer: Dictionary)   # required
signal cancelled()                    # required (emit only when decision.cancellable is true)
signal acted(action: Dictionary)      # optional: the priority scene (and a fallback that passes); `action_chosen` also works

func setup(decision: Dictionary, view: Dictionary, client: Node) -> void:   # required
	pass

func set_busy(busy: bool) -> void:                          # optional
	pass

func show_error(message: String, rules: Array = []) -> void:   # optional
	pass

func view_changed(view: Dictionary) -> void:                # optional
	pass

func rejected(error: Dictionary) -> void:                   # optional
	pass
```

A scene whose root lacks `setup`, `answered` or `cancelled` is replaced by the fallback (with a warning in the output).

- **Placement.** The layer is a full-screen `Control` that lets every click through to the board. The prompt places
  itself with anchors, and must leave the board clickable: a panel anchored at the bottom right (about 380 px wide, above
  the viewer's hand) is the default; a small one may sit at the top centre. Do not make the root full-screen with
  `mouse_filter = STOP`. Use the project theme (`theme/neon_grid.tres` is applied to every Control); never hard-code
  colours that ignore it (read `NeonTheme.colors()` for the two neon colours if you draw your own).
- **`setup` is called once**, right after the scene entered the tree (so `@onready` variables are ready). `decision` is the
  pending decision as parsed JSON; `view` is the whole view (`GameView`); `client` is the `GameClient` autoload.
- **Numbers arrive as floats** (JSON). Read them with `Val.num(decision, "max")` (and the other `Val` helpers in
  `model/Val.gd`), never with `int(decision.max)` on a value that may be missing or null.
- **What the scene may read from `client`:** `client.legal` (Array of LegalAction `{action, kind, label, isMana, object?}`),
  `client.selection` (a `BoardSelection`, or null when no Table is open, as in tests), `client.view`, `client.viewer`,
  `client.can_undo`, `client.is_playable(id)`, `client.legal_for(id)`. **Never call `client.act`**: emit a signal instead,
  so the layer can tie the reply to the prompt. One exception: the priority scene's hold-priority toggle may call
  `client.stops(player, stops)` with the player's whole StopSettings and `holdPriority` set (stops are never stale and are
  not an answer). Reading `client` through `client.get("legal")` / `client.call(...)` lets tests pass any `Node` with these
  members.
- **Lifetime.** The layer frees the scene when the decision is answered (a new decision id arrives), when the decision is
  no longer the viewer's (a hot-seat hand-off, the opponent's turn) or when the Table closes. Keep no state outside it.
  While the same decision stays pending and a new view arrives (a stop toggled, a clock), `view_changed(view)` is called if
  the scene has it.
- **Busy and refusals.** After the scene emits `answered`, `acted` or `cancelled`, the layer calls `set_busy(true)` if the
  scene has it (block the buttons until the answer is settled). If the engine refuses, the decision stays pending and the
  scene stays up: the layer calls `set_busy(false)`, then `show_error(message, rules)` if the scene has it (otherwise the
  layer shows the message itself for a few seconds), then `rejected({message, rules})` if the scene has it. If the answer
  was accepted but the same decision is still pending, the layer calls `set_busy(false)`.

## What the layer sends

| scene emits | the layer sends with `GameClient.act` |
|---|---|
| `answered(answer)` | `{type: 'answer', player: decision.player, decisionId: decision.id, answer: answer}` |
| `cancelled()` | `{type: 'cancel', player: decision.player}` |
| `acted(action)` or `action_chosen(action)` | `action` as it is |

`decision.player` is used even when `decision.decidedBy` is the viewer (CR 723.5: the controller answers for the controlled
player; the answer still names the controlled player).

## Answers, by kind (`DecisionAnswer` in types/decisions.ts)

Every answer carries `kind`, the decision's kind. Send whole numbers as ints.

| kind | decision fields to read | answer |
|---|---|---|
| `priority` | `player`; `client.legal` | not an answer: `acted({type: 'pass', player})`, `{type: 'pass', player, resolveAll: true}` (Resolve all), or the `action` of a LegalAction (play a land, cast, activate, special, manualTrigger, manualStatic) |
| `playFirst` | `options` (player ids) | `{kind, player}` |
| `mulligan` | `handSize`, `mulligans` | `{kind, keep: bool}` |
| `chooseObjects` | `options` (object ids), `min`, `max`, `ordered?`, `limit?` | `{kind, ids: [ObjectId]}` |
| `yesNo` | `yesLabel?`, `noLabel?` | `{kind, yes: bool}` |
| `chooseOption` | `options [{id, label, disabled?}]`, `min`, `max`, `allowRepeat?` | `{kind, ids: [string]}` |
| `chooseNumber` | `min`, `max` | `{kind, n: int}` |
| `chooseColor` | `options` (W U B R G C) | `{kind, color}` |
| `order` | `items [{id, label}]` | `{kind, ids: [string]}` (all of them, in the chosen order) |
| `chooseTargets` | `targetText`, `objects`, `players`, `min`, `max` | `{kind, targets: [{kind: 'object', id} or {kind: 'player', id}]}` |
| `payCost` | `costText`, `manaSources [{objectId, abilityKey, label, produces}]`, `autoPayable`, `onlyWay?`, `forPlayer?`, `origin?` | `{kind, auto: true}` or `{kind, auto: false, activations: [{objectId, abilityKey, color?}], lifeForPhyrexian?: [int], spendPool?: [int]}` |
| `declareAttackers` | `candidates [{id, defenders, mustAttack?, onlyWithOthers?, taxed?}]`, `requirements?`, `mustObey?`, `obeying?`, `unchecked?`, `limits?` | `{kind, attacks: [{attacker, defender}]}` |
| `declareBlockers` | `candidates [{id, attackers, maxBlocks, onlyWithOthers?}]`, `needsMultiple`, `maxBlockers?`, `minBlockers?`, `requirements?`, `mustObey?`, `obeying?`, `unchecked?`, `limits?` | `{kind, blocks: [{blocker, attacker}]}` |
| `assignDamage` | `attacker`, `amount`, `recipients [{id, lethal, trampleTarget?}]`, `canTrample` | `{kind, amounts: [{id, amount: int}]}` |
| `chooseReplacement` | `options [{id, label, klass?}]` | `{kind, id}` |
| `manualResolve` | `sourceName`, `text`, `resolvingId?`, `subjectId?`, `bound?`, `done?`, `reminder?`, `reason?`, `step?` | `{kind, ops: [ManualOp], continue?: bool}` |
| `chooseDivision` | `what`, `total`, `targets [{id, label}]` | `{kind, amounts: [int]}` (one per target, in order) |
| `chooseName` | `what`, `options?`, `cardKind?` | `{kind, name}` |
| `commanderZone` | `object`, `card`, `rule`, `zone` | `{kind, command: bool}` |

The client validates nothing by itself (the server is the judge): it disables what the decision says is not
allowed (an option's `disabled`, `min`/`max`, a defender not in a candidate's list) and lets the engine refuse the rest.

## Clicking the board: `BoardSelection`

For decisions about objects and players on the table (`chooseObjects`, `chooseTargets`, `declareAttackers`,
`declareBlockers`, and any other scene that wants it), use `client.selection` (`model/Selection.gd`, class
`BoardSelection`). The Table owns it, draws the glows and reports clicks; the prompt decides what a click means.

```gdscript
var _sel: BoardSelection

func setup(decision: Dictionary, view: Dictionary, client: Node) -> void:
	_sel = client.selection
	if _sel != null:
		_sel.set_selectable(Val.texts(decision, "objects") + Val.texts(decision, "players"))
		_sel.hint = Val.text(decision, "targetText")
		_sel.card_clicked.connect(_toggle)
		_sel.player_clicked.connect(_toggle)

func _toggle(id: String) -> void:
	# keep your own chosen list, then show it:
	_sel.set_selected(_chosen)
```

- `set_selectable(ids)`: the ids that may be clicked (object ids and player ids in one list). While any id is selectable,
  clicks on other cards do nothing (the board's own action menu is off).
- `set_selected(ids)`: what is chosen so far (drawn with the second neon).
- `set_marks({id: text})`: short texts drawn as a chip above those cards, never over the picture ("Attacks Ann", "3",
  "1st"); `{}` removes them.
- `hint`: a short line the Table shows above the board; set it before `set_selectable`/`set_selected` (they redraw).
- `card_clicked(id)`, `player_clicked(id)`: a selectable card or player panel was clicked.
- `clear()`: the layer calls it when the prompt closes (it also removes the marks and the hint); call it yourself only if
  the scene stops selecting earlier.

The board shows the battlefield, the hands and the stack. Objects anywhere else (a library search, a graveyard, exile, the
command zone) are not on the board: list them in the prompt itself, drawing each with the card scene
(`preload("res://scenes/Card.tscn")`, add it to the tree, then `show_object(view, id)` and `set_card_scale(0.6)`).

## Helpers you can use

`View` (players, zones, objects, names, rows, stack, pending, turn, combat, log), `Chars` (what the view says about an
object's name, cost, types, text, power and toughness), `Val` (safe JSON reads), `Config` (formats, steps), `NeonTheme`
(the two colours), `CardView` (`scenes/Card.tscn`). All are static, need no setup, and never change the view.

## Tests

Each scene gets a gdUnit4 test in `tests/prompts/test_<kind>.gd`: instantiate the scene, add it to the test's scene tree,
call `setup` with a fixture decision of its kind, a fixture view and a stub client (a `Node` with `legal`, `selection`,
`view` and `viewer` properties), drive its controls, and check that it emits an answer of the right shape (or `cancelled`).
Fixture views come from the TypeScript source's test helpers, scrubbed of card text like `tests/fixtures/patches/view_*.json`.
