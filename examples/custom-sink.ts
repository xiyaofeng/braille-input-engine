import { createBrailleController } from "../src/core/controller.js";

const editor = {
  insertText(text: string) {
    console.log("insert", text);
  },
};

const controller = createBrailleController({
  outputSink: {
    write(action) {
      if (action.kind === "braille") editor.insertText(action.char);
      if (action.kind === "text") editor.insertText(action.text);
      return "accepted";
    },
  },
});

controller.dispatch({
  type: "dot-down",
  dot: 1,
  inputId: "example:1",
  source: "api",
});
controller.dispatch({
  type: "dot-up",
  dot: 1,
  inputId: "example:1",
  source: "api",
});
controller.commitPending();
controller.destroy();
