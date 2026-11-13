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
            '--sway-a1': bubble.swayA1 + 'px',
            '--sway-a2': bubble.swayA2 + 'px',
            '--phase1': -bubble.phase1 + 'ms',
            '--phase2': -bubble.phase2 + 'ms',
            '--wobble-phase': -bubble.wobblePhase + 'ms',
        }"
        @click.stop="$emit('click')"
    >
        <div class="bubble-sway1">
            <div class="bubble-sway2">
                <div class="bubble-float">
                    <span class="bubble-shine"></span>
                    <div class="bubble-inner">{{ bubble.text }}</div>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
/* 轨迹 = 匀速上飘 ⊕ 两个非整数频率比的正弦横摆 ⊕ 轻微旋转晃动。
   每层各自平滑、相位随机，叠加出来是一条处处连续、永不重复的利萨如路线。 */
.bubble-drift {
    position: absolute;
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

/* 主摆：整个漂移期一个周期 */
.bubble-sway1 {
    animation: bubble-sway var(--drift-ms) ease-in-out infinite;
    animation-delay: var(--phase1);
    will-change: transform;
}

/* 次摆：频率是非整数比（×0.37），叠加出永不循环的 wandering */
.bubble-sway2 {
    animation: bubble-sway calc(var(--drift-ms) * 0.37) ease-in-out infinite;
    animation-delay: var(--phase2);
    will-change: transform;
}

@keyframes bubble-sway {
    0% {
        transform: translateX(0);
    }

    12.5% {
        transform: translateX(var(--amp, var(--sway-a1)));
    }

    25% {
        transform: translateX(0);
    }

    37.5% {
        transform: translateX(calc(var(--amp, var(--sway-a1)) * -1));
    }

    50% {
        transform: translateX(0);
    }

    62.5% {
        transform: translateX(var(--amp, var(--sway-a1)));
    }

    75% {
        transform: translateX(0);
    }

    87.5% {
        transform: translateX(calc(var(--amp, var(--sway-a1)) * -1));
    }

    100% {
        transform: translateX(0);
    }
}

.bubble-sway1 .bubble-sway2 {
    --amp: var(--sway-a2);
}

/* 轻微的旋转+上下晃动：真泡泡在空气里会这样颤 */
.bubble-float {
    position: relative;
    animation: bubble-wobble 2.7s ease-in-out infinite alternate;
    animation-delay: var(--wobble-phase);
}

@keyframes bubble-wobble {
    from {
        transform: translateY(-3px) rotate(-1.6deg);
    }

    to {
        transform: translateY(3px) rotate(1.6deg);
    }
}

.bubble-float {
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

.bubble-inner {
    position: relative;
}
</style>
