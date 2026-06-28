<script setup lang="ts">
import type { MetadataSourceMode } from "../lib/metadata/metadataTemplate";

defineProps<{
  mode: MetadataSourceMode;
}>();

const emit = defineEmits<{
  "update:mode": [MetadataSourceMode];
}>();

const options: { value: MetadataSourceMode; title: string; hint: string }[] = [
  {
    value: "none",
    title: "默认",
    hint: "仅合成视频 MotionPhoto XMP，不叠加机型 EXIF",
  },
  {
    value: "reference",
    title: "从机内原图提取",
    hint: "先合成 MotionPhoto XMP，再叠加参考图 EXIF / IPTC / MakerNote",
  },
  {
    value: "template",
    title: "Find X8 Ultra 模板",
    hint: "先合成 MotionPhoto XMP，再叠加模板 EXIF 参数（可编辑）",
  },
];
</script>

<template>
  <section class="panel meta-source-step">
    <p class="panel-title">元数据（可选）</p>
    <p class="panel-desc">
      不影响视频抽帧与 MP4 合成。<strong>MotionPhoto XMP</strong>（Container、时间戳、VideoLength
      等）始终由视频转换自动生成，不可编辑。参考图 / 模板仅在 XMP 合成<strong>之后</strong>叠加
      EXIF / IPTC 等伪造参数。
    </p>

    <fieldset class="source-modes">
      <legend class="sr-only">元数据来源</legend>
      <label
        v-for="opt in options"
        :key="opt.value"
        class="mode-option"
        :class="{ selected: mode === opt.value }"
      >
        <input
          type="radio"
          name="metadataSource"
          :value="opt.value"
          :checked="mode === opt.value"
          @change="emit('update:mode', opt.value)"
        />
        <span class="mode-copy">
          <strong>{{ opt.title }}</strong>
          <small>{{ opt.hint }}</small>
        </span>
      </label>
    </fieldset>
  </section>
</template>

<style scoped>
.meta-source-step {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.source-modes {
  border: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 10px;
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
  line-height: 1.4;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
}
</style>
