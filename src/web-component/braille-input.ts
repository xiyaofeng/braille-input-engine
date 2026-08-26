import { createActivationGroup } from "../adapters/activation.js";
import {
  attachBrailleEditable,
  isEditableTargetAttached,
  validateBrailleEditableTarget,
  type EditableAttachment,
} from "../adapters/editable.js";
import {
  attachKeyboard,
  type KeyboardAttachment,
} from "../adapters/keyboard.js";
import { createBrailleController } from "../core/controller.js";
import { reportControllerDiagnostic } from "../core/internal.js";
import {
  BrailleInputException,
  type BrailleInputController,
  type BrailleInputDiagnostic,
  type BrailleInputStrategyFactory,
} from "../core/types.js";
import { renderDefaultBrailleUI } from "../ui/default-ui.js";

const observedAttributes = [
  "for",
  "input-mode",
  "space-mode",
  "keyboard",
  "numpad",
  "disabled",
  "debug",
] as const;

type InternalEditableAttachment = EditableAttachment & {
  release(): void;
};

function boolEnum(
  element: HTMLElement,
  name: string,
  fallback: boolean,
  report: (diagnostic: BrailleInputDiagnostic) => void,
): boolean {
  const value = element.getAttribute(name);
  if (value === null) return fallback;
  if (value === "on") return true;
  if (value === "off") return false;
  report({
    severity: "warning",
    code: "INVALID_ATTRIBUTE",
    message: `Invalid ${name} attribute; using the default.`,
  });
  return fallback;
}

export class BrailleInputElement extends HTMLElement {
  static get observedAttributes(): readonly string[] {
    return observedAttributes;
  }

  readonly controller: BrailleInputController;
  private readonly group: ReturnType<typeof createActivationGroup>;
  private readonly ui!: ReturnType<typeof renderDefaultBrailleUI>;
  private stateDisposer: (() => void) | undefined;
  private keyboard: KeyboardAttachment | undefined;
  private editable: EditableAttachment | undefined;
  private observer: MutationObserver | undefined;
  private connected = false;
  private requestedTarget: HTMLElement | null = null;
  private resolvedTarget: HTMLElement | null = null;
  private boundTarget: HTMLElement | null = null;
  private appliedFor: string | null = null;
  private appliedInputMode = "sequential";
  private appliedSpaceMode = "braille";
  private bindingSuspended = true;
  private reconnectTarget: HTMLElement | null = null;
  private resolutionQueued = false;
  private desiredEnabled = true;
  private destroyed = false;
  private _eventComposed = true;
  private pendingDiagnostics: BrailleInputDiagnostic[] = [];
  private restoringFor = false;

  constructor() {
    super();
    const document = this.ownerDocument;
    this.group = createActivationGroup(document);
    this.controller = createBrailleController();
    const shadow = this.attachShadow({ mode: "open" });
    this.setupKeyboard();
    this.ui = renderDefaultBrailleUI(
      this.controller,
      this,
      {
        eventComposed: true,
        activationGroup: this.group,
        actionGuard: () => this.ensureBindingLive(),
        ...(this.keyboard ? { keyboardBindings: this.keyboard } : {}),
        shadow: true,
      },
      shadow,
    );
    this.stateDisposer = this.controller.subscribeState((state) => {
      if (
        this.connected &&
        this.bindingSuspended &&
        state.pendingDots.length === 0 &&
        !state["awaitingRetry"]
      )
        this.scheduleTargetResolution();
    });
    for (const diagnostic of this.pendingDiagnostics.splice(0))
      this.report(diagnostic);
  }

  get target(): HTMLElement | null {
    return this.requestedTarget;
  }

