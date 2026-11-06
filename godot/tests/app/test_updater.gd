extends GdUnitTestSuite
## autoload/Updater.gd's parts that need no network: latest.yml as electron-builder writes it, versions, and the signer's name.

const U := preload("res://autoload/Updater.gd")

const LATEST := """version: 0.2.18
files:
  - url: OpenMTG-Setup-0.2.18.exe
    sha512: 29sgwAVOu8arOpucDH4XvXtv9BRLJ495aTOpWxNYd6UmhWyqQBNIN2Ip77Hw0DAaQFPgI68G2nKdxR1Au0a3vA==
    size: 137736784
path: OpenMTG-Setup-0.2.18.exe
sha512: 29sgwAVOu8arOpucDH4XvXtv9BRLJ495aTOpWxNYd6UmhWyqQBNIN2Ip77Hw0DAaQFPgI68G2nKdxR1Au0a3vA==
releaseDate: '2026-10-26T19:31:43.854Z'
"""


func test_parse_latest() -> void:
	var l := U.parse_latest(LATEST)
	assert_str(String(l["version"])).is_equal("0.2.18")
	assert_str(String(l["path"])).is_equal("OpenMTG-Setup-0.2.18.exe")
	assert_str(String(l["sha512"])).is_equal("29sgwAVOu8arOpucDH4XvXtv9BRLJ495aTOpWxNYd6UmhWyqQBNIN2Ip77Hw0DAaQFPgI68G2nKdxR1Au0a3vA==")
	assert_int(int(l["size"])).is_equal(137736784)
	assert_int(Marshalls.base64_to_raw(String(l["sha512"])).size()).is_equal(64)


func test_parse_latest_files_only_and_refusals() -> void:
	var files_only := "version: '1.2.3'\nfiles:\n  - url: OpenMTG-Setup-1.2.3.exe\n    sha512: \"abc=\"\n    size: 9\n  - url: other.exe\n    sha512: zzz\n"
	var l := U.parse_latest(files_only)
	assert_str(String(l["version"])).is_equal("1.2.3")
	assert_str(String(l["path"])).is_equal("OpenMTG-Setup-1.2.3.exe")
	assert_str(String(l["sha512"])).is_equal("abc=")
	assert_dict(U.parse_latest("")).is_empty()
	assert_dict(U.parse_latest("version: 1.0.0\n")).is_empty()
	# Never a file outside the download folder.
	assert_dict(U.parse_latest("version: 9.0.0\npath: ../evil.exe\nsha512: abc=\n")).is_empty()
	assert_dict(U.parse_latest("version: 9.0.0\npath: C:\\evil.exe\nsha512: abc=\n")).is_empty()


func test_is_newer() -> void:
	assert_bool(U.is_newer("0.3.0", "0.2.18")).is_true()
	assert_bool(U.is_newer("0.2.19", "0.2.18")).is_true()
	assert_bool(U.is_newer("0.2.18", "0.2.18")).is_false()
	assert_bool(U.is_newer("0.2.9", "0.2.18")).is_false()
	assert_bool(U.is_newer("1.0.0", "0.99.99")).is_true()
	assert_bool(U.is_newer("v0.4.0", "0.3.0")).is_true()
	assert_bool(U.is_newer("0.3.0-beta.1", "0.3.0")).is_false()
	assert_bool(U.is_newer("0.3.0", "0.3.0-beta.1")).is_true()
	assert_bool(U.is_newer("garbage", "0.3.0")).is_false()
	assert_bool(U.is_newer("0.3", "0.2.0")).is_false()


func test_signer_name() -> void:
	assert_str(U.signer_name("CN=DigiDice LLC, O=DigiDice LLC, L=Seattle, S=Washington, C=US")).is_equal("DigiDice LLC")
	assert_str(U.signer_name("CN=\"DigiDice, LLC\", O=\"DigiDice, LLC\", C=US")).is_equal("DigiDice, LLC")
	assert_str(U.signer_name("O=Someone, C=US")).is_equal("")
	assert_str(U.signer_name("")).is_equal("")


func test_no_settings_no_update() -> void:
	# The editor and an unsigned build have no update.json next to the program: nothing is checked or installed.
	assert_bool(Updater.enabled()).is_false()
