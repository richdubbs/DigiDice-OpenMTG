extends Control
## Decks (packages/client/src/decks/DecksScreen.tsx, useDeckInfo.ts, ImportPanel.tsx, ExportPanel.tsx): the player's decks as
## boxes, each with its name, colours, format, size and date, a format check (Legal, problems, Not fully checked, Empty), and
## Edit, Rename, Duplicate, Export and Delete. New deck makes one and opens the deckbuilder; Import reads a pasted or loaded list
## (or explains how to copy one from a deck site) and saves it. The decks are the server's library; one change runs at a time
## and the list is read again after each.


var _grid: HFlowContainer = null
var _count_chip: Label = null
var _new_button: Button = null
var _error: Label = null
var _message: Label = null
var _status: Label = null
var _empty: Control = null
var _decks: Array = []
var _busy: bool = false
## name -> CardSummary, for the whole visit.
var _cards: Dictionary = {}
## deck id -> {updatedAt, colors, validity, problems, cover}
var _info: Dictionary = {}
## deck id -> its tile's parts.
var _tiles: Dictionary = {}
var _info_run: int = 0
## Picture key -> the deck whose cover it is, while the picture is on its way.
var _cover_wait: Dictionary = {}


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
	for side: String in ["left", "right"]:
		margin.add_theme_constant_override("margin_" + side, 24)
	margin.add_theme_constant_override("margin_top", 14)
	margin.add_theme_constant_override("margin_bottom", 18)
	scroll.add_child(margin)
	var page := VBoxContainer.new()
	page.add_theme_constant_override("separation", 12)
	margin.add_child(page)
	page.add_child(_title_row())
	page.add_child(HSeparator.new())
	_error = Hud.text("", 14, Color("#ff9bff"))
	_error.visible = false
	page.add_child(_error)
	_message = Hud.text("", 14, Hud.TEXT)
	_message.visible = false
	page.add_child(_message)
	_status = Hud.text("Loading decks…", 14)
	page.add_child(_status)
	_empty = _empty_state()
	_empty.visible = false
	page.add_child(_empty)
	_grid = HFlowContainer.new()
	_grid.alignment = FlowContainer.ALIGNMENT_CENTER
	_grid.add_theme_constant_override("h_separation", 24)
	_grid.add_theme_constant_override("v_separation", 30)
	page.add_child(_grid)
	Pictures.picture_ready.connect(_on_picture)
	_reload()


## The tile under the pointer lifts: up 7 px over 180 ms, its box turning toward the player.
func _process(_delta: float) -> void:
	var mouse := get_global_mouse_position()
	for id: String in _tiles:
		var parts: Dictionary = _tiles[id]
		var holder: Control = parts["holder"]
		if not is_instance_valid(holder):
			continue
		var on := holder.get_global_rect().has_point(mouse) and not _has_modal()
		var deck_box: DeckBox = parts["box"]
		if deck_box.lifted == on:
			continue
		deck_box.lifted = on
		var panel: Control = parts["panel"]
		var t := create_tween()
		t.tween_property(panel, "position:y", -7.0 if on else 0.0, 0.18).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
		panel.modulate = Color(1.08, 1.08, 1.14) if on else Color.WHITE


func _has_modal() -> bool:
	for c: Node in get_children():
		if c is Modal:
			return true
	return false


func _title_row() -> Control:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 14)
	var back := Hud.button("‹")
	back.tooltip_text = "Back"
	back.custom_minimum_size = Vector2(44, 44)
	back.set_meta(&"sfx", "none")
	back.pressed.connect(Nav.back)
	row.add_child(back)
	var title := Hud.title("Decks", 30)
	title.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(title)
	_count_chip = Label.new()
	_count_chip.visible = false
	_count_chip.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_count_chip.add_theme_font_size_override("font_size", 12)
	_count_chip.add_theme_color_override("font_color", Color("#8fe9ff"))
	var chip := StyleBoxFlat.new()
	chip.bg_color = Color(NeonTheme.colors()[0], 0.08)
	chip.border_color = Color(NeonTheme.colors()[0], 0.6)
	chip.set_border_width_all(1)
	chip.set_corner_radius_all(999)
	chip.content_margin_left = 10
	chip.content_margin_right = 10
	chip.content_margin_top = 2
	chip.content_margin_bottom = 2
	_count_chip.add_theme_stylebox_override("normal", chip)
	row.add_child(_count_chip)
	var spacer := Control.new()
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(spacer)
	_new_button = Hud.primary("New deck", 16)
	_new_button.custom_minimum_size = Vector2(150, 42)
	_new_button.pressed.connect(_new_deck)
	row.add_child(_new_button)
	var import := Hud.button("Import")
	import.custom_minimum_size = Vector2(110, 42)
	import.pressed.connect(_open_import)
	row.add_child(import)
	return row


