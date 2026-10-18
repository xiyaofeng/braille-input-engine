// @vitest-environment jsdom
import { expect, it } from "vitest";
import * as core from "../../src/index.js";
import * as adapters from "../../src/entries/adapters.js";
import { lifecycleCoordinationCases } from "../fixtures/lifecycle-coordination.js";

it("coordinates document/window fan-out before host reentry", async () => {
  class TestPointerEvent extends MouseEvent {
    pointerId: number;
    pointerType: string;
    constructor(type: string, init: PointerEventInit) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? "";
    }
  }
  Object.defineProperty(globalThis, "PointerEvent", {
    configurable: true,
    writable: true,
    value: TestPointerEvent,
  });
  const result = await lifecycleCoordinationCases({ ...core, ...adapters });
  expect(result.count).toBe(576);
  expect(result.failures).toEqual([]);
});

it.each(["deactivate", "detach", "options"] as const)(
  "keyboard %s releases only its owned input",
  (transition) => {
    const c = core.createBrailleController({ inputMode: "chord" });
    const one = document.createElement("section"),
      two = document.createElement("section");
    document.body.append(one, two);
    const a = adapters.attachKeyboard(c, one, { activation: "manual" });
    const b = adapters.attachKeyboard(c, two, { activation: "always" });
    a.activate();
    one.dispatchEvent(
      new KeyboardEvent("keydown", { code: "KeyF", bubbles: true }),
    );
    two.dispatchEvent(
      new KeyboardEvent("keydown", { code: "KeyD", bubbles: true }),
    );
    c.dispatch({
      type: "dot-down",
      dot: 3,
      inputId: "other-api",
      source: "api",
    });
    const preserved = c
      .getState()
      .pressedInputIds.filter((id) => !id.endsWith("KeyF"));
    if (transition === "options") a.updateOptions({ keyMap: { KeyF: 4 } });
    else a[transition]();
    expect(c.getState().pressedInputIds).toEqual(preserved);
    one.dispatchEvent(
      new KeyboardEvent("keyup", { code: "KeyF", bubbles: true }),
    );
    expect(c.getState().pressedInputIds).toEqual(preserved);
    a.detach();
    b.detach();
    c.destroy();
    one.remove();
    two.remove();
  },
);

it("supports reused DOM events, nested lifecycle events and document separation", () => {
  const id = core.extensionId("test:nested");
  let resets = 0;
  const c = core.createBrailleController({
    inputMode: id,
    strategies: [
      () => ({
        id,
        activate() {},
        deactivate() {},
        destroy() {},
        reset() {
          resets++;
        },
        handle(a, ctx) {
          if (a.type === "dot-down")
            ctx.setPendingContributions([
              { id: a.inputId, dot: a.dot, source: a.source },
            ]);
        },
      }),
    ],
  });
  const other = document.implementation.createHTMLDocument();
  const a = adapters.attachKeyboard(c, document, { activation: "always" });
  const b = adapters.attachKeyboard(c, document, { activation: "always" });
  const d = adapters.attachKeyboard(c, other, { activation: "always" });
  const event = new Event("blur");
  window.dispatchEvent(event);
  window.dispatchEvent(event);
  expect(resets).toBe(2);
  other.dispatchEvent(new Event("compositionstart"));
  expect(resets).toBe(3);
  c.dispatch({ type: "dot-down", dot: 1, inputId: "old", source: "api" });
  let armed = true;
  c.subscribeState((s) => {
    if (armed && !s.pressedInputIds.length) {
      armed = false;
      c.dispatch({
        type: "dot-down",
        dot: 2,
        inputId: "between-events",
        source: "api",
      });
      window.dispatchEvent(new Event("blur"));
      c.dispatch({
        type: "dot-down",
        dot: 3,
        inputId: "after-nested",
        source: "api",
      });
    }
  });
  window.dispatchEvent(event);
  expect(resets).toBe(5);
  expect(c.getState().pressedInputIds).toEqual(["after-nested"]);
  expect(c.getState().pendingDots).toEqual([3]);
  a.detach();
  b.detach();
  d.detach();
  c.destroy();
});

it("publishes new keyboard bindings before cleanup can reenter the adapter", () => {
  const c = core.createBrailleController();
  const scope = document.createElement("section");
  document.body.append(scope);
  const a = adapters.attachKeyboard(c, scope, { activation: "always" });
  scope.dispatchEvent(
    new KeyboardEvent("keydown", { code: "KeyF", bubbles: true }),
  );
  let armed = true;
  c.subscribeState((s) => {
    if (armed && !s.pressedInputIds.length) {
      armed = false;
      scope.dispatchEvent(
        new KeyboardEvent("keydown", { code: "KeyF", bubbles: true }),
      );
    }
  });
  a.updateOptions({ keyMap: { KeyF: 2 } });
  expect(c.getState().pendingDots).toEqual([1, 2]);
  scope.dispatchEvent(
    new KeyboardEvent("keyup", { code: "KeyF", bubbles: true }),
  );
  expect(c.getState().pressedInputIds).toEqual([]);
  a.detach();
  c.destroy();
  scope.remove();
});

