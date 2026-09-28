import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initWhatsAppWidget } from "./whatsapp-widget";

describe("initWhatsAppWidget", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    sessionStorage.clear();
    vi.useFakeTimers();
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  function createWidgetDom(options: {
    attention?: string;
    prefillGeneral?: string;
    prefillProduct?: string;
    storeName?: string;
  } = {}) {
    const {
      attention = "true",
      prefillGeneral = "Hello {store}",
      prefillProduct = "Inquiry about {product} — {url}",
      storeName = "Algiers Shop",
    } = options;

    document.body.innerHTML = `
      <div id="wa-widget"
           class="wa-widget"
           data-store-name="${storeName}"
           data-prefill-general="${prefillGeneral}"
           data-prefill-product="${prefillProduct}"
           data-attention="${attention}">
        <button id="wa-launcher" aria-expanded="false" aria-controls="wa-panel" aria-label="Open WhatsApp">
          Launcher
        </button>
        <div id="wa-panel" role="dialog" hidden>
          <button id="wa-close" aria-label="Close">Close</button>
          <div id="wa-content">Hello there</div>
          <a id="wa-cta" href="https://wa.me/213551234567" data-base-href="https://wa.me/213551234567">Chat</a>
        </div>
      </div>
    `;

    return {
      container: document.getElementById("wa-widget")!,
      launcher: document.getElementById("wa-launcher") as HTMLButtonElement,
      panel: document.getElementById("wa-panel") as HTMLElement,
      closeBtn: document.getElementById("wa-close") as HTMLButtonElement,
      ctaBtn: document.getElementById("wa-cta") as HTMLAnchorElement,
    };
  }

  it("is inert when container is missing", () => {
    const teardown = initWhatsAppWidget(null);
    expect(teardown).toBeUndefined();
  });

  it("is idempotent when called multiple times on the same container", () => {
    const { container } = createWidgetDom();
    const teardown1 = initWhatsAppWidget(container);
    const teardown2 = initWhatsAppWidget(container);
    expect(teardown1).toBeTypeOf("function");
    expect(teardown2).toBeUndefined();
    teardown1?.();
  });

  it("toggles panel open on launcher click and focuses close button", () => {
    const { container, launcher, panel, closeBtn } = createWidgetDom();
    const teardown = initWhatsAppWidget(container);

    expect(panel.hidden).toBe(true);
    expect(launcher.getAttribute("aria-expanded")).toBe("false");

    launcher.click();

    expect(panel.hidden).toBe(false);
    expect(panel.getAttribute("data-open")).toBe("true");
    expect(launcher.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(closeBtn);

    teardown?.();
  });

  it("closes panel on close button click and returns focus to launcher", () => {
    const { container, launcher, panel, closeBtn } = createWidgetDom();
    const teardown = initWhatsAppWidget(container);

    launcher.click();
    expect(panel.hidden).toBe(false);

    closeBtn.click();
    expect(panel.hidden).toBe(true);
    expect(panel.hasAttribute("data-open")).toBe(false);
    expect(launcher.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(launcher);

    teardown?.();
  });

  it("closes panel on Escape key", () => {
    const { container, launcher, panel } = createWidgetDom();
    const teardown = initWhatsAppWidget(container);

    launcher.click();
    expect(panel.hidden).toBe(false);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(panel.hidden).toBe(true);
    expect(launcher.getAttribute("aria-expanded")).toBe("false");

    teardown?.();
  });

  it("closes panel on click outside", () => {
    const { container, launcher, panel } = createWidgetDom();
    const teardown = initWhatsAppWidget(container);

    const outsideElement = document.createElement("div");
    document.body.appendChild(outsideElement);

    launcher.click();
    expect(panel.hidden).toBe(false);

    outsideElement.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(panel.hidden).toBe(true);

    teardown?.();
  });

  it("resolves general prefill text when page has no product", () => {
    const { container, ctaBtn } = createWidgetDom({
      storeName: "MyStore",
      prefillGeneral: "Inquiry to {store}",
    });
    const teardown = initWhatsAppWidget(container);

    ctaBtn.click();
    expect(ctaBtn.href).toBe("https://wa.me/213551234567?text=Inquiry%20to%20MyStore");

    teardown?.();
  });

  it("resolves product prefill text when #page-data has data-product-name", () => {
    const { container, ctaBtn } = createWidgetDom({
      storeName: "MyStore",
      prefillProduct: "Interested in {product}",
    });

    const pageData = document.createElement("div");
    pageData.id = "page-data";
    pageData.setAttribute("data-product-name", "Sneakers DZ");
    document.body.appendChild(pageData);

    const teardown = initWhatsAppWidget(container);

    ctaBtn.click();
    expect(ctaBtn.href).toBe("https://wa.me/213551234567?text=Interested%20in%20Sneakers%20DZ");

    teardown?.();
  });

  it("triggers attention pulse ~8s after load and dismisses on interaction", () => {
    const { container, launcher } = createWidgetDom({ attention: "true" });
    const teardown = initWhatsAppWidget(container);

    expect(launcher.classList.contains("has-pulse")).toBe(false);

    vi.advanceTimersByTime(8000);
    expect(launcher.classList.contains("has-pulse")).toBe(true);

    launcher.click();
    expect(launcher.classList.contains("has-pulse")).toBe(false);
    expect(sessionStorage.getItem("wa_pulse_seen")).toBe("1");

    teardown?.();
  });

  it("suppresses attention pulse if reduced-motion is preferred", () => {
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const { container, launcher } = createWidgetDom({ attention: "true" });
    const teardown = initWhatsAppWidget(container);

    vi.advanceTimersByTime(9000);
    expect(launcher.classList.contains("has-pulse")).toBe(false);

    teardown?.();
  });

  it("suppresses attention pulse if already seen in current session", () => {
    sessionStorage.setItem("wa_pulse_seen", "1");

    const { container, launcher } = createWidgetDom({ attention: "true" });
    const teardown = initWhatsAppWidget(container);

    vi.advanceTimersByTime(9000);
    expect(launcher.classList.contains("has-pulse")).toBe(false);

    teardown?.();
  });

  it("teardown cleans up initialized dataset and listeners", () => {
    const { container, launcher, panel } = createWidgetDom();
    const teardown = initWhatsAppWidget(container);
    expect(container.dataset.waInitialized).toBe("true");

    teardown?.();
    expect(container.dataset.waInitialized).toBeUndefined();

    // Clicking launcher after teardown should do nothing
    launcher.click();
    expect(panel.hidden).toBe(true);
  });
});
