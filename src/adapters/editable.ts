import {
  BrailleInputException,
  type BrailleAttachment,
  type BrailleInputController,
  type BrailleOutputAction,
  type OutputDelivery,
  type EditableAdapterOptions,
  type BrailleStateSnapshot,
} from "../core/types.js";
import {
  asInternalController,
  reportControllerDiagnostic,
} from "../core/internal.js";
import { getInternalActivationGroup } from "./activation.js";

export type BrailleEditableTarget =
  HTMLInputElement | HTMLTextAreaElement | HTMLElement;

interface SelectionBookmark {
  start: number;
  end: number;
}

interface ContentBookmark extends SelectionBookmark {
  readonly node: Text | null;
}

const attachedTargets = new WeakMap<
  object,
  { controller: BrailleInputController; token: symbol }
>();

function isInputTarget(
  target: BrailleEditableTarget,
): target is HTMLInputElement {
  return (
    typeof HTMLInputElement !== "undefined" &&
    target instanceof HTMLInputElement
  );
}

function isTextAreaTarget(
  target: BrailleEditableTarget,
): target is HTMLTextAreaElement {
  return (
    typeof HTMLTextAreaElement !== "undefined" &&
    target instanceof HTMLTextAreaElement
  );
}

function isContentEditableTarget(
  target: BrailleEditableTarget,
): target is HTMLElement {
  if (isInputTarget(target) || isTextAreaTarget(target)) return false;
  const value = target.getAttribute("contenteditable");
  return value === "" || value === "true" || target.isContentEditable === true;
}

function targetKind(
  target: BrailleEditableTarget,
): "input" | "textarea" | "contenteditable" {
  if (isTextAreaTarget(target)) return "textarea";
  if (isInputTarget(target)) {
    const type = target.type.toLowerCase();
    if (["text", "search", "tel", "url"].includes(type)) return "input";
    throw new BrailleInputException(
      "UNSUPPORTED_TARGET",
      `Unsupported input type: ${type}`,
    );
  }
  if (isContentEditableTarget(target)) return "contenteditable";
  throw new BrailleInputException(
    "UNSUPPORTED_TARGET",
    "Target is not a supported editable element.",
  );
}

function validateContentGrammar(target: HTMLElement): Text | null {
  if (target.getAttribute("contenteditable") === "false")
    throw new BrailleInputException(
      "UNSUPPORTED_TARGET",
      "contenteditable=false is not supported.",
    );
  if (target.childNodes.length === 0) return null;
  if (
    target.childNodes.length !== 1 ||
    target.firstChild?.nodeType !== Node.TEXT_NODE
  ) {
    throw new BrailleInputException(
      "UNSUPPORTED_TARGET",
      "Only an empty host or one direct Text child is supported.",
    );
  }
  return target.firstChild as Text;
}

function getPreviousGraphemeStart(value: string, end: number): number | null {
  if (end <= 0) return null;
  const Segmenter = globalThis.Intl?.Segmenter;
  if (typeof Segmenter !== "function") return null;
  const segmenter = new Segmenter(undefined, { granularity: "grapheme" });
  let previous = 0;
  for (const segment of segmenter.segment(value)) {
    if (segment.index >= end) break;
    previous = segment.index;
    if (segment.index + segment.segment.length >= end) return segment.index;
  }
  return previous;
}

function selectionEqual(
  left: SelectionBookmark | null,
  right: SelectionBookmark | null,
): boolean {
  return Boolean(
    left && right && left.start === right.start && left.end === right.end,
  );
}

function createInputEvent(
  target: HTMLElement,
  type: "beforeinput" | "input",
  inputType: string,
  data: string | null,
  cancelable: boolean,
): Event {
  const view = target.ownerDocument.defaultView;
  const InputEventCtor = view?.InputEvent;
  if (InputEventCtor) {
    return new InputEventCtor(type, {
      bubbles: true,
      composed: true,
      cancelable,
      inputType,
      data,
    });
  }
  const event = new Event(type, { bubbles: true, composed: true, cancelable });
  Object.defineProperties(event, {
    inputType: { configurable: true, value: inputType },
    data: { configurable: true, value: data },
  });
  return event;
}

