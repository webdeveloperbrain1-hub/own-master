const CATEGORY_RULES = [
  ["producer", "Production"],
  ["record", "Recording"],
  ["songwriter", "Songwriting"],
  ["publisher", "Publishing"],
  ["copyright", "Copyright"],
  ["management", "Management"],
  ["booking", "Booking"],
  ["royalty", "Royalties"],
  ["licens", "Licensing"],
  ["distribution", "Distribution"],
  ["sponsor", "Sponsorship"],
  ["agency", "Agency"],
  ["merchandise", "Merchandising"]
];

export function fallbackAnalyze({ originalName, text, reason }) {
  const haystack = `${originalName}\n${text}`.toLowerCase();
  const match = CATEGORY_RULES.find(([needle]) => haystack.includes(needle));
  const title = titleize(originalName);
  const snippets = collectRiskFlags(text);

  return {
    analysisStatus: "needs_review",
    needsReview: true,
    reviewReason: reason || "AI analysis unavailable or returned malformed JSON",
    title,
    contractType: match?.[1] || "Unclassified Music Contract",
    category: match?.[1] || "Unclassified",
    parties: [],
    effectiveDate: null,
    expirationDate: null,
    summary: text
      ? `Draft filing created from extracted text. Manual review is required before relying on the analysis.`
      : `No usable text was extracted. Manual review is required.`,
    keyTerms: [],
    obligations: [],
    rights: [],
    paymentTerms: null,
    territory: null,
    duration: null,
    governingLaw: null,
    renewalTerms: null,
    terminationTerms: null,
    riskFlags: snippets,
    tags: [...new Set([match?.[1], "needs-review"].filter(Boolean))],
    confidence: 0.2,
    analyzerModel: "deterministic-fallback"
  };
}

function titleize(name) {
  return name
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+\(\d+\)$/g, "")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function collectRiskFlags(text = "") {
  const flags = [];
  const checks = [
    ["termination", "Contains termination language"],
    ["exclusive", "May include exclusivity obligations"],
    ["royalt", "Contains royalty/payment language"],
    ["assignment", "May assign rights or copyright"],
    ["perpetuity", "May include perpetual rights"],
    ["indemn", "Contains indemnity language"]
  ];

  for (const [needle, label] of checks) {
    if (text.toLowerCase().includes(needle)) flags.push(label);
  }

  return flags;
}
