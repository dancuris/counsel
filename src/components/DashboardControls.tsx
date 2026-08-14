"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { JOB_STATUSES, JOB_STATUS_LABELS } from "@/lib/constants";

const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Recently updated" },
  { value: "company:asc", label: "Company (A → Z)" },
  { value: "company:desc", label: "Company (Z → A)" },
  { value: "role:asc", label: "Role (A → Z)" },
  { value: "role:desc", label: "Role (Z → A)" },
  { value: "salary:asc", label: "Salary (low → high)" },
  { value: "salary:desc", label: "Salary (high → low)" },
  { value: "status:asc", label: "Status" },
  { value: "lastChecked:desc", label: "Last checked (newest)" },
  { value: "lastChecked:asc", label: "Last checked (oldest)" },
];

export function DashboardControls({
  sortField,
  sortDir,
  q,
  status,
}: {
  sortField: string | null;
  sortDir: "asc" | "desc";
  q: string;
  status: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Stay on the page these controls are standing on.
  //
  // This pushed a hardcoded `/`, which was correct while the pipeline *was*
  // the index route. The split moved it to `/pipeline` and left this behind,
  // so typing into the search box waited 350ms and then threw you onto Today,
  // taking `?q=` with it to a page that does not read it. The status filter
  // and the sort dropdown did the same thing, which is why sorting the
  // pipeline appeared to do nothing at all.
  //
  // The general shape: a component that names its own route cannot be moved.
  // `usePathname` means these controls work wherever they are mounted.
  const pathname = usePathname();
  const [searchValue, setSearchValue] = useState(q);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function pushParams(patch: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
    }
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (searchValue !== q) pushParams({ q: searchValue });
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchValue]);

  const sortValue = sortField ? `${sortField}:${sortDir}` : "";

  return (
    <div className="border-b border-line px-4 py-3">
      {/*
        Say how the list is organised.
        
        The dropdown reads "Recently updated", which sounds like it describes
        the whole list and does not: rows are grouped by status first, and the
        sort only orders rows *within* each group. Dan said he could not tell
        why it sorted the way it did and thought the control had been removed.
        It was there; it was describing something he could not see.
      */}
      <p className="mb-2 text-[11.5px] text-[var(--tx-3)]">
        Grouped by status. Within each group:{" "}
        <span className="text-[var(--tx-2)]">
          {SORT_OPTIONS.find((o) => o.value === sortValue)?.label.toLowerCase() ?? "recently updated"}
        </span>
        .
      </p>
      <div className="flex flex-wrap items-center gap-2">
      <input
        value={searchValue}
        onChange={(e) => setSearchValue(e.target.value)}
        placeholder="Search company or role..."
        className="min-w-[180px] flex-1 rounded-lg border border-line px-3 py-2 text-[13px]"
      />
      <select
        value={status}
        onChange={(e) => pushParams({ status: e.target.value })}
        className="rounded-lg border border-line px-3 py-2 text-[13px]"
      >
        <option value="">All statuses</option>
        {JOB_STATUSES.map((s) => (
          <option key={s} value={s}>
            {JOB_STATUS_LABELS[s]}
          </option>
        ))}
      </select>
      <select
        value={sortValue}
        onChange={(e) => {
          const [field, dir] = e.target.value.split(":");
          if (field) document.cookie = `dashboardSort=${field}:${dir}; path=/; max-age=31536000`;
          else document.cookie = "dashboardSort=; path=/; max-age=0";
          pushParams({ sort: field || null, dir: dir || null });
        }}
        className="rounded-lg border border-line px-3 py-2 text-[13px]"
      >
        {SORT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      </div>
    </div>
  );
}