function readControlSelection(
  target: HTMLInputElement | HTMLTextAreaElement,
): SelectionBookmark | null {
  if (target.selectionStart === null || target.selectionEnd === null)
    return null;
  return { start: target.selectionStart, end: target.selectionEnd };
}

function readContentSelection(target: HTMLElement): ContentBookmark | null {
  const document = target.ownerDocument;
  const selection = document.getSelection?.();
  const textNode = target.firstChild instanceof Text ? target.firstChild : null;
  if (!selection || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0);
  const pointToOffset = (node: Node, offset: number): number | null => {
    if (textNode && node === textNode) return offset;
    if (
      node === target &&
      (offset === 0 || offset === target.childNodes.length)
    )
      return offset === 0 ? 0 : (textNode?.data.length ?? 0);
    return null;
  };
  const start = pointToOffset(range.startContainer, range.startOffset);
  const end = pointToOffset(range.endContainer, range.endOffset);
  if (start === null || end === null) return null;
  return { start, end, node: textNode };
}

function setContentSelection(
  target: HTMLElement,
  bookmark: SelectionBookmark,
): void {
  const document = target.ownerDocument;
  const selection = document.getSelection?.();
  if (!selection) return;
  const textNode = target.firstChild instanceof Text ? target.firstChild : null;
  const node = textNode ?? target;
  const max = textNode?.data.length ?? 0;
  const start = Math.max(0, Math.min(bookmark.start, max));
  const end = Math.max(start, Math.min(bookmark.end, max));
  const range = document.createRange();
  range.setStart(node, textNode ? start : 0);
  range.setEnd(node, textNode ? end : 0);
  selection.removeAllRanges();
  selection.addRange(range);
}

function isReadonly(target: BrailleEditableTarget): boolean {
  if (isInputTarget(target) || isTextAreaTarget(target))
    return target.readOnly || target.disabled;
  return target.getAttribute("contenteditable") === "false";
}

function actionText(
  action: BrailleOutputAction,
): { text: string; inputType: string; data: string | null } | null {
  if (action.kind === "braille")
    return { text: action.char, inputType: "insertText", data: action.char };
  if (action.kind === "text")
    return { text: action.text, inputType: "insertText", data: action.text };
  if (action.kind === "command" && action.command === "lineBreak")
    return { text: "\n", inputType: "insertLineBreak", data: null };
  return null;
}

type EditIntent = { text: string; inputType: string; data: string | null };

type EditPlan = readonly [
  start: number,
  end: number,
  replacement: string,
  inputType: string,
  data: string | null,
];

function createEditPlan(
  value: string,
  selection: SelectionBookmark,
  action: BrailleOutputAction,
  intent: EditIntent | null,
): EditPlan | null {
  let start = selection.start;
  const end = selection.end;
  let replacement = intent?.text ?? "";
  let inputType = intent?.inputType ?? "deleteContentBackward";
  let data = intent?.data ?? null;
  if (
    action.kind === "command" &&
    action.command === "deleteBackward" &&
    start === end
  ) {
    const previous = getPreviousGraphemeStart(value, end);
    if (previous === null) return null;
    start = previous;
    replacement = "";
    inputType = "deleteContentBackward";
    data = null;
  }
  return [start, end, replacement, inputType, data];
}

export interface EditableAttachment extends BrailleAttachment<EditableAdapterOptions> {
  suspend?(): void;
  resume?(): void;
}

interface InternalEditableAdapterOptions extends EditableAdapterOptions {
  readonly __preservePending?: boolean;
}

interface InternalEditableAttachment extends EditableAttachment {
  release(): void;
}

