extends Control
## The base of every decision prompt scene (prompts/<Kind>.tscn, an inherited scene of prompts/PromptFrame.tscn).
##
## Contract with the prompt layer (scenes/Table.tscn's Prompt layer, written separately):
## - instantiate prompts/<Kind>.tscn for `view.pending.kind` (Kind = the kind with a capital first letter), connect the signals, then
##   call `setup(decision, view, client)`. setup may come before or after the scene enters the tree.
## - `answered(answer)` carries EXACTLY the engine's DecisionAnswer for the decision's kind (packages/engine/src/types/decisions.ts); the
##   layer wraps it as {type:'answer', player: decision.player, decisionId: decision.id, answer}.
## - `cancelled()` is emitted only when `decision.cancellable` is true; the layer sends {type:'cancel', player}.
## - Exception: the priority scene emits `acted(action)` with a whole engine Action instead (see Priority.gd).
## - After a refused action the layer may call `show_error(message, rules)`; `set_busy(true/false)` blocks the buttons while an
##   action is on its way. One decision per instance: the layer makes a new scene for each decision id.
##
## `client` is read only through Object.get/call, so any Node with these members works (tests pass a fake):
##   client.legal: Array of LegalAction Dictionaries; client.selection: an Object with signals card_clicked(id: String),
##   player_clicked(id: String) and methods set_selectable(ids: Array), set_selected(ids: Array), clear() (and, if it has it,
##   set_marks(marks: Dictionary): short text to draw beside a card, never over its picture).
##
## Keys: Space = the primary action (the OK button), Esc = cancel (after a prompt's own use of Esc, e.g. dropping a picked blocker).
## Theme: the project theme (res://theme/neon_grid.tres via project.godot). Nothing is styled here; the frame uses the type variations
## PromptPanel, PromptTitle, PromptRules, PromptDetail, PromptWarning, PromptError and PromptPrimary, which fall back to the base types
## when the theme does not define them.

signal answered(answer: Dictionary)
signal cancelled()

## The label column of a grid of fields (make_cell_label).
const CELL_LABEL_WIDTH: float = 140.0

const J := preload("res://prompts/lib/json_read.gd")
const Names := preload("res://prompts/lib/names.gd")

## How long after a prompt appears its buttons start to work (ms): the second click of a double click must not answer the next prompt
## (the browser's armDelayMs). Tests set it to 0.
var arm_delay_ms: int = 300
## Answer at once where the browser does (a cost with only one way to pay; a lone opponent as the only legal target). Tests turn it off.
var auto_answer: bool = true

var decision: Dictionary = {}
var view: Dictionary = {}
var client: Node = null

## The prompt's chip buttons by id (cards and players), kept so a refresh updates them in place.
var chip_buttons: Dictionary = {}
var _chip_labels: Dictionary = {}

## The decision drawn large over the dimmed table (PromptStage), or null: away from the table (a prompt shown alone, the tests)
## the prompt stays the plain one.
var stage: PromptStage = null

var _started: bool = false
var _armed_at: int = 0
var _busy: bool = false
var _ok_enabled: bool = true
var _selection: Object = null
var _selectable: Array = []

@onready var title_label: Label = $Frame/Box/Title
@onready var rules_label: Label = $Frame/Box/Rules
@onready var detail_label: Label = $Frame/Box/Detail
@onready var body: VBoxContainer = $Frame/Box/Body
@onready var problem_label: Label = $Frame/Box/Problem
@onready var error_label: Label = $Frame/Box/Error
@onready var actions: HBoxContainer = $Frame/Box/Actions
@onready var ok_button: Button = $Frame/Box/Actions/Ok
@onready var cancel_button: Button = $Frame/Box/Actions/Cancel


func setup(p_decision: Dictionary, p_view: Dictionary, p_client: Node) -> void:
	if _started:
		push_warning("A prompt scene answers one decision; make a new scene for the next one.")
		return
	decision = p_decision
	view = p_view
	client = p_client
	if is_node_ready():
		_start()


func _ready() -> void:
	if not decision.is_empty():
		_start()


func _exit_tree() -> void:
	if _selection == null:
		return
	if _selection.is_connected("card_clicked", _on_selection_card):
		_selection.disconnect("card_clicked", _on_selection_card)
	if _selection.is_connected("player_clicked", _on_selection_player):
		_selection.disconnect("player_clicked", _on_selection_player)
	# Clear only what this prompt published: the next prompt may already have published its own selection.
	if _selection.has_method("clear") and _selection.get_meta(&"prompt_owner", 0) == get_instance_id():
		_selection.call("clear")
		_selection.remove_meta(&"prompt_owner")
	_selection = null


