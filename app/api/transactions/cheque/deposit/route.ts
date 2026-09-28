import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  CHEQUE_IMAGE_BUCKET, CHEQUE_METHOD_KEY, CHEQUE_METHOD_LABEL,
  chequeDepositSchema, readChequeImage
} from "@/lib/cheques";
import { chequeInsertError, isActiveAccount, REQUIRED_CHEQUE_COLUMNS } from "@/lib/cheque-server";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { insertTransaction } from "@/lib/transactions";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Two images of at most 5 MB each, plus ordinary form fields.
  if (Number(request.headers.get("content-length")) > 11 * 1024 * 1024) {
    return NextResponse.json({ error: "Cheque images must be 5 MB or smaller each." }, { status: 413 });
  }

  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Submit cheque details and two images." }, { status: 400 });

  const parsed = chequeDepositSchema.safeParse({
    amount: form.get("amount"),
    chequeNumber: form.get("chequeNumber"),
    bankName: form.get("bankName"),
    payerName: form.get("payerName"),
    chequeDate: form.get("chequeDate")
  });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid cheque details." }, { status: 400 });
  }

  const front = await readChequeImage(form.get("frontImage"));
  if (!front.ok) return NextResponse.json({ error: `Front image: ${front.error}` }, { status: 400 });
  const back = await readChequeImage(form.get("backImage"));
  if (!back.ok) return NextResponse.json({ error: `Back image: ${back.error}` }, { status: 400 });

  try {
    const supabase = createSupabaseAdminClient();
    if (!await isActiveAccount(supabase, user.id)) {
      return NextResponse.json({ error: "An active account is required to deposit a cheque." }, { status: 403 });
    }

    const id = randomUUID();
    const prefix = `${user.id}/${id}`;
    const frontImagePath = `${prefix}/front.${front.extension}`;
    const backImagePath = `${prefix}/back.${back.extension}`;
    const uploaded: string[] = [];
    let saved = false;

    try {
      for (const image of [
        { path: frontImagePath, file: front },
        { path: backImagePath, file: back }
      ]) {
        const { error } = await supabase.storage.from(CHEQUE_IMAGE_BUCKET).upload(image.path, image.file.bytes, {
          contentType: image.file.contentType,
          upsert: false
        });
        if (error) {
          console.error("Cheque image upload failed:", error);
          return NextResponse.json({ error: "Cheque image upload is unavailable. Please contact support." }, { status: 500 });
        }
        uploaded.push(image.path);
      }

      const { data, error } = await insertTransaction(supabase, {
        id,
        user_id: user.id,
        // Older installations still have a profiles foreign key on this table.
        profile_id: user.id,
        type: "deposit",
        status: "pending",
        amount: parsed.data.amount,
        method_key: CHEQUE_METHOD_KEY,
        method_label: CHEQUE_METHOD_LABEL,
        description: `Cheque deposit · ${parsed.data.bankName}`,
        cheque_details: {
          kind: "deposit",
          chequeNumber: parsed.data.chequeNumber,
          bankName: parsed.data.bankName,
          payerName: parsed.data.payerName,
          chequeDate: parsed.data.chequeDate,
          frontImagePath,
          backImagePath
        }
      }, { requiredColumns: REQUIRED_CHEQUE_COLUMNS });

      if (error) {
        console.error("Cheque deposit insert failed:", error);
        return NextResponse.json({ error: chequeInsertError(error) }, { status: 400 });
      }
      saved = true;
      return NextResponse.json({ transaction: data }, { status: 201 });
    } finally {
      // Never leave scans in storage if the second upload or DB write fails.
      if (!saved && uploaded.length) {
        const { error } = await supabase.storage.from(CHEQUE_IMAGE_BUCKET).remove(uploaded);
        if (error) console.error("Could not clean up cheque images:", error);
      }
    }
  } catch (error) {
    console.error("Cheque deposit request failed:", error);
    return NextResponse.json({ error: "Could not submit cheque deposit. Please try again." }, { status: 500 });
  }
}
