; Auto-updates call quitAndInstall(false, true) — no /S flag — so the
; one-click SpiderBanner shows file-extract progress during the multi-minute
; apply. Only set auto-close for optional manual silent CLI installs.

!macro customInit
  ${If} ${Silent}
    SetAutoClose true
  ${EndIf}
!macroend
