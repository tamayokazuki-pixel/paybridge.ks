"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | undefined;

/**
 * Creates (once) and returns the browser Supabase client.
 *
 * IMPORTANT: only call this from event handlers / effects, never during
 * render. Client components are still pre-rendered on the server during
 * `next build`, so creating the client in a component body makes the build
 * fail ("Error occurred prerendering page ...") whenever the public env
 * vars are not present at build time.
 *
 * Keep the `process.env.NEXT_PUBLIC_*` references as literal property
 * accesses: Next.js only inlines them into the browser bundle that way,
 * and inlining happens at build time — so on Vercel the variables must be
 * set before building (Project Settings -> Environment Variables), and
 * changing them requires a redeploy.
 */
export function createSupabaseBrowserClient(): SupabaseClient {
  if (browserClient) return browserClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Supabase is not configured: NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY must be set (on Vercel: Project " +
        "Settings -> Environment Variables, then redeploy so the new " +
        "build picks them up)."
    );
  }

  browserClient = createBrowserClient(url, anonKey);
  return browserClient;
}
