import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

const schema = z.object({
  profileId: z.string().uuid(),
  status: z.enum(["active", "suspended"])
});

export async function POST(request: Request) {
  await requireAdmin();
  const body = schema.parse(await request.json());
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("users")
    .update({ status: body.status })
    .eq("id", body.profileId)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ profile: data });
}
