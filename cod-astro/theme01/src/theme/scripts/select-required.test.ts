/**
 * Required dropdowns, which the browser will not enforce for us.
 *
 * `Select.astro` keeps its value in a `type="hidden"` input, and hidden inputs
 * are barred from constraint validation by the HTML spec. So `required` on one
 * does nothing: before this module, an unanswered wilaya submitted silently and
 * the shopper learnt about it from the server a round trip later.
 *
 * The two things that must both hold, and that fight each other:
 *   1. an unanswered required dropdown BLOCKS the submit, visibly; and
 *   2. blocking never leaves the shopper stuck — not with a dead confirm button,
 *      and never over a control they cannot see.
 */
/// <reference types="vitest/globals" />

import { findUnansweredSelects, initRequiredSelects } from "./select-required";

let teardown: () => void = () => {};

afterEach(() => {
  teardown();
  teardown = () => {};
  document.body.innerHTML = "";
});

/** The markup Select.astro emits, trimmed to what validation touches. */
function selectMarkup(
  id: string,
  { required = true, value = "", withMessage = true } = {},
): string {
  return `
    <div class="custom-select-container" data-id="${id}">
      <button type="button" id="${id}-trigger" aria-haspopup="listbox"${
        withMessage ? ` aria-describedby="${id}-required"` : ""
      }></button>
      <input type="hidden" name="${id}" id="${id}" class="select-hidden-input" value="${value}" ${
        required ? "required" : ""
      } />
      ${withMessage ? `<p id="${id}-required" class="select-required-msg" hidden>Please choose an option</p>` : ""}
    </div>`;
}

function mount(inner: string): HTMLFormElement {
  document.body.innerHTML = `<form method="POST" id="order-form">${inner}
    <button type="submit" id="submit-btn">Confirm</button>
  </form>`;
  // happy-dom lays nothing out, so offsetParent is null for everything. The
  // module skips dropdowns it believes are not rendered, so tests must make
  // "rendered" true the same way a browser would report it.
  for (const el of document.querySelectorAll<HTMLElement>(".custom-select-container")) {
    Object.defineProperty(el, "offsetParent", { value: document.body, configurable: true });
  }
  return document.querySelector("form")!;
}

function hide(id: string): void {
  const container = document.querySelector<HTMLElement>(`[data-id="${id}"]`)!;
  Object.defineProperty(container, "offsetParent", { value: null, configurable: true });
}

const submit = (form: HTMLFormElement) =>
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

const messageOf = (id: string) => document.getElementById(`${id}-required`) as HTMLElement;
const triggerOf = (id: string) => document.getElementById(`${id}-trigger`) as HTMLButtonElement;

describe("findUnansweredSelects", () => {
  it("finds a required dropdown with no answer", () => {
    const form = mount(selectMarkup("f-wilaya"));
    expect(findUnansweredSelects(form).map((s) => s.container.dataset.id)).toEqual(["f-wilaya"]);
  });

  it("ignores one that has been answered", () => {
    const form = mount(selectMarkup("f-wilaya", { value: "16" }));
    expect(findUnansweredSelects(form)).toEqual([]);
  });

  it("treats a whitespace answer as no answer", () => {
    const form = mount(selectMarkup("f-wilaya", { value: "   " }));
    expect(findUnansweredSelects(form)).toHaveLength(1);
  });

  it("ignores a dropdown that is not required", () => {
    const form = mount(selectMarkup("f-colour", { required: false }));
    expect(findUnansweredSelects(form)).toEqual([]);
  });

  it("skips a dropdown the shopper cannot see", () => {
    // Blocking a submit over an invisible control is the exact failure this
    // module exists to prevent, not one to recreate.
    const form = mount(selectMarkup("f-hidden"));
    hide("f-hidden");
    expect(findUnansweredSelects(form)).toEqual([]);
  });

  it("returns them in DOM order, so the first is the one to focus", () => {
    const form = mount(selectMarkup("f-wilaya") + selectMarkup("f-commune"));
    expect(findUnansweredSelects(form).map((s) => s.container.dataset.id)).toEqual([
      "f-wilaya",
      "f-commune",
    ]);
  });

  it("only looks inside the form it was given", () => {
    mount(selectMarkup("f-wilaya"));
    document.body.insertAdjacentHTML("beforeend", `<div>${selectMarkup("f-elsewhere")}</div>`);
    const form = document.querySelector("form")!;
    expect(findUnansweredSelects(form).map((s) => s.container.dataset.id)).toEqual(["f-wilaya"]);
  });
});

