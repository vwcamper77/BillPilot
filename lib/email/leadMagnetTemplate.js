export function buildLeadMagnetEmail({ landingPageUrl, spreadsheetUrl, guideUrl }) {
  const subject = "Your ClearTill cash-position worksheet and guide";
  const text = [
    "Your free ClearTill cash-position resources are ready.",
    "",
    `Download the spreadsheet: ${spreadsheetUrl}`,
    `Read the Bank Balance Reset guide: ${guideUrl}`,
    `See how to use them: ${landingPageUrl}`,
    "",
    "The worksheet is manual and covers one payday cycle. ClearTill can carry recurring bills forward, provide reminders and keep your position live.",
    "",
    "ClearTill is a product from GMBF Ventures Ltd.",
    "Support: hello@cleartill.money",
    `Privacy: ${new URL("/privacy", landingPageUrl)}`,
  ].join("\n");

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;color:#183038">
      <p style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#26735f;margin:0 0 12px">ClearTill</p>
      <h1 style="font-size:24px;line-height:1.2;margin:0 0 16px">Your cash-position worksheet and guide are ready</h1>
      <p style="font-size:16px;line-height:1.6">Use the links below whenever you are ready.</p>
      <p><a href="${spreadsheetUrl}" style="display:inline-block;background:#153c3a;color:#fff;text-decoration:none;padding:13px 18px;border-radius:999px;font-weight:700">Download the spreadsheet</a></p>
      <p style="line-height:1.8"><a href="${guideUrl}" style="color:#176b55">Read the Bank Balance Reset guide</a><br><a href="${landingPageUrl}" style="color:#176b55">See how to use the worksheet</a></p>
      <p style="font-size:14px;line-height:1.6;color:#65777b">The worksheet is manual and covers one payday cycle. ClearTill can carry recurring bills forward, provide reminders and keep your position live.</p>
      <hr style="border:0;border-top:1px solid #dce5e3;margin:24px 0">
      <p style="font-size:12px;line-height:1.6;color:#65777b">ClearTill is a product from GMBF Ventures Ltd. Questions? <a href="mailto:hello@cleartill.money" style="color:#176b55">Contact support</a>. Read our <a href="${new URL("/privacy", landingPageUrl)}" style="color:#176b55">Privacy Policy</a>.</p>
    </div>
  `.trim();

  return { subject, text, html };
}
