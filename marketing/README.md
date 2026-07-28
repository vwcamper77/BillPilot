# ClearTill Marketing and Content Operating System

**Intended repository path:** `marketing/README.md`  
**Owner:** ClearTill / GMBF Ventures Ltd  
**Version:** 1.0  
**Effective date:** 19 July 2026  
**Operational timezone:** Europe/London  
**Review cadence:** Weekly operational review; four-week strategic review

---

## 1. Executive decision

### Verdict: PROCEED WITH CONTROLLED TESTING

ClearTill should build a repeatable marketing system, but it must not automate content volume before establishing which message creates product activation.

The immediate objective is to learn:

1. which problem statement makes the right people recognise a need;
2. which audience starts and completes a first ClearTill position;
3. which content formats create qualified visits rather than superficial engagement;
4. which channels generate return usage and purchases;
5. which objections prevent people from trying the product.

The operating system must therefore optimise for **evidence**, not output.

### Strongest counterargument

Organic social media may not produce enough qualified traffic within four weeks to distinguish between messages. This is addressed by:

- running controlled message variants;
- using unique tracking on every post;
- repeating apparent winners with new creative treatment;
- using a small paid validation budget only after organic signals appear;
- interviewing users and recording comments when traffic is insufficient.

### Initial kill criteria

Do not respond to weak performance by publishing more of the same content.

After at least **100 qualified social visits**, trigger a product and positioning review when either condition is true:

- fewer than 10 visitors start the preview; or
- fewer than 6 visitors save a complete first position.

These are operating heuristics, not external industry benchmarks.

---

## 2. Purpose of this document

This document defines how ClearTill will:

- research content opportunities;
- maintain product and brand facts;
- generate content ideas;
- create social and Journal drafts;
- produce visuals using Canva, original screenshots, AI generation and licensed stock;
- approve content;
- schedule and publish through Buffer;
- attribute traffic and product behaviour;
- review results;
- decide whether to stop, pivot, test further or proceed.

This system is designed to prevent:

- generic budgeting content that does not explain ClearTill;
- invented claims, testimonials, users or savings;
- inconsistent versions of the brand across AI tools;
- publishing content without a hypothesis;
- treating likes and impressions as proof of demand;
- unlicensed or poorly documented visual assets;
- AI-generated imagery that appears to depict real customers;
- automation that bypasses human approval.

---

## 3. Tool architecture

```text
ClearTill repository: approved product facts and records
                              ↓
ChatGPT Project: strategy, research, drafts and critique
                              ↓
Codex: repository records, validation, UTM and integrations
                              ↓
Canva: branded visual production and export
                              ↓
Human approval: claims, facts, design, links and timing
                              ↓
Buffer: draft preview, scheduling and publishing
                              ↓
LinkedIn / Facebook / Instagram
                              ↓
ClearTill analytics + Buffer delivery data
                              ↓
Weekly STOP / PIVOT / TEST / PROCEED decision
```

### 3.1 ChatGPT Project

Use the existing **ClearTill ChatGPT Project** as the marketing operating centre.

ChatGPT is responsible for:

- defining hypotheses;
- challenging assumptions;
- competitor and substitute research;
- generating and revising ideas;
- producing channel-specific copy;
- creating visual briefs;
- generating appropriate original images;
- recommending free-stock search queries;
- analysing weekly campaign results;
- identifying objections and audience language;
- proposing stop, pivot, test or proceed decisions.

ChatGPT is not authoritative for:

- current product features where the repository differs;
- prices where the application differs;
- payment completion;
- customer claims;
- legal conclusions;
- unsupervised publishing.

### 3.2 Codex

Codex is responsible for:

- maintaining structured marketing files;
- checking repository product facts;
- generating and validating campaign URLs;
- validating content records;
- building the Buffer integration;
- preventing duplicate or unapproved publication;
- running tests;
- writing approved final records back to the repository;
- producing weekly reports from exported results.

Codex must not:

- invent missing product facts;
- overwrite unrelated uncommitted work;
- commit, push, deploy or publish unless explicitly instructed;
- treat generated content as approved;
- expose API keys to client-side code.

### 3.3 Canva

Canva is the **visual production layer**.

Use Canva for:

- ClearTill Brand Kit management;
- reusable branded templates;
- social carousels;
- single-image explainers;
- product screenshot layouts;
- simple diagrams;
- Journal hero images;
- short screen-recording edits;
- subtitle and cover production;
- resizing approved creative into channel variants;
- exporting final production assets.

Canva does not decide:

- the marketing strategy;
- whether a claim is accurate;
- whether a stock image is contextually misleading;
- whether an experiment succeeded;
- whether content is ready for publication.

### 3.4 Buffer

Buffer is the distribution layer.

Use Buffer for:

- receiving approved drafts;
- previewing channel-specific presentation;
- scheduling;
- publishing;
- reporting delivery status;
- retrieving available post metrics where supported.

The integration must use Buffer's current GraphQL API and current asset input format. Media attached through the API must be available at a suitable public URL.

### 3.5 ClearTill repository

The repository is the long-term source of truth for:

- approved product facts;
- positioning;
- audiences;
- voice;
- claims rules;
- experiments;
- content calendar;
- approved content;
- asset provenance;
- publication records;
- campaign results;
- decisions and learning.

### 3.6 Source-of-truth hierarchy

When records conflict, use this order:

1. **Live repository and deployed product behaviour**
2. **Approved marketing files in the repository**
3. **Current legal, regulatory or official primary source**
4. **Approved ChatGPT Project instructions**
5. **Buffer draft**
6. **Unapproved conversation draft**

---

## 4. Recommended repository structure

```text
marketing/
├── README.md
├── brand/
│   ├── positioning.json
│   ├── audiences.json
│   ├── voice.json
│   ├── product-facts.json
│   └── claims-policy.json
├── strategy/
│   ├── content-pillars.json
│   ├── objections.json
│   ├── competitors.json
│   └── experiments.json
├── calendar/
│   └── content-calendar.json
├── drafts/
│   ├── social/
│   └── journal/
├── approved/
│   ├── social/
│   └── journal/
├── assets/
│   ├── source/
│   ├── canva-exports/
│   ├── product-screenshots/
│   ├── generated/
│   └── asset-register.json
├── published/
└── performance/
    ├── campaign-results.json
    └── weekly-decisions/
```

Do not rely on empty folders being tracked by Git. Use a `.gitkeep` file where needed.

---

## 5. ClearTill proposition

### 5.1 Core proposition

ClearTill helps someone estimate what is likely to remain before payday after the bills and costs they enter.

### 5.2 Product characteristics

ClearTill is:

- a forward cash-position tool;
- controlled by the user;
- based on figures entered by the user;
- focused on the period before payday;
- usable without a bank login;
- usable without Open Banking;
- designed to show what is likely to remain;
- designed to be updated when a balance, bill or date changes.

