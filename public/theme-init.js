/* Applies the saved theme to <html data-theme> before first paint, so there is
   no flash of the light theme for dark-mode users. Mirrors the resolution logic
   in src/theme.ts (storage key "cv-theme"); keep the two in sync.

   This is a classic same-origin script loaded from <head>, rather than an
   inline script, so the public app remains compatible with a strict
   `script-src 'self'` policy without `unsafe-inline`. */
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
