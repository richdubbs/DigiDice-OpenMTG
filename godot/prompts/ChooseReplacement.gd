extends "res://prompts/PromptBase.gd"
## chooseReplacement (CR 616.1): which replacement or prevention effect applies first. The options are grouped by their CR 616.1a-e
## class (`klass`), in the order they must be applied; one click answers.
## Answer: {kind:'chooseReplacement', id: string}.

## The classes a replacement or prevention effect falls into (CR 616.1a-e), with why these are the choices.
const CLASSES := {
	0: ["Self-replacement effects", "CR 616.1a", "One of these must apply first: they come from the spell or ability that causes the event (CR 614.15)."],
	1: ["Effects on who controls it as it enters", "CR 616.1b", "One of these must apply before any other effect."],
	2: ["Copy effects as it enters", "CR 616.1c", "One of these must apply before any effect but the ones above."],
	3: ["Entering with its back face up", "CR 616.1d", "One of these must apply before the remaining effects (CR 701.27, 701.28)."],
	4: ["Replacement and prevention effects", "CR 616.1e", "Any of these may apply first."],
}


func _build() -> void:
	ok_button.visible = false
	set_detail("%s chooses which effect applies first; the others may still apply afterwards, if they still apply (CR 616.1, 616.1f)." % Names.player_name(view, J.str_of(decision, "player")))
	var options := J.dicts(decision, "options")
	for klass: int in [0, 1, 2, 3, 4, -1]:
		var group: Array = []
		for o: Dictionary in options:
			if J.int_of(o, "klass", -1) == klass:
				group.append(o)
		if group.is_empty():
			continue
		if CLASSES.has(klass):
			var c: Array = CLASSES[klass]
			body.add_child(make_label("%s (%s). %s" % [c[0], c[1], c[2]], &"PromptDetail"))
		var column := VBoxContainer.new()
		for o: Dictionary in group:
			var oid := J.str_of(o, "id")
			var b := Button.new()
			b.name = ("Replacement_" + oid).validate_node_name()
			b.text = J.str_of(o, "label", oid)
			b.pressed.connect(_choose.bind(oid))
			column.add_child(b)
		body.add_child(column)


func _choose(oid: String) -> void:
	send_answer({"kind": "chooseReplacement", "id": oid})
