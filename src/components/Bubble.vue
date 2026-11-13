<script setup lang="ts">
import { onMounted, ref } from "vue";
import type { FloatingBubble } from "../composables/useIslandBubbles";

const props = defineProps<{
    bubble: FloatingBubble;
}>();

defineEmits<{ click: [] }>();

const rootRef = ref<HTMLElement | null>(null);

// 每颗泡泡生成一条自己的轨迹：整体匀速上飘，水平方向分段随机游走，
// 出生时冒出来、临消失前淡出。用 WAAPI 逐段插值，比固定 keyframes 自然。
onMounted(() => {
    const el = rootRef.value;
    if (!el) return;
    const rise = props.bubble.riseTo;
    const segments = 6;
    const frames: Keyframe[] = [
        {
            transform: "translate(0px, 0px) scale(0.45)",
            opacity: 0,
            offset: 0,
            easing: "ease-out",
        },
    ];
    let x = 0;
    for (let i = 1; i <= segments; i++) {
        const last = i === segments;
        const offset = i / segments;
        if (!last) {
            // 每段随机游走一步，起点方向由 swayX 给出偏向
            const bias = i === 1 ? props.bubble.swayX * 0.4 : 0;
            x += bias + (Math.random() * 2 - 1) * 44;
            x = Math.max(-80, Math.min(80, x));
        }
        frames.push({
            transform: `translate(${x.toFixed(1)}px, ${(-rise * offset).toFixed(1)}px) scale(1)`,
            opacity: offset >= 0.92 ? 0 : 0.95,
            offset,
            easing: last ? "ease-in" : "ease-in-out",
        });
    }
    el.animate(frames, {
        duration: props.bubble.driftMs,
        fill: "forwards",
        easing: "linear",
    });
});
</script>

<template>
    <div
        ref="rootRef"
        class="bubble-drift"
        :data-bubble-id="bubble.id"
        :style="{ left: bubble.x + 'px', top: bubble.y + 'px' }"
        @click.stop="$emit('click')"
    >
        <span class="bubble-shine"></span>
        <div class="bubble-inner">{{ bubble.text }}</div>
    </div>
</template>

<style scoped>
.bubble-drift {
    position: absolute;
    /* 语句自适应：单行随内容伸缩，超长才折行 */
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
    will-change: transform, opacity;
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

/* 微微的果冻感呼吸，幅度很小不影响轨迹 */
.bubble-inner {
    animation: bubble-bob 2.6s ease-in-out infinite alternate;
}

@keyframes bubble-bob {
    from {
        transform: translateY(-1px) scale(1, 0.99);
    }

    to {
        transform: translateY(1px) scale(0.995, 1.01);
    }
}
</style>
