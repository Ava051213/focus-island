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
            '--sway-a': bubble.swayAmp + 'px',
            '--sway-delay': -bubble.swayPhase + 'ms',
        }"
        @click.stop="$emit('click')"
    >
        <div class="bubble-sway">
            <div class="bubble-float">
                <span class="bubble-shine"></span>
                <div class="bubble-inner">{{ bubble.text }}</div>
            </div>
        </div>
    </div>
</template>

<style scoped>
/* 三层各管一个运动，叠加起来才是连续轻盈的轨迹：
   外层匀速上飘（浮力恒定），中层正弦横摆（只在端点转向），内层微呼吸 */
.bubble-drift {
    position: absolute;
    /* 语句自适应：单行随内容伸缩，超长才折行 */
    max-width: 420px;
    white-space: nowrap;
    animation: bubble-rise var(--drift-ms) linear forwards;
    will-change: transform, opacity;
}

@keyframes bubble-rise {
    0% {
        opacity: 0;
        transform: translateY(0) scale(0.7);
    }

    9% {
        opacity: 0.96;
        transform: translateY(-14px) scale(1);
    }

    86% {
        opacity: 0.96;
    }

    100% {
        opacity: 0;
        transform: translateY(var(--rise-to)) scale(1);
    }
}

.bubble-sway {
    animation: bubble-sway var(--drift-ms) ease-in-out infinite;
    animation-delay: var(--sway-delay);
    will-change: transform;
}

/* 正弦式横摆：端点转向、中段最快，连续无停顿 */
@keyframes bubble-sway {
    0% {
        transform: translateX(0);
    }

    12.5% {
        transform: translateX(var(--sway-a));
    }

    25% {
        transform: translateX(0);
    }

    37.5% {
        transform: translateX(calc(var(--sway-a) * -1));
    }

    50% {
        transform: translateX(0);
    }

    62.5% {
        transform: translateX(var(--sway-a));
    }

    75% {
        transform: translateX(0);
    }

    87.5% {
        transform: translateX(calc(var(--sway-a) * -1));
    }

    100% {
        transform: translateX(0);
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
    animation: bubble-bob 2.6s ease-in-out infinite alternate;
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

/* 微微的呼吸，幅度很小 */
@keyframes bubble-bob {
    from {
        transform: translateY(-1px) scale(1, 0.99);
    }

    to {
        transform: translateY(1px) scale(0.995, 1.01);
    }
}
</style>
