/* Applies the saved theme to <html data-theme> before first paint, so there is
   no flash of the light theme for dark-mode users. Mirrors the resolution logic
   in src/theme.ts (storage key "cv-theme"); keep the two in sync.

   This is a classic same-origin script (loaded render-blocking from <head>)
   rather than an inline <script> on purpose: the Tauri desktop build's CSP is
   `script-src 'self'` with no 'unsafe-inline', which would block an inline
   script but allows this external file. */
(function () {
  try {
    var pref = localStorage.getItem("cv-theme");
    if (pref !== "light" && pref !== "dark" && pref !== "system") pref = "system";
    var dark =
      pref === "dark" ||
      (pref === "system" &&
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  } catch (e) {
    /* localStorage/matchMedia unavailable: leave the default (light) theme. */
  }
})();
