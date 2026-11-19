<script setup>
import { onMounted } from "vue";
import NavBar from "./components/NavBar.vue";
import HeroSection from "./components/HeroSection.vue";
import VideoCard from "./components/VideoCard.vue";
import PlaylistCard from "./components/PlaylistCard.vue";
import FeaturesSection from "./components/FeaturesSection.vue";
import PricingSection from "./components/PricingSection.vue";
import FaqSection from "./components/FaqSection.vue";
import FooterSection from "./components/FooterSection.vue";
import ToastMessage from "./components/ToastMessage.vue";
import { results, refreshStats } from "./stores/app.js";

onMounted(refreshStats);
</script>

<template>
  <NavBar />
  <HeroSection />
  <main>
    <section class="results" v-show="results.length">
      <template v-for="r in results" :key="r.id">
        <PlaylistCard v-if="r.type === 'playlist'" :info="r.info" :url="r.url" />
        <VideoCard v-else :info="r.info" :url="r.url" />
      </template>
    </section>
    <FeaturesSection />
    <PricingSection />
    <FaqSection />
  </main>
  <FooterSection />
  <ToastMessage />
</template>