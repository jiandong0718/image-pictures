// 联系充值页：展示管理员在配置中心填写的联系方式（逐行+独立复制）和微信二维码。

import { mountLayout } from "/shared/layout.js";
import { apiGet } from "/shared/api.js";

// 把一行文案拆成「标签：内容」，没有冒号就整行当内容，标签留空。
function splitLabel(line) {
  const match = line.match(/^([^：:]{1,8})[：:]\s*(.+)$/);
  return match ? { label: match[1], value: match[2] } : { label: "", value: line };
}

function copyText(text, msgEl) {
  navigator.clipboard
    .writeText(text)
    .then(() => {
      msgEl.textContent = "已复制";
      msgEl.className = "msg success";
    })
    .catch(() => {
      msgEl.textContent = "复制失败，请手动选中文字复制";
      msgEl.className = "msg error";
    });
}

function renderContactRows(contact, msgEl) {
  const container = document.getElementById("contactRows");
  const lines = contact.split("\n").map((l) => l.trim()).filter(Boolean);
  container.innerHTML = "";
  lines.forEach((line) => {
    const { label, value } = splitLabel(line);
    // 一行里可能塞了多个号码/邮箱（空格分隔），每个都要能单独复制，不能合在一起复制一整串。
    const items = value.split(/\s+/).filter(Boolean);

    const row = document.createElement("div");
    row.className = "contact-row";
    if (label) {
      const labelEl = document.createElement("div");
      labelEl.className = "contact-row-label";
      labelEl.textContent = label;
      row.appendChild(labelEl);
    }
    items.forEach((item) => {
      const itemEl = document.createElement("div");
      itemEl.className = "contact-item";
      itemEl.innerHTML = `
        <span class="contact-item-value">${item}</span>
        <button class="btn sm ghost" type="button">复制</button>
      `;
      itemEl.querySelector("button").addEventListener("click", () => copyText(item, msgEl));
      row.appendChild(itemEl);
    });
    container.appendChild(row);
  });
}

async function main() {
  const ctx = await mountLayout({ active: "contact", title: "联系充值", crumb: "ACCOUNT" });
  if (!ctx) {
    return;
  }

  const { contact, qrUrl } = await apiGet("/api/contact");
  const layout = document.getElementById("contactLayout");
  const emptyState = document.getElementById("emptyState");

  if (!contact && !qrUrl) {
    emptyState.hidden = false;
    return;
  }
  layout.hidden = false;

  if (contact) {
    renderContactRows(contact, document.getElementById("copyMsg"));
  } else {
    layout.querySelector(".card").hidden = true;
    layout.style.gridTemplateColumns = "1fr";
  }

  const qrCard = document.getElementById("qrCard");
  if (qrUrl) {
    qrCard.hidden = false;
    document.getElementById("contactQr").src = qrUrl;
  } else {
    layout.style.gridTemplateColumns = "1fr";
  }
}

main();
