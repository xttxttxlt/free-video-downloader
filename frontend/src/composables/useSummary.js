import { reactive, onUnmounted } from "vue";
import { api } from "../api.js";
import { handleError } from "../stores/app.js";

const SUM_STATUS_TEXT = {
  queued: "排队中…",
  fetching_subtitle: "正在获取字幕…",
  summarizing: "AI 正在总结…",
};

// AI 总结任务生命周期：idle → loading → done | error | taskError
// error：接口/网络异常（按钮文案保持「AI 总结」）；taskError：任务本身失败（按钮文案「重试总结」）
export function useSummary() {
  const state = reactive({
    phase: "idle",
    statusText: "排队中…",
    data: null,
    error: "",
  });
  let timer = null;

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  function poll(sid) {
    timer = setInterval(async () => {
      let t;
      try {
        t = await api(`/api/summary/${sid}`);
      } catch (e) {
        stop();
        state.phase = "error";
        state.error = e.message;
        return;
      }
      if (t.status === "done") {
        stop();
        state.data = t;
        state.phase = "done";
      } else if (t.status === "error") {
        stop();
        state.error = t.error;
        state.phase = "taskError";
      } else {
        state.statusText = SUM_STATUS_TEXT[t.status] || "处理中…";
      }
    }, 1000);
  }

  async function start(info, url) {
    stop();
    state.phase = "loading";
    state.statusText = "排队中…";
    state.error = "";
    state.data = null;
    try {
      const { summary_id } = await api("/api/summarize", { url: info.webpage_url || url });
      poll(summary_id);
    } catch (e) {
      state.phase = "error";
      state.error = e.message;
      handleError(e);
    }
  }

  onUnmounted(stop);

  return { state, start };
}