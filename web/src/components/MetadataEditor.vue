<script setup lang="ts">
import { computed, ref } from "vue";
import {
  METADATA_FIELD_GROUPS,
  OPPO_SYSTEM_FIELDS,
  type NativeMetadataBundle,
} from "../lib/metadata";

const props = defineProps<{
  referenceBundle: NativeMetadataBundle | null;
  edits: NativeMetadataBundle;
  dirtyKeys: Set<string>;
}>();

const emit = defineEmits<{
  "update:edits": [NativeMetadataBundle];
  reloadFromReference: [];
}>();

const activeGroup = ref("camera");
const filter = ref("");

const currentGroup = computed(() =>
  METADATA_FIELD_GROUPS.find((g) => g.id === activeGroup.value),
);

function fieldKey(key: string, iptc?: boolean): string {
  return iptc ? `iptc:${key}` : `exif:${key}`;
}

function getValue(key: string, iptc?: boolean): string {
  if (iptc) return props.edits.iptc[key] ?? props.referenceBundle?.iptc[key] ?? "";
  return props.edits.exif[key] ?? props.referenceBundle?.exif[key] ?? "";
}

function isDirty(key: string, iptc?: boolean): boolean {
  return props.dirtyKeys.has(fieldKey(key, iptc));
}

function onFieldInput(key: string, value: string, iptc?: boolean) {
  const next: NativeMetadataBundle = {
    exif: { ...props.edits.exif },
    iptc: { ...props.edits.iptc },
    presentationTimestampUs: props.edits.presentationTimestampUs,
    presentationTimestampUserSet: props.edits.presentationTimestampUserSet,
  };
  const bucket = iptc ? next.iptc : next.exif;
  if (value.trim()) bucket[key] = value.trim();
  else delete bucket[key];
  emit("update:edits", next);
}

const filteredFields = computed(() => {
  const g = currentGroup.value;
  if (!g) return [];
  const q = filter.value.trim().toLowerCase();
  if (!q) return g.fields;
  return g.fields.filter(
    (f) =>
      f.label.toLowerCase().includes(q) || f.key.toLowerCase().includes(q),
  );
});

const presentationUs = computed({
  get(): string | number {
    const v =
      props.edits.presentationTimestampUs ??
      props.referenceBundle?.presentationTimestampUs;
    return v ?? "";
  },
  set(v: string | number) {
    const n = typeof v === "string" ? parseInt(v, 10) : v;
    emit("update:edits", {
      ...props.edits,
      presentationTimestampUs: Number.isFinite(n) ? n : undefined,
      presentationTimestampUserSet: true,
    });
  },
});
</script>

<template>
  <section class="panel meta-step">
    <div class="head">
      <div>
        <p class="panel-title">原生数据</p>
        <p class="panel-desc" style="margin-bottom: 0">
          编辑后将写入输出 JPEG。标黄字段表示已修改。
        </p>
      </div>
      <button
        type="button"
        class="btn"
        :disabled="!referenceBundle"
        @click="emit('reloadFromReference')"
      >
        从参考图加载
      </button>
    </div>

    <input
      v-model="filter"
      type="search"
      class="search-input"
      placeholder="搜索 Make、GPS、DateTime…"
    />

    <p v-if="!referenceBundle" class="empty-hint">
      未上传参考图时，可手动填写；上传后会自动解析填充。
    </p>

    <div class="layout">
      <nav class="groups" aria-label="字段分组">
        <button
          v-for="g in METADATA_FIELD_GROUPS"
          :key="g.id"
          type="button"
          class="group-btn"
          :class="{ active: activeGroup === g.id }"
          @click="activeGroup = g.id"
        >
          {{ g.title }}
        </button>
        <button
          type="button"
          class="group-btn"
          :class="{ active: activeGroup === 'system' }"
          @click="activeGroup = 'system'"
        >
          OPPO 系统
        </button>
      </nav>

      <div class="fields">
        <template v-if="activeGroup !== 'system'">
          <label
            v-for="f in filteredFields"
            :key="f.key"
            class="field"
            :class="{ dirty: isDirty(f.key, activeGroup === 'iptc') }"
          >
            <span>{{ f.label }}</span>
            <input
              type="text"
              :value="getValue(f.key, activeGroup === 'iptc')"
              :placeholder="f.placeholder ?? f.key"
              @input="
                onFieldInput(
                  f.key,
                  ($event.target as HTMLInputElement).value,
                  activeGroup === 'iptc',
                )
              "
            />
          </label>
        </template>
        <template v-else>
          <div v-for="s in OPPO_SYSTEM_FIELDS" :key="s.key" class="field readonly">
            <span>{{ s.label }}</span>
            <input type="text" :value="s.value" readonly />
          </div>
          <label class="field">
            <span>PresentationTimestampUs</span>
            <input
              type="number"
              min="0"
              class="mono"
              :value="presentationUs"
              placeholder="自动计算"
              @input="presentationUs = ($event.target as HTMLInputElement).value"
            />
            <span class="unit">微秒 · 封面在片段内的偏移</span>
          </label>
        </template>
      </div>
    </div>
  </section>
</template>

<style scoped>
.meta-step {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  flex-wrap: wrap;
}
.empty-hint {
  margin: 0;
  font-size: 13px;
  color: var(--text-faint);
}
.layout {
  display: grid;
  grid-template-columns: 132px 1fr;
  gap: 20px;
  align-items: start;
}
@media (max-width: 640px) {
  .layout {
    grid-template-columns: 1fr;
  }
  .groups {
    flex-direction: row !important;
    flex-wrap: wrap;
  }
}
.groups {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.group-btn {
  text-align: left;
  padding: 8px 12px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-soft);
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: background var(--transition), color var(--transition);
}
.group-btn:hover {
  background: var(--bg-hover);
}
.group-btn.active {
  background: var(--live-dim);
  color: var(--live);
  font-weight: 600;
}
.fields {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
}
.mono {
  font-family: var(--font-mono);
  font-size: 13px;
}
</style>
