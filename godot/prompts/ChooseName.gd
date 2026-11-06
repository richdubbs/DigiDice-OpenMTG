extends "res://prompts/PromptBase.gd"
## chooseName (CR 607.2d, 608.2d, 201.4): name a creature type, card type or land type from the engine's closed list (`options`, filtered
## as the player types), or a card name. For a card name the browser searches the local server's whole Oracle index
## (GET /api/cards/search, 250 ms after the last key, two letters or more); this scene offers the names of the cards in this game
## first (every non-token definition the view knows, each face's name, of `cardKind` only), then the search's. When the search is
## unavailable it lets the player use the typed name after a warning that it is not checked against the card list. The decision
## can't be cancelled, so it is never a dead end.
## Answer: {kind:'chooseName', name: string}.

const MAX_SHOWN := 40
const WHAT := {"cardName": "a card name", "creatureType": "a creature type", "cardType": "a card type", "landType": "a land type"}

var chosen: String = ""
var _typed: bool = false
var _all: Array = []
var _search: LineEdit = null
var _list: HFlowContainer = null
var _more: Label = null
var _use_typed: Button = null
var _warning: Label = null
## Names the server's search found for the typed text, and the search waiting to run.
var _found: Array = []
var _search_timer: Timer = null
var _search_seq: int = 0


func _build() -> void:
	var what := J.str_of(decision, "what")
	if J.has(decision, "options"):
		_all = J.strings(decision, "options")
	else:
		_all = game_card_names(J.str_of(decision, "cardKind"))
	var kind := J.str_of(decision, "cardKind")
	# The label above the box: beside a 240 px box it had no room and shrank to one letter a line.
	body.add_child(make_label("Search %s" % ("a %s card name" % kind if what == "cardName" and kind != "" else str(WHAT.get(what, "a name")))))
	_search = LineEdit.new()
	_search.name = "Search"
	_search.custom_minimum_size = Vector2(240, 0)
	_search.text_changed.connect(_on_search_changed)
	body.add_child(_search)
	if not J.has(decision, "options"):
		body.add_child(make_label("The names of the cards in this game are listed; another card's exact name can be typed and used.", &"PromptDetail"))
	_list = HFlowContainer.new()
	_list.name = "Names"
	body.add_child(_list)
	_more = make_label("", &"PromptDetail")
	body.add_child(_more)
	_use_typed = Button.new()
	_use_typed.name = "UseTyped"
	_use_typed.text = "Use the typed name"
	_use_typed.pressed.connect(_on_use_typed)
	body.add_child(_use_typed)
	_warning = make_label("", &"PromptWarning")
	body.add_child(_warning)
	_search_timer = Timer.new()
	_search_timer.one_shot = true
	_search_timer.timeout.connect(_search_cards)
	add_child(_search_timer)
	_fill()


## The whole card list: the names the server finds for the typed text (a land or nonland card when the decision says so).
func _search_cards() -> void:
	var q := _search.text.strip_edges()
	_search_seq += 1
	var seq := _search_seq
	if q.length() < 2 or J.has(decision, "options"):
		_found = []
		_fill()
		return
	var query := "q=%s" % q.uri_encode()
	match J.str_of(decision, "cardKind"):
		"land":
			query += "&types=land"
		"nonland":
			query += "&scry=%s" % "-t:land".uri_encode()
	var r: Dictionary = await Server.get_json("/api/cards/search?%s" % query)
	if seq != _search_seq or not is_inside_tree():
		return
	_found = []
	if bool(r["ok"]):
		for c: Variant in Val.list(Val.as_dict(r["data"]), "cards"):
			var n := Val.text(Val.as_dict(c), "name")
			if n != "" and not _found.has(n):
				_found.append(n)
	_fill()


## The names of the cards in this game: every non-token card definition the view knows, each face's name when it has several (CR 201.4b-f),
## of `card_kind` ('land' / 'nonland', CR 201.3) only when given; sorted.
func game_card_names(card_kind: String) -> Array:
	var out: Array = []
	var defs := J.dict(view, "defs")
	for key: Variant in defs:
		var cd: Dictionary = defs[key]
		if str(key) == Names.HIDDEN_DEF or J.bool_of(cd, "isToken"):
			continue
		var faces := J.dicts(cd, "faces")
		for f: Dictionary in faces:
			var is_land := J.strings(f, "types").has("Land") if J.has(f, "types") else J.str_of(f, "typeLine").contains("Land")
			if card_kind != "" and is_land != (card_kind == "land"):
				continue
			var n := J.str_of(f, "name") if faces.size() > 1 else J.str_of(cd, "name")
			if n != "" and not out.has(n):
				out.append(n)
		if faces.is_empty() and card_kind == "":
			var n2 := J.str_of(cd, "name")
			if n2 != "" and not out.has(n2):
				out.append(n2)
	out.sort()
	return out


## Closed-list filter: names that start with the query first, then names that contain it (case ignored).
static func filter_names(options: Array, query: String) -> Array:
	var q := query.strip_edges().to_lower()
	if q == "":
		return options.duplicate()
	var starts: Array = []
	var contains: Array = []
	for o: Variant in options:
		var s := str(o)
		var low := s.to_lower()
		if low.begins_with(q):
			starts.append(s)
		elif low.contains(q):
			contains.append(s)
	return starts + contains


func _on_search_changed(_new_text: String) -> void:
	if _typed:
		chosen = ""
		_typed = false
	if not J.has(decision, "options"):
		_search_timer.start(0.25)
	_fill()


func _fill() -> void:
	clear_children(_list)
	var shown := filter_names(_all, _search.text)
	for n: Variant in _found:
		if not shown.has(n):
			shown.append(n)
	for i: int in mini(shown.size(), MAX_SHOWN):
		var n := str(shown[i])
		var b := Button.new()
		b.name = ("Name_" + n).validate_node_name()
		b.text = n
		b.toggle_mode = true
		b.set_pressed_no_signal(n == chosen)
		b.pressed.connect(choose.bind(n), CONNECT_DEFERRED)
		_list.add_child(b)
	var extra := shown.size() - MAX_SHOWN
	_more.text = "%d more: keep typing." % extra if extra > 0 else ("No match." if shown.is_empty() and _search.text.strip_edges() != "" else "")
	_more.visible = _more.text != ""
	var typed := _search.text.strip_edges()
	_use_typed.visible = not J.has(decision, "options") and typed != "" and not shown.has(typed)
	_refresh()


## Choose a listed name.
func choose(n: String) -> void:
	chosen = n
	_typed = false
	_fill()


func _on_use_typed() -> void:
	chosen = _search.text.strip_edges()
	_typed = chosen != ""
	_refresh()


func _refresh() -> void:
	if _warning == null:
		return
	_warning.text = "\"%s\" is not checked against the Oracle card list (CR 201.4): make sure it is the exact name of a card." % chosen if _typed and chosen != "" else ""
	_warning.visible = _warning.text != ""
	set_ok(chosen != "", "Choose a name" if chosen == "" else "Name \"%s\"" % chosen)


func _on_ok() -> void:
	if chosen != "":
		send_answer({"kind": "chooseName", "name": chosen})
