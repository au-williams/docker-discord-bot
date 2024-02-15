
/**
 * Gets if two arrays are equal in their content
 * @param {Array} array1
 * @param {Array} array2
 * @returns {boolean}
 */
export function getIsEqualArrays(array1, array2) {
  return JSON.stringify(array1) === JSON.stringify(array2);
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
 * Splits a string by the desired size of returned items
 * (Example 1: "aabbccdd", 2 => ["aa", "bb", "cc", "dd"])
 * (Example 2: "abcdefgh", 3 => ["abc", "def", "gh"])
 * @param {String} str
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
