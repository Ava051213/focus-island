<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { emit, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { availableMonitors, getCurrentWindow, PhysicalPosition } from "@tauri-apps/api/window";
import { useIslandState } from "../composables/useIslandState";
import { useTimer, type NotificationType } from "../composables/useTimer";
import { useSettings } from "../composables/useSettings";
import { useDockMode } from "../composables/useDockMode";
import CapsuleIdle from "./CapsuleIdle.vue";
import DockStrip from "./DockStrip.vue";
import CapsuleFocus from "./CapsuleFocus.vue";
import NotificationBanner from "./NotificationBanner.vue";
import type { TimerStatePayload } from "../composables/useTimerBridge";

const { state, setState, setNotificationVisible } = useIslandState();
const timer = useTimer();
const { settings, settingsReady } = useSettings();
const { dockCollapsed, stripProgress, stripColor, DOCK_STRIP_WINDOW_H, updatePointerOver } = useDockMode();
const showStrip = computed(() => dockCollapsed.value);

let unlisten: (() => void) | null = null;
let unlistenPanelMotion: (() => void) | null = null;
let unlistenNotification: (() => void) | null = null;

const notificationType = ref<NotificationType>(null);
const hoverActive = ref(false);
// 悬停时才显示快捷按钮；通知横幅出现时先让用户处理通知，避免误触。
const capsuleInteractive = computed(
    () => hoverActive.value && notificationType.value === null,
);
let hoverTimer: ReturnType<typeof setInterval> | null = null;
let fullscreenTimer: ReturnType<typeof setInterval> | null = null;

// 前台全屏（游戏、视频、演示）时把岛让开；通知出现时临时冒出来。
const fullscreenActive = ref(false);
const islandHiddenByFullscreen = ref(false);

async function applyFullscreenVisibility() {
    const shouldHide = fullscreenActive.value && notificationType.value === null;
    if (shouldHide === islandHiddenByFullscreen.value) return;
    islandHiddenByFullscreen.value = shouldHide;
    try {
        await invoke("set_island_visible", { visible: !shouldHide });
    } catch {
        // 命令不可用时忽略
    }
}

function startFullscreenPolling() {
    if (fullscreenTimer !== null) return;
    fullscreenTimer = window.setInterval(async () => {
        if (!settings.value.hideOnFullscreen) {
            if (fullscreenActive.value) {
                fullscreenActive.value = false;
                applyFullscreenVisibility();
            }
            return;
        }
        try {
            const full = await invoke<boolean>("is_foreground_fullscreen");
            if (full === fullscreenActive.value) return;
            fullscreenActive.value = full;
            if (full) {
                // 面板也一起收起，别挡着全屏内容
                try {
                    if (await invoke<boolean>("is_panel_visible")) {
                        await invoke("hide_panel");
                    }
                } catch {
                    // 忽略
                }
            }
            applyFullscreenVisibility();
        } catch {
            // 不支持检测的平台直接忽略
        }
    }, 1000);
}

// 通知横幅可见，或鼠标正悬停在岛上时，关闭鼠标穿透以便接收点击。
function syncClickThrough() {
    const interactive = notificationType.value !== null || hoverActive.value;
    invoke("set_click_through", { ignore: !interactive });
}

// 穿透状态下 webview 收不到 mousemove，只能轮询系统光标位置来判断悬停。
// 停靠模式的展开/收起也复用这一次结果，避免两套轮询同时跑。
function startHoverPolling() {
    if (hoverTimer !== null) return;
    hoverTimer = window.setInterval(async () => {
        if (notificationType.value !== null) return;
        // 拖动中保持可交互，否则指针短暂离开窗口会重新开启穿透并打断拖动
        if (dragging.value) return;
        try {
            const over = await invoke<boolean>("is_mouse_over_window", { pad: 2 });
            updatePointerOver(over);
            if (over !== hoverActive.value) {
                hoverActive.value = over;
                syncClickThrough();
            }
        } catch {
            // 命令不可用时忽略
        }
    }, 200);
}

async function onIslandClick() {
    if (dragMoved) {
        dragMoved = false;
        return;
    }
    try {
        await invoke("toggle_panel");
    } catch {
        // 忽略
    }
}

// 胶囊上的暂停/跳过按钮只发指令，真正的计时逻辑在 panel 窗口。
function onCapsuleToggle() {
    emit("timer-command", "toggle").catch(() => {});
}

function onCapsuleSkip() {
    emit("timer-command", "skip").catch(() => {});
}

// ===== 顶部水平拖动 =====
const islandWindow = getCurrentWindow();
const dragging = ref(false);
let dragPointerId: number | null = null;
let dragStartScreenX = 0;
let dragStartWindowX = 0;
let dragMoved = false;

interface ScreenRect {
    left: number;
    top: number;
    width: number;
}

let screens: ScreenRect[] = [];
let virtualLeft = 0;
let virtualRight = 0;
let monitorTop = 0;
let windowWidth = 0;
let currentWindowX = 0;

/** 按窗口中心的横坐标找屏幕；落在缝隙里就取最近的一块 */
function screenForX(centerX: number): ScreenRect | null {
    if (screens.length === 0) return null;
    const hit = screens.find(s => centerX >= s.left && centerX <= s.left + s.width);
    if (hit) return hit;
    let nearest = screens[0];
    for (const s of screens) {
        const d = Math.abs(s.left + s.width / 2 - centerX);
        const best = Math.abs(nearest.left + nearest.width / 2 - centerX);
        if (d < best) nearest = s;
    }
    return nearest;
}

async function refreshIslandGeometry() {
    try {
        const list = await availableMonitors();
        screens = list.map(m => ({
            left: m.position.x,
            top: m.position.y,
            width: m.size.width,
        }));
        if (screens.length > 0) {
            virtualLeft = Math.min(...screens.map(s => s.left));
            virtualRight = Math.max(...screens.map(s => s.left + s.width));
        }
        const size = await islandWindow.outerSize();
        const pos = await islandWindow.outerPosition();
        windowWidth = size.width;
        currentWindowX = pos.x;
        const screen = screenForX(pos.x + windowWidth / 2);
        if (screen) monitorTop = screen.top;
    } catch {
        // 平台不支持时保持旧值
    }
}

// 尺寸变化后（Rust 会按当前屏幕水平居中）按保存的比例贴回原来的位置。
async function restoreIslandX() {
    await refreshIslandGeometry();
    const ratio = settings.value.islandXRatio;
    if (ratio === null || screens.length === 0) return;
    const screen = screenForX(currentWindowX + windowWidth / 2);
    if (!screen) return;
    const maxX = screen.width - windowWidth;
    if (maxX <= 0) return;
    const x = Math.round(screen.left + ratio * maxX);
    try {
        await islandWindow.setPosition(new PhysicalPosition(x, screen.top));
        currentWindowX = x;
        monitorTop = screen.top;
    } catch {
        // 忽略
    }
}

// 拖动范围放宽到整个虚拟桌面，胶囊可以跨到副屏
function clampIslandX(x: number) {
    const maxX = virtualRight - virtualLeft - windowWidth;
    if (maxX <= 0) return virtualLeft;
    return Math.round(Math.min(Math.max(x, virtualLeft), virtualLeft + maxX));
}

function onCapsulePointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const el = e.currentTarget as HTMLElement | null;
    try {
        el?.setPointerCapture(e.pointerId);
    } catch {
        // 忽略
    }
    dragPointerId = e.pointerId;
    dragStartScreenX = e.screenX;
    dragStartWindowX = currentWindowX;
    dragMoved = false;
}

