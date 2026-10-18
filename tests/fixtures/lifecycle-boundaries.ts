import type * as Core from "../../src/index.js";
import type * as Adapters from "../../src/entries/adapters.js";

type Api = typeof Core & typeof Adapters;
type Mode = "chord" | "sequential" | "retry";
type Shape = "single" | "shared" | "nested";
function equal(actual: unknown, expected: unknown, label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(
      `${label}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`,
    );
}
function down(
  c: Core.BrailleInputController,
  dot: Core.BrailleDot,
  inputId: string,
) {
  c.dispatch({ type: "dot-down", dot, inputId, source: "api" });
}
function up(
  c: Core.BrailleInputController,
  dot: Core.BrailleDot,
  inputId: string,
) {
  c.dispatch({ type: "dot-up", dot, inputId, source: "api" });
}

export function setupTerminal(
  api: Api,
  options: {
    shape: Shape;
    kind: "pointer" | "keyboard";
    terminal: "pointerup" | "pointercancel" | "lostpointercapture" | "keyup";
    guards: "allow" | "deny" | "throw" | "mixed" | "reverse-mixed";
    mode: Mode;
    reentry: "state" | "guard" | "capture";
    shadow?: boolean;
  },
) {
  const { shape, kind, terminal, guards, mode, reentry } = options;
  const host = document.createElement("main");
  document.body.append(host);
  const root = options.shadow ? host.attachShadow({ mode: "open" }) : host;
  root.innerHTML =
    '<section><section><button data-braille-dot="1">one</button></section></section>';
  const outer = root.firstElementChild as HTMLElement,
    inner = outer.firstElementChild as HTMLElement;
  const button = inner.firstElementChild as HTMLElement;
  const calls: number[] = [],
    outputs: string[] = [],
    diagnostics: string[] = [];
  let armed = false,
    fired = false,
    rejecting = mode === "retry";
  const c = api.createBrailleController({
    inputMode: mode === "sequential" ? mode : "chord",
    toggleDots: false,
    outputSink: {
      write(action) {
        if (action.kind === "braille") outputs.push(action.char);
        return rejecting ? "rejected" : "accepted";
      },
    },
  });
  c.subscribeDiagnostic((d) => diagnostics.push(d.code));
  if (mode === "retry") {
    down(c, 1, "frozen");
    up(c, 1, "frozen");
  }
  const fresh = () => {
    if (!fired && armed && mode !== "retry") {
      fired = true;
      down(c, 2, "fresh");
    }
  };
  const scopes =
    shape === "single"
      ? [inner]
      : shape === "shared"
        ? [inner, inner]
        : [inner, outer];
  const guard = (index: number) => {
    if (!armed) return true;
    calls.push(index);
    if (reentry === "guard") fresh();
    if (guards === "throw") throw new Error("guard");
    return (
      guards === "allow" ||
      (guards === "mixed" && index === 0) ||
      (guards === "reverse-mixed" && index === 1)
    );
  };
  // Reverse registration verifies bubble path order, not Set insertion order.
  const attachments = [...scopes.entries()].reverse().map(([index, scope]) =>
    kind === "pointer"
      ? api.attachPointer(c, scope, {
          activation: "always",
          actionGuard: () => guard(index),
        })
      : api.attachKeyboard(c, scope, {
          activation: "always",
          keyboardFilter: () => guard(index),
        }),
  );
  const count = scopes.length;
  c.subscribeState((s) => {
    if (reentry === "state" && s.pressedInputIds.length === count - 1) fresh();
  });
  let releases = 0;
  const instrumentCapture = () => {
    button.setPointerCapture = () => {};
    button.releasePointerCapture = () => {
      releases++;
      if (reentry === "capture") fresh();
    };
  };
  const send = (type: string) =>
    button.dispatchEvent(
      kind === "pointer"
        ? new PointerEvent(type, {
            bubbles: true,
            composed: true,
            cancelable: true,
            pointerType: "touch",
            pointerId: 1,
            button: 0,
          })
        : new KeyboardEvent(type, {
            bubbles: true,
            composed: true,
            code: "KeyF",
          }),
    );
  const arm = () => {
    armed = true;
  };
  const verify = () => {
    const cancelled =
      (terminal !== "pointerup" && terminal !== "keyup") || guards !== "allow";
    const hadFresh =
      mode !== "retry" &&
      (reentry !== "capture" || (cancelled && kind === "pointer"));
    equal(fired, hadFresh, "reentry executed");
    const expectDots =
      mode === "retry"
        ? [1]
        : mode === "sequential"
          ? hadFresh
            ? [1, 2]
            : [1]
          : hadFresh
            ? [2]
            : [];
    equal(c.getState().pendingDots, expectDots, "terminal pending");
    equal(
      c.getState().pressedInputIds,
      hadFresh ? ["fresh"] : [],
      "terminal ownership",
    );
    const invokesGuard = terminal === "pointerup" || terminal === "keyup";
    const expectedCalls = !invokesGuard
      ? []
      : shape === "nested"
        ? [0, 1]
        : shape === "shared"
          ? [1, 0]
          : [0];
    equal(calls, expectedCalls, "guard count/order");
    if (mode === "retry") {
      equal(c.getState().awaitingRetry, true, "retry flag");
      rejecting = false;
      c.commitPending();
      equal(outputs, ["⠁", "⠁"], "actual retry");
    } else {
      if (hadFresh) up(c, 2, "fresh");
      if (mode === "sequential") c.commitPending();
      equal(
        outputs,
        mode === "sequential"
          ? [hadFresh ? "⠃" : "⠁"]
          : cancelled
            ? hadFresh
              ? ["⠂"]
              : []
            : hadFresh
              ? ["⠁", "⠂"]
              : ["⠁"],
        "accepted outputs",
      );
    }
    equal(c.getState().awaitingRetry, false, "retry released");
    const beforeLate = c.getState();
    send(terminal);
    if (kind === "pointer") send("lostpointercapture");
    equal(c.getState(), beforeLate, "late terminal inert");
    armed = false;
    down(c, 3, "next");
    up(c, 3, "next");
    if (mode === "sequential") c.commitPending();
    equal(outputs.at(-1), "⠄", "next round");
    equal(
      diagnostics,
      kind === "keyboard" && guards === "throw"
        ? Array(count).fill("INVALID_ACTION")
        : [],
      "diagnostics",
    );
    return { outputs, calls, releases, fired };
  };
  return {
    c,
    button,
    arm,
    send,
    verify,
    instrumentCapture,
    dispose() {
      armed = false;
      attachments.forEach((a) => a.detach());
      c.destroy();
      host.remove();
    },
  };
}

