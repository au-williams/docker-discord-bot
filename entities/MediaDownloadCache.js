import AFHConvert from "ascii-fullwidth-halfwidth-convert";
import { Utilities } from "../services/utilities.js";

/**
 *
 */
export default class MediaDownloadCache {
  /**
   *
   */
  constructor({ description, endTime, genre, id, likes, link, messageId, segments, title, uploadDate, uploader, videoFormats, views } = {}) {
    this.chapterIndex = -1;
    this.description = description?.trim();
    this.endTime = endTime?.trim();
    this.genre = parseGenre(description, genre, title, uploader);
    this.id = id?.trim();
    this.likes = likes?.trim();
    this.link = link?.trim();
    this.messageId = messageId;
    this.segments = segments;
    this.startTime = "00:00:00";
    this.title = title?.trim();
    this.uploadDate = uploadDate?.trim();
    this.uploader = uploader?.trim();
    this.videoFormats = videoFormats;
    this.views = views?.trim();
  }

  /**
   * Get an array of chapters from the description.
   * @returns {MediaDownloadCache[]}
   */
  get chapters() {
    const chapterRegex = /(?:\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?)\s+(.+?)(?=\n|$)/g;
    const chapters = [];
    let match;

    // Loop through all matches and extract the timestamp and title
    while ((match = chapterRegex.exec(this.description)) !== null) {
      let [fullMatch, startTime, title] = match;

      title = title.trim();
      if (title.startsWith("- ")) title = title.slice("- ".length);

      const result = new MediaDownloadCache();
      result.description = this.description;
      result.genre = this.genre;
      result.likes = this.likes;
      result.link = this.link;
      result.messageId = this.messageId;
      result.startTime = Utilities.getLongTimestamp(startTime);
      result.title = title;
      result.type = null;
      result.uploadDate = this.uploadDate;
      result.uploader = this.uploader;
      result.videoFormats = this.videoFormats;
      result.views = this.views;
      chapters.push(result);
    }

    // Loop through all chapters and update their end times
    chapters.forEach((chapter, i) => {
      chapter.chapterIndex = i;
      chapter.id = `${this.id}-${i}`; // TODO: is this needed?
      const nextStartTime = chapters[i + 1]?.startTime;

      if (nextStartTime) {
        // set this chapters end time one second before the next chapters start time
        const [hours, minutes, seconds] = nextStartTime.split(":").map(Number);
        const date = new Date();
        date.setHours(hours, minutes, seconds);
        date.setSeconds(date.getSeconds() - 1);
        const newHours = String(date.getHours()).padStart(2, "0");
        const newMinutes = String(date.getMinutes()).padStart(2, "0");
        const newSeconds = String(date.getSeconds()).padStart(2, "0");
        chapter.endTime = `${newHours}:${newMinutes}:${newSeconds}`;
      }
      else {
        // set this chapters end time the medias end time as no next chapter exists
        chapter.endTime = this.endTime;
      }
    });

    return chapters;
  }

  /**
   * Get a clean author based on the author and title properties.
   * @returns {string}
   */
  get cleanUploader() {
    return getCleanUploader(this.uploader);
  }

  /**
   * Get a clean description by replacing unexpected or incorrectly displayed
   * characters with a basic hyphen to simplify its display and processing.
   * @returns {string}
   */
  get cleanDescription() {
    return this.description.replaceAll(" � ", " - ").replaceAll(" • ", " - ");
  }

  /**
   * Get a short-form preview of the clean description text.
   * @returns {string}
   */
  get cleanDescriptionPreview() {
    const cleanDescriptionWithoutEmptyLines = this.cleanDescription?.split("\n").map(item => item.trim()).filter(item => item).join("\n");
    return Utilities.getTruncatedStringTerminatedByWord(cleanDescriptionWithoutEmptyLines, 200);
  }

  /**
   * Get a clean link by removing any unnecessary parameters from it.
   * @returns {string}
   */
  get cleanLink() {
    return Utilities.getLinkWithoutParametersFromString(this.link);
  }

  /**
   * Get a clean title by removing any unnecessary text blurbs from it.
   * @returns {string}
   */
  get cleanTitle() {
    return getCleanTitle(this.title, this.uploader);
  }

