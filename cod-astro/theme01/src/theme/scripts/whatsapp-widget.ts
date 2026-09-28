/**
 * WhatsApp chat widget client script (theme layer).
 * Self-initialising, idempotent, accessible, zero dependencies.
 *
 * Implements:
 * - Launcher toggle + close button
 * - Escape key dismissal + focus return to launcher
 * - Click-outside dismissal
 * - Dynamic prefill resolution at click time
 * - One-time session attention pulse (~8s) suppressed under reduced motion
 */

import {
  resolvePrefillText,
  buildWhatsAppHref,
} from "@/theme/utils/whatsapp-prefill";

export function initWhatsAppWidget(
  container: HTMLElement | null = document.getElementById("wa-widget"),
): (() => void) | void {
  const root = container;
  if (!root) return;
  if (root.dataset.waInitialized === "true") return;
  root.dataset.waInitialized = "true";

  const launcher = root.querySelector<HTMLButtonElement>("#wa-launcher");
  const panel = root.querySelector<HTMLElement>("#wa-panel");
  const closeBtn = root.querySelector<HTMLButtonElement>("#wa-close");
  const ctaBtn = root.querySelector<HTMLAnchorElement>("#wa-cta");

  if (!launcher || !panel || !closeBtn || !ctaBtn) return;

  const rootEl = root;
  const launcherEl = launcher;
  const panelEl = panel;
  const closeBtnEl = closeBtn;
  const ctaBtnEl = ctaBtn;

  const baseHref = ctaBtnEl.getAttribute("data-base-href") || ctaBtnEl.href;
  const storeName = rootEl.dataset.storeName || "";
  const prefillGeneral = rootEl.dataset.prefillGeneral || "";
  const prefillProduct = rootEl.dataset.prefillProduct || "";
  const attentionEnabled = rootEl.dataset.attention === "true";

  let pulseTimer: ReturnType<typeof setTimeout> | null = null;

  function dismissPulse() {
    launcherEl.classList.remove("has-pulse");
    try {
      sessionStorage.setItem("wa_pulse_seen", "1");
    } catch {
      // Ignore private browsing restrictions
    }
  }

  // Attention pulse: ~8s after load, once per session, suppressed under prefers-reduced-motion
  if (attentionEnabled) {
    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let alreadySeen = false;
    try {
      alreadySeen = sessionStorage.getItem("wa_pulse_seen") === "1";
    } catch {
      alreadySeen = false;
    }

    if (!reducedMotion && !alreadySeen) {
      pulseTimer = setTimeout(() => {
        if (!panelEl.hasAttribute("data-open")) {
          launcherEl.classList.add("has-pulse");
        }
      }, 8000);
    }
  }

  function openPanel() {
    dismissPulse();
    panelEl.hidden = false;
    panelEl.setAttribute("data-open", "true");
    launcherEl.setAttribute("aria-expanded", "true");
    closeBtnEl.focus();
  }

  function closePanel() {
    panelEl.hidden = true;
    panelEl.removeAttribute("data-open");
    launcherEl.setAttribute("aria-expanded", "false");
    launcherEl.focus();
  }

  function onLauncherClick() {
    if (panelEl.hasAttribute("data-open")) {
      closePanel();
    } else {
      openPanel();
    }
  }

  function onCloseClick() {
    closePanel();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape" && panelEl.hasAttribute("data-open")) {
      closePanel();
    }
  }

  function onDocumentClick(e: MouseEvent) {
    if (!panelEl.hasAttribute("data-open")) return;
    const target = e.target as Node;
    if (!rootEl.contains(target)) {
      closePanel();
    }
  }

  function updateCtaHref() {
    const pageData = document.getElementById("page-data");
    const productName = pageData?.getAttribute("data-product-name") || null;
    const hasProduct = Boolean(productName);

    const template = hasProduct
      ? (prefillProduct || prefillGeneral)
      : prefillGeneral;

    let orderNumber: string | null = null;
    try {
      const params = new URLSearchParams(window.location.search);
      orderNumber = params.get("order");
    } catch {
      orderNumber = null;
    }

    const currentUrl = typeof window !== "undefined" ? window.location.href : "";

    const text = resolvePrefillText({
      template,
      storeName,
      productName,
      url: currentUrl,
      orderNumber,
    });

    ctaBtnEl.href = buildWhatsAppHref(baseHref, text);
  }

  function onCtaClick() {
    dismissPulse();
    updateCtaHref();
  }

  // Bind event listeners
  launcherEl.addEventListener("click", onLauncherClick);
  closeBtnEl.addEventListener("click", onCloseClick);
  ctaBtnEl.addEventListener("click", onCtaClick);
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("click", onDocumentClick);

  // Return teardown
  return () => {
    if (pulseTimer) clearTimeout(pulseTimer);
    launcherEl.removeEventListener("click", onLauncherClick);
    closeBtnEl.removeEventListener("click", onCloseClick);
    ctaBtnEl.removeEventListener("click", onCtaClick);
    document.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("click", onDocumentClick);
    delete rootEl.dataset.waInitialized;
  };
}

// Self-initialisation on DOM ready
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => initWhatsAppWidget());
  } else {
    initWhatsAppWidget();
  }
}
