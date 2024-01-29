export default class LinkData {
  /**
   * @param {Object} param
   * @param {string} param.endTime YouTubeDL `%(duration)s` in HH:MM:SS format
   * @param {string} param.id YouTubeDL `%(id)s`
   * @param {Object[]} param.segments SponsorBlock segments
   */
  constructor({ authorName, endTime, id, link, linkWithoutParameters, segments, title }) {
    this.authorName = authorName,
    this.endTime = endTime;
    this.id = id;
    this.link = link;
    this.linkWithoutParameters = linkWithoutParameters;
    this.segments = segments;
    this.title = title;
  }
}