  /**
   *
   */
  get trackTitleArtistValues() {
    const firstItem = this.cleanTitle.split(" - ").slice(0, -1).join(" - ").trim();
    const secondItem = this.cleanTitle.split(" - ").splice(-1)[0].trim();
    // Nobody on the internet uses a standardized 'Title - Artist' or 'Artist - Title' format.
    // If what we guess to be the title is the uploader name, return it as the artist instead.
    const formatArtist = item => item.toLowerCase().replaceAll(" ", "").replaceAll("vevo", "");
    const isFirstItemTitle = formatArtist(secondItem).includes(formatArtist(this.uploader));
    const artist = getCleanUploader((isFirstItemTitle ? secondItem : firstItem) || this.uploader);
    const title = getCleanTitle((isFirstItemTitle ? firstItem : secondItem) || this.title, artist);
    return [title, artist];
  }
}

/**
 *
 */
function getCleanTitle(input, artist) {
  input = input.replaceAll(" � ", " - ").replaceAll(" • ", " - ");
  if (input.startsWith(`${artist} - `)) input = input.slice(`${artist} - `.length);
  if (input.endsWith(` by ${artist}`)) input = input.slice(0, -` by ${artist}`.length);
  if (input.toLowerCase().endsWith(" [hq]")) input = input.slice(0, -" [hd]".length);
  if (input.toLowerCase().endsWith(" (hq)")) input = input.slice(0, -" (hd)".length);
  if (input.toLowerCase().endsWith(" [hq]")) input = input.slice(0, -" [hq]".length);
  if (input.toLowerCase().endsWith(" (hq)")) input = input.slice(0, -" (hq)".length);
  if (input.toLowerCase().endsWith(" [mv]")) input = input.slice(0, -" [mv]".length);
  if (input.toLowerCase().endsWith(" (mv)")) input = input.slice(0, -" (mv)".length);
  if (input.toLowerCase().endsWith(" [hd remaster]")) input = input.slice(0, -" [hd remaster]".length);
  if (input.toLowerCase().endsWith(" (hd remaster)")) input = input.slice(0, -" (hd remaster)".length);
  if (input.toLowerCase().endsWith(" [official audio and lyrics]")) input = input.slice(0, -" [official audio and lyrics]".length);
  if (input.toLowerCase().endsWith(" (official audio and lyrics)")) input = input.slice(0, -" (official audio and lyrics)".length);
  if (input.toLowerCase().endsWith(" [official audio visualizer]")) input = input.slice(0, -" [official audio visualizer]".length);
  if (input.toLowerCase().endsWith(" (official audio visualizer)")) input = input.slice(0, -" (official audio visualizer)".length);
  if (input.toLowerCase().endsWith(" [official lyric video]")) input = input.slice(0, -" [official lyric video]".length);
  if (input.toLowerCase().endsWith(" (official lyric video)")) input = input.slice(0, -" (official lyric video)".length);
  if (input.toLowerCase().endsWith(" [official music video]")) input = input.slice(0, -" [official music video]".length);
  if (input.toLowerCase().endsWith(" (official music video)")) input = input.slice(0, -" (official music video)".length);
  if (input.toLowerCase().endsWith(" [official visualizer]")) input = input.slice(0, -" [official visualizer]".length);
  if (input.toLowerCase().endsWith(" (official visualizer)")) input = input.slice(0, -" (official visualizer)".length);
  if (input.toLowerCase().endsWith(" [audio visualizer]")) input = input.slice(0, -" [audio visualizer]".length);
  if (input.toLowerCase().endsWith(" (audio visualizer)")) input = input.slice(0, -" (audio visualizer)".length);
  if (input.toLowerCase().endsWith(" [official video]")) input = input.slice(0, -" [official video]".length);
  if (input.toLowerCase().endsWith(" (official video)")) input = input.slice(0, -" (official video)".length);
  if (input.toLowerCase().endsWith(" [official audio]")) input = input.slice(0, -" [official audio]".length);
  if (input.toLowerCase().endsWith(" (official audio)")) input = input.slice(0, -" (official audio)".length);
  if (input.toLowerCase().endsWith(" [music video]")) input = input.slice(0, -" [music video]".length);
  if (input.toLowerCase().endsWith(" (music video)")) input = input.slice(0, -" (music video)".length);
  if (input.toLowerCase().endsWith(" [lyric video]")) input = input.slice(0, -" [lyric video]".length);
  if (input.toLowerCase().endsWith(" (lyric video)")) input = input.slice(0, -" (lyric video)".length);
  if (input.toLowerCase().endsWith(" [visualizer]")) input = input.slice(0, -" [visualizer]".length);
  if (input.toLowerCase().endsWith(" (visualizer)")) input = input.slice(0, -" (visualizer)".length);
  if (input.toLowerCase().endsWith(" [official]")) input = input.slice(0, -" [official]".length);
  if (input.toLowerCase().endsWith(" (official)")) input = input.slice(0, -" (official)".length);
  if (input.toLowerCase().endsWith(" [lyrics]")) input = input.slice(0, -" [lyrics]".length);
  if (input.toLowerCase().endsWith(" (lyrics)")) input = input.slice(0, -" (lyrics)".length);
  if (input.toLowerCase().endsWith(" [audio]")) input = input.slice(0, -" [audio]".length);
  if (input.toLowerCase().endsWith(" (audio)")) input = input.slice(0, -" (audio)".length);
  if (input.toLowerCase().endsWith(" lyrics")) input = input.slice(0, -" lyrics".length);
  return new AFHConvert().toHalfWidth(input = input.trim());
}

