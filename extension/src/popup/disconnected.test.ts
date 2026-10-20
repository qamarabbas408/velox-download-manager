import { describe, expect, it } from "vitest";
import { SOURCEFORGE_URL } from "../constants";
import { ErrorCode } from "../types";
import type { StatusResponse } from "../types";
import { disconnectedAction } from "./disconnected";

const base: StatusResponse = {
  connected: false,
  lastError: null,
  errorCode: null,
  clientId: "test",
};

describe("disconnectedAction", () => {
  it("offers the install link when the native host is missing", () => {
    expect(
      disconnectedAction({
        ...base,
        errorCode: ErrorCode.HOST_NOT_FOUND,
        lastError: "Velox browser host is not installed or registered.",
      })
    ).toBe("install");
  });

  it("offers the install link from a not-found message without a code", () => {
    expect(
      disconnectedAction({
        ...base,
        lastError: "Specified native messaging host not found.",
      })
    ).toBe("install");
  });

  it("offers reconnect for other failures", () => {
    expect(
      disconnectedAction({
        ...base,
        errorCode: ErrorCode.APP_NOT_RUNNING,
        lastError: "Velox is not running.",
      })
    ).toBe("reconnect");
    expect(disconnectedAction(base)).toBe("reconnect");
  });

  it("links to the SourceForge project page", () => {
    expect(SOURCEFORGE_URL).toBe(
      "https://sourceforge.net/projects/velox-download-manager/"
    );
  });
});
