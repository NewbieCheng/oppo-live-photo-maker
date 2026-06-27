<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import StepIndicator from "./components/StepIndicator.vue";
import VideoStep from "./components/VideoStep.vue";
import ReferenceStep from "./components/ReferenceStep.vue";
import MetadataEditor from "./components/MetadataEditor.vue";
import ExportStep from "./components/ExportStep.vue";
import {
  extractCoverWebCodecs,
  hasWebCodecsApi,
  loadReferenceCover,
  probeAndCheck,
  transcodeClipWebCodecs,
  type VideoInfo,
} from "./lib/webcodecs";
import { buildOppoMotionPhoto } from "./lib/muxer";
import {
  computePresentationTimestampUs,
  emptyBundle,
  mergeBundles,
  parseReferenceImageSync,
  type CoverMode,
  type NativeMetadataBundle,
} from "./lib/metadata";

const STEP_LABELS = ["视频", "参考图", "原生数据", "导出"];

const step = ref(1);
const file = ref<File | null>(null);
const info = ref<VideoInfo | null>(null);
const previewUrl = ref("");
const dragOver = ref(false);

const referenceFile = ref<File | null>(null);
const referenceBytes = ref<Uint8Array | null>(null);
const referencePreviewUrl = ref("");
const referenceBundle = ref<NativeMetadataBundle | null>(null);
const metadataEdits = ref<NativeMetadataBundle>(emptyBundle());
const coverMode = ref<CoverMode>("videoFrame");

const unsupported = ref<{ reason: string; codec?: string } | null>(null);

const start = ref(0);
const duration = ref(3);
const coverTime = ref(0);
const longEdge = ref(1920);
const audioKbps = ref(128);

const status = ref<"idle" | "running" | "done" | "error">("idle");
const statusText = ref("");
const errorText = ref("");
const log = ref<string[]>([]);
const progress = ref(0);
const resultUrl = ref("");
const resultName = ref("");
const resultSize = ref(0);

const browserHasWebCodecs = hasWebCodecsApi();

const dirtyKeys = computed(() => {
  const keys = new Set<string>();
  if (!referenceBundle.value) {
    for (const k of Object.keys(metadataEdits.value.exif)) keys.add(`exif:${k}`);
    for (const k of Object.keys(metadataEdits.value.iptc)) keys.add(`iptc:${k}`);
    return keys;
  }
  const base = referenceBundle.value;
  for (const [k, v] of Object.entries(metadataEdits.value.exif)) {
    if (base.exif[k] !== v) keys.add(`exif:${k}`);
  }
  for (const [k, v] of Object.entries(metadataEdits.value.iptc)) {
    if (base.iptc[k] !== v) keys.add(`iptc:${k}`);
  }
  return keys;
});

const canConvert = computed(
  () =>
    !!file.value &&
    !!info.value &&
    !unsupported.value &&
    (coverMode.value !== "referenceImage" || !!referenceFile.value),
);

function pickFile() {
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = "video/*";
  inp.onchange = () => {
    if (inp.files?.[0]) loadFile(inp.files[0]);
  };
  inp.click();
}

async function loadFile(f: File) {
  resetResult();
  unsupported.value = null;
  file.value = f;
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  previewUrl.value = URL.createObjectURL(f);
  status.value = "idle";
  statusText.value = "正在读取视频信息…";
  step.value = 1;
  try {
    const result = await probeAndCheck(f);
    info.value = result.info;
    if (!result.supported) {
      unsupported.value = { reason: result.reason ?? "未知原因", codec: result.info.codec };
      statusText.value = "";
      return;
    }
    start.value = 0;
    coverTime.value = 0;
    duration.value = Math.min(3, Math.max(0.5, result.info.duration || 3));
    statusText.value = `${f.name} · ${result.info.width}×${result.info.height}`;
  } catch (e) {
    status.value = "error";
    errorText.value = (e as Error).message;
  }
}

function pickReference() {
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = "image/jpeg,image/jpg,.jpg,.jpeg";
  inp.onchange = () => {
    if (inp.files?.[0]) loadReference(inp.files[0]);
  };
  inp.click();
}

