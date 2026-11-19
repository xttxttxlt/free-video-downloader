import { reactive, ref } from "vue";
import { api } from "../api.js";

// 轻量全局单例 store：toast / 统计 / 结果列表 / 搜索框聚焦
export const stats = reactive({ downloads: 0, quota: "-" });

export const toast = reactive({ visible: false, message: "", action: null, seq: 0 });
let toastTimer = null;

export function showToast(message, ms = 3200, action = null) {
  toast.message = message;
  toast.action = action;
  toast.visible = true;
  toast.seq++;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.visible = false; }, ms);
}

export const results = reactive([]);
let resultSeq = 0;

export function addResult(info, url) {
  results.unshift({
    id: ++resultSeq,
    type: info.type === "playlist" ? "playlist" : "video",
    info,
    url,
  });
}

export const searchInput = ref(null);

export function focusSearch() {
  searchInput.value?.focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

export async function refreshStats() {
  try {
    const [s, quota] = await Promise.all([api("/api/stats"), api("/api/quota")]);
    stats.downloads = s.downloads;
    stats.quota = quota.remaining;
  } catch { /* 静默失败，与原实现一致 */ }
}

export function handleError(e) {
  if (e.status === 429) {
    refreshStats();
    showToast(e.message, 5000, { href: "#pricing", label: "看看会员 →" });
  } else {
    showToast(e.message);
  }
}