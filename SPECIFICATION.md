# Braille Input Engine 技术规范

## 1. 文档状态

- 项目：Braille Input Engine
- 仓库：`https://github.com/xiyaofeng/braille-input-engine`
- 产品定位：可附着到同一 JavaScript 执行环境内受支持编辑目标，或由宿主通过 `outputSink` 接入的 Headless Braille Input Engine
- 规范版本：0.4.0
- 项目版本：0.1.0 alpha
- 版权：`Copyright (c) 2026 xiyaofeng`
- 许可证：MIT
- 分发策略：公开 GitHub 源码及可选 GitHub Release 资产，不发布到 npm registry
- 维护模式：实验性、社区支持、best effort；无 SLA，不承诺响应或修复时间
- 目标平台：现代桌面与移动浏览器
- 默认输入模式：Sequential Mode（逐点输入）
- 可选高级模式：Chord Mode（Perkins-style 六键和弦）
- 预留扩展：Latch Mode 及其他自定义输入策略
- 默认字符输出范围：六点 Unicode 盲文字符 `U+2800–U+283F`
- 实现：TypeScript 核心，编译为 ESM、CommonJS 和浏览器 IIFE

本规范描述项目的公开产品、API、兼容性、安全和质量契约。实现与规范冲突时，应先更新规范或记录 ADR，不能让文档静默失效。

“规范版本”不是产物版本。`package.json.version` 当前为 `0.1.0`，仅用于本地打包、Git tag 和 GitHub Release 资产标识，不表示会发布到 npm。1.0 之前的破坏性变更也必须写入 CHANGELOG 和迁移说明。

本文出现的 `npm ci`、`npm run` 和 `npm pack` 只是本地依赖管理、构建、测试与生成 tarball 的工程命令，不授权 `npm publish`，也不会在 npm 上创建该项目的公共包。

### 1.1 规范用语

- **必须 / 不得（MUST / MUST NOT）**：合并和发布门禁；不满足即不能宣称对应里程碑完成。
- **应 / 建议（SHOULD）**：默认方案；偏离时必须在设计记录中说明原因和替代验证。
- **可以（MAY）**：可选实现，不构成兼容性承诺。
- **未来（FUTURE）**：不属于 1.0 验收范围，也不能让 1.0 API 依赖尚未实现的能力。

## 2. 正式产品定位

本项目不是固定样式的盲文输入框，而是无界面的输入引擎：

```text
Physical Input
      ↓
Input Adapter
      ↓
Input Strategy
Sequential / Chord / future modes
      ↓
Dot State
      ↓
Unicode Braille Encoder
      ↓
Output Adapter
```

核心负责归一化动作、输入策略、点集合状态、Unicode 编码和输出事务，不依赖默认 UI 或 DOM。键盘、指针与编辑目标属于 adapter 层。默认 UI 是可直接集成的可访问参考实现，也用于开发调试、功能演示、输入状态可视化和六键测试；生产入口默认不记录历史，宿主仍可完全替换 UI。

## 3. 项目目标

1. 默认通过普通键盘或数字小键盘逐点选择盲文点位。
2. 以任意顺序累积当前 Braille Cell，确认后输出一个 Unicode 点阵字符。
3. 再次选择已激活点位时取消该点。
4. 可选启用 Perkins-style 六键和弦输入。
5. 为 Latch Mode 和其他策略保留扩展接口。
6. 支持鼠标、触摸和指针设备。
7. 只编码点集合，不解释语言含义。
8. 宿主可以完全定制 UI。
9. 提供简洁、可访问且可直接集成的默认 UI；调试日志仅由 demo 显式开启。
10. 自动适配受支持的 `input`、`textarea` 和受限单 Text `contenteditable`；前端框架及复杂编辑器通过唯一 `outputSink` 接入。

## 4. 产品边界与非目标

引擎只理解：

```text
dots {1, 2, 4}
→ Unicode Braille Pattern
→ ⠋
```

核心不理解 `⠁ = 英文字母 a`，也不包含中文盲文、英文 UEB、数字、缩写、数学、音乐或其他语义翻译；不包含八点盲文、候选窗、分词、自动纠错、系统级输入法或特定 UI 框架。

正常 Braille Cell 提交结果严格位于 `U+2800–U+283F`。换行、删除和可选 ASCII 空格属于编辑命令或空间处理结果，不得伪装成 Braille Cell 提交。

### 4.1 Web 能力边界

本项目名称中的“输入引擎”不等于操作系统输入法。1.0 只处理当前页面明确激活范围内的事件，不能注册为 macOS Input Source、iOS/iPadOS Custom Keyboard，不能向浏览器地址栏或其他应用写入，也不能访问跨源 iframe、不可访问的 Shadow Root 或未由宿主授权的编辑目标。PWA 安装不会扩大这些权限。

“任意编辑目标”仅指本文明确支持的原生 DOM 目标，或宿主通过唯一 `outputSink` 接入的复杂编辑器。若未来开发 Apple 或其他系统级原生输入法，必须另立平台文档与发布线；可以共享 Unicode 规则、状态机规范和语言无关测试向量，但不得直接复用 DOM adapter，也不纳入本版验收。

## 5. 既有惯例与本项目设计

### 5.1 Perkins-style / 常见电脑六键输入惯例

```text
F = 点1
D = 点2
S = 点3
J = 点4
K = 点5
L = 点6

S D F    J K L
3 2 1    4 5 6
```

该 SDFJKL 映射可以描述为 Perkins-style / 常见电脑六键盲文输入惯例。

### 5.2 本项目自行设计

以下不是行业标准：

- Sequential Mode 作为默认模式；
- `7/4/1 + 8/5/2` 的数字小键盘映射；
- 再次按键取消点位的 toggle 行为；
- Sequential 中用 `Space` 或 `NumpadEnter` 确认 Cell；
- 默认 UI 的布局、预览和六键测试交互。

数字小键盘映射是本项目为紧凑、直观和利用 `Numpad5` 触觉定位点设计的默认值。全部映射都允许宿主重新配置。

## 6. 设计原则

### 6.1 Headless First

状态、策略、Unicode 编码和编辑命令位于无界面核心。默认 UI、Web Component 和框架组件只调用公开 API，不复制核心逻辑。

### 6.2 Strategy-based Input

控制器不写死 Sequential 或 Chord 的事件规则。不同模式通过统一 Input Strategy 接口工作，以便未来加入 Latch、辅助设备或宿主策略。

### 6.3 宿主控制输出与监听范围

核心以事件或回调返回结果，由宿主决定如何写入。键盘监听默认仅在指定目标聚焦或显式激活时工作；页面级监听必须主动开启。

### 6.4 Unicode 按位编码

不维护 64 项查找表：

```ts
declare const braillePatternBrand: unique symbol;
export type BraillePattern = string & {
  readonly [braillePatternBrand]: true;
};

export function dotsToBraille(dots: Iterable<number>): BraillePattern {
  let mask = 0;
  for (const dot of dots) {
    if (!Number.isInteger(dot) || dot < 1 || dot > 6) {
      throw new RangeError(`Invalid six-dot Braille dot: ${dot}`);
    }
    mask |= 1 << (dot - 1);
  }
  return String.fromCodePoint(0x2800 | mask) as BraillePattern;
}
```

| 点位    | 输出          |
| ------- | ------------- |
| 1       | `⠁`（U+2801） |
| 1、2    | `⠃`（U+2803） |
| 1、2、4 | `⠋`（U+280B） |
| 1、4、5 | `⠙`（U+2819） |
| 1–6     | `⠿`（U+283F） |
| 无点    | `⠀`（U+2800） |

`U+2800` 的 Unicode 名称是 BRAILLE PATTERN BLANK。按固定的 Unicode 17.0.0 UCD，它的 General_Category 为 `So`，也不在 `White_Space` 属性集合中。它是宽度取决于字体的空盲文 Cell，**不是**一般文本空格，不具有 U+0020 的断词、换行、搜索或空白折叠语义。`spaceMode: 'braille'` 只表示输出空盲文 Cell；普通文本宿主若需要词间空格应选 `ascii`。

### 6.5 核心不变量

- 点位只能是整数 1–6；普通 Cell commit 至少包含一个点，空集合只允许由 `reason='space'` 产生 U+2800。
- `dots`、`mask`、`char` 和 `codePoint` 必须相互一致，并由控制器统一构造；自定义策略不能直接伪造这些字段。
- 一次 `dispatch()` 最多产生一个规范化 OutputAction。
- 状态快照、输出动作、public diagnostic/context 和 DOM `detail` 都复制并冻结；监听者不能通过修改对象影响后续监听者。
- `src/core/**` 不导入 DOM 类型或浏览器全局；DOM 监听、编辑和自定义事件只存在于 adapter、UI 与 Web Component 层。
- 同一控制器同一时刻最多有一个可产生写入副作用的 sink；跨控制器或自定义 sink 的目标唯一性由宿主负责。

## 7. 推荐架构

```text
宿主 UI / 默认 UI / 物理输入
              ↓
        Input Adapters
              ↓
     Headless Controller
              ↓
   Input Strategy Registry
  ┌───────────┼───────────┐
Sequential  Chord  Future/Latch
  └───────────┼───────────┘
              ↓
          Dot State
              ↓
 Unicode Braille Encoder
              ↓
 Output Adapter / Events
```

M3 初次交付的最小目标拓扑（可按责任增加内部文件，不得缺少下列能力）：

```text
.github/
  workflows/
    ci.yml
    release.yml           # 只生成可选 GitHub Release 资产，不发 npm
.gitignore
.gitattributes
.node-version
.npmrc
package.json
package-lock.json
LICENSE
README.md
DEPLOYMENT.md
SECURITY.md
CHANGELOG.md
src/
  core/
    controller.ts
    unicode.ts
    types.ts
    strategies/
      strategy.ts
      sequential.ts
      chord.ts
  adapters/
    keyboard.ts
    pointer.ts
    editable.ts
  ui/
    default-ui.ts
    chord-test.ts
    default-ui.css
  i18n/
    en.ts
    zh-CN.ts
  web-component/
    braille-input.ts
  entries/
    browser.ts
    auto-register.ts
tests/
  unit/
  model/
  dom/
  browser/
  a11y/
  contract/
  performance/
  fixtures/
examples/
demo/
scripts/
docs/
  milestones.json
  toolchain.md
  performance-contract.json
  adr/
  compatibility/       # vX.Y.Z.md，不覆盖旧证据
  a11y/                 # vX.Y.Z.md，不覆盖旧证据
  release/
    evidence.schema.json
  requirements-to-tests.md
  exceptions.yml
dist/                 # 仅由构建生成
```

`core` 不访问 DOM；`strategies` 实现输入行为；`adapters` 归一化键盘、指针和编辑目标；默认 UI 负责可视化；六键测试与实际输入隔离。`package.json` 必须固定 `private: true`、`packageManager`、开发 Node 基线、唯一 lockfile 和 `exports`；包外只允许导入 `exports` 声明的入口，不承诺 `src/**` 或 `dist/**` 深路径兼容。

Web Component 类入口不得自动调用 `customElements.define()`；自动注册放在独立 `auto-register` 副作用入口。`dist/**` 不手工修改，也不作为源文件提交评审依据。

## 8. 核心状态

```ts
export type BrailleDot = 1 | 2 | 3 | 4 | 5 | 6;
declare const extensionIdBrand: unique symbol;
export type ExtensionId = string & { readonly [extensionIdBrand]: true };
export function extensionId(value: string): ExtensionId;
export type BuiltInInputMode = "sequential" | "chord";
export type InputMode = BuiltInInputMode | ExtensionId;
export type SpaceMode = "braille" | "ascii" | "event";
export type BuiltInInputSource = "keyboard" | "numpad" | "pointer" | "api";
export type InputSource = BuiltInInputSource | ExtensionId;
export type OutputSource = InputSource | "mixed";
export type OutputSinkState = "empty" | "ready" | "faulted";

export interface BrailleStateSnapshot {
  readonly inputMode: InputMode;
  readonly pendingDots: readonly BrailleDot[];
  readonly pendingSources: readonly InputSource[];
  readonly previewChar: BraillePattern | null;
  readonly pressedInputIds: readonly string[];
  readonly chordInProgress: boolean;
  readonly awaitingRetry: boolean;
  readonly outputSinkState: OutputSinkState;
  readonly enabled: boolean;
  readonly destroyed: boolean;
}

export type BrailleInputAction =
  | { type: "dot-down"; dot: BrailleDot; inputId: string; source: InputSource }
  | { type: "dot-up"; dot: BrailleDot; inputId: string; source: InputSource }
  | { type: "input-cancel"; inputId: string; source: InputSource }
  | { type: "commit-request"; source: InputSource }
  | { type: "space-request"; source: InputSource }
  | { type: "command"; command: BrailleCommand; source: InputSource };
```

- `pendingDots`：尚未提交的当前 Cell。
- `pendingSources`：当前仍激活点位的来源去重集合；点位被 toggle 或 Backspace 移除时同步重算。
- `previewChar`：当前点集合的实时 Unicode 预览；空状态为 `null`。
- `pressedInputIds`：尚未释放的实体输入 ID，用于去重、和弦和调试；它不只包含键盘 code。
- `chordInProgress`：仅表示 Chord 的进行中状态。
- `awaitingRetry`：上一次 Cell commit 被 sink 拒绝，当前 Cell 已冻结，等待重试或放弃。
- `outputSinkState`：当前 sink 未安装、可用或因协议违规已 faulted；变化属于可观察 statechange。
- `inputMode`：当前策略，默认 `sequential`。

状态快照中的数组必须排序、复制并冻结，不能暴露内部可变 `Set`：dots 数值升序，pressed ID 码点字典序，sources 按 `keyboard → numpad → pointer → api` 后接 ExtensionId 字典序。状态变化通过统一订阅通知 UI；UI 不维护另一份点集合。`previewChar` 是从 `pendingDots` 派生的快照字段，不作为第二份可独立修改的状态。

所有输入适配器只向控制器提交 `BrailleInputAction`。当前 Input Strategy 负责解释同一组 `dot-down`/`dot-up`/`input-cancel`：Sequential 在有效 `dot-down` 时切换点位，Chord 则从 down 到全部 up 维护并集。这样默认 UI 和适配器切换模式时不需要复制模式判断。

`inputId` 必须在控制器内带不可复用的 adapter attachment ID，例如 `keyboard:<attachmentId>:KeyF`、`numpad:<attachmentId>:Numpad7`、`pointer:<attachmentId>:12:dot:1`。每次 attachment 创建都分配 opaque ID，detach 后也不在该 controller 生命周期内复用；API 手工 dispatch 的宿主同样必须使用自己的稳定 namespace。控制器记录首次 down 的 dot/source；同一 ID 未释放前再次 down 只按 repeat 处理，若 dot/source 改变则报告 `INVALID_ACTION`。未知或在 blur 后迟到的 up 静默忽略；已追踪 ID 的 up/cancel 必须优先释放，不受后来出现的修饰键或 IME 状态过滤。

`dispatch()`、策略提供的点集合和 adapter 输入都执行运行时校验，不能只依赖 TypeScript。`pendingSources` 只聚合当前仍激活点位的来源，不包含确认键来源；输出另以 `triggerSource` 记录触发提交的动作来源。

`awaitingRetry=true` 是 controller 级门禁，先于任何 strategy：只继续处理已追踪 ID 的 up/cancel，只允许 `commit-request`/`commitPending()` 重试、Escape/`cancelPending()` 放弃和生命周期操作。其他 dot-down、space 与编辑命令均为 handled no-op，不改变冻结 Cell。`commitPending()` 无 pending 时为 no-op，Chord 进行中调用报告 `INVALID_ACTION`；省略 source 时默认为 `api`。重试的 `triggerSource` 使用本次重试来源，且 editable sink 使用当前重新验证的选择区，绝不恢复失败事务的旧书签。若 sink 已 faulted，重试请求不调用它，按新的 `rejected` 尝试通知并保持冻结；宿主必须先清除/替换 sink 或放弃。

## 9. Sequential Mode（默认）

### 9.1 流程与乱序输入

