import { mountLayout } from "/shared/layout.js";
import { apiGet } from "/shared/api.js";
import { renderPagination } from "/shared/pagination.js";
const $ = id => document.getElementById(id);
const number = value => value === null ? "未记录" : Number(value || 0).toLocaleString("zh-CN");
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
})[c]);
const dateTime = ms => ms ? new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
}).format(new Date(Number(ms))) : "未记录";
const dayOf = ms => new Date(ms + 8 * 3600000).toISOString().slice(0, 10);
const DAY = 86400000;
const state = {
  dashboard: null,
  users: {
    page: 1,
    pageSize: 10
  },
  tasks: {
    page: 1,
    pageSize: 10
  },
  taskFilter: null,
  taskLabel: "",
  filter: {},
  request: 0,
  userRequest: 0,
  taskRequest: 0
};
const metrics = [["users", "用户总数", "当前账户数"], ["newUsers", "今日新增用户", "今日注册的账户"], ["activeUsers", "今日活跃用户", "按账号去重"], ["image", "今日生成图片", "成功产出 · 张"], ["video", "今日生成视频", "成功产出 · 条"], ["audio", "今日生成语音", "成功产出 · 条"], ["credits", "今日消耗积分", "已结算消费"], ["tasks", "今日提交任务", "一次批量生成计一个任务"]];
function message(text, error = false) {
  $("pageMessage").textContent = text;
  $("pageMessage").className = error ? "msg error" : "msg";
}
function query(extra = {}) {
  return new URLSearchParams({
    ...state.filter,
    ...extra
  }).toString();
}
function readFilter() {
  return {
    start: $("startDate").value,
    end: $("endDate").value,
    includeAdmins: String($("includeAdmins").checked)
  };
}
function renderMetrics(data) {
  $("metrics").innerHTML = metrics.map(([key, label, caption]) => `<article class="sc-metric"><div class="sc-metric-label">${label}</div><div class="sc-metric-value">${data ? number(data[key]) : "—"}</div><div class="sc-metric-caption">${caption}</div></article>`).join("");
}
function renderChart() {
  if (!state.dashboard) return;
  const days = state.dashboard.days;
  const metric = $("chartMetric").value;
  const label = $("chartMetric").selectedOptions[0].textContent;
  const available = days.filter(day => day[metric] !== null);
  if (!available.length) {
    $("chart").innerHTML = '<p class="sc-chart-empty">所选日期还没有活跃记录，请选择记录启用后的日期。</p>';
    return;
  }
  const width = Math.max(320, Math.min(960, $("chart").clientWidth)),
    height = 240,
    left = 44,
    right = 20,
    top = 22,
    bottom = 36;
  const max = Math.max(2, Math.ceil(Math.max(...available.map(d => d[metric])) / 2) * 2);
  const x = i => days.length === 1 ? left + (width - left - right) / 2 : left + i * (width - left - right) / (days.length - 1);
  const y = n => height - bottom - n / max * (height - top - bottom);
  let drawing = false;
  const line = days.map((d, i) => {
    if (d[metric] === null) {
      drawing = false;
      return "";
    }
    const point = `${drawing ? "L" : "M"}${x(i).toFixed(2)},${y(d[metric]).toFixed(2)}`;
    drawing = true;
    return point;
  }).join(" ");
  const ticks = [0, .5, 1].map(fraction => {
    const py = y(max * fraction);
    return `<line class="sc-chart-axis" x1="${left}" x2="${width - right}" y1="${py}" y2="${py}"/><text x="${left - 10}" y="${py + 4}" text-anchor="end">${number(Math.ceil(max * fraction))}</text>`;
  }).join("");
  const dateIndices = [...new Set([0, Math.floor((days.length - 1) / 2), days.length - 1])];
  const dates = dateIndices.map(i => `<text x="${x(i)}" y="${height - 8}" text-anchor="${i === 0 ? "start" : i === days.length - 1 ? "end" : "middle"}">${escapeHtml(days[i].day.slice(5))}</text>`).join("");
  const dots = available.length <= 31 ? days.map((d, i) => d[metric] === null ? "" : `<circle class="sc-chart-dot" cx="${x(i)}" cy="${y(d[metric])}" r="3"><title>${escapeHtml(d.day)} · ${label} ${number(d[metric])}</title></circle>`).join("") : "";
  $("chart").innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="chartTitle chartDescription"><title id="chartTitle">${escapeHtml(label)}每日趋势</title><desc id="chartDescription">${escapeHtml(state.filter.start)} 至 ${escapeHtml(state.filter.end)}。详细数值可展开下方每日数据表查看；未记录日期不绘制曲线。</desc>${ticks}<path class="sc-chart-line" d="${line}"/>${dots}${dates}</svg>`;
}
function renderDashboard(data) {
  state.dashboard = data;
  renderMetrics(data.today);
  $("metrics").setAttribute("aria-busy", "false");
  $("todayDate").textContent = data.todayDate + " · 北京时间";
  $("updatedAt").textContent = "更新于 " + dateTime(data.updatedAt);
  const sum = key => data.days.reduce((total, day) => total + (day[key] || 0), 0);
  $("rangeSummary").textContent = `所选期间：新增 ${number(sum("newUsers"))} 人 · 图片 ${number(sum("image"))} 张 · 视频 ${number(sum("video"))} 条 · 语音 ${number(sum("audio"))} 条 · 消耗 ${number(sum("credits"))} 积分`;
  $("dailyBody").innerHTML = data.days.map(d => `<tr><td>${d.day}</td>${["newUsers", "activeUsers", "image", "video", "audio", "credits"].map(k => `<td>${number(d[k])}</td>`).join("")}</tr>`).join("");
  $("serviceBody").innerHTML = data.services.map(s => `<tr><td>${escapeHtml(s.label)}</td><td>${number(s.submitted)}</td><td>${number(s.succeeded)}</td><td>${number(s.partial)}</td><td>${number(s.failed)}</td><td>${number(s.running)} / ${number(s.interrupted)}</td><td>${s.successRate === null ? "—" : (s.successRate * 100).toFixed(1) + "%"}</td><td>${s.id.includes("video") ? number(s.video) + " 条视频" : s.id === "audio" ? number(s.audio) + " 条语音" : number(s.image) + " 张图片"}</td><td><button class="btn sm ghost" type="button" data-module="${s.id}">查看</button></td></tr>`).join("");
  $("coverage").textContent = `活跃记录自 ${dateTime(data.coverage.activitySince)} 起启用。${data.coverage.historicalOutputs}`;
  if (data.coverage.lastErrorAt) message("部分统计记录曾写入失败，最近一次发生于 " + dateTime(data.coverage.lastErrorAt) + "；统计可能不完整。", true);
  renderChart();
}
async function loadDashboard() {
  const request = ++state.request;
  $("metrics").setAttribute("aria-busy", "true");
  try {
    const data = await apiGet("/api/service-center/dashboard?" + query());
    if (request === state.request) renderDashboard(data);
  } catch (error) {
    if (request === state.request) {
      message(error.message, true);
      $("metrics").setAttribute("aria-busy", "false");
    }
  }
}
async function loadUsers() {
  const request = ++state.userRequest;
  $("userBody").innerHTML = '<tr><td colspan="9">正在加载用户…</td></tr>';
  try {
    const data = await apiGet("/api/service-center/users?" + query({
      ...state.users,
      keyword: $("keyword").value.trim()
    }));
    if (request !== state.userRequest) return;
    $("userBody").innerHTML = data.items.map(u => `<tr><td><span class="sc-user-name">${escapeHtml(u.username)}</span><span class="sc-user-meta">#${u.id} · ${u.role === "admin" ? "管理员" : "普通用户"}</span></td><td>${dateTime(u.registeredAt)}</td><td>${dateTime(u.lastActiveAt)}</td>${["image", "video", "audio", "consumed", "credits"].map(key => `<td>${number(u[key])}</td>`).join("")}<td><button class="btn sm ghost" data-user="${u.id}" type="button">查看任务</button></td></tr>`).join("") || '<tr><td colspan="9">没有匹配的用户，请调整关键词或勾选“包含管理员”。</td></tr>';
    state.users = {
      page: data.pagination.page,
      pageSize: data.pagination.pageSize
    };
    renderPagination($("userPagination"), {
      ...data.pagination,
      onChange: next => {
        state.users = next;
        loadUsers();
      }
    });
  } catch (error) {
    if (request === state.userRequest) {
      $("userBody").innerHTML = '<tr><td colspan="9">用户明细加载失败，请点击刷新数据重试。</td></tr>';
      message(error.message, true);
    }
  }
}
async function loadTasks() {
  if (!state.taskFilter) return;
  $("taskDescription").textContent = state.taskLabel + " · " + state.filter.start + " 至 " + state.filter.end;
  const request = ++state.taskRequest;
  $("taskBody").innerHTML = '<tr><td colspan="6">正在加载任务…</td></tr>';
  try {
    const data = await apiGet("/api/service-center/tasks?" + query({
      ...state.tasks,
      ...state.taskFilter
    }));
    if (request !== state.taskRequest) return;
    const labels = {
      running: "进行中",
      done: "完整成功",
      partial: "部分成功",
      error: "失败",
      interrupted: "已中断"
    };
    $("taskBody").innerHTML = data.items.map(t => `<tr><td>${escapeHtml(t.username)}</td><td>${escapeHtml(t.moduleLabel)}</td><td>${dateTime(t.createdAt)}</td><td>${dateTime(t.updatedAt)}</td><td><span class="sc-status sc-status-${escapeHtml(t.status)}">${labels[t.status] || escapeHtml(t.status)}</span></td><td>${number(t.outputCount)} ${t.kind === "image" ? "张" : "条"}</td></tr>`).join("") || '<tr><td colspan="6">所选期间没有可核实的任务记录。历史作品记录可能早于任务记录。</td></tr>';
    state.tasks = {
      page: data.pagination.page,
      pageSize: data.pagination.pageSize
    };
    renderPagination($("taskPagination"), {
      ...data.pagination,
      onChange: next => {
        state.tasks = next;
        loadTasks();
      }
    });
  } catch (error) {
    if (request === state.taskRequest) {
      $("taskBody").innerHTML = '<tr><td colspan="6">任务明细加载失败，请点击刷新数据重试。</td></tr>';
      message(error.message, true);
    }
  }
}
async function refresh(reset = false) {
  message("");
  const filter = readFilter();
  if (!filter.start || !filter.end || filter.start > filter.end) {
    message("请选择先后顺序正确的日期范围。", true);
    return;
  }
  if (filter.end > dayOf(Date.now()) || Date.parse(filter.end) - Date.parse(filter.start) > 365 * DAY) {
    message("请选择不晚于今天、最多 366 天的日期范围。", true);
    return;
  }
  state.filter = filter;
  if (reset) {
    state.users.page = 1;
    state.tasks.page = 1;
  }
  $("refresh").disabled = true;
  await Promise.all([loadDashboard(), loadUsers(), loadTasks()]);
  $("refresh").disabled = false;
}
function preset(days) {
  $("endDate").value = dayOf(Date.now());
  $("startDate").value = dayOf(Date.now() - (days - 1) * DAY);
  document.querySelectorAll("[data-days]").forEach(b => b.setAttribute("aria-pressed", String(Number(b.dataset.days) === days)));
}
function showTasks(filter, label) {
  state.taskFilter = filter;
  state.taskLabel = label;
  state.tasks.page = 1;
  $("taskSection").hidden = false;
  $("taskDescription").textContent = label + " · " + state.filter.start + " 至 " + state.filter.end;
  loadTasks();
  $("taskSection").scrollIntoView({
    block: "start",
    behavior: "instant"
  });
}
async function init() {
  const ctx = await mountLayout({
    active: "service-center",
    title: "服务中心",
    crumb: "管理 / 服务中心"
  });
  if (!ctx || ctx.me.role !== "admin") return;
  preset(30);
  $("startDate").max = $("endDate").max = dayOf(Date.now());
  renderMetrics(null);
  $("rangeForm").addEventListener("submit", event => {
    event.preventDefault();
    document.querySelectorAll("[data-days]").forEach(b => b.setAttribute("aria-pressed", "false"));
    refresh(true);
  });
  document.querySelectorAll("[data-days]").forEach(button => button.addEventListener("click", () => {
    preset(Number(button.dataset.days));
    refresh(true);
  }));
  $("refresh").addEventListener("click", () => refresh());
  $("includeAdmins").addEventListener("change", () => refresh(true));
  $("userSearch").addEventListener("submit", event => {
    event.preventDefault();
    state.users.page = 1;
    loadUsers();
  });
  $("chartMetric").addEventListener("change", renderChart);
  window.addEventListener("resize", renderChart);
  $("serviceBody").addEventListener("click", event => {
    const button = event.target.closest("[data-module]");
    if (button) showTasks({
      module: button.dataset.module
    }, button.closest("tr").firstElementChild.textContent);
  });
  $("userBody").addEventListener("click", event => {
    const button = event.target.closest("[data-user]");
    if (button) showTasks({
      userId: button.dataset.user
    }, button.closest("tr").querySelector(".sc-user-name").textContent);
  });
  $("closeTasks").addEventListener("click", () => {
    state.taskRequest++;
    state.taskFilter = null;
    $("taskSection").hidden = true;
    $("usersTitle").scrollIntoView({
      block: "start"
    });
  });
  await refresh();
}
init().catch(error => message(error.message, true));
