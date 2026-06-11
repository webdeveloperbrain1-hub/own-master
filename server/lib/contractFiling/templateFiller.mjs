const MAX_FIELDS = 80;

const COMMON_LABELS = [
  "artist",
  "producer",
  "company",
  "employer",
  "musician",
  "publisher",
  "songwriter",
  "manager",
  "agent",
  "address",
  "date",
  "fee",
  "deposit",
  "royalty",
  "percentage",
  "term",
  "territory",
  "venue",
  "performance",
  "recording",
  "composition",
  "title",
  "signature"
];

export function detectTemplateFields(text = "", metadata = {}) {
  const fields = [];
  const seenKeys = new Set();
  const labelKeys = new Map();
  const normalized = text.replace(/\r/g, "\n");

  collectPresetFields(normalized, metadata, fields, seenKeys, labelKeys);
  const hasPreset = fields.length > 0;
  collectLabelFields(normalized, fields, seenKeys, labelKeys);
  collectUnderscoreFields(normalized, fields, seenKeys, labelKeys);
  collectImplicitPromptFields(normalized, fields, seenKeys, labelKeys);
  collectNoBlankPromptFields(normalized, metadata, fields, seenKeys, labelKeys);
  collectRoleTokenFields(normalized, metadata, fields, seenKeys, labelKeys);
  if (!hasPreset) collectNamedPromptFields(normalized, fields, seenKeys, labelKeys);

  if (fields.length === 0) {
    addField(fields, seenKeys, labelKeys, {
      key: "contract_parties",
      label: "Contract parties",
      type: "text",
      required: true,
      helpText: "Enter the names and roles of the people or companies signing this contract.",
      source: "suggested"
    });
    addField(fields, seenKeys, labelKeys, {
      key: "effective_date",
      label: "Effective date",
      type: "date",
      required: false,
      helpText: "Leave blank if the template does not require an effective date.",
      source: "suggested"
    });
  }

  const placementKeys = new Set(
    fields
      .filter((field) => field.source === "blank" || field.source === "label" || field.source === "implicit")
      .map((field) => field.key)
  );

  return suppressBrokenPresetFields(
    suppressRedundantGenericDates(applyDraftOrder(fields.slice(0, MAX_FIELDS))),
    normalized
  ).map((field, index) => ({
    ...field,
    hidden: Boolean(
      field.hidden ||
        isNotNeededInFillForm(field) ||
        (field.source === "preset" && !placementKeys.has(field.key))
    ),
    order: index + 1,
    value: ""
  }));
}

export function mergeStoredFieldScan(text = "", metadata = {}, storedFields = []) {
  const baseFields = detectTemplateFields(text, metadata);
  if (!Array.isArray(storedFields)) return baseFields;
  if (storedFields.length === 0) {
    return baseFields.some((field) => !field.hidden && field.source !== "suggested") ? baseFields : [];
  }

  const storedByKey = new Map(storedFields.map((field) => [field.key, field]));
  const baseKeys = new Set(baseFields.map((field) => field.key));
  const hasRoleTokenFields = baseFields.some((field) => field.source === "role_token");
  const merged = baseFields.map((field) => {
    const stored = storedByKey.get(field.key);
    if (!stored) {
      return {
        ...field,
        hidden: field.source === "implicit" || field.source === "role_token" ? Boolean(field.hidden) : true
      };
    }

    return {
      ...field,
      label: labelForMergedField(field, stored),
      type: typeForMergedField(field, stored),
      required: Boolean(stored.required),
      helpText: stored.helpText || field.helpText,
      hidden:
        hasRoleTokenFields && shouldHideFooterDuplicateField(field, stored)
          ? true
          : shouldForceShowMergedField(field, stored)
            ? false
            : field.hidden
              ? true
              : Boolean(
                  (field.source !== "implicit" && field.source !== "role_token" && stored.hidden) ||
                    shouldHideMergedField(field, stored)
                ),
      currentLabel: stored.currentLabel || field.currentLabel || field.label
    };
  });

  for (const stored of storedFields) {
    if (baseKeys.has(stored.key)) continue;
    merged.push(stored);
  }

  return uniquifyVisibleLabels(suppressBrokenPresetFields(suppressRedundantGenericDates(applyDraftOrder(merged)), text)).map(
    (field, index) => ({
      ...field,
      order: index + 1
    })
  );
}

export function renderFilledTemplate(text = "", fields = [], values = {}) {
  let placeholderIndex = 0;
  const insertedKeys = new Set();
  const placeholderFields = fields.filter((field) => field.source === "blank").sort(compareByPlacement);
  let rendered = text.replace(/_{3,}/g, (match, offset, source) => {
    const field = placeholderFields[placeholderIndex];
    placeholderIndex += 1;
    const alias = field ? valueForBlank(field, values) : null;
    const rawValue = field ? cleanValue(values[field.key]) || alias?.value || "" : "";
    if (!field || (field.hidden && !shouldRenderHiddenBlankWithValue(field, rawValue))) return "";
    const value = field ? formatValueForBlank(rawValue, field, source.slice(offset + match.length, offset + match.length + 20)) : "";
    if (!value) return `[${field?.label || "Fill in"}]`;
    insertedKeys.add(field.key);
    if (alias?.key) insertedKeys.add(alias.key);
    const previousChar = source[offset - 1] || "";
    const nextChar = source[offset + match.length] || "";
    const nextText = source.slice(offset + match.length, offset + match.length + 20);
    const leadingSpacer =
      /[A-Za-z0-9)]/.test(previousChar) && !field.label.toLowerCase().includes("agreement year") ? " " : "";
    const trailingSpacer = /[A-Za-z0-9(]/.test(nextChar) && !/^\s*th\s+day/i.test(nextText) ? " " : "";
    return `${leadingSpacer}[[FILLED:${value}]]${trailingSpacer}`;
  });

  for (const field of fields.filter((item) => item.source === "label")) {
    const value = cleanValue(values[field.key]);
    if (!value || !field.labelText) continue;
    const escaped = escapeRegExp(field.labelText);
    const next = rendered.replace(new RegExp(`(${escaped}\\s*:)\\s*(?!\\S)`, "i"), `$1 [[FILLED:${value}]]`);
    if (next !== rendered) insertedKeys.add(field.key);
    rendered = next;
  }

  for (const field of fields.filter((item) => item.source === "implicit").sort(compareByPlacement)) {
    if (!field.anchorText) continue;
    const value = cleanValue(values[field.key]);
    const marker = value ? ` [[FILLED:${value}]]` : ` [${field.label || "Fill in"}]`;
    const next = insertImplicitValue(rendered, field, marker, Boolean(value));
    if (next !== rendered) {
      if (value) insertedKeys.add(field.key);
      rendered = next;
    }
  }

  for (const field of fields.filter((item) => !item.hidden && item.source === "role_token").sort(compareByPlacement)) {
    const value = cleanValue(values[field.key]);
    const marker = value ? `[[FILLED:${value}]]` : `[${field.label || "Fill in"}]`;
    const next = replaceRoleToken(rendered, field, marker);
    if (next !== rendered) {
      if (value) insertedKeys.add(field.key);
      rendered = next;
    }
  }

  const unplacedParagraphs = fields
    .filter(
      (field) =>
        !field.hidden &&
        field.source !== "implicit" &&
        field.type === "paragraph" &&
        cleanValue(values[field.key]) &&
        !insertedKeys.has(field.key)
    )
    .map((field) => `${field.label.toUpperCase()}\n[[FILLED:${cleanValue(values[field.key])}]]`);

  if (unplacedParagraphs.length) {
    rendered = `${rendered.trim()}\n\nADDITIONAL FILLED CLAUSES\n\n${unplacedParagraphs.join("\n\n")}`;
  }

  rendered = cleanupFilledScaffold(rendered);

  return rendered;
}

