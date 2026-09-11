// Injected into browsed pages: Ctrl+wheel scrolls horizontally instead of zooming.
window.addEventListener(
  "wheel",
  e => {
    if (e.ctrlKey) {
      e.preventDefault();
      window.scrollBy({ left: e.deltaY, behavior: "auto" });
    }
  },
  { passive: false, capture: true },
);
