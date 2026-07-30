"use strict";

const DEFAULT_TIMEZONE = "Europe/London";
const DEFAULT_WEEKDAYS = [1, 3, 5];
const DEFAULT_PUBLICATION_TIME = "09:30";
const DEFAULT_PLAN_START = "2026-08-03";
const SLOT_COUNT = 156;
const ADAPTIVE_COUNT = 31;

const CATEGORY_ALLOCATIONS = Object.freeze({
  clear_to_spend: 30,
  bills_direct_debits_subscriptions: 26,
  irregular_income: 18,
  seasonal_life_events: 24,
  calculators_templates_tools: 16,
  privacy_trust_product: 11,
  adaptive: 31,
});

const MONTHLY_THEMES = Object.freeze({
  "2026-08": "school holidays, back-to-school costs and holiday recovery",
  "2026-09": "autumn bill reset, direct-debit dates and household planning",
  "2026-10": "winter bills, energy planning and annual subscriptions",
  "2026-11": "Black Friday, Christmas preparation and spending decisions",
  "2026-12": "Christmas cashflow, early paydays and January commitments",
  "2027-01": "subscription audits, financial reset and five-week pay cycles",
  "2027-02": "short-month budgeting, annual renewals and irregular income",
  "2027-03": "tax-year preparation, family costs and spring bill review",
  "2027-04": "new tax year, council tax, utilities and recurring costs",
  "2027-05": "bank holidays, travel planning and monthly bill timing",
  "2027-06": "summer planning, family activities and holiday saving",
  "2027-07": "school holidays, travel costs and annual content refresh",
});

const CATEGORY_BRIEFS = Object.freeze({
  clear_to_spend: {
    label: "Clear-to-spend and cashflow fundamentals",
    cluster: "clear-to-spend fundamentals",
    articleTypes: ["guide", "question answer", "checklist"],
    title: "How to understand your clear-to-spend position",
    keyword: "clear to spend before payday",
    audience: "UK households planning between paydays",
    cta: "Start a ClearTill no-card preview",
    links: ["/tools/payday-cashflow-calculator", "/start"],
  },
  bills_direct_debits_subscriptions: {
    label: "Bills, direct debits and subscriptions",
    cluster: "bills and recurring payments",
    articleTypes: ["guide", "checklist", "comparison"],
    title: "How to review bills and recurring payments",
    keyword: "review bills and subscriptions",
    audience: "UK households managing recurring payments",
    cta: "List bills in ClearTill",
    links: ["/blog/how-much-can-i-spend-before-payday", "/start"],
  },
  irregular_income: {
    label: "Weekly, fortnightly and irregular income",
    cluster: "irregular-income planning",
    articleTypes: ["guide", "question answer", "calculator support article"],
    title: "Planning cashflow when income dates vary",
    keyword: "budgeting with irregular income UK",
    audience: "UK workers with weekly, fortnightly or irregular income",
    cta: "Calculate the position to the next reliable income date",
    links: ["/blog/budgeting-irregular-income-no-payday", "/tools/payday-cashflow-calculator"],
  },
  seasonal_life_events: {
    label: "Seasonal and life-event cashflow",
    cluster: "seasonal cashflow planning",
    articleTypes: ["seasonal", "guide", "checklist"],
    title: "A practical cashflow plan for seasonal costs",
    keyword: "seasonal cashflow planning UK",
    audience: "UK households preparing for seasonal and family costs",
    cta: "Plan upcoming costs in ClearTill",
    links: ["/start", "/free-cash-position-sheet"],
  },
  calculators_templates_tools: {
    label: "Calculators, templates and downloadable tools",
    cluster: "cashflow tools and templates",
    articleTypes: ["calculator support article", "template", "checklist"],
    title: "A simple tool for planning money before payday",
    keyword: "payday planning template UK",
    audience: "People seeking a practical planning tool",
    cta: "Use the free payday cashflow calculator",
    links: ["/tools/payday-cashflow-calculator", "/free-cash-position-sheet"],
  },
  privacy_trust_product: {
    label: "Privacy, trust and ClearTill product education",
    cluster: "privacy-first money planning",
    articleTypes: ["product education", "comparison", "question answer"],
    title: "Planning money without connecting a bank account",
    keyword: "money app without bank connection",
    audience: "Privacy-conscious UK money-app users",
    cta: "See how ClearTill works without a bank connection",
    links: ["/security", "/about-cleartill", "/start"],
  },
});

