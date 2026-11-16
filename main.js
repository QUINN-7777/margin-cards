'use strict';

const { Plugin, PluginSettingTab, Setting, Modal, FuzzySuggestModal, MarkdownView, MarkdownRenderer, ItemView, Menu, Notice, normalizePath, getLanguage } = require('obsidian');

const DATA_FILE = '批注.json';

// 中英双版：文案一律写成 L('中文', 'English')，当前语言挂在 LANG 上。
// 用函数而不是词典，是因为词典会漏 key —— 漏了就是一片空白，这样漏不掉。
let LANG = 'zh';
function L(zh, en) {
  return LANG === 'en' && en ? en : zh;
}
function resolveLang(mode) {
  if (mode === 'zh' || mode === 'en') return mode;
  // getLanguage 是 1.8.7 才有的；老版本解构出来是 undefined，退回系统语言
  const code = typeof getLanguage === 'function' ? getLanguage() : '';
  const guess = code || (typeof navigator === 'undefined' ? '' : navigator.language) || '';
  return /^zh/i.test(String(guess)) ? 'zh' : 'en';
}
function applyLang(mode) {
  LANG = resolveLang(mode);
}
// 点面板一行跳过去之后，显眼高亮停留的时间；CSS 里 omn-flash 动画时长要跟着改（略短一点，收尾留白）
const FLASH_MS = 3400;
const DEFAULT_SETTINGS = {
  categories: [
    { name: 'Normal', color: '#6c99f4' },
    { name: 'Add on', color: '#2f9e44' },
    { name: 'Question', color: '#d1493f' },
    { name: 'Summary', color: '#d7b509' },
  ],
  textWidth: 640,
  cardPct: 26,
  gap: 40,
  radius: 6,
  leader: 'dashed',
  markStyle: 'soft',
  cardStyle: 'side',
  marginSide: 'right',
  displayMode: 'margin',
  highlight: true,
  groupPanel: false,
  exportFile: '批注清单.md',
  language: 'auto',
};

// 原文标记、卡片皮肤、引线是三个独立开关，任意搭配；值就是挂在覆盖层上的类名后缀
// 中文名是后来改文艺的，前面那个英文键才是真身，改名字不影响已有设置
const MARK_STYLES = [
  ['soft', '淡墨', 'Tint'],
  ['marker', '涟漪', 'Wave'],
  ['dash', '疏影', 'Dashed'],
  ['pill', '落章', 'Pill'],
  ['brush', '横扫', 'Marker'],
];
const CARD_STYLES = [
  ['side', '题笺', 'Accent bar'],
  ['tint', '晕纸', 'Tinted'],
  ['dot', '素点', 'Dot'],
  ['fill', '敷色', 'Solid'],
  ['note', '贴黄', 'Sticky note'],
];
const LEADERS = [
  ['dashed', '虚线', 'Dashed'],
  ['solid', '实线', 'Solid'],
  ['none', '不画', 'None'],
];
// 展示方式：页边＝卡片常驻在正文左右；浮签＝正文满宽，鼠标停在原文上才弹气泡
const DISPLAYS = [
  ['margin', '页边', 'Margin'],
  ['bubble', '浮签', 'Bubble'],
];
// 批注列在哪一侧：卡片永远待在页边，不落进正文
const SIDES = [
  ['right', '右边（默认）', 'Right (default)'],
  ['left', '左边', 'Left'],
  ['both', '左右两边', 'Both sides'],
];
// 界面语言：选项名在自己的语言里写，两种界面下都认得出来
const LANGS = [
  ['auto', '跟随 Obsidian', 'Follow Obsidian'],
  ['zh', '中文', '中文'],
  ['en', 'English', 'English'],
];

function hexToRgba(hex, alpha) {
  let h = (hex || '').trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return 'rgba(128, 128, 128, ' + alpha + ')';
  const n = parseInt(h, 16);
  return 'rgba(' + ((n >> 16) & 255) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255) + ', ' + alpha + ')';
}

function norm(str) {
  let text = '';
  const map = [];
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (/\s/.test(ch)) continue;
    text += ch.toLowerCase();
    map.push(i);
  }
  return { text, map };
}

