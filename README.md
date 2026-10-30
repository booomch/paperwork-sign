# Paperwork

A browser-based PDF signing app. Upload a PDF, upload a batch of signature
images, position them, and download the result. Documents and signatures are
processed entirely in your browser: no file uploads to a server, shared
signature library, cloud services, or accounts.

[Open Paperwork](https://booomch.github.io/paperwork-sign/)

## Run

Requires Node.js 20.16+ and npm.

```sh
npm install
npm run dev
```

Open the localhost URL printed in your terminal.

```sh
npm test
npm run build
npm run preview
```

## Signing

- Choose or drop a PDF. Password-protected PDFs are not supported.
- Click **Upload signature images** and select multiple PNG/JPG/WebP images.
  Upload again to add more signatures. Each image must be at most 25 megapixels.
- For an image on white paper, leave **Remove white background** enabled.
  Disable it before importing if you want to preserve the original image
  background/colors. This setting does not change already imported images.
- **Opaque signature ink on import** is enabled by default with white-background
  removal. It makes visible ink pixels fully opaque, so strokes cover overlapping
  document text without adding a white rectangle. Turn it off to retain softer,
  translucent ink. Re-upload images to apply a changed import setting.
- Drag a signature thumbnail onto the PDF, or click/tap it to insert at the
  center, then drag to position. Select a signature
  and drag its bottom-right corner handle or use the size slider to resize.
  New signatures start at 7% of the page width (smaller for very tall images).
  Resizing preserves its proportions and top-left position and stops at page edges.
  Arrow keys move a focused signature; Shift+Arrow moves faster.
  Delete/Backspace removes the focused signature.
- Click **Duplicate** on a selected signature to add another copy with the same
  image and size. Move each copy independently.
- Click a thumbnail again to reuse that signature. Navigate between pages to
  reuse signatures on other pages, or mix different signatures on the same page.
- Download the signed PDF. Your original file is not modified.

## Phones and tablets

- Choose your PDF and signature images using the device's file picker.
  The signature picker accepts multiple images.
- Tap a signature thumbnail to insert it. The preview scrolls into view
  automatically; dragging thumbnails from the library is not needed on touchscreens.
- Drag a placed signature with one finger. Resize using its corner handle or
  the **Signature size** slider below the preview. **Duplicate** and **Remove**
  are next to the slider.
- Scroll outside the signature to navigate the page. Rotate your device for a
  wider preview; existing placements keep their positions and proportions.
- Tap **Download signed PDF** and save the result using your browser's download
  controls. The app does not require access to your camera or photo library.

## Publish

Pushes to `main` run the tests, build the app, and deploy to
[GitHub Pages](https://booomch.github.io/paperwork-sign/) using
[the deployment workflow](.github/workflows/pages.yml).
In the repository's **Settings → Pages**, the build source must be
**GitHub Actions**. You can also deploy manually from the workflow's
**Run workflow** button.

Run `npm run build` and deploy **only `dist/`** to a static host, such as
GitHub Pages, Netlify, or Cloudflare Pages. No Node server or API is needed
in production. Relative asset URLs support hosting under a subdirectory.
Use HTTPS for the public site.

Do not publish the project root or any personal signature folders. Existing
local signature files are not loaded by the app or included in the build.

This adds visible signature images, not cryptographic or certificate-based
digital signatures. Editing an already digitally signed PDF can invalidate its
existing signatures. Do not rely on this app to preserve existing digital
signatures, interactive forms, or advanced PDF features without checking the output.

The app does not persist PDFs, signatures, or placements: reloading or closing
the tab clears the entire session. Download your signed PDF before leaving.
Fonts, scripts, and PDF processing libraries are bundled locally; no external
services are needed at runtime.