### 5.3 Current primary CTA

> **Check my position free**

### 5.4 Trust proposition

> **No bank login • No Open Banking • You control your data**

### 5.5 What ClearTill is not

Do not describe ClearTill as:

- a bank;
- an accounting platform;
- a debt-management solution;
- regulated financial advice;
- a guarantee that spending is safe;
- an Open Banking service;
- an automatic view of every transaction;
- a replacement for professional debt or financial advice.

### 5.6 Required qualification

Where the context could otherwise mislead, state that results are:

> Estimates based on the figures entered by the user.

---

## 6. Audience hypotheses

These are hypotheses to test, not facts about the current customer base.

### Audience A: Salaried workers with multiple Direct Debits

**Problem hypothesis:** Their visible balance includes money required for bills that have not yet left.

**Likely alternatives:**

- mental arithmetic;
- bank balance;
- banking app spending tools;
- spreadsheet;
- notes app;
- calculator.

**Likely objection:** “My bank already tells me my balance.”

### Audience B: Parents managing variable family costs

**Problem hypothesis:** School, travel, activities and one-off household costs make the period before payday difficult to judge.

**Likely alternatives:**

- calendar reminders;
- partner messages;
- notes;
- spreadsheet;
- separate pots.

**Likely objection:** “I do not have time to keep another app updated.”

### Audience C: Privacy-conscious users

**Problem hypothesis:** They want a simple forward view but do not want to connect a bank account.

**Likely alternatives:**

- spreadsheet;
- offline notes;
- manual budgeting;
- no formal system.

**Likely objection:** “Manual entry sounds like work.”

### Audience D: People with changing dates or irregular one-off costs

**Problem hypothesis:** A bill date, payday or one-off cost changes and invalidates a static monthly budget.

**Likely alternatives:**

- recalculate manually;
- ignore until closer to the date;
- use several accounts or pots.

**Likely objection:** “I only need this occasionally.”

### Audience priority

Start broad enough to test the core proposition, but do not speak to “everyone who has money”.

For Month 2, choose one primary and one secondary audience based on:

- qualified traffic;
- preview starts;
- completed first positions;
- balance updates;
- return visits;
- useful comments and objections.

---

## 7. Content principles

Every publishable item must satisfy these principles.

### 7.1 Product relevance

Content must naturally connect to a ClearTill use case.

Reject content that could be published unchanged by any generic budgeting account.

### 7.2 One primary message

Each post should test one main proposition.

Do not combine:

- privacy;
- bill forecasting;
- one-off costs;
- daily amount;
- subscriptions;
- debt;
- pricing;

into one overloaded post.

### 7.3 Demonstration before abstraction

Prefer:

- a worked example;
- a product screen;
- a changed bill date;
- a before-and-after position;
- a clear calculation;

over general statements about “taking control of money”.

### 7.4 Honest limitation

Manual entry is part of the proposition, but it also creates friction.

Do not hide that trade-off. Test whether users value:

- control;
- simplicity;
- privacy;
- deliberate attention;

enough to enter and update their figures.

### 7.5 No manufactured social proof

Do not invent:

- customers;
- testimonials;
- reviews;
- user numbers;
- savings;
- activation statistics;
- awards;
- endorsements;
- media coverage;
- “people are saying” claims.

### 7.6 UK English

Use:

- payday;
- bills;
- Direct Debit;
- money left;
- costs;
- bank account.

Avoid unnecessary US terminology such as “checking account”.

### 7.7 Clear and non-judgemental

Do not shame people for:

- debt;
- missed bills;
- spending;
- using credit;
- not budgeting;
- financial anxiety.

### 7.8 Evidence before scale

A post that receives likes but no qualified visits is not a winner.

A message that produces completed first positions is more valuable than one that receives broad engagement.

---

## 8. Content pillars

### 8.1 The bank-balance illusion

Explain that a visible balance may include money already needed before payday.

Example angle:

> £1,200 in the bank is not necessarily £1,200 available.

### 8.2 What remains before payday

Show the practical outcome ClearTill is designed to calculate.

Example angle:

> Balance minus the bills and costs still due.

### 8.3 Manual by design

Explain why ClearTill can be used without a banking connection.

Example angle:

> A money view you control without sharing a bank login.

### 8.4 Real-life one-off costs

Show how non-monthly costs affect the period before payday.

Examples:

- school trip;
- car repair;
- family day out;
- annual insurance;
- birthday;
- travel;
- household repair.

### 8.5 Bills, dates and changing balances

Demonstrate that the position can change when:

- a bill moves;
- a balance changes;
- income arrives later;
- a cost is added;
- a cost is removed.

### 8.6 Founder-led insight

Explain:

- why ClearTill was built;
- what problem it is trying to solve;
- product decisions;
- lessons from testing;
- honest trade-offs.

Do not make the founder story grander than the evidence supports.

### 8.7 Worked illustrative examples

Use clearly labelled fictional figures to make the calculation understandable.

Required label:

> Illustrative example — not a real customer account.

### 8.8 Product walkthroughs

Show:

- entering a balance;
- choosing a payday;
- adding a bill;
- adding a one-off cost;
- updating a balance;
- seeing the position change.

Use real ClearTill screens. Do not generate fictional product interfaces with AI.

---

## 9. Claims and safety policy

### 9.1 Prohibited claims

Never claim or imply:

- guaranteed savings;
- guaranteed financial control;
- guaranteed avoidance of overdrafts;
- real-time access to a bank account;
- automatic transaction accuracy;
- regulated approval;
- bank-level security unless formally evidenced;
- that a person can safely spend a precise amount;
- that ClearTill will solve debt;
- that illustrative figures represent a customer.

### 9.2 Debt and payment difficulty

When discussing serious payment difficulty, signpost appropriate free support such as:

- MoneyHelper;
- StepChange;
- Citizens Advice;
- National Debtline.

Do not use ClearTill content to replace professional or regulated support.

### 9.3 Statistics

Every external statistic must include:

- exact source;
- source date;
- population or sample;
- geographic relevance;
- wording that does not broaden the finding.

Do not turn a statistic about one organisation's clients into a claim about all UK households.

### 9.4 Product facts

Pricing, preview rules and feature limits must be checked against:

- current application behaviour;
- repository configuration;
- Stripe configuration where relevant;
- approved product-facts file.

### 9.5 Personal data

Do not upload real customer financial information to:

- ChatGPT;
- Canva;
- Buffer;
- image-generation tools;
- public stock or asset hosting.

Product screenshots must use:

- test accounts;
- invented names;
- invented bills;
- non-identifying values;
- no real email addresses;
- no real payment or account details.

---

## 10. Canva operating system

### 10.1 Role of Canva

Canva should turn approved briefs into consistent, accessible and reusable ClearTill creative.

