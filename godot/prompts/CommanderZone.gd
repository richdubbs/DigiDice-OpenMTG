extends "res://prompts/PromptBase.gd"
## commanderZone (CR 903.9): the commander's owner chooses whether it goes to the command zone.
##  - rule '903.9b': it would be put into its owner's hand or library (`zone`); it may go to the command zone instead (a replacement).
##  - rule '903.9a': it was put into a graveyard or exile (`zone`) since the last state-based action check (CR 704.6d).
## OK (Space) puts it into the command zone.
## Answer: {kind:'commanderZone', command: bool}.


func _build() -> void:
	var cname := commander_name()
	var zone := J.str_of(decision, "zone")
	var question := ""
	var stay := ""
	if J.str_of(decision, "rule") == "903.9b":
		question = "%s would be put into your %s. You may put it into the command zone instead (CR 903.9b)." % [cname, zone]
		stay = "Put %s into your %s" % [cname, zone]
	else:
		var where := "exile" if zone == "exile" else "your graveyard"
		question = "%s was put into %s. You may put it into the command zone (CR 903.9a, 704.6d)." % [cname, where]
		stay = "Leave %s in %s" % [cname, where]
	set_detail(question)
	set_ok(true, "Put %s into the command zone" % cname)
	wrap_action(ok_button)
	wrap_action(add_action(stay, "Stay", _on_stay))
	var st := open_stage("%s: to the command zone?" % cname, question)
	if st != null:
		var size := st.get_viewport_rect().size
		st.body.add_child(st.card(view, J.str_of(decision, "object"), clampf(size.x * 0.22, 140.0, 260.0)))


## The commander's name: from the visible object, else from the commander's definition (public, CR 903.6).
func commander_name() -> String:
	var object_id := J.str_of(decision, "object")
	var o := Names.object_of(view, object_id)
	if not o.is_empty() and J.str_of(o, "defId") != Names.HIDDEN_DEF:
		return Names.object_name(view, object_id)
	var card := J.str_of(decision, "card")
	for p: Dictionary in Names.players(view):
		for rec: Dictionary in J.dicts(p, "commanders"):
			if J.str_of(rec, "card") == card:
				var cd := J.dict(J.dict(view, "defs"), J.str_of(rec, "defId"))
				if J.str_of(cd, "name") != "":
					return J.str_of(cd, "name")
	return "Your commander"


func _on_ok() -> void:
	send_answer({"kind": "commanderZone", "command": true})


func _on_stay() -> void:
	send_answer({"kind": "commanderZone", "command": false})
