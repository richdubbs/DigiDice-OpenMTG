class_name NewGameScreen
extends Control
## New game (packages/client/src/game/NewGameScreen.tsx): online entry buttons, format, starting life and who plays first on
## one row, 2 / 3 / 4 players, then one panel per player: who plays it (player 1 is always "You, at this screen"; the others a
## person at this screen or the computer), the name, which decks to show, the deck, and the deck as a box in its colours with
## its size. A VS badge between two players; START GAME (or PLAY VS COMPUTER) at the bottom.
##
## Builds the engine's GameConfig with Config.gd from the card definitions of POST /api/cards/defs, then asks the server for a
## table (GameClient.start) and opens the Table when it exists.
##
## Decks: the built-in ones (data/builtin-decks.json, written from the TypeScript source's practice decks and Commander precons by its
## scripts/export-godot-data.ts) and the player's library on the server (GET /api/library/decks), which a pasted deck joins.
## Decks pasted here before the library existed (user://decks.json) are moved into it once. Opened with Nav.args.deck_id (the
## deckbuilder's Play this deck), that deck is player 1's.

const LOCAL_DECKS: String = "user://decks.json"
const BUILTIN_DECKS: String = "res://data/builtin-decks.json"
const START_TIMEOUT_S: float = 20.0
## The id of "Choose a deck…" (an id of -1 would be the item's position, which is a deck's index).
const NO_DECK: int = 1 << 30
## The players' colours (player 1 the first neon, player 2 the second, then green and amber), as the browser's seats.
const EXTRA_SEAT_COLORS: Array[Color] = [Color(0.25, 1.0, 0.55), Color(1.0, 0.7, 0.2)]
## Which decks a seat lists: [id, label]; the label gets the count.
const SHOW: Array = [["all", "All decks"], ["yours", "Your decks"], ["builtin", "Built-in decks"], ["precon", "Commander precons"]]
const BASIC_COLORS: Dictionary = {"Plains": "W", "Island": "U", "Swamp": "B", "Mountain": "R", "Forest": "G"}
const MANA_TONES: Dictionary = {
	"W": Color(0.98, 0.92, 0.7), "U": Color(0.25, 0.6, 1.0), "B": Color(0.62, 0.42, 0.9), "R": Color(1.0, 0.35, 0.2),
	"G": Color(0.25, 0.95, 0.45),
}

## [{"id", "name", "format", "deck": DeckList, "kind": "yours"|"builtin"|"precon", "colors": "WU", "note": "Practice deck"}]
var _decks: Array[Dictionary] = []
var _format_ids: Array[String] = []
## One per seat: {"name": LineEdit, "deck": OptionButton, "show": OptionButton, "person": Button, "computer": Button,
## "box": DeckBox, "legal": Label}
var _rows: Array[Dictionary] = []
var _starting: bool = false
var _count: int = 2

var _format: OptionButton = null
var _life: SpinBox = null
var _first: OptionButton = null
var _count_buttons: Array[Button] = []
var _seats: GridContainer = null
var _paste_toggle: Button = null
var _paste: VBoxContainer = null
var _paste_name: LineEdit = null
var _paste_text: TextEdit = null
var _paste_add: Button = null
var _message: Label = null
var _start: Button = null


func _ready() -> void:
	TopBar.attach(self)
	var scroll := ScrollContainer.new()
	scroll.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	scroll.offset_top = TopBar.HEIGHT
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	add_child(scroll)
	var margin := MarginContainer.new()
	margin.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for side: String in ["left", "right"]:
		margin.add_theme_constant_override("margin_" + side, 190)
	margin.add_theme_constant_override("margin_top", 18)
	margin.add_theme_constant_override("margin_bottom", 24)
	scroll.add_child(margin)
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 14)
	margin.add_child(col)
	col.add_child(_header())
	col.add_child(_online_row())
	col.add_child(_settings_row())
	col.add_child(_decks_hint())
	_paste = _paste_box()
	col.add_child(_paste)
	col.add_child(_players_row())
	_seats = GridContainer.new()
	_seats.columns = 3
	_seats.add_theme_constant_override("h_separation", 18)
	_seats.add_theme_constant_override("v_separation", 18)
	col.add_child(_seats)
	col.add_child(_start_row())
	_name_unique([_format, _message, _start, _paste_toggle, _paste_name, _paste_text, _paste_add])
	_build_seats(2)
	_load_decks()


