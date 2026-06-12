/**
 * Cursor pagination over Gong list endpoints. The API pages at 100 records and
 * reports progress in `records`: `totalRecords` is the full count for the
 * filter, `cursor` is present while more pages remain.
 */
export interface PageRecords {
  totalRecords?: number;
  currentPageSize?: number;
  cursor?: string;
}

export interface ScanResult<TPage> {
  pages: TPage[];
  pagesScanned: number;
  /** True iff the scan stopped at `maxPages` while a cursor remained. */
  truncated: boolean;
  totalRecords?: number;
}

export async function scanPages<TPage extends { records?: PageRecords }>(
  fetchPage: (cursor?: string) => Promise<TPage>,
  maxPages: number,
): Promise<ScanResult<TPage>> {
  const pages: TPage[] = [];
  let cursor: string | undefined;
  let totalRecords: number | undefined;
  for (let i = 0; i < maxPages; i++) {
    const page = await fetchPage(cursor);
    pages.push(page);
    totalRecords = page.records?.totalRecords ?? totalRecords;
    cursor = page.records?.cursor;
    if (!cursor) break;
  }
  return { pages, pagesScanned: pages.length, truncated: cursor !== undefined, totalRecords };
}
