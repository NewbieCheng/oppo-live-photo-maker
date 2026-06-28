<script setup lang="ts">
import { computed, ref } from "vue";
import {
  FEATURE_ONE_SPOOF_GROUP_IDS,
  METADATA_FIELD_GROUPS,
  type MetadataFieldDef,
  type NativeMetadataBundle,
} from "../lib/metadata";

const props = defineProps<{
  referenceBundle: NativeMetadataBundle | null;
  edits: NativeMetadataBundle;
  dirtyKeys: Set<string>;
  compact?: boolean;
  allowReload?: boolean;
  spoofOnly?: boolean;
}>();

const emit = defineEmits<{
  "update:edits": [NativeMetadataBundle];
  reloadFromReference: [];
  resetTemplate: [];
}>();

const reloadEnabled = computed(() => props.allowReload !== false);

const activeGroup = ref("camera");
const filter = ref("");

const visibleGroups = computed(() =>
  props.spoofOnly
    ? METADATA_FIELD_GROUPS.filter((g) => FEATURE_ONE_SPOOF_GROUP_IDS.has(g.id))
    : METADATA_FIELD_GROUPS,
);

const currentGroup = computed(() =>
  visibleGroups.value.find((g) => g.id === activeGroup.value),
);

function fieldDirtyKey(f: MetadataFieldDef): string {
  if (f.iptc) return `iptc:${f.key}`;
  if (f.xmp === "gcamera") return `xmp:gcamera:${f.key}`;
  if (f.xmp === "opcamera") return `xmp:opcamera:${f.key}`;
  if (f.xmp === "container") return `xmp:container:${f.key}`;
  if (f.xmp === "hdrgm") return `xmp:hdrgm:${f.key}`;
  return `exif:${f.key}`;
}

function getValue(f: MetadataFieldDef): string {
  if (f.iptc) return props.edits.iptc[f.key] ?? props.referenceBundle?.iptc[f.key] ?? "";
  if (f.xmp === "gcamera") {
    return props.edits.xmp?.gcamera[f.key] ?? props.referenceBundle?.xmp?.gcamera[f.key] ?? "";
  }
  if (f.xmp === "opcamera") {
    return props.edits.xmp?.opcamera[f.key] ?? props.referenceBundle?.xmp?.opcamera[f.key] ?? "";
  }
  if (f.xmp === "container") {
    const k = f.key as "gainMapLength" | "videoLength";
    return props.edits.xmp?.container[k] ?? props.referenceBundle?.xmp?.container[k] ?? "";
  }
  if (f.xmp === "hdrgm") {
    return props.edits.xmp?.hdrgm.version ?? props.referenceBundle?.xmp?.hdrgm.version ?? "";
  }
  return props.edits.exif[f.key] ?? props.referenceBundle?.exif[f.key] ?? "";
}

function isDirty(f: MetadataFieldDef): boolean {
  return props.dirtyKeys.has(fieldDirtyKey(f));
}

function onFieldInput(f: MetadataFieldDef, value: string) {
  const next: NativeMetadataBundle = {
    exif: { ...props.edits.exif },
    iptc: { ...props.edits.iptc },
    xmp: {
      gcamera: { ...props.edits.xmp?.gcamera },
      opcamera: { ...props.edits.xmp?.opcamera },
      container: { ...props.edits.xmp?.container },
      hdrgm: { ...props.edits.xmp?.hdrgm },
      mode: props.edits.xmp?.mode ?? props.referenceBundle?.xmp?.mode ?? "native",
    },
    makerNoteJson: props.edits.makerNoteJson ?? props.referenceBundle?.makerNoteJson,
    presentationTimestampUs: props.edits.presentationTimestampUs,
    presentationTimestampUserSet: props.edits.presentationTimestampUserSet,
  };

  const trimmed = value.trim();
  if (f.iptc) {
    if (trimmed) next.iptc[f.key] = trimmed;
    else delete next.iptc[f.key];
  } else if (f.xmp === "gcamera") {
    if (trimmed) next.xmp!.gcamera[f.key] = trimmed;
    else delete next.xmp!.gcamera[f.key];
  } else if (f.xmp === "opcamera") {
    if (trimmed) next.xmp!.opcamera[f.key] = trimmed;
    else delete next.xmp!.opcamera[f.key];
  } else if (f.xmp === "container") {
    const k = f.key as "gainMapLength" | "videoLength";
    if (trimmed) next.xmp!.container[k] = trimmed;
    else delete next.xmp!.container[k];
  } else if (f.xmp === "hdrgm") {
    if (trimmed) next.xmp!.hdrgm.version = trimmed;
    else delete next.xmp!.hdrgm.version;
  } else {
    if (trimmed) next.exif[f.key] = trimmed;
    else delete next.exif[f.key];
  }
  emit("update:edits", next);
}

