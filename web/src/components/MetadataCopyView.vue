<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import SourceMetadataPanel from "./SourceMetadataPanel.vue";
import {
  copyImageMetadata,
  emptyBundle,
  FULL_COPY_PRESET,
  loadReferenceImageFile,
  LIVE_PHOTO_TARGET_PRESET,
  sourceEditsForCopy,
  type CopyMetadataOptions,
  type NativeMetadataBundle,
  type ParseSummary,
} from "../lib/metadata";
import {
  isLikelyLivePhotoFilename,
  isLikelyLivePhotoTarget,
} from "../lib/metadata/detectLivePhotoTarget";
import {
  BACKEND_LABELS,
  checkBackendHealth,
  copyImageMetadataViaBackend,
  loadBackendUrl,
  saveBackendUrl,
  type BackendHealth,
} from "../lib/metadata/backendCopy";
import { preloadExiftoolRuntime } from "../lib/metadata/exiftoolCopy";
import { debugLog } from "../lib/metadata/exiftoolDebug";
import { previewBlobForImageFile } from "../lib/metadata/imageToJpeg";
import { REFERENCE_IMAGE_ACCEPT } from "../lib/metadata";

type CopyEngine = "browser" | "backend";

const sourceFile = ref<File | null>(null);
const destFile = ref<File | null>(null);
const sourcePreviewUrl = ref("");
const destPreviewUrl = ref("");
const sourcePreviewLoading = ref(false);
const destPreviewLoading = ref(false);
const previewError = ref("");

const sourceBundle = ref<NativeMetadataBundle | null>(null);
const sourceEdits = ref<NativeMetadataBundle>(emptyBundle());
const sourceMetaLoading = ref(false);
const sourceMetaError = ref("");
const sourceParseSummary = ref<ParseSummary | null>(null);
const showSourceMeta = ref(false);

const excludeExif = ref(false);
const excludeXmp = ref(true);
const excludeIptc = ref(false);
const preset = ref<"live" | "full" | "custom">("live");
const destIsLivePhoto = ref(false);
const destLiveHint = ref("");
const destLiveWarning = ref("");

const copyEngine = ref<CopyEngine>("browser");
const backendUrl = ref(loadBackendUrl());
const backendHealth = ref<BackendHealth | null>(null);
const backendChecking = ref(false);

const exiftoolReady = ref(false);
const exiftoolLoading = ref(false);

const status = ref<"idle" | "running" | "done" | "error">("idle");
const statusText = ref("");
const errorText = ref("");
const engineUsedLabel = ref("");
const resultUrl = ref("");
const resultName = ref("");
const resultSize = ref(0);
const resultMeta = ref<{
  fieldCount: number;
  outputMake?: string;
  outputModel?: string;
  outputExifCount: number;
  colorOsIssues?: string[];
} | null>(null);

const backendStatusLine = computed(() => {
  if (copyEngine.value !== "backend") return "";
  if (backendChecking.value) return "检测连接…";
  if (backendHealth.value?.ok) {
    const name = backendHealth.value.gexiv2?.backend ?? "local";
    const label = BACKEND_LABELS[name] ?? name;
    const ver = backendHealth.value.version ? ` · v${backendHealth.value.version}` : "";
    return `已连接 · ${label}${ver}`;
  }
  if (backendHealth.value?.error) return backendHealth.value.error;
  return "未连接";
});

function copyOptions(): CopyMetadataOptions {
  const opts: CopyMetadataOptions = {
    excludeExif: excludeExif.value,
    excludeXmp: excludeXmp.value,
    excludeIptc: excludeIptc.value,
  };
  const edits = sourceEditsForCopy(sourceBundle.value, sourceEdits.value);
  if (edits) opts.sourceEdits = edits;
  return opts;
}

function resetSourceMetadata() {
  sourceBundle.value = null;
  sourceEdits.value = emptyBundle();
  sourceMetaError.value = "";
  sourceParseSummary.value = null;
  showSourceMeta.value = false;
}