func _start() -> void:
	if _started:
		return
	_started = true
	title_label.text = J.str_of(decision, "prompt")
	# A decision redirected to this player because its player left the game (CR 800.4g-h: "Bob left the game; you choose for
	# them (CR 800.4g). …") says so above the choice, and the choice keeps its own words.
	var redirect_re := RegEx.create_from_string("(?s)^(.+?) left the game; you choose for them \\((CR 800\\.4[gh])\\)\\.\\s*(.*)$")
	var redirected := redirect_re.search(J.str_of(decision, "prompt"))
	if redirected != null:
		title_label.text = redirected.get_string(3)
		var notice := make_label("%s left the game: you choose for them (%s)." % [redirected.get_string(1), redirected.get_string(2)], &"PromptWarning")
		title_label.get_parent().add_child(notice)
		title_label.get_parent().move_child(notice, title_label.get_index())
	var cites := J.strings(decision, "rules")
	rules_label.text = ", ".join(J.packed(cites))
	rules_label.visible = not cites.is_empty()
	cancel_button.visible = is_cancellable()
	ok_button.pressed.connect(_on_ok_pressed)
	cancel_button.pressed.connect(_on_cancel_pressed)
	_armed_at = Time.get_ticks_msec() + arm_delay_ms
	_connect_selection()
	_build()
	_refresh()


# ---- for the prompt scripts to override -------------------------------------------------------------------------------------------

## Build the prompt's own controls (in `body` and `actions`). Called once, after setup, in the tree.
func _build() -> void:
	pass


## Update the controls, the OK button and the board selection from the prompt's state. Called after _build and after every change.
func _refresh() -> void:
	pass


## The primary action (the OK button and Space).
func _on_ok() -> void:
	pass


## A selectable card (or, by default, player) was clicked on the board.
func _on_card_clicked(_id: String) -> void:
	pass


func _on_player_clicked(id: String) -> void:
	_on_card_clicked(id)


## Esc: return true when the prompt used it (dropping a pick); otherwise a cancellable decision is cancelled.
func _on_escape() -> bool:
	return false


# ---- for the prompt layer -----------------------------------------------------------------------------------------------------------

## Block (or unblock) the buttons while an action is on its way.
func set_busy(b: bool) -> void:
	_busy = b
	if _started:
		ok_button.disabled = b or not _ok_enabled
		cancel_button.disabled = b
		if not b:
			_refresh()


## The engine refused the last action: say why, with its rules.
func show_error(message: String, cites: Array = []) -> void:
	if not _started:
		return
	var text := "Not allowed: %s" % message
	if not cites.is_empty():
		text += " (%s)" % ", ".join(J.packed(cites))
	error_label.text = text
	error_label.visible = true


# ---- helpers ------------------------------------------------------------------------------------------------------------------------

func is_cancellable() -> bool:
	return J.bool_of(decision, "cancellable")


func is_armed() -> bool:
	return Time.get_ticks_msec() >= _armed_at


## Emit the answer (the engine's DecisionAnswer), unless the prompt is not armed yet or busy.
func send_answer(answer: Dictionary) -> void:
	if _busy or not is_armed():
		return
	error_label.visible = false
	answered.emit(answer)


func send_cancel() -> void:
	if not is_cancellable() or _busy or not is_armed():
		return
	cancelled.emit()


## Answer on the next idle frame, without the arm delay (the browser's automatic answers: nothing to choose).
func send_answer_deferred(answer: Dictionary) -> void:
	_emit_deferred.call_deferred(answer)


func _emit_deferred(answer: Dictionary) -> void:
	if not _busy and is_inside_tree():
		answered.emit(answer)


func set_detail(text: String) -> void:
	detail_label.text = text
	detail_label.visible = text != ""


## A warning under the body ("" hides it): why OK is disabled, or why the engine will refuse.
func set_problem(text: String) -> void:
	problem_label.text = text
	problem_label.visible = text != ""


func set_ok(enabled: bool, label: String = "") -> void:
	_ok_enabled = enabled
	ok_button.disabled = not enabled or _busy
	if label != "":
		ok_button.text = label


## Open the stage over the table, with its title and the line under it and a hint under its buttons: this prompt's buttons move
## onto it, big, with the lines that say why OK is off or why the engine refused; the frame steps aside (the stage says what it
## said). Null away from the table. Call it at the end of _build (the buttons it restyles are the ones there then).
func open_stage(stage_title: String, line: String = "", hint: String = "") -> PromptStage:
	var scene := get_tree().current_scene if is_inside_tree() else null
	if scene == null or not scene.has_method("show_zoom"):
		return null
	stage = PromptStage.new()
	stage.title = stage_title
	stage.subtitle = line
	add_child(stage)
	move_child(stage, 0)
	stage.take_actions(actions, ok_button, hint)
	stage.take_labels([problem_label, error_label])
	$Frame.visible = false
	return stage


