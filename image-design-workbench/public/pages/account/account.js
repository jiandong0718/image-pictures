// 我的积分页：余额概览 + 流水明细。

import { mountLayout } from "/shared/layout.js";
import { apiGet, apiPost } from "/shared/api.js";

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

  bindPasswordForm();

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

function bindPasswordForm() {
  const form = document.getElementById("pwdForm");
  if (!form) {
    return;
  }
  const msg = document.getElementById("pwdMsg");
  const btn = document.getElementById("pwdBtn");
  const set = (text, kind = "") => {
    msg.textContent = text || "";
    msg.className = `msg ${kind}`;
  };
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const oldPassword = document.getElementById("oldPwd").value;
    const newPassword = document.getElementById("newPwd").value;
    const confirm = document.getElementById("newPwd2").value;
    if (!oldPassword || !newPassword) {
      set("请填写原密码和新密码", "error");
      return;
    }
    if (newPassword.length < 6 || newPassword.length > 64) {
      set("新密码长度需为 6-64 位", "error");
      return;
    }
    if (newPassword !== confirm) {
      set("两次输入的新密码不一致", "error");
      return;
    }
    btn.disabled = true;
    set("保存中…");
    try {
      await apiPost("/api/account/password", { oldPassword, newPassword });
      set("密码已修改", "success");
      form.reset();
    } catch (err) {
      set(err.message, "error");
    } finally {
      btn.disabled = false;
    }
  });
}

main();
