# Margin Cards

Margin notes for Obsidian that float in the page gutter, aligned with the exact line you annotated — and your Markdown files are never modified.

Select text in Reading view, write a note, and a card appears in the margin beside it. Each card top lines up with its annotated line; cards that would overlap cascade downward; a short leader line points from the card back into the text.

**Nothing is ever written into your notes.** Every annotation lives in one JSON file at the vault root (`批注.json`). Your `.md` files stay byte-for-byte identical, so they keep syncing, diffing and version-controlling cleanly, and the annotations survive removal of the plugin.

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

## Appearance

Three independent switches that combine freely:

- **Text mark** — how the annotated phrase looks in the body: tint, wavy underline, dashed underline, pill, highlighter sweep.
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
