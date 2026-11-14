<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { useBubbleRenderer } from "./renderer";
import Bubble from "./Bubble.vue";

// 泡泡 overlay：铺满岛所在屏的工作区，默认整面穿透，只有泡泡本体可点；
// 决策在 main 的 spawner，这里只接收并渲染，用完即毁
const { bubbles, start, stop, onBubbleClick } = useBubbleRenderer();

onMounted(async () => {
    await start();
});

onUnmounted(() => {
    stop();
});
</script>

<template>
    <div class="bubble-layer">
        <Bubble
            v-for="b in bubbles"
            :key="b.id"
            :bubble="b"
            @click="onBubbleClick"
        />
    </div>
</template>

<style scoped>
.bubble-layer {
    position: fixed;
    inset: 0;
    pointer-events: none;
}
</style>