  set target(value: HTMLElement | null) {
    this.assertLive();
    if (value !== null && !(value instanceof HTMLElement))
      throw new BrailleInputException(
        "UNSUPPORTED_TARGET",
        "target must be an HTMLElement or null.",
      );
    const state = this.controller.getState();
    if (state.pendingDots.length > 0 || state["awaitingRetry"])
      throw new BrailleInputException(
        "INVALID_ACTION",
        "Discard the current Cell before changing target.",
      );
    if (value !== null) this.validateCandidate(value, true);
    if (!this.connected) {
      this.requestedTarget = value;
      this.resolvedTarget = null;
      return;
    }
    if (value === null) {
      const fallback = this.findForTarget();
      if (fallback) this.validateCandidate(fallback, false);
      this.attachCandidate(fallback);
      this.requestedTarget = null;
      this.resolvedTarget =
        this.boundTarget === fallback && fallback !== null ? fallback : null;
      this.appliedFor = this.getAttribute("for");
      this.observeTargetRoots();
      return;
    }
    this.attachCandidate(value);
    this.requestedTarget = value;
    this.resolvedTarget = this.boundTarget === value ? value : null;
    this.observeTargetRoots();
  }

  get eventComposed(): boolean {
    return this._eventComposed;
  }

  set eventComposed(value: boolean) {
    this._eventComposed = Boolean(value);
    if (!this.destroyed)
      this.ui.updateOptions({ eventComposed: this._eventComposed });
  }

  connectedCallback(): void {
    if (this.destroyed) return;
    this.connected = true;
    this.setAttribute("data-braille-ui-root", "");
    this.setupKeyboard();
    this.ui.updateOptions({ keyboardBindings: this.keyboard });
    this.applyAttributes();
    this.observer = new MutationObserver(() => this.onObservedMutation());
    this.observeTargetRoots();
    this.resolveTarget();
  }

  disconnectedCallback(): void {
    if (!this.connected || this.destroyed) return;
    this.connected = false;
    this.observer?.disconnect();
    this.observer = undefined;
    const preservePending =
      this.controller.getState().inputMode === "sequential";
    this.suspendBinding(!preservePending);
    this.ui.updateOptions({ keyboardBindings: undefined });
    this.keyboard?.detach();
    this.keyboard = undefined;
    this.releaseBoundTarget(preservePending);
  }

  attributeChangedCallback(
    name: string,
    oldValue: string | null,
    newValue: string | null,
  ): void {
    if (oldValue === newValue || this.destroyed) return;
    if (!this.connected) return;
    if (this.restoringFor) return;
    if (name === "for") {
      if (
        this.controller.getState().pendingDots.length > 0 ||
        this.controller.getState()["awaitingRetry"]
      ) {
        if (this.appliedFor === null) this.removeAttribute("for");
        else this.setAttribute("for", this.appliedFor);
        this.report({
          severity: "error",
          code: "INVALID_ACTION",
          message: "The target cannot change while a Cell is pending.",
        });
        return;
      }
      this.resolveTarget();
      return;
    }
    this.applyAttributes();
  }

  registerStrategy(factory: BrailleInputStrategyFactory): () => void {
    this.assertLive();
    return this.controller.registerStrategy(factory);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.connected = false;
    this.observer?.disconnect();
    this.observer = undefined;
    this.keyboard?.detach();
    this.editable?.detach();
    this.stateDisposer?.();
    this.stateDisposer = undefined;
    this.ui.detach();
    this.removeAttribute("data-braille-ui-root");
    this.group.destroy();
    this.controller.destroy();
  }

  private setupKeyboard(): void {
    if (this.keyboard) return;
    try {
      this.keyboard = attachKeyboard(
        this.controller,
        this.shadowRoot as ShadowRoot,
        {
          activation: "always",
          activationGroup: this.group,
          keyboard: boolEnum(this, "keyboard", true, (diagnostic) =>
            this.report(diagnostic),
          ),
          numpad: boolEnum(this, "numpad", true, (diagnostic) =>
            this.report(diagnostic),
          ),
          keyboardFilter: () => this.ensureBindingLive(),
        },
      );
    } catch (error) {
      this.report({
        severity: "error",
        code:
          error instanceof BrailleInputException
            ? error.code
            : "INVALID_CONFIG",
        message: "Keyboard adapter could not be attached.",
      });
    }
  }