describe("submitting with an unanswered required dropdown", () => {
  it("blocks the submit", () => {
    const form = mount(selectMarkup("f-wilaya"));
    teardown = initRequiredSelects();
    expect(submit(form)).toBe(false); // preventDefault was called
  });

  it("shows the message the component rendered", () => {
    const form = mount(selectMarkup("f-wilaya"));
    teardown = initRequiredSelects();
    expect(messageOf("f-wilaya").hidden).toBe(true);

    submit(form);
    expect(messageOf("f-wilaya").hidden).toBe(false);
  });

  it("marks the trigger invalid for assistive tech, not just in red", () => {
    const form = mount(selectMarkup("f-wilaya"));
    teardown = initRequiredSelects();

    submit(form);
    expect(triggerOf("f-wilaya").getAttribute("aria-invalid")).toBe("true");
    expect(triggerOf("f-wilaya").className).toContain("!border-red-400");
  });

  it("moves focus to the trigger, which is a control the shopper can actually see", () => {
    const form = mount(selectMarkup("f-wilaya"));
    teardown = initRequiredSelects();

    submit(form);
    expect(document.activeElement).toBe(triggerOf("f-wilaya"));
  });

  it("flags every unanswered dropdown but focuses the first", () => {
    const form = mount(selectMarkup("f-wilaya") + selectMarkup("f-commune"));
    teardown = initRequiredSelects();

    submit(form);
    expect(messageOf("f-wilaya").hidden).toBe(false);
    expect(messageOf("f-commune").hidden).toBe(false);
    expect(document.activeElement).toBe(triggerOf("f-wilaya"));
  });

  it("does not leave the confirm button disabled", () => {
    /**
     * The product page disables the confirm button on submit. This validator is
     * bound on document in the capture phase and stops propagation, so that
     * handler never runs — otherwise a blocked submit would hand the shopper a
     * dead button with no way forward, which is worse than the bug being fixed.
     */
    const form = mount(selectMarkup("f-wilaya"));
    teardown = initRequiredSelects();

    const submitBtn = document.getElementById("submit-btn") as HTMLButtonElement;
    form.addEventListener("submit", () => {
      submitBtn.disabled = true;
    });

    submit(form);
    expect(submitBtn.disabled).toBe(false);
  });
});

describe("submitting once the dropdowns are answered", () => {
  it("lets the form through", () => {
    const form = mount(selectMarkup("f-wilaya", { value: "16" }));
    teardown = initRequiredSelects();
    expect(submit(form)).toBe(true);
  });

  it("lets the page's own submit handlers run", () => {
    const form = mount(selectMarkup("f-wilaya", { value: "16" }));
    teardown = initRequiredSelects();

    const onSubmit = vi.fn();
    form.addEventListener("submit", onSubmit);

    submit(form);
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("clears a message left from an earlier attempt", () => {
    const form = mount(selectMarkup("f-wilaya"));
    teardown = initRequiredSelects();

    submit(form);
    expect(messageOf("f-wilaya").hidden).toBe(false);

    (document.getElementById("f-wilaya") as HTMLInputElement).value = "16";
    submit(form);
    expect(messageOf("f-wilaya").hidden).toBe(true);
    expect(triggerOf("f-wilaya").hasAttribute("aria-invalid")).toBe(false);
  });
});

describe("answering after being told", () => {
  it("clears the error as soon as an option is picked", () => {
    // Select.astro dispatches a bubbling change on its hidden input when an
    // option is chosen, so the shopper is not left reading an error they fixed.
    const form = mount(selectMarkup("f-wilaya"));
    teardown = initRequiredSelects();
    submit(form);
    expect(messageOf("f-wilaya").hidden).toBe(false);

    const input = document.getElementById("f-wilaya") as HTMLInputElement;
    input.value = "16";
    input.dispatchEvent(new Event("change", { bubbles: true }));

    expect(messageOf("f-wilaya").hidden).toBe(true);
    expect(triggerOf("f-wilaya").hasAttribute("aria-invalid")).toBe(false);
  });

  it("keeps the error when a change leaves it empty", () => {
    // Clearing the wilaya resets the commune to empty: that is not an answer.
    const form = mount(selectMarkup("f-commune"));
    teardown = initRequiredSelects();
    submit(form);

    const input = document.getElementById("f-commune") as HTMLInputElement;
    input.value = "";
    input.dispatchEvent(new Event("change", { bubbles: true }));

    expect(messageOf("f-commune").hidden).toBe(false);
  });
});

describe("binding", () => {
  it("binds once, so a second call cannot leak a listener past teardown", () => {
    /**
     * The page scripts self-initialise on import, and a layout that also calls
     * init binds twice — the repo has been bitten by exactly that (one tap
     * adding two cart items). Double-binding this validator looks harmless while
     * the page lives, because blocking twice blocks once. It shows up at
     * teardown: the second binding's teardown is the one nobody kept, so an
     * unguarded second call leaves a listener validating forever.
     */
    const form = mount(selectMarkup("f-wilaya"));
    const first = initRequiredSelects();
    initRequiredSelects(); // the teardown a caller would not think to keep
    first();

    expect(submit(form)).toBe(true);
    expect(messageOf("f-wilaya").hidden).toBe(true);
  });

  it("returns a no-op teardown from the second call, which cannot unbind the first", () => {
    const form = mount(selectMarkup("f-wilaya"));
    teardown = initRequiredSelects();
    const second = initRequiredSelects();

    second();
    expect(submit(form)).toBe(false);
  });

  it("stops validating after teardown", () => {
    const form = mount(selectMarkup("f-wilaya"));
    const unbind = initRequiredSelects();
    unbind();

    expect(submit(form)).toBe(true);
    expect(messageOf("f-wilaya").hidden).toBe(true);
  });

  it("does nothing to a page with no dropdowns", () => {
    const form = mount("");
    teardown = initRequiredSelects();
    expect(submit(form)).toBe(true);
  });

  it("survives a required dropdown the theme rendered without a message", () => {
    // A theme could omit requiredMessage; the submit must still be blocked
    // rather than the script throwing on a missing element.
    const form = mount(selectMarkup("f-wilaya", { withMessage: false }));
    teardown = initRequiredSelects();
    expect(submit(form)).toBe(false);
    expect(triggerOf("f-wilaya").getAttribute("aria-invalid")).toBe("true");
  });
});
