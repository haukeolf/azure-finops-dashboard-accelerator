const API_URL = "http://127.0.0.1:7071/api/dashboard";
const FALLBACK_URL = "/data/snapshots/dashboard-snapshot.json";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const eur = (value) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value || 0);
const num = (value) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 }).format(value || 0);
const pct = (value) => `${value >= 0 ? "+" : ""}${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(value || 0)}%`;
const pctAbs = (value) => `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(value || 0)}%`;
// Compact currency: "€ 2.47 M". Custom-built so it stays locale-stable across browsers
// (Intl 'compact' returns "Mio.", "Mrd." in de-DE which doesn't match the inspo).
const eurCompact = (value) => {
  const v = value || 0;
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  const fmt = (n, d = 2) => new Intl.NumberFormat("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
  if (abs >= 1e9) return `${sign}€ ${fmt(abs / 1e9)} B`;
  if (abs >= 1e6) return `${sign}€ ${fmt(abs / 1e6)} M`;
  if (abs >= 1e3) return `${sign}€ ${fmt(abs / 1e3, 1)} k`;
  return `${sign}€ ${fmt(abs, 0)}`;
};
const ptsSigned = (value) => `${value >= 0 ? "+" : ""}${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(value || 0)} pts`;

let doc;                  // full multi-tenant document { tenants, defaultTenant, views }
let snapshot;             // active tenant view (the body the renderers read from)
let selectedTenant = "all";
let selectedBillingAccount = "";
let selectedPeriod = "";
let selectedCompare = "month";
let selectedCluster = "Compute";

const COMPARE_OPTIONS = [
  { id: "month", label: "vs previous month" },
  { id: "quarter", label: "vs previous quarter" },
  { id: "year", label: "vs same month last year" },
];

// The local API only exists during dev (make api). Skip the probe when the page is
// hosted off-box (Azure Static Web Apps etc.) so we don't waste a roundtrip + error log.
const isLocalHost = typeof location !== "undefined" && /^(127\.0\.0\.1|localhost|0\.0\.0\.0)$/.test(location.hostname);

async function loadDocument() {
  if (isLocalHost) {
    try {
      const response = await fetch(API_URL);
      if (response.ok) return await response.json();
    } catch {
      // fall through to static snapshot
    }
  }
  const response = await fetch(FALLBACK_URL);
  if (!response.ok) throw new Error(`Snapshot fetch failed: ${response.status}`);
  return await response.json();
}

function classForDelta(value) {
  if (value < 0) return "negative";
  if (value > 0) return "positive";
  return "";
}

function clearCanvas(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(rect.width * ratio));
  canvas.height = Math.max(1, Math.floor(rect.height * ratio));
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  return { ctx, width: rect.width, height: rect.height };
}

function palette() {
  return [css("--cp-accent"), css("--cp-link"), css("--cp-warning"), css("--cp-success"), css("--cp-danger"), css("--cp-border-strong"), css("--cp-text-soft"), css("--cp-text-muted")];
}

function drawBarChart(canvasId, labels, series, options = {}) {
  const canvas = $(`#${canvasId}`);
  if (!canvas || !canvas.offsetParent) return;
  const { ctx, width, height } = clearCanvas(canvas);
  const pad = { top: 16, right: 18, bottom: 44, left: 48 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const colors = palette();
  const max = Math.max(...series.flatMap((s) => s.values), 1);
  const groups = labels.length;
  const barW = plotW / groups / (series.length + 0.5);

  ctx.strokeStyle = css("--cp-border");
  ctx.fillStyle = css("--cp-text-muted");
  ctx.font = "12px Segoe UI, Aptos, Calibri, sans-serif";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 3; i += 1) {
    const y = pad.top + (plotH / 3) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
  }

  labels.forEach((label, i) => {
    const x0 = pad.left + (plotW / groups) * i;
    series.forEach((s, si) => {
      const value = s.values[i] || 0;
      const h = (value / max) * plotH;
      ctx.fillStyle = colors[si % colors.length];
      ctx.fillRect(x0 + si * barW + 4, pad.top + plotH - h, Math.max(4, barW - 4), h);
    });
    ctx.save();
    ctx.translate(x0 + 4, height - 18);
    ctx.rotate(options.rotateLabels ? -0.55 : 0);
    ctx.fillStyle = css("--cp-text-muted");
    ctx.fillText(label, 0, 0);
    ctx.restore();
  });
}