export function terminalBoundaryCases(api: Api) {
  const failures: string[] = [];
  let count = 0;
  for (const kind of ["pointer", "keyboard"] as const)
    for (const shape of ["single", "shared", "nested"] as const)
      for (const terminal of kind === "pointer"
        ? (["pointerup", "pointercancel", "lostpointercapture"] as const)
        : (["keyup"] as const))
        for (const guards of [
          "allow",
          "deny",
          "throw",
          "mixed",
          "reverse-mixed",
        ] as const)
          for (const mode of ["chord", "sequential", "retry"] as const)
            for (const queued of [false, true]) {
              if (shape === "single" && guards.includes("mixed")) continue;
              for (const reentry of (kind === "pointer" &&
              terminal !== "pointerup"
                ? ["state", "capture"]
                : ["state", "guard"]) as ("state" | "guard" | "capture")[]) {
                const name = JSON.stringify({
                  kind,
                  shape,
                  terminal,
                  guards,
                  mode,
                  queued,
                  reentry,
                });
                count++;
                const p = setupTerminal(api, {
                  shape,
                  kind,
                  terminal,
                  guards,
                  mode,
                  reentry,
                });
                p.instrumentCapture();
                try {
                  p.send(kind === "pointer" ? "pointerdown" : "keydown");
                  p.arm();
                  if (queued) {
                    let once = true;
                    const stop = p.c.subscribeState(() => {
                      if (once) {
                        once = false;
                        p.send(terminal);
                      }
                    });
                    stop();
                  } else p.send(terminal);
                  p.verify();
                } catch (error) {
                  failures.push(`${name}: ${String(error)}`);
                } finally {
                  p.dispose();
                }
              }
            }
  return { count, failures };
}

