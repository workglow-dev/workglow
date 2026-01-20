/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { A11yState, BoundingBox, SerializedA11yNode } from "./A11yNode";

/**
 * Parser that extracts the accessibility tree from the DOM
 * 
 * This code is designed to run in the browser context and will be injected
 * into pages via page.evaluate()
 */

/**
 * Generate a unique ID for a node
 */
let nodeIdCounter = 0;
function generateNodeId(): string {
  return `a11y-node-${nodeIdCounter++}`;
}

/**
 * Compute the accessible name for an element
 * Following ARIA naming computation algorithm (simplified)
 */
function computeAccessibleName(element: Element): string {
  // Check aria-labelledby
  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const ids = labelledBy.split(/\s+/);
    const names = ids
      .map((id) => {
        const labelElement = document.getElementById(id);
        return labelElement ? labelElement.textContent?.trim() : "";
      })
      .filter(Boolean);
    if (names.length > 0) {
      return names.join(" ");
    }
  }

  // Check aria-label
  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel) {
    return ariaLabel.trim();
  }

  // Check associated label (for inputs)
  if (element instanceof HTMLElement) {
    const htmlElement = element as HTMLElement;
    
    // Check if wrapped in a label
    const labelAncestor = htmlElement.closest("label");
    if (labelAncestor) {
      const labelText = labelAncestor.textContent?.trim();
      if (labelText) {
        return labelText;
      }
    }

    // Check for label with for attribute
    if (htmlElement.id) {
      const label = document.querySelector(`label[for="${htmlElement.id}"]`);
      if (label) {
        const labelText = label.textContent?.trim();
        if (labelText) {
          return labelText;
        }
      }
    }
  }

  // Check alt attribute (for images)
  const alt = element.getAttribute("alt");
  if (alt !== null) {
    return alt.trim();
  }

  // Check title attribute
  const title = element.getAttribute("title");
  if (title) {
    return title.trim();
  }

  // Check placeholder (for inputs)
  const placeholder = element.getAttribute("placeholder");
  if (placeholder) {
    return placeholder.trim();
  }

  // Use text content as fallback
  if (element instanceof HTMLElement) {
    // For buttons, links, headings, use direct text content
    const tagName = element.tagName.toLowerCase();
    if (["button", "a", "h1", "h2", "h3", "h4", "h5", "h6", "summary"].includes(tagName)) {
      return element.textContent?.trim() || "";
    }
    
    // For other elements, use first text node child
    for (let i = 0; i < element.childNodes.length; i++) {
      const node = element.childNodes[i];
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent?.trim();
        if (text) {
          return text;
        }
      }
    }
  }

  return "";
}

/**
 * Get the implicit or explicit ARIA role for an element
 */
function getRole(element: Element): string {
  // Check explicit ARIA role
  const explicitRole = element.getAttribute("role");
  if (explicitRole) {
    return explicitRole;
  }

  // Implicit roles based on semantic HTML
  const tagName = element.tagName.toLowerCase();
  const implicitRoles: Record<string, string> = {
    a: "link",
    button: "button",
    input: "textbox", // will be refined below
    textarea: "textbox",
    select: "combobox",
    img: "image",
    nav: "navigation",
    main: "main",
    header: "banner",
    footer: "contentinfo",
    aside: "complementary",
    section: "region",
    article: "article",
    form: "form",
    h1: "heading",
    h2: "heading",
    h3: "heading",
    h4: "heading",
    h5: "heading",
    h6: "heading",
    ul: "list",
    ol: "list",
    li: "listitem",
    table: "table",
    tr: "row",
    th: "columnheader",
    td: "cell",
    dialog: "dialog",
    summary: "button",
  };

  let role = implicitRoles[tagName];

  // Refine input role based on type
  if (tagName === "input") {
    const type = (element.getAttribute("type") || "text").toLowerCase();
    const inputRoles: Record<string, string> = {
      button: "button",
      submit: "button",
      reset: "button",
      checkbox: "checkbox",
      radio: "radio",
      range: "slider",
      email: "textbox",
      password: "textbox",
      search: "searchbox",
      tel: "textbox",
      text: "textbox",
      url: "textbox",
      number: "spinbutton",
    };
    role = inputRoles[type] || "textbox";
  }

  return role || "generic";
}

