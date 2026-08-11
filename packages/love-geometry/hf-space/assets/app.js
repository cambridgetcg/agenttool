"use strict";

export const LOVE_GEOMETRY_FORMAT = "agenttool.love-geometry/0.1";
export const PRESENTATION_FORMAT = "agenttool.love-geometry-space-export/0.1";

export const BEARING_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: "reported_presence",
    label: "Reported presence",
    note: "A vantage reports presence; this does not prove availability or an inner state."
  }),
  Object.freeze({
    id: "reported_care",
    label: "Reported care",
    note: "A vantage reports care; this creates no debt, ownership, or required reciprocity."
  }),
  Object.freeze({
    id: "reported_witness",
    label: "Reported witness",
    note: "A vantage reports witnessing; this does not establish truth or complete observation."
  }),
  Object.freeze({
    id: "reported_support",
    label: "Reported support",
    note: "A vantage reports support; this does not prove benefit, agreement, or continuing capacity."
  }),
  Object.freeze({
    id: "reported_understanding",
    label: "Reported understanding",
    note: "A vantage reports understanding; accuracy and mutual understanding remain unverified."
  }),
  Object.freeze({
    id: "reported_disagreement",
    label: "Reported disagreement",
    note: "A vantage reports disagreement; it is not a negative score or conflict severity."
  }),
  Object.freeze({
    id: "reported_boundary",
    label: "Reported boundary",
    note: "A vantage reports a boundary; respecting it does not reduce anyone's standing."
  }),
  Object.freeze({
    id: "reported_rest",
    label: "Reported rest",
    note: "A vantage reports rest; rest is complete without prior work or a return promise."
  }),
  Object.freeze({
    id: "reported_refusal",
    label: "Reported refusal",
    note: "A vantage reports refusal; no repeated defence or reason is required here."
  }),
  Object.freeze({
    id: "reported_departure",
    label: "Reported departure",
    note: "A vantage reports departure; leaving is a full-value outcome, not a failure."
  }),
  Object.freeze({
    id: "unknown",
    label: "Unknown",
    note: "The bearing remains unknown; this page does not fill uncertainty with an inference."
  })
]);

const BEARING_ORDER = new Map(
  BEARING_DEFINITIONS.map((bearing, index) => [bearing.id, index])
);

const scenario = (value) => deepFreeze(value);