It should not become a disconnected design archive. Final exports and provenance must be recorded in the repository.

### 10.2 Brand Kit setup

Create a **ClearTill Brand Kit** containing:

- approved ClearTill logo files;
- brand colours;
- approved headline font;
- approved body font;
- app screenshots;
- icon set;
- trust-line lock-up;
- CTA treatment;
- example charts or UI components;
- standard disclaimers.

Do not create a new ClearTill logo from a public Canva logo template. Public template elements may be non-exclusive and unsuitable for trademark identity.

### 10.3 Canva folders

Use:

```text
ClearTill/
├── 00 Brand Master
├── 01 Social Templates
├── 02 Current Month
├── 03 Approved Exports
├── 04 Product Screens
├── 05 Journal
├── 06 Reels and Video
└── 99 Archive
```

### 10.4 Required master templates

Create these reusable templates:

1. **Feed portrait explainer:** 1080 × 1350
2. **Square explainer:** 1080 × 1080
3. **Story/Reel cover:** 1080 × 1920
4. **LinkedIn/Facebook landscape:** 1200 × 627
5. **Journal hero:** 1600 × 900
6. **Five-slide carousel**
7. **Worked calculation card**
8. **Product screenshot frame**
9. **Founder quote card**
10. **Question/poll card**

These are ClearTill working standards. Confirm platform and Buffer requirements before final export.

### 10.5 Template design rules

Each visual must:

- communicate one idea;
- remain understandable on a mobile screen;
- use large, readable text;
- avoid excessive decorative elements;
- contain sufficient contrast;
- avoid dense paragraphs;
- use the approved ClearTill logo;
- use consistent spacing and corner treatment;
- use real ClearTill screenshots for product demonstrations;
- include alt text in the content record;
- avoid implying that a stock model is a ClearTill customer.

### 10.6 ClearTill visual hierarchy

Recommended order:

1. problem or calculation;
2. short explanation;
3. ClearTill outcome;
4. CTA;
5. qualification or illustrative-example label where required.

### 10.7 Carousel structure

A standard five-slide carousel should follow:

- **Slide 1:** Hook
- **Slide 2:** The hidden issue
- **Slide 3:** Simple worked example
- **Slide 4:** ClearTill mechanism or screenshot
- **Slide 5:** CTA

Do not place the entire caption on the slides.

### 10.8 Canva export process

For each approved design:

1. duplicate the locked master template;
2. apply the content ID to the Canva design name;
3. use approved copy from the content record;
4. add or create the visual;
5. complete factual and claims checks;
6. check mobile readability;
7. check safe margins;
8. export;
9. record the exported filename;
10. record any Canva or third-party licensed content;
11. store the final export in `marketing/assets/canva-exports/`;
12. update `asset-register.json`.

### 10.9 Canva file naming

```text
YYYY-MM-DD_content-id_channel_format_v01.ext
```

Example:

```text
2026-07-20_ct-w01-a01_instagram_carousel_v03.png
```

Increment the version whenever the exported visual changes.

### 10.10 Canva content licensing controls

Canva Free and Pro content may be usable in commercial designs subject to Canva's current Content License Agreement.

Operational rules:

- never extract and redistribute a Canva stock element as a standalone asset;
- preserve the Canva design record;
- record whether content is Free, Pro, uploaded, AI-generated or third-party;
- treat Pro content as licensed within the design rather than owned by ClearTill;
- do not use Canva's Popular Music in commercial ClearTill promotional content;
- do not use a public Canva logo template as the ClearTill trademark;
- recheck licence terms when a design is materially repurposed or exported into a new design;
- prefer ClearTill-owned assets, product screens and simple original shapes.

This section is operational guidance, not legal advice.

---

## 11. Image and visual sourcing strategy

### 11.1 Priority order

Use visual sources in this order:

1. **Real ClearTill product screenshots**
2. **Original diagrams and calculations made in Canva**
3. **Original photography owned by ClearTill**
4. **AI-generated conceptual imagery**
5. **Licensed free stock**
6. **Canva library content**
7. **Wikimedia Commons or Openverse assets with file-specific licence checks**

This prioritises authenticity and reduces generic stock imagery.

### 11.2 Real product screenshots

Use screenshots for:

- onboarding;
- adding bills;
- updating balance;
- changing dates;
- weekly position;
- what remains before payday.

Rules:

- use test data only;
- show current production behaviour;
- remove browser or account information where unnecessary;
- do not alter the result to imply unsupported functionality;
- date and version screenshots where product UI may change.

### 11.3 Original diagrams

Prefer simple branded diagrams such as:

```text
Current balance
      −
Bills still due
      −
One-off costs
      =
Estimated amount remaining
```

These are more distinctive than generic finance photography.

### 11.4 AI-generated imagery

Use AI generation for:

- abstract concepts;
- neutral household scenes;
- textured backgrounds;
- non-branded illustrative objects;
- editorial-style compositions;
- simple conceptual metaphors.

Do not use AI generation for:

- fake ClearTill screens;
- fake customer testimonials;
- recognisable public figures;
- bank logos;
- financial statements;
- realistic debt distress presented as a real story;
- images that falsely imply endorsement;
- images containing important financial text or figures that must be accurate.

### 11.5 AI image prompt framework

Use:

```text
Create a [format and aspect ratio] editorial image for ClearTill.

Concept:
[one financial situation or metaphor]

Audience:
[target audience]

Composition:
[main subject, negative space and focal point]

Style:
[clean, contemporary, credible, human, restrained]

Brand integration:
Leave clear space for ClearTill headline and CTA. Do not generate a logo.

Restrictions:
No bank logos, no credit-card numbers, no financial documents, no text,
no fake app interface, no visible brand names, no distressed or shaming depiction,
and no implication that the people shown are real ClearTill customers.
```

### 11.6 Image-generation review checklist

Confirm:

- no distorted hands or objects;
- no fabricated words;
- no bank or third-party marks;
- no accidental account information;
- no culturally inappropriate depiction;
- no unrealistic currency;
- no deceptive product screen;
- no implication of a real customer;
- image supports the hypothesis rather than merely decorating the post.

### 11.7 Free stock repositories

#### Pexels

Suitable for:

- household scenes;
- working from home;
- family activities;
- bills and desk scenes;
- short background video.

Pexels permits free personal and commercial use under its licence and does not require attribution, although attribution is appreciated.

Operational restrictions:

- do not resell an unaltered asset;
- do not imply endorsement;
- do not label a recognisable person as being in debt or a ClearTill customer;
- record the source URL, creator and download date.

#### Unsplash

Suitable for:

- higher-quality editorial photography;
- household and lifestyle context;
- neutral background imagery.

Unsplash permits broad free commercial use under its licence without mandatory attribution.

Operational restrictions:

- do not compile or redistribute the image library;
- do not imply endorsement;
- record the photographer and source;
- avoid using recognisable people in sensitive financial claims.

