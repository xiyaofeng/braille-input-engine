import type {
  BrailleInputController,
  BrailleInputDiagnostic,
} from "./types.js";

export interface InternalController {
  __reportDiagnostic(diagnostic: BrailleInputDiagnostic): void;
  __handleActivationLost(reason: "activation-lost" | "hidden"): void;
  __isInTransaction(): boolean;
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
