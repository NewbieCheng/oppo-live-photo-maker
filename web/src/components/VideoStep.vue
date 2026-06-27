<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { VideoInfo } from "../lib/webcodecs";

const props = defineProps<{
  file: File;
  previewUrl: string;
  info: VideoInfo | null;
  unsupported: { reason: string; codec?: string } | null;
  start: number;
  duration: number;
  coverTime: number;
  longEdge: number;
  audioKbps: number;
}>();

const emit = defineEmits<{
  changeVideo: [];
  "update:start": [number];
  "update:duration": [number];
  "update:coverTime": [number];
  "update:longEdge": [number];
  "update:audioKbps": [number];
}>();

const videoEl = ref<HTMLVideoElement | null>(null);
const showAdvanced = ref(false);

const formatTime = (s: number) => (isFinite(s) ? s.toFixed(2) : "0.00");
const positionLabel = computed(() => {
  const cur = videoEl.value?.currentTime ?? 0;
  const dur = props.info?.duration ?? 0;
  return `${formatTime(cur)} / ${formatTime(dur)} 秒`;
});

const metaLine = computed(() => {
  if (!props.info) return "";
  return `${props.info.width}×${props.info.height} · ${props.info.codec.toUpperCase()}`;
});

function setStartFromCurrent() {
  if (!videoEl.value) return;
  emit("update:start", +videoEl.value.currentTime.toFixed(2));
}
function setCoverFromCurrent() {
  if (!videoEl.value) return;
  emit("update:coverTime", +videoEl.value.currentTime.toFixed(2));
}

watch(
  () => props.start,
  (v) => {
    if (Math.abs(props.coverTime - v) < 0.5) {
      emit("update:coverTime", v);
    }
  },
);
</script>

<template>
  <section class="panel video-step">
    <div class="head">
      <div>
        <p class="panel-title">选取片段</p>
        <p v-if="metaLine" class="meta-line">{{ metaLine }}</p>
      </div>
      <button type="button" class="btn btn-ghost" @click="emit('changeVideo')">换视频</button>
    </div>

    <p class="filename">{{ file.name }}</p>

    <div v-if="unsupported" class="alert alert-warn">
      <strong>无法处理此视频</strong>
      <p>{{ unsupported.reason }}<span v-if="unsupported.codec">（{{ unsupported.codec }}）</span></p>
    </div>

    <template v-else>
      <div class="viewfinder">
        <div class="viewfinder-ring" aria-hidden="true" />
        <div class="viewfinder-corners" aria-hidden="true">
          <span /><span /><span /><span />
        </div>
        <video ref="videoEl" :src="previewUrl" controls />
      </div>

      <div class="transport">
        <span class="timecode">{{ positionLabel }}</span>
        <div class="transport-actions">
          <button type="button" class="btn" @click="setStartFromCurrent">设为起点</button>
          <button type="button" class="btn" @click="setCoverFromCurrent">设为封面</button>
        </div>
      </div>

      <div class="form-grid">
        <label class="field">
          <span>片段起点</span>
          <input
            type="number"
            step="0.1"
            min="0"
            :value="start"
            @input="emit('update:start', +($event.target as HTMLInputElement).value)"
          />
          <span class="unit">秒</span>
        </label>
        <label class="field">
          <span>片段时长</span>
          <input
            type="number"
            step="0.1"
            min="0.5"
            max="10"
            :value="duration"
            @input="emit('update:duration', +($event.target as HTMLInputElement).value)"
          />
          <span class="unit">秒 · 建议 ≤3</span>
        </label>
        <label class="field">
          <span>封面位置</span>
          <input
            type="number"
            step="0.1"
            min="0"
            :value="coverTime"
            @input="emit('update:coverTime', +($event.target as HTMLInputElement).value)"
          />
          <span class="unit">秒</span>
        </label>
      </div>

      <details class="advanced" :open="showAdvanced">
        <summary @click.prevent="showAdvanced = !showAdvanced">编码参数</summary>
        <div class="form-grid advanced-grid">
          <label class="field">
            <span>输出长边</span>
            <input
              type="number"
              min="360"
              max="4096"
              step="40"
              :value="longEdge"
              @input="emit('update:longEdge', +($event.target as HTMLInputElement).value)"
            />
            <span class="unit">像素</span>
          </label>
          <label class="field">
            <span>音频码率</span>
            <input
              type="number"
              min="64"
              max="320"
              step="32"
              :value="audioKbps"
              @input="emit('update:audioKbps', +($event.target as HTMLInputElement).value)"
            />
            <span class="unit">kbps</span>
          </label>
        </div>
      </details>
    </template>
  </section>
</template>

<style scoped>
.video-step {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}
.meta-line {
  margin: 4px 0 0;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-faint);
  letter-spacing: 0.04em;
}
.filename {
  margin: -8px 0 0;
  font-size: 13px;
  color: var(--text-soft);
  word-break: break-all;
}
.transport {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.timecode {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--warm);
}
.transport-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.advanced {
  border-top: 1px solid var(--border);
  padding-top: 14px;
}
.advanced summary {
  cursor: pointer;
  font-size: 13px;
  color: var(--text-soft);
  user-select: none;
  list-style: none;
}
.advanced summary::-webkit-details-marker {
  display: none;
}
.advanced-grid {
  margin-top: 14px;
}
.alert p {
  margin: 6px 0 0;
  font-size: 13px;
}
</style>
