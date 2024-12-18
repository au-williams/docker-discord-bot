import { ActionRowBuilder, BaseChannel, ChannelType, DMChannel, GuildChannel, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, ThreadChannel } from "discord.js";
import { basename, dirname, extname, parse } from "path";
import { getAverageColor } from "fast-average-color-node";
import { Logger } from "./logger.js";
import { nanoid } from "nanoid";
import Downloader from "nodejs-file-downloader";
import emojiRegex from "emoji-regex";
import fs from "fs-extra";
import sanitize from "sanitize-filename";
import secondsToTimestamp from "seconds-to-timestamp";
import sharp from "sharp";
import Vibrant from "node-vibrant";

const logger = new Logger(import.meta.filename);

/**
 *
 */
export class Utilities {
  static tempDirectory = fs.readJsonSync("config.json").temp_directory;

  /**
   * Check if a message thread is able to be created. Message threads cannot be created in DMs.
   */
  static checkAllowedThreadCreate(wrapperOrChannel) {
    if (wrapperOrChannel.channel) wrapperOrChannel = wrapperOrChannel.channel;
    Utilities.checkType(BaseChannel, wrapperOrChannel);
    return wrapperOrChannel instanceof GuildChannel;
  }

  /**
   * Check if the url directs to Discord.
   * @param {string} url
   * @returns {boolean}
   */
  static checkDiscordUrl(url) {
    return typeof url === "string" && (url.includes("cdn.discordapp.com") || url.includes("media.discordapp.net"));
  }

  static checkEphemeralMessage(message) {
    return message?.flags?.has(MessageFlags.Ephemeral);
  }

  /**
   * Checks if two arrays are equal in their content
   * TODO: sort before compare?
   * @param {Array} array1
   * @param {Array} array2
   * @returns {boolean}
   */
  static checkEqualArrays(array1, array2) {
    return JSON.stringify(array1) === JSON.stringify(array2);
  }

  /**
   * Checks if the filename is a non-test JavaScript or TypeScript file
   * @param {string} filename
   * @returns {boolean}
   */
  static checkExecutableFilename(filename) {
    return filename.endsWith(".js") && !filename.endsWith(".test.js");
  }

  /**
   *
   */
  static checkImageEmbedsInMessage(message) {
    return Boolean(message?.embeds?.some(({ data }) => data.image));
    // return message.embeds.some(({ data }) => data?.type?.includes("image") && (requiredUrls?.length ? requiredUrls.some(url => data?.thumbnail?.url.contains(url)) : true));
  }

    /**
   *
   */
  static checkEmbedFooterInMessage(message) {
    return Boolean(message?.embeds?.some(({ data }) => data.footer));
  }

  /**
   */
  static getEmbedFooterInMessage(message) {
    if (!Utilities.checkEmbedFooterInMessage(message)) return undefined;
    return message.embeds.find(({ data }) => data.footer).data.footer.text;
    // return message.embeds.filter(({ data }) => data.image).map(({ data }) => data.image.url);
    // return message.embeds.filter(({ data }) => data?.type?.includes("image") && (requiredUrls?.length ? requiredUrls.some(url => data?.thumbnail?.url.contains(url)) : true));
  }

  /**
   * TODO: this may not work for embeds with multiple thumbnails
   */
  static getEmbedImageUrlsInMessage(message) {
    if (!Utilities.checkImageEmbedsInMessage(message)) return undefined;
    return message.embeds.find(({ data }) => data.image).data.image.url;
    // return message.embeds.filter(({ data }) => data.image).map(({ data }) => data.image.url);
    // return message.embeds.filter(({ data }) => data?.type?.includes("image") && (requiredUrls?.length ? requiredUrls.some(url => data?.thumbnail?.url.contains(url)) : true));
  }

  /**
   *
   */
  static getUserIdFromString(string) {
    return string.match(/<@(\d+)>/)?.[1];
  }