function compareByPlacement(a, b) {
  const aPlacement = Number.isFinite(a.placementOffset)
    ? a.placementOffset
    : Number.isFinite(a.placementIndex)
      ? a.placementIndex
      : Number.MAX_SAFE_INTEGER;
  const bPlacement = Number.isFinite(b.placementOffset)
    ? b.placementOffset
    : Number.isFinite(b.placementIndex)
      ? b.placementIndex
      : Number.MAX_SAFE_INTEGER;
  if (aPlacement !== bPlacement) return aPlacement - bPlacement;
  return (a.order || 0) - (b.order || 0);
}

function labelForMergedField(field, stored) {
  const before = String(field.contextBefore || "").toLowerCase();
  const after = String(field.contextAfter || "").toLowerCase();
  const context = `${before} ${after}`;
  const label = String(stored.label || field.label || "").trim();
  const lower = label.toLowerCase();

  if (field.key?.includes("composition_title")) return "Composition title";
  if (field.key === "recipient_name") return "Vocalist name";
  if (field.key === "producer_daily_fee") return "Producer daily fee";
  if (before.includes("written and composed by")) return "Writer or composer name";
  if (before.endsWith(" i,") || before.includes("agreement of obligation to pay i,")) return "Artist legal name";
  if (before.includes("musical compositions shall include and are limited to")) return "Musical compositions included and limited to";
  if (before.includes("persons due payment for services rendered on above recordings")) return "People owed payment for recording services";
  if (before.includes("on the the date(s) of")) return "Recording date(s)";
  if (before.includes("at the address of")) return "Recording studio address";
  if (before.includes("in the state of")) return "Recording studio state";
  if (before.includes("studios in the city of")) return "Recording studio city";
  if (before.includes("copyright office") && before.includes(" on")) return "Copyright registration date";
  if (before.includes("event description")) return "Event description";
  if (after.startsWith("whereas, event shall take place")) return "Event description";
  if (before.includes("event shall take place on")) return "Event date(s)";
  if (before.includes("(date or dates)") && before.includes("between") && before.trim().endsWith("and")) return "Event end time";
  if (before.includes("(date or dates)") && before.includes("between")) return "Event start time";
  if (after.includes("event location")) return "Event location";
  if (before.includes("per hour for each hour") && before.includes("hereunder; or, (b) dollars")) return "Producer daily fee";
  if (before.includes("(b) dollars") && after.includes("per day")) return "Producer daily fee";
  if (before.includes("agrees to pay producer the following: (a) dollars")) return "Producer hourly fee";
  if (before.includes("additional sum of ($")) return "Engineering services fee";
  if (before.includes("agreement shall be for") || before.includes("duration of this agreement shall be for")) return "Agreement term in years";
  if (before.includes("publishing and copyrights to either")) return "Publisher performing rights organization";
  if (before.includes("serve as the agreement with")) return "Producer legal name";
  if (before.includes("producer agrees to produce")) return "Number of masters or recordings";
  if (before.includes("pay you the sum of") && after.includes("advance")) return "Advance amount";
  if (before.includes("pay you the sum of")) return "Royalty payment amount";
  if (before.includes("jurisdiction of the courts of")) return "Jurisdiction state";
  if (before.includes("of the agreed price $")) return "Agent commission amount";
  if (before.includes("agrees and guarantees to pay")) return "Agent commission percentage";
  if (context.includes("(city, state, zip)")) return "City, state, and zip code";
  if (lower === "on" && context.includes("agreement")) return "Agreement date";
  if (lower === "at" && context.includes("event")) return "Event location";
  if (lower === "by" && context.includes("written by")) return "Writer name";

  return label || field.label;
}

function typeForMergedField(field, stored) {
  const before = String(field.contextBefore || "").toLowerCase();
  const after = String(field.contextAfter || "").toLowerCase();
  const context = `${before} ${after}`;
  if (before.includes("written and composed by")) return "text";
  if (field.key?.includes("composition_title")) return "textarea";
  if (field.key === "recipient_name") return "text";
  if (before.endsWith(" i,") || before.includes("agreement of obligation to pay i,")) return "text";
  if (before.includes("musical compositions shall include and are limited to")) return "paragraph";
  if (before.includes("persons due payment for services rendered on above recordings")) return "paragraph";
  if (before.includes("on the the date(s) of")) return "date";
  if (before.includes("at the address of")) return "textarea";
  if (before.includes("in the state of")) return "text";
  if (before.includes("studios in the city of")) return "text";
  if (before.includes("copyright office") && before.includes(" on")) return "date";
  if (before.includes("of the agreed price $")) return "money";
  if (before.includes("agrees and guarantees to pay")) return "percent";
  if (before.includes("event shall take place on")) return "date";
  if (before.includes("event description")) return "paragraph";
  if (after.startsWith("whereas, event shall take place")) return "paragraph";
  if (after.includes("event location")) return "textarea";
  if (before.includes("per hour for each hour") && before.includes("hereunder; or, (b) dollars")) return "money";
  if (before.includes("agrees to pay producer the following: (a) dollars")) return "money";
  if (before.includes("additional sum of ($")) return "money";
  if (before.includes("agreement shall be for") || before.includes("duration of this agreement shall be for")) return "text";
  if (before.includes("publishing and copyrights to either")) return "text";
  if (before.includes("serve as the agreement with")) return "text";
  if (before.includes("producer agrees to produce")) return "text";
  if (before.includes("pay you the sum of")) return "money";
  if (before.includes("jurisdiction of the courts of")) return "text";
  if (context.includes("(city, state, zip)")) return "textarea";
  return stored.type || field.type;
}

function shouldHideMergedField(field, stored) {
  const before = String(field.contextBefore || "").toLowerCase();
  const after = String(field.contextAfter || "").toLowerCase();
  const label = String(stored.label || field.label || "").toLowerCase().trim();

  return (
    label.includes("____") ||
    before.includes("i set my name to this agreement the") ||
    (
      label === "by" &&
      before.includes("date:") &&
      after.includes("publisher") &&
      after.includes("writer")
    )
  );
}

function shouldForceShowMergedField(field, stored) {
  const before = String(field.contextBefore || "").toLowerCase();
  const label = String(stored.label || field.label || "").toLowerCase().trim();
  return (
    before.includes("studios in the city of") ||
    before.includes("in the state of") ||
    before.includes("at the address of") ||
    before.includes("musical compositions shall include and are limited to") ||
    before.includes("persons due payment for services rendered on above recordings") ||
    label === "artist legal name"
  );
}

function shouldHideFooterDuplicateField(field, stored) {
  const label = String(stored.label || field.label || "").toLowerCase().trim();
  return field.source === "label" && ["manager legal name", "artist legal name", "manager", "artist"].includes(label);
}

function uniquifyVisibleLabels(fields) {
  const labelCounts = new Map();
  const result = [];

  for (const field of fields) {
    if (field.hidden) {
      result.push(field);
      continue;
    }

    const label = String(field.label || "Field").trim();
    const count = labelCounts.get(label) || 0;
    labelCounts.set(label, count + 1);
    result.push(count ? { ...field, label: `${label} ${count + 1}` } : field);
  }

  return result;
}

function suppressRedundantGenericDates(fields) {
  const hasSpecificExecutionDate = fields.some(
    (field) =>
      !field.hidden &&
      ["execution date", "agreement date"].includes(String(field.label || "").toLowerCase().trim())
  );

  if (!hasSpecificExecutionDate) return fields;

  return fields.map((field) => {
    const label = String(field.label || "").toLowerCase().trim();
    if (field.source === "implicit" && label === "date") return { ...field, hidden: true };
    return field;
  });
}

