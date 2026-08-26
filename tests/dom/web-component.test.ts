// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  BrailleInputElement,
  defineBrailleInput,
} from "../../src/web-component/braille-input.js";
import { isEditableTargetAttached } from "../../src/adapters/editable.js";
import { BrailleInputException } from "../../src/core/types.js";

function enterCell(input: BrailleInputElement): void {
  input.controller.dispatch({
    type: "dot-down",
    dot: 1,
    inputId: "component-test:1",
    source: "api",
  });
  input.controller.dispatch({
    type: "dot-up",
    dot: 1,
    inputId: "component-test:1",
    source: "api",
  });
  input.controller.commitPending();
}

async function settleMutations(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("Web Component", () => {
  it("binds a same-document target and writes through the shadow UI", () => {
    const tag = "braille-input-test";
    if (!customElements.get(tag)) defineBrailleInput(tag);
    const target = document.createElement("textarea");
    target.id = "component-target";
    document.body.append(target);
    const input = document.createElement(tag) as BrailleInputElement;
    input.setAttribute("for", target.id);
    document.body.append(input);
    target.focus();
    expect(
      input.shadowRoot?.querySelector('[part~="chord-test"]'),
    ).not.toBeNull();
    const dot = input.shadowRoot?.querySelector<HTMLButtonElement>(
      '[data-braille-dot="1"]',
    );
    dot?.click();
    const commit = input.shadowRoot?.querySelector<HTMLButtonElement>(
      '[part~="commit-button"]',
    );
    commit?.click();
    expect(target.value).toBe("⠁");
    input.destroy();
    target.remove();
    input.remove();
  });

  it("releases a target on disconnect and rejects it on reconnect if occupied", () => {
    const tag = "braille-input-reconnect-test";
    if (!customElements.get(tag)) defineBrailleInput(tag);
    const target = document.createElement("textarea");
    target.id = "component-reconnect-target";
    document.body.append(target);
    const first = document.createElement(tag) as BrailleInputElement;
    first.target = target;
    document.body.append(first);
    first.remove();
    const second = document.createElement(tag) as BrailleInputElement;
    second.target = target;
    document.body.append(second);
    target.focus();
    enterCell(second);
    expect(target.value).toBe("⠁");
    first.addEventListener("braille-error", (event) => event.preventDefault());
    document.body.append(first);
    expect(first.controller.getState().outputSinkState).toBe("empty");
    second.destroy();
    first.destroy();
    target.remove();
    second.remove();
    first.remove();
  });

  it("rolls back an invalid target property and keeps the old binding", () => {
    const tag = "braille-input-atomic-test";
    if (!customElements.get(tag)) defineBrailleInput(tag);
    const oldTarget = document.createElement("textarea");
    document.body.append(oldTarget);
    const input = document.createElement(tag) as BrailleInputElement;
    input.target = oldTarget;
    document.body.append(input);
    const invalid = document.createElement("div");
    expect(() => {
      input.target = invalid;
    }).toThrow(BrailleInputException);
    expect(input.target).toBe(oldTarget);
    oldTarget.focus();
    enterCell(input);
    expect(oldTarget.value).toBe("⠁");
    input.destroy();
    oldTarget.remove();
    input.remove();
  });

  it("atomically rejects target=null when the for fallback is invalid", () => {
    const tag = "braille-input-null-fallback-test";
    if (!customElements.get(tag)) defineBrailleInput(tag);
    const oldTarget = document.createElement("textarea");
    const invalid = document.createElement("div");
    invalid.id = "invalid-fallback-target";
    document.body.append(oldTarget, invalid);
    const input = document.createElement(tag) as BrailleInputElement;
    input.target = oldTarget;
    document.body.append(input);
    input.setAttribute("for", invalid.id);
    expect(() => {
      input.target = null;
    }).toThrow(BrailleInputException);
    expect(input.target).toBe(oldTarget);
    expect(isEditableTargetAttached(oldTarget)).toBe(true);
    oldTarget.focus();
    enterCell(input);
    expect(oldTarget.value).toBe("⠁");
    input.destroy();
    oldTarget.remove();
    invalid.remove();
    input.remove();
  });

  it("releases and restores a direct target across root removal", async () => {
    const tag = "braille-input-cross-root-lifecycle-test";
    if (!customElements.get(tag)) defineBrailleInput(tag);
    const target = document.createElement("textarea");
    document.body.append(target);
    const host = document.createElement("div");
    document.body.append(host);
    const shadow = host.attachShadow({ mode: "open" });
    const input = document.createElement(tag) as BrailleInputElement;
    input.target = target;
    shadow.append(input);
    target.focus();
    input.controller.dispatch({
      type: "dot-down",
      dot: 1,
      inputId: "cross-root:1",
      source: "api",
    });
    expect(input.controller.getState().pendingDots).toEqual([1]);
    target.remove();
    await settleMutations();
    expect(isEditableTargetAttached(target)).toBe(false);
    expect(input.controller.getState().enabled).toBe(false);
    expect(input.controller.getState().pendingDots).toEqual([1]);
    document.body.append(target);
    await settleMutations();
    target.focus();
    input.controller.commitPending();
    expect(target.value).toBe("⠁");
    input.destroy();
    target.remove();
    input.remove();
    host.remove();
  });

  it("fails closed synchronously when the target is removed before a UI action", () => {
    const tag = "braille-input-sync-gate-test";
    if (!customElements.get(tag)) defineBrailleInput(tag);
    const target = document.createElement("textarea");
    document.body.append(target);
    const input = document.createElement(tag) as BrailleInputElement;
    input.target = target;
    document.body.append(input);
    const outputs: string[] = [];
    let domOutputEvents = 0;
    input.controller.subscribeOutput((_action, delivery) =>
      outputs.push(delivery),
    );
    input.addEventListener("braille-input", () => {
      domOutputEvents += 1;
    });
    target.focus();
    target.remove();
    const dot = input.shadowRoot?.querySelector<HTMLButtonElement>(
      '[data-braille-dot="1"]',
    );
    const commit = input.shadowRoot?.querySelector<HTMLButtonElement>(
      '[part~="commit-button"]',
    );
    dot?.click();
    commit?.click();
    expect(input.controller.getState().enabled).toBe(false);
    expect(input.controller.getState().pendingDots).toEqual([]);
    expect(outputs).toEqual([]);
    expect(domOutputEvents).toBe(0);
    expect(isEditableTargetAttached(target)).toBe(false);
    input.destroy();
    input.remove();
  });

  it("fails closed synchronously when a for target changes identity", () => {
    const tag = "braille-input-for-identity-test";
    if (!customElements.get(tag)) defineBrailleInput(tag);
    const target = document.createElement("textarea");
    target.id = "for-identity-target";
    document.body.append(target);
    const input = document.createElement(tag) as BrailleInputElement;
    input.setAttribute("for", target.id);
    document.body.append(input);
    const deliveries: string[] = [];
    let domOutputEvents = 0;
    input.controller.subscribeOutput((_action, delivery) =>
      deliveries.push(delivery),
    );
    input.addEventListener("braille-input", () => {
      domOutputEvents += 1;
    });
    target.focus();
    target.id = "renamed-target";
    input.shadowRoot
      ?.querySelector<HTMLButtonElement>('[data-braille-dot="1"]')
      ?.click();
    input.shadowRoot
      ?.querySelector<HTMLButtonElement>('[part~="commit-button"]')
      ?.click();
    expect(target.value).toBe("");
    expect(input.controller.getState().enabled).toBe(false);
    expect(input.controller.getState().pendingDots).toEqual([]);
    expect(deliveries).toEqual([]);
    expect(domOutputEvents).toBe(0);
    expect(isEditableTargetAttached(target)).toBe(false);
    input.destroy();
    target.remove();
    input.remove();
  });

  it("rejects a synchronous same-id replacement and cross-root move", () => {
    const tag = "braille-input-for-replacement-test";
    if (!customElements.get(tag)) defineBrailleInput(tag);
    const target = document.createElement("textarea");
    target.id = "replace-target";
    document.body.append(target);
    const input = document.createElement(tag) as BrailleInputElement;
    input.setAttribute("for", target.id);
    document.body.append(input);
    const replacement = document.createElement("textarea");
    replacement.id = target.id;
    target.replaceWith(replacement);
    input.shadowRoot
      ?.querySelector<HTMLButtonElement>('[data-braille-dot="1"]')
      ?.click();
    expect(target.value).toBe("");
    expect(replacement.value).toBe("");
    expect(isEditableTargetAttached(target)).toBe(false);
    input.destroy();
    input.remove();
    replacement.remove();

    const rootTarget = document.createElement("textarea");
    rootTarget.id = "root-move-target";
    document.body.append(rootTarget);
    const rootInput = document.createElement(tag) as BrailleInputElement;
    rootInput.setAttribute("for", rootTarget.id);
    document.body.append(rootInput);
    const host = document.createElement("div");
    document.body.append(host);
    const shadow = host.attachShadow({ mode: "open" });
    shadow.append(rootTarget);
    rootInput.shadowRoot
      ?.querySelector<HTMLButtonElement>('[data-braille-dot="1"]')
      ?.click();
    expect(rootTarget.value).toBe("");
    expect(isEditableTargetAttached(rootTarget)).toBe(false);
    rootInput.destroy();
    rootInput.remove();
    host.remove();
  });

  it("preserves pending and retry state while synchronously releasing a stale for target", () => {
    const tag = "braille-input-for-pending-test";
    if (!customElements.get(tag)) defineBrailleInput(tag);
    for (const retry of [false, true]) {
      const target = document.createElement("textarea");
      target.id = `pending-target-${String(retry)}`;
      document.body.append(target);
      const input = document.createElement(tag) as BrailleInputElement;
      input.setAttribute("for", target.id);
      document.body.append(input);
      if (retry)
        target.addEventListener("beforeinput", (event) =>
          event.preventDefault(),
        );
      target.focus();
      input.controller.dispatch({
        type: "dot-down",
        dot: 1,
        inputId: `pending:${String(retry)}`,
        source: "api",
      });
      input.controller.dispatch({
        type: "dot-up",
        dot: 1,
        inputId: `pending:${String(retry)}`,
        source: "api",
      });
      if (retry) input.controller.commitPending();
      const deliveries: string[] = [];
      input.controller.subscribeOutput((_action, delivery) =>
        deliveries.push(delivery),
      );
      target.id = `stale-${target.id}`;
      input.shadowRoot
        ?.querySelector<HTMLButtonElement>(
          retry ? '[part~="retry-button"]' : '[part~="commit-button"]',
        )
        ?.click();
      expect(input.controller.getState().pendingDots).toEqual([1]);
      expect(input.controller.getState().awaitingRetry).toBe(retry);
      expect(deliveries).toEqual([]);
      expect(isEditableTargetAttached(target)).toBe(false);
      input.destroy();
      target.remove();
      input.remove();
    }
  });

  it("fails closed synchronously for runtime type changes and document adoption", () => {
    const tag = "braille-input-runtime-target-test";
    if (!customElements.get(tag)) defineBrailleInput(tag);
    const target = document.createElement("input");
    target.type = "text";
    document.body.append(target);
    const input = document.createElement(tag) as BrailleInputElement;
    input.target = target;
    document.body.append(input);
    const outputCount = { value: 0 };
    input.controller.subscribeOutput(() => {
      outputCount.value += 1;
    });
    target.type = "password";
    input.shadowRoot
      ?.querySelector<HTMLButtonElement>('[data-braille-dot="1"]')
      ?.click();
    expect(input.controller.getState().enabled).toBe(false);
    expect(outputCount.value).toBe(0);
    expect(isEditableTargetAttached(target)).toBe(false);

    const otherDocument = document.implementation.createHTMLDocument("other");
    const adopted = document.createElement("textarea");
    document.body.append(adopted);
    const adoptedInput = document.createElement(tag) as BrailleInputElement;
    adoptedInput.target = adopted;
    document.body.append(adoptedInput);
    otherDocument.body.append(adopted);
    adoptedInput.shadowRoot
      ?.querySelector<HTMLButtonElement>('[data-braille-dot="1"]')
      ?.click();
    expect(adoptedInput.controller.getState().enabled).toBe(false);
    expect(isEditableTargetAttached(adopted)).toBe(false);
    input.destroy();
    adoptedInput.destroy();
    input.remove();
    adoptedInput.remove();
  });

  it("preserves awaiting retry through disconnect and reconnect", async () => {
    const tag = "braille-input-retry-lifecycle-test";
    if (!customElements.get(tag)) defineBrailleInput(tag);
    const target = document.createElement("textarea");
    document.body.append(target);
    const input = document.createElement(tag) as BrailleInputElement;
    input.target = target;
    document.body.append(input);
    const prevent = (event: Event): void => event.preventDefault();
    target.addEventListener("beforeinput", prevent);
    target.focus();
    enterCell(input);
    expect(input.controller.getState().awaitingRetry).toBe(true);
    input.remove();
    expect(input.controller.getState().awaitingRetry).toBe(true);
    target.removeEventListener("beforeinput", prevent);
    document.body.append(input);
    await settleMutations();
    target.focus();
    input.controller.commitPending();
    expect(target.value).toBe("⠁");
    input.destroy();
    target.remove();
    input.remove();
  });

  it("allows direct property binding across same-document roots but keeps for scoped", () => {
    const tag = "braille-input-root-test";
    if (!customElements.get(tag)) defineBrailleInput(tag);
    const outside = document.createElement("textarea");
    outside.id = "root-outside-target";
    document.body.append(outside);
    const host = document.createElement("div");
    document.body.append(host);
    const shadow = host.attachShadow({ mode: "open" });
    const input = document.createElement(tag) as BrailleInputElement;
    shadow.append(input);
    input.target = outside;
    outside.focus();
    enterCell(input);
    expect(outside.value).toBe("⠁");
    input.destroy();
    input.remove();
    host.remove();

    const scoped = document.createElement(tag) as BrailleInputElement;
    scoped.setAttribute("for", outside.id);
    shadow.append(scoped);
    expect(scoped.controller.getState().outputSinkState).toBe("empty");
    scoped.destroy();
    scoped.remove();
    outside.remove();
  });

  it("rejects a property target from another document", () => {
    const tag = "braille-input-cross-document-test";
    if (!customElements.get(tag)) defineBrailleInput(tag);
    const input = document.createElement(tag) as BrailleInputElement;
    document.body.append(input);
    const otherDocument = document.implementation.createHTMLDocument("other");
    const otherTarget = otherDocument.createElement("textarea");
    expect(() => {
      input.target = otherTarget;
    }).toThrow("same document");
    expect(input.target).toBeNull();
    input.destroy();
    input.remove();
  });

  it("does not auto-register from the class module", () => {
    expect(customElements.get("braille-input")).toBeUndefined();
    const constructor = defineBrailleInput("braille-input-test");
    expect(constructor).toBe(customElements.get("braille-input-test"));
    expect(constructor.prototype instanceof BrailleInputElement).toBe(true);
  });
});
