import { expect, test } from "@playwright/test";

type BrowserController = {
  dispatch(action: {
    type: "dot-down" | "dot-up";
    dot: 1;
    inputId: string;
    source: "api";
  }): void;
  commitPending(): void;
  subscribeOutput(
    listener: (action: unknown, delivery: string) => void,
  ): () => void;
  getState(): {
    outputSinkState: string;
    pendingDots: readonly number[];
    pressedInputIds: readonly string[];
    chordInProgress: boolean;
    awaitingRetry: boolean;
    enabled: boolean;
  };
  destroy(): void;
};

type BrowserInputElement = HTMLElement & {
  target: HTMLElement | null;
  controller: BrowserController;
  destroy(): void;
};

type BrowserApi = {
  createBrailleController(options?: Record<string, unknown>): BrowserController;
  attachKeyboard(
    controller: BrowserController,
    scope: Document,
    options?: Record<string, unknown>,
  ): { detach(): void };
  attachBrailleEditable(
    controller: BrowserController,
    target: HTMLElement,
    options?: { activation?: "focus" | "manual" | "always" },
  ): { detach(): void };
  defineBrailleInput(name: string): void;
  isEditableTargetAttached(target: object): boolean;
};

async function loadApi(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("about:blank");
  await page.addScriptTag({ path: "dist/braille-input.iife.min.js" });
}

test("focus activation and beforeinput transactions protect native targets", async ({
  page,
}) => {
  await loadApi(page);
  await page.setContent(
    '<textarea id="target"></textarea><button id="outside">outside</button>',
  );
  const result = await page.evaluate(() => {
    const api = (globalThis as typeof globalThis & { BrailleInput: BrowserApi })
      .BrailleInput;
    const target = document.querySelector("#target") as HTMLTextAreaElement;
    const outside = document.querySelector("#outside") as HTMLButtonElement;
    const controller = api.createBrailleController();
    const attachment = api.attachBrailleEditable(controller, target);
    const commit = () => {
      controller.dispatch({
        type: "dot-down",
        dot: 1,
        inputId: "browser:1",
        source: "api",
      });
      controller.dispatch({
        type: "dot-up",
        dot: 1,
        inputId: "browser:1",
        source: "api",
      });
      controller.commitPending();
    };
    commit();
    const unfocused = target.value;
    target.focus();
    commit();
    const focused = target.value;
    outside.focus();
    commit();
    const afterBlur = target.value;
    target.focus();
    target.addEventListener("beforeinput", () => target.remove(), {
      once: true,
    });
    const deliveries: string[] = [];
    const dispose = controller.subscribeOutput(
      (_action: unknown, delivery: string) => deliveries.push(delivery),
    );
    commit();
    const conflictState = controller.getState();
    dispose();
    attachment.detach();
    controller.destroy();
    return {
      unfocused,
      focused,
      afterBlur,
      deliveries,
      conflictPending: conflictState.pendingDots.join(","),
      conflictRetry: conflictState.awaitingRetry,
    };
  });
  expect(result.unfocused).toBe("");
  expect(result.focused).toBe("⠁");
  expect(result.afterBlur).toBe("⠁");
  expect(result.deliveries).toEqual(["conflicted"]);
  expect(result.conflictPending).toBe("");
  expect(result.conflictRetry).toBe(false);
});

test("Web Component target transactions work across roots and keep for scoped", async ({
  page,
}) => {
  await loadApi(page);
  await page.setContent(
    '<textarea id="outside"></textarea><div id="host"></div>',
  );
  const result = await page.evaluate(() => {
    const api = (globalThis as typeof globalThis & { BrailleInput: BrowserApi })
      .BrailleInput;
    api.defineBrailleInput("braille-input-browser");
    const outside = document.querySelector("#outside") as HTMLTextAreaElement;
    const host = document.querySelector("#host") as HTMLDivElement;
    const shadow = host.attachShadow({ mode: "open" });
    const input = document.createElement(
      "braille-input-browser",
    ) as BrowserInputElement;
    shadow.append(input);
    input.target = outside;
    outside.focus();
    input.controller.dispatch({
      type: "dot-down",
      dot: 1,
      inputId: "browser:target",
      source: "api",
    });
    input.controller.dispatch({
      type: "dot-up",
      dot: 1,
      inputId: "browser:target",
      source: "api",
    });
    input.controller.commitPending();
    const direct = outside.value;
    const scoped = document.createElement(
      "braille-input-browser",
    ) as BrowserInputElement;
    scoped.setAttribute("for", outside.id);
    shadow.append(scoped);
    const scopedState = scoped.controller.getState().outputSinkState;
    input.destroy();
    scoped.destroy();
    input.remove();
    scoped.remove();
    host.remove();
    outside.remove();
    return { direct, scopedState };
  });
  expect(result.direct).toBe("⠁");
  expect(result.scopedState).toBe("empty");
});