function suppressBrokenPresetFields(fields, text = "") {
  const hasAgreementDateParts = fields.some(
    (field) =>
      !field.hidden &&
      field.source === "blank" &&
      /agreement (?:day|month|year)|(?:day|month|year) of agreement/i.test(field.label || "")
  );
  const hasDressPrompt = /\bdress\b/i.test(text);

  return fields.map((field) => {
    if (field.key === "agreement_date" && field.source === "implicit" && hasAgreementDateParts) {
      return { ...field, hidden: true };
    }
    if (field.key === "dress_code" && field.source === "preset" && !hasDressPrompt) {
      return { ...field, hidden: true };
    }
    return field;
  });
}

export function renderPreviewHtml(renderedText = "") {
  return escapeHtml(renderedText)
    .replace(/\[\[FILLED:([\s\S]*?)\]\]/g, "<strong class=\"filled-value\">$1</strong>")
    .replace(/\[([^\]\n]{1,80})\]/g, "<strong class=\"placeholder\">[$1]</strong>");
}

export function renderPlainText(renderedText = "") {
  return String(renderedText).replace(/\[\[FILLED:([\s\S]*?)\]\]/g, "$1");
}

export function completionSummary(fields = [], values = {}) {
  const visibleFields = fields.filter((field) => !field.hidden);
  const required = visibleFields.filter((field) => field.required);
  const filledRequired = required.filter((field) => cleanValue(values[field.key]));
  const filledAll = visibleFields.filter((field) => cleanValue(values[field.key]));
  return {
    totalFields: visibleFields.length,
    requiredFields: required.length,
    filledRequired: filledRequired.length,
    filledFields: filledAll.length,
    missingRequired: required
      .filter((field) => !cleanValue(values[field.key]))
      .map((field) => field.label)
  };
}

function collectUnderscoreFields(text, fields, seenKeys, labelKeys) {
  const matches = text.matchAll(/_{3,}/g);
  let index = 0;
  for (const match of matches) {
    const before = text.slice(Math.max(0, match.index - 120), match.index);
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 180);
    const label = inferLabel(before, after, index);
    const alias = aliasForLabel(label);
    if (alias && seenKeys.has(alias.key)) {
      fields.push({
        key: alias.key,
        label: alias.label,
        type: alias.type || inferType(alias.label, before, after),
        required: false,
        helpText: helpFor(alias.label),
        source: "blank",
        hidden: true,
        placementLabel: label,
        placementIndex: index,
        placementOffset: match.index,
        contextBefore: compactContext(before),
        contextAfter: compactContext(after)
      });
      index += 1;
      continue;
    }

    const duplicateKey = labelKeys.get(normalizeLabel(label));
    if (duplicateKey) {
      fields.push({
        key: duplicateKey,
        label,
        type: inferType(label, before, after),
        required: false,
        helpText: helpFor(label),
        source: "blank",
        hidden: true,
        placementLabel: label,
        placementIndex: index,
        placementOffset: match.index,
        contextBefore: compactContext(before),
        contextAfter: compactContext(after)
      });
      index += 1;
      continue;
    }

    addField(fields, seenKeys, labelKeys, {
      key: uniqueKey(label, index),
      label,
      type: inferType(label, before, after),
      required: inferRequired(label),
      helpText: helpFor(label),
      source: "blank",
      placementIndex: index,
      placementOffset: match.index,
      contextBefore: compactContext(before),
      contextAfter: compactContext(after)
    });
    index += 1;
  }
}

function collectPresetFields(text, metadata, fields, seenKeys, labelKeys) {
  const name = `${metadata.originalName || ""} ${metadata.title || ""} ${metadata.contractType || ""}`.toLowerCase();
  const haystack = `${name} ${text.slice(0, 1000).toLowerCase()}`;
  const presets = [];

  if (haystack.includes("booking")) {
    presets.push(
      ["employer_name", "Employer legal name", "text", true],
      ["employer_address", "Employer address", "textarea", true],
      ["musician_names", "Musician or artist name(s)", "textarea", true],
      ["number_of_artists", "Number of artists", "text", false],
      ["performance_place", "Place of performance", "textarea", true],
      ["performance_date", "Date of performance", "date", true],
      ["performance_time", "Time of performance", "text", true],
      ["load_in", "Load-in time", "text", false],
      ["engagement_type", "Type of engagement", "text", false],
      ["dress_code", "Dress code", "text", false],
      ["wage", "Wage or performance fee", "money", true],
      ["deposit", "Deposit", "money", false],
      ["balance_amount", "Balance amount", "money", false],
      ["balance_payee", "Balance payable to", "text", false],
      ["sound_provider", "Sound provider", "text", false],
      ["lights_provider", "Lights provider", "text", false],
      ["additional_terms", "Additional terms", "paragraph", false]
    );
  } else if (haystack.includes("producer")) {
    presets.push(
      ["artist_name", "Artist legal or professional name", "text", true],
      ["producer_name", "Producer legal name", "text", true],
      ["record_company", "Record company or client", "text", false],
      ["master_recordings", "Master recordings or songs covered", "textarea", true],
      ["recording_start_date", "Recording start date", "date", false],
      ["producer_fee", "Producer fee or advance", "money", false],
      ["producer_royalty", "Producer royalty", "percent", false],
      ["ownership_terms", "Ownership terms", "paragraph", false],
      ["special_instructions", "Special production instructions", "paragraph", false]
    );
  } else if (haystack.includes("recording") || haystack.includes("record company")) {
    presets.push(
      ["record_company", "Record company or client", "text", true],
      ["artist_name", "Artist legal or professional name", "text", true],
      ["agreement_date", "Agreement date", "date", true],
      ["recording_term", "Recording term", "text", false],
      ["recording_commitment", "Recording commitment or selections", "paragraph", false],
      ["royalty_amount", "Royalty amount", "percent", false],
      ["royalty_payment_schedule", "Royalty payment schedule", "paragraph", false],
      ["territory", "Territory", "text", false],
      ["rights_granted", "Rights granted", "paragraph", false]
    );
  } else if (haystack.includes("songwriter") || haystack.includes("publishing") || haystack.includes("publisher")) {
    presets.push(
      ["songwriter_name", "Songwriter name", "text", true],
      ["publisher_name", "Publisher name", "text", true],
      ["composition_titles", "Composition title(s)", "textarea", true],
      ["publishing_share", "Publishing share", "percent", false],
      ["territory", "Territory", "text", false],
      ["term", "Term", "text", false],
      ["royalty_terms", "Royalty terms", "paragraph", false],
      ["composition_description", "Composition or catalog description", "paragraph", false]
    );
  } else if (haystack.includes("license")) {
    presets.push(
      ["licensor_name", "Licensor name", "text", true],
      ["licensee_name", "Licensee name", "text", true],
      ["licensed_work", "Licensed work", "textarea", true],
      ["licensed_rights", "Licensed rights", "textarea", true],
      ["territory", "Territory", "text", false],
      ["term", "Term", "text", false],
      ["fee_or_royalty", "Fee or royalty", "money", false],
      ["use_description", "Use description", "paragraph", false]
    );
  } else if (haystack.includes("management") || haystack.includes("manager")) {
    presets.push(
      ["artist_name", "Artist name", "text", true],
      ["manager_name", "Manager name", "text", true],
      ["management_term", "Management term", "text", true],
      ["commission", "Commission", "percent", true],
      ["territory", "Territory", "text", false],
      ["excluded_income", "Excluded income", "paragraph", false],
      ["manager_services", "Manager services", "paragraph", false]
    );
  }

  for (const [key, label, type, required] of presets) {
    addField(fields, seenKeys, labelKeys, {
      key,
      label,
      type,
      required,
      helpText: helpFor(label),
      source: "preset"
    });
  }
}

