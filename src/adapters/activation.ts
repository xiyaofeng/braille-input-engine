import {
  applyActivationLosses,
  containsFocus,
  retainFocusRoot,
  type ActivationLoss,
} from "./lifecycle.js";
import { BrailleInputException, type ActivationGroup } from "../core/types.js";

interface InternalActivationGroup extends ActivationGroup {
  isDestroyed(): boolean;
  isMember(element: Node | null): boolean;
  subscribeDestroyed(listener: () => ActivationLoss | void): () => void;
}

class ActivationGroupImpl implements InternalActivationGroup {
  private readonly _ownerDocument: Document;
  private readonly counts = new Map<HTMLElement, [number, () => void]>();
  private readonly destroyListeners = new Set<() => ActivationLoss | void>();
  private _destroyed = false;

  constructor(ownerDocument: Document) {
    this._ownerDocument = ownerDocument;
  }

  add(element: HTMLElement): () => void {
    if (this._destroyed)
      throw new BrailleInputException(
        "INVALID_ACTION",
        "The activation group has been destroyed.",
      );
    if (!element || element.ownerDocument !== this._ownerDocument) {
      throw new BrailleInputException(
        "INVALID_CONFIG",
        "Activation group members must belong to the owner document.",
      );
    }
    const entry: [number, () => void] = this.counts.get(element) ?? [
      0,
      retainFocusRoot(element),
    ];
    entry[0]++;
    this.counts.set(element, entry);
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      if (--entry[0] === 0) {
        this.counts.delete(element);
        entry[1]();
      }
    };
  }

  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    for (const entry of this.counts.values()) entry[1]();
    this.counts.clear();
    const listeners = [...this.destroyListeners];
    this.destroyListeners.clear();
    // Deactivate every member before notifying any controller or releasing capture.
    const losses = listeners
      .map((listener) => listener())
      .filter(Boolean) as ActivationLoss[];
    applyActivationLosses(losses);
  }

  isDestroyed(): boolean {
    return this._destroyed;
  }

  isMember(element: Node | null): boolean {
    if (this._destroyed || !element) return false;
    for (const member of this.counts.keys()) {
      if (containsFocus(member, element)) return true;
    }
    return false;
  }

  subscribeDestroyed(listener: () => ActivationLoss | void): () => void {
    if (this._destroyed) {
      listener();
      return () => {};
    }
    this.destroyListeners.add(listener);
    return () => this.destroyListeners.delete(listener);
  }
}

const groups = new WeakMap<object, ActivationGroupImpl>();

export function createActivationGroup(
  ownerDocument: Document,
): ActivationGroup {
  if (!ownerDocument || typeof ownerDocument.addEventListener !== "function") {
    throw new BrailleInputException(
      "INVALID_CONFIG",
      "createActivationGroup requires a Document.",
    );
  }
  const group = new ActivationGroupImpl(ownerDocument);
  groups.set(group, group);
  return group;
}

export function getActivationGroup(
  value: ActivationGroup | undefined,
): ActivationGroup | undefined {
  return value ? groups.get(value) : undefined;
}

export function getInternalActivationGroup(
  value: ActivationGroup | undefined,
): InternalActivationGroup | undefined {
  return value ? groups.get(value) : undefined;
}
