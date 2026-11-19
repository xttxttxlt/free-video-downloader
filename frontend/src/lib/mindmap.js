import { esc } from "./format.js";

// 思维导图 SVG / Markdown 生成
export const MM_COLORS = ["#1777FF", "#F59E0B", "#22C55E", "#EF4444", "#8B5CF6", "#14B8A6", "#EC4899", "#6366F1"];
const MM_FONT = '13px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif';

export function mindmapSvg(title, r) {
  const ctx = document.createElement("canvas").getContext("2d");
  ctx.font = MM_FONT;
  const width = (s) => ctx.measureText(s).width;
  const GAP = 44, PAD = 24, LINE = 17;

  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
  const wrap = (s, per = 14, maxLines = 2) => {
    const lines = [];
    for (let i = 0; i < s.length && lines.length < maxLines; i += per) lines.push(s.slice(i, i + per));
    if (lines.length === maxLines && s.length > per * maxLines) lines[maxLines - 1] = clip(lines[maxLines - 1], per - 1) + "…";
    return lines;
  };

  const root = { text: clip(title || "视频主题", 20), depth: 0, color: "#1777FF", children: [] };
  r.chapters.forEach((ch, i) => {
    const color = MM_COLORS[i % MM_COLORS.length];
    root.children.push({
      text: clip(ch.title, 16), depth: 1, color,
      children: ch.points.map((p) => ({ text: p, depth: 2, color, children: [] })),
    });
  });

  const maxW = [0, 0, 0];
  const prep = (n) => {
    n.lines = n.depth === 2 ? wrap(n.text) : [n.text];
    n.w = Math.max(...n.lines.map(width));
    n.h = n.depth === 2 ? n.lines.length * LINE + 10 : 26;
    maxW[n.depth] = Math.max(maxW[n.depth], n.w);
    if (!n.children.length) { n.leaves = 1; return 1; }
    n.leaves = n.children.reduce((s, c) => s + prep(c), 0);
    return n.leaves;
  };
  prep(root);
  const depthX = [PAD];
  for (let d = 1; d <= 2; d++) depthX[d] = depthX[d - 1] + maxW[d - 1] + GAP;
  const totalW = depthX[2] + maxW[2] + PAD;

  let cursor = PAD / 2;
  const place = (n) => {
    n.x = depthX[n.depth];
    if (!n.children.length) { n.y = cursor + n.h / 2; cursor += n.h + 6; }
    else { n.children.forEach(place); n.y = (n.children[0].y + n.children[n.children.length - 1].y) / 2; }
  };
  place(root);
  const totalH = cursor + PAD / 2;

  const edges = [], nodes = [];
  const walk = (n) => {
    const hasDot = n.depth < 2;
    const startX = n.x + n.w + (hasDot ? 12 : 0);
    n.children.forEach((c) => {
      const endX = c.x - 6;
      const midX = (startX + endX) / 2;
      edges.push(`<path d="M ${startX} ${n.y} C ${midX} ${n.y}, ${midX} ${c.y}, ${endX} ${c.y}" fill="none" stroke="${c.color}" stroke-width="1.6" opacity="${n.depth === 0 ? 0.9 : 0.55}"/>`);
      walk(c);
    });
    const lastY = n.y + ((n.lines.length - 1) / 2) * LINE;
    n.lines.forEach((ln, i) => {
      const y = n.y + (i - (n.lines.length - 1) / 2) * LINE + 4;
      nodes.push(`<text x="${n.x}" y="${y}" font-size="13" fill="${n.depth === 2 ? "#475569" : "#0F172A"}" font-weight="${n.depth < 2 ? 700 : 400}">${esc(ln)}</text>`);
    });
    nodes.push(`<line x1="${n.x}" y1="${lastY + 9}" x2="${n.x + n.w}" y2="${lastY + 9}" stroke="${n.color}" stroke-width="1.4" opacity="${n.depth === 2 ? 0.45 : 0.9}"/>`);
    if (hasDot) nodes.push(`<circle cx="${n.x + n.w + 7}" cy="${n.y}" r="3.5" fill="#fff" stroke="${n.color}" stroke-width="1.6"/>`);
  };
  walk(root);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(totalW)}" height="${Math.ceil(totalH)}" viewBox="0 0 ${Math.ceil(totalW)} ${Math.ceil(totalH)}" font-family='system-ui, "PingFang SC", "Microsoft YaHei", sans-serif'>${edges.join("")}${nodes.join("")}</svg>`;
}

export function mindmapMarkdown(title, r) {
  const lines = [`# ${title || "视频主题"}`, ""];
  r.chapters.forEach((ch) => {
    lines.push(`## ${ch.title}`, "");
    ch.points.forEach((p) => lines.push(`- ${p}`));
    lines.push("");
  });
  return lines.join("\n");
}