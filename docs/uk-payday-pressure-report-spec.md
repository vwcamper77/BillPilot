# Internal specification: UK Payday Pressure Report 2026

Status: internal and non-public

Proposed future route: `/research/uk-payday-pressure-report-2026`

Owner: GMBF Ventures Ltd / ClearTill
Last updated: 18 July 2026

## Publication status and hard boundary

This document specifies possible future research. It contains no findings, percentages, participant data or claim that fieldwork has happened. No public report route, placeholder, Journal card or “coming soon” message should exist until the publication gate in this document is satisfied.

The free payday cashflow calculator must not collect research data. Calculator values, dates and descriptions must not be stored, transmitted, placed in analytics, reused for research or linked to a future survey. Any survey must be separate, clearly labelled, voluntary and governed by its own privacy information and consent/participation flow.

## Commercial and editorial purpose

The proposed report would describe how UK adults experience and manage the period before their next income date. Its editorial value would be a transparent evidence base for useful public explanations about bill timing, pay patterns and manual versus connected money tools. Its commercial value would be relevant awareness of ClearTill among consumers, journalists and organisations interested in household cashflow.

Commercial relevance must not shape the arithmetic, suppress inconvenient results or turn neutral survey responses into product endorsements. The report must distinguish observed survey responses from interpretation and from ClearTill's product position.

## Intended audience

- UK consumers managing regular or irregular income
- Personal-finance, consumer-affairs and employment journalists
- Money-guidance organisations and researchers
- Employers, payroll providers and organisations interested in pay-cycle design
- Product teams working on consumer budgeting and cashflow tools

## Research questions

1. How much pressure do respondents report at different points between income dates?
2. How many known bills or committed costs are commonly due before the next reliable income date?
3. How do weekly, fortnightly, four-weekly, monthly and irregular income patterns differ in reported pressure?
4. How often do people check balances, bills and upcoming commitments?
5. Which information do people use to decide what is available to spend?
6. What mistakes or uncertainties make that decision harder, including forgotten bills or uncertain income?
7. Do respondents prefer manual, spreadsheet-based, bank-connected or mixed approaches, and why?
8. Which subgroups may warrant careful descriptive comparison without implying causation?

## Proposed data-collection method

Commission a standalone online survey of UK adults aged 18 or over through a reputable panel provider. Use quotas agreed before fieldwork for relevant characteristics such as nation/region, age and gender, with any weighting method designed and documented before analysis. Do not recruit silently from calculator usage or infer responses from customer records.

The survey landing page must name GMBF Ventures Ltd, explain the research purpose, identify the panel/research provider, state the expected completion time, explain incentives, link the privacy notice and make participation voluntary. Fieldwork start and end dates, recruitment source, completion rules and survey version must be retained for methodology reporting.

An independent research-methods review should assess the questionnaire before launch. A small pilot should check comprehension, routing, completion time and whether free-text prompts invite unnecessary personal or identifying information.

### Geographic and demographic coverage

The sample design should cover England, Scotland, Wales and Northern Ireland, with nation and English-region targets documented before fieldwork. Review coverage across age, gender, employment status, household composition, disability and income pattern where collection is necessary and proportionate. Do not promise representative national or subgroup estimates merely because quotas are used. Any demographic field must have a stated analytical purpose, proportionate answer bands and an appropriate â€œprefer not to sayâ€ option.

### Consent and participation

Participation must be informed, voluntary and separate from ClearTill product access. The survey introduction must explain what participation involves, which responses are optional, whether free text is collected, how to withdraw before anonymisation and how incentives operate. Consent to participate, any consent to recontact and any marketing permission must be separate choices. Do not bundle research participation with product terms or treat calculator use as consent.

## Candidate survey questions

Final wording, answer order and routing require specialist review and pilot testing. Candidate topics include:

1. UK nation/region and broad demographic quota questions.
2. Main income pattern: weekly, fortnightly, four-weekly, monthly, irregular/no fixed pattern, or another pattern.
3. Date of the most recent main income and expected next reliable income date, collected as derived bands where possible rather than exact personally revealing dates.
4. Number of calendar days until the next reliable income date.
5. Number of known bills due before that date, using bands.
6. Approximate amount expected to remain after those commitments, using non-overlapping bands including “less than £0”, “£0–£49.99”, “£50–£99.99”, higher bands, “not sure” and “prefer not to say”.
7. Point in the pay cycle when financial pressure usually feels highest.
8. A clearly defined pressure scale, for example 0–10, with labelled endpoints.
9. Frequency of checking a bank balance.
10. Frequency of checking upcoming bills or direct debits.
11. Whether a bill or committed cost was overlooked in the previous three months.
12. Current planning method: memory, paper, spreadsheet, manual app, bank-connected app, bank tools, another method or no method.
13. Preference for manual versus bank-connected tools, with balanced answer wording and an option for no preference.
14. Reasons for that preference, including convenience, automation, control, privacy, account support and effort.
15. Whether income amount or timing varies, and how often.
16. Whether the respondent manages money across cash, multiple accounts or shared household bills.
17. Optional broad household/income bands only where necessary for planned analysis.

Avoid questions asking for account numbers, bank login details, transaction exports, exact addresses, employer names, creditor names, free-form bill descriptions or raw financial records. Minimise free text and warn respondents not to include names or identifying information where it is genuinely necessary.

## Candidate metric definitions

All metrics are proposals, not findings.

- **Bills due before next income:** count reported by a respondent within the interval starting on the survey completion date and ending immediately before the next reliable income arrives.
- **Less than £100 after commitments:** proportion of valid respondents whose selected remaining-amount band is below £100, with “not sure” and “prefer not to say” excluded from the denominator and disclosed.
- **Pay-cycle pressure point:** distribution of the respondent-selected interval or normalised cycle position associated with the highest reported pressure.
- **Income pattern:** mutually exclusive main pattern selected from weekly, fortnightly, four-weekly, monthly, irregular/no fixed pattern and other.
- **Balance-check frequency:** ordered category from more than once daily through never, using a defined reference period.
- **Planning preference:** manual, bank-connected, mixed, no preference or unsure, based on neutral definitions shown before the question.
- **Valid completed response:** a submitted response meeting age/location, completion, quality, uniqueness and survey-routing criteria defined before fieldwork.

Definitions, denominators, missing-data treatment, rounding, any weighting and whether a metric was specified before analysis must appear in the analysis plan and published methodology.

## Inclusion and exclusion criteria

Include respondents who:

- are aged 18 or over;
- confirm they currently live in the United Kingdom;
- complete all mandatory routed questions;
- pass pre-defined attention and consistency checks;
- meet the unique-response rules; and
- fall within the recorded fieldwork period and approved recruitment sources.

Exclude responses that:

- are incomplete beyond the pre-defined threshold;
- fail eligibility or quality checks;
- are duplicates under the approved duplicate procedure;
- show implausibly fast completion based on a pilot-derived threshold;
- contain impossible or contradictory routed answers that cannot be resolved under pre-defined rules;
- originate from test, staff or supplier QA accounts; or
- were obtained after a quota was closed, if the panel contract and analysis plan specify exclusion.

Do not create exclusion rules after viewing results merely because responses are inconvenient.

## Duplicate-response handling

The panel provider should enforce one valid completion per panel member and document its fraud controls. GMBF Ventures Ltd should receive a provider-generated pseudonymous response identifier, not direct identity data, where possible.

Before analysis, identify duplicates using the provider identifier, survey completion token and conservative technical signals approved in the data-protection review. Do not use invasive fingerprinting. Retain the earliest valid complete response unless the pre-registered rule specifies another treatment. Record counts and reasons for removed duplicates in the QA log and methodology.

## Methodology disclosure

Any publication must state:

- commissioning and research organisations;
- target population and eligibility;
- recruitment and incentive method;
- achieved valid sample size;
- fieldwork dates;
- quota and weighting variables, targets and achieved distributions;
- question wording relevant to every reported metric;
- completion, exclusion, duplicate and missing-data rules;
- rounding and denominator conventions;
- small-cell threshold;
- whether results are weighted or unweighted;
- material questionnaire or analysis changes;
- limitations and the non-causal, self-reported nature of findings; and
- a contact for methodology questions.

## Sample limitations

An online panel is not automatically representative of every UK adult. Coverage, self-selection, recall, non-response, question interpretation and panel conditioning may affect results. Quotas or weighting can improve alignment on selected characteristics but cannot remove every bias. Subgroup comparisons have greater uncertainty, especially after weighting or multiple comparisons.

