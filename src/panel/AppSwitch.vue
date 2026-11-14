<script setup lang="ts">
defineProps<{
    label: string;
    hint?: string;
    error?: string;
}>();

const model = defineModel<boolean>({ required: true });
</script>

<template>
    <div class="toggle-row">
        <div class="toggle-copy">
            <span class="toggle-label">{{ label }}</span>
            <span v-if="hint" class="toggle-hint">{{ hint }}</span>
            <span v-if="error" class="toggle-hint is-error">{{ error }}</span>
        </div>
        <label class="switch" :aria-label="label">
            <input v-model="model" type="checkbox" />
            <span class="switch-track"></span>
        </label>
    </div>
</template>
