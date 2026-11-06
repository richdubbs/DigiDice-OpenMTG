extends Control
## Replays (packages/client/src/replays/ReplaysScreen.tsx): every game played here is kept as a replay by the game server
## (finished, conceded or left unfinished; GET /api/library/replays). Filters by format, opponent and result, newest or oldest
## first, how many to keep automatically; each replay with its facts and Watch, Rename, Keep, Export and Delete; Import of
## .openmtg-replay files, picked or dropped on the window.

const MODES: Dictionary = {"hotseat": "Hot-seat", "computer": "Against the computer", "onlineHost": "Online (host)",
	"onlineGuest": "Online (guest)", "hosted": "Hosted"}
const RESULTS: Array = [["any", "Any result"], ["won", "I won"], ["lost", "I lost"], ["draw", "Draw"], ["abandoned", "Abandoned"]]
const RETENTION: Array = [[10, "The newest 10"], [50, "The newest 50"], [200, "The newest 200"]]
const TITLE_MAX: int = 200
## The status badge (the server's status of the file on its engine: whether it plays exactly, is checked when watched, shows its
## recording only, or needs a newer OpenMTG).
const STATUS_LABELS: Dictionary = {"exact": "Exact", "checked": "Checked when watched", "recordingOnly": "Recording only",
	"needsNewer": "Needs a newer OpenMTG"}

var _replays: Array = []
var _retention: int = 50
var _list: VBoxContainer = null
var _count: Label = null
var _error: Label = null
var _message: Label = null
var _format: OptionButton = null
var _opponent: OptionButton = null
var _result: OptionButton = null
var _sort: OptionButton = null
var _keep_auto: OptionButton = null
var _import: Button = null
## The row whose Rename or Delete form is open (only one at a time).
var _open_form: Control = null


func _ready() -> void:
	TopBar.attach(self)
	Footer.attach(self)
	var scroll := ScrollContainer.new()
	scroll.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	scroll.offset_top = TopBar.HEIGHT
	scroll.offset_bottom = -56
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	add_child(scroll)
	var margin := MarginContainer.new()
	margin.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	margin.add_theme_constant_override("margin_left", 180)
	margin.add_theme_constant_override("margin_right", 180)
	margin.add_theme_constant_override("margin_top", 18)
	margin.add_theme_constant_override("margin_bottom", 24)
	scroll.add_child(margin)
	var page := VBoxContainer.new()
	page.add_theme_constant_override("separation", 14)
	margin.add_child(page)
	var head := HBoxContainer.new()
	head.add_theme_constant_override("separation", 14)
	var back := Hud.button("Back")
	back.custom_minimum_size = Vector2(80, 36)
	back.pressed.connect(Nav.back)
	head.add_child(back)
	head.add_child(Hud.title("Replays", 28))
	_count = Hud.text("", 14)
	_count.autowrap_mode = TextServer.AUTOWRAP_OFF
	_count.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_count.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(_count)
	_import = Hud.button("Import")
	_import.pressed.connect(_pick_imports)
	head.add_child(_import)
	page.add_child(head)
	_error = Hud.text("", 14, Color("#ff9bff"))
	_error.visible = false
	page.add_child(_error)
	_message = Hud.text("", 14, Hud.TEXT)
	_message.visible = false
	page.add_child(_message)
	page.add_child(_tools())
	page.add_child(Hud.text("Drop .openmtg-replay files anywhere here to import them.", 12))
	_list = VBoxContainer.new()
	_list.add_theme_constant_override("separation", 10)
	page.add_child(_list)
	_list.add_child(Hud.text("Loading replays…", 14))
	get_window().files_dropped.connect(_on_files_dropped)
	if not Server.is_ready:
		await Server.server_ready
	_load()


func _exit_tree() -> void:
	if get_window().files_dropped.is_connected(_on_files_dropped):
		get_window().files_dropped.disconnect(_on_files_dropped)


func _say(text: String) -> void:
	_message.text = text
	_message.visible = text != ""
	if text != "":
		_error.visible = false


func _fail(text: String) -> void:
	_error.text = text
	_error.visible = text != ""
	if text != "":
		_message.visible = false
		Sound.cue("ui.error")


