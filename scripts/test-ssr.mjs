const globals = ["window", "document", "navigator"];
for (const name of globals) delete globalThis[name];
const module = await import("../dist/index.js");
if (
  typeof module.createBrailleController !== "function" ||
  typeof module.dotsToBraille !== "function"
) {
  throw new Error("SSR entry did not expose the core API.");
}
const controller = module.createBrailleController();
controller.dispatch({
  type: "dot-down",
  dot: 1,
  inputId: "ssr:1",
  source: "api",
});
controller.dispatch({ type: "commit-request", source: "api" });
if (controller.getState().pendingDots.length !== 0)
  throw new Error("SSR core smoke did not commit.");
controller.destroy();
