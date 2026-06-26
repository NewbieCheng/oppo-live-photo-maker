<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import {
  extractCoverWebCodecs,
  hasWebCodecsApi,
  probeAndCheck,
  transcodeClipWebCodecs,
  type VideoInfo,
} from "./lib/webcodecs";
import { buildOppoMotionPhoto } from "./lib/muxer";

const file = ref<File | null>(null);
const info = ref<VideoInfo | null>(null);
const previewUrl = ref<string>("");
const videoEl = ref<HTMLVideoElement | null>(null);
const dragOver = ref(false);

const unsupported = ref<{ reason: string; codec?: string } | null>(null);

const start = ref(0);
const duration = ref(3);
const coverTime = ref(0);
const longEdge = ref(1920);
const audioKbps = ref(128);
const showAdvanced = ref(false);

const status = ref<"idle" | "running" | "done" | "error">("idle");
const statusText = ref("");
const errorText = ref("");
const log = ref<string[]>([]);
const logEl = ref<HTMLElement | null>(null);
void logEl;
const progress = ref(0);
const resultUrl = ref("");
const resultName = ref("");
const resultSize = ref(0);

const browserHasWebCodecs = hasWebCodecsApi();

const formatTime = (s: number) => (isFinite(s) ? s.toFixed(2) : "0.00");
const positionLabel = computed(() => {
  const cur = videoEl.value?.currentTime ?? 0;
  const dur = info.value?.duration ?? 0;
  return `${formatTime(cur)} 秒 / ${formatTime(dur)} 秒`;
});

function pickFile() {
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = "video/*";
  inp.onchange = () => {
    if (inp.files && inp.files[0]) loadFile(inp.files[0]);
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
    statusText.value = `${f.name} · ${result.info.width}×${result.info.height} · ${formatTime(result.info.duration)} 秒 · ${result.info.codec}`;
  } catch (e) {
    status.value = "error";
    errorText.value = (e as Error).message;
  }
}

function onDrop(e: DragEvent) {
  e.preventDefault();
  dragOver.value = false;
  const f = e.dataTransfer?.files?.[0];
  if (f) loadFile(f);
}

function setStartFromCurrent() {
  if (!videoEl.value) return;
  start.value = +videoEl.value.currentTime.toFixed(2);
}
function setCoverFromCurrent() {
  if (!videoEl.value) return;
  coverTime.value = +videoEl.value.currentTime.toFixed(2);
}

watch(start, (v) => {
  if (Math.abs(coverTime.value - v) < 0.5) coverTime.value = v;
});

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

  try {
    statusText.value = "[1/3] 正在抽取封面帧…";
    progress.value = 0;
    const cover = await extractCoverWebCodecs(file.value, {
      timestamp: coverTime.value,
      longEdge: longEdge.value,
    });

    statusText.value = "[2/3] 正在转码视频片段…";
    progress.value = 0;
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
    const { buffer: livePhoto } = buildOppoMotionPhoto(cover, clip);

    const blob = new Blob([livePhoto as unknown as ArrayBuffer], { type: "image/jpeg" });
    if (resultUrl.value) URL.revokeObjectURL(resultUrl.value);
    resultUrl.value = URL.createObjectURL(blob);
    const stem = file.value.name.replace(/\.[^.]+$/, "");
    resultName.value = `${stem}.live.jpg`;
    resultSize.value = blob.size;
    status.value = "done";
    statusText.value = `完成！${(blob.size / 1024 / 1024).toFixed(2)} MB`;
    progress.value = 1;
  } catch (e) {
    status.value = "error";
    errorText.value = (e as Error).message ?? String(e);
    statusText.value = "失败";
  }
}

onBeforeUnmount(() => {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  if (resultUrl.value) URL.revokeObjectURL(resultUrl.value);
});

const REPO_URL = "https://github.com/Young-Spark/oppo-live-photo-maker";
</script>

