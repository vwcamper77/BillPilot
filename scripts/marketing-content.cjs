#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  MARKETING_ROOT,
  channelDraft,
  getContentById,
  loadCalendar,
  validateMarketingSystem,
} = require("../lib/marketing/content");
const { buildCampaignUrl } = require("../lib/marketing/utm");
const { BufferPublisher } = require("../lib/marketing/publishers/BufferPublisher");
const { SubmissionStore } = require("../lib/marketing/submissionStore");
const { JournalAdapter } = require("../lib/marketing/JournalAdapter");

function args(argv) {
  const result = { _: [] };
  for (const item of argv) {
    if (!item.startsWith("--")) result._.push(item);
    else {
      const [key, ...rest] = item.slice(2).split("=");
      result[key] = rest.length ? rest.join("=") : true;
    }
  }
  return result;
}

function output(value) { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); }
function requireFlag(flags, name) {
  const value = String(flags[name] || "").trim();
  if (!value) throw new Error(`Missing --${name}=<value>.`);
  return value;
}
function postAndChannel(flags) {
  const post = getContentById(requireFlag(flags, "id"));
  if (!post) throw new Error(`Unknown content ID: ${flags.id}.`);
  const channel = String(flags.channel || "linkedin").toLowerCase();
  return { post, channel, draft: channelDraft(post, channel) };
}
function publisher(flags) { return new BufferPublisher({ dryRun: flags["dry-run"] === true }); }