func _tools() -> Control:
	var panel := Hud.panel(12)
	var row := HFlowContainer.new()
	row.add_theme_constant_override("h_separation", 12)
	row.add_theme_constant_override("v_separation", 8)
	panel.add_child(row)
	var labelled := func(caption: String, control: Control) -> void:
		var box := HBoxContainer.new()
		box.add_theme_constant_override("separation", 6)
		var l := Label.new()
		l.text = caption
		box.add_child(l)
		box.add_child(control)
		row.add_child(box)
	_format = OptionButton.new()
	_opponent = OptionButton.new()
	_result = OptionButton.new()
	for r: Array in RESULTS:
		_result.add_item(String(r[1]))
		_result.set_item_metadata(_result.item_count - 1, String(r[0]))
	_sort = OptionButton.new()
	_sort.add_item("Newest first")
	_sort.add_item("Oldest first")
	_keep_auto = OptionButton.new()
	for r: Array in RETENTION:
		_keep_auto.add_item(String(r[1]))
		_keep_auto.set_item_metadata(_keep_auto.item_count - 1, int(r[0]))
	_keep_auto.tooltip_text = "Replays marked Keep are never removed; of the others, older ones beyond this many are removed when a new replay is saved."
	_keep_auto.item_selected.connect(func(i: int) -> void:
		Server.post_json("/api/library/replays/retention", {"limit": int(_keep_auto.get_item_metadata(i))}))
	for o: OptionButton in [_format, _opponent, _result, _sort]:
		o.item_selected.connect(func(_i: int) -> void: _show())
	labelled.call("Format", _format)
	labelled.call("Opponent", _opponent)
	labelled.call("Result", _result)
	labelled.call("Sort", _sort)
	labelled.call("Keep automatically", _keep_auto)
	return panel


func _load() -> void:
	var r: Dictionary = await Server.get_json("/api/library/replays")
	if not is_inside_tree():
		return
	if not bool(r["ok"]):
		_fail("Could not open the replays: %s" % r["error"])
		_replays = []
	else:
		var data := Val.as_dict(r["data"])
		_replays = Val.list(data, "replays")
		_retention = int(Val.num(data, "retention", 50))
	_count.text = "1 replay" if _replays.size() == 1 else "%d replays" % _replays.size()
	for i: int in _keep_auto.item_count:
		if int(_keep_auto.get_item_metadata(i)) == _retention:
			_keep_auto.select(i)
	_fill_filters()
	_show()


func _fill_filters() -> void:
	var formats := {}
	var opponents := {}
	for rp: Variant in _replays:
		var g := Val.dict(Val.as_dict(rp), "game")
		formats[Val.text(g, "format")] = true
		for p: Variant in Val.list(g, "players"):
			var pd := Val.as_dict(p)
			if Val.text(pd, "id") != Val.text(g, "savedBy"):
				opponents[Val.text(pd, "name")] = true
	var keep_format := String(_format.get_item_metadata(_format.selected)) if _format.item_count > 0 else ""
	var keep_opp := String(_opponent.get_item_metadata(_opponent.selected)) if _opponent.item_count > 0 else ""
	_format.clear()
	_format.add_item("Every format")
	_format.set_item_metadata(0, "")
	var fl: Array = formats.keys()
	fl.sort()
	for f: Variant in fl:
		_format.add_item(DeckModel.format_name(String(f)) if String(f) != "" else "Casual")
		_format.set_item_metadata(_format.item_count - 1, String(f))
		if String(f) == keep_format:
			_format.select(_format.item_count - 1)
	_opponent.clear()
	_opponent.add_item("Anyone")
	_opponent.set_item_metadata(0, "")
	var ol: Array = opponents.keys()
	ol.sort()
	for o: Variant in ol:
		_opponent.add_item(String(o))
		_opponent.set_item_metadata(_opponent.item_count - 1, String(o))
		if String(o) == keep_opp:
			_opponent.select(_opponent.item_count - 1)


func _matches(rp: Dictionary) -> bool:
	var g := Val.dict(rp, "game")
	var f := String(_format.get_item_metadata(_format.selected))
	if f != "" and Val.text(g, "format") != f:
		return false
	var opp := String(_opponent.get_item_metadata(_opponent.selected))
	if opp != "":
		var found := false
		for p: Variant in Val.list(g, "players"):
			var pd := Val.as_dict(p)
			if Val.text(pd, "name") == opp and Val.text(pd, "id") != Val.text(g, "savedBy"):
				found = true
		if not found:
			return false
	var result := Val.dict(g, "result")
	var saved_by := Val.text(g, "savedBy")
	match String(_result.get_item_metadata(_result.selected)):
		"won":
			return saved_by != "" and not result.is_empty() and Val.text(result, "winner") == saved_by
		"lost":
			return saved_by != "" and not result.is_empty() and result.get("winner") != null and Val.text(result, "winner") != saved_by
		"draw":
			return not result.is_empty() and result.get("winner") == null
		"abandoned":
			return Val.text(g, "ended") == "abandoned"
	return true


