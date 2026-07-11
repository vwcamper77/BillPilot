const TRACKER_CHECKS = [
  { label: "Energy", key: "energy", keywords: ["energy", "gas", "electric", "electricity", "octopus", "british gas", "eon", "e.on", "ovo", "bulb", "shell energy"] },
  { label: "Water", key: "water", keywords: ["water"] },
  { label: "Wastewater", key: "wastewater", keywords: ["wastewater", "waste water", "sewerage", "sewage"] },
  { label: "Council tax", key: "council_tax", keywords: ["council tax"] },
  { label: "Broadband", key: "broadband", keywords: ["broadband", "internet", "fibre", "sky", "virgin", "bt", "plusnet", "talktalk"] },
  { label: "Mobile", key: "mobile", keywords: ["mobile", "phone", "o2", "vodafone", "ee", "three", "giffgaff"] },
  { label: "Home insurance", key: "home_insurance", keywords: ["home insurance", "contents insurance", "buildings insurance", "aviva", "direct line", "admiral", "churchill", "compare the market"] },
  { label: "Rent / mortgage", key: "rent_mortgage", keywords: ["rent", "mortgage", "landlord", "letting agent", "halifax", "nationwide", "santander mortgage", "barclays mortgage"] },
];

function normaliseTrackerText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function trackerBillMatch(billName, keywords) {
  const text = ` ${normaliseTrackerText(billName)} `;
  if (!text.trim()) {
    return false;
  }

  return keywords.some((keyword) => {
    const normalisedKeyword = normaliseTrackerText(keyword);
    if (!normalisedKeyword) {
      return false;
    }

    return text.includes(` ${normalisedKeyword} `);
  });
}

export function buildTrackerChecks(bills) {
  const activeBills = (bills || []).filter((bill) => bill?.active !== false);

  return TRACKER_CHECKS.map((check) => {
    const matchedBill = activeBills.find((bill) => trackerBillMatch(bill?.name, check.keywords));
    return {
      ...check,
      found: Boolean(matchedBill),
      matchedBillName: matchedBill?.name || "",
    };
  });
}

export default function UtilitiesTracker({ bills, onAddMissingUtility }) {
  const checks = buildTrackerChecks(bills);
  const missingChecks = checks.filter((check) => !check.found);

  return (
    <div className="tracker-card">
      <h3>🏠 Household utilities tracker</h3>
      <p className="tracker-sub">ClearTill checks whether the main household bills are in your forecast.</p>
      <div className="tracker-grid">
        {checks.map((check) => (
          <div key={check.key} className={`tracker-row ${check.found ? "tracker-added" : "tracker-missing"}`}>
            <div className="tracker-row-main">
              <span className="tracker-state" aria-hidden="true">{check.found ? "✓" : null}</span>
              <div className="tracker-copy">
                <span className="tracker-label">{check.label}</span>
                <span className="tracker-note">{check.found ? "Added to forecast" : "Missing from forecast"}</span>
              </div>
            </div>
            {!check.found ? (
              <button
                className="tracker-inline-action"
                type="button"
                onClick={() => onAddMissingUtility?.(check)}
              >
                Add
              </button>
            ) : null}
          </div>
        ))}
      </div>
      {missingChecks.length ? (
        <button
          className="tracker-action"
          type="button"
          onClick={() => onAddMissingUtility?.(missingChecks[0])}
        >
          Add missing utility
        </button>
      ) : null}
    </div>
  );
}