function collectLabelFields(text, fields, seenKeys, labelKeys) {
  const lines = text.split("\n");
  let offset = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    const lineOffset = offset + Math.max(0, line.indexOf(trimmed));
    offset += line.length + 1;
    const match = trimmed.match(/^(?:\d+[.)]\s*)?([A-Z][A-Z0-9 /&().'-]{3,80}):\s*$/);
    if (!match) continue;
    const label = titleCase(match[1]);
    if (label.toLowerCase().includes("additional terms")) continue;
    const alias = aliasForLabel(label);
    if (alias && seenKeys.has(alias.key)) {
      fields.push({
        key: alias.key,
        label: alias.label,
        type: alias.type || inferType(alias.label),
        required: false,
        helpText: helpFor(alias.label),
      source: "label",
      hidden: true,
      placementLabel: label,
      labelText: match[1],
      placementOffset: lineOffset,
      contextBefore: "",
      contextAfter: ""
      });
      continue;
    }
    if (labelKeys.has(normalizeLabel(label))) continue;

    addField(fields, seenKeys, labelKeys, {
      key: slugify(label),
      label,
      type: inferType(label),
      required: inferRequired(label),
      helpText: helpFor(label),
      source: "label",
      labelText: match[1],
      placementOffset: lineOffset,
      contextBefore: "",
      contextAfter: ""
    });
  }
}

function collectImplicitPromptFields(text, fields, seenKeys, labelKeys) {
  const prompts = [
    {
      key: "partnership_name",
      label: "Partnership name",
      type: "text",
      required: true,
      pattern: /\bI\.\s+The name of the partnership shall be:/i
    },
    {
      key: "principal_place_of_business",
      label: "Principal place of business",
      type: "textarea",
      required: true,
      pattern: /\bIII\.\s+The location of the principal place of business shall be at:/i
    },
    {
      key: "partner_residence_details",
      label: "Partner names and residence details",
      type: "paragraph",
      required: true,
      pattern: /\bIV\.\s+The names and places of residence of the general and limited partner\(s\) are:/i,
      removeAfterWhenFilled: "\\s*\\(indicate whether partner is general or limited\\)\\."
    },
    {
      key: "partnership_term_years",
      label: "Partnership term in years",
      type: "text",
      required: true,
      pattern: /\bV\.\s+The partnership shall continue for/i
    },
    {
      key: "limited_partner_cash_contributions",
      label: "Limited partner cash contributions",
      type: "paragraph",
      required: false,
      pattern: /\bName of Limited Partner Cash\b/i,
      insertMode: "replaceAnchor"
    },
    {
      key: "limited_partner_profit_percentages",
      label: "Limited partner profit percentages",
      type: "paragraph",
      required: false,
      pattern: /\bName of Limited Partner Percentage of the Net Profit\b/i,
      insertMode: "replaceAnchor"
    },
    {
      key: "partnership_execution_date",
      label: "Execution date",
      type: "date",
      required: false,
      pattern: /^DATE:\s*$/im
    }
  ];

  let implicitIndex = 0;
  for (const prompt of prompts) {
    const match = text.match(prompt.pattern);
    if (!match || match.index === undefined) continue;
    const before = text.slice(Math.max(0, match.index - 120), match.index);
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 180);
    addField(fields, seenKeys, labelKeys, {
      key: prompt.key,
      label: prompt.label,
      type: prompt.type,
      required: prompt.required,
      helpText: helpFor(prompt.label),
      source: "implicit",
      anchorText: match[0],
      insertMode: prompt.insertMode || "afterAnchor",
      removeAfterWhenFilled: prompt.removeAfterWhenFilled || "",
      placementLabel: prompt.label,
      placementIndex: implicitIndex,
      placementOffset: match.index,
      contextBefore: compactContext(before),
      contextAfter: compactContext(after)
    });
    implicitIndex += 1;
  }
}

