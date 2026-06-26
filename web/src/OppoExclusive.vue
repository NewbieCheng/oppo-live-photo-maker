<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref } from "vue";
import exifr from "exifr";
import {
  extractCoverWebCodecs,
  hasWebCodecsApi,
  probeAndCheck,
  transcodeClipWebCodecs,
  type VideoInfo,
} from "./lib/webcodecs";
import { buildOppoMotionPhoto, type OPPOMetadata } from "./lib/muxer";

// ---------- reactive state ------------------------------------------------
const state = reactive({
  // Page mode: "extract" | "combine"
  mode: "extract" as "extract" | "combine",

  // Metadata extraction
  phonePhoto: null as File | null,
  phonePhotoUrl: "",
  extractedMeta: null as Record<string, any> | null,
  metaCache: null as Record<string, any> | null,
  metaCacheSource: "",

  // Video
  videoFile: null as File | null,
  videoInfo: null as VideoInfo | null,
  videoUrl: "",
  dragOver: false,
  unsupported: null as { reason: string; codec?: string } | null,

  // Combine settings
  start: 0,
  duration: 3,
  coverTime: 0,
  longEdge: 1920,
  audioKbps: 128,
  showAdvanced: false,

  // Processing
  status: "idle" as "idle" | "running" | "done" | "error",
  statusText: "",
  errorText: "",
  log: [] as string[],
  progress: 0,
  resultUrl: "",
  resultName: "",
  resultSize: 0,
  resultMeta: null as OPPOMetadata | null,
});

const videoEl = ref<HTMLVideoElement | null>(null);
const browserOk = hasWebCodecsApi();

// ---------- helpers -------------------------------------------------------
const fmt = (s: number) => (isFinite(s) ? s.toFixed(2) : "0.00");

const posLabel = computed(() => {
  const c = videoEl.value?.currentTime ?? 0;
  const d = state.videoInfo?.duration ?? 0;
  return `${fmt(c)}s / ${fmt(d)}s`;
});