The minimum sample thresholds below are internal editorial safeguards. They are not a guarantee of statistical representativeness, a substitute for research design, or a legal rule.

## Effective anonymisation requirements

Design collection so the research dataset contains no direct identifiers unless strictly necessary for panel administration and held separately by the provider. GMBF Ventures Ltd should receive the minimum fields required for the approved analysis.

Before internal sharing or publication:

- remove direct identifiers and unnecessary metadata;
- generalise dates, locations, ages, income and financial values into approved bands;
- review combinations of characteristics that could single someone out;
- remove or redact identifying free text;
- separate any recontact permissions and contact details from survey answers;
- restrict access to named analysts under least-privilege controls;
- assess singling-out, linkability and inference risk in the release context; and
- document the anonymisation decision and residual risk.

Calling data “anonymous” requires an effective anonymisation review; simply removing names or replacing them with IDs is not enough.

## Small-cell suppression

Do not publish a subgroup result based on fewer than 50 valid respondents. Suppress tables or combine pre-approved categories where a cell is below 50. Also suppress complementary cells where their publication would allow a small cell to be calculated by subtraction.

Review percentages based on exactly or just over 50 respondents for misleading precision. Use whole percentages by default, disclose bases and avoid league-table framing for fragile comparisons.

## Privacy notice requirements

The participant privacy notice must be available before participation and explain:

- identity and contact details of the controller(s) and relevant processors;
- purpose of the research and intended publication;
- categories of data collected;
- source of participants and role of the panel provider;
- lawful basis or bases, subject to formal review;
- whether any special-category data is collected and the applicable condition;
- recipients and international transfers;
- retention periods or decision criteria;
- automated decision-making, if any;
- participant rights and how to exercise them;
- complaint route, including the ICO; and
- the distinction between anonymised published aggregates and retained research records.

Survey copy must be consistent with the privacy notice and must not imply that participation affects access to ClearTill.

## Lawful-basis review

Before procurement or collection, obtain a documented UK data-protection review covering controller/processor roles, Article 6 lawful basis, any special-category conditions, transparency, necessity, proportionality, data minimisation, rights handling, processor terms and international transfers.

Do not assume that survey participation consent is automatically the appropriate UK GDPR lawful basis for every processing operation. If consent is relied on, it must meet the applicable standard and withdrawal consequences must be clear. Consider whether a data protection impact assessment is required and record the decision.

This specification is not legal advice. A suitably qualified privacy professional must approve the final approach.

## Retention and deletion plan

Set periods before fieldwork and reflect them in contracts and notices. Proposed starting points for review:

- direct panel contact and incentive data: held by the provider only for the shortest operational period;
- raw response export: restricted analysis workspace and deleted within six months of final publication or a documented no-publication decision;
- cleaned pseudonymous analysis dataset: deleted or irreversibly anonymised within 12 months of publication;
- anonymised aggregate tables, questionnaire, codebook, methodology, QA log and approval record: retained as the evidence base for the published report;
- backups: expire under documented backup schedules; and
- deletion requests: handled according to legal obligations and the stage at which data has been effectively anonymised.

Record deletion completion and require equivalent processor deletion or return.

## Quality assurance

1. Pre-register the research questions, candidate metrics, exclusions, weighting and main subgroup comparisons internally before fieldwork closes.
2. Review questionnaire wording for balance, accessibility, routing, leading language and unnecessary data collection.
3. Pilot and document changes before the main launch.
4. Freeze and version the cleaned dataset and analysis code.
5. Reconcile all bases, weights, exclusions and duplicate counts.
6. Independently reproduce headline arithmetic from the frozen dataset.
7. Check every chart against its source table and question wording.
8. Review claims for causal overreach, denominator changes, false precision and omitted limitations.
9. Confirm that no chart, table, example or quote can identify a respondent.
10. Archive an approval pack containing the questionnaire, codebook, methodology, QA results and sign-offs.

## Publication approval gate

Publication is prohibited unless all of the following are true:

- at least 500 valid, unique completed responses are available;
- fieldwork dates are recorded;
- a full methodology is ready to publish with the report;
- no subgroup result is based on fewer than 50 respondents;
- no raw individual financial records appear in public assets;
- an effective anonymisation review is complete;
- privacy and lawful-basis review is complete;
- arithmetic and presentation have been independently checked;
- limitations and denominators are explicit;
- no statement implies representativeness beyond what the design supports; and
- the founder has given explicit final approval.

Failure of any gate means no public route, press release, outreach or partial findings. The founder may impose stricter gates.

## Ownership and approval gates

- **Research owner:** a named GMBF Ventures Ltd research lead maintains the questionnaire, codebook, fieldwork record and analysis plan.
- **Data-governance owner:** a named privacy lead approves notices, contracts, access, retention and anonymisation.
- **Editorial owner:** a named editor checks every public claim against an approved table and methodology note.
- **Independent checker:** a person other than the primary analyst reproduces headline arithmetic and chart bases.
- **Final approver:** the founder gives explicit written approval only after the research, privacy, statistical and editorial gates are signed off.

No owner may waive another owner's control silently. Unresolved disagreements, material post-fieldwork changes or failed QA return the work to review and keep the route unpublished.

## Update cadence

Treat 2026 as a proposed edition, not an automatic annual series. After publication, review corrections and material context changes at least quarterly for the first year. Repeat fieldwork only when there is a defensible editorial question, budget for equivalent governance and a method that permits honest comparison. Never label changing methods as a trend without explaining the break.

## Proposed future public structure

Only after approval, the reserved route could contain:

1. plain-language headline findings;
2. sample and fieldwork summary adjacent to those findings;
3. charts with bases and accessible text alternatives;
4. complete methodology and questionnaire;
5. limitations;
6. definitions and downloadable aggregate tables where disclosure-safe;
7. ClearTill's interpretation clearly separated from measured results; and
8. contact details for corrections and methodology questions.

The future page should use `Dataset` or report/article structured data only if it accurately represents published content and source files. It must not contain ratings, usage numbers or claims not supported by the approved dataset.

## Publication checklist

- Every headline, percentage and comparison maps to an approved table, base and question.
- The valid sample, fieldwork dates, recruitment method, weighting and exclusions are visible.
- Limitations appear beside the claims they materially qualify.
- Tables, chart alternatives and downloads pass accessibility and disclosure review.
- Small cells and complementary cells are suppressed under the approved rules.
- Legal, privacy, research-methods, independent arithmetic and founder approvals are recorded.
- Press materials, social copy and outreach emails use the same approved numbers and caveats.
- A corrections contact, version date and correction process are published.
- The reserved route remains absent until every mandatory gate is complete.

## Outreach angles once evidence exists

Subject to the results and approval gate, possible angles include:

- how bill timing relates to reported pressure before the next income date;
- differences between weekly, fortnightly, four-weekly, monthly and irregular pay patterns;
- how often respondents check a balance versus upcoming commitments;
- the gap between a visible balance and reported money remaining after commitments;
- consumer preferences for manual, connected and mixed budgeting methods; and
- practical implications for employers, payroll teams and money-guidance content.

No angle should be pre-written as a finding. Outreach must use the actual approved data, disclose the base and methodology, avoid stigmatising people under financial pressure and offer meaningful caveats alongside headline numbers.

## Backlink, outreach and press-use plan

Create outreach only after evidence and claims are approved. Prepare a concise methodology page, disclosure-safe aggregate tables, accessible charts and a journalist note that makes bases, fieldwork dates and limitations easy to verify. Prioritise relevant consumer-finance, employment, payroll and money-guidance contacts; do not mass-send unrelated outlets or trade links for coverage.

Press materials may offer approved charts, methodology contacts and plain-language definitions. They must not imply endorsement by quoted organisations, turn correlations into causes, cherry-pick fragile subgroups or omit caveats to make a stronger headline. Any supplied quote must be clearly attributed as ClearTill interpretation rather than a research finding.

Backlinks are a possible consequence of genuinely useful, verifiable work, not a promised result or publication criterion. Do not pay for undisclosed editorial links, make coverage contingent on a backlink or describe outreach projections as achieved coverage.

Publishing unsupported statistics, illustrative percentages presented as findings, or claims that cannot be traced to the frozen approved analysis is prohibited. Exposing the reserved route, a placeholder page, a Journal card or a â€œcoming soonâ€ message before approved evidence exists is also prohibited.
