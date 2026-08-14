import { SubmitButton } from "@/components/SubmitButton";
import { JOB_STATUSES, JOB_STATUS_LABELS } from "@/lib/constants";
import { createApplication } from "./actions";
import { QuickAddForm } from "./QuickAddForm";
import { LinkedInImport } from "@/components/LinkedInImport";
import { buttonClass, inputClass } from "@/lib/button";
import { PAGE_TITLE_RECORD } from "@/lib/type";

export default function NewApplicationPage() {
  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className={PAGE_TITLE_RECORD}>New application</h1>
        <p className="mt-1 text-sm text-[var(--tx-3)]">Paste a link or a job description and Claude fills in the rest.</p>

        {/* A link is what you have when you find something. Pasting the text is
            the step that sends you out of the app, so the link goes first. */}
        <div className="mt-4">
          <LinkedInImport />
        </div>

        <div className="mt-4 panel p-4 shadow-sm">
          <p className="mb-2 text-xs font-medium text-[var(--tx-3)]">Or paste the description text</p>
          <QuickAddForm />
        </div>
      </div>

      <details className="group">
        <summary className="cursor-pointer text-sm font-medium text-[var(--tx-2)] hover:text-[var(--tx)]">
          Or add manually
        </summary>
        <form action={createApplication} className="mt-4 space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-[var(--tx-2)]">Company</label>
              <input name="companyName" required className={`mt-1 ${inputClass("md")}`} />
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--tx-2)]">Drive folder name (if different)</label>
              <input name="driveFolderName" className={`mt-1 ${inputClass("md")}`} />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--tx-2)]">Role title</label>
            <input name="roleTitle" required className={`mt-1 ${inputClass("md")}`} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="text-xs font-medium text-[var(--tx-2)]">Status</label>
              <select name="status" defaultValue="LIVE_POSTING_FOUND" className={`mt-1 ${inputClass("md")}`}>
                {JOB_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {JOB_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--tx-2)]">Salary range</label>
              <input name="salaryRange" className={`mt-1 ${inputClass("md")}`} />
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--tx-2)]">Posting link</label>
              <input name="postingLink" type="url" className={`mt-1 ${inputClass("md")}`} />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--tx-2)]">Notes</label>
            <textarea name="notes" rows={2} className={`mt-1 ${inputClass("md")}`} />
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--tx-2)]">Job description (optional)</label>
            <textarea name="jobDescription" rows={8} className={`mt-1 font-mono ${inputClass("md")}`} />
          </div>
          <SubmitButton className={buttonClass("primary", "md")}>Create application</SubmitButton>
        </form>
      </details>
    </div>
  );
}
