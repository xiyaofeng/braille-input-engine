import { asInternalController } from "../core/internal.js";
import type {
  BrailleInputAction,
  BrailleInputController,
} from "../core/types.js";

export type ActivationLoss = readonly [
  controller: BrailleInputController,
  inputIds: readonly string[],
  release?: () => void,
];

// Preparation must only swap local tracking/activation state. Run it for all
// participants before entering controller code, which can notify host callbacks.
export function applyActivationLosses(losses: readonly ActivationLoss[]): void {
  for (const controller of new Set(losses.map((loss) => loss[0]))) {
    const entries = losses.filter((loss) => loss[0] === controller);
    try {
      asInternalController(controller).__handleActivationLost(
        "activation-lost",
        entries.flatMap((entry) => entry[1]),
      );
    } catch {
      // Adapter teardown is best effort during an unavailable controller phase.
    } finally {
      for (const entry of entries) entry[2]?.();
    }
  }
}

type PrepareInput = (composing?: boolean) => ActivationLoss | void;
type DocumentParticipant = {
  prepare: PrepareInput;
  focus?: (from: Node, to: Node | null) => ActivationLoss | void;
};

// Document-global loss and root-local focus share one ownership registry. Group
// tokens can retain a root even when no attachment listens on that root itself.
const documents = new WeakMap<
  Document,
  ReturnType<typeof createDocumentLifecycle>
>();
function createDocumentLifecycle(document: Document) {
  const controllers = new Map<
    BrailleInputController,
    Set<DocumentParticipant>
  >();
  const roots = new Map<Node, Set<object>>();
  let pending: Node | undefined;
  const focus = (event: Event) => {
    const path = event.composedPath();
    if (
      [...path].reverse().find((node) => roots.has(node as Node)) !==
      event.currentTarget
    )
      return;
    const target = path[0] as Node;
    let from: Node | undefined, to: Node | null;
    if (event.type === "focusout") {
      const related = (event as FocusEvent).relatedTarget as Node | null;
      pending = undefined;
      // Cross-root relatedTarget can expose only a host. The browser's next
      // synchronous focusin supplies the actual accessible destination.
      if ((related as Element | null)?.shadowRoot) {
        pending = target;
        return;
      }
      from = target;
      to = related;
    } else {
      from = pending;
      to = target;
      pending = undefined;
    }
    if (from) {
      const losses: ActivationLoss[] = [];
      for (const members of controllers.values())
        for (const member of [...members]) {
          const loss = member.focus?.(from, to);
          if (loss) losses.push(loss);
        }
      applyActivationLosses(losses);
    }
  };
  const loss = (event: Event) => {
    const hidden = event.type === "visibilitychange";
    if (hidden && document.visibilityState !== "hidden") return;
    for (const [controller, members] of [...controllers]) {
      const losses = [...members].map((member) =>
        member.prepare(event.type === "compositionstart" || undefined),
      );
      try {
        asInternalController(controller).__handleActivationLost(
          hidden ? "hidden" : "activation-lost",
        );
      } catch {
        /* Structural lifecycle hook reentry is rejected by the controller. */
      } finally {
        for (const loss of losses) if (loss) loss[2]?.();
      }
    }
  };
  const end = () => {
    for (const members of controllers.values())
      for (const member of [...members]) member.prepare(false);
  };
  const listen = (add: boolean) => {
    const method = add ? "addEventListener" : "removeEventListener";
    document[method]("compositionstart", loss, true);
    document[method]("compositionend", end, true);
    document[method]("visibilitychange", loss);
    document.defaultView?.[method]("blur", loss);
  };
  return {
    controllers,
    roots,
    focus,
    listen,
    clear: () => {
      pending = undefined;
    },
  };
}
function documentLifecycle(document: Document) {
  let runtime = documents.get(document);
  if (!runtime)
    documents.set(document, (runtime = createDocumentLifecycle(document)));
  return runtime;
}

export function observeDocumentLifecycle(
  controller: BrailleInputController,
  document: Document,
  prepare: PrepareInput,
  focus?: DocumentParticipant["focus"],
): () => void {
  const runtime = documentLifecycle(document);
  const release = retainFocusRoot(document);
  if (!runtime.controllers.size) runtime.listen(true);
  let members = runtime.controllers.get(controller);
  if (!members) runtime.controllers.set(controller, (members = new Set()));
  const participants = members;
  const member: DocumentParticipant = { prepare, ...(focus ? { focus } : {}) };
  participants.add(member);
  return () => {
    participants.delete(member);
    if (!participants.size) runtime.controllers.delete(controller);
    if (!runtime.controllers.size) runtime.listen(false);
    release();
  };
}

