<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  progress: number
  color: string
  scale: number
  /** 竖条形态：岛贴左右边时进度从底往上长 */
  vertical?: boolean
}>()

const fillSize = computed(() => `${Math.max(0, Math.min(1, props.progress)) * 100}%`)
const thickness = computed(() => `${Math.max(2, 4 * props.scale)}px`)
</script>

<template>
  <div class="dock-strip" :class="{ vertical }" :style="{ '--strip-color': color }">
    <div class="track" :style="vertical ? { width: thickness } : { height: thickness }">
      <div
        class="fill"
        :style="vertical
          ? { height: fillSize, width: thickness, background: color }
          : { width: fillSize, height: thickness, background: color }"
      />
    </div>
  </div>
</template>

<style scoped>
.dock-strip {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.track {
  width: 80%;
  border-radius: 999px;
  background: color-mix(in srgb, var(--strip-color) 38%, transparent);
  overflow: hidden;
  display: flex;
  align-items: stretch;
}

.dock-strip.vertical .track {
  height: 80%;
  flex-direction: column;
  justify-content: flex-end;
}

.fill {
  border-radius: 999px;
  transition: width 0.4s linear, height 0.4s linear, background 0.3s ease;
  min-width: 0;
}
</style>
