import type * as Core from "../../src/index.js";
import type * as Adapters from "../../src/entries/adapters.js";

type Api = typeof Core & typeof Adapters;

// This function is serialized into Playwright as well as called with source
// modules in JSDOM, so its runtime dependencies must be local to the function.
export async function activationLossCases(api?: Api) {
  if (!api) {
    // Browser-only fallback: source DOM tests inject api before dist exists.
    const load = (path: string) => import(/* @vite-ignore */ path);
    const core = (await load("/dist/core.js")) as typeof Core;
    const adapters = (await load("/dist/adapters.js")) as typeof Adapters;
    api = { ...core, ...adapters } as Api;
  }
  const results = [];
  for (const mode of ["chord", "custom"] as const)
    for (const sibling of ["pointer", "keyboard"] as const)
      for (const held of [false, true])
        for (const queued of [false, true])
          for (const before of [false, true])
            for (const newInput of ["dom", "api", "capture"] as const) {
              const root = document.createElement("main");
              root.innerHTML =
                '<section><button data-braille-dot="1">1</button></section><section><button data-braille-dot="3">3</button></section><section><button data-braille-dot="2">2</button></section>';
              document.body.append(root);
              const [s1, s3, s2] = [...root.children] as [
                HTMLElement,
                HTMLElement,
                HTMLElement,
              ];
              const [d1, d3, d2] = [
                s1.firstElementChild,
                s3.firstElementChild,
                s2.firstElementChild,
              ] as [HTMLElement, HTMLElement, HTMLElement];
              const id = api.extensionId("test:group-latch");
              const c = api.createBrailleController({
                inputMode: mode === "custom" ? id : mode,
                ...(mode === "custom"
                  ? {
                      strategies: [
                        () => ({
                          id,
                          activate() {},
                          deactivate() {},
                          destroy() {},
                          reset(reason, context) {
                            if (reason === "activation-lost")
                              context.setPendingContributions([]);
                          },
                          handle(action, context) {
                            if (action.type === "dot-down")
                              context.setPendingContributions([
                                ...context.getPendingContributions(),
                                {
                                  id: action.inputId,
                                  dot: action.dot,
                                  source: action.source,
                                },
                              ]);
                            if (action.type === "commit-request")
                              context.requestCommit(action.source);
                          },
                        }),
                      ],
                    }
                  : {}),
              });
              const outputs: string[] = [],
                diagnostics: string[] = [];
              c.subscribeOutput((action) => {
                if (action.kind === "braille") outputs.push(action.char);
              });
              c.subscribeDiagnostic((d) => diagnostics.push(d.code));
              const send = (
                element: HTMLElement,
                type: string,
                pointerId: number,
              ) =>
                element.dispatchEvent(
                  new PointerEvent(type, {
                    bubbles: true,
                    cancelable: true,
                    pointerType: "touch",
                    pointerId,
                    button: 0,
                  }),
                );
              let armed = false,
                fired = false;
              const start = () => {
                if (!armed || fired) return;
                fired = true;
                if (newInput === "api")
                  c.dispatch({
                    type: "dot-down",
                    dot: 2,
                    inputId: "new-api",
                    source: "api",
                  });
                else send(d2, "pointerdown", 2);
              };
              for (const dot of [d1, d3, d2]) {
                dot.setPointerCapture = () => {};
                dot.releasePointerCapture =
                  newInput === "capture" ? start : () => {};
              }
              const listener = (state: ReturnType<typeof c.getState>) => {
                if (
                  newInput !== "capture" &&
                  !state.pressedInputIds.some((x) => x.endsWith(":dot:1"))
                )
                  start();
              };
              let dispose = () => {};
              if (before) dispose = c.subscribeState(listener);
              const group = api.createActivationGroup(document);
              const a = api.attachPointer(c, s1, { activationGroup: group });
              const extra =
                sibling === "pointer"
                  ? api.attachPointer(c, s3, { activationGroup: group })
                  : api.attachKeyboard(c, s3, { activationGroup: group });
              const b = api.attachPointer(c, s2, { activation: "always" });
              if (!before) dispose = c.subscribeState(listener);
              send(d1, "pointerdown", 1);
              if (held) {
                if (sibling === "pointer") send(d3, "pointerdown", 3);
                else
                  s3.dispatchEvent(
                    new KeyboardEvent("keydown", {
                      bubbles: true,
                      cancelable: true,
                      code: "KeyD",
                    }),
                  );
              }
              armed = true;
              if (queued) {
                let once = false;
                c.subscribeState(() => {
                  if (!once) {
                    once = true;
                    group.destroy();
                  }
                })();
              } else group.destroy();
              const after = c.getState();
              // Late events belonging to the destroyed group cannot commit or
              // release the unrelated new round.
              send(d1, "lostpointercapture", 1);
              send(d3, "pointerup", 3);
              s3.dispatchEvent(
                new KeyboardEvent("keyup", { bubbles: true, code: "KeyD" }),
              );
              if (newInput === "api")
                c.dispatch({
                  type: "dot-up",
                  dot: 2,
                  inputId: "new-api",
                  source: "api",
                });
              else send(d2, "pointerup", 2);
              if (mode === "custom") c.commitPending();
              results.push({
                kind: "group",
                mode,
                sibling,
                held,
                queued,
                before,
                newInput,
                fired,
                after,
                final: c.getState(),
                outputs: [...outputs],
                diagnostics: [...diagnostics],
              });
              armed = false;
              dispose();
              a.detach();
              extra.detach();
              b.detach();
              c.destroy();
              root.remove();
            }
  for (const mode of ["chord", "sequential", "custom"] as const)
    for (const transition of [
      "deactivate",
      "detach",
      "group-destroy",
      "blur",
      "hidden",
      "compositionstart",
      "disable",
      "configuration-change",
    ] as const) {
      const root = document.createElement("section");
      root.innerHTML = '<button data-braille-dot="1">1</button>';
      document.body.append(root);
      const dot = root.firstElementChild as HTMLElement;
      dot.setPointerCapture = () => {};
      dot.releasePointerCapture = () => {};
      const id = api.extensionId("test:frozen-retry");
      let accepted = false;
      const attempts: string[] = [],
        diagnostics: string[] = [],
        resets: string[] = [];
      const c = api.createBrailleController({
        inputMode: mode === "custom" ? id : mode,
        outputSink: {
          write(action) {
            if (action.kind === "braille") attempts.push(action.char);
            return accepted ? "accepted" : "rejected";
          },
        },
        ...(mode === "custom"
          ? {
              strategies: [
                () => ({
                  id,
                  activate() {},
                  deactivate() {},
                  destroy() {},
                  reset(reason, context) {
                    resets.push(reason);
                    context.setPendingContributions([]);
                  },
                  handle(action, context) {
                    if (action.type === "dot-down")
                      context.setPendingContributions([
                        {
                          id: action.inputId,
                          dot: action.dot,
                          source: action.source,
                        },
                      ]);
                    if (action.type === "commit-request")
                      context.requestCommit(action.source);
                  },
                }),
              ],
            }
          : {}),
      });
      c.subscribeDiagnostic((d) => diagnostics.push(d.code));
      const group = api.createActivationGroup(document);
      const a = api.attachPointer(c, root, {
        activation: "manual",
        activationGroup: group,
      });
      a.activate();
      const keyboard = api.attachKeyboard(c, root, {
        activation: "always",
        activationGroup: group,
      });
      for (const type of ["pointerdown", "pointerup"])
        dot.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            pointerType: "touch",
            pointerId: 1,
            button: 0,
          }),
        );
      if (mode !== "chord") c.commitPending();
      const frozen = c.getState();
      accepted = true;
      if (transition === "deactivate" || transition === "detach")
        a[transition]();
      else if (transition === "group-destroy") group.destroy();
      else if (transition === "blur") window.dispatchEvent(new Event("blur"));
      else if (transition === "compositionstart")
        document.dispatchEvent(new Event("compositionstart"));
      else if (transition === "hidden") {
        const own = Object.getOwnPropertyDescriptor(
          document,
          "visibilityState",
        );
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          value: "hidden",
        });
        document.dispatchEvent(new Event("visibilitychange"));
        if (own) Object.defineProperty(document, "visibilityState", own);
        else Reflect.deleteProperty(document, "visibilityState");
      } else if (transition === "disable") c.disable();
      else keyboard.updateOptions({ keyMap: { KeyF: 2 } });
      const after = c.getState();
      // Retry gate still rejects editing; successful retry releases it.
      c.dispatch({
        type: "dot-down",
        dot: 2,
        inputId: "blocked",
        source: "api",
      });
      c.commitPending();
      const final = c.getState();
      c.enable();
      c.dispatch({ type: "dot-down", dot: 2, inputId: "next", source: "api" });
      c.dispatch({ type: "dot-up", dot: 2, inputId: "next", source: "api" });
      if (mode !== "chord") c.commitPending();
      results.push({
        kind: "retry",
        mode,
        transition,
        frozen,
        after,
        final,
        attempts: [...attempts],
        diagnostics: [...diagnostics],
        resets: [...resets],
      });
      a.detach();
      keyboard.detach();
      group.destroy();
      c.destroy();
      root.remove();
    }
  return results;
}
