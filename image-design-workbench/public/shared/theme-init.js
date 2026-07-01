// 在页面渲染前同步应用主题，避免闪烁。默认仙侠风；仅当用户显式切到科技风才用 tech。
// 与 layout.js 的切换逻辑共用 localStorage key。两套主题：xianxia(默认) / tech。
(function () {
  var theme = "xianxia";
  try {
    if (localStorage.getItem("imageStudioTheme") === "tech") {
      theme = "tech";
    }
  } catch (e) {
    /* localStorage 不可用时用默认仙侠风 */
  }
  document.documentElement.dataset.theme = theme;
})();
