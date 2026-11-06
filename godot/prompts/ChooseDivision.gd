extends "res://prompts/PromptBase.gd"
## chooseDivision (CR 601.2d): the caster divides damage or counters among the announced targets; each gets at least 1 and the amounts
## add up to exactly `total`. One SpinBox and one HSlider per target; it starts with 1 each and the rest on the first target.
## Answer: {kind:'chooseDivision', amounts: number[]} (parallel to `targets`).

const Combat := preload("res://prompts/lib/combat.gd")

var amounts: Array = []
var _targets: Array = []
var _spins: Array = []
var _sliders: Array = []


func _build() -> void:
	_targets = J.dicts(decision, "targets")
	var total := J.int_of(decision, "total")
	amounts = Combat.default_division(total, _targets.size())
	var top := maxi(1, total - (_targets.size() - 1))
	var grid := GridContainer.new()
	grid.name = "Amounts"
	grid.columns = 3
	for i: int in _targets.size():
		var t: Dictionary = _targets[i]
		grid.add_child(make_cell_label(J.str_of(t, "label", J.str_of(t, "id"))))
		var spin := SpinBox.new()
		spin.name = "Amount_%d" % i
		spin.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		var slider := HSlider.new()
		slider.name = "Slider_%d" % i
		slider.custom_minimum_size = Vector2(100, 0)
		fit_cell(slider)
		for rng: Range in [spin, slider]:
			rng.min_value = 1
			rng.max_value = top
			rng.step = 1
			rng.rounded = true
			rng.set_value_no_signal(J.to_int(amounts[i]))
		spin.value_changed.connect(_on_value_changed.bind(i))
		slider.value_changed.connect(_on_value_changed.bind(i))
		grid.add_child(spin)
		grid.add_child(slider)
		_spins.append(spin)
		_sliders.append(slider)
	body.add_child(grid)


func set_amount(i: int, n: int) -> void:
	if i < 0 or i >= amounts.size():
		return
	amounts[i] = n
	var spin: SpinBox = _spins[i]
	var slider: HSlider = _sliders[i]
	spin.set_value_no_signal(n)
	slider.set_value_no_signal(n)
	_refresh()


func _on_value_changed(value: float, i: int) -> void:
	set_amount(i, roundi(value))


func _refresh() -> void:
	var total := J.int_of(decision, "total")
	var sum := 0
	for a: Variant in amounts:
		sum += J.to_int(a)
	var what := J.str_of(decision, "what")
	var noun := "damage" if what == "damage" else ("counters" if what == "counters" else "")
	set_detail("Divide %d %s among the targets; each gets at least 1 (CR 601.2d). %d of %d divided." % [total, noun, sum, total])
	var problem := Combat.division_problem(total, amounts)
	set_problem(problem)
	set_ok(problem == "", "Divide")


func _on_ok() -> void:
	if Combat.division_problem(J.int_of(decision, "total"), amounts) != "":
		return
	var out: Array = []
	for a: Variant in amounts:
		out.append(J.to_int(a))
	send_answer({"kind": "chooseDivision", "amounts": out})