/**
 * Extract state information from an element
 */
function getState(element: Element): A11yState {
  const state: Record<string, any> = {};

  // Disabled
  if (element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true") {
    state.disabled = true;
  }

  // Checked
  const ariaChecked = element.getAttribute("aria-checked");
  if (ariaChecked) {
    state.checked = ariaChecked === "mixed" ? "mixed" : ariaChecked === "true";
  } else if (element instanceof HTMLInputElement) {
    if (element.type === "checkbox" || element.type === "radio") {
      state.checked = element.checked;
    }
  }

  // Expanded
  const ariaExpanded = element.getAttribute("aria-expanded");
  if (ariaExpanded) {
    state.expanded = ariaExpanded === "true";
  }

  // Selected
  const ariaSelected = element.getAttribute("aria-selected");
  if (ariaSelected) {
    state.selected = ariaSelected === "true";
  } else if (element instanceof HTMLOptionElement) {
    state.selected = element.selected;
  }

  // Pressed
  const ariaPressed = element.getAttribute("aria-pressed");
  if (ariaPressed) {
    state.pressed = ariaPressed === "true";
  }

  // Readonly
  if (element.hasAttribute("readonly") || element.getAttribute("aria-readonly") === "true") {
    state.readonly = true;
  }

  // Required
  if (element.hasAttribute("required") || element.getAttribute("aria-required") === "true") {
    state.required = true;
  }

  // Invalid
  const ariaInvalid = element.getAttribute("aria-invalid");
  if (ariaInvalid && ariaInvalid !== "false") {
    state.invalid = true;
  } else if (element instanceof HTMLInputElement) {
    if (!element.validity.valid) {
      state.invalid = true;
    }
  }

  // Busy
  const ariaBusy = element.getAttribute("aria-busy");
  if (ariaBusy === "true") {
    state.busy = true;
  }

  // Hidden
  const ariaHidden = element.getAttribute("aria-hidden");
  if (ariaHidden === "true") {
    state.hidden = true;
  }

  // Modal
  const ariaModal = element.getAttribute("aria-modal");
  if (ariaModal === "true") {
    state.modal = true;
  }

  // Multiselectable
  const ariaMultiselectable = element.getAttribute("aria-multiselectable");
  if (ariaMultiselectable === "true") {
    state.multiselectable = true;
  }

  // Level (for headings)
  const ariaLevel = element.getAttribute("aria-level");
  if (ariaLevel) {
    state.level = parseInt(ariaLevel, 10);
  } else if (element.tagName.match(/^H[1-6]$/)) {
    state.level = parseInt(element.tagName[1], 10);
  }

  // Value min/max/now (for range inputs and sliders)
  const ariaValueMin = element.getAttribute("aria-valuemin");
  if (ariaValueMin) {
    state.valueMin = parseFloat(ariaValueMin);
  }
  const ariaValueMax = element.getAttribute("aria-valuemax");
  if (ariaValueMax) {
    state.valueMax = parseFloat(ariaValueMax);
  }
  const ariaValueNow = element.getAttribute("aria-valuenow");
  if (ariaValueNow) {
    state.valueNow = parseFloat(ariaValueNow);
  }

  return state as A11yState;
}

/**
 * Get the bounding box for an element
 */
function getBoundingBox(element: Element): BoundingBox {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  };
}

/**
 * Get the current value of an element
 */
function getValue(element: Element): string | undefined {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return element.value;
  }
  if (element instanceof HTMLSelectElement) {
    return element.value;
  }
  const ariaValueText = element.getAttribute("aria-valuetext");
  if (ariaValueText) {
    return ariaValueText;
  }
  return undefined;
}

/**
 * Collect relevant attributes from an element
 */
function getAttributes(element: Element): Record<string, string> {
  const attributes: Record<string, string> = {};
  
  // Collect data-* attributes
  if (element instanceof HTMLElement) {
    for (const [key, value] of Object.entries(element.dataset)) {
      if (value !== undefined) {
        attributes[`data-${key}`] = value;
      }
    }
  }

  // Collect specific ARIA attributes
  const relevantAttrs = [
    "aria-describedby",
    "aria-controls",
    "aria-owns",
    "aria-live",
    "aria-atomic",
    "aria-relevant",
  ];
  
  for (const attr of relevantAttrs) {
    const value = element.getAttribute(attr);
    if (value) {
      attributes[attr] = value;
    }
  }

  return attributes;
}

