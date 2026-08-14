export const JOB_STATUSES = [
  // A company worth approaching, with no specific requisition behind it. Most
  // of the original inventory was this: a target list wearing an application's
  // clothes, which inflated the pipeline and buried the roles actually in play.
  "TARGET",
  "LIVE_POSTING_FOUND",
  "APPLIED",
  "INTERVIEWING",
  "OFFER",
  "VERIFY",
  "PASSED",
  "CLOSED_REJECTED",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

/**
 * Roles still in motion: everything that has not been passed on or rejected.
 *
 * The follow-up cadence and the Ask snapshot both need "is this still live",
 * and both had written their own copy of the list. A status added later would
 * have been silently missing from one of them.
 */
export const FOLLOW_UP_STATUSES = [
  "TARGET",
  "LIVE_POSTING_FOUND",
  "APPLIED",
  "INTERVIEWING",
  "OFFER",
  "VERIFY",
] as const satisfies readonly JobStatus[];

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  TARGET: "Target company",
  LIVE_POSTING_FOUND: "Live posting found",
  APPLIED: "Applied",
  INTERVIEWING: "Interviewing",
  OFFER: "Offer",
  VERIFY: "Verify",
  PASSED: "Passed / reviewed",
  CLOSED_REJECTED: "Closed / rejected",
};

// Groupings used for the dashboard columns.
export const STATUS_GROUPS: { label: string; statuses: JobStatus[] }[] = [
  { label: "Active pipeline", statuses: ["APPLIED", "INTERVIEWING", "OFFER"] },
  { label: "Live posting found", statuses: ["LIVE_POSTING_FOUND"] },
  { label: "Verify", statuses: ["VERIFY"] },
  { label: "Target companies", statuses: ["TARGET"] },
  { label: "Passed / reviewed", statuses: ["PASSED"] },
  { label: "Closed / rejected", statuses: ["CLOSED_REJECTED"] },
];

export const DOCUMENT_TYPES = [
  "resume",
  "cover_letter",
  "job_description",
  "interview_prep",
  "recruiter_response",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

// Filename stem used when a Document is downloaded as docx/pdf.
export const DOCUMENT_FILENAME_LABELS: Record<DocumentType, string> = {
  resume: "Resume",
  cover_letter: "CoverLetter",
  job_description: "JobDescription",
  interview_prep: "InterviewPrep",
  recruiter_response: "RecruiterResponse",
};

export const RECOMMENDATIONS = ["swing", "stretch", "pass"] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number];

// Only for changes that leave no dated row of their own. Anything that already
// creates one (a document version, an evaluation, a correspondence draft) is
// read off that row instead - see src/lib/activity.ts.
export const ACTIVITY_ACTIONS = [
  "status_changed",
  "details_edited",
  "notes_edited",
  "follow_up_completed",
  "follow_up_reopened",
  "document_deleted",
  "document_restored",
  "application_deleted",
  "application_restored",
] as const;
export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

export const WARM_THREAD_STATUSES = ["active", "dormant", "closed"] as const;
export type WarmThreadStatus = (typeof WARM_THREAD_STATUSES)[number];

export const CORRESPONDENCE_STATUSES = ["draft", "sent"] as const;
export type CorrespondenceStatus = (typeof CORRESPONDENCE_STATUSES)[number];

export const CORRESPONDENCE_TYPES = ["thank_you", "follow_up", "role_outreach", "general"] as const;
export type CorrespondenceType = (typeof CORRESPONDENCE_TYPES)[number];

export const CORRESPONDENCE_TYPE_LABELS: Record<CorrespondenceType, string> = {
  thank_you: "Thank you",
  follow_up: "Follow-up",
  // Telling somebody you know that you are applying to a specific posting.
  // Its own type because the register is unlike the others: it names a job,
  // makes no request, and must not invoke whatever favour exists between them.
  role_outreach: "Applying, letting them know",
  general: "General",
};

export const MAIL_CATEGORIES = [
  "application_confirmation",
  "rejection",
  "recruiter_outreach",
  "interview_invite",
  "offer",
  "other_job_related",
  "not_job_related",
] as const;
export type MailCategory = (typeof MAIL_CATEGORIES)[number];

export const MAIL_CATEGORY_LABELS: Record<MailCategory, string> = {
  application_confirmation: "Application received",
  rejection: "Rejection",
  recruiter_outreach: "Recruiter outreach",
  interview_invite: "Interview invite",
  offer: "Offer",
  other_job_related: "Job related",
  not_job_related: "Not job related",
};
