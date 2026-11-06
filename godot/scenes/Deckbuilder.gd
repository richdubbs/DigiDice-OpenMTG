extends Control
## The deckbuilder and Deck Details (packages/client/src/decks/DeckbuilderScreen.tsx, SearchPanel.tsx, AdvancedSearch.tsx,
## DeckSectionList.tsx, ValidationPanel.tsx, DeckDetails.tsx, StatsPanel.tsx), one screen with two views.
##
## Build: the card pool on the left (a search box that also takes Scryfall syntax, the six colour toggles, Filters and Advanced
## search, live results 50 to a page, a card's picture adds it to the main deck), the deck on the right (name, size, format, the
## format check, the sections with their cards, notes, Done). Details: the deck's stats on the left (curve, colours, lands), the
## large box in the middle with Edit deck, Export and the format check, its card types on the right.
##
## Every change is saved at once to the server's library, naming the version it replaces: a deck changed elsewhere meanwhile is
## not overwritten (a banner offers to reload it). The format check runs 300 ms after the cards or the format change.

const SEARCH_DELAY_S: float = 0.32
const CHECK_DELAY_S: float = 0.3
const PREVIEW_DELAY_S: float = 0.25
const RESULT_W: float = 132.0
const SCRY_KEYWORDS: Array[String] = ["name", "c", "color", "colors", "id", "identity", "ci", "commander", "t", "type", "o", "oracle", "fo",
	"fulloracle", "kw", "keyword", "m", "mana", "mv", "cmc", "manavalue", "pow", "power", "tou", "toughness", "pt", "powtou", "loy",
	"loyalty", "def", "defense", "f", "format", "legal", "banned", "restricted", "is", "not", "has", "layout", "produces", "devotion",
	"s", "set", "e", "edition", "st", "b", "block", "r", "rarity", "a", "artist", "ft", "flavor", "wm", "watermark", "cn", "number",
	"stamp", "frame", "border", "lang", "language", "year", "date", "in", "new", "game", "prints", "sets", "paperprints", "papersets",
	"cheapest", "usd", "eur", "tix", "function", "oracletag", "otag", "art", "arttag", "atag", "order", "direction", "unique",
	"prefer", "display", "include"]
const COLOR_LETTERS: Array[String] = ["W", "U", "B", "R", "G", "C"]
const COMPARE_COLORS: Array = [[":", "including / within"], ["=", "exactly"], [">=", "at least"], ["<=", "at most"], [">", "more than"],
	["<", "fewer than"]]
const COMPARE_NUMBERS: Array = [["=", "equals"], [">=", "at least"], ["<=", "at most"], [">", "more than"], ["<", "less than"],
	["!=", "not"]]
const ADV_FORMATS: Array[String] = ["standard", "pioneer", "modern", "legacy", "vintage", "commander", "pauper", "brawl", "historic",
	"timeless", "oathbreaker"]
const ADV_PROPERTIES: Array[String] = ["commander", "permanent", "spell", "historic", "vanilla", "frenchvanilla", "split", "transform",
	"mdfc", "dfc", "adventure", "hybrid"]
const CHEAT_SHEET: Array = [
	["t:creature c:g mv<=3", "Cheap green creatures (words are ANDed)"],
	["o:\"draw a card\" -t:creature", "Rules text containing a phrase, minus creatures (- negates)"],
	["o:\"~ deals\" (c:r or c:u)", "~ is the card's own name; ( ) group and \"or\" alternates"],
	["id<=esper", "Color identity within a set of colors (names, guilds, shards, letters)"],
	["c=rg", "Exactly red and green (= >= <= > < != compare color sets)"],
	["c:c", "Colorless (c:m is multicolor)"],
	["m:{2}{R}{R}", "Mana cost containing these symbols (m={1}{G} for exactly)"],
	["mv:even pow>=4", "Mana value even / odd, or compared with a number"],
	["pow>tou", "One stat against another (pow, tou, mv, loy, def)"],
	["kw:flying t:angel", "A keyword the card has, with a type"],
	["f:modern -banned:legacy", "Legal in a format (f:, banned:, restricted:)"],
	["s:dmu t:creature", "Printed in a set: its code or name (s:, set:, e:, edition:)"],
	["is:commander id<=wb", "Can be a commander (also is:permanent, is:spell, is:historic, is:vanilla, is:mdfc ...)"],
	["produces:g", "Mana a card can make"],
	["!\"Lightning Bolt\"", "The exact card name"],
	["name:/^jace/ or t:/saga/", "/regex/ for names, rules text (o:), and types (t:)"],
]
const BAD: Color = Color("#ffa6ff")
const ERROR_TEXT: Color = Color("#ff9bff")

# ---- the deck and its saving
var _id: String = ""
var _deck: Dictionary = {}
## The stored version the next save replaces (its updatedAt), null for a deck not saved yet.
var _revision: Variant = null
var _saving: bool = false
var _dirty: bool = false
var _conflict: bool = false
var _save_error: String = ""
signal _saves_done()

# ---- card data
## name -> CardSummary ({} when the card is unknown); name -> "unknown" | "unavailable" for failed look-ups.
var _cards: Dictionary = {}
var _failed: Dictionary = {}
var _details: Dictionary = {}
var _looking_up: bool = false
## The picture key of the cover while it is on its way.
var _cover_key: String = ""

# ---- search
var _search_seq: int = 0
var _searched_once: bool = false
var _search_timer: Timer = null
var _page: int = 1
var _pages: int = 1
var _last_query: Dictionary = {}
var _search_failed: bool = false
var _identity_override: Variant = null
## The identity the last search used.
var _searched_identity: String = ""
var _colors_on: Dictionary = {}

# ---- format check
var _check_timer: Timer = null
var _check_seq: int = 0
var _check: Dictionary = {}
var _check_prev: Dictionary = {}
var _check_state: String = "idle"
var _check_error: String = ""
var _verdict: String = ""
var _check_failed_sound: bool = false

# ---- view
var _view: String = "build"
var _title: Label = null
var _view_buttons: Dictionary = {}
var _export_button: Button = null
var _banner: PanelContainer = null
var _build: Control = null
var _details_view: Control = null

# ---- build parts
var _search_box: LineEdit = null
var _clear_search: Button = null
var _color_toggles: Dictionary = {}
var _filters_button: Button = null
var _advanced_button: Button = null
var _filters: PanelContainer = null
var _advanced: PanelContainer = null
var _status: Label = null
var _sweep: Sweep = null
var _results_scroll: ScrollContainer = null
var _results: GridContainer = null
var _pager: HBoxContainer = null
var _page_label: Label = null
var _prev: Button = null
var _next: Button = null
var _types: LineEdit = null
var _keywords: LineEdit = null
var _mv: LineEdit = null
var _pow: LineEdit = null
var _tou: LineEdit = null
var _legal: CheckBox = null
var _automation: OptionButton = null
var _identity_toggles: Dictionary = {}
var _identity_hint: Label = null
var _adv_query: LineEdit = null
var _adv_error: Label = null
var _adv_fields: Dictionary = {}
var _adv_adds: Label = null
var _adv_add: Button = null
var _adv_clear: Button = null
var _adv_scroll: ScrollContainer = null
var _adv_box: VBoxContainer = null
var _sets: Array = []
var _sets_loading: bool = false

# ---- deck panel parts
var _small_box: DeckBox = null
var _name_field: LineEdit = null
var _name_error: Label = null
var _counter: Label = null
var _format_select: OptionButton = null
var _check_box: VBoxContainer = null
var _partner_hint: Label = null
var _sections: VBoxContainer = null
var _notes: TextEdit = null
var _play: Button = null

# ---- details parts
var _detail_name: LineEdit = null
var _detail_format: OptionButton = null
var _stats_box: VBoxContainer = null
var _big_box: DeckBox = null
var _detail_title: Label = null
var _detail_count: Label = null
var _detail_check: VBoxContainer = null
var _types_box: VBoxContainer = null

# ---- previews
var _floating: CardPreview = null
var _hover_name: String = ""
var _hover_rect: Rect2 = Rect2()
var _hover_seq: int = 0


func _ready() -> void:
	_id = Val.text(Nav.args, "id")
	_view = Val.text(Nav.args, "view", "build")
	Nav.args = {}
	TopBar.attach(self)
	_search_timer = _timer(_run_search)
	_check_timer = _timer(_run_check)
	Pictures.picture_ready.connect(_on_picture)
	var root := VBoxContainer.new()
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.offset_top = TopBar.HEIGHT + 10
	root.offset_left = 20
	root.offset_right = -20
	root.offset_bottom = -14
	root.add_theme_constant_override("separation", 10)
	add_child(root)
	root.add_child(_header())
	_banner = PanelContainer.new()
	_banner.visible = false
	root.add_child(_banner)
	var body := Control.new()
	body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	root.add_child(body)
	_status_only(body, "Deck: %s (loading…)" % _id)
	_load_deck(body)


func _timer(callback: Callable) -> Timer:
	var t := Timer.new()
	t.one_shot = true
	t.timeout.connect(callback)
	add_child(t)
	return t


func _status_only(body: Control, text: String) -> void:
	for c: Node in body.get_children():
		c.queue_free()
	var l := Hud.text(text, 15, Hud.TEXT)
	body.add_child(l)


func _load_deck(body: Control) -> void:
	var r: Dictionary = await DeckModel.get_deck(_id)
	if not is_inside_tree():
		return
	if not bool(r["ok"]):
		_status_only(body, ("Deck: %s was not found in your deck library." % _id) if bool(r["missing"]) else
			("Deck: %s could not be opened: %s" % [_id, r["error"]]))
		Sound.cue("ui.error")
		return
	_deck = r["deck"]
	_revision = Val.text(_deck, "updatedAt")
	for c: Node in body.get_children():
		c.queue_free()
	_build = _build_view()
	_build.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	body.add_child(_build)
	_details_view = _details_layout()
	_details_view.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	body.add_child(_details_view)
	_set_view(_view, false)
	_refresh_deck()
	_schedule_check(true)
	_look_up_deck_cards()
	_schedule_search(true)


# ---- header and view -------------------------------------------------------------------------------------------------------------

func _header() -> Control:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 14)
	var back := Hud.button("‹")
	back.tooltip_text = "Back"
	back.custom_minimum_size = Vector2(44, 44)
	back.pressed.connect(Nav.back)
	row.add_child(back)
	_title = Hud.title("Deckbuilder", 28)
	_title.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(_title)
	var segment := HBoxContainer.new()
	segment.add_theme_constant_override("separation", 0)
	for v: Array in [["build", "Build"], ["details", "Details"]]:
		var b := Button.new()
		b.text = String(v[1])
		b.toggle_mode = true
		b.custom_minimum_size = Vector2(96, 38)
		b.set_meta(&"sfx", "ui.click")
		var view := String(v[0])
		b.pressed.connect(func() -> void: _set_view(view, true))
		segment.add_child(b)
		_view_buttons[view] = b
	row.add_child(segment)
	_export_button = Hud.button("Export")
	_export_button.custom_minimum_size = Vector2(100, 38)
	_export_button.pressed.connect(_open_export)
	row.add_child(_export_button)
	return row