  /**
   * Checks if the message contains image attachments.
   * @param {Message} message
   * @returns {boolean}
   */
  static checkImageAttachment(message) {
    return Boolean(message?.attachments.some(({ contentType }) => contentType.includes("image")));
  }

/**
 * Get a collection of all image URLs attached to a Discord message
 * @param {Message} message
 * @param {boolean} unique When true, only unique results will be returned
 * @returns {string[]}
 */
  static getImageAttachmentUrlsFromMessage(message, unique = false) {
    if (!Utilities.checkImageAttachment(message)) return [];
    const urls = message.attachments.filter(({ contentType }) => contentType.includes("image")).map(({ url }) => url);
    return unique ? [...new Set(urls)] : urls;
  }

  /**
   * Checks if the string is a valid number
   * https://stackoverflow.com/questions/175739/how-can-i-check-if-a-string-is-a-valid-number
   * @param {string} str
   * @returns {boolean}
   */
  static checkNumericString(str) {
    if (typeof str != "string") return false; // we only process strings!
    return (
      !isNaN(str) && // use type coercion to parse the _entirety_ of the string (`parseFloat` alone does not do this)...
      !isNaN(parseFloat(str))
    ); // ...and ensure strings of whitespace fail
  }

  /**
   * Checks if the string ends with a punctuation character
   * @param {string} string
   * @returns {boolean}
   */
  static checkPunctuatedString(string) {
    string = string.replaceAll("\"", "").replaceAll("'", ""); // ignore trailing quotation marks
    const punctuations = [".", ".\"", ",", ";", ":", "!", "?", "-", "(", ")", "[", "]", "{", "}"];
    return punctuations.some(punctuation => string.endsWith(punctuation));
  }

  /**
   * Check if the channel is a thread channel.
   * @throws If not a channel or wrapper of channel.
   * @param {*} channelOrWrapper
   * @returns {boolean}
   */
  static checkThreadChannel(channelOrWrapper) {
    channelOrWrapper = channelOrWrapper.channel || channelOrWrapper;
    Utilities.throwType(BaseChannel, channelOrWrapper);
    return channelOrWrapper.type === ChannelType.PublicThread || channelOrWrapper.type === ChannelType.PrivateThread;
  }

  /**
   * Check if the provided value is of type. Used to type check primitives and classes.
   * @param {*} type `"Function"` | `"boolean"` | `GuildMember` | `ButtonInteraction` | (etc)
   * @param {*} value `myCallbackFunction` | `isValue` | (other variables, etc)
   * @returns {boolean}
   */
  static checkType(type, value) {
    if (value?.constructor?.name === type) {
      return true;
    }
    if (typeof type === "function") {
      return value instanceof type;
    }
    else if (typeof type === "string") {
      return typeof value === type;
    }
    return false;
  }

  /**
   * Check if the provided value is one of multiple types. Used to type check primitives and classes.
   * @param {*[]} types
   * @param {*} value
   * @returns {boolean}
   */
  static checkTypes(types, value) {
    return types.some(type => Utilities.checkType(type, value))
  }

  /**
   * Check if the timestamp contains non-number or invalid number segments.
   * @param {string} value HH:MM:SS timestamp (eg. `"00:00:02"` or `"0:02"`)
   * @returns {boolean}
   */
  static checkValidTimestamp(value) {
    if (typeof value !== "string") return false;
    return !value.split(":").some((item, index) => isNaN(item) || Number(item) < 0 || (index && Number(item) < 10 && item.length != 2) || Number(item) > 59);
  }

  /**
   * Deletes the child thread if the starter message channel is in the channel ids
   * TODO: unit test
   * @param {object} param
   * @param {string[]} param.channelIds
   * @param {Logger} param.Logger
   * @param {Message} param.starterMessage
   * @returns {boolean}
   */
  static async deleteMessageThread({ message, listener }) {
    if (!message.thread) return;
    const name = message.thread.name;
    await message.thread.delete();
    logger.debug(`Deleted thread channel "${name}" in response to deleted source message.`, listener)
  }

  /**
   * Get a boolean from the parameter, evaluating the return value of a function if one is provided.
   * @async
   * @throws
   * @param {boolean|Function} param
   * @returns {boolean}
   */
  static async evalAsBoolean(param) {
    if (Utilities.checkType("AsyncFunction", param)) {
      param = await param();
    }
    if (Utilities.checkType("Function", param)) {
      param = param();
    }
    if (typeof param !== "boolean") {
      throw new Error("Expected a boolean value.")
    }
    return param;
  }

