<script setup lang="ts">
import type { FloatingBubble } from "../composables/useIslandBubbles";

defineProps<{
    bubble: FloatingBubble;
}>();

defineEmits<{ click: [] }>();
</script>

<template>
    <div
        class="bubble-drift"
        :data-bubble-id="bubble.id"
        :style="{
            left: bubble.x + 'px',
            top: bubble.y + 'px',
            '--drift-ms': bubble.driftMs + 'ms',
            '--sway-x': bubble.swayX + 'px',
            '--rise-to': -bubble.riseTo + 'px',
        }"
        @click.stop="$emit('click')"
    >
        <div class="bubble-inner">{{ bubble.text }}</div>
    </div>
</template>

<style scoped>
.bubble-drift {
    position: absolute;
    max-width: 240px;
    padding: 8px 14px;
    border-radius: 16px;
    background: rgba(240, 244, 255, 0.82);
    border: 1px solid rgba(255, 255, 255, 0.6);
    box-shadow: 0 4px 18px rgba(80, 120, 200, 0.22);
    color: rgba(30, 34, 44, 0.9);
    font-size: 12px;
    line-height: 1.4;
    text-align: center;
    cursor: pointer;
    user-select: none;
    pointer-events: auto;
    will-change: transform, opacity;
    animation: bubble-drift var(--drift-ms) linear forwards;
}

/* 外层负责整体上飘与淡出；内层负责左右轻摆 */
@keyframes bubble-drift {
    0% {
        opacity: 0;
        transform: translate(0, 0) scale(0.5);
    }

    10% {
        opacity: 0.96;
        transform: translate(calc(var(--sway-x) * 0.15), -26px) scale(1);
    }

    82% {
        opacity: 0.92;
    }

    100% {
        opacity: 0;
        transform: translate(var(--sway-x), var(--rise-to)) scale(1);
    }
}

.bubble-inner {
    animation: bubble-sway 3.2s ease-in-out infinite alternate;
}

@keyframes bubble-sway {
    from {
        transform: translateX(-9px) rotate(-1deg);
    }

    to {
        transform: translateX(9px) rotate(1deg);
    }
}
</style>
