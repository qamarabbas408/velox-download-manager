import { ErrorCode } from "../types";
import type { StatusResponse } from "../types";

export type DisconnectedAction = "install" | "reconnect";

/**
 * Choose the next step shown while the popup is disconnected.
 *
 * A missing native-messaging host means the desktop app was never installed (or
 * its registration is gone), so point the user at the download. Every other
 * failure — app closed, timeout, transient disconnect — can simply be retried.
 */
export function disconnectedAction(status: StatusResponse): DisconnectedAction {
  if (status.errorCode === ErrorCode.HOST_NOT_FOUND) return "install";
  if (
    status.lastError &&
    /not found|not installed|not registered|cannot connect/i.test(status.lastError)
  ) {
    return "install";
  }
  return "reconnect";
}