test("editable runtime type and owner-document changes fail closed", async ({
  page,
}) => {
  await loadApi(page);
  await page.setContent(
    '<input id="target" type="text"><iframe id="frame"></iframe>',
  );
  const result = await page.evaluate(() => {
    const api = (globalThis as typeof globalThis & { BrailleInput: BrowserApi })
      .BrailleInput;
    const target = document.querySelector("#target") as HTMLInputElement;
    const controller = api.createBrailleController();
    const attachment = api.attachBrailleEditable(controller, target, {
      activation: "always",
    });
    const deliveries: string[] = [];
    const dispose = controller.subscribeOutput(
      (_action: unknown, delivery: string) => deliveries.push(delivery),
    );
    const commit = () => {
      controller.dispatch({
        type: "dot-down",
        dot: 1,
        inputId: `runtime:${deliveries.length}:down`,
        source: "api",
      });
      controller.dispatch({
        type: "dot-up",
        dot: 1,
        inputId: `runtime:${deliveries.length}:down`,
        source: "api",
      });
      controller.commitPending();
    };
    target.type = "password";
    commit();
    const typeChange = {
      delivery: deliveries[0] ?? null,
      value: target.value,
      pending: controller.getState().pendingDots.join(","),
    };
    dispose();
    attachment.detach();
    controller.destroy();

    const adoptedTarget = document.createElement("input");
    adoptedTarget.type = "text";
    document.body.append(adoptedTarget);
    const adoptedController = api.createBrailleController();
    const adoptedAttachment = api.attachBrailleEditable(
      adoptedController,
      adoptedTarget,
      { activation: "always" },
    );
    const frame = document.querySelector("#frame") as HTMLIFrameElement;
    const otherDocument = frame.contentDocument as Document;
    otherDocument.body.append(otherDocument.adoptNode(adoptedTarget));
    adoptedController.dispatch({
      type: "dot-down",
      dot: 1,
      inputId: "adopt:1",
      source: "api",
    });
    adoptedController.dispatch({
      type: "dot-up",
      dot: 1,
      inputId: "adopt:1",
      source: "api",
    });
    adoptedController.commitPending();
    const adopted = {
      delivery: adoptedController.getState().awaitingRetry,
      value: adoptedTarget.value,
      attachedBeforeDetach: api.isEditableTargetAttached(adoptedTarget),
    };
    adoptedAttachment.detach();
    const attachedAfterDetach = api.isEditableTargetAttached(adoptedTarget);
    adoptedController.destroy();
    frame.remove();
    return { typeChange, adopted: { ...adopted, attachedAfterDetach } };
  });
  expect(result.typeChange).toEqual({
    delivery: "rejected",
    value: "",
    pending: "1",
  });
  expect(result.adopted).toEqual({
    delivery: true,
    value: "",
    attachedBeforeDetach: true,
    attachedAfterDetach: false,
  });
});

test("Web Component synchronously gates UI actions after target removal", async ({
  page,
}) => {
  await loadApi(page);
  await page.setContent('<textarea id="target"></textarea>');
  const result = await page.evaluate(() => {
    const api = (globalThis as typeof globalThis & { BrailleInput: BrowserApi })
      .BrailleInput;
    api.defineBrailleInput("braille-input-sync-browser");
    const target = document.querySelector("#target") as HTMLTextAreaElement;
    const input = document.createElement(
      "braille-input-sync-browser",
    ) as BrowserInputElement;
    input.target = target;
    document.body.append(input);
    let outputCount = 0;
    let eventCount = 0;
    input.controller.subscribeOutput(() => {
      outputCount += 1;
    });
    input.addEventListener("braille-input", () => {
      eventCount += 1;
    });
    target.focus();
    target.remove();
    const dot = input.shadowRoot?.querySelector(
      '[data-braille-dot="1"]',
    ) as HTMLButtonElement;
    const commit = input.shadowRoot?.querySelector(
      '[part~="commit-button"]',
    ) as HTMLButtonElement;
    dot.click();
    commit.click();
    const state = {
      enabled: input.controller.getState().enabled,
      pending: input.controller.getState().pendingDots.join(","),
      outputCount,
      eventCount,
      attached: api.isEditableTargetAttached(target),
    };
    input.destroy();
    input.remove();
    return state;
  });
  expect(result).toEqual({
    enabled: false,
    pending: "",
    outputCount: 0,
    eventCount: 0,
    attached: false,
  });
});

