import type * as Core from "../../src/index.js";
import type * as Adapters from "../../src/entries/adapters.js";
import type * as UI from "../../src/ui/default-ui.js";

export type UIApi = typeof Core & typeof Adapters & typeof UI;
export const uiShapes = [
  { shadow: false, scope: "document" },
  { shadow: false, scope: "local" },
  { shadow: true, scope: "document" },
  { shadow: true, scope: "root" },
  { shadow: true, scope: "local" },
] as const;
export const uiControls = [
  "clear",
  "commit",
  "retry",
  "discard",
  "backspace",
  "mode",
  "dot",
  "chord-test",
] as const;
export type UIControl = (typeof uiControls)[number];
type Shape = (typeof uiShapes)[number];

function equal(actual: unknown, expected: unknown, label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(
      `${label}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`,
    );
}

// Real renderer and public controller/adapter APIs are used for all entries.
export function setupKeyboardUI(
  api: UIApi,
  shape: Shape,
  options: Pick<
    Core.KeyboardAdapterOptions,
    "activation" | "preventDefault"
  > = {},
) {
  const host = document.createElement("main");
  document.body.append(host);
  const root = shape.shadow ? host.attachShadow({ mode: "open" }) : host;
  const scope = document.createElement("section"),
    mount = document.createElement("section");
  const ordinary = document.createElement("textarea"),
    outside = document.createElement("textarea");
  scope.append(ordinary, mount);
  root.append(scope, outside);
  const outputs: string[] = [],
    diagnostics: string[] = [],
    filters: string[] = [];
  let rejecting = false;
  const c = api.createBrailleController({
    outputSink: { write: () => (rejecting ? "rejected" : "accepted") },
    onOutput: (action) =>
      outputs.push(
        action.kind === "braille"
          ? action.char
          : action.kind === "command"
            ? action.command
            : action.kind === "text"
              ? action.text
              : "space-intent",
      ),
    onDiagnostic: (d) => diagnostics.push(d.code),
  });
  const group = api.createActivationGroup(document),
    member = group.add(ordinary);
  const keyboard = api.attachKeyboard(
    c,
    shape.scope === "document"
      ? document
      : shape.scope === "root"
        ? root
        : scope,
    {
      activationGroup: group,
      // Enter is intentionally a valid engine commit too: exclusion wins.
      commitKeys: ["Enter", "NumpadEnter"],
      ...options,
      keyboardFilter: (event) => {
        filters.push(event.type);
        return true;
      },
    },
  );
  keyboard.activate();
  const ui = api.createDefaultBrailleUI(c, mount, {
    activationGroup: group,
    keyboardBindings: keyboard,
  });
  const selectors: Record<UIControl, string> = {
    clear: '[part="clear-button"]',
    commit: '[part="commit-button"]',
    retry: '[part="retry-button"]',
    discard: '[part="discard-button"]',
    backspace: 'button[part="actions"]',
    mode: '[part="mode-selector"]',
    dot: '[data-braille-dot="2"]',
    "chord-test": '[part="chord-test"] button',
  };
  const controls = Object.fromEntries(
    uiControls.map((name) => [name, mount.querySelector(selectors[name])]),
  ) as Record<UIControl, HTMLElement>;
  const descendants = Object.fromEntries(
    uiControls.map((name) => {
      const control = controls[name];
      if (name === "mode") return [name, control.firstElementChild];
      const label = document.createElement("span");
      label.textContent = control.textContent;
      control.replaceChildren(label);
      return [name, label];
    }),
  ) as Record<UIControl, HTMLElement>;
  let clicks = 0;
  for (const control of Object.values(controls))
    control.addEventListener("click", () => clicks++);
  const events: KeyboardEvent[] = [];
  scope.addEventListener(
    "keydown",
    (event) => events.push(event as KeyboardEvent),
    true,
  );
  scope.addEventListener(
    "keyup",
    (event) => events.push(event as KeyboardEvent),
    true,
  );
  const clearObservations = () => {
    outputs.length = diagnostics.length = filters.length = events.length = 0;
    clicks = 0;
  };
  const seed = (control: UIControl) => {
    c.setInputMode("sequential");
    c.cancelPending();
    c.dispatch({ type: "dot-down", dot: 1, inputId: "seed", source: "api" });
    c.dispatch({ type: "dot-up", dot: 1, inputId: "seed", source: "api" });
    if (control === "retry" || control === "discard") {
      rejecting = true;
      c.commitPending();
      rejecting = false;
      equal(c.getState().awaitingRetry, true, "seed retry");
    }
    controls[control].focus();
    clearObservations();
  };
  const send = (
    target: HTMLElement,
    type: string,
    code: string,
    repeat = false,
  ) => {
    const event = new KeyboardEvent(type, {
      code,
      repeat,
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    target.dispatchEvent(event);
    return event;
  };
  const snapshot = () => ({
    pending: [...c.getState().pendingDots],
    pressed: [...c.getState().pressedInputIds],
    retry: c.getState().awaitingRetry,
    mode: c.getState().inputMode,
    outputs: [...outputs],
    diagnostics: [...diagnostics],
    filters: [...filters],
    clicks,
    events: events.map((event) => ({
      type: event.type,
      code: event.code,
      trusted: event.isTrusted,
      prevented: event.defaultPrevented,
    })),
  });
  return {
    c,
    keyboard,
    controls,
    descendants,
    ordinary,
    outside,
    seed,
    send,
    snapshot,
    clearObservations,
    dispose() {
      keyboard.detach();
      ui.detach();
      member();
      group.destroy();
      c.destroy();
      host.remove();
    },
  };
}

export function keyboardUIBoundaryCases(api: UIApi) {
  const failures: string[] = [];
  let count = 0;
  for (const shape of uiShapes)
    for (const activation of ["focus", "manual", "always"] as const)
      for (const preventDefault of ["handled", "always", "never"] as const) {
        const p = setupKeyboardUI(api, shape, { activation, preventDefault });
        try {
          for (const control of uiControls) {
            p.seed(control);
            for (const descendant of [false, true])
              for (const code of [
                "Space",
                "Enter",
                "KeyD",
                "Numpad4",
                "NumpadEnter",
                "Backspace",
                "Escape",
                "KeyZ",
              ]) {
                const label = JSON.stringify({
                  ...shape,
                  activation,
                  preventDefault,
                  control,
                  descendant,
                  code,
                });
                count++;
                try {
                  const before = p.c.getState();
                  const target = (descendant ? p.descendants : p.controls)[
                    control
                  ];
                  const events = [
                    p.send(target, "keydown", code),
                    p.send(target, "keydown", code, true),
                    p.send(target, "keyup", code),
                  ];
                  equal(p.c.getState(), before, `${label} state`);
                  equal(
                    events.map((e) => e.defaultPrevented),
                    [false, false, false],
                    `${label} native default`,
                  );
                  const after = p.snapshot();
                  equal(after.outputs, [], `${label} outputs`);
                  equal(after.filters, [], `${label} filters`);
                  equal(after.diagnostics, [], `${label} diagnostics`);
                } catch (error) {
                  failures.push(String(error));
                }
              }
          }
          // A blanket Shadow DOM rejection must fail these positive controls.
          p.c.cancelPending();
          p.ordinary.focus();
          p.clearObservations();
          p.send(p.ordinary, "keydown", "KeyF");
          p.send(p.ordinary, "keyup", "KeyF");
          equal(p.c.getState().pendingDots, [1], "ordinary member admitted");
          p.send(p.ordinary, "keydown", "Space");
          equal(p.snapshot().outputs, ["⠁"], "ordinary member commits");
          if (activation === "focus") {
            p.outside.focus();
            const event = p.send(p.outside, "keydown", "KeyF");
            equal(p.c.getState().pendingDots, [], "nonmember excluded");
            equal(event.defaultPrevented, false, "nonmember default");
          }
          // Exclusion applies to new downs; an already owned up still releases.
          for (const mode of ["sequential", "chord"] as const) {
            p.c.setInputMode(mode);
            p.c.cancelPending();
            p.ordinary.focus();
            p.clearObservations();
            p.send(p.ordinary, "keydown", "KeyF");
            p.controls.clear.focus();
            p.send(p.controls.clear, "keyup", "KeyF");
            equal(
              p.c.getState().pressedInputIds,
              [],
              "tracked up at control releases",
            );
            equal(
              p.snapshot().outputs,
              mode === "chord" ? ["⠁"] : [],
              "tracked up retains semantics",
            );
          }
        } catch (error) {
          failures.push(
            `${JSON.stringify({ ...shape, activation, preventDefault })}: ${String(error)}`,
          );
        } finally {
          p.dispose();
        }
      }
  return { count, failures };
}
