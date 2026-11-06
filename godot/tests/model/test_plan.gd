extends GdUnitTestSuite
## model/Plan.gd against the TypeScript source's packages/client/src/board/fx/plan.ts (`planBatch`).
##
## tests/fixtures/plans/*.json were exported from the TypeScript source: changes of seeded computer-against-computer games played through its
## LocalConnection (seat p1, as the table channel serves them), each {name, features, events, from, to, plan} where `plan` is the
## TypeScript source's own planBatch(events, from, to). Every text is a token (no card text is stored here); a name the spell look reads keeps
## its look with an invented word ("t12 bolt"); each object carries the `chars` summary (its colours after the layers). The views are
## trimmed to what a plan reads (no log, no rules of the definitions).

const DIR: String = "res://tests/fixtures/plans"


func _files() -> Array[String]:
	var out: Array[String] = []
	for f: String in DirAccess.get_files_at(DIR):
		if f.ends_with(".json"):
			out.append(f)
	out.sort()
	return out


func _load(file: String) -> Dictionary:
	return Val.as_dict(JSON.parse_string(FileAccess.get_file_as_string(DIR.path_join(file))))


func test_goldens_exist() -> void:
	assert_int(_files().size()).is_greater_equal(30)


func test_every_golden_plan() -> void:
	for f: String in _files():
		var g := _load(f)
		var events := Val.list(g, "events")
		var from := Val.dict(g, "from")
		var to := Val.dict(g, "to")
		var events_before := events.duplicate(true)
		var plan := Plan.plan_batch(events, from, to)
		# Key order is not part of a plan's meaning: compare as JSON values.
		assert_bool(Patch.json_equal(plan, g.get("plan"), false)) \
			.override_failure_message("%s (%s): plan differs\n got  %s\n want %s" % [f, Val.text(g, "name"), JSON.stringify(plan), JSON.stringify(g.get("plan"))]) \
			.is_true()
		# Planning never changes its input.
		assert_bool(Patch.json_equal(events, events_before)).override_failure_message("%s: events changed" % f).is_true()


func test_every_step_kind_is_covered() -> void:
	var kinds: Dictionary = {}
	for f: String in _files():
		for s: Variant in Val.list(Val.dict(_load(f), "plan"), "a"):
			kinds[Val.text(Val.as_dict(s), "kind")] = true
	for k: String in ["cast", "ability", "resolve", "combat", "damage", "life", "countered", "counters"]:
		assert_bool(kinds.has(k)).override_failure_message("no golden plan has a %s step" % k).is_true()


func test_stack_pace() -> void:
	assert_float(Plan.stack_pace(0)).is_equal(1.0)
	assert_float(Plan.stack_pace(5)).is_equal(1.0)
	assert_float(Plan.stack_pace(6)).is_equal_approx(25.0 / 36.0, 0.0001)
	assert_float(Plan.stack_pace(10)).is_equal(0.25)
	assert_float(Plan.stack_pace(40)).is_equal(0.25)


func test_stack_depths() -> void:
	var steps: Array = [{"kind": "cast"}, {"kind": "resolve"}, {"kind": "ability"}, {"kind": "countered"}, {"kind": "life"}]
	assert_str(str(Plan.stack_depths(steps, 2))).is_equal("[3, 3, 3, 3, 2]")


func test_classify_move() -> void:
	var from := {"objects": {"o1": {"id": "o1", "kind": "token", "defId": "x"}}, "lki": {}}
	var e := {"type": "zoneChanged", "oldId": "o1", "newId": "o2", "from": "battlefield", "to": "graveyard", "owner": "p1", "controller": "p1", "cause": "sacrifice"}
	var m := Plan.classify_move(e, from)
	assert_str(Val.text(m, "kind")).is_equal("sacrifice")
	assert_bool(Val.flag(m, "token")).is_true()
	e["cause"] = "destroy"
	assert_str(Val.text(Plan.classify_move(e, from), "kind")).is_equal("die")
	e["to"] = "exile"
	assert_str(Val.text(Plan.classify_move(e, from), "kind")).is_equal("exile")


func test_empty_plan() -> void:
	var plan := Plan.plan_batch([], {"zones": {"stack": []}}, {"zones": {"stack": []}})
	assert_bool(Plan.is_empty(plan)).is_true()
	assert_int(Plan.total_damage([{"amount": 3}, {"amount": 4}])).is_equal(7)
