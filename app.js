const imageInput = document.getElementById("imageInput");
const knownLengthInput = document.getElementById("knownLength");
const unitInput = document.getElementById("unitInput");
const applyKnownBtn = document.getElementById("applyKnownBtn");
const undoBtn = document.getElementById("undoBtn");
const redoBtn = document.getElementById("redoBtn");
const clearBtn = document.getElementById("clearBtn");
const magnifierToggle = document.getElementById("magnifierToggle");
const lockReferenceToggle = document.getElementById("lockReferenceToggle");
const polylineToggle = document.getElementById("polylineToggle");
const themeToggle = document.getElementById("themeToggle");
const exportCsvBtn = document.getElementById("exportCsvBtn");
const exportTxtBtn = document.getElementById("exportTxtBtn");
const exportPngBtn = document.getElementById("exportPngBtn");
const statusEl = document.getElementById("status");
const photo = document.getElementById("photo");
const overlay = document.getElementById("overlay");
const emptyState = document.getElementById("emptyState");
const measureList = document.getElementById("measureList");
const loupe = document.getElementById("loupe");
const unitPresetButtons = Array.from(document.querySelectorAll(".unit-preset"));

const LINE_MIN_PX = 3;
const LOUPE_SIZE = 150;
const LOUPE_ZOOM = 3;
const MAX_HISTORY = 250;

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
  dragMoved: false,
  selectedHandle: null,
  nextId: 1,
  undoStack: [],
  redoStack: [],
};

function setStatus(message) {
  statusEl.textContent = message;
}

function sanitizeUnit(value) {
  return value.trim().replace(/\s+/g, " ").slice(0, 12) || "u";
}

