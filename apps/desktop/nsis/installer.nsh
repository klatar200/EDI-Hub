; Hide the NSIS progress window during electron-updater silent apply (/S).
; One-click installers still create an MUI instfiles page; without this the
; user sees a second "EDI Hub Setup" progress bar after our in-app download UI.

!macro customInit
  ${If} ${Silent}
    SetAutoClose true
    ShowWindow $HWNDPARENT ${SW_HIDE}
  ${EndIf}
!macroend

!macro customInstall
  ${If} ${Silent}
    ShowWindow $HWNDPARENT ${SW_HIDE}
  ${EndIf}
!macroend
