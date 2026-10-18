import type * as Core from "../../src/index.js";
import type { InternalController } from "../../src/core/internal.js";
export type ModelAction = {
  kind:
    | "down"
    | "up"
    | "cancel"
    | "loss"
    | "global-loss"
    | "commit"
    | "discard"
    | "disable"
    | "disable-discard"
    | "enable"
    | "reset"
    | "config"
    | "mode"
    | "destroy"
    | "rebuild";
  slot: 1 | 2 | 3;
  delivery: "accepted" | "rejected" | "unhandled" | "conflicted";
};

// A deliberately small set model: no production contribution arrays, ordinals,
// queue, draft, resetStrategy or adapter implementation is reused here.
export function runLifecycleModel(
  api: typeof Core,
  initialMode: "chord" | "sequential" | "custom",
  actions: readonly ModelAction[],
) {
  let mode = initialMode;
  const customId = api.extensionId("test:model");
  let delivery: ModelAction["delivery"] = "accepted";
  const actual: string[] = [],
    expected: string[] = [];
  let enabled = true,
    destroyed = false,
    retry = false,
    toggle = true;
  const held = new Set<number>(),
    cell = new Set<number>();
  const create = () =>
    api.createBrailleController({
      inputMode: mode === "custom" ? customId : mode,
      outputSink: { write: () => delivery },
      onOutput(action, result) {
        if (action.kind === "braille") actual.push(`${action.char}:${result}`);
      },
      strategies: [
        () => ({
          id: customId,
          activate() {},
          deactivate() {},
          destroy() {},
          reset(_reason, ctx) {
            ctx.setPendingContributions([]);
          },
          handle(action, ctx) {
            if (action.type === "dot-down")
              ctx.setPendingContributions([
                ...ctx
                  .getPendingContributions()
                  .filter((x) => x.id !== action.inputId),
                { id: action.inputId, dot: action.dot, source: action.source },
              ]);
            if (action.type === "commit-request")
              ctx.requestCommit(action.source);
          },
        }),
      ],
    });
  let c = create();
  const snapshots: [ReturnType<typeof c.getState>, string][] = [];
  const commit = () => {
    if (!cell.size) return;
    expected.push(
      `${String.fromCodePoint(0x2800 | [...cell].reduce((m, d) => m | (1 << (d - 1)), 0))}:${delivery}`,
    );
    retry = delivery === "rejected";
    if (!retry) cell.clear();
    if (delivery === "conflicted") held.clear();
  };
  const clear = () => {
    held.clear();
    cell.clear();
    retry = false;
  };
  for (const [index, action] of actions.entries()) {
    delivery = action.delivery;
    const id = `model:${action.slot}`,
      dot = action.slot;
    const beforeOutputs = actual.length;
    if (action.kind === "rebuild") {
      c.destroy();
      clear();
      enabled = true;
      destroyed = false;
      toggle = true;
      c = create();
    } else if (destroyed) {
      if (action.kind === "destroy") c.destroy();
      else {
        let threw = false;
        try {
          c.dispatch({ type: "dot-down", dot, inputId: id, source: "api" });
        } catch {
          threw = true;
        }
        if (!threw) throw new Error(`destroyed mutator accepted at ${index}`);
      }
    } else
      switch (action.kind) {
        case "down":
          c.dispatch({ type: "dot-down", dot, inputId: id, source: "api" });
          if (enabled && !retry && !held.has(dot)) {
            held.add(dot);
            if (mode === "sequential" && toggle && cell.has(dot))
              cell.delete(dot);
            else cell.add(dot);
          }
          break;
        case "up": {
          c.dispatch({ type: "dot-up", dot, inputId: id, source: "api" });
          const known = held.delete(dot);
          if (known && !retry && mode === "chord" && !held.size) commit();
          break;
        }
        case "cancel":
          c.dispatch({ type: "input-cancel", inputId: id, source: "api" });
          if (held.delete(dot) && !retry && mode === "chord") cell.clear();
          break;
        case "loss":
        case "global-loss":
          (c as typeof c & InternalController).__handleActivationLost(
            "activation-lost",
            action.kind === "loss" ? [id] : undefined,
          );
          if (action.kind === "loss") held.delete(dot);
          else held.clear();
          if (!retry && mode !== "sequential") cell.clear();
          break;
        case "commit":
          c.commitPending();
          if ((enabled || retry) && (retry || mode !== "chord" || !held.size))
            commit();
          break;
        case "discard":
          c.cancelPending();
          clear();
          break;
        case "disable":
        case "disable-discard": {
          const cancel = action.kind === "disable-discard";
          c.disable({ cancelPending: cancel });
          if (enabled || cancel) {
            held.clear();
            if (cancel) {
              cell.clear();
              retry = false;
            } else if (!retry && mode !== "sequential") cell.clear();
          }
          enabled = false;
          break;
        }
        case "enable":
          c.enable();
          enabled = true;
          break;
        case "reset":
          c.reset();
          clear();
          break;
        case "config":
          toggle = !toggle;
          c.updateOptions({ toggleDots: toggle });
          held.clear();
          if (!retry && mode !== "sequential") cell.clear();
          break;
        case "mode": {
          const next = mode === "chord" ? "sequential" : "chord";
          c.setInputMode(next);
          mode = next;
          clear();
          break;
        }
        case "destroy":
          c.destroy();
          clear();
          enabled = false;
          destroyed = true;
          break;
      }
    const s = c.getState();
    const ordered = [...cell].sort();
    const expectedPressed = [...held].sort().map((d) => `model:${d}`);
    if (
      String(s.pendingDots) !== String(ordered) ||
      String(s.pressedInputIds) !== String(expectedPressed) ||
      s.awaitingRetry !== retry ||
      s.enabled !== enabled ||
      s.destroyed !== destroyed ||
      String(actual) !== String(expected)
    )
      throw new Error(
        `model mismatch at ${index}: ${JSON.stringify({ action, state: s, cell: ordered, held: expectedPressed, retry, enabled, destroyed, actual, expected })}`,
      );
    if (actual.length - beforeOutputs > 1)
      throw new Error("multiple outputs in one action");
    if (
      !Object.isFrozen(s) ||
      !Object.isFrozen(s.pendingDots) ||
      !Object.isFrozen(s.pressedInputIds)
    )
      throw new Error("mutable snapshot");
    snapshots.push([s, JSON.stringify(s)]);
    for (const [old, serialized] of snapshots)
      if (JSON.stringify(old) !== serialized)
        throw new Error("changed old snapshot");
  }
  c.destroy();
}
