class_name GameBar
extends Control
## The game's bar (packages/client/src/game/GameBar.tsx), in the table's own layout: Menu (the DigiDice mark; Home, Decks,
## Replays, Images, Settings, About: the game goes on meanwhile and Play returns to it), the turn in words ("Turn 2: Player 1,
## Precombat main"), and at the top right Undo (hot-seat), Concede ("Who concedes?" for the players at this screen) and Leave,
## which asks first while the game runs. Screens the app does not have yet are listed dimmed.

signal undo_pressed()
signal concede(player: String)
signal leave()
## The menu's Report a bug.
signal report_bug()

const LONG_STEPS: Dictionary = {
	"untap": "Untap", "upkeep": "Upkeep", "draw": "Draw", "main1": "Precombat main", "beginCombat": "Beginning of combat",
	"declareAttackers": "Declare attackers", "declareBlockers": "Declare blockers", "combatDamage": "Combat damage",
	"endCombat": "End of combat", "main2": "Postcombat main", "end": "End step", "cleanup": "Cleanup",
}
const MENU: Array = [["home", "Home"], ["decks", "Decks"], ["replays", "Replays"], ["images", "Images"], ["settings", "Settings"],
	["about", "About"]]

var _menu_button: Button = null
var _menu: PanelContainer = null
var _turn: Label = null
var _undo: Button = null
var _concede: Button = null
var _leave: Button = null
var _confirm: PanelContainer = null
var _over: bool = false
var _view: Dictionary = {}
var _notes_button: Button = null
var _notes: PanelContainer = null
var _notes_box: VBoxContainer = null
var _notes_key: String = ""
## The table layout switch, shown with three or four players (the same setting as Settings' Table section).
var _layout: OptionButton = null


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	var left := VBoxContainer.new()
	left.position = Vector2(14, 10)
	left.add_theme_constant_override("separation", 6)
	add_child(left)
	_menu_button = Hud.button("Menu")
	_menu_button.name = "Menu"
	var mark := Logo3D.make(26.0)
	mark.still = true
	mark.position = Vector2(8, 6)
	_menu_button.add_child(mark)
	_menu_button.custom_minimum_size = Vector2(120, 38)
	_menu_button.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	_menu_button.alignment = HORIZONTAL_ALIGNMENT_RIGHT
	_menu_button.pressed.connect(_toggle_menu)
	left.add_child(_menu_button)
	var game := Hud.kicker("Game", NeonTheme.colors()[0])
	left.add_child(game)
	_turn = Hud.text("", 13, Hud.TEXT)
	_turn.custom_minimum_size = Vector2(212, 0)
	left.add_child(_turn)
	# Reminders (manual text the engine does not enforce) and this turn's reveals of face-down cards (CR 708.9), counted on the
	# button, listed in a small panel under it.
	_notes_button = Hud.button("Reminders")
	_notes_button.visible = false
	_notes_button.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	_notes_button.pressed.connect(func() -> void:
		_notes.visible = not _notes.visible
		Sound.cue("ui.open" if _notes.visible else "ui.close"))
	left.add_child(_notes_button)
	_layout = OptionButton.new()
	_layout.tooltip_text = "How a game with three or four players is drawn"
	for l: Array in [["shared", "Shared table"], ["acrossTop", "Opponents across the top"], ["focused", "One focused opponent"]]:
		_layout.add_item(String(l[1]))
		_layout.set_item_metadata(_layout.item_count - 1, String(l[0]))
	_layout.item_selected.connect(func(i: int) -> void: Settings.set_table_layout(String(_layout.get_item_metadata(i))))
	_layout.visible = false
	_layout.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	left.add_child(_layout)
	_notes = Hud.panel(10)
	_notes.visible = false
	_notes.custom_minimum_size = Vector2(360, 0)
	_notes_box = VBoxContainer.new()
	_notes_box.add_theme_constant_override("separation", 6)
	_notes.add_child(_notes_box)
	left.add_child(_notes)
	_menu = Hud.panel(10)
	_menu.visible = false
	_menu.position = Vector2(14, 54)
	var items := VBoxContainer.new()
	items.add_theme_constant_override("separation", 6)
	_menu.add_child(items)
	for m: Array in MENU:
		var b := Hud.button(String(m[1]))
		b.name = "Menu_" + String(m[0])
		b.custom_minimum_size = Vector2(170, 36)
		if Nav.exists(String(m[0])):
			b.pressed.connect(func() -> void: Nav.go(String(m[0])))
		else:
			b.disabled = true
			b.tooltip_text = "Coming soon"
		items.add_child(b)
	var report := Hud.button("Report a bug")
	report.name = "Menu_report"
	report.custom_minimum_size = Vector2(170, 36)
	report.pressed.connect(func() -> void:
		_menu.visible = false
		report_bug.emit())
	items.add_child(report)
	add_child(_menu)
	var right := HBoxContainer.new()
	right.anchor_left = 1.0
	right.anchor_right = 1.0
	right.offset_left = -292.0
	right.offset_right = -14.0
	right.offset_top = 12.0
	right.offset_bottom = 50.0
	right.alignment = BoxContainer.ALIGNMENT_END
	right.add_theme_constant_override("separation", 8)
	add_child(right)
	_undo = Hud.button("Undo")
	_undo.name = "Undo"
	_undo.tooltip_text = "Take back your last action (Z)"
	_undo.pressed.connect(func() -> void: undo_pressed.emit())
	right.add_child(_undo)
	_concede = Hud.button("Concede")
	_concede.name = "Concede"
	_concede.set_meta(&"slab", "danger")
	_concede.pressed.connect(func() -> void: _ask_concede())
	right.add_child(_concede)
	_leave = Hud.button("Leave")
	_leave.name = "Leave"
	_leave.pressed.connect(func() -> void: _ask_leave())
	right.add_child(_leave)