const TOPIC_ANGLES = Object.freeze({
  clear_to_spend: [
    "working out money left before payday",
    "understanding a clear-to-spend figure",
    "allowing for bills before spending",
    "planning the final week before payday",
    "using a cautious cashflow buffer",
    "checking affordability between income dates",
    "updating a manual cashflow position",
    "avoiding double-counting account transfers",
    "planning with more than one bank account",
    "deciding what is already spoken for",
    "using balance minus upcoming commitments",
    "handling a bill due on payday",
    "planning when payday falls on a weekend",
    "reviewing money after a large purchase",
    "separating available money from a spending target",
    "using a weekly pace without a rigid daily budget",
    "planning a five-week payday cycle",
    "recovering after an expensive month",
    "checking cashflow before a discretionary purchase",
    "building a small end-of-month margin",
    "planning shared household cashflow",
    "handling refunds before payday",
    "including reliable income before payday",
    "excluding uncertain income from a short-term plan",
    "planning cash and bank balances together",
    "reconciling a manual money plan",
    "choosing the right short-term planning horizon",
    "reviewing upcoming commitments in date order",
    "what a negative clear-to-spend figure means",
    "when a cashflow calculation needs updating",
  ],
  bills_direct_debits_subscriptions: [
    "reviewing subscriptions without a bank connection",
    "listing direct debits before payday",
    "planning around changing energy payments",
    "checking annual subscriptions before renewal",
    "handling direct debits after a payday change",
    "building a complete recurring-bills list",
    "spotting quarterly payments in a monthly plan",
    "planning council tax payment months",
    "reviewing mobile and broadband contract dates",
    "allowing for insurance renewals",
    "handling a failed direct debit safely",
    "planning bills that move around bank holidays",
    "separating fixed bills from variable essentials",
    "reviewing streaming-service renewals",
    "planning rent and mortgage payment timing",
    "checking standing orders against direct debits",
    "preparing for an annual service charge",
    "planning buy-now-pay-later due dates",
    "recording household contributions toward bills",
    "reviewing duplicate subscriptions",
    "planning bills across two current accounts",
    "handling a mid-month bill increase",
    "reviewing recurring app-store charges",
    "creating a bill-date calendar",
    "planning irregular water bills",
    "checking recurring costs after moving home",
  ],
  irregular_income: [
    "budgeting between freelance invoices",
    "planning with weekly wages",
    "planning with fortnightly pay",
    "choosing a reliable income date",
    "handling zero-hours income changes",
    "planning cashflow between shifts",
    "reserving tax from self-employed income",
    "planning when a client pays late",
    "using a lower-income month as a baseline",
    "handling commission payments",
    "planning seasonal self-employed income",
    "separating business and household commitments",
    "planning around universal credit dates",
    "handling two different household pay cycles",
    "planning cashflow during unpaid leave",
    "using confirmed work without counting uncertain income",
    "building a buffer from stronger income months",
    "reviewing irregular income every week",
  ],
  seasonal_life_events: [
    "planning back-to-school costs",
    "recovering cashflow after a holiday",
    "preparing for winter energy bills",
    "planning Black Friday decisions",
    "preparing Christmas cashflow",
    "handling an early December payday",
    "planning January commitments",
    "reviewing costs after moving home",
    "planning household costs after a new baby",
    "preparing for school holiday spending",
    "planning bank-holiday payment timing",
    "budgeting for wedding attendance",
    "planning a summer holiday balance",
    "preparing for car insurance renewal",
    "planning annual MOT and servicing costs",
    "handling emergency home repairs",
    "planning birthday and family-event costs",
    "preparing for a rent increase",
    "planning a change of job",
    "handling a period of sick leave",
    "planning university-term costs",
    "preparing for council tax changes",
    "planning travel during peak periods",
    "running an annual household-cost refresh",
  ],
  calculators_templates_tools: [
    "using a payday cashflow calculator",
    "creating a printable bill-date checklist",
    "building a subscription review template",
    "using a five-week pay-cycle worksheet",
    "creating an irregular-income planning sheet",
    "building an annual-renewals checklist",
    "using a holiday-cost planning template",
    "creating a household bills inventory",
    "building a direct-debit date tracker",
    "using a short-month cashflow checklist",
    "creating a moving-home recurring-cost list",
    "building a school-holiday cost planner",
    "using a weekly income planning template",
    "creating a Christmas commitments checklist",
    "building a cashflow refresh worksheet",
    "using a no-bank-connection money planner",
  ],
  privacy_trust_product: [
    "using a money app without Open Banking",
    "understanding manual-entry money planning",
    "what ClearTill does with entered figures",
    "comparing connected and manual budgeting apps",
    "checking ClearTill privacy controls",
    "understanding ClearTill cashflow estimates",
    "why ClearTill does not label money safe to spend",
    "updating ClearTill after transactions",
    "planning multiple accounts in ClearTill",
    "understanding the ClearTill no-card preview",
    "when a connected budgeting app may be more convenient",
  ],
});