export function retainFocusRoot(scope: Node): () => void {
  const root = scope.getRootNode();
  const runtime = documentLifecycle(
    scope.nodeType === 9 ? (scope as Document) : scope.ownerDocument!,
  );
  let owners = runtime.roots.get(root);
  if (!owners) {
    runtime.roots.set(root, (owners = new Set()));
    for (const type of ["focusout", "focusin"])
      root.addEventListener(type, runtime.focus, true);
  }
  const registrations = owners,
    token = {};
  registrations.add(token);
  return () => {
    if (!registrations.delete(token) || registrations.size) return;
    runtime.roots.delete(root);
    for (const type of ["focusout", "focusin"])
      root.removeEventListener(type, runtime.focus, true);
    if (!runtime.roots.size) runtime.clear();
  };
}

type InputParticipant = {
  scope: Node;
  types: readonly string[];
  prepare: (
    event: Event,
  ) => (() => ActivationLoss | BrailleInputAction | undefined) | undefined;
};
const terminals = new WeakMap<BrailleInputController, Set<InputParticipant>>();
const terminalEvents = new WeakMap<Event, WeakSet<BrailleInputController>>();

// Capture marks a new dispatch, without touching input state. All capture
// listeners precede the first bubble listener, which prepares every matching
// attachment before notifying the controller. Later bubble listeners are inert.
// A reused Event is rearmed by capture; nested distinct events have separate keys.
export function observeInputTermination(
  controller: BrailleInputController,
  scope: Node,
  types: readonly string[],
  prepare: InputParticipant["prepare"],
): () => void {
  let members = terminals.get(controller);
  if (!members) terminals.set(controller, (members = new Set()));
  const participants = members,
    member = { scope, types, prepare };
  participants.add(member);
  const capture = (event: Event) => {
    if (!terminalEvents.has(event)) terminalEvents.set(event, new WeakSet());
    terminalEvents.get(event)!.delete(controller);
  };
  const cancel = (event: Event) => {
    const handled = terminalEvents.get(event)!;
    if (handled.has(controller)) return;
    handled.add(controller);
    const path = event.composedPath();
    const preparations = [...participants]
      .filter(
        (entry) =>
          entry.types.includes(event.type) &&
          path.includes(entry.scope) &&
          (event.bubbles || event.target === entry.scope),
      )
      .sort((a, b) => path.indexOf(a.scope) - path.indexOf(b.scope))
      .map((entry) => entry.prepare(event))
      .filter(Boolean);
    if (!preparations.length) return;
    try {
      asInternalController(controller).__handleActivationLost(
        "activation-lost",
        () => {
          const losses: ActivationLoss[] = [];
          const actions: BrailleInputAction[] = [];
          for (const prepare of preparations) {
            const result = prepare?.();
            if (Array.isArray(result))
              losses.push(result as unknown as ActivationLoss);
            else if (result) actions.push(result as BrailleInputAction);
          }
          return [
            losses.length ? losses.flatMap((loss) => loss[1]) : undefined,
            actions.sort(
              (a, b) =>
                Number(a.type !== "input-cancel") -
                Number(b.type !== "input-cancel"),
            ),
            () => {
              for (const loss of losses) loss[2]?.();
            },
          ];
        },
      );
    } catch {
      // Structural-hook reentry is diagnosed by the controller, never leaked
      // through a browser listener. No preparation ran in that rejected phase.
    }
  };
  for (const type of types) {
    scope.addEventListener(type, capture, true);
    scope.addEventListener(type, cancel);
  }
  return () => {
    participants.delete(member);
    for (const type of types) {
      scope.removeEventListener(type, capture, true);
      scope.removeEventListener(type, cancel);
    }
  };
}

// DOM contains does not cross shadow boundaries. Only walk roots reachable from
// an already supplied node; never discover inaccessible roots or other frames.
export function containsFocus(scope: Node, node: Node | null): boolean {
  for (; node; node = (node.getRootNode() as ShadowRoot).host)
    if (scope.contains(node)) return true;
  return false;
}

export function leavesScope(
  from: Node,
  to: Node | null,
  scope: Node,
  group?: { isMember(node: Node | null): boolean },
): boolean {
  const contains = (node: Node | null) =>
    group ? group.isMember(node) : containsFocus(scope, node);
  return contains(from) && !contains(to);
}
