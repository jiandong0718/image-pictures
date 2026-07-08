// 用户中心：头像上传 + 绑定邮箱 + 修改密码 + VIP 成长等级。

import { mountLayout, setAvatar } from "/shared/layout.js";
import { apiGet, apiPost, apiUpload, fetchMe } from "/shared/api.js";

function setMsg(id, text, kind = "") {
  const el = document.getElementById(id);
  el.textContent = text || "";
  el.className = `msg ${kind}`;
}

function renderAvatarPreview(me) {
  const el = document.getElementById("avatarPreview");
  el.innerHTML = me.avatarUrl
    ? `<img src="${me.avatarUrl}" alt="" />`
    : (me.username || "?").slice(0, 1).toUpperCase();
}

function renderProfileHero(me) {
  document.getElementById("profileName").textContent = me.username;
}

function renderVip(vip) {
  const { currentTier, nextTier, totalGenerated, remainingToNext, tiers } = vip;

  document.getElementById("profileTotal").textContent = `累计生成 ${totalGenerated} 张`;
  const badge = document.getElementById("profileTierBadge");
  badge.textContent = currentTier.label;
  badge.className = `tier-badge tier-${currentTier.key}`;

  document.getElementById("vipCurrentLabel").textContent =
    `当前：${currentTier.label} · ¥${currentTier.price.toFixed(1)}/张`;
  document.getElementById("vipNextLabel").textContent = nextTier
    ? `还差 ${remainingToNext} 张升级${nextTier.label}`
    : "已是最高等级";

  let percent = 100;
  if (nextTier) {
    const span = nextTier.start - currentTier.start;
    const progressed = totalGenerated - currentTier.start;
    percent = Math.min(100, Math.max(0, (progressed / span) * 100));
  }
  document.getElementById("vipProgressFill").style.width = `${percent}%`;

  document.getElementById("vipTableBody").innerHTML = tiers
    .map((tier) => {
      let status;
      if (tier.current) {
        status = `<span class="tier-status current">当前等级</span>`;
      } else if (totalGenerated >= tier.start) {
        status = `<span class="tier-status done">已达成</span>`;
      } else {
        status = `<span class="tier-status pending">还差 ${tier.start - totalGenerated} 张</span>`;
      }
      return `
        <tr class="${tier.current ? "current" : ""}">
          <td><span class="tier-badge tier-${tier.key}">${tier.label}</span></td>
          <td class="mono">¥${tier.price.toFixed(1)}/张</td>
          <td>${status}</td>
        </tr>`;
    })
    .join("");
}

function bindAvatar(me) {
  const input = document.getElementById("avatarInput");
  document.getElementById("avatarBtn").addEventListener("click", () => input.click());
  input.addEventListener("change", async () => {
    const file = input.files[0];
    input.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setMsg("avatarMsg", "请选择图片文件", "error");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setMsg("avatarMsg", "头像不能超过 5MB", "error");
      return;
    }
    setMsg("avatarMsg", "上传中…");
    try {
      const fd = new FormData();
      fd.append("avatar", file);
      const data = await apiUpload("/api/account/avatar", fd);
      const url = `${data.avatarUrl}?t=${Date.now()}`;
      me.avatarUrl = url;
      renderAvatarPreview(me);
      setAvatar(url);
      setMsg("avatarMsg", "头像已更新", "success");
    } catch (err) {
      setMsg("avatarMsg", err.message, "error");
    }
  });
}

// 邮箱/手机号：默认始终「展示态」——有值显示值 +「修改」，没值显示「未绑定X」+「添加」。
// 只有点了「修改/添加」才切出输入框；保存后回到展示态。
function bindContactField(key, apiPath, fieldName, initialValue) {
  const display = document.getElementById(`${key}Display`);
  const valueEl = document.getElementById(`${key}Value`);
  const editBtn = document.getElementById(`${key}EditBtn`);
  const form = document.getElementById(`${key}Form`);
  const input = document.getElementById(key);
  const cancelBtn = document.getElementById(`${key}Cancel`);
  const btn = document.getElementById(`${key}Btn`);
  const msgId = `${key}Msg`;
  const emptyText = `未绑定${fieldName}`;

  function showDisplay(value) {
    const has = Boolean(value);
    valueEl.textContent = has ? value : emptyText;
    valueEl.classList.toggle("is-empty", !has);
    editBtn.textContent = has ? "修改" : "添加";
    display.hidden = false;
    form.hidden = true;
    setMsg(msgId, "");
  }
  function showForm() {
    display.hidden = true;
    form.hidden = false;
    input.focus();
  }

  input.value = initialValue || "";
  showDisplay(initialValue);

  editBtn.addEventListener("click", showForm);
  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => {
      input.value = (valueEl.classList.contains("is-empty") ? "" : valueEl.textContent) || "";
      showDisplay(input.value);
    });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const value = input.value.trim();
    btn.disabled = true;
    setMsg(msgId, "保存中…");
    try {
      await apiPost(apiPath, { [key]: value });
      showDisplay(value);
      setMsg(msgId, `${fieldName}已保存`, "success");
    } catch (err) {
      setMsg(msgId, err.message, "error");
    } finally {
      btn.disabled = false;
    }
  });
}

function bindPasswordForm() {
  const form = document.getElementById("pwdForm");
  const btn = document.getElementById("pwdBtn");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const oldPassword = document.getElementById("oldPwd").value;
    const newPassword = document.getElementById("newPwd").value;
    const confirm = document.getElementById("newPwd2").value;
    if (!oldPassword || !newPassword) {
      setMsg("pwdMsg", "请填写原密码和新密码", "error");
      return;
    }
    if (newPassword.length < 6 || newPassword.length > 64) {
      setMsg("pwdMsg", "新密码长度需为 6-64 位", "error");
      return;
    }
    if (newPassword !== confirm) {
      setMsg("pwdMsg", "两次输入的新密码不一致", "error");
      return;
    }
    btn.disabled = true;
    setMsg("pwdMsg", "保存中…");
    try {
      await apiPost("/api/account/password", { oldPassword, newPassword });
      setMsg("pwdMsg", "密码已修改", "success");
      form.reset();
    } catch (err) {
      setMsg("pwdMsg", err.message, "error");
    } finally {
      btn.disabled = false;
    }
  });
}

async function main() {
  const ctx = await mountLayout({ active: "user-center", title: "用户中心", crumb: "ACCOUNT" });
  if (!ctx) {
    return;
  }
  // 头像/邮箱是本页的编辑对象，不用可能过期的本地缓存，直接拉一次最新值。
  const me = (await fetchMe()) || ctx.me;
  renderProfileHero(me);
  renderAvatarPreview(me);
  bindAvatar(me);
  bindContactField("email", "/api/account/email", "邮箱", me.email);
  bindContactField("phone", "/api/account/phone", "手机号", me.phone);
  bindPasswordForm();

  const { vip } = await apiGet("/api/account/vip");
  renderVip(vip);
}

main();