const CONTROLLED_TOPIC_OVERRIDES = Object.freeze({
  "bills_direct_debits_subscriptions:1": Object.freeze({
    provisionalTitle: "How to List Direct Debits Due Before Your Next Payday",
    primaryKeyword: "direct debits before payday",
    searchIntent: "List direct debits due before the next payday",
    seasonalRelevance: "August examples may be used internally; keep the title evergreen",
    evergreenOrAdaptive: "evergreen",
    rationale: "Evergreen bills guidance selected for the controlled first batch. August examples may be used inside the article without adding planning metadata to the title.",
  }),
  "seasonal_life_events:1": Object.freeze({
    provisionalTitle: "How to Budget for Back-to-School Costs Before Payday",
    primaryKeyword: "back to school budget before payday",
    searchIntent: "Budget for back-to-school costs before payday",
    seasonalRelevance: "August back-to-school costs",
    evergreenOrAdaptive: "seasonal",
    rationale: "A genuinely seasonal August topic selected for the controlled first batch.",
  }),
  "calculators_templates_tools:1": Object.freeze({
    provisionalTitle: "How to Build a Simple Monthly Bill Calendar",
    primaryKeyword: "monthly bill calendar UK",
    searchIntent: "Build and use a simple monthly bill calendar",
    seasonalRelevance: "August examples may be used internally; keep the title evergreen",
    evergreenOrAdaptive: "evergreen",
    articleType: "template/tool support",
    supportingAssetRequirement: "Approved hero plus a reviewed monthly bill calendar template",
    rationale: "Evergreen template and tool support selected for the controlled first batch. August examples may be used inside the article without changing the title.",
  }),
});

function parseDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new TypeError("Plan dates must use YYYY-MM-DD.");
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const value = new Date(date);
  value.setUTCDate(value.getUTCDate() + days);
  return value;
}

function mondayOfWeek(date) {
  const day = date.getUTCDay() || 7;
  return addDays(date, 1 - day);
}

function adaptiveIndexes() {
  return new Set(
    Array.from({ length: ADAPTIVE_COUNT }, (_, index) => (
      Math.floor(((index + 0.5) * SLOT_COUNT) / ADAPTIVE_COUNT)
    )),
  );
}

function plannedCategories() {
  const remaining = Object.fromEntries(
    Object.entries(CATEGORY_ALLOCATIONS).filter(([key]) => key !== "adaptive"),
  );
  const order = Object.keys(remaining);
  const result = [];
  while (result.length < SLOT_COUNT - ADAPTIVE_COUNT) {
    for (const category of order) {
      if (remaining[category] > 0) {
        result.push(category);
        remaining[category] -= 1;
      }
    }
  }
  const moveCategoryTo = (category, destination) => {
    const source = result.indexOf(category, destination);
    if (source < 0) throw new Error(`Missing planned category ${category}.`);
    [result[destination], result[source]] = [result[source], result[destination]];
  };
  moveCategoryTo("seasonal_life_events", 0);
  moveCategoryTo("bills_direct_debits_subscriptions", 1);
  moveCategoryTo("calculators_templates_tools", 2);
  return result;
}

function titleCase(value) {
  return String(value).replace(/\b\w/g, (character) => character.toUpperCase());
}

