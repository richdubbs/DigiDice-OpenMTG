class_name BoardSelection
extends RefCounted
## Clicking cards and players on the board for a prompt (chooseObjects, chooseTargets, declareAttackers, declareBlockers, ...).
##
## The Table owns one BoardSelection and hands it to prompts as `client.selection` (prompts/README.md). A prompt says which ids
## may be clicked (`set_selectable`) and which are chosen so far (`set_selected`); the Table draws the glows and reports clicks
## through `card_clicked` / `player_clicked`. The prompt decides what a click means (toggle, pair an attacker with a defender, ...)
## and calls `set_selected` again. The prompt calls `clear()` when it is done; the Table also clears it whenever the prompt
## closes. While nothing is selectable, a click on a card opens that card's legal actions instead (the Table's own behaviour).
##
## Ids are object ids ("o12") or player ids ("p1"); one set holds both. Nothing here knows the rules: the decision lists what
## is allowed, and the engine checks the answer.

## A selectable card was clicked.
signal card_clicked(id: String)
## A selectable player (their life panel) was clicked.
signal player_clicked(id: String)
## The selectable or selected ids changed (the Table redraws the glows).
signal changed()

## id -> true
var selectable: Dictionary = {}
## id -> true
var selected: Dictionary = {}
## id -> a short text the Table draws beside that card (above it, never over its picture): "Attacks Ann", "2 damage", "1st".
var marks: Dictionary = {}
## Optional short text the Table shows near the board while selecting ("Choose up to two targets").
var hint: String = ""


func set_selectable(ids: Array) -> void:
	selectable.clear()
	for id: Variant in ids:
		selectable[str(id)] = true
	changed.emit()


func set_selected(ids: Array) -> void:
	selected.clear()
	for id: Variant in ids:
		selected[str(id)] = true
	changed.emit()


## Short texts to draw beside cards (id -> text); an empty Dictionary removes them.
func set_marks(new_marks: Dictionary) -> void:
	marks.clear()
	for id: Variant in new_marks.keys():
		marks[str(id)] = str(new_marks[id])
	changed.emit()


func mark_of(id: String) -> String:
	return String(marks.get(id, ""))


func clear() -> void:
	selectable.clear()
	selected.clear()
	marks.clear()
	hint = ""
	changed.emit()


## Whether a prompt is selecting (some id is selectable).
func is_active() -> bool:
	return not selectable.is_empty()


func can_select(id: String) -> bool:
	return selectable.has(id)


func is_selected(id: String) -> bool:
	return selected.has(id)


## The selected ids, in the order they were given.
func selected_ids() -> Array[String]:
	var out: Array[String] = []
	out.assign(selected.keys())
	return out


## Called by the Table when a card is clicked; true when the click went to the prompt.
func click_card(id: String) -> bool:
	if not selectable.has(id):
		return false
	card_clicked.emit(id)
	return true


## Called by the Table when a player's panel is clicked; true when the click went to the prompt.
func click_player(id: String) -> bool:
	if not selectable.has(id):
		return false
	player_clicked.emit(id)
	return true
