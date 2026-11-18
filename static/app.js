const $ = (id) => document.getElementById(id);
const results = $("results");

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

let toastTimer;
function toast(msg, ms = 3200) {
  const t = $("toast");
  t.innerHTML = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), ms);
}

function fmtDuration(sec) {
  if (!sec) return "";
  sec = Math.round(sec);
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtSpeed(bps) {
  if (!bps) return "";
  if (bps > 1048576) return (bps / 1048576).toFixed(1) + " MB/s";
  return Math.round(bps / 1024) + " KB/s";
}

async function api(path, body) {
  const res = await fetch(path, body ? {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  } : undefined);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.detail || "出了点问题，稍后再试";
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function refreshStats() {
  try {
    const [stats, quota] = await Promise.all([api("/api/stats"), api("/api/quota")]);
    $("statDownloads").textContent = stats.downloads;
    $("statQuota").textContent = quota.remaining;
  } catch {}
}

function handleError(e) {
  if (e.status === 429) {
    refreshStats();
    toast(`${esc(e.message)} <a href="#pricing">看看会员 →</a>`, 5000);
  } else {
    toast(esc(e.message));
  }
}

/* ---------- video card ---------- */

function renderVideoCard(info, url) {
  const card = document.createElement("div");
  card.className = "video-card";
  const choices = info.choices?.length ? info.choices : [{ id: "best", label: "最佳画质" }];
  const defaultIdx = 0;
  const subs = info.subtitles || [];

  card.innerHTML = `
    ${info.thumbnail ? `<img class="video-thumb" src="${esc(info.thumbnail)}" alt="" referrerpolicy="no-referrer" onerror="this.style.display='none'">` : ""}
    <div class="video-body">
      <div class="video-title">${esc(info.title)}</div>
      <div class="video-meta">${esc(info.uploader || "")}${info.duration ? " · " + fmtDuration(info.duration) : ""}</div>
      <div class="choice-row">
        ${choices.map((c, i) => `<button class="choice${i === defaultIdx ? " on" : ""}" data-id="${esc(c.id)}">${esc(c.label)}</button>`).join("")}
        ${subs.length ? `<select class="sub-select"><option value="">不带字幕</option>${subs.map((s) => `<option value="${esc(s)}">字幕: ${esc(s)}</option>`).join("")}</select>` : ""}
      </div>
      <div class="video-actions">
        <button class="btn btn-primary dl-btn">下载到本地</button>
        ${info.engine === "douyin" ? "" : '<button class="btn btn-ghost ai-btn">✨ AI 总结</button>'}
        <div class="progress-wrap hidden">
          <div class="progress-bar"><div class="progress-fill"></div></div>
          <div class="progress-text">排队中…</div>
        </div>
        <a class="btn btn-primary save-btn hidden" href="#">保存到本地</a>
        <span class="card-error hidden"></span>
      </div>
    </div>
    <div class="summary-panel hidden"></div>`;
  results.prepend(card);
  results.classList.remove("hidden");

  let chosen = choices[defaultIdx].id;
  card.querySelectorAll(".choice").forEach((btn) => {
    btn.onclick = () => {
      card.querySelectorAll(".choice").forEach((b) => b.classList.remove("on"));
      btn.classList.add("on");
      chosen = btn.dataset.id;
    };
  });

  const dlBtn = card.querySelector(".dl-btn");
  const wrap = card.querySelector(".progress-wrap");
  const fill = card.querySelector(".progress-fill");
  const ptext = card.querySelector(".progress-text");
  const saveBtn = card.querySelector(".save-btn");
  const errSpan = card.querySelector(".card-error");

  dlBtn.onclick = async () => {
    dlBtn.disabled = true;
    errSpan.classList.add("hidden");
    wrap.classList.remove("hidden");
    fill.style.width = "0%";
    ptext.textContent = "排队中…";
    try {
      const sub = card.querySelector(".sub-select")?.value || null;
      const { task_id } = await api("/api/download", {
        url: info.webpage_url || url, choice: chosen, title: info.title, subtitle: sub,
      });
      refreshStats();
      pollTask(task_id, { fill, ptext, wrap, dlBtn, saveBtn, errSpan });
    } catch (e) {
      wrap.classList.add("hidden");
      dlBtn.disabled = false;
      if (e.status !== 429) {
        errSpan.textContent = e.message;
        errSpan.classList.remove("hidden");
      }
      handleError(e);
    }
  };

  const aiBtn = card.querySelector(".ai-btn");
  if (aiBtn) aiBtn.onclick = () => startSummarize(info, url, card, aiBtn);
}

/* ---------- AI summary ---------- */

const SUM_STATUS_TEXT = { queued: "排队中…", fetching_subtitle: "正在获取字幕…", summarizing: "AI 正在总结…" };

async function startSummarize(info, url, card, btn) {
  const panel = card.querySelector(".summary-panel");
  btn.disabled = true;
  panel.classList.remove("hidden");
  panel.innerHTML = '<div class="sum-status"><span class="spinner spinner-blue"></span><span class="sum-status-text">排队中…</span></div>';
  try {
    const { summary_id } = await api("/api/summarize", { url: info.webpage_url || url });
    pollSummary(summary_id, panel, btn);
  } catch (e) {
    panel.innerHTML = `<div class="sum-error">${esc(e.message)}</div>`;
    btn.disabled = false;
    handleError(e);
  }
}

function pollSummary(sid, panel, btn) {
  const timer = setInterval(async () => {
    let t;
    try {
      t = await api(`/api/summary/${sid}`);
    } catch (e) {
      clearInterval(timer);
      panel.innerHTML = `<div class="sum-error">${esc(e.message)}</div>`;
      btn.disabled = false;
      return;
    }
    if (t.status === "done") {
      clearInterval(timer);
      btn.textContent = "✨ 已总结";
      renderSummaryPanel(panel, t);
    } else if (t.status === "error") {
      clearInterval(timer);
      panel.innerHTML = `<div class="sum-error">${esc(t.error)}</div>`;
      btn.disabled = false;
      btn.textContent = "✨ 重试总结";
    } else {
      const el = panel.querySelector(".sum-status-text");
      if (el) el.textContent = SUM_STATUS_TEXT[t.status] || "处理中…";
    }
  }, 1000);
}

function fmtTs(sec) {
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const mm = String(m).padStart(2, "0"), ss = String(s).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function tsToSeconds(ts) {
  return String(ts).split(":").map(Number).reduce((acc, n) => acc * 60 + (n || 0), 0);
}

function jumpUrl(base, seconds) {
  try {
    const u = new URL(base);
    u.searchParams.set("t", Math.floor(seconds));
    return u.toString();
  } catch {
    return base;
  }
}

function renderSummaryPanel(panel, t) {
  const r = t.result;
  const notes = [];
  if (t.subtitle_kind === "auto") notes.push("基于平台 AI 字幕，可能有识别误差");
  if (t.partial) notes.push("视频较长，总结基于部分字幕");
  panel.innerHTML = `
    ${notes.length ? `<div class="sum-note">${notes.map(esc).join(" · ")}</div>` : ""}
    <div class="sum-tabs">
      <button class="sum-tab on" data-pane="summary"><span class="tab-ico">📝</span>总结摘要</button>
      <button class="sum-tab" data-pane="cues"><span class="tab-ico">📄</span>字幕文本</button>
      <button class="sum-tab" data-pane="mindmap"><span class="tab-ico">🧠</span>思维导图</button>
      <button class="sum-tab" data-pane="chat"><span class="tab-ico">💬</span>AI 问答</button>
    </div>
    <div class="sum-pane" data-pane="summary">${summaryHtml(r, t.webpage_url)}</div>
    <div class="sum-pane hidden" data-pane="cues">${cuesHtml(t.cues)}</div>
    <div class="sum-pane hidden" data-pane="mindmap">
      <div class="pane-tools">
        <button class="btn btn-ghost btn-sm mm-png">导出 PNG</button>
        <button class="btn btn-ghost btn-sm mm-md">导出 Markdown</button>
      </div>
      <div class="mindmap-wrap">${mindmapSvg(t.title, r)}</div>
      <div class="mm-hint hidden">导图较宽，可左右滑动查看</div>
    </div>
    <div class="sum-pane hidden" data-pane="chat">${chatHtml(t.rounds_left)}</div>`;
  panel.querySelectorAll(".sum-tab").forEach((tab) => {
    tab.onclick = () => {
      panel.querySelectorAll(".sum-tab").forEach((b) => b.classList.toggle("on", b === tab));
      panel.querySelectorAll(".sum-pane").forEach((p) => p.classList.toggle("hidden", p.dataset.pane !== tab.dataset.pane));
      if (tab.dataset.pane === "mindmap") {
        const w = panel.querySelector(".mindmap-wrap");
        const svg = w.querySelector("svg");
        w.scrollLeft = 0;
        w.scrollTop = Math.max(0, (svg.clientHeight - w.clientHeight) / 2);
        panel.querySelector(".mm-hint").classList.toggle("hidden", w.scrollWidth <= w.clientWidth);
      }
    };
  });
  panel.querySelector(".mm-png").onclick = () => exportMindmapPng(panel, t.title);
  panel.querySelector(".mm-md").onclick = () => downloadBlob(`${safeFileName(t.title)}-思维导图.md`,
    new Blob([mindmapMarkdown(t.title, r)], { type: "text/markdown;charset=utf-8" }));
  panel.querySelector(".cue-srt").onclick = () => downloadBlob(`${safeFileName(t.title)}.srt`,
    new Blob([cuesToSrt(t.cues)], { type: "text/plain;charset=utf-8" }));
  panel.querySelector(".cue-txt").onclick = () => downloadBlob(`${safeFileName(t.title)}-字幕.txt`,
    new Blob([cuesToTxt(t.cues)], { type: "text/plain;charset=utf-8" }));
  bindChat(panel, t.id, t.rounds_left);
}

function summaryHtml(r, webpageUrl) {
  return `
    <p class="sum-abstract">${esc(r.summary)}</p>
    <div class="chapter-list">
      ${r.chapters.map((ch) => `
        <div class="chapter-item">
          <a class="ts-link" href="${esc(jumpUrl(webpageUrl, tsToSeconds(ch.timestamp)))}" target="_blank" rel="noopener" title="跳到视频对应位置">${esc(ch.timestamp)}</a>
          <div class="chapter-body">
            <div class="chapter-title">${esc(ch.title)}</div>
            ${ch.points.length ? `<ul class="chapter-points">${ch.points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : ""}
          </div>
        </div>`).join("")}
    </div>
    ${r.highlights.length ? `
      <div class="highlight-block">
        <div class="highlight-head">✨ 核心亮点</div>
        <ul class="highlight-list">${r.highlights.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>
      </div>` : ""}`;
}

const MM_COLORS = ["#1777FF", "#F59E0B", "#22C55E", "#EF4444", "#8B5CF6", "#14B8A6", "#EC4899", "#6366F1"];
const MM_FONT = '13px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif';

function mindmapSvg(title, r) {
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

function mindmapMarkdown(title, r) {
  const lines = [`# ${title || "视频主题"}`, ""];
  r.chapters.forEach((ch) => {
    lines.push(`## ${ch.title}`, "");
    ch.points.forEach((p) => lines.push(`- ${p}`));
    lines.push("");
  });
  return lines.join("\n");
}

function safeFileName(s) {
  return String(s || "video").replace(/[\\/:*?"<>|]/g, "").trim().slice(0, 60) || "video";
}

function downloadBlob(name, blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function exportMindmapPng(panel, title) {
  const svg = panel.querySelector(".mindmap-wrap svg");
  if (!svg) return toast("思维导图还没生成好");
  const w = +svg.getAttribute("width"), h = +svg.getAttribute("height");
  const xml = new XMLSerializer().serializeToString(svg);
  const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }));
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = w * 2; canvas.height = h * 2;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    canvas.toBlob((b) => {
      if (b) downloadBlob(`${safeFileName(title)}-思维导图.png`, b);
      else toast("导出失败了，再试一次");
    }, "image/png");
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast("导出失败了，再试一次"); };
  img.src = url;
}

function srtTs(sec) {
  const ms = Math.round((sec % 1) * 1000);
  const s = Math.floor(sec);
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss},${String(ms).padStart(3, "0")}`;
}

function cuesToSrt(cues) {
  return cues.map((c, i) => `${i + 1}\n${srtTs(c.start)} --> ${srtTs(c.end)}\n${c.text}\n`).join("\n");
}

function cuesToTxt(cues) {
  return cues.map((c) => `[${fmtTs(c.start)}] ${c.text}`).join("\n");
}

function cuesHtml(cues) {
  return `
    <div class="pane-tools">
      <button class="btn btn-ghost btn-sm cue-srt">导出 SRT</button>
      <button class="btn btn-ghost btn-sm cue-txt">导出 TXT</button>
    </div>
    <details class="cue-details" open>
      <summary>完整字幕（${cues.length} 条）</summary>
      <div class="cue-list">
        ${cues.map((c) => `<div class="cue-item"><span class="cue-ts">${esc(fmtTs(c.start))}</span><span>${esc(c.text)}</span></div>`).join("")}
      </div>
    </details>`;
}

function chatHtml(roundsLeft) {
  return `
    <div class="chat-box">
      <div class="chat-msgs"><div class="chat-msg ai">关于这个视频，想问点什么？</div></div>
      <div class="chat-input-row">
        <input class="chat-input" type="text" maxlength="500" placeholder="比如：视频里举了哪些例子？">
        <button class="btn btn-primary btn-sm chat-send">发送</button>
      </div>
      <div class="chat-left">剩余提问次数：<b class="chat-rounds">${roundsLeft}</b></div>
    </div>`;
}

function bindChat(panel, sid, roundsLeft) {
  const msgs = panel.querySelector(".chat-msgs");
  const input = panel.querySelector(".chat-input");
  const send = panel.querySelector(".chat-send");
  const roundsEl = panel.querySelector(".chat-rounds");
  let left = roundsLeft;

  const doSend = async () => {
    const q = input.value.trim();
    if (!q) return;
    if (left <= 0) return toast("本次总结的问答次数用完啦，重新生成一份总结即可继续");
    input.value = "";
    msgs.insertAdjacentHTML("beforeend", `<div class="chat-msg user">${esc(q)}</div>`);
    const reply = document.createElement("div");
    reply.className = "chat-msg ai";
    reply.textContent = "思考中…";
    msgs.appendChild(reply);
    msgs.scrollTop = msgs.scrollHeight;
    input.disabled = send.disabled = true;
    let started = false;
    try {
      const res = await fetch(`/api/summary/${sid}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.detail || "出了点问题，稍后再试");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          for (const line of chunk.split("\n")) {
            if (!line.startsWith("data:")) continue;
            let ev;
            try { ev = JSON.parse(line.slice(5)); } catch { continue; }
            if (ev.delta) {
              if (!started) { reply.textContent = ""; started = true; }
              reply.textContent += ev.delta;
              msgs.scrollTop = msgs.scrollHeight;
            } else if (ev.done) {
              left = ev.rounds_left;
              roundsEl.textContent = left;
            } else if (ev.error) {
              throw new Error(ev.error);
            }
          }
        }
      }
      if (!started) throw new Error("AI 返回的内容有点问题，再试一次");
    } catch (e) {
      reply.textContent = e.message;
      reply.classList.add("err");
    } finally {
      input.disabled = send.disabled = false;
      input.focus();
      msgs.scrollTop = msgs.scrollHeight;
    }
  };
  send.onclick = doSend;
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") doSend(); });
}

