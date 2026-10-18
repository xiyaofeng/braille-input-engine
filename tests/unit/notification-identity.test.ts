import { expect, it } from "vitest";
import * as core from "../../src/index.js";
import { notificationIdentityCases } from "../fixtures/notification-identity.js";
it("disposes registration identity and preserves snapshot notification order", () => {
  expect(notificationIdentityCases(core)).toEqual([]);
});
