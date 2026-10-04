import "./demo.css";
import "../src/ui/default-ui.css";

import {
  attachBrailleEditable,
  attachKeyboard,
  createDefaultBrailleUI,
  createBrailleController,
} from "../src/entries/browser.js";

const output = document.querySelector<HTMLTextAreaElement>("#demo-output");
const host = document.querySelector<HTMLElement>("#braille-ui");
if (!output || !host) throw new Error("Demo fixture is incomplete.");

const controller = createBrailleController();
// The demo has one fixed output target, so its controls must be able to commit
// after taking focus away from the textarea.
const editable = attachBrailleEditable(controller, output, {
  activation: "always",
});
const keyboard = attachKeyboard(controller, document, { activation: "always" });
const ui = createDefaultBrailleUI(controller, host, {
  lang: "zh-CN",
  debug: true,
  keyboardBindings: keyboard,
});

window.addEventListener("beforeunload", () => {
  ui.detach();
  keyboard.detach();
  editable.detach();
  controller.destroy();
});
