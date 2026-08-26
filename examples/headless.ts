import { createBrailleController } from "../src/core/controller.js";

const outputs: string[] = [];
const controller = createBrailleController({
  onOutput(action, delivery) {
    if (delivery === "unhandled" && action.kind === "braille")
      outputs.push(action.char);
  },
});

for (const [dot, inputId] of [
  [4, "example:4"],
  [1, "example:1"],
  [2, "example:2"],
] as const) {
  controller.dispatch({
    type: "dot-down",
    dot: dot as 1 | 2 | 3 | 4 | 5 | 6,
    inputId,
    source: "api",
  });
  controller.dispatch({
    type: "dot-up",
    dot: dot as 1 | 2 | 3 | 4 | 5 | 6,
    inputId,
    source: "api",
  });
}
controller.commitPending();
console.log(outputs.join(""));
controller.destroy();
