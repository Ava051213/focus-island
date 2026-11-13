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
            '--rise-to': -bubble.riseTo + 'px',
            '--drift-ms': bubble.driftMs + 'ms',
            '--arc-x': bubble.arcX + 'px',
        }"
        @click.stop="$emit('click')"
    >
        <div class="bubble-arc">
            <div class="bubble-float">
                <span class="bubble-shine"></span>
                <div class="bubble-inner">{{ bubble.text }}</div>
            </div>
        </div>
    </div>
</template>

<style scoped>
/* 运动只有两笔：匀速直线上升 + 一条缓慢的弧形偏移。
   没有转折、没有旋转、没有颤动——气泡是刚体，轻盈 = 干净利落。 */
.bubble-drift {
    position: absolute;
    animation: bubble-rise var(--drift-ms) linear forwards;
    will-change: transform, opacity;
}

@keyframes bubble-rise {
    0% {
        opacity: 0;
        transform: translateY(0) scale(0.88);
    }

    8% {
        opacity: 0.97;
    }

    84% {
        opacity: 0.97;
    }

    100% {
        opacity: 0;
        transform: translateY(var(--rise-to)) scale(1);
    }
}

.bubble-arc {
    animation: bubble-arc var(--drift-ms) ease-in-out forwards;
    will-change: transform;
}

/* 一整段弧：只朝一个方向缓慢偏移，中段最快、两端最慢 */
@keyframes bubble-arc {
    from {
        transform: translateX(0);
    }

    to {
        transform: translateX(var(--arc-x));
    }
}

.bubble-float {
    position: relative;
    max-width: 420px;
    white-space: nowrap;
    padding: 7px 16px;
    border-radius: 999px;
    background: linear-gradient(
        135deg,
        rgba(255, 255, 255, 0.38),
        rgba(255, 255, 255, 0.16) 55%,
        rgba(186, 214, 255, 0.26)
    );
    backdrop-filter: blur(10px) saturate(1.15);
    border: 1px solid rgba(255, 255, 255, 0.62);
    box-shadow:
        inset 0 1px 5px rgba(255, 255, 255, 0.55),
        0 6px 20px rgba(96, 136, 200, 0.18);
    color: #2c3a55;
    font-size: 13px;
    line-height: 1.4;
    text-align: center;
    text-shadow: 0 1px 0 rgba(255, 255, 255, 0.4);
    cursor: pointer;
    user-select: none;
    pointer-events: auto;
}

/* 肥皂泡的高光点 */
.bubble-shine {
    position: absolute;
    top: 4px;
    left: 12px;
    width: 16px;
    height: 9px;
    border-radius: 50%;
    background: radial-gradient(rgba(255, 255, 255, 0.95), rgba(255, 255, 255, 0));
    transform: rotate(-24deg);
    pointer-events: none;
}
</style>