  /**
   * Gets the first unique filename for a filepath. If the filepath "c:\readme.md" is provided and
   * the file "readme.md" does not exist in that directory then "readme.md" will be returned. If
   * the file "readme.md" does exist then "readme (1).md" will be returned unless it too exists,
   * then "readme (2).md" will be returned and so on until a unique filename is created.
   * @param {string} filepath
   * @returns {string}
   */
  static getAvailableFilename(filepath) {
    const extension = extname(filepath);
    const filename = basename(filepath, extension);
    if (!fs.existsSync(filepath)) return filename + extension;

    const directory = dirname(filepath);
    const nextNumber = fs
      .readdirSync(directory)
      .filter(fn => fn.includes(filename))
      .reduce((prev, fn) => {
        const match = fn.match(/\((\d+)\)/);
        return match ? Math.max(prev, match[1]) : prev;
      }, 0) + 1;

    return `${filename} (${nextNumber})${extension}`;
  }

  /**
   * Create a temporary download of the destination file and process it with getAverageColor
   * @param {string} url
   * @returns {FastAverageColorResult}
   */
  static async getAverageColorFromUrl(url) {
    const tempDownloadDirectory = `${this.tempDirectory}/${nanoid()}`;
    const downloader = new Downloader({ url, directory: tempDownloadDirectory });
    const { filePath: tempDownloadFilePath } = await downloader.download();
    const averageColor = await getAverageColor(tempDownloadFilePath);
    // TODO: has issues with file locking that need resolving
    // https://stackoverflow.com/questions/20796902/deleting-file-in-node-js
    // fs.removeSync(tempDownloadDirectory);
    return averageColor;
  }

  /**
   *
   */
  static getCompactNumber(num) {
    if (num >= 1000000000) {
       return (num / 1000000000).toFixed(1).replace(/\.0$/, '') + 'G';
    }
    if (num >= 1000000) {
       return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    }
    if (num >= 1000) {
       return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    }
    return num;
}

  /**
   * TODO: filter button component type
   */
  static getButtonComponentCount(message, ignoredCustomIds = []) {
    return [...message.components]
    .map(({ components }) => components)
    .flat()
    .filter(({ customId }) => !ignoredCustomIds.includes(customId))
    .length;
  }

  /**
   *
   */
  static getValueAsString(value) {
    if (Array.isArray(value)) {
      return `[${value.map(item => typeof item === "string" ? `'${item}'` : item).join(", ")}]`;
    }
    if (typeof value === "object") {
      return JSON.stringify(value).split("\n").map(item => item.trim()).join(" ");
    }
    return value;
  }

  static getValueAsType(value) {
    if (Array.isArray) {
      return "array";
    }
    if (typeof value === "object") {
      let name = value.constructor.name;
      if (name === "Object") name = name.toLowerCase();
      if (name !== "object") name += "(object)";
      return name;
    }
    return value;
  }

  static getFormattedGuildAndChannelString(message) {
    if (message.channel instanceof GuildChannel) {
      return `${message.guild.name} #${message.channel.name}`;
    }
    if (message.channel instanceof ThreadChannel) {
      // TODO: GuildName #ChannelName ThreadName
      return `${message.guild.name} #${message.channel.name}`;
    }
    if (message.channel instanceof DMChannel) {
      const name = message.channel.recipient?.displayName;
      if (name) return `${name}'s DM channel`;
      // TODO: partial channel may need to be re-fetched due to the dog water dmchannel API
      // TODO: this needs to be async but I dont want this to be async. thanks Discord! ugh
      return "a DM channel";
    }
    throw new Error("Unhandled type of channel");
  }

  /**
   * Gets the least frequently occurring strings in the string array.
   * (Example 1: ['a', 'a', 'b', 'b', 'c', 'c', 'c'] => ['a', 'b'])
   * (Example 2: ['a', 'a', 'b', 'b'] => ['a', 'b'])
   * @param {string[]} stringArray
   * @returns {string[]}
   */
  static getLeastFrequentlyOccurringStrings(stringArray) {
    if (!stringArray?.length) return [];
    const frequency = {};
    for (const item of stringArray) frequency[item] = (frequency[item] || 0) + 1;
    const min = Math.min(...Object.values(frequency));
    const result = [];
    for (const [item, freq] of Object.entries(frequency)) if (freq === min) result.push(item);
    logger.debug(`Evaluating item occurrences in array:\n- ${Object.entries(frequency).map(([k,v]) => `${v} ${Utilities.getPluralizedString("item", v)}: '${k}'`).join("\n- ")}`);
    return result;
  }

