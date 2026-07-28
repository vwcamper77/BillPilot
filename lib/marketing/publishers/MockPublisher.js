"use strict";

const { SocialPublisher } = require("./SocialPublisher");

class MockPublisher extends SocialPublisher {
  constructor({ channels = [], now = () => new Date() } = {}) {
    super();
    this.channels = channels;
    this.now = now;
    this.posts = new Map();
    this.calls = [];
  }

  async listChannels() {
    this.calls.push({ method: "listChannels" });
    return this.channels;
  }

  async createDraft(content) {
    return this.#create(content, { mode: "draft", dueAt: null });
  }

  async schedulePost(content, dueAt) {
    return this.#create(content, { mode: "scheduled", dueAt: new Date(dueAt).toISOString() });
  }

  async getPost(postId) {
    this.calls.push({ method: "getPost", postId });
    return this.posts.get(postId) || null;
  }

  async getPostMetrics(postId) {
    this.calls.push({ method: "getPostMetrics", postId });
    const post = this.posts.get(postId);
    return post ? { postId, metrics: post.metrics || [], metricsUpdatedAt: null } : null;
  }

  #create(content, { mode, dueAt }) {
    const id = `mock_${this.posts.size + 1}`;
    const post = { id, status: mode, dueAt, content, createdAt: this.now().toISOString(), metrics: [] };
    this.calls.push({ method: mode === "draft" ? "createDraft" : "schedulePost", content, dueAt });
    this.posts.set(id, post);
    return Promise.resolve(post);
  }
}

module.exports = { MockPublisher };
