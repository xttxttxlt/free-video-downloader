<script setup>
import { toast } from "../stores/app.js";
</script>

<template>
  <div class="toast" v-if="toast.visible" :key="toast.seq">
    {{ toast.message }}
    <a v-if="toast.action" :href="toast.action.href">{{ toast.action.label }}</a>
  </div>
</template>