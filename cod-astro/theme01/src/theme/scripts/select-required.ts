/**
 * Required-answer validation for the custom dropdowns.
 *
 * `Select.astro` is a button plus a listbox, and it keeps the chosen value in a
 * `type="hidden"` input. Hidden inputs are **barred from constraint validation**
 * by the HTML spec, so `required` on one is inert: the browser submits a form
 * with an unanswered dropdown without a word, and the shopper only learns from
 * cod-server's reply a round trip later. Wilaya and commune have always behaved
 * that way; a merchant's own required dropdown inherits it.
 *
 * The two obvious fixes are both worse:
 *
 *   - Making the input non-hidden but visually hidden hands the browser a
 *     control it cannot show. Chrome refuses to submit, logs "not focusable",
 *     and displays nothing — a dead button with no message, which is exactly the
 *     failure the address field had.
 *   - A native `<select>` behind the custom one means two sources of truth for
 *     the value, and the searchable list is the reason this component exists.
 *
 * So the validation is ours. It blocks the submit, marks the offending dropdown,
 * shows the message the component rendered, and moves focus to the trigger —
 * which, unlike the hidden input, is a real visible control.
 *
 * Bound on `document` in the CAPTURE phase on purpose: the product page's own
 * submit handler disables the confirm button, and if that ran first a blocked
 * submit would leave the shopper staring at a dead button. Capturing on an
 * ancestor runs before every listener on the form itself, whatever order the
 * page's scripts happen to load in.
 */

const CONTAINER = ".custom-select-container";
const HIDDEN_INPUT = ".select-hidden-input";
const MESSAGE = ".select-required-msg";
const TRIGGER = 'button[id$="-trigger"]';

const ERROR_CLASSES = ["!border-red-400", "!bg-red-50"];

export interface UnansweredSelect {
  container: HTMLElement;
  trigger: HTMLButtonElement | null;
}

/**
 * The required dropdowns in this form that have no answer, in DOM order.
 *
 * A dropdown that is not rendered is skipped. Blocking a submit on a control the
 * shopper cannot see is the trap this module exists to avoid, not one to
 * recreate — and `offsetParent` is null exactly when an ancestor is hidden.
 */
export function findUnansweredSelects(form: HTMLFormElement): UnansweredSelect[] {
  const unanswered: UnansweredSelect[] = [];

  for (const container of form.querySelectorAll<HTMLElement>(CONTAINER)) {
    const input = container.querySelector<HTMLInputElement>(HIDDEN_INPUT);
    if (!input?.required) continue;
    if (container.offsetParent === null) continue;
    if (input.value.trim() !== "") continue;
    unanswered.push({ container, trigger: container.querySelector<HTMLButtonElement>(TRIGGER) });
  }

  return unanswered;
}

function setInvalid(container: HTMLElement, invalid: boolean): void {
  const trigger = container.querySelector<HTMLButtonElement>(TRIGGER);
  const message = container.querySelector<HTMLElement>(MESSAGE);

  if (trigger) {
    trigger.classList.toggle(ERROR_CLASSES[0], invalid);
    trigger.classList.toggle(ERROR_CLASSES[1], invalid);
    // Announced, not just coloured: the message is useless to a shopper who
    // cannot see the red border.
    if (invalid) trigger.setAttribute("aria-invalid", "true");
    else trigger.removeAttribute("aria-invalid");
  }
  if (message) message.hidden = !invalid;
}

/**
 * Start enforcing required dropdowns for every form on the page.
 *
 * Idempotent, and returns a teardown. The page scripts self-initialise on
 * import, and a layout that also called this would otherwise validate twice and
 * block the same submit with two listeners.
 */
export function initRequiredSelects(): () => void {
  const flag = "__selectRequiredBound";
  const target = window as unknown as Record<string, unknown>;
  if (target[flag]) return () => {};
  target[flag] = true;

  const onSubmit = (event: Event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;

    const unanswered = findUnansweredSelects(form);

    // Clear every dropdown first so a previously flagged one stops showing an
    // error the moment it has an answer, even if the submit fails elsewhere.
    for (const container of form.querySelectorAll<HTMLElement>(CONTAINER)) {
      setInvalid(container, false);
    }
    for (const { container } of unanswered) setInvalid(container, true);

    if (unanswered.length === 0) return;

    event.preventDefault();
    // Stops the form's own handlers — the page's submit guard disables the
    // confirm button, and a blocked submit must not leave it disabled.
    event.stopPropagation();

    const first = unanswered[0];
    first.trigger?.focus();
    first.container.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  // Select.astro dispatches a bubbling `change` on its hidden input when an
  // option is picked, so the error clears as soon as the shopper answers rather
  // than at the next submit.
  const onChange = (event: Event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.classList.contains("select-hidden-input")) {
      return;
    }
    const container = input.closest<HTMLElement>(CONTAINER);
    if (container && input.value.trim() !== "") setInvalid(container, false);
  };

  document.addEventListener("submit", onSubmit, true);
  document.addEventListener("change", onChange);

  return () => {
    document.removeEventListener("submit", onSubmit, true);
    document.removeEventListener("change", onChange);
    target[flag] = false;
  };
}
