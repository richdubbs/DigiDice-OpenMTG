extends Node
## A stand-in for the GameClient autoload, with only what the prompt scenes read: `legal`, `selection` and `stops(player, stops)`.

const FakeSelection := preload("res://tests/prompts/fake_selection.gd")

var legal: Array = []
var selection: RefCounted = FakeSelection.new()
## Every stops(player, stops) call: [{player, stops}].
var stops_sent: Array = []


func stops(player: String, settings: Dictionary) -> void:
	stops_sent.append({"player": player, "stops": settings})