#### Pixabay

Suitable for:

- illustrations;
- simple icons;
- backgrounds;
- photographs;
- some video and audio.

Pixabay permits free use and adaptation subject to prohibited uses.

Operational restrictions:

- do not distribute content on a standalone basis;
- avoid content containing recognisable trademarks or brands for commercial promotion;
- do not use content deceptively;
- check third-party rights.

#### Wikimedia Commons

Use only where a historical, public-domain or factual image adds specific value.

Every file can have different terms.

Required checks:

- file description page;
- named creator;
- exact licence;
- attribution requirement;
- share-alike requirement;
- source link;
- modification statement;
- public-domain status where claimed.

#### Openverse

Openverse is a search tool for openly licensed media, not a blanket licence.

Check the underlying asset and original source. Do not rely only on the search-result label.

### 11.8 Avoid misleading stock use

Do not place a recognisable stock model next to copy such as:

- “I could not pay my bills”;
- “ClearTill saved me from debt”;
- “This user saved £500”;
- “A ClearTill customer”.

Use stock people only as general editorial illustration and never as invented proof.

### 11.9 Attribution policy

Even where attribution is not required, maintain internal provenance.

For public-facing credits:

- credit where licence requires it;
- credit photographers where practical;
- put longer credits on the Journal page or image-credits page;
- do not rely on a social caption that may later be separated from the image where the licence requires attribution.

---

## 12. Asset register

Every external or generated visual must have a record.

Example:

```json
{
  "assetId": "asset-2026-07-20-001",
  "contentId": "ct-w01-a01",
  "type": "stock_photo",
  "sourceProvider": "pexels",
  "sourceUrl": "https://example.com/source-page",
  "creator": "Creator name",
  "licence": "Pexels License",
  "downloadedAt": "2026-07-19T20:30:00+01:00",
  "originalFilename": "original-file.jpg",
  "canvaDesignUrl": null,
  "generatedPrompt": null,
  "modifications": "Cropped, darkened and overlaid with ClearTill text",
  "attributionRequired": false,
  "publicAttribution": null,
  "modelOrTrademarkRiskChecked": true,
  "approvedBy": "Gavin Ferns",
  "approvedAt": null
}
```

### Required asset fields

- asset ID;
- associated content ID;
- source type;
- source provider;
- source URL or generation prompt;
- creator;
- licence;
- download or generation date;
- modifications;
- attribution requirement;
- Canva design reference;
- approval;
- notes on people, trademarks or sensitive context.

---

## 13. Buffer publishing architecture

### 13.1 Provider-neutral interface

Do not hard-code all content records to Buffer.

Use:

```text
SocialPublisher
├── MockPublisher
├── BufferPublisher
└── FuturePublisher
```

### 13.2 Required methods

```text
listChannels()
createDraft(content)
schedulePost(content, dueAt)
getPost(postId)
getPostMetrics(postId)
```

### 13.3 Buffer rules

- use the current GraphQL API;
- use the current asset input format;
- discover organisation and channel IDs through the API;
- keep the API key server-side;
- create drafts by default;
- require explicit approval before scheduling;
- require `--confirm-publish` for a live schedule operation;
- reject past dates;
- use Europe/London for calendar input and convert correctly for API timestamps;
- prevent duplicate publication;
- record the remote post ID;
- redact secrets from logs;
- use bounded retries only for transient errors;
- do not bulk publish in the first version.

### 13.4 Media hosting

Buffer's API needs accessible media URLs.

Approved options may include:

- an existing ClearTill public asset endpoint;
- Vercel Blob;
- Cloudinary;
- Cloudflare R2 with public delivery;
- another controlled media host already used by ClearTill.

Do not use:

- local file paths;
- temporary ChatGPT links;
- expiring preview URLs;
- private Google Drive URLs;
- a Canva editor link as the media file URL.

### 13.5 Status model

```text
idea
→ drafted
→ visual_required
→ visual_ready
→ reviewed
→ approved
→ buffer_draft
→ scheduled
→ published
→ measured
→ archived
```

A post may move backwards for revision.

### 13.6 Approval gate

Live scheduling must fail unless all are true:

- `status === "approved"`;
- `claimsChecked === true`;
- `productFactsChecked === true`;
- `licenceChecked === true`;
- `linksChecked === true`;
- final visual exists;
- alt text exists;
- schedule is in the future;
- explicit confirmation flag is present.

---

## 14. Content record

Example master record:

```json
{
  "id": "ct-w01-a01",
  "date": "2026-07-20",
  "experimentId": "exp-core-message-01",
  "hypothesis": "A visible balance-minus-bills calculation will create stronger product recognition than generic budgeting language.",
  "targetAudience": ["salaried_workers"],
  "contentPillar": "bank_balance_illusion",
  "messageVariant": "A",
  "format": "five_slide_carousel",
  "sourceOrRationale": "Core ClearTill proposition",
  "illustrativeExample": true,
  "cta": "Check my position free",
  "landingPath": "/start",
  "utm": {
    "utm_source": "instagram",
    "utm_medium": "organic_social",
    "utm_campaign": "balance_not_reality",
    "utm_content": "w01_a01_carousel"
  },
  "channels": {
    "linkedin": {
      "text": "",
      "visualAssetId": null
    },
    "facebook": {
      "text": "",
      "visualAssetId": null
    },
    "instagram": {
      "text": "",
      "visualAssetId": null
    }
  },
  "visualBrief": "",
  "altText": "",
  "status": "drafted",
  "checks": {
    "claimsChecked": false,
    "productFactsChecked": false,
    "licenceChecked": false,
    "linksChecked": false
  },
  "approval": {
    "approvedBy": null,
    "approvedAt": null
  },
  "publication": {
    "provider": "buffer",
    "remotePostIds": [],
    "scheduledAt": null,
    "publishedAt": null
  },
  "results": {
    "impressions": null,
    "engagements": null,
    "qualifiedVisits": null,
    "previewStarts": null,
    "firstPositionsSaved": null,
    "balanceUpdates": null,
    "returnVisits": null,
    "planSelections": null,
    "purchases": null
  },
  "decision": null
}
```

---

## 15. Channel strategy

### 15.1 LinkedIn

Primary role:

- founder insight;
- product decisions;
- problem definition;
- transparent experiments;
- thoughtful explanations.

Preferred formats:

- founder text post;
- product screenshot;
- PDF carousel;
- short screen recording;
- Journal article excerpt.

Avoid:

- over-polished corporate language;
- generic motivational posts;
- pretending ClearTill is already a large company.

### 15.2 Facebook

Primary role:

- relatable household scenarios;
- practical before-payday examples;
- questions;
- family and bill timing use cases;
- direct product demonstrations.

Preferred formats:

- single image;
- short video;
- simple carousel;
- discussion prompt;
- linked Journal guide.

