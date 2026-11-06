class_name ImportPanel
extends VBoxContainer
## Import a deck (packages/client/src/decks/ImportPanel.tsx): paste a list (Arena, MTGO or plain text), load a .txt file, or
## paste a deck site's link (OpenMTG never opens it: the panel says how to copy the list from that site). POST /api/decks/resolve
## reads it; a list with unknown names, unreadable lines or links is shown for review first (unknown names with "Use …" buttons
## for the suggested cards), else the deck is saved at once (`save_requested`).

signal save_requested(deck: Dictionary, ignored: int)

const MAX_FILE_BYTES: int = 1_000_000

var _modal: Modal = null
var _text: TextEdit = null
var _name: LineEdit = null
var _format: OptionButton = null
var _import: Button = null
var _state: VBoxContainer = null
var _file_name: String = ""
var _reading: bool = false
var _saving: bool = false

static var _re_link: RegEx = null


static func make(modal: Modal) -> ImportPanel:
	var p := ImportPanel.new()
	p._modal = modal
	p._build()
	return p


func _build() -> void:
	add_theme_constant_override("separation", 10)
	var title := Label.new()
	title.text = "Import a deck"
	title.add_theme_font_override("font", Hud.bold_font())
	title.add_theme_font_size_override("font_size", 20)
	add_child(title)
	add_child(Hud.text("Paste a decklist (Arena, MTGO or plain text), upload a .txt file, or paste a link to a deck on a deck site.", 13))
	_text = TextEdit.new()
	_text.custom_minimum_size = Vector2(0, 220)
	_text.placeholder_text = "4 Lightning Bolt\n20 Mountain\n\nSideboard\n2 Pyroblast"
	_text.add_theme_font_override("font", ExportPanel._mono())
	_text.text_changed.connect(func() -> void:
		if not _reading:
			_clear_state()
		_refresh())
	add_child(_text)
	var file_row := HBoxContainer.new()
	file_row.add_theme_constant_override("separation", 8)
	var upload := Hud.button("Upload a file")
	upload.pressed.connect(_pick_file)
	file_row.add_child(upload)
	add_child(file_row)
	var grid := GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 12)
	grid.add_child(_caption("Deck name"))
	_name = LineEdit.new()
	_name.placeholder_text = "From the list, or “Imported deck”"
	_name.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	grid.add_child(_name)
	grid.add_child(_caption("Format"))
	_format = OptionButton.new()
	_format.add_item("From the list (else Casual)")
	_format.set_item_metadata(0, "")
	for f: Dictionary in Config.FORMAT_OPTIONS:
		_format.add_item(String(f["name"]))
		_format.set_item_metadata(_format.item_count - 1, String(f["id"]))
	grid.add_child(_format)
	add_child(grid)
	_state = VBoxContainer.new()
	_state.add_theme_constant_override("separation", 6)
	add_child(_state)
	var row := HBoxContainer.new()
	row.alignment = BoxContainer.ALIGNMENT_END
	row.add_theme_constant_override("separation", 8)
	_import = Hud.primary("Import deck", 15)
	_import.pressed.connect(func() -> void: _submit(_text.text))
	row.add_child(_import)
	row.add_child(_modal.cancel_button())
	add_child(row)
	_refresh()
	_text.grab_focus.call_deferred()


func _caption(text: String) -> Label:
	var l := Label.new()
	l.text = text
	return l


func _refresh() -> void:
	_import.disabled = _text.text.strip_edges() == "" or _reading


func _clear_state() -> void:
	for c: Node in _state.get_children():
		c.queue_free()


func _line(text: String, color: Color = Hud.TEXT, size: int = 13) -> Label:
	var l := Hud.text(text, size, color)
	_state.add_child(l)
	return l


func _pick_file() -> void:
	var dialog := FileDialog.new()
	dialog.file_mode = FileDialog.FILE_MODE_OPEN_FILE
	dialog.access = FileDialog.ACCESS_FILESYSTEM
	dialog.use_native_dialog = true
	dialog.filters = PackedStringArray(["*.txt, *.dec ; Decklists"])
	dialog.file_selected.connect(func(path: String) -> void:
		_clear_state()
		var f := FileAccess.open(path, FileAccess.READ)
		if f == null:
			_line("Could not read %s" % path.get_file(), Color("#ff9bff"))
			return
		if f.get_length() > MAX_FILE_BYTES:
			_line("%s is too large for a decklist." % path.get_file(), Color("#ff9bff"))
			return
		_text.text = f.get_as_text()
		_file_name = path.get_file()
		_refresh())
	add_child(dialog)
	dialog.popup_centered(Vector2i(800, 500))


static func _is_link(text: String) -> bool:
	if _re_link == null:
		_re_link = RegEx.create_from_string("(?i)^https?://\\S+$")
	return _re_link.search(text.strip_edges()) != null


