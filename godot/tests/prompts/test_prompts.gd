extends GdUnitTestSuite
## Scene tests of the decision prompts (gdUnit4). For each decision kind a fixture decision (tests/fixtures/decisions/<kind>.json, written
## from packages/engine/src/types/decisions.ts) is shown with a fixture view (view.json) and a fake client; the test drives the simplest
## legal path and checks that the emitted answer has exactly the engine's DecisionAnswer shape (or, for priority, the Action shape).

const FIXTURES := "res://tests/fixtures/decisions/"
const FakeClient := preload("res://tests/prompts/fake_client.gd")
const Fallbacks := preload("res://prompts/fallbacks.gd")

## Every decision kind of the engine and the scene that shows it.
const KINDS := [
	"priority", "playFirst", "mulligan", "chooseObjects", "yesNo", "chooseOption", "chooseNumber", "chooseColor", "order", "chooseTargets",
	"payCost", "declareAttackers", "declareBlockers", "assignDamage", "chooseReplacement", "manualResolve", "chooseDivision", "chooseName",
	"commanderZone",
]

var _client: Node = null
var _answers: Array = []
var _cancels: Array = []
var _acts: Array = []


func before_test() -> void:
	_client = auto_free(FakeClient.new())
	_answers = []
	_cancels = []
	_acts = []


# ---- helpers -------------------------------------------------------------------------------------------------------------------------

func _json(file_name: String) -> Variant:
	return JSON.parse_string(FileAccess.get_file_as_string(FIXTURES + file_name))


func _decision(kind: String) -> Dictionary:
	var d: Variant = _json(kind + ".json")
	assert_bool(d is Dictionary).is_true()
	return d if d is Dictionary else {}


func _view() -> Dictionary:
	var v: Variant = _json("view.json")
	return v if v is Dictionary else {}


static func _scene_name(kind: String) -> String:
	return kind.substr(0, 1).to_upper() + kind.substr(1)


## Show `d` in prompts/<scene>.tscn, connected to the recorders. Automatic answers are off unless `auto` is true.
func _open(scene: String, d: Dictionary, auto: bool = false) -> Control:
	var packed: PackedScene = load("res://prompts/%s.tscn" % scene)
	var prompt: Control = packed.instantiate()
	prompt.set("arm_delay_ms", 0)
	prompt.set("auto_answer", auto)
	prompt.connect("answered", func(a: Dictionary) -> void: _answers.append(a))
	prompt.connect("cancelled", func() -> void: _cancels.append(true))
	if prompt.has_signal("acted"):
		prompt.connect("acted", func(a: Dictionary) -> void: _acts.append(a))
	add_child(prompt)
	auto_free(prompt)
	prompt.call("setup", d, _view(), _client)
	return prompt


func _open_kind(kind: String) -> Control:
	return _open(_scene_name(kind), _decision(kind))


func _find(prompt: Node, node_name: String) -> Node:
	var n := prompt.find_child(node_name, true, false)
	assert_object(n).is_not_null()
	return n


func _button(prompt: Node, node_name: String) -> BaseButton:
	return _find(prompt, node_name) as BaseButton


func _press(prompt: Node, node_name: String) -> void:
	var b := _button(prompt, node_name)
	if b != null:
		b.pressed.emit()


func _selection() -> Object:
	return _client.get("selection")


# ---- every kind ----------------------------------------------------------------------------------------------------------------------

func test_every_kind_has_a_scene_that_shows_its_prompt() -> void:
	for kind: String in KINDS:
		var d := _decision(kind)
		var prompt := _open(_scene_name(kind), d)
		var title := _find(prompt, "Title") as Label
		assert_str(title.text).is_equal(str(d["prompt"]))
		var rules := _find(prompt, "Rules") as Label
		assert_bool(rules.visible).is_true()
		var cancel := _button(prompt, "Cancel")
		assert_bool(cancel.visible).is_equal(d.get("cancellable", false) == true)


# ---- priority (emits an Action) ------------------------------------------------------------------------------------------------------

func _open_priority() -> Control:
	var legal: Variant = _json("priority_legal.json")
	_client.set("legal", legal)
	return _open_kind("priority")


func test_priority_pass() -> void:
	var prompt := _open_priority()
	assert_str((_button(prompt, "Ok") as Button).text).is_equal("Pass priority")
	_press(prompt, "Ok")
	assert_array(_answers).is_empty()
	assert_that(_acts).is_equal([{"type": "pass", "player": "p1"}])