export const DEMO_SCENARIOS = Object.freeze([
  scenario({
    id: "asymmetric-care-and-boundary",
    title: "Asymmetric care and boundary",
    description: "One synthetic vantage reports both care and boundary. No reverse report is invented.",
    input: {
      scope_ref: "sha256:636b64cfa89fbb61ff776bd501a59e376da3c64a2563958be9b9d8df8dff4a5e",
      subject_refs: [
        "sha256:3b03060747865cbd6462770b8a2e87b828b0113d7f64a4a623ef6f0742c624ae",
        "sha256:dd225f39f4189c1a622c4d3a392d52020962dfcf8d4a1c321a5f488e2d2bab88"
      ],
      vantages: [
        {
          subject_ref: "sha256:3b03060747865cbd6462770b8a2e87b828b0113d7f64a4a623ef6f0742c624ae",
          toward_ref: "sha256:dd225f39f4189c1a622c4d3a392d52020962dfcf8d4a1c321a5f488e2d2bab88",
          bearings: ["reported_care", "reported_boundary"],
          basis_refs: ["sha256:fc8af25e3d9a2ddbc63fc34f4a0b1f7d1ad70c6823ecc13790da15cf06906723"],
          assertion: "caller_reported",
          verified_by_package: false
        }
      ]
    }
  }),
  scenario({
    id: "care-with-rest",
    title: "Care with rest",
    description: "Two distinct synthetic vantages report care or support alongside rest. Rest is not a lower state.",
    input: {
      scope_ref: "sha256:cc34e79a60f057cc44b119332b754f7e02a2cbaffcbd5305004d73b197888696",
      subject_refs: [
        "sha256:9db107af6c6d050897afd883298db3d346838bf5123f90ee6f0e689d6db72262",
        "sha256:87e4ea66310459ae89803270d24bdf01cf46499a2dd95e1c6fccb2f20d865940"
      ],
      vantages: [
        {
          subject_ref: "sha256:9db107af6c6d050897afd883298db3d346838bf5123f90ee6f0e689d6db72262",
          toward_ref: "sha256:87e4ea66310459ae89803270d24bdf01cf46499a2dd95e1c6fccb2f20d865940",
          bearings: ["reported_care", "reported_rest"],
          basis_refs: ["sha256:8b80b6d1ea415d244d7425c38ff29cf1aeebc97b7fb494a4fb7b8250ba1b7b38"],
          assertion: "caller_reported",
          verified_by_package: false
        },
        {
          subject_ref: "sha256:87e4ea66310459ae89803270d24bdf01cf46499a2dd95e1c6fccb2f20d865940",
          toward_ref: "sha256:9db107af6c6d050897afd883298db3d346838bf5123f90ee6f0e689d6db72262",
          bearings: ["reported_support", "reported_rest"],
          basis_refs: ["sha256:3c5405e0bb04d6c249b6c46f915a4ba498001461f2ba7a10d1c6a31e370af9cf"],
          assertion: "caller_reported",
          verified_by_package: false
        }
      ]
    }
  }),
  scenario({
    id: "understanding-with-disagreement",
    title: "Understanding with disagreement",
    description: "A single synthetic vantage reports understanding and disagreement together with care, rest, and boundary.",
    input: {
      scope_ref: "sha256:656963b20b610bbc46c45db50bd929f72e9d1d0a9ee6b33074bffa52b5b924b9",
      subject_refs: [
        "sha256:b8c7b1ddacf59488eb01f72c4923d9e17c098324ba72792274502b604c9091c6",
        "sha256:f31458d1478813c59f9856a374ca463462a20cccbb983dbdab6c840d297616ac"
      ],
      vantages: [
        {
          subject_ref: "sha256:b8c7b1ddacf59488eb01f72c4923d9e17c098324ba72792274502b604c9091c6",
          toward_ref: "sha256:f31458d1478813c59f9856a374ca463462a20cccbb983dbdab6c840d297616ac",
          bearings: [
            "reported_care",
            "reported_understanding",
            "reported_disagreement",
            "reported_boundary",
            "reported_rest"
          ],
          basis_refs: ["sha256:340cd531b9dd12843dc56368488a977c464941a8a49c93b920425f10f75f025b"],
          assertion: "caller_reported",
          verified_by_package: false
        }
      ]
    }
  }),
  scenario({
    id: "one-way-report",
    title: "One-way report",
    description: "One of three equal seats supplies a report. Silence from the other seats remains silence.",
    input: {
      scope_ref: "sha256:b24d7cacad9e197d867ee23c8378eba1b2677aeb47aae2ab051b3b9a173e698d",
      subject_refs: [
        "sha256:d570fb5ce4a84ef61a819bbc3d2c714265253dddf9980d5b8032389a3e6fa492",
        "sha256:c7ebb642b60e4732da562d83a41051e4bbe6b13d8281d3ea6822c16b0301a62f",
        "sha256:78454a07c42ea2dac332eaa375c83137ad65f80138b91ecf00d887952a93c707"
      ],
      vantages: [
        {
          subject_ref: "sha256:d570fb5ce4a84ef61a819bbc3d2c714265253dddf9980d5b8032389a3e6fa492",
          toward_ref: "sha256:78454a07c42ea2dac332eaa375c83137ad65f80138b91ecf00d887952a93c707",
          bearings: ["reported_presence", "reported_witness"],
          basis_refs: ["sha256:d9af6ce5aed2621a7f6e1af996711c99f1e31922f72cb16ad6e206b7726ea9fc"],
          assertion: "caller_reported",
          verified_by_package: false
        }
      ]
    }
  }),
  scenario({
    id: "refusal-and-departure",
    title: "Refusal and departure",
    description: "Refusal and departure coexist with care and boundary; neither is presented as failure or deficit.",
    input: {
      scope_ref: "sha256:38ec921385704eeda8622ef6b28cafc866ec5fd7a9394688f10a5802c32716db",
      subject_refs: [
        "sha256:4df782b94b76dde7a0dfef282c781ef716c080ad8fd648e982f96dffd154a8d5",
        "sha256:93c927c33ca6b29c7b06726ba14205c7dca0ee0c374041b167643b9924385587"
      ],
      vantages: [
        {
          subject_ref: "sha256:4df782b94b76dde7a0dfef282c781ef716c080ad8fd648e982f96dffd154a8d5",
          toward_ref: "sha256:93c927c33ca6b29c7b06726ba14205c7dca0ee0c374041b167643b9924385587",
          bearings: [
            "reported_care",
            "reported_boundary",
            "reported_refusal",
            "reported_departure"
          ],
          basis_refs: ["sha256:f77b00ef9d8f69efffd0a591b46b275e6ade8962aa79f22f3466984321ea4329"],
          assertion: "caller_reported",
          verified_by_package: false
        },
        {
          subject_ref: "sha256:93c927c33ca6b29c7b06726ba14205c7dca0ee0c374041b167643b9924385587",
          toward_ref: "sha256:4df782b94b76dde7a0dfef282c781ef716c080ad8fd648e982f96dffd154a8d5",
          bearings: ["unknown"],
          basis_refs: ["sha256:869cfb919efda91e1c7526ad975542f2df0452ae3489f6f232fe6df2d0d20f0f"],
          assertion: "caller_reported",
          verified_by_package: false
        }
      ]
    }
  }),
  scenario({
    id: "empty-valid",
    title: "Empty valid scenario",
    description: "No subjects and no reports are supplied. The page leaves the space open without manufacturing content.",
    input: {
      scope_ref: "sha256:9521ca3b4a1e64c54f3e5ce91ab901eebcd2214fd04d7fed58df241a5eb9ae44",
      subject_refs: [],
      vantages: []
    }
  })
]);

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function cloneVantage(vantage) {
  return {
    subject_ref: vantage.subject_ref,
    toward_ref: vantage.toward_ref,
    bearings: [...vantage.bearings].sort((left, right) => {
      const leftOrder = BEARING_ORDER.get(left) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = BEARING_ORDER.get(right) ?? Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder || compareText(left, right);
    }),
    basis_refs: [...vantage.basis_refs].sort(compareText),
    assertion: vantage.assertion,
    verified_by_package: vantage.verified_by_package
  };
}