## Every new view: the turn line, which buttons show.
func show_view(view: Dictionary, can_undo: bool, hot_seat: bool, over: bool) -> void:
	_view = view
	_over = over
	var turn := View.turn(view)
	var n := int(Val.num(turn, "number"))
	_turn.text = "Start of the game" if n == 0 else "Turn %d: %s, %s" % [n, View.player_name(view, Val.text(turn, "activePlayer")),
		String(LONG_STEPS.get(View.step(view), View.step(view)))]
	_undo.visible = hot_seat
	_undo.disabled = not can_undo
	_show_notes(view)
	_layout.visible = View.player_ids(view).size() > 2
	for i: int in _layout.item_count:
		if String(_layout.get_item_metadata(i)) == Settings.table_layout:
			_layout.select(i)
	_concede.visible = not over and not _concedable().is_empty() and not GameClient.is_replay
	_undo.visible = _undo.visible and not GameClient.is_replay


func _concedable() -> Array[String]:
	var out: Array[String] = []
	for pid: Variant in GameClient.table_seats:
		var p := View.player(_view, String(pid))
		if not p.is_empty() and not Val.flag(p, "hasLost"):
			out.append(String(pid))
	if out.is_empty() and View.viewer(_view) != "":
		out.append(View.viewer(_view))
	return out


func _toggle_menu() -> void:
	_close_confirm()
	_menu.visible = not _menu.visible
	if _menu.visible:
		Sound.cue("ui.open")


func _goes_on() -> bool:
	var multiplayer := not Val.dict(Val.dict(_view, "options"), "multiplayer").is_empty()
	var still := 0
	for p: Variant in Val.list(_view, "players"):
		if not Val.flag(Val.as_dict(p), "hasLost"):
			still += 1
	return multiplayer and still > 2