func test_priority_board_click_casts_a_card_with_one_action() -> void:
	_open_priority()
	assert_bool(_selection().get("selectable").has("o30")).is_true()
	_selection().call("click_card", "o30")
	assert_that(_acts).is_equal([{"type": "cast", "player": "p1", "card": "o30"}])


func test_priority_resolve_all() -> void:
	var prompt := _open_priority()
	_press(prompt, "ResolveAll")
	assert_that(_acts).is_equal([{"type": "pass", "player": "p1", "resolveAll": true}])


func test_priority_hold_priority_goes_through_client_stops() -> void:
	var prompt := _open_priority()
	_press(prompt, "HoldPriority")
	var sent: Array = _client.get("stops_sent")
	assert_array(sent).has_size(1)
	var first: Dictionary = sent[0]
	assert_str(str(first["player"])).is_equal("p1")
	var settings: Dictionary = first["stops"]
	assert_bool(settings["holdPriority"] == true).is_true()
	assert_bool(settings["fullControl"] == false).is_true()


# ---- one-click decisions -------------------------------------------------------------------------------------------------------------

func test_play_first() -> void:
	var prompt := _open_kind("playFirst")
	_press(prompt, "Ok")
	assert_that(_answers).is_equal([{"kind": "playFirst", "player": "p1"}])
	_press(prompt, "Player_p2")
	assert_that(_answers[1]).is_equal({"kind": "playFirst", "player": "p2"})


func test_mulligan() -> void:
	var prompt := _open_kind("mulligan")
	_press(prompt, "Ok")
	_press(prompt, "Mulligan")
	assert_that(_answers).is_equal([{"kind": "mulligan", "keep": true}, {"kind": "mulligan", "keep": false}])


func test_yes_no() -> void:
	var prompt := _open_kind("yesNo")
	assert_str((_button(prompt, "Ok") as Button).text).is_equal("Pay {1}")
	_press(prompt, "Ok")
	_press(prompt, "No")
	assert_that(_answers).is_equal([{"kind": "yesNo", "yes": true}, {"kind": "yesNo", "yes": false}])
	assert_bool(_button(prompt, "Cancel").visible).is_false()


func test_choose_color() -> void:
	var prompt := _open_kind("chooseColor")
	_press(prompt, "Color_G")
	assert_that(_answers).is_equal([{"kind": "chooseColor", "color": "G"}])


func test_choose_replacement() -> void:
	var prompt := _open_kind("chooseReplacement")
	_press(prompt, "Replacement_r2")
	assert_that(_answers).is_equal([{"kind": "chooseReplacement", "id": "r2"}])


func test_commander_zone() -> void:
	var prompt := _open_kind("commanderZone")
	assert_str((_button(prompt, "Ok") as Button).text).is_equal("Put Krenko, Mob Boss into the command zone")
	_press(prompt, "Ok")
	_press(prompt, "Stay")
	assert_that(_answers).is_equal([{"kind": "commanderZone", "command": true}, {"kind": "commanderZone", "command": false}])


# ---- choices with min / max ------------------------------------------------------------------------------------------------------------

func test_choose_objects() -> void:
	var prompt := _open_kind("chooseObjects")
	assert_bool(_button(prompt, "Ok").disabled).is_true()
	_press(prompt, "Chip_o30")
	assert_bool(_button(prompt, "Ok").disabled).is_true()
	_selection().call("click_card", "o31")
	assert_bool(_button(prompt, "Ok").disabled).is_false()
	_press(prompt, "Ok")
	assert_that(_answers).is_equal([{"kind": "chooseObjects", "ids": ["o30", "o31"]}])


func test_choose_objects_ok_disabled_answers_nothing() -> void:
	var prompt := _open_kind("chooseObjects")
	_press(prompt, "Ok")
	assert_array(_answers).is_empty()


func test_choose_option_disabled_option_is_not_chosen() -> void:
	var prompt := _open_kind("chooseOption")
	assert_bool(_button(prompt, "Option_2").disabled).is_true()
	_press(prompt, "Option_2")
	_press(prompt, "Option_0")
	assert_bool(_button(prompt, "Ok").disabled).is_true()
	_press(prompt, "Option_3")
	assert_bool(_button(prompt, "Ok").disabled).is_false()
	_press(prompt, "Ok")
	assert_that(_answers).is_equal([{"kind": "chooseOption", "ids": ["0", "3"]}])