async function parseSourceMetadata(f: File) {
  sourceMetaLoading.value = true;
  sourceMetaError.value = "";
  sourceBundle.value = null;
  sourceEdits.value = emptyBundle();
  sourceParseSummary.value = null;
  try {
    const loaded = await loadReferenceImageFile(f);
    URL.revokeObjectURL(loaded.previewUrl);
    sourceBundle.value = loaded.bundle;
    sourceParseSummary.value = loaded.summary;
  } catch (e) {
    sourceMetaError.value = (e as Error).message ?? String(e);
  } finally {
    sourceMetaLoading.value = false;
  }
}

function reloadSourceMetadataFromFile() {
  if (sourceFile.value) void parseSourceMetadata(sourceFile.value);
}

function applyPreset(mode: "full" | "live" | "custom") {
  preset.value = mode;
  if (mode === "full") {
    excludeExif.value = FULL_COPY_PRESET.excludeExif ?? false;
    excludeXmp.value = FULL_COPY_PRESET.excludeXmp ?? false;
    excludeIptc.value = FULL_COPY_PRESET.excludeIptc ?? false;
  } else if (mode === "live") {
    excludeExif.value = LIVE_PHOTO_TARGET_PRESET.excludeExif ?? false;
    excludeXmp.value = LIVE_PHOTO_TARGET_PRESET.excludeXmp ?? true;
    excludeIptc.value = LIVE_PHOTO_TARGET_PRESET.excludeIptc ?? false;
  }
  updateDestLiveHints();
}

function updateDestLiveHints() {
  if (!destIsLivePhoto.value) {
    destLiveHint.value = "";
    destLiveWarning.value = "";
    return;
  }
  if (preset.value === "live") {
    destLiveHint.value =
      "已识别为实况图目标：Live 目标预设不会复制源图 XMP，copy 后会同步 MotionPhoto 标签。";
    destLiveWarning.value = "";
  } else if (preset.value === "full") {
    destLiveHint.value = "";
    destLiveWarning.value =
      "目标为实况图且使用全量预设：可能短暂覆盖 MotionPhoto XMP；复制后会自动重建，仍建议改用 Live 目标。";
  } else {
    destLiveHint.value = "已识别为实况图目标。";
    destLiveWarning.value =
      excludeXmp.value
        ? ""
        : "自定义选项未排除 XMP：向 live.jpg 复制可能覆盖 MotionPhoto 标签。";
  }
}

async function inspectDestLivePhoto(f: File) {
  destIsLivePhoto.value = false;
  destLiveHint.value = "";
  destLiveWarning.value = "";
  try {
    const bytes = new Uint8Array(await f.arrayBuffer());
    destIsLivePhoto.value = isLikelyLivePhotoTarget(f, bytes);
    if (destIsLivePhoto.value && preset.value !== "custom") {
      applyPreset("live");
    } else {
      updateDestLiveHints();
    }
  } catch {
    destIsLivePhoto.value = isLikelyLivePhotoFilename(f.name);
    updateDestLiveHints();
  }
}

async function ensureExiftoolReady() {
  if (exiftoolReady.value) return;
  exiftoolLoading.value = true;
  try {
    await preloadExiftoolRuntime();
    exiftoolReady.value = true;
  } finally {
    exiftoolLoading.value = false;
  }
}

async function refreshBackendHealth() {
  backendChecking.value = true;
  try {
    saveBackendUrl(backendUrl.value);
    backendHealth.value = await checkBackendHealth(backendUrl.value);
  } finally {
    backendChecking.value = false;
  }
}

function onCopyEngineChange() {
  engineUsedLabel.value = "";
  if (copyEngine.value === "browser") {
    void ensureExiftoolReady();
  } else {
    void refreshBackendHealth();
  }
}

onMounted(() => {
  void ensureExiftoolReady();
  void refreshBackendHealth();
});

