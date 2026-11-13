<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from "vue";
import { useIslandState } from "../composables/useIslandState";
import { useTimer } from "../composables/useTimer";
import { useSettings } from "../composables/useSettings";
import { useDockMode } from "../composables/useDockMode";
import { useIslandBridge } from "../composables/useIslandBridge";
import { useIslandInteraction } from "../composables/useIslandInteraction";
import CapsuleIdle from "./CapsuleIdle.vue";
import DockStrip from "./DockStrip.vue";
import CapsuleFocus from "./CapsuleFocus.vue";
import NotificationBanner from "./NotificationBanner.vue";

const { state, setNotificationVisible } = useIslandState();
const timer = useTimer();
const { settings } = useSettings();
const { dockCollapsed, stripProgress, stripColor, DOCK_STRIP_WINDOW_H } = useDockMode();
const showStrip = dockCollapsed;

// 跨窗口桥接：计时快照、通知、面板动画、本地倒计时
const bridge = useIslandBridge();
const {
    notificationType,
    panelMotionState,
    onNotifConfirm,
    onNotifExtend,
    onNotifDismiss,
    onCapsuleToggle,
    onCapsuleSkip,
} = bridge;

// 窗口交互：悬停、点击穿透、拖动、尺寸与位置
const interaction = useIslandInteraction({ notificationType });
const {
    hoverActive,
    dragging,
    onIslandClick,
    onCapsulePointerDown,
    onCapsulePointerMove,
    onCapsulePointerUp,
    syncClickThrough,
    applyWindowSize,
} = interaction;

// 悬停时才显示快捷按钮；通知横幅出现时先让用户处理通知，避免误触。
const capsuleInteractive = computed(
    () => hoverActive.value && notificationType.value === null,
);

const BASE_WIDTH = 320;
const BASE_HEIGHT = 34;

const capsuleWidth = computed(() => BASE_WIDTH * (settings.value.islandScale ?? 1));
const capsuleHeight = computed(() => BASE_HEIGHT * (settings.value.islandScale ?? 1));
const capsuleRadius = computed(() => capsuleHeight.value / 2);

// 岛贴底边时内容朝屏幕内侧长：通知横幅翻到岛上方，挤压动画原点也翻到底部
const bannerFlipped = computed(() => settings.value.islandEdge === "bottom");

const progressScale = computed(() => {
    if (state.value === "idle" || state.value === "alert") return 0;
    const v = timer.progress.value;
    if (Number.isNaN(v) || v <= 0) return 0;
    if (v >= 1) return 1;
    return v;
});

const ringColor = computed(() => {
    if (timer.phase.value === "focus" && timer.running.value)
        return "var(--focus-color)";
    if (timer.phase.value === "break" && timer.running.value)
        return "var(--break-color)";
    return "rgba(255,255,255,0.45)";
});

watch(notificationType, (val) => {
    setNotificationVisible(val !== null);
    syncClickThrough();
    void applyWindowSize();
});

onMounted(async () => {
    interaction.start();
    await bridge.start();
});

onUnmounted(() => {
    interaction.stop();
    bridge.stop();
});
</script>

<template>
    <div
        class="island-container w-full h-full flex items-start justify-center"
        :class="{ 'flip-inner': bannerFlipped }"
    >
        <div class="island-stack">
            <div
                class="capsule-motion"
                :class="{
                    'panel-launching': panelMotionState === 'opening',
                    'panel-receiving': panelMotionState === 'closing',
                    'animating': panelMotionState !== 'idle',
                }"
            >
                <div
                    class="capsule-shell relative flex items-center justify-center"
                    :class="{
                        'ring-focus':
                            timer.phase.value === 'focus' && timer.running.value,
                        'ring-break':
                            timer.phase.value === 'break' && timer.running.value,
                        'strip-mode': showStrip,
                        interactive: hoverActive,
                        dragging: dragging,
                    }"
                    @click="onIslandClick"
                    @pointerdown="onCapsulePointerDown"
                    @pointermove="onCapsulePointerMove"
                    @pointerup="onCapsulePointerUp"
                    @pointercancel="onCapsulePointerUp"
                    :style="{
                        '--ring-progress': progressScale,
                        '--ring-color': ringColor,
                        '--ring-opacity': timer.running.value ? 1 : 0.35,
                        '--island-scale': settings.islandScale ?? 1,
                        width: capsuleWidth + 'px',
                        height: (showStrip ? DOCK_STRIP_WINDOW_H * (settings.islandScale ?? 1) : capsuleHeight) + 'px',
                        borderRadius: (showStrip ? 4 : capsuleRadius) + 'px',
                    }"
                >
                    <DockStrip
                        v-if="showStrip"
                        :progress="stripProgress"
                        :color="stripColor"
                        :scale="settings.islandScale ?? 1"
                    />
                    <template v-else>
                        <CapsuleIdle
                            v-if="state === 'idle' || state === 'alert'"
                        />
                        <CapsuleFocus
                            v-else-if="state === 'focus' || state === 'break'"
                            :interactive="capsuleInteractive"
                            @toggle="onCapsuleToggle"
                            @skip="onCapsuleSkip"
                        />
                        <svg class="progress-ring" :viewBox="`0 0 ${capsuleWidth} ${capsuleHeight}`" aria-hidden="true">
                            <rect
                                class="ring-track"
                                :x="1.5 * settings.islandScale"
                                :y="1.5 * settings.islandScale"
                                :width="capsuleWidth - 3 * settings.islandScale"
                                :height="capsuleHeight - 3 * settings.islandScale"
                                :rx="capsuleRadius - 1.5 * settings.islandScale"
                                pathLength="1"
                            />
                            <rect
                                class="ring-progress"
                                :x="1.5 * settings.islandScale"
                                :y="1.5 * settings.islandScale"
                                :width="capsuleWidth - 3 * settings.islandScale"
                                :height="capsuleHeight - 3 * settings.islandScale"
                                :rx="capsuleRadius - 1.5 * settings.islandScale"
                                pathLength="1"
                            />
                        </svg>
                    </template>
                </div>
            </div>
            <NotificationBanner
                :type="notificationType"
                :scale="settings.islandScale ?? 1"
                @confirm="onNotifConfirm"
                @extend="onNotifExtend"
                @dismiss="onNotifDismiss"
            />
        </div>
    </div>
