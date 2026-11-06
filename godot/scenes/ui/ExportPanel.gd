class_name ExportPanel
extends VBoxContainer
## Export a deck (packages/client/src/decks/ExportPanel.tsx): Arena, MTGO or plain text, the text to copy, Copy, Save .txt
## and Close.

var _deck: Dictionary = {}
var _kind: String = "arena"
var _text: TextEdit = null
var _hint: Label = null
var _result: Label = null


static func make(deck: Dictionary, modal: Modal) -> ExportPanel:
	var p := ExportPanel.new()
	p._deck = deck
	p._build(modal)
	return p


func _build(modal: Modal) -> void:
	add_theme_constant_override("separation", 10)
	var title := Label.new()
	title.text = "Export “%s”" % Val.text(_deck, "name")
	title.add_theme_font_override("font", Hud.bold_font())
	title.add_theme_font_size_override("font_size", 20)
	add_child(title)
	var kinds := HBoxContainer.new()
	kinds.add_theme_constant_override("separation", 16)
	var group := ButtonGroup.new()
	for k: Array in DeckModel.EXPORT_KINDS:
		var r := CheckBox.new()
		r.button_group = group
		r.text = String(k[1])
		r.button_pressed = k[0] == _kind
		var kind := String(k[0])
		r.toggled.connect(func(on: bool) -> void:
			if on:
				_kind = kind
				_refresh())
		kinds.add_child(r)
	add_child(kinds)
	_hint = Hud.text("", 13)
	add_child(_hint)
	_text = TextEdit.new()
	_text.editable = false
	_text.custom_minimum_size = Vector2(0, 260)
	_text.add_theme_font_override("font", _mono())
	_text.focus_entered.connect(func() -> void: _text.select_all())
	add_child(_text)
	_result = Hud.text("", 13, Hud.TEXT)
	_result.visible = false
	add_child(_result)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	row.alignment = BoxContainer.ALIGNMENT_END
	var copy := Hud.button("Copy")
	copy.set_meta(&"sfx", "none")
	copy.pressed.connect(func() -> void:
		DisplayServer.clipboard_set(_text.text)
		_show("Copied to the clipboard.", "ui.success"))
	row.add_child(copy)
	var save := Hud.button("Save .txt…")
	save.set_meta(&"sfx", "none")
	save.pressed.connect(_save)
	row.add_child(save)
	row.add_child(modal.cancel_button("Close"))
	add_child(row)
	_refresh()


static func _mono() -> Font:
	var f := SystemFont.new()
	f.font_names = PackedStringArray(["Consolas", "Cascadia Mono", "monospace"])
	return f


func _refresh() -> void:
	_hint.text = String(DeckModel.EXPORT_HINTS[_kind])
	_text.text = DeckModel.export_text(_deck, _kind)


func _show(text: String, sound: String) -> void:
	_result.text = text
	_result.visible = true
	Sound.cue(sound)


func _save() -> void:
	var dialog := FileDialog.new()
	dialog.file_mode = FileDialog.FILE_MODE_SAVE_FILE
	dialog.access = FileDialog.ACCESS_FILESYSTEM
	dialog.use_native_dialog = true
	dialog.filters = PackedStringArray(["*.txt ; Text"])
	dialog.current_file = DeckModel.export_file_name(Val.text(_deck, "name"), _kind)
	dialog.file_selected.connect(func(path: String) -> void:
		var f := FileAccess.open(path, FileAccess.WRITE)
		if f == null:
			_show("The file could not be saved.", "ui.error")
			return
		f.store_string(_text.text)
		f.close()
		_show("Saved “%s”." % path.get_file(), "ui.success"))
	add_child(dialog)
	dialog.popup_centered(Vector2i(800, 500))
