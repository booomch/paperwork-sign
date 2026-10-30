import './style.css';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type PageViewport } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PDFDocument } from 'pdf-lib';
import { clamp, signPdf, signatureBounds, resizeSignatureBounds, type PagePoint, type Placement } from './pdf';
import { removeWhiteBackground, type Signature } from './library';

GlobalWorkerOptions.workerSrc = workerUrl;

function element<T extends HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing UI element: ${id}`);
  return result as T;
}
const pdfInput = element<HTMLInputElement>('pdf-input');
const pdfCanvas = element<HTMLCanvasElement>('pdf-canvas');
const stage = element('pdf-stage');
const layer = element('signature-layer');
const downloadButton = element<HTMLButtonElement>('download');
const sizeInput = element<HTMLInputElement>('signature-size');
const removeWhite = element<HTMLInputElement>('remove-white');
const opaqueInk = element<HTMLInputElement>('opaque-ink');

let pdf: PDFDocumentProxy | undefined;
let original: Uint8Array | undefined;
let filename = '';
let pageNumber = 1;
let placements: Placement[] = [];
let selectedId: number | undefined;
let nextId = 1;
let busy = false;
let rendering = false;
let renderAgain = false;
let messageTimer: ReturnType<typeof setTimeout> | undefined;
let libraryBusy = false;
const signatures: Signature[] = [];
let nextSignatureId = 1;
const viewports = new Map<number, PageViewport>();
const signatureDragType = 'application/x-paperwork-signature';

function notify(message: string, error = false) {
  clearTimeout(messageTimer);
  const box = element('message');
  box.textContent = message;
  box.classList.toggle('error', error);
  box.hidden = false;
  if (!error) messageTimer = setTimeout(() => { box.hidden = true; }, 5000);
}

function report(error: unknown) {
  console.error(error);
  notify(error instanceof Error ? error.message : 'Something went wrong. Please try again.', true);
}

function updateControls() {
  layer.inert = busy;
  sizeInput.disabled = busy;
  element<HTMLButtonElement>('duplicate-signature').disabled = busy;
  element<HTMLButtonElement>('remove-signature').disabled = busy;
  element<HTMLButtonElement>('upload-variants').disabled = libraryBusy;
  removeWhite.disabled = libraryBusy;
  opaqueInk.disabled = libraryBusy || !removeWhite.checked;
  for (const button of element('signature-library').querySelectorAll('button')) {
    button.disabled = !pdf || busy || libraryBusy;
    button.draggable = !button.disabled && !matchMedia('(pointer: coarse)').matches;
  }
  downloadButton.disabled = !pdf || !placements.length || busy;
  element<HTMLButtonElement>('previous-page').disabled = !pdf || pageNumber <= 1 || busy;
  element<HTMLButtonElement>('next-page').disabled = !pdf || pageNumber >= pdf.numPages || busy;
  element('page-label').textContent = pdf ? `${pageNumber} / ${pdf.numPages}` : 'No document';
  element('placement-count').textContent = placements.length
    ? `${placements.length} signature${placements.length === 1 ? '' : 's'} added`
    : pdf ? 'Add a signature to get started.' : 'Ready when you are.';
  const selected = placements.find(item => item.id === selectedId);
  element('placement-tools').hidden = !selected;
  if (selected) {
    const maxSize = resizeSignatureBounds(selected, 1).width * 100;
    sizeInput.min = String(Math.min(1, maxSize));
    sizeInput.max = String(maxSize);
    sizeInput.value = String(selected.width * 100);
  }
}

function selectSignature(id: number | undefined) {
  selectedId = id;
  for (const child of layer.children) {
    child.classList.toggle('selected', child instanceof HTMLElement && Number(child.dataset.id) === id);
  }
  updateControls();
}

function positionSignature(button: HTMLElement, placement: Placement) {
  button.style.left = `${placement.x * 100}%`;
  button.style.top = `${placement.y * 100}%`;
  button.style.width = `${placement.width * 100}%`;
  button.style.height = `${placement.height * 100}%`;
}

function renderSignatures() {
  layer.replaceChildren();
  for (const placement of placements.filter(item => item.page === pageNumber)) {
    const button = document.createElement('button');
    button.className = 'placed-signature';
    button.dataset.id = String(placement.id);
    button.setAttribute('aria-label', 'Signature. Drag or use arrow keys to move.');
    const image = document.createElement('img');
    image.src = placement.image;
    image.alt = '';
    image.draggable = false;
    const resizeHandle = document.createElement('span');
    resizeHandle.className = 'resize-handle';
    resizeHandle.title = 'Drag to resize signature';
    resizeHandle.setAttribute('aria-hidden', 'true');
    button.append(image, resizeHandle);
    positionSignature(button, placement);
    resizeHandle.addEventListener('pointerdown', event => {
      if (!event.isPrimary || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      button.focus({ preventScroll: true });
      selectSignature(placement.id);
      const bounds = layer.getBoundingClientRect();
      const startX = event.clientX;
      const startY = event.clientY;
      const initialWidth = placement.width;
      const pixelWidth = placement.width * bounds.width;
      const pixelHeight = placement.height * bounds.height;
      resizeHandle.setPointerCapture(event.pointerId);
      const move = (moveEvent: PointerEvent) => {
        const growth = ((moveEvent.clientX - startX) * pixelWidth + (moveEvent.clientY - startY) * pixelHeight)
          / (pixelWidth * pixelWidth + pixelHeight * pixelHeight);
        Object.assign(placement, resizeSignatureBounds(placement, initialWidth * (1 + growth)));
        positionSignature(button, placement);
        updateControls();
      };
      const finish = () => {
        resizeHandle.removeEventListener('pointermove', move);
        resizeHandle.removeEventListener('pointerup', finish);
        resizeHandle.removeEventListener('pointercancel', finish);
      };
      resizeHandle.addEventListener('pointermove', move);
      resizeHandle.addEventListener('pointerup', finish);
      resizeHandle.addEventListener('pointercancel', finish);
    });
    button.addEventListener('focus', () => selectSignature(placement.id));
    button.addEventListener('pointerdown', event => {
      if (!event.isPrimary || event.button !== 0) return;
      event.preventDefault();
      button.focus({ preventScroll: true });
      selectSignature(placement.id);
      const bounds = layer.getBoundingClientRect();
      const startX = event.clientX;
      const startY = event.clientY;
      const x = placement.x;
      const y = placement.y;
      button.setPointerCapture(event.pointerId);
      const move = (moveEvent: PointerEvent) => {
        placement.x = clamp(x + (moveEvent.clientX - startX) / bounds.width, 0, 1 - placement.width);
        placement.y = clamp(y + (moveEvent.clientY - startY) / bounds.height, 0, 1 - placement.height);
        positionSignature(button, placement);
      };
      const finish = () => {
        button.removeEventListener('pointermove', move);
        button.removeEventListener('pointerup', finish);
        button.removeEventListener('pointercancel', finish);
      };
      button.addEventListener('pointermove', move);
      button.addEventListener('pointerup', finish);
      button.addEventListener('pointercancel', finish);
    });
    button.addEventListener('keydown', event => {
      const directions: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
      };
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        removeSelected();
      } else if (directions[event.key]) {
        event.preventDefault();
        const [dx, dy] = directions[event.key];
        const step = event.shiftKey ? 0.02 : 0.002;
        placement.x = clamp(placement.x + dx * step, 0, 1 - placement.width);
        placement.y = clamp(placement.y + dy * step, 0, 1 - placement.height);
        positionSignature(button, placement);
      }
    });
    layer.append(button);
  }
  selectSignature(selectedId);
}

async function renderPage() {
  if (!pdf) return;
  if (rendering) {
    renderAgain = true;
    return;
  }
  rendering = true;
  busy = true;
  updateControls();
  try {
    do {
      renderAgain = false;
      const page = await pdf.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      viewports.set(pageNumber, base);
      const preview = element('preview-scroll');
      const style = getComputedStyle(preview);
      const available = Math.max(100, preview.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
      const viewport = page.getViewport({ scale: Math.min(available / base.width, 1.5) });
      const ratio = window.devicePixelRatio || 1;
      pdfCanvas.width = Math.ceil(viewport.width * ratio);
      pdfCanvas.height = Math.ceil(viewport.height * ratio);
      pdfCanvas.style.width = `${viewport.width}px`;
      pdfCanvas.style.height = `${viewport.height}px`;
      const canvasContext = pdfCanvas.getContext('2d');
      if (!canvasContext) throw new Error('Cannot render PDF preview.');
      await page.render({ canvasContext, viewport, transform: [ratio, 0, 0, ratio, 0, 0] }).promise;
    } while (renderAgain);
    renderSignatures();
  } catch (error) {
    report(error);
  } finally {
    rendering = false;
    busy = false;
    updateControls();
  }
}

async function openPdf(file: File) {
  if (busy) {
    notify('Please wait for the current document operation to finish.');
    return;
  }
  busy = true;
  updateControls();
  let candidate: PDFDocumentProxy | undefined;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await PDFDocument.load(bytes);
    candidate = await getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
    const old = pdf;
    pdf = candidate;
    original = bytes;
    filename = file.name;
    pageNumber = 1;
    placements = [];
    selectedId = undefined;
    viewports.clear();
    element('document-name').textContent = filename;
    element('file-label').textContent = filename;
    element('file-meta').textContent = `${pdf.numPages} page${pdf.numPages === 1 ? '' : 's'} · ${(file.size / 1024 / 1024).toFixed(2)} MB · Click to replace`;
    element('empty-state').hidden = true;
    stage.hidden = false;
    element('message').hidden = true;
    await renderPage();
    if (old) await old.destroy();
  } catch (error) {
    if (candidate && candidate !== pdf) await candidate.destroy();
    report(new Error(`Could not open this PDF. It may be password-protected or damaged. ${error instanceof Error ? error.message : ''}`));
  } finally {
    busy = false;
    pdfInput.value = '';
    updateControls();
  }
}

pdfInput.addEventListener('change', () => {
  const file = pdfInput.files?.[0];
  if (file) void openPdf(file);
});
const dropZone = element('pdf-drop');
dropZone.addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pdfInput.click(); }
});
dropZone.addEventListener('dragover', event => { event.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', event => {
  event.preventDefault();
  dropZone.classList.remove('dragover');
  const file = event.dataTransfer?.files[0];
  if (file) void openPdf(file);
});

async function decodeSignatureFile(file: File) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    throw new Error('Please use a PNG, JPG, or WebP signature image.');
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (image.width * image.height > 25_000_000) throw new Error('Please use a signature image smaller than 25 megapixels.');
    return image;
  } finally { URL.revokeObjectURL(url); }
}

function signatureImage(
  source: HTMLImageElement,
  removeBackground: boolean,
  makeInkOpaque: boolean,
): { image: string; ratio: number } {
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 1600 / Math.max(source.width, source.height));
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Cannot create a signature image.');
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  if (removeBackground) removeWhiteBackground(pixels.data, makeInkOpaque);
  let minX = canvas.width, minY = canvas.height, maxX = -1, maxY = -1;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const offset = (y * canvas.width + x) * 4;
      if (pixels.data[offset + 3] > 8) {
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      }
    }
  }
  if (maxX < minX) throw new Error('This image has no visible signature. Try disabling white-background removal.');
  context.putImageData(pixels, 0, 0);
  const cropped = document.createElement('canvas');
  cropped.width = maxX - minX + 1;
  cropped.height = maxY - minY + 1;
  const croppedContext = cropped.getContext('2d');
  if (!croppedContext) throw new Error('Cannot prepare the signature.');
  croppedContext.drawImage(canvas, minX, minY, cropped.width, cropped.height, 0, 0, cropped.width, cropped.height);
  return { image: cropped.toDataURL('image/png'), ratio: cropped.height / cropped.width };
}

function insertSignature(signature: Signature, point?: PagePoint) {
  if (!pdf || busy) throw new Error('Open a PDF and wait for its preview before inserting a signature.');
  const viewport = viewports.get(pageNumber);
  if (!viewport) throw new Error('Wait for your PDF preview to finish loading.');
  const placement: Placement = {
    id: nextId++, page: pageNumber, image: signature.image,
    ...signatureBounds(signature.ratio, viewport, point),
  };
  addPlacement(placement);
}

function renderLibrary() {
  const list = element('signature-library');
  list.replaceChildren();
  for (const signature of signatures) {
    const button = document.createElement('button');
    button.className = 'saved-signature';
    button.setAttribute('aria-label', `Insert signature ${signature.name}`);
    button.title = 'Drag onto the PDF, or click to insert';
    const image = document.createElement('img');
    image.src = signature.image;
    image.alt = '';
    image.draggable = false;
    image.addEventListener('error', () => report(new Error(`Cannot display signature "${signature.name}". Please upload it again.`)));
    const name = document.createElement('span');
    name.textContent = signature.name;
    button.append(image, name);
    button.addEventListener('click', () => {
      try { insertSignature(signature); }
      catch (error) { report(error); }
    });
    button.addEventListener('dragstart', event => {
      if (button.disabled || !event.dataTransfer) {
        event.preventDefault();
        return;
      }
      event.dataTransfer.setData(signatureDragType, signature.id);
      event.dataTransfer.effectAllowed = 'copy';
      event.dataTransfer.setDragImage(image, image.width / 2, image.height / 2);
    });
    button.addEventListener('dragend', () => stage.classList.remove('drop-target'));
    list.append(button);
  }
  element('library-status').textContent = signatures.length
    ? `${signatures.length} signature${signatures.length === 1 ? '' : 's'} ready · Open a PDF, then drag or click a signature.`
    : 'No signatures yet. Upload a batch to get started.';
  updateControls();
}

stage.addEventListener('dragover', event => {
  if (!pdf || busy || libraryBusy || !event.dataTransfer?.types.includes(signatureDragType)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
  stage.classList.add('drop-target');
});
stage.addEventListener('dragleave', event => {
  if (!(event.relatedTarget instanceof Node) || !stage.contains(event.relatedTarget)) {
    stage.classList.remove('drop-target');
  }
});
stage.addEventListener('drop', event => {
  if (!event.dataTransfer?.types.includes(signatureDragType)) return;
  event.preventDefault();
  stage.classList.remove('drop-target');
  if (!pdf || busy || libraryBusy) {
    notify('Wait for the PDF and signature library to finish loading.', true);
    return;
  }
  const id = event.dataTransfer.getData(signatureDragType);
  const signature = signatures.find(signature => signature.id === id);
  if (!signature) {
    report(new Error('This signature is no longer available. Please upload it again.'));
    return;
  }
  const bounds = stage.getBoundingClientRect();
  try {
    insertSignature(signature, {
      x: (event.clientX - bounds.left) / bounds.width,
      y: (event.clientY - bounds.top) / bounds.height,
    });
  } catch (error) { report(error); }
});

async function libraryOperation(operation: () => Promise<void>) {
  if (libraryBusy) return;
  libraryBusy = true;
  element('message').hidden = true;
  updateControls();
  try { await operation(); }
  catch (error) {
    report(error);
  } finally {
    libraryBusy = false;
    updateControls();
  }
}

const variantsInput = element<HTMLInputElement>('variants-input');
removeWhite.addEventListener('change', updateControls);
element('upload-variants').addEventListener('click', () => variantsInput.click());
variantsInput.addEventListener('change', () => {
  const files = Array.from(variantsInput.files ?? []);
  if (!files.length) return;
  void libraryOperation(async () => {
    const failures: string[] = [];
    let imported = 0;
    const removeBackground = removeWhite.checked;
    const makeInkOpaque = opaqueInk.checked;
    for (const file of files) {
      try {
        const image = await decodeSignatureFile(file);
        signatures.push({
          id: String(nextSignatureId++),
          name: file.name.replace(/\.[^.]+$/, '').slice(0, 80),
          ...signatureImage(image, removeBackground, makeInkOpaque),
        });
        imported++;
      } catch (error) {
        console.error(`Cannot import signature ${file.name}:`, error);
        failures.push(`${file.name}: ${error instanceof Error ? error.message : 'Import failed.'}`);
      }
    }
    variantsInput.value = '';
    renderLibrary();
    if (failures.length) throw new Error(`Imported ${imported} signature(s). ${failures.join(' ')}`);
    notify(`Imported ${imported} signature${imported === 1 ? '' : 's'}. Drag or click one to add it to your PDF.`);
  });
});

function addPlacement(placement: Placement) {
  placements.push(placement);
  selectedId = placement.id;
  renderSignatures();
  const button = layer.querySelector<HTMLButtonElement>(`[data-id="${placement.id}"]`);
  button?.focus({ preventScroll: true });
  if (matchMedia('(max-width: 850px), (pointer: coarse)').matches) {
    button?.scrollIntoView({ block: 'center', inline: 'nearest' });
  }
  notify('Signature added. Drag to move, or use Duplicate to add another copy.');
}

element('duplicate-signature').addEventListener('click', () => {
  const selected = placements.find(item => item.id === selectedId);
  if (!selected || busy) return;
  addPlacement({
    ...selected,
    id: nextId++,
    x: clamp(selected.x + 0.035, 0, 1 - selected.width),
    y: clamp(selected.y + 0.035, 0, 1 - selected.height),
  });
});
sizeInput.addEventListener('input', () => {
  const placement = placements.find(item => item.id === selectedId);
  if (!placement) return;
  Object.assign(placement, resizeSignatureBounds(placement, Number(sizeInput.value) / 100));
  renderSignatures();
});
function removeSelected() {
  placements = placements.filter(item => item.id !== selectedId);
  selectedId = undefined;
  renderSignatures();
}
element('remove-signature').addEventListener('click', removeSelected);
layer.addEventListener('pointerdown', event => {
  if (event.target === layer) selectSignature(undefined);
});
element('previous-page').addEventListener('click', () => {
  if (pageNumber <= 1 || busy) return;
  pageNumber--; selectedId = undefined; void renderPage();
});
element('next-page').addEventListener('click', () => {
  if (!pdf || pageNumber >= pdf.numPages || busy) return;
  pageNumber++; selectedId = undefined; void renderPage();
});

downloadButton.addEventListener('click', async () => {
  if (!original || busy || !placements.length) return;
  busy = true;
  updateControls();
  downloadButton.textContent = 'Preparing PDF...';
  try {
    const bytes = await signPdf(original, placements.map(placement => ({ ...placement })), viewports);
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${filename.replace(/\.pdf$/i, '')}-signed.pdf`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    notify('Your signed PDF is ready. The original is unchanged.');
  } catch (error) { report(error); }
  finally {
    busy = false;
    downloadButton.textContent = 'Download signed PDF ↓';
    updateControls();
  }
});

let resizeTimer: ReturnType<typeof setTimeout> | undefined;
new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (pdf && (!busy || rendering)) void renderPage(); }, 150);
}).observe(element('preview-scroll'));
updateControls();
