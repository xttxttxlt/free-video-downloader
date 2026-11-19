export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

export function fmtDuration(sec) {
  if (!sec) return "";
  sec = Math.round(sec);
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function fmtSpeed(bps) {
  if (!bps) return "";
  if (bps > 1048576) return (bps / 1048576).toFixed(1) + " MB/s";
  return Math.round(bps / 1024) + " KB/s";
}

export function fmtTs(sec) {
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const mm = String(m).padStart(2, "0"), ss = String(s).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function tsToSeconds(ts) {
  return String(ts).split(":").map(Number).reduce((acc, n) => acc * 60 + (n || 0), 0);
}

export function jumpUrl(base, seconds) {
  try {
    const u = new URL(base);
    u.searchParams.set("t", Math.floor(seconds));
    return u.toString();
  } catch {
    return base;
  }
}

export function safeFileName(s) {
  return String(s || "video").replace(/[\\/:*?"<>|]/g, "").trim().slice(0, 60) || "video";
}

export function srtTs(sec) {
  const ms = Math.round((sec % 1) * 1000);
  const s = Math.floor(sec);
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss},${String(ms).padStart(3, "0")}`;
}

export function cuesToSrt(cues) {
  return cues.map((c, i) => `${i + 1}\n${srtTs(c.start)} --> ${srtTs(c.end)}\n${c.text}\n`).join("\n");
}

export function cuesToTxt(cues) {
  return cues.map((c) => `[${fmtTs(c.start)}] ${c.text}`).join("\n");
}