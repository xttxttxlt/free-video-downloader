<script setup>
import { ref, computed, onUnmounted } from "vue";
import SummaryPanel from "./SummaryPanel.vue";
import { api } from "../api.js";
import { showToast, handleError, refreshStats } from "../stores/app.js";
import { useSummary } from "../composables/useSummary.js";
import { fmtDuration, fmtSpeed } from "../lib/format.js";

const props = defineProps({
  info: { type: Object, required: true },
  url: { type: String, required: true },
});

const choices = props.info.choices?.length ? props.info.choices : [{ id: "best", label: "最佳画质" }];
const subs = props.info.subtitles || [];
const chosen = ref(choices[0].id);
const sub = ref("");

const downloading = ref(false);
const progressVisible = ref(false);
const percent = ref(0);
const progressText = ref("排队中…");
const done = ref(false);
const saveUrl = ref("");
const error = ref("");
const errorVisible = ref(false);
let timer = null;

function stopPoll() {
  if (timer) { clearInterval(timer); timer = null; }
}
onUnmounted(stopPoll);

function pollTask(taskId) {
  timer = setInterval(async () => {
    let t;
    try {
      t = await api(`/api/tasks/${taskId}`);
    } catch {
      stopPoll();
      progressVisible.value = false;
      downloading.value = false;
      return;
    }
    if (t.status === "downloading" || t.status === "queued") {
      percent.value = t.percent;
      progressText.value = t.status === "queued" ? "排队中…"
        : `${t.percent}%${t.speed ? " · " + fmtSpeed(t.speed) : ""}`;
    } else if (t.status === "done") {
      stopPoll();
      percent.value = 100;
      progressVisible.value = false;
      done.value = true;
      saveUrl.value = `/api/files/${taskId}`;
      showToast("下载好啦，点「保存到本地」存起来，服务器 1 小时后自动删除", 4500);
    } else if (t.status === "error") {
      stopPoll();
      progressVisible.value = false;
      downloading.value = false;
      error.value = t.error;
      errorVisible.value = true;
    }
  }, 1000);
}

async function onDownload() {
  downloading.value = true;
  errorVisible.value = false;
  progressVisible.value = true;
  percent.value = 0;
  progressText.value = "排队中…";
  try {
    const { task_id } = await api("/api/download", {
      url: props.info.webpage_url || props.url,
      choice: chosen.value,
      title: props.info.title,
      subtitle: sub.value || null,
    });
    refreshStats();
    pollTask(task_id);
  } catch (e) {
    progressVisible.value = false;
    downloading.value = false;
    if (e.status !== 429) {
      error.value = e.message;
      errorVisible.value = true;
    }
    handleError(e);
  }
}

const summary = useSummary();
const aiLabel = computed(() => {
  switch (summary.state.phase) {
    case "done": return "✨ 已总结";
    case "taskError": return "✨ 重试总结";
    default: return "✨ AI 总结";
  }
});
const aiDisabled = computed(() => summary.state.phase === "loading" || summary.state.phase === "done");
function onAi() {
  summary.start(props.info, props.url);
}

const meta = computed(() =>
  (props.info.uploader || "") + (props.info.duration ? " · " + fmtDuration(props.info.duration) : "")
);
</script>

<template>
  <div class="video-card">
    <img v-if="info.thumbnail" class="video-thumb" :src="info.thumbnail" alt="" referrerpolicy="no-referrer" @error="$event.target.style.display = 'none'">
    <div class="video-body">
      <div class="video-title">{{ info.title }}</div>
      <div class="video-meta">{{ meta }}</div>
      <div class="choice-row">
        <button class="choice" :class="{ on: chosen === c.id }" v-for="c in choices" :key="c.id" @click="chosen = c.id">{{ c.label }}</button>
        <select class="sub-select" v-if="subs.length" v-model="sub">
          <option value="">不带字幕</option>
          <option v-for="s in subs" :key="s" :value="s">字幕: {{ s }}</option>
        </select>
      </div>
      <div class="video-actions">
        <button class="btn btn-primary dl-btn" v-show="!done" :disabled="downloading" @click="onDownload">下载到本地</button>
        <button class="btn btn-ghost ai-btn" v-if="info.engine !== 'douyin'" :disabled="aiDisabled" @click="onAi">{{ aiLabel }}</button>
        <div class="progress-wrap" v-show="progressVisible">
          <div class="progress-bar"><div class="progress-fill" :style="{ width: percent + '%' }"></div></div>
          <div class="progress-text">{{ progressText }}</div>
        </div>
        <a class="btn btn-primary save-btn" v-show="done" :href="saveUrl" download>保存到本地</a>
        <span class="card-error" v-show="errorVisible">{{ error }}</span>
      </div>
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