Avoid:

- sensational debt imagery;
- broad targeting without a clear use case;
- long technical founder posts.

### 15.3 Instagram

Primary role:

- visual explanation;
- worked examples;
- product walkthroughs;
- Reels;
- carousels;
- concise trust messaging.

Preferred formats:

- 4:5 carousel;
- short Reel;
- Story;
- product screenshot;
- calculation card.

Avoid:

- dense captions as the only explanation;
- generic cash photography;
- captions without a usable profile or Story link route.

### 15.4 Journal

The Journal should provide durable, search-relevant explanation and become a source for social repurposing.

Every Journal article should include:

- a clear question or use case;
- concise answer near the top;
- worked example;
- product relevance;
- internal links;
- appropriate external sources;
- CTA;
- accurate metadata;
- original or properly licensed hero image;
- alt text.

### 15.5 Email

Email is not the initial acquisition channel, but social and Journal content can be repurposed into:

- preview onboarding;
- balance-update reminders;
- product education;
- end-of-preview conversion;
- occasional founder updates.

Do not send general marketing email without the appropriate consent and suppression controls.

---

## 16. Twelve-week experiment structure

### Month 1: Core message fit

**Weeks 1–4: 20 July–16 August 2026**

Test:

- Message A: The bank balance is not necessarily the amount available.
- Message B: Know what remains without connecting a bank.
- Message C: Balance minus what is still due before payday.

Decision:

- choose a leading message;
- reject or reframe weak messages;
- identify whether the landing page explains the same proposition.

### Month 2: Audience and use-case fit

**Weeks 5–8: 17 August–13 September 2026**

Use the leading Month 1 message to test:

- parents and school costs;
- salaried workers with several Direct Debits;
- privacy-conscious users;
- people with changed dates and one-off costs.

Decision:

- choose one primary audience;
- retain one secondary audience;
- stop audience-specific work that produces engagement without activation.

### Month 3: Format and conversion fit

**Weeks 9–12: 14 September–11 October 2026**

Use the leading message and audience to test:

- founder post;
- carousel;
- screen recording;
- worked example;
- Journal article;
- CTA language.

Decision:

- select the repeatable message-format-channel combination;
- decide whether to increase organic frequency;
- decide whether a small paid test is justified.

---

## 17. Detailed four-week content calendar

### Week 1: 20–26 July 2026

#### Monday 20 July — Bank balance is not availability

- **Content ID:** `ct-w01-a01`
- **Message:** A
- **Hook:** “£1,200 in your account does not necessarily mean £1,200 is available.”
- **Format:** Five-slide carousel
- **Illustrative figures:** £1,200 balance; £850 bills and costs; £350 estimated remaining
- **Hypothesis:** A visible calculation creates stronger recognition than generic budgeting language.
- **Visual:** Canva calculation carousel with a clearly labelled illustrative example.
- **CTA:** Check my position free.
- **Primary metric:** First positions saved per qualified visit.

#### Wednesday 22 July — No bank connection

- **Content ID:** `ct-w01-b01`
- **Message:** B
- **Hook:** “Why ClearTill does not need your bank login.”
- **Format:** Founder post plus product screenshot
- **Hypothesis:** Privacy and control are meaningful reasons to try ClearTill.
- **Visual:** Real onboarding screen framed in Canva.
- **CTA:** See your position without connecting a bank.
- **Failure risk:** Users may interpret manual entry as excessive work.

#### Friday 24 July — The before-payday calculation

- **Content ID:** `ct-w01-c01`
- **Message:** C
- **Hook:** “Balance minus everything still due before payday.”
- **Format:** 20–30 second product screen recording
- **Hypothesis:** Direct demonstration produces higher-intent visits than explanation.
- **Visual:** Real test-account flow with subtitles and no personal data.
- **CTA:** Check my position free.
- **Primary metric:** Preview-start rate.

### Week 2: 27 July–2 August 2026

#### Monday 27 July — A normal day out changes the position

- **Content ID:** `ct-w02-c01`
- **Message:** C
- **Hook:** “The day out is £45. But what does that do to the rest of the week?”
- **Format:** Worked example carousel
- **Hypothesis:** A familiar one-off decision makes the product tangible.
- **Visual:** Original Canva illustration; no fake customer.
- **CTA:** Add the cost before deciding.

#### Wednesday 29 July — Money already spoken for

- **Content ID:** `ct-w02-a01`
- **Message:** A
- **Hook:** “The bill has not left yet. The money is still spoken for.”
- **Format:** Single calculation graphic
- **Hypothesis:** “Spoken for” is more understandable than “budgeted”.
- **Visual:** Balance amount visually separated from pending commitments.
- **CTA:** See what remains before payday.

#### Friday 31 July — Manual does not mean complicated

- **Content ID:** `ct-w02-b01`
- **Message:** B
- **Hook:** “Balance. Payday. Bills. Answer.”
- **Format:** Four-step carousel
- **Hypothesis:** A short process reduces perceived manual-entry friction.
- **Visual:** Four real screens or accurate simplified diagrams.
- **CTA:** Check my position free.

### Week 3: 3–9 August 2026

#### Monday 3 August — “My bank already shows my balance”

- **Content ID:** `ct-w03-a01`
- **Message:** A
- **Hook:** “Your bank shows what is there. The question is what is already needed.”
- **Format:** Objection-response founder post
- **Hypothesis:** Contrasting current balance with forward commitments explains the difference.
- **Visual:** Split-screen Canva graphic.
- **CTA:** Compare your balance with what is still due.

#### Wednesday 5 August — Move a bill date

- **Content ID:** `ct-w03-c01`
- **Message:** C
- **Hook:** “Move one bill into next month and the position changes.”
- **Format:** Product screen recording
- **Hypothesis:** Responsive date changes demonstrate repeat value.
- **Visual:** Real ClearTill bill-date update.
- **CTA:** Test your own dates.

#### Friday 7 August — Audience research question

- **Content ID:** `ct-w03-r01`
- **Message:** Research
- **Hook:** “What is hardest: remembering bills, knowing what is left, or dealing with unexpected costs?”
- **Format:** Poll or question card
- **Hypothesis:** Direct audience wording will reveal which problem has salience.
- **Visual:** Simple Canva question card.
- **CTA:** Comment or vote.
- **Decision note:** Do not treat engagement as product activation.

### Week 4: 10–16 August 2026

#### Monday 10 August — Repeat the current winner

- **Content ID:** `ct-w04-win01`
- **Message:** Current winning A/B/C
- **Hook:** Reuse the winning proposition with new figures.
- **Format:** Different creative treatment, same proposition
- **Hypothesis:** A real message winner should survive a new example.
- **Visual:** Canva carousel or single graphic.
- **CTA:** Keep the CTA unchanged where possible.

#### Wednesday 12 August — Back-to-school costs

