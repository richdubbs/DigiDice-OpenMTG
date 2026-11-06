extends "res://prompts/PromptBase.gd"
## yesNo: one click. OK is the yes answer (Space), with the decision's own labels when it has them.
## Answer: {kind:'yesNo', yes: bool}.


func _build() -> void:
	set_ok(true, J.str_of(decision, "yesLabel", "Yes"))
	add_action(J.str_of(decision, "noLabel", "No"), "No", _on_no)


func _on_ok() -> void:
	send_answer({"kind": "yesNo", "yes": true})


func _on_no() -> void:
	send_answer({"kind": "yesNo", "yes": false})
