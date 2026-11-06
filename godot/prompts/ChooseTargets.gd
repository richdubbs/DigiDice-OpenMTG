extends "res://prompts/PromptBase.gd"
## chooseTargets (CR 601.2c, 115): click the legal targets the engine offers, cards and players, here or on the board. min 0 is
## "up to" (CR 115.1); OK is enabled when the count is within min..max ("No targets" when none is chosen and none is required).
## Like the browser's prompt bar, a choice whose one legal target is a single opponent is answered at once (`auto_answer`).
## Answer: {kind:'chooseTargets', targets: [{kind:'object'|'player', id}]}.

var chosen: Array = []
var _objects: Array = []
var _players: Array = []
var _lo: int = 0
var _hi: int = 0


func _build() -> void:
	_objects = J.strings(decision, "objects")
	_players = J.strings(decision, "players")
	_lo = J.int_of(decision, "min")
	_hi = J.int_of(decision, "max")
	var none := _objects.is_empty() and _players.is_empty()
	set_detail("%s: %s. %s" % [Names.count_text(_lo, _hi), J.str_of(decision, "targetText"),
		"Nothing can be targeted." if none else "Only legal targets can be chosen."])
	if not _players.is_empty():
		var labels := {}
		var me := Names.viewer(view)
		for p: Variant in _players:
			var pid := str(p)
			labels[pid] = "%s (you)" % Names.player_name(view, pid) if pid == me else Names.player_name(view, pid)
		add_chips(body, _players, toggle_id, labels)
	if not _objects.is_empty():
		add_chips(body, _objects, toggle_id)
	if auto_answer and _objects.is_empty() and _players.size() == 1 and _lo == 1 and str(_players[0]) != Names.viewer(view):
		send_answer_deferred({"kind": "chooseTargets", "targets": [{"kind": "player", "id": str(_players[0])}]})


func toggle_id(id: String) -> void:
	if not _objects.has(id) and not _players.has(id):
		return
	chosen = Names.toggle(chosen, id, _hi)
	_refresh()


func _on_card_clicked(id: String) -> void:
	toggle_id(id)


func _refresh() -> void:
	for id: Variant in _objects + _players:
		update_chip(str(id), chosen.has(id))
	var ok := chosen.size() >= _lo and chosen.size() <= _hi
	set_ok(ok, "No targets" if chosen.is_empty() and _lo == 0 else "Choose targets")
	publish_selection(_objects + _players, chosen)


## The answer's TargetChoice list, in click order.
func targets() -> Array:
	var out: Array = []
	for id: Variant in chosen:
		var sid := str(id)
		var is_p := _players.has(sid) and Names.is_player(view, sid)
		out.append({"kind": "player" if is_p else "object", "id": sid})
	return out


func _on_ok() -> void:
	send_answer({"kind": "chooseTargets", "targets": targets()})
