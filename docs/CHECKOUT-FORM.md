# Checkout Form Control

The storefront order form is configurable per store: which details it asks for,
how strictly each one is enforced, and any extra questions the merchant wants to
ask. Dashboard → **Checkout form** (`/checkout-form`).

A store that never opens that page behaves exactly as it did before this feature
existed. The column is `NULL`, which means "the defaults", and the defaults are
the original form.

---

## What a merchant can change

| Field | States | Notes |
|---|---|---|
| Full name, phone, wilaya, commune | — | **Always required.** COD dispatch needs a name and phone, the wilaya→commune pair sets the delivery price, and the normalised phone is how a returning customer is recognised. The dashboard shows them as locked rows with the reason. |
| Address | required · optional | **Cannot be hidden.** Every carrier adapter sends the address for a home delivery (`orders/dispatch.ts`), so a store that stopped collecting it would be shipping parcels the carrier rejects. Required applies to **home delivery only** — a stop-desk parcel is collected at the desk. |
| Order notes | optional · hidden | Hiding it shortens checkout; customers can no longer leave delivery instructions. |
| Email | required · optional · hidden | Hidden by default. Stored on the order (`orders.customer_email`) when supplied. |
| Delivery options | home and/or stop desk | At least one must stay on. With one left, the storefront still shows how the order arrives, but not as a choice. |
| Custom questions | up to 5 | Short text, long text, number, or a list of choices. Each can be required. |

## Custom questions

A question is a label, an answer type, and whether an answer is required.
Answers appear on the order in the dashboard and are **never sent to carriers**
— they are information for the merchant, not dispatch data.

Two properties are worth knowing:

- **Ids are server-owned.** Saving a new question mints a `cf_xxxxxxxx` id. An
  id the store does not already have is refused, because ids are what an
  order's stored answers are keyed by — a client that could choose one could
  make a new question inherit an old question's history.
- **Answers are snapshots.** Each answer is stored with the label it had when
  the order was placed, so renaming or deleting a question later never rewrites
  what an old order says. The dashboard renders the snapshot, never the live
  configuration.

## Where the rules actually live

The storefront renders the merchant's configuration, but it does not enforce it.
**cod-server does**, on every order, the same way the OTP and Turnstile gates
work:

```
Dashboard  ── PUT /api/checkout-form ──▶  stores.checkout_form_json
                                              │
                          GET /store/config ──┤  (resolved policy, never the raw column)
                                              ▼
Storefront renders the form ── POST /store/orders ──▶ applyCheckoutPolicy()
                                                         │
                                        strip · reject · snapshot
```

Everything is decided once, in `cod-shared/checkout-form/`:

| File | Role |
|---|---|
| `policy.ts` | The shape, the defaults, the built-in field registry, and a **lenient** reader that never throws |
| `validate.ts` | The **strict** writer the dashboard saves through, plus id minting |
| `apply.ts` | Enforcement on the order path, and the order's answer snapshot |
| `messages.ts` | Rejection text in AR, FR and EN |

The read path is lenient and the write path is strict on purpose. Reading must
never fail — a store whose configuration was written by a newer deploy, or
corrupted by hand, has to keep selling with the original form rather than stop
taking orders. Writing must refuse anything it does not understand, because a
settings screen that quietly drops a key is how "my changes didn't save" bugs
are born.

### Strip or reject

Two outcomes, and which one a rule gets is deliberate:

- **Strip**, when honouring the configuration costs the shopper nothing. A
  hidden note or email that still arrives from an edge-cached page is dropped
  and the order goes through.
- **Reject**, when silently "fixing" the order would change what the shopper
  agreed to. A delivery option the merchant turned off is refused rather than
  rewritten, because rewriting it changes the delivery fee the shopper was
  shown. Refusals are written in the store's own language.

## What the email is used for

Two things, once a shopper gives one:

1. **Shown on the order** in the dashboard, next to the phone number.
2. **Sent to Meta as a hashed identifier** (`em`) on the Conversions API event.
   Email is the strongest signal Meta matches on after the phone, so an order
   that carries one is attributed better — most of the value in storing it.
   It is SHA-256 hashed before it leaves the Worker and never sent in the clear.

Staff can also enter one on the dashboard's **New order** form. It is optional
there whatever the storefront is configured to ask, for the same reason the
address rule differs on that path: staff on a call either have the address or
they do not, and a required box only gets a made-up value typed into it.

`customers.email` is deliberately **not** written. A returning phone reuses its
customer record untouched (see `store/CONTEXT.md`), and the order keeps the
snapshot instead.

## Required dropdowns

`Select.astro` (wilaya, commune, and any list question a merchant adds) keeps its
value in a `type="hidden"` input, and hidden inputs are **barred from constraint
validation** by the HTML spec. `required` on one is therefore inert: the browser
submits an unanswered dropdown without a word, and the shopper learns from the
server a round trip later.

`theme01/src/theme/scripts/select-required.ts` does that check instead — it blocks
the submit, reveals the message the component rendered, marks the trigger
`aria-invalid`, and moves focus there. Two details are load-bearing:

- It is bound on `document` in the **capture** phase, so it runs before the
  page's own submit handler, which disables the confirm button. If that ran
  first, a blocked submit would leave a dead button and no message.
- A dropdown that is not rendered is skipped. Blocking a submit over a control
  the shopper cannot see is the failure this replaces, not one to recreate.

## Permissions

Two scopes, so editing the order form can be granted separately from seeing it:

- `checkout_form:read` — view the configuration
- `checkout_form:manage` — change it

## Caching

`/products/[slug]` and `/lp/[slug]` are edge-cached (60s fresh, stale-while-
revalidate up to a day). A shopper can therefore be looking at a form that
predates a change. Because the server is the authority, **tightening** a rule
can refuse an order placed from a stale page — with a message in the store's
language telling the shopper to refresh. Loosening a rule never refuses
anything. The dashboard says so on the page.

## Rollback

```sql
UPDATE stores SET checkout_form_json = NULL;
```

Every store reads that as the original form. The three columns added by
migration `0031` (`stores.checkout_form_json`, `orders.customer_email`,
`orders.custom_fields_json`) are additive and nullable, so no down-migration is
needed for a code rollback — an order placed under a configuration is an
ordinary CodFlow order.

## Not included

Per-product or per-landing-page overrides · questions that appear based on
another answer · custom answers reaching carriers or pricing · per-shopper
translation of merchant-written labels · editing the built-in field labels
(those are storefront content, in the store's content strings) · applying the
policy to the dashboard's own manual order form, which is a staff path with its
own rules.
