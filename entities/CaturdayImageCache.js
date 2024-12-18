/**
 *
 */
export default class CaturdayImageCache {
  /**
   *
   */
  constructor({ attachmentUrl, message, messageId, userId } = {}) {
    this.attachmentUrl = attachmentUrl;
    this.messageId = message?.id || messageId;
    this.userId = userId;
  }
}