export function attachBrailleEditable(
  controller: BrailleInputController,
  target: BrailleEditableTarget,
  options: EditableAdapterOptions = {},
): EditableAttachment {
  if (!target || typeof target.addEventListener !== "function")
    throw new BrailleInputException(
      "UNSUPPORTED_TARGET",
      "Target is not an editable DOM element.",
    );
  const state = asInternalController(controller).getState();
  if (state["destroyed"])
    throw new BrailleInputException(
      "CONTROLLER_DESTROYED",
      "The controller has been destroyed.",
    );
  const preservePending =
    (options as InternalEditableAdapterOptions).__preservePending === true;
  if (
    !preservePending &&
    (state.pendingDots.length > 0 || state["awaitingRetry"])
  )
    throw new BrailleInputException(
      "INVALID_ACTION",
      "Attach an editable target only when no Cell is pending.",
    );
  const ownerDocument = target.ownerDocument;
  const ownerRealm = ownerDocument.defaultView;
  const kind = targetKind(target);
  const targetStillValid = (): boolean => {
    const document = target.ownerDocument;
    if (
      document !== ownerDocument ||
      document.defaultView != ownerRealm ||
      !target.isConnected
    )
      return false;
    try {
      return targetKind(target) === kind;
    } catch {
      return false;
    }
  };
  if (attachedTargets.has(target))
    throw new BrailleInputException(
      "TARGET_ALREADY_ATTACHED",
      "The target is already attached to a controller.",
    );
  const activation = options.activation ?? "focus";
  if (!(["focus", "manual", "always"] as const).includes(activation))
    throw new BrailleInputException(
      "INVALID_CONFIG",
      "Invalid editable activation mode.",
    );
  const group = getInternalActivationGroup(options.activationGroup);
  if (options.activationGroup && !group)
    throw new BrailleInputException(
      "INVALID_CONFIG",
      "activationGroup must be created by createActivationGroup().",
    );
  const attachmentToken = Symbol("editable-attachment");
  let currentActivation = activation;
  let active = false;
  let detached = false;
  let suspended = false;
  let bookmark: SelectionBookmark | null = null;
  let contentBookmark: ContentBookmark | null = null;
  let groupToken: (() => void) | undefined;
  let groupDestroyDisposer: (() => void) | undefined;
  if (group && target instanceof HTMLElement) groupToken = group.add(target);
  if (group?.isDestroyed())
    throw new BrailleInputException(
      "INVALID_ACTION",
      "The activation group has been destroyed.",
    );
  const focusMatchesActivationScope = (): boolean => {
    const activeElement = ownerDocument.activeElement;
    if (group) return group.isMember(activeElement);
    return activeElement === target || target.contains(activeElement);
  };
  const syncFocusActivation = (): void => {
    if (currentActivation !== "focus") return;
    active = focusMatchesActivationScope();
  };
  active =
    currentActivation === "always" ||
    (currentActivation === "focus" && focusMatchesActivationScope());
  if (group)
    groupDestroyDisposer = group.subscribeDestroyed(() => {
      active = false;
      bookmark = null;
      contentBookmark = null;
    });

  const saveSelection = (): void => {
    if (kind === "contenteditable")
      contentBookmark = readContentSelection(target as HTMLElement);
    else
      bookmark = readControlSelection(
        target as HTMLInputElement | HTMLTextAreaElement,
      );
  };
  const onFocus = (): void => {
    if (group?.isDestroyed()) return;
    if (currentActivation === "focus" || currentActivation === "always")
      active = true;
    saveSelection();
  };
  const onBlur = (): void => {
    saveSelection();
    queueMicrotask(syncFocusActivation);
  };
  const onDocumentFocus = (): void => syncFocusActivation();
  target.addEventListener("focus", onFocus);
  target.addEventListener("blur", onBlur);
  ownerDocument.addEventListener("focusin", onDocumentFocus, true);
  ownerDocument.addEventListener("focusout", onDocumentFocus, true);
  attachedTargets.set(target, { controller, token: attachmentToken });

  const activationSatisfied = (): boolean => {
    if (currentActivation === "manual") return active;
    if (currentActivation === "always") return true;
    const focused = focusMatchesActivationScope();
    active = focused;
    return focused;
  };

  const transactionStillValid = (
    beforeState: BrailleStateSnapshot,
  ): boolean => {
    const attached = attachedTargets.get(target);
    return (
      !detached &&
      !suspended &&
      attached?.controller === controller &&
      attached.token === attachmentToken &&
      targetStillValid() &&
      !isReadonly(target) &&
      activationSatisfied() &&
      controller.getState() === beforeState
    );
  };

  const sink: { write(action: BrailleOutputAction): OutputDelivery } = {
    write(action: BrailleOutputAction): OutputDelivery {
      if (
        detached ||
        suspended ||
        !activationSatisfied() ||
        !targetStillValid() ||
        isReadonly(target)
      )
        return "rejected";
      if (kind === "contenteditable") {
        try {
          validateContentGrammar(target as HTMLElement);
        } catch {
          reportControllerDiagnostic(controller, {
            severity: "error",
            code: "UNSUPPORTED_TARGET",
            message: "The contenteditable grammar is no longer supported.",
          });
          return "rejected";
        }
      }
      const intent = actionText(action);
      if (
        action.kind === "space-intent" ||
        (action.kind === "command" &&
          action.command !== "lineBreak" &&
          action.command !== "deleteBackward")
      )
        return "unhandled";
      if (
        !intent &&
        !(action.kind === "command" && action.command === "deleteBackward")
      )
        return "unhandled";
      if (
        kind !== "textarea" &&
        action.kind === "command" &&
        action.command === "lineBreak"
      )
        return "unhandled";
      if (
        kind === "contenteditable" &&
        action.kind === "command" &&
        action.command === "lineBreak"
      )
        return "unhandled";

      if (kind === "contenteditable") return writeContent(action, intent);
      return writeControl(action, intent);
    },
  };

  function writeControl(
    action: BrailleOutputAction,
    intent: { text: string; inputType: string; data: string | null } | null,
  ): OutputDelivery {
    const control = target as HTMLInputElement | HTMLTextAreaElement;
    const current = readControlSelection(control);
    const selection = current ?? bookmark;
    if (!selection) return "rejected";
    if (current === null && bookmark)
      control.setSelectionRange(bookmark.start, bookmark.end);
    const beforeValue = control.value;
    const beforeSelection = readControlSelection(control);
    if (!beforeSelection) return "rejected";
    const beforeState = controller.getState();
    const beforeMaxLength = control.maxLength;
    const plan = createEditPlan(beforeValue, beforeSelection, action, intent);
    if (!plan) return "unhandled";
    const [start, end, replacement, inputType, data] = plan;
    const nextValue =
      beforeValue.slice(0, start) + replacement + beforeValue.slice(end);
    const maxLength = control.maxLength;
    if (
      maxLength >= 0 &&
      nextValue.length > maxLength &&
      nextValue.length > beforeValue.length
    )
      return "rejected";
    const beforeinput = createInputEvent(
      control,
      "beforeinput",
      inputType,
      data,
      true,
    );
    control.dispatchEvent(beforeinput);
    const afterSelection = readControlSelection(control);
    if (
      control.value !== beforeValue ||
      !selectionEqual(afterSelection, beforeSelection) ||
      control.maxLength !== beforeMaxLength ||
      !transactionStillValid(beforeState)
    )
      return "conflicted";
    if (beforeinput.defaultPrevented) return "rejected";
    try {
      control.setRangeText(replacement, start, end, "end");
    } catch {
      return "rejected";
    }
    const input = createInputEvent(control, "input", inputType, data, false);
    control.dispatchEvent(input);
    saveSelection();
    return "accepted";
  }

  function writeContent(
    action: BrailleOutputAction,
    intent: { text: string; inputType: string; data: string | null } | null,
  ): OutputDelivery {
    const host = target as HTMLElement;
    let textNode: Text | null;
    try {
      textNode = validateContentGrammar(host);
    } catch {
      reportControllerDiagnostic(controller, {
        severity: "error",
        code: "UNSUPPORTED_TARGET",
        message: "The contenteditable grammar is no longer supported.",
      });
      return "rejected";
    }
    const current = readContentSelection(host);
    const stored = contentBookmark;
    const selection = current ?? stored;
    if (!selection) return "rejected";
    if (!current && stored) setContentSelection(host, stored);
    const beforeText = textNode?.data ?? "";
    const beforeSelection = readContentSelection(host) ?? {
      start: selection.start,
      end: selection.end,
      node: textNode,
    };
    const beforeState = controller.getState();
    const plan = createEditPlan(beforeText, beforeSelection, action, intent);
    if (!plan) return "unhandled";
    const [start, end, replacement, inputType, data] = plan;
    const beforeinput = createInputEvent(
      host,
      "beforeinput",
      inputType,
      data,
      true,
    );
    host.dispatchEvent(beforeinput);
    const afterTextNode =
      host.firstChild instanceof Text ? host.firstChild : null;
    const afterSelection = readContentSelection(host);
    let grammarStillSupported = true;
    try {
      validateContentGrammar(host);
    } catch {
      grammarStillSupported = false;
    }
    if (
      afterTextNode !== textNode ||
      (afterTextNode?.data ?? "") !== beforeText ||
      !selectionEqual(afterSelection, beforeSelection) ||
      !grammarStillSupported ||
      !transactionStillValid(beforeState)
    )
      return "conflicted";
    if (beforeinput.defaultPrevented) return "rejected";
    const nextText =
      beforeText.slice(0, start) + replacement + beforeText.slice(end);
    if (nextText.length === 0) {
      host.textContent = "";
    } else if (textNode) {
      textNode.data = nextText;
    } else {
      host.appendChild(host.ownerDocument.createTextNode(nextText));
    }
    setContentSelection(host, {
      start: start + replacement.length,
      end: start + replacement.length,
    });
    host.dispatchEvent(createInputEvent(host, "input", inputType, data, false));
    saveSelection();
    return "accepted";
  }

  const releaseInternal = (cancelPending: boolean): void => {
    if (detached) return;
    detached = true;
    if (cancelPending) {
      try {
        controller.cancelPending();
      } catch {
        // A destroyed controller already has no live pending Cell.
      }
    }
    try {
      controller.clearOutputSink(sink);
    } catch {
      // A destroyed controller already has no live sink.
    }
    target.removeEventListener("focus", onFocus);
    target.removeEventListener("blur", onBlur);
    ownerDocument.removeEventListener("focusin", onDocumentFocus, true);
    ownerDocument.removeEventListener("focusout", onDocumentFocus, true);
    attachedTargets.delete(target);
    groupToken?.();
    groupDestroyDisposer?.();
  };

  const attachment: InternalEditableAttachment = {
    activate(): void {
      if (!detached && !group?.isDestroyed() && currentActivation === "manual")
        active = true;
    },
    deactivate(): void {
      if (!detached && currentActivation === "manual") active = false;
    },
    updateOptions(patch): void {
      if (detached) return;
      if ("activationGroup" in (patch as object))
        throw new BrailleInputException(
          "INVALID_CONFIG",
          "activationGroup is construction-only.",
        );
      if (
        patch.activation !== undefined &&
        !["focus", "manual", "always"].includes(patch.activation)
      )
        throw new BrailleInputException(
          "INVALID_CONFIG",
          "Invalid activation mode.",
        );
      if (patch.activation !== undefined) {
        currentActivation = patch.activation;
        if (currentActivation === "always") active = true;
        else if (currentActivation === "manual") active = false;
        else syncFocusActivation();
      }
    },
    detach(): void {
      releaseInternal(true);
    },
    release(): void {
      releaseInternal(false);
    },
    suspend(): void {
      if (detached || suspended) return;
      suspended = true;
      try {
        controller.clearOutputSink(sink);
      } catch {
        // No-op after controller destruction.
      }
    },
    resume(): void {
      if (detached || !suspended) return;
      if (!targetStillValid()) return;
      suspended = false;
      try {
        controller.setOutputSink(sink);
      } catch {
        suspended = true;
      }
    },
  };

  try {
    controller.setOutputSink(sink);
  } catch (error) {
    target.removeEventListener("focus", onFocus);
    target.removeEventListener("blur", onBlur);
    ownerDocument.removeEventListener("focusin", onDocumentFocus, true);
    ownerDocument.removeEventListener("focusout", onDocumentFocus, true);
    attachedTargets.delete(target);
    groupToken?.();
    throw error;
  }
  saveSelection();
  return attachment;
}

export function isEditableTargetAttached(target: object): boolean {
  return attachedTargets.has(target);
}

export function validateBrailleEditableTarget(
  target: BrailleEditableTarget,
): void {
  targetKind(target);
}