func test_choose_option_allow_repeat() -> void:
	var d := _decision("chooseOption")
	d["allowRepeat"] = true
	d["min"] = 1
	d["max"] = 3
	var prompt := _open("ChooseOption", d)
	_press(prompt, "Option_1")
	_press(prompt, "Option_1")
	_press(prompt, "Option_0")
	_press(prompt, "Less_1")
	_press(prompt, "Option_3")
	_press(prompt, "Ok")
	assert_that(_answers).is_equal([{"kind": "chooseOption", "ids": ["0", "1", "3"]}])


func test_choose_number() -> void:
	var prompt := _open_kind("chooseNumber")
	(_find(prompt, "Number") as SpinBox).value = 3
	assert_str((_button(prompt, "Ok") as Button).text).is_equal("Choose 3")
	_press(prompt, "Ok")
	assert_that(_answers).is_equal([{"kind": "chooseNumber", "n": 3}])


func test_order() -> void:
	var prompt := _open_kind("order")
	(_find(prompt, "List") as ItemList).select(0)
	_press(prompt, "Down")
	_press(prompt, "Ok")
	assert_that(_answers).is_equal([{"kind": "order", "ids": ["t2", "t1"]}])


func test_choose_targets_player_from_the_board() -> void:
	var prompt := _open_kind("chooseTargets")
	assert_bool(_button(prompt, "Ok").disabled).is_true()
	_selection().call("click_card", "o20")
	_selection().call("click_player", "p2")
	_press(prompt, "Ok")
	assert_that(_answers).is_equal([{"kind": "chooseTargets", "targets": [{"kind": "player", "id": "p2"}]}])


func test_choose_targets_object() -> void:
	var prompt := _open_kind("chooseTargets")
	_press(prompt, "Chip_o21")
	_press(prompt, "Ok")
	assert_that(_answers).is_equal([{"kind": "chooseTargets", "targets": [{"kind": "object", "id": "o21"}]}])


func test_choose_targets_up_to_answers_no_targets() -> void:
	var d := _decision("chooseTargets")
	d["min"] = 0
	var prompt := _open("ChooseTargets", d)
	assert_str((_button(prompt, "Ok") as Button).text).is_equal("No targets")
	_press(prompt, "Ok")
	assert_that(_answers).is_equal([{"kind": "chooseTargets", "targets": []}])


func test_choose_targets_cancel() -> void:
	var prompt := _open_kind("chooseTargets")
	assert_bool(_button(prompt, "Cancel").visible).is_true()
	_press(prompt, "Cancel")
	assert_array(_cancels).has_size(1)
	assert_array(_answers).is_empty()


func test_choose_targets_lone_opponent_is_answered_at_once() -> void:
	var d := _decision("chooseTargets")
	d["objects"] = []
	d["players"] = ["p2"]
	_open("ChooseTargets", d, true)
	await get_tree().process_frame
	await get_tree().process_frame
	assert_that(_answers).is_equal([{"kind": "chooseTargets", "targets": [{"kind": "player", "id": "p2"}]}])


# ---- costs ---------------------------------------------------------------------------------------------------------------------------

func test_pay_cost_auto() -> void:
	var prompt := _open_kind("payCost")
	assert_str((_button(prompt, "Ok") as Button).text).is_equal("Auto pay")
	_press(prompt, "Ok")
	assert_that(_answers).is_equal([{"kind": "payCost", "auto": true}])


func test_pay_cost_manual() -> void:
	var prompt := _open_kind("payCost")
	_press(prompt, "PayByHand")
	_press(prompt, "Source_2")
	_selection().call("click_card", "o11")
	_press(prompt, "Ok")
	assert_that(_answers).is_equal([{"kind": "payCost", "auto": false, "activations": [
		{"objectId": "o13", "abilityKey": "r:basic:R"}, {"objectId": "o11", "abilityKey": "p:0:0"}]}])


func test_pay_cost_only_way_is_paid_at_once() -> void:
	var d := _decision("payCost")
	d["onlyWay"] = true
	_open("PayCost", d, true)
	await get_tree().process_frame
	await get_tree().process_frame
	assert_that(_answers).is_equal([{"kind": "payCost", "auto": true}])


# ---- combat --------------------------------------------------------------------------------------------------------------------------

func test_declare_attackers_requirement_preselected() -> void:
	var prompt := _open_kind("declareAttackers")
	assert_str((_button(prompt, "Ok") as Button).text).is_equal("Attack with 1")
	_press(prompt, "Ok")
	assert_that(_answers).is_equal([{"kind": "declareAttackers", "attacks": [{"attacker": "o11", "defender": "p2"}]}])