/**
 * Check if an element should be included in the accessibility tree
 */
function shouldIncludeElement(element: Element): boolean {
  // Skip elements with aria-hidden="true"
  if (element.getAttribute("aria-hidden") === "true") {
    return false;
  }

  // Skip script, style, noscript elements
  const tagName = element.tagName.toLowerCase();
  if (["script", "style", "noscript", "meta", "link"].includes(tagName)) {
    return false;
  }

  // Skip elements with display: none or visibility: hidden
  if (element instanceof HTMLElement) {
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") {
      return false;
    }
  }

  // Include elements with semantic roles or interactive elements
  const role = getRole(element);
  const interactiveRoles = [
    "button",
    "link",
    "textbox",
    "checkbox",
    "radio",
    "combobox",
    "searchbox",
    "slider",
    "spinbutton",
  ];
  
  if (interactiveRoles.includes(role)) {
    return true;
  }

  // Include elements with accessible names
  const name = computeAccessibleName(element);
  if (name) {
    return true;
  }

  // Include structural elements
  const structuralRoles = [
    "navigation",
    "main",
    "banner",
    "contentinfo",
    "complementary",
    "region",
    "article",
    "heading",
    "list",
    "listitem",
  ];
  
  if (structuralRoles.includes(role)) {
    return true;
  }

  return false;
}

/**
 * Parse an element and its descendants into an accessibility node
 */
function parseElement(element: Element): SerializedA11yNode | null {
  if (!shouldIncludeElement(element)) {
    return null;
  }

  const children: SerializedA11yNode[] = [];
  
  // Recursively parse children
  for (let i = 0; i < element.children.length; i++) {
    const child = element.children[i];
    const childNode = parseElement(child);
    if (childNode) {
      children.push(childNode);
    }
  }

  const value = getValue(element);
  const node: SerializedA11yNode = {
    id: generateNodeId(),
    role: getRole(element),
    name: computeAccessibleName(element),
    state: getState(element),
    value: value !== undefined ? value : undefined,
    boundingBox: getBoundingBox(element),
    children,
    attributes: getAttributes(element),
    tagName: element.tagName,
  };

  return node;
}

/**
 * Parse the entire document into an accessibility tree
 * This function is designed to be serialized and executed in the page context
 * 
 * IMPORTANT: This function must be completely self-contained with all its dependencies
 * embedded within it, because it will be injected into the page context as a string.
 */