```text
单键选择点位
→ 累积或取消 current Cell
→ 实时预览
→ Space / NumpadEnter 确认
→ 编码并输出
→ accepted/unhandled：清空；rejected：冻结并等待重试；conflicted：清空并提示检查目标
```

不要求同时按键或点号顺序。以下都得到 `{1,2,4}` 和 `⠋`：

```text
F → D → J
J → F → D
D → J → F
```

### 9.2 Toggle 语义

默认 `toggleDots: true`：

```text
inactive dot + keypress → active
active dot + keypress   → inactive
```

忽略 `event.repeat`。同一实体键必须先收到 `keyup`，下一次 `keydown` 才能再次切换。

如果宿主显式设置 `toggleDots: false`，重复选择已激活点位为无操作；取消通过 Backspace 或 `cancelPending`/清除当前 Cell 完成。第一版默认 UI 始终使用 `true`。

### 9.3 实时状态和预览

每次切换立即更新 `pendingDots` 与 `previewChar` 并触发核心状态订阅，让 UI 同步亮灭。只有 Web Component/UI 包装层派发 `braille-statechange` DOM 事件。若最后一个点被取消，preview 恢复 `null`，不提交空 Cell。

### 9.4 确认

默认确认键为 `Space` 和 `NumpadEnter`。有 pending dots 时，两者都提交当前 Cell；delivery 为 accepted/unhandled 后清空点位与预览，rejected 时保留并冻结以便重试，conflicted 时清空且禁止自动重试并提示检查目标。

必须用 `KeyboardEvent.code` 区分 `Enter` 与 `NumpadEnter`。普通 Enter 不确认 Cell，可作为可配置 `lineBreak`；空状态下 NumpadEnter 默认无操作。

规范化动作不允许 adapter 根据当前状态自行分支：`Space` 始终派发保留的 `space-request`，由控制器执行“有 pending 则提交、无 pending 则按 `spaceMode`”的上下文规则；`NumpadEnter` 和其他显式确认键派发 `commit-request`。默认 `commitKeys` 因此只包含 `NumpadEnter`，`Space` 由独立 `spaceKey` 配置，避免删除普通确认键时意外关闭空盲文 Cell 行为。

## 10. 默认键位

### 10.1 普通键盘

| code   | 点位 |
| ------ | ---: |
| `KeyF` |    1 |
| `KeyD` |    2 |
| `KeyS` |    3 |
| `KeyJ` |    4 |
| `KeyK` |    5 |
| `KeyL` |    6 |

这是常见 Perkins-style 映射；Sequential 的逐点确认交互是本项目设计。实现以 `KeyboardEvent.code` 的物理位置为准，不以键帽字符或当前键盘布局为准；非 US 布局、`code='Unidentified'` 和移动软键盘必须显示实际配置并提供按钮/指针回退，不能猜测字符。

### 10.2 数字小键盘

```text
Numpad7 = 1     Numpad8 = 4
Numpad4 = 2     Numpad5 = 5
Numpad1 = 3     Numpad2 = 6
```

```text
1 ●  ● 4        7   8
2 ●  ● 5   →    4   5
3 ●  ● 6        1   2
```

这是本项目自行设计的默认映射，不是行业标准。`Numpad9/6/3` 默认不占用。使用 `event.code` 区分物理位置，并在 Num Lock 开/关和真实外接键盘上验证。`numpad: false` 禁用所有 `Numpad*` 点位和 `NumpadEnter`；`keyboard: false` 只禁用非 Numpad 键盘输入，两项都关闭时仍允许 pointer 和 API 输入。

## 11. Space 与编辑命令

### 11.1 上下文语义

```text
存在 pendingDots → Commit current cell
不存在 pendingDots → 按 spaceMode 处理
```

| `spaceMode` | 空状态下           |
| ----------- | ------------------ |
| `braille`   | 输出 U+2800（`⠀`） |
| `ascii`     | 输出 U+0020        |
| `event`     | 仅发出 space 事件  |

默认 `spaceMode: 'braille'`。`ascii` 产生 TextOutput，而不是 BrailleCommit；`event` 产生 SpaceIntent 且不直接修改目标。

再次强调：`braille` 输出的是 BRAILLE PATTERN BLANK，不是 Unicode whitespace。复制、搜索、换行、朗读和视觉宽度可能与 U+0020 不同，集成方必须按内容用途选择模式。

### 11.2 命令表

| 按键          | 有 pending cell                | 无 pending cell    |
| ------------- | ------------------------------ | ------------------ |
| `Space`       | 提交 Cell                      | 按 `spaceMode`     |
| `NumpadEnter` | 提交 Cell                      | 无操作             |
| `Backspace`   | 取消最近一次仍处于激活状态的点 | `deleteBackward`   |
| `Escape`      | `cancelPending`                | 无操作             |
| `Enter`       | 可配置 `lineBreak`             | 可配置 `lineBreak` |

核心内部维护仅用于编辑语义的点位激活顺序；取消点位时也从该顺序删除。默认 UI 另有“清除当前 Cell”。输错单点时既可以再次选择该点，也可以用 Backspace 撤销最近激活点。该 Backspace 规则只适用于 Sequential；Chord 进行中按 Backspace 不执行目标删除。

默认 UI 的“确认”按钮派发 `commit-request`，只在存在 pending cell 时有效；空状态点击确认不等同于 Space，也不会输出 U+2800。只有真实 `space-request` 才进入 `spaceMode` 分支。

默认 `commandMap` 为 `{ Backspace: 'deleteBackward', Escape: 'cancelPending' }`；`Enter` 默认未绑定，宿主显式配置后才产生 `lineBreak`。创建时传入的 `keyMap`/`commandMap` 是对默认值的 patch，值为 `null` 表示解除默认绑定；数组选项整体替换。所有 patch 先完整合并和校验，再原子生效。

repeat 规则固定如下：点位、Space、确认、Escape 和 Enter 的 repeat 默认忽略；已识别 repeat 仍可按 `preventDefault='handled'` 阻止原字符重复写入。Backspace 在 pending Cell 内忽略 repeat，避免一次长按清空多个点；空状态下是否连续删除由 `KeyboardAdapterOptions.repeatDeleteBackward` 控制，默认 `false`。

## 12. Chord Mode（高级可选）

`inputMode: 'chord'` 面向熟悉 Perkins-style 六键输入的用户，不是默认要求。

> 从本轮第一个 Braille key 的 keydown 开始，到属于该轮的所有 Braille keys 全部释放为止，在此期间检测到的点位取并集，并作为同一个 Braille Cell 提交。

1. 第一个有效键开始一轮。
2. 后续有效键加入点位并集。
3. 忽略 repeat。
4. keyup 只移除对应 `pressedInputIds`。
5. 全部本轮键释放后提交一次。
6. accepted/unhandled 后清空状态；rejected 转入 awaiting-retry；conflicted 清空并终止该轮。
7. 失焦、隐藏、禁用或销毁取消未完成和弦，不提交。

绝不在第一个 keyup 提交。Chord 在完整释放后自动提交，不依赖 Space/NumpadEnter；无进行中和弦且无待重试 Cell 时，Space 按 `spaceMode`，NumpadEnter 无操作。

Chord 进行中，`Space`、`NumpadEnter`、`Enter` 和 `Backspace` 默认被忽略并阻止其编辑副作用；`Escape` 取消整轮和弦。宿主如需其他行为必须通过自定义策略明确实现。

同一轮可以包含多个实体 `inputId`，包括映射到同一点位的不同按键；只有全部 inputId 释放才结束。若当前仍激活点位来自键盘、小键盘或指针等多个来源，输出的 `source` 为 `mixed`，确认/最后释放动作另记为 `triggerSource`，不参与来源聚合。

如果 Cell commit 被 sink 拒绝，和弦结束但 `pendingDots` 保留并进入 `awaitingRetry=true`。此时冻结 Cell，拒绝开始新和弦和其他编辑命令，只允许 `commitPending()`/`commit-request` 重试或 `cancelPending()`/Escape 放弃；默认 UI 必须显示“重试”和“放弃”。重试成功、无 sink 交付或放弃后才能开始下一轮。切换模式、reset、带 `cancelPending` 的 disable 和 destroy 会放弃待重试 Cell，绝不隐式提交。

## 13. Latch Mode 与策略扩展

Latch 是预留策略，不等同于 Sequential：

- Sequential：正式支持的逐点 toggle 和显式确认。
- Latch：未来用于特殊设备、非标准保持逻辑、辅助输入或自定义工作流。

```ts
export type ControllerCommand = "cancelPending";
export type BuiltInEditorCommand = "deleteBackward" | "lineBreak";
export type EditorCommand = BuiltInEditorCommand | ExtensionId;
export type BrailleCommand = ControllerCommand | EditorCommand;

export type StrategyDeactivateReason = "mode-switch" | "destroy";

export type StrategyResetReason =
  | "cancel-pending"
  | "activation-lost"
  | "hidden"
  | "disable"
  | "configuration-change"
  | "controller-reset";

export interface PendingDotContribution {
  readonly id: string;
  readonly dot: BrailleDot;
  readonly source: InputSource;
}

export interface StrategyLifecycleContext {
  readonly getState: () => BrailleStateSnapshot;
  reportDiagnostic(diagnostic: BrailleInputDiagnostic): void;
}

export interface StrategyResetContext extends StrategyLifecycleContext {
  getPendingContributions(): readonly PendingDotContribution[];
  setPendingContributions(entries: Iterable<PendingDotContribution>): void;
}

export interface StrategyContext extends StrategyLifecycleContext {
  getPendingContributions(): readonly PendingDotContribution[];
  setPendingContributions(entries: Iterable<PendingDotContribution>): void;
  requestCommit(triggerSource: InputSource): void;
  requestSpace(source: InputSource): void;
  requestCommand(command: EditorCommand, source: InputSource): void;
}

export interface BrailleInputStrategy {
  readonly id: InputMode;
  activate(context: StrategyLifecycleContext): void;
  handle(action: BrailleInputAction, context: StrategyContext): void;
  deactivate(
    reason: StrategyDeactivateReason,
    context: StrategyLifecycleContext,
  ): void;
  reset(reason: StrategyResetReason, context: StrategyResetContext): void;
  destroy(context: StrategyLifecycleContext): void;
}

export type BrailleInputStrategyFactory = () => BrailleInputStrategy;

export type BuiltInDiagnosticCode =
  | "INVALID_CONFIG"
  | "INVALID_ACTION"
  | "INVALID_ATTRIBUTE"
  | "KEY_BINDING_CONFLICT"
  | "DOUBLE_WRITE_RISK"
  | "OUTPUT_SINK_CONFLICT"
  | "OUTPUT_SINK_ERROR"
  | "OUTPUT_REJECTED"
  | "SINK_PROTOCOL_VIOLATION"
  | "STRATEGY_ERROR"
  | "STRATEGY_ALREADY_REGISTERED"
  | "TARGET_ALREADY_ATTACHED"
  | "TARGET_NOT_FOUND"
  | "UNSUPPORTED_TARGET"
  | "UI_HOST_CONFLICT"
  | "UNKNOWN_STRATEGY"
  | "CONTROLLER_DESTROYED";
export type BrailleDiagnosticCode = BuiltInDiagnosticCode | ExtensionId;

export interface BrailleInputDiagnostic {
  readonly severity: "warning" | "error";
  readonly code: BrailleDiagnosticCode;
  readonly message: string;
  readonly context?: Readonly<Record<string, string | number | boolean>>;
}

export class BrailleInputException extends Error {
  readonly code: BuiltInDiagnosticCode;
  constructor(
    code: BuiltInDiagnosticCode,
    message: string,
    options?: ErrorOptions,
  );
}
```

策略只能在 `handle()` 请求语义 intent；activate/deactivate/destroy 收到的受限 lifecycle context 不能修改 contribution 或产生输出。`reset()` 收到单独的 copy-on-write `StrategyResetContext`，只能调整 controller-owned contributions，不能请求输出；这样扩展策略可以对 activation-lost、hidden、默认 disable 和 configuration-change 明确选择保留或取消本轮状态。显式 `cancelPending()`、controller reset、`disable({cancelPending:true})`、mode switch 和 destroy 的最终清空规则由 controller 强制执行，strategy hook 不能重新加入 contribution。1.0 strategy 实例只能保存不可变配置和可释放资源句柄，所有 per-cell/per-round 可变数据必须放入 controller-owned contribution/core draft，不得依赖私有字段跨 action 保存；因此 controller 直接 retry/cancel/commit 后不会遗留 strategy 私有 Cell。规范化 BrailleCommit 必须由控制器根据已校验状态构造。每次 `handle()`/`reset()` 使用 copy-on-write 草稿；handle 最多接受一个输出请求。第一次 `requestCommit()`、`requestSpace()` 或 `requestCommand()` 会捕获并封存当时的 contribution/core 草稿；封存后再次调用任何 request 或 `setPendingContributions()` 都使本 action 非法并完整回滚，因此不存在 `set(A) → requestCommit() → set(B)` 应输出 A 还是 B 的分叉。没有请求输出时，handle 返回时的最终草稿才提交为新状态。重复请求、非法 contribution 或策略抛错会丢弃本次全部 core 状态/输出草稿并报告诊断。

`getPendingContributions()` 返回冻结且有序的当前草稿；`setPendingContributions()` 是全量替换。每个 contribution ID 必须唯一且含合法 dot/source；surviving ID 保留原 ordinal，新 ID 按本次 iterable 顺序追加，移除后再次出现按新 ID 处理。控制器由其派生排序去重的 `pendingDots`/`pendingSources`，激活顺序则按 ordinal。内置 Sequential 每个 active dot 恰有一个 contribution，Backspace 删除 ordinal 最新的整个 dot；Chord 可让同一点保留多个来源 contribution，keyup 只释放 pressed input，不移除本轮 contribution。Sequential toggle/remove、`cancelPending`、Chord-round cancel、成功 Cell commit 或 reset 才按各自规则移除 contribution；普通 Sequential `input-cancel` 只释放 pressed input，不回滚已经发生的 toggle。`ControllerCommand` 在进入 strategy 前由控制器消费：`cancelPending` 永远不进入 `requestCommand()`，也不会生成 `CommandOutput`。

策略以 factory 注册，每个控制器获得独立实例，不得共享可变策略对象。`extensionId()` 只接受匹配 `^[a-z][a-z0-9._-]*:[a-z][a-z0-9._-]*$` 的单个小写 `namespace:name`，每段最长 64 字符，并拒绝保留的 `braille` namespace；模板字符串类型不代替运行时校验。内置 ID 不可覆盖；重复 ID、策略方法抛错和销毁后调用都必须产生稳定诊断。活动策略的 disposer 必须拒绝，宿主先 `setInputMode()` 切走；非活动策略注销时调用一次 `destroy()`。mode switch 先清理 core pending，再调用 old deactivate 和 new activate；old deactivate 抛错时报告 `STRATEGY_ERROR`、把旧 custom 实例标记 unavailable，但仍继续激活已校验的新策略，不回滚到可能已损坏的旧实例。活动 custom 的 handle/reset 故障先丢弃本 action 草稿，再进入 structural fault transition：best-effort 调用一次 `deactivate('mode-switch')`，无论其是否再抛错都把实例标记 unavailable，清空 pressed、contributions、Chord round 和 awaiting-retry，把 mode 设为 Sequential 并激活内置实例，同时保留 enabled 与 sink 状态且不产生 OutputAction。new custom activate 失败也按同一清理规则回退，但不对尚未成功激活的实例调用 deactivate。绝不能把 custom contributions 带入 Sequential；这是运行期故障回退，不适用“配置校验失败保持旧 mode”的规则。`cancelPending`、activation loss、hidden、disable、配置清 pressed/Chord 和 controller reset 分别用稳定的 `StrategyResetReason` 通知受影响实例；controller reset 调用全部实例，其他原因只调用 active 实例。controller destroy 即使 hook 抛错也继续完成：先尝试 deactivate active，再尝试 destroy 所有实例各一次，最终状态不可逆。所有内置策略的全部方法（包括 `handle()`）都是不得抛错的不变量；若实现违反该不变量，应由测试/开发断言暴露，不能尝试回退到同一个内置实例。第一版可不完整实现 Latch，但应以测试策略证明控制器没有硬编码为仅支持 Sequential/Chord。