  /**
   * Extract a link from a string
   * `"foo http://youtu.be/w?v=a&b=c bar"` -> `"http://youtu.be/w?v=a&b=c"`
   * @param {string} string
   * @param {boolean} ignoreCodeBlocks
   * @returns {string}
   */
  static getLinkFromString(string, ignoreCodeBlocks = true) {
    if (ignoreCodeBlocks) string = string.replace(/```[\s\S]*?```/g, "");
    else string = string.replaceAll("`", "");
    let match = string.match(/(https?:\/\/[^\s]+)/g)?.[0];
    if (!match) return null;

    // fix embedless links (thank you Discord markup very cool!)
    if (string.includes(`(<${match}`) && match.endsWith(">)")) {
      match = match.slice(0, -2);
    }

    else if (string.includes(`(${match}`) && match.endsWith(")")) {
      match = match.slice(0, -1);
    }

    return match;
  }

  /**
   * Extract a link from a string with its parameters removed
   * `"foo http://youtu.be/w?v=a&b=c bar"` -> `"http://youtu.be/w?v=a"`
   * @param {string} string
   * @param {boolean} ignoreCodeBlocks
   * @returns {string}
   */
  static getLinkWithoutParametersFromString(string, ignoreCodeBlocks = true) {
    if (ignoreCodeBlocks) string = string.replace(/```[\s\S]*?```/g, "");
    let match = string.match(/(https?:\/\/[^&\s]+)/g)?.[0];
    if (!match) return null;

    // fix embedless links (thank you Discord markup very cool!)
    if (string.includes(`(<${match}`) && match.endsWith(">)")) {
      match = match.slice(0, -2);
    }

    else if (string.includes(`(${match}`) && match.endsWith(")")) {
      match = match.slice(0, -1);
    }

    return match;
  }

  static getJoinedArrayWithOr(array) {
    if (array.length === 1) return array;
    return array.reduce((previous, current, index) => {
      const isLastItem = index === array.length - 1;
      return isLastItem ? `${previous} or ${current}` : `${previous} ${current}`;
    }, "");
  }

  static getObjectLength(obj) {
    return typeof obj === "object" && Object.keys(obj).length;
  }

  /**
   * Get the existing thread or create one if it doesn't exist
   * @async
   * @param {object} param
   * @param {Message} param.message
   * @param {object} param.clientOptions
   * @param {object} param.threadOptions
   * @returns {Promise<ThreadChannel>}
   */
  static async getOrCreateThreadChannel({ message, clientOptions, threadOptions }) {
    if (message.hasThread) return message.thread;

    threadOptions.name = Utilities.getTruncatedStringTerminatedByChar(threadOptions.name, 100);
    const threadChannel = await message.startThread(threadOptions);

    if (clientOptions.removeMembers) {
      const fetchedMembers = await threadChannel.members.fetch();
      const removedMemberIds = fetchedMembers.filter(({ user }) => !user.bot).map(({ id }) => id);
      for (const id of removedMemberIds) await threadChannel.members.remove(id);
    }

    return threadChannel;
  }

  /**
   * Amazing how there's not a better way of determining if a string is valid JSON or not. Try/catch here we come!
   *   Btw the "is-json" NPM package doesn't work. It's not trash because with trash you know what you're getting.
   *   It's worse than trash because it makes you think it works until it doesn't and causes a ton of file issues.
   *   https://stackoverflow.com/a/20392392 thanks I hate it but at least I'm not gaslit by an NPM package anymore
   * @param {string} jsonString
   * @returns {string?}
   */
  static getParsedJsonString(jsonString) {
    try {
      const o = JSON.parse(jsonString);
      // Handle non-exception-throwing cases:
      // Neither JSON.parse(false) or JSON.parse(1234) throw errors, hence the type-checking,
      // but... JSON.parse(null) returns null, and typeof null === "object",
      // so we must check for that, too. Thankfully, null is falsey, so this suffices:
      if (o && typeof o === "object") return o;
    } catch (e) {
      return undefined;
    }
  }