func _set_view(view: String, sound: bool) -> void:
	_view = view
	if _build == null:
		return
	_build.visible = view == "build"
	_details_view.visible = view == "details"
	_title.text = "DECKBUILDER" if view == "build" else "DECK DETAILS"
	_export_button.visible = view == "build"
	for v: String in _view_buttons:
		var b: Button = _view_buttons[v]
		b.set_pressed_no_signal(v == view)
	if view == "details":
		_refresh_details()
	if sound:
		pass


func _open_export() -> void:
	var m := Modal.open(self, "", true)
	m.body.add_child(ExportPanel.make(_deck, m))


func _show_banner() -> void:
	for c: Node in _banner.get_children():
		c.queue_free()
	var s := StyleBoxFlat.new()
	s.bg_color = Color(NeonTheme.colors()[1], 0.12)
	s.border_color = NeonTheme.colors()[1]
	s.border_width_left = 3
	s.set_corner_radius_all(6)
	s.set_content_margin_all(10)
	_banner.add_theme_stylebox_override("panel", s)
	_banner.visible = _conflict or _save_error != ""
	if _conflict:
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 10)
		var text := Hud.text("This deck was changed somewhere else, so your latest changes were not saved.", 14, Hud.TEXT)
		text.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(text)
		var reload := Hud.button("Reload the deck")
		reload.pressed.connect(_reload_deck)
		row.add_child(reload)
		_banner.add_child(row)
	elif _save_error != "":
		_banner.add_child(Hud.text("Could not save the deck: %s" % _save_error, 14, Hud.TEXT))


# ---- changes and saving ----------------------------------------------------------------------------------------------------------

## Apply `change` (deck -> deck; the same deck back means nothing changed), show it and save it.
func _change(change: Callable) -> bool:
	var next: Dictionary = change.call(_deck)
	if is_same(next, _deck):
		return false
	next = next.duplicate()
	next["updatedAt"] = DeckModel.now_iso()
	var cards_changed := false
	for s: String in DeckModel.SECTIONS:
		if Val.list(next, s) != Val.list(_deck, s):
			cards_changed = true
	var format_changed := Val.text(next, "format") != Val.text(_deck, "format")
	var cover_changed := Val.text(next, "cover") != Val.text(_deck, "cover")
	_deck = next
	if cards_changed or format_changed or cover_changed:
		_refresh_deck()
	else:
		_refresh_names()
	if cards_changed or format_changed:
		_schedule_check(false)
		_look_up_deck_cards()
	if format_changed:
		_schedule_search(false)
	_save()
	return true


func _save() -> void:
	if _saving:
		_dirty = true
		return
	_saving = true
	while true:
		_dirty = false
		var snapshot := _deck
		var r: Dictionary = await DeckModel.save_deck(snapshot, _revision)
		if not is_inside_tree():
			return
		if bool(r["ok"]):
			_revision = Val.text(snapshot, "updatedAt")
			_save_error = ""
		elif bool(r["conflict"]):
			_conflict = true
			Sound.cue("ui.error")
		else:
			_save_error = String(r["error"])
			Sound.cue("ui.error")
		_show_banner()
		if not _dirty:
			break
	_saving = false
	_saves_done.emit()


func _wait_for_saves() -> void:
	while _saving:
		await _saves_done


func _reload_deck() -> void:
	await _wait_for_saves()
	var r: Dictionary = await DeckModel.get_deck(_id)
	if not is_inside_tree():
		return
	if not bool(r["ok"]):
		Sound.cue("ui.error")
		_conflict = false
		_save_error = "This deck was deleted somewhere else. Export it to keep a copy."
		_show_banner()
		return
	_deck = r["deck"]
	_revision = Val.text(_deck, "updatedAt")
	_conflict = false
	_save_error = ""
	_show_banner()
	_refresh_deck()
	_schedule_check(false)
	_look_up_deck_cards()


func _add(section: String, card: Dictionary, delta: int) -> void:
	var card_name := Val.text(card, "name")
	if _change(func(d: Dictionary) -> Dictionary: return DeckModel.add_card(d, section, card_name, Val.text(card, "oracleId"), delta)):
		UiSounds.claim()
		Sound.cue("deck.add" if delta > 0 else "deck.remove")


## A search result into a section: main and sideboard take any number; a commander is added once (several different ones may
## be); the companion replaces the one there.
func _add_from_search(section: String, card: Dictionary) -> void:
	var card_name := Val.text(card, "name")
	if section == "commander" and DeckModel.count_of(_deck, "commander", card_name) > 0:
		return
	if section == "companion":
		if DeckModel.count_of(_deck, "companion", card_name) > 0:
			return
		if _change(func(d: Dictionary) -> Dictionary:
			var next := d.duplicate()
			var entry := {"name": card_name, "count": 1}
			if Val.text(card, "oracleId") != "":
				entry["oracleId"] = Val.text(card, "oracleId")
			next["companion"] = [entry]
			return next):
			UiSounds.claim()
			Sound.cue("deck.add")
		return
	_add(section, card, 1)


func _move(from: String, to: String, card_name: String) -> void:
	_change(func(d: Dictionary) -> Dictionary: return DeckModel.move_card(d, from, to, card_name))


# ---- card data ---------------------------------------------------------------------------------------------------------------------

func _look_up_deck_cards() -> void:
	if _looking_up:
		return
	_looking_up = true
	var names := DeckModel.playing_names(_deck)
	for s: String in ["sideboard", "companion"]:
		for e: Variant in Val.list(_deck, s):
			var n := Val.text(Val.as_dict(e), "name")
			if not names.has(n):
				names.append(n)
	if Val.text(_deck, "cover") != "":
		names.append(Val.text(_deck, "cover"))
	var any := false
	for n: String in names:
		if _cards.has(n) or _failed.has(n):
			continue
		var r: Dictionary = await Server.get_json("/api/cards/%s%s" % [n.uri_encode(), "?images=1" if Settings.scryfall_images else ""])
		if not is_inside_tree():
			return
		if bool(r["ok"]):
			_cards[n] = Val.dict(Val.as_dict(r["data"]), "card")
			_details[n] = Val.as_dict(r["data"])
		else:
			_failed[n] = "unknown" if int(r["status"]) == 404 else "unavailable"
		any = true
	_looking_up = false
	if any:
		_refresh_deck()


# ---- refreshing what the deck shows ------------------------------------------------------------------------------------------------

func _refresh_deck() -> void:
	if _build == null:
		return
	var format := Val.text(_deck, "format")
	if _name_field != null and not _name_field.has_focus():
		_name_field.text = Val.text(_deck, "name")
	if _detail_name != null and not _detail_name.has_focus():
		_detail_name.text = Val.text(_deck, "name")
	_fill_format(_format_select, format)
	_fill_format(_detail_format, format)
	var colors := DeckModel.deck_colors(_deck, _cards)
	var cover_tex := _cover_texture()
	for b: DeckBox in [_small_box, _big_box]:
		b.colors = colors
		b.cover = cover_tex
	_counter.text = _count_text()
	_counter.tooltip_text = "%d cards and %d commander(s) (CR 903.5a)" % [DeckModel.section_count(_deck, "main"),
		DeckModel.section_count(_deck, "commander")] if DeckModel.is_commander_format(format) else ""
	if _notes != null and not _notes.has_focus():
		_notes.text = Val.text(_deck, "notes")
	_play.visible = DeckModel.is_commander_format(format) and not Nav.in_game()
	_refresh_sections()
	_refresh_check()
	_refresh_identity()
	_refresh_result_counts()
	if _view == "details":
		_refresh_details()


## A rename or a note: only the names shown elsewhere change.
func _refresh_names() -> void:
	if _name_field != null and not _name_field.has_focus():
		_name_field.text = Val.text(_deck, "name")
	if _detail_name != null and not _detail_name.has_focus():
		_detail_name.text = Val.text(_deck, "name")
	if _detail_title != null:
		_detail_title.text = DeckModel.shown_name(_deck)


func _cover_texture() -> Texture2D:
	var cover := Val.text(_deck, "cover")
	if cover == "" or not _cards.has(cover):
		return null
	var card: Dictionary = _cards[cover]
	var t := Pictures.texture_for(card, 0)
	_cover_key = Pictures.key_for(card, 0) if t == null else ""
	return t


## The cover's picture arrived: the boxes show it.
func _on_picture(key: String, _texture: Texture2D) -> void:
	if key != "" and key == _cover_key:
		_cover_key = ""
		_refresh_deck()


func _count_text() -> String:
	var format := Val.text(_deck, "format")
	var size_n := DeckModel.deck_size(format)
	var main := DeckModel.section_count(_deck, "main")
	var commanders := DeckModel.section_count(_deck, "commander")
	if DeckModel.is_commander_format(format):
		return "%d + %d/%d Cards" % [main, commanders, size_n]
	return "%d/%d Cards" % [main + commanders, size_n]


func _fill_format(select: OptionButton, format: String) -> void:
	if select == null:
		return
	select.clear()
	var at := -1
	for f: Dictionary in Config.FORMAT_OPTIONS:
		select.add_item(String(f["name"]))
		select.set_item_metadata(select.item_count - 1, String(f["id"]))
		if String(f["id"]) == format:
			at = select.item_count - 1
	if at < 0:
		select.add_item(format)
		select.set_item_metadata(select.item_count - 1, format)
		at = select.item_count - 1
	select.select(at)
	select.tooltip_text = DeckModel.format_name(format)


func _on_format_selected(select: OptionButton) -> void:
	var format := String(select.get_item_metadata(select.selected))
	_change(func(d: Dictionary) -> Dictionary:
		if Val.text(d, "format") == format:
			return d
		var next := d.duplicate()
		next["format"] = format
		return next)


func _on_name_typed(text: String, error_label: Label) -> void:
	if error_label != null:
		error_label.visible = text.strip_edges() == ""
	if text.strip_edges() == "":
		return
	_change(func(d: Dictionary) -> Dictionary:
		if Val.text(d, "name") == text:
			return d
		var next := d.duplicate()
		next["name"] = text
		return next)


# ---- Build: the card pool -------------------------------------------------------------------------------------------------------------

