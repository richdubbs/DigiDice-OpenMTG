extends "res://prompts/PromptBase.gd"
## chooseObjects (discard, sacrifice, put on the bottom, search, CR 701.9, 701.21, 701.23, 103.5): click the offered objects, here or on
## the board. OK is enabled when the count is within min..max (and, when the decision has a `limit`, the chosen total keeps it,
## CR 608.2d). With `ordered`, the click order is the answer's order and is shown beside each card.
## Answer: {kind:'chooseObjects', ids: ObjectId[]}.

var chosen: Array = []
var _options: Array = []
var _lo: int = 0
var _hi: int = 0
var _clear_button: Button = null
## The stage's cards by object id, and which stage it is ("search", "hand", "bottom"; "" without one).
var _stage_cards: Dictionary = {}
var _stage_kind: String = ""
var _stage_owner: String = ""

const STAT_WORDS := {"power": "power", "toughness": "toughness", "manaValue": "mana value"}


func _build() -> void:
	_options = J.strings(decision, "options")
	_lo = J.int_of(decision, "min")
	_hi = J.int_of(decision, "max")
	add_chips(body, _options, toggle_id)
	_clear_button = add_action("Clear", "Clear", _on_clear)
	_open_choice_stage()


## The stage of a choice the browser draws large: searching a library (CR 701.23a-b: only the cards it can find, by name), another
## player's revealed hand (every revealed card, the ones that can't be chosen dimmed), or the new hand after a mulligan (CR 103.5),
## fanned like the opening hand.
func _open_choice_stage() -> void:
	var library := searched_library()
	var hand := revealed_hand() if library == "" else ""
	var cards: Array = []
	var st: PromptStage = null
	if library != "":
		_stage_kind = "search"
		_stage_owner = library
		cards = search_order(_options)
		st = open_stage("Search %s" % _whose_library())
		if st != null:
			for c: PromptStage.StageCard in st.row(view, cards):
				_stage_cards[c.id] = c
	elif hand != "":
		_stage_kind = "hand"
		_stage_owner = hand
		for id: Variant in J.arr(J.dict(J.dict(view, "zones"), "hand"), hand):
			if J.str_of(Names.object_of(view, str(id)), "defId") != Names.HIDDEN_DEF:
				cards.append(str(id))
		st = open_stage("%s's hand" % Names.player_name(view, hand))
		if st != null:
			for c: PromptStage.StageCard in st.row(view, cards):
				_stage_cards[c.id] = c
				if not _options.has(c.id):
					c.set_unchoosable("Can't be chosen")
	elif is_mulligan_bottom():
		_stage_kind = "bottom"
		var me := J.str_of(decision, "player")
		for id: Variant in J.arr(J.dict(J.dict(view, "zones"), "hand"), me):
			if _options.has(str(id)):
				cards.append(str(id))
		st = open_stage("Put %s on the bottom" % Names.plural(_lo, "card"))
		if st != null:
			for c: PromptStage.StageCard in st.fan(view, cards):
				c.drop_when_chosen = st.get_viewport_rect().size.y * 0.05
				_stage_cards[c.id] = c
	for c: Variant in _stage_cards.values():
		var sc: PromptStage.StageCard = c
		if _options.has(sc.id):
			sc.make_clickable()
			sc.pressed.connect(_on_stage_card)


func _on_stage_card(id: String) -> void:
	if _busy:
		return
	Sound.cue("ui.tick" if chosen.has(id) else "ui.select")
	toggle_id(id)


func _whose_library() -> String:
	return "your library" if _stage_owner == Names.viewer(view) else "%s's library" % Names.player_name(view, _stage_owner)


## The library a choice searches (CR 701.23a): every option is a card in the same player's library, which the engine showed to the
## searcher; "" otherwise (discards, sacrifices, cards already looked at in other zones).
func searched_library() -> String:
	var owner := ""
	for id: Variant in _options:
		var o := Names.object_of(view, str(id))
		if o.is_empty() or J.str_of(o, "zone") != "library" or (owner != "" and J.str_of(o, "owner") != owner):
			return ""
		owner = J.str_of(o, "owner")
	return owner


## Another player's hand a choice picks from (Thoughtseize, Duress, CR 701.20b): every option is a card in the same other player's
## hand; "" otherwise.
func revealed_hand() -> String:
	var owner := ""
	var me := Names.viewer(view)
	for id: Variant in _options:
		var o := Names.object_of(view, str(id))
		if o.is_empty() or J.str_of(o, "zone") != "hand" or J.str_of(o, "owner") == me or (owner != "" and J.str_of(o, "owner") != owner):
			return ""
		owner = J.str_of(o, "owner")
	return owner