const sizeHuman = (b: number) => {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(2)} MB`;
};

// ---------- metadata extraction -------------------------------------------
async function loadPhonePhoto(f: File) {
  resetResult();
  if (state.phonePhotoUrl) URL.revokeObjectURL(state.phonePhotoUrl);
  state.phonePhoto = f;
  state.phonePhotoUrl = URL.createObjectURL(f);
  state.extractedMeta = null;
  state.statusText = "Reading photo metadata...";

  try {
    // Extract EXIF + XMP using exifr
    const exif = await exifr.parse(f, { 
      xmp: true, iptc: true, exif: true, gps: true,
      translateKeys: true, translateValues: true,
    });
    // exifr returns XMP and IPTC alongside EXIF when options enable them
    const xmpRaw = (exif as any)?.xmp ?? {};
    const iptcRaw = (exif as any)?.iptc ?? {};
    
    state.extractedMeta = {
      exif: exif ?? {},
      xmp: xmpRaw,
      iptc: iptcRaw,
      fileName: f.name,
      fileSize: f.size,
      fileType: f.type,
    };

    state.statusText = `Metadata extracted from ${f.name}`;
  } catch (e) {
    state.errorText = `Extraction failed: ${(e as Error).message}`;
    state.status = "error";
  }
}

function cacheCurrentMeta() {
  if (!state.extractedMeta) return;
  state.metaCache = state.extractedMeta;
  state.metaCacheSource = state.phonePhoto?.name ?? "";
  state.statusText = `Metadata cached from ${state.metaCacheSource}`;
}

function clearMetaCache() {
  state.metaCache = null;
  state.metaCacheSource = "";
}

function pickPhonePhoto() {
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = "image/*";
  inp.onchange = () => { if (inp.files?.[0]) loadPhonePhoto(inp.files[0]); };
  inp.click();
}

// ---------- video loading -------------------------------------------------
function pickVideo() {
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = "video/*";
  inp.onchange = () => { if (inp.files?.[0]) loadVideo(inp.files[0]); };
  inp.click();
}

async function loadVideo(f: File) {
  resetResult();
  state.unsupported = null;
  state.videoFile = f;
  if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
  state.videoUrl = URL.createObjectURL(f);
  state.status = "idle";
  state.statusText = "Reading video info...";
  try {
    const r = await probeAndCheck(f);
    state.videoInfo = r.info;
    if (!r.supported) {
      state.unsupported = { reason: r.reason ?? "Unknown", codec: r.info.codec };
      state.statusText = "";
      return;
    }
    state.start = 0;
    state.coverTime = 0;
    state.duration = Math.min(3, Math.max(0.5, r.info.duration || 3));
    state.statusText = `${f.name} · ${r.info.width}×${r.info.height} · ${fmt(r.info.duration)}s · ${r.info.codec}`;
  } catch (e) {
    state.status = "error";
    state.errorText = (e as Error).message;
  }
}

function dropVideo(e: DragEvent) {
  e.preventDefault();
  state.dragOver = false;
  const f = e.dataTransfer?.files?.[0];
  if (f) loadVideo(f);
}

function setStart() { if (videoEl.value) state.start = +videoEl.value.currentTime.toFixed(2); }
function setCover() { if (videoEl.value) state.coverTime = +videoEl.value.currentTime.toFixed(2); }

// ---------- combine & generate --------------------------------------------
function resetResult() {
  if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
  state.resultUrl = "";
  state.resultName = "";
  state.resultSize = 0;
  state.resultMeta = null;
  state.errorText = "";
  state.log = [];
  state.progress = 0;
}

async function combine() {
  if (!state.videoFile || !state.videoInfo) return;
  resetResult();
  state.status = "running";

  try {
    // Step 1: extract cover from video
    state.statusText = "[1/3] Extracting cover frame...";
    state.progress = 0;
    const cover = await extractCoverWebCodecs(state.videoFile, {
      timestamp: state.coverTime,
      longEdge: state.longEdge,
    });

    // Step 2: transcode clip
    state.statusText = "[2/3] Transcoding video...";
    state.progress = 0;
    const clip = await transcodeClipWebCodecs(state.videoFile, {
      start: state.start,
      duration: state.duration,
      longEdge: state.longEdge,
      audioKbps: state.audioKbps,
      hasAudio: state.videoInfo.hasAudio,
      onProgress: (r) => (state.progress = r),
      onDiscarded: (reasons) => {
        for (const r of reasons) state.log.push(`[discarded] ${r}`);
      },
    });

    // Step 3: mux OPPO live photo
    state.statusText = "[3/3] Muxing OPPO Live Photo...";
    const { buffer, metadata } = buildOppoMotionPhoto(cover, clip);
    state.resultMeta = metadata;

    const blob =     new Blob([buffer as unknown as ArrayBuffer], { type: "image/jpeg" });
    if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
    state.resultUrl = URL.createObjectURL(blob);
    const stem = state.videoFile.name.replace(/\.[^.]+$/, "");
    state.resultName = `${stem}.live.jpg`;
    state.resultSize = blob.size;
    state.status = "done";
    state.statusText = `Done! ${sizeHuman(blob.size)}`;
    state.progress = 1;
  } catch (e) {
    state.status = "error";
    state.errorText = (e as Error).message ?? String(e);
    state.statusText = "Failed";
  }
}

onBeforeUnmount(() => {
  if (state.phonePhotoUrl) URL.revokeObjectURL(state.phonePhotoUrl);
  if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
  if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
});

// ---------- metadata display helpers --------------------------------------
const metaGroups = computed(() => {
  const m = state.metaCache ?? state.extractedMeta;
  if (!m) return [];
  const groups: { title: string; items: { key: string; val: any }[] }[] = [];
  if (m.fileName) groups.push({ title: "File", items: [
    { key: "Name", val: m.fileName }, { key: "Size", val: sizeHuman(m.fileSize) },
  ]});
  if (m.exif && Object.keys(m.exif).length) {
    const items = Object.entries(m.exif).map(([k, v]) => ({ key: k, val: v }));
    groups.push({ title: "EXIF", items });
  }
  if (m.iptc && Object.keys(m.iptc).length) {
    const items = Object.entries(m.iptc).map(([k, v]) => ({ key: k, val: v }));
    groups.push({ title: "IPTC", items });
  }
  if (m.xmp && Object.keys(m.xmp).length) {
    const items = Object.entries(m.xmp).map(([k, v]) => ({ key: k, val: v }));
    groups.push({ title: "XMP", items });
  }
  return groups;
});
</script>

<template>
  <div class="page">
    <header class="hero">
      <div class="badge">OPPO EXCLUSIVE</div>
      <h1>OPPO 实况图 · 元数据提取与合成</h1>
      <p class="sub">
        步骤：① 提取手机照片元数据并缓存 → ② 加载视频 → ③ 合成 OPPO 实况图
      </p>
    </header>

    <!-- ===================== Browser check ===================== -->
    <div v-if="!browserOk" class="msg err">
      <h2>浏览器不支持 WebCodecs</h2>
      <p>请使用 Chrome/Edge 94+ / Safari 16.4+ / Firefox 130+</p>
    </div>

    <!-- ===================== Step 1: Extract Metadata ===================== -->
    <section class="card">
      <div class="step-hdr"><span class="step-num">1</span> 提取手机照片元数据并缓存</div>
      <p class="hint">上传一张 OPPO 手机拍摄的普通照片，系统将提取 EXIF/IPTC/XMP 并缓存，用于合成时注入实况图</p>

      <div v-if="!state.phonePhoto" class="drop-small" @click="pickPhonePhoto">
        <span class="drop-icon2">📷</span>
        <span>点击选择手机照片</span>
      </div>

      <div v-else class="meta-card">
        <div class="meta-row">
          <img :src="state.phonePhotoUrl" class="thumb" />
          <div class="meta-info">
            <strong>{{ state.phonePhoto.name }}</strong>
            <span>{{ sizeHuman(state.phonePhoto.size) }}</span>
          </div>
          <button class="btn-sm" @click="cacheCurrentMeta()" :disabled="!state.extractedMeta">缓存元数据</button>
          <button class="btn-sm" @click="state.phonePhoto = null; state.extractedMeta = null">换一张</button>
        </div>

        <div v-if="state.extractedMeta" class="meta-grid">
          <div v-for="g in metaGroups" :key="g.title" class="meta-group">
            <div class="meta-group-title">{{ g.title }}</div>
            <div v-for="item in g.items" :key="item.key" class="meta-item">
              <span class="mk">{{ item.key }}</span>
              <span class="mv">{{ typeof item.val === 'object' ? JSON.stringify(item.val).slice(0,60) : String(item.val).slice(0,60) }}</span>
            </div>
          </div>
        </div>
        <div v-else-if="state.status === 'error'" class="err-msg">{{ state.errorText }}</div>
        <div v-else class="loading">正在提取...</div>
      </div>

      <div v-if="state.metaCache" class="cache-badge">
        ✅ 元数据已缓存：<strong>{{ state.metaCacheSource }}</strong>
        <button class="btn-sm" @click="clearMetaCache()">清除缓存</button>
      </div>
    </section>

    <!-- ===================== Step 2: Load Video ===================== -->
    <section class="card">
      <div class="step-hdr"><span class="step-num">2</span> 加载视频</div>
      <p class="hint">选择视频文件，拖入或点击选择。系统将转码为 H.264+AAC 片段并合成实况图</p>

      <div v-if="!state.videoFile" class="dropzone"
        :class="{ over: state.dragOver }"
        @click="pickVideo"
        @dragenter.prevent="state.dragOver = true"
        @dragover.prevent="state.dragOver = true"
        @dragleave.prevent="state.dragOver = false"
        @drop="dropVideo">
        <div class="dz-icon">🎬</div>
        <div>拖入视频或点击选择</div>
        <small>MP4 / MOV / MKV / WebM</small>
      </div>

      <div v-else>
        <div class="filebar">
          <span class="fn">{{ state.videoFile.name }} ({{ sizeHuman(state.videoFile.size) }})</span>
          <button class="btn-sm" @click="state.videoFile = null; state.videoInfo = null; state.unsupported = null">换一个</button>
        </div>

        <div v-if="state.unsupported" class="msg err">
          <p>{{ state.unsupported.reason }}<span v-if="state.unsupported.codec"> ({{ state.unsupported.codec }})</span></p>
        </div>

        <template v-else>
          <video ref="videoEl" :src="state.videoUrl" controls class="video-preview" />

          <div class="timeline">
            <span>{{ posLabel }}</span>
            <div class="btn-group">
              <button class="btn" @click="setStart">设为起点</button>
              <button class="btn" @click="setCover">设为封面</button>
            </div>
          </div>

          <div v-if="state.videoInfo" class="vinfo">
            <div class="vchip"><span>分辨率</span><strong>{{ state.videoInfo.width }}×{{ state.videoInfo.height }}</strong></div>
            <div class="vchip"><span>时长</span><strong>{{ fmt(state.videoInfo.duration) }}s</strong></div>
            <div class="vchip"><span>编码</span><strong class="mono">{{ state.videoInfo.codec }}</strong></div>
            <div class="vchip"><span>音频</span><strong>{{ state.videoInfo.hasAudio ? "有" : "无" }}</strong></div>
          </div>

          <div class="params">
            <label>起点 <input type="number" step="0.1" min="0" v-model.number="state.start" /> s</label>
            <label>时长 <input type="number" step="0.1" min="0.5" max="10" v-model.number="state.duration" /> s</label>
            <label>封面 <input type="number" step="0.1" min="0" v-model.number="state.coverTime" /> s</label>
          </div>

          <details class="adv" :open="state.showAdvanced">
            <summary @click="state.showAdvanced = !state.showAdvanced">高级参数</summary>
            <div class="params">
              <label>长边 <input type="number" min="360" max="4096" step="40" v-model.number="state.longEdge" /> px</label>
              <label>音频码率 <input type="number" min="64" max="320" step="32" v-model.number="state.audioKbps" /> kbps</label>
            </div>
          </details>
        </template>
      </div>
    </section>

    <!-- ===================== Step 3: Combine ===================== -->
    <section class="card">
      <div class="step-hdr"><span class="step-num">3</span> 合成 OPPO 实况图</div>
      <p class="hint">将缓存元数据注入实况图片，生成 OPPO 相册可识别的 MotionPhoto</p>

      <button class="btn-primary" :disabled="!state.videoFile || state.status === 'running'" @click="combine">
        {{ state.status === "running" ? "处理中..." : "生成 OPPO 实况图" }}
      </button>

      <div v-if="state.status !== 'idle'" class="prog">
        <div class="stat">{{ state.statusText }}</div>
        <div v-if="state.status === 'running'" class="bar"><div class="bf" :style="{ width: `${Math.min(100, state.progress * 100)}%` }" /></div>
        <div v-if="state.errorText" class="err-msg">{{ state.errorText }}</div>
      </div>

      <!-- ===================== Result ===================== -->
      <div v-if="state.resultUrl" class="result-box">
        <div class="res-hdr">
          <span class="res-badge">✅ 生成成功</span>
          <span class="res-name">{{ state.resultName }} ({{ sizeHuman(state.resultSize) }})</span>
        </div>

        <a :href="state.resultUrl" :download="state.resultName" class="btn-dl">⬇ 下载</a>

        <div v-if="state.resultMeta" class="meta-full">
          <h3>OPPO MotionPhoto 元数据</h3>
          <table>
            <tr><td>GCamera:MotionPhoto</td><td>{{ state.resultMeta.gCameraMotionPhoto }}</td></tr>
            <tr><td>GCamera:MotionPhotoVersion</td><td>{{ state.resultMeta.gCameraMotionPhotoVersion }}</td></tr>
            <tr><td>GCamera:PresentationTimestampUs</td><td>{{ state.resultMeta.presentationTimestampUs }}</td></tr>
            <tr class="oppo"><td>OpCamera:MotionPhotoOwner</td><td><strong>{{ state.resultMeta.motionPhotoOwner }}</strong></td></tr>
            <tr class="oppo"><td>OpCamera:OLivePhotoVersion</td><td><strong>{{ state.resultMeta.oLivePhotoVersion }}</strong></td></tr>
            <tr class="oppo"><td>OpCamera:VideoLength</td><td>{{ sizeHuman(state.resultMeta.videoLength) }} ({{ state.resultMeta.videoLength }} bytes)</td></tr>
            <tr class="oppo"><td>OpCamera:MotionPhotoFeatureFlag</td><td>{{ state.resultMeta.motionPhotoFeatureFlag }}</td></tr>
            <tr><td>Container:Directory[1]</td><td>image/jpeg — Primary</td></tr>
            <tr><td>Container:Directory[2]</td><td>video/mp4 — MotionPhoto ({{ sizeHuman(state.resultMeta.videoLength) }})</td></tr>
            <tr><td>EXIF:UserComment</td><td><code>Oplus_8388608</code></td></tr>
            <tr><td>MPF:NumberOfImages</td><td>1 (Baseline MP Primary)</td></tr>
          </table>
        </div>

        <div v-if="state.metaCache" class="cached-applied">
          <h3>📋 已应用缓存元数据</h3>
          <p>来源：<strong>{{ state.metaCacheSource }}</strong></p>
          <div class="meta-grid">
            <div v-for="g in metaGroups" :key="g.title" class="meta-group">
              <div class="meta-group-title">{{ g.title }}</div>
              <div v-for="item in g.items.slice(0,10)" :key="item.key" class="meta-item">
                <span class="mk">{{ item.key }}</span>
                <span class="mv">{{ typeof item.val === 'object' ? JSON.stringify(item.val).slice(0,50) : String(item.val).slice(0,50) }}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="tip-box">
          📱 通过 <strong>USB / OPPO 互传 / 微信原图</strong> 传到手机，
          放到 <code>DCIM/Camera/</code> 目录。
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.page { max-width: 820px; margin: 0 auto; padding: 16px 20px 64px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; color: #1a1a1a; }
.hero { text-align: center; margin-bottom: 24px; }
.badge { display: inline-block; padding: 3px 14px; background: linear-gradient(135deg,#1677ff,#0958d9); color: #fff; border-radius: 20px; font-size: 11px; font-weight: 700; letter-spacing: 1.5px; margin-bottom: 10px; }
.hero h1 { margin: 0 0 6px; font-size: 24px; }
.hero .sub { color: #666; margin: 0; font-size: 13px; }
.card { background: #fff; border: 1px solid #e8e8e8; border-radius: 12px; padding: 20px; margin-bottom: 16px; }
.step-hdr { font-size: 16px; font-weight: 700; margin-bottom: 4px; }
.step-num { display: inline-block; width: 24px; height: 24px; line-height: 24px; text-align: center; background: #1677ff; color: #fff; border-radius: 50%; font-size: 13px; margin-right: 8px; }
.hint { font-size: 13px; color: #666; margin: 4px 0 14px; }
.msg { padding: 20px; border-radius: 8px; }
.msg.err { background: #fff2f0; border: 1px solid #ffccc7; }
.msg.err h2 { color: #cf1322; font-size: 18px; }
.drop-small { display: flex; align-items: center; gap: 10px; padding: 20px; border: 2px dashed #d9d9d9; border-radius: 8px; cursor: pointer; justify-content: center; color: #555; transition: 0.15s; }
.drop-small:hover { border-color: #1677ff; background: #e6f4ff; }
.drop-icon2 { font-size: 28px; }
.dropzone { padding: 40px 20px; border: 2px dashed #d9d9d9; border-radius: 8px; text-align: center; cursor: pointer; transition: 0.15s; background: #fafafa; }
.dropzone:hover, .dropzone.over { border-color: #1677ff; background: #e6f4ff; }
.dz-icon { font-size: 36px; margin-bottom: 6px; }
.dropzone small { display: block; margin-top: 4px; color: #888; }
.meta-card { margin-top: 10px; }
.meta-row { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.thumb { width: 60px; height: 60px; object-fit: cover; border-radius: 6px; border: 1px solid #e8e8e8; }
.meta-info { flex: 1; display: flex; flex-direction: column; gap: 2px; font-size: 13px; color: #555; }
.meta-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; margin-top: 10px; }
.meta-group { background: #fafafa; border: 1px solid #eee; border-radius: 8px; padding: 10px; }
.meta-group-title { font-size: 11px; font-weight: 700; color: #888; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
.meta-item { display: flex; gap: 4px; font-size: 12px; padding: 2px 0; border-bottom: 1px solid #f0f0f0; }
.mk { color: #666; min-width: 80px; font-family: ui-monospace, monospace; font-size: 11px; flex-shrink: 0; }
.mv { color: #1a1a1a; word-break: break-all; }
.cache-badge { margin-top: 10px; padding: 8px 12px; background: #f6ffed; border: 1px solid #b7eb8f; border-radius: 6px; font-size: 13px; display: flex; align-items: center; gap: 10px; }
.btn-sm { padding: 4px 10px; border: 1px solid #d9d9d9; border-radius: 5px; background: #fff; cursor: pointer; font-size: 12px; white-space: nowrap; }
.btn-sm:hover { border-color: #1677ff; color: #1677ff; }
.btn-sm:disabled { opacity: 0.4; cursor: not-allowed; }
.loading { color: #888; font-size: 13px; padding: 8px 0; }
.err-msg { padding: 8px 12px; background: #fff2f0; border-left: 3px solid #ff4d4f; border-radius: 4px; font-size: 13px; margin-top: 8px; }
.filebar { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: #f5f5f5; border-radius: 6px; margin-bottom: 10px; }
.fn { font-weight: 500; font-size: 14px; word-break: break-all; }
.video-preview { width: 100%; max-height: 380px; background: #000; border-radius: 8px; }
.timeline { display: flex; align-items: center; justify-content: space-between; font-size: 13px; color: #666; margin: 8px 0; }
.btn-group { display: flex; gap: 6px; }
.btn { padding: 5px 10px; border: 1px solid #d9d9d9; background: #fff; border-radius: 5px; cursor: pointer; font-size: 12px; }
.btn:hover { border-color: #1677ff; color: #1677ff; }
.vinfo { display: grid; grid-template-columns: repeat(4,1fr); gap: 8px; margin: 10px 0; }
.vchip { background: #fafafa; border: 1px solid #eee; border-radius: 6px; padding: 8px; text-align: center; font-size: 12px; }
.vchip span { display: block; color: #888; font-size: 10px; margin-bottom: 2px; }
.vchip strong { font-size: 14px; }
.mono { font-family: ui-monospace, monospace; font-size: 11px !important; word-break: break-all; }
.params { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; margin: 10px 0; }
.params label { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: #555; }
.params input { padding: 6px 8px; border: 1px solid #d9d9d9; border-radius: 4px; font-size: 13px; }
.adv summary { cursor: pointer; color: #555; font-size: 13px; user-select: none; }
.btn-primary { width: 100%; padding: 14px; background: linear-gradient(135deg,#1677ff,#0958d9); color: #fff; border: none; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer; transition: 0.15s; }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-primary:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(22,119,255,0.3); }
.prog { margin-top: 12px; display: flex; flex-direction: column; gap: 6px; }
.stat { font-size: 13px; color: #444; }
.bar { height: 5px; background: #eee; border-radius: 3px; overflow: hidden; }
.bf { height: 100%; background: linear-gradient(90deg,#1677ff,#4096ff); transition: 0.2s; }
.result-box { margin-top: 16px; padding: 16px; background: linear-gradient(135deg,#f6ffed,#e6f7ff); border: 1px solid #b7eb8f; border-radius: 10px; display: flex; flex-direction: column; gap: 14px; }
.res-hdr { display: flex; align-items: center; gap: 10px; }
.res-badge { padding: 2px 10px; background: #52c41a; color: #fff; border-radius: 10px; font-size: 11px; font-weight: 700; }
.res-name { font-weight: 600; font-size: 14px; }
.btn-dl { display: inline-block; padding: 10px 28px; background: #52c41a; color: #fff; border-radius: 6px; text-decoration: none; font-weight: 600; text-align: center; transition: 0.15s; }
.btn-dl:hover { background: #73d13d; }
.meta-full { background: #fff; border: 1px solid #e8e8e8; border-radius: 8px; padding: 14px; }
.meta-full h3 { margin: 0 0 10px; font-size: 13px; color: #333; }
.meta-full table { width: 100%; border-collapse: collapse; font-size: 12px; }
.meta-full td { padding: 5px 8px; border-bottom: 1px solid #f0f0f0; }
.meta-full td:first-child { font-family: ui-monospace, monospace; color: #555; width: 55%; }
.meta-full tr.oppo td:first-child { color: #1677ff; }
.meta-full code { background: #f5f5f5; padding: 1px 4px; border-radius: 3px; font-size: 11px; }
.cached-applied { background: #fff; border: 1px solid #e8e8e8; border-radius: 8px; padding: 14px; }
.cached-applied h3 { margin: 0 0 6px; font-size: 13px; }
.cached-applied p { font-size: 12px; color: #555; margin: 0 0 8px; }
.tip-box { font-size: 13px; color: #555; line-height: 1.6; padding: 10px 14px; background: #fff; border-radius: 6px; border: 1px solid #e8e8e8; }
.tip-box code { background: #f5f5f5; padding: 1px 5px; border-radius: 3px; }
</style>