const filteredFields = computed(() => {
  const g = currentGroup.value;
  if (!g) return [];
  const q = filter.value.trim().toLowerCase();
  if (!q) return g.fields;
  return g.fields.filter(
    (f) => f.label.toLowerCase().includes(q) || f.key.toLowerCase().includes(q),
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

const xmpMode = computed({
  get(): string {
    return props.edits.xmp?.mode ?? props.referenceBundle?.xmp?.mode ?? "native";
  },
  set(v: string) {
    emit("update:edits", {
      ...props.edits,
      xmp: {
        gcamera: { ...props.edits.xmp?.gcamera },
        opcamera: { ...props.edits.xmp?.opcamera },
        container: { ...props.edits.xmp?.container },
        hdrgm: { ...props.edits.xmp?.hdrgm },
        mode: v === "compat" ? "compat" : "native",
      },
    });
  },
});

const makerNotePreview = computed(
  () => props.edits.makerNoteJson ?? props.referenceBundle?.makerNoteJson ?? "",
);
</script>

<template>
  <section class="meta-step" :class="{ panel: !compact, compact }">
    <div class="head">
      <div v-if="!compact">
        <p class="panel-title">原生数据</p>
        <p class="panel-desc" style="margin-bottom: 0">
          编辑后将写入输出文件。标黄字段表示已修改。MakerNote 仅展示，请用「元数据复制」整包复制。
        </p>
      </div>
      <p v-else class="compact-title">
        {{ spoofOnly ? "伪造参数（EXIF / IPTC）" : "源图元数据字段" }}
      </p>
      <div class="head-actions">
        <button
          v-if="reloadEnabled"
          type="button"
          class="btn"
          :disabled="!referenceBundle"
          @click="emit('reloadFromReference')"
        >
          {{ compact ? "从源图重新加载" : "从参考图加载" }}
        </button>
        <button
          v-else
          type="button"
          class="btn"
          @click="emit('resetTemplate')"
        >
          恢复模板默认
        </button>
      </div>
    </div>

    <input
      v-model="filter"
      type="search"
      class="search-input"
      placeholder="搜索 Make、VideoLength、UserComment…"
    />

    <p v-if="spoofOnly" class="spoof-notice">
      MotionPhoto XMP（Container、时间戳、VideoLength）由视频合成固定生成，此处不可编辑。
    </p>

    <p v-else-if="!referenceBundle" class="empty-hint">
      未上传参考图时，可手动填写；上传后会自动解析填充。
    </p>

    <div class="layout">
      <nav class="groups" aria-label="字段分组">
        <button
          v-for="g in visibleGroups"
          :key="g.id"
          type="button"
          class="group-btn"
          :class="{ active: activeGroup === g.id }"
          @click="activeGroup = g.id"
        >
          {{ g.title }}
        </button>
        <button
          v-if="!spoofOnly || makerNotePreview"
          type="button"
          class="group-btn"
          :class="{ active: activeGroup === 'system' }"
          @click="activeGroup = 'system'"
        >
          系统 / MakerNote
        </button>
      </nav>

      <div class="fields">
        <template v-if="activeGroup !== 'system'">
          <label
            v-for="f in filteredFields"
            :key="f.key"
            class="field"
            :class="{ dirty: isDirty(f) }"
          >
            <span>{{ f.label }}</span>
            <input
              type="text"
              :value="getValue(f)"
              :placeholder="f.placeholder ?? f.key"
              @input="onFieldInput(f, ($event.target as HTMLInputElement).value)"
            />
          </label>
        </template>
        <template v-else>
          <template v-if="!spoofOnly">
            <label class="field">
              <span>XMP 模式</span>
              <select v-model="xmpMode">
                <option value="native">native（OPPO 原片，无 MicroVideo）</option>
                <option value="compat">compat（含 MicroVideo，兼容 output2）</option>
              </select>
            </label>
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
              <span class="unit">微秒 · 同步写入 GCamera 与 OpCamera</span>
            </label>
          </template>
          <div v-if="makerNotePreview" class="field readonly maker-note">
            <span>MakerNote JSON（只读）</span>
            <textarea readonly rows="8" class="mono">{{ makerNotePreview }}</textarea>
          </div>
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
.meta-step.compact {
  gap: 12px;
}
.compact-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-soft);
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  flex-wrap: wrap;
}
.head-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.empty-hint {
  margin: 0;
  font-size: 13px;
  color: var(--text-faint);
}
.spoof-notice {
  margin: 0;
  font-size: 12px;
  color: var(--text-soft);
  line-height: 1.45;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  border: 1px solid var(--border);
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
.maker-note {
  grid-column: 1 / -1;
}
.maker-note textarea {
  width: 100%;
  resize: vertical;
}
.unit {
  font-size: 11px;
  color: var(--text-faint);
}
</style>
