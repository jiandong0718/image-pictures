// 在页面渲染前同步应用主题，避免闪烁。默认仙侠风；用户显式切到科技/玄幻才用 tech/mystic。
// 与 layout.js 的切换逻辑共用 localStorage key。三套主题：xianxia(默认) / tech / mystic。
(function () {
  var theme = "xianxia";
  try {
    var saved = localStorage.getItem("imageStudioTheme");
    if (saved === "tech" || saved === "mystic") {
      theme = saved;
    }
  } catch (e) {
    /* localStorage 不可用时用默认仙侠风 */
  }
  document.documentElement.dataset.theme = theme;
})();
