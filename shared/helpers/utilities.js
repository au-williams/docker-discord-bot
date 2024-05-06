import { basename, dirname, extname } from "path";
import { fileURLToPath } from "url";
import { getAverageColor } from 'fast-average-color-node';
import { nanoid } from 'nanoid'
import { scheduledJobs } from "croner";
import Vibrant from 'node-vibrant'
import Downloader from "nodejs-file-downloader";
import fs from "fs-extra";
import sharp from "sharp";

const { temp_directory } = fs.readJsonSync("config.json");

/**
 * Create a temporary download of the destination file to process with getAverageColor
 * @param {string} url
 */
export const getAverageColorFromUrl = async url => {
  const tempDownloadDirectory = `${temp_directory}\\${nanoid()}`;
  const downloader = new Downloader({ url, directory: tempDownloadDirectory });
  const { filePath: tempDownloadFilePath } = await downloader.download();
  const averageColor = await getAverageColor(tempDownloadFilePath);
  // todo: has issues with file locking that need resolving
  // https://stackoverflow.com/questions/20796902/deleting-file-in-node-js
  // fs.removeSync(tempDownloadDirectory);
  return averageColor;
}

export const getVibrantColorFromUrl = async url => {
  // download the file
  const tempDownloadDirectory = `${temp_directory}\\${nanoid()}`;
  const downloader = new Downloader({ url, directory: tempDownloadDirectory });
  let { filePath: tempDownloadFilePath } = await downloader.download();

  // convert the file if it's .webp (Vibrant does not support it)
  if (tempDownloadFilePath.endsWith(".webp")) {
    const ext = extname(tempDownloadFilePath);
    const base = basename(tempDownloadFilePath, ext);
    const webpTempDownloadFilePath = tempDownloadFilePath;
    tempDownloadFilePath = `${tempDownloadDirectory}\\${base}.png`;
    await sharp(webpTempDownloadFilePath).toFormat('png').toFile(tempDownloadFilePath);
  }

  // extract the vibrant color
  const vibrantColor = await new Vibrant(tempDownloadFilePath).getPalette();
  const { LightVibrant, LightMuted, DarkVibrant, DarkMuted } = vibrantColor;
  // todo: has issues with file locking that need resolving
  // https://stackoverflow.com/questions/20796902/deleting-file-in-node-js
  // fs.removeSync(tempDownloadDirectory);

  return LightMuted?.hex || LightVibrant?.hex|| DarkVibrant?.hex || DarkMuted?.hex
}

/**
 * The options for the `croner` NPM package. By default, jobs will use their
 *   plugin filenames as their names. Appended text is optional to make them
 *   unique and avoid conflicts. Conflicting names will automatically append
 *   parenthesized numbers in ascending order.
 * @param {Logger} logger
 * @param {string?} appendedJobName
 */
export const getCronOptions = (logger, appendedJobName = "") => {
  let name = `${logger.filename}${(appendedJobName ? " ":"")}${appendedJobName}`;
  let isDuplicateName = scheduledJobs.find(job => job.name === name);

  while (isDuplicateName) {
    const split = name.split(" ");
    const counter = split.pop().replace("(", "").replace(")", "");
    name = getIsNumeric(counter) ? `${split.join(" ")} (${parseInt(counter) + 1})` : `${name} (1)`;
    isDuplicateName = scheduledJobs.find(job => job.name === name);
  }

  return {
    catch: e => logger.error(e),
    name,
    protect: true
  }
}

/**
 * Gets if two arrays are equal in their content
 * @param {Array} array1
 * @param {Array} array2
 * @returns {boolean}
 */
export function getIsEqualArrays(array1, array2) {
  return JSON.stringify(array1) === JSON.stringify(array2);
}

// https://stackoverflow.com/questions/175739/how-can-i-check-if-a-string-is-a-valid-number
export function getIsNumeric(str) {
  if (typeof str != "string") return false; // we only process strings!
  return !isNaN(str) && // use type coercion to parse the _entirety_ of the string (`parseFloat` alone does not do this)...
         !isNaN(parseFloat(str)); // ...and ensure strings of whitespace fail
}

/**
 * Gets the least frequently occurring strings in the string array.
 * (Example 1: ['a', 'a', 'b', 'b', 'c', 'c', 'c'] => ['a', 'b'])
 * (Example 2: ['a', 'a', 'b', 'b'] => ['a', 'b'])
 * @param {String[]} stringArray
 * @returns {String[]}
 */
export function getLeastFrequentlyOccurringStrings(stringArray) {
  const frequency = {};
  for (const item of stringArray) frequency[item] = (frequency[item] || 0) + 1;
  const min = Math.min(...Object.values(frequency));
  const result = [];
  for (const [item, freq] of Object.entries(frequency)) if (freq === min) result.push(item);
  return result;
}

/**
 * Extract a link from a string
 * `"foo http://youtu.be/w?v=a&b=c bar"` -> `"http://youtu.be/w?v=a&b=c"`
 * @param {string} string
 * @param {bool} ignoreCodeBlocks
 * @returns {string}
 */
