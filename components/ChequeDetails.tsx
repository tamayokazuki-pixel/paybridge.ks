"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { chequeDetailsSchema } from "@/lib/cheques";
import { money } from "@/lib/format";

type ChequeTransaction = {
  id: string;
  type: string;
  status: string;
  amount: number;
  cheque_details?: unknown;
  reference?: string | null;
  admin_note?: string | null;
};

type ImageUrls = { frontUrl: string; backUrl: string };

export function ChequeDetails({ transaction, onClose, onImagesReady, children }: {
  transaction: ChequeTransaction;
  onClose: () => void;
  onImagesReady?: (ready: boolean) => void;
  children?: React.ReactNode;
}) {
  const details = chequeDetailsSchema.safeParse(transaction.cheque_details);
  const cheque = details.success && details.data.kind === transaction.type ? details.data : null;
  const kind = cheque?.kind;
  const [images, setImages] = useState<ImageUrls | null>(null);
  const [imageError, setImageError] = useState("");
  const [loadingImages, setLoadingImages] = useState(false);
  const [frontLoaded, setFrontLoaded] = useState(false);
  const [backLoaded, setBackLoaded] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    // An admin may approve only after both private scans actually rendered.
    onImagesReady?.(kind === "deposit" && !!images && !imageError && frontLoaded && backLoaded);
  }, [kind, images, imageError, frontLoaded, backLoaded, onImagesReady]);

  useEffect(() => {
    if (kind !== "deposit") return;
    const controller = new AbortController();
    setImages(null);
    setFrontLoaded(false);
    setBackLoaded(false);
    setImageError("");
    setLoadingImages(true);

    fetch(`/api/transactions/cheque/${encodeURIComponent(transaction.id)}/images`, { signal: controller.signal })
      .then(async (res) => {
        const payload = await res.json();
        if (!res.ok) throw new Error(payload.error || "Images are unavailable.");
        return payload as ImageUrls;
      })
      .then((urls) => {
        if (!controller.signal.aborted) {
          setImages(urls);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) setImageError(error instanceof Error ? error.message : "Images are unavailable.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingImages(false);
      });

    return () => {
      controller.abort();
      onImagesReady?.(false);
    };
  }, [kind, transaction.id, retry, onImagesReady]);

  return (
    <section className="card p-6" aria-label="Cheque request details">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-teal2">Cheque {transaction.type}</p>
          <h2 className="mt-1 font-head text-2xl font-bold">{money(transaction.amount)}</h2>
          <p className="mt-1 text-sm text-grey">Request {transaction.id.slice(0, 8)} · <span className="capitalize">{transaction.status}</span></p>
        </div>
        <button aria-label="Close cheque details" className="btn-secondary px-3 py-2" onClick={onClose} type="button"><X size={18} /></button>
      </div>

      {!cheque ? (
        <p className="mt-5 text-sm text-red-600">Cheque details are unavailable. Do not approve this request.</p>
      ) : cheque.kind === "deposit" ? (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <Detail label="Issuing bank" value={cheque.bankName} />
            <Detail label="Cheque number" value={cheque.chequeNumber} />
            <Detail label="Payer" value={cheque.payerName} />
            <Detail label="Cheque date" value={cheque.chequeDate} />
          </div>
          <div className="mt-5">
            <p className="label">Front and endorsed back</p>
            {loadingImages ? <p className="text-sm text-grey">Loading private cheque images…</p> : null}
            {imageError ? (
              <div className="text-sm text-red-600">
                {imageError}{" "}
                <button className="font-bold underline" onClick={() => setRetry((value) => value + 1)} type="button">Try again</button>
              </div>
            ) : null}
            {images ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {([ ["Front", images.frontUrl], ["Back", images.backUrl] ] as const).map(([side, url]) => (
                  <div className="rounded-xl border border-slate-200 p-3" key={side}>
                    <p className="mb-2 text-sm font-bold">{side}</p>
                    {/* Storage returns short-lived signed URLs from the private bucket. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img alt={`${side} of cheque`} className="h-48 w-full rounded-lg bg-off object-contain" onLoad={() => side === "Front" ? setFrontLoaded(true) : setBackLoaded(true)} onError={() => setImageError("An image could not be displayed. Please reload the images.")} src={url} />
                    <a className="mt-2 inline-block text-sm font-bold text-teal2 underline" href={url} rel="noopener noreferrer" target="_blank">Open full size</a>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <Detail label="Payee" value={cheque.payeeName} />
          <Detail label="Mail cheque to" value={[
            cheque.mailingAddress.line1,
            cheque.mailingAddress.line2,
            `${cheque.mailingAddress.city}, ${cheque.mailingAddress.region} ${cheque.mailingAddress.postalCode}`,
            cheque.mailingAddress.country
          ].filter(Boolean).join("\n")} />
        </div>
      )}
      {transaction.reference ? <p className="mt-4 text-sm"><strong>Reference:</strong> {transaction.reference}</p> : null}
      {transaction.admin_note ? <p className="mt-2 text-sm"><strong>Admin note:</strong> {transaction.admin_note}</p> : null}
      {children}
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-off p-4">
      <p className="text-xs font-bold uppercase tracking-wider text-grey">{label}</p>
      <p className="mt-1 whitespace-pre-line break-words font-semibold">{value}</p>
    </div>
  );
}