function pickSource() {
  openPicker((f) => loadSource(f));
}

function pickDest() {
  openPicker((f) => loadDest(f));
}

function openPicker(onFile: (f: File) => void, accept = REFERENCE_IMAGE_ACCEPT) {
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = accept;
  inp.onchange = () => {
    if (inp.files?.[0]) onFile(inp.files[0]);
  };
  inp.click();
}

async function setPreview(file: File, target: "source" | "dest") {
  const loading = target === "source" ? sourcePreviewLoading : destPreviewLoading;
  const urlRef = target === "source" ? sourcePreviewUrl : destPreviewUrl;
  loading.value = true;
  previewError.value = "";
  if (urlRef.value) URL.revokeObjectURL(urlRef.value);
  urlRef.value = "";
  try {
    const blob = await previewBlobForImageFile(file);
    urlRef.value = URL.createObjectURL(blob);
  } catch (e) {
    previewError.value = (e as Error).message ?? String(e);
  } finally {
    loading.value = false;
  }
}

async function loadSource(f: File) {
  clearResult();
  sourceFile.value = f;
  await Promise.all([setPreview(f, "source"), parseSourceMetadata(f)]);
}

async function loadDest(f: File) {
  clearResult();
  destFile.value = f;
  await Promise.all([setPreview(f, "dest"), inspectDestLivePhoto(f)]);
}

function clearSource() {
  if (sourcePreviewUrl.value) URL.revokeObjectURL(sourcePreviewUrl.value);
  sourcePreviewUrl.value = "";
  sourceFile.value = null;
  resetSourceMetadata();
  clearResult();
}

function clearDest() {
  if (destPreviewUrl.value) URL.revokeObjectURL(destPreviewUrl.value);
  destPreviewUrl.value = "";
  destFile.value = null;
  destIsLivePhoto.value = false;
  destLiveHint.value = "";
  destLiveWarning.value = "";
  clearResult();
}

function clearResult() {
  if (resultUrl.value) URL.revokeObjectURL(resultUrl.value);
  resultUrl.value = "";
  resultName.value = "";
  resultSize.value = 0;
  resultMeta.value = null;
  errorText.value = "";
  engineUsedLabel.value = "";
  status.value = "idle";
  statusText.value = "";
}

function onDropSource(e: DragEvent) {
  e.preventDefault();
  const f = e.dataTransfer?.files?.[0];
  if (f) loadSource(f);
}

function onDropDest(e: DragEvent) {
  e.preventDefault();
  const f = e.dataTransfer?.files?.[0];
  if (f) loadDest(f);
}

function outputName(dest: File): { name: string; mime: string } {
  const dot = dest.name.lastIndexOf(".");
  const base = dot > 0 ? dest.name.slice(0, dot) : dest.name;
  const ext = dot > 0 ? dest.name.slice(dot) : ".jpg";
  return {
    name: `${base}-meta${ext}`,
    mime: dest.type || "application/octet-stream",
  };
}

function backendLabel(id?: string): string {
  if (!id) return "本地服务";
  return BACKEND_LABELS[id] ?? id;
}

