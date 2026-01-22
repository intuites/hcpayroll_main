/* ================= API ================= */
const API_URL = window.location.origin + "/api"; // ✅ Vercel + local works

/* ================= DOM ================= */
const candidateList = document.getElementById("candidateList");
const generateBtn = document.getElementById("generateBtn");
const fromDateInput = document.getElementById("fromDate");
const toDateInput = document.getElementById("toDate");
const previewContainer = document.getElementById("payrollPreview");

/* ================= TOGGLE PAYROLL ================= */
const toggleBtn = document.getElementById("togglePayroll");
const payrollCard = document.getElementById("payrollCard");

/* ================= STATE ================= */
let payrollRows = [];
let previewTimer = null;

/* ================= UTIL ================= */
function parseNumberOrNull(v) {
  if (v === "" || v === null || v === undefined) return null;
  const num = Number(v);
  return Number.isNaN(num) ? null : num;
}

function safeText(v) {
  return v === null || v === undefined ? "" : String(v);
}

/* ================= EDITABLE FIELDS ================= */
const EDITABLE_FIELDS = [
  "reg_hours",
  "ot_hours",
  "holiday_hours",

  "w2_rate",
  "stipend_rate",
  "ot_rate",
  "holiday_rate",

  "sign_bonus",

  "client_standard_bill_rate",
  "client_ot_bill_rate",
  "client_holiday_bill_rate",

  "total_candidate_expense",

  "missed_payment_amount",
  "missed_payment_type",
];

/* ================= HELPERS ================= */
function formatPayrollName(from, to) {
  return `payroll_${from}_${to}`;
}

function formatDateMMDDYYYY(dateStr) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${mm}-${dd}-${yyyy}`;
}

async function safeJson(res) {
  // If API returns HTML error, json() will crash. This prevents it.
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

/* ================= Show / Hide Payroll ================= */
if (toggleBtn && payrollCard) {
  toggleBtn.textContent = "Generate Payroll";

  toggleBtn.addEventListener("click", () => {
    const isHidden =
      payrollCard.style.display === "none" ||
      getComputedStyle(payrollCard).display === "none";

    payrollCard.style.display = isHidden ? "block" : "none";
    toggleBtn.textContent = isHidden ? "Hide Payroll" : "Generate Payroll";
  });
}

/* ================= Generate Button Enable/Disable ================= */
function updateGenerateState() {
  const hasFrom = !!fromDateInput?.value;
  const hasTo = !!toDateInput?.value;
  generateBtn.disabled = !(hasFrom && hasTo);
}

fromDateInput?.addEventListener("change", updateGenerateState);
toDateInput?.addEventListener("change", updateGenerateState);
updateGenerateState();

/* ================= LOAD CANDIDATES ================= */
async function loadCandidates() {
  try {
    candidateList.innerHTML = "Loading candidates...";

    const res = await fetch(`${API_URL}/candidates`);
    const candidates = await safeJson(res);

    if (!res.ok) {
      console.error("Candidates API error:", candidates);
      candidateList.innerHTML = "Failed to load candidates.";
      return;
    }

    if (!Array.isArray(candidates)) {
      console.error("Candidates API returned non-array:", candidates);
      candidateList.innerHTML = "Invalid candidates response.";
      return;
    }

    candidateList.innerHTML = `
      <table>
        <thead>
          <tr>
            <th></th>
            <th>Name</th>
            <th>Reg</th>
            <th>OT</th>
            <th>Holiday</th>
          </tr>
        </thead>
        <tbody>
          ${candidates
            .map(
              (c) => `
              <tr>
                <td>
                  <input
                    type="checkbox"
                    class="candidate-checkbox"
                    value="${safeText(c.candidate_uuid)}"
                  />
                </td>
                <td class="candidate-name">${safeText(c.candidate_name)}</td>
                <td><input type="number" class="reg_hours" value="0" step="0.5" /></td>
                <td><input type="number" class="ot_hours" value="0" step="0.5" /></td>
                <td><input type="number" class="holiday_hours" value="0" step="0.5" /></td>
              </tr>
            `
            )
            .join("")}
        </tbody>
      </table>
    `;
  } catch (err) {
    console.error("loadCandidates crash:", err);
    candidateList.innerHTML = "Error loading candidates.";
  }
}

/* ================= GENERATE PREVIEW ================= */
generateBtn?.addEventListener("click", async (e) => {
  e.preventDefault();

  try {
    if (!fromDateInput.value || !toDateInput.value) {
      alert("Please select Start Date and End Date");
      return;
    }

    if (new Date(fromDateInput.value) > new Date(toDateInput.value)) {
      alert("End Date cannot be before Start Date");
      return;
    }

    const candidates = [];

    document.querySelectorAll(".candidate-checkbox:checked").forEach((cb) => {
      const row = cb.closest("tr");
      if (!row) return;

      candidates.push({
        id: cb.value,
        reg_hours: parseNumberOrNull(row.querySelector(".reg_hours")?.value),
        ot_hours: parseNumberOrNull(row.querySelector(".ot_hours")?.value),
        holiday_hours: parseNumberOrNull(
          row.querySelector(".holiday_hours")?.value
        ),
      });
    });

    if (!candidates.length) {
      alert("Select at least one candidate");
      return;
    }

    previewContainer.innerHTML = "Generating preview...";

    const res = await fetch(`${API_URL}/payroll?action=preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidates }),
    });

    const data = await safeJson(res);

    if (!res.ok || !Array.isArray(data.rows)) {
      console.error("Preview error:", data);
      alert(data.error || "Payroll preview failed");
      previewContainer.innerHTML = "";
      return;
    }

    payrollRows = data.rows;
    renderPayrollTable();
  } catch (err) {
    console.error("Generate preview crash:", err);
    alert("Preview failed. Check console logs.");
  }
});

