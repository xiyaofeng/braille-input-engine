import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { chromium } from "playwright";

// Serve only the extracted ZIP. A working source tree cannot fill missing assets.
export async function verifyReleaseDemo(archive) {
  const temp = await mkdtemp(join(tmpdir(), "braille-release-demo-"));
  let browser;
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(
        new URL(request.url, "http://localhost").pathname,
      );
      const path = resolve(
        temp,
        `.${pathname.endsWith("/") ? `${pathname}index.html` : pathname}`,
      );
      if (!path.startsWith(`${temp}${sep}`))
        throw new Error("Outside demo root");
      const content = await readFile(path);
      const mime = path.endsWith(".js")
        ? "text/javascript"
        : path.endsWith(".css")
          ? "text/css"
          : "text/html";
      response.writeHead(200, { "content-type": mime });
      response.end(content);
    } catch {
      response.writeHead(404);
      response.end("Missing demo resource");
    }
  });
  try {
    execFileSync("unzip", ["-q", archive, "-d", temp]);
    await readFile(join(temp, "index.html"));
    await readFile(join(temp, "default-ui.css"));
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    browser = await chromium.launch();
    const page = await browser.newPage();
    const failures = [];
    page.on("pageerror", (error) => failures.push(error.message));
    page.on("requestfailed", (request) => failures.push(request.url()));
    page.on("response", (response) => {
      if (response.status() >= 400)
        failures.push(`${response.status()} ${response.url()}`);
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`, {
      waitUntil: "networkidle",
    });
    assert.deepEqual(failures, [], "Release demo resource/runtime failure");
    assert.equal(
      await page.locator("#braille-ui button").count(),
      12,
      "Release demo controls missing",
    );
    assert(
      (await page.locator('link[rel="stylesheet"]').count()) > 0,
      "Release demo stylesheet missing",
    );
    await page.locator("#demo-output").focus();
    await page.keyboard.press("f");
    await page.keyboard.press("Space");
    assert.equal(
      await page.locator("#demo-output").inputValue(),
      "⠁",
      "Release demo keyboard input failed",
    );
    assert.deepEqual(failures, [], "Release demo runtime failure after input");
  } finally {
    await browser?.close();
    if (server.listening)
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    await rm(temp, { recursive: true, force: true });
  }
}
