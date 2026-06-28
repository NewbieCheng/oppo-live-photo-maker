<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import VideoStep from "./VideoStep.vue";
import ExportStep from "./ExportStep.vue";
import ReferenceStep from "./ReferenceStep.vue";
import MetadataSourceStep from "./MetadataSourceStep.vue";
import SourceMetadataPanel from "./SourceMetadataPanel.vue";
import {
  extractCoverWebCodecs,
  probeAndCheck,
  transcodeClipWebCodecs,
  type VideoInfo,
} from "../lib/webcodecs";
import {
  buildLivePhotoWithMetadata,
  createFindX8UltraTemplate,
  emptyBundle,
  loadReferenceImageFile,
  mergeSpoofBundles,
  spoofBundleFrom,
  REFERENCE_IMAGE_ACCEPT,
  type CoverMode,
  type LoadedReferenceImage,
  type MetadataSourceMode,
  type NativeMetadataBundle,
  type ParseSummary,
} from "../lib/metadata";

const findX8Template = createFindX8UltraTemplate();

const file = ref<File | null>(null);
const info = ref<VideoInfo | null>(null);
const previewUrl = ref("");
const unsupported = ref<{ reason: string; codec?: string } | null>(null);

const start = ref(0);
const duration = ref(3);
const coverTime = ref(0);
const longEdge = ref(1920);
const audioKbps = ref(128);

const referenceFile = ref<File | null>(null);
const referenceLoaded = ref<LoadedReferenceImage | null>(null);
const referencePreviewUrl = ref("");
const referenceParsing = ref(false);
const referenceParseError = ref("");
const referenceParseSummary = ref<ParseSummary | null>(null);
const coverMode = ref<CoverMode>("videoFrame");
const metadataSource = ref<MetadataSourceMode>("none");
const metadataEdits = ref<NativeMetadataBundle>(emptyBundle());
const showMetadata = ref(false);

const status = ref<"idle" | "running" | "done" | "error">("idle");
const statusText = ref("");
const errorText = ref("");
const log = ref<string[]>([]);
const progress = ref(0);
const resultUrl = ref("");
const resultName = ref("");
const resultSize = ref(0);
const resultBytes = ref<Uint8Array | null>(null);

const canConvert = computed(
  () =>
    !!file.value &&
    !!info.value &&
    !unsupported.value &&
    !(coverMode.value === "referenceImage" && !referenceLoaded.value),
);

const metadataEditorBase = computed(() => {
  if (metadataSource.value === "template") return findX8Template;
  if (referenceLoaded.value) return spoofBundleFrom(referenceLoaded.value.bundle);
  return null;
});

const showMetadataPanel = computed(
  () =>
    metadataSource.value === "template" ||
    (metadataSource.value === "reference" && !!referenceLoaded.value),
);

const exportDescription = computed(() => {
  if (metadataSource.value === "reference" && referenceLoaded.value) {
    return "上传视频 → 选片段 → 合成 MotionPhoto XMP → 叠加机内原图 EXIF / IPTC 伪造参数。";
  }
  if (metadataSource.value === "template") {
    return "上传视频 → 选片段 → 合成 MotionPhoto XMP → 叠加 Find X8 Ultra 模板 EXIF 参数。";
  }
  return "上传视频 → 选片段 → 仅合成 MotionPhoto XMP（默认）。可选参考图或模板叠加 EXIF 伪造参数。";
});

function effectiveSpoofMetadata(): NativeMetadataBundle | undefined {
  if (metadataSource.value === "reference" && referenceLoaded.value) {
    return mergeSpoofBundles(
      spoofBundleFrom(referenceLoaded.value.bundle),
      metadataEdits.value,
    );
  }
  if (metadataSource.value === "template") {
    return mergeSpoofBundles(findX8Template, metadataEdits.value);
  }
  return undefined;
}

function onMetadataSourceChange(mode: MetadataSourceMode) {
  if (mode !== "reference") clearReference();
  metadataSource.value = mode;
  metadataEdits.value = emptyBundle();
  showMetadata.value = false;
}

function resetTemplateEdits() {
  metadataEdits.value = emptyBundle();
}

function pickVideo() {
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = "video/*";
  inp.onchange = () => {
    if (inp.files?.[0]) loadFile(inp.files[0]);
  };
  inp.click();
}

