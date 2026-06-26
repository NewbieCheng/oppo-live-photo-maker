<script setup lang="ts">
import { useRouter, useRoute } from "vue-router";

const router = useRouter();
const route = useRoute();

const navItems = [
  { path: "/", label: "Converter", icon: "🎬" },
  { path: "/oppo-exclusive", label: "OPPO Exclusive", icon: "📱" },
];

const REPO_URL = "https://github.com/Young-Spark/oppo-live-photo-maker";
</script>

<template>
  <div class="layout">
    <nav class="navbar">
      <div class="nav-inner">
        <a class="brand" href="#/" @click.prevent="router.push('/')">
          <span class="brand-icon">📸</span>
          <span class="brand-text">Live Photo</span>
        </a>
        <div class="nav-links">
          <a
            v-for="item in navItems"
            :key="item.path"
            :class="['nav-link', { active: route.path === item.path }]"
            href="#"
            @click.prevent="router.push(item.path)"
          >
            <span class="nav-icon">{{ item.icon }}</span>
            {{ item.label }}
          </a>
        </div>
        <a :href="REPO_URL" target="_blank" rel="noopener" class="gh-link">GitHub</a>
      </div>
    </nav>
    <main class="main">
      <router-view />
    </main>
  </div>
</template>

<style scoped>
.layout {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.navbar {
  background: #fff;
  border-bottom: 1px solid #e8e8e8;
  position: sticky;
  top: 0;
  z-index: 50;
}

.nav-inner {
  max-width: 860px;
  margin: 0 auto;
  padding: 0 20px;
  height: 52px;
  display: flex;
  align-items: center;
  gap: 24px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 6px;
  text-decoration: none;
  color: #1a1a1a;
  font-weight: 700;
  font-size: 16px;
}

.brand-icon { font-size: 20px; }

.nav-links {
  display: flex;
  gap: 4px;
  flex: 1;
}

.nav-link {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 14px;
  border-radius: 6px;
  text-decoration: none;
  color: #555;
  font-size: 13px;
  font-weight: 500;
  transition: 0.15s;
}

.nav-link:hover {
  background: #f5f5f5;
  color: #1a1a1a;
}

.nav-link.active {
  background: #e6f4ff;
  color: #1677ff;
}

.nav-icon { font-size: 16px; }

.gh-link {
  text-decoration: none;
  color: #555;
  font-size: 13px;
  transition: 0.15s;
}

.gh-link:hover { color: #1677ff; }

.main {
  flex: 1;
}
</style>