func _build_view() -> Control:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 20)
	var pool := VBoxContainer.new()
	pool.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	pool.add_theme_constant_override("separation", 8)
	row.add_child(pool)
	pool.add_child(_search_bar())
	var status_row := VBoxContainer.new()
	status_row.add_theme_constant_override("separation", 2)
	_status = Hud.text("", 13)
	_status.custom_minimum_size = Vector2(0, 26)
	status_row.add_child(_status)
	_sweep = Sweep.new()
	_sweep.custom_minimum_size = Vector2(0, 2)
	status_row.add_child(_sweep)
	pool.add_child(status_row)
	_results_scroll = ScrollContainer.new()
	_results_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_results_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_results_scroll.resized.connect(_layout_results)
	pool.add_child(_results_scroll)
	_results = GridContainer.new()
	_results.add_theme_constant_override("h_separation", 12)
	_results.add_theme_constant_override("v_separation", 18)
	_results.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_results_scroll.add_child(_results)
	_pager = HBoxContainer.new()
	_pager.alignment = BoxContainer.ALIGNMENT_CENTER
	_pager.add_theme_constant_override("separation", 12)
	_pager.visible = false
	_prev = Hud.button("Previous")
	_prev.pressed.connect(func() -> void: _go_page(_page - 1))
	_pager.add_child(_prev)
	_page_label = Label.new()
	_pager.add_child(_page_label)
	_next = Hud.button("Next")
	_next.pressed.connect(func() -> void: _go_page(_page + 1))
	_pager.add_child(_next)
	pool.add_child(_pager)
	var panel := _deck_panel()
	panel.custom_minimum_size = Vector2(clampf(get_viewport_rect().size.x * 0.28, 318.0, 400.0), 0)
	row.add_child(panel)
	_filters = _filters_drawer()
	_advanced = _advanced_drawer()
	for d: PanelContainer in [_filters, _advanced]:
		d.visible = false
		d.z_index = 20
		add_child(d)
	return row


func _layout_results() -> void:
	var w := _results_scroll.size.x - 14.0
	_results.columns = maxi(1, int((w + 12.0) / (RESULT_W + 12.0)))


func _search_bar() -> Control:
	var bar := HFlowContainer.new()
	bar.name = "SearchBar"
	bar.add_theme_constant_override("h_separation", 10)
	bar.add_theme_constant_override("v_separation", 8)
	var box := HBoxContainer.new()
	box.custom_minimum_size = Vector2(320, 0)
	box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_search_box = LineEdit.new()
	_search_box.placeholder_text = "Search cards, or t:creature s:dmu mv<=3"
	_search_box.tooltip_text = "A name or rules text, or Scryfall syntax: t:creature o:draw s:dmu mv<=3 (see Advanced search)"
	_search_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_search_box.custom_minimum_size = Vector2(0, 40)
	_search_box.text_changed.connect(func(_t: String) -> void:
		_clear_search.visible = _search_box.text != ""
		_schedule_search(false))
	_search_box.text_submitted.connect(func(_t: String) -> void: _run_search_now())
	_search_box.gui_input.connect(func(e: InputEvent) -> void:
		if e.is_action_pressed("ui_cancel") and (_filters.visible or _advanced.visible):
			_close_drawers()
			_search_box.accept_event())
	box.add_child(_search_box)
	_clear_search = Hud.button("✕")
	_clear_search.tooltip_text = "Clear search"
	_clear_search.set_meta(&"sfx", "ui.cancel")
	_clear_search.visible = false
	_clear_search.custom_minimum_size = Vector2(32, 32)
	_clear_search.pressed.connect(func() -> void:
		_search_box.text = ""
		_clear_search.visible = false
		_schedule_search(false))
	box.add_child(_clear_search)
	bar.add_child(box)
	var toggles := HBoxContainer.new()
	toggles.add_theme_constant_override("separation", 6)
	for c: String in COLOR_LETTERS:
		var t := ColorToggle.new()
		t.letter = c
		t.tooltip_text = DeckModel.COLOR_NAMES[c]
		t.toggled.connect(func(on: bool) -> void:
			if on:
				_colors_on[c] = true
			else:
				_colors_on.erase(c)
			_schedule_search(false))
		toggles.add_child(t)
		_color_toggles[c] = t
	bar.add_child(toggles)
	_filters_button = Hud.button("Filters")
	_filters_button.pressed.connect(func() -> void: _toggle_drawer(_filters))
	bar.add_child(_filters_button)
	_advanced_button = Hud.button("Advanced search")
	_advanced_button.pressed.connect(func() -> void: _toggle_drawer(_advanced))
	bar.add_child(_advanced_button)
	var go := Hud.primary("Search", 15)
	go.custom_minimum_size = Vector2(110, 40)
	go.pressed.connect(_run_search_now)
	bar.add_child(go)
	return bar


func _toggle_drawer(drawer: PanelContainer) -> void:
	var open := not drawer.visible
	_close_drawers()
	drawer.visible = open
	if open:
		_place_drawer(drawer)


func _close_drawers() -> void:
	_filters.visible = false
	_advanced.visible = false


func _place_drawer(drawer: PanelContainer) -> void:
	var bar := _build.find_child("SearchBar", true, false) as Control
	if bar == null:
		return
	var r := bar.get_global_rect()
	drawer.position = Vector2(r.position.x, r.end.y + 8.0) - get_global_rect().position
	drawer.custom_minimum_size.x = r.size.x
	if drawer == _advanced:
		# As tall as its content, at most min(78 % of the window, 640 px); it scrolls beyond.
		_adv_scroll.custom_minimum_size.y = minf(_adv_box.get_combined_minimum_size().y, minf(get_viewport_rect().size.y * 0.78, 640.0) - 28.0)
	drawer.size = Vector2(r.size.x, 0)


func _process(_delta: float) -> void:
	for d: PanelContainer in [_filters, _advanced]:
		if d != null and d.visible:
			_place_drawer(d)
	if _floating != null and is_instance_valid(_floating):
		_place_floating()


func _drawer_panel() -> Array:
	var panel := PanelContainer.new()
	var s := StyleBoxFlat.new()
	s.bg_color = Color(0.02, 0.04, 0.09, 0.98)
	s.border_color = Color(NeonTheme.colors()[0], 0.8)
	s.set_border_width_all(1)
	s.set_corner_radius_all(12)
	s.set_content_margin_all(14)
	s.shadow_color = Color(0, 0, 0, 0.6)
	s.shadow_size = 16
	panel.add_theme_stylebox_override("panel", s)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 10)
	panel.add_child(box)
	return [panel, box]


func _field(placeholder: String, width: float = 0.0) -> LineEdit:
	var e := LineEdit.new()
	e.placeholder_text = placeholder
	e.tooltip_text = placeholder
	if width > 0.0:
		e.custom_minimum_size = Vector2(width, 0)
	else:
		e.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return e


func _filters_drawer() -> PanelContainer:
	var parts := _drawer_panel()
	var box: VBoxContainer = parts[1]
	box.add_child(Hud.kicker("Color identity", Hud.MUTED))
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 6)
	for c: String in COLOR_LETTERS:
		var t := ColorToggle.new()
		t.letter = c
		t.tooltip_text = "Identity %s" % DeckModel.COLOR_NAMES[c]
		t.toggled.connect(func(_on: bool) -> void:
			var letters := ""
			for l: String in COLOR_LETTERS:
				if (_identity_toggles[l] as ColorToggle).button_pressed:
					letters += l
			_identity_override = letters
			_refresh_identity()
			_refresh_filter_badge()
			_schedule_search(false))
		row.add_child(t)
		_identity_toggles[c] = t
	box.add_child(row)
	_identity_hint = Hud.text("Showing cards within your commander's color identity.", 12)
	box.add_child(_identity_hint)
	var r1 := HBoxContainer.new()
	r1.add_theme_constant_override("separation", 8)
	_types = _field("Types: creature, elf")
	_keywords = _field("Keywords: flying, lifelink")
	r1.add_child(_types)
	r1.add_child(_keywords)
	box.add_child(r1)
	var r2 := HBoxContainer.new()
	r2.add_theme_constant_override("separation", 8)
	_mv = _field("Mana value: 3, <=2", 170.0)
	_pow = _field("Power: >=3", 130.0)
	_tou = _field("Toughness", 130.0)
	for e: LineEdit in [_mv, _pow, _tou]:
		r2.add_child(e)
	box.add_child(r2)
	for e: LineEdit in [_types, _keywords, _mv, _pow, _tou]:
		e.text_changed.connect(func(_t: String) -> void:
			_refresh_filter_badge()
			_schedule_search(false))
	var r3 := HBoxContainer.new()
	r3.add_theme_constant_override("separation", 14)
	_legal = CheckBox.new()
	_legal.button_pressed = true
	_legal.toggled.connect(func(_on: bool) -> void:
		_refresh_filter_badge()
		_schedule_search(false))
	r3.add_child(_legal)
	var auto_label := Label.new()
	auto_label.text = "Automation"
	r3.add_child(auto_label)
	_automation = OptionButton.new()
	for a: Array in [["", "Any"], ["full", "Full"], ["partial", "Partial"], ["manual", "Manual"]]:
		_automation.add_item(String(a[1]))
		_automation.set_item_metadata(_automation.item_count - 1, String(a[0]))
	_automation.item_selected.connect(func(_i: int) -> void:
		_refresh_filter_badge()
		_schedule_search(false))
	r3.add_child(_automation)
	box.add_child(r3)
	return parts[0]


func _refresh_identity() -> void:
	if _identity_hint == null:
		return
	var effective := _effective_identity()
	# The commander's identity is known once its card data is: the search follows it.
	if effective != _searched_identity and _searched_once:
		_schedule_search(false)
	for c: String in COLOR_LETTERS:
		(_identity_toggles[c] as ColorToggle).set_pressed_no_signal(effective.contains(c))
		(_identity_toggles[c] as ColorToggle).queue_redraw()
	var format := Val.text(_deck, "format")
	_identity_hint.visible = DeckModel.is_commander_format(format) and _identity_override == null and \
		DeckModel.commander_identity(_deck, _cards) != ""
	var key := DeckModel.legality_key(format)
	_legal.visible = key != ""
	_legal.text = "Legal in %s" % DeckModel.format_name(format)


## The identity the search uses: the player's choice, else in a commander format the commander's, else none.
func _effective_identity() -> String:
	if _identity_override != null:
		return String(_identity_override)
	if DeckModel.is_commander_format(Val.text(_deck, "format")):
		return DeckModel.commander_identity(_deck, _cards)
	return ""


func _refresh_filter_badge() -> void:
	var n := 0
	if _identity_override != null:
		n += 1
	for e: LineEdit in [_types, _keywords, _mv, _pow, _tou]:
		if e.text.strip_edges() != "":
			n += 1
	if String(_automation.get_item_metadata(_automation.selected)) != "":
		n += 1
	if not _legal.button_pressed and DeckModel.legality_key(Val.text(_deck, "format")) != "":
		n += 1
	_filters_button.text = "Filters" if n == 0 else "Filters (%d)" % n
	_advanced_button.text = "Advanced search" if _adv_query == null or _adv_query.text.strip_edges() == "" else "Advanced search • on"


