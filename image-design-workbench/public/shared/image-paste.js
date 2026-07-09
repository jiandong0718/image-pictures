// 整页粘贴图片支持：剪贴板里有图片时，把第一张图当作 File 交给 handler（等价于选文件上传）。
// 只在检测到图片文件时 preventDefault，纯文本粘贴不受影响。返回取消监听的函数。
export function enableImagePaste(handler) {
  const onPaste = (e) => {
    const items = e.clipboardData?.items || [];
    for (const item of items) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const f = item.getAsFile();
        if (f) {
          e.preventDefault();
          handler(f);
          return;
        }
      }
    }
  };
  document.addEventListener("paste", onPaste);
  return () => document.removeEventListener("paste", onPaste);
}
