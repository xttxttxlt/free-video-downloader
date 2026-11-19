<script setup>
import { ref, reactive, nextTick } from "vue";
import { showToast } from "../stores/app.js";

const props = defineProps({
  sid: { type: String, required: true },
  roundsLeft: { type: Number, required: true },
});

const msgs = reactive([{ role: "ai", text: "关于这个视频，想问点什么？", err: false }]);
const input = ref("");
const sending = ref(false);
const left = ref(props.roundsLeft);
const msgsEl = ref(null);
const inputEl = ref(null);

function scrollToBottom() {
  nextTick(() => {
    if (msgsEl.value) msgsEl.value.scrollTop = msgsEl.value.scrollHeight;
  });
}

async function doSend() {
  const q = input.value.trim();
  if (!q) return;
  if (left.value <= 0) return showToast("本次总结的问答次数用完啦，重新生成一份总结即可继续");
  input.value = "";
  msgs.push({ role: "user", text: q, err: false });
  const reply = reactive({ role: "ai", text: "思考中…", err: false });
  msgs.push(reply);
  scrollToBottom();
  sending.value = true;
  let started = false;
  try {
    const res = await fetch(`/api/summary/${props.sid}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: q }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.detail || "出了点问题，稍后再试");
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data:")) continue;
          let ev;
          try { ev = JSON.parse(line.slice(5)); } catch { continue; }
          if (ev.delta) {
            if (!started) { reply.text = ""; started = true; }
            reply.text += ev.delta;
            scrollToBottom();
          } else if (ev.done) {
            left.value = ev.rounds_left;
          } else if (ev.error) {
            throw new Error(ev.error);
          }
        }
      }
    }
    if (!started) throw new Error("AI 返回的内容有点问题，再试一次");
  } catch (e) {
    reply.text = e.message;
    reply.err = true;
  } finally {
    sending.value = false;
    inputEl.value?.focus();
    scrollToBottom();
  }
}
</script>

<template>
  <div class="chat-box">
    <div class="chat-msgs" ref="msgsEl">
      <div class="chat-msg" :class="[m.role, { err: m.err }]" v-for="(m, i) in msgs" :key="i">{{ m.text }}</div>
    </div>
    <div class="chat-input-row">
      <input ref="inputEl" class="chat-input" type="text" maxlength="500" placeholder="比如：视频里举了哪些例子？" v-model="input" :disabled="sending" @keydown.enter="doSend">
      <button class="btn btn-primary btn-sm chat-send" :disabled="sending" @click="doSend">发送</button>
    </div>
    <div class="chat-left">剩余提问次数：<b>{{ left }}</b></div>
  </div>
</template>