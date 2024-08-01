import { getIsEqualArrays, getIsNumericString, getTruncatedStringTerminatedByChar } from './utilities.js';

describe('getIsEqualArrays', () => {
  test('returns true for two identical arrays', () => {
    expect(getIsEqualArrays([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(getIsEqualArrays(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(true);
    expect(getIsEqualArrays([], [])).toBe(true);
  });

  test('returns false for arrays with different elements', () => {
    expect(getIsEqualArrays([1, 2, 3], [1, 2, 4])).toBe(false);
    expect(getIsEqualArrays(['a', 'b', 'c'], ['a', 'b', 'd'])).toBe(false);
    expect(getIsEqualArrays([1, 2, 3], [1, 2])).toBe(false);
  });

  test('returns false for arrays of different lengths', () => {
    expect(getIsEqualArrays([1, 2, 3], [1, 2, 3, 4])).toBe(false);
    expect(getIsEqualArrays(['a', 'b'], ['a', 'b', 'c'])).toBe(false);
  });

  test('handles nested arrays', () => {
    expect(getIsEqualArrays([[1, 2], [3, 4]], [[1, 2], [3, 4]])).toBe(true);
    expect(getIsEqualArrays([[1, 2], [3, 4]], [[1, 2], [4, 3]])).toBe(false);
  });

  test('handles arrays with different types of elements', () => {
    expect(getIsEqualArrays([1, '2', 3], [1, '2', 3])).toBe(true);
    expect(getIsEqualArrays([1, '2', 3], [1, 2, 3])).toBe(false);
  });

  test('handles edge cases', () => {
    expect(getIsEqualArrays(null, null)).toBe(true);
    expect(getIsEqualArrays(null, undefined)).toBe(false);
    expect(getIsEqualArrays(undefined, undefined)).toBe(true);
    expect(getIsEqualArrays([], null)).toBe(false);
    expect(getIsEqualArrays([], undefined)).toBe(false);
  });
});

describe('getIsNumericString', () => {
  test('returns true for numeric strings', () => {
    expect(getIsNumericString('123')).toBe(true);
    expect(getIsNumericString('123.45')).toBe(true);
    expect(getIsNumericString('-123.45')).toBe(true);
    expect(getIsNumericString('0')).toBe(true);
  });

  test('returns false for non-numeric strings', () => {
    expect(getIsNumericString('abc')).toBe(false);
    expect(getIsNumericString('123abc')).toBe(false);
    expect(getIsNumericString('')).toBe(false);
    expect(getIsNumericString(' ')).toBe(false);
  });

  test('returns false for non-string inputs', () => {
    expect(getIsNumericString(123)).toBe(false);
    expect(getIsNumericString(null)).toBe(false);
    expect(getIsNumericString(undefined)).toBe(false);
    expect(getIsNumericString({})).toBe(false);
    expect(getIsNumericString([])).toBe(false);
  });

  test('returns true for strings with leading and trailing spaces around numeric values', () => {
    expect(getIsNumericString(' 123 ')).toBe(true);
    expect(getIsNumericString(' 123.45 ')).toBe(true);
  });

  test('handles edge cases', () => {
    // expect(getIsNumericString('NaN')).toBe(false);
    // expect(getIsNumericString('Infinity')).toBe(false);
    // expect(getIsNumericString('-Infinity')).toBe(false);
    // expect(getIsNumericString('0x123')).toBe(false);
  });
});

describe('getTruncatedStringTerminatedByChar', () => {
  test('returns the original string if its length is less than or equal to maxLength', () => {
    expect(getTruncatedStringTerminatedByChar('short string', 20)).toBe('short string');
    expect(getTruncatedStringTerminatedByChar('exact length', 12)).toBe('exact length');
  });

  test('returns a truncated string with no ellipsis if maxLength is less than or equal to 3', () => {
    expect(getTruncatedStringTerminatedByChar('truncate', 3)).toBe('tru');
    expect(getTruncatedStringTerminatedByChar('truncate', 2)).toBe('tr');
    expect(getTruncatedStringTerminatedByChar('truncate', 1)).toBe('t');
  });

  test('returns a truncated string with ".." if maxLength is between 4 and 5 inclusive', () => {
    expect(getTruncatedStringTerminatedByChar('truncate', 5)).toBe('tru..');
    expect(getTruncatedStringTerminatedByChar('truncate', 4)).toBe('tr..');
  });

  test('returns a truncated string with "..." if maxLength is greater than 5', () => {
    expect(getTruncatedStringTerminatedByChar('this is a longer string', 10)).toBe('this is...');
    expect(getTruncatedStringTerminatedByChar('this is a longer string', 15)).toBe('this is a lo...');
  });

  test('handles edge cases', () => {
    expect(getTruncatedStringTerminatedByChar('', 5)).toBe('');
    expect(getTruncatedStringTerminatedByChar('short', 0)).toBe('');
    // expect(getTruncatedStringTerminatedByChar('short', -1)).toBe('');
    expect(getTruncatedStringTerminatedByChar('short', 1)).toBe('s');
  });
});