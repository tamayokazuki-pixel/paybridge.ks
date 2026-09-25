import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

const schema = z.object({
  id: z.string().uuid(),
  label: z.string().min(1),
  fields: z.array(z.object({ label: z.string().min(1), value: z.string().min(1) })),
  isActive: z.boolean()
});

export async function POST(request: Request) {
  const adminUser = await getAdminUser();
  if (!adminUser) {
    return NextResponse.json({ error: "Admin access required. Please sign in again." }, { status: 403 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid request body." }, { status: 400 });
  }

  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("payment_methods")
      .update({ label: parsed.data.label, fields: parsed.data.fields, is_active: parsed.data.isActive })
      .eq("id", parsed.data.id)
      .select("*")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ paymentMethod: data });
  } catch (error) {
    console.error("Update payment method crashed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected server error." },
      { status: 500 }
    );
  }
}