func _empty_state() -> Control:
	var center := CenterContainer.new()
	var panel := Hud.panel(28)
	panel.custom_minimum_size = Vector2(520, 0)
	center.add_child(panel)
	var box := VBoxContainer.new()
	box.alignment = BoxContainer.ALIGNMENT_CENTER
	box.add_theme_constant_override("separation", 12)
	panel.add_child(box)
	var deck_box := DeckBox.new()
	deck_box.custom_minimum_size = Vector2(240, 250)
	deck_box.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	box.add_child(deck_box)
	var text := Hud.text("No decks yet. Start a new deck or import a decklist.", 15)
	text.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(text)
	return center


func _say(text: String) -> void:
	_message.text = text
	_message.visible = text != ""


func _fail(text: String) -> void:
	_error.text = text
	_error.visible = text != ""
	if text != "":
		Sound.cue("ui.error")


# ---- the list -------------------------------------------------------------------------------------------------------------------

func _reload() -> void:
	var r: Dictionary = await DeckModel.list_decks()
	if not is_inside_tree():
		return
	_status.visible = false
	if not bool(r["ok"]):
		_fail("Could not open the deck library: %s" % r["error"])
		_decks = []
	else:
		_decks = r["decks"]
	_count_chip.visible = not _decks.is_empty()
	_count_chip.text = ("1 DECK" if _decks.size() == 1 else "%d DECKS" % _decks.size())
	_empty.visible = _decks.is_empty()
	_build_tiles()
	_load_info()


func _build_tiles() -> void:
	for c: Node in _grid.get_children():
		c.queue_free()
	_tiles.clear()
	var tile_w := clampf(get_viewport_rect().size.x * 0.24, 240.0, 380.0)
	for d: Variant in _decks:
		var deck := Val.as_dict(d)
		_grid.add_child(_tile(deck, tile_w))


func _tile(d: Dictionary, tile_w: float) -> Control:
	var id := Val.text(d, "id")
	var holder := Control.new()
	holder.custom_minimum_size = Vector2(tile_w, tile_w * 0.78 + 300.0)
	var panel := Hud.panel(14)
	panel.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	holder.add_child(panel)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 8)
	panel.add_child(box)
	# The upper part opens Deck Details.
	var open := Button.new()
	open.flat = true
	open.set_meta(&"slab", "none")
	open.set_meta(&"sfx", "none")
	open.tooltip_text = "Open %s" % DeckModel.shown_name(d)
	open.size_flags_vertical = Control.SIZE_EXPAND_FILL
	open.custom_minimum_size = Vector2(0, tile_w * 0.78 + 180.0)
	box.add_child(open)
	var inside := VBoxContainer.new()
	inside.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	inside.mouse_filter = Control.MOUSE_FILTER_IGNORE
	inside.add_theme_constant_override("separation", 4)
	open.add_child(inside)
	var deck_box := DeckBox.new()
	deck_box.custom_minimum_size = Vector2(tile_w * 0.54 * 1.5, tile_w * 0.54 * 1.396 + 26.0)
	deck_box.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	inside.add_child(deck_box)
	var title := Label.new()
	title.text = DeckModel.shown_name(d)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	title.max_lines_visible = 2
	title.add_theme_font_override("font", Hud.bold_font())
	title.add_theme_font_size_override("font_size", 18)
	title.add_theme_color_override("font_color", Color("#f2fbff"))
	title.add_theme_color_override("font_shadow_color", Color(NeonTheme.colors()[0], 0.6))
	title.add_theme_constant_override("shadow_outline_size", 6)
	inside.add_child(title)
	var pips := Pips.new()
	pips.custom_minimum_size = Vector2(0, 18)
	inside.add_child(pips)
	var meta := Hud.text(_meta_line(d), 12)
	meta.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	inside.add_child(meta)
	var updated := Hud.text("Updated %s" % _local_day(Val.text(d, "updatedAt")), 11)
	updated.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	inside.add_child(updated)
	var chip := FormatChip.new()
	chip.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	box.add_child(chip)
	var actions := HBoxContainer.new()
	actions.add_theme_constant_override("separation", 7)
	var edit := Hud.primary("Edit", 15)
	edit.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	edit.custom_minimum_size = Vector2(0, 36)
	edit.set_meta(&"sfx", "none")
	edit.pressed.connect(func() -> void: _open(id, "build"))
	actions.add_child(edit)
	for a: Array in [["Rename", "edit"], ["Duplicate", "copy"], ["Export", "export"], ["Delete", "trash"]]:
		var b := IconButton.new()
		b.icon_name = String(a[1])
		b.tooltip_text = String(a[0])
		b.custom_minimum_size = Vector2(34, 34)
		if a[0] == "Delete":
			b.set_meta(&"slab", "danger")
		var action := String(a[0])
		b.pressed.connect(func() -> void: _tile_action(action, d))
		actions.add_child(b)
	box.add_child(actions)
	open.pressed.connect(func() -> void: _open(id, "details"))
	_tiles[id] = {"holder": holder, "panel": panel, "box": deck_box, "pips": pips, "chip": chip, "open": open}
	_apply_info(id)
	return holder