- **Content ID:** `ct-w04-p01`
- **Message:** A or C
- **Hook:** “Shoes, uniform and a school trip can all land before the next payday.”
- **Format:** Product walkthrough
- **Hypothesis:** Parents may be a high-intent use case.
- **Visual:** Real product screens plus neutral school-item illustration.
- **CTA:** Add the costs and see the effect.
- **Safety:** Do not show identifiable children without appropriate rights.

#### Friday 14 August — Outcome-led CTA

- **Content ID:** `ct-w04-cta01`
- **Message:** Current winner
- **Hook:** “Start with today’s balance. Finish with what is likely to remain.”
- **Format:** Direct-response single image or short video
- **Hypothesis:** Outcome language converts better than feature language.
- **Visual:** ClearTill product result, not a generic finance image.
- **CTA:** Check my position free.

---

## 18. Weeks 5–12 content plan

### Week 5: 17–23 August — Parents and variable family costs

- **Mon:** “Three school costs that do not arrive like a monthly bill.” — Carousel
- **Wed:** Add a school trip and show the before-payday position changing. — Screen recording
- **Fri:** “Do you plan family one-offs in a spreadsheet, notes app or not at all?” — Research question

**Test:** Whether parents produce stronger activation than the broad audience.

### Week 6: 24–30 August — Privacy-conscious users

- **Mon:** “A useful money view without giving an app bank access.” — Founder post
- **Wed:** Explain exactly what ClearTill does and does not collect. — Trust graphic
- **Fri:** “Manual control versus automatic connection: what matters more?” — Poll

**Test:** Whether privacy is a primary buying reason or only a supporting reassurance.

### Week 7: 31 August–6 September — Direct Debits and bill timing

- **Mon:** “Five Direct Debits have not left yet. Your balance still includes them.” — Calculation carousel
- **Wed:** Change a Direct Debit date and compare two positions. — Product demo
- **Fri:** “The problem is not always the bill amount. Sometimes it is the date.” — Founder post

**Test:** Whether bill timing is more salient than generic affordability.

### Week 8: 7–13 September — One-off costs and annual expenses

- **Mon:** Annual insurance entered as a future cost. — Worked example
- **Wed:** “Monthly budgets miss costs that are not monthly.” — Journal-led post
- **Fri:** Ask which annual cost people most often forget. — Research post

**Test:** Whether occasional use cases create return behaviour.

### Week 9: 14–20 September — Format test

Use the leading message and audience.

- **Mon:** Founder text post
- **Wed:** Five-slide carousel
- **Fri:** 20-second screen recording

**Test:** Hold the message constant and compare format.

### Week 10: 21–27 September — CTA test

Use the same message and broadly similar creative.

- **Mon CTA:** “Check my position free”
- **Wed CTA:** “See what is really left”
- **Fri CTA:** “Work out what remains before payday”

**Test:** Compare preview starts and first positions saved, not clicks alone.

### Week 11: 28 September–4 October — Trust and objection test

- **Mon:** “Why there is no bank login.” — Trust post
- **Wed:** “What ClearTill cannot know unless you enter it.” — Honest limitation
- **Fri:** “How long does the first setup actually take?” — Timed product demo

**Test:** Whether honesty about manual entry improves qualified conversion.

### Week 12: 5–11 October — Confirmation and decision

- **Mon:** Repeat the best message-format-audience combination.
- **Wed:** Publish the strongest Journal guide with a product demonstration.
- **Fri:** Founder learning post: what users responded to and what ClearTill changed.

**Test:** Confirm repeatability before increasing frequency or paid spend.

---

## 19. Journal plan

Publish one substantial article every two weeks initially.

### Article 1

**Title:** Why your bank balance is not always what you can spend  
**Primary query:** what is left after bills  
**Supporting content:** worked calculation and ClearTill screenshot

### Article 2

**Title:** How to calculate what is left before payday  
**Primary query:** money left until payday  
**Supporting content:** step-by-step method and product example

### Article 3

**Title:** Why use a money app without connecting your bank?  
**Primary query:** budgeting app without bank connection  
**Supporting content:** trade-offs of manual and connected tools

### Article 4

**Title:** How to plan for one-off costs between paydays  
**Primary query:** plan for unexpected costs before payday  
**Supporting content:** school, car, travel and annual costs

### Article 5

**Title:** Why bill dates matter as much as bill amounts  
**Primary query:** manage bills before payday  
**Supporting content:** date movement worked example

### Article 6

**Title:** Spreadsheet, banking app or ClearTill: which job is each best for?  
**Primary query:** cash flow app versus budget spreadsheet  
**Supporting content:** honest substitute comparison

Do not attack free alternatives. Explain the narrower job ClearTill is intended to do.

---

## 20. Additional content idea backlog

### Bank balance and commitments

1. “The balance is current. Your commitments are future.”
2. “Why pending bills can create a false sense of room.”
3. “£900 in the bank, but £620 is already needed.”
4. “The difference between account balance and planned balance.”
5. “A balance is a snapshot, not a plan.”

### Before-payday decisions

6. “Can I spend £30 tonight without affecting Friday’s bill?”
7. “What happens when payday is five days away?”
8. “The decision is not ‘can I buy it?’ but ‘what remains afterwards?’”
9. “A simple check before a non-essential purchase.”
10. “What changes when income arrives one day later?”

### Manual by design

11. “What ClearTill can do without reading your bank account.”
12. “Why manual entry can create deliberate control.”
13. “What you enter, what ClearTill calculates and what it cannot know.”
14. “No bank login: benefit and trade-off.”
15. “Why ClearTill does not pretend manual data is automatic.”

### Bills and dates

16. “A bill moved from the 28th to the 2nd.”
17. “The same bills, a different payday, a different position.”
18. “What a forgotten subscription changes.”
19. “Two bills on the same day.”
20. “Why updating the current balance matters.”

### One-off costs

21. “MOT and service in the same pay period.”
22. “Birthday costs that are not monthly.”
23. “A train fare, school cost and fuel top-up.”
24. “Annual insurance as a future commitment.”
25. “A weekend away before payday.”

### Founder and product building

26. “The product decision to avoid Open Banking.”
27. “What we learned from people misunderstanding ‘available’.”
28. “Why ClearTill focuses on one job.”
29. “A product bug that changed how the position updates.”
30. “Why the next balance should appear immediately after an update.”

### Objections

31. “I can do this in a spreadsheet.”
32. “My banking app already has spending insights.”
33. “I do not want another subscription.”
34. “I will forget to update it.”
35. “I only need it near payday.”

### Trust and limitations

36. “ClearTill is an estimate, not a guarantee.”
37. “What happens when you forget a bill.”
38. “Why the figures are only as good as what is entered.”
39. “What ClearTill does not share with a bank.”
40. “When ClearTill is not the right tool.”

### Seasonal and timely