function collectNoBlankPromptFields(text, metadata, fields, seenKeys, labelKeys) {
  collectEmptyColonFields(text, fields, seenKeys, labelKeys);

  const prompts = [
    {
      key: "agreement_date",
      label: "Agreement date",
      type: "date",
      required: true,
      pattern: /(?:this\s+)?day of\s*,\s*20|as of this day of\s*,\s*20/i,
      insertMode: "replacePhrase",
      applies: "agreement-date"
    },
    {
      key: "publisher_name",
      label: "Publisher legal name",
      type: "text",
      required: true,
      pattern: /between\s+hereinafter called\s+"PUBLISHER"/i,
      insertMode: "replacePhrase",
      replacementPrefix: "between "
    },
    {
      key: "company_name",
      label: "Company legal name",
      type: "text",
      required: true,
      pattern: /and\s+hereinafter called\s+"COMPANY"/i,
      insertMode: "replacePhrase",
      replacementPrefix: "and "
    },
    {
      key: "licensee_name",
      label: "Licensee legal name",
      type: "text",
      required: true,
      pattern: /by and between\s+\(hereinafter referred to as\s+"Licensee"\)/i,
      insertMode: "replacePhrase",
      replacementPrefix: "by and between "
    },
    {
      key: "licensor_name",
      label: "Licensor legal name",
      type: "text",
      required: true,
      pattern: /and\s+\(hereinafter referred to as\s+"Licensor"\)/i,
      insertMode: "replacePhrase",
      replacementPrefix: "and "
    },
    {
      key: "producer_name",
      label: "Producer legal name",
      type: "text",
      required: true,
      pattern: /by and between\s+\(hereinafter referred to as\s+"Producer"\)/i,
      insertMode: "replacePhrase",
      replacementPrefix: "by and between "
    },
    {
      key: "artist_name",
      label: "Artist legal name",
      type: "text",
      required: true,
      pattern: /and\s*,\s+\(hereinafter referred to as\s+"Artist"\)/i,
      insertMode: "replacePhrase",
      replacementPrefix: "and "
    },
    {
      key: "composition_title",
      label: "Composition title",
      type: "textarea",
      required: true,
      pattern: /musical composition entitled:/i,
      insertMode: "afterPhrase"
    },
    {
      key: "writer_or_composer_name",
      label: "Writer or composer name",
      type: "text",
      required: true,
      pattern: /\bby:\s*\./i,
      insertMode: "replacePhrase",
      replacementPrefix: "by: "
    },
    {
      key: "copyright_registration_number",
      label: "Copyright registration number",
      type: "text",
      required: false,
      pattern: /Copyright Office Registration No:/i,
      insertMode: "afterPhrase"
    },
    {
      key: "joint_venture_name",
      label: "Joint venture name",
      type: "text",
      required: true,
      pattern: /name of the joint venture shall be:/i,
      insertMode: "afterPhrase"
    },
    {
      key: "business_character",
      label: "Business character",
      type: "paragraph",
      required: true,
      pattern: /character of the business shall be:/i,
      insertMode: "afterPhrase"
    },
    {
      key: "principal_place_of_business",
      label: "Principal place of business",
      type: "textarea",
      required: true,
      pattern: /location of the principal place of business shall be:/i,
      insertMode: "afterPhrase"
    },
    {
      key: "venture_member_residence_details",
      label: "Member names and residence details",
      type: "paragraph",
      required: true,
      pattern: /name and place of residence of each of the undersigned is:/i,
      insertMode: "afterPhrase"
    },
    {
      key: "venture_contributions_and_profit_shares",
      label: "Contributions and profit shares",
      type: "paragraph",
      required: true,
      pattern: /Name Cash Property % of Net Profit/i,
      insertMode: "replacePhrase"
    },
    {
      key: "recording_count",
      label: "Number of recordings",
      type: "text",
      required: true,
      pattern: /\(\s*\)\s+so-called\s+"Master-demos"/i,
      insertMode: "replacePhrase"
    },
    {
      key: "production_months",
      label: "Production month(s)",
      type: "text",
      required: false,
      pattern: /produced during the month\(s\) of\s*,\s*20/i,
      insertMode: "replacePhrase"
    },
    {
      key: "recording_studio_location",
      label: "Recording studio location",
      type: "textarea",
      required: false,
      pattern: /take place at\s+Recording Studios in/i,
      insertMode: "replacePhrase",
      replacementPrefix: "take place at "
    },
    {
      key: "recording_budget",
      label: "Recording budget",
      type: "money",
      required: false,
      pattern: /budget for the Recordings shall be\s+\(\$\s*\)\s+Dollars/i,
      insertMode: "replacePhrase",
      replacementPrefix: "budget for the Recordings shall be "
    },
    {
      key: "producer_hourly_fee",
      label: "Producer hourly fee",
      type: "money",
      required: false,
      pattern: /\(a\)\s+Dollars\s+\(\$\s*\)\s+per hour/i,
      insertMode: "replacePhrase",
      replacementPrefix: "(a) "
    },
    {
      key: "producer_daily_fee",
      label: "Producer daily fee",
      type: "money",
      required: false,
      pattern: /\(b\)\s+Dollars\s+\(\$\s*\)\s+per day/i,
      insertMode: "replacePhrase",
      replacementPrefix: "(b) "
    },
    {
      key: "producer_recording_fee",
      label: "Producer per-recording fee",
      type: "money",
      required: false,
      pattern: /\(c\)\s+Dollars\s+\(\$\s*\)\s+per Recording/i,
      insertMode: "replacePhrase",
      replacementPrefix: "(c) "
    },
    {
      key: "contract_number",
      label: "Contract number",
      type: "text",
      required: false,
      pattern: /^Contract No\.\s*$/im,
      insertMode: "afterPhrase"
    },
    {
      key: "recipient_name",
      label: "Recipient name",
      type: "text",
      required: true,
      pattern: /Dear\s*,/i,
      insertMode: "replacePhrase",
      replacementPrefix: "Dear "
    },
    {
      key: "minimum_record_sides",
      label: "Minimum number of record sides",
      type: "text",
      required: false,
      pattern: /A minimum number of\s+record sides/i,
      insertMode: "replacePhrase",
      replacementPrefix: "A minimum number of "
    },
    {
      key: "writer_name",
      label: "Writer legal name",
      type: "text",
      required: true,
      pattern: /by and\s+between the undersigned lyricist\(s\) and\/or composer\(s\) and\/or arranger\(s\)[\s\S]{0,160}?"Writer"\)/i,
      insertMode: "replacePhrase",
      replacementPrefix: "by and between "
    },
    {
      key: "publisher_name",
      label: "Publisher legal name",
      type: "text",
      required: true,
      pattern: /and the undersigned publisher[\s\S]{0,80}?"Publisher"\)/i,
      insertMode: "replacePhrase",
      replacementPrefix: "and "
    },
    {
      key: "royalty_composition_schedule",
      label: "Composition schedule",
      type: "paragraph",
      required: true,
      pattern: /composition\(s\) set forth on\s+schedule A/i,
      insertMode: "afterPhrase"
    },
    {
      key: "execution_date",
      label: "Execution date",
      type: "date",
      required: false,
      pattern: /the\s+day of 20_/i,
      insertMode: "replacePhrase",
      replacementPrefix: "the "
    },
    {
      key: "songwriter_agreement_date",
      label: "Agreement date",
      type: "date",
      required: true,
      pattern: /this day of 20\s*,/i,
      insertMode: "replacePhrase",
      applies: "songwriter"
    },
    {
      key: "songwriter_publisher_name",
      label: "Publisher legal name",
      type: "text",
      required: true,
      pattern: /by and between herein designated as the PUBLISHER/i,
      insertMode: "replacePhrase",
      replacementPrefix: "by and between "
    },
    {
      key: "composer_name",
      label: "Composer legal name",
      type: "text",
      required: true,
      pattern: /and author and\/or composer, hereinafter jointly designated as the COMPOSER/i,
      insertMode: "replacePhrase",
      replacementPrefix: "and "
    },
    {
      key: "songwriter_composition_title",
      label: "Composition title",
      type: "textarea",
      required: true,
      pattern: /at present entitled/i,
      insertMode: "afterPhrase"
    }
  ];

  let promptIndex = 0;
  const templateName = `${metadata.originalName || ""} ${metadata.title || ""}`.toLowerCase();
  for (const prompt of prompts) {
    if (prompt.applies === "agreement-date" && !/\bday of\s*,\s*20|as of this day of\s*,\s*20/i.test(text.slice(0, 800))) continue;
    if (prompt.applies === "songwriter" && !templateName.includes("songwriter")) continue;
    const match = text.match(prompt.pattern);
    if (!match || match.index === undefined) continue;
    const before = text.slice(Math.max(0, match.index - 140), match.index);
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 220);
    addField(fields, seenKeys, labelKeys, {
      key: prompt.key,
      label: prompt.label,
      type: prompt.type,
      required: prompt.required,
      helpText: helpFor(prompt.label),
      source: "implicit",
      anchorText: match[0],
      insertMode: prompt.insertMode || "afterPhrase",
      replacementPrefix: prompt.replacementPrefix || "",
      placementLabel: prompt.label,
      placementIndex: promptIndex,
      placementOffset: match.index,
      contextBefore: compactContext(before),
      contextAfter: compactContext(after)
    });
    promptIndex += 1;
  }
}

function collectEmptyColonFields(text, fields, seenKeys, labelKeys) {
  const labels = [
    ["Record Company Name", "Record company name", "text", true],
    ["Address", "Address", "textarea", false],
    ["City", "City", "text", false],
    ["State", "State", "text", false],
    ["Telephone", "Telephone", "text", false],
    ["Date", "Date", "date", false]
  ];

  for (const [rawLabel, label, type, required] of labels) {
    const regex = new RegExp(`^${escapeRegExp(rawLabel)}:\\s*$`, "im");
    const match = text.match(regex);
    if (!match || match.index === undefined) continue;
    addField(fields, seenKeys, labelKeys, {
      key: slugify(label),
      label,
      type,
      required,
      helpText: helpFor(label),
      source: "implicit",
      anchorText: match[0],
      insertMode: "afterLine",
      placementLabel: label,
      placementOffset: match.index,
      contextBefore: compactContext(text.slice(Math.max(0, match.index - 120), match.index)),
      contextAfter: compactContext(text.slice(match.index + match[0].length, match.index + match[0].length + 160))
    });
  }
}

function collectRoleTokenFields(text, metadata, fields, seenKeys, labelKeys) {
  const name = `${metadata.originalName || ""} ${metadata.title || ""}`.toLowerCase();
  const haystack = `${name} ${text.slice(0, 400).toLowerCase()}`;
  if (!haystack.includes("artist - management contract ii") && !haystack.includes("artist - manager contract")) return;

  const prompts = [
    {
      key: "agreement_date",
      label: "Agreement date",
      type: "date",
      required: true,
      pattern: /this day of 20\s*,/i,
      insertMode: "replacePhrase"
    },
    {
      key: "manager_name",
      label: "Manager legal name",
      type: "text",
      required: true,
      pattern: /undersigned MANAGER/i,
      token: "MANAGER"
    },
    {
      key: "artist_name",
      label: "Artist legal name",
      type: "text",
      required: true,
      pattern: /undersigned ARTIST/i,
      token: "ARTIST"
    },
    {
      key: "record_company_name",
      label: "Record company legal name",
      type: "text",
      required: true,
      pattern: /\bRECORD COMPANY\b/,
      token: "RECORD COMPANY"
    },
    {
      key: "record_contract_date",
      label: "Recording contract date",
      type: "date",
      required: true,
      pattern: /the date of the contract was:\s*,\s*20\s*\./i,
      insertMode: "replacePhrase",
      replacementPrefix: "the date of the contract was: "
    },
    {
      key: "manager_royalty_percentage",
      label: "Manager royalty percentage",
      type: "percent",
      required: true,
      pattern: /the following percentage of the amounts received/i,
      insertMode: "afterPhrase"
    }
  ];

  let roleIndex = 0;
  for (const prompt of prompts) {
    const match = text.match(prompt.pattern);
    if (!match || match.index === undefined) continue;
    const before = text.slice(Math.max(0, match.index - 120), match.index);
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 180);
    addField(fields, seenKeys, labelKeys, {
      key: prompt.key,
      label: prompt.label,
      type: prompt.type,
      required: prompt.required,
      helpText: helpFor(prompt.label),
      source: "role_token",
      anchorText: match[0],
      token: prompt.token || "",
      insertMode: prompt.insertMode || "replaceToken",
      replacementPrefix: prompt.replacementPrefix || "",
      placementLabel: prompt.label,
      placementIndex: roleIndex,
      placementOffset: match.index,
      contextBefore: compactContext(before),
      contextAfter: compactContext(after)
    });
    roleIndex += 1;
  }
}