  private applyAttributes(): void {
    if (!this.connected) return;
    const keyboard = boolEnum(this, "keyboard", true, (diagnostic) =>
      this.report(diagnostic),
    );
    const numpad = boolEnum(this, "numpad", true, (diagnostic) =>
      this.report(diagnostic),
    );
    const debug = boolEnum(this, "debug", false, (diagnostic) =>
      this.report(diagnostic),
    );
    const disabled = this.hasAttribute("disabled");
    this.desiredEnabled = !disabled;
    const inputMode = this.getAttribute("input-mode") ?? "sequential";
    const spaceMode = this.getAttribute("space-mode") ?? "braille";
    try {
      this.controller.updateOptions({
        inputMode: inputMode as "sequential" | "chord",
        spaceMode: spaceMode as "braille" | "ascii" | "event",
      });
      this.appliedInputMode = inputMode;
      this.appliedSpaceMode = spaceMode;
    } catch (error) {
      if (this.getAttribute("input-mode") !== this.appliedInputMode)
        this.setAttribute("input-mode", this.appliedInputMode);
      if (this.getAttribute("space-mode") !== this.appliedSpaceMode)
        this.setAttribute("space-mode", this.appliedSpaceMode);
      this.report({
        severity: "error",
        code:
          error instanceof BrailleInputException
            ? error.code
            : "INVALID_ATTRIBUTE",
        message:
          "Invalid controller attribute; the previous value was restored.",
      });
    }
    try {
      this.keyboard?.updateOptions({ keyboard, numpad });
    } catch (error) {
      this.report({
        severity: "error",
        code:
          error instanceof BrailleInputException
            ? error.code
            : "INVALID_CONFIG",
        message: "Invalid keyboard attribute.",
      });
    }
    this.ui.updateOptions({ debug });
    if (disabled) this.controller.disable();
    else if (!this.bindingSuspended) this.controller.enable();
  }

  private findForTarget(): HTMLElement | null {
    const id = this.getAttribute("for");
    if (!id) return null;
    const root = this.getRootNode();
    if (root instanceof Document) return root.getElementById(id);
    if (root instanceof ShadowRoot) {
      return (
        [...root.querySelectorAll<HTMLElement>("[id]")].find(
          (element) => element.id === id,
        ) ?? null
      );
    }
    return this.ownerDocument.getElementById(id);
  }

  private validateCandidate(
    target: HTMLElement,
    propertyTarget: boolean,
  ): void {
    if (target.ownerDocument !== this.ownerDocument)
      throw new BrailleInputException(
        "UNSUPPORTED_TARGET",
        "The target must belong to the same document.",
      );
    if (!propertyTarget) {
      const root = this.getRootNode();
      if (root instanceof ShadowRoot && !root.contains(target))
        throw new BrailleInputException(
          "UNSUPPORTED_TARGET",
          "The target must belong to the same root.",
        );
    }
    validateBrailleEditableTarget(target);
    if (isEditableTargetAttached(target) && target !== this.boundTarget)
      throw new BrailleInputException(
        "TARGET_ALREADY_ATTACHED",
        "The target is already attached to another controller.",
      );
  }