function drawLineChart(canvasId, labels, series, options = {}) {
  const canvas = $(`#${canvasId}`);
  if (!canvas || !canvas.offsetParent) return;
  const { ctx, width, height } = clearCanvas(canvas);
  const pad = { top: 18, right: 18, bottom: 36, left: 48 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const band = options.band;
  const bandValues = band ? [...band.lower, ...band.upper] : [];
  const values = [...series.flatMap((s) => s.values), ...bandValues].filter((v) => typeof v === "number");
  const min = Math.min(...values);
  const max = Math.max(...values);
  const colors = palette();
  const x = (i) => pad.left + (plotW / Math.max(1, labels.length - 1)) * i;
  const y = (v) => pad.top + plotH - ((v - min) / Math.max(1, max - min)) * plotH;

  ctx.strokeStyle = css("--cp-border");
  for (let i = 0; i <= 3; i += 1) {
    const gy = pad.top + (plotH / 3) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, gy);
    ctx.lineTo(width - pad.right, gy);
    ctx.stroke();
  }

  if (band) {
    const points = labels.map((_, i) => i).filter((i) => typeof band.lower[i] === "number" && typeof band.upper[i] === "number");
    if (points.length > 1) {
      ctx.beginPath();
      points.forEach((i, idx) => (idx === 0 ? ctx.moveTo(x(i), y(band.upper[i])) : ctx.lineTo(x(i), y(band.upper[i]))));
      [...points].reverse().forEach((i) => ctx.lineTo(x(i), y(band.lower[i])));
      ctx.closePath();
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = css("--cp-link");
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  ctx.font = "12px Segoe UI, Aptos, Calibri, sans-serif";
  ctx.fillStyle = css("--cp-text-muted");
  labels.forEach((label, i) => {
    if (i % Math.ceil(labels.length / 6) === 0) ctx.fillText(label, x(i) - 12, height - 10);
  });

  series.forEach((s, si) => {
    ctx.strokeStyle = colors[si % colors.length];
    ctx.lineWidth = 3;
    ctx.beginPath();
    s.values.forEach((value, i) => {
      if (typeof value !== "number") return;
      if (i === 0 || typeof s.values[i - 1] !== "number") ctx.moveTo(x(i), y(value));
      else ctx.lineTo(x(i), y(value));
    });
    ctx.stroke();
  });
}

function drawStackedTrend() {
  const canvas = $("#chart-trend");
  if (!canvas || !canvas.offsetParent) return;
  const { ctx, width, height } = clearCanvas(canvas);
  const pad = { top: 18, right: 18, bottom: 42, left: 56 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const labels = snapshot.trend.labels;
  const series = snapshot.trend.series;
  const colors = palette();
  const totals = labels.map((_, i) => series.reduce((sum, s) => sum + s.values[i], 0));
  const max = Math.max(...totals, 1);
  const barW = plotW / labels.length * 0.72;

  ctx.strokeStyle = css("--cp-border");
  ctx.font = "12px Segoe UI, Aptos, Calibri, sans-serif";
  ctx.fillStyle = css("--cp-text-muted");
  for (let i = 0; i <= 4; i += 1) {
    const y = pad.top + (plotH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
  }
  labels.forEach((label, i) => {
    let yBase = pad.top + plotH;
    const x = pad.left + (plotW / labels.length) * i + (plotW / labels.length - barW) / 2;
    series.forEach((s, si) => {
      const h = (s.values[i] / max) * plotH;
      ctx.fillStyle = colors[si % colors.length];
      ctx.fillRect(x, yBase - h, barW, h);
      yBase -= h;
    });
    ctx.fillStyle = css("--cp-text-muted");
    ctx.fillText(label, x - 3, height - 12);
  });
  $("#legend-trend").innerHTML = series.map((s, i) => `<span><i class="dot" style="background: ${palette()[i % palette().length]}"></i>${s.name}</span>`).join("");
}

function renderMeta() {
  const accounts = doc.billingAccounts || [];
  const account = accounts.find((a) => a.id === selectedBillingAccount) || accounts[0] || { label: "—" };
  $("#billing-account-label").textContent = account.label;
  $("#currency-label").textContent = snapshot.summary.currency || "—";
  const refreshed = new Date(doc.generatedAt);
  $("#snapshot-meta").textContent = isNaN(refreshed) ? "—" : `${refreshed.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC`;
  $("#page-title").textContent = `Azure Cost Analytics — ${snapshot.summary.monthTitle}`;
}

// `tone` drives badge color: "up" = red (cost going the wrong way), "down" = green
// (cost going the right way), "neutral" = muted. This is per-KPI editorial: e.g.
// rising savings-plan utilization uses ▲ but the green tone because more is better.
function renderSummary() {
  const s = snapshot.summary;
  const a = s.openAnomalies;
  const monthMoM = s.compare.month;
  const items = [
    {
      label: "Current month spend",
      value: eurCompact(s.currentCost),
      sub: `MTD · ${s.daysElapsed} days · forecast ${eurCompact(s.currentMonthForecast)}`,
      delta: { arrow: monthMoM.delta >= 0 ? "▲" : "▼", text: `${pct(monthMoM.deltaPercent)} MoM`, tone: monthMoM.delta >= 0 ? "up" : "down" },
    },
    {
      label: "Quarter-to-date",
      value: eurCompact(s.qtdTotal),
      sub: s.qtdLabel,
      delta: { arrow: s.qtdDeltaPercent >= 0 ? "▲" : "▼", text: `${pct(s.qtdDeltaPercent)} QoQ`, tone: s.qtdDeltaPercent >= 0 ? "up" : "down" },
    },
    {
      label: "Year-to-date",
      value: eurCompact(s.ytdTotal),
      sub: `vs. budget ${eurCompact(s.budget)} (${pct(s.ytdVsBudgetPercent)})`,
      delta: { arrow: s.ytdVsBudgetPercent <= 0 ? "▼" : "▲", text: `${pctAbs(Math.abs(s.ytdVsBudgetPercent))} vs budget`, tone: s.ytdVsBudgetPercent <= 0 ? "down" : "up" },
    },
    {
      label: "Reservation coverage",
      value: pctAbs(s.reservationCoveragePercent),
      sub: `eligible compute · target ${s.reservationTargetPercent}%`,
      delta: { arrow: "−", text: `−${s.reservationGapPts.toFixed(1)} pts to target`, tone: "neutral" },
    },
    {
      label: "Savings plan utilization",
      value: pctAbs(s.savingsPlanUtilizationPercent),
      sub: `${eurCompact(s.savingsPlanHourlyCommitment)}/h commitment`,
      delta: { arrow: s.savingsPlanUtilizationMomPts >= 0 ? "▲" : "▼", text: `${ptsSigned(s.savingsPlanUtilizationMomPts)} MoM`, tone: s.savingsPlanUtilizationMomPts >= 0 ? "down" : "up" },
    },
    {
      label: "Open anomalies",
      value: String(a.count),
      sub: `${a.high} high · ${a.medium} medium · ${a.wins} wins`,
      delta: { arrow: a.newThisWeek > 0 ? "▲" : "−", text: `${a.newThisWeek} new this week`, tone: a.newThisWeek > 0 ? "up" : "neutral" },
    },
  ];
  $("#summary").innerHTML = items.map((k) => `<article class="kpi"><div class="kpi-label">${k.label}</div><div class="kpi-value">${k.value}</div><div class="kpi-sub">${k.sub}</div><span class="kpi-badge ${k.delta.tone}">${k.delta.arrow} ${k.delta.text}</span></article>`).join("");
}

function buildWaterfall(mode) {
  if (mode === "quarter") {
    const qr = snapshot.quarterRollup;
    const prev = Object.values(qr.previous).reduce((a, b) => a + b, 0);
    const curr = Object.values(qr.current).reduce((a, b) => a + b, 0);
    const drivers = Object.keys(qr.current)
      .map((name) => ({ label: name, value: qr.current[name] - qr.previous[name] }))
      .filter((d) => d.value !== 0)
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    return [
      { label: "Previous quarter", value: prev, type: "total" },
      ...drivers.map((d) => ({ ...d, type: d.value >= 0 ? "up" : "down" })),
      { label: "Current quarter", value: curr, type: "total" },
    ];
  }
  if (mode === "year") {
    const series = snapshot.trend.series;
    const last = series[0].values.length - 1;
    const prev = series.reduce((sum, s) => sum + s.values[0], 0);
    const curr = series.reduce((sum, s) => sum + s.values[last], 0);
    const drivers = series
      .map((s) => ({ label: s.name, value: s.values[last] - s.values[0] }))
      .filter((d) => d.value !== 0)
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    return [
      { label: "12 months ago", value: prev, type: "total" },
      ...drivers.map((d) => ({ ...d, type: d.value >= 0 ? "up" : "down" })),
      { label: "Current month", value: curr, type: "total" },
    ];
  }
  return snapshot.waterfall;
}

function waterfallHeadings(mode) {
  const labels = snapshot.trend.labels;
  const prevMonth = labels[labels.length - 2] || "previous month";
  const currMonth = labels[labels.length - 1] || "current month";
  if (mode === "quarter") return ["Quarter-on-quarter change decomposition", "Waterfall: previous quarter → current quarter, drivers by cluster."];
  if (mode === "year") return ["Year-on-year change decomposition", "Waterfall: 12 months ago → current month, drivers by cluster."];
  return ["Month-on-month change decomposition", `Waterfall: ${prevMonth} → ${currMonth} forecast, drivers by cluster.`];
}

function renderWaterfall() {
  const [title, sub] = waterfallHeadings(selectedCompare);
  $("#waterfall-title").textContent = title;
  $("#waterfall-sub").textContent = sub;
  const rows = buildWaterfall(selectedCompare);
  const max = Math.max(...rows.map((item) => Math.abs(item.value)), 1);
  $("#waterfall").innerHTML = rows.map((item) => {
    const width = Math.max(6, Math.round(Math.abs(item.value) / max * 100));
    const cls = item.type === "down" ? "good" : item.type === "total" ? "warn" : "";
    return `<div class="waterfall-row"><strong>${item.label}</strong><div class="track"><div class="fill ${cls}" style="width:${width}%"></div></div><span class="num ${classForDelta(item.value)}">${eur(item.value)}</span></div>`;
  }).join("");
}

function renderCommercial() {
  $("#service-mom-table").innerHTML = snapshot.commercialChanges.map((item) => `<tr><td><strong>${item.service}</strong></td><td>${item.cluster}</td><td class="num">${eur(item.previousCost)}</td><td class="num">${eur(item.currentCost)}</td><td class="num ${classForDelta(item.delta)}">${eur(item.delta)}</td><td class="num ${classForDelta(item.deltaPercent)}">${pct(item.deltaPercent)}</td><td>${item.driver}</td></tr>`).join("");
  const labels = snapshot.serviceClusters.map((item) => item.name);
  drawBarChart("chart-cluster-mom", labels, [
    { name: "Previous", values: snapshot.serviceClusters.map((item) => item.previousCost || 0) },
    { name: "Current", values: snapshot.serviceClusters.map((item) => item.cost) },
  ], { rotateLabels: true });
  drawBarChart("chart-cluster-qoq", Object.keys(snapshot.quarterRollup.current), [
    { name: "Previous quarter", values: Object.values(snapshot.quarterRollup.previous) },
    { name: "Current quarter", values: Object.values(snapshot.quarterRollup.current) },
  ], { rotateLabels: true });
  drawLineChart("chart-unitprice", snapshot.unitPriceIndex.labels, snapshot.unitPriceIndex.series);
}

function renderClusterTabs() {
  const names = Object.keys(snapshot.clusterDetails);
  if (!names.includes(selectedCluster)) selectedCluster = names[0];
  $("#cluster-tabs").innerHTML = names.map((name) => `<button class="cluster-tab ${name === selectedCluster ? "active" : ""}" data-cluster="${name}">${name}</button>`).join("");
  $$(".cluster-tab").forEach((button) => button.addEventListener("click", () => {
    selectedCluster = button.dataset.cluster;
    renderServices();
  }));
}

function renderServices() {
  renderClusterTabs();
  const detail = snapshot.clusterDetails[selectedCluster];
  $("#cluster-title").textContent = `${selectedCluster} trend`;
  $("#cluster-subtitle").textContent = detail.description;
  drawLineChart("chart-cluster-detail", snapshot.trend.labels, [{ name: selectedCluster, values: detail.trend }]);
  $("#cluster-meter-table").innerHTML = detail.meters.map((m) => `<tr><td>${m.meter}</td><td class="num">${num(m.quantity)}</td><td>${m.unit}</td><td class="num">${eur(m.cost)}</td><td class="num ${classForDelta(m.deltaPercent)}">${pct(m.deltaPercent)}</td></tr>`).join("");
  $("#cluster-resource-table").innerHTML = detail.resources.map((r, i) => `<tr class="clickable" data-resource="${i}"><td><small>${r.id}</small></td><td>${r.subscription}</td><td>${r.region}</td><td class="num">${eur(r.mtdCost)}</td><td class="num ${classForDelta(r.deltaPercent)}">${pct(r.deltaPercent)}</td><td>${r.pricing}</td></tr>`).join("");
  $$("#cluster-resource-table tr").forEach((row) => row.addEventListener("click", () => openResourceDetail(Number(row.dataset.resource))));
}

function openResourceDetail(index) {
  const r = snapshot.clusterDetails[selectedCluster].resources[index];
  $("#resource-detail-title").textContent = `Root cause: ${r.subscription}`;
  $("#resource-detail-body").innerHTML = `<p><strong>Resource:</strong> ${r.id}</p><p><strong>Tags:</strong> ${r.tags}</p><p><strong>Candidate cause:</strong> ${r.cause}</p>`;
  $("#resource-detail-panel").classList.add("open");
}

function renderAccounts() {
  $("#movers-up-table").innerHTML = snapshot.moversUp.map((m) => `<tr><td>${m.subscription}</td><td>${m.owner}</td><td class="num positive">${eur(m.delta)}</td><td class="num positive">${pct(m.deltaPercent)}</td><td>${m.driver}</td></tr>`).join("");
  $("#movers-down-table").innerHTML = snapshot.moversDown.map((m) => `<tr><td>${m.subscription}</td><td>${m.owner}</td><td class="num negative">${eur(m.delta)}</td><td class="num negative">${pct(m.deltaPercent)}</td><td>${m.driver}</td></tr>`).join("");
  $("#subscriptions-table").innerHTML = snapshot.subscriptions.map((s) => `<tr><td>${s.name}</td><td>${s.tenant}</td><td>${s.owner}<br><small>${s.costCenter}</small></td><td class="num">${eur(s.currentCost)}</td><td class="num">${eur(s.averageSixMonths)}</td><td class="num ${classForDelta(s.deltaVsAverage)}">${eur(s.deltaVsAverage)}</td><td><canvas class="spark" width="120" height="30" data-values="${s.spark.join(",")}"></canvas></td><td><span class="badge">${s.status}</span></td></tr>`).join("");
  drawSparklines();
}

function drawSparklines() {
  $$(".spark").forEach((canvas) => {
    const values = canvas.dataset.values.split(",").map(Number);
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    const min = Math.min(...values);
    const max = Math.max(...values);
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = css("--cp-accent");
    ctx.lineWidth = 2;
    ctx.beginPath();
    values.forEach((v, i) => {
      const x = (w / (values.length - 1)) * i;
      const y = h - ((v - min) / Math.max(1, max - min)) * (h - 4) - 2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  });
}

function renderCommitments() {
  const c = snapshot.commitments;
  $("#ri-coverage").textContent = pctAbs(c.reservationCoveragePercent);
  $("#sp-utilization").textContent = pctAbs(c.savingsPlanUtilizationPercent);
  $("#ri-coverage-bar").style.width = `${c.reservationCoveragePercent}%`;
  $("#sp-utilization-bar").style.width = `${c.savingsPlanUtilizationPercent}%`;
  drawLineChart("chart-savings", snapshot.trend.labels, [{ name: "Savings", values: c.savings12m }]);
  const maxMix = Math.max(...c.commitmentMix.map((item) => item.hourly), 1);
  $("#commitment-mix").innerHTML = c.commitmentMix.map((item) => `<div><strong>${item.name}</strong><div class="track"><div class="fill" style="width:${Math.round(item.hourly / maxMix * 100)}%"></div></div><small>${eur(item.hourly)} hourly normalized</small></div>`).join("");
  $("#expiring-table").innerHTML = c.expiring.map((item) => `<tr><td>${item.name}</td><td>${item.type}</td><td class="num">${eur(item.hourly || 0)}</td><td>${item.expiresOn}</td><td class="num">${pctAbs(item.utilizationPercent)}</td><td>${item.recommendation || "Review renewal"}</td></tr>`).join("");
  $("#commitment-recs-table").innerHTML = c.purchaseRecommendations.map((item) => `<tr><td>${item.title}</td><td>${item.scope}</td><td class="num">${eur(item.upfront || 0)}</td><td class="num">${eur(item.annualSavings)}</td><td>${item.roi || "n/a"}</td></tr>`).join("");
}

function renderAnomalies() {
  $("#anomaly-list").innerHTML = snapshot.anomalies.map((a) => `<article class="anomaly-card ${a.severity}"><span class="badge ${a.severity}">${a.severity}</span><h3>${a.title}</h3><p>${a.rootCauseCandidate}</p><small>${a.scope} · ${a.owner} · metric: ${a.relatedMetric}</small><p><strong>Recommendation:</strong> ${a.recommendation}</p></article>`).join("");
  const labels = snapshot.anomalySummary.labels;
  drawBarChart("chart-anomaly-summary", labels, [
    { name: "High", values: snapshot.anomalySummary.high },
    { name: "Medium", values: snapshot.anomalySummary.medium },
    { name: "Win", values: snapshot.anomalySummary.win },
  ], { rotateLabels: true });
  drawLineChart("chart-forecast", snapshot.forecast.labels, [
    { name: "Actual", values: snapshot.forecast.actual },
    { name: "Forecast", values: snapshot.forecast.forecast },
  ], { band: { lower: snapshot.forecast.lower, upper: snapshot.forecast.upper } });
}

function populateRecommendationFilters() {
  const tenants = ["all", ...new Set(snapshot.recommendations.map((r) => r.tenant))];
  const clusters = ["all", ...new Set(snapshot.recommendations.map((r) => r.cluster))];
  const efforts = ["all", ...new Set(snapshot.recommendations.map((r) => r.effort))];
  $("#rec-tenant").innerHTML = tenants.map((v) => `<option value="${v}">${v}</option>`).join("");
  $("#rec-cluster").innerHTML = clusters.map((v) => `<option value="${v}">${v}</option>`).join("");
  $("#rec-effort").innerHTML = efforts.map((v) => `<option value="${v}">${v}</option>`).join("");
  ["#rec-tenant", "#rec-cluster", "#rec-effort"].forEach((id) => { $(id).onchange = renderRecommendations; });
}

function renderRecommendations() {
  const tenant = $("#rec-tenant").value || "all";
  const cluster = $("#rec-cluster").value || "all";
  const effort = $("#rec-effort").value || "all";
  const rows = snapshot.recommendations.filter((r) => (tenant === "all" || r.tenant === tenant) && (cluster === "all" || r.cluster === cluster) && (effort === "all" || r.effort === effort));
  $("#rec-summary").textContent = `${rows.length} recommendations · ${eur(rows.reduce((sum, r) => sum + r.annualSavings, 0))} annual savings`;
  $("#recommendation-list").innerHTML = rows.map((r) => `<div class="recommendation-row"><div><strong>${r.title}</strong><br><small>${r.scope} · ${r.owner}</small></div><span>${r.cluster}</span><span>${r.effort}</span><strong class="num">${eur(r.annualSavings)}</strong></div>`).join("");
}

function renderDataSources() {
  $("#dataset-table").innerHTML = snapshot.dataSources.datasets.map((d) => `<tr><td>${d.dataset}</td><td>${d.scope}</td><td>${d.frequency}</td><td>${d.schema}</td></tr>`).join("");
  $("#field-table").innerHTML = snapshot.dataSources.fields.map((f) => `<tr><td>${f.field}</td><td>${f.usedFor}</td></tr>`).join("");
  $("#architecture-text").textContent = snapshot.dataSources.architecture;
}

function renderGlossary() {
  $("#glossary-clusters").innerHTML = snapshot.glossary.clusters.map((g) => `<tr><td>${g.cluster}</td><td>${g.includes}</td></tr>`).join("");
  $("#methodology").innerHTML = snapshot.glossary.methodology.map((m) => `<p class="method-card">${m}</p>`).join("");
}

function renderAll() {
  renderMeta();
  renderSummary();
  renderWaterfall();
  renderCommercial();
  renderServices();
  renderAccounts();
  renderCommitments();
  renderAnomalies();
  populateRecommendationFilters();
  renderRecommendations();
  renderDataSources();
  renderGlossary();
  drawStackedTrend();
}

function showSection(id) {
  $$(".nav-link").forEach((button) => button.classList.toggle("active", button.dataset.section === id));
  $$(".dashboard-section").forEach((section) => section.classList.toggle("active", section.id === id));
  requestAnimationFrame(() => {
    drawStackedTrend();
    renderCommercial();
    renderServices();
    renderCommitments();
    renderAnomalies();
    drawSparklines();
  });
}

function renderActiveView() {
  snapshot = doc.views[selectedTenant] || doc.views[doc.defaultTenant];
  renderAll();
}

function setupGlobalControls() {
  const tenantSelect = $("#global-tenant");
  tenantSelect.innerHTML = doc.tenants.map((t) => `<option value="${t.id}">${t.label}</option>`).join("");
  tenantSelect.value = selectedTenant;
  tenantSelect.onchange = () => {
    selectedTenant = tenantSelect.value;
    renderActiveView();
  };

  const billingSelect = $("#global-billing-account");
  const accounts = doc.billingAccounts || [];
  billingSelect.innerHTML = accounts.map((a) => `<option value="${a.id}">${a.label}</option>`).join("");
  billingSelect.value = selectedBillingAccount;
  if (accounts.length <= 1) billingSelect.setAttribute("disabled", "");
  billingSelect.onchange = () => {
    selectedBillingAccount = billingSelect.value;
    renderMeta();
  };

  const periodSelect = $("#global-period");
  const periods = doc.periodOptions || [];
  periodSelect.innerHTML = periods.map((p) => `<option value="${p.id}">${p.label}</option>`).join("");
  periodSelect.value = selectedPeriod;
  if (periods.length <= 1) periodSelect.setAttribute("disabled", "");
  periodSelect.onchange = () => {
    selectedPeriod = periodSelect.value;
    // Placeholder: snapshot only carries MTD data today.
  };

  const compareSelect = $("#global-compare");
  compareSelect.innerHTML = COMPARE_OPTIONS.map((o) => `<option value="${o.id}">${o.label}</option>`).join("");
  compareSelect.value = selectedCompare;
  compareSelect.onchange = () => {
    selectedCompare = compareSelect.value;
    renderSummary();
    renderWaterfall();
  };
}

$$(".nav-link").forEach((button) => button.addEventListener("click", () => showSection(button.dataset.section)));
$("#detail-close").addEventListener("click", () => $("#resource-detail-panel").classList.remove("open"));
$("#theme-toggle").addEventListener("click", () => {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  requestAnimationFrame(() => renderActiveView());
});
window.addEventListener("resize", () => snapshot && requestAnimationFrame(() => renderActiveView()));

loadDocument()
  .then((loaded) => {
    doc = loaded;
    selectedTenant = doc.views[doc.defaultTenant] ? doc.defaultTenant : Object.keys(doc.views)[0];
    selectedBillingAccount = doc.defaultBillingAccount || (doc.billingAccounts && doc.billingAccounts[0]?.id) || "";
    selectedPeriod = doc.defaultPeriod || (doc.periodOptions && doc.periodOptions[0]?.id) || "";
    setupGlobalControls();
    renderActiveView();
  })
  .catch((error) => {
    $("#billing-account-label").textContent = "Failed to load";
    $("#snapshot-meta").textContent = error.message;
  });