export function getLinkFromString(string, ignoreCodeBlocks = true) {
  if (ignoreCodeBlocks) string = string.replace(/```[\s\S]*?```/g, "");
  const match = string.match(/(https?:\/\/[^\s]+)/g);
  return match?.length ? match[0] : null;
}

/**
 * Extract a link from a string with its parameters removed
 * `"foo http://youtu.be/w?v=a&b=c bar"` -> `"http://youtu.be/w?v=a"`
 * @param {string} string
 * @param {bool} ignoreCodeBlocks
 * @returns {string}
 */
export function getLinkWithoutParametersFromString(string, ignoreCodeBlocks = true) {
  if (ignoreCodeBlocks) string = string.replace(/```[\s\S]*?```/g, "");
  const match = string.match(/(https?:\/\/[^&\s]+)/g);
  return match?.length ? match[0] : null;
}

export function getPercentage(partialValue, totalValue) {
  return (100 * partialValue) / totalValue;
}

/**
 * Get the filename of where this function is invoked
 * @param {string} importMetaUrl import.meta.url
 * @returns {string} "example_plugin_name.js"
 */
export function getPluginFilename(importMetaUrl) {
  return basename(fileURLToPath(importMetaUrl));
}

/**
 * Get the total seconds from a HH:MM:SS formatted timestamp
 * @param {string} timestamp HH:MM:SS timestamp
 */
export function getTimestampAsTotalSeconds(timestamp) {
  const time = timestamp.split(":");
  return (+time[0]) * 60 * 60 + (+time[1]) * 60 + (+time[2]);
}

/**
 * Truncate a string to the maximum allowed size
 * @param {*} string
 * @param {*} maxLength
 * @returns {*}
 */
export function getTruncatedString(string, maxLength) {
  if (string.length > maxLength) string = string.slice(0, maxLength - 3) + "...";
  return string;
}

/**
 * Gets the first unique filename for a filepath. If the filepath "c:\readme.md" is provided and
 *   the file "readme.md" does not exist in that directory then "readme.md" will be returned. If
 *   the file "readme.md" does exist then "readme (1).md" will be returned unless it too exists,
 *   then "readme (2).md" will be returned and so on until a unique filename is created.
 * @param {string} filepath
 * @returns {string}
 */
export function getAvailableFilename(filepath) {
  const extension = extname(filepath);
  const filename = basename(filepath, extension);
  if (!fs.existsSync(filepath)) return filename + extension;

  const directory = dirname(filepath);
  const nextNumber = fs.readdirSync(directory).filter(fn => fn.includes(filename)).reduce((prev, fn) => {
    const match = fn.match(/\((\d+)\)/);
    return match ? Math.max(prev, match[1]) : prev;
  }, 0) + 1;

  return `${filename} (${nextNumber})${extension}`;
}


/**
 * Gets the first unique filename for a filepath. If the filepath "c:\readme.md" is provided and
 *   the file "readme.md" does not exist in that directory then "c:\readme.md" will be returned. If
 *   the file "readme.md" does exist then "c:\readme (1).md" will be returned unless it too exists,
 *   then "c:\readme (2).md" will be returned and so on until a unique filename is created.
 * @param {string} filepath
 * @returns {string}
 */
export function getAvailableFilepath(filepath) {
  const availableFilename = getAvailableFilename(filepath);
  return filepath.replace(basename(filepath), availableFilename);
}

/**
 * Splits a string by the desired size of returned items
 * (Example 1: "aabbccdd", 2 => ["aa", "bb", "cc", "dd"])
 * (Example 2: "abcdefgh", 3 => ["abc", "def", "gh"])
 * @param {string} str
 * @param {Number} length
 * @returns {String[]}
 */
export function splitJsonStringByLength(jsonString, length) {
  const splitLines = jsonString.split("\n");
  const resultLines = [""];

  for(const splitLine of splitLines) {
    const i = resultLines.length - 1;
    const appendedResultLine = resultLines[i] ? `${resultLines[i]}\n${splitLine}` : splitLine;
    if (appendedResultLine.length <= length) resultLines[i] = appendedResultLine;
    else resultLines.push(splitLine);
  }

  return resultLines;
}

/**
 * Amazing how there's not a better way of determining if a string is valid JSON or not. Try/catch here we come!
 *   Btw the "is-json" NPM package doesn't work. It's not trash because with trash you know what you're getting.
 *   It's worse than trash because it makes you think it works until it doesn't and causes a ton of file issues.
 *   https://stackoverflow.com/a/20392392 thanks I hate it but at least I'm not gaslit by an NPM package anymore
 * @param {string} jsonString
 * @returns {string?}
 */
export function tryParseStringToObject(jsonString){
  try {
      const o = JSON.parse(jsonString);
      // Handle non-exception-throwing cases:
      // Neither JSON.parse(false) or JSON.parse(1234) throw errors, hence the type-checking,
      // but... JSON.parse(null) returns null, and typeof null === "object",
      // so we must check for that, too. Thankfully, null is falsey, so this suffices:
      if (o && typeof o === "object") return o;
  }
  // eslint-disable-next-line no-empty
  catch (e) { }
}

export function getPluralizedString(string, count) {
  return count != 1 ? `${string}s` : string;
}