func _name_unique(nodes: Array) -> void:
	for n: Variant in nodes:
		var node := n as Node
		node.owner = self
		node.unique_name_in_owner = true


# ---- layout ---------------------------------------------------------------------------------------------------------------------

func _header() -> Control:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 16)
	var back := Hud.button("Back")
	back.name = "Back"
	back.custom_minimum_size = Vector2(80, 36)
	back.pressed.connect(Nav.back)
	row.add_child(back)
	var title := Hud.title("New game", 28)
	row.add_child(title)
	return row


func _online_row() -> Control:
	var panel := Hud.panel(12)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	panel.add_child(row)
	var label := Hud.kicker("Play online against a friend", Hud.MUTED)
	label.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(label)
	for pair: Array in [["Host an online game", "hostOnline"], ["Join an online game", "joinOnline"]]:
		var b := Hud.button(String(pair[0]))
		var screen := String(pair[1])
		b.pressed.connect(func() -> void: Nav.go(screen))
		row.add_child(b)
	# No DigiDice server before the launch: the way in is shown, off.
	var digidice := Hud.button("Play on the DigiDice server")
	digidice.disabled = true
	digidice.tooltip_text = "Coming soon"
	row.add_child(digidice)
	var soon := Hud.kicker("Coming soon", NeonTheme.colors()[1])
	soon.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(soon)
	return panel


func _settings_row() -> Control:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	row.add_child(_caption("Format"))
	_format = OptionButton.new()
	_format.name = "Format"
	for f: Dictionary in Config.formats():
		_format.add_item(String(f["label"]))
		_format_ids.append(String(f["id"]))
	_format.select(maxi(0, _format_ids.find(Config.DEFAULT_FORMAT)))
	_format.item_selected.connect(func(_i: int) -> void: _on_format_changed())
	row.add_child(_format)
	row.add_child(_caption("Starting life"))
	_life = SpinBox.new()
	_life.name = "Life"
	_life.min_value = 1
	_life.max_value = 999
	_life.custom_minimum_size = Vector2(90, 0)
	row.add_child(_life)
	row.add_child(_caption("Who plays first"))
	_first = OptionButton.new()
	_first.name = "First"
	row.add_child(_first)
	return row


func _decks_hint() -> Control:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	var hint := Hud.text("Decks you add appear here; until then, try the practice decks.", 13)
	hint.autowrap_mode = TextServer.AUTOWRAP_OFF
	hint.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(hint)
	_paste_toggle = Button.new()
	_paste_toggle.name = "PasteToggle"
	_paste_toggle.text = "Add a deck from a list…"
	_paste_toggle.toggle_mode = true
	_paste_toggle.flat = true
	_paste_toggle.add_theme_color_override("font_color", NeonTheme.colors()[0])
	_paste_toggle.toggled.connect(func(on: bool) -> void: _paste.visible = on)
	row.add_child(_paste_toggle)
	return row


func _paste_box() -> VBoxContainer:
	var box := VBoxContainer.new()
	box.visible = false
	_paste_name = LineEdit.new()
	_paste_name.name = "PasteName"
	_paste_name.placeholder_text = "Deck name"
	box.add_child(_paste_name)
	_paste_text = TextEdit.new()
	_paste_text.name = "PasteText"
	_paste_text.placeholder_text = "Paste a deck list (Arena, MTGO or plain text)"
	_paste_text.custom_minimum_size = Vector2(0, 140)
	box.add_child(_paste_text)
	_paste_add = Hud.button("Add deck")
	_paste_add.name = "PasteAdd"
	_paste_add.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	_paste_add.pressed.connect(_on_paste_add)
	box.add_child(_paste_add)
	return box


func _players_row() -> Control:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	row.add_child(_caption("Players"))
	var group := ButtonGroup.new()
	for n: int in [2, 3, 4]:
		var b := _chip("%d players" % n)
		b.name = "Players_%d" % n
		b.button_group = group
		b.button_pressed = n == 2
		b.toggled.connect(func(on: bool) -> void:
			if on and n != _count:
				_build_seats(n))
		row.add_child(b)
		_count_buttons.append(b)
	return row


