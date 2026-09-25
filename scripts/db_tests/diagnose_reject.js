/**
 * Diagnoses "the admin console cannot reject a transaction".
 *
 * Read-only by default. It reports:
 *   1. which columns the live `transactions` table actually exposes
 *   2. the CHECK constraints on it (needs the optional `query` RPC helper)
 *   3. whether the reject UPDATE is accepted by the database
 *
 * Usage (from the repository root, with .env present):
 *   node scripts/db_tests/diagnose_reject.js
 *   node scripts/db_tests/diagnose_reject.js --probe
 *
 * --probe writes one throwaway transaction row, runs the exact UPDATE the
 * reject route runs, and deletes the row again. Use it when the constraint
 * list above cannot be read.
 */
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");

function loadEnv() {
  const path = fs.existsSync(".env") ? ".env" : fs.existsSync(".env.local") ? ".env.local" : null;
  if (!path) {
    console.error("No .env or .env.local found. Run this from the repository root.");
    process.exit(1);
  }
  const env = {};
  fs.readFileSync(path, "utf8")
    .split("\n")
    .forEach((line) => {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) env[match[1].trim()] = match[2].trim().replace(/^['"](.*)['"]$/, "$1");
    });
  return env;
}

const CANONICAL_STATUSES = ["pending", "completed", "rejected"];
const LEGACY_STATUSES = ["failed", "approved"];

async function main() {
  const probe = process.argv.includes("--probe");
  const env = loadEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are missing from the env file.");
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  console.log(`Project: ${url}\n`);

  // 1. Columns exposed by PostgREST -------------------------------------------------
  console.log("1) Columns on public.transactions");
  try {
    const res = await fetch(`${url}/rest/v1/`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/openapi+json" }
    });
    const spec = await res.json();
    const properties =
      spec?.definitions?.transactions?.properties || spec?.components?.schemas?.transactions?.properties || null;
    if (!properties) {
      console.log("   could not read the API schema\n");
    } else {
      const columns = Object.keys(properties);
      console.log(`   ${columns.join(", ")}`);
      for (const required of ["admin_note", "reference", "completed_at", "profile_id"]) {
        console.log(`   ${columns.includes(required) ? "OK  " : "MISSING"} ${required}`);
      }
      console.log("");
    }
  } catch (error) {
    console.log(`   could not read the API schema (${error.message})\n`);
  }

  // 2. CHECK constraints ------------------------------------------------------------
  console.log("2) CHECK constraints");
  const constraintQuery = `
    select conname, pg_get_constraintdef(oid) as definition
    from pg_constraint
    where conrelid = 'public.transactions'::regclass and contype = 'c'
    order by conname;`;
  const { data: constraints, error: constraintError } = await supabase.rpc("query", { sql_query: constraintQuery });
  if (constraintError) {
    console.log(`   could not read constraints via the 'query' RPC (${constraintError.message})`);
    console.log("   paste this into the Supabase SQL editor instead:");
    console.log(`   ${constraintQuery.trim().replace(/\n\s*/g, " ")}\n`);
  } else if (!constraints || constraints.length === 0) {
    console.log("   no CHECK constraints on public.transactions\n");
  } else {
    for (const row of constraints) console.log(`   ${row.conname}: ${row.definition}`);
    const statusConstraint = constraints.find((row) => /status/i.test(row.definition || ""));
    if (statusConstraint) {
      const missing = CANONICAL_STATUSES.filter((value) => !statusConstraint.definition.includes(value));
      console.log(
        missing.length
          ? `   -> the status constraint rejects: ${missing.join(", ")}  <== this breaks reject\n`
          : "   -> the status constraint allows every value the app writes\n"
      );
    } else {
      console.log("");
    }
  }

  // 3. Live write probe -------------------------------------------------------------
  if (probe) {
    console.log("3) Write probe (temporary row, deleted afterwards)");
    const { data: users } = await supabase.from("users").select("id").limit(1);
    const userId = users?.[0]?.id;
    if (!userId) {
      console.log("   no user rows found, skipping\n");
    } else {
      const base = {
        user_id: userId,
        profile_id: userId,
        type: "deposit",
        status: "pending",
        amount: 0,
        description: "paybridge diagnostic row (safe to delete)"
      };
      let inserted = await supabase.from("transactions").insert(base).select("*").single();
      if (inserted.error && /column/i.test(inserted.error.message)) {
        const { profile_id, ...withoutProfile } = base;
        inserted = await supabase.from("transactions").insert(withoutProfile).select("*").single();
      }
      if (inserted.error) {
        console.log(`   could not create the probe row: ${inserted.error.message}\n`);
      } else {
        const id = inserted.data.id;
        const fields = { status: "rejected", admin_note: "diagnostic", completed_at: new Date().toISOString() };
        let attempt = await supabase
          .from("transactions")
          .update(fields)
          .eq("id", id)
          .eq("status", "pending")
          .select("*")
          .single();

        if (attempt.error) {
          console.log(`   status 'rejected' REJECTED: ${attempt.error.code || ""} ${attempt.error.message}`);
          const legacy = await supabase
            .from("transactions")
            .update({ ...fields, status: "failed" })
            .eq("id", id)
            .eq("status", "pending")
            .select("*")
            .single();
          console.log(
            legacy.error
              ? `   status 'failed' also rejected: ${legacy.error.message}`
              : "   status 'failed' accepted -> this database still uses the LEGACY vocabulary."
          );
        } else {
          console.log("   status 'rejected' accepted -> rejecting works at the database level.");
        }

        await supabase.from("transactions").delete().eq("id", id);
        console.log("   probe row deleted\n");
      }
    }
  } else {
    console.log("3) Write probe skipped (run again with --probe to test a real reject UPDATE)\n");
  }

  console.log("If the status constraint is missing 'rejected', or 'rejected' is refused,");
  console.log("run supabase/fix_transactions_status.sql in the Supabase SQL editor.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
