extends GdUnitTestSuite
## model/View.gd and model/Chars.gd on real engine views (the `after` views of tests/fixtures/patches/view_*.json: a seeded
## computer-against-computer game, texts replaced by tokens, card types and colours kept).


func _views() -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	var dir := "res://tests/fixtures/patches"
	for f: String in DirAccess.get_files_at(dir):
		if f.begins_with("view_") and f.ends_with(".json"):
			var v := Val.as_dict(JSON.parse_string(FileAccess.get_file_as_string(dir.path_join(f))))
			out.append(Val.dict(v, "after"))
	return out


func test_reads_every_fixture_view() -> void:
	var views := _views()
	assert_int(views.size()).is_greater(0)
	for view: Dictionary in views:
		var ids := View.player_ids(view)
		assert_int(ids.size()).is_equal(2)
		var on_battlefield := View.shared_zone(view, "battlefield")
		var counted: int = 0
		for pid: String in ids:
			# Every permanent is in exactly one row or drawn under its host.
			var rows := View.rows_of(view, pid)
			var row_ids: Array = rows["creatures"] + rows["lands"] + rows["others"]
			var attached: int = 0
			for id: String in View.battlefield_of(view, pid):
				var host := Val.text(View.object(view, id), "attachedTo")
				if host != "" and Val.text(View.object(view, host), "zone") == "battlefield":
					attached += 1
			assert_int(row_ids.size() + attached).is_equal(View.battlefield_of(view, pid).size())
			counted += View.battlefield_of(view, pid).size()
			# Hands of the other player are hidden in a player's view; the viewer's own are not.
			for id: String in View.hand_of(view, pid):
				var hidden := View.is_hidden(View.object(view, id))
				if View.viewer(view) != "":
					assert_bool(hidden).is_equal(pid != View.viewer(view))
		assert_int(counted).is_equal(on_battlefield.size())
		for id: String in on_battlefield:
			var obj := View.object(view, id)
			assert_bool(obj.is_empty()).is_false()
			if not View.is_hidden(obj):
				var chars := Chars.of(view, obj)
				assert_bool(chars.has("types")).is_true()
				assert_bool(View.name_of(view, obj) != "").is_true()
		var pending := View.pending(view)
		if not pending.is_empty():
			assert_bool(pending.has("kind") and pending.has("id")).is_true()


func test_mana_text() -> void:
	var cost: Array = [
		{"kind": "generic", "amount": 2.0}, {"kind": "colored", "color": "G"}, {"kind": "hybrid", "colors": ["W", "U"]},
		{"kind": "phyrexian", "color": "B"}, {"kind": "variable", "name": "X"}, {"kind": "snow"}, {"kind": "colorless"},
		{"kind": "monoHybrid", "color": "R", "generic": 2}, {"kind": "hybridPhyrexian", "colors": ["G", "U"]}, {"kind": "colorlessHybrid", "color": "W"},
	]
	assert_str(Chars.mana_text(cost)).is_equal("{2}{G}{W/U}{B/P}{X}{S}{C}{2/R}{G/U/P}{C/W}")
	assert_str(Chars.mana_text(null)).is_equal("")


func test_log_text_shows_private_text_to_its_players() -> void:
	var entry: Dictionary = {"seq": 1, "turn": 1, "text": "p1 draws a card.", "privateText": {"players": ["p1"], "text": "p1 draws Test Card."}}
	assert_str(View.log_text(entry, "p1")).is_equal("p1 draws Test Card.")
	assert_str(View.log_text(entry, "p2")).is_equal("p1 draws a card.")
	assert_str(View.log_text(entry, "")).is_equal("p1 draws a card.")


