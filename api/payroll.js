// import { createClient } from "@supabase/supabase-js";

// const supabase = createClient(
//   process.env.SUPABASE_URL,
//   process.env.SUPABASE_KEY
// );

// export default async function handler(req, res) {
//   try {
//     if (req.method === "POST") {
//       const rows = req.body;

//       if (!Array.isArray(rows)) {
//         return res.status(400).json({ error: "Expected array of payroll rows" });
//       }

//       const { error } = await supabase
//         .from("payroll")
//         .insert(rows);

//       if (error) throw error;

//       return res.status(200).json({ success: true });
//     }

//     if (req.method === "GET") {
//       const { data, error } = await supabase
//         .from("payroll")
//         .select("*")
//         .order("created_at", { ascending: false });

//       if (error) throw error;

//       return res.status(200).json(data);
//     }

//     return res.status(405).json({ error: "Method not allowed" });
//   } catch (err) {
//     return res.status(500).json({ error: err.message });
//   }
// }

import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";
import { pipeline } from "stream/promises";

/* ================= SUPABASE ================= */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY; // you added this in vercel env

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_KEY in Vercel env");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/* ================= CONFIG ================= */
const SHEET_ID = process.env.GSHEET_ID;
const SHEET_NAME = "Payroll";
const VMS_RATE = 0.06;

if (!SHEET_ID) throw new Error("GSHEET_ID missing in Vercel env");

/*
  IMPORTANT:
  For Vercel, do NOT use google-service-account.json file.
  Put service account values in env variables:

  client_email
  private_key

  (You already added them in Vercel screenshot)
*/
const CLIENT_EMAIL = process.env.client_email;
let PRIVATE_KEY = process.env.private_key;

if (!CLIENT_EMAIL || !PRIVATE_KEY) {
  throw new Error("Missing Google service account env: client_email/private_key");
}

// Fix multiline private key
PRIVATE_KEY = PRIVATE_KEY.replace(/\\n/g, "\n");

/* ================= GOOGLE AUTH ================= */
const auth = new google.auth.JWT({
  email: CLIENT_EMAIL,
  key: PRIVATE_KEY,
  scopes: [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
  ],
});

const sheetsApi = google.sheets({ version: "v4", auth });
const driveApi = google.drive({ version: "v3", auth });

/* ================= UTIL ================= */
const n = (v) => {
  const x = Number(v);
  return Number.isNaN(x) ? 0 : x;
};

const round = (v) =>
  v === null || v === undefined
    ? null
    : Math.round((Number(v) + Number.EPSILON) * 100) / 100;

