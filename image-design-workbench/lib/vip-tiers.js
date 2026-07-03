"use strict";

// VIP 成长等级：按累计成功生成张数分档，价格仅用于展示成长权益（信息/勋章性质）。
// 积分扣减规则不受等级影响，依然是 1 积分 = 1 张（见 lib/accounts.js consumeCredits）。

const VIP_TIERS = [
  { key: "normal", label: "普通", price: 1.0, width: 100 },
  { key: "silver", label: "白银", price: 0.9, width: 200 },
  { key: "platinum", label: "铂金", price: 0.8, width: 300 },
  { key: "diamond", label: "钻石", price: 0.7, width: 500 },
  { key: "vip", label: "VIP", price: 0.6, width: 1000 },
  { key: "svip", label: "SVIP", price: 0.5, width: 2000 },
];

// 每档的累计区间 [start, end)；最后一档（SVIP）向上不设上限。
function buildTierTable() {
  let start = 0;
  return VIP_TIERS.map((tier, index) => {
    const end = index === VIP_TIERS.length - 1 ? null : start + tier.width;
    const row = { ...tier, start, end };
    start = end;
    return row;
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