function loadReference(f: File) {
  if (referencePreviewUrl.value) URL.revokeObjectURL(referencePreviewUrl.value);
  referenceFile.value = f;
  referencePreviewUrl.value = URL.createObjectURL(f);
  f.arrayBuffer().then((buf) => {
    referenceBytes.value = new Uint8Array(buf);
    try {
      referenceBundle.value = parseReferenceImageSync(referenceBytes.value);
      metadataEdits.value = emptyBundle();
    } catch (e) {
      referenceBundle.value = null;
      errorText.value = `参考图解析失败: ${(e as Error).message}`;
    }
  });
}

function clearReference() {
  if (referencePreviewUrl.value) URL.revokeObjectURL(referencePreviewUrl.value);
  referenceFile.value = null;
  referenceBytes.value = null;
  referencePreviewUrl.value = "";
  referenceBundle.value = null;
  metadataEdits.value = emptyBundle();
  coverMode.value = "videoFrame";
}

function onDrop(e: DragEvent) {
  e.preventDefault();
  dragOver.value = false;
  const f = e.dataTransfer?.files?.[0];
  if (f) loadFile(f);
}

function reloadMetadataFromReference() {
  if (referenceBundle.value) metadataEdits.value = emptyBundle();
}

function buildMetadataForMux(): NativeMetadataBundle | undefined {
  const base = referenceBundle.value ?? emptyBundle();
  const merged = mergeBundles(base, metadataEdits.value);
  const hasData =
    Object.keys(merged.exif).length ||
    Object.keys(merged.iptc).length ||
    referenceBytes.value;
  return hasData ? merged : undefined;
}

function resetResult() {
  if (resultUrl.value) URL.revokeObjectURL(resultUrl.value);
  resultUrl.value = "";
  resultName.value = "";
  resultSize.value = 0;
  errorText.value = "";
  log.value = [];
  progress.value = 0;
}

async function convert() {
  if (!file.value || !info.value) return;
  resetResult();
  status.value = "running";
  step.value = 4;

  try {
    const meta = buildMetadataForMux();
    const presentationTs = computePresentationTimestampUs({
      coverMode: coverMode.value,
      coverTime: coverTime.value,
      start: start.value,
      referenceTimestampUs: referenceBundle.value?.presentationTimestampUs,
      userOverrideUs: metadataEdits.value.presentationTimestampUs,
      userSet: metadataEdits.value.presentationTimestampUserSet,
    });

    statusText.value = "[1/3] 正在准备封面…";
    progress.value = 0;
    const cover =
      coverMode.value === "referenceImage" && referenceFile.value
        ? await loadReferenceCover(referenceFile.value, { longEdge: longEdge.value })
        : await extractCoverWebCodecs(file.value, {
            timestamp: coverTime.value,
            longEdge: longEdge.value,
          });

    statusText.value = "[2/3] 正在转码视频片段…";
    const clip = await transcodeClipWebCodecs(file.value, {
      start: start.value,
      duration: duration.value,
      longEdge: longEdge.value,
      audioKbps: audioKbps.value,
      hasAudio: info.value.hasAudio,
      onProgress: (r) => (progress.value = r),
      onDiscarded: (reasons) => {
        for (const r of reasons) log.value.push(`[discarded] ${r}`);
      },
    });

    statusText.value = "[3/3] 正在合成 OPPO 实况图…";
    const livePhoto = buildOppoMotionPhoto(cover, clip, {
      presentationTimestampUs: presentationTs,
      nativeMetadata: meta,
      referenceJpeg: referenceBytes.value ?? undefined,
    });

    const blob = new Blob([livePhoto.buffer as ArrayBuffer], { type: "image/jpeg" });
    if (resultUrl.value) URL.revokeObjectURL(resultUrl.value);
    resultUrl.value = URL.createObjectURL(blob);
    const stem = file.value.name.replace(/\.[^.]+$/, "");
    resultName.value = `${stem}.live.jpg`;
    resultSize.value = blob.size;
    status.value = "done";
    statusText.value = `完成 · ${(blob.size / 1024 / 1024).toFixed(2)} MB`;
    progress.value = 1;
  } catch (e) {
    status.value = "error";
    errorText.value = (e as Error).message ?? String(e);
    statusText.value = "转换失败";
  }
}

