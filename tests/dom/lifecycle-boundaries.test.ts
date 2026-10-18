// @vitest-environment jsdom
import { expect, it } from "vitest";
import * as core from "../../src/index.js";
import * as adapters from "../../src/entries/adapters.js";
import {
  terminalBoundaryCases,
  focusBoundaryCases,
} from "../fixtures/lifecycle-boundaries.js";
class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;
  readonly pointerType: string;
  constructor(type: string, init: PointerEventInit) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
    this.pointerType = init.pointerType ?? "";
  }
}
Object.defineProperty(globalThis, "PointerEvent", {
  configurable: true,
  value: TestPointerEvent,
});
it("coordinates terminal branches, guard callbacks and frozen Cells", () => {
  const result = terminalBoundaryCases({ ...core, ...adapters });
  expect(result.count).toBeGreaterThan(500);
  expect(result.failures).toEqual([]);
});
it("handles actual focus transfers across registered roots and group members", () => {
  const result = focusBoundaryCases({ ...core, ...adapters });
  expect(result.count).toBeGreaterThan(500);
  expect(result.failures).toEqual([]);
}, 15_000);

it("mixed pointer rejection preserves the allowed attachment's other pressed input", () => {
  const scope = document.createElement("section");
  scope.innerHTML = '<button data-braille-dot="1">1</button>';
  document.body.append(scope);
  const button = scope.firstElementChild as HTMLElement;
  const c = core.createBrailleController({ inputMode: "chord" });
  let allowed = true;
  const a = adapters.attachPointer(c, scope, { activation: "always" });
  const send = (type: string, pointerId: number) =>
    button.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        pointerId,
        pointerType: "touch",
      }),
    );
  send("pointerdown", 2);
  const allowedOther = c.getState().pressedInputIds[0]!;
  const b = adapters.attachPointer(c, scope, {
    activation: "always",
    actionGuard: () => allowed,
  });
  send("pointerdown", 2);
  send("pointerdown", 1);
  c.dispatch({ type: "dot-down", dot: 3, inputId: "unrelated", source: "api" });
  allowed = false;
  send("pointerup", 1);
  expect(c.getState().pressedInputIds).toEqual(
    [allowedOther, "unrelated"].sort(),
  );
  expect(c.getState().pendingDots).toEqual([]);
  send("pointerup", 2);
  expect(c.getState().pressedInputIds).toEqual(["unrelated"]);
  a.detach();
  b.detach();
  c.destroy();
  scope.remove();
});

it("uses one root batch across groups, callback membership changes, partial detach and rebuild", () => {
  const c = core.createBrailleController({ inputMode: "chord" });
  const host = document.createElement("div"),
    outside = document.createElement("button");
  document.body.append(host, outside);
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML =
    "<section><button>one</button></section><section><button>two</button></section>";
  const one = root.firstElementChild as HTMLElement,
    two = root.lastElementChild as HTMLElement;
  const group = adapters.createActivationGroup(document),
    token = group.add(two),
    duplicate = group.add(two);
  const a = adapters.attachKeyboard(c, one, { activationGroup: group }),
    b = adapters.attachKeyboard(c, one, { activationGroup: group });
  duplicate();
  duplicate();
  const send = (scope: HTMLElement, type: string) =>
    scope.firstElementChild!.dispatchEvent(
      new KeyboardEvent(type, { code: "KeyF", bubbles: true, composed: true }),
    );
  one.firstElementChild!.dispatchEvent(
    new FocusEvent("focusin", { bubbles: true }),
  );
  (one.firstElementChild as HTMLElement).focus();
  send(one, "keydown");
  (two.firstElementChild as HTMLElement).focus();
  expect(c.getState().pressedInputIds).toHaveLength(2);
  let once = true;
  const stop = c.subscribeState((s) => {
    if (once && s.pressedInputIds.length === 1) {
      once = false;
      token();
      group.add(two)();
      c.dispatch({ type: "dot-down", dot: 2, inputId: "new", source: "api" });
    }
  });
  outside.focus();
  expect(c.getState().pressedInputIds).toEqual(["new"]);
  expect(c.getState().pendingDots).toEqual([2]);
  stop();
  c.cancelPending();
  a.detach();
  a.detach();
  (one.firstElementChild as HTMLElement).focus();
  send(one, "keydown");
  outside.focus();
  expect(c.getState().pressedInputIds).toEqual([]);
  b.detach();
  group.destroy();
  const rebuilt = adapters.attachKeyboard(c, one);
  (one.firstElementChild as HTMLElement).focus();
  send(one, "keydown");
  outside.focus();
  expect(c.getState().pendingDots).toEqual([]);
  rebuilt.detach();
  c.destroy();
  host.remove();
  outside.remove();
});

