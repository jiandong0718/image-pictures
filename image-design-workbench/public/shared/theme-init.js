// 在页面渲染前同步应用主题，避免闪烁。新访客默认幻紫星雾，保留用户选过的主题。
// 与 layout.js 的切换逻辑共用 localStorage key。
(function () {
  var theme = "mystic";
  try {
    var saved = localStorage.getItem("imageStudioTheme");
    if (saved === "tech" || saved === "xianxia" || saved === "mystic") {
      theme = saved;
    }
  } catch (e) {
    /* localStorage 不可用时用默认幻紫星雾 */
  }
  document.documentElement.dataset.theme = theme;
})();
