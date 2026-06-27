<script setup lang="ts">
import type { CoverMode } from "../lib/metadata/types";
import type { ParseSummary } from "../lib/metadata/parse";

defineProps<{
  referenceFile: File | null;
  referencePreviewUrl: string;
  coverMode: CoverMode;
  parsing: boolean;
  parsingName: string;
  parseError: string;
  parseSummary: ParseSummary | null;
}>();

const emit = defineEmits<{
  pickReference: [];
  clearReference: [];
  dropReference: [File];
  "update:coverMode": [CoverMode];
}>();

function onDrop(e: DragEvent) {
  e.preventDefault();
  const f = e.dataTransfer?.files?.[0];
  if (f) emit("dropReference", f);
}
</script>

<template>
  <section class="panel ref-step">
    <p class="panel-title">上传机内原图</p>
    <p class="panel-desc">
      第一步：上传手机相册里的<strong>普通照片</strong>（机内直出的 JPG / HEIC 等）。
      工具会实时读取 Make、Model、拍摄时间、GPS 等 EXIF，并在导出时移植到实况图。
    </p>

    <div
      v-if="!referenceFile && !parsing"
      class="drop-target inner-drop"
      role="button"
      tabindex="0"
      @click="emit('pickReference')"
      @keydown.enter="emit('pickReference')"
      @dragenter.prevent
      @dragover.prevent
      @drop="onDrop"
    >
      <div class="drop-target-icon" aria-hidden="true">◫</div>
      <div class="drop-target-title">拖入或选择机内原图</div>
      <div class="drop-target-hint">JPG · HEIC · HEIF · PNG · WebP · 不上传服务器</div>
    </div>

    <div v-else-if="parsing" class="parse-status" aria-live="polite">
      <span class="spinner" aria-hidden="true" />
      <span>正在解析 {{ parsingName || referenceFile?.name }} …</span>
    </div>

    <div v-else-if="parseError" class="alert alert-warn">
      <strong>解析失败</strong>
      <p>{{ parseError }}</p>
      <button type="button" class="btn btn-ghost" @click="emit('pickReference')">重选图片</button>
    </div>

    <div v-else class="ref-preview">
      <div class="viewfinder thumb-frame">
        <img :src="referencePreviewUrl" alt="参考图预览" />
      </div>
      <div class="ref-meta">
        <p class="ref-name">{{ referenceFile?.name }}</p>
        <div v-if="parseSummary" class="parse-chips">
          <span class="chip">{{ parseSummary.formatLabel }}</span>
          <span class="chip">{{ parseSummary.fieldCount }} 项元数据</span>
          <span v-if="parseSummary.make" class="chip chip-accent">{{ parseSummary.make }}</span>
          <span v-if="parseSummary.model" class="chip chip-accent">{{ parseSummary.model }}</span>
          <span v-if="parseSummary.dateTime" class="chip">{{ parseSummary.dateTime }}</span>
          <span v-if="parseSummary.hasGps" class="chip">GPS</span>
        </div>
        <div class="ref-actions">
          <button type="button" class="btn btn-ghost" @click="emit('pickReference')">更换</button>
          <button type="button" class="btn btn-ghost" @click="emit('clearReference')">移除</button>
        </div>
      </div>
    </div>

    <fieldset class="cover-mode">
      <legend>封面来源</legend>
      <label class="mode-option" :class="{ selected: coverMode === 'videoFrame' }">
        <input
          type="radio"
          name="coverMode"
          value="videoFrame"
          :checked="coverMode === 'videoFrame'"
          @change="emit('update:coverMode', 'videoFrame')"
        />
        <span class="mode-copy">
          <strong>视频帧</strong>
          <small>从预览中截取静态封面</small>
        </span>
      </label>
      <label
        class="mode-option"
        :class="{ selected: coverMode === 'referenceImage', disabled: !referenceFile }"
      >
        <input
          type="radio"
          name="coverMode"
          value="referenceImage"
          :checked="coverMode === 'referenceImage'"
          :disabled="!referenceFile"
          @change="emit('update:coverMode', 'referenceImage')"
        />
        <span class="mode-copy">
          <strong>参考图</strong>
          <small>使用上传图片作为封面像素</small>
        </span>
      </label>
    </fieldset>
  </section>
</template>

<style scoped>
.ref-step {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.inner-drop {
  margin-top: 0;
  padding: 40px 20px;
}
.parse-status {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 24px;
  border: 1px dashed var(--border);
  border-radius: var(--radius-md);
  color: var(--text-soft);
  font-size: 14px;
}
.spinner {
  width: 18px;
  height: 18px;
  border: 2px solid var(--border);
  border-top-color: var(--live);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.ref-preview {
  display: flex;
  gap: 20px;
  align-items: flex-start;
}
.thumb-frame {
  width: 140px;
  flex-shrink: 0;
}
.thumb-frame img {
  max-height: 140px;
  object-fit: cover;
}
.ref-name {
  margin: 0 0 10px;
  font-size: 14px;
  word-break: break-all;
  color: var(--text);
}
.parse-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}
.chip {
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  color: var(--text-soft);
}
.chip-accent {
  border-color: var(--live);
  color: var(--live);
  background: var(--live-dim);
}
.ref-actions {
  display: flex;
  gap: 4px;
}
.cover-mode {
  border: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 10px;
}
.cover-mode legend {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-soft);
  letter-spacing: 0.05em;
  margin-bottom: 4px;
}
.mode-option {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 14px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  background: var(--bg-input);
  cursor: pointer;
  transition: border-color var(--transition), background var(--transition);
}
.mode-option.selected {
  border-color: var(--live);
  background: var(--live-dim);
}
.mode-option.disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.mode-option input {
  margin-top: 3px;
  accent-color: var(--live);
}
.mode-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.mode-copy strong {
  font-size: 14px;
  font-weight: 500;
}
.mode-copy small {
  font-size: 12px;
  color: var(--text-faint);
}
.alert p {
  margin: 6px 0 10px;
  font-size: 13px;
}
</style>
