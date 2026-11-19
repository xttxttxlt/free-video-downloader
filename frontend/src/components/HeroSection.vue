<script setup>
import { ref, onMounted } from "vue";
import { api } from "../api.js";
import { stats, showToast, handleError, addResult, searchInput } from "../stores/app.js";

const urlInput = ref("");
const batchInput = ref("");
const batchMode = ref(false);
const parsing = ref(false);
const batchParsing = ref(false);
const batchProgress = ref("");
const inputEl = ref(null);

const batchPlaceholder = "一行一个链接，最多 10 个\nhttps://www.bilibili.com/video/BV...\nhttps://v.douyin.com/...";

const chips = [
  { label: "📺 B站", hot: true },
  { label: "🎵 抖音", hot: true },
  { label: "⚡ 快手" },
  { label: "▶️ YouTube" },
  { label: "📕 小红书" },
  { label: "🔥 微博" },
  { label: "🍉 西瓜视频" },
  { label: "🐦 X / Twitter" },
  { label: "📷 Instagram" },
  { label: "🎬 腾讯视频" },
  { label: "🥝 爱奇艺" },
  { label: "＋ 更多平台" },
];

onMounted(() => { searchInput.value = inputEl.value; });

async function parseOne(url) {
  const info = await api("/api/parse", { url });
  addResult(info, url);
}

async function onParse() {
  const url = urlInput.value.trim();
  if (!url) return showToast("先粘贴一个视频链接呀");
  parsing.value = true;
  try {
    await parseOne(url);
  } catch (e) {
    handleError(e);
  } finally {
    parsing.value = false;
  }
}

function onInputKeydown(e) {
  if (e.key === "Enter") onParse();
}

function toggleBatch() {
  batchMode.value = !batchMode.value;
}

async function onBatchParse() {
  const urls = batchInput.value.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 10);
  if (!urls.length) return showToast("先粘贴链接，一行一个");
  batchParsing.value = true;
  let ok = 0;
  for (let i = 0; i < urls.length; i++) {
    batchProgress.value = `解析第 ${i + 1}/${urls.length} 个…`;
    try {
      await parseOne(urls[i]);
      ok++;
    } catch (e) {
      showToast(`第 ${i + 1} 个链接：${e.message}`);
    }
  }
  batchParsing.value = false;
  if (ok) showToast(`解析好了 ${ok} 个，逐个点下载就行`);
}
</script>

<template>
  <header class="hero" id="top">
    <h1>全网视频，<span class="hl">一键保存</span></h1>
    <p class="hero-sub">粘贴链接就能下，高清原画 · 批量下载 · AI 总结 · 手机电脑都能用</p>

    <div class="search-shell">
      <div class="search-pill" v-show="!batchMode">
        <svg class="search-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>
        <input ref="inputEl" v-model="urlInput" type="url" placeholder="粘贴视频链接，比如 B站 / 抖音的分享链接" autocomplete="off" @keydown="onInputKeydown">
        <button class="btn btn-primary search-btn" :disabled="parsing" @click="onParse">
          <template v-if="parsing"><span class="spinner"></span>解析中…</template>
          <template v-else>解析视频</template>
        </button>
      </div>
      <div class="batch-box" v-show="batchMode">
        <textarea v-model="batchInput" rows="5" :placeholder="batchPlaceholder"></textarea>
        <button class="btn btn-primary" :disabled="batchParsing" @click="onBatchParse">
          <template v-if="batchParsing"><span class="spinner"></span>{{ batchProgress }}</template>
          <template v-else>批量解析</template>
        </button>
      </div>
      <button class="batch-toggle" @click="toggleBatch">
        {{ batchMode ? "← 回到单个下载" : "要下好几个？试试批量下载 →" }}
      </button>
    </div>

    <div class="trust-strip">
      <span class="trust-item"><span class="dot"></span>服务正常</span>
      <span class="sep"></span>
      <span class="trust-item">支持 <b>1000+</b> 平台</span>
      <span class="sep"></span>
      <span class="trust-item">今日已下载 <b>{{ stats.downloads }}</b> 个</span>
      <span class="sep"></span>
      <span class="trust-item">今日免费额度剩 <b>{{ stats.quota }}</b> 次</span>
    </div>

    <div class="platform-chips" id="platforms">
      <span class="chip" :class="{ 'chip-hot': c.hot }" v-for="c in chips" :key="c.label">{{ c.label }}</span>
    </div>
  </header>
</template>