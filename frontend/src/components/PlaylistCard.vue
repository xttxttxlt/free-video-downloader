<script setup>
import { ref, reactive, computed, watch, onUnmounted } from "vue";
import SummaryPanel from "./SummaryPanel.vue";
import { api } from "../api.js";
import { showToast, handleError, refreshStats } from "../stores/app.js";
import { useSummary } from "../composables/useSummary.js";
import { fmtDuration } from "../lib/format.js";

const props = defineProps({
  info: { type: Object, required: true },
  url: { type: String, required: true },
});

const heights = [2160, 1080, 720, 480];
const checkAll = props.info.entries.length <= 10;

const entries = reactive(props.info.entries.map((e) => ({
  title: e.title,
  url: e.url,
  checked: checkAll,
  statusText: e.duration ? fmtDuration(e.duration) : "",
  statusKind: "",
  saveUrl: "",
  aiLabel: "✨ 总结",
  aiDisabled: false,
})));

const toggleLabel = ref(checkAll ? "全不选" : "全选");
const quality = ref("1080");
const downloading = ref(false);

const headTitle = computed(() => {
  const total = props.info.total || props.info.entries.length;
  const trunc = props.info.truncated ? `，仅显示前 ${props.info.entries.length} 个` : "";
  return `📦 ${props.info.title || "合集"}（${total} 个视频${trunc}）`;
});

function toggleAll() {
  const toCheck = entries.some((e) => !e.checked);
  entries.forEach((e) => { e.checked = toCheck; });
  toggleLabel.value = toCheck ? "全不选" : "全选";
}

const timers = new Set();
onUnmounted(() => { timers.forEach(clearInterval); timers.clear(); });

function waitPlaylistTask(taskId, e) {
  return new Promise((resolve) => {
    const timer = setInterval(async () => {
      let t;
      try {
        t = await api(`/api/tasks/${taskId}`);
      } catch {
        clearInterval(timer); timers.delete(timer); resolve(); return;
      }
      if (t.status === "downloading") {
        e.statusText = t.percent + "%";
      } else if (t.status === "done") {
        clearInterval(timer); timers.delete(timer);
        e.statusText = "保存";
        e.saveUrl = `/api/files/${taskId}`;
        e.statusKind = "done";
        resolve();
      } else if (t.status === "error") {
        clearInterval(timer); timers.delete(timer);
        e.statusText = "失败";
        e.statusKind = "err";
        resolve();
      }
    }, 1200);
    timers.add(timer);
  });
}

async function downloadSelected() {
  if (!entries.some((e) => e.checked)) return showToast("先勾选要下载的视频");
  downloading.value = true;
  for (const e of entries) {
    if (!e.checked) continue;
    e.statusText = "下载中…";
    e.statusKind = "";
    try {
      const { task_id } = await api("/api/download", { url: e.url, choice: quality.value, title: e.title });
      refreshStats();
      await waitPlaylistTask(task_id, e);
    } catch (err) {
      e.statusText = err.status === 429 ? "额度用完" : "失败";
      e.statusKind = "err";
      handleError(err);
      if (err.status === 429) break;
    }
  }
  downloading.value = false;
}

const summary = useSummary();
const activeAi = ref(-1);

function onEntryAi(i) {
  activeAi.value = i;
  entries[i].aiDisabled = true;
  summary.start({ webpage_url: entries[i].url, title: entries[i].title }, entries[i].url);
}

watch(() => summary.state.phase, (phase) => {
  const i = activeAi.value;
  if (i < 0) return;
  const e = entries[i];
  if (phase === "done") { e.aiLabel = "✨ 已总结"; e.aiDisabled = true; }
  else if (phase === "taskError") { e.aiLabel = "✨ 重试总结"; e.aiDisabled = false; }
  else if (phase === "error") { e.aiDisabled = false; }
  else if (phase === "loading") { e.aiDisabled = true; }
});
</script>

<template>
  <div class="video-card playlist-card">
    <div class="playlist-head">
      <span class="playlist-title">{{ headTitle }}</span>
      <div class="playlist-tools">
        <button class="btn btn-ghost btn-sm" @click="toggleAll">{{ toggleLabel }}</button>
        <select class="sub-select quality-select" v-model="quality">
          <option v-for="h in heights" :key="h" :value="String(h)">最高 {{ h }}P</option>
          <option value="audio">仅音频 MP3</option>
        </select>
        <button class="btn btn-primary btn-sm" :disabled="downloading" @click="downloadSelected">下载选中</button>
      </div>
    </div>
    <div class="playlist-list">
      <label class="playlist-item" v-for="(e, i) in entries" :key="i">
        <input type="checkbox" v-model="e.checked">
        <span class="pi-title">{{ e.title }}</span>
        <button class="btn btn-ghost btn-sm pi-ai" type="button" :disabled="e.aiDisabled" @click.prevent="onEntryAi(i)">{{ e.aiLabel }}</button>
        <span class="pi-status" :class="{ done: e.statusKind === 'done', err: e.statusKind === 'err' }">
          <a v-if="e.statusKind === 'done'" :href="e.saveUrl" download>保存</a>
          <template v-else>{{ e.statusText }}</template>
        </span>
      </label>
    </div>

    <div class="summary-panel" v-if="summary.state.phase !== 'idle'">
      <div class="sum-status" v-if="summary.state.phase === 'loading'">
        <span class="spinner spinner-blue"></span><span>{{ summary.state.statusText }}</span>
      </div>
      <div class="sum-error" v-else-if="summary.state.phase === 'error' || summary.state.phase === 'taskError'">{{ summary.state.error }}</div>
      <SummaryPanel v-else-if="summary.state.phase === 'done'" :task="summary.state.data" :key="summary.state.data.id" />
    </div>
  </div>
</template>