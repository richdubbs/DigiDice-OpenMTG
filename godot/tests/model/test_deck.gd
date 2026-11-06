extends GdUnitTestSuite
## model/Deck.gd against the browser's packages/client/src/decks/textio.ts, stats.ts and model.ts: tests/fixtures/decks/deck_model.json
## holds their answers for invented decks (exports in the three formats and their file names, list headers, a line's name
## replaced, the left-out maybeboard text, a deck's stats, and adding and moving cards).

const FILE: String = "res://tests/fixtures/decks/deck_model.json"


func _data() -> Dictionary:
	return Val.as_dict(JSON.parse_string(FileAccess.get_file_as_string(FILE)))


func test_export() -> void:
	for c: Variant in Val.list(_data(), "exports"):
		var d := Val.as_dict(c)
		var deck := Val.dict(d, "deck")
		var kind := Val.text(d, "kind")
		var label := "%s / %s" % [Val.text(deck, "name"), kind]
		assert_str(DeckModel.export_text(deck, kind)).override_failure_message(label).is_equal(Val.text(d, "text"))
		assert_str(DeckModel.export_file_name(Val.text(deck, "name"), kind)).override_failure_message(label).is_equal(Val.text(d, "file"))


func test_read_header() -> void:
	for c: Variant in Val.list(_data(), "headers"):
		var d := Val.as_dict(c)
		var got := DeckModel.read_header(Val.text(d, "text"))
		assert_dict(got).override_failure_message(JSON.stringify(d)).is_equal(Val.dict(d, "header"))


func test_replace_line_name_and_ignored_text() -> void:
	var data := _data()
	for c: Variant in Val.list(data, "replace"):
		var d := Val.as_dict(c)
		assert_str(DeckModel.replace_line_name(Val.text(d, "text"), int(Val.num(d, "line")), Val.text(d, "from"), Val.text(d, "to"))) \
			.is_equal(Val.text(d, "out"))
	for c: Variant in Val.list(data, "ignored"):
		var d := Val.as_dict(c)
		assert_str(DeckModel.ignored_text(int(Val.num(d, "n")), Val.text(d, "verb"))).is_equal(Val.text(d, "text"))


func test_stats() -> void:
	var s := Val.dict(_data(), "stats")
	var cards := {}
	for c: Variant in Val.list(s, "cards"):
		cards[Val.text(Val.as_dict(c), "name")] = c
	var got := DeckModel.stats(Val.dict(s, "deck"), cards)
	var want := Val.dict(s, "out")
	for k: String in ["creatureCurve", "otherCurve"]:
		var a: Array = []
		for v: Variant in got[k]:
			a.append(int(v))
		var b: Array = []
		for v: Variant in Val.list(want, k):
			b.append(int(v))
		assert_array(a).override_failure_message(k).is_equal(b)
	assert_float(float(got["average"])).is_equal_approx(Val.real(want, "average"), 0.0001)
	assert_int(int(got["lands"])).is_equal(int(Val.num(want, "lands")))
	assert_int(int(got["notLoaded"])).is_equal(int(Val.num(want, "notLoaded")))
	for k: String in ["pips", "sources"]:
		var g: Dictionary = got[k]
		var w := Val.dict(want, k)
		for color: String in DeckModel.WUBRG:
			assert_int(int(g.get(color, 0))).override_failure_message("%s %s" % [k, color]).is_equal(int(Val.num(w, color)))
	var groups: Array = got["groups"]
	var want_groups: Array = Val.list(want, "groups")
	assert_int(groups.size()).is_equal(want_groups.size())
	for i: int in mini(groups.size(), want_groups.size()):
		var g := Val.as_dict(groups[i])
		var w := Val.as_dict(want_groups[i])
		assert_str(Val.text(g, "type")).is_equal(Val.text(w, "type"))
		assert_int(int(Val.num(g, "count"))).is_equal(int(Val.num(w, "count")))
		var subs: Array = []
		for sub: Variant in Val.list(g, "subtypes"):
			subs.append("%s %d" % [String(sub[0]), int(sub[1])])
		var want_subs: Array = []
		for sub: Variant in Val.list(w, "subtypes"):
			want_subs.append("%s %d" % [Val.text(Val.as_dict(sub), "name"), int(Val.num(Val.as_dict(sub), "count"))])
		assert_array(subs).override_failure_message(Val.text(w, "type")).is_equal(want_subs)


func test_add_and_move() -> void:
	var d := DeckModel.empty_deck("Changes", "modern", "t", "x")
	d["createdAt"] = "t"
	d["updatedAt"] = "t"
	for c: Variant in Val.list(_data(), "steps"):
		var s := Val.as_dict(c)
		var next: Dictionary
		match Val.text(s, "what"):
			"add bolt":
				next = DeckModel.add_card(d, "main", "Lightning Bolt", "o-bolt")
			"add 3 more":
				next = DeckModel.add_card(d, "main", "Lightning Bolt", "", 3)
			"add shock":
				next = DeckModel.add_card(d, "main", "Shock")
			"remove absent":
				next = DeckModel.add_card(d, "sideboard", "Shock", "", -1)
			"move 2 bolts":
				next = DeckModel.move_card(d, "main", "sideboard", "Lightning Bolt", 2)
			"move all shock":
				next = DeckModel.move_card(d, "main", "sideboard", "Shock")
			"remove 5 bolts":
				next = DeckModel.add_card(d, "main", "Lightning Bolt", "", -5)
			"oracle id added":
				next = DeckModel.add_card(d, "sideboard", "Shock", "o-shock", 1)
		var what := Val.text(s, "what")
		assert_bool(is_same(next, d)).override_failure_message("%s: unchanged" % what).is_equal(Val.flag(s, "same"))
		var want := Val.dict(s, "deck")
		for section: String in ["main", "sideboard"]:
			assert_str(JSON.stringify(Val.list(next, section))).override_failure_message("%s: %s" % [what, section]) \
				.is_equal(JSON.stringify(_ints(Val.list(want, section))))
		d = next


## Counts as whole numbers (JSON reads them as floats).
static func _ints(entries: Array) -> Array:
	var out: Array = []
	for e: Variant in entries:
		var entry := Val.as_dict(e).duplicate()
		entry["count"] = int(Val.num(entry, "count"))
		out.append(entry)
	return out
