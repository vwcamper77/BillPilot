export const BLOG_CATEGORIES = [
  {
    slug: "money-basics",
    label: "Money basics",
    description: "Straightforward explanations for the everyday money questions nobody teaches clearly.",
  },
  {
    slug: "bills-and-payday",
    label: "Bills & payday",
    description: "Practical ways to plan around due dates, payday and the money already spoken for.",
  },
  {
    slug: "spending-and-saving",
    label: "Spending & saving",
    description: "Calmer, realistic approaches to spending decisions, buffers and longer-term costs.",
  },
];

/*
 * Add articles here when copy is approved. Keeping content in one structured
 * collection means the blog index, article pages, metadata and sitemap remain
 * in sync automatically.
 *
 * Article shape:
 * {
 *   slug, title, description, category, publishedAt, updatedAt?, readingMinutes,
 *   featured?, takeaway, content: [
 *     { type: "paragraph", text: "..." },
 *     { type: "heading", text: "...", id: "..." },
 *     { type: "list", items: ["..."] },
 *     { type: "callout", title: "...", text: "..." }
 *   ]
 * }
 */
export const BLOG_POSTS = [
  {
    slug: "how-much-can-i-spend-before-payday",
    title: "How much can I spend before payday? Work it out in 60 seconds",
    seoTitle: "How Much Can I Spend Before Payday? A 60-Second Method",
    description: "Work out exactly what you can spend before payday with one piece of arithmetic: balance minus bills still to come out. No bank connection needed.",
    keywords: ["how much can I spend before payday", "money left until payday", "what can I spend before payday", "how much money do I have until payday"],
    category: "bills-and-payday",
    publishedAt: "2026-07-14",
    readingMinutes: 5,
    featured: true,
    takeaway: "Subtract every fixed payment due before payday from your current balance to get a useful working clear-to-spend figure, then decide whether you also want to keep a buffer untouched.",
    faqs: [
      {
        question: "Should I include food and petrol as bills?",
        answer: "No—only fixed, dated payments that leave the account automatically. Food, fuel and everything you actively choose to buy is what the clear-to-spend figure is for. If you prefer certainty on essentials, you can set aside a fixed weekly amount for food and treat it like a bill, but keep it simple to start.",
      },
      {
        question: "What if a bill is due on payday itself?",
        answer: "Count anything due before the money lands. If rent goes out on the 28th and pay arrives on the 28th, timing within the day varies by bank. It is safer to count it as due before payday so the surprise, if any, is a pleasant one.",
      },
      {
        question: "What about money coming in before payday?",
        answer: "If it is certain—a refund or a transfer from a partner—add it to the balance side. If it is only probable, leave it out. The figure is most useful when it is the cautious version.",
      },
    ],
    content: [
      {
        type: "paragraph",
        text: "You know the moment. You're in the queue, about to tap your card, and you're doing sums in your head. There's £312 in the account. Payday is the 28th. But the phone bill hasn't come out yet, and neither has the car insurance, and was the gym on the 25th or the 26th?",
      },
      {
        type: "paragraph",
        text: "The number on your banking app is not the answer. It's the start of a maths problem you're being asked to solve from memory, several times a day.",
      },
      { type: "paragraph", text: "Here's the actual answer, and the one-line calculation behind it." },
      { type: "heading", text: "The calculation", id: "the-calculation" },
      {
        type: "formula",
        label: "What you're clear to spend",
        formula: "current balance − bills still due before payday",
      },
      { type: "paragraph", text: "That's it. Not your salary, not your monthly budget, not a spreadsheet with categories. Just two numbers:" },
      {
        type: "ordered-list",
        items: [
          [
            { text: "Your balance right now. ", strong: true },
            { text: "Open your banking app once and note it down." },
          ],
          [
            { text: "Every bill and direct debit that will leave the account between today and payday. ", strong: true },
            { text: "Rent or mortgage if it falls in that window, phone, energy, subscriptions, insurance, anything on a standing order." },
          ],
        ],
      },
      {
        type: "paragraph",
        segments: [
          { text: "Subtract the second from the first. The result is the amount left after the fixed payments you entered have been allowed for. Everything above that number is already spoken for—it just hasn't left the account yet." },
        ],
      },
      { type: "heading", text: "A worked example", id: "worked-example" },
      { type: "paragraph", text: "Say it's the 14th, you get paid on the 28th, and your balance is £412." },
      { type: "paragraph", text: "Bills still to come out before the 28th:" },
      {
        type: "table",
        caption: "Bills due before payday",
        headers: ["Bill", "Amount"],
        rows: [
          ["Energy", "£84"],
          ["Phone", "£32"],
          ["Spotify", "£12"],
          ["Car insurance", "£58"],
          ["Total still to go out", "£186"],
        ],
        totalRow: 4,
      },
      {
        type: "result",
        segments: [
          { text: "£412 − £186 = " },
          { text: "£226 clear to spend", strong: true },
          { text: " over the next 14 days." },
        ],
      },
      {
        type: "paragraph",
        text: "Your banking app shows £412. After allowing for the £186 of fixed payments still due, your working clear-to-spend figure is £226. That £186 gap is exactly where “how did I end up in my overdraft?” can come from—the bills were always coming, they just hadn't landed when you checked.",
      },
      { type: "heading", text: "Why per-day figures can mislead you", id: "why-per-day-figures-can-mislead" },
      { type: "paragraph", text: "A tempting next step is to divide by the days remaining: £226 ÷ 14 = about £16 a day. As a rough pacing guide, fine. But treat it loosely, for two reasons." },
      { type: "paragraph", text: "First, spending isn't smooth. A supermarket shop or a night out lands as one lump, so a strict daily figure sets you up to feel behind on day two." },
      { type: "paragraph", text: "Second, division by days remaining behaves badly at the end of the cycle. With £30 left and one day to go, the maths says “£30 today”—technically true, practically an invitation to arrive at payday with nothing. The headline number to trust is the total that's clear to spend, not a per-day figure." },
      { type: "paragraph", text: "You may also choose to leave part of the result untouched as a buffer, rather than treating the entire figure as a spending target." },
      { type: "heading", text: "Do this once, not fourteen times", id: "do-this-once" },
      { type: "paragraph", text: "The catch with the manual method: it's only accurate at the moment you do it. Spend £40 on Friday and your number is stale. Most people respond by re-checking their banking app constantly—one number, checked eight times a day, that never actually answers the question." },
      {
        type: "paragraph",
        segments: [
          { text: "This is the problem " },
          { text: "ClearTill", href: "/" },
          { text: " was built for. You tell it your balance, your payday and your bills—typing them in plain English is enough, and it works out the rest. The first thing you see is a single figure: " },
          { text: "what you're clear to spend before you're paid", strong: true },
          { text: ". When you update your balance, ClearTill immediately recalculates the bills still due and your new clear-to-spend figure." },
        ],
      },
      { type: "paragraph", text: "No bank connection, no transaction history, no categories to maintain. It's the calculation above, kept current for you. There's a 7-day free trial, then it's £1.99 a month." },
      { type: "heading", text: "Frequently asked questions", id: "frequently-asked-questions" },
      { type: "faqs" },
    ],
  },
  {
    slug: "budgeting-irregular-income-no-payday",
    title: "Budgeting with irregular income when payday isn't a fixed date",
    seoTitle: "Budgeting With Irregular Income When There's No Payday",
    description: "Learn a practical way to budget between irregular payments, invoices or shifts by calculating what remains after bills due before the next reliable income date.",
    keywords: ["budgeting with irregular income UK", "how to budget self employed UK", "budgeting between invoices", "no regular payday budgeting", "freelancer cash flow"],
    category: "money-basics",
    publishedAt: "2026-07-14",
    readingMinutes: 10,
    takeaway: "Choose the next income date you can reasonably rely on, then subtract scheduled payments and amounts reserved for essentials or tax from your usable balance.",
    disclaimer: "ClearTill is not financial advice, tax advice or business cash-flow forecasting. It performs simple calculations using the balances, dates and bills you enter.",
    faqs: [
      {
        question: "What if I genuinely do not know when the next payment is coming?",
        answer: "Use a cautious provisional date, such as the end of the month or the furthest realistic payment date. The resulting figure may look restrictive, but that is preferable to relying on income that does not arrive. Revise the date when a payment becomes sufficiently certain.",
      },
      {
        question: "Should fuel count as a bill?",
        answer: "Personal fuel is usually variable spending. However, fuel required to complete confirmed paid work is already committed in practical terms. Reserve an appropriate amount before calculating discretionary spending. The same principle applies to materials, travel, parking and other essential job costs.",
      },
      {
        question: "Should tax count as a bill?",
        answer: "Tax should not be treated as spendable money. Many self-employed people move a proportion of each payment into a separate tax account as soon as it arrives. If the tax money remains in your main balance, subtract the reserved amount before calculating what is available. Seek appropriate tax guidance where necessary.",
      },
      {
        question: "What if a client normally pays on time but occasionally pays late?",
        answer: "Use the expected date only when the payment pattern and current circumstances make it reasonably dependable. If the client has not approved the work, disputes the invoice or has already missed the date, move your horizon back and recalculate.",
      },
      {
        question: "Does a partner's salary change the method?",
        answer: "No. A partner's salary can act as a reliable income date for a shared household, provided that the money is genuinely available for the commitments being calculated.",
      },
      {
        question: "Can I use the method for weekly or fortnightly pay?",
        answer: "Yes. The method does not depend on a monthly salary. Use the next reliable payment date, list everything due before that date and subtract those commitments from the usable balance.",
      },
    ],
    content: [
      { type: "paragraph", text: "Almost every simple budgeting method begins with an assumption:" },
      { type: "quote", text: "Money arrives on a known date and in a reasonably predictable amount." },
      { type: "paragraph", text: "That works when you receive a salary on the same day each month. It works less neatly when you are:" },
      { type: "list", items: ["Self-employed", "Freelance", "Paid per job", "On a zero-hours contract", "Working variable shifts", "Waiting for invoices to clear", "Receiving commission or seasonal income"] },
      { type: "paragraph", text: "There may be no reliable monthly payday." },
      { type: "paragraph", text: "Money arrives when a job finishes, a client pays, a timesheet is approved or enough shifts appear on the rota." },
      { type: "paragraph", text: "Traditional budgeting advice remains important, but irregular income creates an additional short-term problem:" },
      { type: "quote", text: "What can I safely treat as available between now and the next payment I can reasonably rely on?" },

      { type: "heading", text: "Start with the long-term foundations", id: "long-term-foundations" },
      { type: "paragraph", text: "Established irregular-income guidance usually recommends several sensible steps:" },
      { type: "list", items: ["Base essential commitments on a lower-income month rather than a particularly good one.", "Calculate average income across several months.", "Build a buffer during stronger periods.", "Put money aside for tax as soon as income arrives.", "Plan for annual and irregular expenses.", "Separate business and personal money where appropriate."] },
      {
        type: "paragraph",
        segments: [
          { text: "MoneyHelper's guide to budgeting for irregular income", href: "https://www.moneyhelper.org.uk/en/everyday-money/budgeting/how-to-budget-for-an-irregular-income" },
          { text: " provides useful, impartial guidance on these longer-term foundations." },
        ],
      },
      { type: "paragraph", text: "These measures help answer:" },
      { type: "quote", text: "Is my overall lifestyle affordable despite variable income?" },
      { type: "paragraph", text: "But they do not always answer the shorter-term question you may face halfway through a quiet period:" },
      { type: "quote", text: "There is £618 in the account. The van insurance and phone bill have not come out yet. The next reliable payment is expected in ten days. What is my position until then?" },
      { type: "paragraph", text: "That is a different calculation." },

      { type: "heading", text: "Use a short-term income horizon", id: "short-term-income-horizon" },
      { type: "paragraph", text: "Someone with a fixed salary has a natural horizon: today until payday." },
      { type: "paragraph", text: "With irregular income, you need to choose the horizon yourself." },
      { type: "paragraph", text: "Your horizon is the next date on which you are reasonably confident money will arrive." },
      { type: "paragraph", text: "This might be:" },
      { type: "list", items: ["A regular retainer paid on the first of the month", "A CIS payment that normally clears on a particular Friday", "A confirmed shift payment", "A client payment with an established and reliable pattern", "The completion payment for a job that is already substantially finished", "A partner's salary entering a shared household account"] },
      { type: "paragraph", text: "Do not automatically use the most optimistic date." },
      { type: "paragraph", text: "An invoice that is overdue, disputed or dependent on further work is not the same as money you can rely on." },
      { type: "paragraph", text: "When two dates are possible, the later credible date usually gives you the more cautious working figure." },

      { type: "heading", text: "The short-horizon calculation", id: "short-horizon-calculation" },
      { type: "paragraph", text: "The basic method is:" },
      { type: "formula", label: "Working clear-to-spend figure", formula: "current balance − fixed payments due before the next reliable income date − amounts reserved for essentials or tax" },

      { type: "subheading", text: "Step 1: Check the current balance", id: "check-current-balance" },
      { type: "paragraph", text: "Use the balance that best reflects the money actually available." },
      { type: "paragraph", text: "Before relying on it, consider whether it includes:" },
      { type: "list", items: ["Pending card payments", "Unprocessed cash withdrawals", "Cheques or transfers that have not cleared", "Money belonging to the business", "Tax money that should already be separated", "An overdraft that you do not want to treat as normal spending money"] },
      { type: "paragraph", text: "The number shown by the bank is the starting point, not necessarily the final answer." },

      { type: "subheading", text: "Step 2: Select the next reliable income date", id: "select-reliable-income-date" },
      { type: "paragraph", text: "Choose the next payment date you have reasonable grounds to expect." },
      { type: "paragraph", text: "Avoid counting:" },
      { type: "list", items: ["Work you have not yet won", "An invoice you have not yet sent", "A client who regularly pays late", "A refund that has not been approved", "An informal promise with no firm date"] },
      { type: "paragraph", text: "If the payment is possible but uncertain, leave it out of the first calculation. You can update the position when the money actually arrives." },

      { type: "subheading", text: "Step 3: List payments due before that date", id: "list-payments-due" },
      { type: "paragraph", text: "Include fixed or scheduled payments such as:" },
      { type: "list", items: ["Rent or mortgage", "Utilities", "Phone contract", "Vehicle finance", "Vehicle insurance", "Software subscriptions", "Loan or credit-card payments", "Standing orders", "Business insurance", "Equipment finance"] },
      { type: "paragraph", text: "Also account for money that is not technically a bill but is already committed." },
      { type: "paragraph", text: "For example, if you expect to need £100 of fuel to finish confirmed jobs before the next payment, reserve that amount rather than treating it as discretionary spending." },

      { type: "subheading", text: "Step 4: Protect tax money", id: "protect-tax-money" },
      { type: "paragraph", text: "If you are self-employed, money reserved for tax is not clear to spend." },
      { type: "paragraph", text: "One simple approach is to move the tax allocation into a separate account when each payment arrives. If it remains in the same account, subtract it before calculating what is available for personal spending." },
      { type: "paragraph", text: "The correct percentage depends on your circumstances, income and business structure. ClearTill does not calculate your tax liability." },

      { type: "subheading", text: "Step 5: Subtract", id: "subtract" },
      { type: "paragraph", text: "Suppose:" },
      { type: "table", caption: "Example short-horizon calculation", headers: ["Item", "Amount"], rows: [["Current usable balance", "£618"], ["Bills due before the next reliable payment", "− £74"], ["Fuel reserved for confirmed work", "− £100"], ["Additional tax amount still held in the account", "− £80"], ["Working clear-to-spend figure", "£364"]], totalRow: 4 },
      { type: "result", segments: [{ text: "£618 − £74 − £100 − £80 = " }, { text: "£364", strong: true }] },
      { type: "paragraph", text: "Your working clear-to-spend figure is therefore £364 until the next reliable income date." },
      { type: "paragraph", text: "That does not mean you should aim to spend all £364. You may choose to retain part of it as a buffer." },
      { type: "quote", text: "The purpose of the figure is orientation, not permission." },

      { type: "heading", text: "Why dividing it into a daily allowance can mislead", id: "daily-allowance" },
      { type: "paragraph", text: "You could divide £364 by ten days and call the result £36.40 per day." },
      { type: "paragraph", text: "That may be useful as a rough pacing guide, but irregular spending rarely happens evenly." },
      { type: "paragraph", text: "You might need:" },
      { type: "list", items: ["£90 for a supermarket shop", "£60 for fuel", "£35 for school costs", "Nothing at all on several other days"] },
      { type: "paragraph", text: "A strict daily figure can make ordinary lump-sum purchases look like failure." },
      { type: "paragraph", text: "The total remaining after known commitments is usually the more useful headline number. A daily figure should remain a secondary guide rather than a spending target." },

      { type: "heading", text: "Recalculate when the position changes", id: "recalculate" },
      { type: "paragraph", text: "With irregular income, the horizon moves." },
      { type: "paragraph", text: "A client may pay early. A job may be delayed. A new invoice may become sufficiently certain to count. An unexpected bill may appear." },
      { type: "paragraph", text: "When that happens:" },
      { type: "ordered-list", items: [[{ text: "Update the balance." }], [{ text: "Select the next reliable income date." }], [{ text: "Update the payments due before that date." }], [{ text: "Recalculate." }]] },
      { type: "paragraph", text: "The method remains the same even when the income pattern changes." },

      { type: "heading", text: "Why this complements annual budgeting", id: "annual-budgeting" },
      { type: "paragraph", text: "Short-term calculation does not replace proper planning." },
      { type: "paragraph", text: "You still need to understand:" },
      { type: "list", items: ["Whether annual income covers annual living costs", "Whether pricing is sufficient", "Whether tax is being reserved", "Whether you have enough emergency savings", "Whether business and personal spending should be separated", "Whether debt repayments remain affordable", "Whether your lowest-income months are sustainable"] },
      { type: "paragraph", text: "Annual and monthly budgeting show whether the overall structure works." },
      { type: "paragraph", text: "The short-horizon calculation shows where you stand today." },
      { type: "paragraph", text: "Both are necessary because a year can appear affordable on average while the next ten days remain extremely tight." },

      { type: "heading", text: "Using ClearTill when your income is irregular", id: "using-cleartill" },
      { type: "paragraph", text: "ClearTill is built around the period between today and the next date you expect to be paid." },
      { type: "paragraph", text: "For irregular income, treat the next payment you can reasonably rely on as your next payday." },
      { type: "paragraph", text: "Enter:" },
      { type: "list", items: ["Your current balance", "The next reliable income date", "The bills due before that date"] },
      { type: "paragraph", text: "ClearTill subtracts the bills you entered and shows the amount remaining." },
      { type: "paragraph", text: "When your balance or next income date changes, update it and the calculation is refreshed." },
      { type: "paragraph", text: "ClearTill does not:" },
      { type: "list", items: ["Connect to your bank", "Predict whether a client will pay", "Calculate tax", "Replace business cash-flow forecasting", "Decide how much buffer you should retain", "Automatically track every transaction"] },
      { type: "paragraph", text: "It is a simple way to hold the short-term arithmetic in one place." },
      { type: "paragraph", text: "There is a seven-day free trial, followed by a £1.99 monthly subscription." },

      { type: "heading", text: "Frequently asked questions", id: "frequently-asked-questions" },
      { type: "faqs" },
    ],
  },
];

export function getPostBySlug(slug) {
  return BLOG_POSTS.find((post) => post.slug === slug);
}

export function getCategory(slug) {
  return BLOG_CATEGORIES.find((category) => category.slug === slug);
}

export function formatPostDate(value) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00Z`));
}
