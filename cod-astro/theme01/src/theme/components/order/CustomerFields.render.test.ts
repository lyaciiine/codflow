// @vitest-environment node
// Node environment: under happy-dom the Astro plugin resolves `.astro` imports
// to the browser stub, which throws instead of rendering.
/**
 * What the order form actually emits for a given Checkout Form Policy.
 *
 * Rendered through Astro's Container API against the real components, because
 * the claim being tested is about markup, and a helper written to be testable
 * would not be the thing shoppers get served.
 *
 * The rule that matters most here: a hidden field ships NO markup. Not markup
 * that is disabled, not markup that is `display: none` — nothing. A field in
 * the DOM can be re-enabled from the console and posted, and while cod-server
 * would strip it anyway, a form that still contains what the merchant removed
 * is a form the merchant cannot trust.
 */
/// <reference types="vitest/globals" />

import { Window } from "happy-dom";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import CustomerFields from "./CustomerFields.astro";
import { en as enContent } from "@/theme/content/en";
import type { CheckoutFormPolicy } from "@/core/api/types";

const DEFAULTS: CheckoutFormPolicy = {
  address: "optional",
  notes: "optional",
  email: "hidden",
  deliveryOptions: { home: true, stopDesk: true },
  customFields: [],
};

async function render(formPolicy?: Partial<CheckoutFormPolicy>) {
  const container = await AstroContainer.create();
  return container.renderToString(CustomerFields, {
    props: {
      content: enContent,
      fieldErrors: {},
      isRTL: false,
      ...(formPolicy === undefined ? {} : { formPolicy: { ...DEFAULTS, ...formPolicy } }),
    },
  });
}

describe("no policy at all — a storefront talking to an older server", () => {
  it("renders the form exactly as it has always been", async () => {
    const html = await render(undefined);
    expect(html).toContain('name="customerName"');
    expect(html).toContain('name="phone"');
    expect(html).toContain('name="address"');
    expect(html).toContain('name="notes"');
    expect(html).toContain('value="home"');
    expect(html).toContain('value="stop_desk"');
    // No email field, which is what "before this feature" means.
    expect(html).not.toContain('name="email"');
  });
});

describe("the fixed fields are never configurable", () => {
  it("keeps name, phone, wilaya and commune under every policy", async () => {
    const html = await render({
      address: "required",
      notes: "hidden",
      email: "hidden",
      deliveryOptions: { home: true, stopDesk: false },
    });
    expect(html).toContain('name="customerName"');
    expect(html).toContain('name="phone"');
    expect(html).toContain('name="wilayaId"');
    expect(html).toContain('name="communeId"');
  });
});

describe("email", () => {
  it("ships no markup when hidden", async () => {
    expect(await render({ email: "hidden" })).not.toContain('name="email"');
  });

  it("renders an optional row without a required attribute", async () => {
    const html = await render({ email: "optional" });
    expect(html).toContain('name="email"');
    expect(html).toContain('type="email"');
    expect(html).toMatch(/<input[^>]*name="email"(?![^>]*required)/);
  });

  it("marks the field required when the merchant requires it", async () => {
    const html = await render({ email: "required" });
    expect(html).toMatch(/<input[^>]*name="email"[^>]*required/);
  });

  it("is laid out left-to-right, unlike the phone row", async () => {
    // An address typed into an RTL field reads backwards. The phone row must
    // NOT do this (it would left-align an Arabic placeholder and break the
    // paired row) — this field is its own row, so it is safe here.
    const html = await render({ email: "optional" });
    expect(html).toMatch(/<input[^>]*name="email"[^>]*dir="ltr"/);
    expect(html).not.toMatch(/<input[^>]*name="phone"[^>]*dir="ltr"/);
  });
});

describe("notes", () => {
  it("ships no markup when hidden", async () => {
    expect(await render({ notes: "hidden" })).not.toContain('name="notes"');
  });

  it("is rendered when the merchant keeps it", async () => {
    expect(await render({ notes: "optional" })).toContain('name="notes"');
  });
});

