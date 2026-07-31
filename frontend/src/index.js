import { mount } from 'svelte';
import '@/index.css';
import App from '@/App.svelte';

const root = document.getElementById('root');
const app = mount ? mount(App, { target: root }) : new App({ target: root });

export default app;

// Register service worker so the app is installable as a standalone PWA.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const swUrl = `${process.env.PUBLIC_URL || ""}/service-worker.js`;
    navigator.serviceWorker.register(swUrl).catch(() => {});
  });
}