func _advanced_drawer() -> PanelContainer:
	var parts := _drawer_panel()
	var outer: PanelContainer = parts[0]
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_adv_scroll = scroll
	var box: VBoxContainer = parts[1]
	_adv_box = box
	outer.remove_child(box)
	outer.add_child(scroll)
	box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(box)
	box.add_child(Hud.kicker("Search in Scryfall syntax", Hud.MUTED))
	_adv_query = LineEdit.new()
	_adv_query.placeholder_text = "t:creature c:g mv<=3 o:\"draw a card\""
	_adv_query.add_theme_font_override("font", ExportPanel._mono())
	_adv_query.text_changed.connect(func(_t: String) -> void:
		_adv_clear.disabled = _adv_query.text.strip_edges() == ""
		_refresh_filter_badge()
		_schedule_search(false))
	box.add_child(_adv_query)
	_adv_error = Hud.text("", 12, ERROR_TEXT)
	_adv_error.visible = false
	box.add_child(_adv_error)
	box.add_child(Hud.text("Words search card names; keywords narrow the search (c:, id:, t:, o:, mv, pow, f:, s:, is: ...). Combine them with spaces (and), or, ( ) and - (not). Not available (the card data has no printing details): block, rarity, artist, flavor text, year or date, prices and tags.", 12))
	var guide := LinkButton.new()
	guide.text = "Scryfall syntax guide"
	guide.uri = "https://scryfall.com/docs/syntax"
	guide.add_theme_color_override("font_color", NeonTheme.colors()[0])
	box.add_child(guide)
	box.add_child(Hud.kicker("Build a search", Hud.MUTED))
	var r1 := HBoxContainer.new()
	r1.add_theme_constant_override("separation", 8)
	for f: Array in [["name", "Name contains"], ["o", "Rules text contains"], ["t", "Type: creature, elf"], ["kw", "Keyword: flying"]]:
		var e := _field(String(f[1]))
		_adv_fields[String(f[0])] = e
		r1.add_child(e)
	box.add_child(r1)
	var r2 := HBoxContainer.new()
	r2.add_theme_constant_override("separation", 8)
	r2.add_child(_compare("c_op", COMPARE_COLORS))
	_adv_fields["c"] = _field("Colors: rg, izzet, c, m", 150.0)
	r2.add_child(_adv_fields["c"])
	r2.add_child(_compare("id_op", COMPARE_COLORS))
	_adv_fields["id"] = _field("Identity: esper", 130.0)
	r2.add_child(_adv_fields["id"])
	_adv_fields["produces"] = _field("Produces: g", 100.0)
	r2.add_child(_adv_fields["produces"])
	_adv_fields["s"] = _field("Set: dmu, Dominaria United", 190.0)
	(_adv_fields["s"] as LineEdit).focus_entered.connect(_load_sets)
	(_adv_fields["s"] as LineEdit).text_changed.connect(_suggest_sets)
	r2.add_child(_adv_fields["s"])
	box.add_child(r2)
	var r3 := HBoxContainer.new()
	r3.add_theme_constant_override("separation", 8)
	for f: Array in [["mv", "Mana value"], ["pow", "Power"], ["tou", "Toughness"]]:
		var label := Label.new()
		label.text = String(f[1])
		r3.add_child(label)
		r3.add_child(_compare("%s_op" % f[0], COMPARE_NUMBERS))
		_adv_fields[String(f[0])] = _field("", 60.0)
		r3.add_child(_adv_fields[String(f[0])])
	box.add_child(r3)
	var r4 := HBoxContainer.new()
	r4.add_theme_constant_override("separation", 8)
	var fmt := OptionButton.new()
	fmt.add_item("Any format")
	fmt.set_item_metadata(0, "")
	for f: String in ADV_FORMATS:
		fmt.add_item("Legal in %s" % f)
		fmt.set_item_metadata(fmt.item_count - 1, f)
	_adv_fields["f"] = fmt
	r4.add_child(fmt)
	var prop := OptionButton.new()
	prop.add_item("Any card")
	prop.set_item_metadata(0, "")
	for p: String in ADV_PROPERTIES:
		prop.add_item("is:%s" % p)
		prop.set_item_metadata(prop.item_count - 1, p)
	_adv_fields["is"] = prop
	r4.add_child(prop)
	_adv_add = Hud.button("Add to search")
	_adv_add.pressed.connect(_add_terms)
	r4.add_child(_adv_add)
	_adv_clear = Button.new()
	_adv_clear.text = "Clear advanced search"
	_adv_clear.flat = true
	_adv_clear.disabled = true
	_adv_clear.add_theme_color_override("font_color", NeonTheme.colors()[0])
	_adv_clear.pressed.connect(func() -> void:
		_adv_query.text = ""
		_adv_clear.disabled = true
		_refresh_filter_badge()
		_schedule_search(false))
	r4.add_child(_adv_clear)
	box.add_child(r4)
	_adv_adds = Hud.text("", 12)
	box.add_child(_adv_adds)
	for k: String in _adv_fields:
		var c: Control = _adv_fields[k]
		if c is LineEdit:
			(c as LineEdit).text_changed.connect(func(_t: String) -> void: _refresh_terms())
		elif c is OptionButton:
			(c as OptionButton).item_selected.connect(func(_i: int) -> void: _refresh_terms())
	_refresh_terms()
	var sheet_toggle := Button.new()
	sheet_toggle.flat = true
	sheet_toggle.toggle_mode = true
	sheet_toggle.text = "▸ Syntax cheat sheet"
	sheet_toggle.alignment = HORIZONTAL_ALIGNMENT_LEFT
	sheet_toggle.add_theme_color_override("font_color", NeonTheme.colors()[0])
	box.add_child(sheet_toggle)
	var sheet := GridContainer.new()
	sheet.columns = 2
	sheet.visible = false
	sheet.add_theme_constant_override("h_separation", 12)
	for ex: Array in CHEAT_SHEET:
		var b := Button.new()
		b.text = String(ex[0])
		b.tooltip_text = "Use this example"
		b.alignment = HORIZONTAL_ALIGNMENT_LEFT
		b.add_theme_font_override("font", ExportPanel._mono())
		var example := String(ex[0])
		b.pressed.connect(func() -> void:
			_adv_query.text = example
			_adv_clear.disabled = false
			_refresh_filter_badge()
			_schedule_search(false))
		sheet.add_child(b)
		sheet.add_child(Hud.text(String(ex[1]), 12))
	sheet_toggle.toggled.connect(func(on: bool) -> void:
		sheet_toggle.text = ("▾ " if on else "▸ ") + "Syntax cheat sheet"
		sheet.visible = on)
	box.add_child(sheet)
	return outer


func _compare(key: String, options: Array) -> OptionButton:
	var o := OptionButton.new()
	for op: Array in options:
		o.add_item(String(op[1]))
		o.set_item_metadata(o.item_count - 1, String(op[0]))
	_adv_fields[key] = o
	return o


static func _quoted(v: String) -> String:
	var clean := v.replace("\"", "")
	for ch: String in [" ", "\t", "'", "(", ")"]:
		if clean.contains(ch):
			return "\"%s\"" % clean
	return clean


## The terms "Add to search" adds, in the builder's order.
func _terms() -> String:
	var out: Array[String] = []
	var text := func(k: String) -> String: return (_adv_fields[k] as LineEdit).text.strip_edges()
	var op := func(k: String) -> String:
		var o: OptionButton = _adv_fields[k]
		return String(o.get_item_metadata(o.selected))
	for k: String in ["name", "o", "t", "kw"]:
		if text.call(k) != "":
			out.append("%s:%s" % [k, _quoted(text.call(k))])
	for k: String in ["c", "id", "mv", "pow", "tou"]:
		if text.call(k) != "":
			out.append("%s%s%s" % [k, op.call("%s_op" % k), _quoted(text.call(k))])
	var f := String(op.call("f"))
	if f != "":
		out.append("f:%s" % f)
	if text.call("s") != "":
		out.append("s:%s" % _quoted(text.call("s")))
	if text.call("produces") != "":
		out.append("produces:%s" % _quoted(text.call("produces")))
	var p := String(op.call("is"))
	if p != "":
		out.append("is:%s" % p)
	return " ".join(out)


func _refresh_terms() -> void:
	var t := _terms()
	_adv_adds.text = ("Adds: %s" % t) if t != "" else ""
	_adv_add.disabled = t == ""


func _add_terms() -> void:
	var t := _terms()
	if t == "":
		return
	_adv_query.text = (_adv_query.text.strip_edges() + " " + t).strip_edges()
	for k: String in _adv_fields:
		var c: Control = _adv_fields[k]
		if c is LineEdit:
			(c as LineEdit).text = ""
		elif c is OptionButton:
			(c as OptionButton).select(0)
	_adv_clear.disabled = false
	_refresh_terms()
	_refresh_filter_badge()
	_schedule_search(false)


func _load_sets() -> void:
	if not _sets.is_empty() or _sets_loading:
		return
	_sets_loading = true
	var r: Dictionary = await Server.get_json("/api/sets")
	_sets_loading = false
	if bool(r["ok"]):
		_sets = Val.list(Val.as_dict(r["data"]), "sets")


var _set_menu: PopupMenu = null


func _suggest_sets(text: String) -> void:
	var t := text.strip_edges().to_lower()
	if _set_menu == null:
		_set_menu = PopupMenu.new()
		_set_menu.id_pressed.connect(func(i: int) -> void:
			(_adv_fields["s"] as LineEdit).text = Val.text(Val.as_dict(_sets[i]), "code")
			_refresh_terms())
		add_child(_set_menu)
	_set_menu.clear()
	if t.length() < 2:
		_set_menu.hide()
		return
	var n := 0
	for i: int in _sets.size():
		var s := Val.as_dict(_sets[i])
		if Val.text(s, "code").to_lower().begins_with(t) or Val.text(s, "name").to_lower().contains(t):
			_set_menu.add_item("%s  %s (%s)" % [Val.text(s, "code"), Val.text(s, "name"), Val.text(s, "released").substr(0, 4)], i)
			n += 1
			if n >= 12:
				break
	if n == 0:
		_set_menu.hide()
		return
	var field: LineEdit = _adv_fields["s"]
	var r := field.get_global_rect()
	_set_menu.position = Vector2i(int(r.position.x), int(r.end.y))
	_set_menu.popup()
	field.grab_focus.call_deferred()


# ---- running a search ---------------------------------------------------------------------------------------------------------------

static var _re_scry: RegEx = null