test("Web Component synchronously gates for identity changes and can restore the same object", async ({
  page,
}) => {
  await loadApi(page);
  await page.setContent('<textarea id="identity-target"></textarea>');
  const result = await page.evaluate(async () => {
    const api = (globalThis as typeof globalThis & { BrailleInput: BrowserApi })
      .BrailleInput;
    api.defineBrailleInput("braille-input-identity-browser");
    const target = document.querySelector(
      "#identity-target",
    ) as HTMLTextAreaElement;
    const input = document.createElement(
      "braille-input-identity-browser",
    ) as BrowserInputElement;
    input.setAttribute("for", target.id);
    document.body.append(input);
    let outputCount = 0;
    let eventCount = 0;
    input.controller.subscribeOutput(() => {
      outputCount += 1;
    });
    input.addEventListener("braille-input", () => {
      eventCount += 1;
    });
    const dot = input.shadowRoot?.querySelector(
      '[data-braille-dot="1"]',
    ) as HTMLButtonElement;
    const commit = input.shadowRoot?.querySelector(
      '[part~="commit-button"]',
    ) as HTMLButtonElement;
    target.focus();
    target.id = "renamed-target";
    dot.click();
    commit.click();
    const renamed = {
      value: target.value,
      enabled: input.controller.getState().enabled,
      pending: input.controller.getState().pendingDots.join(","),
      outputCount,
      eventCount,
      attached: api.isEditableTargetAttached(target),
    };
    target.id = "identity-target";
    await Promise.resolve();
    await Promise.resolve();
    target.focus();
    dot.click();
    commit.click();
    const restored = {
      value: target.value,
      enabled: input.controller.getState().enabled,
      outputCount,
      eventCount,
    };
    input.destroy();
    input.remove();
    target.remove();

    const oldTarget = document.createElement("textarea");
    oldTarget.id = "replace-target";
    document.body.append(oldTarget);
    const replacementInput = document.createElement(
      "braille-input-identity-browser",
    ) as BrowserInputElement;
    replacementInput.setAttribute("for", oldTarget.id);
    document.body.append(replacementInput);
    const replacement = document.createElement("textarea");
    replacement.id = oldTarget.id;
    oldTarget.replaceWith(replacement);
    (
      replacementInput.shadowRoot?.querySelector(
        '[data-braille-dot="1"]',
      ) as HTMLButtonElement
    ).click();
    const replaced = {
      oldValue: oldTarget.value,
      newValue: replacement.value,
      attached: api.isEditableTargetAttached(oldTarget),
    };
    replacementInput.destroy();
    replacementInput.remove();
    replacement.remove();

    const rootTarget = document.createElement("textarea");
    rootTarget.id = "root-target";
    document.body.append(rootTarget);
    const rootInput = document.createElement(
      "braille-input-identity-browser",
    ) as BrowserInputElement;
    rootInput.setAttribute("for", rootTarget.id);
    document.body.append(rootInput);
    const host = document.createElement("div");
    document.body.append(host);
    host.attachShadow({ mode: "open" }).append(rootTarget);
    (
      rootInput.shadowRoot?.querySelector(
        '[data-braille-dot="1"]',
      ) as HTMLButtonElement
    ).click();
    const moved = {
      value: rootTarget.value,
      attached: api.isEditableTargetAttached(rootTarget),
    };
    rootInput.destroy();
    rootInput.remove();
    host.remove();
    return { renamed, restored, replaced, moved };
  });
  expect(result.renamed).toEqual({
    value: "",
    enabled: false,
    pending: "",
    outputCount: 0,
    eventCount: 0,
    attached: false,
  });
  expect(result.restored).toEqual({
    value: "⠁",
    enabled: true,
    outputCount: 1,
    eventCount: 1,
  });
  expect(result.replaced).toEqual({
    oldValue: "",
    newValue: "",
    attached: false,
  });
  expect(result.moved).toEqual({ value: "", attached: false });
});

