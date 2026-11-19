<script setup>
import { ref, computed, nextTick } from "vue";
import ChatBox from "./ChatBox.vue";
import { mindmapSvg, mindmapMarkdown } from "../lib/mindmap.js";
import { downloadBlob, exportMindmapPng } from "../lib/export.js";
import { safeFileName, fmtTs, tsToSeconds, jumpUrl, cuesToSrt, cuesToTxt } from "../lib/format.js";
import { showToast } from "../stores/app.js";

const props = defineProps({
  task: { type: Object, required: true },
});

const r = computed(() => props.task.result);

const notes = computed(() => {
  const n = [];
  if (props.task.subtitle_kind === "auto") n.push("基于平台 AI 字幕，可能有识别误差");
  if (props.task.partial) n.push("视频较长，总结基于部分字幕");
  return n;
});

const mindmapSvgStr = computed(() => mindmapSvg(props.task.title, r.value));

const tabs = [
  { key: "summary", ico: "📝", label: "总结摘要" },
  { key: "cues", ico: "📄", label: "字幕文本" },
  { key: "mindmap", ico: "🧠", label: "思维导图" },
  { key: "chat", ico: "💬", label: "AI 问答" },
];
const activeTab = ref("summary");
const mmWrapEl = ref(null);
const mmHintVisible = ref(false);

function setTab(key) {
  activeTab.value = key;
  if (key === "mindmap") {
    nextTick(() => {
      const w = mmWrapEl.value;
      if (!w) return;
      const svg = w.querySelector("svg");
      w.scrollLeft = 0;
      w.scrollTop = Math.max(0, (svg.clientHeight - w.clientHeight) / 2);
      mmHintVisible.value = w.scrollWidth > w.clientWidth;
    });
  }
}

function exportPng() {
  const svg = mmWrapEl.value?.querySelector("svg");
  exportMindmapPng(svg, props.task.title, showToast);
}
function exportMd() {
  downloadBlob(`${safeFileName(props.task.title)}-思维导图.md`,
    new Blob([mindmapMarkdown(props.task.title, r.value)], { type: "text/markdown;charset=utf-8" }));
}
function exportSrt() {
  downloadBlob(`${safeFileName(props.task.title)}.srt`,
    new Blob([cuesToSrt(props.task.cues)], { type: "text/plain;charset=utf-8" }));
}
function exportTxt() {
  downloadBlob(`${safeFileName(props.task.title)}-字幕.txt`,
    new Blob([cuesToTxt(props.task.cues)], { type: "text/plain;charset=utf-8" }));
}
</script>

<template>
  <div>
    <div class="sum-note" v-if="notes.length">{{ notes.join(" · ") }}</div>

    <div class="sum-tabs">
      <button class="sum-tab" :class="{ on: activeTab === t.key }" v-for="t in tabs" :key="t.key" @click="setTab(t.key)">
        <span class="tab-ico">{{ t.ico }}</span>{{ t.label }}
      </button>
    </div>

    <!-- 总结摘要 -->
    <div class="sum-pane" v-show="activeTab === 'summary'">
      <p class="sum-abstract">{{ r.summary }}</p>
      <div class="chapter-list">
        <div class="chapter-item" v-for="(ch, i) in r.chapters" :key="i">
          <a class="ts-link" :href="jumpUrl(task.webpage_url, tsToSeconds(ch.timestamp))" target="_blank" rel="noopener" title="跳到视频对应位置">{{ ch.timestamp }}</a>
          <div class="chapter-body">
            <div class="chapter-title">{{ ch.title }}</div>
            <ul class="chapter-points" v-if="ch.points.length">
              <li v-for="(p, j) in ch.points" :key="j">{{ p }}</li>
            </ul>
          </div>
        </div>
      </div>
      <div class="highlight-block" v-if="r.highlights.length">
        <div class="highlight-head">✨ 核心亮点</div>
        <ul class="highlight-list">
          <li v-for="(h, i) in r.highlights" :key="i">{{ h }}</li>
        </ul>
      </div>
    </div>

    <!-- 字幕文本 -->
    <div class="sum-pane" v-show="activeTab === 'cues'">
      <div class="pane-tools">
        <button class="btn btn-ghost btn-sm" @click="exportSrt">导出 SRT</button>
        <button class="btn btn-ghost btn-sm" @click="exportTxt">导出 TXT</button>
      </div>
      <details class="cue-details" open>
        <summary>完整字幕（{{ task.cues.length }} 条）</summary>
        <div class="cue-list">
          <div class="cue-item" v-for="(c, i) in task.cues" :key="i">
            <span class="cue-ts">{{ fmtTs(c.start) }}</span><span>{{ c.text }}</span>
          </div>
        </div>
      </details>
    </div>

    <!-- 思维导图 -->
    <div class="sum-pane" v-show="activeTab === 'mindmap'">
      <div class="pane-tools">
        <button class="btn btn-ghost btn-sm" @click="exportPng">导出 PNG</button>
        <button class="btn btn-ghost btn-sm" @click="exportMd">导出 Markdown</button>
      </div>
      <div class="mindmap-wrap" ref="mmWrapEl" v-html="mindmapSvgStr"></div>
      <div class="mm-hint" v-show="mmHintVisible">导图较宽，可左右滑动查看</div>
    </div>

    <!-- AI 问答 -->
    <div class="sum-pane" v-show="activeTab === 'chat'">
      <ChatBox :sid="task.id" :rounds-left="task.rounds_left" />
    </div>
  </div>
</template>