async function runCopy() {
  if (!sourceFile.value || !destFile.value) return;
  clearResult();
  status.value = "running";

  if (copyEngine.value === "backend") {
    if (!backendHealth.value?.ok) {
      status.value = "error";
      errorText.value = backendHealth.value?.error ?? "本地服务不可用";
      statusText.value = "复制失败";
      return;
    }
    statusText.value = "正在复制…";
  } else {
    statusText.value = exiftoolReady.value ? "正在复制…" : "正在加载 ExifTool…";
  }

  try {
    let result;
    if (copyEngine.value === "backend") {
      result = await copyImageMetadataViaBackend(
        destFile.value,
        sourceFile.value,
        copyOptions(),
        backendUrl.value,
      );
      engineUsedLabel.value = `已通过本地服务复制 (${backendLabel(result.backendUsed)})`;
    } else {
      await ensureExiftoolReady();
      statusText.value = "正在复制…";
      result = await copyImageMetadata(
        destFile.value,
        sourceFile.value,
        copyOptions(),
      );
      engineUsedLabel.value = "已通过浏览器内置服务复制";
    }
    const out = result.downloadName
      ? { name: result.downloadName, mime: destFile.value.type || "application/octet-stream" }
      : outputName(destFile.value);
    debugLog("C", "MetadataCopyView.vue:runCopy", "before-blob", {
      byteLength: result.bytes.byteLength,
      engine: copyEngine.value,
      backendUsed: "backendUsed" in result ? result.backendUsed : undefined,
    });
    const blob = new Blob([new Uint8Array(result.bytes)], { type: out.mime });
    resultUrl.value = URL.createObjectURL(blob);
    resultName.value = out.name;
    resultSize.value = blob.size;
    resultMeta.value = {
      fieldCount: result.sourceFieldCount,
      outputMake: result.outputMake,
      outputModel: result.outputModel,
      outputExifCount: result.outputExifCount,
      colorOsIssues: result.colorOsExif?.ok === false ? result.colorOsExif.issues : undefined,
    };
    const verified =
      result.outputMake || result.outputModel
        ? `${result.outputMake ?? ""} ${result.outputModel ?? ""}`.trim()
        : "";
    status.value = "done";
    const colorOsNote =
      result.colorOsExif?.ok === false
        ? ` · ColorOS 警告：${result.colorOsExif.issues[0] ?? "EXIF 结构可能不兼容"}`
        : "";
    statusText.value = verified
      ? `完成 · ${verified}（${result.outputExifCount} 项 EXIF）${colorOsNote}`
      : `完成 · ${result.sourceFieldCount} 项已复制${colorOsNote}`;
  } catch (e) {
    status.value = "error";
    errorText.value = (e as Error).message ?? String(e);
    debugLog("D", "MetadataCopyView.vue:runCopy", "error", {
      message: errorText.value.slice(0, 800),
      engine: copyEngine.value,
      hasEFile: errorText.value.includes("EFile"),
    });
    statusText.value = "复制失败";
  }
}

onBeforeUnmount(() => {
  if (sourcePreviewUrl.value) URL.revokeObjectURL(sourcePreviewUrl.value);
  if (destPreviewUrl.value) URL.revokeObjectURL(destPreviewUrl.value);
  if (resultUrl.value) URL.revokeObjectURL(resultUrl.value);
});
</script>