describe("address", () => {
  it("renders when optional or required", async () => {
    expect(await render({ address: "optional" })).toContain('name="address"');
    expect(await render({ address: "required" })).toContain('name="address"');
  });

  it("omits the address container entirely when hidden", async () => {
    const html = await render({ address: "hidden" });
    expect(html).not.toContain('name="address"');
    expect(html).not.toContain("address-field-container");
  });

  it("carries required and a marker the delivery toggle can read", async () => {
    // The marker exists because a required field inside the hidden address
    // container would make the form unsubmittable for stop-desk orders; the
    // toggle restores the requirement only while home delivery is selected.
    const html = await render({ address: "required" });
    expect(html).toMatch(/<input[^>]*id="f-address"[^>]*required/);
    expect(html).toContain('data-address-required="true"');
  });

  it("has no marker when it is optional", async () => {
    expect(await render({ address: "optional" })).not.toContain("data-address-required");
  });
});

describe("delivery options", () => {
  it("renders both when both are on", async () => {
    const html = await render({ deliveryOptions: { home: true, stopDesk: true } });
    expect(html).toContain('value="home"');
    expect(html).toContain('value="stop_desk"');
    // Two real choices: the cards behave like buttons.
    expect(html).toContain("cursor-pointer");
    expect(html).toContain("active:scale-95");
  });

  it("drops the option the merchant turned off", async () => {
    const html = await render({ deliveryOptions: { home: true, stopDesk: false } });
    expect(html).toContain('value="home"');
    expect(html).not.toContain('value="stop_desk"');
  });

  it("drops home delivery when that is the one turned off", async () => {
    const html = await render({ deliveryOptions: { home: false, stopDesk: true } });
    expect(html).toContain('value="stop_desk"');
    expect(html).not.toContain('value="home"');
  });

  it("shows a lone option without pretending it can be tapped", async () => {
    /**
     * The shopper still needs to know how the order arrives, so the card stays.
     * What goes is the behaviour of a button — tapping it does nothing, because
     * it is already the only answer — and any sentence about the option that is
     * missing. A shopper cannot miss a choice they were never offered, and
     * naming the absence only raises a question about it.
     */
    const html = await render({ deliveryOptions: { home: false, stopDesk: true } });
    expect(html).toContain('value="stop_desk"');
    // Still a checked radio, so the value is submitted.
    expect(html).toMatch(/<input[^>]*value="stop_desk"[^>]*checked/);
    expect(html).toContain("cursor-default");
    expect(html).not.toContain("cursor-pointer");
    expect(html).not.toContain("active:scale-95");
  });
});

describe("the fixed dropdowns get the same treatment", () => {
  it("wires a required message to wilaya and commune", async () => {
    // These have always had the inert-required bug; fixing it in the platform
    // component fixes it for them, not just for a merchant's new dropdown.
    const html = await render(undefined);
    expect(html).toMatch(/aria-describedby="f-wilaya-required"/);
    expect(html).toMatch(/aria-describedby="f-commune-required"/);
    expect(html.match(/select-required-msg/g)).toHaveLength(2);
  });
});

