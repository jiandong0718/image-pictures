// 我的积分页：余额概览 + 流水明细。

import { mountLayout } from "/shared/layout.js";
import { apiGet } from "/shared/api.js";

const TYPE_LABEL = {
  signup_bonus: "注册赠送",
  consume: "消费",
  admin_recharge: "管理员充值",
  adjust: "调整",
};

function fmtTime(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return String(value || "");
  }
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function main() {
  const ctx = await mountLayout({ active: "account", title: "我的积分", crumb: "ACCOUNT" });
  if (!ctx) {
    return;
  }

  const data = await apiGet("/api/account");
  const tx = data.transactions || [];

  document.getElementById("balance").textContent = data.user.credits;

  const spent = tx.filter((t) => t.amount < 0).reduce((sum, t) => sum + Math.abs(t.amount), 0);
  const earned = tx.filter((t) => t.amount > 0).reduce((sum, t) => sum + t.amount, 0);
  document.getElementById("spent").textContent = spent;
  document.getElementById("earned").textContent = earned;

  const body = document.getElementById("txBody");
  if (!tx.length) {
    body.innerHTML = `<tr><td colspan="5"><div class="empty">暂无流水记录</div></td></tr>`;
    return;
  }
  body.innerHTML = tx
    .map((t) => {
      const positive = t.amount >= 0;
      const color = positive ? "var(--accent)" : "var(--danger)";
      const sign = positive ? "+" : "";
      return `
        <tr>
          <td class="mono">${fmtTime(t.createdAt)}</td>
          <td><span class="badge">${TYPE_LABEL[t.type] || t.type}</span></td>
          <td>${t.note || ""}</td>
          <td class="mono" style="text-align: right; color: ${color}; font-weight: 700">${sign}${t.amount}</td>
          <td class="mono" style="text-align: right">${t.balanceAfter}</td>
        </tr>`;
    })
    .join("");
}

main();
