extends RefCounted
## A stand-in for the table's Selection helper (the prompt contract): remembers what a prompt published and lets a test click cards and
## players as the board would.

signal card_clicked(id: String)
signal player_clicked(id: String)

var selectable: Array = []
var selected: Array = []
var marks: Dictionary = {}
var cleared: int = 0


func set_selectable(ids: Array) -> void:
	selectable = ids.duplicate()


func set_selected(ids: Array) -> void:
	selected = ids.duplicate()


func set_marks(m: Dictionary) -> void:
	marks = m.duplicate()


func clear() -> void:
	selectable = []
	selected = []
	marks = {}
	cleared += 1


func click_card(id: String) -> void:
	card_clicked.emit(id)


func click_player(id: String) -> void:
	player_clicked.emit(id)