## Whether the box holds Scryfall syntax (a keyword such as t: or mv<=, or !exact), not plain words.
static func looks_like_scryfall(text: String) -> bool:
	if _re_scry == null:
		_re_scry = RegEx.create_from_string("(?:^|[\\s(])-?([a-zA-Z]+)(?:!=|<=|>=|:|=|<|>)")
	for m: RegExMatch in _re_scry.search_all(text):
		if SCRY_KEYWORDS.has(m.get_string(1).to_lower()):
			return true
	return RegEx.create_from_string("(?:^|\\s)!\\S").search(text) != null


func _query(page: int) -> Dictionary:
	var q := {}
	var box := _search_box.text.strip_edges()
	var scry: Array[String] = []
	if box != "":
		if looks_like_scryfall(box):
			scry.append(box)
		else:
			q["q"] = box
	var colors := ""
	for c: String in COLOR_LETTERS:
		if _colors_on.has(c):
			colors += c
	if colors != "":
		q["colors"] = colors
	var identity := _effective_identity()
	if identity != "":
		q["identity"] = identity
	var list_re := RegEx.create_from_string("\\s*,\\s*")
	if _types.text.strip_edges() != "":
		q["types"] = list_re.sub(_types.text.strip_edges(), ",", true)
	if _keywords.text.strip_edges() != "":
		q["keywords"] = list_re.sub(_keywords.text.strip_edges(), ",", true)
	for pair: Array in [["mv", _mv], ["pow", _pow], ["tou", _tou]]:
		var v := (pair[1] as LineEdit).text.replace(" ", "").replace("\t", "")
		if v != "":
			q[String(pair[0])] = v
	var key := DeckModel.legality_key(Val.text(_deck, "format"))
	if _legal.button_pressed and key != "":
		q["format"] = key
	var auto := String(_automation.get_item_metadata(_automation.selected))
	if auto != "":
		q["automation"] = auto
	var adv := _adv_query.text.strip_edges()
	if adv != "":
		scry.append(adv)
	if scry.size() == 2:
		q["scry"] = "(%s) (%s)" % [scry[0], scry[1]]
	elif scry.size() == 1:
		q["scry"] = scry[0]
	q["page"] = str(page)
	if Settings.scryfall_images:
		q["images"] = "1"
	return q


static func _query_string(q: Dictionary) -> String:
	var keys: Array = q.keys()
	keys.sort()
	var parts: PackedStringArray = []
	for k: Variant in keys:
		if String(q[k]) != "":
			parts.append("%s=%s" % [String(k), String(q[k]).uri_encode()])
	return "&".join(parts)


## The first search runs at once; later changes wait 320 ms after the last one.
func _schedule_search(now: bool) -> void:
	if _search_box == null:
		return
	if now or not _searched_once:
		_searched_once = true
		_run_search()
	else:
		_search_timer.start(SEARCH_DELAY_S)


func _run_search_now() -> void:
	_search_timer.stop()
	_run_search()


func _run_search() -> void:
	_page = 1
	_last_query = _query(1)
	_searched_identity = Val.text(_last_query, "identity")
	_fetch_results()


func _go_page(page: int) -> void:
	if page < 1 or page > _pages:
		return
	_page = page
	_last_query["page"] = str(page)
	_fetch_results()


func _fetch_results() -> void:
	_search_seq += 1
	var seq := _search_seq
	_status.text = "Searching…"
	_status.add_theme_color_override("font_color", NeonTheme.colors()[0])
	_sweep.running = true
	_adv_error.visible = false
	var r: Dictionary = await Server.get_json("/api/cards/search?%s" % _query_string(_last_query))
	if seq != _search_seq or not is_inside_tree():
		return
	_sweep.running = false
	if not bool(r["ok"]):
		_status.add_theme_color_override("font_color", ERROR_TEXT)
		if int(r["status"]) == 400 and _last_query.has("scry"):
			_status.text = "This search can't run: %s" % r["error"]
			if _adv_query.text.strip_edges() != "":
				_adv_error.text = String(r["error"])
				_adv_error.visible = true
		else:
			_status.text = "Search failed: %s" % _describe(r)
			if not _search_failed:
				Sound.cue("ui.error")
			_search_failed = true
		return
	_search_failed = false
	var data := Val.as_dict(r["data"])
	var total := int(Val.num(data, "total"))
	var page_size := maxi(1, int(Val.num(data, "pageSize", 50)))
	_pages = maxi(1, ceili(float(total) / page_size))
	_status.add_theme_color_override("font_color", Hud.MUTED)
	if total == 0:
		_status.text = "No cards found."
	else:
		_status.text = "%s card%s" % [Hud.thousands(total), "" if total == 1 else "s"]
		if _pages > 1:
			_status.text += ", page %d of %d" % [_page, _pages]
	_pager.visible = _pages > 1
	_page_label.text = "%d / %d" % [_page, _pages]
	_prev.disabled = _page <= 1
	_next.disabled = _page >= _pages
	_show_results(Val.list(data, "cards"))


## "The OpenMTG server is not running…" for a server that does not answer, else the server's own words.
static func _describe(r: Dictionary) -> String:
	var status := int(r["status"])
	if status == 0 or status == 502 or status == 504:
		return "The game server is not answering. Restart OpenMTG, then try again."
	return String(r["error"])


func _show_results(cards: Array) -> void:
	for c: Node in _results.get_children():
		c.queue_free()
	_layout_results()
	for c: Variant in cards:
		var card := Val.as_dict(c)
		_cards[Val.text(card, "name")] = card
		_results.add_child(_result_tile(card))
	_results_scroll.scroll_vertical = 0


func _result_tile(card: Dictionary) -> Control:
	var card_name := Val.text(card, "name")
	var tile := VBoxContainer.new()
	tile.custom_minimum_size = Vector2(RESULT_W, 0)
	tile.add_theme_constant_override("separation", 3)
	tile.set_meta(&"card", card_name)
	var thumb := CardThumb.new()
	thumb.lift = true
	thumb.card = card
	thumb.custom_minimum_size = Vector2(RESULT_W, RESULT_W / CardThumb.ASPECT)
	thumb.tooltip_text = "Add %s to main deck" % card_name
	thumb.clicked.connect(func() -> void: _add_from_search("main", card))
	thumb.mouse_entered.connect(func() -> void: _hover_card(card, thumb))
	thumb.mouse_exited.connect(func() -> void: _unhover_card(card_name))
	tile.add_child(thumb)
	var name_button := Button.new()
	name_button.text = card_name
	name_button.flat = true
	name_button.clip_text = true
	name_button.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	name_button.tooltip_text = "Show %s large" % card_name
	name_button.alignment = HORIZONTAL_ALIGNMENT_LEFT
	name_button.add_theme_font_size_override("font_size", 13)
	name_button.add_theme_color_override("font_color", Color("#e6f6ff"))
	name_button.pressed.connect(func() -> void: _pin_preview(card))
	tile.add_child(name_button)
	var line := HBoxContainer.new()
	var faces: Array = Val.list(card, "faces")
	var cost := ManaCost.new()
	cost.symbol_size = 14.0
	cost.cost = Val.text(Val.as_dict(faces[0]), "manaCost") if not faces.is_empty() else ""
	cost.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	cost.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	line.add_child(cost)
	line.add_child(CardThumb.automation_badge(Val.text(card, "automation")))
	tile.add_child(line)
	var actions := HFlowContainer.new()
	actions.add_theme_constant_override("h_separation", 4)
	actions.add_theme_constant_override("v_separation", 4)
	var in_deck := Label.new()
	in_deck.name = "InDeck"
	in_deck.add_theme_font_size_override("font_size", 11)
	in_deck.add_theme_color_override("font_color", Color("#8fe9ff"))
	actions.add_child(in_deck)
	actions.add_child(_small_button("+ Side", "Add %s to sideboard" % card_name, func() -> void: _add_from_search("sideboard", card)))
	if DeckModel.is_commander_format(Val.text(_deck, "format")):
		actions.add_child(_small_button("Commander", "Set %s as commander" % card_name, func() -> void: _add_from_search("commander", card)))
	if _has_companion(card):
		actions.add_child(_small_button("Companion", "Set %s as companion" % card_name, func() -> void: _add_from_search("companion", card)))
	tile.add_child(actions)
	_refresh_tile_count(tile)
	return tile


func _small_button(text: String, tip: String, action: Callable) -> Button:
	var b := Hud.button(text)
	b.tooltip_text = tip
	b.set_meta(&"slab_depth", 2.0)
	b.add_theme_font_size_override("font_size", 11)
	b.pressed.connect(action)
	return b


static func _has_companion(card: Dictionary) -> bool:
	for f: Variant in Val.list(card, "faces"):
		for l: String in Val.text(Val.as_dict(f), "oracleText").split("\n"):
			if l.begins_with("Companion —"):
				return true
	return false


func _refresh_result_counts() -> void:
	if _results == null:
		return
	for tile: Node in _results.get_children():
		_refresh_tile_count(tile as Control)


func _refresh_tile_count(tile: Control) -> void:
	var label := tile.find_child("InDeck", true, false) as Label
	if label == null:
		return
	var n := DeckModel.copies(_deck, String(tile.get_meta(&"card", "")))
	label.text = "%d in deck" % n
	label.visible = n > 0


# ---- previews ---------------------------------------------------------------------------------------------------------------------------

func _hover_card(card: Dictionary, thumb: Control) -> void:
	_hover_seq += 1
	var seq := _hover_seq
	_hover_name = Val.text(card, "name")
	_hover_rect = thumb.get_global_rect()
	if not _details.has(_hover_name):
		await get_tree().create_timer(PREVIEW_DELAY_S).timeout
		if seq != _hover_seq:
			return
		var r: Dictionary = await Server.get_json("/api/cards/%s%s" % [_hover_name.uri_encode(), "?images=1" if Settings.scryfall_images else ""])
		if bool(r["ok"]):
			_details[_hover_name] = Val.as_dict(r["data"])
		if seq != _hover_seq or not is_inside_tree():
			return
	_close_floating()
	_floating = CardPreview.make(card, Val.as_dict(_details.get(_hover_name)), false)
	_floating.z_index = 90
	_floating.custom_minimum_size = Vector2(600, 0)
	add_child(_floating)
	_place_floating()


func _unhover_card(card_name: String) -> void:
	if card_name == _hover_name:
		_hover_seq += 1
		_hover_name = ""
		_close_floating()


func _close_floating() -> void:
	if _floating != null and is_instance_valid(_floating):
		_floating.queue_free()
	_floating = null


## Beside the card: on its right when there is room (or on neither side), else on its left; kept inside the window.
func _place_floating() -> void:
	var vp := get_viewport_rect().size
	var w := 600.0
	var h := maxf(_floating.size.y, 440.0)
	var left := minf(_hover_rect.end.x + 14.0, maxf(8.0, vp.x - w - 8.0))
	if not (_hover_rect.end.x + 14.0 + w <= vp.x - 8.0) and _hover_rect.position.x - 14.0 - w >= 8.0:
		left = _hover_rect.position.x - w - 14.0
	var top := minf(maxf(8.0, _hover_rect.position.y - 24.0), maxf(8.0, vp.y - h - 8.0))
	_floating.position = Vector2(maxf(8.0, left), top) - get_global_rect().position