同步构造、配置、重复绑定和销毁后误用等调用方错误抛出 `BrailleInputException`，且不部分修改旧状态；运行期 sink/strategy/adapter 错误通过 `onDiagnostic` 和包装层 `braille-error` 报告，不跨浏览器事件边界抛出。Web Component 的非法枚举属性回退默认值并报告 warning。所有 public diagnostic/context 在 core 出口即按 allowlist 脱敏并冻结，不携带原始 `cause`、DOM target、KeyboardEvent 或编辑内容；DOM wrapper 只能进一步删字段，不能暴露内部异常对象。

### 13.1 生命周期矩阵

| 操作                                   | pressed inputs | Sequential pending | Chord in progress | awaiting retry | sink state | 输出                            |
| -------------------------------------- | -------------- | ------------------ | ----------------- | -------------- | ---------- | ------------------------------- |
| 同一已注册 activation group 内焦点移动 | 保留           | 保留并保存书签     | 保留              | 保留           | 不变       | 无                              |
| 离开 activation scope / window blur    | 清空           | 保留、使旧书签失效 | 取消              | 保留           | 不变       | 无                              |
| `visibilitychange=hidden`              | 清空           | 保留、使旧书签失效 | 取消              | 保留           | 不变       | 无                              |
| `disable()`                            | 清空           | 默认保留           | 取消              | 保留           | 不变       | 无                              |
| `disable({cancelPending:true})`        | 清空           | 清空               | 取消              | 放弃           | 不变       | 无                              |
| `reset()`                              | 清空           | 清空               | 取消              | 放弃           | 不变       | 无                              |
| 模式切换                               | 清空           | 默认取消           | 取消              | 放弃           | 不变       | 无                              |
| `destroy()`                            | 清空           | 清空               | 取消              | 放弃           | empty      | 最终 statechange 后停止所有事件 |

默认模式切换策略是 `cancel`；未来可以增加 `modeSwitchBehavior: 'cancel' | 'reject'`，但不应在切换时隐式提交。library-managed Web Component 把默认 UI 与编辑目标注册为同一 `ActivationGroup`：用户在组内移动焦点时保存编辑目标和选择区，不把它视为目标解绑。独立组合 controller、keyboard、editable 和 UI 的宿主必须把同一个显式 group 传给各 attachment，或选择共同的 `HTMLElement` scope/manual activation；未提供 group 时各 attachment 不承诺识别 DOM 邻接关系。非文本按钮可在指针激活时防止夺取编辑焦点；键盘激活按钮时由选择区书签在写入前恢复。

离开 activation scope 后旧选择书签失效，重新聚焦时以目标的当前选择区为准；写入前始终重新校验连接状态、可编辑状态和选择区归属。composition/modifier 过滤只阻止新的 down；已经追踪的 up/cancel 必须先释放。`compositionstart` 取消进行中的 Chord，但不清 Sequential pending。

## 14. 公开 API 草案

### 14.1 默认配置

```ts
export const defaultControllerOptions = {
  inputMode: "sequential",
  toggleDots: true,
  spaceMode: "braille",
} as const;

export const defaultKeyboardOptions = {
  keyboard: true,
  numpad: true,
  keyMap: {
    KeyF: 1,
    KeyD: 2,
    KeyS: 3,
    KeyJ: 4,
    KeyK: 5,
    KeyL: 6,
    Numpad7: 1,
    Numpad4: 2,
    Numpad1: 3,
    Numpad8: 4,
    Numpad5: 5,
    Numpad2: 6,
  },
  spaceKey: "Space",
  commitKeys: ["NumpadEnter"],
  commandMap: {
    Backspace: "deleteBackward",
    Escape: "cancelPending",
  },
  repeatDeleteBackward: false,
  preventDefault: "handled",
} as const;
```

核心与 DOM 配置必须物理分离：`createBrailleController()` 只接受 controller options；`attachKeyboard()` 接受 `KeyboardAdapterOptions`。1.0 不承诺未定义的 `createBrailleInput()` 总 facade；若未来增加，它必须分组 controller/keyboard/editable/UI options，明确资源所有权，且不得作为 `core` 子路径实现或让导入 core 时解析 `KeyboardEvent`/访问 DOM。

### 14.2 统一输出动作与单一写入者

控制器只生成一条规范化 `BrailleOutputAction` 流。一个控制器同一时刻最多绑定一个具有写入副作用的 `outputSink`。sink 返回 `accepted` 时，状态订阅、`onOutput` 和 DOM 自定义事件都是只读通知，监听者不得再次应用同一动作；sink 返回 `unhandled` 或根本没有 sink 时，通知可以作为宿主的非事务性唯一消费入口。

`unhandled` 不表示失败，也不能把监听结果反馈给控制器；通知发出前当前 Cell 已按 fire-and-forget 语义清空。需要写入成功确认、拒绝保留和可靠重试的集成必须使用 sink。library-managed DOM adapter 只能在同一 realm、同一包注册表内阻止重复目标绑定；多个包副本和自定义 sink 的唯一写入责任由宿主承担。

- `spaceMode='braille'` 生成 `BrailleCommit`，其中 `dots=[]`、`char='⠀'`、`reason='space'`。
- `spaceMode='ascii'` 生成 `TextOutput`。
- `spaceMode='event'` 生成不含字符的 `SpaceIntent`。
- 需要作用于编辑目标的删除和换行生成 `CommandOutput`；Sequential 有 pending 时的 Backspace 只更新当前点集合，不生成目标删除动作。

```ts
export interface BrailleCommit {
  readonly kind: "braille";
  readonly reason: "cell" | "space";
  readonly char: BraillePattern;
  readonly codePoint: number;
  readonly dots: readonly BrailleDot[];
  readonly mask: number;
  readonly sources: readonly InputSource[];
  readonly source: OutputSource;
  readonly triggerSource: InputSource;
  readonly inputMode: InputMode;
}

export interface TextOutput {
  readonly kind: "text";
  readonly reason: "space";
  readonly text: " ";
  readonly source: InputSource;
}

export interface SpaceIntent {
  readonly kind: "space-intent";
  readonly source: InputSource;
}

export interface CommandOutput {
  readonly kind: "command";
  readonly command: EditorCommand;
  readonly source: InputSource;
}

export type BrailleOutputAction =
  BrailleCommit | TextOutput | SpaceIntent | CommandOutput;

export type OutputDelivery =
  "accepted" | "rejected" | "unhandled" | "conflicted";

export interface BrailleOutputSink {
  write(action: BrailleOutputAction): OutputDelivery;
}
```

`accepted` 表示恰好一次副作用已经同步完成；`rejected` 表示确定没有发生任何可观察写入副作用；`unhandled` 表示 sink 明确没有处理且也没有产生副作用；`conflicted` 表示尝试期间观察到外部变更或协议违规，动作是否已被部分/完整应用不可确定。`conflicted` 是终态：Cell pending 被清除且不得自动重试，UI 必须提示用户检查目标后再决定是否重新输入。Promise、thenable 或非法返回值可被检测并报告一次 `SINK_PROTOCOL_VIOLATION`；未捕获异常报告一次 `OUTPUT_SINK_ERROR`。这两类情况都确定性按 conflicted 分类并将该 sink 标记为 faulted，直至宿主清除或替换。faulted 期间不再调用 `write()`：每个后续输出固定得到 `rejected` 通知并报告 `OUTPUT_REJECTED`，普通 Cell 因此冻结等待清除/替换后重试，非 Cell 不创建 retry；清除后状态回到 empty，安装新 sink 后为 ready。控制器无法观察异常发生前是否已有副作用，因此任何未捕获 throw 都不得归为 rejected；确知零副作用的拒绝必须由 sink 自行 catch 并显式返回 rejected。sink 先产生副作用再返回 rejected 仍违反协议且 library 无法可靠检测；合规 sink 若知道结果不确定必须返回 conflicted，exactly-once 保证只适用于 accepted/rejected/unhandled 的契约分支。第一版 sink 必须同步；异步确认需要另行设计 waiting、timeout、cancel、destroy 和队列语义，不属于 1.0。

所有输出都经过 `onOutput`/output notification；宿主不会因为字符与空格分属不同回调而漏掉 U+2800。`reason='cell'` 时 `sources/source` 来自当前仍激活点位；`reason='space'` 时 `sources=[triggerSource]` 且 `source=triggerSource`。

### 14.3 配置与控制器

```ts
export interface BrailleInputOptions {
  readonly inputMode?: InputMode;
  readonly toggleDots?: boolean;
  readonly spaceMode?: SpaceMode;
  readonly strategies?: readonly BrailleInputStrategyFactory[];
  readonly outputSink?: BrailleOutputSink;
  readonly onStateChange?: (state: BrailleStateSnapshot) => void;
  readonly onOutput?: (
    action: BrailleOutputAction,
    delivery: OutputDelivery,
  ) => void;
  readonly onDiagnostic?: (diagnostic: BrailleInputDiagnostic) => void;
}

export type BrailleInputOptionPatch = Partial<
  Pick<BrailleInputOptions, "inputMode" | "toggleDots" | "spaceMode">
>;

export type ActivationMode = "focus" | "manual" | "always";
export type KeyboardScope = Document | ShadowRoot | HTMLElement;

export interface ActivationGroup {
  add(element: HTMLElement): () => void;
  destroy(): void;
}

export function createActivationGroup(ownerDocument: Document): ActivationGroup;

export interface KeyboardAdapterOptions {
  readonly keyboard?: boolean;
  readonly numpad?: boolean;
  readonly keyMap?: Readonly<Record<string, BrailleDot | null>>;
  readonly spaceKey?: string | null;
  readonly commitKeys?: readonly string[];
  readonly commandMap?: Readonly<Record<string, BrailleCommand | null>>;
  readonly repeatDeleteBackward?: boolean;
  readonly preventDefault?: "handled" | "always" | "never";
  readonly activation?: ActivationMode;
  readonly activationGroup?: ActivationGroup;
  readonly keyboardFilter?: (event: KeyboardEvent) => boolean;
}

export interface BrailleAttachment<TOptions> {
  activate(): void;
  deactivate(): void;
  updateOptions(patch: Partial<Omit<TOptions, "activationGroup">>): void;
  detach(): void;
}

export interface KeyboardBindingSource {
  getEffectiveKeyMap(): Readonly<Record<string, BrailleDot>>;
  subscribeEffectiveKeyMap(
    listener: (keyMap: Readonly<Record<string, BrailleDot>>) => void,
  ): () => void;
}

export interface KeyboardAttachment
  extends BrailleAttachment<KeyboardAdapterOptions>, KeyboardBindingSource {}

export interface BrailleInputController {
  enable(): void;
  disable(options?: { cancelPending?: boolean }): void;
  reset(): void;
  updateOptions(patch: BrailleInputOptionPatch): void;
  setInputMode(mode: InputMode): void;
  commitPending(source?: InputSource): void;
  cancelPending(): void;
  registerStrategy(factory: BrailleInputStrategyFactory): () => void;
  dispatch(action: BrailleInputAction): void;
  setOutputSink(sink: BrailleOutputSink): () => void;
  getState(): BrailleStateSnapshot;
  subscribeState(listener: (state: BrailleStateSnapshot) => void): () => void;
  subscribeOutput(
    listener: (action: BrailleOutputAction, delivery: OutputDelivery) => void,
  ): () => void;
  subscribeDiagnostic(
    listener: (diagnostic: BrailleInputDiagnostic) => void,
  ): () => void;
  clearOutputSink(expected?: BrailleOutputSink): void;
  destroy(): void;
}

export function createBrailleController(
  options?: BrailleInputOptions,
): BrailleInputController;

export function attachKeyboard(
  controller: BrailleInputController,
  scope: KeyboardScope,
  options?: KeyboardAdapterOptions,
): KeyboardAttachment;
```

`setOutputSink` 在已有 sink 时必须抛出可诊断的 `OUTPUT_SINK_CONFLICT`，防止 Web Component 的 `for`、`attachBrailleEditable()` 和宿主写入回调同时修改目标；其 disposer 只在该 sink 仍为当前实例时清除且幂等。无 sink 初始为 empty，成功安装（包括构造 options）变为 ready，协议违规变为 faulted，`clearOutputSink()`/有效 disposer 变回 empty；每次实际变化都先更新 snapshot 再发 statechange。构造时安装的 sink 可用 `clearOutputSink(expected?)` 清除；传入 `expected` 且身份不匹配时抛 `OUTPUT_SINK_CONFLICT`。替换必须先清除旧 sink，再安装新 sink，且事务锁期间禁止这两项操作，因此不会穿透正在写入的动作。所有 `updateOptions()` 都先合并、完整校验并原子替换；失败时旧配置、sink、策略和状态保持不变。键位更新会清 `pressedInputIds`、取消 Chord 并保留 Sequential pending；模式变更遵守生命周期矩阵。`KeyboardBindingSource` 的快照已应用 `keyboard`/`numpad` 开关并排除 null mapping，排序、冻结；订阅注册后立即收到当前值，仅在有效映射实际变化后通知。

`enable()`、`disable()`、`destroy()`、所有 disposer 和 `detach()` 必须幂等。`subscribeState()` 注册后立即同步收到一次当前快照；其他订阅只接收后续事件。destroy 后 `getState()` 仍返回 `enabled=false, destroyed=true` 的最终快照，重复 destroy/dispose 为无操作，其余变更方法抛 `CONTROLLER_DESTROYED`。

### 14.4 输出事务和事件顺序

提交按以下顺序执行：

```text
构造 OutputAction
→ outputSink 尝试写入
→ reason='cell' commit rejected：保留并冻结 pending cell，awaitingRetry=true
→ reason='cell' commit accepted/unhandled：清空 pending cell 和来源
→ reason='cell' commit conflicted：清空该 pending cell，不进入 retry，并要求用户检查目标
→ reason='space' / Text / SpaceIntent / Command：无论 delivery 如何都不清与该动作无关的已有 pending cell；conflicted 仍发出检查提示
→ 若状态发生变化则派发 statechange
→ 派发 output 通知和 DOM 自定义事件
```

没有 output sink 时，delivery 为 `unhandled`，动作仍通过通知发出；这是纯 Headless 事件集成模式。只有 delivery 为 `unhandled` 时，通知监听者才可以作为该动作的唯一非事务性写入者；控制器不等待或确认监听结果。

控制器在 sink、状态订阅、输出订阅和诊断回调期间保持事务锁；这些普通回调中的 `dispatch()`、`commitPending()` 和 `cancelPending()` 重入按 FIFO 排队。strategy activate/deactivate/reset/destroy 属于 structural transaction phase：即使 hook 通过闭包调用 controller，dispatch/commit/cancel 与所有其他 mutator 也稳定拒绝并报告 `INVALID_ACTION`，绝不入 FIFO 或在 hook 返回后补发。配置、sink、strategy registry、reset、disable 和 destroy 等结构性变更在任何事务中同样稳定抛 `INVALID_ACTION`，不得穿透当前事务。成功 DOM sink 由 adapter 控制的关键事件相对顺序为 `beforeinput → mutation → input → statechange → subscribeOutput/onOutput → DOM output event`；浏览器还可能产生 selection、focus 或 MutationObserver 等其他观察。各类监听器按注册顺序调用，单个监听器抛错被隔离，不能阻止后续监听器或回滚 accepted 写入；diagnostic listener 自身抛错直接隔离并吞掉，避免递归 diagnostic。一次输入动作最多产生一个规范化 OutputAction。

sink 的未捕获异常不能越过浏览器事件监听边界；控制器一律捕获、报告 `OUTPUT_SINK_ERROR`、按 conflicted 处理并 fault sink，不推测异常发生在副作用前还是后。只有 sink 显式返回的 rejected Cell commit 才进入 awaiting-retry；U+2800 space、Text、SpaceIntent 或 Command rejected 只报告失败，用户可重新触发。Promise、thenable 或非法返回值同样直接按 conflicted 并 fault sink，不保留可重试 Cell。sink 必须自行保证“返回 rejected 时零副作用”，否则控制器无法检测已发生的写入，重试可能重复插入，属于集成方协议违规。

