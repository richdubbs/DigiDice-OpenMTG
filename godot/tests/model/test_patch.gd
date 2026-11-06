extends GdUnitTestSuite
## model/Patch.gd against the TypeScript source's packages/engine/src/core/view-patch.ts.
##
## tests/fixtures/patches/*.json were exported from the TypeScript source with its own diffJson/applyPatch:
## each is {name, before, ops, after} or {name, before, ops, error} (refused), with `maxWork` when the vector tests the work
## bound. The engine views among them (view_*.json) are real views of a seeded computer-against-computer game with every text
## replaced by a token (no card text is stored here). The port must give the same JSON, key order included, and refuse
## exactly what the TypeScript refuses.

const DIR: String = "res://tests/fixtures/patches"


func _files() -> Array[String]:
	var out: Array[String] = []
	for f: String in DirAccess.get_files_at(DIR):
		if f.ends_with(".json"):
			out.append(f)
	out.sort()
	return out


func _load(file: String) -> Dictionary:
	return Val.as_dict(JSON.parse_string(FileAccess.get_file_as_string(DIR.path_join(file))))


func _deep_copy(v: Variant) -> Variant:
	if v is Dictionary:
		var d: Dictionary = v
		return d.duplicate(true)
	if v is Array:
		var a: Array = v
		return a.duplicate(true)
	return v


func test_vectors_exist() -> void:
	assert_int(_files().size()).is_greater_equal(60)


func test_every_vector() -> void:
	for f: String in _files():
		var v := _load(f)
		assert_bool(v.has("before") and v.has("ops")).override_failure_message("%s is not a vector" % f).is_true()
		var initial: Variant = v.get("before")
		var snapshot: Variant = _deep_copy(initial)
		var max_work: int = Val.num(v, "maxWork", Patch.PATCH_MAX_WORK)
		var r := Patch.apply(initial, v.get("ops"), max_work)
		if v.has("error"):
			assert_bool(Val.flag(r, "ok")).override_failure_message("%s should be refused (%s)" % [f, Val.text(v, "error")]).is_false()
		else:
			assert_bool(Val.flag(r, "ok")).override_failure_message("%s: %s" % [f, Val.text(r, "error")]).is_true()
			assert_bool(Patch.json_equal(r.get("value"), v.get("after"))).override_failure_message("%s: not the expected JSON" % f).is_true()
		# applyPatch never changes its input
		assert_bool(Patch.json_equal(initial, snapshot)).override_failure_message("%s changed its input" % f).is_true()


func test_work_bound_messages() -> void:
	var r := Patch.apply({"a": 1, "b": 2}, [{"op": "keys", "path": [], "keys": ["b", "a"]}], 4)
	assert_bool(Val.flag(r, "ok")).is_false()
	assert_str(Val.text(r, "error")).contains("more work than")


func test_shares_what_did_not_change() -> void:
	var prev: Dictionary = {"a": {"deep": [1, 2, 3]}, "b": {"untouched": {"n": 1}}, "c": [{"k": 1}]}
	var ops: Array = [
		{"op": "splice", "path": ["a", "deep"], "at": 3, "del": 0, "add": [4]},
		{"op": "set", "path": ["c", 0, "k"], "value": 2},
	]
	var r := Patch.apply(prev, ops)
	assert_bool(Val.flag(r, "ok")).is_true()
	var out: Dictionary = r["value"]
	assert_bool(is_same(out["b"], prev["b"])).is_true()
	assert_bool(is_same(out["a"], prev["a"])).is_false()
	assert_bool(Patch.json_equal(prev["a"]["deep"], [1, 2, 3])).is_true()
	assert_bool(Patch.json_equal(out, {"a": {"deep": [1, 2, 3, 4]}, "b": {"untouched": {"n": 1}}, "c": [{"k": 2}]})).is_true()


