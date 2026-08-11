import { useCallback, useEffect, useRef } from "react";
import { getCurrentWindow, ProgressBarStatus } from "@tauri-apps/api/window";
import { TrayIcon } from "@tauri-apps/api/tray";
import { Menu, MenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { isTauri } from "../engine";
import { trayIconBytes } from "./trayIcon";

export function useSystemTray(opts: {
  activeCount: number;
  totalSpeedLabel: string;
  hasActive: boolean;
  taskbarProgress: number | null;
  onPauseAll: () => void;
}) {
  const { activeCount, totalSpeedLabel, hasActive, taskbarProgress, onPauseAll } = opts;
  const trayRef = useRef<TrayIcon | null>(null);
  const onPauseAllRef = useRef(onPauseAll);
  onPauseAllRef.current = onPauseAll;
  const pauseItemRef = useRef<MenuItem | null>(null);
  const hasActiveRef = useRef(hasActive);
  hasActiveRef.current = hasActive;

  const showWindow = useCallback(async () => {
    try {
      const win = getCurrentWindow();
      await win.show();
      await win.setFocus();
    } catch {}
  }, []);

  const hideWindow = useCallback(async () => {
    try {
      await getCurrentWindow().hide();
    } catch {}
  }, []);

  const toggleWindow = useCallback(async () => {
    try {
      const win = getCurrentWindow();
      const visible = await win.isVisible();
      if (visible) hideWindow();
      else await showWindow();
    } catch {}
  }, [showWindow, hideWindow]);

  useEffect(() => {
    if (!isTauri) return;
    let unlistenClose: (() => void) | undefined;
    let disposed = false;

    (async () => {
      try {
        const showHide = await MenuItem.new({
          text: "Show Velox",
          action: () => toggleWindow(),
        });
        const sep1 = await PredefinedMenuItem.new({ item: "Separator" });
        const pauseAll = await MenuItem.new({
          text: "Pause All",
          enabled: hasActiveRef.current,
          action: () => onPauseAllRef.current(),
        });
        pauseItemRef.current = pauseAll;
        const sep2 = await PredefinedMenuItem.new({ item: "Separator" });
        const quit = await MenuItem.new({
          text: "Quit",
          action: () => getCurrentWindow().destroy(),
        });

        const menu = await Menu.new({ items: [showHide, sep1, pauseAll, sep2, quit] });

        if (disposed) return;
        const tray = await TrayIcon.new({
          id: "main",
          menu,
          icon: trayIconBytes(),
          iconAsTemplate: true,
          tooltip: "Velox Download Manager",
          showMenuOnLeftClick: false,
          action: (e) => {
            if (e.type === "Click" && e.button === "Left" && e.buttonState === "Up") {
              toggleWindow();
            }
          },
        });
        if (disposed) return;
        trayRef.current = tray;

        const win = getCurrentWindow();
        unlistenClose = await win.onCloseRequested(async (e) => {
          e.preventDefault();
          hideWindow();
        });
      } catch {
        // tray unavailable or unsupported platform
      }
    })();

    return () => {
      disposed = true;
      unlistenClose?.();
      trayRef.current?.close().catch(() => {});
      trayRef.current = null;
    };
  }, [toggleWindow, hideWindow]);

  useEffect(() => {
    if (!isTauri) return;
    pauseItemRef.current?.setEnabled(hasActive).catch(() => {});
  }, [hasActive]);

  useEffect(() => {
    if (!isTauri) return;
    const tooltip =
      activeCount > 0
        ? `Velox — ${activeCount} active · ${totalSpeedLabel}`
        : "Velox — idle";
    trayRef.current?.setTooltip(tooltip).catch(() => {});
  }, [activeCount, totalSpeedLabel]);

  useEffect(() => {
    if (!isTauri) return;
    const state =
      taskbarProgress == null
        ? { status: ProgressBarStatus.None }
        : { status: ProgressBarStatus.Normal, progress: taskbarProgress };
    getCurrentWindow().setProgressBar(state).catch(() => {});
  }, [taskbarProgress]);
}

export async function notifyDownloadComplete(name: string, extension: string) {
  if (!isTauri) return;
  try {
    let granted = await isPermissionGranted();
    if (!granted) {
      granted = (await requestPermission()) === "granted";
    }
    if (!granted) return;
    sendNotification({ title: "Download complete", body: `${name}.${extension}` });
  } catch {}
}

export async function notifyDownloadFailed(name: string, extension: string) {
  if (!isTauri) return;
  try {
    let granted = await isPermissionGranted();
    if (!granted) {
      granted = (await requestPermission()) === "granted";
    }
    if (!granted) return;
    sendNotification({ title: "Download failed", body: `${name}.${extension}` });
  } catch {}
}
