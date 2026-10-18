import type {
  BrailleInputController,
  BrailleInputDiagnostic,
  BrailleInputAction,
} from "./types.js";

export type AdapterBatch = readonly [
  inputIds: readonly string[] | null | undefined,
  actions: readonly BrailleInputAction[],
  release?: () => void,
];

export interface InternalController {
  __reportDiagnostic(diagnostic: BrailleInputDiagnostic): void;
  __handleActivationLost(
    reason: "activation-lost" | "hidden",
    inputIds?: readonly string[] | (() => AdapterBatch),
  ): void;
}

export function asInternalController(
  controller: BrailleInputController,
): BrailleInputController & InternalController {
  return controller as BrailleInputController & InternalController;
}

export function reportControllerDiagnostic(
  controller: BrailleInputController,
  diagnostic: BrailleInputDiagnostic,
): void {
  asInternalController(controller).__reportDiagnostic(diagnostic);
}