// 把 md 源码折成「阅读视图里看到的那些字」：只用来判断一句话还在不在正文里，
// 不追求和渲染一模一样 —— 宁可漏报也别误报，把好好的批注说成丢了很气人
function plainify(src) {
  const lines = String(src || '').split('\n');
  // YAML 头（第一行就是 --- 才算，别把正文里的分隔线当头部）
  if ((lines[0] || '').trim() === '---') {
    for (let i = 1; i < lines.length; i++) {
      const t = lines[i].trim();
      if (t === '---' || t === '...') {
        lines.splice(0, i + 1);
        break;
      }
    }
  }
  // 查询块里的那几行是代码，屏幕上出现的是它跑出来的结果，不能当成正文
  const RUN = /^\s*(```|~~~)[ \t]*(dataview|dataviewjs|tasks|js)\b/i;
  let running = false;
  return lines
    .map((l) => {
      if (/^\s*(```|~~~)/.test(l)) {
        if (running) {
          running = false;
          return '';
        }
        if (RUN.test(l)) {
          running = true;
          return '';
        }
        return ''; // 普通代码块：围栏本身不显示，里面的字照样在正文里
      }
      if (running) return '';
      let s = l;
      s = s.replace(/^[ \t]{0,3}#{1,6}[ \t]+/, '');
      while (/^[ \t]*>[ \t]?/.test(s)) s = s.replace(/^[ \t]*>[ \t]?/, '');
      s = s.replace(/^[ \t]*[-*+][ \t]+(?=\S)/, '');
      s = s.replace(/^[ \t]*\d+[.)][ \t]+/, '');
      s = s.replace(/[ \t]*\|[ \t]*/g, ' ');
      s = s.replace(/!\[\[[^\]]*\]\]/g, ' ');
      s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
      s = s.replace(/\[\[[^|\]]*\|([^\]]*)\]\]/g, '$1');
      s = s.replace(/\[\[([^\]]*)\]\]/g, '$1');
      s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
      s = s.replace(/\[![^\]]*\]/g, '');
      s = s.replace(/(`{1,3}|\*{1,3}|_{2}|~{2})/g, '');
      return s;
    })
    .join('\n');
}

function blockOf(node, sizer) {
  let el = node && (node.nodeType === 1 ? node : node.parentElement);
  while (el && el.parentElement !== sizer) el = el.parentElement;
  return el;
}

// 不重叠地数一段文字里出现了几次
function countOcc(text, target) {
  if (!target) return 0;
  let n = 0;
  let pos = text.indexOf(target);
  while (pos !== -1) {
    n++;
    pos = text.indexOf(target, pos + target.length);
  }
  return n;
}

function unwrapMarks(root) {
  root.querySelectorAll('mark.omn-mark').forEach((m) => {
    const parent = m.parentNode;
    if (!parent) return;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m);
    parent.normalize();
  });
}

function newId() {
  return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// 不在设置清单里的分类名，按名字哈希落到 7 套备用色上，同名永远同色
function catHashClass(name) {
  let h = 0;
  const s = name || '';
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 997;
  return 'omn-c' + (h % 7);
}

class NoteModal extends Modal {
  constructor(app, opts) {
    super(app);
    this.opts = opts;
  }

  onOpen() {
    const { contentEl } = this;
    const o = this.opts;

    contentEl.createEl('h3', { text: o.isNew ? L('添加批注', 'Add annotation') : L('编辑批注', 'Edit annotation'), cls: 'omn-modal-title' });

    if (o.anchor) {
      const box = contentEl.createDiv({ cls: 'omn-modal-anchor' });
      box.createSpan({ text: L('原文：', 'Original: '), cls: 'omn-modal-anchor-label' });
      box.createSpan({ text: o.anchor, cls: 'omn-modal-anchor-text' });
    }

    // 分类改成点选标签；批注原有的分类不在清单里时补一个，免得一改就丢
    const cats = (o.categories || []).slice();
    if (o.category && !cats.some((c) => c.name === o.category)) {
      cats.unshift({ name: o.category, cls: o.categoryClass || 'omn-c0' });
    }
    let chosen = o.category || (cats[0] && cats[0].name) || '批注';
    const chipRow = contentEl.createDiv({ cls: 'omn-modal-cats' });
    const paint = () => {
      Array.from(chipRow.children).forEach((b) => b.toggleClass('is-on', b.dataset.cat === chosen));
    };
    cats.forEach((c) => {
      const chip = chipRow.createDiv({ cls: 'omn-chip ' + (c.cls || 'omn-c0'), text: c.name });
      chip.dataset.cat = c.name;
      chip.addEventListener('click', () => {
        chosen = c.name;
        paint();
      });
    });
    paint();

    const body = contentEl.createEl('textarea', {
      cls: 'omn-modal-body',
      attr: { placeholder: L('批注内容。图片直接粘贴、网址直接粘贴，库里的文件按下面的按钮搜', 'Annotation. Paste images and URLs directly; search vault files with the button below') },
    });
    body.value = o.note || '';
    this.body = body;

    // 不让他手打路径：图片和网址靠粘贴，库里的文件靠搜
    const tools = contentEl.createDiv({ cls: 'omn-modal-tools' });
    tools
      .createEl('button', { text: L('引用库里的笔记 / 文件', 'Link a note / file from the vault'), cls: 'omn-tool' })
      .addEventListener('click', () => this.pickFile());
    contentEl.createDiv({
      cls: 'omn-modal-hint',
      text: L('图片：截完图在框里 Cmd+V，插件把图存进附件目录并插好。网址：复制后直接粘进来，自动变成能点的链接。库里的笔记、图片、PDF：点上面那个按钮搜，选完自动插入。Cmd+Enter 保存。', 'Image: take a screenshot, then Cmd+V (Ctrl+V) in this box — the plugin stores it in your attachments folder and inserts it. URL: paste it and it turns into a clickable link. Notes, images and PDFs in the vault: search with the button above, the pick is inserted for you. Cmd+Enter (Ctrl+Enter) saves.'),
    });

    body.addEventListener('paste', (e) => this.onPaste(e));

    const save = () => {
      const note = body.value.trim();
      if (!note) {
        new Notice(L('批注内容不能为空', 'The annotation is empty'));
        return;
      }
      o.onSave({ category: chosen, note });
      this.close();
    };

    body.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        save();
      }
    });
    contentEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });

    const row = contentEl.createDiv({ cls: 'omn-modal-row' });
    row.createEl('button', { text: L('保存', 'Save'), cls: 'mod-cta' }).addEventListener('click', save);
    if (!o.isNew) {
      row.createEl('button', { text: L('删除这条', 'Delete this') }).addEventListener('click', () => {
        this.close();
        o.onDelete();
      });
    }
    row.createEl('button', { text: L('取消', 'Cancel') }).addEventListener('click', () => this.close());

    setTimeout(() => body.focus(), 50);
  }

  onClose() {
    this.contentEl.empty();
  }

  // 光标处替换：选中的字直接被盖掉，插完把光标交回输入框（从文件搜索回来时焦点会丢）
  insert(snip) {
    const body = this.body;
    if (!body) return;
    const s = body.selectionStart == null ? body.value.length : body.selectionStart;
    const e = body.selectionEnd == null ? s : body.selectionEnd;
    body.setRangeText(snip, s, e, 'end');
    window.setTimeout(() => body.focus(), 0);
  }

  // 剪贴板里有图片就先落库，是单个网址就包成链接，其余交给默认粘贴
  onPaste(ev) {
    const dt = ev.clipboardData;
    if (!dt) return;
    const imgs = Array.from(dt.files || []).filter((f) => /^image\//i.test(f.type));
    if (imgs.length) {
      ev.preventDefault();
      this.saveImages(imgs);
      return;
    }
    const text = (dt.getData('text/plain') || '').trim();
    // Markdown 不保证认裸链接，包一层 [网址](网址) 才一定能点
    if (/^https?:\/\/\S+$/i.test(text)) {
      ev.preventDefault();
      this.insert('[' + text + '](' + text + ')');
    }
  }

  async saveImages(imgs) {
    for (const f of imgs) {
      try {
        const buf = await f.arrayBuffer();
        const path = await this.app.fileManager.getAvailablePathForAttachment(f.name || 'Pasted image.png', this.opts.sourcePath);
        await this.app.vault.createBinary(path, buf);
        this.insert('![[' + path + ']]');
        new Notice(L('图片已存进附件目录：', 'Image saved to the attachments folder: ') + path);
      } catch (e) {
        new Notice(L('图片粘贴失败：', 'Could not paste the image: ') + e.message);
      }
    }
  }

  // 库里的文件交给模糊搜索，选完按类型插成链接或嵌入
  pickFile() {
    new FileSuggest(this.app, (f) => this.insert(f.extension === 'md' ? '[[' + f.path + ']]' : '![[' + f.path + ']]')).open();
  }
}

// 2400 多个文件靠敲全路径是不现实的，模糊搜索敲两三个字母就够
class FileSuggest extends FuzzySuggestModal {
  constructor(app, onPick) {
    super(app);
    this.onPick = onPick;
    this.setPlaceholder(L('搜笔记 / 图片 / PDF，敲几个字母就行', 'Search notes / images / PDFs — a few letters is enough'));
    this.limit = 30;
  }

  getItems() {
    return this.app.vault.getFiles();
  }

  getItemText(f) {
    return f.path;
  }

  onChooseItem(f) {
    this.onPick(f);
  }
}

// 卡片挂不上了（那句话被改过或删掉）：让他把新的原文贴回来，重新挂上去
class AnchorModal extends Modal {
  constructor(app, plugin, r) {
    super(app);
    this.plugin = plugin;
    this.r = r;
  }

  onOpen() {
    const { contentEl } = this;
    const r = this.r;
    contentEl.createEl('h3', { text: L('重新挂上这条批注', 'Re-attach this annotation'), cls: 'omn-modal-title' });
    const hint = contentEl.createDiv({
      cls: 'omn-modal-hint',
      text: L('这篇「', 'The note "') + r.p + L('」里已经找不到原来那句了。回笔记里把新的那句选中、复制，再回来粘到框里。', '" no longer contains the original sentence. Go back to the note, select and copy the new wording, then paste it here.'),
    });
    // 查询代码块渲染出来的句子源码里没有，挂不上 —— 直接讲清楚，别让他白找
    this.plugin.plainInfo(r.p).then((info) => {
      if (info && info.query && hint.isConnected) {
        hint.appendText(L('这篇有查询代码块：查询渲染出来的句子在源码里不存在，批注只能挂在正文手写的句子上。', 'This note has query blocks: sentences rendered by a query do not exist in the source, so an annotation can only attach to wording you typed yourself.'));
      }
    });
    const old = contentEl.createDiv({ cls: 'omn-modal-anchor' });
    old.createSpan({ text: L('原来记的是：', 'Previously anchored to: '), cls: 'omn-modal-anchor-label' });
    old.createSpan({ text: r.a.anchor || '', cls: 'omn-modal-anchor-text' });

    const body = contentEl.createEl('textarea', {
      cls: 'omn-modal-body',
      attr: { placeholder: L('新的原文，一两句就够', 'The new sentence — one or two lines is enough') },
    });
    body.value = r.a.anchor || '';
    const tip = contentEl.createDiv({ cls: 'omn-modal-hint' });
    const row = contentEl.createDiv({ cls: 'omn-modal-row' });
    const saveBtn = row.createEl('button', { text: L('挂上去', 'Attach'), cls: 'mod-cta' });
    row.createEl('button', { text: L('取消', 'Cancel') }).addEventListener('click', () => this.close());

    // 边打边告诉他正文里有没有这句，省得按了保存才发现贴错
    let seq = 0;
    const check = async () => {
      const mine = ++seq;
      const t = body.value.trim();
      if (!t) {
        tip.setText(L('还没填原文', 'Nothing entered yet'));
        return;
      }
      const ok = await this.plugin.anchorOk(r.p, t);
      if (mine !== seq) return;
      tip.setText(ok ? L('正文里有这句，可以挂上去', 'Found in the text — this will attach') : L('正文里没有这句 —— 直接从笔记里复制过来最稳', 'Not found in the text — copy the sentence straight from the note'));
      tip.toggleClass('omn-ok', ok);
    };
    body.addEventListener('input', () => {
      if (this.typing) window.clearTimeout(this.typing);
      this.typing = window.setTimeout(check, 250);
    });

    const save = async () => {
      const t = body.value.trim().slice(0, 240);
      if (!t) {
        new Notice(L('先把新的原文填进来', 'Enter the new sentence first'));
        return;
      }
      if (!(await this.plugin.anchorOk(r.p, t))) {
        new Notice(L('这句在正文里找不到，先回笔记里复制那句原文', 'That sentence is not in the text — copy it from the note first'));
        return;
      }
      r.a.anchor = t;
      r.a.occ = 0; // 新贴的这句没量过选区，从第一次出现算起
      await this.plugin.upsert(r.p, r.a);
      this.plugin.renderPath(r.p);
      new Notice(L('重新挂上了', 'Re-attached'));
      this.close();
    };
    saveBtn.addEventListener('click', save);
    body.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        save();
      }
    });
    window.setTimeout(() => {
      body.focus();
      check();
    }, 50);
  }

  onClose() {
    if (this.typing) window.clearTimeout(this.typing);
    this.contentEl.empty();
  }
}

class ManageModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    const file = this.app.workspace.getActiveFile();
    contentEl.empty();
    contentEl.createEl('h3', { text: file ? L('本篇批注', 'Annotations in this note') : L('没有打开的笔记', 'No note is open') });
    if (!file) return;

    const items = this.plugin.data[file.path] || [];
    if (!items.length) {
      contentEl.createEl('p', {
        text: L('还没有批注。切到阅读视图，选中一段文字，松手后点旁边冒出来的「批注」按钮。', 'No annotations yet. Switch to Reading view, select some text, then click the Annotate button that appears next to it.'),
      });
      return;
    }

    items.forEach((a) => {
      const row = contentEl.createDiv({ cls: 'omn-manage-row' });
      const info = row.createDiv({ cls: 'omn-manage-info' });
      info.createDiv({ cls: 'omn-manage-cat', text: a.category || '批注' });
      info.createDiv({ cls: 'omn-manage-anchor', text: L('原文：', 'Original: ') + a.anchor });
      info.createDiv({ cls: 'omn-manage-note', text: a.note });
      row.createEl('button', { text: L('定位', 'Locate') }).addEventListener('click', () => {
        this.close();
        this.plugin.scrollTo(a.id);
      });
      row.createEl('button', { text: L('删除', 'Delete') }).addEventListener('click', async () => {
        await this.plugin.remove(file.path, a.id);
        this.plugin.renderActive();
        this.onOpen();
      });
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

class OmnSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const el = this.containerEl;
    const s = this.plugin.settings;
    el.empty();

    new Setting(el)
      .setName(L('界面语言', 'Interface language'))
      .setDesc(L('默认跟着 Obsidian 的语言走（Obsidian 设置 → 通用 → 语言）。也可以在这儿单独锁死中文或英文，锁了就不管 Obsidian 用什么语言了。', 'Follows the Obsidian language by default (Obsidian Settings → General → Language). You can also pin Chinese or English here; a pinned choice ignores the app language.'))
      .addDropdown((d) => {
        LANGS.forEach(([v, label, en]) => d.addOption(v, L(label, en)));
        d.setValue(s.language).onChange((v) => this.plugin.setLang(v));
      });

    el.createEl('h3', { text: L('一、分类', '1. Categories') });
    el.createEl('p', { text: L('每条批注点选一个分类；颜色就是卡片左边那条和原文高亮的颜色。', 'Pick a category for each annotation. The color is the bar on the left of the card and the highlight in the text.'), cls: 'omn-set-note' });

    s.categories.forEach((c, i) => {
      new Setting(el)
        .setName(L('分类 ', 'Category ') + (i + 1))
        .addText((t) =>
          t
            .setPlaceholder(L('分类名', 'Category name'))
            .setValue(c.name)
            .onChange(async (v) => {
              c.name = v.trim() || L('未命名', 'Untitled');
              await this.plugin.updateSettings();
            }),
        )
        .addColorPicker((p) =>
          p.setValue(c.color).onChange(async (v) => {
            c.color = v;
            await this.plugin.updateSettings();
          }),
        )
        .addButton((b) =>
          b.setButtonText(L('删除', 'Delete')).onClick(async () => {
            s.categories.splice(i, 1);
            await this.plugin.updateSettings();
            this.display();
          }),
        );
    });

    new Setting(el)
      .addButton((b) =>
        b.setButtonText(L('新增分类', 'Add category')).onClick(async () => {
          s.categories.push({ name: L('新分类', 'New Category ') + (s.categories.length + 1), color: '#3b6fd4' });
          await this.plugin.updateSettings();
          this.display();
        }),
      )
      .addButton((b) =>
        b.setButtonText(L('恢复默认分类', 'Restore default categories')).onClick(async () => {
          await this.plugin.updateSettings({ categories: JSON.parse(JSON.stringify(DEFAULT_SETTINGS.categories)) });
          this.display();
        }),
      );

    el.createEl('h3', { text: L('二、版式', '2. Layout') });
    el.createEl('p', {
      text: L('下面每一项都能单独换，互相不影响：正文标记、卡片长相、引线线型是三个独立开关，随便搭。', 'Everything below is independent: text mark, card skin and leader line are three separate switches — mix them freely.'),
      cls: 'omn-set-note',
    });

    const slider = (title, desc, key, min, max, step) =>
      new Setting(el)
        .setName(title)
        .setDesc(desc)
        .addSlider((sl) =>
          sl
            .setLimits(min, max, step)
            .setValue(s[key])
            .setDynamicTooltip()
            .onChange(async (v) => {
              s[key] = v;
              await this.plugin.updateSettings();
            }),
        );

    slider(L('正文列宽', 'Text column width'), L('页边模式下正文最宽能到多少；面板不够宽时会自动让给批注列', 'Maximum width of the text in margin mode; it gives way to the annotation column when the pane is too narrow'), 'textWidth', 400, 900, 20);
    slider(L('卡片宽占比', 'Card width'), L('批注卡片占面板宽度的百分比：窗口拉宽卡片跟着变宽，面板不够宽时自动让位给正文', 'Card width as a percentage of the pane: cards grow with the window and shrink back when it is too narrow'), 'cardPct', 14, 40, 1);
    slider(L('空隙', 'Gap'), L('正文和卡片之间留多远', 'Space between the text and the cards'), 'gap', 12, 90, 2);
    slider(L('圆角', 'Corner radius'), L('0 是直角卡片，五种卡片样式都吃这个值', '0 means square corners; applies to all five card skins'), 'radius', 0, 20, 1);

    const pick = (title, desc, key, pairs) =>
      new Setting(el)
        .setName(title)
        .setDesc(desc)
        .addDropdown((d) => {
          pairs.forEach(([v, label, en]) => d.addOption(v, L(label, en)));
          d.setValue(s[key]).onChange(async (v) => {
            s[key] = v;
            await this.plugin.updateSettings();
          });
        });

    pick(L('展示方式', 'Display mode'), L('页边＝卡片常驻在正文左右两侧；浮签＝正文满宽阅读，鼠标停在被批注的文字上才弹出气泡', 'Margin: cards sit permanently in the gutters. Bubble: full-width text, a bubble appears when you hover the annotated words'), 'displayMode', DISPLAYS);
    pick(L('原文标记', 'Text mark'), L('正文里被批注的那句话长什么样。淡墨＝淡底加实线、涟漪＝字底波浪下划线、疏影＝虚线下划线、落章＝胶囊标签、横扫＝马克笔粗线', 'How the annotated phrase looks in the text. Tint = pale fill with a rule, Wave = wavy underline, Dashed = dashed underline, Pill = capsule, Marker = highlighter sweep'), 'markStyle', MARK_STYLES);
    pick(L('卡片样式', 'Card skin'), L('批注卡长什么样。题笺＝色条白卡、晕纸＝无边淡底、素点＝纸白卡加小色点、敷色＝实心色块、贴黄＝便签', 'How the card looks. Accent bar = white card with a colored bar, Tinted = borderless pale fill, Dot = white card with a dot, Solid = filled block, Sticky note = note slip'), 'cardStyle', CARD_STYLES);
    pick(L('引线', 'Leader line'), L('卡片伸向正文的那条短线（浮签方式不画引线）', 'The short line from the card toward the text (not drawn in bubble mode)'), 'leader', LEADERS);
    pick(L('批注位置', 'Card side'), L('页边卡片飘在哪一侧；选「左右两边」时按原文顺序一条右、一条左交替排（只在页边方式下生效）', 'Which gutter the cards float in; "Both sides" alternates right and left in text order (margin mode only)'), 'marginSide', SIDES);

    new Setting(el)
      .setName(L('高亮原文', 'Highlight the text'))
      .setDesc(L('关掉后正文不变色，只在右边显示卡片。浮签方式为了让鼠标有地方停，会始终标记原文。', 'Off leaves the text unchanged and only shows the cards. Bubble mode always marks the text so the pointer has something to hover.'))
      .addToggle((t) =>
        t.setValue(s.highlight).onChange(async (v) => {
          s.highlight = v;
          await this.plugin.updateSettings();
        }),
      );

    new Setting(el)
      .setName(L('面板按笔记分组', 'Group the panel by note'))
      .setDesc(L('批注总览面板里，同一篇笔记的批注归到一组，组名可点开放下收起。关掉就是原来的一条列表。', 'In the overview panel, annotations from the same note form a group; click the group name to collapse or expand it. Off gives a flat list.'))
      .addToggle((t) =>
        t.setValue(s.groupPanel).onChange(async (v) => {
          s.groupPanel = v;
          await this.plugin.updateSettings();
        }),
      );

    el.createEl('h3', { text: L('三、导出复习清单', '3. Export a review list') });
    el.createEl('p', {
      text: L('把批注汇总成一篇新的 md 方便复习。只写这一个文件，任何原文都不改；再点一次就覆盖上一版。不点它就什么都不发生。', 'Collect annotations into a new Markdown file for review. Only this one file is written and no note is ever modified; running it again overwrites the previous version. Nothing happens unless you click.'),
      cls: 'omn-set-note',
    });

    new Setting(el)
      .setName(L('清单文件', 'List file'))
      .setDesc(L('写在库根，和 批注.json 挨着', 'Written at the vault root, next to 批注.json'))
      .addText((t) =>
        t.setValue(s.exportFile).onChange(async (v) => {
          s.exportFile = v.trim() || '批注清单.md';
          await this.plugin.updateSettings();
        }),
      );

    new Setting(el)
      .setName(L('导出现在这篇', 'Export this note'))
      .setDesc(L('只汇总当前笔记的批注', 'Only the annotations in the current note'))
      .addButton((b) =>
        b.setButtonText(L('导出', 'Export')).onClick(() => this.plugin.exportMd('current')),
      );

    new Setting(el)
      .setName(L('导出全部笔记', 'Export all notes'))
      .setDesc(L('汇总 批注.json 里所有笔记的批注', 'Every annotation in 批注.json, across all notes'))
      .addButton((b) =>
        b.setButtonText(L('导出', 'Export')).onClick(() => this.plugin.exportMd('all')),
      );
  }
}

const VIEW_TYPE = 'omn-browser';

// 丝带按钮打开的批注面板：所有批注自动汇总，能搜、能按分类筛、点一行跳回原文
class OmnBrowserView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.query = '';
    this.cat = 'all';
    this.collapsed = {};
  }

  getViewType() {
    return VIEW_TYPE;
  }

  getDisplayText() {
    return L('批注总览', 'Annotation overview');
  }

  getIcon() {
    return 'list-checks';
  }

  async onOpen() {
    const el = this.contentEl;
    el.empty();
    el.addClass('omn-bw');
    // 面板刚打开时 applyStyle 不会再叫一次，这里自己认领当前卡片皮肤
    this.plugin.tagSkin(el);

    const head = el.createDiv({ cls: 'omn-bw-head' });
    head.createDiv({ cls: 'omn-bw-title', text: L('批注', 'Annotations') });
    head.createDiv({ cls: 'omn-bw-hint', text: L('单击跳转 · 右键修改/删除', 'Click to jump · right-click to edit or delete') });
    this.countEl = head.createDiv({ cls: 'omn-bw-count' });

    const tools = el.createDiv({ cls: 'omn-bw-tools' });
    const input = tools.createEl('input', {
      type: 'search',
      cls: 'omn-bw-search',
      attr: { placeholder: L('搜原文 / 批注 / 分类 / 笔记名', 'Search the text, the annotation, the category or the note name') },
    });
    input.addEventListener('input', () => {
      this.query = input.value.trim().toLowerCase();
      this.paint();
    });
    this.chipRow = tools.createDiv({ cls: 'omn-modal-cats' });

    this.listEl = el.createDiv({ cls: 'omn-bw-list' });
    this.paint();
  }

  async onClose() {
    if (this.listEl) this.listEl.empty();
  }

  allRows() {
    const rows = [];
    const data = this.plugin.data || {};
    Object.keys(data).forEach((p) => (data[p] || []).forEach((a) => rows.push({ p, a })));
    rows.sort((x, y) => ((y.a.created || '') > (x.a.created || '') ? 1 : -1));
    return rows;
  }

  // 筛选条：全部 + 设置里的分类 + 数据里出现过但已不在清单的分类
  catChips() {
    const list = this.plugin.categoryList();
    const extra = {};
    this.allRows().forEach((r) => {
      const n = r.a.category || '批注';
      if (!list.some((c) => c.name === n)) extra[n] = this.plugin.catCls(n);
    });
    Object.keys(extra).forEach((n) => list.unshift({ name: n, cls: extra[n] }));
    return list;
  }

  paint() {
    if (!this.listEl) return;
    const all = this.allRows();
    const grouped = !!this.plugin.settings.groupPanel;
    const shut = grouped ? Object.keys(this.collapsed).filter((k) => this.collapsed[k]).sort().join('|') : '';
    let lost = this.plugin.brokenIds || [];
    // 定位不到的那批全消失了，还停在「定位不到」这一栏会是一片空，自动回「全部」
    if (this.cat === 'lost' && !lost.length) this.cat = 'all';
    // 正文每渲染一次、设置每改一次都会叫到这里。清单内容和筛选没变就一个字都不动 ——
    // 整列面板推倒重建也是点批注时那一下卡顿的一部分
    const sig = [grouped ? 'g' : '', shut, this.cat, this.query, lost.join('|'), all.map((r) => r.p + ':' + r.a.id + ':' + (r.a.note || '').length + ':' + (r.a.category || '')).join(',')].join('#');
    if (this.__sig === sig) return;
    this.__sig = sig;
    const shown = all.filter((r) => {
      if (this.cat === 'lost') {
        if (lost.indexOf(r.a.id) < 0) return false;
      } else if (this.cat !== 'all' && (r.a.category || '批注') !== this.cat) {
        return false;
      }
      if (!this.query) return true;
      const hay = ((r.a.anchor || '') + ' ' + (r.a.note || '') + ' ' + (r.a.category || '') + ' ' + r.p).toLowerCase();
      return hay.indexOf(this.query) >= 0;
    });

    this.chipRow.empty();
    const mk = (label, key, cls) => {
      const c = this.chipRow.createDiv({ cls: 'omn-chip ' + (cls || ''), text: label });
      if (!cls) c.style.setProperty('--omn-accent', 'var(--interactive-accent)');
      c.toggleClass('is-on', this.cat === key);
      c.addEventListener('click', () => {
        this.cat = key;
        this.paint();
      });
      return c;
    };
    mk(L('全部 ', 'All ') + all.length, 'all');
    if (lost.length) mk(L('定位不到 ', 'Unanchored ') + lost.length, 'lost', 'omn-lost-chip');
    this.catChips().forEach((c) => mk(c.name, c.name, c.cls));

    this.countEl.setText(shown.length + ' / ' + all.length + L(' 条', all.length === 1 ? ' item' : ' items'));

    this.listEl.empty();
    // 分组时每行标题右侧已经写了笔记名，条目里那一栏重复，藏掉
    this.listEl.toggleClass('omn-bw-grouped', grouped);
    if (!shown.length) {
      this.listEl.createDiv({
        cls: 'omn-bw-empty',
        text: all.length ? L('没有匹配的批注，换个词或点「全部」。', 'Nothing matches — try another word or click All.') : L('还没有批注：切到阅读视图，选中正文文字，松手后点旁边冒出的「批注」。', 'No annotations yet: switch to Reading view, select some text, then click the Annotate button that appears.'),
      });
      return;
    }
    if (!grouped) {
      shown.forEach((r) => this.mkItem(r));
      return;
    }
    // 按笔记归组：组顺序跟着排序后的第一次出现走，收起的组只留一行组名
    const groups = [];
    const byPath = {};
    shown.forEach((r) => {
      let g = byPath[r.p];
      if (!g) g = byPath[r.p] = { p: r.p, rows: [] };
      g.rows.push(r);
      if (groups.indexOf(g) < 0) groups.push(g);
    });
    groups.forEach((g) => {
      const box = this.listEl.createDiv({ cls: 'omn-bw-group' });
      const head = box.createDiv({ cls: 'omn-bw-group-head' });
      const closed = !!this.collapsed[g.p];
      head.toggleClass('is-closed', closed);
      head.createSpan({ cls: 'omn-bw-group-caret' });
      head.createSpan({ cls: 'omn-bw-group-name', text: g.p.replace(/^.*\//, '').replace(/\.md$/, '') });
      head.createSpan({ cls: 'omn-bw-group-count', text: String(g.rows.length) });
      head.setAttr('title', g.p + L('：点开收起 / 展开这一组', ' — click to collapse or expand this group'));
      head.addEventListener('click', () => {
        this.collapsed[g.p] = !closed;
        this.paint();
      });
      if (closed) return;
      const rowsBox = box.createDiv({ cls: 'omn-bw-group-rows' });
      g.rows.forEach((r) => this.mkItem(r, rowsBox));
    });
  }

  mkItem(r, host) {
    const a = r.a;
    const item = (host || this.listEl).createDiv({ cls: 'omn-bw-item ' + this.plugin.catCls(a.category) });
    item.setAttr('title', L('单击跳到原文，右键可修改或删除', 'Click to jump to the text; right-click to edit or delete'));
    const top = item.createDiv({ cls: 'omn-bw-top' });
    top.createSpan({ cls: 'omn-bw-cat', text: a.category || '批注' });
    if ((this.plugin.brokenIds || []).indexOf(a.id) >= 0) {
      item.addClass('omn-bw-lost');
      top.createSpan({ cls: 'omn-bw-lost-tag', text: L('定位不到', 'Unanchored') });
      item.setAttr('title', L('原文在笔记里已经找不到了：右键选「重新选原文」把它挂回去', 'The original sentence is no longer in the note: right-click and choose Re-pick the text to attach it again'));
    }
    top.createSpan({ cls: 'omn-bw-note', text: r.p.replace(/^.*\//, '').replace(/\.md$/, '') });
    top.createSpan({ cls: 'omn-bw-date', text: (a.created || '').slice(0, 10) });
    item.createDiv({ cls: 'omn-bw-anchor', text: L('原文：', 'Original: ') + (a.anchor || '') });
    // 面板条目和页边卡片渲染同一份 Markdown：链接能点、图片直接显示
    const body = item.createDiv({ cls: 'omn-bw-body omn-body' });
    MarkdownRenderer.render(this.app, a.note || '', body, r.p, this);
    item.addEventListener('click', (e) => {
      if (this.plugin.linkClick(e, r.p)) return;
      if (e.target.closest('button, input, textarea, img, .math')) return;
      this.jump(r.p, a.id);
    });
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.menu(r, e);
    });
  }

  // 右键：直接改内容或删掉，不用回到正文里的卡片
  menu(r, e) {
    const m = new Menu();
    m.addItem((item) => {
      item.setTitle(L('修改这条批注', 'Edit this annotation')).setIcon('pencil').onClick(() => this.editRow(r));
    });
    m.addItem((item) => {
      item.setTitle(L('重新选原文', 'Re-pick the text')).setIcon('anchor').onClick(() => new AnchorModal(this.app, this.plugin, r).open());
    });
    m.addSeparator();
    m.addItem((item) => {
      item.setTitle(L('删除这条批注', 'Delete this annotation')).setIcon('trash-2').onClick(() => this.delRow(r));
    });
    m.showAtPosition({ x: e.pageX, y: e.pageY });
  }

  editRow(r) {
    const a = r.a;
    const path = r.p;
    new NoteModal(this.app, {
      isNew: false,
      sourcePath: path,
      anchor: a.anchor,
      category: a.category,
      note: a.note,
      categories: this.plugin.categoryList(a.category),
      onSave: async (vals) => {
        a.category = vals.category;
        a.note = vals.note;
        await this.plugin.upsert(path, a);
        this.plugin.renderPath(path);
      },
      onDelete: async () => {
        await this.plugin.remove(path, a.id);
        this.plugin.renderPath(path);
      },
    }).open();
  }

  async delRow(r) {
    await this.plugin.remove(r.p, r.a.id);
    this.plugin.renderPath(r.p);
    new Notice(L('已删除这条批注', 'Annotation deleted'));
  }

  async jump(path, id) {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!f) {
      new Notice(L('这篇笔记已经不在库里了：', 'This note is no longer in the vault: ') + path);
      return;
    }
    let leaf = this.plugin.fileLeaf(path);
    const same = !!leaf;
    // 没开过就新开一个标签页；开着的就原地跳。两种情况都不改它的编辑/阅读模式 ——
    // 点一下批注就把人家正在编辑的笔记猛地切成阅读视图，很难不让人骂
    if (!leaf) leaf = this.app.workspace.getLeaf('tab');
    if (!same) await leaf.openFile(f, { active: true });
    this.app.workspace.revealLeaf(leaf);
    // 同一篇的卡片早就画好了，不用等正文渲染；刚换笔记才需要留那 400ms
    window.setTimeout(() => this.plugin.scrollTo(id, same ? 3 : 6), same ? 40 : 400);
  }
}

module.exports = class OwnMarginNotes extends Plugin {
  async onload() {
    this.unloaded = false;
    // 全新用户还没有 批注.json，readData 读不到东西就不会赋值 —— 这里先把空壳摆好，
    // 否则后面每一处 this.data[路径] 都是往 undefined 上取属性
    this.data = {};
    await this.readData();
    await this.loadSettings();
    this.applyStyle();
    this.tab = new OmnSettingTab(this.app, this);
    this.addSettingTab(this.tab);

    this.registerView(VIEW_TYPE, (leaf) => new OmnBrowserView(leaf, this));
    this.ribbonEl = this.addRibbonIcon('list-checks', L('批注总览', 'Annotation overview'), () => this.activateBrowser());

    this.addCommand({
      id: 'omn-add',
      // 不能用 get name()：Obsidian 的 Plugin.addCommand 会往这个对象上写
      // e.name = manifest.name + ": " + e.name，getter-only 在严格模式下直接抛 TypeError，
      // 整个插件加载失败。命令名只能传普通字符串，换语言后重载插件才更新。
      name: L('为选中文字添加批注', 'Add annotation to selection'),
      checkCallback: (checking) => {
        const view = this.previewView();
        if (!view) return false;
        if (!checking) this.addFromSelection(view);
        return true;
      },
    });

    this.addCommand({
      id: 'omn-manage',
      name: L('管理本篇批注', 'Manage annotations in this note'),
      callback: () => new ManageModal(this.app, this).open(),
    });

    this.addCommand({
      id: 'omn-refresh',
      name: L('刷新本篇批注', 'Refresh annotations in this note'),
      callback: () => this.renderActive(),
    });

    this.addCommand({
      id: 'omn-open-browser',
      name: L('打开批注总览面板', 'Open the annotation overview panel'),
      callback: () => this.activateBrowser(),
    });

    this.registerEvent(this.app.workspace.on('markdown-view-rendered', (view) => this.render(view)));
    this.registerEvent(this.app.workspace.on('file-open', () => this.scheduleRender()));
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.scheduleRender()));
    this.registerEvent(this.app.workspace.on('layout-change', () => this.scheduleRender()));
    this.registerEvent(this.app.workspace.on('resize', () => this.scheduleRender()));
    // 笔记被改了，批注挂的那句话可能就不在了；不写盘，只在面板里标出来让他重新挂
    ['modify', 'delete', 'rename', 'create'].forEach((ev) => this.registerEvent(this.app.vault.on(ev, () => this.scheduleAnchorCheck())));
    // 改笔记名（或挪文件夹）：批注.json 里的键还是老路径，不搬过来这些批注就全挂不上了
    this.registerEvent(
      this.app.vault.on('rename', (f, oldPath) => {
        if (this.unloaded) return;
        // 整个文件夹改名或挪位置时，Obsidian 只给文件夹这一下，里面每篇文件不会再单独触发
        if (f.children) {
          this.moveKeys(oldPath + '/', f.path + '/');
          return;
        }
        const list = this.data[oldPath];
        if (!list || !list.length) return;
        this.data[f.path] = (this.data[f.path] || []).concat(list);
        delete this.data[oldPath];
        this.save();
        this.refreshBrowser();
      })
    );
    this.scheduleAnchorCheck();

    // 批注.json 也可能被外面改：网盘同步、别人改的、自己拿编辑器改。
    // 不及时读回来，下一次保存就会拿内存里的旧数据把外面那一份顶掉。
    this.registerEvent(
      this.app.vault.on('modify', (f) => {
        if (this.unloaded) return;
        if (f.path !== normalizePath(DATA_FILE)) return;
        if (Date.now() - (this.lastSelfWrite || 0) < 1500) return; // 自己刚写的那一下不算外部改动
        this.readData().then(() => {
          this.scheduleRender();
          this.refreshBrowser();
        });
      })
    );

    // 切到阅读视图时正文是异步渲染出来的，靠观察器补上这一次
    this.observer = new MutationObserver((records) => {
      for (const r of records) {
        const t = r.target;
        if (t.nodeType !== 1 || !t.closest) continue;
        // 覆盖层里的卡片、色块是我们自己画的，不算正文变动 ——
        // 不然异步渲染完往层里插节点，又把块文本缓存清了、又排一次，自己追着自己打
        if (t.closest('.omn-layer')) continue;
        const sizer = t.closest('.markdown-preview-sizer');
        if (!sizer) continue;
        // 正文动过了：命中缓存的那份块文本作废，但块矩形要等重排时才重量
        sizer.__omnBlocks = null;
        // 这一画正在进行中（卡片正文还在异步渲染 Markdown）：不能同时起第二画，
        // 但这次变动不能丢 —— 记一笔，等这画收尾补一次，不然卡片会挂在已经换掉的旧块上
        if (this.busy) {
          this.renderOwed = true;
          return;
        }
        this.scheduleRender();
        return;
      }
    });
    this.observer.observe(document.body, { childList: true, subtree: true });

    // 阅读视图里选中文字后直接冒出一个「批注」小按钮，省得去命令面板找
    this.registerDomEvent(document, 'mouseup', (e) => this.onMouseUp(e));
    // 右键、双击选词、Shift+方向键这类选字不会都触发 mouseup，所以再加一条选择变化监听
    this.registerDomEvent(document, 'selectionchange', () => {
      if (this.selTimer) window.clearTimeout(this.selTimer);
      this.selTimer = window.setTimeout(() => this.onMouseUp(), 150);
    });
    this.registerDomEvent(window, 'scroll', () => this.hideButton(), { capture: true, passive: true });

    // 上一个没被真正卸掉的实例如果还挂着总览面板，它会继续往 批注.json 写自己那份内存，
    // 和这个实例互相覆盖 —— 谁后写谁就把对方的批注抹掉了。加载时把它们卸干净。
    const owners = this.app.workspace
      .getLeavesOfType(VIEW_TYPE)
      .map((l) => l.view && l.view.plugin)
      .filter((x) => x && x !== this);
    for (const dead of new Set(owners)) {
      try {
        await dead.unload();
      } catch (e) {}
    }
    if (owners.length) this.applyStyle();
    // 刚打开插件时，可能正停在一篇有批注的笔记上，而「换笔记」事件不会再触发一次；
    // 上面卸僵尸实例也会把覆盖层清掉 —— 所以加载完主动画一遍，不然要切一次笔记才看得到卡片
    this.scheduleRender();
  }

  onMouseUp(e) {
    // 弹窗里选文字（批注框、总览、搜文件）也会走到这儿，不能再往旁边钉一个「批注」按钮
    if (document.querySelector('.modal-container')) {
      this.hideButton();
      return;
    }
    // 松手这一下如果落在「批注」按钮上，绝不能重建按钮 —— 否则元素在点下去时选区就被换掉了，点了没反应
    if (e && e.target && e.target.closest && e.target.closest('.omn-add-btn')) return;
    // 浮签模式里在气泡内划选文字是正常动作，别在旁边又钉一个「批注」按钮
    if (e && e.target && e.target.closest && e.target.closest('.omn-card') && !window.getSelection().isCollapsed) return;
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.file) return;
    const sel = window.getSelection();
    const text = sel ? sel.toString().trim() : '';
    if (!text) {
      this.hideButton();
      return;
    }
    // 编辑模式（Live Preview / 源码）里插不进页边卡片：安静地不出现就行。
    // 以前这里弹一条提示，选字就挨一句「请到阅读视图」，莫名其妙
    const sizer = this.visibleSizer(view);
    if (!sizer || !blockOf(sel.anchorNode, sizer)) {
      this.hideButton();
      return;
    }
    let rect = null;
    try {
      rect = sel.getRangeAt(0).getBoundingClientRect();
    } catch (e) {
      rect = null;
    }
    if (!rect || (!rect.width && !rect.height)) {
      this.hideButton();
      return;
    }
    this.showButton(rect, view);
  }

  showButton(rect, view) {
    this.btnView = view;
    if (!this.btn || !this.btn.isConnected) {
      const btn = document.body.createDiv({ cls: 'omn-add-btn', text: L('批注', 'Annotate') });
      // 不让点按钮这一下把选区弄没了
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const target = this.btnView;
        this.hideButton();
        if (target) this.addFromSelection(target);
      });
      this.btn = btn;
    }
    this.btn.style.left = Math.min(rect.right + 6, window.innerWidth - 70) + 'px';
    this.btn.style.top = Math.min(rect.bottom + 6, window.innerHeight - 40) + 'px';
  }

  hideButton() {
    if (this.btn) {
      this.btn.remove();
      this.btn = null;
    }
  }

  onunload() {
    // 先立牌子：下面 detachLeavesOfType 会触发 layout-change，观察器/事件在 onunload 返回后才解绑，
    // 那一发 scheduleRender 会排在卸载之后跑，把动态 style 又建回来、往已卸载的实例上重画
    this.unloaded = true;
    if (this.timer) window.clearTimeout(this.timer);
    if (this.selTimer) window.clearTimeout(this.selTimer);
    if (this.anchorTimer) window.clearTimeout(this.anchorTimer);
    // 设置的写盘是延后的，卸载前补一次，别把最后那一下调整弄丢了
    if (this.setTimer) {
      window.clearTimeout(this.setTimer);
      this.setTimer = 0;
      this.saveData(this.settings);
    }
    if (this.observer) this.observer.disconnect();
    this.hideButton();
    this.cleanupAll();
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
    const dyn = document.getElementById('omn-dyn');
    if (dyn) dyn.remove();
  }

  scheduleRender() {
    if (this.unloaded) return;
    if (this.timer) window.clearTimeout(this.timer);
    // 这里只重画正文旁边的卡片。总览面板的内容和布局、窗口大小没关系，
    // 以前一并 refreshBrowser，等于滚一下页面就把整个面板连同里面的 Markdown 全部重渲染
    this.timer = window.setTimeout(() => this.renderActive(), 150);
  }

  previewView() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.file) return null;
    // 看得见的那份正文 = 正在阅读。getMode() 分不开阅读视图和 Live Preview，
    // 而 Live Preview 里那份隐藏的预览容器宽是 0，所以只能量元素，不能问模式
    return this.visibleSizer(view) ? view : null;
  }

  // Obsidian 在每个 MarkdownView 里另藏了一份 0×0 的阅读视图（悬停预览用），
  // querySelector 经常先撞上它 —— 卡片画进看不见的地方，就变成「原文找不到」「点了没反应」。
  // 所以只认屏幕上看得见的那一个。
  visibleSizer(view) {
    if (!view || !view.contentEl) return null;
    const all = view.contentEl.querySelectorAll('.markdown-preview-sizer');
    for (let i = 0; i < all.length; i++) {
      if (all[i].offsetWidth > 200) return all[i];
    }
    return null;
  }

  // 主编辑区里已经打开这篇的叶子；没有就返回 null，由调用方决定怎么开。
  // 绝不能退回「随便挑一个 markdown 叶子」—— 那等于把另一篇正在看的笔记顶掉
  fileLeaf(path) {
    return (
      this.app.workspace.getLeavesOfType('markdown').find((l) => {
        const root = l.getRoot && l.getRoot();
        return root === this.app.workspace.rootSplit && l.view && l.view.file && l.view.file.path === path;
      }) || null
    );
  }

  // 这篇此刻显示在编辑器里（Live Preview / 源码）时的视图；在阅读视图里返回 null
  editViewOf(path) {
    const leaf = this.fileLeaf(path);
    const v = leaf && leaf.view;
    if (!v || !v.editor || !v.file || v.file.path !== path) return null;
    const cm = v.contentEl.querySelector('.cm-content');
    return cm && cm.offsetWidth > 0 ? v : null;
  }

  renderActive() {
    if (this.unloaded) return;
    this.render(this.previewView());
  }

  // 面板里改完/删完批注，只重画那一篇笔记（前提它是开着的阅读视图）
  renderPath(path) {
    this.app.workspace.getLeavesOfType('markdown').forEach((l) => {
      const v = l.view;
      if (!v || !v.file || v.file.path !== path) return;
      if (v.getMode && v.getMode() !== 'preview') return;
      this.render(v);
    });
  }

  // 丝带按钮：右侧栏打开（或聚焦）批注面板
  async activateBrowser() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      // 右侧栏被关掉时 getRightLeaf 返回 null，不判空就是「点了丝带没反应 + 控制台报错」
      leaf = this.app.workspace.getRightLeaf(false);
      if (!leaf) {
        new Notice(L('打不开右侧栏，请先在 Obsidian 设置「界面」里打开右侧边栏', 'Cannot open the right sidebar — enable it first in Obsidian Settings, under Interface'));
        return;
      }
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
    if (leaf.view && leaf.view.paint) leaf.view.paint();
  }

  refreshBrowser() {
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((l) => {
      if (l.view && l.view.paint) l.view.paint();
    });
  }

  cleanupAll() {
    document.querySelectorAll('.markdown-preview-view').forEach((root) => {
      const sizer = root.querySelector('.markdown-preview-sizer');
      if (sizer) this.cleanup(sizer);
      root.classList.remove('omn-active', 'omn-margin', 'omn-bubble');
      this.tagSide(root, null);
      const layer = root.querySelector(':scope > .omn-layer');
      if (layer) layer.remove();
    });
  }

  cleanup(sizer) {
    // 只有老版本会往正文里塞节点，这里负责清残留；现在什么都不插，所以绝大多数时候该一趟都不跑
    let dirty = false;
    Array.from(sizer.children).forEach((el) => {
      if (!el.classList.contains('omn-card')) return;
      el.remove();
      dirty = true;
    });
    if (sizer.querySelector('mark.omn-mark')) {
      unwrapMarks(sizer);
      dirty = true;
    }
    // 正文真被动过才作废「哪块里有哪句话」的缓存。每次渲染都作废的话，
    // 滚动、改窗口大小这些只重排不重绘的场合也要把全文重读一遍，长文里就发涩
    if (dirty) sizer.__omnBlocks = null;
  }

  // 覆盖层和正文容器对齐；卡片、高亮、引线全画在这里面，Obsidian 的正文一个节点都不动
  layerFor(root, sizer) {
    let layer = root.querySelector(':scope > .omn-layer');
    if (!layer) layer = root.createDiv({ cls: 'omn-layer' });
    this.tagLayer(layer);
    layer.style.left = sizer.offsetLeft + 'px';
    layer.style.top = sizer.offsetTop + 'px';
    layer.style.width = sizer.offsetWidth + 'px';
    layer.style.height = sizer.offsetHeight + 'px';
    this.bindBubble(layer);
    return layer;
  }

  async render(view) {
    // markdown-view-rendered 也会直接叫这一句，传进来的 view 有可能是个没文件的空壳
    if (this.unloaded || !view || !view.file) return;
    const sizer = this.visibleSizer(view);
    if (!sizer) return;
    const root = sizer.closest('.markdown-preview-view') || view.contentEl;

    // 插件自己改 DOM 也会触发 MutationObserver，这段时间里屏蔽掉，否则会和观察器互相打死
    this.busy = true;
    try {
      this.cleanup(sizer);

      const path = view.file.path;
      const items = this.data[path] || [];
      const bubble = this.settings.displayMode === 'bubble';
      root.classList.toggle('omn-active', items.length > 0);
      this.tagSide(root);
      this.tagDisplay(root);
      if (!items.length) {
        const dead = root.querySelector(':scope > .omn-layer');
        if (dead) dead.remove();
        return;
      }

      const layer = this.layerFor(root, sizer);
      const locs = items.map((a) => this.locate(sizer, a.anchor, a.occ));
      // 打开一篇笔记会连着触发好几次渲染，每次都推倒重建卡片就是一闪一闪；签名没变就只重算位置。
      // 签名里带上每条批注落在正文第几块：原文被改掉、卡片该跟着消失时，签名就变了
      // 展示方式和高亮开关也要进签名：浮签方式即使关了高亮也必须画出色块，否则鼠标没地方停
      const kids = Array.from(sizer.children);
      // 整份签名当作 JSON.stringify 的「第一个参数」传：写成两个参数，第二个会被当成
      // replacer（字段白名单），批注内容全被过滤掉，签名永远只剩 ["margin",true] ——
      // 结果是改完批注正文，卡片死活不重画
      const sig = JSON.stringify([
        this.settings.displayMode,
        this.settings.highlight,
        items.map((a, i) => [a.id, a.anchor, a.category, a.note, a.occ || 0, kids.indexOf(locs[i] ? locs[i].el : null)]),
      ]);
      if (layer.omnSig === sig && layer.omnPlaced && layer.omnPlaced.length) {
        // 正文被 Obsidian 重排过（改窗口宽度、滚动懒渲染）时块元素会换成新的一批，
        // 老引用已经脱离文档，卡片和高亮会量到 0 宽 —— 只把引用换回来，不重画卡片
        layer.omnPlaced.forEach((it) => {
          const b = locs[it.idx];
          if (b && (it.block !== b.el || it.occInBlock !== b.occ)) {
            it.block = b.el;
            it.occInBlock = b.occ;
            it.rectCache = null;
          }
        });
        this.place(root, layer, layer.omnPlaced);
        return;
      }
      layer.empty();
      layer.omnSig = '';

      const pending = [];
      const placed = [];
      items.forEach((a, i) => {
        const loc = locs[i];
        if (!loc) return;
        const block = loc.el;

        const card = layer.createDiv({ cls: 'omn-card ' + this.catCls(a.category) });
        card.dataset.omnId = a.id;
        card.createDiv({ cls: 'omn-cat', text: a.category || '批注' });
        // 卡片里先复述一遍被批注的原文，光靠短线看不出指的是哪句
        const quoted = (a.anchor || '').replace(/\s+/g, ' ').trim();
        const q = card.createDiv({ cls: 'omn-quote', text: quoted.length > 44 ? quoted.slice(0, 44) + '…' : quoted });
        q.title = quoted;
        const body = card.createDiv({ cls: 'omn-body' });
        // 运行时的参数顺序是 (app, markdown, el, sourcePath, component)，和官方文档写的顺序相反
        pending.push(MarkdownRenderer.render(this.app, a.note || '', body, path, this));
        card.addEventListener('click', (e) => {
          if (this.linkClick(e, path)) return;
          if (e.target.closest('button, input, textarea, img, .math')) return;
          this.edit(a, path);
        });

        // 浮签模式下色块就是触发器，高亮开关被忽略也要画
        const hl = this.settings.highlight || bubble ? layer.createDiv({ cls: 'omn-hl ' + this.catCls(a.category) }) : null;
        if (hl) hl.dataset.omnId = a.id;
        placed.push({ a, idx: i, card, hl, block, occInBlock: loc.occ });
      });

      layer.omnPlaced = placed;
      // 签名先记下来再等异步：等完再记的话，只要有第二次渲染插进来（观察器、resize 都会叫），
      // 这批卡片的签名就永远记不上，下一次又推倒重建 —— 卡片闪就是这么来的
      layer.omnSig = sig;

      this.place(root, layer, placed);
      // 卡片正文异步渲染完高度才会定下来，所以再排一次位置
      await Promise.allSettled(pending);
      // 期间可能又起了一次渲染，只有这批卡片还在层里才补排，否则会把已经作废的卡片又摆出来
      if (layer.isConnected && layer.omnPlaced === placed) {
        this.place(root, layer, placed);
      }
    } finally {
      const owed = this.renderOwed;
      this.renderOwed = false;
      window.setTimeout(() => {
        this.busy = false;
        // 画的这段时间里正文又变过（切笔记、懒渲染、别的插件改了 DOM）：补一次，别把这一下吞了
        if (owed) this.scheduleRender();
      }, 0);
    }
  }

  // 卡片宽占比，脏值一律夹回 12%~40%，别让 NaN 流进宽度
  cardRatio() {
    const p = Number(this.settings.cardPct);
    return Math.min(40, Math.max(12, Number.isFinite(p) ? p : DEFAULT_SETTINGS.cardPct)) / 100;
  }

  // 页边的三条宽度按面板实际宽度现算：设置里的「卡片占比 / 空隙」是上限，不是死值。
  // 单边也想把正文摆正中，就得在对面空出一条同宽的假列（plan(2)）：够宽才这么排，
  // 不够就退回贴对侧的老排法（plan(1)），否则卡片会盖到文字上。
  // 算完写回 --omn-* 让 CSS 用同一份数，正文永远只占剩下的那份。
  fit(root, W) {
    const s = this.settings;
    const side = SIDES.some(([k]) => k === s.marginSide) ? s.marginSide : DEFAULT_SETTINGS.marginSide;
    const TEXT_MIN = 380;
    const CARD_MIN = 150;
    const r = this.cardRatio();
    // 两边都不许贴窗口边：批注列外侧和正文外侧各留一份呼吸位（--omn-edge 给 CSS 用同一份数）
    const edge = Math.round(Math.min(32, Math.max(20, W * 0.028)));
    const plan = (n) => {
      let gap = Math.min(s.gap || 40, W * 0.06);
      let card = Math.max(CARD_MIN, Math.min(W * r, W * 0.4));
      let text = W - n * (card + gap) - 2 * edge;
      if (text < TEXT_MIN) {
        gap = Math.min(gap, 16);
        card = Math.max(CARD_MIN, Math.ceil((W - TEXT_MIN - 2 * edge) / n - gap));
        text = W - n * (card + gap) - 2 * edge;
      }
      return { n, gap, card, edge, text };
    };
    const two = plan(2);
    const f = two.text >= TEXT_MIN ? two : plan(1);
    const out = {
      side: f.n === 1 && side === 'both' ? 'right' : side,
      card: Math.round(f.card),
      gap: Math.round(f.gap),
      edge: f.edge,
      // 正文列宽同样是上限：面板宽就按设置走，面板窄就让给批注列
      text: Math.round(Math.min(s.textWidth || W, f.text)),
      centered: f.n === 2,
    };
    root.style.setProperty('--omn-card', out.card + 'px');
    root.style.setProperty('--omn-gap', out.gap + 'px');
    root.style.setProperty('--omn-text', out.text + 'px');
    root.style.setProperty('--omn-edge', out.edge + 'px');
    // 正文居中还是贴对侧，CSS 靠这个类切换；双边本来就居中，一并算上
    root.classList.toggle('omn-centered', out.centered);
    this.tagSide(root, out.side);
    return out;
  }

  // 算位置：卡片顶到原文那一行，同一列里挨太近就往下顺延，不叠在一起
  place(root, layer, placed) {
    const lr = layer.getBoundingClientRect();
    // 叶子被切走时量到的宽度是 0，这一遍不排，等笔记重新可见（active-leaf-change / 观察器会再来一次）
    if (!lr.width) return;

    // 浮签方式正文满宽、不留批注列：只把原文色块摆好，卡片等鼠标上来再定位（宽度由 openBubble 按面板算）
    if (this.settings.displayMode === 'bubble') {
      placed.forEach((it) => this.markLines(it, lr));
      return;
    }

    const f = this.fit(root, lr.width);
    // 居中排法里卡片贴着正文列的外侧，不再钉在窗口边上 —— 正文和卡片中间那段大白空白就是这么来的
    const textLeft = (lr.width - f.text) / 2;
    const RIGHT = f.centered ? textLeft + f.text + f.gap : lr.width - f.edge - f.card;
    const LEFT = f.centered ? textLeft - f.gap - f.card : f.edge;
    // 卡片按原文从上到下排，不按批注存的先后：后加的批注即使挂在更前面那段，
    // 也轮到它先落位，不会被「往下顺延」挤到最底下。
    const items = placed.map((it, i) => ({ it, i, rects: this.markLines(it, lr) }))
      .sort((x, y) => x.rects[0].top - y.rects[0].top || x.i - y.i);
    // 双边时两条列各自往下排，互不牵扯；交替分配按原文从上到下，第一条落右边
    const bottoms = { right: 0, left: 0 };
    const colOf = [];
    items.forEach((o, n) => {
      colOf[o.i] = f.side === 'both' ? (n % 2 ? 'left' : 'right') : (f.side === 'left' ? 'left' : 'right');
    });

    items.forEach((o) => {
      const it = o.it;
      const first = o.rects[0];

      const col = colOf[o.i];
      const top = Math.max(first.top - lr.top, bottoms[col]);
      it.card.style.left = (col === 'left' ? LEFT : RIGHT) + 'px';
      it.card.style.width = f.card + 'px';
      it.card.style.top = top + 'px';
      // 在左列的卡片，引线要反过来朝右指
      it.card.classList.toggle('omn-flip', col === 'left');
      bottoms[col] = top + it.card.offsetHeight + 10;
    });
  }

  // 原文那几句话的行矩形。块没换、块宽没变就吃缓存 —— 长文里每次滚动都重走一遍
  // TreeWalker + 逐字规范化，就是点批注时那一下卡顿。缓存存的是「相对本块」的偏移，
  // 所以图片晚加载、正文上下挪位也不会错位。
  lineRects(it) {
    const br = it.block.getBoundingClientRect();
    const c = it.rectCache;
    // 键用块自己的宽度：页边的正文列宽是插件按面板现算的，会随窗口变，
    // 拿覆盖层宽度当键就漏掉了「列宽变了、行数跟着变了」这一种，高亮会停在旧行上
    const key = Math.round(br.width);
    if (!c || c.block !== it.block || c.w !== key || !br.height) {
      const list = this.anchorRects(it.block, it.a.anchor, it.occInBlock);
      if (!list || !br.height) return [br];
      it.rectCache = {
        block: it.block,
        w: key,
        lines: list.map((r) => ({ x: r.left - br.left, y: r.top - br.top, width: r.width, height: r.height })),
      };
    }
    return it.rectCache.lines.map((l) => ({ left: br.left + l.x, top: br.top + l.y, width: l.width, height: l.height }));
  }

  // 高亮色块：有几行摆几个，节点能复用就不重建（滚动时反复 empty/create 也是一笔开销）
  markLines(it, lr) {
    const rects = this.lineRects(it);
    if (it.hl) {
      const kids = it.hl.children;
      while (kids.length > rects.length) it.hl.removeChild(kids[kids.length - 1]);
      while (kids.length < rects.length) {
        const d = it.hl.createDiv({ cls: 'omn-hl-line' });
        d.dataset.omnId = it.a.id;
      }
      for (let n = 0; n < rects.length; n++) {
        const r = rects[n];
        const d = kids[n];
        d.style.left = r.left - lr.left + 'px';
        d.style.top = r.top - lr.top + 'px';
        d.style.width = r.width + 'px';
        d.style.height = r.height + 'px';
      }
    }
    return rects;
  }

  // 只量矩形，不改正文：把 anchor 在块里的文本范围找出来，返回它每一行的位置
  anchorRects(block, anchor, occ) {
    const target = norm(anchor || '').text;
    if (!target) return null;
    const parts = [];
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => {
        if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let joined = '';
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const n = norm(node.nodeValue);
      parts.push({ node, from: joined.length, to: joined.length + n.text.length, map: n.map });
      joined += n.text;
    }

    let idx = joined.indexOf(target);
    for (let k = 0; idx !== -1 && k < (occ || 0); k++) idx = joined.indexOf(target, idx + target.length);
    if (idx === -1) idx = joined.indexOf(target);
    if (idx === -1) return null;
    const end = idx + target.length;
    const hit = parts.filter((p) => p.from < end && p.to > idx);
    if (!hit.length) return null;

    const a = hit[0];
    const b = hit[hit.length - 1];
    const range = document.createRange();
    range.setStart(a.node, a.map[Math.max(idx - a.from, 0)]);
    range.setEnd(b.node, b.map[Math.min(end - b.from, b.to - b.from) - 1] + 1);
    const rects = Array.from(range.getClientRects());
    return rects.length ? rects : null;
  }


  // 「哪一块正文里有哪句话」的扫描结果整篇共用一份。以前每条批注都要把全文再读一遍 textContent
  // 并逐字规范化，长文里点一下批注就是几百次全文读取 —— 那一下卡顿就是这么来的。
  // 正文节点一变（观察器 / cleanup）就把这份缓存作废，不会拿着旧文本骗人。
  blockTexts(sizer) {
    const kids = Array.from(sizer.children).filter((el) => !el.classList.contains('omn-card'));
    const c = sizer.__omnBlocks;
    if (c && c.list.length === kids.length && c.list.every((b, i) => b.el === kids[i])) return c.list;
    const list = kids.map((el) => ({ el, text: norm(el.textContent || '').text }));
    sizer.__omnBlocks = { list };
    return list;
  }

  // 一句话在正文里出现好几次时，靠 occ（第几次出现）挑出他当初选中的那一处。
  // 返回 { el: 哪一块, occ: 在这一块里是第几次 }
  locate(sizer, anchor, occ) {
    const target = norm(anchor || '').text;
    if (!target) return null;
    occ = occ || 0;
    const blocks = this.blockTexts(sizer);
    let seen = 0;
    let last = null;
    for (const b of blocks) {
      const n = countOcc(b.text, target);
      if (!n) continue;
      last = { el: b.el, occ: n - 1 };
      if (seen + n > occ) return { el: b.el, occ: occ - seen };
      seen += n;
    }
    // 记的那一次比现在正文里的出现次数多（前面有一处被删了）：落在还能找到的最后一处
    if (last) return last;
    const short = target.slice(0, 16);
    if (short.length >= 6) {
      for (const b of blocks) {
        if (b.text.includes(short)) return { el: b.el, occ: 0 };
      }
    }
    return null;
  }

  findBlock(sizer, anchor, occ) {
    const hit = this.locate(sizer, anchor, occ);
    return hit ? hit.el : null;
  }

  // 选区起点之前，这句话已经出现过几次 —— 新建批注时用它算出 occ
  occOfSelection(sizer, sel) {
    const target = norm(sel && sel.toString ? sel.toString() : '').text;
    if (!target || !sel.rangeCount) return 0;
    const range = sel.getRangeAt(0);
    const startBlock = blockOf(range.startContainer, sizer) || blockOf(sel.anchorNode, sizer);
    if (!startBlock) return 0;
    let occ = 0;
    for (const b of this.blockTexts(sizer)) {
      if (b.el !== startBlock) {
        occ += countOcc(b.text, target);
        continue;
      }
      const before = norm(this.textBefore(b.el, range.startContainer, range.startOffset)).text.length;
      let pos = b.text.indexOf(target);
      let k = 0;
      while (pos !== -1 && pos < before) {
        k++;
        pos = b.text.indexOf(target, pos + target.length);
      }
      return occ + k;
    }
    return 0;
  }

  // 块里排在选区起点前面的那些字
  textBefore(blockEl, node, offset) {
    const walker = document.createTreeWalker(blockEl, NodeFilter.SHOW_TEXT);
    let s = '';
    if (node && node.nodeType !== 3) {
      while (walker.nextNode()) {
        const n = walker.currentNode;
        if (node.contains && node.contains(n)) break;
        s += n.nodeValue || '';
      }
      return s;
    }
    while (walker.nextNode()) {
      const n = walker.currentNode;
      if (n === node) return s + String(n.nodeValue || '').slice(0, offset);
      s += n.nodeValue || '';
    }
    return s;
  }

  addFromSelection(view) {
    const sizer = this.visibleSizer(view);
    if (!sizer) {
      new Notice(L('Margin Cards 只在阅读视图里工作：右上角点书本图标切过去，再选中正文文字', 'Margin Cards works in Reading view only: click the book icon at the top right, then select the text'));
      return;
    }
    const sel = window.getSelection();
    const text = sel ? sel.toString().trim() : '';
    if (!text) {
      new Notice(L('先选中要批注的文字（在阅读视图里），松手后点旁边冒出的「批注」', 'Select the text first (in Reading view), then click the Annotate button that appears'));
      return;
    }
    if (!blockOf(sel.anchorNode, sizer)) {
      new Notice(L('选区不在正文里，换一处再试', 'The selection is not in the text — try somewhere else'));
      return;
    }

    const a = {
      id: newId(),
      anchor: text.slice(0, 240),
      // 这句在正文里是第几次出现，先在这一刻定死：不记的话重复句子一律挂到第一处
      occ: this.occOfSelection(sizer, sel),
      category: (this.settings.categories[0] || {}).name || '批注',
      note: '',
      created: new Date().toISOString(),
    };
    // 弹窗可能开着不动，期间主区叶子会被复用成别的笔记，所以路径要在这一刻定死，不能等保存时再读
    const path = view.file.path;

    new NoteModal(this.app, {
      isNew: true,
      sourcePath: path,
      anchor: a.anchor,
      category: a.category,
      note: '',
      categories: this.categoryList(),
      onSave: async (vals) => {
        a.category = vals.category;
        a.note = vals.note;
        await this.upsert(path, a);
        this.renderPath(path);
      },
      onDelete: async () => {
        await this.remove(path, a.id);
        this.renderPath(path);
      },
    }).open();
  }

  edit(a, path) {
    new NoteModal(this.app, {
      isNew: false,
      sourcePath: path,
      anchor: a.anchor,
      category: a.category,
      note: a.note,
      categories: this.categoryList(a.category),
      onSave: async (vals) => {
        a.category = vals.category;
        a.note = vals.note;
        await this.upsert(path, a);
        this.renderPath(path);
      },
      onDelete: async () => {
        await this.remove(path, a.id);
        this.renderPath(path);
      },
    }).open();
  }

  scrollTo(id, tries) {
    if (this.unloaded) return;
    tries = tries === undefined ? 3 : tries;
    const hit = this.findById(id);
    if (!hit) return;
    // 浮签模式下卡片平时不显示，所以跳的是原文色块；两种都只认屏幕上看得见的那份
    const cls = this.settings.displayMode === 'bubble' ? '.omn-hl-line' : '.omn-card';
    const el = Array.from(document.querySelectorAll(cls)).find(
      (c) => c.dataset.omnId === id && c.offsetWidth > 0
    );
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      this.flash(id, el);
      return;
    }
    // 这篇开在编辑器里：本来就没有卡片可滚，别切模式、也别空等，直接在正文里按行找
    if (this.editViewOf(hit.p)) {
      this.scrollToLine(hit);
      return;
    }
    // 这篇的卡片可能压根还没画出来（后台标签页、刚重载过插件都会这样）—— 主动补排一次，别干等
    this.renderPath(hit.p);
    if (tries > 0) {
      window.setTimeout(() => this.scrollTo(id, tries - 1), 300);
      return;
    }
    this.reportLost(hit);
  }

  // 「这句原文还在不在」用源码来判断，别把「正文没画出来」说成「文字被改过了」
  async reportLost(hit) {
    const info = await this.plainInfo(hit.p);
    if (info && this.anchorInInfo(info, hit.a.anchor)) {
      new Notice(L('这句原文还在笔记里，是正文没画出来：点一下笔记正文再试', 'The sentence is still in the note, the text just was not rendered: click into the note body and try again'));
      return;
    }
    this.markLost(hit.a.id);
    if (info && info.query) {
      new Notice(L('这句是查询代码块渲染出来的，源码里没有这几个字，批注挂不上：右键这条，选「重新选原文」挑一句正文里手写的', 'This sentence was rendered by a query block, so those words are not in the source and nothing can attach: right-click the entry, choose Re-pick the text, then pick a sentence you typed yourself'));
      return;
    }
    new Notice(L('这句原文在笔记里已经找不到了：在面板里右键这条，选「重新选原文」', 'The original sentence is no longer in the note: right-click the entry in the panel and choose Re-pick the text'));
  }

  // 笔记源码折成「屏幕上能看到的那些字」，按 mtime+size 缓存；文件一改自然作废。
  // 顺带记下这篇有没有查询代码块：Dataview / 任务块渲染出来的句子源码里根本没有，
  // 批注挂在那种句子上一定失败，得把原因说清楚，别让人以为插件坏了
  async plainInfo(path) {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!f || !f.stat) return null; // 文件没了 → 调用方按「找不到」处理
    const cache = this.plainCache || (this.plainCache = {});
    const key = f.stat.mtime + ':' + f.stat.size;
    const old = cache[path];
    if (old && old.key === key) return old;
    let src = '';
    try {
      src = await this.app.vault.cachedRead(f);
    } catch (e) {
      return null;
    }
    const entry = {
      key: key,
      text: norm(plainify(src)).text,
      query: /^\s*(```|~~~)[ \t]*(dataview|dataviewjs|tasks|js)\b/im.test(src) || /`=/.test(src),
    };
    cache[path] = entry;
    return entry;
  }

  async plainText(path) {
    const info = await this.plainInfo(path);
    return info ? info.text : null;
  }

  // 整句找不到时，再拿前面一小截试一次：他改的多半是句子中间或尾巴，不是整句被删
  anchorInInfo(info, anchor) {
    const t = norm(String(anchor || '')).text;
    if (t.length < 3) return true; // 没记原文的老批注不算丢
    if (info.text.indexOf(t) >= 0) return true;
    if (t.length < 6) return false;
    return info.text.indexOf(t.slice(0, 16)) >= 0;
  }

  async anchorOk(path, anchor) {
    const info = await this.plainInfo(path);
    if (!info) return false;
    return this.anchorInInfo(info, anchor);
  }

  scheduleAnchorCheck() {
    if (this.unloaded) return;
    if (this.anchorTimer) window.clearTimeout(this.anchorTimer);
    this.anchorTimer = window.setTimeout(() => {
      this.anchorTimer = 0;
      this.checkAnchors();
    }, 600);
  }

  // 全库扫一遍，把挂不上的批注号记在内存里给面板加一栏；不写盘，批注.json 一个字都不动
  async checkAnchors() {
    const mine = (this.checkSeq || 0) + 1;
    this.checkSeq = mine;
    const ids = [];
    for (const p of Object.keys(this.data || {})) {
      for (const a of this.data[p] || []) {
        if (!(await this.anchorOk(p, a.anchor))) ids.push(a.id);
      }
    }
    if (mine !== this.checkSeq) return;
    const before = (this.brokenIds || []).join('|');
    this.brokenIds = ids;
    if (before !== ids.join('|')) this.refreshBrowser();
  }

  markLost(id) {
    if (!this.brokenIds) this.brokenIds = [];
    if (this.brokenIds.indexOf(id) >= 0) return;
    this.brokenIds.push(id);
    this.refreshBrowser();
  }

  // 编辑器里定位：从文件文本算出 anchor 落在第几行，光标挪过去，再给那一行闪一下。
  // anchor 可能跨行，所以只拿它第一行去匹配；读的是 Obsidian 的文本缓存，不额外开文件
  async scrollToLine(hit) {
    const v = this.editViewOf(hit.p);
    if (!v) return;
    const key = norm(String(hit.a.anchor || '').split('\n')[0]).text;
    if (key.length < 3) return;
    let src = '';
    try {
      src = await this.app.vault.cachedRead(v.file);
    } catch (e) {
      return;
    }
    const lines = src.split('\n');
    // 源码里同样有好几行含这句：按记下来的「第几次出现」挑一行，超出就落在最后一行
    const pick = (k) => {
      const hits = [];
      lines.forEach((l, i) => {
        if (norm(l).text.includes(k)) hits.push(i);
      });
      if (!hits.length) return -1;
      return hits[Math.min(hit.a.occ || 0, hits.length - 1)];
    };
    let k2 = key;
    let line = pick(key);
    // 句子中间被改过就整行对不上了，再拿前面一小截试一次；闪行的精度低一点没关系
    if (line < 0 && key.length >= 12) {
      k2 = key.slice(0, 16);
      line = pick(k2);
    }
    if (line < 0) {
      this.reportLost(hit);
      return;
    }
    const pos = { line: line, ch: 0 };
    try {
      v.editor.setCursor(pos);
      if (v.editor.scrollIntoView) v.editor.scrollIntoView({ from: pos, to: pos }, true);
    } catch (e) {}
    // 那一行要等 CodeMirror 重排后才进 DOM，稍等一下再上色
    window.setTimeout(() => {
      const el = Array.from(v.contentEl.querySelectorAll('.cm-line')).find((x) => norm(x.textContent || '').text.includes(k2));
      if (!el) return;
      el.addClass('omn-flash-line');
      window.setTimeout(() => el.isConnected && el.removeClass('omn-flash-line'), FLASH_MS);
    }, 150);
  }

  // 跳过去之后，把卡片和原文那几句各闪一下，长文里不用再用眼睛找
  // host 可能是页边卡片，也可能是浮签模式下的原文色块；块和行矩形直接领排版时算好的结果，
  // 不再全文重扫一遍（重扫就是点一下卡一下的另一个来源）
  flash(id, host) {
    if (host.classList.contains('omn-card')) {
      host.addClass('omn-flash-card');
      window.setTimeout(() => host.isConnected && host.removeClass('omn-flash-card'), FLASH_MS);
    }
    const root = host.closest('.markdown-preview-view');
    const layer = root && root.querySelector(':scope > .omn-layer');
    const anchor = layer || (root && root.querySelector('.markdown-preview-sizer'));
    if (!anchor || !anchor.offsetWidth) return;

    let it = layer ? (layer.omnPlaced || []).find((x) => x.a.id === id) : null;
    if (!it) {
      const hit = this.findById(id);
      // 找块要用正文容器（sizer），页边覆盖层里没有正文
      const sizer = root && root.querySelector('.markdown-preview-sizer');
      const loc = hit && sizer ? this.locate(sizer, hit.a.anchor, hit.a.occ) : null;
      if (!loc) return;
      it = { a: hit.a, block: loc.el, occInBlock: loc.occ };
    }

    const fl = root.createDiv({ cls: 'omn-flashlayer' });
    // 单独一个闪烁层，不复用 .omn-layer：那个层会在重绘时被 empty() 掉
    fl.style.left = anchor.offsetLeft + 'px';
    fl.style.top = anchor.offsetTop + 'px';
    fl.style.width = anchor.offsetWidth + 'px';
    fl.style.height = anchor.offsetHeight + 'px';
    const fr = fl.getBoundingClientRect();
    this.lineRects(it).forEach((r) => {
      const d = fl.createDiv({ cls: 'omn-flash ' + this.catCls(it.a.category) });
      d.style.left = r.left - fr.left + 'px';
      d.style.top = r.top - fr.top + 'px';
      d.style.width = r.width + 'px';
      d.style.height = r.height + 'px';
    });
    window.setTimeout(() => fl.isConnected && fl.remove(), FLASH_MS);

    // 浮签方式跳过来要顺手把气泡展开，不然闪完什么内容都看不到
    if (layer && it.card && this.settings.displayMode === 'bubble') this.openBubble(layer, it);
  }

  // 鼠标停在原文色块上才展开气泡，移开一会儿再收 —— 绑在覆盖层上，一层一次
  bindBubble(layer) {
    if (layer.__omnBubble) return;
    layer.__omnBubble = true;
    const item = (el) => {
      const id = el && el.dataset ? el.dataset.omnId : null;
      return id ? (layer.omnPlaced || []).find((x) => x.a.id === id) : null;
    };
    layer.addEventListener('mouseover', (e) => {
      const line = e.target.closest ? e.target.closest('.omn-hl-line') : null;
      if (!line) return;
      const it = item(line);
      if (it) {
        this.clearBubbleHide(layer);
        this.openBubble(layer, it, line);
      }
    });
    layer.addEventListener('mouseout', (e) => {
      const line = e.target.closest ? e.target.closest('.omn-hl-line') : null;
      if (!line) return;
      const to = e.relatedTarget;
      if (to && to.closest && (to.closest('.omn-card') || to.closest('.omn-hl-line'))) return;
      this.scheduleBubbleHide(layer);
    });
    // 用键盘 / 触屏把焦点移过来时没有 mouseover，点一下也展开
    layer.addEventListener('click', (e) => {
      const line = e.target.closest ? e.target.closest('.omn-hl-line') : null;
      if (!line) return;
      const it = item(line);
      if (it) this.openBubble(layer, it, line);
    });
  }

  openBubble(layer, it, lineEl) {
    const card = it.card;
    if (!card || !card.isConnected) return;
    if (!card.__omnBound) {
      card.__omnBound = true;
      // 鼠标从原文挪进气泡里这一下不能算离开
      card.addEventListener('mouseenter', () => this.clearBubbleHide(layer));
      card.addEventListener('mouseleave', () => this.scheduleBubbleHide(layer));
    }
    this.closeBubbles(layer, it);
    card.classList.add('omn-open');
    if (it.hl) it.hl.classList.add('omn-hl-on');

    const lr = layer.getBoundingClientRect();
    // 气泡按同样的比例缩放，再比页边卡放宽一点：悬停是临时看一眼，挤成一条就不想看了
    const pw = layer.offsetWidth;
    const w = Math.round(Math.max(220, Math.min(pw * 0.55, pw * this.cardRatio() * 1.25)));
    card.style.width = w + 'px';
    // 定位基准优先用「鼠标停住的那块色块」自己的矩形：它已经按行摆好了，气泡贴它旁边一定对得上；
    // 拿不到元素（比如从面板跳过来）再退回行矩形缓存
    let anchor = null;
    const src = lineEl || (it.hl ? it.hl.querySelector('.omn-hl-line') : null);
    if (src && src.offsetWidth) {
      const sr = src.getBoundingClientRect();
      anchor = { left: sr.left, top: sr.top, right: sr.right };
    } else {
      const first = this.lineRects(it)[0];
      // 缓存里的行矩形是视口坐标，且没有 right（以前写 first.right 拿到 undefined，算出 NaN，气泡的 left 就没设上）
      if (first) anchor = { left: first.left, top: first.top, right: first.left + first.width };
    }
    if (!anchor || !Number.isFinite(anchor.left) || !Number.isFinite(anchor.top)) return;
    const box = card.getBoundingClientRect();
    const H = box.height || 160;
    const W = box.width || w;
    // 优先贴在这一行的右边（和页边的习惯一致），挤不下就翻到左边，再挤就压在正文上
    let left = anchor.right - lr.left + 10;
    if (left + W > layer.offsetWidth) left = anchor.left - lr.left - W - 10;
    if (left < 0) left = Math.max(0, Math.min(anchor.left - lr.left, layer.offsetWidth - W));
    let top = anchor.top - lr.top - 6;
    const room = window.innerHeight - 14 - (lr.top + top);
    if (room < H) top = Math.max(0, top + (room - H) + 40);
    if (top < 0) top = 0;
    card.style.left = Math.round(left) + 'px';
    card.style.top = Math.round(top) + 'px';
  }

  closeBubbles(layer, keep) {
    (layer.omnPlaced || []).forEach((it) => {
      if (it === keep) return;
      it.card.classList.remove('omn-open');
      if (it.hl) it.hl.classList.remove('omn-hl-on');
    });
  }

  scheduleBubbleHide(layer) {
    this.clearBubbleHide(layer);
    // 留一点缓冲：从原文划到气泡中间那一下不能就把它关掉，否则气泡里的链接根本点不到
    layer.__omnHideTimer = window.setTimeout(() => {
      layer.__omnHideTimer = 0;
      this.closeBubbles(layer);
    }, 260);
  }

  clearBubbleHide(layer) {
    if (layer.__omnHideTimer) window.clearTimeout(layer.__omnHideTimer);
    layer.__omnHideTimer = 0;
  }

  findById(id) {
    for (const p of Object.keys(this.data)) {
      const a = (this.data[p] || []).find((x) => x.id === id);
      if (a) return { p, a };
    }
    return null;
  }

  // 导出复习清单：写库根一个新文件，正文一个字符都不碰
  async exportMd(scope) {
    if (this.unloaded) return;
    let rows = [];
    Object.keys(this.data).forEach((p) => {
      (this.data[p] || []).forEach((a) => rows.push({ p, a }));
    });
    if (scope === 'current') {
      // 导出只认「现在打开的是哪一篇」，用不着非得在读视图里
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view || !view.file) {
        new Notice(L('导出现在这篇：先打开一篇笔记', 'Export this note: open a note first'));
        return;
      }
      const cur = view.file.path;
      rows = rows.filter((r) => r.p === cur);
      if (!rows.length) {
        new Notice(L('这篇还没有批注：', 'No annotations in this note: ') + cur);
        return;
      }
    }
    if (!rows.length) {
      new Notice(L('批注.json 里还没有任何批注', '批注.json does not have any annotations yet'));
      return;
    }

    const name = normalizePath(((this.settings.exportFile || '批注清单.md') + '').trim().replace(/\.md$/, '') + '.md');
    const md = this.buildMd(rows, scope);
    let out = this.app.vault.getAbstractFileByPath(name);
    try {
      if (out) {
        // 走 vault.modify：清单可能正开在另一个标签页里，用 adapter 直接写盘会让 Obsidian 里的旧内容还挂着
        await this.app.vault.modify(out, md);
      } else {
        out = await this.app.vault.create(name, md);
      }
    } catch (e) {
      new Notice(L('清单写不进去：', 'Could not write the list: ') + e.message);
      return;
    }
    new Notice(L('已导出 ', 'Exported ') + rows.length + L(' 条批注到 ', ' annotations to ') + name);
    if (out) await this.app.workspace.getLeaf('tab').openFile(out, { active: true });
  }

  buildMd(rows, scope) {
    const order = this.settings.categories.map((c) => c.name);
    const byCat = new Map();
    rows.forEach((r) => {
      const k = r.a.category || '批注';
      if (!byCat.has(k)) byCat.set(k, []);
      byCat.get(k).push(r);
    });
    const rank = (k) => (order.indexOf(k) < 0 ? 999 : order.indexOf(k));
    const keys = Array.from(byCat.keys()).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, 'zh'));
    const cn = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
    const title = (i) => L((i < cn.length ? cn[i] : String(i + 1)) + '、', String(i + 1) + '. ');

    let out =
      L('> 由 Margin Cards 导出的批注清单，共 ', '> Review list exported by Margin Cards — ') + rows.length + L(' 条（', rows.length === 1 ? ' annotation (' : ' annotations (') + this.stamp() + L('）\n', ')\n') +
      L('> 范围：', '> Scope: ') + (scope === 'current' ? L('当前这篇笔记', 'this note') : L('全库所有笔记', 'every note in the vault')) +
      L('。这个文件随便删，批注还在 批注.json 里；再导出一次会覆盖它。\n\n', '. Delete this file whenever you like — the annotations stay in 批注.json, and exporting again overwrites the list.\n\n');

    keys.forEach((k, i) => {
      const list = byCat.get(k).slice().sort((a, b) => a.p.localeCompare(b.p, 'zh') || String(a.a.created || '').localeCompare(String(b.a.created || '')));
      out += '# ' + title(i) + k + L('（', ' (') + list.length + L(' 条）\n\n', list.length === 1 ? ' item)\n\n' : ' items)\n\n');
      list.forEach((r) => {
        const anchor = (r.a.anchor || '').replace(/\s+/g, ' ').trim();
        const noteName = r.p.replace(/^.*\//, '').replace(/\.md$/, '');
        // 标题是「哪篇笔记」，原文另起一行引用，别把同一句话写两遍
        out += '## ' + noteName + '\n\n';
        out += L('> 原文：', '> Original: ') + anchor + '\n\n';
        out += ((r.a.note || '').trim() || L('（这条没写内容）', '(no text in this annotation)')) + '\n\n';
        out += '*' + this.stamp(r.a.created) + ' · [[' + noteName + ']]*\n\n';
      });
    });
    return out;
  }

  stamp(iso) {
    const d = iso ? new Date(iso) : new Date();
    const p = (n) => (n < 10 ? '0' + n : '' + n);
    if (isNaN(d.getTime())) return String(iso);
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + (iso ? ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) : '');
  }

  // 文件夹改名/挪走：把以老路径开头的键一个个搬到新路径下面
  moveKeys(from, to) {
    const hit = Object.keys(this.data).filter((p) => p.startsWith(from));
    if (!hit.length) return;
    hit.forEach((p) => {
      const np = to + p.slice(from.length);
      this.data[np] = (this.data[np] || []).concat(this.data[p]);
      delete this.data[p];
    });
    this.save();
    this.refreshBrowser();
  }

  async upsert(path, a) {
    // 弹窗还开着但插件被重新加载了（改了代码、手动开关）：这时候写盘会用死实例的旧内存
    // 把新实例的数据整份顶掉。宁可让他重做一遍，也不能悄悄把批注弄丢
    if (this.unloaded) {
      new Notice(L('插件刚被重新加载，这一步没保存，请再点一次保存', 'The plugin was just reloaded, so this save did not go through — click Save again'));
      return;
    }
    if (!this.data[path]) this.data[path] = [];
    const list = this.data[path];
    const i = list.findIndex((x) => x.id === a.id);
    if (i === -1) list.push(a);
    else list[i] = a;
    await this.save();
    this.scheduleAnchorCheck();
    this.refreshBrowser();
  }

  async remove(path, id) {
    if (this.unloaded) {
      new Notice(L('插件刚被重新加载，这一步没删除，请再点一次', 'The plugin was just reloaded, so this delete did not go through — click again'));
      return;
    }
    if (!this.data[path]) return;
    this.data[path] = this.data[path].filter((x) => x.id !== id);
    if (!this.data[path].length) delete this.data[path];
    await this.save();
    this.scheduleAnchorCheck();
    this.refreshBrowser();
  }

  async loadSettings() {
    const saved = (await this.loadData()) || {};
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
    if (!Array.isArray(this.settings.categories) || !this.settings.categories.length) {
      this.settings.categories = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.categories));
    }    // 样式值将来可能改名或删掉，认不出来就落回默认那套，别让覆盖层光着
    const known = (v, pairs, dft) => (pairs.some(([k]) => k === v) ? v : dft);
    this.settings.markStyle = known(this.settings.markStyle, MARK_STYLES, DEFAULT_SETTINGS.markStyle);
    this.settings.cardStyle = known(this.settings.cardStyle, CARD_STYLES, DEFAULT_SETTINGS.cardStyle);
    this.settings.leader = known(this.settings.leader, LEADERS, DEFAULT_SETTINGS.leader);
    this.settings.marginSide = known(this.settings.marginSide, SIDES, DEFAULT_SETTINGS.marginSide);
    this.settings.displayMode = known(this.settings.displayMode, DISPLAYS, DEFAULT_SETTINGS.displayMode);
    this.settings.language = known(this.settings.language, LANGS, DEFAULT_SETTINGS.language);
    // LANG 必须在任何文案画出来之前定下来：onload 里 ribbon、命令、面板都在这之后
    applyLang(this.settings.language);
    // 卡片原来是写死的像素宽，换成占面板的比例：老 data.json 里只有 cardWidth，
    // 合并默认值之后已经有个 26 了，所以要看 saved 里有没有，不能看 settings
    if (typeof saved.cardPct !== 'number') {
      this.settings.cardPct = Math.round(Math.min(40, Math.max(14, ((Number(saved.cardWidth) || 250) / 900) * 100)));
    }
    delete this.settings.cardWidth;
  }

  async updateSettings(patch) {
    Object.assign(this.settings, patch || {});
    applyLang(this.settings.language);
    // 先只更新那一串 CSS 变量：这步便宜，拖滑块时颜色、圆角能立刻跟着动
    this.applyStyle();
    // 重排正文、重画面板、写盘都贵。滑块每挪一格都来一遍会卡手（而且是往 OneDrive 里狂写文件），
    // 所以等手停下来 200ms 做一次
    if (this.setTimer) window.clearTimeout(this.setTimer);
    this.setTimer = window.setTimeout(() => {
      this.setTimer = 0;
      this.renderActive();
      this.refreshBrowser();
      this.saveData(this.settings);
    }, 200);
  }

  // 换语言：文案都是画的那一刻现取的，所以 ribbon 补一下、设置面板重画一次就行；
  // 卡片和总览面板交给 updateSettings 里那 200ms 后的重排
  async setLang(mode) {
    await this.updateSettings({ language: mode });
    if (this.ribbonEl) {
      const t = L('批注总览', 'Annotation overview');
      this.ribbonEl.setAttribute('aria-label', t);
      this.ribbonEl.setAttribute('title', t);
    }
    if (this.tab) this.tab.display();
  }

  // 分类颜色、宽度、圆角、引线、样式开关都写进一个动态 style，改设置立刻生效，不用动 styles.css
  applyStyle() {
    if (this.unloaded) return;
    const s = this.settings;
    const leader = LEADERS.some(([k]) => k === s.leader) ? s.leader : DEFAULT_SETTINGS.leader;
    let css =
      '.markdown-preview-view.omn-active,.omn-bw{--omn-text:' + s.textWidth + 'px;--omn-card:' +
      Math.round(this.cardRatio() * 100) + '%;--omn-gap:' + s.gap + 'px;--omn-radius:' + s.radius + 'px;--omn-leader:' + leader + ';}';
    s.categories.forEach((c, i) => {
      css +=
        '.omn-k' + i + '{--omn-accent:' + c.color + ';--omn-hl:' + hexToRgba(c.color, 0.14) +
        ';--omn-hl-strong:' + hexToRgba(c.color, 0.30) + ';--omn-fill:' + hexToRgba(c.color, 0.18) + ';}';
    });
    let el = document.getElementById('omn-dyn');
    if (!el) {
      el = document.createElement('style');
      el.id = 'omn-dyn';
      document.head.appendChild(el);
    }
    el.textContent = css;
    // 已经画出来的卡片不用重绘，换掉覆盖层身上的样式类就够了
    document.querySelectorAll('.omn-layer').forEach((layer) => this.tagLayer(layer));
    // 侧边栏面板跟着一起换，条目和卡片始终是同一件衣服
    document.querySelectorAll('.omn-bw').forEach((el) => this.tagSkin(el));
    // 换边要改的是正文列的对齐，所以挂在阅读视图容器上
    document.querySelectorAll('.markdown-preview-view').forEach((r) => {
      this.tagSide(r);
      this.tagDisplay(r);
    });
  }

  // 批注列在左 / 右 / 双边，落在阅读视图容器一个类上，正文对齐和卡片位置都读它
  // 传 null 表示这一篇现在没有批注，三个类全摘掉
  tagSide(root, want) {
    const side = want === null ? '' : want || this.settings.marginSide;
    SIDES.forEach(([k]) => root.classList.toggle('omn-side-' + k, k === side));
  }

  // 页边和浮签是两套排版：页边要让出正文列，浮签不动正文、只在原文上悬气泡
  tagDisplay(root) {
    const bubble = this.settings.displayMode === 'bubble';
    root.classList.toggle('omn-margin', !bubble);
    root.classList.toggle('omn-bubble', bubble);
  }

  // 原文标记 / 卡片皮肤两个开关落在覆盖层上，正文高亮和卡片各自认领
  tagLayer(layer) {
    MARK_STYLES.forEach(([k]) => layer.classList.toggle('omn-mk-' + k, k === this.settings.markStyle));
    this.tagSkin(layer);
  }

  // 卡片皮肤单独挂出来：面板里的批注条目要和页边卡片穿同一件衣服
  tagSkin(el) {
    CARD_STYLES.forEach(([k]) => el.classList.toggle('omn-cs-' + k, k === this.settings.cardStyle));
  }

  // Obsidian 的「点链接跳转」绑在阅读视图 / 编辑器自己身上，卡片和面板条目都画在外面够不着，
  // 内链外链得这里接手（实测过：不接手点了什么反应都没有）。处理掉了返回 true
  linkClick(e, path) {
    const link = e.target.closest ? e.target.closest('a') : null;
    if (!link) return false;
    e.preventDefault();
    e.stopPropagation();
    const href = link.getAttribute('href') || '';
    if (link.classList.contains('internal-link')) this.app.workspace.openLinkText(href, path, e.metaKey || e.ctrlKey);
    // 外链交给 app.openExternalLink（手机端才有反应）。只放行 http/https/mailto：
    // 批注内容是自己写的，但万一混进 javascript: 链接，点了就是执行脚本
    else if (/^(https?:|mailto:)/i.test(href)) this.app.openExternalLink(href);
    return true;
  }

  catCls(name) {
    const i = this.settings.categories.findIndex((c) => c.name === name);
    return i >= 0 ? 'omn-k' + i : catHashClass(name);
  }

  // 弹窗里那一排可点选的标签；批注原有的分类不在清单里时补在最前面
  categoryList(extra) {
    const list = this.settings.categories.map((c) => ({ name: c.name, cls: this.catCls(c.name) }));
    if (extra && !list.some((c) => c.name === extra)) {
      list.unshift({ name: extra, cls: this.catCls(extra) });
    }
    return list;
  }

  // 不能叫 load：那是 Component 基类的生命周期方法，覆盖了它 onload() 就不会被调用
  async readData() {
    // 先读进一份新的，整份读明白了再整体换掉：中途别把 this.data 清空，
    // 否则同一时间发生的渲染会当成「这篇没批注」，卡片直接消失
    const next = {};
    try {
      if (!(await this.app.vault.adapter.exists(normalizePath(DATA_FILE)))) return;
      const raw = await this.app.vault.adapter.read(normalizePath(DATA_FILE));
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
      // 这个文件是给人看的，手改坏一行、或者被别的工具写成别的形状都不能让插件跟着崩：
      // 只认「路径 → 条目数组，每条有 anchor」，其余整条丢掉，但原文一个字都不动。
      let dropped = 0;
      Object.keys(parsed).forEach((p) => {
        const val = parsed[p];
        if (!Array.isArray(val)) {
          dropped++;
          return;
        }
        const list = val.filter((a) => a && typeof a === 'object' && typeof a.anchor === 'string');
        if (list.length !== val.length) dropped += val.length - list.length;
        if (list.length) next[p] = list;
      });
      this.data = next;
      if (dropped) new Notice(L('批注数据里有 ', 'Skipping ') + dropped + L(' 条读不懂，本次先跳过；再动一次批注（保存）就会把它们从 ', ' unreadable entries this time; saving again will drop them from ') + DATA_FILE + L(' 里去掉', ''));
    } catch (e) {
      // 读砸了就留着内存里那一份：这时候存盘也不能把他本来看得见的批注写没了
      new Notice(L('批注数据读取失败：', 'Could not read the annotation data: ') + e.message);
    }
  }

  async save() {
    this.lastSelfWrite = Date.now();
    try {
      await this.app.vault.adapter.write(normalizePath(DATA_FILE), JSON.stringify(this.data, null, 2));
    } catch (e) {
      new Notice(L('批注保存失败：', 'Could not save the annotations: ') + e.message);
    }
  }
};
