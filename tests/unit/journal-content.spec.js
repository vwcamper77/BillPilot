import { expect, test } from "@playwright/test";
import {
  BLOG_POSTS,
  JOURNAL_TOOLS,
  validateJournalArticle,
  validateJournalContent,
  validateJournalTool,
} from "../../app/blog/posts.js";

test("approved Journal article and tool records pass validation", () => {
  expect(validateJournalContent()).toBe(true);
  expect(BLOG_POSTS.every((record) => record.type === "article")).toBe(true);
  expect(JOURNAL_TOOLS.every((record) => record.type === "tool")).toBe(true);
});

test("article validation rejects the wrong discriminator and missing article metadata", () => {
  expect(() => validateJournalArticle({ ...BLOG_POSTS[0], type: "guide" })).toThrow(/type "article"/);
  const { readingMinutes, ...withoutReadingTime } = BLOG_POSTS[0];
  expect(() => validateJournalArticle(withoutReadingTime)).toThrow(/readingMinutes/);
});

test("tool validation does not require article fields and rejects them if fabricated", () => {
  expect(validateJournalTool(JOURNAL_TOOLS[0])).toBe(JOURNAL_TOOLS[0]);
  expect(() => validateJournalTool({ ...JOURNAL_TOOLS[0], readingMinutes: 4 })).toThrow(/article-only field readingMinutes/);
  expect(() => validateJournalTool({ ...JOURNAL_TOOLS[0], publishedAt: "2026-07-18" })).toThrow(/article-only field publishedAt/);
});

test("Journal validation rejects duplicate slugs across content types", () => {
  const duplicateTool = { ...JOURNAL_TOOLS[0], slug: BLOG_POSTS[0].slug };
  expect(() => validateJournalContent(BLOG_POSTS, [duplicateTool])).toThrow(/slugs must be unique/);
});
