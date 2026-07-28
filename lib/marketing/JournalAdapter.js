"use strict";

class JournalAdapter {
  constructor({ primaryCta = "Check my position free", landingPath = "/start" } = {}) {
    this.primaryCta = primaryCta;
    this.landingPath = landingPath;
  }

  repurpose(article) {
    if (!article || article.type !== "article" || !article.slug || !article.title || !article.description) {
      throw new Error("Journal adapter requires an approved article with slug, title and description.");
    }
    const base = `${article.title}\n\n${article.description}`;
    return {
      sourceType: "journal_article",
      sourceSlug: article.slug,
      sourceOrRationale: `Repurposed from approved Journal article: ${article.slug}.`,
      status: "draft",
      claimsChecked: false,
      productFactsChecked: false,
      CTA: this.primaryCta,
      landingPath: this.landingPath,
      channels: {
        linkedin: { text: `${base}\n\n${this.primaryCta}:` },
        facebook: { text: `${article.description}\n\nRead the full ClearTill Journal guide, then ${this.primaryCta.toLowerCase()}:` },
        instagram: { text: `${article.title}\n\n${article.takeaway || article.description}\n\nRead the Journal guide via the link.` },
      },
    };
  }
}

module.exports = { JournalAdapter };