41. School uniform and activity costs
42. Christmas planning before December
43. Energy cap changes with properly cited official sources
44. Annual insurance renewals
45. Holiday spending
46. Council tax break months where applicable
47. Summer childcare
48. New Year Direct Debit increases
49. Car tax and MOT
50. Payday changes around bank holidays

---

## 21. Tracking and attribution

### 21.1 Required UTM fields

ClearTill should create its own tracked URLs before Buffer.

```text
utm_source
utm_medium
utm_campaign
utm_content
```

Optional:

```text
utm_term
experiment_id
creative_id
```

Use lowercase snake case.

Example:

```text
https://www.cleartill.money/start
?utm_source=linkedin
&utm_medium=organic_social
&utm_campaign=balance_not_reality
&utm_content=w01_a01_carousel
```

### 21.2 Link restrictions

Campaign destinations must:

- use an allowlisted ClearTill domain;
- use an approved path;
- avoid arbitrary redirect targets;
- preserve campaign parameters;
- avoid exposing secrets or personal information.

### 21.3 Product funnel

Use or map to existing analytics events:

```text
social_link_clicked
landing_cta_clicked
preview_started
first_position_saved
balance_updated
return_visit
plan_selected
checkout_started
purchase_completed
```

Purchase completion must remain server- or webhook-confirmed.

### 21.4 Event properties

Capture where appropriate:

- `content_id`;
- `experiment_id`;
- `utm_source`;
- `utm_medium`;
- `utm_campaign`;
- `utm_content`;
- `landing_variant`;
- `access_type`;
- anonymous or authenticated state;
- time to first position;
- return interval.

Do not add personal bill or balance values to general marketing analytics.

---

## 22. Measurement framework

### 22.1 Primary Month 1 metric

```text
First-position activation rate
=
first_position_saved / qualified_landing_sessions
```

### 22.2 Secondary metrics

- qualified visits;
- landing CTA clicks;
- preview starts;
- balance updates;
- return visits;
- plan selections;
- purchases;
- saves and shares;
- substantive comments;
- video completion;
- delivery failures.

### 22.3 Do not optimise around

- impressions alone;
- likes alone;
- follower count alone;
- generic comments;
- AI-estimated sentiment without reading the comments;
- Buffer engagement metrics without ClearTill product events.

### 22.4 Provisional message criteria

After at least 30 qualified visits to a message:

**Promising**

- preview-start rate at or above 15%;
- first-position activation rate at or above 8%;
- evidence of some return usage.

**Weak**

- fewer than 5% start a preview;
- fewer than 3% save a first position;
- repeated comments show misunderstanding.

**Directional winner**

- at least 1.5 times the activation rate of the next-best message;
- at least five activated users;
- no material deterioration in return behaviour.

These are internal decision rules, not market benchmarks.

### 22.5 Channel pause criteria

After 8–10 properly adapted posts on a channel, pause the channel for one month when all are true:

- fewer than 10 qualified visits;
- no activated users;
- no useful audience feedback.

### 22.6 Paid test trigger

Use a small paid test only when:

- one or two messages show stronger organic activation;
- the landing page and product tracking work;
- the target audience can be defined;
- creative and CTA are approved;
- purchase events are correctly attributed.

Suggested initial test:

- £30–£50 total;
- same audience;
- same placement where possible;
- two leading messages;
- equal budgets;
- no simultaneous landing-page redesign.

---

## 23. Weekly operating rhythm

### Monday

- review the prior seven days;
- confirm the active hypothesis;
- approve the next three master posts;
- approve copy variants;
- approve Canva briefs;
- verify links and UTMs;
- save Buffer drafts.

### Tuesday

- complete Canva production;
- register assets;
- review mobile previews;
- add alt text;
- complete claims, facts and licence checks.

### Wednesday

- check publication status;
- respond to substantive comments;
- record objections and user wording;
- avoid changing the experiment mid-week unless something is wrong.

### Friday

Record:

```json
{
  "week": 1,
  "messageWinner": null,
  "bestChannel": null,
  "bestFormat": null,
  "qualifiedVisits": 0,
  "previewStarts": 0,
  "firstPositionsSaved": 0,
  "balanceUpdates": 0,
  "returnVisits": 0,
  "planSelections": 0,
  "purchases": 0,
  "audienceLanguage": [],
  "learning": "",
  "decision": "continue"
}
```

### Every four weeks

Make one decision:

- **STOP:** The audience does not recognise or act on the problem.
- **PIVOT:** The problem appears real, but the message, audience, landing page or onboarding is wrong.
- **TEST:** Evidence remains mixed or the sample is too small.
- **PROCEED:** Activation is repeatable enough to justify increased effort.

---

## 24. Editorial and visual approval checklist

### Copy

- [ ] One clear message
- [ ] Clear target audience
- [ ] Defined hypothesis
- [ ] No invented claim
- [ ] No invented customer
- [ ] No unsupported statistic
- [ ] UK English
- [ ] Non-judgemental wording
- [ ] Accurate CTA
- [ ] Illustrative example identified
- [ ] Product limitation stated where relevant

### Product

- [ ] Current screenshot
- [ ] Test data only
- [ ] Current pricing and preview terms
- [ ] Product behaviour verified
- [ ] No fictional feature
- [ ] No visible personal data

### Visual

- [ ] Canva master used
- [ ] Mobile readable
- [ ] Sufficient contrast
- [ ] No misleading stock model
- [ ] No accidental third-party logo
- [ ] Alt text written
- [ ] Asset registered
- [ ] Licence checked
- [ ] Attribution included where required
- [ ] Final export stored

### Link and publication

- [ ] ClearTill destination allowlisted
- [ ] UTM complete
- [ ] `content_id` correct
- [ ] Buffer channel correct
- [ ] Date and timezone correct
- [ ] Final preview checked
- [ ] Human approval recorded
- [ ] No duplicate remote post

---

## 25. Prompt library

### 25.1 Weekly content creation

```text
Create three ClearTill master content records for week [number].

Use the approved marketing files as the source of truth.

For each record provide:
- hypothesis;
- target audience;
- message variant;
- content pillar;
- reason the content may fail;
- LinkedIn version;
- Facebook version;
- Instagram version;
- visual brief;
- Canva template;
- image source recommendation;
- alt text;
- CTA;
- landing path;
- UTM fields;
- claims requiring verification;
- measurement goal.

Do not invent customers, product features, savings or statistics.
Use UK English.
Make each post test a materially different question.
```

### 25.2 Red-team editorial review

```text
Review these ClearTill drafts as a sceptical growth and compliance editor.

For each draft identify:
- unclear proposition;
- generic budgeting language;
- unsupported claims;
- misleading financial implications;
- weak CTA;
- likely vanity engagement;
- audience mismatch;
- stock-image risk;
- missing qualification;
- duplicated hypothesis.

Return STOP, PIVOT, TEST or PROCEED for each draft.
```

