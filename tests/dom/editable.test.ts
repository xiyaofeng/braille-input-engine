// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  attachBrailleEditable,
  isEditableTargetAttached,
} from "../../src/adapters/editable.js";
import { createActivationGroup } from "../../src/adapters/activation.js";
import { createBrailleController } from "../../src/core/controller.js";

function enterCell(
  controller: ReturnType<typeof createBrailleController>,
): void {
  controller.dispatch({
    type: "dot-down",
    dot: 1,
    inputId: "api:1",
    source: "api",
  });
  controller.dispatch({
    type: "dot-up",
    dot: 1,
    inputId: "api:1",
    source: "api",
  });
  controller.commitPending();
}

describe("native editable adapter", () => {
  it("writes a selected textarea range only after beforeinput", () => {
    const target = document.createElement("textarea");
    target.value = "old text";
    target.setSelectionRange(0, 3);
    document.body.append(target);
    const controller = createBrailleController();
    const attachment = attachBrailleEditable(controller, target);
    target.focus();
    const events: string[] = [];
    target.addEventListener("beforeinput", () => events.push("beforeinput"));
    target.addEventListener("input", () => events.push("input"));
    enterCell(controller);
    expect(target.value).toBe("⠁ text");
    expect(events).toEqual(["beforeinput", "input"]);
    attachment.detach();
    controller.destroy();
  });

  it("keeps a Cell pending when beforeinput is canceled", () => {
    const target = document.createElement("textarea");
    document.body.append(target);
    target.addEventListener("beforeinput", (event) => event.preventDefault());
    const controller = createBrailleController();
    const attachment = attachBrailleEditable(controller, target);
    target.focus();
    enterCell(controller);
    expect(target.value).toBe("");
    expect(controller.getState().awaitingRetry).toBe(true);
    attachment.detach();
    controller.destroy();
  });

  it("reports a conflict when beforeinput replaces the content text node", () => {
    const target = document.createElement("div");
    target.setAttribute("contenteditable", "true");
    target.append(document.createTextNode("old"));
    document.body.append(target);
    const deliveries: string[] = [];
    target.addEventListener("beforeinput", () => {
      target.replaceChildren(document.createTextNode("old"));
    });
    const controller = createBrailleController({
      onOutput: (_action, delivery) => deliveries.push(delivery),
    });
    const attachment = attachBrailleEditable(controller, target);
    target.focus();
    const selection = document.createRange();
    selection.setStart(target.firstChild as Text, 3);
    selection.setEnd(target.firstChild as Text, 3);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(selection);
    enterCell(controller);
    expect(deliveries).toEqual(["conflicted"]);
    expect(target.textContent).toBe("old");
    attachment.detach();
    controller.destroy();
  });

  it("does not retry when a beforeinput listener already inserts the Cell", () => {
    const target = document.createElement("textarea");
    document.body.append(target);
    const deliveries: string[] = [];
    const controller = createBrailleController({
      onOutput: (_action, delivery) => deliveries.push(delivery),
    });
    const attachment = attachBrailleEditable(controller, target, {
      activation: "always",
    });
    target.addEventListener(
      "beforeinput",
      () => {
        target.value = "⠁";
      },
      { once: true },
    );
    enterCell(controller);
    expect(deliveries).toEqual(["conflicted"]);
    expect(target.value).toBe("⠁");
    expect(controller.getState().pendingDots).toEqual([]);
    expect(controller.getState().awaitingRetry).toBe(false);
    controller.commitPending();
    expect(target.value).toBe("⠁");
    attachment.detach();
    controller.destroy();
  });

  it("rejects a focus-mode write while the target is not focused", () => {
    const target = document.createElement("textarea");
    document.body.append(target);
    const controller = createBrailleController();
    const attachment = attachBrailleEditable(controller, target);
    enterCell(controller);
    expect(target.value).toBe("");
    expect(controller.getState().awaitingRetry).toBe(true);
    attachment.detach();
    controller.destroy();
  });

  it("deactivates outside the activation group and stays active within it", () => {
    const target = document.createElement("textarea");
    const groupButton = document.createElement("button");
    const outside = document.createElement("button");
    document.body.append(target, groupButton, outside);
    const controller = createBrailleController();
    const group = createActivationGroup(document);
    const groupButtonToken = group.add(groupButton);
    const attachment = attachBrailleEditable(controller, target, {
      activationGroup: group,
    });
    target.focus();
    groupButton.focus();
    enterCell(controller);
    expect(target.value).toBe("⠁");
    target.value = "";
    outside.focus();
    enterCell(controller);
    expect(target.value).toBe("");
    groupButtonToken();
    attachment.detach();
    group.destroy();
    controller.destroy();
  });

  it("returns conflicted when beforeinput removes the target", () => {
    const target = document.createElement("textarea");
    document.body.append(target);
    const deliveries: string[] = [];
    const controller = createBrailleController({
      onOutput: (_action, delivery) => deliveries.push(delivery),
    });
    const attachment = attachBrailleEditable(controller, target);
    target.focus();
    target.addEventListener("beforeinput", () => target.remove(), {
      once: true,
    });
    enterCell(controller);
    expect(deliveries).toEqual(["conflicted"]);
    expect(target.value).toBe("");
    attachment.detach();
    controller.destroy();
  });

  it("returns conflicted when beforeinput changes readonly or selection state", () => {
    const target = document.createElement("textarea");
    document.body.append(target);
    const deliveries: string[] = [];
    const controller = createBrailleController({
      onOutput: (_action, delivery) => deliveries.push(delivery),
    });
    const attachment = attachBrailleEditable(controller, target);
    target.focus();
    target.addEventListener(
      "beforeinput",
      () => {
        target.readOnly = true;
        target.setSelectionRange(0, 0);
      },
      { once: true },
    );
    enterCell(controller);
    expect(deliveries).toEqual(["conflicted"]);
    expect(target.value).toBe("");
    attachment.detach();
    controller.destroy();
  });

  it("returns conflicted when contenteditable grammar becomes complex", () => {
    const target = document.createElement("div");
    target.setAttribute("contenteditable", "true");
    target.append(document.createTextNode("old"));
    document.body.append(target);
    const deliveries: string[] = [];
    const controller = createBrailleController({
      onOutput: (_action, delivery) => deliveries.push(delivery),
    });
    const attachment = attachBrailleEditable(controller, target);
    target.focus();
    const selection = document.createRange();
    selection.setStart(target.firstChild as Text, 3);
    selection.setEnd(target.firstChild as Text, 3);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(selection);
    target.addEventListener(
      "beforeinput",
      () => target.append(document.createElement("br")),
      { once: true },
    );
    enterCell(controller);
    expect(deliveries).toEqual(["conflicted"]);
    expect(target.textContent).toBe("old");
    attachment.detach();
    controller.destroy();
  });

  it("rejects password inputs", () => {
    const target = document.createElement("input");
    target.type = "password";
    document.body.append(target);
    expect(() =>
      attachBrailleEditable(createBrailleController(), target),
    ).toThrow("Unsupported input type");
  });

  it.each(["password", "number"])(
    "rejects a text input that changes to %s after attach",
    (type) => {
      const target = document.createElement("input");
      target.type = "text";
      document.body.append(target);
      const deliveries: string[] = [];
      const controller = createBrailleController({
        onOutput: (_action, delivery) => deliveries.push(delivery),
      });
      const attachment = attachBrailleEditable(controller, target, {
        activation: "always",
      });
      target.type = type;
      enterCell(controller);
      expect(deliveries).toEqual(["rejected"]);
      expect(target.value).toBe("");
      expect(controller.getState().pendingDots).toEqual([1]);
      expect(controller.getState().awaitingRetry).toBe(true);
      attachment.detach();
      controller.destroy();
    },
  );

  it("terminates a conflicted Cell when beforeinput changes input type", () => {
    const target = document.createElement("input");
    target.type = "text";
    document.body.append(target);
    const deliveries: string[] = [];
    const controller = createBrailleController({
      onOutput: (_action, delivery) => deliveries.push(delivery),
    });
    const attachment = attachBrailleEditable(controller, target, {
      activation: "always",
    });
    target.addEventListener(
      "beforeinput",
      () => {
        target.type = "password";
      },
      { once: true },
    );
    enterCell(controller);
    expect(deliveries).toEqual(["conflicted"]);
    expect(target.value).toBe("");
    expect(controller.getState().pendingDots).toEqual([]);
    expect(controller.getState().pressedInputIds).toEqual([]);
    expect(controller.getState().awaitingRetry).toBe(false);
    attachment.detach();
    controller.destroy();
  });

  it("rejects an adopted target and removes listeners from its original document", () => {
    const target = document.createElement("input");
    target.type = "text";
    document.body.append(target);
    const otherDocument = document.implementation.createHTMLDocument("other");
    const controller = createBrailleController();
    const attachment = attachBrailleEditable(controller, target, {
      activation: "always",
    });
    otherDocument.body.append(target);
    enterCell(controller);
    expect(target.value).toBe("");
    expect(controller.getState().pendingDots).toEqual([1]);
    attachment.detach();
    expect(isEditableTargetAttached(target)).toBe(false);
    controller.destroy();
  });
});
