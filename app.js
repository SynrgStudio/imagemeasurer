const imageInput = document.getElementById("imageInput");
const knownLengthInput = document.getElementById("knownLength");
const unitInput = document.getElementById("unitInput");
const applyKnownBtn = document.getElementById("applyKnownBtn");
const undoBtn = document.getElementById("undoBtn");
const clearBtn = document.getElementById("clearBtn");
const magnifierToggle = document.getElementById("magnifierToggle");
const themeToggle = document.getElementById("themeToggle");
const exportCsvBtn = document.getElementById("exportCsvBtn");
const exportTxtBtn = document.getElementById("exportTxtBtn");
const statusEl = document.getElementById("status");
const photo = document.getElementById("photo");
const overlay = document.getElementById("overlay");
const emptyState = document.getElementById("emptyState");
const measureList = document.getElementById("measureList");
const canvasWrap = document.getElementById("canvasWrap");
const loupe = document.getElementById("loupe");

const state = {
  imageLoaded: false,
  knownLength: null,
  unit: "cm",
  knownApplied: false,
  referenceLine: null,
  measureLines: [],
  scale: null,
  tempLine: null,
  drawing: false,
  activePointerId: null,
  hoveredLine: null,
  dragHandle: null,
  nextId: 1,
};

const LINE_MIN_PX = 3;
const LOUPE_SIZE = 150;
const LOUPE_ZOOM = 3;

function setStatus(message) {
  statusEl.textContent = message;
}

function sanitizeUnit(value) {
  return value.trim().replace(/\s+/g, " ").slice(0, 12) || "u";
}

function distance(line) {
  const dx = line.x2 - line.x1;
  const dy = line.y2 - line.y1;
  return Math.hypot(dx, dy);
}

