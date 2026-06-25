export function clone(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

export function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function formatCurrency(value) {
  return `¥${Number(value || 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
}

function renderInlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

export function renderMarkdown(markdown = "") {
  const lines = String(markdown || "").replace(/\r/g, "").split("\n");
  const blocks = [];
  let listItems = [];
  let codeLines = [];
  let inCodeBlock = false;

  function flushList() {
    if (!listItems.length) return;
    blocks.push(`<ul>${listItems.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</ul>`);
    listItems = [];
  }

  function flushCode() {
    if (!codeLines.length) return;
    blocks.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
    codeLines = [];
  }

  lines.forEach((line) => {
    if (line.trim().startsWith("```")) {
      if (inCodeBlock) {
        flushCode();
      } else {
        flushList();
      }
      inCodeBlock = !inCodeBlock;
      return;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      return;
    }

    if (!line.trim()) {
      flushList();
      return;
    }

    if (line.startsWith("- ")) {
      listItems.push(line.slice(2));
      return;
    }

    flushList();

    if (line.startsWith("# ")) {
      blocks.push(`<h1>${renderInlineMarkdown(line.slice(2))}</h1>`);
      return;
    }

    if (line.startsWith("## ")) {
      blocks.push(`<h2>${renderInlineMarkdown(line.slice(3))}</h2>`);
      return;
    }

    if (line.startsWith("### ")) {
      blocks.push(`<h3>${renderInlineMarkdown(line.slice(4))}</h3>`);
      return;
    }

    if (line.startsWith("> ")) {
      blocks.push(`<blockquote>${renderInlineMarkdown(line.slice(2))}</blockquote>`);
      return;
    }

    blocks.push(`<p>${renderInlineMarkdown(line)}</p>`);
  });

  flushList();
  flushCode();

  return blocks.join("");
}

export function excerptText(value = "", maxLength = 80) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}...`;
}

export function isWithinLastDays(dateText, days) {
  if (!dateText) return false;
  const date = new Date(dateText);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  return diff >= 0 && diff <= days * 24 * 60 * 60 * 1000;
}

const PINYIN_MAP = {
  阿: "a",
  敖: "ao",
  宝: "bao",
  兵: "bing",
  波: "bo",
  彩: "cai",
  陈: "chen",
  晨: "chen",
  程: "cheng",
  德: "de",
  邓: "deng",
  丁: "ding",
  段: "duan",
  飞: "fei",
  峰: "feng",
  付: "fu",
  高: "gao",
  郭: "guo",
  贵: "gui",
  韩: "han",
  何: "he",
  胡: "hu",
  黄: "huang",
  金: "jin",
  江: "jiang",
  洁: "jie",
  娟: "juan",
  军: "jun",
  李: "li",
  莉: "li",
  亮: "liang",
  连: "lian",
  刘: "liu",
  玲: "ling",
  林: "lin",
  宏: "hong",
  娜: "na",
  潘: "pan",
  庞: "pang",
  彭: "peng",
  蒲: "pu",
  平: "ping",
  邱: "qiu",
  起: "qi",
  申: "shen",
  生: "sheng",
  婷: "ting",
  廷: "ting",
  王: "wang",
  文: "wen",
  吴: "wu",
  武: "wu",
  霞: "xia",
  贤: "xian",
  兴: "xing",
  许: "xu",
  严: "yan",
  杨: "yang",
  姨: "yi",
  毅: "yi",
  余: "yu",
  袁: "yuan",
  云: "yun",
  张: "zhang",
  兆: "zhao",
  赵: "zhao",
  郑: "zheng",
  忠: "zhong",
  周: "zhou",
  朱: "zhu",
};

export function getPinyinSearchText(value = "") {
  const chars = [...String(value || "")];
  const syllables = chars.map((char) => PINYIN_MAP[char] || (/^[a-z0-9]$/i.test(char) ? char.toLowerCase() : ""));
  const full = syllables.join("");
  const initials = syllables.map((item) => item.slice(0, 1)).join("");
  return [value, full, initials].filter(Boolean).join(" ");
}