func test_declare_attackers_click_adds_an_attacker() -> void:
	var prompt := _open_kind("declareAttackers")
	_selection().call("click_card", "o10")
	_press(prompt, "Ok")
	assert_that(_answers).is_equal([{"kind": "declareAttackers", "attacks": [
		{"attacker": "o10", "defender": "p2"}, {"attacker": "o11", "defender": "p2"}]}])


func test_declare_attackers_multiplayer_needs_a_target() -> void:
	var d := _decision("declareAttackers")
	d["candidates"] = [{"id": "o10", "defenders": ["p2", "p3"]}]
	d.erase("requirements")
	d.erase("mustObey")
	d.erase("obeying")
	var v := _view()
	v["options"] = {"multiplayer": {"variant": "freeForAll"}}
	var players: Array = v["players"]
	players.append({"id": "p3", "name": "Carol", "life": 20, "hasLost": false, "stops": {}})
	var packed: PackedScene = load("res://prompts/DeclareAttackers.tscn")
	var prompt: Control = packed.instantiate()
	prompt.set("arm_delay_ms", 0)
	prompt.connect("answered", func(a: Dictionary) -> void: _answers.append(a))
	add_child(prompt)
	auto_free(prompt)
	prompt.call("setup", d, v, _client)
	_selection().call("click_card", "o10")
	assert_bool(_button(prompt, "Ok").disabled).is_true()
	_selection().call("click_player", "p3")
	assert_bool(_button(prompt, "Ok").disabled).is_false()
	_press(prompt, "Ok")
	assert_that(_answers).is_equal([{"kind": "declareAttackers", "attacks": [{"attacker": "o10", "defender": "p3"}]}])


func test_declare_blockers() -> void:
	var prompt := _open_kind("declareBlockers")
	assert_str((_button(prompt, "Ok") as Button).text).is_equal("No blocks")
	_press(prompt, "Chip_o10")
	_press(prompt, "Chip_o20")
	_press(prompt, "Ok")
	assert_that(_answers).is_equal([{"kind": "declareBlockers", "blocks": [{"blocker": "o10", "attacker": "o20"}]}])


func test_declare_blockers_board_clicks_move_a_single_block() -> void:
	var prompt := _open_kind("declareBlockers")
	_selection().call("click_card", "o11")
	_selection().call("click_card", "o20")
	_selection().call("click_card", "o11")
	_selection().call("click_card", "o21")
	_press(prompt, "Ok")
	assert_that(_answers).is_equal([{"kind": "declareBlockers", "blocks": [{"blocker": "o11", "attacker": "o21"}]}])


func test_declare_blockers_attacker_first() -> void:
	var prompt := _open_kind("declareBlockers")
	_selection().call("click_card", "o21")
	_selection().call("click_card", "o10")
	_press(prompt, "Ok")
	assert_that(_answers).is_equal([{"kind": "declareBlockers", "blocks": [{"blocker": "o10", "attacker": "o21"}]}])


func test_assign_damage_lethal_first_with_trample() -> void:
	var prompt := _open_kind("assignDamage")
	assert_bool(_button(prompt, "Ok").disabled).is_false()
	_press(prompt, "Ok")
	assert_that(_answers).is_equal([{"kind": "assignDamage", "amounts": [
		{"id": "o10", "amount": 2}, {"id": "o11", "amount": 1}, {"id": "p1", "amount": 2}]}])


func test_assign_damage_total_and_trample_rule() -> void:
	var prompt := _open_kind("assignDamage")
	(_find(prompt, "Amount_p1") as SpinBox).value = 3
	assert_bool(_button(prompt, "Ok").disabled).is_true()
	(_find(prompt, "Amount_o11") as SpinBox).value = 0
	assert_bool(_button(prompt, "Ok").disabled).is_true()
	(_find(prompt, "Amount_o10") as SpinBox).value = 2
	(_find(prompt, "Amount_o11") as SpinBox).value = 1
	(_find(prompt, "Amount_p1") as SpinBox).value = 2
	assert_bool(_button(prompt, "Ok").disabled).is_false()


func test_choose_division() -> void:
	var prompt := _open_kind("chooseDivision")
	_press(prompt, "Ok")
	assert_that(_answers).is_equal([{"kind": "chooseDivision", "amounts": [2, 1]}])
	(_find(prompt, "Amount_1") as SpinBox).value = 2
	assert_bool(_button(prompt, "Ok").disabled).is_true()


