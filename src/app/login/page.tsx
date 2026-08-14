import type { Metadata } from "next";
import { PublicLanding } from "@/components/PublicLanding";

export const metadata: Metadata = {
  title: "Counsel",
  description:
    "Counsel is a private job-search assistant: it tracks applications, evaluates roles against a stored profile, and drafts tailored resumes and cover letters.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return <PublicLanding error={error} />;
}