function onCapsulePointerMove(e: PointerEvent) {
    if (dragPointerId !== e.pointerId) return;
    const dxCss = e.screenX - dragStartScreenX;
    // 小于阈值视为点击，避免手抖把单击变成微移
    if (!dragMoved && Math.abs(dxCss) < 4) return;
    dragMoved = true;
    dragging.value = true;
    const dpr = window.devicePixelRatio || 1;
    const x = clampIslandX(dragStartWindowX + dxCss * dpr);
    // 跨到另一块屏时，纵向跟着那块屏的顶边，别停在半空
    const screen = screenForX(x + windowWidth / 2);
    if (screen) monitorTop = screen.top;
    currentWindowX = x;
    islandWindow.setPosition(new PhysicalPosition(x, monitorTop)).catch(() => {});
}

async function onCapsulePointerUp(e: PointerEvent) {
    if (dragPointerId !== e.pointerId) return;
    const el = e.currentTarget as HTMLElement | null;
    try {
        el?.releasePointerCapture(e.pointerId);
    } catch {
        // 忽略
    }
    dragPointerId = null;
    if (!dragging.value) return;
    dragging.value = false;
    await refreshIslandGeometry();
    const screen = screenForX(currentWindowX + windowWidth / 2);
    const maxX = screen ? screen.width - windowWidth : 0;
    if (screen && maxX > 0) {
        settings.value.islandXRatio = Math.min(
            Math.max((currentWindowX - screen.left) / maxX, 0),
            1,
        );
    }
}

// Compute and apply the main window size based on notification / dock / capsule state.
async function applyWindowSize() {
    const scale = settings.value.islandScale ?? 1;
    if (notificationType.value !== null) {
        // Expand window to fit capsule + gap + notification banner
        const width = 360 * scale;
        const height = (BASE_HEIGHT + 6 + 60) * scale;
        await invoke("set_island_custom_size", { width, height });
    } else if (showStrip.value) {
        // Docked thin strip at the top edge
        await invoke("set_island_custom_size", {
            width: 360 * scale,
            height: DOCK_STRIP_WINDOW_H * scale,
        });
    } else {
        // Normal capsule size
        await invoke("set_island_size", { scale });
    }
    await restoreIslandX();
}

// Watch notification visibility and toggle click-through + resize window
watch(notificationType, (val) => {
    setNotificationVisible(val !== null);
    syncClickThrough();
    applyWindowSize();
    // 全屏把岛藏起来时，通知照常浮出来；处理完再藏回去
    applyFullscreenVisibility();
});

// Resize when dock strip state or island scale changes
watch([showStrip, () => settings.value.islandScale], applyWindowSize);