### 14.5 配置校验和按键优先级

初始化及配置更新时必须拒绝同一 `KeyboardEvent.code` 同时出现在有效 `keyMap`、`spaceKey`、`commitKeys` 或 `commandMap`。冲突抛出 `KEY_BINDING_CONFLICT`，不采用隐式优先级；被 `null` 解除的条目不参与冲突。

合法事件处理顺序为：

```text
已追踪 inputId 的 keyup/cancel（始终先释放）
→ disabled / inactive / scope 外的新输入
→ composition / modifier / keyboardFilter
→ Chord Test 独占捕获
→ reserved space request
→ commit request
→ configured command
→ mapped dot input
→ unhandled
```

Keyboard adapter 始终把有效 `commitKeys` 归一化为 `commit-request`，当前 strategy 决定处理或忽略；内置 Chord 除 awaiting-retry 外忽略。`spaceKey` 是独立保留键，不能同时出现在其他映射。Chord Test 也必须执行作用域、IME 和修饰键安全过滤，不能劫持系统快捷键。

| `preventDefault` | 可执行语义                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------- |
| `handled`        | 仅阻止被引擎消费的配置键；mapped repeat 和 Chord 安全忽略键也算 handled                                       |
| `always`         | 阻止通过安全过滤后的所有**已配置候选键**，即使本次状态无变化                                                  |
| `never`          | 不阻止默认行为，但引擎仍更新状态；宿主承担原字符同时写入的风险，并收到 `DOUBLE_WRITE_RISK` warning diagnostic |

无论取值为何，scope 外、未映射、IME composition、带 Ctrl/Meta/Alt/AltGraph 的新 down 和系统快捷键都不得被阻止。已追踪 keyup 只为释放状态，不因此额外阻止默认行为。adapter 在初始配置为 `never` 或从其他值切换到 `never` 时各报告一次稳定 warning；默认 UI/Web Component 若连接则把它呈现为可感知警告，纯 headless 集成只承诺 diagnostic 和文档，不虚构 UI。

`keyboardFilter(event)` 返回 `true` 才继续处理；`false` 表示 pass-through 且不得 preventDefault。filter 抛错时报告 adapter diagnostic 并按 `false` 处理。已追踪 inputId 的 release 永远先于 filter。默认 `focus` activation 要么使用 `HTMLElement` scope 本身，要么使用显式 `activationGroup`，并以事件 `composedPath()` 或所属 root 的 active element 是否位于有效 member 内判断；`Document`/`ShadowRoot` scope 若没有 group，必须显式选择 `manual` 或 `always`，否则初始化即 `INVALID_CONFIG`，从而把页面/root 级捕获变成明确 opt-in。group 只接受同一 ownerDocument 的 HTMLElement；editable target、UI host 和 `HTMLElement` keyboard scope 各自自动取得一个 registration token 并在 detach 时释放，`Document`/`ShadowRoot` 本身绝不传给 `add()`，使用 group 时由宿主或其他 attachment 注册其中的实际 HTMLElement member。对同一元素的每次 `add()` 都产生独立且幂等的 token，只有最后一个 token 释放或 group destroy 后才移除该 member，避免一个 attachment 的 detach 破坏另一个 attachment 的 activation。`activationGroup` 是 construction-only option，已从通用 `updateOptions()` patch 类型中排除；JavaScript 运行期传入该字段必须以 `INVALID_CONFIG` 零副作用拒绝。group destroy 同步使相关 focus attachment inactive、清 pressed/取消 Chord、使书签失效，之后 `add()` 抛 `INVALID_ACTION`；恢复必须 detach 并用新的 live group 重新 attach，不能热迁组。manual 仅由 attachment activate/deactivate 控制；always 在 attachment 存续且 controller enabled 时有效。非 manual 模式调用 activate/deactivate 为幂等 no-op。library-managed Web Component 创建并拥有一个 group 来协调已知 target 与内部 UI，不把任意同 root 元素纳入范围；独立集成若共享 group，由宿主负责最终 `destroy()`。

## 15. DOM 事件

| 事件                  | 时机                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `braille-statechange` | `BrailleStateSnapshot` 任一可观察字段变化，包括 pendingSources、pressed IDs、Chord、retry、outputSinkState、enabled、destroyed |
| `braille-input`       | BrailleCommit，包括 reason=space 的 U+2800                                                                                     |
| `braille-space`       | TextOutput 或 SpaceIntent                                                                                                      |
| `braille-command`     | CommandOutput                                                                                                                  |
| `braille-error`       | 配置或运行错误                                                                                                                 |

每个 OutputAction 只映射到表中的一个输出事件，不同时派发 `braille-input` 和 `braille-space`。输出事件的 `detail` 为冻结的 `{ action, delivery }`，state 事件为 `{ state }`，error 事件为已脱敏的 `{ diagnostic }`。所有通知事件 `cancelable: false`；默认 `bubbles: true`、`composed: true`，因此同源祖先可以观察状态和动作。`eventComposed=false` 只限制跨 Shadow DOM 边界，不阻止同 root 冒泡或同页脚本订阅，不能当成保密措施。

delivery 为 `accepted` 时 DOM 事件严格只读；为 `unhandled` 时可以作为唯一的非事务性消费入口；为 `rejected` 时只能观察错误或提示用户重试，不能绕过 sink 再写入；为 `conflicted` 时只能提示检查目标，既不能补写也不能自动重试。编辑适配器成功修改目标后再派发标准 `input`。自定义 UI 以 `braille-statechange` 为实时状态来源。

`destroy()` 清除 sink/fault、把 `outputSinkState` 设为 empty，再同步发布一次 `enabled=false, destroyed=true` 的最终 core statechange并移除订阅；连接中的 Web Component 在解除 DOM 监听前镜像该最终事件。destroy 后不再发任何其他事件。

如果 Web Component 已通过 `for` 或 `target` 绑定自动写入且 delivery 为 `accepted`，宿主监听 `braille-input` 时只能观察，不得再次插入 `detail.action.char`。纯事件集成不配置 output sink，此时 delivery 为 `unhandled`，宿主可以选择把该通知作为自己的唯一写入入口；监听失败不会恢复 pending，可靠集成应改用 sink。

## 16. Web 编辑目标适配

复杂编辑器推荐提供唯一的 output sink：

```ts
const controller = createBrailleController({
  outputSink: {
    write(action) {
      if (action.kind === "braille") editor.insertText(action.char);
      if (action.kind === "text") editor.insertText(action.text);
      if (action.kind === "command") editor.execute(action.command);
      if (action.kind === "space-intent") editor.handleSpaceIntent();
      return "accepted";
    },
  },
});
```

简单原生目标可用 `attachBrailleEditable()`：

```ts
export interface EditableAdapterOptions {
  readonly activation?: ActivationMode;
  readonly activationGroup?: ActivationGroup;
}

export function attachBrailleEditable(
  controller: BrailleInputController,
  target: HTMLInputElement | HTMLTextAreaElement | HTMLElement,
  options?: EditableAdapterOptions,
): BrailleAttachment<EditableAdapterOptions>;
```

实现要求：

- public `attachBrailleEditable()` 只在 controller 无 pending/awaitingRetry 时安装；否则抛 `INVALID_ACTION`，避免把旧 Cell 绑定到新目标。其 public detach 在释放 sink/target 前显式取消当前 pending/retry，确保以后不会写到另一目标；Web Component 为同一对象 disconnect/reconnect 使用内部 suspension 路径，按第 19 节处理，不伪装成 public detach。
- 完整支持 `textarea` 和 `input[type=text|search|tel|url]`。1.0 的通用 adapter 不支持 `input[type=password]`，也不支持 `email`、`number`、`date`、`color` 等缺少所需选择语义的类型，统一返回 `UNSUPPORTED_TARGET`。密码输入须等 controller-wide sensitive facade 定义完成后再开放；core subscriber 与自定义 sink 属于受信任宿主代码，不能承诺对其隐藏动作。
- 第一版 `contenteditable` 自动适配只支持单一 editing host，且 DOM grammar 必须为空或仅含一个直接 Text child；任何 element（包括 `<br>`）、多个 Text node、comment、嵌套 editable 或 `contenteditable=false` 岛都不进入自动适配，attach 时抛出 `UNSUPPORTED_TARGET`。合法 attach 后若运行期 grammar 变复杂，adapter 必须在零副作用下报告 `UNSUPPORTED_TARGET` 并对所有动作返回 `rejected`；`BrailleCommit(reason='cell')` 因而保留并冻结 Cell，绝不能以 `unhandled` 的 fire-and-forget 分支清空。空 host 的唯一合法 caret 为 host offset 0，首次插入创建一个 Text node；之后 selection 两端必须位于该 Text node，或是等价的 host 边界，并映射为其 UTF-16 offset。复杂/富文本必须先 detach 自动 adapter，再使用编辑器官方 API 的唯一 sink。
- `readonly`、`disabled` 或不再连接到 DOM 的目标拒绝写入并返回 `rejected`。
- `input/textarea` 使用选择区和 `setRangeText(text, start, end, 'end')`，插入、替换或删除后 caret 折叠到结果末尾。adapter 在派发 `beforeinput` 前先按 HTML API value（textarea 换行已归一化为 LF）的 UTF-16 `length` 计算旧长度与 `value.slice(0,start) + replacement + value.slice(end)` 的新长度；仅当非负 `maxLength` 被超过且新长度大于旧长度时，才零副作用返回 `rejected`，不派发 beforeinput，也不截断 Braille Cell。这样脚本赋值或动态调低 maxLength 造成的既有超长值仍可删除或作不增加长度的替换，逐步恢复合法。`contenteditable` 在上述单 Text 模型内使用 `Selection`、`Range` 和文本节点。
- Selection 必须完全属于当前 target/editing host；跨目标、失效、多 Range 或被 DOM 更新破坏的书签返回 `rejected`，绝不能退回到其他元素或 document 当前选择区写入。
- 插入字符使用 `inputType='insertText'`，textarea 换行使用 `insertLineBreak`，删除使用 `deleteContentBackward`。插入的 `data` 为字符/文本，删除和命令的 `data` 为 `null`。
- 写入前保存 target identity、value/文本、DOM 版本和 selection 书签，再派发 `bubbles:true, composed:true, cancelable:true` 的合成 `beforeinput`。监听返回后先比较快照：target value、DOM、selection 或书签任一变化都返回 `conflicted`，不再 mutation、不派发 adapter 的标准 `input`，Cell 也不得自动重试；即使事件同时被取消也以 conflicted 为准。目标完全未变化且事件被取消时才返回 `rejected`；仅 `BrailleCommit(reason='cell')` 保留并冻结 pending，其他动作不创建 retry Cell。未取消且未变化才执行 mutation，成功后只派发一次 `bubbles:true, composed:true, cancelable:false` 的 `input`。
- 不使用 `innerHTML +=`。
- 自动 adapter 对支持目标同步执行删除，并按 grapheme cluster 处理，优先使用 `Intl.Segmenter`，不能等待浏览器稍后默认删除，也不能只删 UTF-16 code unit/code point。复杂编辑器由自定义 sink 调用其官方删除 API。
- 若没有 `Intl.Segmenter` 且没有经过完整 Unicode 测试的内置 fallback，未发生副作用时固定返回 `unhandled`，允许唯一通知入口接管；不得在运行时随机选择 rejected，也不得静默降级。
- 单行 input 和 1.0 的单 Text contenteditable 对 `lineBreak` 固定返回 `unhandled`；只有 textarea 执行 `insertLineBreak`。
- pending 状态不写入目标，确认后才修改。
- 支持 focus（默认）、manual、always 激活策略；manual 由 attachment 的 `activate()/deactivate()` 控制。
- 不默认监听整个 document。
- 自动 adapter 只执行 `BuiltInEditorCommand` allowlist，不根据任意 command 字符串动态调用目标方法；`ControllerCommand` 已由 controller 内部消费，`SpaceIntent` 和自定义 `EditorCommand` 返回 `unhandled` 且不产生副作用，交由受信任宿主的唯一通知入口处理。

合成的 `beforeinput`/`input` 事件 `isTrusted=false`，不会触发浏览器默认编辑，也不能保证进入原生撤销栈。原生适配器提供 best-effort 撤销支持，并在兼容矩阵中逐目标记录“已验证”或“已知限制”；ProseMirror、CodeMirror、React 受控输入等必须使用其官方编辑 API 作为 output sink。

Headless core 不读取编辑目标。editable adapter 只在本地、当前事务内读取完成选择替换和相邻 grapheme 删除所需的最小文本，不持久化、不分析、不上报。public diagnostic/error、debug history、日志和 trace 不得包含目标文本、选择区、原始 KeyboardEvent、DOM target 或原始异常 cause；`diagnostic.context` 只允许经过字段 allowlist 的标量元数据。正常 state/output 通知按契约包含 dots、preview 或 action，是明确的输入数据暴露面；`composed:false` 只限制 Shadow DOM 穿透，不能阻止同页受信任脚本订阅，也不是保密边界。

## 17. 完全可定制 UI

宿主可只使用核心：

```ts
const controller = createBrailleController({
  inputMode: "sequential",
  outputSink,
});
const uiInstanceId = crypto.randomUUID(); // 本 controller 生命周期内不可复用

button.addEventListener("pointerdown", (event) => {
  controller.dispatch({
    type: "dot-down",
    dot,
    inputId: `pointer:${uiInstanceId}:${event.pointerId}:dot:${dot}`,
    source: "pointer",
  });
});

button.addEventListener("pointerup", (event) => {
  controller.dispatch({
    type: "dot-up",
    dot,
    inputId: `pointer:${uiInstanceId}:${event.pointerId}:dot:${dot}`,
    source: "pointer",
  });
});

button.addEventListener("pointercancel", (event) => {
  controller.dispatch({
    type: "input-cancel",
    inputId: `pointer:${uiInstanceId}:${event.pointerId}:dot:${dot}`,
    source: "pointer",
  });
});
```

实际 adapter 对 mouse 只接受 `button===0`；对 touch 接受所有活动 `pointerId`，不得以 `isPrimary` 过滤第二个及后续触点；pen 的按钮策略必须记录在兼容矩阵。有效 down 后 capture，并统一处理 `pointerup`、`pointercancel` 和 `lostpointercapture`；正常 up 已释放的 ID 随后收到 lost capture 时必须忽略。Sequential 的 cancel 只释放 pressed input，不回滚已经发生的 toggle；Chord 任一仍活动 pointer cancel 默认取消整轮且不提交。

点按钮还必须支持原生按钮的键盘/辅助技术 `click`：没有对应活动 pointer 的 click 合成一次唯一 down/up；真实 pointer 后续 click 被去重，避免 pointerdown 与 click 双重 toggle。Chord 和多点触控不得成为唯一可完成路径，Sequential 的标准按钮激活必须覆盖全部核心任务。

核心不依赖 DOM 结构、类名、颜色、尺寸或文案。默认 UI 提供插槽、稳定 token、CSS 变量和可替换文案；结构需要完全不同则直接使用核心 API。

1.0 Web Component 必须暴露 `container`、`toolbar`、`mode-selector`、`cell`、`dot`、`dot-active`、`preview`、`actions`、`commit-button`、`clear-button`、`retry-button`、`discard-button`、`chord-test` 和 `chord-test-result` Shadow Parts。standalone 默认 UI 在 light DOM 的 `part` attribute 使用同一 token，供默认 CSS 的 `[part~="..."]` selector 使用，但宿主不能在 light DOM 对它使用 `::part()`。两种 host 都由 library 在占用期间设置 `data-braille-ui-root` marker，使外部 CSS 可用 `[data-braille-ui-root] [part~="..."]` 和 `[data-braille-ui-root]::part(...)`，因此自定义 element tag 也能获得默认样式；detach 只移除由本 attachment 添加的 marker。两种形态都提供 `--braille-bg`、`--braille-fg`、`--braille-dot-size`、`--braille-dot-gap`、`--braille-dot-idle`、`--braille-dot-active`、`--braille-focus` 和 `--braille-font` CSS 自定义属性。这些 marker/token/parts/变量属于受语义化版本保护的公开 surface。

