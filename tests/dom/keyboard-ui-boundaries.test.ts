// @vitest-environment jsdom
import { expect, it } from "vitest";
import * as core from "../../src/index.js";
import * as adapters from "../../src/entries/adapters.js";
import * as ui from "../../src/ui/default-ui.js";
import { keyboardUIBoundaryCases } from "../fixtures/keyboard-ui-boundaries.js";

it("excludes actual UI controls while admitting ordinary members and releasing owned keys", () => {
  const result = keyboardUIBoundaryCases({ ...core, ...adapters, ...ui });
  expect(result.count).toBe(5760);
  expect(result.failures).toEqual([]);
});
