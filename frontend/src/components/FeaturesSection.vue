<script setup>
const features = [
  { emoji: "⚡", title: "贴链接就下", desc: "不用装软件、不用注册，复制分享链接粘进来，几秒钟出结果。" },
  { emoji: "🎬", title: "高清原画", desc: "平台有多清晰就能下多清晰，1080P、4K 随心选，还能只存 MP3。" },
  { emoji: "📦", title: "批量下载", desc: "一次贴一排链接，整个合集挨个下好，不用一条条重复操作。" },
  { emoji: "📱", title: "手机也能用", desc: "网页打开就能下，通勤路上刷到好视频，随手存进手机相册。" },
];
</script>

<template>
  <section class="features" id="features">
    <h2>为什么大家都在用<span class="hl">闪存视频</span></h2>
    <div class="feature-grid">
      <div class="feature-card" v-for="f in features" :key="f.title">
        <div class="feature-emoji">{{ f.emoji }}</div>
        <h3>{{ f.title }}</h3>
        <p>{{ f.desc }}</p>
      </div>
    </div>
  </section>
</template>