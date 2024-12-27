import { Utilities } from "../services/utilities.js";

/**
 * Schedules a new Cron job managed by `Emitter.js`.
 */
export default class CronJob {
  date = null;
  expression = "* * * * *";
  isEnabled = true;
  isTriggered = false;
  runOrder = -90; // run after services and before plugins

  func = () => {
    throw new Error("Function is not implemented.");
  };

  /**
   * Set the date that the Cron job will execute. (Not implemented yet!)
   * @param {Date} date
   * @returns {CronJob}
   */
  setDate(date) {
    Utilities.throwType(Date, date);
    this.date = date;
    return this;
  }

  /**
   * Set if the CronJob should be enabled. This is typically for debug / dependency purposes.
   * @param {boolean|Function|Promise<boolean>} isEnabled
   * @returns {CronJob}
   */
  setEnabled(isEnabled = true) {
    Utilities.throwTypes(["boolean", "Function", "AsyncFunction"], isEnabled);
    this.isEnabled = isEnabled;
    return this;
  }

  /**
   * Set the expression for this Cron job to execute on.
   * @param {string} expression
   * @returns {CronJob}
   */
  setExpression(expression) {
    Utilities.throwType("string", expression);
    this.expression = expression;
    return this;
  }

  /**
   * Set the function to be executed by the Cron job.
   * @param {Function} func
   * @returns {CronJob}
   */
  setFunction(func) {
    Utilities.throwTypes(["Function", "AsyncFunction"], func);
    this.func = func;
    return this;
  }

  /**
   * Set the order in which this listener sorts alongside other listeners of its kind.
   * This is typically only used for events (more specifically service events that are
   * dependencies for the bot. Such as loading config data or maintaining the messages
   * cache). A lower value will invoke sooner than most listeners. A higher value will
   * invoke later than most listeners.
   * @param {number} runOrder
   * @returns {Listener}
   */
  setRunOrder(runOrder) {
    Utilities.throwType("number", runOrder);
    this.runOrder = runOrder;
    return this;
  }

  /**
   * Set if the Cron job is triggered on create.
   * @param {boolean|Function|Promise<boolean>} isTriggered
   * @returns {CronJob}
   */
  setTriggered(isTriggered = true) {
    Utilities.throwTypes(["boolean", "Function", "AsyncFunction"], isTriggered);
    this.isTriggered = isTriggered;
    return this;
  }
}
