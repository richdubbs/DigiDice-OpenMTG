class_name BugReport
extends VBoxContainer
## "Report a bug" (the browser's bugs/BugReportDialog.tsx), in a Modal over the table: the moment the report is about (taken when it
## opens; a replay being watched pauses there), what happened and which card, what the report holds, and Save report. The server
## makes the report (table channel `bugCapture`, `bugReport`) and this saves it as a file in the Downloads folder. Nothing is sent
## anywhere. While it is open the table's keys are off.

const WORDS_MAX: int = 20000
const CARD_MAX: int = 200

## Where reports are saved ("" for the Downloads folder; the developer checks save elsewhere).
static var save_dir: String = ""

var _modal: Modal = null
var _capture_id: int = -1
var _report_id: int = -1
var _capture: Dictionary = {}
var _view: Dictionary = {}
var _env: Dictionary = {}
var _names: Array[String] = []
var _moment: Label = null
var _words: TextEdit = null
var _card: LineEdit = null
var _hints: ItemList = null
var _holds: Label = null
var _note: Label = null
var _show: Button = null
var _save: Button = null
var _cancel: Button = null
var _saved_path: String = ""


## Open the report over `host` (the table's dialog layer).
static func open(host: Control) -> Modal:
	var m := Modal.open(host, "Report a bug", true)
	var r := BugReport.new()
	r._modal = m
	m.body.add_child(r)
	if GameClient.is_replay:
		GameClient.replay_control("pause")
	return m


func _ready() -> void:
	add_theme_constant_override("separation", 10)
	_view = GameClient.view
	_env = environment()
	_names = card_names(_view)
	var intro := Hud.text("Nothing is sent anywhere: the report is saved as a file on this computer. Send it yourself to whoever looks after OpenMTG for you.", 14)
	add_child(intro)
	_moment = Hud.text("Taking the moment…", 14, Hud.TEXT)
	add_child(_moment)
	add_child(_field_label("What happened, and what did you expect?"))
	_words = TextEdit.new()
	_words.custom_minimum_size = Vector2(0, 120)
	_words.wrap_mode = TextEdit.LINE_WRAPPING_BOUNDARY
	_words.text_changed.connect(_on_words)
	add_child(_words)
	add_child(_field_label("Which card? (optional)"))
	_card = LineEdit.new()
	_card.max_length = CARD_MAX
	_card.placeholder_text = "A card's name"
	_card.text_changed.connect(_on_card)
	add_child(_card)
	_hints = ItemList.new()
	_hints.visible = false
	_hints.custom_minimum_size = Vector2(0, 110)
	_hints.item_activated.connect(_on_hint)
	_hints.item_clicked.connect(func(i: int, _at: Vector2, _button: int) -> void: _on_hint(i))
	add_child(_hints)
	var head := Hud.kicker("What the report holds")
	add_child(head)
	_holds = Hud.text("", 13)
	add_child(_holds)
	_note = Hud.text("", 14, Hud.TEXT)
	_note.visible = false
	add_child(_note)
	var row := HBoxContainer.new()
	row.alignment = BoxContainer.ALIGNMENT_END
	row.add_theme_constant_override("separation", 8)
	_show = Hud.button("Show in folder")
	_show.visible = false
	_show.pressed.connect(func() -> void: OS.shell_show_in_file_manager(_saved_path))
	row.add_child(_show)
	_save = Hud.button("Save report")
	_save.set_meta(&"slab", "primary")
	_save.disabled = true
	_save.tooltip_text = "Write what happened first"
	_save.pressed.connect(_on_save)
	row.add_child(_save)
	_cancel = Hud.button("Cancel")
	_cancel.pressed.connect(func() -> void: _modal.dismiss())
	row.add_child(_cancel)
	add_child(row)
	GameClient.bug_captured.connect(_on_captured)
	GameClient.bug_report_file.connect(_on_report_file)
	_capture_id = GameClient.bug_capture()
	_refresh_holds()
	_words.grab_focus.call_deferred()


func _field_label(text: String) -> Label:
	var l := Hud.text(text, 13, Hud.TEXT)
	l.add_theme_font_override("font", Hud.bold_font())
	return l


func _on_words() -> void:
	if _words.text.length() > WORDS_MAX:
		_words.text = _words.text.left(WORDS_MAX)
	var described := _words.text.strip_edges() != ""
	_save.disabled = not described or _capture.is_empty() or _report_id >= 0
	_save.tooltip_text = "" if described else "Write what happened first"


## The card names the view shows (its definitions), for "Which card?".
static func card_names(view: Dictionary) -> Array[String]:
	var seen := {}
	for d: Variant in Val.dict(view, "defs").values():
		var dd := Val.as_dict(d)
		var n := Val.text(dd, "name").strip_edges()
		if n != "" and not Val.text(dd, "id").begins_with("__"):
			seen[n] = true
	var out: Array[String] = []
	for n: Variant in seen:
		out.append(String(n))
	out.sort()
	return out


func _on_card(text: String) -> void:
	_hints.clear()
	var t := text.strip_edges().to_lower()
	if t != "":
		for n: String in _names:
			if n.to_lower().contains(t) and n.to_lower() != t:
				_hints.add_item(n)
				if _hints.item_count >= 8:
					break
	_hints.visible = _hints.item_count > 0


func _on_hint(i: int) -> void:
	_card.text = _hints.get_item_text(i)
	_card.caret_column = _card.text.length()
	_hints.visible = false


