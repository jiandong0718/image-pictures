// 管理员充值页：搜索用户 → 选中 → 充值。仅管理员可访问（服务端已守卫）。

import { mountLayout } from "/shared/layout.js";
import { apiGet, apiPost } from "/shared/api.js";

let selected = null;

const els = {
  keyword: document.getElementById("keyword"),
  searchBtn: document.getElementById("searchBtn"),
  userBody: document.getElementById("userBody"),
  target: document.getElementById("rechargeTarget"),
  amount: document.getElementById("amount"),
  note: document.getElementById("note"),
  msg: document.getElementById("rechargeMsg"),
  rechargeBtn: document.getElementById("rechargeBtn"),
};

function setMsg(text, kind = "") {
  els.msg.textContent = text || "";
  els.msg.className = `msg ${kind}`;
}

async function search() {
  const keyword = els.keyword.value.trim();
  els.userBody.innerHTML = `<tr><td colspan="5"><div class="empty">加载中…</div></td></tr>`;
  try {
    const data = await apiGet(`/api/admin/users?keyword=${encodeURIComponent(keyword)}`);
    renderUsers(data.users || []);
  } catch (err) {
    els.userBody.innerHTML = `<tr><td colspan="5"><div class="empty">${err.message}</div></td></tr>`;
  }
}

function renderUsers(users) {
  if (!users.length) {
    els.userBody.innerHTML = `<tr><td colspan="5"><div class="empty">没有匹配的用户</div></td></tr>`;
    return;
  }
  els.userBody.innerHTML = "";
  users.forEach((u) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="mono">${u.id}</td>
      <td>${u.username}</td>
      <td><span class="badge${u.role === "admin" ? " ok" : ""}">${u.role === "admin" ? "管理员" : "用户"}</span></td>
      <td class="mono" style="text-align: right; font-weight: 700">${u.credits}</td>
      <td style="text-align: right"><button class="btn sm" type="button">选择</button></td>
    `;
    tr.querySelector("button").addEventListener("click", () => selectUser(u));
    els.userBody.appendChild(tr);
  });
}

function selectUser(u) {
  selected = u;
  els.target.innerHTML = `${u.username} <span class="mono" style="color: var(--ink-mute); font-size: 14px">#${u.id} · 当前 ${u.credits} 积分</span>`;
  els.rechargeBtn.disabled = false;
  setMsg("");
  els.amount.focus();
}

async function recharge() {
  if (!selected) {
    return;
  }
  const amount = Number(els.amount.value);
  if (!Number.isInteger(amount) || amount <= 0) {
    setMsg("请输入正整数积分数", "error");
    return;
  }
  els.rechargeBtn.disabled = true;
  setMsg("充值中…");
  try {
    const data = await apiPost("/api/admin/recharge", {
      userId: selected.id,
      amount,
      note: els.note.value.trim(),
    });
    setMsg(`充值成功，${data.user.username} 当前余额 ${data.user.credits} 积分`, "success");
    els.amount.value = "";
    els.note.value = "";
    selected = data.user;
    selectUser(data.user);
    await search();
  } catch (err) {
    setMsg(err.message, "error");
  } finally {
    els.rechargeBtn.disabled = false;
  }
}

async function main() {
  const ctx = await mountLayout({ active: "admin", title: "充值管理", crumb: "ADMIN" });
  if (!ctx) {
    return;
  }
  els.searchBtn.addEventListener("click", search);
  els.keyword.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      search();
    }
  });
  els.rechargeBtn.addEventListener("click", recharge);
  await search();
}

main();
