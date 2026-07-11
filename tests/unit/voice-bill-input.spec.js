import { test, expect } from "@playwright/test";
import { normaliseVoiceBillText } from "../../app/dashboard/lib/billHelpers.js";

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
});
