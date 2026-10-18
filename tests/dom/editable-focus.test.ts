// @vitest-environment jsdom
import { expect, it } from "vitest";
import * as core from "../../src/index.js";
import * as adapters from "../../src/entries/adapters.js";
import * as ui from "../../src/ui/default-ui.js";
import { editableFocusCases } from "../fixtures/editable-focus.js";
it("writes through the real editable sink with exact open-root focus and transaction guards", () => {
  const result = editableFocusCases({ ...core, ...adapters, ...ui });
  expect(result.count).toBe(100);
  expect(result.failures).toEqual([]);
});