func _on_captured(id: int, info: Dictionary) -> void:
	if id != _capture_id:
		return
	if Val.text(info, "error") != "":
		_moment.text = Val.text(info, "error")
		return
	_capture = info
	_moment.text = "The moment reported: %s." % moment_text(info, _view)
	_refresh_holds()
	_on_words()


## "turn 4, after action 14", "turn 7, action 83 of 214", "the start of the game, before any action".
static func moment_text(c: Dictionary, view: Dictionary) -> String:
	var n := int(Val.num(View.turn(view), "number"))
	var turn := "the start of the game" if n <= 0 else "turn %d" % n
	var holds := Val.text(c, "holds")
	var at := int(Val.num(c, "at"))
	var length := int(Val.num(c, "length"))
	if holds == "view" or length == 0:
		return "the start of the game, before any action" if holds == "game" else turn
	if holds == "game":
		return "%s, after action %d" % [turn, at + 1]
	return "%s, %s %d of %d" % [turn, "action" if Val.text(c, "kind") == "game" else "frame", at + 1, length]


func _refresh_holds() -> void:
	var lines: Array[String] = []
	var length := int(Val.num(_capture, "length"))
	match Val.text(_capture, "holds"):
		"game":
			lines.append("The game so far, so it can be played again exactly to this moment: its decks, its shuffles and its %s. It holds every player's cards, hidden ones too." % ("1 action" if length == 1 else "%d actions" % length))
		"replay":
			lines.append("This replay as you have it, and the moment you are watching.")
		"recording":
			lines.append("What this screen was shown of the game so far, change by change, with its log. Nothing that was hidden from this screen.")
		"view":
			lines.append("What this screen shows of the game now: the view, its log and the last change. Nothing that is hidden from this screen.")
	lines.append("What you write here.")
	lines.append("This OpenMTG's version, your computer's system and window size, and your display settings.")
	var errors: Array = Val.list(_env, "errors")
	if errors.is_empty():
		lines.append("No errors were caught in this app.")
	else:
		lines.append(("1 error this app caught: " if errors.size() == 1 else "%d errors this app caught, the last: " % errors.size()) + Val.text(Val.as_dict(errors.back()), "message"))
	var text := ""
	for l: String in lines:
		text += "• %s\n" % l
	_holds.text = text.strip_edges()


func _on_save() -> void:
	if _words.text.strip_edges() == "" or _capture.is_empty():
		return
	_note.visible = false
	_save.disabled = true
	_report_id = GameClient.bug_report(_words.text, _card.text.strip_edges(), _env)


func _on_report_file(id: int, info: Dictionary) -> void:
	if id != _report_id:
		return
	_report_id = -1
	_on_words()
	if Val.text(info, "error") != "":
		_fail(Val.text(info, "error"))
		return
	var dir := save_dir if save_dir != "" else OS.get_system_dir(OS.SYSTEM_DIR_DOWNLOADS)
	if dir == "":
		dir = OS.get_system_dir(OS.SYSTEM_DIR_DOCUMENTS)
	var name := Val.text(info, "name").get_file()
	var path := dir.path_join(name)
	var f := FileAccess.open(path, FileAccess.WRITE)
	if f == null:
		_fail("The report could not be saved: %s" % error_string(FileAccess.get_open_error()))
		return
	f.store_buffer(Marshalls.base64_to_raw(Val.text(info, "data")))
	f.close()
	_saved_path = path
	_note.text = "Saved as %s in %s. Nothing was sent." % [name, "your Downloads folder" if dir == OS.get_system_dir(OS.SYSTEM_DIR_DOWNLOADS) else dir]
	_note.remove_theme_color_override("font_color")
	_note.visible = true
	_show.visible = true
	_save.text = "Save again"
	_cancel.text = "Close"
	Sound.cue("ui.success")


func _fail(text: String) -> void:
	_note.text = text
	_note.add_theme_color_override("font_color", NeonTheme.colors()[1])
	_note.visible = true
	Sound.cue("ui.error")


## The app the report is made on: this OpenMTG's version, the system and the window, and the settings that change what the
## screen shows (nothing personal: no player names, no volumes).
static func environment() -> Dictionary:
	var win := DisplayServer.window_get_size()
	var scr := DisplayServer.screen_get_size()
	var scale := DisplayServer.screen_get_scale()
	var version := GameClient.server_version if GameClient.server_version != "" else "0.0.0"
	return {
		"app": {"version": version, "commit": null},
		"browser": {
			"userAgent": ("OpenMTG %s; Godot %s; %s %s" % [version, Engine.get_version_info().get("string", ""), OS.get_name(), OS.get_version()]).left(1000),
			"language": OS.get_locale().left(64),
			"screen": ("window %dx%d, screen %dx%d, %sx" % [win.x, win.y, scr.x, scr.y, str(snappedf(scale, 0.01))]).left(64),
		},
		"settings": {
			"animationSpeed": Settings.animation_speed,
			"reducedMotion": Settings.reduced_motion,
			"tableLayout": Settings.table_layout,
			"cameraFollow": Settings.camera_follow,
			"showScryfallImages": Settings.scryfall_images,
			"sound": Settings.sound_on,
			"fullControl": Settings.full_control,
			"ownTurnStops": " ".join(Settings.stops_own),
			"opponentTurnStops": " ".join(Settings.stops_opponent),
			"lookMotion": Settings.look_motion,
			"lookScene": Settings.look_scene,
		},
		"errors": Errors.recent(),
	}
