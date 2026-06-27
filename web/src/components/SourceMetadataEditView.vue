<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import MetadataEditor from "./MetadataEditor.vue";
import {
  REFERENCE_IMAGE_ACCEPT,
  computeDirtyKeys,
  emptyBundle,
  hasMetadataEdits,
  loadReferenceImageFile,
  type NativeMetadataBundle,
  type ParseSummary,
} from "../lib/metadata";
import {
  BACKEND_LABELS,
  checkBackendHealth,
  editSourceMetadataViaBackend,
  loadBackendUrl,
  saveBackendUrl,
  type BackendHealth,
} from "../lib/metadata/backendCopy";
import { editFormatHint, editSourceMetadata } from "../lib/metadata/editMetadata";
import { preloadExiftoolRuntime } from "../lib/metadata/exiftoolCopy";
import { previewBlobForImageFile } from "../lib/metadata/imageToJpeg";

type EditEngine = "browser" | "backend";

const sourceFile = ref<File | null>(null);
const previewUrl = ref("");
const previewLoading = ref(false);
const previewError = ref("");

const sourceBundle = ref<NativeMetadataBundle | null>(null);
const sourceEdits = ref<NativeMetadataBundle>(emptyBundle());
const sourceMetaLoading = ref(false);
const sourceMetaError = ref("");
const sourceParseSummary = ref<ParseSummary | null>(null);

const editEngine = ref<EditEngine>("browser");
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
const colorOsIssues = ref<string[] | undefined>();

const dirtyKeys = computed(() => computeDirtyKeys(sourceBundle.value, sourceEdits.value));
const hasEdits = computed(() => hasMetadataEdits(sourceBundle.value, sourceEdits.value));
const formatHint = computed(() => editFormatHint(sourceFile.value));