  /**
   * Get the percentage of the partial value from the total value
   * @param {number} partialValue
   * @param {number} totalValue
   * @returns {number}
   */
  static getPercentage(partialValue, totalValue) {
    if (!totalValue) return NaN;
    return (100 * partialValue) / totalValue;
  }

  /**
   * Get a pluralized string if the count is not 1
   * @param {string} string The string to pluralize `(ex. "Apple")`
   * @param {number} count The count to compare with `(ex. 6)`
   * @returns {string} The pluralized string `(ex. "Apples")`
   */
  static getPluralizedString(string, arrayOrNumber) {
    if (Array.isArray(arrayOrNumber)) arrayOrNumber = arrayOrNumber.length;
    return arrayOrNumber != 1 ? `${string}s` : string;
  }

  /**
   * Get the function as a promise.
   */
  static getPromise(func) {
    return new Promise((resolve, reject) => {
      try {
          resolve(func);
      } catch (err) {
          reject(err);
      }
    });
  }

  /**
   * Format the role ids to display as clickable member roles in a Discord message
   * @param {string[]} array An unformatted string array of member role ids
   * @returns {any} A formatted string array of member role ids
   */
  static getRoleIdsAsLinks(array) {
    return array.map(item => `<@&${item}>`);
  }

  /**
   * HH:MM:SS -> M:SS
   */
  static getShortTimestamp(timestamp) {
    Utilities.throwType("string", timestamp);
    timestamp = timestamp.replace(/^0(?:0:0?)?/, "");
    if (timestamp.length === 0) timestamp = `0${timestamp}`;
    if (timestamp.length === 1) timestamp = `0${timestamp}`;
    if (timestamp.length === 2) timestamp = `:${timestamp}`;
    if (timestamp.length === 3) timestamp = `0${timestamp}`;
    return timestamp;
  }

  /**
   *
   */
  static getLongTimestamp(timestamp) {
    timestamp = Utilities.getShortTimestamp(timestamp);
    if (timestamp.length === 4) timestamp = `0${timestamp}`;
    if (timestamp.length === 5) timestamp = `:${timestamp}`;
    if (timestamp.length === 6) timestamp = `0${timestamp}`;
    if (timestamp.length === 7) timestamp = `0${timestamp}`;
    return timestamp;
  }

  static getFilenameTimestamp(timestamp) {
    let shortTimestamp = Utilities.getShortTimestamp(timestamp).replaceAll(":","");
    if (shortTimestamp.length % 2) shortTimestamp = "0" + shortTimestamp;
    return "T" + shortTimestamp;
  }

  static getSplitAuthorTitle(string) {
    string = string.replaceAll(" � ", " - ").replaceAll(" • ", " - ");
    const author = string.split(" - ").slice(0, -1).join(" - ").trim();
    const title = string.split(" - ").splice(-1)[0].trim();
    return [author, title];
  }

  /**
   *
   */
  static getSizeInKilobytes(filepath) {
    return `${(fs.statSync(filepath).size / 1024).toFixed(2)} KiB`;
  }

  /**
   * Splits a string by the desired size of returned items
   * (Example 1: "aabbccdd", 2 => ["aa", "bb", "cc", "dd"])
   * (Example 2: "abcdefgh", 3 => ["abc", "def", "gh"])
   * TODO: this function is funky, maybe simplify it and invoke for each split new line
   * TODO: getSplitStringByLength
   * @param {string} str
   * @param {number} length
   * @returns {string[]}
   */
  static getSplitJsonStringByLength(jsonString, length) {
    const splitLines = jsonString.split("\n");
    const resultLines = [""];

    for (const splitLine of splitLines) {
      const i = resultLines.length - 1;
      const appendedResultLine = resultLines[i] ? `${resultLines[i]}\n${splitLine}` : splitLine;
      if (appendedResultLine.length <= length) resultLines[i] = appendedResultLine;
      else resultLines.push(splitLine);
    }

    return resultLines;
  }