test("tracked keyup filtering releases controller state in both input modes", async ({
  page,
}) => {
  await loadApi(page);
  const results = await page.evaluate(() => {
    const api = (globalThis as typeof globalThis & { BrailleInput: BrowserApi })
      .BrailleInput;
    const scenarios = [
      "ctrl",
      "meta",
      "alt",
      "altGraph",
      "isComposing",
      "composition",
      "filterFalse",
      "filterThrow",
    ];
    const values: Array<{
      scenario: string;
      mode: string;
      pressed: number;
      chord: boolean;
      pending: string;
      outputs: number;
    }> = [];
    for (const mode of ["sequential", "chord"]) {
      for (const scenario of scenarios) {
        let outputs = 0;
        const controller = api.createBrailleController({
          inputMode: mode,
          onOutput: () => {
            outputs += 1;
          },
        });
        const attachment = api.attachKeyboard(controller, document, {
          activation: "always",
          keyboardFilter:
            scenario === "filterFalse"
              ? (event: KeyboardEvent) => event.type === "keydown"
              : scenario === "filterThrow"
                ? (event: KeyboardEvent) => {
                    if (event.type === "keyup") throw new Error("filter");
                    return true;
                  }
                : undefined,
        });
        document.dispatchEvent(
          new KeyboardEvent("keydown", { code: "KeyF", bubbles: true }),
        );
        if (scenario === "composition") {
          document.dispatchEvent(new CompositionEvent("compositionstart"));
        }
        const keyup = new KeyboardEvent("keyup", {
          code: "KeyF",
          bubbles: true,
          ctrlKey: scenario === "ctrl",
          metaKey: scenario === "meta",
          altKey: scenario === "alt",
          isComposing: scenario === "isComposing",
        });
        if (scenario === "altGraph")
          Object.defineProperty(keyup, "getModifierState", {
            value: (name: string) => name === "AltGraph",
          });
        document.dispatchEvent(keyup);
        if (scenario === "composition")
          document.dispatchEvent(new CompositionEvent("compositionend"));
        const state = controller.getState();
        values.push({
          scenario,
          mode,
          pressed: state.pressedInputIds.length,
          chord: state.chordInProgress,
          pending: state.pendingDots.join(","),
          outputs,
        });
        attachment.detach();
        controller.destroy();
      }
    }
    return values;
  });
  for (const result of results) {
    expect(result.pressed, `${result.mode}/${result.scenario}`).toBe(0);
    expect(result.chord, `${result.mode}/${result.scenario}`).toBe(false);
    expect(result.pending, `${result.mode}/${result.scenario}`).toBe(
      result.mode === "sequential" ? "1" : "",
    );
    expect(result.outputs, `${result.mode}/${result.scenario}`).toBe(0);
  }
});

test("stale for identity blocks pending commits and retries without consuming the Cell", async ({
  page,
}) => {
  await loadApi(page);
  const results = await page.evaluate(() => {
    const api = (globalThis as typeof globalThis & { BrailleInput: BrowserApi })
      .BrailleInput;
    api.defineBrailleInput("braille-input-pending-identity-browser");
    return [false, true].map((retry) => {
      const target = document.createElement("textarea");
      target.id = `identity-pending-${String(retry)}`;
      document.body.append(target);
      const input = document.createElement(
        "braille-input-pending-identity-browser",
      ) as BrowserInputElement;
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
        inputId: `identity:${String(retry)}`,
        source: "api",
      });
      input.controller.dispatch({
        type: "dot-up",
        dot: 1,
        inputId: `identity:${String(retry)}`,
        source: "api",
      });
      if (retry) input.controller.commitPending();
      let outputs = 0;
      let events = 0;
      input.controller.subscribeOutput(() => {
        outputs += 1;
      });
      input.addEventListener("braille-input", () => {
        events += 1;
      });
      target.id = `stale-${target.id}`;
      const selector = retry
        ? '[part~="retry-button"]'
        : '[part~="commit-button"]';
      (input.shadowRoot?.querySelector(selector) as HTMLButtonElement).click();
      const state = input.controller.getState();
      const result = {
        retry,
        pending: state.pendingDots.join(","),
        awaitingRetry: state.awaitingRetry,
        outputs,
        events,
        attached: api.isEditableTargetAttached(target),
        value: target.value,
      };
      input.destroy();
      input.remove();
      target.remove();
      return result;
    });
  });
  expect(results).toEqual([
    {
      retry: false,
      pending: "1",
      awaitingRetry: false,
      outputs: 0,
      events: 0,
      attached: false,
      value: "",
    },
    {
      retry: true,
      pending: "1",
      awaitingRetry: true,
      outputs: 0,
      events: 0,
      attached: false,
      value: "",
    },
  ]);
});