## 18. 默认 UI

### 18.1 布局与实时状态

```text
┌────────────────────────────────┐
│ 六点盲文输入  Sequential  已启用│
│      ●  ●     Current dots:    │
│      ●  ○     1, 2, 4          │
│      ○  ○     Preview: ⠋       │
│ [确认] [清除当前] [退格]       │
│ 演示日志：⠁⠃⠋                 │
│ Keyboard Chord Test            │
│ S ✓ D ✓ F ✓ J ✓ K ✓ L ✓       │
│ 6-key rollover: Supported      │
└────────────────────────────────┘
```

Sequential 每次选择都从引擎状态立即重绘：

```text
初始：       按 F：      再按 J：    再按 D：
○  ○        ●  ○        ●  ●        ●  ●
○  ○        ○  ○        ○  ○        ●  ○
○  ○        ○  ○        ○  ○        ○  ○
```

预览不写入目标。“演示日志”只存在于 demo/debug 入口，是只读输出订阅者，不是第二写入者。确认后 accepted/unhandled 清空点位、预览和按钮状态；rejected 保留 Cell 并显示重试/放弃；conflicted 清空 Cell、禁用重试并显示“请检查目标后重新输入”的持续可感知提示。指针适配器为每个 `pointerId` 和 attachment ID 生成唯一 `inputId`，在 `pointerdown` 时调用 `setPointerCapture()` 并派发 `dot-down`，在 `pointerup` 时派发 `dot-up`。Sequential 只在 down 时 toggle 一次；Chord 等全部活动指针 up 后提交。任一活动指针发生 `pointercancel` 或意外丢失 capture 时默认取消整轮指针和弦。只有六点 Cell 区域设置 `touch-action: none`，不能阻止页面其他区域滚动。

默认 UI 显示模式、点集合、掩码、码位、预览和来源，提供模式切换、确认、清除、退格、失败重试与放弃。生产入口 `debug: false`，不保存输出历史；demo 入口可显式设为 `true`。

```ts
export type DefaultMessageKey =
  | "title"
  | "mode"
  | "sequential"
  | "chord"
  | "dot"
  | "enabled"
  | "disabled"
  | "currentDots"
  | "preview"
  | "commit"
  | "clear"
  | "backspace"
  | "retry"
  | "discard"
  | "chordTestStart"
  | "chordTestInstruction"
  | "chordTestCodes"
  | "chordNoMapping"
  | "chordSupported"
  | "chordUnsupported"
  | "outputRejected"
  | "outputConflicted"
  | "doubleWriteRisk";

export interface DefaultUIOptions {
  readonly debug?: boolean;
  readonly lang?: string;
  readonly messages?: Partial<Record<DefaultMessageKey, string>>;
  readonly liveMode?: "quiet" | "polite";
  readonly eventComposed?: boolean;
  readonly activationGroup?: ActivationGroup;
  readonly keyboardBindings?: KeyboardBindingSource;
  readonly chordTestCodes?: readonly [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  readonly chordTestTimeoutMs?: number;
}

export function createDefaultBrailleUI(
  controller: BrailleInputController,
  host: HTMLElement,
  options?: DefaultUIOptions,
): BrailleAttachment<DefaultUIOptions>;
```

`createDefaultBrailleUI()` 的 standalone host 必须是普通 light-DOM 渲染容器：没有 child node、未被另一 UI attachment 占用，且自身不是 shadow host。可观察到 `host.shadowRoot !== null` 时立即抛 `UI_HOST_CONFLICT`；closed Shadow Root 无法由 Web 平台从 host 反查，因此“不得传入已有 closed root 的 host”是明确的宿主前置条件，违反时属于 unsupported integration，library 不承诺可见性或可访问性。通过校验后只在 host 的 light DOM 中创建并独占本次节点；不创建 Shadow Root，也不删除宿主原有内容。重复挂载、非空 host 或 open-shadow host 都抛 `UI_HOST_CONFLICT`。detach 只移除本 attachment 创建的节点、监听与 group membership，不 destroy controller、外部 `ActivationGroup` 或 `KeyboardBindingSource`，并允许清空后的普通 host 重新挂载。Web Component 则由自身构造器创建一个 open Shadow Root，使用同一内部 renderer 并对相应节点设置真正的 `part` token。

`messages` key、parts/token 和 CSS 自定义属性属于公开 UI surface，变更遵循语义化版本。六键测试只有在提供 `keyboardBindings` 时显示；Web Component 必须传入自身 `KeyboardAttachment`，独立集成由宿主传入。`chordTestTimeoutMs` 默认 10,000，合法范围 1,000–60,000；`chordTestCodes` 若提供，必须恰好按点 1–6 各引用一个当前有效 code，否则更新原子失败。1.0 不支持密码自动目标；未来 sensitive facade 必须统一控制 UI、事件和订阅，不能只依靠本 options。

### 18.2 Keyboard Chord Test

测试必须由用户点击“开始六键测试”显式启动。默认 keyMap 提示“同时按住 S D F J K L，保持片刻后全部释放”；自定义 keyMap 从 `keyboardBindings` 的有效快照为每个点选择一组实际 binding、显示其 code/可见标签并按该组判定。未提供 `chordTestCodes` 时，每个点按 code 字典序选择第一个有效 binding；提供时严格使用已校验的六项。若某点没有 binding，则隐藏兼容判定并提示先完成映射，不能继续显示固定 SDFJKL 结果。测试期间映射快照冻结，配置更新先取消本轮再刷新提示；测试维护当前 held set，并保存本轮出现过的最大同时按下集合 `maxConcurrentCodes`：

```text
S ✓  D ✓  F ✓  J ✓  K ✓  L ✓
6-key rollover: Supported
```

未检测全部六键：

```text
6-key rollover: Not reliably supported
Recommended mode: Sequential
```

判定规则：

1. 点击开始后进入 armed 状态，并按 `chordTestTimeoutMs` 设置超时，默认 10 秒。
2. 第一个目标 keydown 开始采样；每次 down/up 更新 held set。
3. 仅当某一时刻的 held set 同时包含全部六键，才记录 Supported。
4. 采样开始后全部已按目标键释放，或测试超时，结束本轮。
5. 六个键依次按过但从未同时处于 held set，不能判为 Supported。

结果仅代表当前键盘、连接、系统和浏览器的本次检测，不是永久硬件认证。自动化合成事件不能证明真实 rollover。测试与输入策略隔离，在通过 scope、IME 和修饰键安全过滤后独占目标键，不写入 pending cell 或编辑目标；测试结束后清空其 pressed 状态。若系统辅助技术或系统盲文输入接管按键，页面不能保证收到 SDFJKL/Space，必须提示改用 Sequential 按钮或关闭网页键盘捕获。

## 19. Web Component 草案

```html
<braille-input
  for="translation-source"
  input-mode="sequential"
  space-mode="braille"
></braille-input>
<textarea id="translation-source"></textarea>
```

| 属性         | 默认         | 说明                                  |
| ------------ | ------------ | ------------------------------------- |
| `for`        | 无           | 同一 DocumentOrShadowRoot 内的目标 ID |
| `input-mode` | `sequential` | 内置或已注册策略 ID                   |
| `space-mode` | `braille`    | `braille`、`ascii` 或 `event`         |
| `keyboard`   | `on`         | 枚举属性：`on` / `off`                |
| `numpad`     | `on`         | 枚举属性：`on` / `off`                |
| `disabled`   | 不存在       | 标准布尔属性                          |
| `debug`      | `off`        | 枚举属性：`on` / `off`；demo 显式开启 |

`keyboard`、`numpad` 和 `debug` 不使用“默认 true 的布尔属性”，避免 `keyboard="false"` 仍被 HTML 解释为存在。非法枚举值回退默认值并发出配置警告。

`for` 只在组件自身的 `getRootNode()` 范围内解析，不能隐式穿越 Shadow Root。复杂或跨 root 集成通过**可写且不反射为 attribute** 的 `target: HTMLElement | null` JavaScript property 传入目标；非 null `target` 优先于 `for`，设回 null 后恢复解析 `for`。

组件分别维护 requested target 描述、最近成功 applied 的 attribute 值和实际 `boundTarget`。更换目标时先验证新目标、同一 realm/ownerDocument 和占用状态，再原子释放旧绑定；失败时保留旧绑定并派发脱敏 `braille-error`。已有成功绑定后，任何不能应用的 `for` 更新都同步回滚到最近 applied 字符串；初次连接时目标尚不存在则保留请求、保持 unbound，并在相关 DOM 变化后重试。当 `pendingDots` 非空或 `awaitingRetry=true` 时，拒绝改变目标对象身份并报告 `INVALID_ACTION`：JS `target` setter 抛异常且 getter 仍返回旧对象，attribute/property 都不保存新的 deferred 身份请求。目标类型不支持或在同一注册表中已被其他控制器占用时不启用新自动写入。primitive 属性更新通过对应 controller/adapter 的原子 `updateOptions()`，对象 property 不做字符串反射。

组件 disconnect 时立即 detach 键盘/目标监听、清 pressed、取消 Chord 并释放目标占用；Sequential pending 和 awaiting-retry 可随同一元素实例保留，但选择书签失效。reconnect 只有重新解析到同一个 HTMLElement 对象时才可保留 pending；目标身份变化时继续冻结并要求显式放弃，绝不能把旧 Cell 自动写入新目标。组件连接期间同时观察 `for` 的 resolution root 与 property target 所在 root/连接状态的相关 child/id 变化，并在 microtask 中重解析；每次 dispatch 和写入前仍同步重验对象身份和连接状态。旧 boundTarget 被替换时立即 detach/release：同一对象恢复连接可恢复绑定；新对象且无 pending 时原子绑定；新对象且有 pending/retry 时 `boundTarget=null` 并冻结，待宿主显式放弃后按仍存在的 `for` 请求重新解析，property target 则必须重新赋值。重新校验配置、目标和占用后才恢复，断开/未绑定期间不输出。显式 `destroy()` 清空全部状态且不可重连。

组件内部维护先于 controller dispatch 的 `bindingSuspended` gate 与递增 suspension token：初次未绑定、目标断连/身份变化或 pending/retry 阻止重绑时先同步置为 suspended、清 pressed，并停用键盘、指针、默认 UI 的 dot/Space/commit/command 入口；这些输入只产生稳定的本地不可用反馈，不派发 `BrailleInputAction`、OutputAction 或 output 事件。暂停期间只允许显式“放弃”调用 `cancelPending()`，以及 reset/disable/destroy 等生命周期操作；Cell 清空且目标重新验证、绑定成功后才恢复先前期望的 enabled/activation 状态。每个 DOM 写事务捕获 token，并在 `beforeinput` 返回后及 mutation 紧前再次核对；token 或目标身份变化时不再 mutation，按 conflicted 结束。资源 detach 可以在当前回调后完成，但 suspension 必须同步生效，防止无 sink 的 unhandled 路径消费旧 Cell。

默认类入口只导出 `BrailleInputElement` 与幂等的 `defineBrailleInput(tagName?)`；主包和 SSR-safe 入口不得求值 `HTMLElement` 子类或自动注册。`web-component`、`default-ui`、`auto-register` 与 IIFE 明确为 browser-only 子路径；独立 auto-register 入口仅在 `customElements` 可用且标签未定义时注册，若同名已有不同构造器则报告清晰错误而不覆盖。SSR fixture 只要求 main/core 及声明为 SSR-safe 的无副作用 adapter 入口可导入，并验证 browser-only 子路径会给出文档化的条件导出/环境错误，而不是误称全部 subpath 都可在 Node 求值。

Web Component 不向 Shadow Root 注入 `<style>`、`style` 属性或运行时 CSS 字符串。默认样式由导出的外部 `default-ui.css` 通过 `data-braille-ui-root`、standalone part token、Web Component `::part()` 和继承的 CSS 变量提供，宿主通过普通 `<link rel="stylesheet">` 或自己的构建管线加载；未加载样式时组件只承诺语义与键盘操作仍可用，不承诺对比度、目标尺寸、焦点/活动态视觉等完整可访问性。IIFE 也必须单独加载该 CSS。这样 strict CSP 集成不需要 nonce 或隐藏的 style API，并用 `style-src 'self'`、无 `unsafe-inline` 的 fixture 验证。

```ts
export class BrailleInputElement extends HTMLElement {
  target: HTMLElement | null;
  eventComposed: boolean;
  registerStrategy(factory: BrailleInputStrategyFactory): () => void;
  destroy(): void;
}

export function defineBrailleInput(
  tagName?: string,
): typeof BrailleInputElement;
```

自定义 strategy 必须先通过组件的 `registerStrategy()` 注册，之后才能把 `input-mode` 设为对应 ID；未知 ID 保留旧 mode、把 attribute 回滚到最近成功值并报告错误。注册实例归组件 controller 所有，disconnect 不注销，显式 disposer 遵守“active 时拒绝”，组件 destroy 时统一销毁。

## 20. 可访问性

加载 bundled `default-ui.css` 的默认 UI 以 WCAG 2.2 AA 为工程目标；所有适用的 A/AA 成功标准都必须通过。宿主若替换或覆盖视觉 CSS，必须对其最终呈现重新验证对比度、target size、focus/active 状态、reflow 和 forced-colors 等视觉标准，不能沿用默认组件证据。自动工具 severity 只用于分诊，任何 severity 的真实 violation 都阻断发布；false positive 必须留证，incomplete 必须人工判定，自动扫描通过不等于宣称完整合规。

- 所有可操作控件可通过键盘到达；不可操作状态必须可感知，且禁用过程中不能造成意外焦点丢失。点按钮使用 `aria-pressed`。
- 点 1–6 有可本地化名称。
- 点按钮可声明 `aria-keyshortcuts`，但不得以该属性代替可见键位说明。
- 普通状态使用节流后的 `polite` live region；只有阻断当前操作的错误可用 `assertive`。用户可以选择 quiet 模式，但仍需有可感知的提交、失败和模式反馈。
- 每次 toggle 立即更新视觉状态；不得默认逐点高频播报，也不得只朗读盲文字符本身。
- Preview 有文本替代，例如“当前点 1、2、4，预览 U+280B”。
- 焦点清晰，状态不只依赖颜色。
- 正文对比度至少 4.5:1；大文本、控件边界、活动点和焦点视觉变化至少 3:1。
- 点按钮至少 24×24 CSS px，默认触摸布局建议不小于 44×44 CSS px。
- 支持 `prefers-reduced-motion`、`forced-colors`、200% 文本缩放、400% 页面缩放/320 CSS px reflow，以及 WCAG 1.4.12 覆盖值：行高 1.5 倍、段后距 2 倍、字距 0.12 倍、词距 0.16 倍且无内容/功能损失。
- 六键测试提供文本结果。
- 默认 UI 内部控件的 Space/Enter 激活由控件自身处理并停止进入编辑目标键盘适配器，避免“按钮 click + Cell commit”双重执行。
- 初始 locale 至少包含 `zh-CN` 与 `en`；所有默认文案通过 `messages` 提供。未知 locale 回退 `en`，局部 messages 缺 key 回退所选 locale 默认值，插值按文本处理不得注入 HTML；动态切换 lang/messages 后立即更新可见名称但不重置输入状态。`lang` 不改变盲文编码。
- 屏幕阅读器浏览模式或系统快捷键拦截导致键盘事件不可用时，点按钮和 Sequential 指针操作仍能完成全部功能。
- 焦点顺序与视觉顺序一致，焦点不得被工具栏、弹层或滚动容器遮挡；activation scope 不形成键盘陷阱。
- RTL 本地化只调整文字与外围布局，点 1–6 的 Braille Cell 空间位置不得意外镜像。
- M4 人工矩阵至少包含 NVDA + Firefox、NVDA + Chrome、Narrator + Edge、VoiceOver + macOS Safari、VoiceOver + iOS/iPadOS Safari 和 TalkBack + Android Chrome；产品、OS、设备与辅助技术的确切版本、日期和结果写入每版证据。M3 自动化 alpha 可以把这些项保留为 `pending`，不得伪造人工结果。
- 只有在所有者决定创建 1.0 stable GitHub Release 时，才要求由盲人或熟练使用屏幕阅读器/盲文输入的目标用户按版本化测试脚本完成核心任务评估。核心任务至少包括：发现并理解控件、用 Sequential 组成/纠正/确认 Cell、插入所选空格、删除目标文本、从 rejected 输出中重试或放弃、在 conflicted 提示后检查目标并安全继续、完成六键测试并在失败时改用按钮、切换模式后继续在原目标输入。每项预先定义成功条件、允许提示、完成时限和数据丢失/错目标判定；报告记录参与者角色、发现分级、候选 commit 与 GitHub Release 资产 SHA-256，影响相关 surface 的后续改动必须重测。

