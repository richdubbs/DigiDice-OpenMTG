class_name CardPicker
extends VBoxContainer
## Search for a card and pick one of its printed sides (packages/client/src/images/CardPicker.tsx): a name box (2 letters or more,
## 250 ms after the last key), the first 5 results with "Show n more", and for a card with two pictures a choice of side.
## `picked` gives the image slot: its key, its label and the card's name.

signal picked(key: String, label: String, card: String)

const FIRST_RESULTS: int = 5

var _box: LineEdit = null
var _list: VBoxContainer = null
var _status: Label = null
var _timer: Timer = null
var _seq: int = 0
var _failed: bool = false


## A picker under the caption `caption`, its box filled with `query`.
static func make(caption: String, query: String = "") -> CardPicker:
	var p := CardPicker.new()
	p._build(caption, query)
	return p


func _build(caption: String, query: String) -> void:
	add_theme_constant_override("separation", 6)
	var label := Label.new()
	label.text = caption
	add_child(label)
	_box = LineEdit.new()
	_box.placeholder_text = "Card name"
	_box.text = query
	_box.text_changed.connect(func(_t: String) -> void: _timer.start(0.25))
	add_child(_box)
	_status = Hud.text("", 12)
	_status.visible = false
	add_child(_status)
	_list = VBoxContainer.new()
	_list.add_theme_constant_override("separation", 4)
	add_child(_list)
	_timer = Timer.new()
	_timer.one_shot = true
	_timer.timeout.connect(_search)
	add_child(_timer)
	if query.strip_edges().length() >= 2:
		_search.call_deferred()


func focus() -> void:
	_box.grab_focus()
	_box.caret_column = _box.text.length()


func _say(text: String, color: Color = Hud.MUTED) -> void:
	_status.text = text
	_status.visible = text != ""
	_status.add_theme_color_override("font_color", color)


func _clear() -> void:
	for c: Node in _list.get_children():
		c.queue_free()


func _search() -> void:
	var q := _box.text.strip_edges()
	_seq += 1
	var seq := _seq
	_clear()
	if q.length() < 2:
		_say("")
		return
	_say("Searching…")
	var r: Dictionary = await Server.get_json("/api/cards/search?q=%s" % q.uri_encode())
	if seq != _seq or not is_inside_tree():
		return
	if not bool(r["ok"]):
		_say("Search failed: %s" % r["error"], Color("#ff9bff"))
		if not _failed:
			Sound.cue("ui.error")
		_failed = true
		return
	_failed = false
	var data := Val.as_dict(r["data"])
	var cards: Array = Val.list(data, "cards")
	if cards.is_empty():
		_say("No card found.")
		return
	_say("")
	_show_results(cards, int(Val.num(data, "total")), FIRST_RESULTS)


func _show_results(cards: Array, total: int, shown: int) -> void:
	_clear()
	for i: int in mini(shown, cards.size()):
		var card := Val.as_dict(cards[i])
		var types: Array[String] = []
		for f: Variant in Val.list(card, "faces"):
			types.append(Val.text(Val.as_dict(f), "typeLine"))
		var b := Button.new()
		b.text = "%s   %s" % [Val.text(card, "name"), " // ".join(types)]
		b.alignment = HORIZONTAL_ALIGNMENT_LEFT
		b.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		b.pressed.connect(func() -> void: _choose(card))
		_list.add_child(b)
	if cards.size() > shown:
		var more := Button.new()
		more.flat = true
		more.text = "Show %d more" % (cards.size() - shown)
		more.alignment = HORIZONTAL_ALIGNMENT_LEFT
		more.add_theme_color_override("font_color", NeonTheme.colors()[0])
		more.pressed.connect(func() -> void: _show_results(cards, total, cards.size()))
		_list.add_child(more)
	elif total > cards.size():
		_list.add_child(Hud.text("%d more: type more of the name." % (total - cards.size()), 12))


## One picture: picked at once; two or more: which side.
func _choose(card: Dictionary) -> void:
	var slots := Pictures.slot_labels(card)
	var card_name := Val.text(card, "name")
	if slots.size() <= 1:
		var key := String(slots[0][0]) if not slots.is_empty() else card_name
		picked.emit(key, String(slots[0][1]) if not slots.is_empty() else card_name, card_name)
		return
	_clear()
	_list.add_child(Hud.text("%s has %d printed sides. Which one is this image?" % [card_name, slots.size()], 13, Hud.TEXT))
	var row := HFlowContainer.new()
	row.add_theme_constant_override("h_separation", 6)
	for s: Variant in slots:
		var pair: Array = s
		var b := Hud.button(String(pair[1]))
		b.pressed.connect(func() -> void: picked.emit(String(pair[0]), String(pair[1]), card_name))
		row.add_child(b)
	_list.add_child(row)
	var another := Button.new()
	another.flat = true
	another.text = "Another card"
	another.alignment = HORIZONTAL_ALIGNMENT_LEFT
	another.add_theme_color_override("font_color", NeonTheme.colors()[0])
	another.pressed.connect(_search)
	_list.add_child(another)
	(row.get_child(0) as Button).grab_focus.call_deferred()