function pollTask(taskId, ui) {
  const timer = setInterval(async () => {
    let t;
    try {
      t = await api(`/api/tasks/${taskId}`);
    } catch {
      clearInterval(timer);
      ui.wrap.classList.add("hidden");
      ui.dlBtn.disabled = false;
      return;
    }
    if (t.status === "downloading" || t.status === "queued") {
      ui.fill.style.width = t.percent + "%";
      ui.ptext.textContent = t.status === "queued" ? "排队中…" :
        `${t.percent}%${t.speed ? " · " + fmtSpeed(t.speed) : ""}`;
    } else if (t.status === "done") {
      clearInterval(timer);
      ui.fill.style.width = "100%";
      ui.wrap.classList.add("hidden");
      ui.dlBtn.classList.add("hidden");
      ui.saveBtn.href = `/api/files/${taskId}`;
      ui.saveBtn.setAttribute("download", "");
      ui.saveBtn.classList.remove("hidden");
      toast("下载好啦，点「保存到本地」存起来，服务器 1 小时后自动删除", 4500);
    } else if (t.status === "error") {
      clearInterval(timer);
      ui.wrap.classList.add("hidden");
      ui.dlBtn.disabled = false;
      ui.errSpan.textContent = t.error;
      ui.errSpan.classList.remove("hidden");
    }
  }, 1000);
}