function planItem({
  slotIndex,
  publicationDate,
  time,
  timezone,
  kind,
  category,
  categoryOrdinal,
  createdAt,
}) {
  const month = publicationDate.slice(0, 7);
  const theme = MONTHLY_THEMES[month] || "adaptive search and content refresh";
  const calendarItemId = `seo-slot-${publicationDate}-${String(slotIndex + 1).padStart(3, "0")}`;
  if (kind === "adaptive") {
    return {
      calendarItemId,
      provisionalTitle: null,
      primaryKeyword: null,
      secondaryKeywords: [],
      category: "adaptive",
      contentCluster: "adaptive search and content refresh",
      searchIntent: null,
      funnelStage: "awareness",
      audience: "To be selected from evidence",
      proposedPublicationDate: `${publicationDate}T${time}:00`,
      timezone,
      seasonalRelevance: theme,
      evergreenOrAdaptive: "adaptive",
      articleType: "content refresh",
      proposedCta: "Selected after the evidence review",
      proposedInternalLinks: [],
      supportingAssetRequirement: "Decide after the adaptive brief is approved",
      status: "planned",
      priority: "adaptive",
      adaptiveEvidence: null,
      rationale: "Unassigned until supported by Search Console data, a product change, a seasonal development, a customer question, a refresh opportunity or an administrator-entered topic.",
      createdAt,
      updatedAt: createdAt,
    };
  }
  const brief = CATEGORY_BRIEFS[category];
  const angle = TOPIC_ANGLES[category][categoryOrdinal - 1];
  const controlledOverride = CONTROLLED_TOPIC_OVERRIDES[`${category}:${categoryOrdinal}`] || {};
  const articleType = controlledOverride.articleType
    || brief.articleTypes[(categoryOrdinal - 1) % brief.articleTypes.length];
  return {
    calendarItemId,
    provisionalTitle: controlledOverride.provisionalTitle || titleCase(angle),
    primaryKeyword: controlledOverride.primaryKeyword || `${angle} UK`,
    secondaryKeywords: [
      brief.keyword,
      `${brief.cluster} UK`,
      theme.split(",")[0],
    ],
    category,
    contentCluster: brief.cluster,
    searchIntent: controlledOverride.searchIntent || (
      articleType === "product education"
        ? `Commercial investigation and product education about ${angle}`
        : `Practical informational guidance about ${angle}`
    ),
    funnelStage: ["product education", "comparison"].includes(articleType)
      ? "consideration"
      : "awareness",
    audience: brief.audience,
    proposedPublicationDate: `${publicationDate}T${time}:00`,
    timezone,
    seasonalRelevance: controlledOverride.seasonalRelevance || theme,
    evergreenOrAdaptive: controlledOverride.evergreenOrAdaptive
      || (category === "seasonal_life_events" ? "seasonal" : "evergreen"),
    articleType,
    proposedCta: brief.cta,
    proposedInternalLinks: brief.links,
    supportingAssetRequirement: controlledOverride.supportingAssetRequirement
      || (articleType === "template"
        ? "Approved hero plus a reviewed downloadable template"
        : articleType === "calculator support article"
          ? "Approved hero plus a calculator example"
          : "Approved ClearTill hero master and mobile assets"),
    status: "planned",
    priority: category === "seasonal_life_events" ? "date-sensitive" : "standard",
    rationale: controlledOverride.rationale
      || `Fulfils the annual ${brief.label.toLowerCase()} allocation and uses the ${month} theme as a planning constraint. No keyword volume or traffic forecast has been invented.`,
    createdAt,
    updatedAt: createdAt,
  };
}

function createAnnualContentPlan({
  startDate = DEFAULT_PLAN_START,
  weekdays = DEFAULT_WEEKDAYS,
  publicationTime = DEFAULT_PUBLICATION_TIME,
  timezone = DEFAULT_TIMEZONE,
  createdAt = "2026-07-30T00:00:00.000Z",
} = {}) {
  if (
    !Array.isArray(weekdays)
    || weekdays.length !== 3
    || new Set(weekdays).size !== 3
    || weekdays.some((day) => !Number.isInteger(day) || day < 1 || day > 7)
  ) {
    throw new TypeError("Exactly three unique publication weekdays are required.");
  }
  if (!/^\d{2}:\d{2}$/.test(publicationTime)) {
    throw new TypeError("Publication time must use HH:MM.");
  }
  const weekStart = mondayOfWeek(parseDate(startDate));
  const adaptive = adaptiveIndexes();
  const categories = plannedCategories();
  const categoryCounts = {};
  let plannedIndex = 0;
  let slotIndex = 0;
  const items = [];
  for (let week = 0; week < 52; week += 1) {
    for (const weekday of [...weekdays].sort((left, right) => left - right)) {
      const date = isoDate(addDays(weekStart, (week * 7) + weekday - 1));
      const kind = adaptive.has(slotIndex) ? "adaptive" : "planned";
      const category = kind === "adaptive" ? "adaptive" : categories[plannedIndex++];
      categoryCounts[category] = Number(categoryCounts[category] || 0) + 1;
      items.push(planItem({
        slotIndex,
        publicationDate: date,
        time: publicationTime,
        timezone,
        kind,
        category,
        categoryOrdinal: categoryCounts[category],
        createdAt,
      }));
      slotIndex += 1;
    }
  }
  return {
    schemaVersion: "cleartill-seo-plan-v1",
    startDate: isoDate(weekStart),
    endDate: items.at(-1).proposedPublicationDate.slice(0, 10),
    timezone,
    publicationTime,
    weekdays: [...weekdays].sort((left, right) => left - right),
    slotCount: items.length,
    plannedCount: items.filter((item) => item.evergreenOrAdaptive !== "adaptive").length,
    adaptiveCount: items.filter((item) => item.evergreenOrAdaptive === "adaptive").length,
    categoryAllocations: { ...CATEGORY_ALLOCATIONS },
    monthlyThemes: { ...MONTHLY_THEMES },
    items,
  };
}

