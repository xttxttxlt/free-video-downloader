<script setup>
import { focusSearch } from "../stores/app.js";

const plans = [
  {
    name: "免费版", price: "¥0", unit: "/永久", hot: false,
    btn: "免费开始", btnClass: "btn-ghost", disabled: false,
    items: ["✔ 每天 5 次下载", "✔ 最高 1080P 清晰度", "✔ 支持全部平台", "✔ 仅音频 MP3"],
  },
  {
    name: "月度会员", price: "¥9.9", unit: "/月", hot: true,
    btn: "即将开放", btnClass: "btn-primary", disabled: true,
    items: ["✔ 下载次数不限", "✔ 4K 超清 + 批量下载", "✔ 下载队列优先处理", "✔ 字幕下载 + 新功能的抢先体验"],
  },
  {
    name: "年度会员", price: "¥59", unit: "/年 · 相当于 ¥4.9/月", hot: false,
    btn: "即将开放", btnClass: "btn-ghost", disabled: true,
    items: ["✔ 月度会员全部权益", "✔ 一年省下 ¥60", "✔ 视频 AI 总结", "✔ 字幕翻译（规划中）"],
  },
];

function onPlanClick(plan) {
  if (!plan.disabled) focusSearch();
}
</script>

<template>
  <section class="pricing" id="pricing">
    <h2>选个适合你的<span class="hl">套餐</span></h2>
    <p class="section-sub">免费版够日常用，重度下载党选会员更划算</p>
    <div class="price-grid">
      <div class="price-card" :class="{ 'price-card-hot': plan.hot }" v-for="plan in plans" :key="plan.name">
        <div class="hot-badge" v-if="plan.hot">最受欢迎</div>
        <h3>{{ plan.name }}</h3>
        <div class="price">{{ plan.price }}<span>{{ plan.unit }}</span></div>
        <ul>
          <li v-for="(item, i) in plan.items" :key="i">{{ item }}</li>
        </ul>
        <button class="btn price-btn" :class="plan.btnClass" :disabled="plan.disabled" @click="onPlanClick(plan)">
          {{ plan.btn }}
        </button>
      </div>
    </div>
  </section>
</template>