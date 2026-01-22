// import { createClient } from "@supabase/supabase-js";

// export default async function handler(req, res) {
//   try {
//     const url = process.env.SUPABASE_URL;
//     const key = process.env.SUPABASE_KEY;

//     if (!url || !key) {
//       return res.status(500).json({
//         error: "Missing Supabase env",
//         SUPABASE_URL: !!url,
//         SUPABASE_KEY: !!key
//       });
//     }

//     const supabase = createClient(url, key);

//     const { data, error } = await supabase
//       .from("candidate_data")
//       .select("*");

//     if (error) {
//       return res.status(500).json({
//         supabaseError: error.message
//       });
//     }

//     return res.status(200).json(data);

//   } catch (e) {
//     return res.status(500).json({
//       crash: e.message
//     });
//   }
// }

import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_KEY;

    if (!SUPABASE_URL || !SUPABASE_KEY) {
      return res.status(500).json({
        error: "Missing Supabase env",
        SUPABASE_URL: !!SUPABASE_URL,
        SUPABASE_KEY: !!SUPABASE_KEY,
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    /* ================= CREATE CANDIDATE ================= */
    if (req.method === "POST") {
      const payload = { ...req.body };

      // Let database generate UUID
      delete payload.candidate_uuid;

      const { data, error } = await supabase
        .from("candidate_data")
        .insert(payload)
        .select("id, candidate_uuid, candidate_name, created_at")
        .single();

      if (error) {
        console.error("SUPABASE INSERT ERROR:", error);
        return res.status(400).json({ error: error.message });
      }

      return res.status(201).json(data);
    }

    /* ================= LIST CANDIDATES ================= */
    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("candidate_data")
        .select("id, candidate_uuid, candidate_name, created_at")
        .order("created_at", { ascending: false });

      if (error) {
        console.error("SUPABASE SELECT ERROR:", error);
        return res.status(400).json({ error: error.message });
      }

      return res.status(200).json(data);
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("CANDIDATES API CRASH:", err);
    return res.status(500).json({ error: err.message });
  }
}