  private attachCandidate(
    target: HTMLElement | null,
    allowPending = false,
  ): void {
    const state = this.controller.getState();
    const hasPending = state.pendingDots.length > 0 || state["awaitingRetry"];
    if (target && !target.isConnected) {
      const preservePending = state.inputMode === "sequential" && hasPending;
      this.suspendBinding(!preservePending);
      this.releaseBoundTarget(preservePending);
      return;
    }
    if (hasPending) {
      if (target === this.boundTarget) {
        this.resumeBinding();
        return;
      }
      if (!allowPending && target !== this.reconnectTarget)
        throw new BrailleInputException(
          "INVALID_ACTION",
          "The target is frozen until the current Cell is discarded.",
        );
      allowPending = true;
    }
    if (target === this.boundTarget && this.editable) {
      this.resumeBinding();
      return;
    }
    const previousEditable = this.editable;
    const previousTarget = this.boundTarget;
    this.suspendBinding();
    if (!target || !target.isConnected) {
      this.releaseBoundTarget(hasPending);
      return;
    }
    try {
      const next = attachBrailleEditable(this.controller, target, {
        activation: "focus",
        activationGroup: this.group,
        ...(allowPending ? { __preservePending: true } : {}),
      } as Parameters<typeof attachBrailleEditable>[2]);
      previousEditable?.detach();
      this.editable = next;
      this.boundTarget = target;
      this.reconnectTarget = null;
      this.bindingSuspended = false;
      if (this.desiredEnabled) this.controller.enable();
      this.keyboard?.activate();
    } catch (error) {
      if (previousEditable && previousTarget) {
        previousEditable.resume?.();
        this.editable = previousEditable;
        this.boundTarget = previousTarget;
        this.bindingSuspended = false;
        if (this.desiredEnabled) this.controller.enable();
        this.keyboard?.activate();
      } else {
        this.editable = undefined;
        this.boundTarget = null;
        this.bindingSuspended = true;
        this.controller.disable();
      }
      throw error;
    }
  }

  private resolveTarget(): void {
    if (!this.connected || this.destroyed) return;
    this.releaseStaleBinding();
    const target = this.requestedTarget ?? this.findForTarget();
    const propertyTarget = this.requestedTarget !== null;
    const state = this.controller.getState();
    const hasPending = state.pendingDots.length > 0 || state["awaitingRetry"];
    if (
      hasPending &&
      target !== this.boundTarget &&
      !(target && target === this.reconnectTarget && target.isConnected)
    ) {
      if (this.boundTarget) {
        this.suspendBinding(state.inputMode !== "sequential");
        this.releaseBoundTarget(state.inputMode === "sequential");
      }
      this.resolvedTarget = null;
      this.bindingSuspended = true;
      this.observeTargetRoots();
      return;
    }
    try {
      if (target) this.validateCandidate(target, propertyTarget);
      this.attachCandidate(
        target,
        hasPending && target === this.reconnectTarget,
      );
      this.resolvedTarget =
        this.boundTarget === target && target !== null ? target : null;
      this.appliedFor = this.getAttribute("for");
      this.observeTargetRoots();
    } catch (error) {
      if (!propertyTarget && this.getAttribute("for") !== this.appliedFor) {
        this.restoringFor = true;
        try {
          if (this.appliedFor === null) this.removeAttribute("for");
          else this.setAttribute("for", this.appliedFor);
        } finally {
          this.restoringFor = false;
        }
      }
      this.report({
        severity: "error",
        code:
          error instanceof BrailleInputException
            ? error.code
            : "UNSUPPORTED_TARGET",
        message: "The target could not be attached.",
      });
    }
  }

  private suspendBinding(cancelPending = false): void {
    this.bindingSuspended = true;
    this.keyboard?.deactivate();
    this.editable?.suspend?.();
    this.controller.disable({ cancelPending });
  }

  private releaseBoundTarget(preservePending: boolean): void {
    const previousTarget = this.boundTarget;
    if (preservePending && previousTarget)
      this.reconnectTarget = previousTarget;
    else if (!preservePending) this.reconnectTarget = null;
    const previousEditable = this.editable as
      InternalEditableAttachment | undefined;
    this.editable = undefined;
    this.boundTarget = null;
    this.resolvedTarget = null;
    this.bindingSuspended = true;
    if (previousEditable) {
      if (typeof previousEditable.release === "function")
        previousEditable.release();
      else previousEditable.detach();
    }
  }

  private releaseStaleBinding(): void {
    if (!this.boundTarget || this.isBoundTargetValid()) return;
    const state = this.controller.getState();
    const preservePending =
      state.inputMode === "sequential" &&
      (state.pendingDots.length > 0 || state["awaitingRetry"]);
    this.suspendBinding(!preservePending);
    this.releaseBoundTarget(preservePending);
  }

