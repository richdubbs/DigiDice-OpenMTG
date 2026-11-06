extends "res://prompts/PromptBase.gd"
## playFirst (CR 103.1): the chosen player decides who takes the first turn. One button per option; OK (Space) is "I play first" when
## the deciding player is an option, else the first option.
## Answer: {kind:'playFirst', player: PlayerId}.

var _first_choice: String = ""


func _build() -> void:
	var options := J.strings(decision, "options")
	var me := J.str_of(decision, "player")
	if options.has(me):
		_first_choice = me
	elif not options.is_empty():
		_first_choice = str(options[0])
	set_ok(_first_choice != "", _label_for(_first_choice))
	for p: Variant in options:
		var pid := str(p)
		if pid != _first_choice:
			add_action(_label_for(pid), "Player_" + pid, _choose.bind(pid))


func _label_for(pid: String) -> String:
	if pid == J.str_of(decision, "player"):
		return "I play first"
	return "%s plays first" % Names.player_name(view, pid)


func _on_ok() -> void:
	_choose(_first_choice)


func _choose(pid: String) -> void:
	if pid != "":
		send_answer({"kind": "playFirst", "player": pid})