function collectNamedPromptFields(text, fields, seenKeys, labelKeys) {
  for (const label of COMMON_LABELS) {
    const regex = new RegExp(`\\b${escapeRegExp(label)}\\b`, "i");
    if (!regex.test(text)) continue;
    const pretty = titleCase(label);
    addField(fields, seenKeys, labelKeys, {
      key: slugify(pretty),
      label: pretty,
      type: inferType(pretty),
      required: ["artist", "producer", "company", "employer", "musician", "publisher", "songwriter"].includes(label),
      helpText: helpFor(pretty),
      source: "suggested"
    });
  }
}

function inferLabel(before, after, index) {
  const cleanBefore = before.replace(/\s+/g, " ").trim();
  const cleanAfter = after.replace(/\s+/g, " ").trim();
  const role = inferNearbyRole(cleanBefore, cleanAfter);
  const parenthetical = cleanAfter.match(/^\s*\((name|address|date|title|description)\)/i);
  if (parenthetical && role) return `${role} ${titleCase(parenthetical[1])}`;
  if (parenthetical) return titleCase(parenthetical[1]);

  const uppercaseLabel =
    cleanBefore.match(/(?:^|\s|\d+[.)]\s*)(NAME OF ARTIST\(S\)|NUMBER OF ARTIST\(S\)|PLACE OF ENGAGEMENT|ADDRESS OF ENGAGEMENT|DATE\(S\) OF ENGAGEMENT|HOURS OF ENGAGEMENT|LOAD IN|TYPE OF ENGAGEMENT|DRESS|PRICE AGREED UPON|WAGE AGREED UPON|DEPOSIT \$?|BALANCE \$?|BALANCE PAYABLE TO|PAYABLE TO|SOUND PROVIDED BY|LIGHTS PROVIDED BY|ADDITIONAL TERMS)\s*$/i) ||
    cleanBefore.match(/([A-Z][A-Z /&().'-]{3,60})\s*$/);
  const labelMatch =
    cleanBefore.match(/([A-Za-z][A-Za-z /&().'-]{2,50})[:]\s*$/) ||
    cleanBefore.match(/\b(Date|Dear Mr\.\/Ms\.|known as|referred to as|on|at|to|by)\s*$/i);

  if (/day of/i.test(cleanAfter)) return "Agreement day";
  if (/20_{2,}/i.test(cleanAfter)) return "Agreement month";
  if (/20$/i.test(cleanBefore)) return "Agreement year";
  if (/professionally known as$/i.test(cleanBefore)) return "Artist professional name";
  if (/producing master recordings/i.test(cleanAfter)) return "Producer name";
  if (/date hereof and shall continue until$/i.test(cleanBefore)) return "Contract end date";
  if (/royalty of$/i.test(cleanBefore)) return "Royalty amount";
  if (/first day of$/i.test(cleanBefore)) return "Royalty payment month";
  if (/deposit\s*\$?$/i.test(cleanBefore)) return "Deposit";
  if (/balance\s*\$?$/i.test(cleanBefore)) return "Balance amount";
  if (/payable to$/i.test(cleanBefore)) return "Balance payable to";
  if (/for the period ending$/i.test(cleanBefore)) return "Royalty period ending date";
  if (/remain in effect for a period of$/i.test(cleanBefore)) return "Recording term";
  if (/recording selections or$/i.test(cleanBefore)) return "Number of recording selections";
  if (uppercaseLabel) return titleCase(uppercaseLabel[1]);
  if (labelMatch) return titleCase(labelMatch[1].replace(/Dear Mr\.\/Ms\./i, "Recipient name"));
  if (/address$/i.test(cleanBefore)) return "Address";
  if (/date/i.test(cleanBefore.slice(-40))) return "Date";
  return contextualFallbackLabel(cleanBefore, cleanAfter, index);
}

function inferNearbyRole(before, after) {
  const context = `${before} ${after}`.toLowerCase();
  if (context.includes("hereinafter individually referred to as \"writer\"") || context.includes("hereinafter referred to as \"writer\"")) return "Writer";
  if (context.includes("hereinafter referred to as \"publisher\"") || context.includes("hereinafter referred to as publisher")) return "Publisher";
  if (context.includes("hereinafter called \"the company\"") || context.includes("called \"the company\"")) return "Company";
  if (context.includes("herein called \"the artist\"") || context.includes("called \"the artist\"")) return "Artist";
  if (context.includes("hereinafter referred to as \"producer\"") || context.includes("referred to as the \"producer\"")) return "Producer";
  return "";
}

function formatValueForBlank(value, field, after) {
  let formatted = cleanValue(value);
  if (!formatted) return "";
  if (field.label.toLowerCase().includes("agreement day") && /^\s*th\s+day/i.test(after)) {
    formatted = formatted.replace(/(?:st|nd|rd|th)$/i, "");
  }
  return formatted;
}

function valueForBlank(field, values) {
  const lower = field.label.toLowerCase();
  const context = `${field.contextBefore || ""} ${field.contextAfter || ""}`.toLowerCase();
  const contextualAliases = [
    [["hereinafter referred to as \"producer\"", "referred to as the \"producer\""], ["producer_name"]],
    [["herein called \"the company\"", "hereinafter referred to as “company”", "hereinafter referred to as \"company\""], ["record_company"]],
    [["herein called \"the artist\"", "hereinafter referred to as “artist”", "hereinafter referred to as \"artist\""], ["artist_name"]],
    [["hereinafter referred to as \"publisher\""], ["publisher_name"]],
    [["hereinafter individually referred to as \"writer\"", "hereinafter referred to as \"writer\""], ["songwriter_name", "writer_name"]],
    [["royalty of"], ["royalty_amount"]]
  ];

  for (const [needles, keys] of contextualAliases) {
    if (!needles.some((needle) => context.includes(needle))) continue;
    for (const key of keys) {
      const value = cleanValue(values[key]);
      if (value) return { key, value };
    }
  }

  const aliases = [
    [["name of artist", "artist(s)", "musician"], ["musician_names", "artist_name"]],
    [["number of artist"], ["number_of_musicians", "number_of_artists"]],
    [["place of engagement", "place of performance"], ["performance_place"]],
    [["address of engagement"], ["employer_address", "performance_place"]],
    [["date(s) of engagement", "date of performance"], ["performance_date"]],
    [["hours of engagement", "time of performance"], ["performance_time"]],
    [["wage agreed", "performance fee"], ["wage", "producer_fee", "fee_or_royalty"]],
    [["deposit"], ["deposit"]],
    [["balance amount"], ["balance_amount"]],
    [["balance payable"], ["balance_payee"]],
    [["price agreed", "wage agreed"], ["wage"]],
    [["sound provided"], ["sound_provider"]],
    [["lights provided"], ["lights_provider"]],
    [["additional terms"], ["additional_terms"]],
    [["producer"], ["producer_name"]],
    [["artist"], ["artist_name", "musician_names"]],
    [["publisher"], ["publisher_name"]],
    [["songwriter"], ["songwriter_name"]],
    [["licensor"], ["licensor_name"]],
    [["licensee"], ["licensee_name"]],
    [["territory"], ["territory"]],
    [["term"], ["term", "management_term", "recording_term"]],
    [["recording term"], ["recording_term"]],
    [["number of recording selections"], ["recording_commitment"]],
    [["royalty period ending"], ["royalty_payment_schedule"]]
  ];

  for (const [needles, keys] of aliases) {
    if (!needles.some((needle) => lower.includes(needle))) continue;
    for (const key of keys) {
      const value = cleanValue(values[key]);
      if (value) return { key, value };
    }
    return null;
  }

  return null;
}

function shouldRenderHiddenBlankWithValue(field, value) {
  if (!cleanValue(value) || field.source !== "blank") return false;

  const before = String(field.contextBefore || "").toLowerCase();
  const after = String(field.contextAfter || "").toLowerCase();
  const context = `${before} ${after}`;
  const nameKeys = ["producer_name", "publisher_name", "songwriter_name", "writer_name", "artist_name", "record_company"];
  const isNameKey = nameKeys.includes(field.key);
  if (isNameKey && after.trim().startsWith("(name)")) return true;

  const suppressContexts = [
    "for purchaser",
    "for artist",
    "print street address",
    "(address)",
    "ss #",
    "tax id",
    "telephone",
    "contract #",
    "leader, manager, or representative",
    "agrees and guarantees to pay"
  ];

  if (suppressContexts.some((term) => context.includes(term))) return false;
  if (isNameKey) {
    return (
      context.includes("(name)") ||
      context.includes("referred to as") ||
      context.includes("herein called") ||
      context.includes("professionally known as")
    );
  }

  return [
    "musician_names",
    "number_of_artists",
    "performance_place",
    "employer_address",
    "performance_date",
    "performance_time",
    "load_in",
    "engagement_type",
    "dress_code",
    "wage",
    "deposit",
    "balance_amount",
    "balance_payee",
    "sound_provider",
    "lights_provider",
    "additional_terms",
    "producer_name",
    "publisher_name",
    "songwriter_name",
    "writer_name",
    "artist_name",
    "record_company",
    "royalty_amount"
  ].includes(field.key);
}

function aliasForLabel(label) {
  const lower = label.toLowerCase();
  const aliases = [
    [["name of artist", "artist professional name", "musician or artist"], "musician_names", "Musician or artist name(s)", "textarea"],
    [["number of artist"], "number_of_artists", "Number of artists", "text"],
    [["place of engagement", "place of performance"], "performance_place", "Place of performance", "textarea"],
    [["address of engagement"], "employer_address", "Employer address", "textarea"],
    [["date(s) of engagement", "date of performance"], "performance_date", "Date of performance", "date"],
    [["hours of engagement", "time of performance"], "performance_time", "Time of performance", "text"],
    [["load in"], "load_in", "Load-in time", "text"],
    [["type of engagement"], "engagement_type", "Type of engagement", "text"],
    [["dress"], "dress_code", "Dress code", "text"],
    [["price agreed", "wage agreed"], "wage", "Wage or performance fee", "money"],
    [["deposit"], "deposit", "Deposit", "money"],
    [["balance amount"], "balance_amount", "Balance amount", "money"],
    [["balance payable", "payable to"], "balance_payee", "Balance payable to", "text"],
    [["sound provided"], "sound_provider", "Sound provider", "text"],
    [["lights provided"], "lights_provider", "Lights provider", "text"],
    [["additional terms"], "additional_terms", "Additional terms", "paragraph"],
    [["publisher name"], "publisher_name", "Publisher name", "text"],
    [["publisher address"], "publisher_address", "Publisher address", "textarea"],
    [["writer name"], "songwriter_name", "Songwriter name", "text"],
    [["writer address"], "songwriter_address", "Songwriter address", "textarea"],
    [["producer name"], "producer_name", "Producer legal name", "text"],
    [["artist legal", "artist name"], "artist_name", "Artist name", "text"],
    [["artist"], "musician_names", "Musician or artist name(s)", "textarea"],
    [["company name"], "record_company", "Record company or client", "text"],
    [["contract end date"], "term_end_date", "Contract end date", "date"],
    [["royalty amount"], "royalty_amount", "Royalty amount", "percent"],
    [["royalty payment month"], "royalty_payment_month", "Royalty payment month", "text"],
    [["royalty period ending"], "royalty_period_ending", "Royalty period ending date", "date"],
    [["recording term"], "recording_term", "Recording term", "text"],
    [["number of recording selections"], "recording_commitment", "Recording commitment or selections", "paragraph"]
  ];

  for (const [needles, key, aliasLabel, type] of aliases) {
    if (needles.some((needle) => lower.includes(needle))) return { key, label: aliasLabel, type };
  }
  return null;
}

function inferType(label, before = "", after = "") {
  const haystack = `${label} ${before} ${after}`.toLowerCase();
  const lowerLabel = label.toLowerCase();
  if (lowerLabel.includes("name")) return "text";
  if (lowerLabel.includes("address")) return "textarea";
  if (haystack.includes("date") || haystack.includes("day of") || haystack.includes("20__")) return "date";
  if (haystack.includes("$") || haystack.includes("fee") || haystack.includes("wage") || haystack.includes("deposit") || haystack.includes("payment")) return "money";
  if (haystack.includes("royalty") || haystack.includes("percentage")) return "percent";
  if (haystack.includes("address") || haystack.includes("place")) return "textarea";
  if (
    lowerLabel.startsWith("field after") ||
    lowerLabel.startsWith("field before") ||
    haystack.includes("additional terms") ||
    haystack.includes("description") ||
    haystack.includes("services") ||
    haystack.includes("provided by") ||
    haystack.includes("conditions") ||
    haystack.includes("instructions") ||
    haystack.includes("rights") ||
    haystack.includes("obligations")
  ) {
    return "paragraph";
  }
  return "text";
}

function inferRequired(label) {
  const lower = label.toLowerCase();
  if (lower.startsWith("field after") || lower.startsWith("field before") || lower.startsWith("unlabeled")) return false;
  return ["name", "artist", "producer", "company", "employer", "musician", "fee", "wage", "payment"].some((word) =>
    lower.includes(word)
  );
}

function isNotNeededInFillForm(field) {
  const lower = String(field.label || "").toLowerCase();

  if (lower.startsWith("unlabeled template field")) {
    return true;
  }

  const adminOrSignatureOnly = [
    "accepted and agreed",
    "agreed and accepted",
    "signature",
    "sincerely",
    "duly authorized",
    "tax id",
    "social security",
    "witness",
    "witnesseth",
    "w i t n e s s",
    "notary"
  ];

  if (adminOrSignatureOnly.some((term) => lower.includes(term))) return true;

  if (field.source === "implicit" || field.source === "role_token") return false;

  if (field.required) return false;

  const tooGeneric = ["to", "date", "name", "address"];
  if (tooGeneric.includes(lower)) return true;

  return false;
}

function helpFor(label) {
  const lower = label.toLowerCase();
  if (lower.startsWith("field after") || lower.startsWith("field before")) {
    return "This template blank did not have a clean label, so this name comes from nearby contract wording.";
  }
  if (lower.includes("date")) return "Use the exact date the parties intend to put in the contract.";
  if (lower.includes("name")) return "Use the full legal name when available.";
  if (lower.includes("address") || lower.includes("place")) return "Include enough detail to identify the person, company, or venue.";
  if (lower.includes("fee") || lower.includes("wage") || lower.includes("payment")) return "Use the exact amount and currency.";
  if (lower.includes("royalty") || lower.includes("percentage")) return "Use the exact percentage or royalty formula.";
  return "Fill this exactly as it should appear in the final contract.";
}

function addField(fields, seenKeys, labelKeys, field) {
  let key = field.key || slugify(field.label);
  let suffix = 2;
  while (seenKeys.has(key)) {
    key = `${field.key || slugify(field.label)}_${suffix}`;
    suffix += 1;
  }
  seenKeys.add(key);
  labelKeys.set(normalizeLabel(field.label), key);
  fields.push({ ...field, key });
}

function applyDraftOrder(fields) {
  const placementOrderByKey = new Map();
  let fallbackPlacement = 0;

  for (const field of fields) {
    const isPlaced =
      field.source === "blank" ||
      field.source === "label" ||
      field.source === "implicit" ||
      field.source === "role_token";
    if (!isPlaced) continue;
    const placement = Number.isFinite(field.placementOffset)
      ? field.placementOffset
      : Number.isFinite(field.placementIndex)
        ? field.placementIndex
        : fallbackPlacement;
    fallbackPlacement += 1;
    const current = placementOrderByKey.get(field.key);
    if (current === undefined || placement < current) placementOrderByKey.set(field.key, placement);
  }

  return fields
    .map((field, index) => ({
      ...field,
      draftOrder: placementOrderByKey.get(field.key) ?? Number.MAX_SAFE_INTEGER,
      originalOrder: index
    }))
    .sort((a, b) => {
      if (a.draftOrder !== b.draftOrder) return a.draftOrder - b.draftOrder;
      if (a.key === b.key) {
        if (a.hidden !== b.hidden) return a.hidden ? 1 : -1;
        if (a.source === "blank" && b.source !== "blank") return 1;
        if (b.source === "blank" && a.source !== "blank") return -1;
      }
      return a.originalOrder - b.originalOrder;
    })
    .map(({ originalOrder, ...field }) => field);
}

function normalizeLabel(label) {
  return String(label || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function contextualFallbackLabel(before, after, index) {
  const context = `${before} ${after}`.toLowerCase();
  if (context.includes("(name)") && context.includes("publisher")) return "Publisher Name";
  if (context.includes("(address)") && context.includes("publisher")) return "Publisher Address";
  if (context.includes("(name)") && (context.includes("writer") || context.includes("songwriter"))) return "Writer Name";
  if (context.includes("(address)") && (context.includes("writer") || context.includes("songwriter"))) return "Writer Address";
  if (context.includes("(name)") && context.includes("company")) return "Company Name";
  if (context.includes("(name)") && context.includes("artist")) return "Artist Name";
  if (context.includes("(address)")) return "Address";
  if (context.includes("(name)")) return "Name";

  const beforeWords = before
    .split(/\s+/)
    .filter(Boolean)
    .slice(-5)
    .join(" ");
  const afterWords = after
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .join(" ");

  if (beforeWords && beforeWords.length > 8) return `Field after "${sentenceCase(beforeWords)}"`;
  if (afterWords && afterWords.length > 8) return `Field before "${sentenceCase(afterWords)}"`;
  return `Unlabeled template field ${index + 1}`;
}

function sentenceCase(value) {
  const text = String(value || "").trim().toLowerCase();
  return text ? text[0].toUpperCase() + text.slice(1) : "";
}

function uniqueKey(label, index) {
  const base = slugify(label);
  return base === "blank" ? `blank_${index + 1}` : `${base}_${index + 1}`;
}

function slugify(value) {
  return String(value || "field")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || "field";
}

function titleCase(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\b[a-z]/g, (char) => char.toUpperCase())
    .replace(/\s+/g, " ")
    .trim();
}

function cleanValue(value) {
  return String(value ?? "").trim();
}

function compactContext(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(-220);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function insertImplicitValue(text, field, marker, hasValue) {
  const escaped = escapeRegExp(field.anchorText).replace(/\s+/g, "\\s+");
  if (field.insertMode === "replaceAnchor" || field.insertMode === "replacePhrase") {
    const regex = new RegExp(`(${escaped})(?!\\s*(?:\\[|\\[\\[FILLED:))`, "i");
    return text.replace(regex, `${field.replacementPrefix || ""}${marker.trimStart()}`);
  }

  if (field.insertMode === "afterPhrase") {
    const regex = new RegExp(`(${escaped})(?!\\s*(?:\\[|\\[\\[FILLED:))`, "i");
    return text.replace(regex, `$1 ${marker.trimStart()}`);
  }

  if (field.insertMode === "afterLine") {
    const regex = new RegExp(`(${escaped})(?!\\s*(?:\\[|\\[\\[FILLED:))`, "i");
    return text.replace(regex, `$1\n${marker.trimStart()}\n`);
  }

  let next = insertAfterAnchor(text, field.anchorText, marker);
  if (hasValue && field.removeAfterWhenFilled) {
    const cleanup = new RegExp(`(\\[\\[FILLED:[\\s\\S]*?\\]\\])${field.removeAfterWhenFilled}`, "i");
    next = next.replace(cleanup, "$1");
  }
  return next;
}

function insertAfterAnchor(text, anchorText, marker) {
  const escaped = escapeRegExp(anchorText).replace(/\s+/g, "\\s+");
  const regex = new RegExp(`(${escaped})(?!\\s*(?:\\[|\\[\\[FILLED:))`, "i");
  return text.replace(regex, `$1${marker}`);
}

function replaceRoleToken(text, field, marker) {
  if (field.insertMode === "replacePhrase" && field.anchorText) {
    return text.replace(
      new RegExp(escapeRegExp(field.anchorText).replace(/\s+/g, "\\s+"), "i"),
      `${field.replacementPrefix || ""}${marker.trimStart()}`
    );
  }

  if (field.insertMode === "afterPhrase" && field.anchorText) {
    const escaped = escapeRegExp(field.anchorText).replace(/\s+/g, "\\s+");
    return text.replace(new RegExp(`(${escaped})(?!\\s*(?:\\[|\\[\\[FILLED:))`, "i"), `$1 ${marker}`);
  }

  if (!field.token) return text;
  const tokenRegex = new RegExp(`\\b${escapeRegExp(field.token).replace(/\s+/g, "\\s+")}\\b`, "g");
  const footerRegex = new RegExp(`^\\s*${escapeRegExp(field.token).replace(/\s+/g, "\\s+")}:\\s*$`);
  let sawTitle = false;

  const replaced = text
    .split("\n")
    .map((line) => {
      if (!sawTitle && /CONTRACT|AGREEMENT|LICENSE/i.test(line) && tokenRegex.test(line)) {
        sawTitle = true;
        tokenRegex.lastIndex = 0;
        return line;
      }
      tokenRegex.lastIndex = 0;
      if (footerRegex.test(line)) return `${field.token}: ${marker}`;
      return line.replace(tokenRegex, marker);
    })
    .join("\n");

  if (field.token === "RECORD COMPANY") {
    return replaced.replace(
      /RECORD COMPANY:\s*(?=and\s+(?:the date of the contract was:|\[\[FILLED:|\[))/g,
      `${marker} `
    );
  }

  return replaced;
}

function cleanupFilledScaffold(text) {
  return String(text)
    .replace(
      /(Persons due payment for services rendered on above recordings:\s*)\n+\s*Name Service Payment Due\s*\n+(\[\[FILLED:)/i,
      "$1\n$2"
    )
    .replace(/\n{5,}/g, "\n\n\n");
}
