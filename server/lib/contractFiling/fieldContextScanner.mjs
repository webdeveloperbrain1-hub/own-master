import { config } from "./filingConfig.mjs";
import { detectTemplateFields } from "./templateFiller.mjs";

export async function scanTemplateFieldsWithAI(template) {
  const baseFields = detectTemplateFields(template.extractedText || "", template);
  if (process.env.AI_FEATURES_ENABLED !== 'true')
    return { status: 'needs_review', analyzerModel: 'deterministic-fallback', fields: baseFields, warnings: ['Fields were extracted without AI. Review them before use.'] };
  const candidates = baseFields
    .filter((field) => !field.hidden)
    .map((field) => ({
      key: field.key,
      currentLabel: field.label,
      type: field.type,
      required: Boolean(field.required),
      source: field.source,
      contextBefore: field.contextBefore || "",
      contextAfter: field.contextAfter || "",
      placementLabel: field.placementLabel || "",
      placementIndex: field.placementIndex,
      placementOffset: field.placementOffset,
      anchorText: field.anchorText || "",
      token: field.token || "",
      insertMode: field.insertMode || "",
      draftOrder: field.draftOrder
    }));

  if (!candidates.length) {
    return {
      status: "complete",
      analyzerModel: "deterministic-no-fields",
      fields: [],
      warnings: ["No visible fillable fields were detected."]
    };
  }

  const result = await requestFieldScan(template, candidates, false);
  if (result.ok) return result.value;

  const retry = await requestFieldScan(template, candidates, true);
  if (retry.ok) return retry.value;

  return {
    status: "needs_review",
    analyzerModel: "deterministic-fallback",
    fields: baseFields,
    warnings: [`AI field context scan failed: ${retry.error || result.error}`]
  };
}