/* ================= TABLE RENDER ================= */
function renderPayrollTable() {
  const headers = [
    ["candidate_name", "NAME"],
    ["total_hours", "TOTAL"],
    ["reg_hours", "REG"],
    ["ot_hours", "OT"],
    ["holiday_hours", "HOL"],

    ["w2_rate", "W2"],
    ["stipend_rate", "STIPEND"],
    ["ot_rate", "OT RATE"],
    ["holiday_rate", "HOL RATE"],

    ["guaranteed", "GUAR"],
    ["standard_w2_amount", "STD W2"],
    ["ot_amount", "OT AMT"],
    ["holiday_amount", "HOL AMT"],
    ["sign_bonus", "BONUS"],
    ["overall_bonus", "OVERALL"],

    ["total_pay", "GUSTO PAY"],
    ["standard_stipend_amount", "STIPEND AMT"],
    ["total_payable", "TOTAL PAYABLE"],

    ["missed_payment_amount", "MISSED AMT"],
    ["missed_payment_type", "MISSED TYPE"],

    ["total_candidate_expense", "CANDIDATE EXP"],

    ["client_standard_bill_rate", "CLIENT STD"],
    ["vms_charges", "VMS"],
    ["client_standard_amount", "CLIENT STD AMT"],
    ["client_ot_bill_rate", "CLIENT OT"],
    ["client_holiday_bill_rate", "CLIENT HOL"],
    ["client_ot_holiday_amount", "OT/HOL AMT"],
    ["total_amount_received_from_client", "RECEIVED"],
    ["net_profit", "NET PROFIT"],
  ];

  previewContainer.innerHTML = `
    <div class="payroll-table-wrapper">
      <table class="payroll-table">
        <thead>
          <tr>
            ${headers.map((h) => `<th>${h[1]}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${payrollRows
            .map(
              (row, r) => `
                <tr>
                  ${headers
                    .map(([key]) => {
                      const isEditable = EDITABLE_FIELDS.includes(key);

                      if (key === "missed_payment_type") {
                        return `
                          <td data-row="${r}" data-key="${key}" class="editable">
                            ${renderMissedType(row[key])}
                          </td>
                        `;
                      }

                      return `
                        <td
                          data-row="${r}"
                          data-key="${key}"
                          class="${isEditable ? "editable" : "readonly"}"
                          ${isEditable ? 'contenteditable="true"' : ""}
                        >
                          ${safeText(row[key])}
                        </td>
                      `;
                    })
                    .join("")}
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </div>

    <div class="payroll-footer">
      <div class="payroll-actions">
        <button id="saveBtn" class="btn primary">Save Payroll</button>
        <button id="downloadBtn" class="btn secondary">Download Payroll</button>
      </div>

      <div id="reportTotals"></div>
    </div>
  `;

  previewContainer
    .querySelectorAll("[contenteditable]")
    .forEach((td) => td.addEventListener("blur", onCellEdit));

  previewContainer
    .querySelectorAll(".missed-type")
    .forEach((sel) => sel.addEventListener("change", onMissedTypeChange));

  document.getElementById("saveBtn").onclick = savePayroll;
  document.getElementById("downloadBtn").onclick = downloadPayroll;

  const totals = calculateGrossReportTotals(payrollRows);
  renderReportTotals(totals);

  // highlight negative profit
  previewContainer.querySelectorAll('[data-key="net_profit"]').forEach((td) => {
    const v = Number(td.textContent);
    if (!Number.isNaN(v) && v < 0) td.classList.add("negative");
  });
}

/* ================= REPORT TOTALS ================= */
function calculateGrossReportTotals(rows) {
  const sum = (key) => rows.reduce((t, r) => t + Number(r[key] || 0), 0);

  const totalBonus = sum("overall_bonus");
  const totalGrossPay = sum("total_pay");
  const totalReimbursement = sum("standard_stipend_amount");

  return {
    totalBonus,
    totalGrossPay,
    totalReimbursement,
    totalEarnings: totalGrossPay + totalReimbursement,
  };
}

function renderReportTotals(totals) {
  const container = document.getElementById("reportTotals");
  if (!container) return;

  if (!totals) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = `
    <div class="report-totals-wrapper">
      <div class="report-totals-card">
        <div class="report-totals-header">Report Totals</div>

        <div class="report-totals-body">
          <div class="totals-row">
            <span>Total Bonus</span>
            <strong>${totals.totalBonus.toFixed(2)}</strong>
          </div>

          <div class="totals-row">
            <span>GUSTO TOTAL Gross Pay</span>
            <strong>${totals.totalGrossPay.toFixed(2)}</strong>
          </div>

          <div class="totals-row">
            <span>GUSTO Total Reimbursement</span>
            <strong>${totals.totalReimbursement.toFixed(2)}</strong>
          </div>

          <div class="totals-row totals-highlight">
            <span>Total Earnings</span>
            <strong>${totals.totalEarnings.toFixed(2)}</strong>
          </div>
        </div>
      </div>
    </div>
  `;
}

/* ================= DROPDOWN ================= */
function renderMissedType(value) {
  return `
    <select class="missed-type">
      <option value="">--</option>
      <option value="regular" ${value === "regular" ? "selected" : ""}>Regular</option>
      <option value="ot" ${value === "ot" ? "selected" : ""}>OT</option>
      <option value="stipend" ${value === "stipend" ? "selected" : ""}>Stipend</option>
      <option value="holiday" ${value === "holiday" ? "selected" : ""}>Holiday</option>
    </select>
  `;
}

/* ================= EDIT ================= */
function onCellEdit(e) {
  const td = e.target;
  const rowIndex = Number(td.dataset.row);
  const key = td.dataset.key;

  payrollRows[rowIndex][key] = parseNumberOrNull(td.textContent.trim());
  debouncePreview();
}

function onMissedTypeChange(e) {
  const td = e.target.closest("td");
  if (!td) return;

  const rowIndex = Number(td.dataset.row);
  payrollRows[rowIndex].missed_payment_type = e.target.value || null;
  debouncePreview();
}

/* ================= AUTO PREVIEW (recalculate) ================= */
function debouncePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(runPreview, 300);
}

async function runPreview() {
  try {
    const res = await fetch(`${API_URL}/payroll?action=preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidates: payrollRows.map((r) => ({
          id: r.candidate_uuid,
          ...Object.fromEntries(EDITABLE_FIELDS.map((f) => [f, r[f] ?? null])),
        })),
      }),
    });

    const data = await safeJson(res);

    if (res.ok && Array.isArray(data.rows)) {
      payrollRows = data.rows;
      renderPayrollTable();
    } else {
      console.error("Auto preview failed:", data);
    }
  } catch (err) {
    console.error("runPreview crash:", err);
  }
}

/* ================= SAVE ================= */
async function savePayroll() {
  try {
    const res = await fetch(`${API_URL}/payroll?action=save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from_date: fromDateInput.value,
        to_date: toDateInput.value,
        payroll_name: formatPayrollName(fromDateInput.value, toDateInput.value),
        rows: payrollRows,
      }),
    });

    const data = await safeJson(res);

    if (!res.ok) {
      console.error("Save error:", data);
      alert(data.error || "Save failed");
      return;
    }

    alert("Payroll saved successfully");
  } catch (err) {
    console.error("savePayroll crash:", err);
    alert("Save failed. Check console.");
  }
}

/* ================= DOWNLOAD ================= */
async function downloadPayroll() {
  try {
    const from = formatDateMMDDYYYY(fromDateInput.value);
    const to = formatDateMMDDYYYY(toDateInput.value);
    const filename = `Payroll_Period_${from}_to_${to}.xlsx`;

    const res = await fetch(`${API_URL}/payroll?action=download`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rows: payrollRows,
        from_date: fromDateInput.value,
        to_date: toDateInput.value,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Download failed:", errText);
      alert("Download failed. Check Vercel logs.");
      return;
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
  } catch (err) {
    console.error("downloadPayroll crash:", err);
    alert("Download failed. Check console.");
  }
}

/* ================= INIT ================= */
loadCandidates();