func _pin_preview(card: Dictionary) -> void:
	_close_floating()
	var card_name := Val.text(card, "name")
	if not _details.has(card_name):
		var r: Dictionary = await Server.get_json("/api/cards/%s%s" % [card_name.uri_encode(), "?images=1" if Settings.scryfall_images else ""])
		if bool(r["ok"]):
			_details[card_name] = Val.as_dict(r["data"])
	if Val.list(card, "faces").is_empty():
		card = Val.dict(Val.as_dict(_details.get(card_name)), "card")
	if card.is_empty() or not is_inside_tree():
		return
	var m := Modal.open(self, "", true)
	var p := CardPreview.make(card, Val.as_dict(_details.get(card_name)), true, Val.text(_deck, "cover") == card_name)
	p.cover_chosen.connect(func(n: String) -> void:
		_change(func(d: Dictionary) -> Dictionary:
			var next := d.duplicate()
			next["cover"] = n
			return next)
		_look_up_deck_cards())
	p.close_pressed.connect(m.close)
	m.body.add_child(p)


# ---- Build: the deck panel ----------------------------------------------------------------------------------------------------------------

func _deck_panel() -> Control:
	var panel := Hud.panel(12)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 8)
	panel.add_child(box)
	var head := HBoxContainer.new()
	head.add_theme_constant_override("separation", 8)
	_small_box = DeckBox.new()
	_small_box.floor_room = 6.0
	_small_box.custom_minimum_size = Vector2(66, 68)
	head.add_child(_small_box)
	var fields := VBoxContainer.new()
	fields.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_name_field = LineEdit.new()
	_name_field.placeholder_text = "Deck name"
	_name_field.add_theme_font_override("font", Hud.bold_font())
	_name_field.add_theme_font_size_override("font_size", 17)
	fields.add_child(_name_field)
	_name_error = Hud.text("A deck needs a name; the last name is kept.", 12, ERROR_TEXT)
	_name_error.visible = false
	fields.add_child(_name_error)
	_name_field.text_changed.connect(func(t: String) -> void: _on_name_typed(t, _name_error))
	_name_field.focus_exited.connect(func() -> void:
		_name_field.text = Val.text(_deck, "name")
		_name_error.visible = false)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	_counter = Label.new()
	_counter.add_theme_font_override("font", Hud.bold_font())
	_counter.mouse_filter = Control.MOUSE_FILTER_PASS
	_counter.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(_counter)
	_format_select = OptionButton.new()
	_format_select.fit_to_longest_item = false
	_format_select.custom_minimum_size = Vector2(150, 0)
	_format_select.item_selected.connect(func(_i: int) -> void: _on_format_selected(_format_select))
	row.add_child(_format_select)
	fields.add_child(row)
	head.add_child(fields)
	box.add_child(head)
	_check_box = VBoxContainer.new()
	box.add_child(_check_box)
	_partner_hint = Hud.text("", 12, Hud.TEXT)
	_partner_hint.visible = false
	box.add_child(_partner_hint)
	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	box.add_child(scroll)
	_sections = VBoxContainer.new()
	_sections.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_sections.add_theme_constant_override("separation", 10)
	scroll.add_child(_sections)
	var notes_toggle := Button.new()
	notes_toggle.flat = true
	notes_toggle.toggle_mode = true
	notes_toggle.text = "▸ NOTES"
	notes_toggle.alignment = HORIZONTAL_ALIGNMENT_LEFT
	notes_toggle.add_theme_color_override("font_color", NeonTheme.colors()[0])
	box.add_child(notes_toggle)
	_notes = TextEdit.new()
	_notes.custom_minimum_size = Vector2(0, 70)
	_notes.wrap_mode = TextEdit.LINE_WRAPPING_BOUNDARY
	_notes.visible = false
	_notes.text_changed.connect(func() -> void:
		var t := _notes.text
		_change(func(d: Dictionary) -> Dictionary:
			if Val.text(d, "notes") == t:
				return d
			var next := d.duplicate()
			next["notes"] = t
			return next))
	notes_toggle.toggled.connect(func(on: bool) -> void:
		notes_toggle.text = ("▾ " if on else "▸ ") + "NOTES"
		_notes.visible = on)
	box.add_child(_notes)
	var footer := HBoxContainer.new()
	footer.alignment = BoxContainer.ALIGNMENT_END
	footer.add_theme_constant_override("separation", 8)
	_play = Hud.button("Play this deck")
	_play.tooltip_text = "Open New game with this deck for player 1"
	_play.pressed.connect(_play_deck)
	footer.add_child(_play)
	var done := Hud.primary("Done", 18)
	done.custom_minimum_size = Vector2(190, 46)
	done.set_meta(&"slab_depth", 6.0)
	done.pressed.connect(Nav.back)
	footer.add_child(done)
	box.add_child(footer)
	return panel


func _play_deck() -> void:
	_play.disabled = true
	await _wait_for_saves()
	Nav.open("newGame", {"deck_id": _id})


func _refresh_sections() -> void:
	for c: Node in _sections.get_children():
		c.queue_free()
	var format := Val.text(_deck, "format")
	var problems := _card_problems()
	for s: String in DeckModel.SECTIONS:
		var entries: Array = Val.list(_deck, s)
		var show := s == "main" or s == "sideboard" or (s == "commander" and (DeckModel.is_commander_format(format) or not entries.is_empty())) \
			or (s == "companion" and not entries.is_empty())
		if not show:
			continue
		var sec := SectionBox.new()
		sec.section = s
		sec.dropped.connect(func(from: String, card_name: String) -> void: _move(from, s, card_name))
		sec.add_theme_constant_override("separation", 4)
		var head := Hud.kicker("%s (%d)" % [DeckModel.SECTION_LABEL[s], DeckModel.section_count(_deck, s)], Hud.MUTED)
		sec.add_child(head)
		if entries.is_empty():
			sec.add_child(Hud.text("Empty" if s in ["commander", "companion"] else "No cards yet. Click a card to add it.", 12))
		for e: Variant in entries:
			sec.add_child(_deck_row(s, Val.as_dict(e), problems))
		_sections.add_child(sec)


## name -> [problem text] for the problems the check pins on one card (notes included).
func _card_problems() -> Dictionary:
	var out := {}
	for p: Variant in Val.list(_check, "problems"):
		var pd := Val.as_dict(p)
		var card := Val.text(pd, "card")
		if card == "":
			continue
		var rules: Array = Val.list(pd, "rules")
		var line := Val.text(pd, "message") + ((" (%s)" % ", ".join(PackedStringArray(rules))) if not rules.is_empty() else "")
		var list: Array = out.get(card, [])
		list.append(line)
		out[card] = list
	return out


func _deck_row(section: String, entry: Dictionary, problems: Dictionary) -> Control:
	var card_name := Val.text(entry, "name")
	var card := Val.as_dict(_cards.get(card_name))
	var tone := DeckModel.tone_of(card)
	var mine: Array = problems.get(card_name, [])
	var wrap := VBoxContainer.new()
	wrap.add_theme_constant_override("separation", 2)
	var row := DeckRow.new()
	row.section = section
	row.card_name = card_name
	row.custom_minimum_size = Vector2(0, 34)
	var s := StyleBoxFlat.new()
	s.bg_color = Color(tone.darkened(0.55), 0.55)
	s.border_color = BAD if not mine.is_empty() else tone
	s.border_width_left = 4
	s.corner_radius_top_left = 4
	s.corner_radius_bottom_left = 4
	s.corner_radius_top_right = 10
	s.corner_radius_bottom_right = 10
	s.content_margin_left = 8
	s.content_margin_right = 6
	row.add_theme_stylebox_override("panel", s)
	var line := HBoxContainer.new()
	line.add_theme_constant_override("separation", 6)
	var count := Label.new()
	count.text = "%dx" % int(Val.num(entry, "count"))
	count.add_theme_font_override("font", Hud.bold_font())
	count.add_theme_color_override("font_color", tone.lightened(0.35))
	line.add_child(count)
	var name_button := Button.new()
	name_button.text = card_name
	name_button.flat = true
	name_button.clip_text = true
	name_button.alignment = HORIZONTAL_ALIGNMENT_LEFT
	name_button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	name_button.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	name_button.add_theme_color_override("font_color", Color("#eaf6ff"))
	name_button.pressed.connect(func() -> void: _pin_preview(card if not card.is_empty() else {"name": card_name}))
	line.add_child(name_button)
	if _failed.has(card_name):
		var flag := Hud.text("Unknown card" if _failed[card_name] == "unknown" else "Card data unavailable", 11,
			ERROR_TEXT if _failed[card_name] == "unknown" else Hud.MUTED)
		flag.autowrap_mode = TextServer.AUTOWRAP_OFF
		line.add_child(flag)
	var tail := HBoxContainer.new()
	tail.add_theme_constant_override("separation", 4)
	if not card.is_empty():
		var faces: Array = Val.list(card, "faces")
		var cost := ManaCost.new()
		cost.symbol_size = 14.0
		cost.cost = Val.text(Val.as_dict(faces[0]), "manaCost") if not faces.is_empty() else ""
		cost.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		tail.add_child(cost)
		tail.add_child(CardThumb.automation_badge(Val.text(card, "automation")))
	line.add_child(tail)
	var buttons := HBoxContainer.new()
	buttons.add_theme_constant_override("separation", 3)
	buttons.alignment = BoxContainer.ALIGNMENT_END
	buttons.mouse_filter = Control.MOUSE_FILTER_IGNORE
	buttons.modulate.a = 0.0
	var minus := _row_button("−", "Remove one", func() -> void: _add(section, {"name": card_name}, -1))
	var plus := _row_button("+", "Add one", func() -> void: _add(section, {"name": card_name}, 1))
	var to := "sideboard" if section == "main" else "main"
	var move := _row_button("→ SB" if section == "main" else "→ Main", "Move to sideboard" if section == "main" else "Move to main deck",
		func() -> void: _move(section, to, card_name))
	move.set_meta(&"sfx", "ui.click")
	for b: Button in [minus, plus, move]:
		buttons.add_child(b)
	row.add_child(line)
	# Over the right end of the row, shown while the pointer is on it.
	row.add_child(buttons)
	row.mouse_entered.connect(func() -> void: buttons.modulate.a = 1.0)
	row.mouse_exited.connect(func() -> void:
		if not row.get_global_rect().has_point(row.get_global_mouse_position()):
			buttons.modulate.a = 0.0)
	for b: Button in [minus, plus, move, name_button]:
		b.mouse_entered.connect(func() -> void: buttons.modulate.a = 1.0)
	wrap.add_child(row)
	for p: Variant in mine:
		wrap.add_child(Hud.text(String(p), 12, BAD))
	return wrap


