extends GdUnitTestSuite
## Settings.apply_desktop_settings: the desktop app's settings ("openmtg.settings.v1", as its browser storage kept them) as this
## app's, on a fresh Settings that writes nothing.

const S := preload("res://autoload/Settings.gd")


func _fresh() -> Node:
	var s: Node = auto_free(S.new())
	return s


func test_takes_the_desktop_settings() -> void:
	var s := _fresh()
	s.apply_desktop_settings({
		"animationSpeed": "fast", "showScryfallImages": false, "fullControl": true, "tableLayout": "focused", "cameraFollow": false,
		"sound": {"enabled": false, "master": 0.5, "interface": 0.25, "game": 0.75, "ambience": 0.0},
		"stops": {"ownTurn": ["upkeep", "main2"], "opponentTurn": ["end"]},
		"playerNames": ["Ann", "Bo", "Cy", "Di"],
		"railWidth": 400,
	})
	assert_str(s.animation_speed).is_equal("fast")
	assert_bool(s.scryfall_images).is_false()
	assert_bool(s.full_control).is_true()
	assert_str(s.table_layout).is_equal("focused")
	assert_bool(s.camera_follow).is_false()
	assert_bool(s.sound_on).is_false()
	assert_float(s.sound_volume).is_equal_approx(0.5, 0.0001)
	assert_float(s.volume_interface).is_equal_approx(0.25, 0.0001)
	assert_float(s.volume_game).is_equal_approx(0.75, 0.0001)
	assert_float(s.volume_ambience).is_equal_approx(0.0, 0.0001)
	assert_array(s.stops_own).contains_exactly(["upkeep", "main2"])
	assert_array(s.stops_opponent).contains_exactly(["end"])
	assert_array(s.player_names).contains_exactly(["Ann", "Bo", "Cy", "Di"])


func test_keeps_what_is_missing_or_wrong() -> void:
	var s := _fresh()
	var before_speed: String = s.animation_speed
	var before_layout: String = s.table_layout
	var before_names: Array = s.player_names.duplicate()
	s.apply_desktop_settings({"animationSpeed": "warp", "tableLayout": "sideways", "sound": {"master": 7}})
	assert_str(s.animation_speed).is_equal(before_speed)
	assert_str(s.table_layout).is_equal(before_layout)
	assert_array(s.player_names).contains_exactly(before_names)
	assert_float(s.sound_volume).is_between(0.0, 1.0)