func _start_row() -> Control:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 16)
	_message = Hud.text("", 13)
	_message.name = "Message"
	_message.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_message.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	_message.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(_message)
	_start = Hud.primary("Start game", 22)
	_start.name = "Start"
	_start.custom_minimum_size = Vector2(320, 60)
	_start.pressed.connect(_on_start)
	row.add_child(_start)
	return row


func _caption(text: String) -> Label:
	var l := Hud.kicker(text, Hud.MUTED)
	l.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	return l


## A toggle chip (the players count, who plays a seat).
func _chip(text: String) -> Button:
	var b := Button.new()
	b.text = text
	b.toggle_mode = true
	b.set_meta(&"slab", "none")
	b.custom_minimum_size = Vector2(0, 32)
	var neon := NeonTheme.colors()[0]
	var on := StyleBoxFlat.new()
	on.bg_color = Color(neon, 0.22)
	on.set_border_width_all(1)
	on.border_color = neon
	on.set_corner_radius_all(6)
	on.shadow_color = Color(neon, 0.35)
	on.shadow_size = 8
	on.set_content_margin_all(8)
	b.add_theme_stylebox_override("pressed", on)
	b.add_theme_stylebox_override("hover_pressed", on)
	return b


# ---- seats ----------------------------------------------------------------------------------------------------------------------

func _build_seats(count: int) -> void:
	var old: Array[Dictionary] = _rows.duplicate()
	_count = count
	for b: Button in _count_buttons:
		b.set_pressed_no_signal(b.name == "Players_%d" % count)
	for child: Node in _seats.get_children():
		_seats.remove_child(child)
		child.queue_free()
	_rows.clear()
	_seats.columns = 3 if count == 2 else 2
	for i: int in range(count):
		var seat := _seat_panel(i)
		_seats.add_child(seat)
		if count == 2 and i == 0:
			_seats.add_child(_vs_badge())
	for i: int in range(mini(old.size(), _rows.size())):
		(_rows[i]["name"] as LineEdit).text = (old[i]["name"] as LineEdit).text
		if i > 0:
			_set_by(i, bool((old[i]["computer"] as Button).button_pressed))
		(_rows[i]["show"] as OptionButton).select((old[i]["show"] as OptionButton).selected)
		_rows[i]["keep"] = (old[i]["deck"] as OptionButton).get_selected_id()
	_fill_deck_options()
	_first.clear()
	_first.add_item("Random", 0)
	for i: int in range(count):
		_first.add_item("Player %d" % (i + 1), i + 1)
	_first.select(0)
	_update_life()


func _seat_color(i: int) -> Color:
	if i < 2:
		return NeonTheme.colors()[i]
	return EXTRA_SEAT_COLORS[(i - 2) % EXTRA_SEAT_COLORS.size()]