func _row_button(text: String, tip: String, action: Callable) -> Button:
	var b := Hud.button(text)
	b.tooltip_text = tip
	b.set_meta(&"slab_depth", 2.0)
	b.set_meta(&"sfx", "none")
	b.custom_minimum_size = Vector2(28, 26)
	b.add_theme_font_size_override("font_size", 12)
	b.pressed.connect(action)
	return b


# ---- the format check ------------------------------------------------------------------------------------------------------------------

func _schedule_check(now: bool) -> void:
	if now:
		_run_check()
	else:
		_check_timer.start(CHECK_DELAY_S)


func _run_check() -> void:
	_check_seq += 1
	var seq := _check_seq
	var format := Val.text(_deck, "format")
	if Val.text(_check, "_format") == format:
		_check_prev = _check
	else:
		_check_prev = {}
	_check_state = "checking"
	_refresh_check()
	var r: Dictionary = await Server.post_json("/api/decks/validate", {"deck": DeckModel.to_deck_list(_deck), "format": DeckModel.validate_format(format)})
	if seq != _check_seq or not is_inside_tree():
		return
	if not bool(r["ok"]):
		_check_state = "error"
		_check_error = _describe(r)
		if not _check_failed_sound:
			Sound.cue("ui.error")
		_check_failed_sound = true
		_refresh_check()
		return
	_check_failed_sound = false
	_check = Val.as_dict(r["data"])
	_check["_format"] = format
	_check_state = "done"
	var verdict := "legal" if Val.text(_check, "status") == "legal" else "illegal"
	if _verdict != "" and verdict != _verdict:
		Sound.cue("deck.legal" if verdict == "legal" else "deck.illegal")
	_verdict = verdict
	_refresh_check()
	_refresh_sections()


func _refresh_check() -> void:
	for target: Array in [[_check_box, false], [_detail_check, true]]:
		var box: VBoxContainer = target[0]
		if box != null:
			_fill_check(box, bool(target[1]))
	_refresh_partner_hint()


func _fill_check(box: VBoxContainer, details: bool) -> void:
	for c: Node in box.get_children():
		c.queue_free()
	var frame := PanelContainer.new()
	var s := StyleBoxFlat.new()
	s.bg_color = Color(0.02, 0.04, 0.08, 0.6)
	s.border_color = Color(NeonTheme.colors()[0], 0.35)
	s.set_border_width_all(1)
	s.set_corner_radius_all(8)
	s.set_content_margin_all(8)
	frame.add_theme_stylebox_override("panel", s)
	var inner := VBoxContainer.new()
	inner.add_theme_constant_override("separation", 4)
	frame.add_child(inner)
	box.add_child(frame)
	var format_name := DeckModel.format_name(Val.text(_deck, "format"))
	if details:
		inner.add_child(Hud.kicker("Format: %s" % format_name, Hud.MUTED))
	if _check_state == "checking":
		inner.add_child(Hud.text("Re-checking…" if not _check_prev.is_empty() else "Checking…", 13, NeonTheme.colors()[0]))
	if _check_state == "error":
		inner.add_child(Hud.text("Could not check the deck: %s" % _check_error, 13, ERROR_TEXT))
		return
	var answer := _check if _check_state == "done" else _check_prev
	if answer.is_empty():
		return
	var shown := VBoxContainer.new()
	shown.modulate.a = 0.6 if _check_state == "checking" else 1.0
	inner.add_child(shown)
	var status := Val.text(answer, "status")
	if status == "legal":
		shown.add_child(Hud.text("Legal in %s." % format_name, 13, Color("#7fe3ff")))
		return
	var list: Array[String] = []
	for p: Variant in Val.list(answer, "problems"):
		var pd := Val.as_dict(p)
		if Val.text(pd, "severity") == "note":
			continue
		var rules: Array = Val.list(pd, "rules")
		list.append(Val.text(pd, "message") + ((" (%s)" % ", ".join(PackedStringArray(rules))) if not rules.is_empty() else ""))
	var title := ("Not legal in %s: %d problem%s." if status == "illegal" else "Not fully checked for %s: %d warning%s.") % [format_name,
		list.size(), "" if list.size() == 1 else "s"]
	var toggle := Button.new()
	toggle.flat = true
	toggle.toggle_mode = true
	toggle.button_pressed = details
	toggle.text = ("▾ " if details else "▸ ") + title
	toggle.alignment = HORIZONTAL_ALIGNMENT_LEFT
	toggle.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	toggle.add_theme_color_override("font_color", BAD if status == "illegal" else Color("#ffd98f"))
	shown.add_child(toggle)
	# A long list scrolls in 96 px; a short one shows whole.
	var items := VBoxContainer.new()
	items.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for l: String in list:
		items.add_child(Hud.text("• " + l, 12, Hud.TEXT))
	var scroll: Control = items
	if list.size() > 3:
		var sc := ScrollContainer.new()
		sc.custom_minimum_size = Vector2(0, 96)
		sc.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
		sc.add_child(items)
		scroll = sc
	scroll.visible = details
	shown.add_child(scroll)
	toggle.toggled.connect(func(on: bool) -> void:
		toggle.text = ("▾ " if on else "▸ ") + title
		scroll.visible = on)


func _refresh_partner_hint() -> void:
	if _partner_hint == null:
		return
	_partner_hint.visible = false
	if not DeckModel.is_commander_format(Val.text(_deck, "format")) or DeckModel.section_count(_deck, "commander") != 2:
		return
	for p: Variant in Val.list(_check, "problems"):
		var pd := Val.as_dict(p)
		if Val.text(pd, "kind") == "commander" and Val.list(pd, "rules").has("CR 702.124f"):
			_partner_hint.text = "%s Two commanders must share a partner ability: both have Partner, both have the same \"Partner—\" ability, or each is the other's \"Partner with\" (CR 702.124f, 702.124h-j)." % Val.text(pd, "message")
			_partner_hint.visible = true
			return


# ---- Details ------------------------------------------------------------------------------------------------------------------------------

func _details_layout() -> Control:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 22)
	var vp := get_viewport_rect().size
	var left := Hud.panel(14)
	left.custom_minimum_size = Vector2(maxf(260.0, vp.x * 0.25), 0)
	left.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	var lbox := VBoxContainer.new()
	lbox.add_theme_constant_override("separation", 10)
	left.add_child(lbox)
	_detail_name = LineEdit.new()
	_detail_name.alignment = HORIZONTAL_ALIGNMENT_CENTER
	_detail_name.placeholder_text = "Deck name"
	_detail_name.add_theme_font_override("font", Hud.bold_font())
	var detail_error := Hud.text("A deck needs a name; the last name is kept.", 12, ERROR_TEXT)
	detail_error.visible = false
	_detail_name.text_changed.connect(func(t: String) -> void: _on_name_typed(t, detail_error))
	_detail_name.focus_exited.connect(func() -> void:
		_detail_name.text = Val.text(_deck, "name")
		detail_error.visible = false)
	lbox.add_child(_detail_name)
	lbox.add_child(detail_error)
	_detail_format = OptionButton.new()
	_detail_format.item_selected.connect(func(_i: int) -> void: _on_format_selected(_detail_format))
	lbox.add_child(_detail_format)
	_stats_box = VBoxContainer.new()
	_stats_box.add_theme_constant_override("separation", 8)
	lbox.add_child(_stats_box)
	row.add_child(left)
	var middle := VBoxContainer.new()
	middle.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	middle.alignment = BoxContainer.ALIGNMENT_CENTER
	middle.add_theme_constant_override("separation", 10)
	_big_box = DeckBox.new()
	_big_box.sway = true
	_big_box.ring = true
	_big_box.floor_room = 36.0
	var bw := clampf((vp.y - 500.0) * 0.62, 140.0, 320.0)
	_big_box.custom_minimum_size = Vector2(bw * 1.5, bw * 1.396 + 36.0)
	_big_box.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	middle.add_child(_big_box)
	_detail_title = Label.new()
	_detail_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_detail_title.add_theme_font_override("font", Hud.bold_font())
	_detail_title.add_theme_font_size_override("font_size", 27)
	_detail_title.add_theme_color_override("font_shadow_color", Color(NeonTheme.colors()[0], 0.6))
	_detail_title.add_theme_constant_override("shadow_outline_size", 8)
	middle.add_child(_detail_title)
	_detail_count = Hud.text("", 14, Hud.TEXT)
	_detail_count.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	middle.add_child(_detail_count)
	var pills := HBoxContainer.new()
	pills.alignment = BoxContainer.ALIGNMENT_CENTER
	pills.add_theme_constant_override("separation", 10)
	var edit := Hud.primary("Edit deck", 19)
	edit.custom_minimum_size = Vector2(190, 46)
	edit.set_meta(&"slab_depth", 6.0)
	edit.pressed.connect(func() -> void: _set_view("build", true))
	pills.add_child(edit)
	var export := Hud.button("Export")
	export.pressed.connect(_open_export)
	pills.add_child(export)
	var validate := Hud.button("Validate")
	validate.pressed.connect(func() -> void: _schedule_check(true))
	pills.add_child(validate)
	middle.add_child(pills)
	var check_wrap := CenterContainer.new()
	_detail_check = VBoxContainer.new()
	_detail_check.custom_minimum_size = Vector2(460, 0)
	check_wrap.add_child(_detail_check)
	middle.add_child(check_wrap)
	row.add_child(middle)
	var right := Hud.panel(14)
	right.custom_minimum_size = Vector2(maxf(230.0, vp.x * 0.22), 0)
	right.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	var rbox := VBoxContainer.new()
	rbox.add_theme_constant_override("separation", 6)
	right.add_child(rbox)
	rbox.add_child(Hud.kicker("Card types", NeonTheme.colors()[0]))
	_types_box = VBoxContainer.new()
	_types_box.add_theme_constant_override("separation", 3)
	rbox.add_child(_types_box)
	row.add_child(right)
	return row


