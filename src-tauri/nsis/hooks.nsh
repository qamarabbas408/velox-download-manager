; Tauri NSIS installer hooks for Velox.
; Removes native-messaging host registration on uninstall.

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\com.velox.native_host"
  DeleteRegKey HKCU "Software\Microsoft\Edge\NativeMessagingHosts\com.velox.native_host"
  DeleteRegKey HKCU "Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.velox.native_host"
  Delete "$LOCALAPPDATA\Velox\native-host.json"
  RMDir "$LOCALAPPDATA\Velox"
!macroend