// 设置加载完成后按保存的水平位置贴回（启动时可能先按默认居中）
watch(settingsReady, (ready) => {
    if (ready) applyWindowSize();
});

function playNotificationSound() {
    if (!settings.value.notificationSound) return;
    try {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "sine";
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.08);
        osc.frequency.setValueAtTime(880, ctx.currentTime + 0.16);
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.35);
    } catch {
        // Audio not available
    }
}

function onNotifConfirm() {
    notificationType.value = null;
    emit("notification-action", "confirm");
}

function onNotifExtend() {
    notificationType.value = null;
    emit("notification-action", "extend");
}

function onNotifDismiss() {
    notificationType.value = null;
    emit("notification-action", "dismiss");
}

let panelMotionTimer: number | null = null;
let countdownTimer: number | null = null;
let countdownEndAt = 0;

const BASE_WIDTH = 320;
const BASE_HEIGHT = 34;
const panelMotionState = ref<"idle" | "opening" | "closing">("idle");

const capsuleWidth = computed(() => BASE_WIDTH * (settings.value.islandScale ?? 1));
const capsuleHeight = computed(() => BASE_HEIGHT * (settings.value.islandScale ?? 1));
const capsuleRadius = computed(() => capsuleHeight.value / 2);

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

function runPanelMotion(phase: "open" | "close") {
    if (panelMotionTimer) {
        window.clearTimeout(panelMotionTimer);
    }
    panelMotionState.value = phase === "open" ? "opening" : "closing";
    panelMotionTimer = window.setTimeout(() => {
        panelMotionState.value = "idle";
        panelMotionTimer = null;
    }, phase === "open" ? 280 : 240);
}

function stopLocalCountdown() {
    if (countdownTimer !== null) {
        window.clearInterval(countdownTimer);
        countdownTimer = null;
    }
}

function syncRemainingFromEndAt() {
    if (countdownEndAt <= 0) return;
    const msLeft = countdownEndAt - Date.now();
    timer.remaining.value = Math.max(0, Math.ceil(msLeft / 1000));
}

function startLocalCountdown(endAt: number) {
    countdownEndAt = endAt;
    syncRemainingFromEndAt();
    if (countdownTimer !== null) return;
    countdownTimer = window.setInterval(syncRemainingFromEndAt, 1000);
}

onMounted(async () => {
    syncClickThrough();
    startHoverPolling();
    startFullscreenPolling();

    // 初始化时应用窗口尺寸（胶囊 / 停靠细条 / 通知）
    applyWindowSize();

    unlisten = await listen<TimerStatePayload>(
        "timer-state-update",
        ({ payload }) => {
            timer.totalDuration.value = payload.totalDuration;
            timer.running.value = payload.running;
            timer.activeTaskId.value = payload.activeTaskId;
            timer.activeTaskTitle.value = payload.activeTaskTitle ?? null;
            if (payload.phase !== timer.phase.value) {
                timer.phase.value = payload.phase;
            }
            if (payload.running) {
                startLocalCountdown(payload.syncedAt + payload.remaining * 1000);
            } else {
                stopLocalCountdown();
                countdownEndAt = 0;
                timer.remaining.value = payload.remaining;
            }

            if (payload.running && payload.phase === "focus") {
                setState("focus");
            } else if (payload.running && payload.phase === "break") {
                setState("break");
            } else if (
                !payload.running &&
                !payload.activeTaskId &&
                state.value !== "idle" &&
                state.value !== "alert"
            ) {
                setState("idle");
            }
        },
    );

    // 拉取 panel 当前计时快照，避免窗口晚启动时错过状态。
    emit("timer-state-request").catch(() => {});

    unlistenPanelMotion = await listen<string>("island-panel-motion", ({ payload }) => {
        if (payload === "open" || payload === "close") {
            runPanelMotion(payload);
        }
    });

    unlistenNotification = await listen<NotificationType>("notification-show", ({ payload }) => {
        notificationType.value = payload;
        if (payload) playNotificationSound();
    });
});

onUnmounted(() => {
    if (hoverTimer !== null) {
        window.clearInterval(hoverTimer);
        hoverTimer = null;
    }
    if (fullscreenTimer !== null) {
        window.clearInterval(fullscreenTimer);
        fullscreenTimer = null;
    }
    unlisten?.();
    unlistenPanelMotion?.();
    unlistenNotification?.();
    stopLocalCountdown();
    if (panelMotionTimer) {
        window.clearTimeout(panelMotionTimer);
    }
});
</script>

<template>
    <div class="island-container w-full h-full flex items-start justify-center">
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
                        <CapsuleIdle v-if="state === 'idle' || state === 'alert'" />
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
    transition: width 0.3s ease, height 0.3s ease;
    contain: layout style paint;
}

.capsule-shell.interactive {
    cursor: grab;
}

.capsule-shell.dragging {
    cursor: grabbing;
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
        opacity: 0;
        transform: translate(-50%, -2%) scale(0.96, 0.68);
    }
}

@keyframes island-tail-close {
    0% {
        opacity: 0;
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
