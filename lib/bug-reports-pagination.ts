import type { BugReport } from "@/types/bug-report";

export type BugReportStatus = BugReport["status"];

export interface BugReportPage {
  records: BugReport[];
  nextCursor: string | null;
  previousCursor: string | null;
  hasMore: boolean;
  hasPrevious: boolean;
}

export interface FilterState {
  status: BugReportStatus | "all";
  severity: string | "all";
  author: string | "";
  tag: string | "all";
}

interface Cursor {
  createdAt: string;
  id: string;
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(value: string | null): Cursor | null {
  if (!value) return null;
  try {
    const cursor = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (typeof cursor.createdAt !== "string" || typeof cursor.id !== "string") {
      return null;
    }
    return cursor;
  } catch {
    return null;
  }
}

export function buildCursor(createdAt: string, id: string): string {
  return encodeCursor({ createdAt, id });
}

export function parseCursor(value: string | null): Cursor | null {
  return decodeCursor(value);
}

export function getCursorBoundary(
  direction: "before" | "after",
  record: BugReport
): string {
  return encodeCursor({ createdAt: record.createdAt, id: record.id });
}

export function paginateBugReports(
  reports: readonly BugReport[],
  options: {
    cursor?: string | null;
    limit?: number;
    status?: BugReportStatus | "all";
    severity?: string | "all";
    author?: string;
    tag?: string | "all";
  } = {},
): BugReportPage {
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 50);
  const filtered = [...reports]
    .filter((report) => !options.status || options.status === "all" || report.status === options.status)
    .filter((report) => !options.severity || options.severity === "all" || (report.priority as string) === options.severity)
    .filter((report) => !options.author || !report.reporterAddress || report.reporterAddress === options.author || report.reporterEmail === options.author)
    .filter((report) => !options.tag || options.tag === "all" || report.category === options.tag)
    .sort((left, right) => {
      const dateOrder = right.createdAt.localeCompare(left.createdAt);
      return dateOrder || right.id.localeCompare(left.id);
    });
  const cursor = decodeCursor(options.cursor ?? null);
  const start = cursor
    ? filtered.findIndex(
        (report) =>
          report.createdAt < cursor.createdAt ||
          (report.createdAt === cursor.createdAt && report.id < cursor.id),
      )
    : 0;
  const records = filtered.slice(start, start + limit);
  const last = records.at(-1);
  const first = records[0];
  const hasMore = start + records.length < filtered.length;
  const hasPrevious = start > 0;
  const previousCursor = hasPrevious && first
    ? encodeCursor({ createdAt: first.createdAt, id: first.id })
    : null;

  return {
    records,
    nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
    previousCursor,
    hasMore,
    hasPrevious,
  };
}

export function filterStateToURLParams(filters: FilterState): Record<string, string> {
  const params: Record<string, string> = {};
  if (filters.status && filters.status !== "all") {
    params.status = filters.status;
  }
  if (filters.severity && filters.severity !== "all") {
    params.severity = filters.severity;
  }
  if (filters.author) {
    params.author = filters.author;
  }
  if (filters.tag && filters.tag !== "all") {
    params.tag = filters.tag;
  }
  return params;
}

export function urlParamsToFilterParams(searchParams: Record<string, string | null>): FilterState {
  return {
    status: (searchParams.status as BugReportStatus) || "all",
    severity: searchParams.severity || "all",
    author: searchParams.author || "",
    tag: searchParams.tag || "all",
  };
}

export function applyOptimisticUpdate(
  reports: BugReport[],
  reportId: string,
  updates: Partial<Pick<BugReport, "status" | "rewardStatus" | "updatedAt">>
): BugReport[] {
  return reports.map((report) => {
    if (report.id === reportId) {
      return { ...report, ...updates };
    }
    return report;
  });
}