function formatMeasure(value) {
  const normalized = Number.isFinite(value) ? value : 0;
  return normalized.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

function getAllLines() {
  const lines = [];
  if (state.referenceLine) {
    lines.push({ ...state.referenceLine, type: "reference" });
  }
  for (const line of state.measureLines) {
    lines.push({ ...line, type: "measure" });
  }
  return lines;
}

function updateButtons() {
  const hasImage = state.imageLoaded;
  const hasAnyLine = Boolean(state.referenceLine) || state.measureLines.length > 0;
  const hasMeasures = state.measureLines.length > 0;

  applyKnownBtn.disabled = !hasImage;
  undoBtn.disabled = !hasAnyLine;
  clearBtn.disabled = !hasImage;
  exportCsvBtn.disabled = !hasMeasures;
  exportTxtBtn.disabled = !hasMeasures;

  applyKnownBtn.classList.toggle("active", state.knownApplied && !state.referenceLine);
}

function getBaseStatus() {
  if (!state.imageLoaded) {
    return "Load an image to start.";
  }
  if (!state.knownApplied) {
    return "Enter a known value and click 'Apply known length'.";
  }
  if (!state.referenceLine) {
    return "Known length applied. Draw the reference line now.";
  }
  return "Calibrated. Draw as many measurement lines as you want.";
}

function updateStatusFromState(extra = "") {
  const base = getBaseStatus();
  setStatus(extra ? `${base} ${extra}` : base);
}

function getRects() {
  const overlayRect = overlay.getBoundingClientRect();
  const photoRect = photo.getBoundingClientRect();
  return { overlayRect, photoRect };
}

function getNaturalPoint(event) {
  const { photoRect } = getRects();
  const x = event.clientX - photoRect.left;
  const y = event.clientY - photoRect.top;
  const naturalX = (x / photoRect.width) * photo.naturalWidth;
  const naturalY = (y / photoRect.height) * photo.naturalHeight;

  return {
    x: Math.max(0, Math.min(photo.naturalWidth, naturalX)),
    y: Math.max(0, Math.min(photo.naturalHeight, naturalY)),
  };
}

function toDisplay(point) {
  const { overlayRect, photoRect } = getRects();
  const scaleX = photoRect.width / photo.naturalWidth;
  const scaleY = photoRect.height / photo.naturalHeight;

  return {
    x: photoRect.left - overlayRect.left + point.x * scaleX,
    y: photoRect.top - overlayRect.top + point.y * scaleY,
  };
}

function makeLineElement(x1, y1, x2, y2, cls) {
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", x1);
  line.setAttribute("y1", y1);
  line.setAttribute("x2", x2);
  line.setAttribute("y2", y2);
  line.setAttribute("class", cls);
  return line;
}

function makeLabel(x, y, text) {
  const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
  label.setAttribute("x", x);
  label.setAttribute("y", y);
  label.setAttribute("class", "line-label");
  label.textContent = text;
  return label;
}

function makeHandle(x, y, lineId, lineType, endpoint) {
  const handle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  handle.setAttribute("cx", x);
  handle.setAttribute("cy", y);
  handle.setAttribute("r", 6);
  handle.setAttribute("class", "line-handle");
  handle.dataset.lineId = String(lineId);
  handle.dataset.lineType = lineType;
  handle.dataset.endpoint = endpoint;
  return handle;
}

function labelForLine(line) {
  if (line.type === "reference") {
    return `Reference: ${formatMeasure(state.knownLength)} ${state.unit}`;
  }
  const result = distance(line) * state.scale;
  return `${line.index}. ${formatMeasure(result)} ${state.unit}`;
}

function renderLine(line) {
  const p1 = toDisplay({ x: line.x1, y: line.y1 });
  const p2 = toDisplay({ x: line.x2, y: line.y2 });
  const cssClass = line.type === "reference" ? "ref-line" : "measure-line";

  const visualLine = makeLineElement(p1.x, p1.y, p2.x, p2.y, cssClass);
  visualLine.dataset.lineId = String(line.id);
  visualLine.dataset.lineType = line.type;
  overlay.appendChild(visualLine);

  const hitLine = makeLineElement(p1.x, p1.y, p2.x, p2.y, "line-hit");
  hitLine.dataset.lineId = String(line.id);
  hitLine.dataset.lineType = line.type;
  overlay.appendChild(hitLine);

  const midX = (p1.x + p2.x) / 2;
  const midY = (p1.y + p2.y) / 2;
  overlay.appendChild(makeLabel(midX + 6, midY - 6, labelForLine(line)));

  const shouldShowHandles =
    state.hoveredLine === line.id ||
    (state.dragHandle && state.dragHandle.lineId === line.id);

  if (shouldShowHandles) {
    overlay.appendChild(makeHandle(p1.x, p1.y, line.id, line.type, "start"));
    overlay.appendChild(makeHandle(p2.x, p2.y, line.id, line.type, "end"));
  }
}

function renderPreview() {
  if (!state.tempLine) {
    return;
  }
  const p1 = toDisplay({ x: state.tempLine.x1, y: state.tempLine.y1 });
  const p2 = toDisplay({ x: state.tempLine.x2, y: state.tempLine.y2 });
  overlay.appendChild(makeLineElement(p1.x, p1.y, p2.x, p2.y, "preview-line"));

  const pxLength = distance(state.tempLine);
  const text = !state.referenceLine
    ? `px: ${formatMeasure(pxLength)}`
    : `${formatMeasure(pxLength * state.scale)} ${state.unit}`;
  overlay.appendChild(makeLabel((p1.x + p2.x) / 2 + 6, (p1.y + p2.y) / 2 - 6, text));
}

function renderOverlay() {
  overlay.innerHTML = "";
  for (const line of getAllLines()) {
    renderLine(line);
  }
  renderPreview();
}

function renderMeasurementsList() {
  measureList.innerHTML = "";

  if (state.referenceLine) {
    const referenceItem = document.createElement("li");
    referenceItem.textContent = `Known Measure: ${formatMeasure(state.knownLength)} ${state.unit}`;
    measureList.appendChild(referenceItem);
  }

  if (!state.referenceLine && !state.measureLines.length) {
    const item = document.createElement("li");
    item.className = "empty";
    item.textContent = "No measurements yet.";
    measureList.appendChild(item);
    return;
  }

  for (const line of state.measureLines) {
    const measured = distance(line) * state.scale;
    const li = document.createElement("li");
    li.textContent = `Measure ${line.index}: ${formatMeasure(measured)} ${state.unit}`;
    measureList.appendChild(li);
  }
}

function recalculateMeasureIndexes() {
  state.measureLines = state.measureLines.map((line, idx) => ({
    ...line,
    index: idx + 1,
  }));
}

function findLine(lineId, lineType) {
  if (lineType === "reference" && state.referenceLine && state.referenceLine.id === lineId) {
    return state.referenceLine;
  }
  if (lineType === "measure") {
    return state.measureLines.find((line) => line.id === lineId) || null;
  }
  return null;
}

function recomputeScaleIfNeeded() {
  if (!state.referenceLine) {
    state.scale = null;
    return;
  }
  const refPx = distance(state.referenceLine);
  if (refPx < LINE_MIN_PX) {
    state.scale = null;
    return;
  }
  state.scale = state.knownLength / refPx;
}

function ensureKnownLength() {
  const value = Number(knownLengthInput.value);
  if (!Number.isFinite(value) || value <= 0) {
    setStatus("Please enter a valid known length greater than zero.");
    knownLengthInput.focus();
    return null;
  }
  return value;
}

function resetDrawingState() {
  state.tempLine = null;
  state.drawing = false;
  state.activePointerId = null;
  state.dragHandle = null;
  hideLoupe();
}

function resetAll() {
  state.knownApplied = false;
  state.knownLength = null;
  state.unit = sanitizeUnit(unitInput.value);
  state.referenceLine = null;
  state.measureLines = [];
  state.scale = null;
  state.hoveredLine = null;
  resetDrawingState();
  updateButtons();
  renderOverlay();
  renderMeasurementsList();
  updateStatusFromState();
}

function loadImage(file) {
  const reader = new FileReader();
  reader.onload = () => {
    photo.onload = () => {
      state.imageLoaded = true;
      emptyState.hidden = true;
      photo.hidden = false;
      overlay.hidden = false;
      resetAll();
      setStatus("Image ready. Enter known length and click 'Apply known length'.");
    };
    photo.src = String(reader.result);
  };
  reader.readAsDataURL(file);
}

function applyKnownLength() {
  if (!state.imageLoaded) {
    return;
  }
  const known = ensureKnownLength();
  if (!known) {
    return;
  }
  state.knownLength = known;
  state.unit = sanitizeUnit(unitInput.value);
  state.knownApplied = true;
  state.referenceLine = null;
  state.measureLines = [];
  state.scale = null;
  state.hoveredLine = null;
  resetDrawingState();
  updateButtons();
  renderOverlay();
  renderMeasurementsList();
  setStatus("Known length applied. Draw your first line as the reference.");
}

function createLineFromTemp() {
  const line = { ...state.tempLine };
  const px = distance(line);
  if (px < LINE_MIN_PX) {
    setStatus("Line is too short. Try again.");
    return;
  }

  if (!state.referenceLine) {
    state.referenceLine = {
      id: state.nextId++,
      ...line,
    };
    recomputeScaleIfNeeded();
    setStatus(
      `Reference calibrated: ${formatMeasure(state.knownLength)} ${state.unit}. Draw any line to measure.`
    );
    return;
  }

  const nextIndex = state.measureLines.length + 1;
  const newLine = {
    id: state.nextId++,
    index: nextIndex,
    ...line,
  };
  state.measureLines.push(newLine);
  const measured = distance(newLine) * state.scale;
  setStatus(`Measurement ${nextIndex}: ${formatMeasure(measured)} ${state.unit}`);
}

function updateLoupe(event) {
  if (!magnifierToggle.checked || !state.drawing) {
    hideLoupe();
    return;
  }

  const { overlayRect, photoRect } = getRects();
  const localX = Math.max(0, Math.min(photoRect.width, event.clientX - photoRect.left));
  const localY = Math.max(0, Math.min(photoRect.height, event.clientY - photoRect.top));

  const posX = event.clientX - overlayRect.left + 16;
  const posY = event.clientY - overlayRect.top + 16;

  loupe.hidden = false;
  loupe.style.left = `${posX}px`;
  loupe.style.top = `${posY}px`;
  loupe.style.backgroundImage = `url(${photo.src})`;
  loupe.style.backgroundSize = `${photoRect.width * LOUPE_ZOOM}px ${photoRect.height * LOUPE_ZOOM}px`;
  loupe.style.backgroundPosition = `${-(localX * LOUPE_ZOOM - LOUPE_SIZE / 2)}px ${-(localY * LOUPE_ZOOM - LOUPE_SIZE / 2)}px`;
}

function hideLoupe() {
  loupe.hidden = true;
}

function startDrawing(event) {
  event.preventDefault();
  overlay.setPointerCapture(event.pointerId);
  state.activePointerId = event.pointerId;
  state.drawing = true;
  const start = getNaturalPoint(event);
  state.tempLine = {
    x1: start.x,
    y1: start.y,
    x2: start.x,
    y2: start.y,
  };
  updateLoupe(event);
  renderOverlay();
}

function startHandleDrag(event, handle) {
  event.preventDefault();
  const lineId = Number(handle.dataset.lineId);
  const lineType = handle.dataset.lineType;
  const endpoint = handle.dataset.endpoint;
  if (!lineType || !endpoint || !Number.isFinite(lineId)) {
    return;
  }
  overlay.setPointerCapture(event.pointerId);
  state.activePointerId = event.pointerId;
  state.dragHandle = {
    lineId,
    lineType,
    endpoint,
  };
  state.drawing = false;
}

function onPointerDown(event) {
  if (!state.imageLoaded || !state.knownApplied) {
    return;
  }

  if (event.target instanceof SVGCircleElement && event.target.classList.contains("line-handle")) {
    startHandleDrag(event, event.target);
    return;
  }

  startDrawing(event);
}

function onPointerMove(event) {
  const maybeLineTarget = event.target;
  if (!state.drawing && !state.dragHandle) {
    if (maybeLineTarget instanceof SVGLineElement) {
      const id = Number(maybeLineTarget.dataset.lineId);
      state.hoveredLine = Number.isFinite(id) ? id : null;
    } else if (!(maybeLineTarget instanceof SVGCircleElement)) {
      state.hoveredLine = null;
    }
  }

  if (state.dragHandle && event.pointerId === state.activePointerId) {
    const point = getNaturalPoint(event);
    const line = findLine(state.dragHandle.lineId, state.dragHandle.lineType);
    if (!line) {
      return;
    }

    if (state.dragHandle.endpoint === "start") {
      line.x1 = point.x;
      line.y1 = point.y;
    } else {
      line.x2 = point.x;
      line.y2 = point.y;
    }

    if (line.type === "reference") {
      recomputeScaleIfNeeded();
    }

    renderOverlay();
    renderMeasurementsList();
    return;
  }

  if (state.drawing && event.pointerId === state.activePointerId && state.tempLine) {
    const point = getNaturalPoint(event);
    state.tempLine.x2 = point.x;
    state.tempLine.y2 = point.y;
    updateLoupe(event);
    renderOverlay();
    return;
  }

  renderOverlay();
}

function onPointerUp(event) {
  if (event.pointerId !== state.activePointerId) {
    return;
  }

  overlay.releasePointerCapture(event.pointerId);

  if (state.dragHandle) {
    state.dragHandle = null;
    recalculateMeasureIndexes();
    recomputeScaleIfNeeded();
    renderOverlay();
    renderMeasurementsList();
    updateStatusFromState("Line updated.");
    updateButtons();
    return;
  }

  if (!state.drawing || !state.tempLine) {
    resetDrawingState();
    renderOverlay();
    return;
  }

  createLineFromTemp();
  resetDrawingState();
  recalculateMeasureIndexes();
  recomputeScaleIfNeeded();
  renderOverlay();
  renderMeasurementsList();
  updateButtons();
  updateStatusFromState();
}

function deleteLine(lineId, lineType) {
  if (lineType === "reference" && state.referenceLine?.id === lineId) {
    state.referenceLine = null;
    state.measureLines = [];
    state.scale = null;
    setStatus("Reference removed. Draw a new reference line.");
    renderOverlay();
    renderMeasurementsList();
    updateButtons();
    return;
  }

  if (lineType === "measure") {
    state.measureLines = state.measureLines.filter((line) => line.id !== lineId);
    recalculateMeasureIndexes();
    renderOverlay();
    renderMeasurementsList();
    updateButtons();
    setStatus("Measurement removed.");
  }
}

function exportCsv() {
  if (!state.referenceLine || !state.measureLines.length) {
    return;
  }

  const rows = [
    ["type", "index", "pixels", "value", "unit", "x1", "y1", "x2", "y2"],
    [
      "reference",
      "0",
      formatMeasure(distance(state.referenceLine)),
      formatMeasure(state.knownLength),
      state.unit,
      formatMeasure(state.referenceLine.x1),
      formatMeasure(state.referenceLine.y1),
      formatMeasure(state.referenceLine.x2),
      formatMeasure(state.referenceLine.y2),
    ],
  ];

  for (const line of state.measureLines) {
    rows.push([
      "measurement",
      String(line.index),
      formatMeasure(distance(line)),
      formatMeasure(distance(line) * state.scale),
      state.unit,
      formatMeasure(line.x1),
      formatMeasure(line.y1),
      formatMeasure(line.x2),
      formatMeasure(line.y2),
    ]);
  }

  const csv = rows.map((row) => row.join(",")).join("\n");
  downloadFile("measurements.csv", csv, "text/csv;charset=utf-8;");
}

function exportTxt() {
  if (!state.referenceLine || !state.measureLines.length) {
    return;
  }

  const lines = [];
  lines.push("ImageMeasurer OSS export");
  lines.push("");
  lines.push(`Reference: ${formatMeasure(state.knownLength)} ${state.unit}`);
  lines.push(`Reference pixels: ${formatMeasure(distance(state.referenceLine))}`);
  lines.push("");
  lines.push("Measurements:");

  for (const line of state.measureLines) {
    const value = distance(line) * state.scale;
    lines.push(
      `${line.index}) ${formatMeasure(value)} ${state.unit} (pixels: ${formatMeasure(distance(line))})`
    );
  }

  downloadFile("measurements.txt", lines.join("\n"), "text/plain;charset=utf-8;");
}

function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

applyKnownBtn.addEventListener("click", applyKnownLength);

undoBtn.addEventListener("click", () => {
  if (state.measureLines.length > 0) {
    state.measureLines.pop();
    recalculateMeasureIndexes();
    renderOverlay();
    renderMeasurementsList();
    updateButtons();
    updateStatusFromState("Last measurement removed.");
    return;
  }

  if (state.referenceLine) {
    state.referenceLine = null;
    state.scale = null;
    renderOverlay();
    renderMeasurementsList();
    updateButtons();
    updateStatusFromState("Reference removed.");
  }
});

clearBtn.addEventListener("click", () => {
  if (!state.imageLoaded) {
    return;
  }
  resetAll();
  setStatus("Everything cleared. Apply known length to calibrate again.");
});

imageInput.addEventListener("change", (event) => {
  const file = event.target.files && event.target.files[0];
  if (!file) {
    return;
  }
  loadImage(file);
});

exportCsvBtn.addEventListener("click", exportCsv);
exportTxtBtn.addEventListener("click", exportTxt);

overlay.addEventListener("pointerdown", onPointerDown);
overlay.addEventListener("pointermove", onPointerMove);
overlay.addEventListener("pointerup", onPointerUp);
overlay.addEventListener("pointercancel", onPointerUp);
overlay.addEventListener("pointerleave", () => {
  if (!state.drawing) {
    state.hoveredLine = null;
    renderOverlay();
  }
});

overlay.addEventListener("dblclick", (event) => {
  if (!(event.target instanceof SVGLineElement)) {
    return;
  }
  const lineId = Number(event.target.dataset.lineId);
  const lineType = event.target.dataset.lineType;
  if (!Number.isFinite(lineId) || !lineType) {
    return;
  }
  deleteLine(lineId, lineType);
});

magnifierToggle.addEventListener("change", () => {
  if (!magnifierToggle.checked) {
    hideLoupe();
  }
});

themeToggle.addEventListener("change", () => {
  document.body.dataset.theme = themeToggle.checked ? "light" : "dark";
});

window.addEventListener("resize", () => {
  if (state.imageLoaded) {
    renderOverlay();
  }
});

renderMeasurementsList();
updateButtons();
updateStatusFromState();
