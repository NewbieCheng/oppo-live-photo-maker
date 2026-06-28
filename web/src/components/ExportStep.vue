<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import {
  createSingleFileZip,
  triggerBrowserDownload,
  zipFilenameFor,
} from "../lib/zipDownload";

const props = withDefaults(
  defineProps<{
    title?: string;
    description?: string;
    status: "idle" | "running" | "done" | "error";
    statusText: string;
    errorText: string;
    progress: number;
    log: string[];
    resultUrl: string;
    resultName: string;
    resultSize: number;
    resultBytes?: Uint8Array | null;
    canConvert: boolean;
  }>(),
  {
    title: "生成实况图",
    description:
      "封面、视频片段与元数据将在本地合成，输出 OPPO 相册可识别的 MotionPhoto JPEG。",
    resultBytes: null,
  },
);

const emit = defineEmits<{
  convert: [];
}>();

const zipUrl = ref("");
const zipBusy = ref(false);
const zipError = ref("");

watch(
  () => props.resultUrl,
  () => {
    zipError.value = "";
    if (zipUrl.value) {
      URL.revokeObjectURL(zipUrl.value);
      zipUrl.value = "";
    }
  },
);

async function resolveResultBytes(): Promise<Uint8Array | null> {
  if (props.resultBytes && props.resultBytes.length > 0) return props.resultBytes;
  if (!props.resultUrl) return null;
  const res = await fetch(props.resultUrl);
  return new Uint8Array(await res.arrayBuffer());
}

async function downloadZip() {
  if (!props.resultName) return;
  zipBusy.value = true;
  zipError.value = "";
  try {
    const bytes = await resolveResultBytes();
    if (!bytes) {
      zipError.value = "无法读取合成文件";
      return;
    }
    const zip = createSingleFileZip(props.resultName, bytes);
    if (zipUrl.value) URL.revokeObjectURL(zipUrl.value);
    zipUrl.value = URL.createObjectURL(new Blob([zip.buffer as ArrayBuffer], { type: "application/zip" }));
    triggerBrowserDownload(zipUrl.value, zipFilenameFor(props.resultName));
  } catch (e) {
    zipError.value = (e as Error).message ?? String(e);
  } finally {
    zipBusy.value = false;
  }
}

onBeforeUnmount(() => {
  if (zipUrl.value) URL.revokeObjectURL(zipUrl.value);
});
</script>

<template>
  <section class="panel export-step">
    <p class="panel-title">{{ title }}</p>
    <p class="panel-desc">{{ description }}</p>

    <button
      type="button"
      class="btn btn-primary btn-block"
      :disabled="status === 'running' || !canConvert"
      @click="emit('convert')"
    >
      {{ status === "running" ? "正在合成…" : "开始转换" }}
    </button>

    <div v-if="status !== 'idle'" class="status-block">
      <div class="status-line">
        <span v-if="status === 'running'" class="spinner" aria-hidden="true" />
        <span>{{ statusText }}</span>
      </div>
      <div v-if="status === 'running'" class="progress-track">
        <div
          class="progress-fill"
          :style="{ width: `${Math.min(100, progress * 100)}%` }"
        />
      </div>
      <div v-if="errorText" class="alert alert-error">{{ errorText }}</div>
      <details v-if="log.length" class="log-panel" :open="status === 'running'">
        <summary>调试日志（{{ log.length }} 行）</summary>
        <pre class="log-body">{{ log.slice(-80).join("\n") }}</pre>
      </details>
    </div>

    <div v-if="resultUrl" class="alert alert-success result-box">
      <p class="download-label">下载方式</p>
      <div class="download-actions">
        <a :href="resultUrl" :download="resultName" class="btn btn-primary download">
          下载 JPG
          <small>{{ resultName }}</small>
        </a>
        <button
          type="button"
          class="btn btn-ghost download"
          :disabled="zipBusy"
          @click="downloadZip"
        >
          {{ zipBusy ? "正在打包…" : "下载 ZIP" }}
          <small>{{ zipFilenameFor(resultName) }}</small>
        </button>
      </div>
      <p v-if="zipError" class="zip-error">{{ zipError }}</p>
      <p class="file-size">{{ (resultSize / 1024 / 1024).toFixed(2) }} MB · JPG 原图</p>
      <p class="transfer-tip">
        推荐用 <strong>ZIP</strong> 经微信 / QQ / 邮件传输，解压后再导入相册，可避免压缩剥除 EXIF / MotionPhoto 元数据。
        也可直接下载 JPG，用 <strong>USB</strong>、<strong>OPPO 互传</strong> 或 <strong>微信原图</strong> 传到手机，
        放进 <code>DCIM/Camera/</code>。
      </p>
    </div>
  </section>
</template>

<style scoped>
.export-step {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.status-block {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.status-line {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: var(--text-soft);
}
.result-box {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.download-label {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-soft);
  letter-spacing: 0.04em;
}
.download-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
@media (max-width: 480px) {
  .download-actions {
    grid-template-columns: 1fr;
  }
}
.download {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  text-decoration: none;
  text-align: center;
  line-height: 1.3;
}
.download small {
  font-size: 10px;
  font-weight: 400;
  opacity: 0.85;
  word-break: break-all;
}
.zip-error {
  margin: 0;
  font-size: 12px;
  color: var(--danger, #e74c3c);
}
.file-size {
  margin: 0;
  text-align: center;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-faint);
}
.transfer-tip {
  margin: 0;
  font-size: 13px;
  color: var(--text-soft);
  line-height: 1.65;
}
.transfer-tip code {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--warm);
}
</style>