static func _meta_line(d: Dictionary) -> String:
	var parts: Array[String] = [DeckModel.format_name(Val.text(d, "format")), "%d main" % DeckModel.section_count(d, "main")]
	var side := DeckModel.section_count(d, "sideboard")
	if side > 0:
		parts.append("%d sideboard" % side)
	var commanders: Array[String] = []
	for e: Variant in Val.list(d, "commander"):
		commanders.append(Val.text(Val.as_dict(e), "name"))
	if not commanders.is_empty():
		parts.append("Commander: %s" % " & ".join(commanders))
	if Val.text(d, "cover") != "":
		parts.append("Cover: %s" % Val.text(d, "cover"))
	return " · ".join(parts)


## The local calendar day of an ISO time ("2026-10-12"); its first 10 characters when it cannot be read.
static func _local_day(iso: String) -> String:
	var unix := Time.get_unix_time_from_datetime_string(iso.substr(0, 19))
	if unix <= 0 and not iso.begins_with("1970"):
		return iso.substr(0, 10)
	var bias := int(Time.get_time_zone_from_system().get("bias", 0)) * 60
	return Time.get_date_string_from_unix_time(unix + bias)


# ---- what each tile shows: cover, check, colours (useDeckInfo) --------------------------------------------------------------------

func _load_info() -> void:
	_info_run += 1
	var run := _info_run
	for d: Variant in _decks:
		var deck := Val.as_dict(d)
		var id := Val.text(deck, "id")
		var known := Val.as_dict(_info.get(id))
		if not known.is_empty() and Val.text(known, "updatedAt") == Val.text(deck, "updatedAt"):
			_apply_info(id)
			continue
		var info := {"updatedAt": Val.text(deck, "updatedAt"), "colors": null, "validity": "checking", "problems": 0, "cover": {}}
		_info[id] = info
		_apply_info(id)
		var cover := Val.text(deck, "cover")
		if cover != "":
			info["cover"] = await _card(cover)
			if run != _info_run or not is_inside_tree():
				return
			_apply_info(id)
		var playing := DeckModel.playing_names(deck)
		if playing.is_empty():
			info["colors"] = ""
			info["validity"] = "empty"
			_apply_info(id)
			continue
		var r: Dictionary = await Server.post_json("/api/decks/validate",
			{"deck": DeckModel.to_deck_list(deck), "format": DeckModel.validate_format(Val.text(deck, "format"))})
		if run != _info_run or not is_inside_tree():
			return
		if bool(r["ok"]):
			var answer := Val.as_dict(r["data"])
			var n := 0
			for p: Variant in Val.list(answer, "problems"):
				if Val.text(Val.as_dict(p), "severity") != "note":
					n += 1
			info["problems"] = n
			info["validity"] = Val.text(answer, "status")
		else:
			info["validity"] = "unknown"
		_apply_info(id)
		await _cards_for(playing)
		if run != _info_run or not is_inside_tree():
			return
		info["colors"] = DeckModel.deck_colors(deck, _cards)
		_apply_info(id)


