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