“阻断问题”包括无法完成核心任务、写错目标/重复输入/数据丢失、键盘陷阱、适用 WCAG A/AA 失败、敏感数据或 secret/credential 泄露、许可证不兼容，以及未修复的 high/critical 漏洞。可选 stable GitHub Release 对这些类别一律不得豁免；自动工具 false positive 只有在证明并非真实失败后才可关闭，不属于豁免。其他不影响验收的已知限制才可由项目所有者 `xiyaofeng` 并参考对应领域意见后批准临时例外，并记录责任人、理由、到期日、残余风险和复测条件。

## 21. 兼容性与边界

必须处理 repeat、Chord rollover 不足、缺失 keyup、pointercancel、Num Lock、同点多键、无关键、后台切换、Enter/NumpadEnter 区分、Space 上下文语义和切换模式时的 pending cell。

为降低个人实验项目的维护面，初始版不承诺旧浏览器；以 2026-08-21 核对的当时稳定主版作为最低声明与验证基线：Chrome/Android Chrome 151、Edge 151、Firefox 154、Safari 26.6 及 iOS/iPadOS 26.6.1 上的 Safari 26.6。以后的发布候选必须在当时稳定版重验，不得因为版本号高于此表就自动宣称兼容。消费者 Node 下限为 `22.12.0`，TypeScript 声明文件下限为 `5.7`；开发工具链按 25.1 执行。

初始 M4 人工验证矩阵冻结如下，“系统内置”仍必须在证据中记录完整 OS build 和实际辅助技术版本：

| 环境                   | 浏览器                  | 辅助技术           | 最低人工覆盖                                      |
| ---------------------- | ----------------------- | ------------------ | ------------------------------------------------- |
| Windows 11 25H2        | Chrome 151、Firefox 154 | NVDA 2026.1.1      | Sequential 核心任务、键盘捕获、编辑目标、六键回退 |
| Windows 11 25H2        | Edge 151                | 系统内置 Narrator  | 同上                                              |
| macOS Tahoe 26.6.2     | Safari 26.6、Chrome 151 | 系统内置 VoiceOver | 键盘、指针、编辑目标、Shadow DOM                  |
| iOS/iPadOS 26.6.1 真机 | Safari 26.6             | 系统内置 VoiceOver | 触控、reflow、软键盘/外接键盘边界                 |
| Android 16 真机        | Chrome 151              | TalkBack 17.0      | 触控、reflow、外接键盘边界                        |

Playwright 使用锁定的自带浏览器 revision 并记录 revision，用于 M3 自动化；它不替代上表品牌浏览器、真设备或辅助技术证据。

- `preventDefault()` 严格遵守 14.5 的三态表，任何模式都不阻止 scope 外、未映射、IME 或系统快捷键。
- 优先使用 `KeyboardEvent.code`。
- 从 `compositionstart` 到 `compositionend` 不接受新的键盘点位；`event.isComposing=true` 的新 down 始终忽略，但已追踪 inputId 的 up/cancel 仍先释放。compositionstart 取消进行中的 Chord。
- 默认忽略带 `Ctrl`、`Meta`、`Alt` 或 `AltGraph` 的事件，避免劫持系统、浏览器和辅助技术快捷键；Shift 可由 `keyboardFilter` 配置是否允许。
- 只有当前 activation scope 内的已启用目标处理映射键。来自默认 UI 按钮、六键测试和其他表单控件的事件不再进入编辑目标键盘适配器。
- Sequential 忽略 repeat，并用 `pressedInputIds` 保证一次按压只 toggle 一次。
- window blur、visibilitychange、scope 失焦、pointercancel、lostpointercapture 和 destroy 清理相应按压态。
- Chord 失焦取消未完成和弦。
- 模式切换默认取消 pending cell 并发出状态变化；宿主可先提交。
- 无关键不加入 Cell，也不导致 Chord 提前提交。
- 六键测试失败只建议 Sequential，不强制切换。
- library-managed adapter 在同一 realm、同一包注册表内保证一个编辑目标最多绑定一个活动控制器；第二次绑定抛出 `TARGET_ALREADY_ATTACHED`。多个包副本或自定义 sink 不作全局保证。
- 移动软键盘可能不产生稳定 `code`；移动端主要可用路径是标准按钮/指针 UI，外接键盘另做真机测试。

按住盲文键后再按 Ctrl/Meta、启动 IME、隐藏页面或离开窗口，随后释放的序列都必须有自动测试，确保已有 inputId 被释放且不提交残缺 Chord。已映射键的 repeat 虽然不改变状态，仍可按 `preventDefault='handled'` 阻止浏览器插入重复字符。

## 22. 测试计划

### 22.1 Unicode

- 64 种组合全部对应 `U+2800–U+283F`。
- 顺序不影响编码，重复点只计算一次。
- 非法点被拒绝。
- 空集合编码为 U+2800，但普通 commit 不隐式提交空 pending cell。
- U+2800 被验证为 BRAILLE PATTERN BLANK，而不是 U+0020 或 Unicode whitespace；复制、搜索和换行测试不得把两者混同。

### 22.2 Sequential

- 默认模式为 sequential。
- `F→D→J`、`J→F→D`、`D→J→F` 都得到 `{1,2,4}` 和 `⠋`。
- 同一点按两次恢复未选中。
- 默认 `preventDefault='handled'` 下 mapped key repeat 不二次 toggle，且仍阻止浏览器插入重复字符；`never` 例外单独测试双写警告。
- 每次选择立即更新 dots 和 preview。
- Space/NumpadEnter 在 pending 时提交；accepted/unhandled 清空，rejected 保留并冻结，conflicted 清空并提示检查。
- Enter 不误判为 NumpadEnter。
- 取消最后一点后 preview 为 null。
- 确认前不修改目标。
- 当前点位来源被移除后 `pendingSources` 同步更新，确认键来源只进入 `triggerSource`。

### 22.3 Space

- pending 时 Space 优先提交。
- 空状态 braille 输出 U+2800。
- 空状态 ascii 输出 U+0020 TextOutput。
- 空状态 event 只派发事件。
- 空状态 NumpadEnter 无操作。
- 空状态点击默认 UI 确认按钮无操作，不输出 U+2800。
- 各分支只派发一次事件。
- 删除/修改 `commitKeys` 不影响独立 `spaceKey`；Space、确认和命令 repeat 符合固定规则。
- `numpad=false` 同时禁用 Numpad 点键和 NumpadEnter。
- `reason='space'` 的 U+2800 rejected 不创建 awaiting-retry 或伪造 pending Cell，重新按 Space 才产生新尝试。

### 22.4 Chord

- 仅显式选择 chord 才启用。
- 单键释放提交一次。
- 多键不同按放顺序提交一次并集。
- 第一个 keyup 不提交，全部释放才提交。
- repeat 不重复输入。
- 失焦取消不提交。
- 相邻和弦不共享点位。
- 主键盘与小键盘映射一致。
- sink rejected 后进入 awaiting-retry，新和弦被阻止；连续拒绝、重试成功、放弃、reset、disable、模式切换和 destroy 都有确定结果。
- modifier/IME 在 keydown 后出现时，已追踪 keyup 仍释放且不产生残缺提交。

### 22.5 输出流水线和配置

- 一个控制器不能同时安装两个 output sink；disposer、`clearOutputSink(expected)`、身份不匹配和清除后安装新 sink 都有测试。
- 一次输入最多生成一个 OutputAction，自动写入与通知事件不会造成双重插入。
- `spaceMode=braille` 通过统一输出流产生 dots 为空的 BrailleCommit。
- Cell sink accepted 后按“清状态、statechange、output notification”顺序执行；Text/SpaceIntent/Command 不误清已有 pending。
- Cell sink rejected 时保留并冻结 pending，不派发标准 input；非 Cell rejected 不伪造可重试 Cell。
- Cell conflicted 时清空且不得重试；非 Cell conflicted 不清无关 pending，所有 conflicted 只允许检查目标提示。
- 无 sink 或 sink 明确返回 `unhandled` 时 delivery 为 unhandled；只有该分支允许通知作为唯一消费入口。
- sink 抛错固定产生 conflicted、`OUTPUT_SINK_ERROR` 并 fault；返回 thenable/非法值产生 conflicted、一次 protocol violation 并 fault。faulted sink 禁止再次调用、重入 dispatch、写入后监听者抛错和多 listener 隔离都有顺序测试。
- 覆盖“非 Cell 协议违规→sink faulted→下一 Cell 固定 rejected/frozen→clear→无 sink retry unhandled”，并断言 `outputSinkState` 的 empty/ready/faulted statechange 与每次后续 `OUTPUT_REJECTED`。
- keyMap、spaceKey、commitKeys、commandMap 冲突会在初始化和更新时失败。
- `updateOptions()` 失败完整回滚；成功更新时 pressed/Chord/pending 行为符合契约。
- `toggleDots=false` 时重复选择为无操作。
- 未注册策略、重复策略 ID、`extensionId()` 的大小写/格式/保留 namespace/长度边界和非法属性值产生稳定错误码。
- 自定义策略贡献模型覆盖有序 get/full-set、surviving/new/re-added ID ordinal、同一点多来源、移除后重算来源和 Chord keyup 保留 contribution；不能输出不一致 char/mask/dots/codePoint、不能一次 action 请求两次输出，也不能跨 controller 共享实例。
- 自定义策略的 controller-owned 草稿在异常、非法 contribution 或重复输出请求时完整回滚；首次 request 封存输出草稿，之后 set/request 失败，覆盖 `set(A)→request→set(B)`。reset context 可在非终局 reason 修改 contribution 但不能输出，强制取消 reason 最终必为空。custom handle/reset fault、old deactivate fault、new activate fault 与确定性 Sequential fallback 分别覆盖；fallback 前清 pressed/contribution/Chord/retry，所有 built-in method 不抛。活动 strategy disposer 被拒绝，切换、各 StrategyResetReason、非活动注销和 destroy 的受限 context/hook 顺序及 hook 异常逐项验证。
- `cancelPending` 只由 controller 消费，不调用 strategy 的 `requestCommand()`、不生成 `CommandOutput`，也不触发 editable 命令。

### 22.6 生命周期和键盘安全

- blur/hidden 保留 Sequential pending、清 pressed，并取消 Chord。
- reset、destroy、disable 的行为符合生命周期矩阵；destroy 只发一次最终 statechange，此后无事件。
- 模式切换取消 pending，且不会隐式提交。
- composition 期间和 `event.isComposing` 不接受新点位，但已追踪 release 必须处理。
- Ctrl/Meta/Alt/AltGraph 快捷键不被拦截。
- `focus` 使用 HTMLElement scope 或显式 ActivationGroup；Document/ShadowRoot 无 group 且未选择 manual/always 时拒绝，page/root 级监听不能被默认开启。
- 同一 controller 的多个 keyboard/pointer attachment 生成不同 opaque attachment ID，任一 attachment 的 up/cancel 不会释放另一 attachment 的 pressed input。
- 共享 ActivationGroup 的 target/UI/toolbar 组内移动保留书签和输入状态；未共享时不猜测邻接。覆盖 HTMLElement 自动注册、Document/ShadowRoot 不作为 member、同元素重复 add/部分 token dispose、wrong-document member、group destroy 后 attachment inactive，以及 activationGroup 热更新零副作用拒绝/重新 attach 恢复。
- 默认 UI 控件的 Space/Enter 不产生额外 Cell 提交。
- 多控制器绑定同一目标被拒绝，解绑后可重新绑定。
- editable attach 在已有 pending/retry 时拒绝；public detach 取消当前 Cell 后释放 sink，不能把旧 Cell 留给下一目标。
- 点击默认 UI 后仍能恢复原编辑目标和选择区。
- destroy、attachment detach 和所有 disposer 幂等；disconnect/reconnect 后无残留监听、目标占用或延迟输出。
- 任意 down/up/cancel/blur/hidden/disable/reject 序列均不产生 stuck input、非法点位或重复输出。

### 22.7 编辑目标

- 测试原生输入各位置插入、替换选择区、grapheme 删除和选择区恢复。
- 覆盖 textarea、允许的 input type、空/单 Text child contenteditable、readonly、disabled、已断开目标和不支持类型；password 必须稳定拒绝。
- 验证 `insertText`、`insertLineBreak`、`deleteContentBackward` 的 beforeinput/input。
- beforeinput 取消且目标未变化时不写入、不派发 input；仅 `reason='cell'` 保留并冻结 pending，其他输出不创建重试状态。监听器改 value/DOM/selection 时 delivery 为 conflicted、Cell 清空且不得重试，覆盖监听器已经插入相同字符的重复输入回归。
- React 受控输入和复杂编辑器使用唯一 output sink，不走 DOM 自动写入。
- 真实浏览器覆盖空/单 Text contenteditable、emoji、ZWJ、旗帜、组合附加符、CRLF、双向文本、Shadow Root 和 stale bookmark；多个 Text node、嵌套节点、`<br>`、comment 与跨 host selection 在 attach 时稳定 `UNSUPPORTED_TARGET`。合法 attach 后 DOM 退化时零副作用 rejected；Cell 保留/冻结并显示重试或放弃，不能猜测 Range 映射或用 unhandled 静默清空。
- `maxLength` 在 beforeinput 前按 UTF-16/textarea LF 归一化预检；使长度继续增加的超限动作 rejected、不截断、不派事件，替换选区刚好等于边界可成功。覆盖脚本写入既有超长值和动态调低 maxLength 后的删除、不增量替换可继续，增长仍拒绝。单行 input 和 contenteditable 的 lineBreak 为 unhandled，textarea 才执行。
- beforeinput 监听器同步修改 DOM 后安全返回 conflicted；合成事件 `isTrusted=false`。默认 `handled` 与 `always` 下 mapped F/D/S/J/K/L 不会同时插入原拉丁字符；显式 `never` 是宿主接受双写风险的例外，必须产生 `DOUBLE_WRITE_RISK`，连接 UI 时再显示可感知警告。
- 选择区、beforeinput、焦点、Pointer Capture 和 Shadow DOM 不能只用 DOM 模拟器验收。

### 22.8 默认 UI、指针和六键测试

- 每次 toggle 立即更新点亮状态、排序 dots 和 preview。
- accepted/unhandled 提交后全部清空；rejected 保留；conflicted 清空并显示不可重试检查提示；清除 current cell 不删除已提交输出。
- 多 pointerId、pointer capture、pointercancel、lostpointercapture 和 touch-action 行为正确；正常 pointerup 后的 lost capture 不重复 cancel。
- 键盘/辅助技术 click 只激活一次，真实 pointer 后续 click 不会二次 toggle。
- 六键测试与输入隔离，只有 maxConcurrentCodes 同时包含六键才显示 Supported。
- 六键依次按下不能通过；超时和测试结束会清理状态。
- 六键测试只在绑定 `KeyboardBindingSource` 后显示；默认映射选中 SDFJKL，自定义/禁用映射、显式 chordTestCodes、非法六项、运行中映射更新和 1,000–60,000 ms 超时边界均有测试。
- 模式切换后 UI 与引擎一致。

### 22.9 Web Component、浏览器与无障碍

