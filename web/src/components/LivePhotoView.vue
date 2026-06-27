<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import VideoStep from "./VideoStep.vue";
import ExportStep from "./ExportStep.vue";
import {
  extractCoverWebCodecs,
  probeAndCheck,
  transcodeClipWebCodecs,
  type VideoInfo,
} from "../lib/webcodecs";
import { buildOppoMotionPhoto } from "../lib/muxer";

const file = ref<File | null>(null);
const info = ref<VideoInfo | null>(null);
const previewUrl = ref("");
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

const canConvert = computed(
  () => !!file.value && !!info.value && !unsupported.value,
);

function pickVideo() {
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
    status.value = "idle";
    errorText.value = "";
    statusText.value = `${f.name} · ${result.info.width}×${result.info.height}`;
  } catch (e) {
    status.value = "error";
    errorText.value = (e as Error).message;
  }
}

function changeVideo() {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  previewUrl.value = "";
  file.value = null;
  info.value = null;
  unsupported.value = null;
  statusText.value = "";
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
    const livePhoto = buildOppoMotionPhoto(cover, clip);

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

onBeforeUnmount(() => {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  if (resultUrl.value) URL.revokeObjectURL(resultUrl.value);
});
</script>

<template>
  <div class="live-module">
    <VideoStep
      :file="file"
      :preview-url="previewUrl"
      :info="info"
      :unsupported="unsupported"
      v-model:start="start"
      v-model:duration="duration"
      v-model:cover-time="coverTime"
      v-model:long-edge="longEdge"
      v-model:audio-kbps="audioKbps"
      @pick-video="pickVideo"
      @drop-video="loadFile"
      @change-video="changeVideo"
    />

    <ExportStep
      title="生成实况图"
      description="上传视频 → 选片段 → 一键合成 OPPO MotionPhoto。需要移植机内原图元数据时，请用「功能二 · 元信息复制」。"
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
</template>

<style scoped>
.live-module {
  display: flex;
  flex-direction: column;
  gap: 24px;
}
</style>