it.each([false, true])(
  "coordinates pointer cancellation across shared/nested scopes (nested=%s)",
  (nested) => {
    const outer = document.createElement("section"),
      inner = document.createElement("section");
    inner.innerHTML = '<button data-braille-dot="1">1</button>';
    outer.append(inner);
    document.body.append(outer);
    const button = inner.firstElementChild as HTMLElement;
    button.setPointerCapture = () => {};
    button.releasePointerCapture = () => {};
    const c = core.createBrailleController({ inputMode: "chord" });
    const a = adapters.attachPointer(c, inner, { activation: "always" });
    const b = adapters.attachPointer(c, nested ? outer : inner, {
      activation: "always",
    });
    const send = (type: string, id: number) =>
      button.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerType: "touch",
          pointerId: id,
        }),
      );
    const outputs: string[] = [];
    c.subscribeOutput((x) => {
      if (x.kind === "braille") outputs.push(x.char);
    });
    let armed = false,
      fired = false;
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
    send("pointercancel", 1);
    expect(fired).toBe(true);
    expect(c.getState().pendingDots).toEqual([2]);
    expect(c.getState().pressedInputIds).toEqual(["fresh"]);
    c.dispatch({ type: "dot-up", dot: 2, inputId: "fresh", source: "api" });
    expect(outputs).toEqual(["⠂"]);
    const event = new PointerEvent("lostpointercapture", {
      bubbles: true,
      pointerId: 2,
      pointerType: "touch",
    });
    send("pointerdown", 2);
    button.dispatchEvent(event);
    expect(c.getState().pressedInputIds).toEqual([]);
    send("pointerdown", 2);
    button.dispatchEvent(event);
    expect(c.getState().pressedInputIds).toEqual([]);
    a.detach();
    b.detach();
    c.destroy();
    outer.remove();
  },
);

it.each(["blur", "hidden", "compositionstart"])(
  "cleans up a pointer-only consumer on %s",
  (event) => {
    const c = core.createBrailleController({ inputMode: "chord" });
    const scope = document.createElement("section");
    scope.innerHTML = '<button data-braille-dot="1">1</button>';
    document.body.append(scope);
    const button = scope.firstElementChild as HTMLElement;
    button.setPointerCapture = () => {};
    let releases = 0;
    button.releasePointerCapture = () => {
      releases++;
    };
    const a = adapters.attachPointer(c, scope, { activation: "always" });
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
    expect(c.getState().pressedInputIds).toEqual([]);
    expect(c.getState().pendingDots).toEqual([]);
    expect(releases).toBe(1);
    a.detach();
    c.destroy();
    scope.remove();
    Reflect.deleteProperty(document, "visibilityState");
  },
);

it("preserves intra-group focus and batches leaving focus scopes", () => {
  const c = core.createBrailleController({ inputMode: "chord" });
  const group = adapters.createActivationGroup(document);
  const one = document.createElement("section"),
    two = document.createElement("section"),
    outside = document.createElement("button");
  document.body.append(one, two, outside);
  const a = adapters.attachKeyboard(c, one, { activationGroup: group }),
    b = adapters.attachKeyboard(c, two, { activationGroup: group });
  one.dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, code: "KeyF" }),
  );
  two.dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, code: "KeyD" }),
  );
  one.dispatchEvent(
    new FocusEvent("focusout", { bubbles: true, relatedTarget: two }),
  );
  expect(c.getState().pressedInputIds).toHaveLength(2);
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
  expect(c.getState().pressedInputIds).toEqual(["new-focus"]);
  expect(c.getState().pendingDots).toEqual([3]);
  a.detach();
  b.detach();
  group.destroy();
  c.destroy();
  one.remove();
  two.remove();
  outside.remove();
});

it("keeps effective-keymap duplicate subscriptions independent and isolates errors", () => {
  const c = core.createBrailleController();
  const a = adapters.attachKeyboard(c, document, { activation: "always" });
  const calls: string[] = [];
  const f = () => {
    calls.push("f");
  };
  const first = a.subscribeEffectiveKeyMap(f);
  a.subscribeEffectiveKeyMap(() => {
    calls.push("g");
    throw new Error("observer");
  });
  const last = a.subscribeEffectiveKeyMap(f);
  last();
  last();
  calls.length = 0;
  a.updateOptions({ keyMap: { KeyF: 2 } });
  expect(calls).toEqual(["f", "g"]);
  first();
  a.detach();
  c.destroy();
});
