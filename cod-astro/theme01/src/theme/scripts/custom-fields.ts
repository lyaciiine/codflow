/**
 * Custom checkout fields — collecting the answers at submit.
 *
 * The merchant's questions are rendered by CustomFieldRow.astro, but their
 * answers do not travel as their own form fields. They are gathered into one
 * hidden JSON input, because the platform's order action validates form input
 * against a fixed whitelist and strips everything else: one whitelisted JSON
 * key survives any policy, while a flat field per question would mean a theme
 * deploy every time a merchant adds one.
 *
 * Shared by the product/landing form and the basket checkout so the two cannot
 * drift — the same reason delivery-fields.ts exists.
 *
 * Nothing here validates. cod-server checks every answer against the field
 * definition it holds, and an answer this function fails to collect is simply
 * absent, which a required field rejects server-side with a message naming it.
 */

export interface CustomFieldAnswerPayload {
  id: string;
  value: string;
}

/**
 * Read the answers currently on the page.
 *
 * Values come from each row's control, found by the id CustomFieldRow gives it.
 * Rows are read in DOM order, which is the order the merchant arranged, so the
 * payload reads the way the form reads.
 */
export function collectCustomFieldAnswers(root: ParentNode = document): CustomFieldAnswerPayload[] {
  const answers: CustomFieldAnswerPayload[] = [];

  for (const row of root.querySelectorAll<HTMLElement>("[data-custom-field]")) {
    const id = row.dataset.customField;
    if (!id) continue;

    // `#f-<id>` is the text input, the textarea, or — for a dropdown — the
    // hidden input Select.astro keeps the chosen value in.
    const control = row.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#f-${id}`);
    const value = control?.value?.trim() ?? "";
    // An empty answer is left out rather than sent as "": the two mean the same
    // thing to the server, and omitting it keeps the payload inside its cap.
    if (value !== "") answers.push({ id, value });
  }

  return answers;
}

/**
 * Keep the hidden JSON input in step with the form, on submit.
 *
 * Written at submit time rather than on every keystroke for the same reason the
 * basket is: the shopper can still change any answer, and what is posted must
 * be what they were looking at. Returns a teardown, and is safe to call when the
 * store has no custom fields — there is then no input and nothing to do.
 */
export function initCustomFields(form: HTMLFormElement | null): () => void {
  const input = document.getElementById("custom-field-responses-input") as HTMLInputElement | null;
  if (!form || !input) return () => {};

  const onSubmit = () => {
    input.value = JSON.stringify(collectCustomFieldAnswers(form));
  };

  form.addEventListener("submit", onSubmit);
  return () => form.removeEventListener("submit", onSubmit);
}
