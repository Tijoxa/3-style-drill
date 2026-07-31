import { writable } from 'svelte/store';

export const toasts = writable([]);

let idCounter = 0;

function addToast(message, type = 'info') {
  const id = ++idCounter;
  toasts.update((all) => [...all, { id, message, type }]);
  setTimeout(() => {
    toasts.update((all) => all.filter((t) => t.id !== id));
  }, 3500);
}

export const toast = (message) => addToast(message, 'info');
toast.success = (message) => addToast(message, 'success');
toast.error = (message) => addToast(message, 'error');