func _show() -> void:
	_open_form = null
	for c: Node in _list.get_children():
		c.queue_free()
	if _replays.is_empty():
		_list.add_child(Hud.text("No replays yet. Every game you play here is kept as a replay: finished, conceded or left unfinished.", 14))
		return
	var shown: Array = []
	for rp: Variant in _replays:
		if _matches(Val.as_dict(rp)):
			shown.append(rp)
	var newest := _sort.selected == 0
	shown.sort_custom(func(a: Variant, b: Variant) -> bool:
		var da := Val.as_dict(a)
		var db := Val.as_dict(b)
		var ka := Val.text(da, "createdAt") + str(int(Val.num(da, "addedAt"))).pad_zeros(15)
		var kb := Val.text(db, "createdAt") + str(int(Val.num(db, "addedAt"))).pad_zeros(15)
		return ka > kb if newest else ka < kb)
	if shown.is_empty():
		_list.add_child(Hud.text("No replay matches these filters.", 14))
		return
	for rp: Variant in shown:
		_list.add_child(_row(Val.as_dict(rp)))


static func _title_of(rp: Dictionary) -> String:
	var t := Val.text(rp, "title")
	return t if t.strip_edges() != "" else "Untitled replay"


## "Ann won on turn 14 (a concession)", "Draw on turn 9", "Abandoned on turn 6".
static func _result_text(g: Dictionary) -> String:
	var turns := int(Val.num(g, "turns"))
	if Val.text(g, "ended") == "abandoned":
		return "Abandoned on turn %d" % turns
	var result := Val.dict(g, "result")
	if result.get("winner") == null:
		return "Draw on turn %d" % turns
	var name := Val.text(result, "winner")
	for p: Variant in Val.list(g, "players"):
		if Val.text(Val.as_dict(p), "id") == name:
			name = Val.text(Val.as_dict(p), "name")
	return "%s won on turn %d%s" % [name, turns, " (a concession)" if Val.text(g, "ended") == "conceded" else ""]


static func _length_text(g: Dictionary) -> String:
	var turns := int(Val.num(g, "turns"))
	var actions := int(Val.num(g, "actions"))
	var parts: Array[String] = ["1 turn" if turns == 1 else "%d turns" % turns, "1 action" if actions == 1 else "%d actions" % actions]
	var start := Time.get_unix_time_from_datetime_string(Val.text(g, "startedAt").substr(0, 19))
	var end := Time.get_unix_time_from_datetime_string(Val.text(g, "endedAt").substr(0, 19))
	if start > 0 and end >= start:
		var minutes := int((end - start) / 60)
		parts.append("under a minute" if minutes < 1 else ("%d min" % minutes if minutes < 60 else "%d h %d min" % [minutes / 60, minutes % 60]))
	return " · ".join(parts)


static func _local_time(iso: String) -> String:
	var unix := Time.get_unix_time_from_datetime_string(iso.substr(0, 19))
	if unix <= 0:
		return iso.substr(0, 16).replace("T", " ")
	var bias := int(Time.get_time_zone_from_system().get("bias", 0)) * 60
	return Time.get_datetime_string_from_unix_time(unix + bias, true).substr(0, 16)