## The cards a search can find, by name (then id): the library's own order is not part of what the search shows.
func search_order(ids: Array) -> Array:
	var out := ids.duplicate()
	out.sort_custom(func(a: Variant, b: Variant) -> bool:
		var na := Names.object_name(view, str(a))
		var nb := Names.object_name(view, str(b))
		return na < nb if na != nb else str(a) < str(b))
	return out


## The stage's line and its cards' state: chosen ones lifted (dropped, for the bottom) with their mark.
func _refresh_stage(marks: Dictionary) -> void:
	if stage == null:
		return
	var n := chosen.size()
	match _stage_kind:
		"search":
			var size := J.arr(J.dict(J.dict(view, "zones"), "library"), _stage_owner).size()
			stage.set_subtitle("%s (%d chosen). %d of the %s in %s can be chosen." % [Names.count_text(_lo, _hi), n, _options.size(),
				Names.plural(size, "card"), _whose_library()])
		"hand":
			stage.set_subtitle("%s (%d chosen). %d of the %s can be chosen." % [Names.count_text(_lo, _hi), n, _options.size(),
				Names.plural(_stage_cards.size(), "revealed card")])
		"bottom":
			var taken := J.int_of(Names.find_player(view, J.str_of(decision, "player")), "mulligans")
			var cards := Names.plural(_lo, "card")
			stage.set_subtitle("Your new hand after %s: click %s to put on the bottom of your library (%d of %d chosen).%s" % [
				"a mulligan" if taken == 1 else "%d mulligans" % taken, "the card" if _lo == 1 else "the %s" % cards, n, _lo,
				" The first one you pick goes to the very bottom." if _lo > 1 else ""])
	for id: Variant in _stage_cards:
		var sc: PromptStage.StageCard = _stage_cards[id]
		var at := chosen.find(id)
		var mark := ""
		if at >= 0:
			if _stage_kind == "bottom":
				mark = "Bottom %d" % (at + 1) if _lo > 1 else "Bottom"
			else:
				mark = str(marks.get(id, "Chosen"))
		sc.set_selected(at >= 0, mark)


func toggle_id(id: String) -> void:
	if not _options.has(id):
		return
	chosen = Names.toggle(chosen, id, _hi)
	_refresh()


func _on_card_clicked(id: String) -> void:
	toggle_id(id)


func _on_clear() -> void:
	chosen = []
	_refresh()


func _refresh() -> void:
	var ordered := J.bool_of(decision, "ordered")
	var marks := {}
	if ordered:
		for i: int in chosen.size():
			marks[chosen[i]] = str(i + 1)
	for id: Variant in _options:
		update_chip(str(id), chosen.has(id), str(marks.get(id, "")))
	var text: String = "%s (%d chosen)" % [Names.count_text(_lo, _hi), chosen.size()]
	text += "; the order you click them in is the order used." if ordered else "."
	set_detail(text)
	var problem := limit_problem()
	set_problem(problem)
	var ok := chosen.size() >= _lo and chosen.size() <= _hi and problem == ""
	set_ok(ok, "Put on the bottom" if is_mulligan_bottom() else "OK")
	_clear_button.disabled = chosen.is_empty()
	publish_selection(_options, chosen, marks)
	_refresh_stage(marks)


## Why the chosen objects break the decision's `limit` ("" when they keep it): "up to two creature cards with total mana value 4 or
## less" (CR 608.2d, 115.1). The engine checks it too (core/validate.ts).
func limit_problem() -> String:
	var limit := J.dict(decision, "limit")
	if limit.is_empty():
		return ""
	var values := J.dict(limit, "values")
	var sum := 0
	for id: Variant in chosen:
		sum += J.to_int(values.get(id, 0))
	var value := J.int_of(limit, "value")
	var op := J.str_of(limit, "op")
	var holds := true
	match op:
		"<=":
			holds = sum <= value
		">=":
			holds = sum >= value
		"==":
			holds = sum == value
		"!=":
			holds = sum != value
		"<":
			holds = sum < value
		">":
			holds = sum > value
	if holds:
		return ""
	var stat := J.str_of(limit, "stat")
	return "The chosen cards' total %s is %d; it must be %s %d (CR 608.2d)." % [str(STAT_WORDS.get(stat, stat)), sum, op, value]


## The cards a mulligan puts on the bottom of the library (CR 103.5): a choice from the deciding player's own new hand before the first
## turn, cited to CR 103.5, which only the mulligan asks.
func is_mulligan_bottom() -> bool:
	if J.int_of(J.dict(view, "turn"), "number") > 0 or not J.strings(decision, "rules").has("CR 103.5") or _options.is_empty():
		return false
	var me := J.str_of(decision, "player")
	for id: Variant in _options:
		var o := Names.object_of(view, str(id))
		if J.str_of(o, "zone") != "hand" or J.str_of(o, "owner") != me:
			return false
	return true


func _on_ok() -> void:
	send_answer({"kind": "chooseObjects", "ids": chosen.duplicate()})
