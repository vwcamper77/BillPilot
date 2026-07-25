export const SEO_SEED_TOPICS = [
  {
    id: "money-left-after-bills",
    primaryKeyword: "money left after bills",
    proposedTitle: "What does money left after bills actually mean?",
    cluster: "money-basics",
    intent: "informational",
    productFitScore: 95,
  },
  {
    id: "safe-to-spend-before-payday",
    primaryKeyword: "safe to spend before payday",
    proposedTitle: "How to work out what is safe to spend before payday",
    cluster: "bills-and-payday",
    intent: "informational",
    productFitScore: 100,
  },
  {
    id: "positive-balance-overdraft",
    primaryKeyword: "positive bank balance but overdrawn",
    proposedTitle: "Why a positive bank balance can still lead to an overdraft",
    cluster: "money-basics",
    intent: "informational",
    productFitScore: 92,
  },
  {
    id: "monthly-bill-calendar",
    primaryKeyword: "monthly bill calendar UK",
    proposedTitle: "A simple bill calendar for monthly household payments",
    cluster: "bills-and-payday",
    intent: "tool",
    productFitScore: 90,
  },
  {
    id: "bills-different-dates",
    primaryKeyword: "budget bills different dates",
    proposedTitle: "How to budget when bills leave on different dates",
    cluster: "bills-and-payday",
    intent: "informational",
    productFitScore: 96,
  },
  {
    id: "five-week-month",
    primaryKeyword: "five week month budget",
    proposedTitle: "How to handle a five-week month between paydays",
    cluster: "bills-and-payday",
    intent: "informational",
    productFitScore: 88,
  },
  {
    id: "weekly-pay-monthly-bills",
    primaryKeyword: "weekly pay monthly bills",
    proposedTitle: "Weekly pay: how to plan for monthly direct debits",
    cluster: "bills-and-payday",
    intent: "informational",
    productFitScore: 94,
  },
  {
    id: "fortnightly-pay-monthly-bills",
    primaryKeyword: "fortnightly pay monthly bills",
    proposedTitle: "How to plan monthly bills when you are paid fortnightly",
    cluster: "bills-and-payday",
    intent: "informational",
    productFitScore: 92,
  },
  {
    id: "annual-bills-monthly-cashflow",
    primaryKeyword: "annual bills monthly budget",
    proposedTitle: "How to account for annual bills in monthly cashflow",
    cluster: "spending-and-saving",
    intent: "informational",
    productFitScore: 86,
  },
  {
    id: "subscription-audit-no-bank-link",
    primaryKeyword: "review subscriptions without bank connection",
    proposedTitle: "How to review subscriptions without connecting your bank account",
    cluster: "spending-and-saving",
    intent: "commercial",
    productFitScore: 98,
  },
];

export function selectNextSeedTopic({ excludedIds = [] } = {}) {
  return SEO_SEED_TOPICS
    .filter((topic) => !excludedIds.includes(topic.id))
    .sort((a, b) => b.productFitScore - a.productFitScore)[0] || null;
}
