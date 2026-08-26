import { test, expect } from "@playwright/test";

test("browser IIFE exposes the Unicode encoder", async ({ page }) => {
  await page.goto("about:blank");
  await page.addScriptTag({ path: "dist/braille-input.iife.min.js" });
  expect(
    await page.evaluate(() =>
      (
        globalThis as typeof globalThis & {
          BrailleInput?: { dotsToBraille: (dots: number[]) => string };
        }
      ).BrailleInput?.dotsToBraille([1, 2, 4]),
    ),
  ).toBe("⠋");
});

test("default dot cell uses Braille's left 123 and right 456 layout", async ({
  page,
}) => {
  await page.setContent(`
    <div data-braille-ui-root>
      <div part="cell">
        <button data-braille-dot="1">1</button>
        <button data-braille-dot="2">2</button>
        <button data-braille-dot="3">3</button>
        <button data-braille-dot="4">4</button>
        <button data-braille-dot="5">5</button>
        <button data-braille-dot="6">6</button>
      </div>
    </div>
  `);
  await page.addStyleTag({ path: "src/ui/default-ui.css" });

  const positions = await page
    .locator("[data-braille-dot]")
    .evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          dot: element.getAttribute("data-braille-dot"),
          left: rect.left,
          top: rect.top,
        };
      }),
    );

  expect(positions.map(({ dot }) => dot)).toEqual([
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
  ]);
  expect(new Set(positions.slice(0, 3).map(({ left }) => left)).size).toBe(1);
  expect(new Set(positions.slice(3).map(({ left }) => left)).size).toBe(1);
  expect(positions[0]?.left).toBeLessThan(positions[3]?.left ?? Infinity);
  expect(positions[0]?.top).toBeLessThan(positions[1]?.top ?? Infinity);
  expect(positions[1]?.top).toBeLessThan(positions[2]?.top ?? Infinity);
  expect(positions[3]?.top).toBeLessThan(positions[4]?.top ?? Infinity);
  expect(positions[4]?.top).toBeLessThan(positions[5]?.top ?? Infinity);
});
