/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useRef, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { TextInput, Spinner } from "@inkjs/ui";

export interface SearchSelectItem {
  readonly id: string;
  readonly label: string;
  readonly description: string;
}

export interface SearchPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | undefined;
}

export interface SearchSelectAppProps<T extends SearchSelectItem> {
  readonly initialQuery?: string;
  readonly placeholder?: string;
  readonly onSearch: (query: string, cursor: string | undefined) => Promise<SearchPage<T>>;
  readonly onSelect: (item: T) => void;
  readonly onCancel: () => void;
  readonly renderItem?: (item: T, isFocused: boolean) => React.ReactElement;
  readonly debounceMs?: number;
  readonly pageSize?: number;
}

const VISIBLE_ITEMS = 10;

export function SearchSelectApp<T extends SearchSelectItem>({
  initialQuery,
  placeholder,
  onSearch,
  onSelect,
  onCancel,
  renderItem,
  debounceMs = 300,
}: SearchSelectAppProps<T>): React.ReactElement {
  const [items, setItems] = useState<T[]>([]);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [hasSearched, setHasSearched] = useState(false);

  const queryRef = useRef(initialQuery ?? "");
  const nextCursorRef = useRef<string | undefined>(undefined);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fetchIdRef = useRef(0);
  const isLoadingMoreRef = useRef(false);

  const doSearch = useCallback(
    async (query: string, cursor: string | undefined) => {
      if (!query) {
        setItems([]);
        setHasSearched(false);
        nextCursorRef.current = undefined;
        return;
      }

      const isFirstPage = cursor === undefined;
      if (isFirstPage) {
        setIsLoading(true);
      } else {
        isLoadingMoreRef.current = true;
      }

      const fetchId = ++fetchIdRef.current;

      try {
        const page = await onSearch(query, cursor);

        if (fetchId !== fetchIdRef.current) return;

        if (isFirstPage) {
          setItems([...page.items] as T[]);
          setHighlightIndex(0);
        } else {
          setItems((prev) => [...prev, ...(page.items as T[])]);
        }

        nextCursorRef.current = page.nextCursor;
        setHasSearched(true);
        setError(undefined);
      } catch (e: unknown) {
        if (fetchId !== fetchIdRef.current) return;
        setError((e as Error).message ?? "Search failed");
      } finally {
        if (fetchId === fetchIdRef.current) {
          setIsLoading(false);
          isLoadingMoreRef.current = false;
        }
      }
    },
    [onSearch]
  );

  useEffect(() => {
    if (initialQuery) {
      doSearch(initialQuery, undefined);
    }
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleQueryChange = useCallback(
    (value: string) => {
      queryRef.current = value;

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = setTimeout(() => {
        nextCursorRef.current = undefined;
        doSearch(value, undefined);
      }, debounceMs);
    },
    [debounceMs, doSearch]
  );

  const handleSubmit = useCallback(() => {
    if (items.length > 0 && highlightIndex < items.length) {
      onSelect(items[highlightIndex]);
    } else if (queryRef.current) {
      doSearch(queryRef.current, undefined);
    }
  }, [items, highlightIndex, onSelect, doSearch]);

  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.downArrow && items.length > 0) {
      setHighlightIndex((prev) => {
        const next = Math.min(prev + 1, items.length - 1);

        if (next === items.length - 1 && nextCursorRef.current && !isLoadingMoreRef.current) {
          doSearch(queryRef.current, nextCursorRef.current);
        }

        return next;
      });
      return;
    }

    if (key.upArrow && items.length > 0) {
      setHighlightIndex((prev) => Math.max(prev - 1, 0));
      return;
    }
  });

  const defaultRenderItem = (item: T, isFocused: boolean): React.ReactElement => (
    <Box key={item.id} flexDirection="column">
      <Box>
        <Text color={isFocused ? "cyan" : "gray"}>
          {isFocused ? "\u25B8 " : "  "}
        </Text>
        <Text bold={isFocused}>{item.label}</Text>
      </Box>
      {item.description && (
        <Box marginLeft={4}>
          <Text dimColor>{item.description}</Text>
        </Box>
      )}
    </Box>
  );

  const itemRenderer = renderItem ?? defaultRenderItem;

  const windowStart = Math.max(0, Math.min(highlightIndex - Math.floor(VISIBLE_ITEMS / 2), items.length - VISIBLE_ITEMS));
  const windowEnd = Math.min(items.length, windowStart + VISIBLE_ITEMS);
  const visibleItems = items.slice(windowStart, windowEnd);

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold color="cyan">
          {placeholder ?? "Search"}: </Text>
        <TextInput
          defaultValue={initialQuery}
          onChange={handleQueryChange}
          onSubmit={handleSubmit}
        />
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {isLoading && items.length === 0 && (
          <Spinner label="Searching..." />
        )}

        {error && (
          <Text color="red">  Search failed: {error}</Text>
        )}

        {!isLoading && hasSearched && items.length === 0 && !error && (
          <Text dimColor>  No results found.</Text>
        )}

        {!hasSearched && !isLoading && (
          <Text dimColor>  Type to search...</Text>
        )}

        {windowStart > 0 && (
          <Text dimColor>  {"\u2191"} {windowStart} more above</Text>
        )}

        {visibleItems.map((item, i) =>
          itemRenderer(item, windowStart + i === highlightIndex)
        )}

        {windowEnd < items.length && (
          <Text dimColor>  {"\u2193"} {items.length - windowEnd} more below</Text>
        )}

        {isLoadingMoreRef.current && (
          <Spinner label="Loading more..." />
        )}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          {"\u2191\u2193"} navigate  Enter select  Esc cancel
        </Text>
      </Box>
    </Box>
  );
}
