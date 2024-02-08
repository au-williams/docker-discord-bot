import { basename } from "path";
import { fileURLToPath } from "url";

/**
 * Get the filename of where this function is invoked
 * @param {string} importMetaUrl import.meta.url
 * @returns {string} "example_plugin_name.js"
 */
export function getPluginFilename(importMetaUrl) {
  return basename(fileURLToPath(importMetaUrl));
}