- 验证 `for`、`target`、同 root 查找、Shadow Root 隔离和目标缺失错误。
- 验证 pending 时 `for` 修改回滚、target setter 保留旧值、connected target 被同 ID 新对象替换、boundTarget 断连/同对象恢复、discard 后 for 重解析和 property 重新赋值；binding suspended 后 dot/Space/commit 均不 dispatch/输出，discard→rebind 后才恢复。beforeinput 期间 suspension token 改变必须阻止 mutation 并产生 conflicted。
- 验证 `keyboard/numpad/debug` 的 on/off 枚举和属性/property 优先级。
- Web Component 自定义 strategy 先注册后切换，active disposer、disconnect 保留和 destroy 所有权正确；standalone 非空、重复或已有 open Shadow Root 的 UI host 报 `UI_HOST_CONFLICT`，closed-shadow host 前置条件写入集成测试说明，detach 只清自身资源。
- 浏览器、OS、设备和辅助技术结果写入版本化兼容矩阵，列出确切版本、测试日期和结果，不使用“当前两个版本”等浮动描述。自动化使用固定版本，发布前另测当时稳定版。
- 桌面至少覆盖 Windows 的 Chrome/Edge/Firefox 与 macOS 的 Safari/Chrome；移动覆盖 iOS/iPadOS Safari 与 Android Chrome，并记录真实外接键盘、Num Lock 和系统盲文输入接管结果。
- 覆盖鼠标、触摸、触控板、200% 文本缩放、400% 页面缩放、320 CSS px reflow、`forced-colors`、仅键盘和屏幕阅读器。
- 屏幕阅读器能获得当前点位、预览、模式和六键测试文本结果。
- 自动扫描的所有真实 A/AA violation 均为零，任意 severity 的 false positive 有证据、incomplete 已人工判定；人工矩阵和目标用户任务测试无阻断问题。

### 22.10 质量、包与回归门禁

- Core 在纯 Node、无 DOM globals 环境执行；编码器 64 组合全覆盖，核心状态机分支覆盖率不低于 90%，下列关键状态转换 100%。
- 关键转换清单：Sequential inactive↔active、最后一点→空；Cell accepted/unhandled→清空、rejected→awaitingRetry、conflicted→清空/检查、retry accepted/rejected 与 discard；Chord idle→pressed→all-released→delivery 及 cancel；enabled↔disabled；每种生命周期操作按 13.1 清理；mode switch old deactivate→new activate/fallback；active→destroyed 最终态；sink empty→ready→faulted→empty；target attached→detached/reconnected-same/identity-rejected。新增关键状态时必须先更新本清单和 `docs/requirements-to-tests.md`，不能仅靠覆盖率百分比判断。
- 使用模型/性质测试生成任意动作序列，持续验证快照不可变、点位合法、一次事务最多一个输出、reset/destroy 无后续输出、相邻 Chord 不串状态。
- `test:package` 针对实际 `npm pack` tarball，在干净 fixture 验证 Node ESM、CommonJS、TypeScript declarations、SSR-safe 入口、browser-only 条件错误、浏览器模块、IIFE 和所有 `exports` 子路径的各自声明环境。
- packed consumer matrix 覆盖声明的最低 Node/TypeScript 与当前受支持版本；真实 bundler fixture 证明只导入 core 时不包含 CSS/UI/DOM adapter、不注册 Custom Element、不读取 DOM，未引用的 UI/adapter 可被 tree-shake。
- 所有公开示例在 CI 编译并至少运行一次；DOM 事件、TypeScript 类型、CSS parts/messages key 和错误码有契约测试。
- 浏览器失败保存 trace、截图、版本和设备信息；重试后通过仍标记 flaky，禁止无限重试掩盖失败。
- 真六键 rollover 与屏幕阅读器结果必须来自人工硬件记录，不能由合成键盘事件替代。

## 23. 验收标准

1. **AC-01** 默认模式为 Sequential，而不是 Chord。
2. **AC-02** Sequential 允许乱序选择，重复选择可取消。
3. **AC-03** 每次点位变化实时更新 UI 和 Unicode 预览。
4. **AC-04** pending 时 Space/NumpadEnter 正确提交；accepted/unhandled 清空，rejected 进入可恢复状态，conflicted 清空并禁止自动重试。
5. **AC-05** 空状态 Space 按 `spaceMode`；默认输出 U+2800。
6. **AC-06** Enter 与 NumpadEnter 不混淆。
7. **AC-07** 64 种组合正确，BrailleCommit 只含 `U+2800–U+283F`。
8. **AC-08** Chord 作为可选模式在全部释放后只提交一次。
9. **AC-09** 默认 UI 有与输入隔离、基于当前有效键组的六键测试；默认键组是 SDFJKL。
10. **AC-10** 策略接口允许 Latch 或自定义策略，并能提供每个 dot contribution 的来源。
11. **AC-11** 核心可在无 DOM 环境测试且不依赖默认 UI。
12. **AC-12** 能接入受支持原生目标和复杂编辑器自定义 sink。
13. **AC-13** 禁用、失焦、切换模式或销毁后无卡住状态。
14. **AC-14** 引擎不包含语言、数字、数学或音乐盲文翻译。
15. **AC-15** 文档和 UI 明确区分 SDFJKL 惯例与本项目 Sequential/Numpad 设计。
16. **AC-16** 按 25.2 固定口径，core + 无样式 adapters ≤10 KB，默认 UI JS+CSS ≤20 KB，完整 IIFE ≤30 KB，且无运行时依赖；预算变更必须先有基准证据和 ADR，不能静默取消门禁。
17. **AC-17** 所有适配器通过统一 `BrailleInputAction` 进入当前策略，不在 UI 中复制模式判断。
18. **AC-18** 一个控制器最多有一个 output sink；合规 accepted/rejected/unhandled 分支不会因回调、DOM 事件或自动适配器重复写入，conflicted 明确停止补写并要求人工检查。
19. **AC-19** U+2800 与普通 Braille Cell 进入同一输出流，ASCII 空格和 space intent 有独立类型。
20. **AC-20** 生命周期矩阵、IME、修饰键、选择区恢复和配置冲突行为均有自动测试。
21. **AC-21** 六键测试只依据最大同时按下集合，不会把依次按键误判为六键并发。
22. **AC-22** Web Component 的目标解析、枚举属性、重连和多实例冲突行为符合文档。
23. **AC-23** Chord/Sequential 的 rejected Cell 都有可见重试或放弃路径，新输入不会覆盖待重试 Cell。
24. **AC-24** `Space`、普通确认键和命令映射相互独立，repeat、numpad 开关和运行时更新规则均有测试。
25. **AC-25** 实际 `npm pack`/GitHub Release tarball 可被 ESM、CommonJS、TypeScript、SSR、浏览器模块和 IIFE 消费，不依赖未声明深路径，也不要求安装者访问 npm registry。
26. **AC-26** 默认 `handled` 与 `always` 下 mapped keys 不会把原始拉丁字符误写入目标；显式 `never` 的双写风险有文档、稳定 warning diagnostic 和独立测试，连接 UI 时可感知呈现。
27. **AC-27** destroy、disconnect、重复 attach/detach 后没有监听泄漏、目标占用或延迟输出。
28. **AC-28** 简单编辑目标的复杂选择区、emoji/ZWJ、双向文本、stale bookmark 和 beforeinput 重入行为均有真实浏览器结果；超出自动适配范围或运行期 grammar 失效时稳定拒绝并保留 Cell，外部变更则 conflicted 且不重试。
29. **AC-29** 默认 UI 达到本文的 WCAG 2.2 AA 工程门禁，人工辅助技术矩阵与目标用户测试无阻断问题。
30. **AC-30** 可选 stable GitHub Release 的桌面与移动目标都有确切浏览器、OS、辅助技术、设备版本、日期、候选 commit、Release 资产 SHA-256 和结果；真实 rollover 不用合成事件代替。
31. **AC-31** 所有公开示例、事件顺序、类型、包入口、CSS parts/messages key 和安全脱敏规则通过契约测试。
32. **AC-32** `package.json.private` 始终为 `true`，不存在 `npm publish`、registry promotion 或 dist-tag 脚本；CI 对这些发布面回归直接失败。
33. **AC-33** M3 包含全部计划功能与自动门禁，所有未在真实环境执行的 M4 项明确标记 `pending`，不宣称 stable。

## 24. 项目里程碑

| 阶段                                          | 交付物                                                                                                                                 | 退出条件                                                                                                           |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| M0 Bootstrap                                  | Git `main` 仓库、`package.json`、lockfile、TypeScript/Vite/Vitest/Playwright/ESLint 配置、目录骨架、LICENSE、基础文档、CI 和可执行脚本 | 第 27.1 节决策全部落地；干净目录 `npm ci` 成功，M0 命令不是空壳                                                    |
| M1 Functional Core                            | Unicode、Controller、Sequential、Chord、Space/编辑命令、输出事务、sink 四态、自定义策略样例                                            | Node 单测、模型/性质测试、类型契约和覆盖率门禁通过                                                                 |
| M2 Browser Integration                        | Keyboard、Numpad、Pointer、editable、activation scope、生命周期与错误交付                                                              | 锁定 Playwright revision 的 Chromium/Firefox/WebKit 自动矩阵通过；无双写、卡键、stale selection 写错目标或监听泄漏 |
| M3 Feature-complete Alpha                     | 默认 UI、六键测试、Web Component、`zh-CN`/`en`、demo、全部公开入口、契约文档、自动无障碍/性能/体积/打包检查                            | `npm run ci:auto`、自动浏览器与 release-asset smoke 全部通过；M4 真机/AT/目标用户项明确为 `pending`                |
| M4 Human Validation & Optional GitHub Release | 品牌浏览器、真设备、辅助技术、真六键与目标用户测试；缺陷修复；可选 Git tag/Release 资产、哈希、SBOM 和证明                             | 所有者明确决定是否发 Release；若发 stable，第 20 节阻断问题为零，同一候选产物的证据完整                            |

React、Vue、Svelte 等框架薄封装不在 M3 范围。后续增加时必须复用 controller/adapter，不复制核心逻辑。

## 25. 发布与非功能约束

### 25.1 工具链与命令契约

项目使用 Node.js `24.19.0` LTS（Krypton）、npm `11.17.0` 和唯一 `package-lock.json`。`.node-version`、`package.json.packageManager` 与 CI 必须精确一致，`.npmrc` 设置 `save-exact=true`；所有直接 devDependency 不使用 `^`、`~`、`latest` 或未限定范围。若改用其他包管理器或主要工具链，必须先写 ADR，并原子更新 lockfile、CI、消费 fixture 和本节，不能并存多个 lockfile。

以下是项目固定的直接工具链；仅在实际功能需要时增加其他精确版本的 devDependency，并在 ADR 或 `docs/toolchain.md` 记录用途、版本和许可证。

| 用途             | 包 / 运行时                                   | 精确版本                       |
| ---------------- | --------------------------------------------- | ------------------------------ |
| 开发运行时       | Node.js                                       | `24.19.0`                      |
| 包管理           | npm                                           | `11.17.0`                      |
| 语言/类型        | `typescript` / `@types/node`                  | `6.0.3` / `24.13.3`            |
| 构建/声明        | `vite` / `vite-plugin-dts`                    | `8.2.2` / `5.0.3`              |
| 单测/覆盖率      | `vitest` / `@vitest/coverage-v8`              | `4.1.11` / `4.1.11`            |
| DOM/性质测试     | `jsdom` / `fast-check`                        | `30.0.1` / `4.9.0`             |
| 真实浏览器自动化 | `@playwright/test`                            | `1.62.1`                       |
| 自动无障碍       | `axe-core` / `@axe-core/playwright`           | `4.13.0` / `4.13.0`            |
| Lint             | `eslint` / `@eslint/js` / `typescript-eslint` | `10.8.1` / `10.0.1` / `8.67.0` |
| 格式化           | `prettier`                                    | `3.9.6`                        |
| 公开 API         | `@microsoft/api-extractor`                    | `7.58.13`                      |
| 打包契约         | `publint` / `@arethetypeswrong/cli`           | `0.3.24` / `0.18.5`            |
| 许可证           | `license-checker-rseidelsohn`                 | `5.0.1`                        |
| Markdown 链接    | `markdown-link-check`                         | `3.15.0`                       |
| gzip 体积        | `gzip-size`                                   | `7.0.0`                        |

TypeScript `6.0.3` 是与上表 `typescript-eslint` 同时满足 peer range 的固定版本，不得只为追求 registry 上更高的数字而打破该兼容组合。

```text
npm ci
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run test:dom
npm run test:browser
npm run test:a11y
npm run test:types
npm run test:package
npm run test:ssr
npm run test:performance
npm run size
npm run build
npm run check:links
npm run check:licenses
npm run check:security
npm run check:api
npm run build:demo
npm run ci:auto
npm run pack:release
npm run verify:release-asset
npm run verify:release-evidence
```

版本控制的 `docs/milestones.json` 是当前里程碑的机器可读来源，至少包含 `milestone`、启用的 suites、required status 名称和批准该提升的 ADR。`ci:auto` 不接受可绕过的降级参数，并按 manifest 固定顺序执行当前里程碑可自动化的 format、lint、type、unit/DOM/model/type contract、build、SSR、browser、a11y、packed-package、size、performance、API、security/license 和 link 门禁。CI 可以分 job 并行，但 required aggregator 必须覆盖同一集合；任何 job 都不得只因没有测试文件而零测试成功。

`pack:release` 只在本地从干净工作区构建第 25.4 节的可选 GitHub Release 资产和 `SHA256SUMS`，不访问 registry，不上传。`verify:release-asset` 必须解压实际 tarball，在干净 fixture 验证 Node ESM/CJS、TypeScript、SSR、浏览器模块、IIFE、CSS、demo 静态托管和所有 `exports` 子路径。`verify:release-evidence` 依据 `docs/release/evidence.schema.json` 校验 M4 报告；schema 至少包含 version、tag、commit、每个资产的 SHA-256、测试日期、环境完整版本、`pending|passed|failed`、已知限制、例外引用和所有者决策。该命令不伪装执行人工测试。

当前里程碑 manifest 启用的工程与契约脚本必须能从干净 checkout 在 `npm ci` 后执行。每个里程碑在 `docs/requirements-to-tests.md` 为全部规范性“必须/不得”条款及 AC 分配稳定 `REQ-*`/`AC-*` ID，并映射到测试文件、证据或明确的非测试验证理由，同时记录最小测试数和允许 skip 清单；文档 lint 阻止未映射的新规范条款。零测试成功、无理由 skip 或用 M0 空壳套件冒充 M1–M3 功能门禁一律失败。性质测试固定或输出 seed，失败保存最小化动作序列。格式化、lint、类型、测试和 build 不得隐式修改受版本控制文件；`prepack` 只允许构建，不能调用 `test:package`、`pack:release` 或 `ci:auto` 形成递归打包。

### 25.2 包与运行时

