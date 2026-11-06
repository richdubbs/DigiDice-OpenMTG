extends GdUnitTestSuite
## The pure parts of the animations and sounds against the TypeScript source (expected values worked out there):
## fx/Shake.gd (board/fx/shake.ts), fx/sounds.gd (board/fx/sounds.ts), the image slot keys of autoload/Pictures.gd
## (engine cards/pool.ts imageSlots, tokenVariantKey), Pictures.safe_scryfall_url (images/scryfall.ts) and Sound.parse_wav.

const PICTURES := preload("res://autoload/Pictures.gd")
const SOUND := preload("res://autoload/Sound.gd")


func test_shake_for() -> void:
	var s1 := Shake.shake_for(1.0)
	assert_float(Val.real(s1, "amplitude")).is_equal_approx(1.2, 0.0001)
	assert_float(Val.real(s1, "duration")).is_equal(150.0)
	var s3 := Shake.shake_for(3.0)
	assert_float(Val.real(s3, "amplitude")).is_equal_approx(5.154301, 0.0001)
	assert_float(Val.real(s3, "duration")).is_equal(190.0)
	assert_float(Val.real(s3, "rotation")).is_equal_approx(0.0348329, 0.00001)
	var s10 := Shake.shake_for(10.0)
	assert_float(Val.real(s10, "amplitude")).is_equal_approx(15.400393, 0.0001)
	assert_float(Val.real(s10, "duration")).is_equal(293.0)
	assert_float(Val.real(s10, "zoom")).is_equal_approx(0.0098265, 0.000001)
	var s40 := Shake.shake_for(40.0)
	assert_float(Val.real(s40, "amplitude")).is_equal_approx(28.0, 0.0001)
	assert_float(Val.real(s40, "duration")).is_equal(420.0)
	assert_float(Val.real(Shake.shake_for(0.0), "amplitude")).is_equal(0.0)
	assert_float(Shake.recoil_for(3.0)).is_equal_approx(4.861384, 0.0001)
	assert_float(Shake.recoil_for(20.0)).is_equal_approx(12.0, 0.0001)


func test_shake_keyframes() -> void:
	var frames := Shake.keyframes(Shake.shake_for(10.0), 970)
	assert_int(frames.size()).is_equal(10) # 9 frames (293 / 32 rounded) plus the end at rest
	var f1: Dictionary = frames[1]
	var off: Vector2 = f1["offset"]
	assert_float(off.x).is_equal_approx(-15.17, 0.01)
	assert_float(off.y).is_equal_approx(5.50, 0.01)
	assert_float(float(f1["rotation"])).is_equal_approx(0.173, 0.001)
	assert_float(float(f1["scale"])).is_equal_approx(1.0098, 0.0001)
	var last: Dictionary = frames[frames.size() - 1]
	var rest: Vector2 = last["offset"]
	assert_bool(rest.is_zero_approx()).is_true()


func test_sound_helpers() -> void:
	assert_str(SoundCues.hit_sound(2, false)).is_equal("hit.light")
	assert_str(SoundCues.hit_sound(5, false)).is_equal("hit.medium")
	assert_str(SoundCues.hit_sound(6, false)).is_equal("hit.heavy")
	assert_str(SoundCues.hit_sound(1, true)).is_equal("hit.player")
	assert_float(SoundCues.damage_gain(3)).is_equal_approx(0.8, 0.0001)
	var a := SoundCues.align_accent(0.44, 0.44, 0.6)
	assert_float(float(a["offset"])).is_equal_approx(0.176, 0.0001)
	assert_float(float(a["delay"])).is_equal(0.0)
	var b := SoundCues.align_accent(0.3, 0.3, 1.6)
	assert_float(float(b["offset"])).is_equal(0.0)
	assert_float(float(b["delay"])).is_equal_approx(0.18, 0.0001)
	assert_bool(SoundCues.counter_good("+1/+1", 1)).is_true()
	assert_bool(SoundCues.counter_good("-1/-1", 1)).is_false()
	assert_bool(SoundCues.counter_good("-1/-1", -1)).is_true()
	assert_str(Val.text(SoundCues.exit_cue({"kind": "die", "token": false}), "id")).is_equal("card.destroy")
	assert_float(Val.real(SoundCues.exit_cue({"kind": "toHand", "token": true}), "gain")).is_equal_approx(0.4, 0.0001)


func test_event_cues() -> void:
	var view := {"viewer": "p1", "objects": {}, "lki": {}, "zones": {"stack": []}}
	var events: Array = [
		{"type": "tapped", "objectId": "o1"}, {"type": "tapped", "objectId": "o2"}, {"type": "manaAdded", "player": "p1", "mana": ["G"], "sourceId": "o2"},
		{"type": "shuffled", "player": "p1"}, {"type": "mulligan", "player": "p1"},
	]
	var cues := SoundCues.event_cues(events, view, view, "p1")
	var ids: Array[String] = []
	for c: Variant in cues:
		ids.append(Val.text(Val.as_dict(c), "id"))
	# o2 made mana (its mana is heard); the shuffle follows the mulligan.
	assert_str(", ".join(ids)).is_equal("card.tap, game.mulligan, game.shuffle")
	assert_float(Val.real(Val.as_dict(cues[2]), "delay")).is_equal_approx(0.77, 0.0001)