## The view's reminders and this turn's reveal lines (game/RevealNotice.tsx: log lines citing CR 708.9, 701.40g or 701.58g;
## at the end of the game, every face-down permanent and spell by its real name).
func _show_notes(view: Dictionary) -> void:
	var lines: Array = []
	for r: Variant in Val.list(view, "reminders"):
		var rd := Val.as_dict(r)
		lines.append(["%s (%s): %s" % [Val.text(rd, "sourceName"), View.player_name(view, Val.text(rd, "controller")), Val.text(rd, "text")],
			"Not enforced by the engine: apply it by hand (manual text)"])
	var n := int(Val.num(View.turn(view), "number"))
	var reveals: Array = []
	for e: Dictionary in View.log_entries(view):
		if int(Val.num(e, "turn")) != n:
			continue
		for rule: Variant in Val.list(e, "rules"):
			if String(rule) in ["CR 708.9", "CR 701.40g", "CR 701.58g"]:
				reveals.append(View.log_text(e, View.viewer(view)))
				break
	reveals = reveals.slice(maxi(0, reveals.size() - 3))
	reveals.reverse()
	for t: Variant in reveals:
		lines.append(["Revealed: %s" % t, "CR 708.9"])
	var key := JSON.stringify(lines)
	if key == _notes_key:
		return
	_notes_key = key
	for c: Node in _notes_box.get_children():
		c.queue_free()
	for l: Array in lines:
		var label := Hud.text(String(l[0]), 13, Hud.TEXT)
		label.tooltip_text = String(l[1])
		label.mouse_filter = Control.MOUSE_FILTER_PASS
		_notes_box.add_child(label)
	_notes_button.visible = not lines.is_empty()
	_notes_button.text = "Reminders (%d)" % lines.size()
	if lines.is_empty():
		_notes.visible = false


## Concede asked from outside the bar (the hot-seat pass cover): the question shows on `host`.
func ask_concede(host: Control = null) -> void:
	_ask_concede(host)


func ask_leave(host: Control = null) -> void:
	_ask_leave(host)


func _ask_concede(host: Control = null) -> void:
	var text := "Who concedes? That player loses and leaves the game at once; the game goes on for the others (CR 104.3a, 800.4a)." \
		if _goes_on() else "Who concedes? That player loses the game at once (CR 104.3a)."
	var buttons: Array = []
	for pid: String in _concedable():
		buttons.append(["%s concedes" % View.player_name(_view, pid), func() -> void: concede.emit(pid), "danger"])
	_open_confirm(text, buttons, host)


func _ask_leave(host: Control = null) -> void:
	# A finished game, or a replay: nothing is lost by leaving.
	if _over or GameClient.is_replay:
		leave.emit()
		return
	_open_confirm("Leave this game? It is not saved and cannot be resumed.", [["Leave the game", func() -> void: leave.emit(), "plain"]], host)


## A small dialog under the bar: the question, its buttons, and "Keep playing".
func _open_confirm(text: String, buttons: Array, host: Control = null) -> void:
	_menu.visible = false
	_close_confirm()
	_confirm = Hud.panel(14)
	_confirm.set_anchors_and_offsets_preset(Control.PRESET_TOP_RIGHT)
	_confirm.position = Vector2(-440, 62)
	_confirm.custom_minimum_size = Vector2(420, 0)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 10)
	_confirm.add_child(box)
	box.add_child(Hud.text(text, 14, Hud.TEXT))
	for b: Array in buttons:
		var button := Hud.button(String(b[0]))
		button.set_meta(&"slab", String(b[2]))
		var act: Callable = b[1]
		button.pressed.connect(func() -> void:
			_close_confirm()
			act.call())
		box.add_child(button)
	var keep := Button.new()
	keep.text = "Keep playing"
	keep.flat = true
	keep.add_theme_color_override("font_color", NeonTheme.colors()[0])
	keep.pressed.connect(func() -> void:
		Sound.cue("ui.close")
		_close_confirm())
	box.add_child(keep)
	(host if host != null else self).add_child(_confirm)


func _close_confirm() -> void:
	if _confirm != null and is_instance_valid(_confirm):
		_confirm.queue_free()
	_confirm = null


## Whether the menu or a question is open (Esc closes it first).
func has_open() -> bool:
	return _menu.visible or _confirm != null


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("ui_cancel") and (_menu.visible or _confirm != null):
		_menu.visible = false
		_close_confirm()
		get_viewport().set_input_as_handled()