function pickReference() {
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = REFERENCE_IMAGE_ACCEPT;
  inp.onchange = () => {
    if (inp.files?.[0]) loadReference(inp.files[0]);
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

async function loadReference(f: File) {
  clearReference();
  referenceFile.value = f;
  referenceParsing.value = true;
  referenceParseError.value = "";
  try {
    const loaded = await loadReferenceImageFile(f);
    referenceLoaded.value = loaded;
    referencePreviewUrl.value = loaded.previewUrl;
    referenceParseSummary.value = loaded.summary;
    metadataEdits.value = emptyBundle();
    showMetadata.value = false;
  } catch (e) {
    referenceParseError.value = (e as Error).message ?? String(e);
  } finally {
    referenceParsing.value = false;
  }
}

function clearReference() {
  if (referencePreviewUrl.value) URL.revokeObjectURL(referencePreviewUrl.value);
  referenceFile.value = null;
  referenceLoaded.value = null;
  referencePreviewUrl.value = "";
  referenceParseError.value = "";
  referenceParseSummary.value = null;
  metadataEdits.value = emptyBundle();
  showMetadata.value = false;
  if (coverMode.value === "referenceImage") coverMode.value = "videoFrame";
}

async function reloadMetadataFromReference() {
  if (!referenceFile.value) return;
  await loadReference(referenceFile.value);
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
  resultBytes.value = null;
  errorText.value = "";
  log.value = [];
  progress.value = 0;
}

async function resolveCoverJpeg(): Promise<Uint8Array> {
  if (coverMode.value === "referenceImage") {
    const loaded = referenceLoaded.value;
    if (!loaded) throw new Error("请先上传机内原图作为封面");
    if (loaded.jpegBytes && loaded.jpegBytes.length > 256) return loaded.jpegBytes;
    if (loaded.useSegmentTransplant) return loaded.originalBytes;
    throw new Error("参考图无法解码为 JPEG 封面，请换一张机内直出原图");
  }
  return extractCoverWebCodecs(file.value!, {
    timestamp: coverTime.value,
    longEdge: longEdge.value,
  });
}

async function convert() {
  if (!file.value || !info.value) return;
  resetResult();
  status.value = "running";

  try {
    statusText.value = "[1/3] 正在抽取封面帧…";
    progress.value = 0;
    const cover = await resolveCoverJpeg();

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
    const merged = effectiveSpoofMetadata();
    const livePhoto = buildLivePhotoWithMetadata(cover, clip, {
      reference: referenceLoaded.value,
      metadata: merged,
      coverTime: coverTime.value,
      segmentStart: start.value,
      coverMode: coverMode.value,
      useReferenceSegments:
        metadataSource.value === "reference" &&
        !!referenceLoaded.value?.useSegmentTransplant,
    });

    const blob = new Blob([livePhoto.buffer as ArrayBuffer], { type: "image/jpeg" });
    if (resultUrl.value) URL.revokeObjectURL(resultUrl.value);
    resultUrl.value = URL.createObjectURL(blob);
    resultBytes.value = livePhoto;
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
  if (referencePreviewUrl.value) URL.revokeObjectURL(referencePreviewUrl.value);
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

    <MetadataSourceStep :mode="metadataSource" @update:mode="onMetadataSourceChange" />

    <ReferenceStep
      v-if="metadataSource === 'reference'"
      :reference-file="referenceFile"
      :reference-preview-url="referencePreviewUrl"
      :cover-mode="coverMode"
      :parsing="referenceParsing"
      :parsing-name="referenceFile?.name ?? ''"
      :parse-error="referenceParseError"
      :parse-summary="referenceParseSummary"
      @pick-reference="pickReference"
      @clear-reference="clearReference"
      @drop-reference="loadReference"
      @update:cover-mode="coverMode = $event"
    />

    <SourceMetadataPanel
      v-if="showMetadataPanel"
      v-model:open="showMetadata"
      :loading="referenceParsing"
      :error="referenceParseError"
      :reference-bundle="metadataEditorBase"
      v-model:edits="metadataEdits"
      :summary="referenceParseSummary"
      :source-label="metadataSource === 'template' ? 'Find X8 Ultra 模板' : '机内原图'"
      :allow-reload="metadataSource === 'reference'"
      spoof-only
      @reload-from-reference="reloadMetadataFromReference"
      @reset-template="resetTemplateEdits"
    />

    <ExportStep
      title="生成实况图"
      :description="exportDescription"
      :status="status"
      :status-text="statusText"
      :error-text="errorText"
      :progress="progress"
      :log="log"
      :result-url="resultUrl"
      :result-name="resultName"
      :result-size="resultSize"
      :result-bytes="resultBytes"
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