### 25.3 Canva visual brief

```text
Turn this approved ClearTill content record into a Canva production brief.

Specify:
- recommended master template;
- slide-by-slide structure;
- exact text hierarchy;
- screenshot requirements;
- original diagram requirements;
- stock or AI image recommendation;
- accessibility considerations;
- safe margins;
- export variants;
- filename;
- alt text;
- licence or provenance checks.

Do not change the approved claim or figures.
```

### 25.4 Free-stock sourcing

```text
Propose five precise search queries for Pexels, Unsplash and Pixabay for this ClearTill brief.

Avoid:
- bank logos;
- visible card details;
- distressed stereotypes;
- recognisable children;
- images that imply the model is a customer;
- clichéd money-rain imagery.

For each query state:
- intended emotional tone;
- composition;
- model or trademark risks;
- how ClearTill text can be overlaid.
```

### 25.5 AI image generation

```text
Create an original editorial image for ClearTill in [aspect ratio].

Concept:
[concept]

The image should feel credible, calm and contemporary.
Leave negative space for a short ClearTill headline.
Do not generate text, logos, bank branding, card numbers, financial documents,
an app interface, or an image implying a real customer testimonial.
```

### 25.6 Weekly evidence review

```text
Analyse the attached ClearTill weekly results.

Do not optimise for likes.

Assess:
- qualified visits;
- preview starts;
- first positions saved;
- balance updates;
- return visits;
- plan selections;
- purchases;
- substantive comments;
- objections and audience language.

Compare message, audience, channel and format.
State:
- STOP, PIVOT, TEST or PROCEED;
- confidence;
- strongest counterargument;
- missing evidence;
- cheapest next test;
- kill criteria.
```

---

## 26. Suggested repository commands

Adapt to the repository's package manager and conventions.

```text
npm run content:validate
npm run content:calendar
npm run content:generate -- --week=1
npm run content:repurpose -- --slug=<journal-slug>
npm run content:utm -- --id=<content-id>
npm run content:photos -- --ids=ct-w01-a01,ct-w01-b01,ct-w01-c01
npm run content:photos:download -- --id=<content-id> --asset=<pixabay-id>
npm run content:infographics
npm run content:assets:validate
npm run content:buffer:channels
npm run content:buffer:payload -- --id=<content-id>
npm run content:buffer:draft -- --id=<content-id>
npm run content:buffer:schedule -- --id=<content-id> --confirm-publish
npm run content:buffer:status -- --id=<content-id>
npm run content:report -- --week=1
```

`content:photos` uses the server-only `PIXABAY_API_KEY` to cache review candidates for 24 hours in `marketing/creative/stock-photo-candidates.json`. Valid cached results are reused automatically; pass `--refresh` only when a deliberate new API request is needed. It never places the key in that file. Candidates are suggestions, not approved assets. After human selection, `content:photos:download` copies the chosen image into `marketing/assets/stock/` and creates an unapproved provenance record in `marketing/assets/asset-register.json`. Licence, model/property, trademark, sensitive-context and human checks must remain false until reviewed. Never send a temporary Pixabay CDN URL to Canva or Buffer.

### Minimum automated checks

- malformed content record;
- missing rationale;
- invented testimonial pattern;
- unsupported claim;
- missing product-fact check;
- missing licence check;
- missing alt text;
- malicious external URL;
- missing UTM;
- unsupported channel;
- missing Buffer configuration;
- secret redaction;
- old Buffer asset format;
- duplicate publication;
- past schedule;
- no confirmation flag;
- network timeout;
- GraphQL error;
- transient retry limit;
- dry run performs no network call.

---

## 27. Manual setup checklist

### ChatGPT Project

- [ ] Confirm ClearTill Project instructions
- [ ] Add approved marketing files
- [ ] Keep separate chats for strategy, production, weekly review, Journal and implementation
- [ ] Do not upload secrets or customer financial data

### Canva

- [ ] Create ClearTill Brand Kit
- [ ] Upload approved logo
- [ ] Set colours and fonts
- [ ] Create ten master templates
- [ ] Create folder structure
- [ ] Add standard disclaimers
- [ ] Create product screenshot test account
- [ ] Establish design naming rules

### Buffer

- [ ] Verify account email
- [ ] Connect LinkedIn
- [ ] Connect ClearTill Facebook Page
- [ ] Connect professional Instagram account
- [ ] Create minimum-scope personal API key
- [ ] Store key server-side
- [ ] Discover organisation ID
- [ ] Discover channel IDs
- [ ] Test one draft
- [ ] Confirm no unintended schedule
- [ ] Test one approved scheduled post

### Repository

- [ ] Populate all marketing JSON files
- [ ] Add asset register
- [ ] Add first 12 content records
- [ ] Add weeks 5–12 plan
- [ ] Add validation
- [ ] Add provider-neutral publisher
- [ ] Add Buffer publisher
- [ ] Add mock publisher
- [ ] Add tests
- [ ] Confirm no secrets are committed

---

## 28. Current external references

These references were checked on 19 July 2026. Recheck them before changing an integration or relying on a licence.

### Buffer

- [Buffer API documentation](https://developers.buffer.com/)
- [Buffer API quick start](https://developers.buffer.com/guides/getting-started.html)
- [Posts and scheduling](https://developers.buffer.com/guides/posts-and-scheduling.html)
- [Buffer API help and current media migration notice](https://support.buffer.com/article/859-does-buffer-have-an-api)

### Canva

- [Canva Brand Kit](https://www.canva.com/help/brand-kit/)
- [Canva copyright and design ownership](https://www.canva.com/help/copyright-design-ownership/)
- [Using Canva to create commercial products](https://www.canva.com/help/using-canva-to-create-products-for-sale/)
- [Canva trademark and logo guidance](https://www.canva.com/help/trademarks-logo/)
- [Canva AI product terms](https://www.canva.com/policies/ai-product-terms/)
- [Canva popular music restrictions](https://www.canva.com/policies/popular-music-license/)

### Free and open media

- [Pexels licence](https://www.pexels.com/license/)
- [Unsplash licence](https://unsplash.com/license)
- [Pixabay licence summary](https://pixabay.com/service/license-summary/)
- [Wikimedia Commons reuse guidance](https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia)
- [Openverse](https://wordpress.org/openverse/)
- [Creative Commons public-domain guidance](https://creativecommons.org/public-domain/)

---

## 29. Final operating rule

No content should be published merely because it has been generated, designed or scheduled.

A ClearTill post is publishable only when:

1. it tests a defined question;
2. the product facts are accurate;
3. the claim is supportable;
4. the visual is licensed and not misleading;
5. the user action is measurable;
6. the owner has approved it;
7. the result will be reviewed.

The system exists to discover what creates real ClearTill usage—not to create the appearance of marketing activity.
