import { Events } from "discord.js";
import chalk from "chalk";
import date from "date-and-time";
import fs from "fs-extra";
import path from "path";

let client; // TODO: utilize Discord log channel

const { enable_logger_debug, enable_logger_timestamps } = fs.readJsonSync("config.json");

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #region EMITTER.JS LISTENERS                                              //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////

/**
 * The event listeners handled by this script. The key is a Discord event or an
 * interaction property from the `Interactions<object>` variable. The value is
 * a `Listener` object and requires a function to be set. Listeners that only
 * set a function can use the function as the value and it will be wrapped in
 * a Listener by the framework for you automatically. When the key is emitted
 * by Discord then the value will be executed. You may use an array to define
 * multiple Listeners for a single key.
 */
export const Listeners = Object.freeze({
  [Events.ClientReady]: async ({ client: c }) => client = c
});

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #endregion EMITTER.JS LISTENERS                                           //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #region SERVICE LOGIC                                                     //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////

/**
 * `Logger` formats and prints logs.
 */
export class Logger {
  /**
   * Create an instance of Logger that will format and print logs using the provided filename.
   * @param {string} param `import.meta` | `import.meta.filename` | `filename as string value`
   */
  constructor(param) {
    this.filename = path.basename(param.filename || param);
  }

  /**
   * Send a log of `info` severity (low importance).
   * @param {string} message The message content of the log (required).
   * @param {Listener?} listener The listener of the issuing command / event / interaction (optional).
   */
  info(message, listener = null) {
    print({
      filename: listener?.filename || this?.filename,
      logMessage: message,
      logFunction: console.log,
      listener
    });
  }

  /**
   * Send a log of `warn` severity (medium importance).
   * @param {string} message The message content of the log (required).
   * @param {Listener?} listener The listener of the issuing command / event / interaction (optional).
   */
  warn(message, listener = null) {
    print({
      filename: listener?.filename || this?.filename,
      logMessage: message,
      logFunction: console.warn,
      listener
    });
  }

  /**
   * Send a log of `error` severity (high importance).
   * @param {string} message The message content of the log (required).
   * @param {Listener?} listener The listener of the issuing command / event / interaction (optional).
   */
  error(message, listener = null) {
    print({
      filename: listener?.filename || this?.filename,
      logMessage: message,
      logFunction: console.error,
      listener
    });
  }

  /**
   * Send a log of `debug` severity (shown only in debug mode).
   * @param {string} message The message content of the log (required).
   * @param {Listener?} listener The listener of the issuing command / event / interaction (optional).
   * @returns {undefined}
   */
  debug = (message, listener = null) => enable_logger_debug && print({
    filename: listener?.filename || this?.filename,
    logMessage: message,
    logFunction: console.debug,
    listener
  });
}

/**
 * Print the log to the console.
 * TODO: send to Discord threads
 * @param {object} param
 * @param {string} param.filename
 * @param {string} param.logMessage
 * @param {Function} param.logFunction
 * @param {Listener?} param.listener
 */
export function print({ filename, logMessage, logFunction, listener = null }) {
  let text = enable_logger_timestamps
    ? `${date.format(new Date(), "M/D/YY H:mm:ss")} ${filename}`
    : `${filename}`;

  if (console.log === logFunction) text = chalk.greenBright(text);
  else if (console.warn === logFunction) text = chalk.yellow(text);
  else if (console.error === logFunction) text = chalk.red(text);
  else if (console.debug === logFunction) text = chalk.gray(`# ${text}`);
  else throw new Error("Invalid logFunction was provided.");

  if (listener?.id) text += console.debug === logFunction
    ? ` ${chalk.gray("[")}${chalk.gray(`"${listener.id}"`)}${chalk.gray("]")}`
    : ` ${chalk.yellowBright("[")}${chalk.cyanBright(`"${listener.id}"`)}${chalk.yellowBright("]")}`;

  if (logMessage.stack) {
    const stack = logMessage.stack.split("\n");
    const header = stack.shift();
    const body = stack.map(item => `    ${item.trim()}`).join("\n");
    text += ` → ${header}\n${body}`;
  }

  else if (typeof logMessage === "object") {
    const name = logMessage.constructor.name;
    const json = JSON.stringify(logMessage, null, 4);
    text += ` → ${name}\n${json}`;
  }

  else {
    text += ` → ${logMessage}`;
  }

  text = text.replace(/\((.*?)\)$/gm, chalk.gray("($1)"));
  text = chalk.white(text);
  logFunction(text);
}

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #endregion SERVICE LOGIC                                                  //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////
