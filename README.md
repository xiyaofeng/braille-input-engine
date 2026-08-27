# Braille Input Engine

[简体中文](README.md) | [English](README.en.md)

面向现代浏览器的无头六点盲文输入引擎。核心接收规范化的输入动作，维护一个待提交的 Cell，并输出 Unicode 盲文模式 `U+2800–U+283F`。它不会翻译英语、中文、数字、数学、音乐或其他盲文记谱法。

这是一个实验性、由社区支持、尽力而为的项目，不提供 SLA。常规分发方式是公开 GitHub 源码和可选的 GitHub Release 资产；该包有意保持私有，不用于发布到 registry。

## 快速开始

```sh
npm ci
npm run build
```

```ts
import {
  attachBrailleEditable,
  attachKeyboard,
  createBrailleController,
} from "braille-input-engine/browser";

const target = document.querySelector("textarea");
if (!target) throw new Error("Missing textarea");

const controller = createBrailleController({
  spaceMode: "ascii",
});
const editable = attachBrailleEditable(controller, target);
const keyboard = attachKeyboard(controller, target, { activation: "focus" });

// 宿主完成使用后，请解除两个附着并销毁控制器。
void editable;
void keyboard;
```

默认键盘映射使用物理 `KeyboardEvent.code` 值 `F D S J K L` 对应点 1–6。项目特定的 Numpad 映射为 `Numpad7/4/1 + Numpad8/5/2`；这里不把它称为行业标准。顺序模式是默认模式，重复选择可切换某个点。空格提交待处理的 Cell，否则按 `spaceMode` 行为；只有在存在待处理 Cell 时，`NumpadEnter` 才会提交。

对于 React、ProseMirror 或 CodeMirror 等编辑器，请使用一个同步的 `outputSink` 及其官方编辑 API，而不是原生可编辑适配器。sink 是控制器唯一的事务性写入器。`accepted`、`rejected`、`unhandled` 和 `conflicted` 具有不同的重试语义；请参阅 `SPECIFICATION.md` 第 14–16 节。

## 浏览器入口

- `braille-input-engine` / `braille-input-engine/core`：SSR 安全的核心和 Unicode 编码器。
- `braille-input-engine/browser`：浏览器适配器、默认 UI 和 Web Component。
- `braille-input-engine/adapters`：键盘、指针、可编辑目标和激活组适配器。
- `braille-input-engine/default-ui`：light DOM 默认 UI，以及 CSS 入口 `braille-input-engine/default-ui.css`。
- `braille-input-engine/web-component`：`<braille-input>` 类和显式的 `defineBrailleInput()`。
- `braille-input-engine/auto-register`：唯一会自动注册自定义元素的入口。

Web Component 可以通过 `for="id"` 指向同一根节点下的原生 input，也可以使用同一 JavaScript realm 的 `target` 属性。它不会隐式跨越 Shadow Root。它使用外部样式表；不会添加运行时 `<style>`、内联样式、远程 CDN、遥测或内容历史。

## 开发

完整的产品和兼容性契约见 [SPECIFICATION.md](SPECIFICATION.md)。常用的本地检查命令包括：

```sh
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run test:dom
npm run build
npm run test:ssr
npm run test:package
npm run ci:auto
```

M3 自动化套件应在干净检出的代码上，使用 Node `24.19.0` 和 npm `11.17.0` 运行。指定品牌浏览器、真实辅助技术、物理六键 rollover、移动设备和目标用户的证据属于 M4 工作；在列出的环境中完成之前，必须明确保持为 `pending`。

## 许可证与安全

本项目采用 MIT 许可证，详见 [LICENSE](LICENSE)。支持范围和私下报告安全问题的指引见 [SECURITY.md](SECURITY.md)。