func test_image_slots() -> void:
	var spirit := {"name": "Spirit Token", "power": "1", "toughness": "1", "colors": ["W"], "typeLine": "Token Creature — Spirit", "oracleText": "Flying"}
	assert_str(PICTURES.token_variant_key(spirit)).is_equal("Spirit (1/1 W Creature — Spirit; Flying)")
	var treasure := {"name": "Treasure", "colors": [], "typeLine": "Artifact — Treasure", "oracleText": "{T}, Sacrifice this artifact: Add one mana of any color. (Reminder.)"}
	assert_str(PICTURES.token_variant_key(treasure)).is_equal("Treasure (C Artifact — Treasure; {T}, Sacrifice this token: Add one mana of any color.)")
	var beast := {"name": "Beast", "power": "3", "toughness": "3", "colors": ["G", "R"], "typeLine": "Creature — Beast", "oracleText": "vigilance, trample\nWhen this creature dies, draw a card."}
	assert_str(PICTURES.token_variant_key(beast)).is_equal("Beast (3/3 RG Creature — Beast; Vigilance; Trample; When this token dies, draw a card.)")
	assert_str(PICTURES.token_base_name("Incubator Token // Phyrexian Token")).is_equal("Incubator // Phyrexian")
	var dfc := {"name": "A // B", "layout": "transform", "faces": [{"name": "A"}, {"name": "B"}]}
	assert_str(PICTURES.slot_key(dfc, 0)).is_equal("A")
	assert_str(PICTURES.slot_key(dfc, 1)).is_equal("B")
	var reversible := {"name": "X", "layout": "reversible_card", "faces": [{"name": "X"}, {"name": "X"}]}
	assert_str(PICTURES.slot_key(reversible, 1)).is_equal("X (back)")
	var split := {"name": "Fire // Ice", "layout": "split", "faces": [{"name": "Fire"}, {"name": "Ice"}]}
	assert_str(PICTURES.slot_key(split, 1)).is_equal("Fire // Ice")


func test_safe_scryfall_url() -> void:
	assert_str(PICTURES.safe_scryfall_url("https://cards.scryfall.io/normal/front/a/b/x.jpg")).is_not_empty()
	assert_str(PICTURES.safe_scryfall_url("http://cards.scryfall.io/normal/x.jpg")).is_empty()
	assert_str(PICTURES.safe_scryfall_url("https://scryfall.io.evil.example/x.jpg")).is_empty()
	assert_str(PICTURES.safe_scryfall_url("https://user@cards.scryfall.io/x.jpg")).is_empty()


func test_parse_wav() -> void:
	# A 16-bit stereo 48 kHz WAV with 4 frames of silence.
	var data := PackedByteArray()
	data.resize(16)
	var wav := PackedByteArray()
	wav.append_array("RIFF".to_ascii_buffer())
	wav.append_array(_u32(36 + data.size()))
	wav.append_array("WAVEfmt ".to_ascii_buffer())
	wav.append_array(_u32(16))
	wav.append_array(_u16(1))
	wav.append_array(_u16(2))
	wav.append_array(_u32(48000))
	wav.append_array(_u32(48000 * 4))
	wav.append_array(_u16(4))
	wav.append_array(_u16(16))
	wav.append_array("data".to_ascii_buffer())
	wav.append_array(_u32(data.size()))
	wav.append_array(data)
	var stream: AudioStreamWAV = SOUND.parse_wav(wav)
	assert_object(stream).is_not_null()
	assert_bool(stream.stereo).is_true()
	assert_int(stream.mix_rate).is_equal(48000)
	assert_int(stream.data.size()).is_equal(16)
	assert_object(SOUND.parse_wav(PackedByteArray([1, 2, 3]))).is_null()


func _u32(n: int) -> PackedByteArray:
	var b := PackedByteArray()
	b.resize(4)
	b.encode_u32(0, n)
	return b


func _u16(n: int) -> PackedByteArray:
	var b := PackedByteArray()
	b.resize(2)
	b.encode_u16(0, n)
	return b


## The WAV route and its ETag as the local server has them (packages/server/src/sounds/service.ts): no "#" in a URL.
func test_sound_route_and_etag() -> void:
	assert_str(SOUND.wav_path("cast.fire", 2)).is_equal("/api/sounds/cast.fire/2.wav")
	assert_str(SOUND.etag_of("abc123", "ui.click", 0)).is_equal("\"abc123-ui.click-0\"")