- `package.json` 的核心元数据冻结为：`name: "braille-input-engine"`、`version: "0.1.0"`、`private: true`、`author: "xiyaofeng"`、`license: "MIT"`、`packageManager: "npm@11.17.0"`，并填写 `repository`、`bugs` 和 `homepage` 指向 `xiyaofeng/braille-input-engine`。不使用 npm organization scope，不存在 `publish`、`release:npm`、dist-tag 或 registry promotion 脚本；CI 必须断言 `private === true`。
- 本地 tarball/GitHub Release 资产同时包含 ESM、CommonJS、浏览器 IIFE 和 TypeScript declarations；conditional `exports` 明确区分 core、adapters、default-ui、web-component、CSS 与 auto-register。
- `package.json.engines.node` 声明 `>=22.12.0`，README 声明 TypeScript `>=5.7`；packed-package CI 至少在 Node `22.12.0` 和开发 Node `24.19.0`、TypeScript `5.7` 和 `6.0.3` 消费 fixture 中执行。浏览器入口绑定第 21 节基线。
- ESM/CJS 使用不同扩展和条件，IIFE 文件名固定为 `braille-input.iife.min.js`、全局名为 `BrailleInput`，Web Component 默认标签为 `<braille-input>`；这些是公开兼容 surface。每个入口和共享 chunk 都纳入 packed-package 测试与 size 报告。
- Headless core 必须 SSR-safe：导入模块时不访问 `window`、`document`、`navigator` 或自定义元素注册表。
- core、无样式 adapters 和 Web Component 类入口可 tree-shake；CSS 与 auto-register 入口在 `sideEffects` 中准确声明。
- 默认 UI 样式提供独立 CSS 入口，以 host selector、公开 `::part()` 与 CSS 变量从 Shadow Root 外部应用；默认生产路径不运行时注入内联 `<style>`、`style` 属性或 CSS 字符串。严格 CSP fixture 只允许批准的外部 stylesheet，不启用 `unsafe-inline`。
- 不使用 `eval`、`new Function` 或内联脚本；不依赖远程 CDN；运行时依赖为零。
- 生成外部 source map 并随本地/GitHub Release 资产提供，便于自行部署者调试；map 不得包含密钥、绝对本地路径或 tarball 外的私有文件，并纳入 secret/path 扫描。
- 体积由版本控制的 canonical consumer fixtures 和 pinned minifier 测量；gzip 使用固定 level 9、mtime 0，shared chunk 在每个消费场景只计一次，UI 预算包含 CSS。core + 无样式 adapters ≤10 KB，默认 UI JS+CSS ≤20 KB，完整 IIFE ≤30 KB（均 minified + gzip，排除 map/`.d.ts`）。
- 版本控制的 `docs/performance-contract.json` 固定性能测试的预热次数、轮数、每轮动作数和阶段。每个场景先预热 200 次，再独立执行 5 轮、每轮 1,000 次动作；5 轮都必须满足 action→state subscription p95 ≤5 ms、action→默认 UI next paint p95 ≤50 ms。Long Task 只在无第三方脚本/扩展的隔离 fixture 中归因：动作 burst 期间不得出现由 library task 包含的 >50 ms entry。重复 100 次 attach/detach 与 connect/disconnect 后，instrumented listener/target registry 回到基线且无延迟输出。测试生成的设备、OS 和浏览器明细属于本地运行记录，不进入公开源码；GitHub CI 仍在每次运行中执行相同门禁并保留该次 workflow 日志与产物。样本口径或预算变更需 ADR。
- `build:demo` 输出可直接放入任意静态服务的 `dist/demo/`；默认不配置 GitHub Pages、CDN、后端或托管账号。`DEPLOYMENT.md` 至少说明 `git clone`、`npm ci`、`npm run build`、部署 `dist/demo/` 和直接从本地 tarball 安装的方法。

### 25.3 隐私与安全

- 项目根目录必须包含完整 MIT `LICENSE`，版权行固定为 `Copyright (c) 2026 xiyaofeng`；`package.json`、README 和 Release 资产的许可证标识与之一致。
- 默认不联网、不采集遥测、不持久化编辑内容或六键测试结果。Core 不读取目标；editable adapter 只在当前事务本地读取最小必要选择区和邻近 grapheme，随后丢弃。
- 生产 UI 默认 `debug=false`，不保存完整输出历史；1.0 的 library-managed editable/Web Component 目标拒绝 password。
- error/diagnostic detail、debug history、日志和 trace 不包含目标文本、选择区、原始 KeyboardEvent、DOM target 或未经脱敏的 `cause`。正常 state/output detail 按公开契约包含输入动作，集成方必须把它视为可由同页脚本观察的数据面。
- 自定义 strategy、keyboardFilter 和 sink 是受信任宿主代码，不构成安全沙箱；adapter 不根据外部 command 字符串执行任意属性或方法。
- `SECURITY.md` 必须明示“实验性、best effort、无 SLA”，并指定 GitHub Private Vulnerability Reporting 为首选渠道。创建公开仓库后由所有者在 Security 设置中手动启用；若尚未启用，公开 issue 只能请求建立私密联系，不得披露漏洞细节。不虚构电子邮箱。
- 受支持范围仅为当前默认分支和最近一个 GitHub Release（如有），且均为 best effort；旧版本、fork 和自行修改的部署不在支持范围。所有者可以随时停止维护或 archive 仓库，届时 README 和 `SECURITY.md` 必须如实标注；不承诺依赖更新周期、首次响应时间或修复时限。
- 从干净 checkout 和锁定依赖构建。开发依赖执行许可证、secret 与漏洞检查；可选 GitHub Release 生成 SBOM、SHA-256 和 GitHub artifact attestation。工作流使用最小 permissions，第三方 Action 固定完整 commit SHA 并在注释中标出 tag，不保存 registry token 或长期发布密钥。
- security/license/API 扫描器版本与失败阈值固定；真实漏洞、许可证不兼容或 API drift 阻断，网络暂时失败与真实死链分开重试/归类。只有第 20 节允许豁免的非阻断发现才能写入 `docs/exceptions.yml`，并包含责任人、批准人、理由、到期日和复测条件，过期即失败；许可证不兼容、secret/credential 或敏感数据泄露、适用 WCAG A/AA 失败及 high/critical 漏洞不得进入 stable 例外。

### 25.4 发布流程与兼容性记录

- 本项目的常态分发是公开 GitHub 源码，不存在 npm registry 发布、dist-tag、unpublish 或 registry provenance 流程。感兴趣的使用者自行 clone/fork、执行 `npm ci && npm run build`，然后托管 `dist/demo/` 或直接消费构建产物。
- GitHub Release 完全可选。若维护者决定发布，`pack:release` 必须一次性从确切 commit 生成下列不可替换资产：`braille-input-engine-vX.Y.Z.tgz`、`braille-input-demo-vX.Y.Z.zip`、`braille-input-engine-vX.Y.Z.spdx.json` 和 `SHA256SUMS`。GitHub 自动生成的 source archives 可同时保留。
- 发布 workflow 只能上传经 `verify:release-asset` 验证的同一组资产，使用 GitHub artifact attestation 绑定 repository、workflow、commit 和产物；公开仓库启用 GitHub immutable releases 后，已发布 tag 与资产不得覆盖。候选内容改变必须提升版本并重建、重验，不替换旧资产。
- GitHub Release 可标记 prerelease；只有 M4 全部人工门禁通过且阻断问题为零时，才能标记 stable。发现错误后保留原 tag/资产和公告，以新版本前进修复；不静默重写历史。
- 每个实际 GitHub Release 保存不可覆盖的 `docs/compatibility/vX.Y.Z.md` 与 `docs/a11y/vX.Y.Z.md`，列出确切浏览器、OS、设备、辅助技术版本、测试日期、候选 commit、每个资产 SHA-256、结果和已知限制；影响相关 surface 的后续改动使旧证据失效并要求重测。
- Playwright WebKit 不等于品牌 Safari，Chromium 不等于 Chrome/Edge；品牌桌面浏览器、iOS/iPadOS、Android、辅助技术和真实键盘证据必须来自对应真实环境。
- 公共兼容 surface 包括包入口、TypeScript 类型、默认配置、错误码、DOM 事件及顺序、Web Component 标签/属性/property、`data-braille-ui-root`、part token/CSS parts/变量、messages key 和最低浏览器基线。
- 维护 CHANGELOG；破坏性变更提供迁移指南。1.0 后遵循语义化版本并提升主版本；1.0 前也不得无记录破坏。
- tarball 包含 LICENSE、第三方许可证清单、README、最小集成示例、完整默认配置、兼容矩阵和已知限制。对实际 `npm pack` tarball 执行 package/SSR/size smoke，核对 `files`、`exports`、types、source map、CSS、许可证、SBOM 与哈希，而不是只测试工作区源码。
- CI 至少执行本节自动命令、平台矩阵和示例编译。如实际发布 GitHub Release，记录附 bundle/性能报告、自动化结果、人工无障碍证据、目标用户报告和真实六键测试记录。

## 26. 规范与参考项目

### 26.1 规范性依据

- [Unicode Braille Patterns U+2800 chart](https://www.unicode.org/charts/PDF/U2800.pdf)：点位、码位和字符名称。
- [Unicode 17.0.0 UnicodeData.txt](https://www.unicode.org/Public/17.0.0/ucd/UnicodeData.txt) 与 [PropList.txt](https://www.unicode.org/Public/17.0.0/ucd/PropList.txt)：固定 UCD 版本；验证 U+2800 的 General_Category 为 `So` 且不具有 `White_Space` 属性。升级 Unicode 版本时必须重跑编码与属性测试并更新本文。
- [W3C UI Events KeyboardEvent code Values](https://www.w3.org/TR/uievents-code/)：物理键位 code 与 Numpad code。
- [W3C Pointer Events Level 3](https://www.w3.org/TR/pointerevents3/)：多 pointer、primary pointer、capture、cancel、lost capture 与 `touch-action`。
- [W3C Input Events Level 2](https://www.w3.org/TR/input-events-2/)：`beforeinput`、`inputType` 和 cancelability。
- [WHATWG HTML Standard](https://html.spec.whatwg.org/) 及其 [`setRangeText()`](https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#dom-textarea/input-setrangetext) / [`maxlength`](https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#attr-fe-maxlength) 条款：编辑目标、UTF-16 长度、selection API、custom elements 与 Shadow DOM 行为。
- [ECMAScript Internationalization API](https://tc39.es/ecma402/#segmenter-objects)：`Intl.Segmenter` grapheme 分段。
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/) 与 [WAI-ARIA Button Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/button/)：默认 UI 的可访问性门禁与 toggle button 行为。APG 是实践指导，不能替代真实辅助技术测试。

### 26.2 执行、发布与版本基线依据

- [GitHub Immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases) 与 [Artifact attestations](https://docs.github.com/en/actions/concepts/security/artifact-attestations)：可选 GitHub Release 的 tag/资产不可覆盖和产物来源证明。
- [GitHub Private Vulnerability Reporting](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting)：公开仓库的默认私密漏洞报告渠道。
- [Node.js 版本与 LTS 记录](https://nodejs.org/en/about/previous-releases)、[Chrome Releases](https://chromereleases.googleblog.com/)、[Microsoft Edge Stable Channel release notes](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-relnote-stable-channel)、[Firefox 154 release files](https://ftp.mozilla.org/pub/firefox/releases/154.0/)、[Safari 26.6 Release Notes](https://developer.apple.com/documentation/safari-release-notes/safari-26_6-release-notes)、[NVDA releases](https://www.nvaccess.org/category/news/releases/) 和 [Google Play 的 Android Accessibility Suite/TalkBack 17.0](https://play.google.com/store/apps/details?id=com.google.android.marvin.talkback&hl=en)：第 21 节和 25.1 的 2026-08-21 版本快照。快照不替代发布时的实机版本记录。

### 26.3 参考实现与采用范围

以下链接和许可证状态于 2026-08-21 核对：

- [Gailbear/dots-editor](https://github.com/Gailbear/dots-editor)：只参考 SDFJKL 和弦生命周期；MIT。
- [UniversalDesignLab/react-native-braille-six-key-input](https://github.com/UniversalDesignLab/react-native-braille-six-key-input)：只参考六点触控布局和组件事件；`Package/package.json` 声明 MIT。
- [srynexx/braille-six-key-input](https://github.com/srynexx/braille-six-key-input)：只参考 Perkins-style 键位说明；未发现 LICENSE，不复制源码。

Sequential 默认策略、toggle、Space/NumpadEnter 确认、`7/4/1 + 8/5/2` 小键盘映射和默认 UI 均为本项目独立设计，不是上述项目提供的行业标准。本项目保留许可证核查记录，避免复制无许可证仓库源码；参考项目状态在每次主要版本发布前重新核对。

## 27. 项目决策与风险登记

### 27.1 项目决策

以下结论定义项目的公开边界。改变任何一项都必须新建 ADR、更新本文和对应自动门禁。

1. **项目与公开名称**：仓库为 `xiyaofeng/braille-input-engine`，本地包名为 `braille-input-engine`，不使用 scope；`package.json.private=true`，Web Component 标签为 `<braille-input>`，IIFE 文件为 `braille-input.iife.min.js`，全局名为 `BrailleInput`。
2. **许可证与版权**：使用 MIT License，版权主体为 GitHub 名称 `xiyaofeng`，固定版权行为 `Copyright (c) 2026 xiyaofeng`。
3. **工具链与兼容基线**：精确开发工具链按 25.1，消费者 Node `>=22.12.0`、TypeScript `>=5.7`，初始浏览器/辅助技术矩阵按第 21 节。默认带外部 source map，并执行路径/secret 扫描。
4. **分发、来源证明、安全与 EOL**：仅公开 GitHub 源码和可选 GitHub Release 资产，不上 npm、不配置 GitHub Pages；发 Release 时使用 SHA-256、SBOM、GitHub artifact attestation 和 immutable releases。漏洞首选 GitHub Private Vulnerability Reporting。项目为实验性/community-supported/best effort，无 SLA；只支持当前默认分支与最近 Release（如有），所有者可随时停止维护或 archive。

### 27.2 风险登记

| 风险                     | Owner               | 状态 / 最近复核       | 触发与缓解                                                             | 发布门禁 / 残余风险                                           |
| ------------------------ | ------------------- | --------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------- |
| 六键 rollover 不足       | Adapter/QA          | Open / 2026-08-21     | 真机缺键；默认 Sequential、显式六键测试                                | 真机记录且回退完成全部任务；硬件差异仍存在                    |
| 辅助技术/系统快捷键接管  | A11y                | Open / 2026-08-21     | 按键不到页面；不拦修饰键、可关闭捕获、按钮回退                         | AT/系统盲文模式矩阵；系统行为不可控                           |
| sink 双写或写后抛错      | Core/Integration    | Open / 2026-08-21     | 一次动作插入两次；单 sink、四态协议、事务测试                          | exactly-once 故障注入；不合规自定义 sink 仍由宿主负责         |
| stale Selection 写错目标 | Editable Adapter    | Open / 2026-08-21     | blur/重渲染使书签失效；写前身份与 selection 重验                       | 真实浏览器 stale bookmark；复杂编辑器只走官方 sink            |
| Pointer Capture 丢失     | Pointer Adapter     | Open / 2026-08-21     | pressed 未释放；cancel action、lostcapture 清理                        | 模型测试与触摸真机；UA 手势仍可能抢占                         |
| grapheme 删除损坏文本    | Editable Adapter    | Open / 2026-08-21     | emoji/组合字符拆分；Segmenter 或 unhandled                             | Unicode 删除向量；罕见新 grapheme 依赖 Unicode/runtime        |
| DOM 事件暴露输入动作     | Security            | Open / 2026-08-21     | ancestor 收到 state/action；披露数据面、diagnostic 脱敏、拒绝 password | 暴露面契约测试；同页受信任脚本仍可观察                        |
| 多格式产物入口漂移       | Release             | Open / 2026-08-21     | ESM/CJS/IIFE 行为不同；实际本地/GitHub tarball tests                   | 全部消费 fixture 与 size；宿主 bundler 差异记录为兼容性风险   |
| 浏览器撤销差异           | Editable Adapter/QA | Open / 2026-08-21     | 合成 input 不入 undo；复杂编辑器用官方 sink                            | 兼容矩阵记录；原生自动 adapter 仍是 best-effort               |
| 个人项目中止维护         | xiyaofeng           | Accepted / 2026-08-21 | 无法保证持续维护；README/SECURITY 明示实验性、无 SLA、允许 fork        | 停止时如实标记 unmaintained/archive；残余风险由自行部署者承担 |

## 28. 文档变更记录

- 0.4.0（2026-08-21）：按项目所有者决定冻结 MIT/`xiyaofeng`、`braille-input-engine`、`<braille-input>`、精确工具链和当前浏览器/AT 基线；改为 GitHub-only、无 npm 发布、无 SLA 的实验性项目；将 M3 定义为 feature-complete alpha，区分可自动验证与 M4 人工/真机证据，并以可选 GitHub Release 资产、哈希、SBOM、attestation 和 immutable release 取代 registry 晋级流程。
- 0.3.1（2026-08-21）：闭合 contenteditable 运行期退化、strategy reset/COW/fallback、faulted sink、maxLength、ActivationGroup、Web Component binding suspension、Shadow Root UI host 和 final-candidate registry 晋级契约；补齐对应测试与不可豁免门禁。
- 0.3.0（2026-08-15）：明确 Web/系统输入法边界；修复 sink 通知、rejected Chord、Space/commit、配置更新、策略不变量、错误交付、target property、隐私和浏览器矩阵冲突；补充工程命令、真实浏览器/无障碍门禁、发布与风险契约。
- 0.2.0：形成 Sequential/Chord、统一输出流、默认 UI 与 Web Component 初始草案。