</template>

<style scoped>
.island-container {
    /* items-start justify-center to stick to top edge */
}

/* 贴底边时整组内容沉到窗口底部，横幅出现在岛上方 */
.island-container.flip-inner {
    align-items: flex-end;
}

.island-container.flip-inner .island-stack {
    flex-direction: column-reverse;
}

.island-container.flip-inner .capsule-motion {
    transform-origin: center bottom;
}

.island-stack {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
}

.capsule-motion {
    transform-origin: center top;
}

.capsule-motion.animating {
    will-change: transform;
}

.capsule-shell {
    /* 纯黑背景，参考 iPhone 灵动岛：rgba(0,0,0,0.95+) */
    background: rgba(0, 0, 0, var(--island-opacity, 0.95));
    transition: width 0.3s ease, height 0.3s ease, transform 0.18s ease;
    contain: layout style paint;
}

.capsule-shell.interactive {
    cursor: grab;
}

/* 拖拽手感：抓起来轻微放大，松手回弹 */
.capsule-shell.dragging {
    cursor: grabbing;
    transform: scale(1.04);
}

.capsule-shell.strip-mode {
    background: transparent;
}

.capsule-shell::before,
.capsule-shell::after {
    content: "";
    position: absolute;
    pointer-events: none;
}

.capsule-shell::before {
    inset: 1px;
    border-radius: inherit;
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.08), transparent 56%);
    opacity: 0;
    transform: scale(0.88, 0.82);
}

.capsule-shell::after {
    left: 50%;
    top: 56%;
    width: 42%;
    height: 46%;
    border-radius: 999px;
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0));
    opacity: 0;
    transform: translate(-50%, -42%) scale(0.42, 0.16);
}

/* ring-focus/ring-break 不再加 box-shadow，避免胶囊四周出现浅色矩形光晕 */

.panel-launching {
    will-change: transform;
    animation: island-release 280ms cubic-bezier(0.2, 0.88, 0.26, 1) both;
}

.panel-launching .capsule-shell::before {
    animation: island-core-open 280ms cubic-bezier(0.2, 0.88, 0.26, 1) both;
}

.panel-launching .capsule-shell::after {
    animation: island-tail-open 280ms cubic-bezier(0.2, 0.88, 0.26, 1) both;
}

.panel-receiving {
    will-change: transform;
    animation: island-receive 240ms cubic-bezier(0.34, 0, 0.72, 0.2) both;
}

.panel-receiving .capsule-shell::before {
    animation: island-core-close 240ms cubic-bezier(0.34, 0, 0.72, 0.2) both;
}

.panel-receiving .capsule-shell::after {
    animation: island-tail-close 240ms cubic-bezier(0.34, 0, 0.72, 0.2) both;
}

@keyframes island-release {
    0% {
        transform: scale(1, 1);
    }

    38% {
        transform: scale(0.96, 0.9);
    }

    100% {
        transform: scale(1, 1);
    }
}

@keyframes island-receive {
    0% {
        transform: scale(1, 1);
    }

    42% {
        transform: scale(0.93, 0.84);
    }

    100% {
        transform: scale(1, 1);
    }
}

@keyframes island-core-open {
    0% {
        opacity: 0;
        transform: scale(0.86, 0.8);
    }

    52% {
        opacity: 1;
        transform: scale(1.02, 0.96);
    }

    100% {
        opacity: 0;
        transform: scale(1.08, 1.02);
    }
}

@keyframes island-core-close {
    0% {
        opacity: 0;
        transform: scale(1.02, 0.96);
    }

    56% {
        opacity: 1;
        transform: scale(0.94, 0.86);
    }

    100% {
        opacity: 0;
        transform: scale(0.82, 0.74);
    }
}

@keyframes island-tail-open {
    0% {
        opacity: 0;
        transform: translate(-50%, -42%) scale(0.42, 0.16);
    }

    46% {
        opacity: 0.78;
        transform: translate(-50%, -16%) scale(0.8, 0.46);
    }

    100% {
        opacity: 0.96;
        transform: translate(-50%, -2%) scale(0.96, 0.68);
    }
}

@keyframes island-tail-close {
    0% {
        opacity: 1;
        transform: translate(-50%, -2%) scale(0.9, 0.62);
    }

    52% {
        opacity: 0.82;
        transform: translate(-50%, -18%) scale(0.72, 0.34);
    }

    100% {
        opacity: 0;
        transform: translate(-50%, -42%) scale(0.38, 0.14);
    }
}

.progress-ring {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
}

.ring-track,
.ring-progress {
    fill: none;
    stroke-width: 3;
    vector-effect: non-scaling-stroke;
}

.ring-track {
    stroke: rgba(255, 255, 255, 0.08);
}

.ring-progress {
    stroke: var(--ring-color);
    stroke-dasharray: 1;
    stroke-dashoffset: calc(1 - var(--ring-progress));
    stroke-linecap: round;
    opacity: var(--ring-opacity);
    transition:
        stroke-dashoffset 0.4s linear,
        opacity 0.3s ease;
}
</style>
