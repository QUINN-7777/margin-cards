# Margin Cards

Margin notes for Obsidian that float in the page gutter, aligned with the exact line you annotated — and your Markdown files are never modified.

Select text in Reading view, write a note, and a card appears in the margin beside it. Each card top lines up with its annotated line; cards that would overlap cascade downward; a short leader line points from the card back into the text.

**Nothing is ever written into your notes.** Every annotation lives in one JSON file at the vault root (`批注.json`). Your `.md` files stay byte-for-byte identical, so they keep syncing, diffing and version-controlling cleanly, and the annotations survive removal of the plugin.

<details>
<summary><strong>中文说明（点击展开）</strong></summary>

旁批插件：批注卡片浮在页边里，顶端和你批注的那一行对齐，而且**绝不改动你的 Markdown 正文**。

在阅读视图里选中文字、写下一条批注，卡片就出现在它旁边的页边里。卡片依次往下排，互不遮挡，并有一条短引线从卡片指回正文。

**正文一个字节都不动。** 所有批注存在库根的一个 JSON 文件里（`批注.json`）。你的 `.md` 文件保持原样，同步、比对、版本管理都干净；就算把插件卸载了，批注还在。

### 安装

Obsidian → 设置 → 第三方插件 → 浏览 → 搜索 **Margin Cards**。

需要 Obsidian **1.7.2** 或更高版本，**仅支持桌面端**（Windows / macOS / Linux）。移动端不支持，也未实测。

### 界面语言

界面是完整双版的 —— **中文和英文**都覆盖设置、弹窗、总览面板、提示消息和导出的批注清单。

- **跟随 Obsidian**（默认）：插件用 Obsidian 当前的语言（设置 → 通用 → 语言）。
- **锁定中文 / English**：在设置第一项「界面语言」里手动选一种，之后不再跟随 App。
- Obsidian 1.8.7 以下没有读取 App 语言的接口，「跟随 Obsidian」会退回用系统语言。

你的批注内容、分类名和笔记文字永远不会被翻译或改写，变的只是外面的标签。

### 用法

1. 在阅读视图打开笔记。
2. 选中一段文字 —— 旁边冒出一个小按钮（中文界面是「批注」，英文界面是 **Annotate**），点它。
3. 选分类、写批注、确认。批注里可以写 Markdown、笔记内链、贴图、网址。
4. 点卡片跳回原文；总览面板列出本篇（或整个库）的所有批注，点一条就跳过去。

同一句话批两次就是两条批注，每条都记得自己指的是**第几次出现**，所以重复的句子也能挂对位置。

### 整块批注

不用选字 —— 把鼠标停在一段话、一张表或一张图上，点「**批注这一块**」，卡片就属于整块，而不是一句话。

- 整块批注靠这块**开头那二十几个字**认块：块中间改字照样挂得住，只有把整块删掉才挂不上。
- 整块批注有自己的一套痕迹，在设置「**整块标记**」里选：左侧色带（块左边一条竖色条）或整块淡底（整块铺一层分类色的浅底）。选字批注仍然走上面的「原文标记」。
- 总览面板和导出的清单里，这类批注前面标 `整块：`（英文界面是 `Block:`）。

### 外观

这些开关互相独立，随便组合：

- **原文标记** —— 被批注那句话在正文里的样子：淡底、波浪下划线、虚线下划线、胶囊、马克笔。
- **整块标记** —— 整块批注的样子：左侧色带、整块淡底。
- **卡片皮肤** —— 卡片本身的样子：色条、淡底纸、圆点、实心块、便签。圆角单独一个滑杆。
- **展示方式** —— *页边*：卡片常驻页边。*浮签*：正文铺满，鼠标停在原文上才冒气泡。

另外还有：卡片放哪一边（右 / 左 / 左右交替）、引线样式（虚线 / 实线 / 关闭）、正文列宽、卡片宽度占面板的百分比、卡片之间的间距。宽度跟着面板走，面板变窄时先让位给正文。

分类和它们的颜色在设置里可以改，默认给四个：Normal、Add on、Question、Summary。

### 命令

命令名跟着界面语言走：

| 英文界面 | 中文界面 | 作用 |
| --- | --- | --- |
| Add annotation to selection | 为选中文字添加批注 | 批注当前选区 |
| Manage annotations in this note | 管理本篇批注 | 列出、修改、删除本篇批注 |
| Refresh annotations in this note | 刷新本篇批注 | 改过正文后重新挂回 |
| Open the annotation overview panel | 打开批注总览面板 | 侧栏面板列出所有批注 |
| Annotate the block under the pointer | 为鼠标停着的那一块加批注 | 批注鼠标停着的那一段、那张表或那张图 |

左侧丝带图标点开总览面板。

### 批注清单

设置里可以导出一份纯 Markdown（库根 `批注清单.md`），把批注列出来供复习或讨论。这是插件除了 `批注.json` 之外唯一会写的文件，按需重新生成，不会碰被批注的笔记。

