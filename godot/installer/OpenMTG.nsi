; The OpenMTG installer (NSIS), built by installer/build.ps1 from the exported app in APP_DIR.
;
; It takes the place of the earlier desktop app's installer: the same per-user folder (%LOCALAPPDATA%\Programs\OpenMTG unless the
; player chose another), the same uninstall entry (UNINSTALL_KEY), the same shortcuts, and the same command line, so an installed
; copy that updates itself runs this installer as it ran the earlier ones: "/S" (no pages), "--updated" (an update), "--force-run"
; (open OpenMTG when done). The player's data in %APPDATA%\OpenMTG is never touched: installing, updating and uninstalling leave it.
;
; An earlier version is removed first by its own uninstaller (silently, keeping the data), so no file of the earlier app is left
; behind, then the new files are copied.
;
; makensis /DVERSION=x.y.z /DAPP_DIR=<folder with OpenMTG.exe> /DOUT_FILE=<setup.exe> OpenMTG.nsi

Unicode true
SetCompressor /SOLID lzma
RequestExecutionLevel user

!ifndef VERSION
  !error "Give the version: /DVERSION=x.y.z"
!endif
!ifndef APP_DIR
  !error "Give the folder of the exported app: /DAPP_DIR=..."
!endif
!ifndef OUT_FILE
  !define OUT_FILE "OpenMTG-Setup-${VERSION}.exe"
!endif

;  A test build may name itself apart (/DAPP_NAME=..., /DAPP_GUID=..., /DNO_SHORTCUTS), so it never meets a real install.
!ifndef APP_NAME
  !define APP_NAME "OpenMTG"
!endif
!define APP_EXE "OpenMTG.exe"
!define PUBLISHER "DigiDice LLC"
; The earlier desktop app's identity (its appId net.digidice.openmtg as a UUID): the key its installs registered.
!ifndef APP_GUID
  !define APP_GUID "93b94729-c368-5ad7-ab4f-5c2421e47563"
!endif
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_GUID}"
!define INSTALL_KEY "Software\${APP_GUID}"
!define UNINSTALLER "Uninstall ${APP_NAME}.exe"

!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"

Name "${APP_NAME}"
OutFile "${OUT_FILE}"
InstallDir "$LOCALAPPDATA\Programs\${APP_NAME}"
InstallDirRegKey HKCU "${INSTALL_KEY}" "InstallLocation"
BrandingText "${PUBLISHER}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APP_NAME}"
VIAddVersionKey "CompanyName" "${PUBLISHER}"
VIAddVersionKey "LegalCopyright" "Copyright (c) 2026 ${PUBLISHER}"
VIAddVersionKey "FileDescription" "${APP_NAME} Setup"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"

!define MUI_ICON "${APP_DIR}\installer-icon.ico"
!define MUI_UNICON "${APP_DIR}\installer-icon.ico"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Open ${APP_NAME}"

!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Var Params
Var HadDesktopLink

Function .onInit
  SetShellVarContext current
  ${GetParameters} $Params
FunctionEnd

; The app and its game server must not be running while their files are replaced (an update closes the app first; a server it
; started may still be stopping).
; The files of the earlier desktop app (Electron) next to its program.
!macro DeleteDesktopAppFiles DIR
  Delete "${DIR}\chrome_100_percent.pak"
  Delete "${DIR}\chrome_200_percent.pak"
  Delete "${DIR}\resources.pak"
  Delete "${DIR}\d3dcompiler_47.dll"
  Delete "${DIR}\dxcompiler.dll"
  Delete "${DIR}\dxil.dll"
  Delete "${DIR}\ffmpeg.dll"
  Delete "${DIR}\libEGL.dll"
  Delete "${DIR}\libGLESv2.dll"
  Delete "${DIR}\vk_swiftshader.dll"
  Delete "${DIR}\vk_swiftshader_icd.json"
  Delete "${DIR}\vulkan-1.dll"
  Delete "${DIR}\icudtl.dat"
  Delete "${DIR}\snapshot_blob.bin"
  Delete "${DIR}\v8_context_snapshot.bin"
  Delete "${DIR}\LICENSE.electron.txt"
  Delete "${DIR}\LICENSES.chromium.html"
  Delete "${DIR}\NOTICE"
  Delete "${DIR}\PLAYING.md"
!macroend

!macro CloseApp
  nsExec::Exec 'taskkill /F /T /IM "${APP_EXE}"'
  Pop $0
  nsExec::Exec 'taskkill /F /IM "openmtg-server.exe"'
  Pop $0
  Sleep 500
!macroend

