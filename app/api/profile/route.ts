import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

const profileSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(5).optional().or(z.literal("")),
  dob: z.string().optional().or(z.literal("")),
  country: z.string().optional().or(z.literal("")),
  username: z.string().min(3),
  accountType: z.string().min(1),
  currency: z.string().min(1),
  marketing: z.boolean().optional()
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = profileSchema.parse(await request.json());
  const supabase = createSupabaseAdminClient();

  const { data: existingUser } = await supabase
    .from("users")
    .select("account_id")
    .eq("id", user.id)
    .maybeSingle();

  const accountId = existingUser?.account_id || `PB${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

  const { data, error } = await supabase
    .from("users")
    .upsert(
      {
        id: user.id,
        email: body.email,
        full_name: `${body.firstName} ${body.lastName}`.trim(),
        account_id: accountId,
        phone: body.phone || null,
        dob: body.dob || null,
        country: body.country || null,
        username: body.username,
        account_type: body.accountType,
        currency: body.currency,
        marketing: body.marketing || false,
        is_verified: false,
        role: "user",
        status: "active"
      },
      { onConflict: "id" }
    )
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ profile: data });
}