async function main() {
  const flags = args(process.argv.slice(2));
  const command = flags._[0];
  if (command === "validate") {
    const result = validateMarketingSystem();
    output(result);
    if (!result.valid) process.exitCode = 1;
    return;
  }
  if (command === "calendar") {
    const calendar = loadCalendar();
    output({ timezone: calendar.timezone, period: calendar.period, posts: calendar.posts.map(({ id, date, messageVariant, contentPillar, status }) => ({ id, date, messageVariant, contentPillar, status })) });
    return;
  }
  if (command === "generate") {
    const week = Number(requireFlag(flags, "week"));
    if (!Number.isInteger(week) || week < 1 || week > 4) throw new Error("--week must be an integer from 1 to 4.");
    const starts = ["2026-07-20", "2026-07-27", "2026-08-03", "2026-08-10"];
    const posts = loadCalendar().posts.filter((post) => {
      const delta = Math.floor((Date.parse(post.date.slice(0, 10)) - Date.parse(starts[0])) / 86400000);
      return Math.floor(delta / 7) + 1 === week;
    });
    const generated = posts.flatMap((post) => ["linkedin", "facebook", "instagram"]
      .filter((channel) => post.channels?.[channel]?.enabled !== false)
      .map((channel) => channelDraft(post, channel)));
    const destination = path.join(MARKETING_ROOT, `drafts/social/week-${week}.json`);
    fs.writeFileSync(destination, `${JSON.stringify({ week, status: "draft", generated }, null, 2)}\n`);
    output({ ok: true, destination: path.relative(process.cwd(), destination), drafts: generated.length });
    return;
  }
  if (command === "repurpose") {
    const slug = requireFlag(flags, "slug");
    const source = fs.readFileSync(path.resolve(__dirname, "../app/blog/posts.js"), "utf8");
    const marker = `slug: "${slug}"`;
    const slugIndex = source.indexOf(marker);
    if (slugIndex < 0) throw new Error(`Unknown Journal slug: ${slug}.`);
    const nextRecord = source.indexOf("\n  {\n    type:", slugIndex + marker.length);
    const block = source.slice(slugIndex, nextRecord < 0 ? source.length : nextRecord);
    const field = (name) => block.match(new RegExp(`\\n\\s*${name}: \\"([^\\"]+)\\"`))?.[1] || "";
    const article = { type: "article", slug, title: field("title"), description: field("description"), takeaway: field("takeaway") };
    const record = new JournalAdapter().repurpose(article);
    const destination = path.join(MARKETING_ROOT, `drafts/journal/${slug}.json`);
    fs.writeFileSync(destination, `${JSON.stringify(record, null, 2)}\n`);
    output({ ok: true, destination: path.relative(process.cwd(), destination), status: record.status });
    return;
  }
  if (command === "utm") {
    const { post, channel } = postAndChannel(flags);
    output({ contentId: post.id, channel, url: buildCampaignUrl({ landingPath: post.landingPath, utm: post.utm, channel }) });
    return;
  }
  if (command === "buffer:channels") {
    output(await publisher(flags).listChannels());
    return;
  }
  if (command === "buffer:payload") {
    const { draft } = postAndChannel(flags);
    output(publisher(flags).buildCreatePostPayload(draft, { draft: true }));
    return;
  }
  if (command === "buffer:draft") {
    const { draft } = postAndChannel(flags);
    output(await publisher(flags).createDraft(draft));
    return;
  }
  if (command === "buffer:update-draft") {
    const { post, channel, draft } = postAndChannel(flags);
    const store = new SubmissionStore(path.join(MARKETING_ROOT, "published/submissions.json"));
    const submission = store.find(post.id, channel, "draft");
    if (!submission) throw new Error(`No Buffer draft recorded for ${post.id} on ${channel}.`);
    output(await publisher(flags).updateDraft(draft, submission.remotePostId));
    return;
  }
  if (command === "buffer:delete-draft") {
    const { post, channel } = postAndChannel(flags);
    const store = new SubmissionStore(path.join(MARKETING_ROOT, "published/submissions.json"));
    const submission = store.find(post.id, channel, "draft");
    if (!submission) throw new Error(`No Buffer draft recorded for ${post.id} on ${channel}.`);
    const result = await publisher(flags).deleteDraft(submission.remotePostId, { confirmDelete: flags["confirm-delete"] === true });
    store.remove(post.id, channel, "draft");
    output(result);
    return;
  }
  if (command === "buffer:schedule") {
    const { post, draft } = postAndChannel(flags);
    output(await publisher(flags).schedulePost(draft, flags["due-at"] || post.date, { confirmPublish: flags["confirm-publish"] === true }));
    return;
  }
  if (command === "buffer:status") {
    const { post, channel } = postAndChannel(flags);
    const store = new SubmissionStore(path.join(MARKETING_ROOT, "published/submissions.json"));
    const submission = store.find(post.id, channel, "scheduled") || store.find(post.id, channel, "draft");
    if (!submission) throw new Error(`No Buffer submission recorded for ${post.id} on ${channel}.`);
    const client = publisher(flags);
    output({ submission, post: await client.getPost(submission.remotePostId), metrics: await client.getPostMetrics(submission.remotePostId) });
    return;
  }
  if (command === "report") {
    const week = Number(requireFlag(flags, "week"));
    const calendar = loadCalendar();
    const weekStart = Date.parse(["2026-07-20", "2026-07-27", "2026-08-03", "2026-08-10"][week - 1] || "invalid");
    if (!Number.isFinite(weekStart)) throw new Error("--week must be an integer from 1 to 4.");
    const posts = calendar.posts.filter((post) => Date.parse(post.date) >= weekStart && Date.parse(post.date) < weekStart + 7 * 86400000);
    output({ week, posts: posts.map((post) => ({ id: post.id, variant: post.messageVariant, results: post.results, decision: post.decision })) });
    return;
  }
  throw new Error("Unknown command. Use validate, calendar, generate, repurpose, utm, buffer:channels, buffer:payload, buffer:draft, buffer:update-draft, buffer:delete-draft, buffer:schedule, buffer:status or report.");
}

main().catch((error) => {
  const safe = typeof error?.toJSON === "function" ? error.toJSON() : { ok: false, error: { code: error?.code || "CONTENT_COMMAND_ERROR", message: error?.message || "Marketing command failed." } };
  process.stderr.write(`${JSON.stringify(safe, null, 2)}\n`);
  process.exitCode = 1;
});
