extends GdUnitTestSuite
## model/ArtSeed.gd against the browser's packages/client/src/cards/artSeed.ts and CardArt.tsx `planArt`:
## tests/fixtures/art/art_seeds.json holds, for invented card names, the hash, the first numbers of the generator, the first
## numbers of the generator seeded with the hash xor 0x9e3779b9 (the light of a one-colour card), and the plan.

const FILE: String = "res://tests/fixtures/art/art_seeds.json"


func _cases() -> Array:
	return Val.as_list(JSON.parse_string(FileAccess.get_file_as_string(FILE)))


func test_hash_generator_and_plan() -> void:
	var cases := _cases()
	assert_int(cases.size()).is_greater(0)
	for c: Variant in cases:
		var d := Val.as_dict(c)
		var case_name := Val.text(d, "name")
		var h := ArtSeed.hash_string(case_name)
		assert_int(h).override_failure_message("hash of '%s'" % case_name).is_equal(Val.num(d, "hash"))
		var rng := ArtSeed.rng_of(h)
		for x: Variant in Val.list(d, "rng"):
			assert_float(rng.next()).override_failure_message("generator of '%s'" % case_name).is_equal_approx(Val.as_float(x), 1e-12)
		var rng2 := ArtSeed.rng_of(h ^ 0x9e3779b9)
		for x: Variant in Val.list(d, "rngXor"):
			assert_float(rng2.next()).override_failure_message("second generator of '%s'" % case_name).is_equal_approx(Val.as_float(x), 1e-12)
		var colors: Array[String] = Val.texts(d, "colors")
		var plan := ArtSeed.plan_art(colors, Val.text(d, "typeLine"), Val.text(d, "oracleText"))
		var expected := Val.dict(d, "plan")
		assert_bool(Patch.json_equal(plan["flavors"], expected["flavors"])).override_failure_message("flavors of '%s'" % case_name).is_true()
		assert_bool(plan["land"] == Val.flag(expected, "land")).override_failure_message("land of '%s'" % case_name).is_true()
		assert_str(String(plan["primary"])).override_failure_message("primary of '%s'" % case_name).is_equal(Val.text(expected, "primary"))
		assert_bool(plan["gear"] == Val.flag(expected, "gear")).override_failure_message("gear of '%s'" % case_name).is_true()


func test_imul_matches_javascript() -> void:
	# Math.imul(0x7fffffff, 3) = 2147483645; Math.imul(0xffffffff, 5) = -5 (as unsigned 4294967291).
	assert_int(ArtSeed.imul(0x7fffffff, 3)).is_equal(2147483645)
	assert_int(ArtSeed.imul(0xffffffff, 5)).is_equal(4294967291)
	assert_int(ArtSeed.imul(0x811c9dc5, 0x01000193)).is_equal(0x811c9dc5 * 0x01000193 & 0xFFFFFFFF)


func test_art_params_shape() -> void:
	var blue: Array[String] = ["U"]
	var one := ArtSeed.art_params("Placeholder Tide", blue, "Instant", "")
	assert_int(int(one["count"])).is_equal(1)
	assert_int(Val.as_list(one["glows"]).size()).is_equal(1)
	var all: Array[String] = ["W", "U", "B", "R", "G"]
	var three := ArtSeed.art_params("Mixed Signal", all, "Creature — Human", "")
	assert_int(int(three["count"])).is_equal(3)
	assert_int(Val.as_list(three["seams"]).size()).is_equal(2)
	assert_bool(bool(three["gold"])).is_true()