function formatDateMMDDYYYY(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;

  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

/* ================= CORE PAYROLL ================= */
function calculatePayroll(base, input) {
  const vms_charges = VMS_RATE;

  const reg = n(input.reg_hours ?? base.reg_hours);
  const ot = n(input.ot_hours ?? base.ot_hours);
  const hol = n(input.holiday_hours ?? base.holiday_hours);

  const w2 = n(input.w2_rate ?? base.w2_rate);
  const stipend = n(input.stipend_rate ?? base.stipend_rate);
  const ot_rate = n(input.ot_rate ?? base.ot_rate);
  const holiday_rate = n(input.holiday_rate ?? base.holiday_rate);
  const sign_bonus = n(input.sign_bonus ?? base.sign_bonus);

  let standard_w2_amount = reg * w2;
  let ot_amount = ot * ot_rate;
  let holiday_amount = hol * holiday_rate;
  let standard_stipend_amount = reg * stipend;

  /* MISSED PAYMENT */
  const missed_amt = n(input.missed_payment_amount);
  const missed_type = input.missed_payment_type;

  if (missed_amt > 0 && missed_type) {
    if (missed_type === "regular") standard_w2_amount += missed_amt;
    if (missed_type === "ot") ot_amount += missed_amt;
    if (missed_type === "holiday") holiday_amount += missed_amt;
    if (missed_type === "stipend") standard_stipend_amount += missed_amt;
  }

  const guaranteed = w2 * ot;
  const overall_bonus = sign_bonus + ot_amount + holiday_amount;
  const total_pay = standard_w2_amount + overall_bonus;

  /* TOTAL PAYABLE */
  const total_payable =
    standard_w2_amount + standard_stipend_amount + overall_bonus;

  /* CLIENT */
  const client_std_rate = n(
    input.client_standard_bill_rate ?? base.client_standard_bill_rate
  );
  const client_ot_rate = n(
    input.client_ot_bill_rate ?? base.client_ot_bill_rate
  );
  const client_hol_rate = n(
    input.client_holiday_bill_rate ?? base.client_holiday_bill_rate
  );

  const client_standard_amount = reg * client_std_rate * (1 - 0.06);

  const client_ot_holiday_amount =
    ot * (client_ot_rate - vms_charges * client_ot_rate) +
    hol * (client_hol_rate - vms_charges * client_hol_rate);

  const total_received = client_standard_amount + client_ot_holiday_amount;

  let total_candidate_expense = null;
  if (
    input.total_candidate_expense !== undefined &&
    input.total_candidate_expense !== null &&
    input.total_candidate_expense !== ""
  ) {
    total_candidate_expense = n(input.total_candidate_expense);
  }

  const net_profit =
    total_candidate_expense !== null
      ? round(total_received - total_candidate_expense)
      : null;

  return {
    candidate_uuid: base.candidate_uuid,
    candidate_name: base.candidate_name,

    reg_hours: reg,
    ot_hours: ot,
    holiday_hours: hol,
    total_hours: reg + ot + hol,

    w2_rate: w2,
    stipend_rate: stipend,
    ot_rate,
    holiday_rate,

    guaranteed: round(guaranteed),

    standard_w2_amount: round(standard_w2_amount),
    ot_amount: round(ot_amount),
    holiday_amount: round(holiday_amount),

    sign_bonus: round(sign_bonus),
    overall_bonus: round(overall_bonus),
    total_pay: round(total_pay),

    standard_stipend_amount: round(standard_stipend_amount),
    total_payable: round(total_payable),

    total_candidate_expense:
      total_candidate_expense !== null ? round(total_candidate_expense) : null,

    client_standard_bill_rate: client_std_rate,
    vms_charges: round(vms_charges),
    client_standard_amount: round(client_standard_amount),

    client_ot_bill_rate: client_ot_rate,
    client_holiday_bill_rate: client_hol_rate,
    client_ot_holiday_amount: round(client_ot_holiday_amount),

    total_amount_received_from_client: round(total_received),
    net_profit,

    missed_payment_amount: missed_amt || null,
    missed_payment_type: missed_type || null,
  };
}

/* ================= GSHEET HELPERS ================= */
async function clearSheet() {
  await sheetsApi.spreadsheets.values.clear({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A2:AB2000`,
  });
}

async function writeToSheet(rows) {
  const values = rows.map((r) => [
    r.candidate_name,
    r.total_hours,
    r.reg_hours,
    r.ot_hours,
    r.holiday_hours,
    r.w2_rate,
    r.stipend_rate,
    r.ot_rate,
    r.holiday_rate,
    r.guaranteed,
    r.standard_w2_amount,
    r.ot_amount,
    r.holiday_amount,
    r.sign_bonus,
    r.overall_bonus,
    r.total_pay,
    r.standard_stipend_amount,
    r.total_payable,
    r.total_candidate_expense ?? "",
    r.client_standard_bill_rate,
    r.vms_charges,
    r.client_standard_amount,
    r.client_ot_bill_rate,
    r.client_holiday_bill_rate,
    r.client_ot_holiday_amount,
    r.total_amount_received_from_client,
    r.net_profit ?? "",
    r.total_candidate_expense ?? "",
  ]);

  await sheetsApi.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A2`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values },
  });
}

