extends "res://prompts/PromptBase.gd"
## chooseColor (CR 105, 106): one button per offered color, a click answers. With a single color OK (Space) answers it.
## Answer: {kind:'chooseColor', color: ManaType}.


func _build() -> void:
	var options := J.strings(decision, "options")
	if options.size() == 1:
		var only := str(options[0])
		set_ok(true, "%s (%s)" % [Names.mana_name(only), only])
		return
	ok_button.visible = false
	var row := HFlowContainer.new()
	row.name = "Colors"
	for c: Variant in options:
		var color := str(c)
		var b := Button.new()
		b.name = ("Color_" + color).validate_node_name()
		b.text = "%s (%s)" % [Names.mana_name(color), color]
		b.pressed.connect(_choose.bind(color))
		row.add_child(b)
	body.add_child(row)


func _on_ok() -> void:
	var options := J.strings(decision, "options")
	if options.size() == 1:
		_choose(str(options[0]))


func _choose(color: String) -> void:
	send_answer({"kind": "chooseColor", "color": color})
