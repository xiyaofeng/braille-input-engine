import { describe, expect, it } from "vitest";
import { ChordStrategy } from "../../src/core/strategies/chord.js";
import {
  SequentialStrategy,
  createSequentialStrategy,
} from "../../src/core/strategies/sequential.js";
import {
  factoryFor,
  isInputAction,
  strategyId,
} from "../../src/core/strategies/strategy.js";
import { extensionId, type StrategyContext } from "../../src/core/types.js";

function contextFor(
  mode: "sequential" | "chord",
  pending: Array<{ id: string; dot: 1 | 2 | 3 | 4 | 5 | 6; source: "api" }>,
  pressedInputIds: string[] = [],
  toggleDots = true,
) {
  const requests: string[] = [];
  const context = {
    __toggleDots: toggleDots,
    getState: () => ({
      inputMode: mode,
      pendingDots: pending.map((entry) => entry.dot),
      pendingSources: ["api"],
      previewChar: null,
      pressedInputIds,
      chordInProgress: mode === "chord" && pressedInputIds.length > 0,
      awaitingRetry: false,
      outputSinkState: "empty",
      enabled: true,
      destroyed: false,
    }),
    reportDiagnostic: () => {},
    getPendingContributions: () => pending,
    setPendingContributions: (entries: typeof pending) => {
      pending.splice(0, pending.length, ...entries);
      requests.push("set");
    },
    requestCommit: (source: string) => requests.push(`commit:${source}`),
    requestSpace: (source: string) => requests.push(`space:${source}`),
    requestCommand: (command: string, source: string) =>
      requests.push(`command:${command}:${source}`),
  } as unknown as StrategyContext & { __toggleDots: boolean };
  return { context, requests, pending };
}

