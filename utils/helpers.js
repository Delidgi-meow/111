/**
 * Chronicle — Helpers
 */

/** Debounce */
export function debounce(fn, delay = 300) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
    };
}

/** Clamp number */
export function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

/** Escape HTML */
export function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/** Generate short ID */
export function shortId() {
    return Math.random().toString(36).substring(2, 8);
}

/** Deep clone (JSON-safe objects) */
export function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

/** Format number with locale */
export function formatNumber(n, locale = 'ru-RU') {
    return n.toLocaleString(locale);
}
