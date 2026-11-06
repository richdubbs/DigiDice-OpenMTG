class_name LogView
extends PanelContainer
## The game log (the view's `log`; the browser's board/GameLog.tsx), closed by default, opening upward from the bottom left: newest
## entry first, each with its turn ("T3"), the private text a line carries when the viewer is among its players, else its public
## text (CR 400.2: the view already carries only what the viewer may read), and its rule citations (every entry carries `rules`).
## A filter by turn (All turns, This turn, Turn n) and More / Less: closed up, the latest COLLAPSED_ENTRIES only. Warnings and
## manual steps are coloured. Rebuilt only when the log, the filter or More changed.

const COLLAPSED_ENTRIES: int = 30

@onready var _toggle: Button = %Toggle
@onready var _text: RichTextLabel = %Text

var _view: Dictionary = {}
var _shown_key: String = ""
var _head: HBoxContainer = null
var _filter: OptionButton = null
var _more: Button = null
var _expanded: bool = false
## "all", "current" or a turn number as text.
var _turn_filter: String = "all"
var _turns: Array = []


func _ready() -> void:
	_toggle.toggled.connect(_on_toggled)
	_head = HBoxContainer.new()
	_head.add_theme_constant_override("separation", 8)
	_head.visible = false
	_filter = OptionButton.new()
	_filter.tooltip_text = "Filter log by turn"
	_filter.item_selected.connect(func(i: int) -> void:
		_turn_filter = String(_filter.get_item_metadata(i))
		_shown_key = ""
		_render())
	_head.add_child(_filter)
	_more = Button.new()
	_more.text = "More"
	_more.pressed.connect(func() -> void:
		_expanded = not _expanded
		_more.text = "Less" if _expanded else "More"
		_text.custom_minimum_size.y = 520.0 if _expanded else 260.0
		_shown_key = ""
		_render()
		_fit.call_deferred())
	_head.add_child(_more)
	var box := _toggle.get_parent()
	box.add_child(_head)
	box.move_child(_head, _toggle.get_index() + 1)


func show_view(view: Dictionary) -> void:
	_view = view
	if _text.visible:
		_render()


func _on_toggled(on: bool) -> void:
	_text.visible = on
	_head.visible = on
	_toggle.text = "Hide log" if on else "Game log"
	if on:
		_shown_key = ""
		_render()
	_fit.call_deferred()


## The log keeps its bottom edge and grows or shrinks upward with its content.
func _fit() -> void:
	offset_top = offset_bottom - get_combined_minimum_size().y


func _fill_filter(turns: Array) -> void:
	if turns == _turns and _filter.item_count > 0:
		return
	_turns = turns
	_filter.clear()
	_filter.add_item("All turns")
	_filter.set_item_metadata(0, "all")
	_filter.add_item("This turn")
	_filter.set_item_metadata(1, "current")
	for t: Variant in turns:
		_filter.add_item("Turn %d" % int(t))
		_filter.set_item_metadata(_filter.item_count - 1, str(int(t)))
	for i: int in _filter.item_count:
		if String(_filter.get_item_metadata(i)) == _turn_filter:
			_filter.select(i)


func _render() -> void:
	var entries := View.log_entries(_view)
	var current_turn := int(Val.num(View.turn(_view), "number"))
	var key := "%d:%d:%s:%s:%d" % [entries.size(), Val.num(entries[entries.size() - 1], "seq") if not entries.is_empty() else -1, _turn_filter,
		_expanded, current_turn]
	if key == _shown_key:
		return
	_shown_key = key
	var turns := {}
	for e: Dictionary in entries:
		turns[int(Val.num(e, "turn"))] = true
	var turn_list: Array = turns.keys()
	turn_list.sort()
	_fill_filter(turn_list)
	var wanted := -1
	if _turn_filter == "current":
		wanted = current_turn
	elif _turn_filter != "all":
		wanted = int(_turn_filter)
	var shown: Array[Dictionary] = []
	for i: int in range(entries.size() - 1, -1, -1):
		var e: Dictionary = entries[i]
		if wanted < 0 or int(Val.num(e, "turn")) == wanted:
			shown.append(e)
	var total := shown.size()
	if not _expanded and shown.size() > COLLAPSED_ENTRIES:
		shown = shown.slice(0, COLLAPSED_ENTRIES)
	var me := View.viewer(_view)
	var lines: Array[String] = []
	for e: Dictionary in shown:
		var text := "[color=#7f8fa6]T%d[/color] %s" % [Val.num(e, "turn"), View.log_text(e, me).replace("[", "[lb]")]
		match Val.text(e, "level"):
			"warning", "error":
				text = "[color=#ffb070]%s[/color]" % text
			"manual":
				text = "[color=#ff8cff]%s[/color]" % text
			"action":
				text = "[color=#9fe3ff]%s[/color]" % text
		var rules: Array = Val.list(e, "rules")
		if not rules.is_empty():
			var cites: Array[String] = []
			for r: Variant in rules:
				cites.append("[bgcolor=#0d2340][color=#8fe9ff] %s [/color][/bgcolor]" % String(r).replace("[", "[lb]"))
			text += "  [font_size=11]%s[/font_size]" % " ".join(cites)
		lines.append(text)
	if lines.is_empty():
		lines.append("[color=#7f8fa6]Nothing yet.[/color]")
	if total > shown.size():
		lines.append("[color=#7f8fa6]%d older entries hidden.[/color]" % (total - shown.size()))
	_text.text = "\n".join(lines)
	_text.scroll_to_line(0)
