import type { DefaultMessageKey } from "../ui/default-ui.js";

export const enMessages: Record<DefaultMessageKey, string> = {
  title: "Six-dot Braille input",
  mode: "Mode",
  sequential: "Sequential",
  chord: "Chord",
  dot: "Dot",
  enabled: "Enabled",
  disabled: "Disabled",
  currentDots: "Current dots",
  preview: "Preview",
  commit: "Commit",
  clear: "Clear current cell",
  backspace: "Backspace",
  retry: "Retry",
  discard: "Discard",
  chordTestStart: "Start six-key test",
  chordTestInstruction: "Hold S D F J K L together, then release all keys.",
  chordTestCodes: "Test codes",
  chordNoMapping: "No complete six-key mapping is available.",
  chordSupported: "6-key rollover: Supported",
  chordUnsupported:
    "6-key rollover: Not reliably supported. Recommended mode: Sequential",
  outputRejected: "Output was rejected. Retry or discard the current cell.",
  outputConflicted: "Please check the target, then enter the cell again.",
  doubleWriteRisk:
    "Keyboard capture is disabled; the browser may also receive these keys.",
};

export default enMessages;
