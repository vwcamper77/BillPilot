import { test, expect } from "@playwright/test";
import {
  buildBillReviewDraft,
  classifyBill,
  normaliseVoiceBillText,
} from "../../app/dashboard/lib/billHelpers.js";

test.describe("normaliseVoiceBillText", () => {
  test("corrects common Council Tax speech-recognition mistakes", () => {
    expect(normaliseVoiceBillText("my cancer tax is £181 on the first"))
      .toBe("my Council Tax is £181 on the first");
    expect(normaliseVoiceBillText("counsel tacks £120 due on the 2nd"))
      .toBe("Council Tax £120 due on the 2nd");
    expect(normaliseVoiceBillText("cance tacx is £99"))
      .toBe("Council Tax is £99");
  });

  test("leaves unrelated bill speech unchanged", () => {
    expect(normaliseVoiceBillText("my broadband is £35 on the 15th"))
      .toBe("my broadband is £35 on the 15th");
  });

  test("corrects common wastewater and home-insurance misspellings", () => {
    expect(normaliseVoiceBillText("waterwater is £42 on the 8th"))
      .toBe("Wastewater is £42 on the 8th");
    expect(normaliseVoiceBillText("Home Insurteqnce £25 monthly"))
      .toBe("Home insurance £25 monthly");
  });

  test("classifies corrected utility names without exact typing", () => {
    expect(classifyBill({ name: "waterwater" }).subCategory).toBe("wastewater");
    expect(classifyBill({ name: "Home Insurteqnce" }).subCategory).toBe("home_insurance");
    expect(classifyBill({ name: "Waste water from Affinity Water" }).subCategory).toBe("wastewater");
    expect(normaliseVoiceBillText("insuayrnasce")).toBe("insurance");
  });

  test("keeps the selected Smart Add utility subtype through review", () => {
    const draft = buildBillReviewDraft({
      action: "create_bill",
      name: "Finte and Affinity Water",
      amount: 60,
      dueDay: 16,
    }, {
      sourceText: "Waste water from Finte and Affinity Water",
      quickAddContext: {
        name: "Wastewater",
        category: "household",
        subCategory: "wastewater",
      },
    });

    expect(draft.subCategory).toBe("wastewater");
  });
});
