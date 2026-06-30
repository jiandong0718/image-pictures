// 在页面渲染前同步应用已保存的主题，避免主题闪烁。
// 与 layout.js 的切换逻辑共用 localStorage key。两套主题：tech(默认) / xianxia。
(function () {
  try {
    var t = localStorage.getItem("imageStudioTheme");
    if (t === "xianxia" || t === "tech") {
      document.documentElement.dataset.theme = t;
    }
  } catch (e) {
    /* localStorage 不可用时用默认主题 */
  }
})();