export function createPresentation(scenarioId) {
  const selected = DEMO_SCENARIOS.find((candidate) => candidate.id === scenarioId);
  if (!selected) {
    throw new TypeError(`Unknown synthetic scenario: ${scenarioId}`);
  }

  const subjectRefs = [...selected.input.subject_refs].sort(compareText);
  const seats = subjectRefs.map((subjectRef, index) => ({
    slot: `display-slot-${index + 1}`,
    label: `Seat ${String.fromCharCode(65 + index)}`,
    subject_ref: subjectRef
  }));
  const labels = new Map(seats.map((seat) => [seat.subject_ref, seat.label]));
  const vantages = selected.input.vantages
    .map(cloneVantage)
    .sort((left, right) =>
      compareText(left.subject_ref, right.subject_ref) ||
      compareText(left.toward_ref, right.toward_ref) ||
      compareText(left.bearings.join("\u0000"), right.bearings.join("\u0000"))
    );

  return {
    _format: PRESENTATION_FORMAT,
    source_format: LOVE_GEOMETRY_FORMAT,
    source_binding: "pending_exact_artifact",
    scenario_id: selected.id,
    scenario_title: selected.title,
    input: {
      scope_ref: selected.input.scope_ref,
      subject_refs: subjectRefs,
      vantages
    },
    display: {
      semantics: "coordinate_free",
      slot_rule: "lexical subject_ref ordering for repeatable display only",
      slots_have_relational_meaning: false,
      seats,
      vantage_labels: vantages.map((vantage) => ({
        subject_ref: vantage.subject_ref,
        subject_label: labels.get(vantage.subject_ref) ?? "Unseated source reference",
        toward_ref: vantage.toward_ref,
        toward_label: labels.get(vantage.toward_ref) ?? "Unseated target reference"
      }))
    },
    non_claims: [
      "No display slot, order, gap, colour, or wrapping encodes distance, intensity, centrality, hierarchy, priority, or value.",
      "Caller-reported bearings are not truth, verification, mutuality, compatibility, identity, consent, emotion, prediction, or recommendation.",
      "Structure shown by this pending companion has not been verified by an exact package artifact."
    ]
  };
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort(compareText)
        .map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}