func _row(rp: Dictionary) -> Control:
	var g := Val.dict(rp, "game")
	var panel := Hud.panel(14)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 6)
	panel.add_child(box)
	var top := HBoxContainer.new()
	top.add_theme_constant_override("separation", 8)
	var title := Label.new()
	title.text = _title_of(rp)
	title.add_theme_font_override("font", Hud.bold_font())
	title.add_theme_font_size_override("font_size", 17)
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	title.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	top.add_child(title)
	top.add_child(_badge("Recording" if Val.text(rp, "kind") == "recording" else "Game"))
	top.add_child(_badge(String(STATUS_LABELS.get(Val.text(rp, "status"), "Checked when watched"))))
	if Val.flag(rp, "keep"):
		top.add_child(_badge("Kept"))
	box.add_child(top)
	var players: Array[String] = []
	for p: Variant in Val.list(g, "players"):
		var pd := Val.as_dict(p)
		players.append(Val.text(pd, "name") + (" (computer)" if Val.text(pd, "kind") == "computer" else ""))
	var facts := GridContainer.new()
	facts.columns = 4
	facts.add_theme_constant_override("h_separation", 14)
	for f: Array in [["Date", _local_time(Val.text(rp, "createdAt"))], ["Players", " vs ".join(players)],
			["Format", DeckModel.format_name(Val.text(g, "format")) if Val.text(g, "format") not in ["", "casual"] else "Casual"],
			["Mode", String(MODES.get(Val.text(g, "mode"), Val.text(g, "mode")))], ["Result", _result_text(g)], ["Length", _length_text(g)]]:
		var k := Hud.text(String(f[0]), 12)
		k.autowrap_mode = TextServer.AUTOWRAP_OFF
		facts.add_child(k)
		var v := Hud.text(String(f[1]), 13, Hud.TEXT)
		v.autowrap_mode = TextServer.AUTOWRAP_OFF
		facts.add_child(v)
	box.add_child(facts)
	var actions := HFlowContainer.new()
	actions.add_theme_constant_override("h_separation", 8)
	var watch := Hud.primary("Watch", 15)
	watch.custom_minimum_size = Vector2(120, 38)
	watch.disabled = Val.text(rp, "status") == "needsNewer"
	watch.pressed.connect(func() -> void: _watch(rp))
	actions.add_child(watch)
	var rename := Hud.button("Rename")
	rename.pressed.connect(func() -> void: _open_rename(rp, box))
	actions.add_child(rename)
	var keep := Hud.button("Keep")
	keep.toggle_mode = true
	keep.button_pressed = Val.flag(rp, "keep")
	keep.toggled.connect(func(on: bool) -> void: _set_keep(rp, on))
	actions.add_child(keep)
	var export := Hud.button("Export")
	export.set_meta(&"sfx", "none")
	export.pressed.connect(func() -> void: _export(rp))
	actions.add_child(export)
	var delete := Hud.button("Delete")
	delete.set_meta(&"slab", "danger")
	delete.pressed.connect(func() -> void: _open_delete(rp, box))
	actions.add_child(delete)
	box.add_child(actions)
	return panel


