import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { parse as parseCsv } from "https://deno.land/std@0.168.0/encoding/csv.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-brain-password",
};

// ── Column alias table ────────────────────────────────────────────────────────
// Maps every known CSV header variation to its canonical leads column name.
// Matching runs after lowercasing + trimming the CSV header.

const COLUMN_ALIASES: Record<string, string> = {
  "phone":            "phone",
  "phone number":     "phone",
  "cell":             "phone",
  "mobile":           "phone",
  "tel":              "phone",
  "contact number":   "phone",
  "telephone":        "phone",

  "first":            "first_name",
  "first name":       "first_name",
  "fname":            "first_name",
  "given name":       "first_name",

  "last":             "last_name",
  "last name":        "last_name",
  "lname":            "last_name",
  "surname":          "last_name",

  "email":            "email",
  "email address":    "email",
  "e-mail":           "email",

  "address":          "address",
  "street":           "address",
  "property address": "address",
  "street address":   "address",

  "city":             "city",
  "town":             "city",

  "state":            "state",
  "st":               "state",
  "province":         "state",

  "zip":              "zip",
  "zip code":         "zip",
  "postal":           "zip",
  "postal code":      "zip",

  "loan":             "loan_amount",
  "loan amount":      "loan_amount",
  "balance":          "loan_amount",
  "loan balance":     "loan_amount",
  "mortgage amount":  "loan_amount",

  "value":            "property_value",
  "property value":   "property_value",
  "home value":       "property_value",
  "estimated value":  "property_value",
  "arv":              "property_value",
};

// ── Phone normalization ───────────────────────────────────────────────────────
// Strip everything except digits. Called before any comparison or insert —
// the unique index on (client_id, phone) requires consistent normalized form.

function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, "");
}

function isValidPhone(normalized: string): boolean {
  return normalized.length >= 10;
}

// ── Column detection ──────────────────────────────────────────────────────────

type ColumnMapping = Record<string, string>; // canonical field → original CSV header

function detectMapping(headers: string[]): {
  mapping: ColumnMapping;
  unmappedColumns: string[];
} {
  const mapping: ColumnMapping = {};
  const unmappedColumns: string[] = [];
  const claimedTargets = new Set<string>();

  for (const header of headers) {
    const normalized = header.toLowerCase().trim();
    const target = COLUMN_ALIASES[normalized];
    if (target && !claimedTargets.has(target)) {
      mapping[target] = header;
      claimedTargets.add(target);
    } else {
      // No alias match, or target already claimed by an earlier column.
      unmappedColumns.push(header);
    }
  }

  return { mapping, unmappedColumns };
}

// When a confirmed_mapping is provided, unmapped columns are any CSV headers
// not referenced as a value in that mapping.
function unmappedFromConfirmed(headers: string[], mapping: ColumnMapping): string[] {
  const mappedHeaders = new Set(Object.values(mapping));
  return headers.filter(h => !mappedHeaders.has(h));
}

// ── Row mapping ───────────────────────────────────────────────────────────────

type LeadRow = {
  phone: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  loan_amount: number | null;
  property_value: number | null;
};

type RowError = { row: number; reason: string };

function mapRow(
  record: Record<string, string>,
  mapping: ColumnMapping,
  rowIndex: number
): { lead: LeadRow | null; error: RowError | null } {
  const get = (field: string): string | null => {
    const header = mapping[field];
    if (!header) return null;
    const val = record[header]?.trim();
    return val || null;
  };

  const rawPhone = get("phone");
  if (!rawPhone) {
    return { lead: null, error: { row: rowIndex, reason: "phone missing" } };
  }

  // Normalize phone BEFORE any comparison or insert.
  const phone = normalizePhone(rawPhone);
  if (!isValidPhone(phone)) {
    return {
      lead: null,
      error: {
        row: rowIndex,
        reason: `phone too short after normalization: '${rawPhone}' → '${phone}'`,
      },
    };
  }

  const parseNumeric = (field: string): number | null => {
    const raw = get(field);
    if (!raw) return null;
    const cleaned = raw.replace(/[$,]/g, "");
    const n = parseFloat(cleaned);
    return isNaN(n) || n < 0 ? null : n;
  };

  return {
    lead: {
      phone,
      first_name:     get("first_name"),
      last_name:      get("last_name"),
      email:          get("email"),
      address:        get("address"),
      city:           get("city"),
      state:          get("state"),
      zip:            get("zip"),
      loan_amount:    parseNumeric("loan_amount"),
      property_value: parseNumeric("property_value"),
    },
    error: null,
  };
}