function formatMeasure(value) {
  const normalized = Number.isFinite(value) ? value : 0;
  return normalized.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

function distance(line) {
  const dx = line.x2 - line.x1;
  const dy = line.y2 - line.y1;
  return Math.hypot(dx, dy);
}

function cloneLine(line) {
  return {
    id: line.id,
    x1: line.x1,
    y1: line.y1,
    x2: line.x2,
    y2: line.y2,
    ...(line.index ? { index: line.index } : {}),
  };
}

function isReferenceLocked() {
  return lockReferenceToggle.checked;
}

function isPolylineMode() {
  return polylineToggle.checked;
}

function getPolylineTotal() {
  return state.measureLines.reduce((sum, line) => sum + distance(line) * state.scale, 0);
}

function getPersistentSnapshot() {
  return {
    knownLength: state.knownLength,
    unit: state.unit,
    knownApplied: state.knownApplied,
    referenceLine: state.referenceLine ? cloneLine(state.referenceLine) : null,
    measureLines: state.measureLines.map((line) => cloneLine(line)),
    nextId: state.nextId,
  };
}

function snapshotsEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function applySnapshot(snapshot) {
  state.knownLength = snapshot.knownLength;
  state.unit = snapshot.unit;
  state.knownApplied = snapshot.knownApplied;
  state.referenceLine = snapshot.referenceLine ? { ...snapshot.referenceLine } : null;
  state.measureLines = snapshot.measureLines.map((line) => ({ ...line }));
  state.nextId = snapshot.nextId;

  if (state.knownLength !== null) {
    knownLengthInput.value = String(state.knownLength);
  } else {
    knownLengthInput.value = "";
  }
  unitInput.value = state.unit;

  recalculateMeasureIndexes();
  recomputeScale();
  clearSelectionIfInvalid();
  renderOverlay();
  renderMeasurementsList();
  updateButtons();
  updateUnitPresetButtons();
}

function commitHistory() {
  const snapshot = getPersistentSnapshot();
  const last = state.undoStack[state.undoStack.length - 1];
  if (last && snapshotsEqual(last, snapshot)) {
    return;
  }

  state.undoStack.push(snapshot);
  if (state.undoStack.length > MAX_HISTORY) {
    state.undoStack.shift();
  }
  state.redoStack = [];
}

function initializeHistory() {
  state.undoStack = [];
  state.redoStack = [];
  commitHistory();
}

function performUndo() {
  if (state.undoStack.length <= 1) {
    return;
  }

  const current = state.undoStack.pop();
  state.redoStack.push(current);
  const previous = state.undoStack[state.undoStack.length - 1];
  applySnapshot(previous);
  updateStatusFromState("Undo applied.");
}

function performRedo() {
  if (!state.redoStack.length) {
    return;
  }

  const snapshot = state.redoStack.pop();
  state.undoStack.push(snapshot);
  applySnapshot(snapshot);
  updateStatusFromState("Redo applied.");
}

function recalculateMeasureIndexes() {
  state.measureLines = state.measureLines.map((line, idx) => ({
    ...line,
    index: idx + 1,
  }));
}

function recomputeScale() {
  if (!state.referenceLine || !state.knownLength) {
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
  if (state.selectedHandle) {
    return "Handle selected. Use arrow keys for fine tuning (Shift = 10 px).";
  }
  return "Calibrated. Draw measurement lines or select handles to adjust.";
}

function updateStatusFromState(extra = "") {
  const base = getBaseStatus();
  setStatus(extra ? `${base} ${extra}` : base);
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

function getRects() {
  const overlayRect = overlay.getBoundingClientRect();
  const photoRect = photo.getBoundingClientRect();
  return { overlayRect, photoRect };
}

function clampNaturalPoint(point) {
  return {
    x: Math.max(0, Math.min(photo.naturalWidth, point.x)),
    y: Math.max(0, Math.min(photo.naturalHeight, point.y)),
  };
}

function getNaturalPointFromEvent(event) {
  const { photoRect } = getRects();
  const localX = event.clientX - photoRect.left;
  const localY = event.clientY - photoRect.top;
  return clampNaturalPoint({
    x: (localX / photoRect.width) * photo.naturalWidth,
    y: (localY / photoRect.height) * photo.naturalHeight,
  });
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

function makeHandle(x, y, lineId, lineType, endpoint, selected) {
  const handle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  handle.setAttribute("cx", x);
  handle.setAttribute("cy", y);
  handle.setAttribute("r", 6);
  handle.setAttribute("class", selected ? "line-handle selected" : "line-handle");
  handle.dataset.lineId = String(lineId);
  handle.dataset.lineType = lineType;
  handle.dataset.endpoint = endpoint;
  return handle;
}

function lineLabel(line) {
  if (line.type === "reference") {
    return `Reference: ${formatMeasure(state.knownLength)} ${state.unit}`;
  }
  const value = distance(line) * state.scale;
  return `${line.index}. ${formatMeasure(value)} ${state.unit}`;
}

function isHandleSelected(line, endpoint) {
  return (
    state.selectedHandle &&
    state.selectedHandle.lineId === line.id &&
    state.selectedHandle.lineType === line.type &&
    state.selectedHandle.endpoint === endpoint
  );
}

function shouldShowHandles(line) {
  if (line.type === "reference" && isReferenceLocked()) {
    return false;
  }
  if (state.hoveredLine === line.id) {
    return true;
  }
  if (state.dragHandle && state.dragHandle.lineId === line.id) {
    return true;
  }
  if (state.selectedHandle && state.selectedHandle.lineId === line.id) {
    return true;
  }
  return false;
}

function renderLine(line) {
  const p1 = toDisplay({ x: line.x1, y: line.y1 });
  const p2 = toDisplay({ x: line.x2, y: line.y2 });
  const cls = line.type === "reference" ? "ref-line" : "measure-line";

  const visibleLine = makeLineElement(p1.x, p1.y, p2.x, p2.y, cls);
  visibleLine.dataset.lineId = String(line.id);
  visibleLine.dataset.lineType = line.type;
  overlay.appendChild(visibleLine);

  const hitLine = makeLineElement(p1.x, p1.y, p2.x, p2.y, "line-hit");
  hitLine.dataset.lineId = String(line.id);
  hitLine.dataset.lineType = line.type;
  overlay.appendChild(hitLine);

  const midX = (p1.x + p2.x) / 2;
  const midY = (p1.y + p2.y) / 2;
  overlay.appendChild(makeLabel(midX + 6, midY - 6, lineLabel(line)));

  if (!shouldShowHandles(line)) {
    return;
  }

  overlay.appendChild(
    makeHandle(p1.x, p1.y, line.id, line.type, "start", isHandleSelected(line, "start"))
  );
  overlay.appendChild(
    makeHandle(p2.x, p2.y, line.id, line.type, "end", isHandleSelected(line, "end"))
  );
}

function renderPreviewLine() {
  if (!state.tempLine) {
    return;
  }

  const p1 = toDisplay({ x: state.tempLine.x1, y: state.tempLine.y1 });
  const p2 = toDisplay({ x: state.tempLine.x2, y: state.tempLine.y2 });
  overlay.appendChild(makeLineElement(p1.x, p1.y, p2.x, p2.y, "preview-line"));

  const px = distance(state.tempLine);
  const text = !state.referenceLine
    ? `px: ${formatMeasure(px)}`
    : `${formatMeasure(px * state.scale)} ${state.unit}`;
  overlay.appendChild(makeLabel((p1.x + p2.x) / 2 + 6, (p1.y + p2.y) / 2 - 6, text));
}

function renderOverlay() {
  overlay.innerHTML = "";
  for (const line of getAllLines()) {
    renderLine(line);
  }
  renderPreviewLine();
}

function renderMeasurementsList() {
  measureList.innerHTML = "";

  if (state.referenceLine) {
    const known = document.createElement("li");
    known.textContent = `Known Measure: ${formatMeasure(state.knownLength)} ${state.unit}`;
    measureList.appendChild(known);
  }

  if (!state.referenceLine && !state.measureLines.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "No measurements yet.";
    measureList.appendChild(empty);
    return;
  }

  for (const line of state.measureLines) {
    const value = distance(line) * state.scale;
    const li = document.createElement("li");
    li.textContent = `Measure ${line.index}: ${formatMeasure(value)} ${state.unit}`;
    measureList.appendChild(li);
  }

  if (isPolylineMode() && state.measureLines.length) {
    const total = document.createElement("li");
    total.textContent = `Polyline total: ${formatMeasure(getPolylineTotal())} ${state.unit}`;
    measureList.appendChild(total);
  }
}

function updateButtons() {
  const hasImage = state.imageLoaded;
  const hasAnyLine = Boolean(state.referenceLine) || state.measureLines.length > 0;
  const hasReference = Boolean(state.referenceLine);

  applyKnownBtn.disabled = !hasImage;
  undoBtn.disabled = state.undoStack.length <= 1;
  redoBtn.disabled = state.redoStack.length === 0;
  clearBtn.disabled = !hasImage;
  exportCsvBtn.disabled = !hasReference || state.measureLines.length === 0;
  exportTxtBtn.disabled = !hasReference || state.measureLines.length === 0;
  exportPngBtn.disabled = !hasImage;

  applyKnownBtn.classList.toggle("active", state.knownApplied && !state.referenceLine);
}

function updateUnitPresetButtons() {
  const current = sanitizeUnit(unitInput.value).toLowerCase();
  for (const button of unitPresetButtons) {
    const active = button.dataset.unit === current;
    button.classList.toggle("active", active);
  }
}

function findLine(lineId, lineType) {
  if (lineType === "reference") {
    return state.referenceLine && state.referenceLine.id === lineId ? state.referenceLine : null;
  }
  if (lineType === "measure") {
    return state.measureLines.find((line) => line.id === lineId) || null;
  }
  return null;
}

function getSelectedHandlePoint() {
  if (!state.selectedHandle) {
    return null;
  }
  const line = findLine(state.selectedHandle.lineId, state.selectedHandle.lineType);
  if (!line) {
    return null;
  }

  if (state.selectedHandle.endpoint === "start") {
    return { x: line.x1, y: line.y1 };
  }
  return { x: line.x2, y: line.y2 };
}

function showLoupeAtNaturalPoint(point) {
  if (!state.imageLoaded || !photo.src) {
    return;
  }

  const display = toDisplay(point);
  const { photoRect } = getRects();
  const displayPoint = {
    x: display.x - (photoRect.left - overlay.getBoundingClientRect().left),
    y: display.y - (photoRect.top - overlay.getBoundingClientRect().top),
  };

  const localX = Math.max(0, Math.min(photoRect.width, displayPoint.x));
  const localY = Math.max(0, Math.min(photoRect.height, displayPoint.y));
  const posX = display.x + 16;
  const posY = display.y + 16;

  loupe.hidden = false;
  loupe.style.left = `${posX}px`;
  loupe.style.top = `${posY}px`;
  loupe.style.backgroundImage = `url(${photo.src})`;
  loupe.style.backgroundSize = `${photoRect.width * LOUPE_ZOOM}px ${photoRect.height * LOUPE_ZOOM}px`;
  loupe.style.backgroundPosition = `${-(localX * LOUPE_ZOOM - LOUPE_SIZE / 2)}px ${-(localY * LOUPE_ZOOM - LOUPE_SIZE / 2)}px`;
}

function updateLoupeFromPointer(event) {
  if (!magnifierToggle.checked || !state.drawing) {
    return;
  }
  const point = getNaturalPointFromEvent(event);
  showLoupeAtNaturalPoint(point);
}

function hideLoupe() {
  loupe.hidden = true;
}

function clearSelectionIfInvalid() {
  if (!state.selectedHandle) {
    return;
  }

  const line = findLine(state.selectedHandle.lineId, state.selectedHandle.lineType);
  const invalidByLock = line && line.type === "reference" && isReferenceLocked();
  if (!line || invalidByLock) {
    state.selectedHandle = null;
    hideLoupe();
  }
}

function selectHandle(lineId, lineType, endpoint) {
  const line = findLine(lineId, lineType);
  if (!line) {
    return;
  }
  if (lineType === "reference" && isReferenceLocked()) {
    setStatus("Known measure is locked. Disable lock to edit reference.");
    return;
  }

  state.selectedHandle = { lineId, lineType, endpoint };
  const point = endpoint === "start" ? { x: line.x1, y: line.y1 } : { x: line.x2, y: line.y2 };
  showLoupeAtNaturalPoint(point);
  renderOverlay();
  updateStatusFromState("Handle selected.");
}

function resetTransientState() {
  state.tempLine = null;
  state.drawing = false;
  state.activePointerId = null;
  state.dragHandle = null;
  state.dragMoved = false;
}

function resetAll() {
  state.knownApplied = false;
  state.knownLength = null;
  state.unit = sanitizeUnit(unitInput.value);
  state.referenceLine = null;
  state.measureLines = [];
  state.scale = null;
  state.hoveredLine = null;
  state.selectedHandle = null;
  hideLoupe();
  resetTransientState();
  initializeHistory();
  renderOverlay();
  renderMeasurementsList();
  updateButtons();
  updateUnitPresetButtons();
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
  state.selectedHandle = null;
  hideLoupe();
  resetTransientState();

  recalculateMeasureIndexes();
  renderOverlay();
  renderMeasurementsList();
  commitHistory();
  updateButtons();
  updateUnitPresetButtons();
  setStatus("Known length applied. Draw your first line as the reference.");
}

function createLineFromTemp() {
  const candidate = { ...state.tempLine };
  if (distance(candidate) < LINE_MIN_PX) {
    setStatus("Line is too short. Try again.");
    return;
  }

  if (!state.referenceLine) {
    state.referenceLine = {
      id: state.nextId++,
      ...candidate,
    };
    recomputeScale();
    setStatus(
      `Reference calibrated: ${formatMeasure(state.knownLength)} ${state.unit}. Draw any line to measure.`
    );
    return;
  }

  const nextIndex = state.measureLines.length + 1;
  state.measureLines.push({
    id: state.nextId++,
    index: nextIndex,
    ...candidate,
  });

  const value = distance(candidate) * state.scale;
  if (isPolylineMode()) {
    const total = getPolylineTotal();
    setStatus(
      `Segment ${nextIndex}: ${formatMeasure(value)} ${state.unit}. Total: ${formatMeasure(total)} ${state.unit}`
    );
  } else {
    setStatus(`Measurement ${nextIndex}: ${formatMeasure(value)} ${state.unit}`);
  }
}

function updateLineEndpoint(line, endpoint, point) {
  const clamped = clampNaturalPoint(point);
  if (endpoint === "start") {
    line.x1 = clamped.x;
    line.y1 = clamped.y;
  } else {
    line.x2 = clamped.x;
    line.y2 = clamped.y;
  }
}

function beginDrawing(event) {
  event.preventDefault();
  state.selectedHandle = null;
  hideLoupe();
  overlay.setPointerCapture(event.pointerId);
  state.activePointerId = event.pointerId;
  state.drawing = true;
  const start = getNaturalPointFromEvent(event);
  state.tempLine = {
    x1: start.x,
    y1: start.y,
    x2: start.x,
    y2: start.y,
  };
  updateLoupeFromPointer(event);
  renderOverlay();
}

function beginHandleDrag(event, target) {
  event.preventDefault();
  const lineId = Number(target.dataset.lineId);
  const lineType = target.dataset.lineType;
  const endpoint = target.dataset.endpoint;
  if (!Number.isFinite(lineId) || !lineType || !endpoint) {
    return;
  }
  if (lineType === "reference" && isReferenceLocked()) {
    setStatus("Known measure is locked. Disable lock to edit reference.");
    return;
  }

  selectHandle(lineId, lineType, endpoint);

  overlay.setPointerCapture(event.pointerId);
  state.activePointerId = event.pointerId;
  state.dragHandle = { lineId, lineType, endpoint };
  state.dragMoved = false;
}

function onPointerDown(event) {
  if (!state.imageLoaded || !state.knownApplied) {
    return;
  }

  if (event.target instanceof SVGCircleElement && event.target.classList.contains("line-handle")) {
    beginHandleDrag(event, event.target);
    return;
  }

  beginDrawing(event);
}

function onPointerMove(event) {
  const target = event.target;

  if (!state.drawing && !state.dragHandle) {
    if (target instanceof SVGLineElement) {
      const id = Number(target.dataset.lineId);
      state.hoveredLine = Number.isFinite(id) ? id : null;
    } else if (!(target instanceof SVGCircleElement)) {
      state.hoveredLine = null;
    }
  }

  if (state.dragHandle && event.pointerId === state.activePointerId) {
    const line = findLine(state.dragHandle.lineId, state.dragHandle.lineType);
    if (!line) {
      return;
    }

    const point = getNaturalPointFromEvent(event);
    updateLineEndpoint(line, state.dragHandle.endpoint, point);
    if (line.type === "reference") {
      recomputeScale();
    }

    state.dragMoved = true;
    showLoupeAtNaturalPoint(point);
    renderOverlay();
    renderMeasurementsList();
    return;
  }

  if (state.drawing && event.pointerId === state.activePointerId && state.tempLine) {
    const point = getNaturalPointFromEvent(event);
    state.tempLine.x2 = point.x;
    state.tempLine.y2 = point.y;
    updateLoupeFromPointer(event);
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
    const changed = state.dragMoved;
    state.dragHandle = null;
    state.dragMoved = false;

    recalculateMeasureIndexes();
    recomputeScale();
    renderOverlay();
    renderMeasurementsList();

    if (changed) {
      commitHistory();
      updateStatusFromState("Line updated.");
    }

    updateButtons();
    state.activePointerId = null;
    return;
  }

  if (!state.drawing || !state.tempLine) {
    resetTransientState();
    renderOverlay();
    return;
  }

  createLineFromTemp();
  resetTransientState();
  recalculateMeasureIndexes();
  recomputeScale();
  renderOverlay();
  renderMeasurementsList();
  commitHistory();
  updateButtons();
  updateStatusFromState();
}

function deleteLine(lineId, lineType) {
  if (lineType === "reference" && state.referenceLine?.id === lineId) {
    if (isReferenceLocked()) {
      setStatus("Known measure is locked. Disable lock to remove it.");
      return;
    }
    state.referenceLine = null;
    state.measureLines = [];
    state.scale = null;
    state.selectedHandle = null;
    hideLoupe();
    commitHistory();
    renderOverlay();
    renderMeasurementsList();
    updateButtons();
    setStatus("Reference removed. Draw a new reference line.");
    return;
  }

  if (lineType === "measure") {
    state.measureLines = state.measureLines.filter((line) => line.id !== lineId);
    recalculateMeasureIndexes();
    clearSelectionIfInvalid();
    commitHistory();
    renderOverlay();
    renderMeasurementsList();
    updateButtons();
    setStatus("Measurement removed.");
  }
}

function moveSelectedHandle(dx, dy) {
  if (!state.selectedHandle) {
    return false;
  }

  const line = findLine(state.selectedHandle.lineId, state.selectedHandle.lineType);
  if (!line) {
    return false;
  }

  if (line.type === "reference" && isReferenceLocked()) {
    setStatus("Known measure is locked. Disable lock to edit reference.");
    return false;
  }

  const current = state.selectedHandle.endpoint === "start"
    ? { x: line.x1, y: line.y1 }
    : { x: line.x2, y: line.y2 };

  const nextPoint = clampNaturalPoint({ x: current.x + dx, y: current.y + dy });
  updateLineEndpoint(line, state.selectedHandle.endpoint, nextPoint);

  if (line.type === "reference") {
    recomputeScale();
  }

  commitHistory();
  renderOverlay();
  renderMeasurementsList();
  showLoupeAtNaturalPoint(nextPoint);
  updateButtons();
  updateStatusFromState("Fine adjustment applied.");
  return true;
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
      ...(isPolylineMode() ? [""] : []),
    ],
  ];

  if (isPolylineMode()) {
    rows[0].push("polyline_running_total");
  }

  let runningTotal = 0;
  for (const line of state.measureLines) {
    const lineValue = distance(line) * state.scale;
    runningTotal += lineValue;
    rows.push([
      "measurement",
      String(line.index),
      formatMeasure(distance(line)),
      formatMeasure(lineValue),
      state.unit,
      formatMeasure(line.x1),
      formatMeasure(line.y1),
      formatMeasure(line.x2),
      formatMeasure(line.y2),
      ...(isPolylineMode() ? [formatMeasure(runningTotal)] : []),
    ]);
  }

  const csv = rows.map((row) => row.join(",")).join("\n");
  downloadBlob("measurements.csv", new Blob([csv], { type: "text/csv;charset=utf-8;" }));
}

function exportTxt() {
  if (!state.referenceLine || !state.measureLines.length) {
    return;
  }

  const lines = [];
  lines.push("ImageMeasurer OSS export");
  lines.push("");
  lines.push(`Known Measure: ${formatMeasure(state.knownLength)} ${state.unit}`);
  lines.push(`Reference pixels: ${formatMeasure(distance(state.referenceLine))}`);
  lines.push("");
  lines.push("Measurements:");

  let runningTotal = 0;
  for (const line of state.measureLines) {
    const value = distance(line) * state.scale;
    runningTotal += value;
    if (isPolylineMode()) {
      lines.push(
        `${line.index}) ${formatMeasure(value)} ${state.unit} | running total: ${formatMeasure(runningTotal)} ${state.unit}`
      );
    } else {
      lines.push(`${line.index}) ${formatMeasure(value)} ${state.unit}`);
    }
  }

  if (isPolylineMode()) {
    lines.push("");
    lines.push(`Polyline total: ${formatMeasure(runningTotal)} ${state.unit}`);
  }

  downloadBlob("measurements.txt", new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8;" }));
}

function drawCanvasLabel(ctx, x, y, text) {
  ctx.font = "bold 28px Trebuchet MS";
  ctx.lineJoin = "round";
  ctx.lineWidth = 7;
  ctx.strokeStyle = "#ffffff";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = "#0b0f16";
  ctx.fillText(text, x, y);
}

function exportAnnotatedPng() {
  if (!state.imageLoaded || !photo.naturalWidth || !photo.naturalHeight) {
    return;
  }

  const canvas = document.createElement("canvas");
  canvas.width = photo.naturalWidth;
  canvas.height = photo.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  ctx.drawImage(photo, 0, 0, canvas.width, canvas.height);

  if (state.referenceLine) {
    ctx.strokeStyle = "#ffb84f";
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(state.referenceLine.x1, state.referenceLine.y1);
    ctx.lineTo(state.referenceLine.x2, state.referenceLine.y2);
    ctx.stroke();

    const refMidX = (state.referenceLine.x1 + state.referenceLine.x2) / 2;
    const refMidY = (state.referenceLine.y1 + state.referenceLine.y2) / 2;
    drawCanvasLabel(
      ctx,
      refMidX + 12,
      refMidY - 12,
      `Known: ${formatMeasure(state.knownLength)} ${state.unit}`
    );
  }

  for (const line of state.measureLines) {
    ctx.strokeStyle = "#67c0ff";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(line.x1, line.y1);
    ctx.lineTo(line.x2, line.y2);
    ctx.stroke();

    const midX = (line.x1 + line.x2) / 2;
    const midY = (line.y1 + line.y2) / 2;
    const value = distance(line) * state.scale;
    drawCanvasLabel(ctx, midX + 10, midY - 10, `${line.index}. ${formatMeasure(value)} ${state.unit}`);
  }

  canvas.toBlob((blob) => {
    if (!blob) {
      return;
    }
    downloadBlob("measurements-annotated.png", blob);
  }, "image/png");
}

function downloadBlob(filename, blob) {
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
undoBtn.addEventListener("click", performUndo);
redoBtn.addEventListener("click", performRedo);

clearBtn.addEventListener("click", () => {
  if (!state.imageLoaded) {
    return;
  }

  resetAll();
  commitHistory();
  updateButtons();
  setStatus("Everything cleared. Apply known length to calibrate again.");
});

for (const button of unitPresetButtons) {
  button.addEventListener("click", () => {
    const unit = button.dataset.unit;
    if (!unit) {
      return;
    }
    unitInput.value = unit;
    updateUnitPresetButtons();
    updateStatusFromState(`Unit preset selected: ${unit}.`);
  });
}

unitInput.addEventListener("input", () => {
  updateUnitPresetButtons();
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
exportPngBtn.addEventListener("click", exportAnnotatedPng);

overlay.addEventListener("pointerdown", onPointerDown);
overlay.addEventListener("pointermove", onPointerMove);
overlay.addEventListener("pointerup", onPointerUp);
overlay.addEventListener("pointercancel", onPointerUp);
overlay.addEventListener("pointerleave", () => {
  if (!state.drawing && !state.dragHandle) {
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
  if (!magnifierToggle.checked && !state.selectedHandle) {
    hideLoupe();
  }
});

lockReferenceToggle.addEventListener("change", () => {
  clearSelectionIfInvalid();
  renderOverlay();
  updateStatusFromState(
    isReferenceLocked()
      ? "Known measure locked."
      : "Known measure unlocked."
  );
});

polylineToggle.addEventListener("change", () => {
  renderMeasurementsList();
  updateStatusFromState(
    isPolylineMode()
      ? "Polyline accumulate mode enabled."
      : "Polyline accumulate mode disabled."
  );
});

themeToggle.addEventListener("change", () => {
  document.body.dataset.theme = themeToggle.checked ? "light" : "dark";
});

window.addEventListener("keydown", (event) => {
  if (!state.selectedHandle) {
    return;
  }

  const keyToVector = {
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
  };

  const vector = keyToVector[event.key];
  if (!vector) {
    return;
  }

  event.preventDefault();
  const step = event.shiftKey ? 10 : 1;
  moveSelectedHandle(vector[0] * step, vector[1] * step);
});

window.addEventListener("resize", () => {
  if (!state.imageLoaded) {
    return;
  }
  renderOverlay();
  const selectedPoint = getSelectedHandlePoint();
  if (selectedPoint) {
    showLoupeAtNaturalPoint(selectedPoint);
  }
});

initializeHistory();
renderMeasurementsList();
updateButtons();
updateUnitPresetButtons();
updateStatusFromState();
