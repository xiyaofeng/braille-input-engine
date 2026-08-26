import { BrailleInputException, type ActivationGroup } from "../core/types.js";

interface InternalActivationGroup extends ActivationGroup {
  isDestroyed(): boolean;
  isMember(element: Node | null): boolean;
  subscribeDestroyed(listener: () => void): () => void;
}

class ActivationGroupImpl implements InternalActivationGroup {
  private readonly _ownerDocument: Document;
  private readonly counts = new Map<HTMLElement, number>();
  private readonly destroyListeners = new Set<() => void>();
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
    this.counts.set(element, (this.counts.get(element) ?? 0) + 1);
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      const count = this.counts.get(element) ?? 0;
      if (count <= 1) this.counts.delete(element);
      else this.counts.set(element, count - 1);
    };
  }

  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    this.counts.clear();
    const listeners = [...this.destroyListeners];
    this.destroyListeners.clear();
    for (const listener of listeners) listener();
  }

  isDestroyed(): boolean {
    return this._destroyed;
  }

  isMember(element: Node | null): boolean {
    if (this._destroyed || !element) return false;
    for (const member of this.counts.keys()) {
      if (member === element || member.contains(element)) return true;
    }
    return false;
  }

  subscribeDestroyed(listener: () => void): () => void {
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