<template>
  <section class="meta-module panel">
    <div class="engine-segment" role="tablist" aria-label="复制引擎">
      <button
        type="button"
        role="tab"
        class="engine-seg-btn"
        :class="{ active: copyEngine === 'backend' }"
        :aria-selected="copyEngine === 'backend'"
        @click="copyEngine = 'backend'; onCopyEngineChange()"
      >
        本地服务
      </button>
      <button
        type="button"
        role="tab"
        class="engine-seg-btn"
        :class="{ active: copyEngine === 'browser' }"
        :aria-selected="copyEngine === 'browser'"
        @click="copyEngine = 'browser'; onCopyEngineChange()"
      >
        浏览器内置
      </button>
    </div>

    <div v-if="copyEngine === 'backend'" class="backend-row">
      <input
        v-model="backendUrl"
        type="url"
        class="backend-url-input"
        placeholder="http://localhost:28471"
        @change="refreshBackendHealth"
      />
      <span
        class="conn-dot"
        :class="{
          ok: backendHealth?.ok,
          err: backendHealth && !backendHealth.ok,
          checking: backendChecking,
        }"
        :title="backendStatusLine"
        :aria-label="backendStatusLine"
      />
    </div>

    <div v-if="previewError" class="alert alert-warn">{{ previewError }}</div>

    <div class="dual-upload">
      <div class="upload-col">
        <p class="col-label">源图</p>
        <div
          v-if="!sourceFile"
          class="drop-target inner-drop"
          role="button"
          tabindex="0"
          @click="pickSource"
          @keydown.enter="pickSource"
          @dragenter.prevent
          @dragover.prevent
          @drop="onDropSource"
        >
          <div class="drop-target-icon" aria-hidden="true">◫</div>
          <div class="drop-target-title">选择源图</div>
        </div>
        <div v-else class="preview-box">
          <div v-if="sourcePreviewLoading" class="preview-loading">
            <span class="spinner" aria-hidden="true" />
          </div>
          <img v-else-if="sourcePreviewUrl" :src="sourcePreviewUrl" alt="源图预览" />
          <p class="file-name">{{ sourceFile.name }}</p>
          <div class="row-actions">
            <button type="button" class="btn btn-ghost" @click="pickSource">更换</button>
            <button type="button" class="btn btn-ghost" @click="clearSource">移除</button>
          </div>
          <SourceMetadataPanel
            v-model:open="showSourceMeta"
            :loading="sourceMetaLoading"
            :error="sourceMetaError"
            :reference-bundle="sourceBundle"
            :edits="sourceEdits"
            :summary="sourceParseSummary"
            @update:edits="sourceEdits = $event"
            @reload-from-reference="reloadSourceMetadataFromFile"
          />
        </div>
      </div>

      <div class="upload-col">
        <p class="col-label">目标图</p>
        <div
          v-if="!destFile"
          class="drop-target inner-drop"
          role="button"
          tabindex="0"
          @click="pickDest"
          @keydown.enter="pickDest"
          @dragenter.prevent
          @dragover.prevent
          @drop="onDropDest"
        >
          <div class="drop-target-icon" aria-hidden="true">▣</div>
          <div class="drop-target-title">选择目标图</div>
        </div>
        <div v-else class="preview-box">
          <div v-if="destPreviewLoading" class="preview-loading">
            <span class="spinner" aria-hidden="true" />
          </div>
          <img v-else-if="destPreviewUrl" :src="destPreviewUrl" alt="目标图预览" />
          <p class="file-name">{{ destFile.name }}</p>
          <div class="row-actions">
            <button type="button" class="btn btn-ghost" @click="pickDest">更换</button>
            <button type="button" class="btn btn-ghost" @click="clearDest">移除</button>
          </div>
        </div>
      </div>
    </div>

    <p class="workflow-hint">
      <strong>网页（仅视频）</strong>：功能一生成 live.jpg → 本页复制 OPPO 原片 EXIF（Live 目标预设）。
      <strong>桌面 / CLI 更稳</strong>：先复制到普通封面 JPG，再用
      <code>oppo-live</code> 或 live-photo-conv 合成（见 README）。
      普通 JPG 作目标时更接近 live-photo-conv FAQ 推荐流程。
    </p>

    <p v-if="destLiveHint" class="dest-live-hint">{{ destLiveHint }}</p>
    <p v-if="destLiveWarning" class="dest-live-warn" role="alert">{{ destLiveWarning }}</p>

    <div class="copy-actions">
      <div class="preset-compact" role="group" aria-label="复制预设">
        <button
          type="button"
          class="preset-chip"
          :class="{ active: preset === 'live' }"
          @click="applyPreset('live')"
        >
          Live 目标
        </button>
        <button
          type="button"
          class="preset-chip"
          :class="{ active: preset === 'full' }"
          @click="applyPreset('full')"
        >
          全量（含 XMP）
        </button>
      </div>

      <button
        type="button"
        class="btn btn-primary btn-block"
        :disabled="
          status === 'running' ||
          (copyEngine === 'browser' && exiftoolLoading) ||
          (copyEngine === 'backend' && !backendHealth?.ok) ||
          !sourceFile ||
          !destFile ||
          sourcePreviewLoading ||
          destPreviewLoading ||
          sourceMetaLoading
        "
        @click="runCopy"
      >
        {{
          status === "running"
            ? statusText
            : copyEngine === "browser" && exiftoolLoading
              ? "加载中…"
              : copyEngine === "backend" && !backendHealth?.ok
                ? "本地服务不可用"
                : "复制并下载"
        }}
      </button>
    </div>

    <div v-if="status !== 'idle'" class="status-line">
      <span v-if="status === 'running'" class="spinner" aria-hidden="true" />
      <span :class="{ 'status-ok': status === 'done', 'status-err': status === 'error' }">
        {{ status === 'error' && errorText ? errorText : statusText }}
      </span>
    </div>

    <p v-if="resultMeta?.colorOsIssues?.length" class="coloros-warn" role="alert">
      手机相册可能无法识别机型水印：{{ resultMeta.colorOsIssues.join("；") }}
    </p>

    <a
      v-if="resultUrl"
      :href="resultUrl"
      :download="resultName"
      class="btn btn-primary btn-block download"
    >
      下载 {{ resultName }}
    </a>
  </section>
