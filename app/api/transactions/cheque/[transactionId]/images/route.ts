import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminUser, getCurrentUser } from "@/lib/auth";
import { CHEQUE_IMAGE_BUCKET, CHEQUE_METHOD_KEY, chequeDepositDetailsSchema } from "@/lib/cheques";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

type Context = { params: Promise<{ transactionId: string }> };

export async function GET(_request: Request, { params }: Context) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { transactionId } = await params;
  if (!z.string().uuid().safeParse(transactionId).success) {
    return NextResponse.json({ error: "Invalid transaction ID." }, { status: 400 });
  }

  try {
    const supabase = createSupabaseAdminClient();
    const { data: transaction, error } = await supabase
      .from("transactions")
      .select("id,user_id,type,method_key,cheque_details")
      .eq("id", transactionId)
      .maybeSingle();
    if (error) throw error;
    if (!transaction || transaction.method_key !== CHEQUE_METHOD_KEY || transaction.type !== "deposit") {
      return NextResponse.json({ error: "Cheque deposit not found." }, { status: 404 });
    }
    if (transaction.user_id !== user.id && !await getAdminUser()) {
      return NextResponse.json({ error: "Cheque deposit not found." }, { status: 404 });
    }

    const details = chequeDepositDetailsSchema.safeParse(transaction.cheque_details);
    const prefix = `${transaction.user_id}/${transaction.id}`;
    if (!details.success ||
        !new RegExp(`^${prefix}/front\\.(jpg|png|webp)$`).test(details.data.frontImagePath) ||
        !new RegExp(`^${prefix}/back\\.(jpg|png|webp)$`).test(details.data.backImagePath)) {
      return NextResponse.json({ error: "Cheque images are unavailable." }, { status: 404 });
    }

    const [front, back] = await Promise.all([
      supabase.storage.from(CHEQUE_IMAGE_BUCKET).createSignedUrl(details.data.frontImagePath, 300),
      supabase.storage.from(CHEQUE_IMAGE_BUCKET).createSignedUrl(details.data.backImagePath, 300)
    ]);
    if (front.error || back.error || !front.data || !back.data) {
      throw front.error || back.error || new Error("Could not sign cheque images.");
    }
    return NextResponse.json({ frontUrl: front.data.signedUrl, backUrl: back.data.signedUrl }, {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    console.error("Could not retrieve cheque images:", error);
    return NextResponse.json({ error: "Could not load cheque images." }, { status: 500 });
  }
}