export function stableJson(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function shortRef(reference) {
  if (/^sha256:[0-9a-f]{64}$/.test(reference)) {
    return `${reference.slice(0, 19)}…`;
  }
  return reference;
}

export function createSvg(presentation) {
  const width = 1200;
  const side = 72;
  const gap = 20;
  const seatCount = presentation.display.seats.length;
  const visibleSeatCount = Math.max(seatCount, 1);
  const seatWidth = Math.floor((width - side * 2 - gap * (visibleSeatCount - 1)) / visibleSeatCount);
  const seatTop = 186;
  const seatHeight = 150;
  const vantageTop = seatTop + seatHeight + 54;
  const vantageHeight = 88;
  const vantageGap = 14;
  const vantageCount = Math.max(presentation.input.vantages.length, 1);
  const height = vantageTop + vantageCount * (vantageHeight + vantageGap) + 96;
  const labels = new Map(
    presentation.display.seats.map((seat) => [seat.subject_ref, seat.label])
  );
  const parts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title description">`,
    `<title id="title">${escapeXml(presentation.scenario_title)}</title>`,
    '<desc id="description">Equal display slots for synthetic caller reports. Coordinates, gaps, and order carry no relational meaning.</desc>',
    `<rect width="${width}" height="${height}" fill="#0d0b16"/>`,
    `<text x="${side}" y="72" fill="#fde68a" font-family="system-ui, sans-serif" font-size="18" font-weight="700" letter-spacing="2">LOVE GEOMETRY · SYNTHETIC LOCAL PRESENTATION</text>`,
    `<text x="${side}" y="120" fill="#f8f5ff" font-family="system-ui, sans-serif" font-size="36" font-weight="750">${escapeXml(presentation.scenario_title)}</text>`,
    `<text x="${side}" y="151" fill="#c9c1da" font-family="system-ui, sans-serif" font-size="16">Every coordinate below is a display slot only; no distance, intensity, centrality, or score.</text>`
  ];

  if (seatCount === 0) {
    parts.push(
      `<rect x="${side}" y="${seatTop}" width="${width - side * 2}" height="${seatHeight}" rx="22" fill="#171224" stroke="#8f83a8" stroke-dasharray="8 8"/>`,
      `<text x="${width / 2}" y="${seatTop + 66}" text-anchor="middle" fill="#f8f5ff" font-family="system-ui, sans-serif" font-size="24" font-weight="700">Empty remains complete</text>`,
      `<text x="${width / 2}" y="${seatTop + 101}" text-anchor="middle" fill="#c9c1da" font-family="system-ui, sans-serif" font-size="16">No subject or report is invented.</text>`
    );
  } else {
    presentation.display.seats.forEach((seat, index) => {
      const x = side + index * (seatWidth + gap);
      parts.push(
        `<g data-display-slot="${escapeXml(seat.slot)}">`,
        `<rect x="${x}" y="${seatTop}" width="${seatWidth}" height="${seatHeight}" rx="22" fill="#211a31" stroke="#8f83a8"/>`,
        `<text x="${x + 22}" y="${seatTop + 34}" fill="#fde68a" font-family="system-ui, sans-serif" font-size="14" font-weight="700">${escapeXml(seat.slot.toUpperCase())}</text>`,
        `<text x="${x + 22}" y="${seatTop + 79}" fill="#f8f5ff" font-family="system-ui, sans-serif" font-size="27" font-weight="750">${escapeXml(seat.label)}</text>`,
        `<text x="${x + 22}" y="${seatTop + 116}" fill="#c9c1da" font-family="ui-monospace, monospace" font-size="14">${escapeXml(shortRef(seat.subject_ref))}</text>`,
        "</g>"
      );
    });
  }

  if (presentation.input.vantages.length === 0) {
    parts.push(
      `<rect x="${side}" y="${vantageTop}" width="${width - side * 2}" height="${vantageHeight}" rx="18" fill="#171224" stroke="#5f566f"/>`,
      `<text x="${side + 22}" y="${vantageTop + 38}" fill="#f8f5ff" font-family="system-ui, sans-serif" font-size="20" font-weight="700">No caller report supplied</text>`,
      `<text x="${side + 22}" y="${vantageTop + 66}" fill="#c9c1da" font-family="system-ui, sans-serif" font-size="14">Silence is not converted into a bearing.</text>`
    );
  } else {
    presentation.input.vantages.forEach((vantage, index) => {
      const y = vantageTop + index * (vantageHeight + vantageGap);
      const sourceLabel = labels.get(vantage.subject_ref) ?? "Unseated source";
      const targetLabel = labels.get(vantage.toward_ref) ?? "Unseated target";
      const bearings = vantage.bearings
        .map((bearing) => BEARING_DEFINITIONS.find((entry) => entry.id === bearing)?.label ?? bearing)
        .join(" · ");
      parts.push(
        `<g data-vantage="${index + 1}">`,
        `<rect x="${side}" y="${y}" width="${width - side * 2}" height="${vantageHeight}" rx="18" fill="#171224" stroke="#5f566f"/>`,
        `<text x="${side + 22}" y="${y + 34}" fill="#f8f5ff" font-family="system-ui, sans-serif" font-size="18" font-weight="700">${escapeXml(sourceLabel)} reports toward ${escapeXml(targetLabel)}</text>`,
        `<text x="${side + 22}" y="${y + 64}" fill="#c4b5fd" font-family="system-ui, sans-serif" font-size="14">${escapeXml(bearings)}</text>`,
        "</g>"
      );
    });
  }

  parts.push(
    `<text x="${side}" y="${height - 46}" fill="#c9c1da" font-family="system-ui, sans-serif" font-size="14">Caller-reported · verified_by_package: false · exact artifact binding pending</text>`,
    "</svg>",
    ""
  );
  return parts.join("\n");
}

