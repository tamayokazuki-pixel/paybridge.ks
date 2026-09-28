import { z } from "zod";

export const CHEQUE_METHOD_KEY = "cheque";
export const CHEQUE_METHOD_LABEL = "Cheque";
export const CHEQUE_IMAGE_BUCKET = "cheque-images";
export const MAX_CHEQUE_IMAGE_BYTES = 5 * 1024 * 1024;

// Amounts are stored as numeric(14,2) in Postgres. Do not silently round a
// customer's request (or accept Infinity / more than two decimal places).
export const chequeAmountSchema = z.number().finite().min(50, "Minimum amount is $50")
  .max(999_999_999_999.99)
  .refine((value) => /^\d+(?:\.\d{1,2})?$/.test(String(value)), "Use dollars and cents (at most two decimal places)");

const requiredText = (label: string, max: number) =>
  z.string().trim().min(1, `${label} is required`).max(max, `${label} is too long`);

const mailingAddressSchema = z.object({
  line1: requiredText("Street address", 160),
  line2: z.string().trim().max(160).optional(),
  city: requiredText("City", 80),
  region: requiredText("State / region", 80),
  postalCode: requiredText("Postal code", 24),
  country: requiredText("Country", 80)
}).strict();

export const chequeDepositSchema = z.object({
  amount: z.string().trim().regex(/^\d+(?:\.\d{1,2})?$/, "Enter an amount in dollars and cents")
    .transform(Number).pipe(chequeAmountSchema),
  chequeNumber: requiredText("Cheque number", 32).regex(/^[\p{L}\p{N} -]+$/u, "Cheque number contains invalid characters"),
  bankName: requiredText("Issuing bank", 100),
  payerName: requiredText("Payer name", 100),
  chequeDate: z.string().date().refine(
    (value) => value <= new Date().toISOString().slice(0, 10),
    "Cheque date cannot be in the future"
  )
}).strict();

export const chequeWithdrawalSchema = z.object({
  amount: chequeAmountSchema,
  payeeName: requiredText("Payee name", 100),
  mailingAddress: mailingAddressSchema
}).strict();

export const chequeDepositDetailsSchema = chequeDepositSchema.omit({ amount: true }).extend({
  kind: z.literal("deposit"),
  frontImagePath: z.string().min(1),
  backImagePath: z.string().min(1)
});

export const chequeWithdrawalDetailsSchema = chequeWithdrawalSchema.omit({ amount: true }).extend({
  kind: z.literal("withdrawal")
});

export const chequeDetailsSchema = z.discriminatedUnion("kind", [
  chequeDepositDetailsSchema,
  chequeWithdrawalDetailsSchema
]);

export type ChequeDetails = z.infer<typeof chequeDetailsSchema>;
export type ChequeDepositDetails = z.infer<typeof chequeDepositDetailsSchema>;
export type ChequeWithdrawalDetails = z.infer<typeof chequeWithdrawalDetailsSchema>;

export function isChequeTransaction(transaction: { method_key?: string | null }) {
  return transaction.method_key === CHEQUE_METHOD_KEY;
}

type ImageContentType = "image/jpeg" | "image/png" | "image/webp";

function imageType(bytes: Uint8Array): ImageContentType | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)) return "image/png";
  if (bytes.length >= 12 && [0, 1, 2, 3].map((i) => String.fromCharCode(bytes[i])).join("") === "RIFF" &&
      [8, 9, 10, 11].map((i) => String.fromCharCode(bytes[i])).join("") === "WEBP") return "image/webp";
  return null;
}

/** Never trust the browser-supplied filename or MIME type for a cheque scan. */
export async function readChequeImage(file: FormDataEntryValue | null): Promise<
  | { ok: true; bytes: Uint8Array; contentType: ImageContentType; extension: string }
  | { ok: false; error: string }
> {
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Select an image of this side of the cheque." };
  if (file.size > MAX_CHEQUE_IMAGE_BYTES) return { ok: false, error: "Each image must be 5 MB or smaller." };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentType = imageType(bytes);
  if (!contentType || (file.type && file.type !== contentType)) {
    return { ok: false, error: "Upload a valid JPEG, PNG or WebP image (not a renamed file)." };
  }
  const extension = contentType === "image/jpeg" ? "jpg" : contentType === "image/png" ? "png" : "webp";
  return { ok: true, bytes, contentType, extension };
}