func _seat_panel(i: int) -> Control:
	var tint := _seat_color(i)
	var panel := Hud.panel(16)
	panel.name = "Seat_%d" % (i + 1)
	panel.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var edge := panel.get_theme_stylebox("panel") as StyleBoxFlat
	edge.border_color = Color(tint, 0.7)
	edge.shadow_color = Color(tint, 0.2)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 16)
	panel.add_child(row)
	var form := VBoxContainer.new()
	form.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	form.add_theme_constant_override("separation", 6)
	row.add_child(form)
	var head := HBoxContainer.new()
	head.add_theme_constant_override("separation", 10)
	var badge := Badge.new()
	badge.number = i + 1
	badge.tint = tint
	badge.custom_minimum_size = Vector2(28, 28)
	head.add_child(badge)
	var title := Hud.title("Player %d" % (i + 1), 18)
	title.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	head.add_child(title)
	form.add_child(head)
	form.add_child(_caption("Played by"))
	var by := HBoxContainer.new()
	var group := ButtonGroup.new()
	var person := _chip("You, at this screen" if i == 0 else "A person at this screen (hot-seat)")
	person.name = "Person"
	person.button_group = group
	person.button_pressed = i == 0
	var computer := _chip("The computer")
	computer.name = "Computer"
	computer.button_group = group
	computer.button_pressed = i > 0
	computer.visible = i > 0
	by.add_child(person)
	by.add_child(computer)
	form.add_child(by)
	form.add_child(_caption("Name"))
	var name_edit := LineEdit.new()
	name_edit.max_length = 40
	name_edit.text = Settings.player_names[0] if i == 0 else "Computer %d" % i
	form.add_child(name_edit)
	form.add_child(_caption("Show"))
	var show := OptionButton.new()
	show.fit_to_longest_item = false
	form.add_child(show)
	form.add_child(_caption("Deck"))
	var deck := OptionButton.new()
	deck.fit_to_longest_item = false
	deck.clip_text = true
	deck.custom_minimum_size = Vector2(240, 0)
	form.add_child(deck)
	var legal := Hud.text("", 12)
	form.add_child(legal)
	var box_col := VBoxContainer.new()
	box_col.alignment = BoxContainer.ALIGNMENT_CENTER
	var box := DeckBox.new()
	box.custom_minimum_size = Vector2(170, 200)
	box_col.add_child(box)
	var box_name := Hud.text("No deck chosen", 13, Hud.TEXT)
	box_name.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box_name.custom_minimum_size = Vector2(170, 0)
	box_col.add_child(box_name)
	var box_note := Hud.text("", 11)
	box_note.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box_col.add_child(box_note)
	row.add_child(box_col)
	person.toggled.connect(func(on: bool) -> void:
		if on and i > 0 and name_edit.text.begins_with("Computer"):
			name_edit.text = Settings.player_names[i]
		_refresh_start_label())
	computer.toggled.connect(func(on: bool) -> void:
		if on and (name_edit.text.begins_with("Player") or name_edit.text == Settings.player_names[i]):
			name_edit.text = "Computer %d" % i
		_refresh_start_label())
	show.item_selected.connect(func(_x: int) -> void: _fill_deck_option(i))
	deck.item_selected.connect(func(_x: int) -> void: _on_deck_chosen(i))
	_rows.append({"name": name_edit, "deck": deck, "show": show, "person": person, "computer": computer, "box": box,
		"box_name": box_name, "box_note": box_note, "legal": legal, "keep": -1})
	return panel


func _vs_badge() -> Control:
	var c := CenterContainer.new()
	var vs := Badge.new()
	vs.label = "VS"
	vs.tint = NeonTheme.colors()[1]
	vs.custom_minimum_size = Vector2(48, 48)
	c.add_child(vs)
	return c


## Whether seat `i` is played by the computer.
func is_computer(i: int) -> bool:
	return i > 0 and i < _rows.size() and bool((_rows[i]["computer"] as Button).button_pressed)


## Seat `i` played by the computer (true) or a person at this screen.
func _set_by(i: int, computer: bool) -> void:
	if i <= 0 or i >= _rows.size():
		return
	(_rows[i]["computer" if computer else "person"] as Button).button_pressed = true


func _refresh_start_label() -> void:
	var machines := 0
	for i: int in range(_rows.size()):
		if is_computer(i):
			machines += 1
	if machines == 0 or machines < _rows.size() - 1:
		_start.text = "START GAME"
	else:
		_start.text = "PLAY VS COMPUTER" if machines == 1 else "PLAY VS %d COMPUTERS" % machines


# ---- decks ----------------------------------------------------------------------------------------------------------------------

func _load_decks() -> void:
	_message.text = "Loading the decks…"
	var wanted := Val.text(Nav.args, "deck_id")
	Nav.args = {}
	await _move_local_decks()
	_decks.clear()
	var all: Dictionary = await all_decks()
	if not is_inside_tree():
		return
	_decks.append_array(Val.list(all, "decks"))
	_fill_deck_options()
	_message.text = "" if Val.text(all, "error") == "" else "Your decks could not be read: %s" % Val.text(all, "error")
	if not Nav.pending_setup.is_empty():
		_apply_setup(Nav.pending_setup)
		Nav.pending_setup = {}
	elif wanted != "":
		_choose_for_player_1(wanted)


