import assert from "node:assert/strict";
import test from "node:test";

import { resolvePushDeviceStatus } from "../shared/push-notifications.mjs";

test("push device indicator is green only for an active registered token", () => {
  assert.equal(
    resolvePushDeviceStatus({ supported: true, permission: "granted", tokenActive: true }),
    "enabled",
  );
  assert.equal(
    resolvePushDeviceStatus({ supported: true, permission: "granted", tokenActive: false }),
    "disabled",
  );
});

test("push device indicator distinguishes opt-out, blocked and unsupported states", () => {
  assert.equal(
    resolvePushDeviceStatus({
      supported: true,
      permission: "granted",
      optedOut: true,
      tokenActive: true,
    }),
    "disabled",
  );
  assert.equal(
    resolvePushDeviceStatus({ supported: true, permission: "denied" }),
    "blocked",
  );
  assert.equal(
    resolvePushDeviceStatus({ supported: false, permission: "default" }),
    "unsupported",
  );
});