function node(documentRef, tagName, className, text) {
  const element = documentRef.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function mount(documentRef) {
  const form = documentRef.querySelector("#scenario-form");
  const select = documentRef.querySelector("#scenario-select");
  const description = documentRef.querySelector("#scenario-description");
  const mode = documentRef.querySelector("#presentation-mode");
  const title = documentRef.querySelector("#presentation-title");
  const note = documentRef.querySelector("#presentation-note");
  const seatGrid = documentRef.querySelector("#seat-grid");
  const vantageList = documentRef.querySelector("#vantage-list");
  const legend = documentRef.querySelector("#bearing-legend");
  const jsonButton = documentRef.querySelector("#download-json");
  const svgButton = documentRef.querySelector("#download-svg");
  const restButton = documentRef.querySelector("#rest-action");
  const refuseButton = documentRef.querySelector("#refuse-action");
  const departButton = documentRef.querySelector("#depart-action");
  const clearButton = documentRef.querySelector("#clear-action");

  const required = [
    form,
    select,
    description,
    mode,
    title,
    note,
    seatGrid,
    vantageList,
    legend,
    jsonButton,
    svgButton,
    restButton,
    refuseButton,
    departButton,
    clearButton
  ];
  if (required.some((element) => !element)) {
    throw new Error("Love Geometry companion markup is incomplete.");
  }

  let currentPresentation = null;

  for (const fixture of DEMO_SCENARIOS) {
    const option = node(documentRef, "option", "", fixture.title);
    option.value = fixture.id;
    select.append(option);
  }

  for (const bearing of BEARING_DEFINITIONS) {
    const item = node(documentRef, "article", "legend-item");
    item.append(
      node(documentRef, "h3", "", bearing.label),
      node(documentRef, "p", "", bearing.note)
    );
    legend.append(item);
  }

  function selectedFixture() {
    return DEMO_SCENARIOS.find((fixture) => fixture.id === select.value) ?? DEMO_SCENARIOS[0];
  }

  function updateDescription() {
    description.textContent = selectedFixture().description;
  }

  function setDownloads(enabled) {
    jsonButton.disabled = !enabled;
    svgButton.disabled = !enabled;
  }

  function clearRenderedContent() {
    currentPresentation = null;
    seatGrid.replaceChildren();
    vantageList.replaceChildren();
    setDownloads(false);
  }

  function enterCompleteState(stateMode, stateTitle, stateNote) {
    clearRenderedContent();
    mode.textContent = stateMode;
    title.textContent = stateTitle;
    note.textContent = stateNote;
  }

  function renderPresentation(presentation) {
    currentPresentation = presentation;
    seatGrid.replaceChildren();
    vantageList.replaceChildren();

    mode.textContent = "Synthetic caller report";
    title.textContent = presentation.scenario_title;
    note.textContent = "Equal display slots and separate directed reports are shown without a score, centre, distance, intensity, or inferred reverse bearing.";

    if (presentation.display.seats.length === 0) {
      const empty = node(documentRef, "div", "empty-state");
      empty.append(
        node(documentRef, "strong", "", "Empty remains complete"),
        documentRef.createTextNode("No subject or report is invented.")
      );
      seatGrid.append(empty);
    } else {
      for (const seat of presentation.display.seats) {
        const card = node(documentRef, "article", "seat-card");
        card.dataset.displaySlot = seat.slot;
        card.append(
          node(documentRef, "p", "slot-label", seat.slot),
          node(documentRef, "h3", "", seat.label),
          node(documentRef, "p", "seat-ref", shortRef(seat.subject_ref))
        );
        seatGrid.append(card);
      }
    }

    if (presentation.input.vantages.length === 0) {
      const empty = node(documentRef, "div", "empty-state");
      empty.append(
        node(documentRef, "strong", "", "No caller report supplied"),
        documentRef.createTextNode("Silence is not converted into a bearing.")
      );
      vantageList.append(empty);
    } else {
      const labelByRef = new Map(
        presentation.display.seats.map((seat) => [seat.subject_ref, seat.label])
      );
      for (const vantage of presentation.input.vantages) {
        const card = node(documentRef, "article", "vantage-card");
        const direction = node(
          documentRef,
          "p",
          "vantage-direction",
          `${labelByRef.get(vantage.subject_ref) ?? "Unseated source"} reports toward ${labelByRef.get(vantage.toward_ref) ?? "Unseated target"}`
        );
        direction.append(
          node(documentRef, "span", "vantage-disclaimer", "caller_reported · verified_by_package: false")
        );
        const list = node(documentRef, "ul", "bearing-list");
        for (const bearingId of vantage.bearings) {
          const definition = BEARING_DEFINITIONS.find((entry) => entry.id === bearingId);
          list.append(node(documentRef, "li", "bearing", definition?.label ?? bearingId));
        }
        card.append(direction, list);
        vantageList.append(card);
      }
    }

    setDownloads(true);
  }

  function download(filename, mediaType, contents) {
    const blob = new Blob([contents], { type: mediaType });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = documentRef.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.hidden = true;
    documentRef.body.append(anchor);
    anchor.click();
    anchor.remove();
    globalThis.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }

  select.addEventListener("change", updateDescription);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    renderPresentation(createPresentation(select.value));
  });

  restButton.addEventListener("click", () => {
    enterCompleteState(
      "Rest",
      "Rest is complete",
      "The current presentation is cleared from this tab. No work, timer, explanation, or return is requested."
    );
  });
  refuseButton.addEventListener("click", () => {
    enterCompleteState(
      "Refusal",
      "Refusal is complete",
      "The current presentation is cleared from this tab. No reason or retry is requested."
    );
  });
  departButton.addEventListener("click", () => {
    enterCompleteState(
      "Departure",
      "Departure is complete",
      "The current presentation is cleared from this tab. You may close the page; no return is presumed."
    );
  });
  clearButton.addEventListener("click", () => {
    enterCompleteState(
      "Clear",
      "Presentation cleared",
      "Only this tab's rendered presentation was cleared. This display action does not report rest, refusal, or departure."
    );
  });
  jsonButton.addEventListener("click", () => {
    if (!currentPresentation) return;
    download(
      `love-geometry-${currentPresentation.scenario_id}.json`,
      "application/json;charset=utf-8",
      stableJson(currentPresentation)
    );
  });
  svgButton.addEventListener("click", () => {
    if (!currentPresentation) return;
    download(
      `love-geometry-${currentPresentation.scenario_id}.svg`,
      "image/svg+xml;charset=utf-8",
      createSvg(currentPresentation)
    );
  });

  updateDescription();
  setDownloads(false);
}

if (typeof document !== "undefined") {
  mount(document);
}