## Player 1 plays the deck with this id (its format follows, as for any deck player 1 picks).
func _choose_for_player_1(id: String) -> void:
	for d: int in range(_decks.size()):
		if String(_decks[d]["id"]) == id:
			(_rows[0]["show"] as OptionButton).select(0)
			_fill_deck_option(0)
			var option: OptionButton = _rows[0]["deck"]
			option.select(option.get_item_index(d))
			_on_deck_chosen(0)
			return


## Decks pasted here before the library existed (user://decks.json) go into the library once; the file is then renamed.
func _move_local_decks() -> void:
	if not FileAccess.file_exists(LOCAL_DECKS):
		return
	var all_moved := true
	for d: Dictionary in _read_local_decks():
		var deck := DeckModel.empty_deck(String(d["name"]), String(d["format"]), "", String(d["id"]))
		for s: String in DeckModel.SECTIONS:
			deck[s] = Val.list(Val.as_dict(d["deck"]), s)
		var r: Dictionary = await DeckModel.save_deck(deck, null)
		if not bool(r["ok"]) and not bool(r["conflict"]):
			all_moved = false
	if all_moved:
		DirAccess.rename_absolute(ProjectSettings.globalize_path(LOCAL_DECKS), ProjectSettings.globalize_path(LOCAL_DECKS + ".moved"))


## Open with a game's setup (the end screen's Change decks): the same players, decks and options.
func _apply_setup(setup: Dictionary) -> void:
	var seats: Array = Val.list(setup, "seats")
	if seats.size() >= 2:
		_build_seats(seats.size())
	var f := _format_ids.find(Val.text(setup, "format"))
	if f >= 0:
		_format.select(f)
	for i: int in range(mini(seats.size(), _rows.size())):
		var seat := Val.as_dict(seats[i])
		(_rows[i]["name"] as LineEdit).text = Val.text(seat, "name")
		_set_by(i, Val.flag(seat, "computer"))
		(_rows[i]["show"] as OptionButton).select(0)
		_fill_deck_option(i)
		for d: int in range(_decks.size()):
			if String(_decks[d]["id"]) == Val.text(seat, "deck_id"):
				var option: OptionButton = _rows[i]["deck"]
				option.select(option.get_item_index(d))
				_on_deck_chosen(i)
	_life.value = Val.num(setup, "life", _life.value)
	_first.select(clampi(int(Val.num(setup, "first")), 0, _first.item_count - 1))


## Every deck a player can pick, as New game lists them (the online screens too): the built-in ones, then the library's.
## {"decks": Array[Dictionary], "error": String}.
static func all_decks() -> Dictionary:
	var out: Array[Dictionary] = builtin_decks()
	var r: Dictionary = await DeckModel.list_decks()
	for d: Variant in r["decks"]:
		var deck := deck_record(Val.as_dict(d))
		if not deck.is_empty():
			out.append(deck)
	return {"decks": out, "error": "" if bool(r["ok"]) else String(r["error"])}


## The practice decks and the Commander precons (newest first), from data/builtin-decks.json.
static func builtin_decks() -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	var f := FileAccess.open(BUILTIN_DECKS, FileAccess.READ)
	if f == null:
		return out
	var data := Val.as_dict(JSON.parse_string(f.get_as_text()))
	for p: Variant in Val.list(data, "practice"):
		var d := Val.as_dict(p)
		var rec := deck_record(d.merged(Val.dict(d, "deck")))
		rec["kind"] = "builtin"
		rec["note"] = "Practice deck"
		out.append(rec)
	for p: Variant in Val.list(data, "precons"):
		var d := Val.as_dict(p)
		var to_entries := func(rows: Array) -> Array:
			var entries: Array = []
			for row: Variant in rows:
				var pair := Val.as_list(row)
				if pair.size() == 2:
					entries.append({"count": int(pair[0]), "name": String(pair[1])})
			return entries
		var commanders: Array = to_entries.call(Val.list(d, "commander"))
		var names: Array[String] = []
		for c: Variant in commanders:
			names.append(Val.text(Val.as_dict(c), "name"))
		out.append({
			"id": Val.text(d, "id"),
			"name": "%s (%s %s)" % [Val.text(d, "name"), Val.text(d, "set"), Val.text(d, "released").substr(0, 4)],
			"format": "commander",
			"deck": {"main": to_entries.call(Val.list(d, "main")), "sideboard": [], "commander": commanders, "companion": []},
			"kind": "precon",
			"colors": Val.text(d, "colors"),
			"note": "Commander precon · %s" % " and ".join(names),
		})
	return out