  static getApproximateSubstring(str, index) {
    // Handle edge cases where index is out of bounds
    if (index < 0 || index >= str.length) return null;

    // Function to find the word boundaries given a starting index
    function findWordBounds(startIndex) {
        let start = startIndex;
        while (start > 0 && str[start - 1] !== ' ') {
            start--;
        }
        let end = startIndex;
        while (end < str.length && str[end] !== ' ') {
            end++;
        }
        return [start, end];
    }

    // If index is on a word character, find the word boundaries
    if (str[index] !== ' ') {
        const [start, end] = findWordBounds(index);
        return str.slice(start, end);
    }

    // If index is on a space, look for the nearest word on both sides
    let left = index - 1;
    let right = index + 1;

    while (left >= 0 || right < str.length) {
        // Check left side for a word
        if (left >= 0 && str[left] !== ' ') {
            const [start, end] = findWordBounds(left);
            return str.slice(start, end);
        }
        // Check right side for a word
        if (right < str.length && str[right] !== ' ') {
            const [start, end] = findWordBounds(right);
            return str.slice(start, end);
        }
        left--;
        right++;
    }

    return null; // No word found if the string is empty or only contains spaces
  }

  static async fetchStarterMessageThenReferenceMessage(message) {
    let starterMessage = message.channel instanceof ThreadChannel
      ? await message.channel.fetchStarterMessage()
      : message;

    // TODO: this may be broken in DMs. if message is response, get by id
    // TODO: i dont know what the above todo message means ._.
    if (starterMessage.reference?.messageId) {
      starterMessage = await message.channel.messages.fetch(starterMessage.reference.messageId);
    }

    return starterMessage;
  }

  /**
   * Get the string with all emojis removed.
   * @param {string} string
   * @returns {string}
   */
  static getStringWithoutEmojis(string) {
    const matches = string.matchAll(emojiRegex());
    for (const match of matches) string = string.replace(match[0], "");
    return string;
  }

  /**
   * Get the total seconds from a HH:MM:SS formatted timestamp.
   * @param {string} timestamp HH:MM:SS timestamp
   * @returns {number}
   */
  static getTimestampAsTotalSeconds(timestamp) {
    if (!Utilities.checkValidTimestamp) return null;
    const time = Utilities.getLongTimestamp(timestamp).split(":");
    return +time[0] * 60 * 60 + +time[1] * 60 + +time[2];
  }

  /**
   * Get the HH:MM:SS formatted timestamp from the total seconds.
   * @param {number} totalSeconds
   * @returns {string}
   */
  static getTimestampFromTotalSeconds(totalSeconds) {
    return secondsToTimestamp(totalSeconds);
  }

  /**
   * Truncate a string to the maximum allowed size terminated on the char of that index.
   * Example: `("the quick brown fox", 12)` => `"the quick br..."`
   * @param {string} string
   * @param {number} maxLength Defaults to `100` to align with Discord thread name restrictions
   * @returns {string}
   */
  static getTruncatedStringTerminatedByChar(string, maxLength = 100) {
    if (string.length <= maxLength) return string;
    if (maxLength <= 3) return string.slice(0, maxLength);
    if (maxLength <= 5) return string.slice(0, maxLength - 2) + "..";
    return string.slice(0, maxLength - 3) + "...";
  }

  /**
   *
   */
  static getTruncatedFilenameWithExtension(string, maxLength = 100) {
    const { ext, name } = parse(string);
    return Utilities.getTruncatedStringTerminatedByChar(name, maxLength - ext.length) + ext;
  }

  /**
   * Truncate a string to the maximum allowed size terminated by a complete word.
   * Example: `("the quick brown fox", 12)` => `"the quick [...]"`
   * @param {string} string
   * @param {number} maxLength Defaults to `100` to align with Discord thread name restrictions
   * @returns {string}
   */
  static getTruncatedStringTerminatedByWord(string, maxLength = 100) {
    if (string.length <= maxLength) return string;
    const words = string.split(" ");
    let result = words.shift();

    for (const word of words) {
      if (`${result} ${word}`.length > maxLength - 6) {
        result += " [...]";
        break;
      }
      result += ` ${word}`;
    }

    return result;
  }

