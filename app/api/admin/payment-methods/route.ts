import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

const schema = z.object({
  id: z.string().uuid(),
  label: z.string().min(1),
  fields: z.array(z.object({ label: z.string().min(1), value: z.string().min(1) })),
  isActive: z.boolean()
});

export async function POST(request: Request) {
  await requireAdmin();
  const body = schema.parse(await request.json());
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("payment_methods")
    .update({ label: body.label, fields: body.fields, is_active: body.isActive })
    .eq("id", body.id)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ paymentMethod: data });
}
