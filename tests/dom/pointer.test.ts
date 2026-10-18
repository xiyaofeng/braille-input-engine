// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createActivationGroup } from "../../src/adapters/activation.js";
import { attachPointer } from "../../src/adapters/pointer.js";
import { createBrailleController } from "../../src/core/controller.js";
import { extensionId, type InputMode } from "../../src/core/types.js";

function pointerEvent(
  type: string,
  pointerId: number,
  pointerType = "touch",
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { configurable: true, value: pointerId },
    pointerType: { configurable: true, value: pointerType },
    button: { configurable: true, value: 0 },
  });
  return event;
}

describe("pointer adapter", () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
    vi.useRealTimers();
  });

  function setup(inputMode: InputMode = "chord", guard?: () => boolean) {
    const controller = createBrailleController({ inputMode });
    const scope = document.createElement("div");
    scope.innerHTML =
      '<button data-braille-dot="1"><span>1</span></button><button data-braille-dot="2">2</button>';
    document.body.append(scope);
    const [dot1, dot2] = [...scope.querySelectorAll("button")];
    if (!dot1 || !dot2) throw new Error("Missing test buttons");
    const output: string[] = [];
    controller.subscribeOutput((action) => {
      if (action.kind === "braille") output.push(action.char);
    });
    const attachment = attachPointer(controller, scope, {
      activation: "manual",
      ...(guard ? { actionGuard: guard } : {}),
    });
    attachment.activate();
    cleanups.push(() => {
      attachment.detach();
      controller.destroy();
      scope.remove();
    });
    return { controller, scope, dot1, dot2, output, attachment };
  }

  function physicalClick(
    element: HTMLElement,
    pointerId = 1,
    pointerType = "touch",
  ) {
    element.dispatchEvent(pointerEvent("click", pointerId, pointerType));
  }

  for (const mode of ["sequential", "chord"] as const) {
    it.each([50, 650, 1500, 60_000])(
      `normalizes %ims presses once in ${mode}`,
      (delay) => {
        vi.useFakeTimers();
        const { controller, dot1, output } = setup(mode);
        const child = dot1.firstElementChild as HTMLElement;
        child.dispatchEvent(pointerEvent("pointerdown", 1));
        vi.advanceTimersByTime(delay);
        dot1.dispatchEvent(pointerEvent("pointerup", 1));
        physicalClick(child);
        expect(controller.getState().pressedInputIds).toEqual([]);
        if (mode === "sequential") {
          expect(controller.getState().pendingDots).toEqual([1]);
          controller.commitPending();
        }
        expect(output).toEqual(["⠁"]);
      },
    );

    it(`accepts independent click activations immediately after pointer input in ${mode}`, () => {
      const { controller, dot1, output } = setup(mode);
      dot1.dispatchEvent(pointerEvent("pointerdown", 1));
      dot1.dispatchEvent(pointerEvent("pointerup", 1));
      physicalClick(dot1);
      dot1.click();
      dot1.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
      if (mode === "sequential") {
        expect(controller.getState().pendingDots).toEqual([1]);
        controller.commitPending();
        expect(output).toEqual(["⠁"]);
      } else expect(output).toEqual(["⠁", "⠁", "⠁"]);
    });

    it.each(["pointerdown", "pointerup"])(
      `does not adopt a previous attachment's tail after %s in ${mode}`,
      (phase) => {
        const { controller, scope, dot1, attachment } = setup(mode);
        dot1.dispatchEvent(pointerEvent("pointerdown", 1));
        if (phase === "pointerup")
          dot1.dispatchEvent(pointerEvent("pointerup", 1));
        attachment.detach();
        const replacement = createBrailleController({ inputMode: mode });
        const next = attachPointer(replacement, scope, {
          activation: "always",
        });
        cleanups.push(() => {
          next.detach();
          replacement.destroy();
        });
        const output: string[] = [];
        replacement.subscribeOutput((action) => {
          if (action.kind === "braille") output.push(action.char);
        });
        dot1.dispatchEvent(pointerEvent("pointerup", 1));
        physicalClick(dot1);
        dot1.dispatchEvent(
          new MouseEvent("click", { bubbles: true, detail: 1 }),
        );
        expect(replacement.getState().pendingDots).toEqual([]);
        expect(output).toEqual([]);
        // New physical input can reuse the ID; an orphan physical click cannot.
        dot1.dispatchEvent(pointerEvent("pointerdown", 1));
        dot1.dispatchEvent(pointerEvent("pointerup", 1));
        physicalClick(dot1);
        if (mode === "sequential") replacement.commitPending();
        expect(output).toEqual(["⠁"]);
        expect(controller.getState().pressedInputIds).toEqual([]);
      },
    );
  }

  it("ignores normal lost capture while another pointer remains live", () => {
    const { controller, dot1, dot2, output } = setup();
    dot1.dispatchEvent(pointerEvent("pointerdown", 1));
    dot2.dispatchEvent(pointerEvent("pointerdown", 2));
    dot1.dispatchEvent(pointerEvent("pointerup", 1));
    dot1.dispatchEvent(pointerEvent("lostpointercapture", 1));
    physicalClick(dot1, 1);
    expect(controller.getState().pressedInputIds).toHaveLength(1);
    expect(controller.getState().pendingDots).toEqual([1, 2]);
    dot2.dispatchEvent(pointerEvent("pointerup", 2));
    physicalClick(dot2, 2);
    expect(output).toEqual(["⠃"]);
  });

  it("keeps same-dot pointers distinct and cancels only live chords", () => {
    const { controller, dot1, output } = setup();
    dot1.dispatchEvent(pointerEvent("pointerdown", 1));
    dot1.dispatchEvent(pointerEvent("pointerdown", 2));
    dot1.dispatchEvent(pointerEvent("pointerup", 1));
    physicalClick(dot1, 1);
    expect(output).toEqual([]);
    dot1.dispatchEvent(pointerEvent("pointerup", 2));
    physicalClick(dot1, 2);
    expect(output).toEqual(["⠁"]);
    dot1.dispatchEvent(pointerEvent("pointerdown", 2));
    dot1.dispatchEvent(pointerEvent("pointercancel", 1));
    expect(controller.getState().pressedInputIds).toHaveLength(1);
    dot1.dispatchEvent(pointerEvent("pointercancel", 2));
    physicalClick(dot1, 2);
    expect(controller.getState().pendingDots).toEqual([]);
    expect(controller.getState().pressedInputIds).toEqual([]);
    expect(output).toEqual(["⠁"]);
  });

  it.each(["deactivate", "disable", "reset"])(
    "does not retain IDs across %s and permits reuse",
    (transition) => {
      const { controller, dot1, output, attachment } = setup();
      for (let pointerId = 1; pointerId <= 200; pointerId++) {
        dot1.dispatchEvent(pointerEvent("pointerdown", pointerId));
        if (transition === "deactivate") {
          attachment.deactivate();
          attachment.activate();
        } else if (transition === "disable") {
          controller.disable({ cancelPending: true });
          controller.enable();
        } else controller.reset();
        dot1.dispatchEvent(pointerEvent("pointerup", pointerId));
        physicalClick(dot1, pointerId);
        expect(controller.getState().pressedInputIds).toEqual([]);
        expect(output).toEqual([]);
      }
      dot1.dispatchEvent(pointerEvent("pointerdown", 1));
      dot1.dispatchEvent(pointerEvent("pointerup", 1));
      expect(output).toEqual(["⠁"]);
    },
  );

  it("ignores input begun while inactive and cancels tracked up when the guard closes", () => {
    let allowed = true;
    const { controller, attachment, dot1, output } = setup(
      "chord",
      () => allowed,
    );
    attachment.deactivate();
    dot1.dispatchEvent(pointerEvent("pointerdown", 1));
    attachment.activate();
    dot1.dispatchEvent(pointerEvent("pointerup", 1));
    physicalClick(dot1);
    dot1.dispatchEvent(pointerEvent("pointerdown", 1));
    allowed = false;
    dot1.dispatchEvent(pointerEvent("pointerup", 1));
    allowed = true;
    physicalClick(dot1);
    expect(controller.getState().pressedInputIds).toEqual([]);
    expect(controller.getState().pendingDots).toEqual([]);
    expect(output).toEqual([]);
    dot1.click();
    expect(output).toEqual(["⠁"]);
  });

  it("does not release another attachment's inputs on the same controller", () => {
    const { controller, attachment, dot1 } = setup();
    const scope = document.createElement("div");
    scope.innerHTML = '<button data-braille-dot="2">2</button>';
    document.body.append(scope);
    const dot2 = scope.firstElementChild as HTMLElement;
    const other = attachPointer(controller, scope, { activation: "always" });
    cleanups.push(() => {
      other.detach();
      scope.remove();
    });
    dot1.dispatchEvent(pointerEvent("pointerdown", 1));
    dot2.dispatchEvent(pointerEvent("pointerdown", 1));
    attachment.detach();
    expect(controller.getState().pressedInputIds).toHaveLength(1);
    dot2.dispatchEvent(pointerEvent("pointerup", 1));
    expect(controller.getState().pressedInputIds).toEqual([]);
  });

  it.each([
    "deactivate",
    "detach",
    "pointercancel",
    "lostpointercapture",
    "group-destroy",
  ] as const)(
    "notifies a custom strategy when pointer input is cancelled by %s",
    (transition) => {
      const mode = extensionId("test:pointer-latch");
      const resets: string[] = [];
      const controller = createBrailleController({
        inputMode: mode,
        strategies: [
          () => ({
            id: mode,
            activate: () => {},
            deactivate: () => {},
            destroy: () => {},
            reset: (reason, context) => {
              resets.push(reason);
              if (reason === "activation-lost")
                context.setPendingContributions([]);
            },
            handle: (action, context) => {
              if (action.type === "dot-down")
                context.setPendingContributions([
                  ...context.getPendingContributions(),
                  {
                    id: action.inputId,
                    dot: action.dot,
                    source: action.source,
                  },
                ]);
              if (
                action.type === "commit-request" &&
                context.getPendingContributions().length > 0
              )
                context.requestCommit(action.source);
            },
          }),
        ],
      });
      const scope = document.createElement("div");
      scope.innerHTML = '<button data-braille-dot="1">1</button>';
      document.body.append(scope);
      const dot = scope.firstElementChild as HTMLElement;
      const group =
        transition === "group-destroy"
          ? createActivationGroup(document)
          : undefined;
      const attachment = attachPointer(controller, scope, {
        activation: "manual",
        ...(group ? { activationGroup: group } : {}),
      });
      attachment.activate();
      const output: string[] = [];
      controller.subscribeOutput((action) => {
        if (action.kind === "braille") output.push(action.char);
      });
      cleanups.push(() => {
        attachment.detach();
        controller.destroy();
        scope.remove();
      });

      dot.dispatchEvent(pointerEvent("pointerdown", 1));
      expect(controller.getState().pendingDots).toEqual([1]);
      if (transition === "deactivate" || transition === "detach")
        attachment[transition]();
      else if (transition === "group-destroy") group?.destroy();
      else dot.dispatchEvent(pointerEvent(transition, 1));

      expect(resets).toEqual(["activation-lost"]);
      expect(controller.getState().pressedInputIds).toEqual([]);
      expect(controller.getState().pendingDots).toEqual([]);
      controller.commitPending();
      expect(output).toEqual([]);
    },
  );

  it.each(["sequential", "chord"] as const)(
    "keeps a queued nested pointer down tracked in %s when an earlier subscriber observes stale state",
    (mode) => {
      const controller = createBrailleController({ inputMode: mode });
      const scope = document.createElement("div");
      scope.innerHTML =
        '<button data-braille-dot="1">1</button><button data-braille-dot="2">2</button>';
      document.body.append(scope);
      const [dot1, dot2] = [...scope.querySelectorAll("button")];
      if (!dot1 || !dot2) throw new Error("Missing test buttons");
      let nested = false;
      const disposeEarlierSubscriber = controller.subscribeState((state) => {
        if (!nested && state.pressedInputIds.length === 1) {
          nested = true;
          dot2.dispatchEvent(pointerEvent("pointerdown", 2));
        }
      });
      const attachment = attachPointer(controller, scope, {
        activation: "manual",
      });
      attachment.activate();
      const output: string[] = [];
      controller.subscribeOutput((action) => {
        if (action.kind === "braille") output.push(action.char);
      });
      cleanups.push(() => {
        attachment.detach();
        disposeEarlierSubscriber();
        controller.destroy();
        scope.remove();
      });

      dot1.dispatchEvent(pointerEvent("pointerdown", 1));
      dot1.dispatchEvent(pointerEvent("pointerup", 1));
      dot2.dispatchEvent(pointerEvent("pointerup", 2));

      expect(nested).toBe(true);
      expect(controller.getState().pressedInputIds).toEqual([]);
      if (mode === "chord") expect(output).toEqual(["⠃"]);
      else {
        expect(controller.getState().pendingDots).toEqual([1, 2]);
        controller.commitPending();
        expect(output).toEqual(["⠃"]);
      }
    },
  );

  for (const mode of ["chord", "custom"] as const)
    for (const timing of ["direct", "queued"] as const)
      for (const order of ["before", "after"] as const)
        it.each([
          "pointercancel",
          "lostpointercapture",
          "deactivate",
          "detach",
          "group-destroy",
        ] as const)(
          `finishes %s before reentrant input in ${mode} (${timing}, subscriber ${order})`,
          (transition) => {
            const id = extensionId("test:cancel-boundary");
            const controller = createBrailleController({
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
            const scope = document.createElement("section");
            const other = document.createElement("section");
            scope.innerHTML =
              '<button data-braille-dot="1">1</button><button data-braille-dot="3">3</button>';
            other.innerHTML = '<button data-braille-dot="2">2</button>';
            document.body.append(scope, other);
            const dot1 = scope.firstElementChild as HTMLElement;
            const dot3 = scope.lastElementChild as HTMLElement;
            const dot2 = other.firstElementChild as HTMLElement;
            let armed = false;
            let fired = false;
            const listener = (
              state: ReturnType<typeof controller.getState>,
            ) => {
              // Queue the next round after the first of two cancellations.
              if (armed && !fired && state.pressedInputIds.length === 1) {
                fired = true;
                dot2.dispatchEvent(pointerEvent("pointerdown", 2));
              }
            };
            const disposers: (() => void)[] = [];
            if (order === "before")
              disposers.push(controller.subscribeState(listener));
            const group = createActivationGroup(document);
            const a = attachPointer(controller, scope, {
              activation: "manual",
              activationGroup: group,
            });
            a.activate();
            const b = attachPointer(controller, other, {
              activation: "always",
            });
            if (order === "after")
              disposers.push(controller.subscribeState(listener));
            const output: string[] = [];
            const diagnostics: string[] = [];
            controller.subscribeOutput((action) => {
              if (action.kind === "braille") output.push(action.char);
            });
            controller.subscribeDiagnostic((d) => diagnostics.push(d.code));
            cleanups.push(() => {
              armed = false;
              disposers.forEach((dispose) => dispose());
              a.detach();
              b.detach();
              group.destroy();
              controller.destroy();
              scope.remove();
              other.remove();
            });
            dot1.dispatchEvent(pointerEvent("pointerdown", 1));
            dot3.dispatchEvent(pointerEvent("pointerdown", 3));
            armed = true;
            const cancel = () => {
              if (transition === "deactivate" || transition === "detach")
                a[transition]();
              else if (transition === "group-destroy") group.destroy();
              else dot1.dispatchEvent(pointerEvent(transition, 1));
            };
            if (timing === "direct") cancel();
            else {
              let once = false;
              const dispose = controller.subscribeState(() => {
                if (!once) {
                  once = true;
                  cancel();
                }
              });
              dispose();
            }
            expect(fired).toBe(true);
            expect(controller.getState().pressedInputIds).toHaveLength(1);
            expect(controller.getState().pendingDots).toEqual([2]);
            // Old capture/up notifications cannot cancel the surviving round.
            dot1.dispatchEvent(pointerEvent("lostpointercapture", 1));
            dot3.dispatchEvent(pointerEvent("pointerup", 3));
            dot2.dispatchEvent(pointerEvent("pointerup", 2));
            if (mode === "custom") controller.commitPending();
            expect(output).toEqual(["⠂"]);
            expect(controller.getState().pressedInputIds).toEqual([]);
            expect(controller.getState().pendingDots).toEqual([]);
            expect(diagnostics).toEqual([]);
          },
        );

  it("cancels every pointer when one pointer loses capture", () => {
    const controller = createBrailleController({ inputMode: "chord" });
    const scope = document.createElement("div");
    const dot = document.createElement("button");
    dot.dataset.brailleDot = "1";
    scope.append(dot);
    document.body.append(scope);
    const attachment = attachPointer(controller, scope, {
      activation: "always",
    });
    dot.dispatchEvent(pointerEvent("pointerdown", 1));
    dot.dispatchEvent(pointerEvent("pointerdown", 2));
    expect(controller.getState().pressedInputIds).toHaveLength(2);
    scope.dispatchEvent(pointerEvent("lostpointercapture", 1));
    expect(controller.getState().pressedInputIds).toEqual([]);
    expect(controller.getState().pendingDots).toEqual([]);
    attachment.detach();
    controller.destroy();
    scope.remove();
  });
});