func _refresh_details() -> void:
	if _detail_title == null:
		return
	_detail_title.text = DeckModel.shown_name(_deck)
	var format := Val.text(_deck, "format")
	var side := DeckModel.section_count(_deck, "sideboard")
	_detail_count.text = "%d/%d Cards%s" % [DeckModel.section_count(_deck, "main") + DeckModel.section_count(_deck, "commander"),
		DeckModel.deck_size(format), (" · %d sideboard" % side) if side > 0 else ""]
	var st := DeckModel.stats(_deck, _cards)
	for c: Node in _stats_box.get_children():
		c.queue_free()
	var legend := HBoxContainer.new()
	legend.add_theme_constant_override("separation", 14)
	var creatures := 0
	var others := 0
	for i: int in 6:
		creatures += int(st["creatureCurve"][i])
		others += int(st["otherCurve"][i])
	legend.add_child(_swatch(CurveChart.CREATURE, "Creatures %d" % creatures))
	legend.add_child(_swatch(CurveChart.OTHER, "NonCreatures %d" % others))
	_stats_box.add_child(legend)
	var curve := CurveChart.new()
	curve.creature = st["creatureCurve"]
	curve.other = st["otherCurve"]
	curve.custom_minimum_size = Vector2(0, clampf(get_viewport_rect().size.y - 616.0, 82.0, 240.0) + 40.0)
	_stats_box.add_child(curve)
	var avg_row := HBoxContainer.new()
	avg_row.add_theme_constant_override("separation", 16)
	var avg := Label.new()
	avg.text = "Average: %.1f" % float(st["average"])
	avg.add_theme_font_override("font", Hud.bold_font())
	avg_row.add_child(avg)
	var lands_text := "Lands: %d" % int(st["lands"])
	if int(st["notLoaded"]) > 0:
		lands_text += " (%d cards still loading or unknown)" % int(st["notLoaded"])
	var lands := Hud.text(lands_text, 14, Hud.TEXT)
	lands.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	avg_row.add_child(lands)
	_stats_box.add_child(avg_row)
	_stats_box.add_child(_colors_table(st))
	for c: Node in _types_box.get_children():
		c.queue_free()
	var groups: Array = st["groups"]
	if groups.is_empty():
		_types_box.add_child(Hud.text("No cards yet.", 13))
	for g: Variant in groups:
		var gd := Val.as_dict(g)
		var head := HBoxContainer.new()
		var t := Label.new()
		t.text = Val.text(gd, "type")
		t.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		t.add_theme_font_override("font", Hud.bold_font())
		head.add_child(t)
		var n := Label.new()
		n.text = str(int(Val.num(gd, "count")))
		n.add_theme_font_override("font", Hud.bold_font())
		head.add_child(n)
		_types_box.add_child(head)
		for sub: Variant in Val.list(gd, "subtypes"):
			var pair := Val.as_list(sub)
			var srow := HBoxContainer.new()
			var sl := _plain("   %s" % String(pair[0]), 13, Hud.MUTED)
			sl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			srow.add_child(sl)
			srow.add_child(_plain(str(int(pair[1])), 13, Hud.MUTED))
			_types_box.add_child(srow)


## A label that keeps to one line (Hud.text wraps, which squeezes it to a letter a line in a row or a grid).
static func _plain(text: String, size: int = 13, color: Color = Hud.TEXT) -> Label:
	var l := Hud.text(text, size, color)
	l.autowrap_mode = TextServer.AUTOWRAP_OFF
	return l


func _swatch(color: Color, text: String) -> Control:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 6)
	var sw := ColorRect.new()
	sw.color = color
	sw.custom_minimum_size = Vector2(12, 12)
	sw.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(sw)
	row.add_child(_plain(text))
	return row


func _colors_table(st: Dictionary) -> Control:
	var pips: Dictionary = st["pips"]
	var sources: Dictionary = st["sources"]
	var used: Array[String] = []
	var total_pips := 0
	for c: String in DeckModel.WUBRG:
		total_pips += int(pips.get(c, 0))
		if int(pips.get(c, 0)) > 0 or int(sources.get(c, 0)) > 0:
			used.append(c)
	if used.is_empty():
		return Hud.text("No colored mana yet.", 13)
	var grid := GridContainer.new()
	grid.columns = 4
	grid.add_theme_constant_override("h_separation", 14)
	for h: Array in [["Color", ""], ["Symbols", ""], ["Share", ""], ["Lands", "Lands that can make this color"]]:
		var l := Hud.kicker(String(h[0]), Hud.MUTED)
		l.tooltip_text = String(h[1])
		l.mouse_filter = Control.MOUSE_FILTER_PASS
		grid.add_child(l)
	for c: String in used:
		var p := int(pips.get(c, 0))
		var src := int(sources.get(c, 0))
		var tone := BAD if p > 0 and src == 0 else Hud.TEXT
		var name_row := HBoxContainer.new()
		name_row.add_theme_constant_override("separation", 6)
		var disc := ManaCost.new()
		disc.symbol_size = 14.0
		disc.cost = "{%s}" % c
		disc.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		name_row.add_child(disc)
		name_row.add_child(_plain(DeckModel.COLOR_NAMES[c], 13, tone))
		grid.add_child(name_row)
		grid.add_child(_plain(str(p), 13, tone))
		grid.add_child(_plain("%d%%" % roundi(100.0 * p / total_pips) if total_pips > 0 else "0%", 13, tone))
		grid.add_child(_plain(str(src), 13, tone))
	return grid


# ---- pieces -------------------------------------------------------------------------------------------------------------------------------

## A round colour toggle (W U B R G C): the symbol, raised and ringed in neon when on.
class ColorToggle:
	extends Button

	var letter: String = "W"

	func _init() -> void:
		toggle_mode = true
		flat = true
		set_meta(&"slab", "none")
		custom_minimum_size = Vector2(34, 34)
		toggled.connect(func(_on: bool) -> void: queue_redraw())
		mouse_entered.connect(queue_redraw)
		mouse_exited.connect(queue_redraw)

	func _draw() -> void:
		var on := button_pressed
		var lift := -2.0 if on or is_hovered() else 0.0
		var s := 1.08 if on else 1.0
		var c := size / 2.0 + Vector2(0, lift)
		var r := 15.0 * s
		if on:
			draw_circle(c, r + 5.0, Color(NeonTheme.colors()[0], 0.25))
			draw_arc(c, r + 2.5, 0.0, TAU, 32, NeonTheme.colors()[0], 2.0, true)
		ManaCost.draw_symbol(self, letter, c, r)
		if on:
			draw_arc(c, r, 0.0, TAU, 32, Color.WHITE, 1.5, true)
		elif not is_hovered():
			draw_circle(c, r, Color(0, 0, 0, 0.35))


## A section of the deck list: takes a dragged card from another section (shown with a dashed neon edge while over it).
class SectionBox:
	extends VBoxContainer

	signal dropped(from: String, card_name: String)

	var section: String = ""
	var _over: bool = false

	func _can_drop_data(_at: Vector2, data: Variant) -> bool:
		var d := Val.as_dict(data)
		var ok := d.has("from") and String(d["from"]) != section
		if ok != _over:
			_over = ok
			queue_redraw()
		return ok

	func _drop_data(_at: Vector2, data: Variant) -> void:
		var d := Val.as_dict(data)
		_over = false
		queue_redraw()
		dropped.emit(String(d["from"]), String(d["name"]))

	func _notification(what: int) -> void:
		if what == NOTIFICATION_DRAG_END and _over:
			_over = false
			queue_redraw()

	func _draw() -> void:
		if not _over:
			return
		var r := Rect2(Vector2(-4, -4), size + Vector2(8, 8))
		var neon := NeonTheme.colors()[0]
		var pts := [r.position, Vector2(r.end.x, r.position.y), r.end, Vector2(r.position.x, r.end.y), r.position]
		for i: int in 4:
			var a: Vector2 = pts[i]
			var b: Vector2 = pts[i + 1]
			var length := a.distance_to(b)
			var t := 0.0
			while t < length:
				draw_line(a.lerp(b, t / length), a.lerp(b, minf(t + 6.0, length) / length), neon, 1.5)
				t += 10.0


## A card row of the deck list: dragged to another section, it moves there.
class DeckRow:
	extends PanelContainer

	var section: String = ""
	var card_name: String = ""

	func _get_drag_data(_at: Vector2) -> Variant:
		var preview := Label.new()
		preview.text = card_name
		preview.add_theme_color_override("font_color", Color.WHITE)
		set_drag_preview(preview)
		return {"from": section, "name": card_name}


## The mana curve: six columns (1 or less … 6 or more), creatures below and other spells stacked on top, the count and label
## under each.
class CurveChart:
	extends Control

	const CREATURE: Color = Color("#ff8a1f")
	const OTHER: Color = Color("#1493e6")

	var creature: Array = [0, 0, 0, 0, 0, 0]
	var other: Array = [0, 0, 0, 0, 0, 0]

	func _draw() -> void:
		var most := 1
		for i: int in 6:
			most = maxi(most, int(creature[i]) + int(other[i]))
		var gap := 8.0
		var col_w := (size.x - gap * 5.0) / 6.0
		var bar_h := size.y - 40.0
		var font := Hud.bold_font()
		for i: int in 6:
			var total := int(creature[i]) + int(other[i])
			var x := i * (col_w + gap)
			var w := col_w * 0.66
			var bx := x + (col_w - w) / 2.0
			var h := maxf(2.0, bar_h * 0.9 * total / most) if total > 0 else 2.0
			var c_h := h * (float(creature[i]) / total) if total > 0 else 0.0
			draw_rect(Rect2(bx, bar_h - h, w, h - c_h), OTHER if total > 0 else Color(1, 1, 1, 0.15))
			if c_h > 0.0:
				draw_rect(Rect2(bx, bar_h - c_h, w, c_h), CREATURE)
			var n := str(total)
			var nw := font.get_string_size(n, HORIZONTAL_ALIGNMENT_LEFT, -1, 15).x
			draw_string(font, Vector2(x + (col_w - nw) / 2.0, bar_h + 17.0), n, HORIZONTAL_ALIGNMENT_LEFT, -1, 15, Color.WHITE)
			var label := DeckModel.CURVE_LABELS[i]
			var lw := font.get_string_size(label, HORIZONTAL_ALIGNMENT_LEFT, -1, 12).x
			draw_string(font, Vector2(x + (col_w - lw) / 2.0, bar_h + 33.0), label, HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Hud.MUTED)
			draw_line(Vector2(x, bar_h + 21.0), Vector2(x + col_w, bar_h + 21.0), Color(1, 1, 1, 0.15), 1.0)


## A 2 px bar of light sliding across while a search runs (deck-progress, 900 ms).
class Sweep:
	extends Control

	var running: bool = false:
		set(v):
			running = v
			queue_redraw()
	var _t: float = 0.0

	func _process(delta: float) -> void:
		if running:
			_t = fmod(_t + delta / 0.9, 1.0)
			queue_redraw()

	func _draw() -> void:
		if not running:
			return
		var w := size.x * 0.4
		var x := lerpf(-w, size.x * 1.4 - w, _t)
		var neon := NeonTheme.colors()[0]
		var pts := PackedVector2Array([Vector2(x, 1), Vector2(x + w * 0.4, 1), Vector2(x + w * 0.6, 1), Vector2(x + w, 1)])
		draw_polyline_colors(pts, PackedColorArray([Color(neon, 0.0), neon, NeonTheme.colors()[1], Color(neon, 0.0)]), 2.0)
