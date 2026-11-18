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
        <div class="progress-wrap hidden">
          <div class="progress-bar"><div class="progress-fill"></div></div>
          <div class="progress-text">排队中…</div>
        </div>
        <a class="btn btn-primary save-btn hidden" href="#">保存到本地</a>
        <span class="card-error hidden"></span>
      </div>
    </div>`;
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
          <span class="pi-status" data-i="${i}">${e.duration ? fmtDuration(e.duration) : ""}</span>
        </label>`).join("")}
    </div>`;
  results.prepend(card);
  results.classList.remove("hidden");

  card.querySelector(".pl-toggle").onclick = (ev) => {
    const boxes = [...card.querySelectorAll("input[type=checkbox]")];
    const toCheck = boxes.some((b) => !b.checked);
    boxes.forEach((b) => { b.checked = toCheck; });
    ev.target.textContent = toCheck ? "全不选" : "全选";
  };

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