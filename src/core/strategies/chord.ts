import type {
  BrailleInputAction,
  BrailleInputStrategy,
  StrategyContext,
  StrategyLifecycleContext,
  StrategyResetContext,
  StrategyResetReason,
} from "../types.js";

export class ChordStrategy implements BrailleInputStrategy {
  readonly id = "chord" as const;

  activate(_context: StrategyLifecycleContext): void {}

  deactivate(
    _reason: "mode-switch" | "destroy",
    _context: StrategyLifecycleContext,
  ): void {}

  reset(_reason: StrategyResetReason, _context: StrategyResetContext): void {}

  destroy(_context: StrategyLifecycleContext): void {}

  handle(action: BrailleInputAction, context: StrategyContext): void {
    switch (action.type) {
      case "dot-down": {
        const entries = [...context.getPendingContributions()];
        if (!entries.some((entry) => entry.id === action.inputId)) {
          entries.push({
            id: action.inputId,
            dot: action.dot,
            source: action.source,
          });
          context.setPendingContributions(entries);
        }
        break;
      }
      case "dot-up":
        if (
          context.getState().pressedInputIds.length === 0 &&
          context.getPendingContributions().length > 0
        ) {
          context.requestCommit(action.source);
        }
        break;
      case "input-cancel":
        // A cancelled pointer/key ends the current chord without committing it.
        context.setPendingContributions([]);
        break;
      case "space-request":
        if (context.getState().chordInProgress) return;
        if (context.getPendingContributions().length > 0)
          context.requestCommit(action.source);
        else context.requestSpace(action.source);
        break;
      case "commit-request":
        if (
          !context.getState().chordInProgress &&
          context.getPendingContributions().length > 0
        ) {
          context.requestCommit(action.source);
        }
        break;
      case "command":
        if (action.command === "cancelPending") {
          context.setPendingContributions([]);
        } else if (!context.getState().chordInProgress) {
          context.requestCommand(action.command, action.source);
        }
        break;
    }
  }
}

export function createChordStrategy(): BrailleInputStrategy {
  return new ChordStrategy();
}