## A card's summary (GET /api/cards/<name>, with its picture address when Scryfall pictures are on); {} when it is unknown.
func _card(card_name: String) -> Dictionary:
	if _cards.has(card_name):
		return _cards[card_name]
	var r: Dictionary = await Server.get_json("/api/cards/%s%s" % [card_name.uri_encode(), "?images=1" if Settings.scryfall_images else ""])
	var card := Val.dict(Val.as_dict(r["data"]), "card") if bool(r["ok"]) else {}
	_cards[card_name] = card
	return card


func _cards_for(names: Array[String]) -> void:
	for n: String in names:
		if not _cards.has(n):
			await _card(n)
		if not is_inside_tree():
			return


func _apply_info(id: String) -> void:
	var parts := Val.as_dict(_tiles.get(id))
	var info := Val.as_dict(_info.get(id))
	if parts.is_empty() or info.is_empty():
		return
	var deck_box: DeckBox = parts["box"]
	var pips: Pips = parts["pips"]
	var chip: FormatChip = parts["chip"]
	var colors: Variant = info.get("colors")
	deck_box.colors = String(colors) if colors != null else ""
	pips.colors = String(colors) if colors != null else ""
	pips.colorless = colors != null and String(colors) == "" and Val.text(info, "validity") != "empty"
	chip.show_state(Val.text(info, "validity"), int(Val.num(info, "problems")))
	var cover := Val.as_dict(info.get("cover"))
	if not cover.is_empty():
		var t := Pictures.texture_for(cover, 0)
		if t != null:
			deck_box.cover = t
		else:
			_cover_wait[Pictures.key_for(cover, 0)] = id


## A cover picture that was on its way.
func _on_picture(key: String, texture: Texture2D) -> void:
	if not _cover_wait.has(key):
		return
	var parts := Val.as_dict(_tiles.get(String(_cover_wait[key])))
	_cover_wait.erase(key)
	if not parts.is_empty():
		(parts["box"] as DeckBox).cover = texture


# ---- actions ----------------------------------------------------------------------------------------------------------------------

func _open(id: String, view: String) -> void:
	Nav.open("deckbuilder", {"id": id, "view": view})


## Run one change (nothing while another runs): its message and sound on success, the error and ui.error on failure; the list is
## read again either way.
func _act(work: Callable) -> void:
	if _busy:
		return
	_busy = true
	_new_button.disabled = true
	_fail("")
	var r: Dictionary = await work.call()
	_busy = false
	if not is_inside_tree():
		return
	_new_button.disabled = false
	if bool(r.get("ok", false)):
		_say(String(r.get("message", "")))
		var sound := String(r.get("sound", ""))
		if sound != "":
			Sound.cue(sound)
	else:
		_fail(String(r.get("error", "")))
	if not bool(r.get("navigated", false)):
		_reload()


func _new_deck() -> void:
	UiSounds.claim()
	_act(func() -> Dictionary:
		var d := DeckModel.empty_deck(DeckModel.next_name(_decks), "casual")
		var r: Dictionary = await DeckModel.save_deck(d, null)
		if not bool(r["ok"]):
			return {"ok": false, "error": r["error"]}
		_open(Val.text(d, "id"), "build")
		return {"ok": true, "navigated": true})


func _tile_action(action: String, d: Dictionary) -> void:
	match action:
		"Rename":
			_open_rename(d)
		"Duplicate":
			_act(func() -> Dictionary:
				var r: Dictionary = await DeckModel.save_deck(DeckModel.duplicate_deck(d), null)
				return {"ok": r["ok"], "error": r["error"], "message": "Made a copy of “%s”." % Val.text(d, "name"), "sound": "ui.notify"})
		"Export":
			_open_export(d)
		"Delete":
			_open_delete(d)


