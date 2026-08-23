import assert from "node:assert/strict";
import test from "node:test";

import {
  getGoogleSignInErrorMessage,
  shouldFallbackToRedirect,
  shouldUseRedirectSignIn,
} from "../shared/auth-flow.mjs";

test("uses redirect sign-in on iPhone and iPad", () => {
  assert.equal(
    shouldUseRedirectSignIn({
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1",
      platform: "iPhone",
      maxTouchPoints: 5,
    }),
    true,
  );
  assert.equal(
    shouldUseRedirectSignIn({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.6 Safari/605.1.15",
      platform: "MacIntel",
      maxTouchPoints: 5,
    }),
    true,
  );
});

test("keeps popup sign-in on desktop browsers", () => {
  assert.equal(
    shouldUseRedirectSignIn({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.6 Safari/605.1.15",
      platform: "MacIntel",
      maxTouchPoints: 0,
    }),
    false,
  );
  assert.equal(
    shouldUseRedirectSignIn({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36",
      platform: "Win32",
      maxTouchPoints: 0,
    }),
    false,
  );
});

test("falls back to redirect when a popup or browser storage is blocked", () => {
  assert.equal(shouldFallbackToRedirect("auth/popup-blocked"), true);
  assert.equal(shouldFallbackToRedirect("auth/web-storage-unsupported"), true);
  assert.equal(shouldFallbackToRedirect("auth/popup-closed-by-user"), false);
});

test("shows actionable Google sign-in errors", () => {
  assert.match(
    getGoogleSignInErrorMessage("auth/network-request-failed"),
    /Sprawdź internet/,
  );
  assert.match(
    getGoogleSignInErrorMessage("auth/web-storage-unsupported"),
    /Safari/,
  );
});