func _submit(text: String) -> void:
	if text.strip_edges() == "" or _reading:
		return
	_reading = true
	_refresh()
	_clear_state()
	_line("Reading the list…", Hud.MUTED)
	var r: Dictionary = await Server.post_json("/api/decks/resolve", {"text": text})
	_reading = false
	if not is_inside_tree():
		return
	_refresh()
	_clear_state()
	if not bool(r["ok"]):
		if _is_link(text):
			_link_steps([{"site": "this site", "url": text.strip_edges(), "exportSteps": DeckModel.GENERIC_LINK_STEPS}])
			Sound.cue("ui.notify")
		else:
			_line("Import failed: %s" % r["error"], Color("#ff9bff"))
			Sound.cue("ui.error")
		return
	var res := Val.as_dict(r["data"])
	var cards: Array = Val.list(res, "cards")
	var unknown: Array = Val.list(res, "unknown")
	var errors: Array = Val.list(res, "errors")
	var links: Array = Val.list(res, "links")
	if not links.is_empty() and cards.is_empty():
		_link_steps(links)
		Sound.cue("ui.notify")
		return
	if cards.is_empty() and unknown.is_empty() and _is_link(text):
		_link_steps([{"site": "this site", "url": text.strip_edges(), "exportSteps": DeckModel.GENERIC_LINK_STEPS}])
		Sound.cue("ui.notify")
		return
	if not unknown.is_empty() or not errors.is_empty() or not links.is_empty() or cards.is_empty():
		_review(text, res)
		Sound.cue("ui.notify")
		return
	_save(text, res)


func _link_steps(links: Array) -> void:
	for l: Variant in links:
		var ld := Val.as_dict(l)
		_line("OpenMTG does not download decks from %s. To import this deck, copy it as text:" % Val.text(ld, "site"))
		var steps: Array = Val.list(ld, "exportSteps")
		for i: int in steps.size():
			_line("%d. %s" % [i + 1, String(steps[i])], Hud.MUTED)


func _review(text: String, res: Dictionary) -> void:
	_link_steps(Val.list(res, "links"))
	var unknown: Array = Val.list(res, "unknown")
	if not unknown.is_empty():
		_line("These names were not found and will be left out:")
		for u: Variant in unknown:
			var ud := Val.as_dict(u)
			var ambiguous: Array = Val.list(ud, "ambiguous")
			var options: Array = ambiguous if not ambiguous.is_empty() else Val.list(ud, "suggestions")
			var desc := "Line %d: %d %s" % [int(Val.num(ud, "line")), int(Val.num(ud, "count")), Val.text(ud, "name")]
			if not ambiguous.is_empty():
				desc += " (could be: %s)" % ", ".join(PackedStringArray(ambiguous))
			elif not options.is_empty():
				desc += " (did you mean: %s?)" % ", ".join(PackedStringArray(options))
			_line(desc, Hud.MUTED)
			if not options.is_empty():
				var row := HFlowContainer.new()
				row.add_theme_constant_override("h_separation", 6)
				for s: Variant in options:
					var b := Hud.button("Use %s" % String(s))
					b.tooltip_text = "Use %s for line %d" % [String(s), int(Val.num(ud, "line"))]
					b.disabled = _saving
					var pick := String(s)
					b.pressed.connect(func() -> void:
						var fixed := DeckModel.replace_line_name(_text.text, int(Val.num(ud, "line")), Val.text(ud, "name"), pick)
						_reading = true
						_text.text = fixed
						_reading = false
						_submit(fixed))
					row.add_child(b)
				_state.add_child(row)
	var errors: Array = Val.list(res, "errors")
	if not errors.is_empty():
		_line("These lines could not be read:")
		for e: Variant in errors:
			var ed := Val.as_dict(e)
			_line("Line %d: “%s”: %s" % [int(Val.num(ed, "line")), Val.text(ed, "text"), Val.text(ed, "message")], Hud.MUTED)
	var ignored := int(Val.num(res, "ignored"))
	if ignored > 0:
		_line(DeckModel.ignored_text(ignored, "will be"), Hud.MUTED)
	var n := 0
	for c: Variant in Val.list(res, "cards"):
		n += int(Val.num(Val.as_dict(c), "count"))
	if n > 0:
		var go := Hud.primary("Import the %d card%s found" % [n, "" if n == 1 else "s"], 15)
		go.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		go.pressed.connect(func() -> void: _save(text, res))
		_state.add_child(go)
	else:
		_line("No cards were found in the list.", Hud.MUTED)


func _save(text: String, res: Dictionary) -> void:
	var header := DeckModel.read_header(text)
	var deck_name := _name.text.strip_edges()
	if deck_name == "":
		deck_name = Val.text(header, "name")
	if deck_name == "" and _file_name != "":
		deck_name = _file_name.get_basename()
	if deck_name == "":
		deck_name = "Imported deck"
	var format := String(_format.get_item_metadata(_format.selected))
	if format == "":
		format = Val.text(header, "format", "casual")
	_saving = true
	save_requested.emit(DeckModel.deck_from_resolve(res, deck_name, format, header), int(Val.num(res, "ignored")))
