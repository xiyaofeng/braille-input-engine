import type {
  BrailleInputAction,
  BrailleInputStrategy,
  BrailleInputStrategyFactory,
  InputMode,
} from "../types.js";

export function strategyId(strategy: BrailleInputStrategy): InputMode {
  return strategy.id;
}

export function factoryFor(
  strategy: BrailleInputStrategy,
): BrailleInputStrategyFactory {
  return () => strategy;
}

export function isInputAction(action: BrailleInputAction): boolean {
  return Boolean(action && typeof action.type === "string");
}