async function updatePayrollPeriod(from_date, to_date) {
  if (!from_date || !to_date) return;

  const from = formatDateMMDDYYYY(from_date);
  const to = formatDateMMDDYYYY(to_date);

  const headerText = `Payroll Period - ${from} to ${to}`;

  await sheetsApi.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!B1`,
    valueInputOption: "RAW",
    requestBody: {
      values: [[headerText]],
    },
  });
}

/* ================= API HANDLER ================= */
/*
  POST /api/payroll?action=preview
  POST /api/payroll?action=push-to-gsheet
  POST /api/payroll?action=download
  POST /api/payroll?action=save
*/
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Only POST supported" });
    }

    const action = req.query.action;

    if (!action) {
      return res.status(400).json({
        error: "Missing action",
        example:
          "/api/payroll?action=preview | push-to-gsheet | download | save",
      });
    }

    /* ================= PREVIEW ================= */
    if (action === "preview") {
      const body = req.body || {};
      const candidates = body.candidates || [];

      if (!Array.isArray(candidates) || candidates.length === 0) {
        return res.status(400).json({ error: "candidates array required" });
      }

      const ids = candidates.map((c) => c.id);

      const { data, error } = await supabase
        .from("candidate_data")
        .select("*")
        .in("candidate_uuid", ids);

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      const rows = candidates
        .map((c) => {
          const base = data.find((b) => b.candidate_uuid === c.id);
          return base ? calculatePayroll(base, c) : null;
        })
        .filter(Boolean);

      return res.status(200).json({ rows });
    }

    /* ================= PUSH TO GSHEET ================= */
    if (action === "push-to-gsheet") {
      const body = req.body || {};
      const rows = body.rows || [];

      if (!Array.isArray(rows)) {
        return res.status(400).json({ error: "rows array required" });
      }

      await clearSheet();
      await writeToSheet(rows);

      return res.status(200).json({ success: true });
    }

    /* ================= DOWNLOAD XLSX ================= */
    if (action === "download") {
      const body = req.body || {};
      const { rows, from_date, to_date } = body;

      if (!Array.isArray(rows)) {
        return res.status(400).json({ error: "rows array required" });
      }

      await updatePayrollPeriod(from_date, to_date);

      // clear + write
      await sheetsApi.spreadsheets.values.clear({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_NAME}!A2:Z2000`,
      });

      await writeToSheet(rows);

      const filename = `payroll_${from_date || "from"}_${to_date || "to"}.xlsx`;

      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );

      const exportStream = await driveApi.files.export(
        {
          fileId: SHEET_ID,
          mimeType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
        { responseType: "stream" }
      );

      await pipeline(exportStream.data, res);

      // optional clear after download
      await sheetsApi.spreadsheets.values.clear({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_NAME}!A2:Z2000`,
      });

      return;
    }

    /* ================= SAVE TO SUPABASE ================= */
    if (action === "save") {
      const body = req.body || {};
      const { from_date, to_date, payroll_name, rows } = body;

      if (!payroll_name) {
        return res.status(400).json({ error: "payroll_name required" });
      }

      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ error: "rows array required" });
      }

      // 1) Create payroll run
      const { data: run, error: runError } = await supabase
        .from("payroll_runs")
        .insert({
          payroll_name,
          from_date,
          to_date,
        })
        .select()
        .single();

      if (runError || !run) {
        return res.status(500).json({
          error: "Failed to create payroll run",
          details: runError?.message,
        });
      }

      // 2) Insert payroll items
      const items = rows
        .filter(Boolean)
        .map((r) => ({
          ...r,
          payroll_run_id: run.id,
        }));

      const { error: itemsError } = await supabase
        .from("payroll_items")
        .insert(items);

      if (itemsError) {
        return res.status(500).json({
          error: "Failed to save payroll items",
          details: itemsError.message,
        });
      }

      return res.status(200).json({ payroll_run_id: run.id });
    }

    return res.status(400).json({ error: "Invalid action" });
  } catch (err) {
    console.error("PAYROLL API ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
}