it("removes every owned root, terminal and global listener after repeated detach/rebuild", () => {
  const prototype = EventTarget.prototype;
  // Saved for explicit .call(this) delegation and restored in finally.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const add = prototype.addEventListener;
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const remove = prototype.removeEventListener;
  const live: {
    target: EventTarget;
    type: string;
    listener: EventListenerOrEventListenerObject;
    capture: boolean;
  }[] = [];
  prototype.addEventListener = function (type, listener, options) {
    if (listener) {
      const capture =
        typeof options === "boolean" ? options : !!options?.capture;
      if (
        !live.some(
          (x) =>
            x.target === this &&
            x.type === type &&
            x.listener === listener &&
            x.capture === capture,
        )
      )
        live.push({ target: this, type, listener, capture });
    }
    return add.call(this, type, listener, options);
  };
  prototype.removeEventListener = function (type, listener, options) {
    const capture = typeof options === "boolean" ? options : !!options?.capture,
      index = live.findIndex(
        (x) =>
          x.target === this &&
          x.type === type &&
          x.listener === listener &&
          x.capture === capture,
      );
    if (index >= 0) live.splice(index, 1);
    return remove.call(this, type, listener, options);
  };
  try {
    for (let i = 0; i < 20; i++) {
      const host = document.createElement("div");
      document.body.append(host);
      const root = host.attachShadow({ mode: "open" });
      const scope = document.createElement("section");
      root.append(scope);
      const c = core.createBrailleController(),
        g = adapters.createActivationGroup(document),
        t = g.add(scope),
        t2 = g.add(scope);
      const a = adapters.attachPointer(c, scope, { activationGroup: g }),
        b = adapters.attachKeyboard(c, root, { activationGroup: g });
      t();
      t();
      a.detach();
      a.detach();
      t2();
      b.detach();
      g.destroy();
      g.destroy();
      c.destroy();
      host.remove();
    }
    expect(live).toEqual([]);
  } finally {
    prototype.addEventListener = add;
    prototype.removeEventListener = remove;
  }
});

it("rebinding a scope after a root move observes the new root synchronously", () => {
  const host = document.createElement("div"),
    outside = document.createElement("button"),
    scope = document.createElement("section");
  scope.innerHTML = "<button>input</button>";
  host.append(scope);
  document.body.append(host, outside);
  const c = core.createBrailleController({ inputMode: "chord" });
  let a = adapters.attachKeyboard(c, scope);
  a.detach();
  const root = host.attachShadow({ mode: "open" });
  root.append(scope);
  a = adapters.attachKeyboard(c, scope);
  (scope.firstElementChild as HTMLElement).focus();
  scope.dispatchEvent(
    new KeyboardEvent("keydown", { code: "KeyF", bubbles: true }),
  );
  outside.focus();
  expect(c.getState().pressedInputIds).toEqual([]);
  expect(c.getState().pendingDots).toEqual([]);
  a.detach();
  c.destroy();
  host.remove();
  outside.remove();
});

