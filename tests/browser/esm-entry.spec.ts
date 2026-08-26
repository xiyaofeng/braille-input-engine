import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import type {
  BrailleInputController,
  BrailleInputOptions,
  BrailleOutputAction,
} from "../../src/core/types.js";

interface BrowserApi {
  readonly defaultControllerOptions: Readonly<{
    inputMode: string;
    spaceMode: string;
    toggleDots: boolean;
  }>;
  readonly createBrailleController: (
    options?: BrailleInputOptions,
  ) => BrailleInputController;
}

const root = resolve(process.cwd());
let server: Server | undefined;
let origin = "";

test.beforeAll(async () => {
  const documentBody = Buffer.from("<!doctype html><html><body></body></html>");
  server = createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const relative = pathname === "/" ? "index.html" : pathname.slice(1);
    const path = resolve(root, relative);
    if (!path.startsWith(`${root}/`)) {
      response.writeHead(403);
      response.end();
      return;
    }
    try {
      const body = pathname === "/" ? documentBody : readFileSync(path);
      response.writeHead(200, {
        "content-type": path.endsWith(".js") ? "text/javascript" : "text/html",
        "content-length": body.byteLength,
        connection: "close",
      });
      response.end(body);
    } catch {
      response.writeHead(404, { connection: "close" });
      response.end();
    }
  });
  const listeningServer = server;
  listeningServer.listen(0, "127.0.0.1");
  await once(listeningServer, "listening");
  const address = listeningServer.address();
  if (!address || typeof address === "string")
    throw new Error("ESM test server did not expose a port.");
  origin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  const currentServer = server;
  if (currentServer)
    await new Promise((resolveServer) => currentServer.close(resolveServer));
});

test("browser ESM entry imports and retains its public behavior", async ({
  page,
}) => {
  await page.goto(`${origin}/`);
  const result = await page.evaluate(async () => {
    // @ts-expect-error This is a browser-served runtime URL, not a source module.
    const api = (await import("/dist/browser.js")) as BrowserApi;
    let output: BrailleOutputAction | undefined;
    const controller = api.createBrailleController({
      toggleDots: false,
      spaceMode: "ascii",
      onOutput: (action) => {
        output = action;
      },
    });
    for (const inputId of ["esm-browser:1", "esm-browser:2"]) {
      controller.dispatch({
        type: "dot-down",
        dot: 1,
        inputId,
        source: "api",
      });
      controller.dispatch({
        type: "dot-up",
        dot: 1,
        inputId,
        source: "api",
      });
    }
    const pending = controller.getState().pendingDots.join(",");
    controller.cancelPending();
    controller.dispatch({ type: "space-request", source: "api" });
    controller.destroy();
    return {
      publicOptions: Object.keys(api.defaultControllerOptions).sort().join(","),
      pending,
      outputKind: output?.kind ?? null,
      outputText: output?.kind === "text" ? output.text : null,
    };
  });
  expect(result).toEqual({
    publicOptions: "inputMode,spaceMode,toggleDots",
    pending: "1",
    outputKind: "text",
    outputText: " ",
  });
});