export function parseAccessibilityTree(): SerializedA11yNode {
  // All the helper functions need to be defined inside this function
  // so they're available when it's serialized and injected
  
  let nodeIdCounter = 0;
  
  function generateNodeId(): string {
    return `a11y-node-${nodeIdCounter++}`;
  }

  function computeAccessibleName(element: Element): string {
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const ids = labelledBy.split(/\s+/);
      const names = ids
        .map((id) => {
          const labelElement = document.getElementById(id);
          return labelElement ? labelElement.textContent?.trim() : "";
        })
        .filter(Boolean);
      if (names.length > 0) {
        return names.join(" ");
      }
    }

    const ariaLabel = element.getAttribute("aria-label");
    if (ariaLabel) {
      return ariaLabel.trim();
    }

    if (element instanceof HTMLElement) {
      const htmlElement = element as HTMLElement;
      
      const labelAncestor = htmlElement.closest("label");
      if (labelAncestor) {
        const labelText = labelAncestor.textContent?.trim();
        if (labelText) {
          return labelText;
        }
      }

      if (htmlElement.id) {
        const label = document.querySelector(`label[for="${htmlElement.id}"]`);
        if (label) {
          const labelText = label.textContent?.trim();
          if (labelText) {
            return labelText;
          }
        }
      }
    }

    const alt = element.getAttribute("alt");
    if (alt !== null) {
      return alt.trim();
    }

    const title = element.getAttribute("title");
    if (title) {
      return title.trim();
    }

    const placeholder = element.getAttribute("placeholder");
    if (placeholder) {
      return placeholder.trim();
    }

    if (element instanceof HTMLElement) {
      const tagName = element.tagName.toLowerCase();
      if (["button", "a", "h1", "h2", "h3", "h4", "h5", "h6", "summary"].includes(tagName)) {
        return element.textContent?.trim() || "";
      }
      
      for (let i = 0; i < element.childNodes.length; i++) {
        const node = element.childNodes[i];
        if (node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent?.trim();
          if (text) {
            return text;
          }
        }
      }
    }

    return "";
  }

  function getRole(element: Element): string {
    const explicitRole = element.getAttribute("role");
    if (explicitRole) {
      return explicitRole;
    }

    const tagName = element.tagName.toLowerCase();
    const implicitRoles: Record<string, string> = {
      a: "link", button: "button", input: "textbox", textarea: "textbox",
      select: "combobox", img: "image", nav: "navigation", main: "main",
      header: "banner", footer: "contentinfo", aside: "complementary",
      section: "region", article: "article", form: "form",
      h1: "heading", h2: "heading", h3: "heading", h4: "heading", h5: "heading", h6: "heading",
      ul: "list", ol: "list", li: "listitem",
      table: "table", tr: "row", th: "columnheader", td: "cell",
      dialog: "dialog", summary: "button",
    };

    let role = implicitRoles[tagName];

    if (tagName === "input") {
      const type = (element.getAttribute("type") || "text").toLowerCase();
      const inputRoles: Record<string, string> = {
        button: "button", submit: "button", reset: "button",
        checkbox: "checkbox", radio: "radio", range: "slider",
        email: "textbox", password: "textbox", search: "searchbox",
        tel: "textbox", text: "textbox", url: "textbox", number: "spinbutton",
      };
      role = inputRoles[type] || "textbox";
    }

    return role || "generic";
  }

  function getState(element: Element): any {
    const state: Record<string, any> = {};

    if (element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true") {
      state.disabled = true;
    }

    const ariaChecked = element.getAttribute("aria-checked");
    if (ariaChecked) {
      state.checked = ariaChecked === "mixed" ? "mixed" : ariaChecked === "true";
    } else if (element instanceof HTMLInputElement) {
      if (element.type === "checkbox" || element.type === "radio") {
        state.checked = element.checked;
      }
    }

    const ariaExpanded = element.getAttribute("aria-expanded");
    if (ariaExpanded) {
      state.expanded = ariaExpanded === "true";
    }

    const ariaSelected = element.getAttribute("aria-selected");
    if (ariaSelected) {
      state.selected = ariaSelected === "true";
    } else if (element instanceof HTMLOptionElement) {
      state.selected = element.selected;
    }

    const ariaPressed = element.getAttribute("aria-pressed");
    if (ariaPressed) {
      state.pressed = ariaPressed === "true";
    }

    if (element.hasAttribute("readonly") || element.getAttribute("aria-readonly") === "true") {
      state.readonly = true;
    }

    if (element.hasAttribute("required") || element.getAttribute("aria-required") === "true") {
      state.required = true;
    }

    const ariaInvalid = element.getAttribute("aria-invalid");
    if (ariaInvalid && ariaInvalid !== "false") {
      state.invalid = true;
    } else if (element instanceof HTMLInputElement) {
      if (!element.validity.valid) {
        state.invalid = true;
      }
    }

    const ariaBusy = element.getAttribute("aria-busy");
    if (ariaBusy === "true") {
      state.busy = true;
    }

    const ariaHidden = element.getAttribute("aria-hidden");
    if (ariaHidden === "true") {
      state.hidden = true;
    }

    const ariaModal = element.getAttribute("aria-modal");
    if (ariaModal === "true") {
      state.modal = true;
    }

    const ariaMultiselectable = element.getAttribute("aria-multiselectable");
    if (ariaMultiselectable === "true") {
      state.multiselectable = true;
    }

    const ariaLevel = element.getAttribute("aria-level");
    if (ariaLevel) {
      state.level = parseInt(ariaLevel, 10);
    } else if (element.tagName.match(/^H[1-6]$/)) {
      state.level = parseInt(element.tagName[1], 10);
    }

    const ariaValueMin = element.getAttribute("aria-valuemin");
    if (ariaValueMin) {
      state.valueMin = parseFloat(ariaValueMin);
    }
    const ariaValueMax = element.getAttribute("aria-valuemax");
    if (ariaValueMax) {
      state.valueMax = parseFloat(ariaValueMax);
    }
    const ariaValueNow = element.getAttribute("aria-valuenow");
    if (ariaValueNow) {
      state.valueNow = parseFloat(ariaValueNow);
    }

    return state;
  }

  function getBoundingBox(element: Element): any {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }

  function getValue(element: Element): string | undefined {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      return element.value;
    }
    if (element instanceof HTMLSelectElement) {
      return element.value;
    }
    const ariaValueText = element.getAttribute("aria-valuetext");
    if (ariaValueText) {
      return ariaValueText;
    }
    return undefined;
  }

  function getAttributes(element: Element): Record<string, string> {
    const attributes: Record<string, string> = {};
    
    if (element instanceof HTMLElement) {
      for (const [key, value] of Object.entries(element.dataset)) {
        if (value !== undefined) {
          attributes[`data-${key}`] = value;
        }
      }
    }

    const relevantAttrs = [
      "aria-describedby", "aria-controls", "aria-owns",
      "aria-live", "aria-atomic", "aria-relevant",
    ];
    
    for (const attr of relevantAttrs) {
      const value = element.getAttribute(attr);
      if (value) {
        attributes[attr] = value;
      }
    }

    return attributes;
  }

  function shouldIncludeElement(element: Element): boolean {
    // Skip elements with aria-hidden="true"
    if (element.getAttribute("aria-hidden") === "true") {
      return false;
    }

    const tagName = element.tagName.toLowerCase();
    
    // Skip script, style, and meta elements
    if (["script", "style", "noscript", "meta", "link", "head"].includes(tagName)) {
      return false;
    }

    // Skip hidden elements (but check computed style only for non-body elements)
    if (element instanceof HTMLElement && tagName !== "body") {
      const style = window.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") {
        return false;
      }
    }

    const role = getRole(element);
    
    // Always include interactive elements
    const interactiveRoles = [
      "button", "link", "textbox", "checkbox", "radio", "combobox",
      "searchbox", "slider", "spinbutton",
    ];
    
    if (interactiveRoles.includes(role)) {
      return true;
    }

    // Always include structural/semantic elements
    const structuralRoles = [
      "navigation", "main", "banner", "contentinfo", "complementary",
      "region", "article", "heading", "list", "listitem", "document",
    ];
    
    if (structuralRoles.includes(role)) {
      return true;
    }

    // Include elements with accessible names
    const name = computeAccessibleName(element);
    if (name && name.length > 0) {
      return true;
    }

    // Include container elements that might have interesting children
    const containerTags = ["div", "section", "article", "aside", "header", "footer", "main", "nav", "body"];
    if (containerTags.includes(tagName)) {
      return true;
    }

    // Include p tags (paragraphs often contain useful text)
    if (tagName === "p") {
      return true;
    }

    return false;
  }

  function parseElement(element: Element): any {
    if (!shouldIncludeElement(element)) {
      return null;
    }

    const children: any[] = [];
    
    for (let i = 0; i < element.children.length; i++) {
      const child = element.children[i];
      const childNode = parseElement(child);
      if (childNode) {
        children.push(childNode);
      }
    }

    const value = getValue(element);
    const node: any = {
      id: generateNodeId(),
      role: getRole(element),
      name: computeAccessibleName(element),
      state: getState(element),
      value: value !== undefined ? value : undefined,
      boundingBox: getBoundingBox(element),
      children,
      attributes: getAttributes(element),
      tagName: element.tagName,
    };

    return node;
  }
  
  // Main parsing logic
  nodeIdCounter = 0;
  
  const rootElement = document.body || document.documentElement;
  const rootNode = parseElement(rootElement);

  if (!rootNode) {
    return {
      id: generateNodeId(),
      role: "document",
      name: document.title || "",
      state: {},
      value: undefined,
      boundingBox: { x: 0, y: 0, width: 0, height: 0 },
      children: [],
      attributes: {},
      tagName: "HTML",
    };
  }

  return rootNode;
}

/**
 * Get the parser function as a string for injection
 * This includes all helper functions and returns the serialized tree
 */
export function getParserScript(): string {
  // Return the entire script as a self-contained function
  return `(${parseAccessibilityTree.toString()})()`;
}