async function requestFieldScan(template, candidates, strictRetry) {
  if (config.aiProvider !== "ollama") {
    return { ok: false, error: `Unsupported AI_PROVIDER=${config.aiProvider}` };
  }

  const content = `${strictRetry ? "Return parseable JSON only. No markdown." : "Return JSON only."}

You are improving a contract template filler.
For each fillable field, decide the clearest user-facing input label based only on the template title and surrounding text.
Do not invent fields that are not present.
Hide fields only if they are signature/admin-only, not a user-filled contract term.
Prefer labels like "Publisher legal name", "Writer address", "Performance fee", "Governing law state", "Additional terms".
Use type: text, textarea, paragraph, date, money, or percent.
Use paragraph only when the answer should be a sentence, clause, terms section, description, rider, obligations, rights, services, or conditions.
Labels must be short noun phrases. Do not include raw context in parentheses such as "(by and between)" or "(pay agent as follows)".
Fix obvious OCR/truncation errors in labels, for example "sical compositions" should be "Musical compositions".
Set required=true only for fields that are essential to complete the contract: party names, main dates, main payment/fee/royalty fields, and the primary subject/work/performance. Optional terms, rider text, governing law, addresses, tax IDs, and signatures should usually be required=false.
If two fields would have the same label, make them distinct with a meaningful suffix like "start date", "end date", "payment term A", or "publisher address".

Template:
${template.originalName}
Title: ${template.title || ""}
Type: ${template.contractType || ""}

Fields to review:
${JSON.stringify(candidates, null, 2)}

Required response schema:
{
  "fields": [
    {
      "key": "same key from input",
      "label": "clear input label",
      "type": "text|textarea|paragraph|date|money|percent",
      "required": true,
      "hidden": false,
      "helpText": "short helpful guidance"
    }
  ],
  "warnings": ["optional notes"]
}`;

  try {
    const response = await fetch(`${config.ollamaBaseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.ollamaModel,
        messages: [
          {
            role: "system",
            content:
              "You label contract template fill fields. You must preserve keys exactly, never add unrelated fields, and output strict JSON."
          },
          { role: "user", content }
        ],
        stream: false,
        format: "json",
        options: { temperature: 0.1, num_ctx: 16384, num_predict: 2400 }
      })
    });

    if (!response.ok) return { ok: false, error: `Ollama HTTP ${response.status}` };
    const data = await response.json();
    const parsed = JSON.parse(data?.message?.content || "{}");
    return { ok: true, value: normalizeAIFieldScan(parsed, candidates) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function normalizeAIFieldScan(parsed, candidates) {
  const byKey = new Map(candidates.map((field) => [field.key, field]));
  const allowedTypes = new Set(["text", "textarea", "paragraph", "date", "money", "percent"]);
  const used = new Set();
  const fields = [];

  const seenLabels = new Map();
  for (const raw of Array.isArray(parsed.fields) ? parsed.fields : []) {
    const base = byKey.get(raw.key);
    if (!base || used.has(raw.key)) continue;
    used.add(raw.key);
    const derived = deriveLabelAndType(base, raw);
    const label = uniqueLabel(derived.label || cleanLabel(raw.label) || base.currentLabel, seenLabels, base);
    fields.push({
      ...base,
      label,
      type: allowedTypes.has(derived.type) ? derived.type : allowedTypes.has(raw.type) ? raw.type : base.type,
      required: Boolean(raw.required),
      hidden: Boolean(raw.hidden || derived.hidden),
      helpText: cleanText(raw.helpText) || "Fill this exactly as it should appear in the contract.",
      source: "ai_field_scan"
    });
  }

  for (const candidate of candidates) {
    if (used.has(candidate.key)) continue;
    const derived = deriveLabelAndType(candidate, {});
    const label = uniqueLabel(derived.label || candidate.currentLabel, seenLabels, candidate);
    fields.push({
      ...candidate,
      label,
      type: derived.type || candidate.type,
      hidden: Boolean(derived.hidden),
      helpText: "Fill this exactly as it should appear in the contract.",
      source: "ai_field_scan_fallback"
    });
  }

  return {
    status: "complete",
    analyzerModel: config.ollamaModel,
    fields,
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map(String).slice(0, 10) : []
  };
}

function deriveLabelAndType(field, raw = {}) {
  const current = `${field.currentLabel || ""} ${raw.label || ""}`.toLowerCase();
  const context = `${field.contextBefore || ""} ${field.contextAfter || ""}`.toLowerCase();
  const before = String(field.contextBefore || "").toLowerCase();
  const vague = isVagueField(field, raw);

  if (isAdminSignatureContext(current, context)) {
    return { label: cleanLabel(raw.label) || field.currentLabel, type: raw.type || field.type, hidden: true };
  }

  if (field.key?.includes("composition_title")) {
    return { label: "Composition title", type: "textarea", hidden: false };
  }
  if (field.key === "recipient_name") {
    return { label: "Vocalist name", type: "text", hidden: false };
  }
  if (vague && before.includes("written and composed by")) {
    return { label: "Writer or composer name", type: "text", hidden: false };
  }
  if (before.endsWith(" i,") || before.includes("agreement of obligation to pay i,")) {
    return { label: "Artist legal name", type: "text", hidden: false };
  }
  if (before.includes("musical compositions shall include and are limited to")) {
    return { label: "Musical compositions included and limited to", type: "paragraph", hidden: false };
  }
  if (before.includes("persons due payment for services rendered on above recordings")) {
    return { label: "People owed payment for recording services", type: "paragraph", hidden: false };
  }
  if (before.includes("on the the date(s) of")) return { label: "Recording date(s)", type: "date", hidden: false };
  if (before.includes("at the address of")) return { label: "Recording studio address", type: "textarea", hidden: false };
  if (before.includes("in the state of")) return { label: "Recording studio state", type: "text", hidden: false };
  if (before.includes("studios in the city of")) return { label: "Recording studio city", type: "text", hidden: false };
  if (vague && before.includes("copyright office") && before.includes(" on")) {
    return { label: "Copyright registration date", type: "date", hidden: false };
  }
  if (vague && before.includes("date:") && context.includes("publisher") && context.includes("writer")) {
    return { label: "Signature name", type: "text", hidden: true };
  }
  if (vague && before.includes("by and between")) {
    return { label: "Assignor legal name", type: "text", hidden: false };
  }
  if (vague && before.includes("assignor") && before.endsWith("and")) {
    return { label: "Agent legal name", type: "text", hidden: false };
  }
  if (before.includes("event description")) {
    return { label: "Event description", type: "paragraph", hidden: false };
  }
  if (String(field.contextAfter || "").toLowerCase().startsWith("whereas, event shall take place")) {
    return { label: "Event description", type: "paragraph", hidden: false };
  }
  if (vague && before.includes("event shall take place on")) {
    return { label: "Event date(s)", type: "date", hidden: false };
  }
  if (vague && before.includes("(date or dates)") && before.includes("between") && before.trim().endsWith("and")) {
    return { label: "Event end time", type: "text", hidden: false };
  }
  if (vague && before.includes("(date or dates)") && before.includes("between")) {
    return { label: "Event start time", type: "text", hidden: false };
  }
  if (vague && String(field.contextAfter || "").toLowerCase().includes("event location")) {
    return { label: "Event location", type: "textarea", hidden: false };
  }
  if (before.includes("per hour for each hour") && before.includes("hereunder; or, (b) dollars")) {
    return { label: "Producer daily fee", type: "money", hidden: false };
  }
  if (before.includes("(b) dollars") && context.includes("per day")) {
    return { label: "Producer daily fee", type: "money", hidden: false };
  }
  if (before.includes("agrees to pay producer the following: (a) dollars")) {
    return { label: "Producer hourly fee", type: "money", hidden: false };
  }
  if (before.includes("additional sum of ($")) {
    return { label: "Engineering services fee", type: "money", hidden: false };
  }
  if (before.includes("agreement shall be for") || before.includes("duration of this agreement shall be for")) {
    return { label: "Agreement term in years", type: "text", hidden: false };
  }
  if (before.includes("publishing and copyrights to either")) {
    return { label: "Publisher performing rights organization", type: "text", hidden: false };
  }
  if (before.includes("serve as the agreement with")) {
    return { label: "Producer legal name", type: "text", hidden: false };
  }
  if (before.includes("producer agrees to produce")) {
    return { label: "Number of masters or recordings", type: "text", hidden: false };
  }
  if (before.includes("pay you the sum of") && context.includes("advance")) {
    return { label: "Advance amount", type: "money", hidden: false };
  }
  if (before.includes("pay you the sum of")) {
    return { label: "Royalty payment amount", type: "money", hidden: false };
  }
  if (before.includes("jurisdiction of the courts of")) {
    return { label: "Jurisdiction state", type: "text", hidden: false };
  }
  if (before.includes("of the agreed price $")) {
    return { label: "Agent commission amount", type: "money", hidden: false };
  }
  if (before.includes("agrees and guarantees to pay")) {
    return { label: "Agent commission percentage", type: "percent", hidden: false };
  }
  if (context.includes("(city, state, zip)")) {
    return { label: "City, state, and zip code", type: "textarea", hidden: false };
  }
  if (vague && (context.includes("pay agent as follows") || context.includes("gross receipts") || context.includes("retail selling price") || context.includes("all monies paid"))) {
    return { label: compensationLabel(context), type: "percent", hidden: false };
  }
  if (vague && context.includes("sub-publishers within the territory of")) {
    return { label: "Licensed territory", type: "text", hidden: false };
  }
  if (vague && (context.includes("composition/album") || context.includes("musical work referred to as"))) {
    if (context.includes("music and lyrics by")) return { label: "Composer or lyricist name(s)", type: "textarea", hidden: false };
    return { label: "Composition or album title", type: "textarea", hidden: false };
  }
  if (vague && context.includes("term of this agreement shall be for a period of")) {
    return { label: "Agreement term in years", type: "text", hidden: false };
  }
  if (vague && context.includes("laws of the state of")) {
    return { label: "Governing law state", type: "text", hidden: false };
  }
  if (vague) {
    return { label: fallbackContextLabel(field), type: raw.type || field.type, hidden: false };
  }
  return {};
}

function isVagueField(field, raw = {}) {
  const label = `${field.currentLabel || ""} ${raw.label || ""}`.toLowerCase().trim();
  return (
    label.startsWith("field after") ||
    label.startsWith("field before") ||
    label === "by" ||
    label === "on" ||
    label === "at" ||
    label.includes(" referred to as") ||
    label.startsWith("referred to as")
  );
}

function compensationLabel(context) {
  if (context.includes("(a)") || context.includes(" a)")) return "Agent compensation percentage A";
  if (context.includes("(b)") || context.includes(" b)")) return "Agent compensation percentage B";
  if (context.includes("(c)") || context.includes(" c)")) return "Agent compensation percentage C";
  if (context.includes("(d)") || context.includes(" d)")) return "Agent compensation percentage D";
  return "Agent compensation percentage";
}

function isAdminSignatureContext(label, context) {
  return (
    label.includes("____") ||
    label.includes("signature") ||
    label.includes("witness") ||
    label.includes("notary") ||
    label.includes("assignor by") ||
    label.includes("agent by") ||
    label.includes("hands") ||
    label.includes("hands the day and year") ||
    context.includes("in witness whereof") ||
    context.includes("i set my name to this agreement the") ||
    context.includes("set their hands") ||
    context.includes("assignor by:") ||
    context.includes("agent by:")
  );
}

function fallbackContextLabel(field) {
  const before = String(field.contextBefore || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(-5)
    .join(" ");
  if (before) return sentenceCase(before);
  return cleanLabel(field.currentLabel) || "Template field";
}

function cleanLabel(value) {
  const text = cleanText(value);
  if (!text) return "";
  return text
    .replace(/^Field (?:after|before)\s+["“]?(.+?)["”]?$/i, "$1")
    .replace(/\bsical\b/gi, "Musical")
    .replace(/\s*\((?:by and between|referred to as|pay agent as follows:? ?|laws of the state of|be for a period of)[^)]*\)/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function cleanText(value) {
  return String(value || "").trim();
}

function sentenceCase(value) {
  const text = String(value || "").trim();
  return text ? text[0].toUpperCase() + text.slice(1) : "";
}

function uniqueLabel(label, seenLabels, field) {
  const base = label || "Field";
  const count = seenLabels.get(base) || 0;
  seenLabels.set(base, count + 1);
  if (!count) return base;

  const context = `${field.placementLabel || ""} ${field.contextBefore || ""} ${field.contextAfter || ""}`.toLowerCase();
  if (context.includes("(a)") || context.includes(" a)")) return `${base} A`;
  if (context.includes("(b)") || context.includes(" b)")) return `${base} B`;
  if (context.includes("(c)") || context.includes(" c)")) return `${base} C`;
  if (context.includes("(d)") || context.includes(" d)")) return `${base} D`;
  if (context.includes("start")) return `${base} start`;
  if (context.includes("end")) return `${base} end`;
  return `${base} ${count + 1}`;
}
