<script setup lang="ts">
import type { CoverMode } from "../lib/metadata/types";

defineProps<{
  referenceFile: File | null;
  referencePreviewUrl: string;
  coverMode: CoverMode;
}>();

const emit = defineEmits<{
  pickReference: [];
  clearReference: [];
  "update:coverMode": [CoverMode];
}>();
</script>

<template>
  <section class="panel ref-step">
    <p class="panel-title">参考原生图</p>
    <p class="panel-desc">
      可选。上传相机或 OPPO 相册里的 JPEG，把 EXIF / IPTC 移植到输出的实况图
      （等同 <code>copy-img-meta --exclude-xmp</code>）。
    </p>

    <div
      v-if="!referenceFile"
      class="drop-target inner-drop"
      role="button"
      tabindex="0"
      @click="emit('pickReference')"
      @keydown.enter="emit('pickReference')"
    >
      <div class="drop-target-icon" aria-hidden="true">◫</div>
      <div class="drop-target-title">选择参考图</div>
      <div class="drop-target-hint">.jpg / .jpeg · 不上传服务器</div>
    </div>

    <div v-else class="ref-preview">
      <div class="viewfinder thumb-frame">
        <img :src="referencePreviewUrl" alt="参考图预览" />
      </div>
      <div class="ref-meta">
        <p class="ref-name">{{ referenceFile.name }}</p>
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
  margin: 0 0 12px;
  font-size: 14px;
  word-break: break-all;
  color: var(--text);
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
</style>