## Add a button to the action row, before Cancel.
func add_action(text: String, node_name: String, callback: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.name = node_name.validate_node_name()
	b.pressed.connect(callback)
	actions.add_child(b)
	actions.move_child(b, cancel_button.get_index())
	return b


func make_label(text: String, variation: StringName = &"") -> Label:
	var l := Label.new()
	l.text = text
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	if variation != &"":
		l.theme_type_variation = variation
	return l


## The label of a field in a grid row. A wrapping label has no width of its own: beside an expanding control (a slider, a
## picker) it shrank to one letter a line and stretched the whole row, so it keeps CELL_LABEL_WIDTH of the frame's 420 px.
func make_cell_label(text: String, variation: StringName = &"") -> Label:
	var l := make_label(text, variation)
	l.custom_minimum_size = Vector2(CELL_LABEL_WIDTH, 0)
	return l


## A field in a grid row: as wide as the row leaves it, as tall as itself (not the row's height).
static func fit_cell(c: Control) -> Control:
	c.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	c.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	return c


## An action whose label names a card ("Put Isamaru, Hound of Konda into the command zone") wraps inside the frame instead of
## widening it across the table.
static func wrap_action(b: Button) -> void:
	b.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	b.size_flags_horizontal = Control.SIZE_EXPAND_FILL


## A wrapping row of toggle buttons ("chips") for object or player ids, labelled like the browser's chips ("Forest #2"); a click
## calls `on_click(id)`. The buttons are named Chip_<id> and kept in `chip_buttons`; `update_chip` sets their state.
func add_chips(parent: Node, ids: Array, on_click: Callable, labels: Dictionary = {}) -> HFlowContainer:
	var row := HFlowContainer.new()
	var names_by_id: Dictionary = labels if not labels.is_empty() else Names.distinct_labels(view, ids)
	for id: Variant in ids:
		var sid := str(id)
		var b := Button.new()
		b.name = ("Chip_" + sid).validate_node_name()
		b.toggle_mode = true
		b.text = str(names_by_id.get(sid, sid))
		b.pressed.connect(on_click.bind(sid))
		row.add_child(b)
		chip_buttons[sid] = b
		_chip_labels[sid] = b.text
	parent.add_child(row)
	return row


func update_chip(id: String, selected: bool, mark: String = "", disabled: bool = false) -> void:
	var b: Button = chip_buttons.get(id)
	if b == null:
		return
	b.set_pressed_no_signal(selected)
	b.disabled = disabled
	var base := str(_chip_labels.get(id, id))
	b.text = base if mark == "" else "%s · %s" % [base, mark]


## Remove and free every child of `node` now (so rebuilt children keep their names).
func clear_children(node: Node) -> void:
	for c: Node in node.get_children():
		node.remove_child(c)
		c.queue_free()


## What the board may click now and what is chosen; marks are short texts drawn beside the cards.
func publish_selection(selectable: Array, selected: Array = [], marks: Dictionary = {}) -> void:
	_selectable = selectable.duplicate()
	if _selection == null:
		return
	_selection.set_meta(&"prompt_owner", get_instance_id())
	if _selection.has_method("set_selectable"):
		_selection.call("set_selectable", selectable)
	if _selection.has_method("set_selected"):
		_selection.call("set_selected", selected)
	if _selection.has_method("set_marks"):
		_selection.call("set_marks", marks)


## The viewer's legal priority actions (client.legal), or [].
func legal_actions() -> Array:
	if client == null:
		return []
	var v: Variant = client.get("legal")
	if not (v is Array):
		return []
	var out: Array = []
	for a: Variant in v:
		if a is Dictionary:
			out.append(a)
	return out


func _connect_selection() -> void:
	if client == null:
		return
	var s: Variant = client.get("selection")
	if not (s is Object):
		return
	_selection = s
	if _selection.has_signal("card_clicked"):
		_selection.connect("card_clicked", _on_selection_card)
	if _selection.has_signal("player_clicked"):
		_selection.connect("player_clicked", _on_selection_player)


func _on_selection_card(id: String) -> void:
	if _selectable.has(id) and not _busy:
		_on_card_clicked(id)


func _on_selection_player(id: String) -> void:
	if _selectable.has(id) and not _busy:
		_on_player_clicked(id)


func _on_ok_pressed() -> void:
	if ok_button.disabled or not ok_button.visible or _busy:
		return
	_on_ok()


func _on_cancel_pressed() -> void:
	send_cancel()


func _unhandled_key_input(event: InputEvent) -> void:
	var k := event as InputEventKey
	if k == null or not k.pressed or k.echo or not _started:
		return
	if k.keycode == KEY_ESCAPE:
		if _on_escape():
			get_viewport().set_input_as_handled()
		elif is_cancellable():
			send_cancel()
			get_viewport().set_input_as_handled()
	elif k.keycode == KEY_SPACE and not k.ctrl_pressed and not k.alt_pressed and not k.meta_pressed:
		if ok_button.visible and not ok_button.disabled:
			_on_ok_pressed()
			get_viewport().set_input_as_handled()
