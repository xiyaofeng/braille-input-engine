import type { DefaultMessageKey } from "../ui/default-ui.js";

export const zhCNMessages: Record<DefaultMessageKey, string> = {
  title: "六点盲文输入",
  mode: "模式",
  sequential: "Sequential",
  chord: "Chord",
  dot: "点",
  enabled: "已启用",
  disabled: "已禁用",
  currentDots: "当前点位",
  preview: "预览",
  commit: "确认",
  clear: "清除当前 Cell",
  backspace: "退格",
  retry: "重试",
  discard: "放弃",
  chordTestStart: "开始六键测试",
  chordTestInstruction: "请同时按住 S D F J K L，然后全部释放。",
  chordTestCodes: "测试按键",
  chordNoMapping: "没有可用的完整六键映射。",
  chordSupported: "六键 rollover：支持",
  chordUnsupported: "六键 rollover：无法可靠支持。建议使用 Sequential",
  outputRejected: "输出被拒绝。可以重试或放弃当前 Cell。",
  outputConflicted: "请检查目标，然后重新输入该 Cell。",
  doubleWriteRisk: "键盘捕获已关闭；浏览器可能同时接收这些按键。",
};

export default zhCNMessages;