var _rename_drafts: Dictionary = {}


func _open_rename(d: Dictionary) -> void:
	var id := Val.text(d, "id")
	var m := Modal.open(self, "Rename “%s”" % Val.text(d, "name"))
	var field := LineEdit.new()
	field.text = String(_rename_drafts.get(id, Val.text(d, "name")))
	field.placeholder_text = "New name"
	m.body.add_child(field)
	var hint := Hud.text("Type a name to save it.", 12)
	m.body.add_child(hint)
	var row := HBoxContainer.new()
	row.alignment = BoxContainer.ALIGNMENT_END
	row.add_theme_constant_override("separation", 8)
	var save := Hud.primary("Save name", 15)
	row.add_child(save)
	row.add_child(m.cancel_button())
	m.body.add_child(row)
	var refresh := func() -> void:
		_rename_drafts[id] = field.text
		hint.visible = field.text.strip_edges() == ""
		save.disabled = field.text.strip_edges() == "" or _busy
	field.text_changed.connect(func(_t: String) -> void: refresh.call())
	refresh.call()
	var submit := func() -> void:
		if field.text.strip_edges() == "" or _busy:
			return
		var new_name := field.text.strip_edges()
		_rename_drafts.erase(id)
		m.close()
		_act(func() -> Dictionary:
			var next := d.duplicate(true)
			next["name"] = new_name
			next["updatedAt"] = DeckModel.now_iso()
			var r: Dictionary = await DeckModel.save_deck(next)
			return {"ok": r["ok"], "error": r["error"], "message": "Renamed to “%s”." % new_name})
	save.pressed.connect(submit)
	field.text_submitted.connect(func(_t: String) -> void: submit.call())
	field.grab_focus()
	field.select_all()


func _open_delete(d: Dictionary) -> void:
	var m := Modal.open(self, "Delete this deck?")
	m.body.add_child(Hud.text("Delete “%s”? This cannot be undone; export it first to keep a copy (the Plain text export also keeps the notes)." % Val.text(d, "name"), 14, Hud.TEXT))
	var row := HBoxContainer.new()
	row.alignment = BoxContainer.ALIGNMENT_END
	row.add_theme_constant_override("separation", 8)
	var yes := Hud.button("Delete deck")
	yes.set_meta(&"slab", "danger")
	yes.set_meta(&"sfx", "none")
	yes.disabled = _busy
	row.add_child(yes)
	var cancel := m.cancel_button()
	row.add_child(cancel)
	m.body.add_child(row)
	cancel.grab_focus.call_deferred()
	yes.pressed.connect(func() -> void:
		m.close()
		_act(func() -> Dictionary:
			var r: Dictionary = await DeckModel.delete_deck(Val.text(d, "id"))
			return {"ok": r["ok"], "error": r["error"], "message": "Deleted “%s”." % Val.text(d, "name"), "sound": "ui.delete"}))


func _open_export(d: Dictionary) -> void:
	var m := Modal.open(self, "", true)
	m.body.add_child(ExportPanel.make(d, m))


func _open_import() -> void:
	var m := Modal.open(self, "", true)
	var panel := ImportPanel.make(m)
	m.body.add_child(panel)
	panel.save_requested.connect(func(deck: Dictionary, ignored: int) -> void:
		m.close()
		_act(func() -> Dictionary:
			var r: Dictionary = await DeckModel.save_deck(deck, null)
			var message := "Imported “%s” (%d main-deck cards)." % [Val.text(deck, "name"), DeckModel.section_count(deck, "main")]
			if ignored > 0:
				message += " " + DeckModel.ignored_text(ignored, "were")
			return {"ok": r["ok"], "error": r["error"], "message": message, "sound": "ui.success"}))


# ---- pieces --------------------------------------------------------------------------------------------------------------------------

