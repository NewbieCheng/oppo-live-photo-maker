<script setup lang="ts">
defineProps<{
  current: number;
  labels: string[];
}>();
</script>

<template>
  <nav class="step-track" aria-label="制作步骤">
    <template v-for="(label, i) in labels" :key="label">
      <button
        type="button"
        class="step-node"
        :class="{
          active: i + 1 === current,
          done: i + 1 < current,
        }"
        :aria-current="i + 1 === current ? 'step' : undefined"
        disabled
      >
        <span class="step-dot" aria-hidden="true" />
        <span class="step-name">{{ label }}</span>
      </button>
      <span v-if="i < labels.length - 1" class="step-connector" aria-hidden="true" />
    </template>
  </nav>
</template>

<style scoped>
.step-track {
  display: flex;
  align-items: center;
  gap: 0;
  margin-bottom: 24px;
  padding: 4px 0;
  overflow-x: auto;
}
.step-node {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  min-width: 72px;
  padding: 8px 12px;
  border: none;
  background: transparent;
  cursor: default;
  flex-shrink: 0;
}
.step-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--bg-input);
  border: 2px solid var(--border-strong);
  transition: all var(--transition);
}
.step-name {
  font-size: 12px;
  color: var(--text-faint);
  white-space: nowrap;
  transition: color var(--transition);
}
.step-node.active .step-dot {
  background: var(--live);
  border-color: var(--live);
  box-shadow: 0 0 12px var(--live-glow);
  transform: scale(1.2);
}
.step-node.active .step-name {
  color: var(--live);
  font-weight: 600;
}
.step-node.done .step-dot {
  background: var(--live-dim);
  border-color: var(--live);
}
.step-node.done .step-name {
  color: var(--text-soft);
}
.step-connector {
  flex: 1;
  min-width: 24px;
  height: 2px;
  background: var(--border);
  margin-bottom: 22px;
}
</style>