Section "Install"
  SetShellVarContext current
  !insertmacro CloseApp

  ; An update keeps the player's choice of a desktop shortcut (the earlier version's uninstaller removes it).
  StrCpy $HadDesktopLink "0"
  ${If} ${FileExists} "$DESKTOP\${APP_NAME}.lnk"
    StrCpy $HadDesktopLink "1"
  ${EndIf}

  ; An earlier version (the desktop app, or an earlier version of this one) goes first, by its own uninstaller: silently, per user,
  ; keeping %APPDATA%\OpenMTG ("--updated": an update, not a removal). It runs from a copy in the temporary folder, as the desktop
  ; app's own installer ran it: it moves the whole install folder away, which it cannot do while it runs from inside it.
  ReadRegStr $1 HKCU "${INSTALL_KEY}" "InstallLocation"
  ${If} $1 == ""
    StrCpy $1 $INSTDIR
  ${EndIf}
  ${If} ${FileExists} "$1\${UNINSTALLER}"
    DetailPrint "Removing the earlier version"
    InitPluginsDir
    CopyFiles /SILENT "$1\${UNINSTALLER}" "$PLUGINSDIR\old-uninstaller.exe"
    ExecWait '"$PLUGINSDIR\old-uninstaller.exe" /S /KEEP_APP_DATA /currentuser --updated _?=$1' $2
    ${If} $2 != 0
      Sleep 1000
      ExecWait '"$PLUGINSDIR\old-uninstaller.exe" /S /KEEP_APP_DATA /currentuser --updated _?=$1' $2
    ${EndIf}
    Delete "$1\${UNINSTALLER}"
  ${EndIf}
  ; Whatever the desktop app's uninstaller could not remove goes too: the desktop app's own files only, never anything else in
  ; the folder.
  ${If} ${FileExists} "$1\resources\app.asar"
    DetailPrint "Removing what is left of the desktop app"
    RMDir /r "$1\resources"
    RMDir /r "$1\locales"
    !insertmacro DeleteDesktopAppFiles "$1"
  ${EndIf}

  SetOutPath "$INSTDIR"
  File "${APP_DIR}\${APP_EXE}"
  File /nonfatal "${APP_DIR}\update.json"
  File /nonfatal "${APP_DIR}\LICENSE"
  File /nonfatal "${APP_DIR}\THIRD_PARTY_NOTICES.md"
  SetOutPath "$INSTDIR\bin"
  File "${APP_DIR}\bin\openmtg-server.exe"
  SetOutPath "$INSTDIR"

  WriteUninstaller "$INSTDIR\${UNINSTALLER}"

!ifndef NO_SHORTCUTS
  ; A new install gets both shortcuts; an update gets the desktop one back only if the player had it.
  ClearErrors
  ${GetOptions} $Params "--updated" $0
  ${If} ${Errors}
  ${OrIf} $HadDesktopLink == "1"
    CreateShortCut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}"
  ${EndIf}
  CreateShortCut "$SMPROGRAMS\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}"
!endif

  WriteRegStr HKCU "${INSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "${PUBLISHER}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\${APP_EXE},0"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\${UNINSTALLER}" /currentuser'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "QuietUninstallString" '"$INSTDIR\${UNINSTALLER}" /currentuser /S'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "EstimatedSize" "$0"
SectionEnd

; "--force-run": open the app once installed (an update installs silently and the new version opens by itself).
Function .onInstSuccess
  ClearErrors
  ${GetOptions} $Params "--force-run" $0
  ${IfNot} ${Errors}
    Exec '"$INSTDIR\${APP_EXE}"'
  ${EndIf}
FunctionEnd

Section "Uninstall"
  SetShellVarContext current
  !insertmacro CloseApp
  Delete "$INSTDIR\${APP_EXE}"
  Delete "$INSTDIR\update.json"
  Delete "$INSTDIR\LICENSE"
  Delete "$INSTDIR\THIRD_PARTY_NOTICES.md"
  Delete "$INSTDIR\bin\openmtg-server.exe"
  RMDir "$INSTDIR\bin"
  Delete "$INSTDIR\${UNINSTALLER}"
  RMDir "$INSTDIR"
  ; An update keeps the shortcuts' places (the new version writes them again); a removal takes them away.
  ClearErrors
  ${GetOptions} $CMDLINE "--updated" $0
  ${If} ${Errors}
    Delete "$DESKTOP\${APP_NAME}.lnk"
    Delete "$SMPROGRAMS\${APP_NAME}.lnk"
    DeleteRegKey HKCU "${UNINSTALL_KEY}"
    DeleteRegKey HKCU "${INSTALL_KEY}"
  ${EndIf}
SectionEnd
