import { describe, expect, it } from "vitest";
import { createBrailleController } from "../../src/core/controller.js";

describe("Chord strategy model", () => {
  it("waits for all keys to release and commits one union", () => {
    const outputs: string[] = [];
    const controller = createBrailleController({
      inputMode: "chord",
      onOutput: (action) =>
        action.kind === "braille" && outputs.push(action.char),
    });
    controller.dispatch({
      type: "dot-down",
      dot: 1,
      inputId: "keyboard:1:KeyF",
      source: "keyboard",
    });
    controller.dispatch({
      type: "dot-down",
      dot: 2,
      inputId: "keyboard:1:KeyD",
      source: "keyboard",
    });
    controller.dispatch({
      type: "dot-up",
      dot: 1,
      inputId: "keyboard:1:KeyF",
      source: "keyboard",
    });
    expect(outputs).toEqual([]);
    controller.dispatch({
      type: "dot-up",
      dot: 2,
      inputId: "keyboard:1:KeyD",
      source: "keyboard",
    });
    expect(outputs).toEqual(["⠃"]);
    expect(controller.getState().chordInProgress).toBe(false);
    controller.destroy();
  });

  it("cancels a chord on input-cancel", () => {
    const outputs: string[] = [];
    const controller = createBrailleController({
      inputMode: "chord",
      onOutput: (action) =>
        action.kind === "braille" && outputs.push(action.char),
    });
    controller.dispatch({
      type: "dot-down",
      dot: 1,
      inputId: "pointer:1:2:dot:1",
      source: "pointer",
    });
    controller.dispatch({
      type: "input-cancel",
      inputId: "pointer:1:2:dot:1",
      source: "pointer",
    });
    expect(outputs).toEqual([]);
    expect(controller.getState().pendingDots).toEqual([]);
    controller.destroy();
  });

  it("passes idle deleteBackward to the output sink", () => {
    const commands: string[] = [];
    const controller = createBrailleController({
      inputMode: "chord",
      outputSink: {
        write: (action) => {
          if (action.kind === "command") commands.push(action.command);
          return "accepted";
        },
      },
    });
    controller.dispatch({
      type: "command",
      command: "deleteBackward",
      source: "api",
    });
    expect(commands).toEqual(["deleteBackward"]);
    controller.destroy();
  });

  it("ignores deleteBackward while a chord is in progress", () => {
    const commands: string[] = [];
    const controller = createBrailleController({
      inputMode: "chord",
      outputSink: {
        write: (action) => {
          if (action.kind === "command") commands.push(action.command);
          return "accepted";
        },
      },
    });
    controller.dispatch({
      type: "dot-down",
      dot: 1,
      inputId: "chord-delete:1",
      source: "api",
    });
    controller.dispatch({
      type: "command",
      command: "deleteBackward",
      source: "api",
    });
    expect(commands).toEqual([]);
    expect(controller.getState().pendingDots).toEqual([1]);
    controller.dispatch({
      type: "input-cancel",
      inputId: "chord-delete:1",
      source: "api",
    });
    controller.destroy();
  });
});
