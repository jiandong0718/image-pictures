// 管理员充值页：搜索用户 → 选中 → 充值/授权管理员。仅管理员可访问（服务端已守卫）。

import { mountLayout } from "/shared/layout.js";
import { apiGet, apiPost } from "/shared/api.js";
import { createLocalState } from "/shared/persistence.js";
import { renderPagination } from "/shared/pagination.js";

let selected = null;
let me = null;
let pageState = { page: 1, pageSize: 10 };
const storage = createLocalState("imageStudio:admin:v1");

const els = {
  keyword: document.getElementById("keyword"),
  searchBtn: document.getElementById("searchBtn"),
  userBody: document.getElementById("userBody"),
  userPagination: document.getElementById("userPagination"),
  target: document.getElementById("rechargeTarget"),
  amount: document.getElementById("amount"),
  note: document.getElementById("note"),
  msg: document.getElementById("rechargeMsg"),
  rechargeBtn: document.getElementById("rechargeBtn"),
  roleMsg: document.getElementById("roleMsg"),
  roleBtn: document.getElementById("roleBtn"),
};

function setMsg(text, kind = "") {
  els.msg.textContent = text || "";
  els.msg.className = `msg ${kind}`;
}

function setRoleMsg(text, kind = "") {
  els.roleMsg.textContent = text || "";
  els.roleMsg.className = `msg ${kind}`;
}

function saveDraft() {
  storage.save({
    keyword: els.keyword.value,
    amount: els.amount.value,
    note: els.note.value,
    selected,
  });
}

function applyDraft() {
  const draft = storage.load({});
  if (!draft || typeof draft !== "object") {
    return;
  }
  if (typeof draft.keyword === "string") els.keyword.value = draft.keyword;
  if (typeof draft.amount === "string") els.amount.value = draft.amount;
  if (typeof draft.note === "string") els.note.value = draft.note;
  if (draft.selected && typeof draft.selected === "object") {
    selectUser(draft.selected);
  }
}

async function search({ resetPage = true } = {}) {
  const keyword = els.keyword.value.trim();
  if (resetPage) {
    pageState = { ...pageState, page: 1 };
  }
  els.userBody.innerHTML = `<tr><td colspan="7"><div class="empty">加载中…</div></td></tr>`;
  try {
    const data = await apiGet(
      `/api/admin/users?keyword=${encodeURIComponent(keyword)}&page=${pageState.page}&pageSize=${pageState.pageSize}`,
    );
    renderUsers(data.users || []);
    const { page, pageSize, total } = data.pagination;
    pageState = { page, pageSize };
    renderPagination(els.userPagination, {
      page,
      pageSize,
      total,
      onChange: (next) => {
        pageState = next;
        search({ resetPage: false });
      },
    });
  } catch (err) {
    els.userBody.innerHTML = `<tr><td colspan="7"><div class="empty">${err.message}</div></td></tr>`;
  }
}

function renderUsers(users) {
  if (!users.length) {
    els.userBody.innerHTML = `<tr><td colspan="7"><div class="empty">没有匹配的用户</div></td></tr>`;
    return;
  }
  els.userBody.innerHTML = "";
  users.forEach((u) => {
    const tier = u.vipTier || { key: "normal", label: "普通" };
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="mono">${u.id}</td>
      <td>${u.username}</td>
      <td><span class="badge${u.role === "admin" ? " ok" : ""}">${u.role === "admin" ? "管理员" : "用户"}</span></td>
      <td><span class="tier-badge tier-${tier.key}">${tier.label}</span></td>
      <td class="mono" style="text-align: right">${u.totalConsumed ?? 0}</td>
      <td class="mono" style="text-align: right; font-weight: 700">${u.credits}</td>
      <td style="text-align: right"><button class="btn sm" type="button">选择</button></td>
    `;
    tr.querySelector("button").addEventListener("click", () => selectUser(u));
    els.userBody.appendChild(tr);
  });
}

function renderRoleButton() {
  if (!selected) {
    els.roleBtn.disabled = true;
    els.roleBtn.textContent = "设为管理员";
    return;
  }
  const isSelf = me && Number(selected.id) === Number(me.id);
  const isAdmin = selected.role === "admin";
  els.roleBtn.disabled = isSelf;
  els.roleBtn.textContent = isAdmin ? "取消管理员权限" : "设为管理员";
  els.roleBtn.className = isAdmin ? "btn danger full" : "btn full";
  setRoleMsg(isSelf ? "不能修改自己的角色" : "");
}

function selectUser(u) {
  selected = u;
  els.target.innerHTML = `${u.username} <span class="mono" style="color: var(--ink-mute); font-size: 14px">#${u.id} · 当前 ${u.credits} 积分</span>`;
  els.rechargeBtn.disabled = false;
  setMsg("");
  renderRoleButton();
  saveDraft();
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
    selected = { ...selected, ...data.user };
    selectUser(selected);
    saveDraft();
    await search({ resetPage: false });
  } catch (err) {
    setMsg(err.message, "error");
  } finally {
    els.rechargeBtn.disabled = false;
  }
}

async function toggleRole() {
  if (!selected || (me && Number(selected.id) === Number(me.id))) {
    return;
  }
  const nextRole = selected.role === "admin" ? "user" : "admin";
  const action = nextRole === "admin" ? "设为管理员" : "取消管理员权限";
  if (!window.confirm(`确定要把 ${selected.username} ${action}吗？`)) {
    return;
  }
  els.roleBtn.disabled = true;
  setRoleMsg("处理中…");
  try {
    const data = await apiPost("/api/admin/set-role", { userId: selected.id, role: nextRole });
    selected = { ...selected, ...data.user };
    selectUser(selected);
    setRoleMsg(`已${action}`, "success");
    await search({ resetPage: false });
  } catch (err) {
    setRoleMsg(err.message, "error");
    els.roleBtn.disabled = false;
  }
}

async function main() {
  const ctx = await mountLayout({ active: "admin", title: "充值管理", crumb: "ADMIN" });
  if (!ctx) {
    return;
  }
  me = ctx.me;
  applyDraft();
  els.searchBtn.addEventListener("click", search);
  [els.keyword, els.amount, els.note].forEach((el) => {
    el.addEventListener("input", saveDraft);
    el.addEventListener("change", saveDraft);
  });
  els.keyword.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      search();
    }
  });
  els.rechargeBtn.addEventListener("click", recharge);
  els.roleBtn.addEventListener("click", toggleRole);
  await search();
}

main();
