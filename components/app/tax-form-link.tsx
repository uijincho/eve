import { FileTextIcon } from "lucide-react";

import { LinkButton } from "@/components/app/link-button";
import type { Person } from "@/lib/contracts";
import { documentUrl } from "@/lib/client/api";

/**
 * Opens the signed tax form PDF in a new tab: the filled IRS W-8BEN, or Eve's
 * receipt for forms it does not fill. Nothing renders until a form is signed.
 */
export function TaxFormLink({ person, className }: { person: Pick<Person, "taxDocumentId" | "taxDocumentForm">; className?: string }) {
  if (!person.taxDocumentId) return null;
  const form = person.taxDocumentForm;
  const label = form === "W-8BEN" ? "View W-8BEN" : `View ${form === "Residency declaration" ? "declaration" : (form ?? "form")} receipt`;
  return (
    <LinkButton href={documentUrl(person.taxDocumentId)} external target="_blank" size="sm" variant="outline" className={className}>
      <FileTextIcon aria-hidden />
      {label}
    </LinkButton>
  );
}
