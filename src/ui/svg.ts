const SVG_NS = 'http://www.w3.org/2000/svg';

// Creates an SVG element with attributes (and optional text), appended to `parent`.
// SVG elements need createElementNS; plain createElement would make inert HTML tags.
export function svg<K extends keyof SVGElementTagNameMap>(
  parent: Element,
  tag: K,
  attrs: Record<string, string | number>,
  text?: string,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, String(value));
  if (text !== undefined) el.textContent = text;
  parent.appendChild(el);
  return el;
}
