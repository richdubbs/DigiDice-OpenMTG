class_name Footer
extends PanelContainer
## The strip along the bottom of every screen but the table (packages/client/src/app/Footer.tsx): "OpenMTG by DigiDice", the
## Fan Content notice, its policy link, About and the server's version.

const POLICY_URL: String = "https://company.wizards.com/en/legal/fancontentpolicy"
const NOTICE: String = "OpenMTG is unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards.\nPortions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC."


static func attach(screen: Control) -> Footer:
	var f := Footer.new()
	screen.add_child(f)
	return f


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_WIDE)
	grow_vertical = Control.GROW_DIRECTION_BEGIN
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.01, 0.015, 0.04, 0.9)
	style.border_width_top = 1
	style.border_color = Color(NeonTheme.colors()[0], 0.25)
	style.content_margin_left = 20
	style.content_margin_right = 20
	style.content_margin_top = 6
	style.content_margin_bottom = 6
	add_theme_stylebox_override("panel", style)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 24)
	add_child(row)
	var brand := Hud.text("OpenMTG by DigiDice", 12, Hud.TEXT)
	brand.add_theme_font_override("font", Hud.bold_font())
	brand.autowrap_mode = TextServer.AUTOWRAP_OFF
	brand.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(brand)
	var notice := Hud.text(NOTICE, 11)
	notice.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	notice.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(notice)
	var policy := LinkButton.new()
	policy.text = "Fan Content Policy"
	policy.uri = POLICY_URL
	policy.add_theme_font_size_override("font_size", 11)
	policy.add_theme_color_override("font_color", NeonTheme.colors()[0])
	policy.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(policy)
	var about := LinkButton.new()
	about.text = "About"
	about.add_theme_font_size_override("font_size", 11)
	about.add_theme_color_override("font_color", NeonTheme.colors()[0])
	about.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	about.pressed.connect(func() -> void: Nav.go("about"))
	row.add_child(about)
	var stamp := Hud.text("Server %s" % Server.version if Server.version != "" else "", 11)
	stamp.autowrap_mode = TextServer.AUTOWRAP_OFF
	stamp.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(stamp)
