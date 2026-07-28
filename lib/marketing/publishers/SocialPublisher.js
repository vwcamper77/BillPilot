"use strict";

class SocialPublisher {
  async listChannels() { throw new Error("listChannels() must be implemented by a social publisher."); }
  async createDraft() { throw new Error("createDraft(content) must be implemented by a social publisher."); }
  async schedulePost() { throw new Error("schedulePost(content, dueAt) must be implemented by a social publisher."); }
  async getPost() { throw new Error("getPost(postId) must be implemented by a social publisher."); }
  async getPostMetrics() { throw new Error("getPostMetrics(postId) must be implemented by a social publisher."); }
}

module.exports = { SocialPublisher };
