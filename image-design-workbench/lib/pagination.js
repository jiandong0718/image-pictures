"use strict";

// 记录查询类接口统一的分页规则：每页 10/20/50 条，默认 10。

const PAGE_SIZES = [10, 20, 50];

function normalizePagination(rawPage, rawPageSize) {
  const pageSize = PAGE_SIZES.includes(Number(rawPageSize)) ? Number(rawPageSize) : PAGE_SIZES[0];
  const page = Number.isInteger(Number(rawPage)) && Number(rawPage) > 0 ? Number(rawPage) : 1;
  return { page, pageSize, offset: (page - 1) * pageSize };
}

module.exports = { PAGE_SIZES, normalizePagination };
