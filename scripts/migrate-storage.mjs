import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const text = fs.readFileSync(".env", "utf8");

function sectionValues(section) {
  const lines = text.split(/\r?\n/);
  let active = false;
  const out = {};

  for (const raw of lines) {
    const t = raw.trim();

    // Detect section headers, including "Stagging", "Staging URL", etc.
    if (/^#\s*(production|prod)\s*$/i.test(t)) {
      active = section === "production";
      continue;
    }

    if (/^#\s*stag+ing(\s+url)?\s*$/i.test(t) || /^#\s*staging.*$/i.test(t)) {
      active = section === "staging";
      continue;
    }

    if (!active || !t) continue;

    const line = t.replace(/^#\s*/, "");
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;

    let value = m[2].trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    out[m[1]] = value;
  }

  return out;
}

const prod = sectionValues("production");
const stage = sectionValues("staging");

const prodUrl = prod.VITE_SUPABASE_URL;
const prodKey = prod.SUPABASE_SERVICE_ROLE_KEY;
const stageUrl = stage.VITE_SUPABASE_URL;
const stageKey = stage.SUPABASE_SERVICE_ROLE_KEY;

console.log("Credential check:");
console.log("Production URL:", !!prodUrl);
console.log("Production service key:", !!prodKey);
console.log("Staging URL:", !!stageUrl);
console.log("Staging service key:", !!stageKey);

if (!prodUrl || !prodKey || !stageUrl || !stageKey) {
  console.error("\nCould not find all four Supabase credentials.");
  process.exit(1);
}

const prodClient = createClient(prodUrl, prodKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const stageClient = createClient(stageUrl, stageKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const buckets = [
  "mentor-verification-documents",
  "payment-proofs",
  "payment-qr",
  "segment-hero",
  "support-attachments"
];

let found = 0;
let uploaded = 0;
let failed = 0;

async function migrate(bucket, prefix = "") {
  const { data, error } = await prodClient.storage
    .from(bucket)
    .list(prefix, {
      limit: 1000,
      sortBy: { column: "name", order: "asc" }
    });

  if (error) throw new Error(`LIST ${bucket}/${prefix}: ${error.message}`);

  for (const item of data ?? []) {
    const path = prefix ? `${prefix}/${item.name}` : item.name;

    // Folder
    if (!item.metadata) {
      await migrate(bucket, path);
      continue;
    }

    found++;

    const { data: blob, error: downloadError } =
      await prodClient.storage.from(bucket).download(path);

    if (downloadError || !blob) {
      console.error(`DOWNLOAD FAILED: ${bucket}/${path}`);
      console.error(downloadError?.message ?? "No blob returned");
      failed++;
      continue;
    }

    const { error: uploadError } =
      await stageClient.storage.from(bucket).upload(path, blob, {
        upsert: true,
        contentType:
          blob.type ||
          item.metadata?.mimetype ||
          "application/octet-stream"
      });

    if (uploadError) {
      console.error(`UPLOAD FAILED: ${bucket}/${path}`);
      console.error(uploadError.message);
      failed++;
      continue;
    }

    uploaded++;
    console.log(`OK ${uploaded}: ${bucket}/${path}`);
  }
}

try {
  for (const bucket of buckets) {
    console.log(`\n=== ${bucket} ===`);
    await migrate(bucket);
  }
} catch (err) {
  console.error("\nMIGRATION ABORTED:");
  console.error(err.message);
  process.exit(1);
}

console.log("\n==============================");
console.log(`FILES FOUND: ${found}`);
console.log(`UPLOADED:    ${uploaded}`);
console.log(`FAILED:      ${failed}`);
console.log("==============================");

if (found !== 70 || uploaded !== 70 || failed !== 0) {
  console.error("❌ Storage migration is NOT complete.");
  process.exit(1);
}

console.log("✅ ALL 70 STORAGE FILES MIGRATED SUCCESSFULLY.");
