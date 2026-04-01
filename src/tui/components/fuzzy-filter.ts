/**
 * Shared fuzzy filtering utilities for select list components.
 */

export interface SearchableItemFields {
  searchText?: string;
  searchAliases?: string[];
}

export interface PreparedSearchItem {
  searchTextLower: string;
  labelLower: string;
  descriptionLower: string;
  searchAliasesLower: string[];
}

/**
 * Word boundary characters for matching.
 */
const WORD_BOUNDARY_CHARS = /[\s\-_./:#@]/;

/**
 * Check if position is at a word boundary.
 */
export function isWordBoundary(text: string, index: number): boolean {
  return index === 0 || WORD_BOUNDARY_CHARS.test(text[index - 1] ?? "");
}

/**
 * Find index where query matches at a word boundary in text.
 * Returns null if no match.
 */
export function findWordBoundaryIndex(text: string, query: string): number | null {
  if (!query) {
    return null;
  }
  const textLower = text.toLowerCase();
  const queryLower = query.toLowerCase();
  const maxIndex = textLower.length - queryLower.length;
  if (maxIndex < 0) {
    return null;
  }
  for (let i = 0; i <= maxIndex; i++) {
    if (textLower.startsWith(queryLower, i) && isWordBoundary(textLower, i)) {
      return i;
    }
  }
  return null;
}

/**
 * Fuzzy match with pre-lowercased inputs (avoids toLowerCase on every keystroke).
 * Returns score (lower = better) or null if no match.
 */
export function fuzzyMatchLower(queryLower: string, textLower: string): number | null {
  if (queryLower.length === 0) {
    return 0;
  }
  if (queryLower.length > textLower.length) {
    return null;
  }

  let queryIndex = 0;
  let score = 0;
  let lastMatchIndex = -1;
  let consecutiveMatches = 0;

  for (let i = 0; i < textLower.length && queryIndex < queryLower.length; i++) {
    if (textLower[i] === queryLower[queryIndex]) {
      const isAtWordBoundary = isWordBoundary(textLower, i);
      if (lastMatchIndex === i - 1) {
        consecutiveMatches++;
        score -= consecutiveMatches * 5; // Reward consecutive matches
      } else {
        consecutiveMatches = 0;
        if (lastMatchIndex >= 0) {
          score += (i - lastMatchIndex - 1) * 2;
        } // Penalize gaps
      }
      if (isAtWordBoundary) {
        score -= 10;
      } // Reward word boundary matches
      score += i * 0.1; // Slight penalty for later matches
      lastMatchIndex = i;
      queryIndex++;
    }
  }
  return queryIndex < queryLower.length ? null : score;
}

function findBoundaryPrefixIndex(textLower: string, queryLower: string): number | null {
  if (!queryLower) {
    return null;
  }
  if (textLower.startsWith(queryLower)) {
    return 0;
  }
  return findWordBoundaryIndex(textLower, queryLower);
}

type RankedPreparedSearchItem<T> = {
  item: T;
  tier: number;
  score: number;
  fieldLength: number;
};

function compareRankedItems<T>(
  a: RankedPreparedSearchItem<T>,
  b: RankedPreparedSearchItem<T>,
): number {
  if (a.tier !== b.tier) {
    return a.tier - b.tier;
  }
  if (a.score !== b.score) {
    return a.score - b.score;
  }
  if (a.fieldLength !== b.fieldLength) {
    return a.fieldLength - b.fieldLength;
  }
  return 0;
}

function resolveDeterministicRank(
  item: PreparedSearchItem,
  queryLower: string,
): RankedPreparedSearchItem<PreparedSearchItem> | null {
  if (!queryLower) {
    return { item, tier: 0, score: 0, fieldLength: item.labelLower.length };
  }

  if (item.labelLower === queryLower) {
    return { item, tier: 0, score: 0, fieldLength: item.labelLower.length };
  }

  const exactAlias = item.searchAliasesLower.find((alias) => alias === queryLower);
  if (exactAlias) {
    return { item, tier: 1, score: 0, fieldLength: exactAlias.length };
  }

  const labelPrefixIndex = findBoundaryPrefixIndex(item.labelLower, queryLower);
  if (labelPrefixIndex !== null) {
    return {
      item,
      tier: 2,
      score: labelPrefixIndex,
      fieldLength: item.labelLower.length,
    };
  }

  const aliasPrefix = item.searchAliasesLower
    .map((alias) => ({ alias, index: findBoundaryPrefixIndex(alias, queryLower) }))
    .filter((entry): entry is { alias: string; index: number } => entry.index !== null)
    .toSorted((left, right) => {
      if (left.index !== right.index) {
        return left.index - right.index;
      }
      return left.alias.length - right.alias.length;
    })[0];
  if (aliasPrefix) {
    return {
      item,
      tier: 3,
      score: aliasPrefix.index,
      fieldLength: aliasPrefix.alias.length,
    };
  }

  const labelIndex = item.labelLower.indexOf(queryLower);
  if (labelIndex !== -1) {
    return {
      item,
      tier: 4,
      score: labelIndex,
      fieldLength: item.labelLower.length,
    };
  }

  const aliasSubstring = item.searchAliasesLower
    .map((alias) => ({ alias, index: alias.indexOf(queryLower) }))
    .filter((entry) => entry.index !== -1)
    .toSorted((left, right) => {
      if (left.index !== right.index) {
        return left.index - right.index;
      }
      return left.alias.length - right.alias.length;
    })[0];
  if (aliasSubstring) {
    return {
      item,
      tier: 5,
      score: aliasSubstring.index,
      fieldLength: aliasSubstring.alias.length,
    };
  }

  const descriptionIndex = item.descriptionLower.indexOf(queryLower);
  if (descriptionIndex !== -1) {
    return {
      item,
      tier: 6,
      score: descriptionIndex,
      fieldLength: item.descriptionLower.length,
    };
  }

  const fuzzyScore = fuzzyMatchLower(queryLower, item.searchTextLower);
  if (fuzzyScore !== null) {
    return {
      item,
      tier: 7,
      score: fuzzyScore,
      fieldLength: item.labelLower.length,
    };
  }

  return null;
}

/**
 * Filter items using pre-lowercased searchTextLower field.
 * Supports space-separated tokens (all must match).
 */
export function fuzzyFilterLower<T extends { searchTextLower?: string }>(
  items: T[],
  queryLower: string,
): T[] {
  const trimmed = queryLower.trim();
  if (!trimmed) {
    return items;
  }

  const tokens = trimmed.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) {
    return items;
  }

  const results: { item: T; score: number }[] = [];
  for (const item of items) {
    const text = item.searchTextLower ?? "";
    let totalScore = 0;
    let allMatch = true;
    for (const token of tokens) {
      const score = fuzzyMatchLower(token, text);
      if (score !== null) {
        totalScore += score;
      } else {
        allMatch = false;
        break;
      }
    }
    if (allMatch) {
      results.push({ item, score: totalScore });
    }
  }
  results.sort((a, b) => a.score - b.score);
  return results.map((r) => r.item);
}