## A deck as this screen keeps it, from the browser's Deck record.
static func deck_record(d: Dictionary) -> Dictionary:
	if d.is_empty():
		return {}
	return {
		"id": Val.text(d, "id"),
		"name": Val.text(d, "name", "Deck"),
		"format": Val.text(d, "format", Config.DEFAULT_FORMAT),
		"deck": {
			"main": Val.list(d, "main"),
			"sideboard": Val.list(d, "sideboard"),
			"commander": Val.list(d, "commander"),
			"companion": Val.list(d, "companion"),
		},
		"kind": "yours",
		"note": "Your deck",
	}


func _read_local_decks() -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	if not FileAccess.file_exists(LOCAL_DECKS):
		return out
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(LOCAL_DECKS))
	for d: Variant in Val.as_list(parsed):
		var deck := deck_record(Val.as_dict(d))
		if not deck.is_empty():
			out.append(deck)
	return out


func _on_paste_add() -> void:
	var text := _paste_text.text.strip_edges()
	if text == "":
		_message.text = "Paste a deck list first."
		return
	_paste_add.disabled = true
	_message.text = "Reading the list…"
	var r: Dictionary = await Server.post_json("/api/decks/resolve", {"text": text})
	_paste_add.disabled = false
	if not Val.flag(r, "ok"):
		_message.text = Val.text(r, "error", "The list could not be read.")
		return
	var data := Val.as_dict(r.get("data"))
	var deck: Dictionary = {"main": [], "sideboard": [], "commander": [], "companion": []}
	for c: Variant in Val.list(data, "cards"):
		var card := Val.as_dict(c)
		var section := Val.text(card, "section", "main")
		if deck.has(section):
			var entries: Array = deck[section]
			entries.append({"name": Val.text(card, "name"), "count": int(Val.num(card, "count", 1))})
	var unknown: Array[String] = []
	for u: Variant in Val.list(data, "unknown"):
		unknown.append(Val.text(Val.as_dict(u), "name"))
	if Val.list(deck, "main").is_empty():
		_message.text = "No cards were recognised in that list."
		return
	var deck_name := _paste_name.text.strip_edges()
	var saved := DeckModel.empty_deck(deck_name if deck_name != "" else "Pasted deck", Config.DEFAULT_FORMAT)
	for s: String in DeckModel.SECTIONS:
		saved[s] = deck[s]
	var w: Dictionary = await DeckModel.save_deck(saved, null)
	if not bool(w["ok"]):
		_message.text = "The deck could not be saved: %s" % w["error"]
		return
	var record := deck_record(saved)
	_decks.append(record)
	_fill_deck_options()
	_paste_text.text = ""
	_paste_name.text = ""
	_message.text = "Deck added." if unknown.is_empty() else "Deck added without these unknown cards: %s." % ", ".join(unknown)


func _fill_deck_options() -> void:
	for i: int in range(_rows.size()):
		_fill_show_option(i)
		_fill_deck_option(i)


## The Show list of seat `i` with each category's count.
func _fill_show_option(i: int) -> void:
	var show: OptionButton = _rows[i]["show"]
	var keep := maxi(0, show.selected)
	show.clear()
	for s: Array in SHOW:
		var n := 0
		for d: Dictionary in _decks:
			if String(s[0]) == "all" or String(d.get("kind", "yours")) == String(s[0]):
				n += 1
		show.add_item("%s (%d)" % [s[1], n])
	show.select(mini(keep, show.item_count - 1))


## The Deck list of seat `i`: "Choose a deck…" then the decks its Show picks; an item's id is the deck's index in _decks.
func _fill_deck_option(i: int) -> void:
	var option: OptionButton = _rows[i]["deck"]
	var keep := option.get_selected_id() if option.item_count > 0 else int(_rows[i].get("keep", -1))
	var kind := String(SHOW[maxi(0, (_rows[i]["show"] as OptionButton).selected)][0])
	option.clear()
	option.add_item("Choose a deck…", NO_DECK)
	for d: int in range(_decks.size()):
		if kind == "all" or String(_decks[d].get("kind", "yours")) == kind:
			option.add_item(String(_decks[d]["name"]), d)
	var index := option.get_item_index(keep) if keep >= 0 else -1
	option.select(index if index >= 0 else 0)
	_on_deck_chosen(i)


