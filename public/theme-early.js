;(function () {
  const STORAGE_KEY = 'sk-theme-mode';
  const THEME_ATTR = 'data-theme';

  function getStoredMode() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
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
    document.documentElement.style.backgroundColor = theme === 'dark' ? '#05060f' : '#f4f7fc';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#05060f' : '#f4f7fc');
  }

  applyTheme(resolveTheme(getStoredMode()));
})();
