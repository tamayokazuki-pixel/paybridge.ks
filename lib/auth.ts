import { redirect } from "next/navigation";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";

export async function getCurrentUser() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) return null;
  return data.user;
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  const admin = createSupabaseAdminClient();
  const { data: profile } = await admin
    .from("users")
    .select("role,is_verified")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "admin" || !profile.is_verified) {
    redirect("/dashboard");
  }

  return user;
}

export async function ensureProfile() {
  const user = await requireUser();
  const admin = createSupabaseAdminClient();
  const fullName = user.user_metadata?.full_name || user.user_metadata?.name || "";
  const [firstName = "Paybridge", ...rest] = fullName.split(" ").filter(Boolean);
  const lastName = rest.join(" ") || "Customer";

  const { data: existing } = await admin
    .from("users")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (existing) {
    // Check if the legacy 'profiles' table needs syncing to prevent foreign key errors on transactions
    const { data: existingProfile } = await admin.from("profiles").select("id").eq("id", user.id).maybeSingle();
    if (!existingProfile) {
      await admin.from("profiles").insert({
        id: user.id,
        email: user.email,
        first_name: firstName,
        last_name: lastName,
        account_id: existing.account_id
      });
    }
    return existing;
  }

  const accountId = `PB${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
  
  // Insert into both tables to keep them synced
  await admin.from("profiles").insert({
    id: user.id,
    email: user.email,
    first_name: firstName,
    last_name: lastName,
    account_id: accountId
  });

  const { data, error } = await admin
    .from("users")
    .insert({
      id: user.id,
      email: user.email,
      full_name: `${firstName} ${lastName}`.trim(),
      account_id: accountId,
      is_verified: false,
      role: "user"
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}
