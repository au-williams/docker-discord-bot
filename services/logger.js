import { Events } from "discord.js";
import chalk from "chalk";
import fs from "fs-extra";
import path from "path";

let client; // TODO: utilize Discord log channel

const { enable_debug_logs } = fs.readJsonSync("config.json");

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
  debug = (message, listener = null) => print({
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
  if (logFunction === console.debug && !enable_debug_logs) {
    return;
  }

  const primaryChalkColor = (() => {
    switch(logFunction) {
      case console.log: return chalk.greenBright;
      case console.warn: return chalk.yellow;
      case console.error: return chalk.red;
      case console.debug: return chalk.gray;
      default: throw new Error("Invalid logFunction was provided.");
    }
  })();

  // --------------------------------------------------------------------- //
  // Format the filename to include listener information                   //
  // --------------------------------------------------------------------- //

  let chalkFilename = logFunction === console.debug
    ? primaryChalkColor(`# ${filename}`)
    : primaryChalkColor(`${filename}`);

  if (listener?.id) {
    chalkFilename += logFunction === console.debug
      ? ` ${chalk.gray(`["${listener.id}"]`)}`
      : ` ${chalk.yellowBright("[")}${chalk.cyanBright(`"${listener.id}"`)}${chalk.yellowBright("]")}`;
  }

  // --------------------------------------------------------------------- //
  // Format the message to include stack information                       //
  // --------------------------------------------------------------------- //

  let chalkMessage = logMessage;

  if (chalkMessage.stack) {
    const stack = logMessage.stack.split("\n");
    const header = stack.shift();
    const body = stack.map(item => `    ${item.trim()}`).join("\n");
    chalkMessage = `${header}\n${body}`;
  }

  else if (typeof chalkMessage === "object") {
    chalkMessage = `${chalkMessage.constructor.name}\n${JSON.stringify(chalkMessage, null, 4)}`;
  }

  chalkMessage = chalkMessage.replace(/\((.*?)\)/g, chalk.gray("($1)"));

  const chalkResult = `${chalkFilename} → ${chalkMessage}`;
  logFunction(chalk.white(chalkResult));
}

///////////////////////////////////////////////////////////////////////////////
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// #endregion SERVICE LOGIC                                                  //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
///////////////////////////////////////////////////////////////////////////////