## The deck's colours as round discs (W U B R G), or "Colorless".
class Pips:
	extends Control

	var colors: String = "":
		set(v):
			colors = v
			queue_redraw()
	var colorless: bool = false:
		set(v):
			colorless = v
			queue_redraw()

	func _draw() -> void:
		var r := 7.0
		if colors == "":
			if colorless:
				var font := get_theme_default_font()
				var w := font.get_string_size("Colorless", HORIZONTAL_ALIGNMENT_LEFT, -1, 12).x
				draw_string(font, Vector2((size.x - w) / 2.0, size.y * 0.75), "Colorless", HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Hud.MUTED)
			return
		var total := colors.length() * (r * 2.0 + 4.0) - 4.0
		var x := (size.x - total) / 2.0 + r
		for c: String in colors.split(""):
			ManaCost.draw_symbol(self, c, Vector2(x, size.y / 2.0), r)
			x += r * 2.0 + 4.0


## The format check of a tile: Legal, "n problems", "Not fully checked", "Empty" or "Checking…".
class FormatChip:
	extends Label

	func _ready() -> void:
		add_theme_font_override("font", Hud.bold_font())
		add_theme_font_size_override("font_size", 12)
		custom_minimum_size = Vector2(0, 22)

	func show_state(validity: String, problems: int) -> void:
		var tone := Hud.MUTED
		var border := Color(1, 1, 1, 0.15)
		match validity:
			"legal":
				text = "✓ Legal"
				tone = Color("#8fe9ff")
				border = NeonTheme.colors()[0]
			"illegal":
				text = "✕ %d problem%s" % [problems, "" if problems == 1 else "s"]
				tone = Color("#ffa6ff")
				border = NeonTheme.colors()[1]
			"unchecked":
				text = "Not fully checked"
				tone = Color("#ffd98f")
				border = Color("#ffb000")
			"empty":
				text = "Empty"
			"checking":
				text = "Checking…"
			_:
				text = ""
		tooltip_text = "Format check: %s" % text if text != "" else ""
		visible = true
		modulate.a = 1.0 if text != "" else 0.0
		add_theme_color_override("font_color", tone)
		var s := StyleBoxFlat.new()
		s.bg_color = Color(border, 0.1)
		s.border_color = Color(border, 0.7)
		s.set_border_width_all(1)
		s.set_corner_radius_all(999)
		s.content_margin_left = 11
		s.content_margin_right = 11
		s.content_margin_top = 2
		s.content_margin_bottom = 2
		add_theme_stylebox_override("normal", s)


## A small square button with a line icon: edit, copy, export or trash.
class IconButton:
	extends Button

	var icon_name: String = ""

	func _draw() -> void:
		var c := size / 2.0
		var k := minf(size.x, size.y) / 24.0 * 0.62
		var col := Color.WHITE if not disabled else Color(1, 1, 1, 0.4)
		var w := 2.0
		var at := func(x: float, y: float) -> Vector2: return c + (Vector2(x, y) - Vector2(12, 12)) * k
		match icon_name:
			"edit":
				draw_polyline(PackedVector2Array([at.call(4, 20), at.call(8, 20), at.call(19, 9), at.call(15, 5), at.call(4, 16), at.call(4, 20)]), col, w, true)
				draw_line(at.call(13, 7), at.call(17, 11), col, w, true)
			"copy":
				draw_rect(Rect2(at.call(8, 8), Vector2(12, 12) * k), col, false, w)
				draw_polyline(PackedVector2Array([at.call(16, 8), at.call(16, 4), at.call(4, 4), at.call(4, 16), at.call(8, 16)]), col, w, true)
			"export":
				draw_line(at.call(12, 15), at.call(12, 4), col, w, true)
				draw_polyline(PackedVector2Array([at.call(7.5, 8.5), at.call(12, 4), at.call(16.5, 8.5)]), col, w, true)
				draw_polyline(PackedVector2Array([at.call(5, 14), at.call(5, 20), at.call(19, 20), at.call(19, 14)]), col, w, true)
			"trash":
				draw_line(at.call(5, 7), at.call(19, 7), col, w, true)
				draw_polyline(PackedVector2Array([at.call(10, 7), at.call(10, 4), at.call(14, 4), at.call(14, 7)]), col, w, true)
				draw_polyline(PackedVector2Array([at.call(7, 7), at.call(8, 20), at.call(16, 20), at.call(17, 7)]), col, w, true)
				draw_line(at.call(10, 11), at.call(10, 17), col, w, true)
				draw_line(at.call(14, 11), at.call(14, 17), col, w, true)
