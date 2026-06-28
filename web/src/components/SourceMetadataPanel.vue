<script setup lang="ts">
import { computed } from "vue";
import MetadataEditor from "./MetadataEditor.vue";
import {
  computeDirtyKeys,
  computeSpoofDirtyKeys,
  type NativeMetadataBundle,
  type ParseSummary,
} from "../lib/metadata";

const props = defineProps<{
  open: boolean;
  loading: boolean;
  error: string;
  referenceBundle: NativeMetadataBundle | null;
  edits: NativeMetadataBundle;
  summary: ParseSummary | null;
  sourceLabel?: string;
  allowReload?: boolean;
  spoofOnly?: boolean;
}>();

const emit = defineEmits<{
  "update:open": [boolean];
  "update:edits": [NativeMetadataBundle];
  reloadFromReference: [];
  resetTemplate: [];
}>();

const dirtyKeys = computed(() =>
  props.spoofOnly
    ? computeSpoofDirtyKeys(props.referenceBundle, props.edits)
    : computeDirtyKeys(props.referenceBundle, props.edits),
);

const editCount = computed(() => dirtyKeys.value.size);

const reloadEnabled = computed(() => props.allowReload !== false);

function toggleOpen() {
  emit("update:open", !props.open);
}
</script>

<template>
  <div v-if="referenceBundle || loading || error" class="source-meta-panel">
    <button
      type="button"
      class="edit-meta-link"
      :disabled="loading"
      :aria-expanded="open"
      @click="toggleOpen"
    >
      {{
        loading
          ? "正在解析…"
          : open
            ? "收起"
            : "编辑元数据"
      }}
      <span v-if="editCount > 0" class="edit-badge">{{ editCount }}</span>
    </button>

    <div v-if="loading" class="meta-loading">
      <span class="spinner" aria-hidden="true" />
      <span>正在读取 EXIF / IPTC…</span>
    </div>

    <div v-else-if="error" class="alert alert-warn meta-error">
      <strong>元数据解析失败</strong>
      <p>{{ error }}</p>
    </div>

    <div v-else-if="open && referenceBundle" class="meta-editor-wrap">
      <p v-if="sourceLabel" class="source-label">{{ sourceLabel }}</p>
      <MetadataEditor
        compact
        :reference-bundle="referenceBundle"
        :edits="edits"
        :dirty-keys="dirtyKeys"
        :allow-reload="reloadEnabled"
        :spoof-only="spoofOnly"
        @update:edits="emit('update:edits', $event)"
        @reload-from-reference="emit('reloadFromReference')"
        @reset-template="emit('resetTemplate')"
      />
    </div>
  </div>
</template>

<style scoped>
.source-meta-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.edit-meta-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: none;
  background: none;
  font-size: 12px;
  color: var(--live);
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.edit-meta-link:hover:not(:disabled) {
  color: #2ec484;
}
.edit-meta-link:disabled {
  opacity: 0.6;
  cursor: wait;
}
.edit-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--live-dim);
  color: var(--live);
  text-decoration: none;
}
.meta-loading {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: var(--text-soft);
  padding: 8px 0;
}
.meta-error p {
  margin: 6px 0 0;
  font-size: 13px;
}
.meta-editor-wrap {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
}
.source-label {
  margin: 0 0 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-faint);
}
</style>
