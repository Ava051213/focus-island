<script setup lang="ts">
import type { IslandBubble } from "../composables/useIslandBubbles";

defineProps<{
    bubble: IslandBubble;
    /** 岛贴底边时泡泡在岛上方，冒出方向要跟着翻 */
    flipped: boolean;
}>();

defineEmits<{ click: [] }>();
</script>

<template>
    <Transition name="bubble">
        <div
            v-if="bubble"
            :key="bubble.id"
            class="bubble"
            :class="{ flipped }"
            @click.stop="$emit('click')"
        >
            <div class="bubble-inner">{{ bubble.text }}</div>
        </div>
    </Transition>
</template>

<style scoped>
.bubble {
    max-width: 240px;
    padding: 8px 14px;
    border-radius: 16px;
    background: rgba(22, 22, 26, 0.85);
    border: 1px solid rgba(255, 255, 255, 0.14);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3);
    color: rgba(255, 255, 255, 0.92);
    font-size: 12px;
    line-height: 1.4;
    text-align: center;
    cursor: pointer;
    user-select: none;
    pointer-events: auto;
    /* 默认在岛下方：从靠近岛的上边缘冒出来 */
    transform-origin: 50% 0;
}

.bubble.flipped {
    transform-origin: 50% 100%;
}

/* 漂浮摆在内层做，和外层的进出场 transition 不打架 */
.bubble-inner {
    animation: bubble-float 2.2s ease-in-out infinite alternate;
}

@keyframes bubble-float {
    from {
        transform: translateY(-2px) rotate(-0.5deg);
    }

    to {
        transform: translateY(3px) rotate(0.5deg);
    }
}

/* 冒出：从岛边挤出来，带一点弹性过冲 */
.bubble-enter-active {
    transition: opacity 0.22s ease-out, transform 0.26s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.bubble-enter-from {
    opacity: 0;
    transform: scale(0.4);
}

/* 破裂：轻轻胀一下再散掉 */
.bubble-leave-active {
    transition: opacity 0.24s ease-in, transform 0.24s ease-in;
}

.bubble-leave-to {
    opacity: 0;
    transform: scale(1.14);
}
</style>
