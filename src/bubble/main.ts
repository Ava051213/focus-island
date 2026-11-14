import { createApp } from 'vue'
import '../styles.css'
import BubbleApp from './BubbleApp.vue'

// 泡泡 overlay 的独立轻量入口：只挂 BubbleApp，
// 不加载岛/清单的任何页面与计时逻辑
createApp(BubbleApp).mount('#app')