/**
 * Deterministically rank prepared search items, using fuzzy matching only as a fallback.
 *
 * Tiers:
 * 1. Exact label
 * 2. Exact alias
 * 3. Boundary-aware prefix in label
 * 4. Boundary-aware prefix in alias
 * 5. Substring in label
 * 6. Substring in alias
 * 7. Substring in description
 * 8. Fuzzy recall
 */
export function rankSearchItems<T extends PreparedSearchItem>(items: T[], queryLower: string): T[] {
  const trimmed = queryLower.trim();
  if (!trimmed) {
    return items;
  }

  return items
    .map((item) => resolveDeterministicRank(item, trimmed))
    .filter((entry): entry is RankedPreparedSearchItem<T> => Boolean(entry))
    .toSorted((left, right) => {
      const ranked = compareRankedItems(left, right);
      if (ranked !== 0) {
        return ranked;
      }
      return (left.item.label ?? left.item.searchAliasesLower[0] ?? "").localeCompare(
        right.item.label ?? right.item.searchAliasesLower[0] ?? "",
      );
    })
    .map((entry) => entry.item);
}

/**
 * Prepare items for fuzzy filtering by pre-computing lowercase search text.
 */
export function prepareSearchItems<
  T extends { label?: string; description?: string } & SearchableItemFields,
>(items: T[]): (T & PreparedSearchItem)[] {
  return items.map((item) => {
    const labelLower = (item.label ?? "").toLowerCase();
    const descriptionLower = (item.description ?? "").toLowerCase();
    const searchAliasesLower = (item.searchAliases ?? [])
      .map((alias) => alias.trim().toLowerCase())
      .filter(Boolean);
    const parts: string[] = [];
    if (item.label) {
      parts.push(item.label);
    }
    if (item.description) {
      parts.push(item.description);
    }
    if (item.searchText) {
      parts.push(item.searchText);
    }
    parts.push(...searchAliasesLower);
    return {
      ...item,
      searchTextLower: parts.join(" ").toLowerCase(),
      labelLower,
      descriptionLower,
      searchAliasesLower,
    };
  });
}
