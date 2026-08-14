"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { JOB_STATUS_LABELS, type JobStatus } from "@/lib/constants";

type Role = { id: string; roleTitle: string; status: string };

export function RoleSwitcher({
  companyId,
  companyName,
  roles,
  currentId,
}: {
  companyId: string;
  companyName: string;
  roles: Role[];
  currentId: string;
}) {
  const router = useRouter();

  if (roles.length <= 1) {
    return (
      <Link href={`/companies/${companyId}`} className="text-sm text-[var(--tx-3)] hover:text-accent hover:underline">
        {companyName}
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-[var(--tx-3)]">{companyName}</span>
      <select
        value={currentId}
        onChange={(e) => router.push(`/applications/${e.target.value}`)}
        className="rounded border border-accent/40 bg-accent-light px-2 py-0.5 text-xs font-medium text-accent-dark"
      >
        {roles.map((r) => (
          <option key={r.id} value={r.id}>
            {r.roleTitle} - {JOB_STATUS_LABELS[r.status as JobStatus] ?? r.status}
          </option>
        ))}
      </select>
      <Link href={`/companies/${companyId}`} className="text-xs text-[var(--tx-3)] hover:text-accent hover:underline">
        View all {roles.length}
      </Link>
    </div>
  );
}