<template>
  <div class="app">
    <header class="hero">
      <h1>OPPO 实况图制作 · 在线版</h1>
      <p class="sub">
        把任意视频转换成 OPPO 手机相册识别的「实况图片」（MotionPhoto）。
        所有处理都在你的浏览器里完成，<strong>视频不会上传到任何服务器</strong>。
      </p>
    </header>

    <section v-if="!browserHasWebCodecs" class="incompatible">
      <div class="big-icon">⚠</div>
      <h2>浏览器不支持 WebCodecs API</h2>
      <p>
        本工具依赖浏览器的硬件视频编解码能力。请使用以下任一最新版浏览器：
      </p>
      <ul>
        <li><strong>Chrome / Edge</strong> 94+（推荐，支持最广泛）</li>
        <li><strong>Safari</strong> 16.4+（macOS 13.3+ / iOS 16.4+）</li>
        <li><strong>Firefox</strong> 130+（部分编码限制）</li>
      </ul>
      <p>
        或下载
        <a :href="REPO_URL + '/releases/latest'" target="_blank" rel="noopener">桌面版（Windows EXE）</a>
        / 用
        <code>pip install git+{{ REPO_URL }}.git</code>
        在本地运行。
      </p>
    </section>

    <section
      v-else-if="!file"
      class="dropzone"
      :class="{ over: dragOver }"
      @click="pickFile"
      @dragenter.prevent="dragOver = true"
      @dragover.prevent="dragOver = true"
      @dragleave.prevent="dragOver = false"
      @drop="onDrop"
    >
      <div class="drop-icon">📂</div>
      <div>把视频文件拖到这里，或点击选择</div>
      <small>支持 .mp4 / .mov / .mkv / .webm 等</small>
    </section>

    <section v-else class="editor">
      <div class="row">
        <div class="filename">{{ file.name }}</div>
        <button class="link" @click="file = null; info = null; unsupported = null">换一个</button>
      </div>

      <div v-if="unsupported" class="unsupported">
        <div class="big-icon">⚠</div>
        <h3>无法处理这个视频</h3>
        <p>{{ unsupported.reason }}<span v-if="unsupported.codec">（{{ unsupported.codec }}）</span></p>
        <p class="hint">
          请尝试：
        </p>
        <ul>
          <li>更新 Chrome / Edge / Safari 到最新版</li>
          <li>使用 H.264 / HEVC / VP9 等主流编码的源视频</li>
          <li>或下载
            <a :href="REPO_URL + '/releases/latest'" target="_blank" rel="noopener">桌面版</a>
            处理这个文件
          </li>
        </ul>
      </div>

      <template v-else>
        <video
          ref="videoEl"
          :src="previewUrl"
          controls
          class="preview"
        />

        <div class="row pos">
          <span>{{ positionLabel }}</span>
          <div class="actions">
            <button @click="setStartFromCurrent">此处设为起点</button>
            <button @click="setCoverFromCurrent">此处设为封面</button>
          </div>
        </div>

        <div class="form">
          <label>
            片段起点
            <input type="number" step="0.1" min="0" v-model.number="start" />
            <span class="unit">秒</span>
          </label>
          <label>
            片段时长
            <input type="number" step="0.1" min="0.5" max="10" v-model.number="duration" />
            <span class="unit">秒</span>
          </label>
          <label>
            封面位置
            <input type="number" step="0.1" min="0" v-model.number="coverTime" />
            <span class="unit">秒</span>
          </label>
        </div>

        <details class="adv" :open="showAdvanced">
          <summary @click="showAdvanced = !showAdvanced">高级参数</summary>
          <div class="form">
            <label>
              输出长边
              <input type="number" min="360" max="4096" step="40" v-model.number="longEdge" />
              <span class="unit">像素</span>
            </label>
            <label>
              音频码率
              <input type="number" min="64" max="320" step="32" v-model.number="audioKbps" />
              <span class="unit">kbps</span>
            </label>
          </div>
        </details>

        <button
          class="primary"
          :disabled="status === 'running'"
          @click="convert"
        >
          {{ status === "running" ? "处理中…" : "开始转换" }}
        </button>

        <div v-if="status !== 'idle'" class="progress-block">
          <div class="status-line">
            <span v-if="status === 'running'" class="spinner" />
            <span>{{ statusText }}</span>
          </div>
          <div v-if="status === 'running'" class="bar">
            <div class="bar-fill" :style="{ width: `${Math.min(100, progress * 100)}%` }" />
          </div>
          <div v-if="errorText" class="error">{{ errorText }}</div>
          <details v-if="log.length" class="log-panel" :open="status === 'running'">
            <summary>调试日志（{{ log.length }} 行）</summary>
            <pre ref="logEl" class="log-body">{{ log.slice(-80).join("\n") }}</pre>
          </details>
        </div>

        <div v-if="resultUrl" class="result">
          <a :href="resultUrl" :download="resultName" class="primary download">
            ⬇ 下载 {{ resultName }}（{{ (resultSize / 1024 / 1024).toFixed(2) }} MB）
          </a>
          <p class="tip">
            下载后通过 <strong>USB / OPPO 互传 / 微信原图</strong> 传到手机，放进
            <code>DCIM/Camera/</code> 目录让相册识别。
            <strong>不要</strong>用普通微信图片或 QQ 图片传输 —— 它们会剥光元数据。
          </p>
        </div>
      </template>
    </section>

    <footer>
      <a :href="REPO_URL" target="_blank" rel="noopener">GitHub · Young-Spark/oppo-live-photo-maker</a>
      ·
      <span>开源 MIT · 未与 OPPO 官方关联</span>
    </footer>
  </div>
</template>