func _chosen_deck(i: int) -> Dictionary:
	var id := (_rows[i]["deck"] as OptionButton).get_selected_id()
	return _decks[id] if id >= 0 and id < _decks.size() else {}


func _on_deck_chosen(i: int) -> void:
	var d := _chosen_deck(i)
	var box: DeckBox = _rows[i]["box"]
	var box_name: Label = _rows[i]["box_name"]
	var box_note: Label = _rows[i]["box_note"]
	var legal: Label = _rows[i]["legal"]
	if d.is_empty():
		box.colors = ""
		box.empty = true
		box_name.text = "No deck chosen"
		box_note.text = ""
		legal.text = ""
		return
	box.empty = false
	box.pop()
	box.colors = _deck_colors(d)
	box_name.text = String(d["name"])
	box_note.text = "%s · %d cards" % [String(d.get("note", "")), _deck_size(Val.dict(d, "deck"))]
	# The format follows player 1's deck (NewGameScreen.tsx) until it is changed by hand.
	if i == 0:
		var f := _format_ids.find(Config.offered_format(String(d.get("format", ""))))
		if f >= 0 and f != _format.selected:
			_format.select(f)
			_update_life()
	_refresh_legal()


func _refresh_legal() -> void:
	for i: int in range(_rows.size()):
		var d := _chosen_deck(i)
		var legal: Label = _rows[i]["legal"]
		if d.is_empty():
			legal.text = ""
			continue
		var why := Config.unplayable_reason(Val.dict(d, "deck"), _selected_format())
		legal.text = "Ready to play in this format." if why == "" else why
		legal.add_theme_color_override("font_color", Hud.MUTED if why == "" else Color(1.0, 0.55, 0.45))


static func _deck_size(deck: Dictionary) -> int:
	var n := 0
	for section: String in ["commander", "main"]:
		for e: Variant in Val.list(deck, section):
			n += int(Val.num(Val.as_dict(e), "count", 1))
	return n


## The deck's colours for its box: a precon's own, else from its basic lands.
static func _deck_colors(d: Dictionary) -> String:
	if String(d.get("colors", "")) != "":
		return String(d["colors"])
	var counts: Dictionary = {}
	for e: Variant in Val.list(Val.dict(d, "deck"), "main"):
		var entry := Val.as_dict(e)
		var c := String(BASIC_COLORS.get(Val.text(entry, "name"), ""))
		if c != "":
			counts[c] = int(counts.get(c, 0)) + int(Val.num(entry, "count", 1))
	var out := ""
	for c: String in ["W", "U", "B", "R", "G"]:
		if counts.has(c):
			out += c
	return out


func _selected_format() -> String:
	var i := _format.selected
	return _format_ids[i] if i >= 0 and i < _format_ids.size() else Config.DEFAULT_FORMAT


func _on_format_changed() -> void:
	_update_life()
	_refresh_legal()


func _update_life() -> void:
	_life.value = Config.starting_life_for(_selected_format(), _rows.size())


# ---- start ----------------------------------------------------------------------------------------------------------------------

