class_name ReplayPanel
extends Control
## A watched replay's panel, in the prompt's place at the bottom right of the table (the browser's replays/viewer/ReplayPrompt.tsx
## with its ReplayBar): what is being decided, read-only, as the view shown sees it (another player's decision stays "Waiting for
## Bob", CR 400.2); what the last change did, from its log lines; whose view it shows (the seats, Public and All cards the replay's
## reveal policy allows; none for a recording); the replay's status and its notice; muting the sound above 4x; then the transport
## (ReplayBar). Its cover (ReplayCover) hides the table while another build's replay is checked, or when it cannot be watched here.
##
## Keys, while it is on screen: Space plays or pauses, Left and Right step, Shift+Left and Shift+Right go to the turn before and
## after, [ and ] change the speed, Home and End go to the start and the end, Esc leaves (unless something on the table is open to
## close first). None of them with Ctrl, Alt or Meta held, nor while a text field has the keys.

## Esc: leave the replay.
signal leave_requested()

## The table: whether something on it takes Esc first (a menu, a dialog, a card's zoom).
var table: Node = null

var _frame: PanelContainer = null
var _status: Label = null
var _status_box: PanelContainer = null
var _notice: Label = null
var _text: Label = null
var _caption_box: PanelContainer = null
var _caption: Label = null
var _view_row: HBoxContainer = null
var _views: OptionButton = null
var _view_keys: Array[String] = []
var _refused: Label = null
var _mute: CheckBox = null
var _report: Button = null
var _bar: ReplayBar = null
var _cover: ReplayCover = null


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_frame = PanelContainer.new()
	_frame.theme_type_variation = &"PromptPanel"
	_frame.anchor_left = 1.0
	_frame.anchor_top = 1.0
	_frame.anchor_right = 1.0
	_frame.anchor_bottom = 1.0
	_frame.offset_left = -436.0
	_frame.offset_right = -16.0
	_frame.offset_top = -158.0
	_frame.offset_bottom = -158.0
	_frame.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	_frame.grow_vertical = Control.GROW_DIRECTION_BEGIN
	add_child(_frame)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 8)
	_frame.add_child(box)
	# The status: a pill ("Exact", "Checked on this version", "Recording from turn 9" ...) and the notice under it.
	var status_row := HBoxContainer.new()
	_status_box = PanelContainer.new()
	_status = Label.new()
	_status.add_theme_font_override("font", Hud.bold_font())
	_status.add_theme_font_size_override("font_size", 11)
	_status_box.add_child(_status)
	status_row.add_child(_status_box)
	box.add_child(status_row)
	_notice = Hud.text("", 12)
	box.add_child(_notice)
	_text = Label.new()
	_text.add_theme_font_override("font", Hud.bold_font())
	_text.add_theme_font_size_override("font_size", 13)
	_text.add_theme_color_override("font_color", Hud.TEXT)
	_text.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	box.add_child(_text)
	_caption_box = PanelContainer.new()
	var cs := StyleBoxFlat.new()
	cs.bg_color = Color(0, 0, 0, 0)
	cs.border_width_left = 3
	cs.border_color = Color(NeonTheme.colors()[0], 0.7)
	cs.content_margin_left = 8
	cs.content_margin_right = 8
	cs.content_margin_top = 6
	cs.content_margin_bottom = 6
	_caption_box.add_theme_stylebox_override("panel", cs)
	_caption = Hud.text("", 12, Hud.TEXT)
	_caption_box.add_child(_caption)
	box.add_child(_caption_box)
	_view_row = HBoxContainer.new()
	_view_row.add_theme_constant_override("separation", 8)
	var view_label := Hud.text("Whose view", 12)
	view_label.autowrap_mode = TextServer.AUTOWRAP_OFF
	_view_row.add_child(view_label)
	_views = OptionButton.new()
	_views.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_views.focus_mode = Control.FOCUS_NONE
	_views.add_theme_font_size_override("font_size", 13)
	_views.item_selected.connect(_on_view_selected)
	_view_row.add_child(_views)
	box.add_child(_view_row)
	_refused = Hud.text("", 12, Hud.TEXT)
	var rs := StyleBoxFlat.new()
	rs.bg_color = Color(0, 0, 0, 0)
	rs.set_border_width_all(1)
	rs.border_color = NeonTheme.colors()[1]
	rs.set_corner_radius_all(8)
	rs.set_content_margin_all(8)
	_refused.add_theme_stylebox_override("normal", rs)
	_refused.visible = false
	box.add_child(_refused)
	# A game replay of this very build that plays differently here is an engine bug: it offers its own report.
	_report = Button.new()
	_report.text = "Report this bug"
	_report.flat = true
	_report.visible = false
	_report.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	_report.add_theme_color_override("font_color", NeonTheme.colors()[0])
	_report.pressed.connect(func() -> void:
		if table != null and table.has_method("open_bug_report"):
			table.call("open_bug_report"))
	box.add_child(_report)
	_mute = CheckBox.new()
	_mute.text = "Mute sound above 4×"
	_mute.focus_mode = Control.FOCUS_NONE
	_mute.add_theme_font_size_override("font_size", 12)
	_mute.toggled.connect(func(on: bool) -> void: GameClient.replay_control("muteFast", on))
	box.add_child(_mute)
	_bar = ReplayBar.new()
	box.add_child(_bar)
	_cover = ReplayCover.new()
	_cover.leave_pressed.connect(func() -> void: leave_requested.emit())
	GameClient.replay_state_changed.connect(_refresh)
	GameClient.replay_refused.connect(_on_refused)
	GameClient.view_changed.connect(_on_view_changed)
	_refresh()