function createControlledReplacementPreview(options = {}) {
  return createAnnualContentPlan(options).items
    .filter((item) => item.evergreenOrAdaptive !== "adaptive")
    .slice(0, 3)
    .map((item) => ({ ...item }));
}

function normalizedTerms(value) {
  return new Set(
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9£]+/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2),
  );
}

function materiallyOverlaps(left, right) {
  const first = normalizedTerms(`${left.primaryKeyword} ${left.searchIntent}`);
  const second = normalizedTerms(`${right.primaryKeyword} ${right.searchIntent}`);
  if (!first.size || !second.size) return false;
  const intersection = [...first].filter((term) => second.has(term)).length;
  const union = new Set([...first, ...second]).size;
  return intersection / union >= 0.78;
}

function findDuplicateRisks(candidate, existingItems = []) {
  const keyword = String(candidate?.primaryKeyword || "").trim().toLowerCase();
  const exactKeyword = existingItems.find((item) => (
    String(item.primaryKeyword || item.keywords?.[0] || "").trim().toLowerCase() === keyword
  ));
  const overlapping = existingItems.find((item) => materiallyOverlaps(candidate, {
    primaryKeyword: item.primaryKeyword || item.keywords?.[0],
    searchIntent: item.searchIntent || item.title,
  }));
  return {
    passed: !exactKeyword && !overlapping,
    duplicatePrimaryKeywordId: exactKeyword?.calendarItemId || exactKeyword?.id || null,
    overlappingIntentId: overlapping?.calendarItemId || overlapping?.id || null,
  };
}

function validateAnnualPlan(plan) {
  const items = plan?.items || [];
  const dates = items.map((item) => item.proposedPublicationDate);
  const categoryCounts = Object.fromEntries(
    Object.keys(CATEGORY_ALLOCATIONS).map((category) => [
      category,
      items.filter((item) => item.category === category).length,
    ]),
  );
  const weekly = new Map();
  for (const item of items) {
    const date = parseDate(item.proposedPublicationDate.slice(0, 10));
    const key = isoDate(mondayOfWeek(date));
    weekly.set(key, Number(weekly.get(key) || 0) + 1);
  }
  const errors = [];
  if (items.length !== SLOT_COUNT) errors.push("Plan must contain 156 slots.");
  if (new Set(dates).size !== dates.length) errors.push("Publication slots must be unique.");
  if ([...weekly.values()].some((count) => count !== 3) || weekly.size !== 52) {
    errors.push("Plan must contain exactly three slots in each of 52 weeks.");
  }
  for (const [category, expected] of Object.entries(CATEGORY_ALLOCATIONS)) {
    if (categoryCounts[category] !== expected) {
      errors.push(`${category} must contain ${expected} slots.`);
    }
  }
  return { passed: errors.length === 0, errors, categoryCounts, weekCount: weekly.size };
}

module.exports = {
  ADAPTIVE_COUNT,
  CATEGORY_ALLOCATIONS,
  DEFAULT_PLAN_START,
  DEFAULT_PUBLICATION_TIME,
  DEFAULT_TIMEZONE,
  DEFAULT_WEEKDAYS,
  MONTHLY_THEMES,
  SLOT_COUNT,
  createAnnualContentPlan,
  createControlledReplacementPreview,
  findDuplicateRisks,
  materiallyOverlaps,
  validateAnnualPlan,
};
