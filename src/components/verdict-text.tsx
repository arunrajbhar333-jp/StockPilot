import { cn } from "@/lib/utils";

type VerdictTone = "buy" | "sell" | "hold";

/** Uppercase verdict words the analyst (or the model) can emit. */
const TOKENS = [
  "STRONG SELL",
  "STRONG BUY",
  "SELL",
  "BUY",
  "HOLD",
  "APPLY",
  "AVOID",
  "WATCH",
  "WAIT",
  "START",
] as const;

type Token = (typeof TOKENS)[number];

const TOKEN_TONE: Record<Token, VerdictTone> = {
  "STRONG SELL": "sell",
  SELL: "sell",
  AVOID: "sell",
  "STRONG BUY": "buy",
  BUY: "buy",
  APPLY: "buy",
  START: "buy",
  HOLD: "hold",
  WATCH: "hold",
  WAIT: "hold",
};

const tokenPattern = () => new RegExp(`\\b(${TOKENS.join("|")})\\b`, "g");

/** Solid, impossible-to-miss chip colours for verdicts inside prose. */
const chipStyles: Record<VerdictTone, string> = {
  buy: "bg-emerald-500 text-white",
  sell: "bg-red-500 text-white",
  hold: "bg-amber-400 text-amber-950",
};

const bannerStyles: Record<VerdictTone, string> = {
  buy: "border-emerald-500/40 bg-emerald-500/10",
  sell: "border-red-500/40 bg-red-500/10",
  hold: "border-amber-400/40 bg-amber-400/10",
};

function isToken(value: string): value is Token {
  return (TOKENS as readonly string[]).includes(value);
}

function VerdictChip({ token }: { token: Token }) {
  return (
    <span
      className={cn(
        "mx-0.5 inline-flex items-center rounded px-1.5 py-0.5 align-middle text-[10px] font-extrabold tracking-[0.08em] whitespace-nowrap",
        chipStyles[TOKEN_TONE[token]],
      )}
    >
      {token}
    </span>
  );
}

/** Renders `**bold**` runs and turns uppercase verdict words into badges. */
function renderInline(text: string, keyPrefix: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).flatMap((chunk, chunkIndex) => {
    if (!chunk) return [];

    const bold = chunk.startsWith("**") && chunk.endsWith("**");
    const inner = bold ? chunk.slice(2, -2) : chunk;

    return inner.split(tokenPattern()).flatMap((piece, pieceIndex) => {
      if (!piece) return [];
      const key = `${keyPrefix}-${chunkIndex}-${pieceIndex}`;

      if (isToken(piece)) return [<VerdictChip key={key} token={piece} />];
      if (bold) {
        return [
          <strong key={key} className="font-semibold text-foreground">
            {piece}
          </strong>,
        ];
      }
      return [<span key={key}>{piece}</span>];
    });
  });
}

/**
 * Splits a line such as `**FINAL VERDICT: SELL**` into its label, the verdict
 * and any trailing sentence, so the decision renders as a highlighted banner.
 */
function parseVerdictLine(line: string) {
  const plain = line.replace(/[*_`#]/g, "").trim();
  const match = plain.match(
    /^(?:final\s+)?(?:verdict|call|recommendation)\s*[:\-–—]\s*(.+)$/i,
  );
  if (!match) return null;

  const tail = match[1].trim();
  const candidates: string[] = tail.toUpperCase().match(tokenPattern()) ?? [];
  const token = candidates.find((value): value is Token => isToken(value));
  if (!token) return null;

  const rest = tail
    .replace(new RegExp(`\\b${token}\\b`), "")
    .replace(/^[\s\-–—:,.]+/, "")
    .replace(/[\s\-–—:,.]+$/, "")
    .trim();

  return { token, rest, tone: TOKEN_TONE[token] };
}

/**
 * Renders an AI reply or reasoning string. Markdown bold is honoured and any
 * verdict (BUY / STRONG BUY / HOLD / SELL / STRONG SELL / APPLY / AVOID) is
 * highlighted so the final decision cannot be missed.
 */
export function VerdictText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {lines.map((line, index) => {
        const trimmed = line.trim();
        if (!trimmed) return <span key={index} className="h-1" aria-hidden />;

        const verdict = parseVerdictLine(trimmed);
        if (verdict) {
          return (
            <div
              key={index}
              className={cn(
                "mt-1 flex flex-wrap items-center gap-2 rounded-lg border px-2.5 py-1.5",
                bannerStyles[verdict.tone],
              )}
            >
              <span className="text-[9px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
                Final verdict
              </span>
              <VerdictChip token={verdict.token} />
              {verdict.rest ? (
                <span className="text-[11px] leading-relaxed text-muted-foreground">
                  {verdict.rest}
                </span>
              ) : null}
            </div>
          );
        }

        return (
          <p key={index} className="leading-relaxed">
            {renderInline(trimmed, String(index))}
          </p>
        );
      })}
    </div>
  );
}
