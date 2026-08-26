import type {
  BrailleInputAction,
  BrailleInputStrategy,
  EditorCommand,
  PendingDotContribution,
  StrategyContext,
  StrategyLifecycleContext,
  StrategyResetContext,
  StrategyResetReason,
} from "../types.js";

function byOrdinal(
  entries: readonly PendingDotContribution[],
): PendingDotContribution[] {
  return [...entries];
}

export class SequentialStrategy implements BrailleInputStrategy {
  readonly id = "sequential" as const;

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
        const entries = byOrdinal(context.getPendingContributions());
        const index = entries.findIndex((entry) => entry.dot === action.dot);
        if (index >= 0) {
          if (getToggleDots(context)) entries.splice(index, 1);
        } else {
          entries.push({
            id: action.inputId,
            dot: action.dot,
            source: action.source,
          });
        }
        context.setPendingContributions(entries);
        break;
      }
      case "commit-request":
        if (context.getPendingContributions().length > 0)
          context.requestCommit(action.source);
        break;
      case "space-request":
        if (context.getPendingContributions().length > 0)
          context.requestCommit(action.source);
        else context.requestSpace(action.source);
        break;
      case "command":
        if (action.command === "deleteBackward") {
          const entries = byOrdinal(context.getPendingContributions());
          if (entries.length > 0) {
            entries.pop();
            context.setPendingContributions(entries);
          } else {
            context.requestCommand(action.command, action.source);
          }
        } else if (action.command !== "cancelPending") {
          context.requestCommand(
            action.command as EditorCommand,
            action.source,
          );
        }
        break;
      case "dot-up":
      case "input-cancel":
        break;
    }
  }
}

// StrategyContext deliberately stays small and DOM-independent. The controller
// supplies this non-public capability without exposing a second public option.
function getToggleDots(context: StrategyContext): boolean {
  return Boolean(
    (context as StrategyContext & { readonly __toggleDots?: boolean })
      .__toggleDots ?? true,
  );
}

export function createSequentialStrategy(): BrailleInputStrategy {
  return new SequentialStrategy();
}