</template>

<style scoped>
.meta-module {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.engine-segment {
  display: flex;
  gap: 4px;
  padding: 4px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
.engine-seg-btn {
  flex: 1;
  padding: 12px 14px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-soft);
  font-size: 14px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.engine-seg-btn:hover:not(.active) {
  background: rgba(255, 255, 255, 0.03);
  color: var(--text);
}
.engine-seg-btn.active {
  background: var(--live-dim);
  border-color: rgba(59, 220, 151, 0.35);
  color: var(--live);
}
.backend-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.backend-url-input {
  flex: 1;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  color: var(--text);
  font-size: 13px;
}
.conn-dot {
  flex-shrink: 0;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--text-faint);
}
.conn-dot.checking {
  animation: dot-pulse 1.2s ease-in-out infinite;
}
.conn-dot.ok {
  background: var(--live);
  box-shadow: 0 0 8px var(--live-glow);
}
.conn-dot.err {
  background: var(--danger, #e55);
}
@keyframes dot-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
.workflow-hint {
  margin: 0;
  font-size: 13px;
  color: var(--text-soft);
  line-height: 1.65;
}
.workflow-hint code {
  font-family: var(--font-mono);
  font-size: 12px;
}
.dest-live-hint {
  margin: 0;
  font-size: 13px;
  color: var(--live);
  line-height: 1.55;
}
.dest-live-warn {
  margin: 0;
  font-size: 13px;
  color: var(--warm, #e6a23c);
  line-height: 1.55;
}
.copy-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.preset-compact {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
.preset-chip {
  padding: 3px 10px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: transparent;
  color: var(--text-faint);
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}
.preset-chip:hover {
  color: var(--text-soft);
}
.preset-chip.active {
  border-color: var(--live);
  color: var(--live);
  background: var(--live-dim);
}
.dual-upload {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.col-label {
  margin: 0 0 8px;
  font-size: 13px;
  color: var(--text-soft);
}
.preview-box img {
  width: 100%;
  max-height: 180px;
  object-fit: contain;
  border-radius: var(--radius-sm);
  background: var(--bg-input);
}
.preview-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 120px;
  background: var(--bg-input);
  border-radius: var(--radius-sm);
}
.file-name {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--text-faint);
  word-break: break-all;
}
.row-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
.status-line {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: var(--text-soft);
}
.status-ok {
  color: var(--live);
}
.status-err {
  color: var(--danger, #e55);
}
.coloros-warn {
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 0.875rem;
  line-height: 1.45;
  color: var(--warn-fg, #8a5a00);
  background: var(--warn-bg, rgba(255, 180, 0, 0.12));
}
.download {
  text-decoration: none;
}
@media (max-width: 640px) {
  .dual-upload {
    grid-template-columns: 1fr;
  }
}
</style>
