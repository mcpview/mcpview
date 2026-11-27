const INTERACTIVE_CHILD_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "[role='button']",
  "[role='link']",
].join(",");

export function eventStartedInInteractiveChild(
  element: HTMLElement,
  target: EventTarget | null,
): boolean {
  const candidate = target as (Element & { closest?: (selector: string) => Element | null }) | null;
  if (!candidate || typeof candidate.closest !== "function") return false;
  const interactive = candidate.closest(INTERACTIVE_CHILD_SELECTOR);
  return interactive !== null && interactive !== element && element.contains(interactive);
}
