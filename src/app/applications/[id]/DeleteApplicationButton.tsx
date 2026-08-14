"use client";

import { ConfirmButton } from "@/components/ConfirmButton";
import { deleteApplication } from "./actions";

/**
 * Deleting a role, confirmed in place rather than in a native dialog.
 *
 * `window.confirm` here was the last of the two survivors of the no-native-
 * dialogs rule. It also could not be dismissed the way everything else in this
 * app can, and on the phone it took the whole screen to ask about a row that
 * was right there.
 *
 * The application is soft-deleted and restorable, which is why this says
 * "hidden" rather than promising destruction it does not perform.
 */
export function DeleteApplicationButton({
  applicationId,
  companyId,
  companyName,
  roleTitle,
}: {
  applicationId: string;
  companyId: string;
  companyName: string;
  roleTitle: string;
}) {
  return (
    <ConfirmButton
      label="Delete this application"
      question={`Hide "${roleTitle}" at ${companyName}, with its notes, documents and correspondence?`}
      confirmLabel="Delete it"
      action={deleteApplication.bind(null, applicationId, companyId)}
      pendingLabel="Deleting..."
    />
  );
}
