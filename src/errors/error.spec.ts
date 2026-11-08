import { afterEach, expect, it, vi } from "vite-plus/test";
import { asFrameworkError, FrameworkError } from "./error.ts";

afterEach(() => vi.unstubAllGlobals());

it("preserves the original fault when the host cannot generate an optional diagnostic ID", () => {
  vi.stubGlobal("crypto", undefined);
  const cause = new Error("Original runtime failure");
  const error = asFrameworkError(cause);
  expect(error.code).toBe("INTERNAL.UNEXPECTED");
  expect(error.cause).toBe(cause);
  expect(error.toEnvelope().errorId).toBeUndefined();
  expect(asFrameworkError(error)).toBe(error);
  expect(error).toBeInstanceOf(FrameworkError);
});