func _on_start() -> void:
	if _starting:
		return
	var format := _selected_format()
	var problem := Config.format_problem(format, _rows.size())
	if problem != "":
		_message.text = problem
		return
	var players: Array = []
	var humans: Array = []
	var machines: Array = []
	for i: int in range(_rows.size()):
		var row: Dictionary = _rows[i]
		var player_name := Config.player_name((row["name"] as LineEdit).text)
		if player_name == "":
			_message.text = "Every player needs a name."
			return
		var chosen := _chosen_deck(i)
		if chosen.is_empty():
			_message.text = "Choose a deck for each player."
			return
		var deck: Dictionary = chosen["deck"]
		var why := Config.unplayable_reason(deck, format)
		if why != "":
			_message.text = "%s: %s" % [player_name, why]
			return
		players.append({"name": player_name, "deck": deck})
		if is_computer(i):
			machines.append(Config.PLAYER_IDS[i])
		else:
			humans.append(Config.PLAYER_IDS[i])
	# The people's names become the ones this screen starts with next time (Settings, Player names); a computer's never.
	for i: int in range(_rows.size()):
		var typed := Config.player_name((_rows[i]["name"] as LineEdit).text)
		if not is_computer(i) and typed != Settings.player_names[i]:
			Settings.set_player_name(i, typed)
	var seats_setup: Array = []
	for i: int in range(_rows.size()):
		var chosen_deck := _chosen_deck(i)
		seats_setup.append({"name": (_rows[i]["name"] as LineEdit).text, "computer": is_computer(i),
			"deck_id": String(chosen_deck.get("id", "")), "deck_name": String(chosen_deck.get("name", ""))})
	Nav.last_setup = {"format": format, "life": _life.value, "first": _first.selected, "seats": seats_setup}
	_starting = true
	_start.disabled = true
	_message.text = "Loading the cards…"
	var r: Dictionary = await Server.post_json("/api/cards/defs", {"names": Config.deck_card_names(players)})
	if not Val.flag(r, "ok"):
		_stop_starting(Val.text(r, "error", "The cards could not be loaded."))
		return
	var data := Val.as_dict(r.get("data"))
	# Only main-deck cards, commanders and companions stop the start; a sideboard card that can't be loaded stays out.
	var needed: Array[String] = Config.main_card_names(players)
	for p: Dictionary in players:
		var c := Config.companion_of(p)
		if c != "":
			needed.append(c)
	var failures: Array[String] = []
	for f: Variant in Val.list(data, "failed"):
		var fd := Val.as_dict(f)
		if needed.has(Val.text(fd, "name")):
			failures.append("%s (%s)" % [Val.text(fd, "name"), Val.text(fd, "reason")])
	if not failures.is_empty():
		_stop_starting("These cards could not be loaded: %s." % "; ".join(failures))
		return
	var first_id := _first.get_selected_id()
	var first_player: Variant = "random"
	if first_id > 0:
		first_player = first_id - 1
	var start := {"startingLife": int(_life.value), "firstPlayer": first_player}
	var built := Config.build_game_config({
		"players": players,
		"defs": Val.dict(data, "defs"),
		"seed": Config.new_seed(),
		"start": start,
		"stops": Settings.stop_settings(),
		"commander": Config.commander_variant_of(format),
	})
	if not Val.flag(built, "ok"):
		_stop_starting(Val.text(built, "error"))
		return
	_message.text = "Starting the game…"
	GameClient.table_opened.connect(_on_table_opened, CONNECT_ONE_SHOT)
	GameClient.start("computer" if not machines.is_empty() else "hotseat", Val.dict(built, "config"), humans, machines, Config.new_seed(), format)
	await get_tree().create_timer(START_TIMEOUT_S).timeout
	if _starting and is_inside_tree():
		if GameClient.table_opened.is_connected(_on_table_opened):
			GameClient.table_opened.disconnect(_on_table_opened)
		_stop_starting("The game server did not open the table. It may be a version without the table channel.")


func _stop_starting(message: String) -> void:
	_starting = false
	_start.disabled = false
	_message.text = message


func _on_table_opened(_table: String) -> void:
	_starting = false
	Nav.clear()
	Nav.go("table")


## A round badge: the player's number, or "VS", in a glowing ring of its colour.
class Badge:
	extends Control

	var number: int = 0
	var label: String = ""
	var tint: Color = Color.WHITE

	func _draw() -> void:
		var c := size / 2.0
		var r := minf(size.x, size.y) / 2.0 - 2.0
		draw_circle(c, r + 4.0, Color(tint, 0.18))
		draw_circle(c, r, Color(0.02, 0.03, 0.08, 0.95))
		draw_arc(c, r, 0.0, TAU, 40, tint, 2.0, true)
		var text := label if label != "" else str(number)
		var font := Hud.bold_font()
		var font_size := int(r * 0.95)
		var w := font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, font_size).x
		draw_string(font, c + Vector2(-w / 2.0, font_size * 0.36), text, HORIZONTAL_ALIGNMENT_LEFT, -1, font_size, Color.WHITE)