  private isBoundTargetValid(): boolean {
    const target = this.boundTarget;
    const currentTarget = this.requestedTarget ?? this.findForTarget();
    if (
      !target ||
      !this.editable ||
      currentTarget !== target ||
      target.ownerDocument !== this.ownerDocument ||
      target.isConnected !== true ||
      !isEditableTargetAttached(target)
    )
      return false;
    try {
      validateBrailleEditableTarget(target);
      return true;
    } catch {
      return false;
    }
  }

  private ensureBindingLive(): boolean {
    if (
      !this.connected ||
      this.destroyed ||
      this.bindingSuspended ||
      !this.desiredEnabled
    )
      return false;
    if (this.isBoundTargetValid()) return true;
    const state = this.controller.getState();
    const preservePending =
      state.inputMode === "sequential" &&
      (state.pendingDots.length > 0 || state["awaitingRetry"]);
    this.suspendBinding(!preservePending);
    this.releaseBoundTarget(preservePending);
    this.observeTargetRoots();
    return false;
  }

  private onObservedMutation(): void {
    if (!this.connected || this.destroyed) return;
    this.releaseStaleBinding();
    this.scheduleTargetResolution();
  }

  private scheduleTargetResolution(): void {
    if (!this.connected || this.destroyed || this.resolutionQueued) return;
    this.resolutionQueued = true;
    queueMicrotask(() => {
      this.resolutionQueued = false;
      if (this.connected && !this.destroyed) this.resolveTarget();
    });
  }

  private observeTargetRoots(): void {
    if (!this.observer) return;
    this.observer.disconnect();
    const roots = new Set<Node>();
    const resolutionRoot = this.getRootNode();
    roots.add(
      resolutionRoot instanceof Document ||
        resolutionRoot instanceof ShadowRoot ||
        resolutionRoot instanceof DocumentFragment
        ? resolutionRoot
        : this.ownerDocument,
    );
    if (this.requestedTarget) {
      roots.add(this.ownerDocument);
      roots.add(this.requestedTarget.getRootNode());
    }
    const options: MutationObserverInit = {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        "id",
        "contenteditable",
        "disabled",
        "readonly",
        "type",
      ],
    };
    for (const root of roots) {
      if (
        root instanceof Document ||
        root instanceof DocumentFragment ||
        root instanceof Element
      )
        this.observer.observe(root, options);
    }
  }

  private resumeBinding(): void {
    if (!this.editable || !this.boundTarget || !this.boundTarget.isConnected)
      return;
    this.editable.resume?.();
    if (this.editable) {
      this.bindingSuspended = false;
      if (this.desiredEnabled) this.controller.enable();
      this.keyboard?.activate();
    }
  }

  private report(diagnostic: BrailleInputDiagnostic): void {
    if (this.ui) reportControllerDiagnostic(this.controller, diagnostic);
    else this.pendingDiagnostics.push(diagnostic);
  }

  private assertLive(): void {
    if (this.destroyed)
      throw new BrailleInputException(
        "CONTROLLER_DESTROYED",
        "The Web Component has been destroyed.",
      );
  }
}

export function defineBrailleInput(
  tagName = "braille-input",
): typeof BrailleInputElement {
  if (typeof customElements === "undefined")
    throw new Error("braille-input is browser-only.");
  const existing = customElements.get(tagName);
  if (existing) {
    if (
      existing !== BrailleInputElement &&
      !(existing.prototype instanceof BrailleInputElement)
    )
      throw new Error(
        `Custom element ${tagName} is already defined by another constructor.`,
      );
    return existing as typeof BrailleInputElement;
  }
  const constructor =
    tagName === "braille-input"
      ? BrailleInputElement
      : class extends BrailleInputElement {};
  customElements.define(tagName, constructor);
  return constructor;
}
