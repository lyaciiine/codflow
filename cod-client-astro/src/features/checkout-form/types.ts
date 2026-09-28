/**
 * Checkout Form screen types.
 *
 * The policy shape itself is re-exported from cod-shared — one definition for
 * the server, this screen, and the storefront's projection. What is declared
 * here is only what the SCREEN needs: the draft a merchant is editing (custom
 * fields have no id until the server mints one) and the capabilities payload
 * the API ships alongside the policy.
 */

import type {
  CheckoutFormPolicy,
  CustomField,
  CustomFieldType,
  FieldState,
} from "../../../../cod-shared/checkout-form/policy";

export type { CheckoutFormPolicy, CustomField, CustomFieldType, FieldState };

/** A custom field being edited: `id` is absent until the server mints one. */
export interface CustomFieldDraft {
  id?: string;
  label: string;
  type: CustomFieldType;
  required: boolean;
  options?: string[];
  /** Local-only key so React can track a row that has no id yet. */
  key: string;
}

export interface CheckoutFormDraft {
  address: CheckoutFormPolicy["address"];
  notes: CheckoutFormPolicy["notes"];
  email: CheckoutFormPolicy["email"];
  deliveryOptions: { home: boolean; stopDesk: boolean };
  customFields: CustomFieldDraft[];
}

/**
 * The server's own rules, sent with every response.
 *
 * The screen renders its controls from these rather than from a second copy of
 * the limits, so raising a cap server-side raises it in the UI on the next load
 * with no client deploy.
 */
export interface CheckoutFormCapabilities {
  builtInFields: Record<string, { states: FieldState[]; default: FieldState }>;
  customFieldTypes: CustomFieldType[];
  limits: {
    MAX_CUSTOM_FIELDS: number;
    MAX_LABEL_LENGTH: number;
    MAX_OPTIONS: number;
    MAX_OPTION_LENGTH: number;
    [key: string]: number;
  };
}

export interface CheckoutFormResponse {
  policy: CheckoutFormPolicy;
  capabilities: CheckoutFormCapabilities;
}

/** One problem the server refused a save for, keyed by a path into the document. */
export interface CheckoutFormIssue {
  path: string;
  code: string;
  message: string;
}
