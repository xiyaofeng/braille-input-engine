import type * as Core from "../../src/index.js";
import type * as Adapters from "../../src/entries/adapters.js";
type Api = typeof Core & typeof Adapters;

// Serializable: the same assertions run against source, ESM/browser/IIFE and
// the unpacked package. Expected state is specified independently of the hub.
export async function lifecycleCoordinationCases(api?: Api) {
  if (!api) {
    // Browser-only fallback: source DOM tests inject api before dist exists.
    const load = (path: string) => import(/* @vite-ignore */ path);
    const core = (await load("/dist/core.js")) as typeof Core;
    const adapters = (await load("/dist/adapters.js")) as typeof Adapters;
    api = { ...core, ...adapters } as Api;
  }
  const failures: string[] = [];
  let count = 0;
  for (const mode of ["chord", "sequential", "custom"] as const)
    for (const eventType of ["blur", "hidden", "compositionstart"])
      for (const members of [1, 2])
        for (const held of [false, true])
          for (const queued of [false, true])
            for (const before of [false, true])
              for (const grouped of [false, true])
                for (const entry of ["api", "pointer"]) {
                  const label = JSON.stringify({
                    mode,
                    eventType,
                    members,
                    held,
                    queued,
                    before,
                    grouped,
                    entry,
                  });
                  count++;
                  const root = document.createElement("main");
                  root.innerHTML =
                    '<section></section><section></section><section><button data-braille-dot="2">2</button></section>';
                  document.body.append(root);
                  const [one, two, pointer] = [
                    ...root.children,
                  ] as HTMLElement[];
                  const dot = pointer!.firstElementChild as HTMLElement;
                  dot.setPointerCapture = () => {};
                  dot.releasePointerCapture = () => {};
                  const outputs: string[] = [],
                    diagnostics: string[] = [];
                  const id = api.extensionId("test:coordinated");
                  let resets = 0;
                  const c = api.createBrailleController({
                    inputMode: mode === "custom" ? id : mode,
                    strategies: [
                      () => ({
                        id,
                        activate() {},
                        deactivate() {},
                        destroy() {},
                        reset(_reason, ctx) {
                          resets++;
                          ctx.setPendingContributions([]);
                        },
                        handle(action, ctx) {
                          if (action.type === "dot-down")
                            ctx.setPendingContributions([
                              ...ctx.getPendingContributions(),
                              {
                                id: action.inputId,
                                dot: action.dot,
                                source: action.source,
                              },
                            ]);
                          if (action.type === "commit-request")
                            ctx.requestCommit(action.source);
                        },
                      }),
                    ],
                    outputSink: { write: () => "accepted" },
                    onOutput: (action, delivery) => {
                      if (action.kind === "braille")
                        outputs.push(`${action.char}:${delivery}`);
                    },
                    onDiagnostic: (d) => diagnostics.push(d.code),
                  });
                  const group = grouped
                    ? api.createActivationGroup(document)
                    : undefined;
                  let armed = false,
                    fired = false;
                  const sendPointer = (type: string) =>
                    dot.dispatchEvent(
                      new PointerEvent(type, {
                        bubbles: true,
                        pointerType: "touch",
                        pointerId: 22,
                      }),
                    );
                  const listen = (state: ReturnType<typeof c.getState>) => {
                    if (!armed || fired || state.pressedInputIds.length) return;
                    fired = true;
                    if (entry === "api")
                      c.dispatch({
                        type: "dot-down",
                        inputId: "new-api",
                        dot: 2,
                        source: "api",
                      });
                    else sendPointer("pointerdown");
                  };
                  let dispose = () => {};
                  if (before) dispose = c.subscribeState(listen);
                  const a = api.attachKeyboard(c, one!, {
                    activation: "always",
                    ...(group ? { activationGroup: group } : {}),
                  });
                  const b =
                    members === 2
                      ? api.attachKeyboard(c, two!, {
                          activation: "always",
                          ...(group ? { activationGroup: group } : {}),
                        })
                      : undefined;
                  const p = api.attachPointer(c, pointer!, {
                    activation: "always",
                  });
                  if (!before) dispose = c.subscribeState(listen);
                  const key = (
                    target: HTMLElement,
                    type: string,
                    code: string,
                  ) =>
                    target.dispatchEvent(
                      new KeyboardEvent(type, { bubbles: true, code }),
                    );
                  key(one!, "keydown", "KeyF");
                  if (held && b) key(two!, "keydown", "KeyS");
                  armed = true;
                  const loss = () => {
                    if (eventType === "blur")
                      window.dispatchEvent(new Event("blur"));
                    else if (eventType === "hidden") {
                      Object.defineProperty(document, "visibilityState", {
                        configurable: true,
                        value: "hidden",
                      });
                      document.dispatchEvent(new Event("visibilitychange"));
                    } else
                      document.dispatchEvent(new Event("compositionstart"));
                  };
                  if (queued) {
                    let once = false;
                    c.subscribeState(() => {
                      if (!once) {
                        once = true;
                        loss();
                      }
                    })();
                  } else loss();
                  const after = c.getState();
                  key(one!, "keyup", "KeyF");
                  key(two!, "keyup", "KeyS");
                  if (entry === "api")
                    c.dispatch({
                      type: "dot-up",
                      inputId: "new-api",
                      dot: 2,
                      source: "api",
                    });
                  else sendPointer("pointerup");
                  if (mode !== "chord") c.commitPending();
                  const expectedDots =
                    mode === "sequential"
                      ? held && b
                        ? [1, 2, 3]
                        : [1, 2]
                      : [2];
                  const expectedChar = String.fromCodePoint(
                    0x2800 +
                      expectedDots.reduce(
                        (mask, d) => mask | (1 << (d - 1)),
                        0,
                      ),
                  );
                  if (
                    !fired ||
                    after.pressedInputIds.length !== 1 ||
                    String(after.pendingDots) !== String(expectedDots) ||
                    String(outputs) !== `${expectedChar}:accepted` ||
                    diagnostics.length ||
                    (mode === "custom" && resets !== 1)
                  )
                    failures.push(label);
                  armed = false;
                  dispose();
                  a.detach();
                  b?.detach();
                  p.detach();
                  group?.destroy();
                  c.destroy();
                  root.remove();
                  Reflect.deleteProperty(document, "visibilityState");
                }
  let edgeCount = 0;
  for (const nested of [false, true])
    for (const connected of [false, true])
      for (const terminal of ["pointercancel", "lostpointercapture"]) {
        edgeCount++;
        const outer = document.createElement("section"),
          inner = document.createElement("section");
        inner.innerHTML = '<button data-braille-dot="1">1</button>';
        outer.append(inner);
        if (connected) document.body.append(outer);
        const button = inner.firstElementChild as HTMLElement;
        button.setPointerCapture = () => {};
        button.releasePointerCapture = () => {};
        const c = api.createBrailleController({ inputMode: "chord" });
        const a = api.attachPointer(c, inner, { activation: "always" }),
          b = api.attachPointer(c, nested ? outer : inner, {
            activation: "always",
          });
        const send = (type: string, id: number) =>
          button.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              pointerId: id,
              pointerType: "touch",
            }),
          );
        let armed = false,
          fired = false;
        const outputs: string[] = [];
        c.subscribeOutput((x) => {
          if (x.kind === "braille") outputs.push(x.char);
        });
        c.subscribeState((s) => {
          if (armed && !fired && s.pressedInputIds.length === 1) {
            fired = true;
            c.dispatch({
              type: "dot-down",
              dot: 2,
              inputId: "fresh",
              source: "api",
            });
          }
        });
        send("pointerdown", 1);
        armed = true;
        send(terminal, 1);
        const after = c.getState();
        c.dispatch({ type: "dot-up", dot: 2, inputId: "fresh", source: "api" });
        if (
          !fired ||
          String(after.pendingDots) !== "2" ||
          String(after.pressedInputIds) !== "fresh" ||
          String(outputs) !== "⠂"
        )
          failures.push(`pointer-fanout:${nested}:${connected}:${terminal}`);
        const event = new PointerEvent(terminal, {
          bubbles: true,
          pointerId: 2,
          pointerType: "touch",
        });
        for (let i = 0; i < 2; i++) {
          send("pointerdown", 2);
          button.dispatchEvent(event);
          if (c.getState().pressedInputIds.length)
            failures.push(
              `pointer-reuse:${nested}:${connected}:${terminal}:${i}`,
            );
        }
        a.detach();
        b.detach();
        c.destroy();
        outer.remove();
      }
  for (const event of ["blur", "hidden", "compositionstart"]) {
    edgeCount++;
    const scope = document.createElement("section");
    scope.innerHTML = '<button data-braille-dot="1">1</button>';
    document.body.append(scope);
    const button = scope.firstElementChild as HTMLElement;
    button.setPointerCapture = () => {};
    let released = 0;
    button.releasePointerCapture = () => {
      released++;
    };
    const c = api.createBrailleController({ inputMode: "chord" }),
      a = api.attachPointer(c, scope, { activation: "always" });
    button.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        pointerId: 1,
        pointerType: "touch",
      }),
    );
    if (event === "blur") window.dispatchEvent(new Event("blur"));
    else if (event === "hidden") {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    } else document.dispatchEvent(new Event("compositionstart"));
    if (
      c.getState().pressedInputIds.length ||
      c.getState().pendingDots.length ||
      released !== 1
    )
      failures.push(`pointer-only:${event}`);
    a.detach();
    c.destroy();
    scope.remove();
    Reflect.deleteProperty(document, "visibilityState");
  }
  for (const activation of ["focus", "manual", "always"] as const) {
    edgeCount++;
    const c = api.createBrailleController({ inputMode: "chord" });
    const group = api.createActivationGroup(document);
    const one = document.createElement("section"),
      two = document.createElement("section"),
      outside = document.createElement("button");
    document.body.append(one, two, outside);
    const a = api.attachKeyboard(c, one, {
        activationGroup: group,
        activation,
      }),
      b = api.attachKeyboard(c, two, { activationGroup: group, activation });
    a.activate();
    b.activate();
    one.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, code: "KeyF" }),
    );
    two.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, code: "KeyD" }),
    );
    one.dispatchEvent(
      new FocusEvent("focusout", { bubbles: true, relatedTarget: two }),
    );
    if (c.getState().pressedInputIds.length !== 2)
      failures.push(`focus-inside:${activation}`);
    let armed = true;
    c.subscribeState((s) => {
      if (armed && s.pressedInputIds.length === 1) {
        armed = false;
        c.dispatch({
          type: "dot-down",
          dot: 3,
          inputId: "new-focus",
          source: "api",
        });
      }
    });
    two.dispatchEvent(
      new FocusEvent("focusout", { bubbles: true, relatedTarget: outside }),
    );
    if (activation === "focus") {
      if (
        String(c.getState().pressedInputIds) !== "new-focus" ||
        String(c.getState().pendingDots) !== "3"
      )
        failures.push("focus-exit");
    } else if (c.getState().pressedInputIds.length !== 2)
      failures.push(`focus-opt-out:${activation}`);
    armed = false;
    a.detach();
    b.detach();
    group.destroy();
    c.destroy();
    one.remove();
    two.remove();
    outside.remove();
  }
  edgeCount++;
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const child = frame.contentDocument;
  if (!child) throw new Error("same-origin fixture document unavailable");
  const scope = child.createElement("section");
  child.body.append(scope);
  const c = api.createBrailleController({ inputMode: "chord" });
  const attachment = api.attachKeyboard(c, scope);
  scope.dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, code: "KeyF" }),
  );
  if (String(c.getState().pendingDots) !== "1") failures.push("iframe-keydown");
  scope.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  if (c.getState().pressedInputIds.length || c.getState().pendingDots.length)
    failures.push("iframe-focus-exit");
  attachment.detach();
  c.destroy();
  frame.remove();
  return { count, edgeCount, failures };
}
