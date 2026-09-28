import { ListChecks } from "lucide-react";
import { Card } from "@/components/ui";
import { useT } from "@/i18n/react";
import { parseCustomFieldAnswers } from "../../../../../cod-shared/checkout-form/apply";

/**
 * The shopper's answers to the merchant's own checkout questions.
 *
 * Rendered from the SNAPSHOT stored on the order, never from the live policy:
 * the merchant may have renamed or deleted a question since, and an order has to
 * keep reading the way it read on the day it was placed. That is why the label
 * travels with the answer.
 *
 * The card is absent entirely when the order carries no answers, which is every
 * order placed before the merchant added a question — and every order at a store
 * that never adds one.
 */
export function OrderCustomAnswersCard({ customFieldsJson }: { customFieldsJson?: string | null }) {
  const t = useT("orders");
  // Lenient by design: an unreadable snapshot shows as no answers rather than
  // taking the whole order page down.
  const answers = parseCustomFieldAnswers(customFieldsJson ?? null);
  if (answers.length === 0) return null;

  return (
    <Card title={t("detail.custom_answers")}>
      <dl className="space-y-4">
        {answers.map((answer) => (
          <div key={answer.id} className="flex items-start gap-3">
            <ListChecks size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              {/* Both are merchant/shopper text, rendered as React children so
                  they are escaped — never dangerouslySetInnerHTML. */}
              <dt className="text-xs font-semibold text-muted-foreground">{answer.label}</dt>
              <dd className="mt-1 text-sm font-semibold break-words">{answer.value}</dd>
            </div>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-xs text-muted-foreground">{t("detail.custom_answers_note")}</p>
    </Card>
  );
}