export function focusBoundaryCases(api: Api) {
  const failures: string[] = [];
  let count = 0;
  for (const shadow of [false, true])
    for (const groupKind of ["none", "same", "cross"] as const)
      for (const shape of ["single", "shared", "nested"] as const)
        for (const adapter of [
          "keyboard",
          "pointer",
          "root-keyboard",
          "document-keyboard",
        ] as const)
          for (const activation of ["focus", "manual", "always"] as const)
            for (const mode of ["chord", "sequential", "retry"] as const)
              for (const destination of [
                "inside",
                "same-root-outside",
                "outside",
                "member",
                "other-root-outside",
              ] as const) {
                if (!shadow && adapter === "root-keyboard") continue;
                if (
                  groupKind === "none" &&
                  (adapter.endsWith("-keyboard") || destination === "member")
                )
                  continue;
                if (
                  groupKind !== "cross" &&
                  destination === "other-root-outside"
                )
                  continue;
                const name = JSON.stringify({
                  shadow,
                  groupKind,
                  shape,
                  adapter,
                  activation,
                  mode,
                  destination,
                });
                count++;
                const host = document.createElement("div"),
                  peerHost = document.createElement("div"),
                  outside = document.createElement("button");
                document.body.append(host, peerHost, outside);
                const root = shadow
                  ? host.attachShadow({ mode: "open" })
                  : host;
                root.innerHTML =
                  '<section><section><button data-braille-dot="1">one</button><button>inside</button></section></section><button>other</button>';
                const outer = root.firstElementChild as HTMLElement,
                  scope = outer.firstElementChild as HTMLElement;
                const button = scope.firstElementChild as HTMLElement,
                  inside = scope.lastElementChild as HTMLElement,
                  sameOut = root.lastElementChild as HTMLElement;
                const peerRoot =
                  groupKind === "cross"
                    ? peerHost.attachShadow({ mode: "open" })
                    : root;
                const member = document.createElement("section");
                member.innerHTML = "<button>member</button>";
                const peerOutside = document.createElement("button");
                peerRoot.append(member, peerOutside);
                const group =
                  groupKind === "none"
                    ? undefined
                    : api.createActivationGroup(document);
                const tokens = group
                  ? [group.add(scope), group.add(member), group.add(member)]
                  : [];
                const outputs: string[] = [],
                  diagnostics: string[] = [];
                let reject = mode === "retry",
                  armed = false,
                  fired = false;
                const c = api.createBrailleController({
                  inputMode: mode === "sequential" ? mode : "chord",
                  toggleDots: false,
                  outputSink: {
                    write(a) {
                      if (a.kind === "braille") outputs.push(a.char);
                      return reject ? "rejected" : "accepted";
                    },
                  },
                });
                c.subscribeDiagnostic((d) => diagnostics.push(d.code));
                if (reject) {
                  down(c, 1, "frozen");
                  up(c, 1, "frozen");
                }
                const scopes =
                  shape === "single"
                    ? [scope]
                    : shape === "shared"
                      ? [scope, scope]
                      : [scope, outer];
                const attachments = scopes.map((element) =>
                  adapter === "pointer"
                    ? api.attachPointer(c, element, {
                        activation,
                        ...(group ? { activationGroup: group } : {}),
                      })
                    : api.attachKeyboard(
                        c,
                        adapter === "root-keyboard"
                          ? (root as ShadowRoot)
                          : adapter === "document-keyboard"
                            ? document
                            : element,
                        {
                          activation,
                          ...(group ? { activationGroup: group } : {}),
                        },
                      ),
                );
                if (activation === "manual")
                  attachments.forEach((a) => a.activate());
                button.setPointerCapture = () => {};
                button.releasePointerCapture = () => {};
                const send = (end: boolean) =>
                  button.dispatchEvent(
                    adapter === "pointer"
                      ? new PointerEvent(end ? "pointerup" : "pointerdown", {
                          pointerId: 1,
                          pointerType: "touch",
                          bubbles: true,
                          composed: true,
                        })
                      : new KeyboardEvent(end ? "keyup" : "keydown", {
                          code: "KeyF",
                          bubbles: true,
                          composed: true,
                        }),
                  );
                const stop = c.subscribeState((s) => {
                  if (
                    armed &&
                    !fired &&
                    mode !== "retry" &&
                    s.pressedInputIds.length === scopes.length - 1
                  ) {
                    fired = true;
                    down(c, 2, "focus-fresh");
                  }
                });
                try {
                  button.focus();
                  send(false);
                  const before = c.getState();
                  equal(
                    before.pressedInputIds.length,
                    mode === "retry" ? 0 : scopes.length,
                    "admission",
                  );
                  armed = true;
                  const target =
                    destination === "inside"
                      ? inside
                      : destination === "same-root-outside"
                        ? sameOut
                        : destination === "outside"
                          ? outside
                          : destination === "member"
                            ? (member.firstElementChild as HTMLElement)
                            : peerOutside;
                  target.focus();
                  const preserve =
                    activation !== "focus" ||
                    destination === "inside" ||
                    destination === "member";
                  if (preserve) {
                    equal(
                      c.getState(),
                      before,
                      "internal/manual/always transfer",
                    );
                    if (activation === "focus") outside.focus();
                  }
                  const shouldCancel = activation === "focus";
                  if (shouldCancel) {
                    equal(
                      c.getState().pressedInputIds,
                      mode === "retry" ? [] : ["focus-fresh"],
                      "focus exit ownership/reentry",
                    );
                    equal(
                      c.getState().pendingDots,
                      mode === "retry"
                        ? [1]
                        : mode === "sequential"
                          ? [1, 2]
                          : [2],
                      "focus exit pending",
                    );
                    send(true); // old terminal at old scope cannot submit the cancelled Cell
                    if (mode !== "retry") up(c, 2, "focus-fresh");
                  } else {
                    armed = false;
                    send(true);
                  }
                  if (mode === "retry") {
                    equal(
                      c.getState().awaitingRetry,
                      true,
                      "frozen focus flag",
                    );
                    reject = false;
                    c.commitPending();
                    equal(outputs, ["⠁", "⠁"], "frozen focus retry");
                  } else if (mode === "sequential") {
                    c.commitPending();
                    equal(
                      outputs,
                      [shouldCancel ? "⠃" : "⠁"],
                      "focus sequential",
                    );
                  } else
                    equal(
                      outputs,
                      [shouldCancel ? "⠂" : "⠁"],
                      "focus chord outputs",
                    );
                  equal(diagnostics, [], "focus diagnostics");
                  armed = false;
                  down(c, 3, "next");
                  up(c, 3, "next");
                  if (mode === "sequential") c.commitPending();
                  equal(outputs.at(-1), "⠄", "focus next round");
                  tokens[2]?.(); // repeated member token does not remove the remaining owner
                } catch (error) {
                  failures.push(`${name}: ${String(error)}`);
                } finally {
                  armed = false;
                  stop();
                  attachments.forEach((a) => a.detach());
                  tokens.forEach((t) => t());
                  group?.destroy();
                  c.destroy();
                  host.remove();
                  peerHost.remove();
                  outside.remove();
                }
              }
  return { count, failures };
}