func _badge(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", 11)
	var s := StyleBoxFlat.new()
	s.bg_color = Color(NeonTheme.colors()[0], 0.1)
	s.border_color = Color(NeonTheme.colors()[0], 0.5)
	s.set_border_width_all(1)
	s.set_corner_radius_all(999)
	s.content_margin_left = 8
	s.content_margin_right = 8
	l.add_theme_stylebox_override("normal", s)
	l.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	return l


func _close_form() -> void:
	if _open_form != null and is_instance_valid(_open_form):
		_open_form.queue_free()
	_open_form = null


func _open_rename(rp: Dictionary, box: VBoxContainer) -> void:
	_close_form()
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	var field := LineEdit.new()
	field.text = Val.text(rp, "title")
	field.max_length = TITLE_MAX
	field.placeholder_text = "New title"
	field.custom_minimum_size = Vector2(360, 0)
	row.add_child(field)
	var save := Hud.primary("Save title", 14)
	save.custom_minimum_size = Vector2(0, 36)
	row.add_child(save)
	var cancel := Hud.button("Cancel")
	cancel.pressed.connect(_close_form)
	row.add_child(cancel)
	box.add_child(row)
	_open_form = row
	field.text_changed.connect(func(t: String) -> void: save.disabled = t.strip_edges() == "")
	var submit := func() -> void:
		var t := field.text.strip_edges().substr(0, TITLE_MAX)
		if t == "":
			return
		var r: Dictionary = await Server.post_json("/api/library/replays/update", {"id": Val.text(rp, "id"), "title": t})
		if bool(r["ok"]):
			_say("Renamed to “%s”." % t)
			_load()
		else:
			_fail(String(r["error"]))
	save.pressed.connect(submit)
	field.text_submitted.connect(func(_t: String) -> void: submit.call())
	field.grab_focus.call_deferred()
	field.select_all.call_deferred()


func _set_keep(rp: Dictionary, on: bool) -> void:
	var r: Dictionary = await Server.post_json("/api/library/replays/update", {"id": Val.text(rp, "id"), "keep": on})
	if bool(r["ok"]):
		_say(("Keeping “%s”." if on else "“%s” is no longer kept.") % Val.text(rp, "title"))
		_load()
	else:
		_fail(String(r["error"]))


func _open_delete(rp: Dictionary, box: VBoxContainer) -> void:
	_close_form()
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	var q := Hud.text("Delete “%s”? This cannot be undone; export it first to keep a copy." % Val.text(rp, "title"), 14, Hud.TEXT)
	q.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(q)
	var yes := Hud.button("Delete replay")
	yes.set_meta(&"slab", "danger")
	yes.set_meta(&"sfx", "none")
	yes.pressed.connect(func() -> void:
		var r: Dictionary = await Server.post_json("/api/library/replays/delete", {"id": Val.text(rp, "id")})
		if bool(r["ok"]):
			Sound.cue("ui.delete")
			_say("Deleted “%s”." % Val.text(rp, "title"))
			_load()
		else:
			_fail(String(r["error"])))
	row.add_child(yes)
	var cancel := Hud.button("Cancel")
	cancel.set_meta(&"sfx", "ui.close")
	cancel.pressed.connect(_close_form)
	row.add_child(cancel)
	box.add_child(row)
	_open_form = row
	cancel.grab_focus.call_deferred()


## "<title>.openmtg-replay": control characters gone, \ / : * ? " < > | as spaces, at most 80 characters, "replay" when empty.
static func _file_name(title: String) -> String:
	var n := ""
	for ch: String in title.split(""):
		if ch.unicode_at(0) < 32 or ch.unicode_at(0) == 127:
			continue
		n += " " if ch in ["\\", "/", ":", "*", "?", "\"", "<", ">", "|"] else ch
	var parts: PackedStringArray = []
	for w: String in n.split(" ", false):
		parts.append(w)
	var base := " ".join(parts).strip_edges().substr(0, 80)
	return (base if base != "" else "replay") + ".openmtg-replay"


func _export(rp: Dictionary) -> void:
	var dialog := FileDialog.new()
	dialog.file_mode = FileDialog.FILE_MODE_SAVE_FILE
	dialog.access = FileDialog.ACCESS_FILESYSTEM
	dialog.use_native_dialog = true
	dialog.filters = PackedStringArray(["*.openmtg-replay ; OpenMTG replay"])
	dialog.current_file = _file_name(Val.text(rp, "title"))
	dialog.file_selected.connect(func(path: String) -> void:
		if DirAccess.copy_absolute(Val.text(rp, "path"), path) == OK:
			Sound.cue("ui.success")
			_say("Exported “%s”." % Val.text(rp, "title"))
		else:
			_fail("The file could not be saved."))
	add_child(dialog)
	dialog.popup_centered(Vector2i(900, 560))


func _pick_imports() -> void:
	var dialog := FileDialog.new()
	dialog.file_mode = FileDialog.FILE_MODE_OPEN_FILES
	dialog.access = FileDialog.ACCESS_FILESYSTEM
	dialog.use_native_dialog = true
	dialog.filters = PackedStringArray(["*.openmtg-replay, *.json, *.gz ; OpenMTG replays"])
	dialog.files_selected.connect(func(paths: PackedStringArray) -> void: _import_files(Array(paths)))
	add_child(dialog)
	dialog.popup_centered(Vector2i(900, 560))


func _on_files_dropped(files: PackedStringArray) -> void:
	_import_files(Array(files))


func _import_files(paths: Array) -> void:
	if paths.is_empty():
		return
	_import.disabled = true
	var refused: Array[String] = []
	var titles: Array[String] = []
	for p: Variant in paths:
		var path := String(p)
		var r: Dictionary = await Server.post_json("/api/library/replays/import", {"path": path})
		if bool(r["ok"]):
			titles.append(_title_of(Val.dict(Val.as_dict(r["data"]), "replay")))
		else:
			refused.append("“%s” was not imported: %s" % [path.get_file().substr(0, 100), r["error"]])
	_import.disabled = false
	if not titles.is_empty():
		_say("Imported “%s”." % titles[0] if titles.size() == 1 else "Imported %d replays." % titles.size())
	if not refused.is_empty():
		_fail(" ".join(refused))
	elif not titles.is_empty():
		Sound.cue("ui.success")
	_load()


func _watch(rp: Dictionary) -> void:
	Nav.open("table", {"replay": Val.text(rp, "id"), "title": _title_of(rp)})
