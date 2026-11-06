extends Node
## Moving between screens, as the browser's app/nav.tsx: `go` opens a screen and remembers the one it came from, `back` returns
## there (Home when there is none), and every move makes the ui.navigate sound. While a table is open, Play is "Back to game".

const SCREENS: Dictionary = {
	"home": "res://scenes/Home.tscn",
	"newGame": "res://scenes/NewGame.tscn",
	"settings": "res://scenes/SettingsScreen.tscn",
	"about": "res://scenes/About.tscn",
	"decks": "res://scenes/Decks.tscn",
	"deckbuilder": "res://scenes/Deckbuilder.tscn",
	"images": "res://scenes/Images.tscn",
	"replays": "res://scenes/Replays.tscn",
	"hostOnline": "res://scenes/online/OnlineHost.tscn",
	"joinOnline": "res://scenes/online/OnlineJoin.tscn",
	"table": "res://scenes/Table.tscn",
}

## The tabs of the top bar, in order: [screen, label]. A screen not in SCREENS is shown but not built yet.
const TABS: Array = [["play", "Play"], ["decks", "Decks"], ["replays", "Replays"], ["images", "Images"], ["settings", "Settings"],
	["about", "About"]]

var _stack: Array[String] = []
## The last game's setup, as New game started it: {format, life, first, seats: [{name, computer, deck_id, deck_name}]}.
var last_setup: Dictionary = {}
## A setup New game opens with (the end screen's Change decks), cleared once used.
var pending_setup: Dictionary = {}
## What the screen being opened is opened with (the deckbuilder: {id, view}); set by `open`.
var args: Dictionary = {}
var _quit_dialog: ConfirmationDialog = null


func _ready() -> void:
	# A running game asks before the window closes (the browser's beforeunload).
	get_tree().set_auto_accept_quit(false)


func _notification(what: int) -> void:
	if what != NOTIFICATION_WM_CLOSE_REQUEST:
		return
	var running := GameClient.table_id != "" and View.result(GameClient.view).is_empty() and not GameClient.view.is_empty()
	if not running:
		get_tree().quit()
		return
	if _quit_dialog == null:
		_quit_dialog = ConfirmationDialog.new()
		_quit_dialog.title = "Quit OpenMTG"
		_quit_dialog.dialog_text = "Quit OpenMTG? The game in progress is not saved and cannot be resumed."
		_quit_dialog.ok_button_text = "Quit"
		_quit_dialog.cancel_button_text = "Keep playing"
		_quit_dialog.confirmed.connect(func() -> void: get_tree().quit())
		get_tree().root.add_child(_quit_dialog)
	_quit_dialog.popup_centered()


## Whether `screen` has a scene in this app yet.
func exists(screen: String) -> bool:
	return screen == "play" or SCREENS.has(screen)


## The screen shown now ("" when unknown).
func current() -> String:
	var scene := get_tree().current_scene
	if scene == null:
		return ""
	for k: String in SCREENS:
		if String(SCREENS[k]) == scene.scene_file_path:
			return k
	return ""


## Whether a game is open in the server (Play returns to it).
func in_game() -> bool:
	return GameClient.table_id != ""


## Open `screen` ("play": the open game, else New game).
func go(screen: String) -> void:
	if screen == "play":
		screen = "table" if in_game() else "newGame"
	if not SCREENS.has(screen):
		return
	var here := current()
	if here == screen:
		return
	if here != "" and here != "table":
		_stack.append(here)
	if _stack.size() > 20:
		_stack.remove_at(0)
	UiSounds.navigate()
	get_tree().change_scene_to_file(String(SCREENS[screen]))


## Open `screen` with `with_args` (read by the screen as Nav.args); the screen on show opens again with them (the table going
## from a finished game to its replay and back).
func open(screen: String, with_args: Dictionary) -> void:
	args = with_args
	if current() == screen and SCREENS.has(screen):
		UiSounds.navigate()
		get_tree().change_scene_to_file(String(SCREENS[screen]))
		return
	go(screen)


## Back to the screen this one was opened from (Home when none).
func back() -> void:
	var to := "home"
	while not _stack.is_empty():
		to = _stack.pop_back()
		if to != current():
			break
	UiSounds.navigate()
	get_tree().change_scene_to_file(String(SCREENS.get(to, SCREENS["home"])))


## Forget the way back (a game started: Back from the table's screens goes Home).
func clear() -> void:
	_stack.clear()