<style scoped>
.app {
  max-width: 760px;
  margin: 0 auto;
  padding: 24px 20px 64px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
    "Microsoft YaHei", sans-serif;
  color: #1a1a1a;
}
.hero h1 {
  margin: 0 0 8px;
  font-size: 26px;
}
.hero .sub {
  color: #555;
  line-height: 1.55;
  margin: 0;
}
.incompatible {
  margin-top: 28px;
  padding: 32px 24px;
  background: #fff7e6;
  border: 1px solid #ffd591;
  border-radius: 10px;
  text-align: center;
}
.incompatible h2 {
  margin: 12px 0 16px;
  color: #d46b08;
}
.incompatible p,
.incompatible ul {
  text-align: left;
  max-width: 480px;
  margin: 0 auto 12px;
  color: #555;
  line-height: 1.7;
}
.incompatible code {
  background: #f5f5f5;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 13px;
}
.incompatible a {
  color: #1677ff;
}
.big-icon {
  font-size: 48px;
}
.unsupported {
  padding: 24px;
  background: #fff7e6;
  border: 1px solid #ffd591;
  border-radius: 10px;
  text-align: center;
}
.unsupported h3 {
  margin: 8px 0 12px;
  color: #d46b08;
}
.unsupported p,
.unsupported ul {
  text-align: left;
  max-width: 420px;
  margin: 0 auto 8px;
  color: #555;
}
.unsupported .hint {
  margin-top: 12px;
  font-size: 13px;
}
.unsupported a {
  color: #1677ff;
}
.dropzone {
  margin-top: 28px;
  padding: 56px 20px;
  border: 2px dashed #c4c4c4;
  border-radius: 12px;
  text-align: center;
  cursor: pointer;
  transition: 0.15s;
  background: #fafafa;
}
.dropzone:hover,
.dropzone.over {
  border-color: #1677ff;
  background: #e6f4ff;
}
.drop-icon {
  font-size: 36px;
  margin-bottom: 8px;
}
.dropzone small {
  display: block;
  margin-top: 6px;
  color: #888;
}
.editor {
  margin-top: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.filename {
  font-weight: 500;
  word-break: break-all;
}
.link {
  background: transparent;
  border: none;
  color: #1677ff;
  cursor: pointer;
  font-size: 14px;
}
.preview {
  width: 100%;
  max-height: 380px;
  background: #000;
  border-radius: 8px;
}
.pos {
  font-size: 13px;
  color: #666;
}
.actions {
  display: flex;
  gap: 8px;
}
button {
  padding: 6px 12px;
  border: 1px solid #d9d9d9;
  background: #fff;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}
button:hover:not(:disabled) {
  border-color: #1677ff;
  color: #1677ff;
}
.form {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}
.form label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
  color: #555;
}
.form input {
  padding: 7px 10px;
  border: 1px solid #d9d9d9;
  border-radius: 5px;
  font-size: 14px;
}
.form input:focus {
  outline: none;
  border-color: #1677ff;
}
.unit {
  font-size: 12px;
  color: #888;
}
.adv summary {
  cursor: pointer;
  color: #555;
  user-select: none;
  padding: 4px 0;
}
.adv > .form {
  margin-top: 10px;
}
.primary {
  padding: 12px 18px;
  background: #1677ff;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 15px;
  font-weight: 500;
  cursor: pointer;
}
.primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.primary:hover:not(:disabled) {
  background: #4096ff;
  color: #fff;
}
.progress-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.status-line {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #444;
}
.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid #d9d9d9;
  border-top-color: #1677ff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  flex-shrink: 0;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
.bar {
  height: 6px;
  background: #eee;
  border-radius: 3px;
  overflow: hidden;
}
.bar-fill {
  height: 100%;
  background: #1677ff;
  transition: 0.2s;
}
.error {
  padding: 10px 12px;
  background: #fff1f0;
  border-left: 3px solid #ff4d4f;
  border-radius: 4px;
  font-size: 13px;
  white-space: pre-wrap;
}
.log-panel summary {
  cursor: pointer;
  font-size: 12px;
  color: #888;
}
.log-body {
  margin: 6px 0 0;
  padding: 8px 10px;
  max-height: 220px;
  overflow: auto;
  background: #1e1e1e;
  color: #d4d4d4;
  font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
  font-size: 11px;
  line-height: 1.5;
  border-radius: 4px;
  white-space: pre;
}
.result {
  padding: 16px;
  background: #f6ffed;
  border: 1px solid #b7eb8f;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.download {
  display: inline-block;
  text-align: center;
  text-decoration: none;
}
.tip {
  margin: 0;
  font-size: 13px;
  color: #555;
  line-height: 1.6;
}
.tip code {
  padding: 1px 5px;
  background: #f5f5f5;
  border-radius: 3px;
}
footer {
  margin-top: 60px;
  text-align: center;
  font-size: 12px;
  color: #888;
}
footer a {
  color: #888;
}
</style>