导出清单的标题跟着界面语言走；文件名是设置项，你叫什么就一直叫什么。

### 数据与隐私

- 所有批注：`<vault>/批注.json`。一个可读的纯文本文件，没有数据库，没有隐藏状态。
- 笔记改名或移动后，批注会自动跟着换键。
- 被批注的那句被你改了或删了，批注不会悄悄消失 —— 总览面板会标成挂不上，你可以重新挂。
- **不联网、不埋点、不统计、不加载远程代码。** 全部本地渲染。
- 卸载插件后，你的笔记和 `批注.json` 都原样留着。

### 许可

MIT —— 见 [LICENSE](LICENSE)。

</details>

## Install

Obsidian → Settings → Community plugins → Browse → search **Margin Cards**.

Requires Obsidian **1.7.2** or newer, on **desktop** (Windows / macOS / Linux). Mobile is not supported and has not been tested.

## Language

The interface is fully bilingual — **Chinese and English** — for settings, dialogs, the overview panel, notices and the exported review list.

- **Follow Obsidian** (default): the plugin uses whatever language Obsidian is set to (Settings → General → Language).
- **Pin 中文 / English**: choose either one in the first setting, *Interface language*; it then ignores the app language.
- On Obsidian older than 1.8.7 there is no API to read the app language, so *Follow Obsidian* falls back to your system language.

Your annotations, categories and notes are never translated or rewritten — only the labels around them.

## Usage

1. Open a note in **Reading view**.
2. Select some text — a small button appears next to the selection (**批注** in the Chinese interface, **Annotate** in the English one). Click it.
3. Pick a category, write the note, confirm. Markdown, note links, pasted images and URLs all work inside a note.
4. Click a card to jump back to its text; the overview panel lists every annotation in the note (or the whole vault) and jumps to it when clicked.

Selecting the same sentence twice creates two annotations, and each one remembers *which occurrence* of that sentence it points at, so repeated text lands in the right place.

## Whole-block annotations

Don't select anything — hover a paragraph, a table or an image and click **Annotate block** (「批注这一块」 in the Chinese interface). The card then belongs to the block as a whole instead of to one phrase.

- A block annotation recognizes its block by the **first ~20 characters** of it, so rewriting words inside the block keeps the card attached; only deleting the block detaches it.
- Block annotations have their own mark, chosen in the **Block mark** setting: a vertical band beside the block, or a pale category tint over the whole block. Word-level annotations keep following **Text mark**.
- The overview panel and the exported review list label them `Block:` (`整块：` in Chinese).

## Appearance

These switches are independent and combine freely:

- **Text mark** — how the annotated phrase looks in the body: tint, wavy underline, dashed underline, pill, highlighter sweep.
- **Block mark** — how a whole-block annotation looks: left band, whole-block tint.
- **Card skin** — how the card itself looks: accent bar, tinted paper, dot, solid block, sticky note. Corner radius is a separate slider.
- **Display mode** — *Margin*: cards sit permanently in the gutter. *Bubble*: the body runs full width and a bubble pops up when you hover the annotated text.

Plus: which side the cards live on (right / left / alternating both), leader line style (dashed / solid / off), body column width, card width as a percentage of the pane, and the gap between them. Widths scale with the pane and give way to the text when the pane gets narrow.

Categories and their colors are editable in settings; four ship as defaults (Normal, Add on, Question, Summary).

## Commands

Command names follow the interface language:

| English interface | 中文界面 | What it does |
| --- | --- | --- |
| Add annotation to selection | 为选中文字添加批注 | Annotate the current selection |
| Manage annotations in this note | 管理本篇批注 | List, edit, delete the annotations in this note |
| Refresh annotations in this note | 刷新本篇批注 | Re-anchor after you edited the text |
| Open the annotation overview panel | 打开批注总览面板 | Side panel with every annotation |
| Annotate the block under the pointer | 为鼠标停着的那一块加批注 | Annotate the paragraph, table or image the pointer is on |

A ribbon icon opens the overview panel.

## Review list

Settings can export a plain Markdown file (`批注清单.md` at the vault root) containing your annotations, for review or study. This is the only file the plugin ever writes besides `批注.json`, it is regenerated on demand, and it never touches the annotated notes.

The headings in the exported list follow the interface language; the file name is a setting and stays whatever you named it.

## Data and privacy

- All annotations: `<vault>/批注.json`. One readable file, no database, no hidden state.
- Renaming or moving a note re-keys its annotations automatically.
- If you edit or delete the annotated sentence, the annotation is not dropped silently — the overview panel marks it as unanchored so you can reattach it.
- **No network access, no telemetry, no analytics, no remote code.** Everything renders locally.
- Uninstalling leaves both your notes and `批注.json` untouched.

## License

MIT — see [LICENSE](LICENSE).