func test_choose_name() -> void:
	var prompt := _open_kind("chooseName")
	assert_bool(_button(prompt, "Ok").disabled).is_true()
	prompt.call("choose", "Elf")
	_press(prompt, "Ok")
	assert_that(_answers).is_equal([{"kind": "chooseName", "name": "Elf"}])


# ---- manual resolution ---------------------------------------------------------------------------------------------------------------

func test_manual_resolve_no_changes_asks_first() -> void:
	var prompt := _open_kind("manualResolve")
	assert_str((_button(prompt, "Ok") as Button).text).is_equal("Done (no changes)")
	_press(prompt, "Ok")
	assert_array(_answers).is_empty()
	assert_str((_button(prompt, "Ok") as Button).text).is_equal("Resolve with no changes")
	_press(prompt, "Ok")
	assert_that(_answers).is_equal([{"kind": "manualResolve", "ops": []}])


func test_manual_resolve_life_op() -> void:
	var prompt := _open_kind("manualResolve")
	prompt.call("select_kind", "life")
	prompt.call("set_field", "player", "p2")
	prompt.call("set_field", "amount", "-3")
	_press(prompt, "Add")
	assert_str((_button(prompt, "Ok") as Button).text).is_equal("Done: apply 1 adjustment")
	_press(prompt, "Ok")
	assert_that(_answers).is_equal([{"kind": "manualResolve", "ops": [{"op": "life", "player": "p2", "delta": -3}]}])


func test_manual_resolve_board_click_and_apply_and_continue() -> void:
	var prompt := _open_kind("manualResolve")
	assert_bool(_selection().get("selectable").has("o50")).is_false()
	_selection().call("click_card", "o10")
	_press(prompt, "Add")
	prompt.call("select_kind", "counters")
	_selection().call("click_player", "p2")
	prompt.call("set_field", "counter", "poison")
	prompt.call("set_field", "amount", "2")
	_press(prompt, "Add")
	_press(prompt, "ApplyAndContinue")
	assert_that(_answers).is_equal([{"kind": "manualResolve", "continue": true, "ops": [
		{"op": "move", "object": "o10", "to": "graveyard"},
		{"op": "counters", "object": "p2", "counter": "poison", "delta": 2}]}])


func test_manual_resolve_refuses_a_moved_card() -> void:
	var prompt := _open_kind("manualResolve")
	_selection().call("click_card", "o10")
	_press(prompt, "Add")
	prompt.call("select_kind", "tap")
	_selection().call("click_card", "o10")
	_press(prompt, "Add")
	var ops: Array = prompt.get("ops")
	assert_array(ops).has_size(1)


# ---- fallback ------------------------------------------------------------------------------------------------------------------------

func test_fallback_scene_offers_the_cheapest_answer() -> void:
	var prompt := _open("Fallback", _decision("yesNo"))
	_press(prompt, "Ok")
	assert_that(_answers).is_equal([{"kind": "yesNo", "yes": false}])


func test_fallback_scene_priority_passes() -> void:
	var prompt := _open("Fallback", _decision("priority"))
	_press(prompt, "Ok")
	assert_that(_acts).is_equal([{"type": "pass", "player": "p1"}])


func test_fallback_scene_without_an_answer_keeps_ok_disabled() -> void:
	var prompt := _open("Fallback", _decision("chooseName"))
	assert_bool(_button(prompt, "Ok").disabled).is_true()


func test_fallbacks_port() -> void:
	var d := _decision("chooseTargets")
	var list := Fallbacks.fallbacks(d)
	assert_that(list).is_equal([
		{"type": "cancel", "player": "p1"},
		{"type": "answer", "player": "p1", "decisionId": "d9", "answer": {"kind": "chooseTargets", "targets": [{"kind": "object", "id": "o10"}]}},
		{"type": "answer", "player": "p1", "decisionId": "d9", "answer": {"kind": "chooseTargets", "targets": [{"kind": "player", "id": "p2"}]}},
	])
	assert_that(Fallbacks.first_answer(_decision("chooseObjects"))).is_equal({"kind": "chooseObjects", "ids": ["o30", "o31"]})
	assert_that(Fallbacks.first_answer(_decision("declareBlockers"))).is_equal({"kind": "declareBlockers", "blocks": []})
	assert_that(Fallbacks.first_answer(_decision("chooseNumber"))).is_equal({"kind": "chooseNumber", "n": 0})
	assert_that(Fallbacks.fallback(_decision("priority"))).is_equal({"type": "pass", "player": "p1"})
	assert_that(Fallbacks.fallbacks(_decision("chooseName"))).is_equal([])
