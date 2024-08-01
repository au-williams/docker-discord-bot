import { getTruncatedStringTerminatedByChar } from "../helpers/utilities.js";

export default class CachedLinkData {
  constructor({
    authorName,
    endTime,
    id,
    linkWithoutParameters,
    segments,
    title
   }) {
    this.authorName = authorName;
    this.endTime = endTime;
    this.id = id;
    this.linkWithoutParameters = linkWithoutParameters;
    this.segments = segments;
    this.threadChannelName = getTruncatedStringTerminatedByChar(`📲 ${title}`, 100);
    this.title = title;
  }
}