func test_a_container_is_copied_once() -> void:
	# Two ops into the same list: the second must change the copy the first made, not the original.
	var prev: Dictionary = {"l": [1, 2, 3]}
	var r := Patch.apply(prev, [
		{"op": "set", "path": ["l", 0], "value": 9},
		{"op": "splice", "path": ["l"], "at": 0, "del": 0, "add": [0]},
		{"op": "set", "path": ["l", 1], "value": 8},
	])
	assert_bool(Patch.json_equal(Val.dict(r, "value"), {"l": [0, 8, 2, 3]})).is_true()
	assert_bool(Patch.json_equal(prev, {"l": [1, 2, 3]})).is_true()


func test_js_key_order() -> void:
	assert_bool(Patch.json_equal(Patch.js_order(["b", "10", "2", "a", "01"]), ["2", "10", "b", "a", "01"])).is_true()
	assert_bool(Patch.is_array_index_key("0")).is_true()
	assert_bool(Patch.is_array_index_key("4294967294")).is_true()
	assert_bool(Patch.is_array_index_key("4294967295")).is_false()
	assert_bool(Patch.is_array_index_key("01")).is_false()
	assert_bool(Patch.is_array_index_key("-1")).is_false()


func test_json_equal_counts_key_order() -> void:
	assert_bool(Patch.json_equal({"a": 1, "b": 2}, {"b": 2, "a": 1})).is_false()
	assert_bool(Patch.json_equal({"a": 1, "b": 2}, {"b": 2, "a": 1}, false)).is_true()
	assert_bool(Patch.json_equal({"n": 3}, {"n": 3.0})).is_true()
	assert_bool(Patch.json_equal({"n": null}, {"n": 0})).is_false()


## nextView, as the TypeScript test "nextView: applies a patch to the view of its base only" and "the result must be a view of
## the same viewer".
func test_next_view() -> void:
	var v1: Dictionary = {"viewer": "p1", "turn": 1}
	var ops: Array = [{"op": "set", "path": ["turn"], "value": 2}]
	var ok := Patch.next_view({"seq": 4, "view": v1}, {"seq": 5, "base": 4, "ops": ops})
	assert_int(Val.num(ok, "seq")).is_equal(5)
	assert_bool(Patch.json_equal(Val.dict(ok, "view"), {"viewer": "p1", "turn": 2})).is_true()
	assert_bool(Patch.next_view({"seq": 3, "view": v1}, {"seq": 5, "base": 4, "ops": ops}).is_empty()).is_true()
	assert_bool(Patch.next_view({}, {"seq": 5, "base": 4, "ops": ops}).is_empty()).is_true()
	assert_bool(Patch.next_view({"seq": 4, "view": v1}, {"seq": 4, "base": 4, "ops": ops}).is_empty()).is_true()
	assert_bool(Patch.next_view({"seq": 4, "view": v1}, {"seq": 5, "base": 4, "ops": [{"op": "del", "path": ["nope"]}]}).is_empty()).is_true()
	for value: Variant in [42, null, "view", [1, 2], {"viewer": "p2", "turn": 2}, {"turn": 2}]:
		var refused := Patch.next_view({"seq": 1, "view": v1}, {"seq": 2, "base": 1, "ops": [{"op": "set", "path": [], "value": value}]})
		assert_bool(refused.is_empty()).override_failure_message(JSON.stringify(value)).is_true()
	assert_bool(Patch.next_view({"seq": 1, "view": v1}, {"seq": 2, "base": 1, "ops": [{"op": "del", "path": ["viewer"]}]}).is_empty()).is_true()
	assert_bool(Patch.next_view({"seq": 1, "view": v1}, {"seq": 2, "base": 1, "ops": [{"op": "set", "path": ["viewer"], "value": "p2"}]}).is_empty()).is_true()
	var spectator: Dictionary = {"viewer": null, "turn": 1}
	var still := Patch.next_view({"seq": 1, "view": spectator}, {"seq": 2, "base": 1, "ops": ops})
	assert_bool(Patch.json_equal(Val.dict(still, "view"), {"viewer": null, "turn": 2})).is_true()
