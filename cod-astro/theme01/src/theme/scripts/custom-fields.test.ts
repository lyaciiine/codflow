/**
 * Collecting the answers to the merchant's own questions.
 *
 * This is the narrowest bridge in the feature: the shopper types into ordinary
 * controls, and this module is the only thing that turns what they typed into
 * the single JSON field cod-server reads. If it silently returns nothing, a
 * required question rejects the order and the shopper cannot get past it — with
 * everything visibly filled in. So the contract is pinned in both directions:
 * what it collects, and what it leaves out.
 */
/// <reference types="vitest/globals" />

import { collectCustomFieldAnswers, initCustomFields } from "./custom-fields";

/** The markup CustomFieldRow.astro emits, for each supported answer type. */
function row(id: string, type: "text" | "number" | "textarea" | "select", value = ""): string {
  if (type === "textarea") {
    return `<div data-custom-field="${id}" data-custom-field-type="textarea">
      <textarea id="f-${id}">${value}</textarea>
    </div>`;
  }
  if (type === "select") {
    // Select.astro keeps the chosen option in a hidden input carrying the id.
    return `<div data-custom-field="${id}" data-custom-field-type="select">
      <button id="f-${id}-trigger" type="button"></button>
      <input type="hidden" id="f-${id}" class="select-hidden-input" value="${value}" />
    </div>`;
  }
  return `<div data-custom-field="${id}" data-custom-field-type="${type}">
    <input id="f-${id}" type="${type === "number" ? "number" : "text"}" value="${value}" />
  </div>`;
}

function mount(rows: string, withInput = true): HTMLFormElement {
  document.body.innerHTML = `
    <form method="POST">
      <input id="f-name" name="customerName" value="Ahmed" />
      ${rows}
      ${withInput ? '<input type="hidden" name="customFieldResponses" id="custom-field-responses-input" value="[]" />' : ""}
      <button type="submit">Confirm</button>
    </form>`;
  return document.querySelector("form")!;
}

describe("collectCustomFieldAnswers", () => {
  it("collects a text answer", () => {
    mount(row("cf_abc12345", "text", "Evening"));
    expect(collectCustomFieldAnswers()).toEqual([{ id: "cf_abc12345", value: "Evening" }]);
  });

  it("collects a long-text answer", () => {
    mount(row("cf_abc12345", "textarea", "Blue gate, second floor"));
    expect(collectCustomFieldAnswers()).toEqual([
      { id: "cf_abc12345", value: "Blue gate, second floor" },
    ]);
  });

  it("collects a numeric answer", () => {
    mount(row("cf_abc12345", "number", "3"));
    expect(collectCustomFieldAnswers()).toEqual([{ id: "cf_abc12345", value: "3" }]);
  });

  it("reads a dropdown from the hidden input the Select keeps its value in", () => {
    mount(row("cf_abc12345", "select", "Morning"));
    expect(collectCustomFieldAnswers()).toEqual([{ id: "cf_abc12345", value: "Morning" }]);
  });

  it("trims what the shopper typed", () => {
    mount(row("cf_abc12345", "text", "  Evening  "));
    expect(collectCustomFieldAnswers()[0].value).toBe("Evening");
  });

  it("leaves out an unanswered question rather than sending an empty value", () => {
    // Empty and absent mean the same thing to the server, and omitting keeps the
    // payload inside its size cap.
    mount(row("cf_abc12345", "text", "") + row("cf_bbbbbbbb", "text", "Yes"));
    expect(collectCustomFieldAnswers()).toEqual([{ id: "cf_bbbbbbbb", value: "Yes" }]);
  });

  it("treats a whitespace-only answer as unanswered", () => {
    mount(row("cf_abc12345", "text", "   "));
    expect(collectCustomFieldAnswers()).toEqual([]);
  });

  it("reads questions in the order the merchant arranged them", () => {
    mount(
      row("cf_11111111", "text", "first") +
        row("cf_22222222", "text", "second") +
        row("cf_33333333", "text", "third"),
    );
    expect(collectCustomFieldAnswers().map((a) => a.id)).toEqual([
      "cf_11111111",
      "cf_22222222",
      "cf_33333333",
    ]);
  });

  it("returns nothing for a store with no custom questions", () => {
    mount("");
    expect(collectCustomFieldAnswers()).toEqual([]);
  });

  it("ignores a row whose control is missing rather than throwing", () => {
    // A theme that renamed the control would lose that answer; it must not take
    // the whole checkout down with it.
    document.body.innerHTML = `<form><div data-custom-field="cf_abc12345"></div></form>`;
    expect(() => collectCustomFieldAnswers()).not.toThrow();
    expect(collectCustomFieldAnswers()).toEqual([]);
  });

  it("scopes collection to the form it is given", () => {
    document.body.innerHTML = `
      <form id="a">${row("cf_11111111", "text", "in form")}</form>
      <div id="elsewhere">${row("cf_22222222", "text", "outside")}</div>`;
    const form = document.getElementById("a") as HTMLFormElement;
    expect(collectCustomFieldAnswers(form)).toEqual([{ id: "cf_11111111", value: "in form" }]);
  });
});

describe("initCustomFields", () => {
  it("writes the answers into the hidden input on submit", () => {
    const form = mount(row("cf_abc12345", "text", "Evening"));
    initCustomFields(form);

    const input = document.getElementById("custom-field-responses-input") as HTMLInputElement;
    expect(input.value).toBe("[]");

    form.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(JSON.parse(input.value)).toEqual([{ id: "cf_abc12345", value: "Evening" }]);
  });

  it("serialises at submit, so a late edit is what gets sent", () => {
    // The same reason the basket is serialised at submit: the shopper can keep
    // changing an answer, and the order must equal what they were looking at.
    const form = mount(row("cf_abc12345", "text", "Morning"));
    initCustomFields(form);

    const control = document.getElementById("f-cf_abc12345") as HTMLInputElement;
    control.value = "Evening";
    form.dispatchEvent(new Event("submit", { cancelable: true }));

    const input = document.getElementById("custom-field-responses-input") as HTMLInputElement;
    expect(JSON.parse(input.value)).toEqual([{ id: "cf_abc12345", value: "Evening" }]);
  });

  it("does nothing when the store has no custom questions", () => {
    // No hidden input is rendered in that case, and binding a submit handler
    // that writes nowhere would be a silent no-op waiting to confuse someone.
    const form = mount("", false);
    expect(() => initCustomFields(form)()).not.toThrow();
    expect(document.getElementById("custom-field-responses-input")).toBeNull();
  });

  it("does nothing without a form", () => {
    mount(row("cf_abc12345", "text", "Evening"));
    expect(() => initCustomFields(null)()).not.toThrow();
  });

  it("stops writing once torn down", () => {
    const form = mount(row("cf_abc12345", "text", "Evening"));
    const teardown = initCustomFields(form);
    teardown();

    form.dispatchEvent(new Event("submit", { cancelable: true }));
    const input = document.getElementById("custom-field-responses-input") as HTMLInputElement;
    expect(input.value).toBe("[]");
  });
});