describe("custom fields", () => {
  const field = (over: Record<string, unknown> = {}) => ({
    id: "cf_abc12345",
    label: "Preferred time",
    type: "text" as const,
    required: false,
    ...over,
  });

  it("renders nothing, and no JSON input, when there are none", async () => {
    const html = await render({ customFields: [] });
    expect(html).not.toContain("data-custom-field");
    expect(html).not.toContain('name="customFieldResponses"');
  });

  it("adds the single JSON input the answers travel in", async () => {
    // One whitelisted key, not one per field — a merchant adding a question
    // must never need a theme deploy.
    const html = await render({ customFields: [field()] });
    expect(html).toContain('name="customFieldResponses"');
    expect(html.match(/name="customFieldResponses"/g)).toHaveLength(1);
  });

  it("renders a text field", async () => {
    const html = await render({ customFields: [field()] });
    expect(html).toContain('data-custom-field="cf_abc12345"');
    expect(html).toContain('id="f-cf_abc12345"');
    expect(html).toContain("Preferred time");
  });

  it("renders a textarea", async () => {
    const html = await render({ customFields: [field({ type: "textarea" })] });
    expect(html).toMatch(/<textarea[^>]*id="f-cf_abc12345"/);
  });

  it("renders a numeric input", async () => {
    const html = await render({ customFields: [field({ type: "number" })] });
    expect(html).toMatch(/<input[^>]*id="f-cf_abc12345"[^>]*type="number"/);
    expect(html).toMatch(/<input[^>]*id="f-cf_abc12345"[^>]*inputmode="numeric"/);
  });

  it("renders a dropdown with the merchant's choices", async () => {
    const html = await render({
      customFields: [field({ type: "select", options: ["Morning", "Evening"] })],
    });
    expect(html).toContain("Morning");
    expect(html).toContain("Evening");
  });

  it("marks a required question required", async () => {
    const html = await render({ customFields: [field({ required: true })] });
    expect(html).toMatch(/<input[^>]*id="f-cf_abc12345"[^>]*required/);
    expect(html).toContain("Preferred time *");
  });

  it("keeps the merchant's order", async () => {
    const html = await render({
      customFields: [
        field({ id: "cf_11111111", label: "First" }),
        field({ id: "cf_22222222", label: "Second" }),
      ],
    });
    expect(html.indexOf("cf_11111111")).toBeLessThan(html.indexOf("cf_22222222"));
  });

  it("gives a required dropdown the message the browser will not show", async () => {
    /**
     * Select.astro keeps its value in a type="hidden" input, and hidden inputs
     * are barred from constraint validation — so `required` on one is inert and
     * the browser submits an unanswered dropdown without a word. The message
     * element is what scripts/select-required.ts reveals instead, and it must be
     * in the markup (and wired to the trigger) for that to be possible.
     */
    const html = await render({
      customFields: [field({ type: "select", required: true, options: ["Morning"] })],
    });
    expect(html).toContain("select-required-msg");
    expect(html).toContain(enContent.formRequiredField);
    expect(html).toMatch(/aria-describedby="f-cf_abc12345-required"/);
  });

  it("leaves an optional dropdown without one — there is nothing to enforce", async () => {
    // Scoped to this field's own id: wilaya and commune are required in the
    // same form, so they legitimately carry a message of their own.
    const html = await render({
      customFields: [field({ type: "select", required: false, options: ["Morning"] })],
    });
    expect(html).not.toContain('id="f-cf_abc12345-required"');
    expect(html).not.toMatch(/aria-describedby="f-cf_abc12345-required"/);
  });

  it("cannot turn a label into an element", async () => {
    /**
     * A merchant's label is untrusted text on a public page, and it lands in two
     * places: a <label> text node and a placeholder attribute.
     *
     * Asserting "the html does not contain <img" would be the wrong test —
     * Astro escapes quotes inside an attribute but leaves `<` alone, so the raw
     * characters legitimately appear INSIDE the attribute value while being
     * unable to escape it. What actually matters is structural, so this parses
     * the output and asks the DOM: did an element appear?
     */
    const html = await render({
      customFields: [field({ label: '<img src=x onerror="alert(1)">' })],
    });
    const { window } = new Window();
    window.document.body.innerHTML = html;

    // The form ships its own inline scripts, so injected markup is identified
    // by the payload rather than by tag name alone.
    expect(window.document.querySelectorAll("img, iframe")).toHaveLength(0);
    expect(
      [...window.document.querySelectorAll("script")].filter((el) =>
        el.textContent?.includes("alert(1)"),
      ),
    ).toHaveLength(0);
    // The text node is escaped, which is what stops the label itself rendering.
    expect(html).toContain("&lt;img");
    // And the attribute cannot be closed early.
    expect(html).not.toMatch(/placeholder="[^"]*"[^>]*alert\(1\)/);
  });

  it("cannot turn a dropdown choice into an element", async () => {
    const html = await render({
      customFields: [field({ type: "select", options: ["<script>alert(1)</script>"] })],
    });
    const { window } = new Window();
    window.document.body.innerHTML = html;

    // Select.astro ships its own inline <script>, so count only injected ones.
    const injected = [...window.document.querySelectorAll("script")].filter((el) =>
      el.textContent?.includes("alert(1)"),
    );
    expect(injected).toHaveLength(0);
  });
});
