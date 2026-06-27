<script setup lang="ts">
import { ref } from "vue";
import LivePhotoView from "./components/LivePhotoView.vue";
import MetadataCopyView from "./components/MetadataCopyView.vue";
import { hasWebCodecsApi } from "./lib/webcodecs";

type AppModule = "live" | "meta" | "future";

const activeModule = ref<AppModule>("live");
const browserHasWebCodecs = hasWebCodecsApi();

const REPO_URL = "https://github.com/NewbieCheng/oppo-live-photo-maker";
const AUTHOR_URL = "https://github.com/NewbieCheng";

const MODULES: { id: AppModule; label: string; hint: string; disabled?: boolean }[] = [
  { id: "live", label: "功能一", hint: "视频 → 实况图" },
  { id: "meta", label: "功能二", hint: "元信息复制" },
  { id: "future", label: "功能三", hint: "即将推出", disabled: true },
];
</script>

<template>
  <div class="shell">
    <header class="site-header">
      <div class="header-inner">
        <div class="brand">
          <span class="live-badge" aria-label="实况图">
            <span class="live-dot" aria-hidden="true" />
            LIVE
          </span>
          <h1>实况图工具箱</h1>
        </div>
        <p class="tagline">
          <strong>功能一</strong>：上传视频一键转实况图。
          <strong>功能二</strong>：元信息复制（可选）。
          <strong>全程本地处理</strong>，视频不会离开本机。
        </p>
      </div>
      <a
        class="repo-link"
        :href="REPO_URL"
        target="_blank"
        rel="noopener"
        aria-label="GitHub 仓库"
      >
        GitHub
      </a>
    </header>

    <nav class="module-tabs" aria-label="功能模块">
      <button
        v-for="m in MODULES"
        :key="m.id"
        type="button"
        class="module-tab"
        :class="{ active: activeModule === m.id, disabled: m.disabled }"
        :disabled="m.disabled"
        @click="!m.disabled && (activeModule = m.id)"
      >
        <span class="module-tab-label">{{ m.label }}</span>
        <span class="module-tab-hint">{{ m.hint }}</span>
      </button>
    </nav>

    <main class="main">
      <section v-if="!browserHasWebCodecs && activeModule === 'live'" class="panel alert alert-warn">
        <strong>浏览器不支持 WebCodecs</strong>
        <p>功能一需要 Chrome / Edge 94+、Safari 16.4+ 或 Firefox 130+。</p>
      </section>

      <div v-else-if="activeModule === 'live'" class="workspace">
        <LivePhotoView />
      </div>

      <div v-else-if="activeModule === 'meta'" class="workspace">
        <MetadataCopyView />
      </div>

      <section v-else class="panel module-placeholder">
        <p class="panel-title">功能三 · 暂未开放</p>
        <p class="panel-desc">此模块预留，后续版本再上线。</p>
      </section>
    </main>

    <footer class="site-footer">
      <span>MIT · <a :href="AUTHOR_URL" target="_blank" rel="noopener">chaseZ</a> · 未与 OPPO 官方关联</span>
      <a :href="REPO_URL" target="_blank" rel="noopener">oppo-live-photo-maker</a>
    </footer>
  </div>
</template>

<style scoped>
.shell {
  max-width: 880px;
  margin: 0 auto;
  padding: 32px 20px 48px;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.site-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 24px;
}
.header-inner {
  flex: 1;
}
.brand {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 10px;
}
.brand h1 {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(26px, 5vw, 34px);
  font-weight: 600;
  letter-spacing: 0.04em;
  line-height: 1.2;
}
.tagline {
  margin: 0;
  max-width: 560px;
  font-size: 14px;
  color: var(--text-soft);
  line-height: 1.65;
}
.tagline strong {
  color: var(--live);
  font-weight: 500;
}
.repo-link {
  flex-shrink: 0;
  padding: 8px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 13px;
  color: var(--text-soft);
  text-decoration: none;
  transition: border-color var(--transition), color var(--transition);
}
.repo-link:hover {
  border-color: var(--text-faint);
  color: var(--text);
  text-decoration: none;
}

.main {
  flex: 1;
}

.workspace {
  animation: fade-up 0.35s ease;
}
@keyframes fade-up {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.module-placeholder {
  text-align: center;
  padding: 48px 24px;
  opacity: 0.6;
}

.site-footer {
  margin-top: 48px;
  padding-top: 20px;
  border-top: 1px solid var(--border);
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--text-faint);
}
.site-footer a {
  color: var(--text-faint);
}
.site-footer a:hover {
  color: var(--live);
}

@media (max-width: 520px) {
  .site-header {
    flex-direction: column;
  }
  .repo-link {
    align-self: flex-start;
  }
}
</style>
