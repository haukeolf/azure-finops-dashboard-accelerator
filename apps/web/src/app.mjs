const API_URL = "http://127.0.0.1:7071/api/dashboard";
const FALLBACK_URL = "/data/snapshots/dashboard-snapshot.json";

const formatCurrency = (value) =>
  new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0
  }).format(value);

const formatPercent = (value) =>
  new Intl.NumberFormat("de-DE", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1
  }).format(value) + "%";

async function loadSnapshot() {
  try {
    const response = await fetch(API_URL);
    if (!response.ok) throw new Error(`API returned ${response.status}`);
    const snapshot = await response.json();
    return { snapshot, source: "Local API" };
  } catch {
    const response = await fetch(FALLBACK_URL);
    if (!response.ok) throw new Error(`Fallback returned ${response.status}`);
    const snapshot = await response.json();
    return { snapshot, source: "Static snapshot" };
  }
}

function renderSummary(snapshot) {
  const items = [
    ["Current spend", formatCurrency(snapshot.summary.currentCost), `${formatCurrency(snapshot.summary.deltaMonth)} vs previous month`],
    ["Quarter delta", formatPercent(snapshot.summary.deltaQuarterPercent), "Commercial movement vs previous quarter"],
    ["Commitment coverage", formatPercent(snapshot.summary.commitmentCoveragePercent), "Reservations and Savings Plans"],
    ["Annual savings potential", formatCurrency(snapshot.summary.annualSavingsPotential), "Ranked recommendations"]
  ];

  document.querySelector("#summary").innerHTML = items.map(([label, value, note]) => `
    <article class="kpi">
      <div class="kpi-label">${label}</div>
      <div class="kpi-value">${value}</div>
      <div class="kpi-note">${note}</div>
    </article>
  `).join("");
}

function renderCommercialChanges(snapshot) {
  const max = Math.max(...snapshot.commercialChanges.map((item) => Math.abs(item.delta)));
  document.querySelector("#commercial-changes").innerHTML = snapshot.commercialChanges.map((item) => {
    const width = Math.max(6, Math.round((Math.abs(item.delta) / max) * 100));
    const direction = item.delta >= 0 ? "positive" : "negative";
    return `
      <div class="bar-row ${direction}">
        <div>
          <strong>${item.service}</strong>
          <small>${item.cluster} · ${item.driver}</small>
        </div>
        <div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div>
        <div class="delta">${formatCurrency(item.delta)}</div>
      </div>
    `;
  }).join("");
}

function renderClusters(snapshot) {
  document.querySelector("#clusters").innerHTML = snapshot.serviceClusters.map((cluster) => `
    <div class="cluster-row">
      <div>
        <strong>${cluster.name}</strong>
        <small>${formatCurrency(cluster.cost)} · ${formatPercent(cluster.sharePercent)} share</small>
      </div>
      <span class="badge">${formatCurrency(cluster.deltaMonth)}</span>
    </div>
  `).join("");
}

function renderCommitments(snapshot) {
  const commitment = snapshot.commitments;
  document.querySelector("#commitments").innerHTML = `
    <div class="item">
      <strong>${formatPercent(commitment.reservationCoveragePercent)} reservation coverage</strong>
      <small>${formatPercent(commitment.savingsPlanUtilizationPercent)} Savings Plan utilization</small>
    </div>
    <div class="item">
      <strong>${commitment.expiring.length} commitments expiring</strong>
      <small>${commitment.expiring.map((item) => item.name).join(", ")}</small>
    </div>
  `;
}

function renderAnomalies(snapshot) {
  document.querySelector("#anomalies").innerHTML = snapshot.anomalies.map((item) => `
    <div class="item">
      <span class="badge ${item.severity}">${item.severity}</span>
      <strong>${item.title}</strong>
      <small>${item.scope} · ${item.rootCauseCandidate}</small>
    </div>
  `).join("");
}

function renderRecommendations(snapshot) {
  document.querySelector("#recommendations").innerHTML = snapshot.recommendations.map((item) => `
    <tr>
      <td><strong>${item.title}</strong><br><small>${item.cluster}</small></td>
      <td>${item.scope}</td>
      <td>${item.owner}</td>
      <td>${item.source}</td>
      <td>${item.effort}</td>
      <td class="num">${formatCurrency(item.annualSavings)}</td>
    </tr>
  `).join("");
}

function renderMeta(snapshot, source) {
  document.querySelector("#data-source-label").textContent = source;
  document.querySelector("#snapshot-meta").textContent = `${snapshot.period.label} · generated ${snapshot.generatedAt}`;
}

loadSnapshot()
  .then(({ snapshot, source }) => {
    renderMeta(snapshot, source);
    renderSummary(snapshot);
    renderCommercialChanges(snapshot);
    renderClusters(snapshot);
    renderCommitments(snapshot);
    renderAnomalies(snapshot);
    renderRecommendations(snapshot);
  })
  .catch((error) => {
    document.querySelector("#data-source-label").textContent = "Failed to load data";
    document.querySelector("#snapshot-meta").textContent = error.message;
  });