it.each([false, true])(
  "queues a root exit triggered during a state notification (shadow=%s)",
  (shadow) => {
    const host = document.createElement("div"),
      outside = document.createElement("button");
    document.body.append(host, outside);
    const root = shadow ? host.attachShadow({ mode: "open" }) : host;
    root.innerHTML = "<section><button>one</button></section>";
    const scope = root.firstElementChild as HTMLElement,
      button = scope.firstElementChild as HTMLElement;
    const c = core.createBrailleController({ inputMode: "chord" }),
      a = adapters.attachKeyboard(c, scope),
      b = adapters.attachKeyboard(c, scope);
    let queued = false,
      fired = false;
    c.subscribeState((s) => {
      if (!queued && s.pressedInputIds.length === 2) {
        queued = true;
        outside.focus();
      } else if (queued && !fired && s.pressedInputIds.length === 1) {
        fired = true;
        c.dispatch({
          type: "dot-down",
          dot: 2,
          inputId: "next",
          source: "api",
        });
      }
    });
    button.focus();
    button.dispatchEvent(
      new KeyboardEvent("keydown", {
        code: "KeyF",
        bubbles: true,
        composed: true,
      }),
    );
    expect(queued).toBe(true);
    expect(fired).toBe(true);
    expect(c.getState().pressedInputIds).toEqual(["next"]);
    expect(c.getState().pendingDots).toEqual([2]);
    a.detach();
    b.detach();
    c.destroy();
    host.remove();
    outside.remove();
  },
);

it("terminal guards run once inside the old-event transaction and reject structural reentry", () => {
  const scope = document.createElement("section");
  scope.innerHTML = '<button data-braille-dot="1">one</button>';
  document.body.append(scope);
  const c = core.createBrailleController({ inputMode: "chord" });
  let armed = false,
    fresh = false;
  const calls: string[] = [],
    diagnostics: string[] = [];
  c.subscribeDiagnostic((d) => diagnostics.push(d.code));
  const guard = () => {
    if (armed) {
      calls.push("guard");
      try {
        c.disable();
      } catch (error) {
        calls.push((error as core.BrailleInputException).code);
      }
      if (!fresh) {
        fresh = true;
        c.dispatch({
          type: "dot-down",
          dot: 2,
          inputId: "fresh",
          source: "api",
        });
      }
      return false;
    }
    return true;
  };
  const a = adapters.attachPointer(c, scope, {
      activation: "always",
      actionGuard: guard,
    }),
    b = adapters.attachPointer(c, scope, {
      activation: "always",
      actionGuard: guard,
    });
  const send = (type: string) =>
    scope.firstElementChild!.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        pointerId: 1,
        pointerType: "touch",
      }),
    );
  send("pointerdown");
  armed = true;
  send("pointerup");
  expect(calls).toEqual(["guard", "INVALID_ACTION", "guard", "INVALID_ACTION"]);
  expect(c.getState().enabled).toBe(true);
  expect(c.getState().pressedInputIds).toEqual(["fresh"]);
  expect(c.getState().pendingDots).toEqual([2]);
  expect(diagnostics).toEqual([]);
  a.detach();
  b.detach();
  c.destroy();
  scope.remove();
});

it("terminal filters share the original event at the first collector; down context stays local", () => {
  const outer = document.createElement("section"),
    inner = document.createElement("section"),
    button = document.createElement("button");
  inner.append(button);
  outer.append(inner);
  document.body.append(outer);
  const c = core.createBrailleController({ inputMode: "chord" });
  const seen: {
    event: KeyboardEvent;
    current: EventTarget | null;
    type: string;
  }[] = [];
  const filter = (event: KeyboardEvent) => {
    seen.push({ event, current: event.currentTarget, type: event.type });
    return event.type === "keydown";
  };
  const a = adapters.attachKeyboard(c, outer, {
      activation: "always",
      keyboardFilter: filter,
    }),
    b = adapters.attachKeyboard(c, inner, {
      activation: "always",
      keyboardFilter: filter,
    });
  const down = new KeyboardEvent("keydown", { code: "KeyF", bubbles: true }),
    up = new KeyboardEvent("keyup", { code: "KeyF", bubbles: true });
  button.dispatchEvent(down);
  button.dispatchEvent(up);
  expect(seen.map((x) => x.current)).toEqual([inner, outer, inner, inner]);
  expect(seen.slice(2).every((x) => x.event === up)).toBe(true);
  expect(c.getState().pressedInputIds).toEqual([]);
  expect(c.getState().pendingDots).toEqual([]);
  a.detach();
  b.detach();
  c.destroy();
  outer.remove();
});
