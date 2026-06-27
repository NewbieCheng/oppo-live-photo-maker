<script setup lang="ts">
defineProps<{
  status: "idle" | "running" | "done" | "error";
  statusText: string;
  errorText: string;
  progress: number;
  log: string[];
  resultUrl: string;
  resultName: string;
  resultSize: number;
  canConvert: boolean;
}>();

const emit = defineEmits<{
  convert: [];
}>();
</script>

<template>
  <section class="panel export-step">
    <p class="panel-title">生成实况图</p>
    <p class="panel-desc">
      封面、视频片段与元数据将在本地合成，输出 OPPO 相册可识别的 MotionPhoto JPEG。
    </p>

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
      <a :href="resultUrl" :download="resultName" class="btn btn-primary btn-block download">
        下载 {{ resultName }}
      </a>
      <p class="file-size">{{ (resultSize / 1024 / 1024).toFixed(2) }} MB</p>
      <p class="transfer-tip">
        用 <strong>USB</strong>、<strong>OPPO 互传</strong> 或 <strong>微信原图</strong> 传到手机，
        放进 <code>DCIM/Camera/</code>。
        普通微信 / QQ 图片会剥除元数据，相册无法识别实况。
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
.download {
  text-decoration: none;
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