## The cover goes on the table's UI layer under the game bar (the caller places it), so the bar's Leave stays in reach.
func cover() -> ReplayCover:
	return _cover


func _on_view_changed(_at_seq: int) -> void:
	_text.text = read_only_prompt(GameClient.view)
	_text.visible = _text.text != ""


## The decision on screen, read-only: the deciding player's own prompt when the view shown sees it, else who is deciding.
static func read_only_prompt(view: Dictionary) -> String:
	var r := View.result(view)
	if not r.is_empty():
		var winner := Val.text(r, "winner")
		var headline := "The game is a draw" if winner == "" else "%s wins" % View.player_name(view, winner)
		return "The game is over. %s: %s" % [headline, Val.text(r, "reason")]
	var d := View.pending(view)
	if d.is_empty():
		return ""
	var who := Val.text(d, "player")
	var sees := Val.flag(view, "open") or (View.viewer(view) != "" and who == View.viewer(view))
	if not sees:
		return "Waiting for %s." % View.player_name(view, who)
	# A prompt that already names its player (priority's "Bob: Precombat main phase. …") is not named twice.
	var pname := View.player_name(view, who)
	var prompt := Val.text(d, "prompt")
	return prompt if prompt.begins_with(pname + ":") else "%s: %s" % [pname, prompt]


func _refresh() -> void:
	var s := GameClient.replay_state
	if s.is_empty():
		_status.text = "Opening"
		_notice.visible = false
		_caption_box.visible = false
		_view_row.visible = false
		return
	var badge := Val.text(s, "badge")
	_status.text = Val.text(s, "statusText")
	var pill := StyleBoxFlat.new()
	pill.set_corner_radius_all(999)
	pill.content_margin_left = 8
	pill.content_margin_right = 8
	pill.content_margin_top = 2
	pill.content_margin_bottom = 2
	match badge:
		"recordingFrom", "watchingUpTo":
			pill.bg_color = Color(1.0, 0.77, 0.0, 0.22)
			_status.add_theme_color_override("font_color", Color("#ffe9a8"))
		"unplayable":
			pill.bg_color = Color(1.0, 0.35, 0.35, 0.25)
			_status.add_theme_color_override("font_color", Color("#ffd6d6"))
		_:
			pill.bg_color = Color(NeonTheme.colors()[0], 0.2)
			_status.add_theme_color_override("font_color", Color("#dff4ff"))
	_status_box.add_theme_stylebox_override("panel", pill)
	var notice := Val.text(s, "notice")
	_notice.text = notice
	_notice.visible = notice != ""
	var caption := Val.text(s, "caption")
	_caption.text = caption
	_caption_box.visible = caption != ""
	_refresh_views(s)
	_mute.set_pressed_no_signal(Val.flag(s, "muteFast"))
	_report.visible = Val.flag(s, "offersReport")
	_text.text = read_only_prompt(GameClient.view)
	_text.visible = _text.text != ""
	_cover.show_state(s)


