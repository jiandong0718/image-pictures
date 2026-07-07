"use strict";

// VIP 成长等级：按累计成功生成张数分档，价格仅用于展示成长权益（信息/勋章性质）。
// 积分扣减规则不受等级影响，依然是 1 积分 = 1 张（见 lib/accounts.js consumeCredits）。
// start 是达到该档的累计张数门槛（绝对值，不是每档的宽度）。

const VIP_TIERS = [
  { key: "normal", label: "普通", price: 1.0, start: 0 },
  { key: "silver", label: "白银", price: 0.9, start: 200 },
  { key: "platinum", label: "铂金", price: 0.8, start: 300 },
  { key: "diamond", label: "钻石", price: 0.7, start: 500 },
  { key: "vip", label: "VIP", price: 0.6, start: 800 },
  { key: "svip", label: "SVIP", price: 0.5, start: 1000 },
  { key: "supreme", label: "至尊", price: 0.3, start: 2000 },
];

// 每档的累计区间 [start, end)；最后一档（至尊）向上不设上限。
function buildTierTable() {
  return VIP_TIERS.map((tier, index) => {
    const next = VIP_TIERS[index + 1];
    return { ...tier, end: next ? next.start : null };
  });
}

function resolveVipStatus(totalGenerated) {
  const table = buildTierTable();
  const total = Math.max(0, Number(totalGenerated) || 0);
  const currentIndex = table.reduce((acc, tier, index) => (total >= tier.start ? index : acc), 0);
  const current = table[currentIndex];
  const next = table[currentIndex + 1] || null;
  return {
    totalGenerated: total,
    tiers: table.map((tier, index) => ({ ...tier, current: index === currentIndex })),
    currentTier: current,
    nextTier: next,
    remainingToNext: next ? next.start - total : 0,
  };
}

module.exports = { VIP_TIERS, buildTierTable, resolveVipStatus };
