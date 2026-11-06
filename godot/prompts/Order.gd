extends "res://prompts/PromptBase.gd"
## order (CR 603.3b and other "in any order"): an ItemList with Move up / Move down. What first and last mean is in the engine's
## prompt. OK (Space) answers the order shown.
## Answer: {kind:'order', ids: string[]}.

@onready var list: ItemList = $Frame/Box/Body/List
@onready var up_button: Button = $Frame/Box/Body/Moves/Up
@onready var down_button: Button = $Frame/Box/Body/Moves/Down

var ids: Array = []
var _labels: Dictionary = {}


func _build() -> void:
	for item: Dictionary in J.dicts(decision, "items"):
		var iid := J.str_of(item, "id")
		ids.append(iid)
		_labels[iid] = item_label(J.str_of(item, "label", iid))
	up_button.pressed.connect(move.bind(-1))
	down_button.pressed.connect(move.bind(1))
	list.item_selected.connect(_on_item_selected)
	_fill(0 if not ids.is_empty() else -1)


## "Elvish Visionary: When ~ enters, draw a card." -> the source before the colon stands for "~" (CR 201.5).
static func item_label(text: String) -> String:
	var colon := text.find(": ")
	return Names.with_self_name(text, text.substr(0, colon)) if colon > 0 else text


func _fill(selected_index: int) -> void:
	list.clear()
	for i: int in ids.size():
		list.add_item("%d. %s" % [i + 1, str(_labels.get(ids[i], ids[i]))])
	if selected_index >= 0 and selected_index < ids.size():
		list.select(selected_index)
	_refresh()


func _selected_index() -> int:
	var sel := list.get_selected_items()
	return sel[0] if sel.size() > 0 else -1


## Move the selected item up (-1) or down (+1).
func move(delta: int) -> void:
	var i := _selected_index()
	var j := i + delta
	if i < 0 or j < 0 or j >= ids.size():
		return
	var tmp: Variant = ids[i]
	ids[i] = ids[j]
	ids[j] = tmp
	_fill(j)


func _on_item_selected(_index: int) -> void:
	_refresh()


func _refresh() -> void:
	var i := _selected_index()
	up_button.disabled = i <= 0
	down_button.disabled = i < 0 or i >= ids.size() - 1
	set_ok(true)


func _on_ok() -> void:
	send_answer({"kind": "order", "ids": ids.duplicate()})
