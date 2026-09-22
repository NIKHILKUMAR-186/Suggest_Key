;(function () {
  const STORAGE_KEY = 'sk-theme-mode';
  const THEME_ATTR = 'data-theme';

  function getInitialMode() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && ['light', 'dark', 'system'].includes(stored)) {
        return stored;
      }
    } catch {}
    return 'system';
  }

  function getSystemTheme() {
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch {
      return 'dark';
    }
  }

  function resolveTheme(mode) {
    return mode === 'system' ? getSystemTheme() : mode;
  }

  function applyTheme(theme) {
    const root = document.documentElement;
    root.setAttribute(THEME_ATTR, theme);
    root.classList.remove('light', 'dark');
    root.classList.add(theme);
    root.style.colorScheme = theme;
    // Paint the correct page background before first render — no flash.
    document.documentElement.style.backgroundColor = theme === 'dark' ? '#0e1114' : '#f2f7fd';
  }

  function init() {
    const mode = getInitialMode();
    const theme = resolveTheme(mode);
    applyTheme(theme);

    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) {
      themeColor.setAttribute('content', theme === 'dark' ? '#0e1114' : '#f2f7fd');
    }
  }

  init();
})();