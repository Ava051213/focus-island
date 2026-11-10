<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { eventRelativeLabel, eventTime, useEvents } from "../composables/useEvents";
import { useSettings } from "../composables/useSettings";
import { useRewardUnlocks } from "../composables/useWeeklyGoals";
import { ASSISTANT_NAME } from "../utils/assistant";

const { upcoming } = useEvents();
const { settings } = useSettings();
const { unlockedRewards } = useRewardUnlocks();

const DEFAULT_MOTTOS = [
    "深呼吸一下，就开始嘛～",
    "一次只做一件事呀～",
    "每一小步都算数的喔～",
    "你比自己想的更厉害啦～",
    "慢慢来，节奏稳就好～",
    "歇一会儿也是正事呀～",
    "今天认真点，明天有底气～",
    "大事拆小块，才不噎嘛～",
    "先做完，完美晚点再管～",
    "再等一下，心流就来啦～",
];

// 完成本周专注目标后解锁的温柔文案包
const GENTLE_MOTTOS = [
    `今天也慢慢来，${ASSISTANT_NAME}陪着你～`,
    "已经做得很好了，歇一下也没关系～",
    `别忘了喝水呀，${ASSISTANT_NAME}在这儿等你～`,
    "伸个懒腰再继续，不差这一小会儿～",
    `累的时候靠一会儿，${ASSISTANT_NAME}不催你～`,
];

const mottos = computed(() => {
    const custom = settings.value.idleMottos;
    if (custom && custom.length > 0) return custom;
    if (unlockedRewards.value.includes("mottos-gentle")) {
        return [...DEFAULT_MOTTOS, ...GENTLE_MOTTOS];
    }
    return DEFAULT_MOTTOS;
});

function pickRandomMottos(count: number): string[] {
    const pool = [...mottos.value];
    const result: string[] = [];
    for (let i = 0; i < count && pool.length > 0; i++) {
        const idx = Math.floor(Math.random() * pool.length);
        result.push(pool.splice(idx, 1)[0]);
    }
    return result;
}

// 随机座右铭单独存一份：轮播条目随日程每分钟重算，随机选择不能放进那条
// 路径，否则座右铭每次都被重新抽取、文字反复闪动。座右铭池变了才重抽。
const randomMottos = ref<string[]>([]);
watch(mottos, () => { randomMottos.value = pickRandomMottos(2); }, { immediate: true });

interface CarouselItem {
    key: string;
    type: "event" | "motto";
    text: string;
    when?: string;
}

const carouselItems = computed<CarouselItem[]>(() => {
    const events = upcoming.value.slice(0, 3);
    if (events.length === 0) {
        // Nothing scheduled: mottos only
        return mottos.value.map((m, i) => ({
            key: `motto-${i}`,
            type: "motto" as const,
            text: m,
        }));
    }
    // Nearest events + 2 random mottos mixed in
    const items: CarouselItem[] = events.map((e) => {
        const clock = eventTime(e.at);
        return {
            key: e.id,
            type: "event" as const,
            text: e.title,
            when: clock ? `${eventRelativeLabel(e.at)} ${clock}` : eventRelativeLabel(e.at),
        };
    });
    randomMottos.value.forEach((m, i) => {
        items.push({
            key: `motto-r-${i}`,
            type: "motto" as const,
            text: m,
        });
    });
    return items;
});

const carouselIndex = ref(0);
let carouselTimer: ReturnType<typeof setInterval> | null = null;

// Reset index when items change length
watch(
    () => carouselItems.value.length,
    () => {
        carouselIndex.value = 0;
    },
);

const currentItem = computed(() => {
    const items = carouselItems.value;
    if (items.length === 0) return null;
    return items[carouselIndex.value % items.length];
});

// 待机轮播只是点缀，放慢到 8 秒
const CAROUSEL_INTERVAL_MS = 8000;

onMounted(() => {
    carouselTimer = setInterval(() => {
        const len = carouselItems.value.length;
        if (len > 1) {
            carouselIndex.value = (carouselIndex.value + 1) % len;
        }
    }, CAROUSEL_INTERVAL_MS);
});

onUnmounted(() => {
    if (carouselTimer) clearInterval(carouselTimer);
});
</script>

<template>
    <div class="capsule-idle relative w-full h-full overflow-hidden">
        <TransitionGroup
            tag="div"
            name="carousel"
            class="relative w-full h-full"
        >
            <div
                v-if="currentItem"
                :key="currentItem.key"
                class="absolute inset-0 flex items-center px-4 gap-2"
                :class="currentItem.type === 'motto' ? 'justify-center' : ''"
            >
                <!-- Upcoming event -->
                <template v-if="currentItem.type === 'event'">
                    <span
                        v-if="currentItem.when"
                        class="text-[var(--idle-color)] shrink-0 opacity-70"
                        :style="{ fontSize: `calc(10px * var(--island-scale, 1))` }"
                    >
                        {{ currentItem.when }}
                    </span>
                    <span class="text-white/90 truncate flex-1" :style="{ fontSize: `calc(12px * var(--island-scale, 1))` }">{{
                        currentItem.text
                    }}</span>
                </template>
                <!-- Motto item -->
                <template v-else>
                    <span class="text-white/35 truncate" :style="{ fontSize: `calc(12px * var(--island-scale, 1))` }">{{
                        currentItem.text
                    }}</span>
                </template>
            </div>
        </TransitionGroup>

        <!-- Dots indicator -->
        <div
            v-if="carouselItems.length > 1"
            class="absolute bottom-0.5 left-1/2 -translate-x-1/2 flex gap-1"
        >
            <div
                v-for="(item, i) in carouselItems"
                :key="item.key"
                class="w-1 h-1 rounded-full transition-colors duration-300"
                :class="
                    i === carouselIndex % carouselItems.length
                        ? 'bg-white/40'
                        : 'bg-white/10'
                "
            />
        </div>
    </div>
</template>

<style scoped>
.carousel-enter-active,
.carousel-leave-active {
    transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);
}
.carousel-enter-from {
    opacity: 0;
    transform: translateY(100%);
}
.carousel-leave-to {
    opacity: 0;
    transform: translateY(-100%);
}
</style>