## View schema 2: the summary is read from `view.chars[id]` first (numbers as integers, null as "*", absent as ""; the abilities'
## readings as the rules text; keywords capitalised for display; the summary's controller and summoning sickness), then from
## `obj.chars` (how the plan goldens carry it), and a hidden object has none.
func test_chars_summary_from_the_view() -> void:
	var view: Dictionary = {
		"viewer": "p1",
		"players": [{"id": "p1", "name": "Ann"}, {"id": "p2", "name": "Bob"}],
		"zones": {"battlefield": ["o1", "o2", "o3"]},
		"objects": {
			"o1": {"id": "o1", "defId": "d1", "owner": "p2", "controller": "p2", "zone": "battlefield", "counters": {}},
			"o2": {"id": "o2", "defId": "d1", "owner": "p1", "controller": "p1", "zone": "battlefield", "counters": {},
				"chars": {"name": "Golden", "colors": ["G"], "types": ["Creature"], "power": "2", "toughness": "2"}},
			"o3": {"id": "o3", "defId": "__hidden__", "owner": "p2", "controller": "p2", "zone": "battlefield"},
		},
		"defs": {"d1": {"id": "d1", "name": "Printed", "faces": [{"name": "Printed", "types": ["Creature"], "power": "1", "toughness": "1"}]}},
		"chars": {
			"o1": {
				"name": "Taken", "manaCost": [{"kind": "generic", "amount": 1.0}, {"kind": "colored", "color": "R"}], "manaValue": 2.0,
				"colors": ["R"], "supertypes": [], "types": ["Creature"], "subtypes": ["Elf"], "controller": "p1",
				"power": 3.0, "toughness": null, "keywords": ["first strike", "haste"],
				"abilities": [{"key": "p:0:0", "text": "First strike"}, {"key": "p:0:1", "text": "Do it by hand.", "manual": true}],
				"summoningSick": true,
			},
		},
	}
	var c := Chars.of_id(view, "o1")
	assert_str(Val.text(c, "name")).is_equal("Taken")
	assert_str(Val.text(c, "mana_cost")).is_equal("{1}{R}")
	assert_int(Val.num(c, "mana_value")).is_equal(2)
	assert_str(Val.text(c, "type_line")).is_equal("Creature — Elf")
	assert_str(Val.text(c, "power")).is_equal("3")
	assert_str(Val.text(c, "toughness")).is_equal("*")
	assert_str(Val.text(c, "loyalty")).is_equal("")
	assert_str(Val.text(c, "text")).is_equal("First strike\nDo it by hand.")
	assert_array(Val.texts(c, "keywords")).contains_exactly(["first strike", "haste"])
	assert_array(Val.texts(c, "keyword_names")).contains_exactly(["First strike", "Haste"])
	assert_str(Val.text(c, "controller")).is_equal("p1")
	assert_bool(Val.flag(c, "sick_known")).is_true()
	assert_bool(Val.flag(c, "summoning_sick")).is_true()
	assert_bool(Val.flag(c, "approximate")).is_false()
	assert_bool(Val.flag(Val.as_dict(Val.list(c, "abilities")[1]), "manual")).is_true()
	# Control after layer 2: o1 sits on p1's side although the object's own field says p2.
	assert_array(View.battlefield_of(view, "p1")).contains_exactly(["o1", "o2"])
	# The plan goldens' place: obj.chars, power as text, the controller from the object.
	var g := Chars.of_id(view, "o2")
	assert_str(Val.text(g, "name")).is_equal("Golden")
	assert_str(Val.text(g, "power")).is_equal("2")
	assert_str(Val.text(g, "controller")).is_equal("p1")
	assert_bool(Val.flag(g, "sick_known")).is_false()
	# A hidden object has no summary.
	assert_bool(Chars.of_id(view, "o3").is_empty()).is_true()
	# Without view.chars, the printed face (approximate).
	view.erase("chars")
	var p := Chars.of_id(view, "o1")
	assert_str(Val.text(p, "name")).is_equal("Printed")
	assert_str(Val.text(p, "power")).is_equal("1")
	assert_str(Val.text(p, "controller")).is_equal("p2")
	assert_bool(Val.flag(p, "approximate")).is_true()