// ── CSV parsing ───────────────────────────────────────────────────────────────
// Parse once into raw rows. Row 0 = headers, rows 1..n = data.
// parseCsv is synchronous in std@0.168.0.

function parseCSV(csvContent: string): {
  headers: string[];
  records: Record<string, string>[];
} {
  const allRows = parseCsv(csvContent) as string[][];
  if (allRows.length === 0) return { headers: [], records: [] };

  const headers = allRows[0];
  const records = allRows.slice(1).map(row => {
    const record: Record<string, string> = {};
    headers.forEach((h, i) => { record[h] = row[i] ?? ""; });
    return record;
  });

  return { headers, records };
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const body = await req.json();
    const { mode, client_id, csv_content, confirmed_mapping } = body;

    if (!client_id)   return bad("client_id required");
    if (!csv_content) return bad("csv_content required");
    if (!["preview", "import"].includes(mode)) return bad("mode must be 'preview' or 'import'");

    // Verify client exists.
    const { data: client, error: clientErr } = await supabase
      .from("clients").select("id").eq("id", client_id).maybeSingle();
    if (clientErr) return bad(`client lookup error: ${clientErr.message} (code: ${clientErr.code})`);
    if (!client) return bad(`client_id '${client_id}' not found`);

    // Parse CSV once.
    let headers: string[];
    let records: Record<string, string>[];
    try {
      ({ headers, records } = parseCSV(csv_content));
    } catch (e) {
      return bad(`CSV parse error: ${e.message}`);
    }

    if (headers.length === 0) return bad("CSV is empty or has no headers");

    // Resolve mapping and unmapped columns.
    let mapping: ColumnMapping;
    let unmappedColumns: string[];

    if (confirmed_mapping) {
      mapping = confirmed_mapping as ColumnMapping;
      unmappedColumns = unmappedFromConfirmed(headers, mapping);
    } else {
      ({ mapping, unmappedColumns } = detectMapping(headers));
    }

    if (!mapping["phone"]) {
      return bad(
        `No phone column detected. CSV headers: [${headers.join(", ")}]. ` +
        `Pass confirmed_mapping with {"phone": "<your column name>"} to override.`
      );
    }

    // ── PREVIEW mode ──────────────────────────────────────────────────────────
    if (mode === "preview") {
      const sampleRows: LeadRow[] = [];
      for (let i = 0; i < Math.min(3, records.length); i++) {
        const { lead } = mapRow(records[i], mapping, i + 2);
        if (lead) sampleRows.push(lead);
      }
      return ok({
        mode: "preview",
        total_rows: records.length,
        detected_mapping: mapping,
        unmapped_columns: unmappedColumns,
        sample_rows: sampleRows,
      });
    }

    // ── IMPORT mode ───────────────────────────────────────────────────────────
    const validLeads: (LeadRow & { client_id: string })[] = [];
    const errors: RowError[] = [];

    for (let i = 0; i < records.length; i++) {
      const { lead, error } = mapRow(records[i], mapping, i + 2);
      if (error) errors.push(error);
      else validLeads.push({ ...lead!, client_id });
    }

    // Bulk upsert in chunks of 500.
    // ignoreDuplicates: true → ON CONFLICT (client_id, phone) DO NOTHING.
    // Phone is already normalized in every lead row before this point.
    // .select("id") returns only rows actually inserted — accurate imported count.
    const CHUNK_SIZE = 500;
    let imported = 0;

    for (let i = 0; i < validLeads.length; i += CHUNK_SIZE) {
      const chunk = validLeads.slice(i, i + CHUNK_SIZE);
      const { data: inserted, error: insertErr } = await supabase
        .from("leads")
        .upsert(chunk, { onConflict: "client_id,phone", ignoreDuplicates: true })
        .select("id");

      if (insertErr) {
        errors.push({
          row: i + 2,
          reason: `Batch insert error (rows ${i + 2}–${i + chunk.length + 1}): ${insertErr.message}`,
        });
      } else {
        imported += inserted?.length ?? 0;
      }
    }

    return ok({
      imported,
      skipped_duplicates: validLeads.length - imported,
      errors,
      unmapped_columns: unmappedColumns,
    });

  } catch (err) {
    console.error("import-leads error:", err);
    return new Response(JSON.stringify({ error: err.message || String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function ok(data: unknown) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function bad(message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
