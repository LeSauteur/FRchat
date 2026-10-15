// Runs in the browser. Conservative gradient endpoint checks enforce >=4.5 even for large text.
export function inspectContrast() {
  function rgba(value) {
    const match = value.match(/^rgba?\(([^)]+)\)$/);
    if (!match) throw new Error(`Unsupported computed color: ${value}`);
    const parts = match[1].split(/[,\s/]+/).map(Number);
    return [...parts.slice(0, 3), parts[3] ?? 1];
  }
  function over(fg, bg) {
    const a = fg[3];
    return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a)).concat(1);
  }
  function lum(color) {
    const c = color.slice(0, 3).map((v) => {
      v /= 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function ratio(fg, bg) {
    const x = lum(fg),
      y = lum(bg);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  function backgrounds(element) {
    const chain = [];
    for (let node = element; node; node = node.parentElement)
      chain.unshift(node);
    let values = [[255, 255, 255, 1]];
    for (const node of chain) {
      const css = getComputedStyle(node),
        color = rgba(css.backgroundColor);
      values = values.map((bg) => over(color, bg));
      if (css.backgroundImage !== "none") {
        if (!css.backgroundImage.startsWith("linear-gradient("))
          throw new Error(
            "Unsupported background image in contrast measurement",
          );
        const stops = css.backgroundImage.match(/rgba?\([^)]+\)/g)?.map(rgba);
        if (!stops?.length) throw new Error("Unresolved gradient");
        values = values.flatMap((bg) => stops.map((stop) => over(stop, bg)));
      }
    }
    return values;
  }
  function selector(el) {
    return (
      el.tagName.toLowerCase() +
      (el.id ? "#" + el.id : "") +
      (el.classList.length ? "." + [...el.classList].join(".") : "")
    );
  }
  const findings = [],
    failures = [];
  function measure(el, color, kind) {
    if (
      !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) ||
      !el.getClientRects().length
    )
      return;
    const fg = rgba(color);
    let opacity = 1;
    for (let node = el; node; node = node.parentElement)
      opacity *= Number(getComputedStyle(node).opacity);
    fg[3] *= opacity;
    const worst = Math.min(
      ...backgrounds(el).map((bg) => ratio(over(fg, bg), bg)),
    );
    const row = {
      selector: selector(el),
      kind,
      ratio: Number(worst.toFixed(3)),
    };
    findings.push(row);
    if (worst < 4.5) failures.push(row);
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (
      node.textContent.trim() &&
      !["SCRIPT", "STYLE", "OPTION"].includes(node.parentElement.tagName)
    )
      measure(
        node.parentElement,
        getComputedStyle(node.parentElement).color,
        "text",
      );
  }
  for (const input of document.querySelectorAll(
    "input[placeholder],textarea[placeholder]",
  ))
    if (!input.value)
      measure(
        input,
        getComputedStyle(input, "::placeholder").color,
        "placeholder",
      );
  for (const control of document.querySelectorAll("select,input,textarea"))
    measure(control, getComputedStyle(control).color, "control");
  for (const svg of document.querySelectorAll("svg")) {
    for (const element of [svg, ...svg.querySelectorAll("[stroke],[fill]")])
      for (const name of ["stroke", "fill"]) {
        const attr = element.getAttribute(name);
        if (attr && !["none", "currentColor"].includes(attr))
          throw new Error("Hard-coded SVG paint");
      }
    measure(svg, getComputedStyle(svg).color, "icon");
  }
  return {
    tested: findings.length,
    minRatio: Math.min(...findings.map((f) => f.ratio)),
    failures,
  };
}
