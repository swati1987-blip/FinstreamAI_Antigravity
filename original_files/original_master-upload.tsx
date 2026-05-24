import { useCallback, useRef, useState } from "react";
import { UploadCloud, Loader2, FileText, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

const WEBHOOK_URL =
  "https://hook.eu1.make.com/gluqiwaidwi3telj1tjdl3byreiguxc9";
const WEBHOOK_TIMEOUT_MS = 120_000;

export interface WebhookTransaction {
  bill_date?: string;
  vendor?: string;
  amount?: number | string;
  currency?: string;
  entity?: string;
  category?: string;
  description?: string;
}

interface MasterUploadProps {
  onAuditingChange: (auditing: boolean) => void;
  onSuccess: (count: number) => void;
}

async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  // Use the bundled worker via Vite ?url import
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text +=
      content.items
        .map((it) => ("str" in it ? (it as { str: string }).str : ""))
        .join(" ") + "\
<truncated 6267 bytes>
y line.
          </p>

          {busy ? (
            <div className="mt-3 flex items-center gap-2 text-xs text-[var(--crystal-teal)]">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>
                FinStream AI is auditing your monthly statement over secure
                cloud servers…
              </span>
            </div>
          ) : (
            <div className="mt-3 flex items-center gap-3 flex-wrap">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="px-3 py-1.5 text-xs font-medium rounded-md bg-[var(--crystal-teal)] text-[var(--midnight-navy)] hover:brightness-110 transition"
              >
                Choose file
              </button>
              <span className="text-[11px] text-[var(--marble-white)]/50">
                or drag &amp; drop here · PDF, CSV
              </span>
            </div>
          )}

          {fileName && (
            <div className="mt-3 inline-flex items-center gap-2 text-[11px] bg-[var(--marble-white)]/10 border border-[var(--rose-copper)]/40 rounded-md px-2 py-1">
              <FileText className="w-3.5 h-3.5 text-[var(--rose-copper)]" />
              <span className="truncate max-w-[260px]">{fileName}</span>
              {!busy && (
                <button
                  type="button"
                  onClick={() => setFileName(null)}
                  className="opacity-70 hover:opacity-100"
                  aria-label="Clear"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
