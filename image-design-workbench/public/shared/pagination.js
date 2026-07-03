// 通用分页控件：页码信息 + 每页条数选择(10/20/50) + 上一页/下一页。纯 DOM，无依赖。

const PAGE_SIZES = [10, 20, 50];

export function renderPagination(container, { page, pageSize, total, onChange }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  container.innerHTML = "";

  const info = document.createElement("span");
  info.className = "pagination-info";
  info.textContent = total ? `共 ${total} 条 · 第 ${page}/${totalPages} 页` : "暂无数据";
  container.appendChild(info);

  const prev = document.createElement("button");
  prev.type = "button";
  prev.className = "btn sm ghost";
  prev.textContent = "上一页";
  prev.disabled = page <= 1;
  prev.addEventListener("click", () => onChange({ page: page - 1, pageSize }));
  container.appendChild(prev);

  const next = document.createElement("button");
  next.type = "button";
  next.className = "btn sm ghost";
  next.textContent = "下一页";
  next.disabled = page >= totalPages;
  next.addEventListener("click", () => onChange({ page: page + 1, pageSize }));
  container.appendChild(next);

  const select = document.createElement("select");
  select.className = "select pagination-size";
  PAGE_SIZES.forEach((size) => {
    const opt = document.createElement("option");
    opt.value = String(size);
    opt.textContent = `每页 ${size} 条`;
    opt.selected = size === pageSize;
    select.appendChild(opt);
  });
  select.addEventListener("change", () => onChange({ page: 1, pageSize: Number(select.value) }));
  container.appendChild(select);
}