const backendStatusLine = computed(() => {
  if (editEngine.value !== "backend") return "";
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

function onEngineChange() {
  engineUsedLabel.value = "";
  if (editEngine.value === "browser") {
    void ensureExiftoolReady();
  } else {
    void refreshBackendHealth();
  }
}

onMounted(() => {
  void ensureExiftoolReady();
  void refreshBackendHealth();
});

function openPicker() {
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = REFERENCE_IMAGE_ACCEPT;
  inp.onchange = () => {
    if (inp.files?.[0]) void loadSource(inp.files[0]);
  };
  inp.click();
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

async function loadSource(f: File) {
  clearResult();
  sourceFile.value = f;
  previewLoading.value = true;
  previewError.value = "";
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  previewUrl.value = "";
  try {
    const blob = await previewBlobForImageFile(f);
    previewUrl.value = URL.createObjectURL(blob);
    await parseSourceMetadata(f);
  } catch (e) {
    previewError.value = (e as Error).message ?? String(e);
  } finally {
    previewLoading.value = false;
  }
}

function reloadSourceMetadataFromFile() {
  if (sourceFile.value) void parseSourceMetadata(sourceFile.value);
}

function clearSource() {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  previewUrl.value = "";
  sourceFile.value = null;
  sourceBundle.value = null;
  sourceEdits.value = emptyBundle();
  sourceMetaError.value = "";
  sourceParseSummary.value = null;
  clearResult();
}

function clearResult() {
  if (resultUrl.value) URL.revokeObjectURL(resultUrl.value);
  resultUrl.value = "";
  resultName.value = "";
  resultSize.value = 0;
  colorOsIssues.value = undefined;
  errorText.value = "";
  engineUsedLabel.value = "";
  status.value = "idle";
  statusText.value = "";
}

function onDrop(e: DragEvent) {
  e.preventDefault();
  const f = e.dataTransfer?.files?.[0];
  if (f) void loadSource(f);
}

function backendLabel(id?: string): string {
  if (!id) return "本地服务";
  return BACKEND_LABELS[id] ?? id;
}

async function runEdit() {
  if (!sourceFile.value || !sourceBundle.value || !hasEdits.value) return;
  clearResult();
  status.value = "running";

  if (editEngine.value === "backend") {
    if (!backendHealth.value?.ok) {
      status.value = "error";
      errorText.value = backendHealth.value?.error ?? "本地服务不可用";
      statusText.value = "保存失败";
      return;
    }
    statusText.value = "正在写入…";
  } else {
    statusText.value = exiftoolReady.value ? "正在写入…" : "正在加载 ExifTool…";
  }

  try {
    let result;
    if (editEngine.value === "backend") {
      result = await editSourceMetadataViaBackend(
        sourceFile.value,
        sourceBundle.value,
        sourceEdits.value,
        backendUrl.value,
      );
      engineUsedLabel.value = `已通过本地服务保存 (${backendLabel("exiftool-edit")})`;
    } else {
      await ensureExiftoolReady();
      statusText.value = "正在写入…";
      result = await editSourceMetadata(
        sourceFile.value,
        sourceBundle.value,
        sourceEdits.value,
      );
      engineUsedLabel.value = "已通过浏览器内置服务保存";
    }

    const blob = new Blob([new Uint8Array(result.bytes)], { type: result.mime });
    resultUrl.value = URL.createObjectURL(blob);
    resultName.value = result.downloadName;
    resultSize.value = blob.size;
    colorOsIssues.value =
      result.colorOsExif?.ok === false ? result.colorOsExif.issues : undefined;
    status.value = "done";
    statusText.value = `完成 · 已写入 ${result.fieldsWritten} 项`;
  } catch (e) {
    status.value = "error";
    errorText.value = (e as Error).message ?? String(e);
    statusText.value = "保存失败";
  }
}

onBeforeUnmount(() => {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  if (resultUrl.value) URL.revokeObjectURL(resultUrl.value);
});
</script>

<template>
  <section class="edit-module panel">
    <p class="module-desc">
      上传手机原图，直接修改 EXIF / IPTC 等参数后下载。适用于调整机型、拍摄时间、GPS 等字段。
    </p>

    <div class="engine-segment" role="tablist" aria-label="编辑引擎">
      <button
        type="button"
        role="tab"
        class="engine-seg-btn"
        :class="{ active: editEngine === 'backend' }"
        :aria-selected="editEngine === 'backend'"
        @click="editEngine = 'backend'; onEngineChange()"
      >
        本地服务
      </button>
      <button
        type="button"
        role="tab"
        class="engine-seg-btn"
        :class="{ active: editEngine === 'browser' }"
        :aria-selected="editEngine === 'browser'"
        @click="editEngine = 'browser'; onEngineChange()"
      >
        浏览器内置
      </button>
    </div>

    <div v-if="editEngine === 'backend'" class="backend-row">
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

    <div
      v-if="!sourceFile"
      class="drop-target"
      role="button"
      tabindex="0"
      @click="openPicker"
      @keydown.enter="openPicker"
      @dragenter.prevent
      @dragover.prevent
      @drop="onDrop"
    >
      <div class="drop-target-icon" aria-hidden="true">◎</div>
      <div class="drop-target-title">上传手机原图</div>
      <p class="drop-target-hint">JPG / HEIC / PNG / WebP · 点击或拖拽</p>
    </div>

    <div v-else class="edit-layout">
      <div class="preview-col">
        <div v-if="previewLoading" class="preview-loading">
          <span class="spinner" aria-hidden="true" />
        </div>
        <img v-else-if="previewUrl" :src="previewUrl" alt="原图预览" />
        <p class="file-name">{{ sourceFile.name }}</p>
        <p v-if="formatHint" class="format-hint">{{ formatHint }}</p>
        <div v-if="sourceParseSummary" class="summary-chips">
          <span v-if="sourceParseSummary.make || sourceParseSummary.model" class="chip">
            {{ [sourceParseSummary.make, sourceParseSummary.model].filter(Boolean).join(" ") }}
          </span>
          <span v-if="sourceParseSummary.dateTime" class="chip">{{ sourceParseSummary.dateTime }}</span>
          <span v-if="sourceParseSummary.hasGps" class="chip">含 GPS</span>
          <span class="chip">{{ sourceParseSummary.fieldCount }} 项元数据</span>
        </div>
        <div class="row-actions">
          <button type="button" class="btn btn-ghost" @click="openPicker">更换</button>
          <button type="button" class="btn btn-ghost" @click="clearSource">移除</button>
        </div>
      </div>

      <div class="editor-col">
        <div v-if="sourceMetaLoading" class="meta-loading">
          <span class="spinner" aria-hidden="true" />
          <span>正在读取 EXIF / IPTC…</span>
        </div>
        <div v-else-if="sourceMetaError" class="alert alert-warn">
          <strong>元数据解析失败</strong>
          <p>{{ sourceMetaError }}</p>
        </div>
        <MetadataEditor
          v-else-if="sourceBundle"
          :reference-bundle="sourceBundle"
          :edits="sourceEdits"
          :dirty-keys="dirtyKeys"
          @update:edits="sourceEdits = $event"
          @reload-from-reference="reloadSourceMetadataFromFile"
        />
      </div>
    </div>

    <button
      type="button"
      class="btn btn-primary btn-block"
      :disabled="
        status === 'running' ||
        !sourceFile ||
        !sourceBundle ||
        !hasEdits ||
        sourceMetaLoading ||
        previewLoading ||
        (editEngine === 'browser' && exiftoolLoading) ||
        (editEngine === 'backend' && !backendHealth?.ok)
      "
      @click="runEdit"
    >
      {{
        status === "running"
          ? statusText
          : !hasEdits && sourceBundle
            ? "请先修改元数据"
            : editEngine === "browser" && exiftoolLoading
              ? "加载中…"
              : editEngine === "backend" && !backendHealth?.ok
                ? "本地服务不可用"
                : "应用修改并下载"
      }}
    </button>

    <div v-if="status !== 'idle'" class="status-line">
      <span v-if="status === 'running'" class="spinner" aria-hidden="true" />
      <span :class="{ 'status-ok': status === 'done', 'status-err': status === 'error' }">
        {{ status === "error" && errorText ? errorText : statusText }}
      </span>
      <span v-if="engineUsedLabel" class="engine-label">{{ engineUsedLabel }}</span>
    </div>

    <p v-if="colorOsIssues?.length" class="coloros-warn" role="alert">
      手机相册可能无法识别机型水印：{{ colorOsIssues.join("；") }}
    </p>

    <a
      v-if="resultUrl"
      :href="resultUrl"
      :download="resultName"
      class="btn btn-primary btn-block download"
    >
      下载 {{ resultName }}（{{ (resultSize / 1024).toFixed(0) }} KB）
    </a>
  </section>
</template>

<style scoped>
.edit-module {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.module-desc {
  margin: 0;
  font-size: 14px;
  color: var(--text-soft);
  line-height: 1.6;
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
.conn-dot.ok {
  background: var(--live);
}
.conn-dot.err {
  background: var(--danger, #e55);
}
.edit-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
  gap: 16px;
  align-items: start;
}
.preview-col img {
  width: 100%;
  max-height: 220px;
  object-fit: contain;
  border-radius: var(--radius-sm);
  background: var(--bg-input);
}
.preview-loading,
.meta-loading {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 120px;
  font-size: 13px;
  color: var(--text-soft);
}
.file-name {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--text-faint);
  word-break: break-all;
}
.format-hint {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--text-soft);
}
.summary-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}
.chip {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text-soft);
}
.row-actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
.editor-col {
  min-height: 200px;
}
.status-line {
  display: flex;
  flex-wrap: wrap;
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
.engine-label {
  font-size: 12px;
  color: var(--text-faint);
}
.coloros-warn {
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 0.875rem;
  color: var(--warn-fg, #8a5a00);
  background: var(--warn-bg, rgba(255, 180, 0, 0.12));
}
.download {
  text-decoration: none;
}
@media (max-width: 720px) {
  .edit-layout {
    grid-template-columns: 1fr;
  }
}
</style>