describe("strategy branch contract", () => {
  it("covers Sequential toggles, commits, spaces, commands, and no-op releases", () => {
    const strategy = new SequentialStrategy();
    const first = contextFor("sequential", []);
    strategy.handle(
      { type: "dot-down", dot: 1, inputId: "one", source: "api" },
      first.context,
    );
    expect(first.pending).toHaveLength(1);

    const duplicate = contextFor("sequential", [
      { id: "one", dot: 1, source: "api" },
    ]);
    strategy.handle(
      { type: "dot-down", dot: 1, inputId: "again", source: "api" },
      duplicate.context,
    );
    expect(duplicate.pending).toEqual([]);

    const nonToggle = contextFor(
      "sequential",
      [{ id: "one", dot: 1, source: "api" }],
      [],
      false,
    );
    strategy.handle(
      { type: "dot-down", dot: 1, inputId: "again", source: "api" },
      nonToggle.context,
    );
    expect(nonToggle.pending).toHaveLength(1);

    const commit = contextFor("sequential", [
      { id: "one", dot: 1, source: "api" },
    ]);
    strategy.handle({ type: "commit-request", source: "api" }, commit.context);
    strategy.handle({ type: "space-request", source: "api" }, commit.context);
    expect(commit.requests).toEqual(["commit:api", "commit:api"]);

    const emptySpace = contextFor("sequential", []);
    strategy.handle(
      { type: "space-request", source: "api" },
      emptySpace.context,
    );
    strategy.handle(
      { type: "commit-request", source: "api" },
      emptySpace.context,
    );
    expect(emptySpace.requests).toEqual(["space:api"]);

    const deletePending = contextFor("sequential", [
      { id: "one", dot: 1, source: "api" },
      { id: "two", dot: 2, source: "api" },
    ]);
    strategy.handle(
      { type: "command", command: "deleteBackward", source: "api" },
      deletePending.context,
    );
    expect(deletePending.pending).toEqual([
      { id: "one", dot: 1, source: "api" },
    ]);

    const deleteEmpty = contextFor("sequential", []);
    strategy.handle(
      { type: "command", command: "deleteBackward", source: "api" },
      deleteEmpty.context,
    );
    strategy.handle(
      { type: "command", command: "cancelPending", source: "api" },
      deleteEmpty.context,
    );
    strategy.handle(
      { type: "command", command: extensionId("test:editor"), source: "api" },
      deleteEmpty.context,
    );
    strategy.handle(
      { type: "dot-up", dot: 1, inputId: "one", source: "api" },
      deleteEmpty.context,
    );
    strategy.handle(
      { type: "input-cancel", inputId: "one", source: "api" },
      deleteEmpty.context,
    );
    const defaultToggle = contextFor("sequential", [
      { id: "one", dot: 1, source: "api" },
    ]);
    delete (defaultToggle.context as { __toggleDots?: boolean }).__toggleDots;
    strategy.handle(
      { type: "dot-down", dot: 1, inputId: "again", source: "api" },
      defaultToggle.context,
    );
    expect(deleteEmpty.requests).toEqual([
      "command:deleteBackward:api",
      "command:test:editor:api",
    ]);
    expect(strategyId(strategy)).toBe("sequential");
    expect(createSequentialStrategy().id).toBe("sequential");
  });

  it("covers Chord release, cancel, space, commit, and command branches", () => {
    const strategy = new ChordStrategy();
    const add = contextFor("chord", []);
    strategy.handle(
      { type: "dot-down", dot: 1, inputId: "one", source: "api" },
      add.context,
    );
    strategy.handle(
      { type: "dot-down", dot: 1, inputId: "one", source: "api" },
      add.context,
    );
    expect(add.pending).toHaveLength(1);

    const release = contextFor("chord", [{ id: "one", dot: 1, source: "api" }]);
    strategy.handle(
      { type: "dot-up", dot: 1, inputId: "one", source: "api" },
      release.context,
    );
    expect(release.requests).toEqual(["commit:api"]);
    const held = contextFor(
      "chord",
      [{ id: "one", dot: 1, source: "api" }],
      ["one"],
    );
    strategy.handle(
      { type: "dot-up", dot: 1, inputId: "one", source: "api" },
      held.context,
    );
    expect(held.requests).toEqual([]);

    const cancelled = contextFor("chord", [
      { id: "one", dot: 1, source: "api" },
    ]);
    strategy.handle(
      { type: "input-cancel", inputId: "one", source: "api" },
      cancelled.context,
    );
    expect(cancelled.pending).toEqual([]);

    const busySpace = contextFor(
      "chord",
      [{ id: "one", dot: 1, source: "api" }],
      ["one"],
    );
    strategy.handle(
      { type: "space-request", source: "api" },
      busySpace.context,
    );
    expect(busySpace.requests).toEqual([]);
    const pendingSpace = contextFor("chord", [
      { id: "one", dot: 1, source: "api" },
    ]);
    strategy.handle(
      { type: "space-request", source: "api" },
      pendingSpace.context,
    );
    const blankSpace = contextFor("chord", []);
    strategy.handle(
      { type: "space-request", source: "api" },
      blankSpace.context,
    );
    expect(pendingSpace.requests).toEqual(["commit:api"]);
    expect(blankSpace.requests).toEqual(["space:api"]);

    const commitBusy = contextFor(
      "chord",
      [{ id: "one", dot: 1, source: "api" }],
      ["one"],
    );
    strategy.handle(
      { type: "commit-request", source: "api" },
      commitBusy.context,
    );
    const commitPending = contextFor("chord", [
      { id: "one", dot: 1, source: "api" },
    ]);
    strategy.handle(
      { type: "commit-request", source: "api" },
      commitPending.context,
    );
    const commitEmpty = contextFor("chord", []);
    strategy.handle(
      { type: "commit-request", source: "api" },
      commitEmpty.context,
    );
    expect(commitPending.requests).toEqual(["commit:api"]);
    expect(commitEmpty.requests).toEqual([]);

    const commands = contextFor("chord", []);
    strategy.handle(
      { type: "command", command: "cancelPending", source: "api" },
      commands.context,
    );
    strategy.handle(
      { type: "command", command: "deleteBackward", source: "api" },
      commands.context,
    );
    strategy.handle(
      { type: "command", command: extensionId("test:editor"), source: "api" },
      commands.context,
    );
    expect(commands.requests).toEqual([
      "set",
      "command:deleteBackward:api",
      "command:test:editor:api",
    ]);
    const busyCommand = contextFor(
      "chord",
      [{ id: "one", dot: 1, source: "api" }],
      ["one"],
    );
    strategy.handle(
      { type: "command", command: "deleteBackward", source: "api" },
      busyCommand.context,
    );
    strategy.handle(
      { type: "command", command: extensionId("test:editor"), source: "api" },
      busyCommand.context,
    );
    expect(busyCommand.requests).toEqual([]);
  });

  it("covers strategy helper predicates and lifecycle no-ops", () => {
    const strategy = new ChordStrategy();
    const context = contextFor("chord", []).context;
    strategy.activate(context);
    strategy.deactivate("mode-switch", context);
    strategy.reset("cancel-pending", context);
    strategy.destroy(context);
    expect(isInputAction({ type: "dot-up" } as never)).toBe(true);
    expect(isInputAction(null as never)).toBe(false);
    expect(isInputAction({ type: 1 } as never)).toBe(false);
    expect(factoryFor(strategy)()).toBe(strategy);
  });
});