## The views the policy allows; the one shown first when it is not among them (the recording's own, past where the game can be run).
func _refresh_views(s: Dictionary) -> void:
	var options := Val.list(s, "perspectives")
	_view_row.visible = not options.is_empty()
	if options.is_empty():
		return
	var current := Val.dict(s, "perspective")
	var current_key := Val.text(current, "key")
	_views.clear()
	_view_keys.clear()
	var listed := false
	for o: Variant in options:
		listed = listed or Val.text(Val.as_dict(o), "key") == current_key
	if not listed:
		_views.add_item(Val.text(current, "label"))
		_view_keys.append(current_key)
	for o: Variant in options:
		var od := Val.as_dict(o)
		_views.add_item(Val.text(od, "label"))
		_view_keys.append(Val.text(od, "key"))
	_views.select(_view_keys.find(current_key))
	var fixed := Val.flag(s, "perspectiveFixed")
	_views.disabled = fixed or not Val.flag(s, "playable")
	_views.tooltip_text = "The recording shows only its own view." if fixed else "Whose cards the replay shows"


func _on_view_selected(i: int) -> void:
	if i < 0 or i >= _view_keys.size():
		return
	_refused.visible = false
	GameClient.replay_control("perspective", _view_keys[i])


func _on_refused(message: String) -> void:
	_refused.text = message
	_refused.visible = true
	_refresh_views(GameClient.replay_state)


# ---- keys ------------------------------------------------------------------------------------------------------------------------

func _input(event: InputEvent) -> void:
	var k := event as InputEventKey
	if k == null or not k.pressed or k.ctrl_pressed or k.alt_pressed or k.meta_pressed or not is_visible_in_tree():
		return
	var focus := get_viewport().gui_get_focus_owner()
	if focus is LineEdit or focus is TextEdit:
		return
	# A dialog over the table (Report a bug) has the keys.
	if table != null and table.has_method("has_open_overlay") and bool(table.call("has_open_overlay")):
		return
	var s := GameClient.replay_state
	var handled := true
	match k.keycode:
		KEY_SPACE:
			if not k.echo:
				GameClient.replay_control("toggle")
		KEY_LEFT:
			GameClient.replay_control("previousTurn" if k.shift_pressed else "step", null if k.shift_pressed else -1)
		KEY_RIGHT:
			GameClient.replay_control("nextTurn" if k.shift_pressed else "step", null if k.shift_pressed else 1)
		KEY_BRACKETLEFT:
			GameClient.replay_control("changeSpeed", -1)
		KEY_BRACKETRIGHT:
			GameClient.replay_control("changeSpeed", 1)
		KEY_HOME:
			GameClient.replay_control("seek", 0)
		KEY_END:
			GameClient.replay_control("seek", int(Val.num(s, "last")))
		_:
			handled = false
	if handled:
		get_viewport().set_input_as_handled()


func _unhandled_key_input(event: InputEvent) -> void:
	if not event.is_action_pressed("ui_cancel"):
		return
	if table != null and table.has_method("has_open_overlay") and bool(table.call("has_open_overlay")):
		return
	get_viewport().set_input_as_handled()
	leave_requested.emit()
