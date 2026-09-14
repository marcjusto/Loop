import { createApp } from 'vue'
import App from './App.vue'
import './fonts.css'
import './style.css'
import { startProviderDetection } from './lib/nimiq.js'
import { boot } from './lib/store.js'

// Start looking for the wallet straight away — it resolves in parallel with
// the first render, so nothing waits on it.
void startProviderDetection()
void boot()

createApp(App).mount('#app')