/* ---------- playlist card ---------- */

function renderPlaylistCard(info, url) {
  const card = document.createElement("div");
  card.className = "video-card playlist-card";
  const heights = [2160, 1080, 720, 480];
  const checkAll = info.entries.length <= 10;
  card.innerHTML = `
    <div class="playlist-head">
      <span class="playlist-title">📦 ${esc(info.title || "合集")}（${info.total || info.entries.length} 个视频${info.truncated ? `，仅显示前 ${info.entries.length} 个` : ""}）</span>
      <div class="playlist-tools">
        <button class="btn btn-ghost btn-sm pl-toggle">${checkAll ? "全不选" : "全选"}</button>
        <select class="sub-select quality-select">
          ${heights.map((h) => `<option value="${h}"${h === 1080 ? " selected" : ""}>最高 ${h}P</option>`).join("")}
          <option value="audio">仅音频 MP3</option>
        </select>
        <button class="btn btn-primary btn-sm pl-dl">下载选中</button>
      </div>
    </div>
    <div class="playlist-list">
      ${info.entries.map((e, i) => `
        <label class="playlist-item">
          <input type="checkbox"${checkAll ? " checked" : ""} data-i="${i}">
          <span class="pi-title">${esc(e.title)}</span>
          <button class="btn btn-ghost btn-sm pi-ai" data-i="${i}" type="button">✨ 总结</button>
          <span class="pi-status" data-i="${i}">${e.duration ? fmtDuration(e.duration) : ""}</span>
        </label>`).join("")}
    </div>
    <div class="summary-panel hidden"></div>`;
  results.prepend(card);
  results.classList.remove("hidden");

  card.querySelector(".pl-toggle").onclick = (ev) => {
    const boxes = [...card.querySelectorAll("input[type=checkbox]")];
    const toCheck = boxes.some((b) => !b.checked);
    boxes.forEach((b) => { b.checked = toCheck; });
    ev.target.textContent = toCheck ? "全不选" : "全选";
  };

  card.querySelectorAll(".pi-ai").forEach((btn) => {
    btn.onclick = (ev) => {
      ev.preventDefault();
      const entry = info.entries[+btn.dataset.i];
      startSummarize({ webpage_url: entry.url, title: entry.title }, entry.url, card, btn);
    };
  });

  card.querySelector(".pl-dl").onclick = async () => {
    const btn = card.querySelector(".pl-dl");
    const quality = card.querySelector(".quality-select").value;
    const checked = [...card.querySelectorAll("input:checked")];
    if (!checked.length) return toast("先勾选要下载的视频");
    btn.disabled = true;
    for (const box of checked) {
      const i = +box.dataset.i;
      const entry = info.entries[i];
      const status = card.querySelector(`.pi-status[data-i="${i}"]`);
      status.textContent = "下载中…";
      status.className = "pi-status";
      try {
        const { task_id } = await api("/api/download", { url: entry.url, choice: quality, title: entry.title });
        refreshStats();
        await waitPlaylistTask(task_id, status);
      } catch (e) {
        status.textContent = e.status === 429 ? "额度用完" : "失败";
        status.className = "pi-status err";
        handleError(e);
        if (e.status === 429) break;
      }
    }
    btn.disabled = false;
  };
}