/**
 *
 */
function getCleanUploader(input) {
  if (input.endsWith(" - Topic")) input = input.slice(0, -" - Topic".length);
  return new AFHConvert().toHalfWidth(input.trim());
}

/**
 *
 */
function mapGenre(input) {
  if (!input) return null;

  const cleanedInput = input
    .replaceAll("-", "")
    .replaceAll("'", "")
    .replaceAll("/", "")
    .replaceAll(" ", "")
    .toLowerCase();

  const inputIncludes = term => cleanedInput.includes(term);

  switch(true) {
    case (inputIncludes("lofi")): return "Lo-Fi";
    case (inputIncludes("punkrock")): return "Punk Rock";
    case (inputIncludes("punk")): return "Punk";
    case (inputIncludes("folk")): return "Folk";
    case (inputIncludes("hiphop")): return "Hip-Hop";
    case (inputIncludes("rap")): return "Rap";
    case (inputIncludes("breakcore")): return "Breakcore";
    case (inputIncludes("chillstep")): return "Chillstep";
    case (inputIncludes("citypop")): return "City Pop";
    case (inputIncludes("bluegrass")): return "Bluegrass";
    case (inputIncludes("country")): return "Country";
    case (inputIncludes("postrock")): return "Post-Rock";
    case (inputIncludes("rock")): return "Rock";
    case (inputIncludes("indie")): return "Indie";
    case (inputIncludes("alternative")): return "Alternative";
    case (inputIncludes("funk")): return "Funk";
    case (inputIncludes("edm")): return "EDM";
    case (inputIncludes("electronicdancemusic")): return "EDM";
    case (inputIncludes("d&b")): return "Drum and Bass";
    case (inputIncludes("dnb")): return "Drum and Bass";
    case (inputIncludes("drum&bass")): return "Drum and Bass";
    case (inputIncludes("drumandbass")): return "Drum and Bass";
    case (inputIncludes("futurebass")): return "Future Bass";
    case (inputIncludes("dubstep")): return "Dubstep";
    case (inputIncludes("drumstep")): return "Dubstep";
    case (inputIncludes("powermetal")): return "Power Metal";
    case (inputIncludes("metalcore")): return "Metal";
    case (inputIncludes("metal")): return "Metal";
    case (inputIncludes("phonk")): return "Phonk";
    case (inputIncludes("trance")): return "Trance";
    case (inputIncludes("orchestra")): return "Orchestral";
    case (inputIncludes("happyhardcore")): return "Happy Hardcore";
    case (inputIncludes("electronic")): return "Electronic";
    case (inputIncludes("soundtrack")): return "Soundtrack";
    default: return null;
  }
}

/**
 *
 */
function parseGenre(description, genre, title, uploader) {
  // Check if we can standardize and return the input genre (if one exists).
  const resultInGenre = mapGenre(genre);
  if (resultInGenre) return resultInGenre;
  // Check if we can standardize and return the hashtags in the description (if any exist).
  const resultInDescription = mapGenre(description?.match(/#\w+/g)?.find(mapGenre));
  if (resultInDescription) return resultInDescription;
  // We are desperate, check if there are any genre clues in the title.
  const resultInTitle = mapGenre(title);
  if (resultInTitle) return resultInTitle;
  // Cross our fingers and hope for the best.
  const resultInUploader = mapGenre(uploader);
  return resultInUploader;
}