watch(referenceFile, (f) => {
  if (!f && coverMode.value === "referenceImage") coverMode.value = "videoFrame";
});

onBeforeUnmount(() => {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  if (referencePreviewUrl.value) URL.revokeObjectURL(referencePreviewUrl.value);
  if (resultUrl.value) URL.revokeObjectURL(resultUrl.value);
});

const REPO_URL = "https://github.com/NewbieCheng/oppo-live-photo-maker";
const AUTHOR_URL = "https://github.com/NewbieCheng";
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
          <h1>实况图制作</h1>
        </div>
        <p class="tagline">
          视频 → OPPO 相册可识别的 MotionPhoto · 支持原生 EXIF 移植 ·
          <strong>全程本地处理</strong>
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

    <main class="main">
      <section v-if="!browserHasWebCodecs" class="panel alert alert-warn">
        <strong>浏览器不支持 WebCodecs</strong>
        <p>请使用 Chrome / Edge 94+、Safari 16.4+ 或 Firefox 130+。</p>
      </section>

      <section
        v-else-if="!file"
        class="drop-target landing-drop"
        :class="{ over: dragOver }"
        role="button"
        tabindex="0"
        @click="pickFile"
        @keydown.enter="pickFile"
        @dragenter.prevent="dragOver = true"
        @dragover.prevent="dragOver = true"
        @dragleave.prevent="dragOver = false"
        @drop="onDrop"
      >
        <div class="drop-target-icon" aria-hidden="true">▷</div>
        <div class="drop-target-title">拖入视频，或点击选择</div>
        <div class="drop-target-hint">MP4 · MOV · MKV · WebM · 文件不会离开本机</div>
      </section>

      <div v-else class="workspace">
        <StepIndicator :current="step" :labels="STEP_LABELS" />

        <nav class="step-nav" aria-label="步骤导航">
          <button type="button" class="btn" :disabled="step <= 1" @click="step--">
            ← 上一步
          </button>
          <span class="step-label">{{ STEP_LABELS[step - 1] }}</span>
          <button
            type="button"
            class="btn"
            :disabled="step >= 4 || !!unsupported"
            @click="step++"
          >
            下一步 →
          </button>
        </nav>

        <div class="step-content">
          <VideoStep
            v-show="step === 1"
            :file="file"
            :preview-url="previewUrl"
            :info="info"
            :unsupported="unsupported"
            v-model:start="start"
            v-model:duration="duration"
            v-model:cover-time="coverTime"
            v-model:long-edge="longEdge"
            v-model:audio-kbps="audioKbps"
            @change-video="file = null; info = null; unsupported = null"
          />

          <ReferenceStep
            v-show="step === 2"
            :reference-file="referenceFile"
            :reference-preview-url="referencePreviewUrl"
            v-model:cover-mode="coverMode"
            @pick-reference="pickReference"
            @clear-reference="clearReference"
          />

          <MetadataEditor
            v-show="step === 3"
            :reference-bundle="referenceBundle"
            v-model:edits="metadataEdits"
            :dirty-keys="dirtyKeys"
            @reload-from-reference="reloadMetadataFromReference"
          />

          <ExportStep
            v-show="step === 4"
            :status="status"
            :status-text="statusText"
            :error-text="errorText"
            :progress="progress"
            :log="log"
            :result-url="resultUrl"
            :result-name="resultName"
            :result-size="resultSize"
            :can-convert="canConvert"
            @convert="convert"
          />
        </div>
      </div>
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
  margin-bottom: 36px;
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
  max-width: 520px;
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
.landing-drop {
  margin-top: 12px;
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

.step-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 20px;
}
.step-label {
  font-family: var(--font-display);
  font-size: 15px;
  color: var(--text-soft);
}

.step-content {
  min-height: 320px;
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
