extends "res://prompts/PromptBase.gd"
## mulligan (CR 103.5): keep the hand or take a mulligan. OK (Space) keeps. Shows the hand, who goes first (CR 103.1), what the other
## players did, and what a mulligan will cost (London mulligan; the first one is free in Brawl, CR 903.12g, and in every multiplayer
## game, CR 103.5c, 800.6).
## Answer: {kind:'mulligan', keep: bool}.


func _build() -> void:
	var me := J.str_of(decision, "player")
	var hand := J.arr(J.dict(J.dict(view, "zones"), "hand"), me)
	var hand_names: Array = []
	for id: Variant in hand:
		hand_names.append(Names.object_name(view, str(id)))
	var mulligans := J.int_of(decision, "mulligans")
	var hand_size := J.int_of(decision, "handSize")
	var game_options := J.dict(view, "options")
	var multiplayer_free := J.has(game_options, "multiplayer")
	var free_count := 1 if (J.bool_of(J.dict(game_options, "commander"), "freeMulligan") or multiplayer_free) else 0
	var free_rules := "CR 103.5c, 800.6" if multiplayer_free else "CR 903.12g"
	var back := maxi(0, mulligans + 1 - free_count)
	var on_bottom := maxi(0, mulligans - free_count)
	var first := J.str_of(J.dict(view, "turn"), "startingPlayer")
	var lines: Array = []
	lines.append("You go first." if first == me else "%s goes first." % Names.player_name(view, first))
	var others := _opponents_status(me)
	if others != "":
		lines.append(others)
	var hand_line := "Your hand: %s." % (", ".join(J.packed(hand_names)) if not hand_names.is_empty() else "no cards")
	if mulligans > 0:
		hand_line += " You took %s; %d card%s already on the bottom of your library." % [
			Names.plural(mulligans, "mulligan"), on_bottom, " is" if on_bottom == 1 else "s are"]
	lines.append(hand_line)
	set_detail("\n".join(J.packed(lines)))
	var hint := ""
	if hand_size > 0:
		if back == 0:
			hint = "Your first mulligan is free: it draws a new hand and puts nothing on the bottom of your library (%s)." % free_rules
		else:
			hint = "A mulligan draws a new hand: you will put %s from it on the bottom of your library." % Names.plural(back, "card")
	set_ok(true, "Keep %d" % hand.size())
	var mull := add_action("Mulligan (keep %d after)" % maxi(0, hand_size), "Mulligan", _on_mulligan)
	mull.disabled = hand_size <= 0
	# A mulligan is heard from its event on the board.
	mull.set_meta(&"sfx", "none")
	# Arena's opening screen: who goes first (CR 103.1), what the others did, the hand fanned out large.
	var st := open_stage("You go first" if first == me else "%s goes first" % Names.player_name(view, first), others, hint)
	if st != null:
		st.fan(view, hand)
	elif hint != "":
		body.add_child(make_label(hint, &"PromptDetail"))


## Who kept and with how many cards, who took mulligans, who decides after (CR 103.5: the starting player declares first).
func _opponents_status(me: String) -> String:
	var parts: Array = []
	var hands := J.dict(J.dict(view, "zones"), "hand")
	for p: Dictionary in Names.players(view):
		var pid := J.str_of(p, "id")
		if pid == me:
			continue
		var pname := J.str_of(p, "name", pid)
		if J.bool_of(p, "keptHand"):
			parts.append("%s kept a hand of %s." % [pname, Names.plural(J.arr(hands, pid).size(), "card")])
		elif J.int_of(p, "mulligans") > 0:
			parts.append("%s took %s." % [pname, Names.plural(J.int_of(p, "mulligans"), "mulligan")])
		else:
			parts.append("%s decides after you." % pname)
	return " ".join(J.packed(parts))


func _on_ok() -> void:
	# Keeping locks the hand in (game.keep, CR 103.5).
	if is_armed() and not _busy:
		Sound.cue("game.keep")
	send_answer({"kind": "mulligan", "keep": true})


func _on_mulligan() -> void:
	if J.int_of(decision, "handSize") > 0:
		send_answer({"kind": "mulligan", "keep": false})
