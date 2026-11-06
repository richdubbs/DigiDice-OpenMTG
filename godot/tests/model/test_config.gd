extends GdUnitTestSuite
## model/Config.gd against the browser's packages/client/src/game/config.ts: tests/fixtures/config/build_config.json holds
## buildGameConfig's output for invented decks and stub definitions (or its ConfigBuildError), and the answers of its helpers.

const FILE: String = "res://tests/fixtures/config/build_config.json"


func _data() -> Dictionary:
	return Val.as_dict(JSON.parse_string(FileAccess.get_file_as_string(FILE)))


func test_build_game_config() -> void:
	var cases := Val.list(_data(), "cases")
	assert_int(cases.size()).is_greater(0)
	for c: Variant in cases:
		var d := Val.as_dict(c)
		var case_name := Val.text(d, "name")
		var built := Config.build_game_config(Val.dict(d, "args"))
		if d.has("error"):
			assert_bool(Val.flag(built, "ok")).override_failure_message(case_name).is_false()
			assert_str(Val.text(built, "error")).override_failure_message(case_name).is_equal(Val.text(d, "error"))
		else:
			assert_bool(Val.flag(built, "ok")).override_failure_message("%s: %s" % [case_name, Val.text(built, "error")]).is_true()
			assert_bool(Patch.json_equal(built.get("config"), d.get("config"), false)).override_failure_message(
				"%s:\n%s\nexpected\n%s" % [case_name, JSON.stringify(built.get("config")), JSON.stringify(d.get("config"))]).is_true()


func test_helpers() -> void:
	var h := Val.dict(_data(), "helpers")
	for c: Variant in Val.list(h, "randomSeat"):
		var d := Val.as_dict(c)
		assert_int(Config.random_seat(Val.text(d, "seed"), Val.num(d, "seats"))).override_failure_message(Val.text(d, "seed")).is_equal(Val.num(d, "seat"))
	for c: Variant in Val.list(h, "seatAtRandom"):
		var d := Val.as_dict(c)
		var order := Config.seat_at_random([0, 1, 2, 3], Val.text(d, "seed"))
		assert_bool(Patch.json_equal(order, d.get("order"))).override_failure_message(Val.text(d, "seed")).is_true()
	for c: Variant in Val.list(h, "playerName"):
		var d := Val.as_dict(c)
		assert_str(Config.player_name(Val.text(d, "typed"))).is_equal(Val.text(d, "name"))
	for c: Variant in Val.list(h, "startingLife"):
		var d := Val.as_dict(c)
		assert_int(Config.starting_life_for(Val.text(d, "format"), Val.num(d, "players"))).is_equal(Val.num(d, "life"))
	for c: Variant in Val.list(h, "offeredFormat"):
		var d := Val.as_dict(c)
		# The TypeScript answers null for "not offered"; the port answers "".
		assert_str(Config.offered_format(Val.text(d, "format"))).is_equal(Val.text(d, "offered", ""))
	for c: Variant in Val.list(h, "unplayable"):
		var d := Val.as_dict(c)
		assert_str(Config.unplayable_reason(Val.dict(d, "deck"), Val.text(d, "format"))).is_equal(Val.text(d, "reason", ""))