function waitPlaylistTask(taskId, statusEl) {
  return new Promise((resolve) => {
    const timer = setInterval(async () => {
      let t;
      try { t = await api(`/api/tasks/${taskId}`); } catch { clearInterval(timer); resolve(); return; }
      if (t.status === "downloading") statusEl.textContent = t.percent + "%";
      else if (t.status === "done") {
        clearInterval(timer);
        statusEl.innerHTML = `<a href="/api/files/${taskId}" download>保存</a>`;
        statusEl.className = "pi-status done";
        resolve();
      } else if (t.status === "error") {
        clearInterval(timer);
        statusEl.textContent = "失败";
        statusEl.className = "pi-status err";
        resolve();
      }
    }, 1200);
  });
}

/* ---------- parse entries ---------- */

async function parseOne(url) {
  const info = await api("/api/parse", { url });
  if (info.type === "playlist") renderPlaylistCard(info, url);
  else renderVideoCard(info, url);
}

$("parseBtn").onclick = async () => {
  const url = $("urlInput").value.trim();
  if (!url) return toast("先粘贴一个视频链接呀");
  const btn = $("parseBtn");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>解析中…';
  try {
    await parseOne(url);
  } catch (e) {
    handleError(e);
  } finally {
    btn.disabled = false;
    btn.textContent = "解析视频";
  }
};

$("urlInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("parseBtn").click();
});

$("batchToggle").onclick = () => {
  const single = $("singleMode"), batch = $("batchMode");
  const toBatch = batch.classList.contains("hidden");
  single.classList.toggle("hidden", toBatch);
  batch.classList.toggle("hidden", !toBatch);
  $("batchToggle").textContent = toBatch ? "← 回到单个下载" : "要下好几个？试试批量下载 →";
};

$("batchParseBtn").onclick = async () => {
  const urls = $("batchInput").value.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 10);
  if (!urls.length) return toast("先粘贴链接，一行一个");
  const btn = $("batchParseBtn");
  btn.disabled = true;
  let ok = 0;
  for (let i = 0; i < urls.length; i++) {
    btn.innerHTML = `<span class="spinner"></span>解析第 ${i + 1}/${urls.length} 个…`;
    try {
      await parseOne(urls[i]);
      ok++;
    } catch (e) {
      toast(`第 ${i + 1} 个链接：${esc(e.message)}`);
    }
  }
  btn.disabled = false;
  btn.textContent = "批量解析";
  if (ok) toast(`解析好了 ${ok} 个，逐个点下载就行`);
};

refreshStats();