  /**
   *
   */
  static getCapitalizedString(val) {
    return String(val).charAt(0).toUpperCase() + String(val).slice(1);
}

  /**
   *
   */
  static getSanitizedFfmpeg(str) {
    return str.trim().replaceAll("'", "'/''");
  }

 /**
  * Sanitize a string for use as a filename in Windows and/or Linux
  * @param {string} str
  * @returns {string}
  */
  static getSanitizedFilename(str) {
    return sanitize(str.replace(/[//]/g, " ").replace(/  +/g, " "));
  }

  static getVibrantColorFromUrl = async url => {
    // download the file
    const tempDownloadDirectory = `${this.tempDirectory}/${nanoid()}`;
    const downloader = new Downloader({ url, directory: tempDownloadDirectory });
    let { filePath: tempDownloadFilePath } = await downloader.download();

    // convert the file if it's .webp (Vibrant does not support it)
    if (tempDownloadFilePath.endsWith(".webp")) {
      const ext = extname(tempDownloadFilePath);
      const base = basename(tempDownloadFilePath, ext);
      const webpTempDownloadFilePath = tempDownloadFilePath;
      tempDownloadFilePath = `${tempDownloadDirectory}/${base}.png`;
      await sharp(webpTempDownloadFilePath).toFormat("png").toFile(tempDownloadFilePath);
    }

    // extract the vibrant color
    const vibrantColor = await new Vibrant(tempDownloadFilePath).getPalette();
    const { LightVibrant, LightMuted, DarkVibrant, DarkMuted } = vibrantColor;
    // TODO: has issues with file locking that need resolving
    // https://stackoverflow.com/questions/20796902/deleting-file-in-node-js
    // fs.removeSync(tempDownloadDirectory);

    return LightMuted?.hex || LightVibrant?.hex || DarkVibrant?.hex || DarkMuted?.hex;
  };

  static LogPresets = {
    CreatedThread: (thread, listener) => logger.info(`Created thread channel "${thread.name}"`, listener),
    DebugSetValue: (property, value, listener) => logger.debug(`Set "${property}" key as "${Utilities.getValueAsString(value)}" ${Utilities.getValueAsType(value)} value.`, listener),
    DeletedMessage: (message, listener) => logger.info(`Deleted a${Utilities.checkEphemeralMessage(message) ? "n ephemeral" : ""} message in ${Utilities.getFormattedGuildAndChannelString(message)} sent by ${message.author.displayName}.`, listener),
    EditedMessage: (message, listener) => logger.info(`Edited a${Utilities.checkEphemeralMessage(message) ? "n ephemeral" : ""} message in ${Utilities.getFormattedGuildAndChannelString(message)}.`, listener),
    EditedMessageFile: (message, filename, listener) => logger.info(`Edited a${Utilities.checkEphemeralMessage(message) ? "n ephemeral" : ""} message reply with "${filename}" file in ${Utilities.getFormattedGuildAndChannelString(message)}.`, listener),
    EditedReply: (message, listener) => logger.info(`Edited a${Utilities.checkEphemeralMessage(message) ? "n ephemeral" : ""} message reply in ${Utilities.getFormattedGuildAndChannelString(message)}.`, listener),
    SentFollowUp: (message, listener) => logger.info(`Sent a${Utilities.checkEphemeralMessage(message) ? "n ephemeral" : ""} message follow up to ${Utilities.getFormattedGuildAndChannelString(message)}.`, listener),
    SentFollowUpFile: (message, filename, listener) => logger.info(`Sent a${Utilities.checkEphemeralMessage(message) ? "n ephemeral" : ""} message follow up with "${filename}" file to ${Utilities.getFormattedGuildAndChannelString(message)}.`, listener),
    SentMessage: (message, listener) => logger.info(`Sent a${Utilities.checkEphemeralMessage(message) ? "n ephemeral" : ""} message to ${Utilities.getFormattedGuildAndChannelString(message)}.`, listener),
    SentMessageFile: (message, filename, listener) => logger.info(`Sent a${Utilities.checkEphemeralMessage(message) ? "n ephemeral" : ""} message with "${filename}" file to ${Utilities.getFormattedGuildAndChannelString(message)}.`, listener),
    SentReply: (message, listener) => logger.info(`Sent a${Utilities.checkEphemeralMessage(message) ? "n ephemeral" : ""} message reply to ${Utilities.getFormattedGuildAndChannelString(message)}.`, listener),
    SentReplyFile: (message, filename, listener) => logger.info(`Sent a${Utilities.checkEphemeralMessage(message) ? "n ephemeral" : ""} message reply with "${filename}" file to ${Utilities.getFormattedGuildAndChannelString(message)}.`, listener),
    ShowedModal: (interaction, listener) => logger.info(`Showed a modal in ${Utilities.getFormattedGuildAndChannelString(interaction.message)}.`, listener),
  }

  /**
   * Shows a modal with a single paragraph, typically used as a confirmation dialog.
   * @param {object} param
   * @param {string?} param.inputCustomId CustomId is not required if text input is not captured.
   * @param {string?} param.inputValue InputLabel is not required if not using a placeholder message.
   * @param {string} param.inputLabel InputLabel is required as a header for the paragraph input.
   * @param {Interaction} param.interaction Interaction is required to display the modal.
   * @param {string} param.modalCustomId ModalCustomId is required to capture the submit. (Can this be nullable?)
   * @param {string} param.modalTitle ModalTitle is required as the title for the modal.
   */
  static async showParagraphModal({ inputCustomId, inputLabel, inputValue, interaction, modalCustomId, modalTitle }) {
    const modal = new ModalBuilder()
      .setCustomId(modalCustomId)
      .setTitle(modalTitle);

    // ------------------------------------------------------------------------- //
    // Discord's incredible API does not allow basic text to be displayed, which //
    // requires this modal to wrap it in a TextInput to convey basic information //
    // that the user should read. We do not care about any TextInput changes, so //
    // randomize the required CustomId field.                                    //
    // ------------------------------------------------------------------------- //

    const input = new TextInputBuilder()
      .setCustomId(inputCustomId || nanoid())
      .setLabel(inputLabel)
      .setStyle(TextInputStyle.Paragraph);

    if (inputValue?.trim()) {
      input.setValue(inputValue.trim());
    }

    const row = new ActionRowBuilder().addComponents(input);
    modal.addComponents(row);

    await interaction.showModal(modal);
  }

  /**
   * Throw if the provided value is not of type. Used to type check primitives and classes.
   * @param {*} type
   * @param {*} value
   * @returns {boolean}
   */
  static throwType(type, value) {
    if (!Utilities.checkType(type, value)) {
      throw new Error(`Expected type ${type}. Received ${value?.constructor?.name}.`);
    }
  }

  /**
   * Throw if the provided value is not one of multiple types. Used to type check primitives and classes.
   * @param {*[]} types
   * @param {*} value
   * @returns {boolean}
   */
  static throwTypes(types, value) {
    const some = types.some(type => Utilities.checkType(type, value));
    if (!some) throw new Error(`Expected types [${types.join("\", \"")}]. Received ${value?.constructor?.name}.`);
  }
}

// TODO: move to static

// /**
//  * Get the filename of where this function is invoked
//  * @param {string} importMetaUrl import.meta.url
//  * @returns {string} "example_plugin_name.js"
//  */
// export function getPluginFilename(importMetaUrl) {
//   return basename(fileURLToPath(importMetaUrl));
// }


// /**
//  * Gets the first unique filename for a filepath. If the filepath "c:\readme.md" is provided and
//  *   the file "readme.md" does not exist in that directory then "c:\readme.md" will be returned. If
//  *   the file "readme.md" does exist then "c:\readme (1).md" will be returned unless it too exists,
//  *   then "c:\readme (2).md" will be returned and so on until a unique filename is created.
//  * @param {string} filepath
//  * @returns {string}
//  */
// export function getAvailableFilepath(filepath) {
//   const availableFilename = getAvailableFilename(filepath);
//   return filepath.replace(basename(filepath), availableFilename);
// }

// /**
//  * The retry policy for the `fetch-retry` NPM package
//  */
// export const fetchRetryPolicy = Object.freeze({
//   retries: 10,
//   retryDelay: 1000,
//   retryOn: [501, 502, 503]
// });
