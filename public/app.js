(() => {
  const PRINT_W = 1600; // 4 inches @ 400 DPI
  const PRINT_H = 2400; // 6 inches @ 400 DPI (Exact 2:3 / 4x6 portrait)

  const state = {
    step: 1,
    categories: [],
    selectedCategory: null,
    selectedPhoto: null,
    stream: null,
    isBusy: false,
    bgImg: null,
    cutoutImg: null,
    cloudinaryCloudName: "",
    cloudinaryUploadPreset: "",
    uploadSeq: 0,
    reuploadTimer: null,
    placement: {
      scale: 0.68,
      offsetX: 0,
      offsetY: 0,
    },
    isDragging: false,
    dragStart: { x: 0, y: 0, origOffsetX: 0, origOffsetY: 0 },
  };

  const els = {
    stepPills: document.querySelectorAll(".step-pill"),
    views: {
      1: document.getElementById("step1View"),
      2: document.getElementById("step2View"),
      3: document.getElementById("step3View"),
      4: document.getElementById("step4View"),
    },
    brandHomeBtn: document.getElementById("brandHomeBtn"),
    apiWarningBanner: document.getElementById("apiWarningBanner"),
    toastBanner: document.getElementById("toastBanner"),
    toastMessage: document.getElementById("toastMessage"),
    toastCloseBtn: document.getElementById("toastCloseBtn"),

    categoriesGrid: document.getElementById("categoriesGrid"),
    categoryPages: document.getElementById("categoryPages"),
    photosGrid: document.getElementById("photosGrid"),
    photoPages: document.getElementById("photoPages"),
    backToGroupsBtn: document.getElementById("backToGroupsBtn"),
    backToPhotosBtn: document.getElementById("backToPhotosBtn"),

    cameraVideo: document.getElementById("cameraVideo"),
    countdownOverlay: document.getElementById("countdownOverlay"),
    countdownNumber: document.getElementById("countdownNumber"),
    shutterFlash: document.getElementById("shutterFlash"),
    processingOverlay: document.getElementById("processingOverlay"),
    cameraSelect: document.getElementById("cameraSelect"),
    capturePhotoBtn: document.getElementById("capturePhotoBtn"),
    uploadFileInput: document.getElementById("uploadFileInput"),
    uploadFallbackBtn: document.getElementById("uploadFallbackBtn"),

    compositeCanvas: document.getElementById("compositeCanvas"),
    qrLoading: document.getElementById("qrLoading"),
    qrLinkWrap: document.getElementById("qrLinkWrap"),
    qrCodeImg: document.getElementById("qrCodeImg"),
    qrMissing: document.getElementById("qrMissing"),
    qrStatusText: document.getElementById("qrStatusText"),
    retryQrBtn: document.getElementById("retryQrBtn"),

    homeResultBtn: document.getElementById("homeResultBtn"),
    scaleSlider: document.getElementById("scaleSlider"),
    verticalSlider: document.getElementById("verticalSlider"),
    resetAdjustBtn: document.getElementById("resetAdjustBtn"),
    printFinalBtn: document.getElementById("printFinalBtn"),
    downloadFinalBtn: document.getElementById("downloadFinalBtn"),
    printImage: document.getElementById("printImage"),
  };

  let toastTimer = null;
  function showError(msg) {
    els.toastMessage.textContent = msg;
    els.toastBanner.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toastBanner.classList.add("hidden"), 7000);
  }

  els.toastCloseBtn.addEventListener("click", () => {
    els.toastBanner.classList.add("hidden");
  });

  async function checkApiStatus() {
    try {
      const res = await fetch("/api/status");
      const data = await res.json();
      els.apiWarningBanner.classList.toggle("hidden", Boolean(data.falKeyConfigured));
      state.cloudinaryCloudName = data.cloudinaryCloudName || "";
      state.cloudinaryUploadPreset = data.cloudinaryUploadPreset || "";
      return data;
    } catch {
      return null;
    }
  }

  function goToStep(stepNum) {
    state.step = stepNum;

    Object.entries(els.views).forEach(([num, el]) => {
      el.classList.toggle("active", Number(num) === stepNum);
    });

    els.stepPills.forEach((pill) => {
      const s = Number(pill.dataset.step);
      pill.classList.toggle("active", s === stepNum);
      pill.classList.toggle("completed", s < stepNum);

      if (s === 1) pill.disabled = false;
      else if (s === 2) pill.disabled = !state.selectedCategory;
      else if (s === 3) pill.disabled = !state.selectedPhoto;
      else if (s === 4) pill.disabled = !(state.bgImg && state.cutoutImg);
    });

    if (stepNum === 3) {
      els.countdownOverlay.classList.add("hidden");
      els.processingOverlay.classList.add("hidden");
      startCamera();
    } else {
      stopCamera();
    }
  }

  async function loadCategories() {
    try {
      const res = await fetch("/api/categories");
      const data = await res.json();
      state.categories = data.categories || [];
      renderCategories();
    } catch {
      showError("Could not load categories.");
    }
  }

  function galleryPage(pager, items, page, pageSize, renderPage) {
    const pageCount = Math.ceil(items.length / pageSize);
    const [previous, status, next] = pager.children;
    pager.classList.toggle("hidden", pageCount <= 1);
    status.textContent = `${page + 1} / ${pageCount}`;
    previous.disabled = page === 0;
    next.disabled = page >= pageCount - 1;
    previous.onclick = () => renderPage(page - 1);
    next.onclick = () => renderPage(page + 1);
    return items.slice(page * pageSize, (page + 1) * pageSize);
  }

  function renderCategories(page = 0) {
    els.categoriesGrid.innerHTML = "";
    const categories = galleryPage(els.categoryPages, state.categories, page, 4, renderCategories);
    categories.forEach((cat) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "category-card";
      btn.innerHTML = `
        <img src="${cat.coverUrl}" alt="${escapeHtml(cat.name)}" loading="lazy" />
        <div class="category-overlay">
          <span class="category-card-title">${escapeHtml(cat.name)}</span>
        </div>
      `;
      btn.addEventListener("click", () => {
        state.selectedCategory = cat;
        renderPhotos(cat);
        goToStep(2);
      });
      els.categoriesGrid.appendChild(btn);
    });
  }

  function renderPhotos(cat, page = 0) {
    els.photosGrid.innerHTML = "";
    const photos = galleryPage(els.photoPages, cat.photos, page, 6, (nextPage) => renderPhotos(cat, nextPage));
    photos.forEach((photo) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "photo-card";
      btn.innerHTML = `
        <img src="${photo.url}" alt="${escapeHtml(photo.title)}" loading="lazy" />
        <div class="photo-overlay">
          <span class="photo-card-title">${escapeHtml(photo.title)}</span>
        </div>
      `;
      btn.addEventListener("click", () => selectBackgroundPhoto(photo));
      els.photosGrid.appendChild(btn);
    });
  }

  async function selectBackgroundPhoto(photo) {
    state.selectedPhoto = photo;

    loadImage(photo.url)
      .then((img) => {
        state.bgImg = img;
        if (state.cutoutImg) {
          renderComposite();
          goToStep(4);
          uploadMergedToCloudinaryAndGenerateQR();
        }
      })
      .catch(() => showError("Failed to load background photo."));

    if (!state.cutoutImg) {
      goToStep(3);
    }
  }

  // Camera
  async function populateCameraList() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter((d) => d.kind === "videoinput");
    const prevValue = els.cameraSelect.value;

    els.cameraSelect.innerHTML = "";
    videoDevices.forEach((dev, idx) => {
      const opt = document.createElement("option");
      opt.value = dev.deviceId;
      opt.textContent = dev.label || `Camera ${idx + 1}`;
      els.cameraSelect.appendChild(opt);
    });

    els.cameraSelect.classList.toggle("hidden", videoDevices.length <= 1);

    if (prevValue && videoDevices.some((d) => d.deviceId === prevValue)) {
      els.cameraSelect.value = prevValue;
    }
  }

  async function startCamera(preferredDeviceId) {
    stopCamera();
    if (!navigator.mediaDevices?.getUserMedia) return;

    try {
      const deviceId = preferredDeviceId || els.cameraSelect.value;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1280 },
          ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "user" }),
        },
      });
      state.stream = stream;
      els.cameraVideo.srcObject = stream;
      await populateCameraList();
    } catch {
      if (preferredDeviceId) return startCamera("");
      showError("Allow camera permission or upload a photo.");
    }
  }

  function stopCamera() {
    if (state.stream) {
      state.stream.getTracks().forEach((t) => t.stop());
      state.stream = null;
    }
    els.cameraVideo.srcObject = null;
  }

  async function handlePhotoClick() {
    if (state.isBusy) return;
    if (!state.stream || !els.cameraVideo.videoWidth) {
      showError("Camera not ready.");
      return;
    }

    state.isBusy = true;
    els.capturePhotoBtn.disabled = true;

    try {
      els.countdownOverlay.classList.remove("hidden");
      for (let sec = 3; sec >= 1; sec--) {
        if (state.step !== 3) {
          state.isBusy = false;
          els.capturePhotoBtn.disabled = false;
          return;
        }
        els.countdownNumber.textContent = String(sec);
        await sleep(900);
      }
      els.countdownOverlay.classList.add("hidden");

      els.shutterFlash.classList.add("flash");
      setTimeout(() => els.shutterFlash.classList.remove("flash"), 160);

      const vw = els.cameraVideo.videoWidth;
      const vh = els.cameraVideo.videoHeight;
      const maxDim = 1920;
      const scale = Math.min(1, maxDim / Math.max(vw, vh));
      const cw = Math.round(vw * scale);
      const ch = Math.round(vh * scale);

      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = cw;
      tempCanvas.height = ch;
      const ctx = tempCanvas.getContext("2d");
      ctx.translate(cw, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(els.cameraVideo, 0, 0, cw, ch);

      const dataUrl = tempCanvas.toDataURL("image/jpeg", 0.92);
      await processForegroundAndMerge(dataUrl);
    } finally {
      state.isBusy = false;
      els.capturePhotoBtn.disabled = false;
    }
  }

  async function processForegroundAndMerge(foregroundDataUrl) {
    els.processingOverlay.classList.remove("hidden");

    try {
      if (!state.bgImg) {
        state.bgImg = await loadImage(state.selectedPhoto.url);
      }

      const res = await fetch("/api/remove-bg", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: foregroundDataUrl }),
      });

      const payload = await res.json();
      if (!res.ok) {
        await checkApiStatus();
        throw new Error(payload.error || "Background removal failed.");
      }

      await checkApiStatus();

      const rawCutout = await loadImage(payload.cutoutDataUrl);
      state.cutoutImg = await trimTransparentPadding(rawCutout);
      state.placement = getDefaultPlacement();
      syncAdjustControls();

      renderComposite();
      goToStep(4);
      uploadMergedToCloudinaryAndGenerateQR();
    } catch (err) {
      showError(err.message || "Error removing background.");
    } finally {
      els.processingOverlay.classList.add("hidden");
    }
  }

  function trimTransparentPadding(img) {
    return new Promise((resolve) => {
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);

      const { data } = ctx.getImageData(0, 0, w, h);
      let minX = w,
        minY = h,
        maxX = 0,
        maxY = 0;
      let found = false;

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (data[(y * w + x) * 4 + 3] > 16) {
            found = true;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }

      if (!found) return resolve(img);

      const pad = 4;
      minX = Math.max(0, minX - pad);
      minY = Math.max(0, minY - pad);
      maxX = Math.min(w - 1, maxX + pad);
      maxY = maxY >= h - 6 ? h - 1 : Math.min(h - 1, maxY + pad);

      const cropW = maxX - minX + 1;
      const cropH = maxY - minY + 1;
      const trimmedCanvas = document.createElement("canvas");
      trimmedCanvas.width = cropW;
      trimmedCanvas.height = cropH;
      trimmedCanvas.getContext("2d").drawImage(c, minX, minY, cropW, cropH, 0, 0, cropW, cropH);

      const trimmedImg = new Image();
      trimmedImg.onload = () => resolve(trimmedImg);
      trimmedImg.src = trimmedCanvas.toDataURL("image/png");
    });
  }

  function drawCoverImage(ctx, img, targetW, targetH) {
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const scale = Math.max(targetW / iw, targetH / ih);
    const sw = targetW / scale;
    const sh = targetH / scale;
    const sx = (iw - sw) / 2;
    const sy = (ih - sh) / 2;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetW, targetH);
  }

  function renderComposite() {
    if (!state.bgImg || !state.cutoutImg) return;

    const canvas = els.compositeCanvas;
    if (canvas.width !== PRINT_W || canvas.height !== PRINT_H) {
      canvas.width = PRINT_W;
      canvas.height = PRINT_H;
    }

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, PRINT_W, PRINT_H);

    drawCoverImage(ctx, state.bgImg, PRINT_W, PRINT_H);

    const fgW = state.cutoutImg.naturalWidth || state.cutoutImg.width;
    const fgH = state.cutoutImg.naturalHeight || state.cutoutImg.height;
    const aspect = fgW / fgH;

    const drawH = PRINT_H * state.placement.scale;
    const drawW = drawH * aspect;

    const drawX = (PRINT_W - drawW) / 2 + state.placement.offsetX;
    const drawY = PRINT_H - drawH + state.placement.offsetY;

    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.28)";
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 6;
    ctx.drawImage(state.cutoutImg, drawX, drawY, drawW, drawH);
    ctx.restore();
  }

  // Direct Cloudinary Unsigned Upload + QR Code Generation
  function setQrPanelState(mode, message) {
    els.qrLoading.classList.toggle("hidden", mode !== "loading");
    els.qrLinkWrap.classList.toggle("hidden", mode !== "ready");
    els.qrMissing.classList.toggle("hidden", mode !== "error");
    if (message) {
      els.qrStatusText.textContent = message;
    }
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Failed to encode image."))),
        type,
        quality
      );
    });
  }

  async function uploadMergedToCloudinaryAndGenerateQR() {
    if (!state.bgImg || !state.cutoutImg) return;

    const seq = ++state.uploadSeq;
    setQrPanelState("loading");

    // Re-check .env values dynamically so user doesn't need to restart server
    await checkApiStatus();
    if (seq !== state.uploadSeq) return;

    const cloudName = state.cloudinaryCloudName;
    const uploadPreset = state.cloudinaryUploadPreset;

    if (!cloudName || !uploadPreset) {
      setQrPanelState(
        "error",
        "Set CLOUDINARY_CLOUD_NAME and CLOUDINARY_UPLOAD_PRESET in .env"
      );
      return;
    }

    try {
      // Encode merged 6x4 image as high-quality JPEG for fast unsigned upload
      const imageBlob = await canvasToBlob(els.compositeCanvas, "image/jpeg", 0.94);
      if (seq !== state.uploadSeq) return;

      const formData = new FormData();
      formData.append("file", imageBlob, "chroma_photo.jpg");
      formData.append("upload_preset", uploadPreset);

      const uploadUrl = `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`;
      const cloudRes = await fetch(uploadUrl, {
        method: "POST",
        body: formData,
      });

      const cloudData = await cloudRes.json();
      if (!cloudRes.ok || !cloudData.secure_url) {
        const reason = cloudData?.error?.message || "Cloudinary upload failed.";
        throw new Error(reason);
      }

      if (seq !== state.uploadSeq) return;

      const qrRes = await fetch(`/api/qr?url=${encodeURIComponent(cloudData.secure_url)}`);
      const qrData = await qrRes.json();
      if (!qrRes.ok || !qrData.qrDataUrl) {
        throw new Error("Could not generate QR code.");
      }

      if (seq !== state.uploadSeq) return;

      els.qrCodeImg.src = qrData.qrDataUrl;
      els.qrLinkWrap.href = cloudData.secure_url;
      setQrPanelState("ready");
    } catch (err) {
      if (seq !== state.uploadSeq) return;
      setQrPanelState("error", err.message || "Cloudinary upload failed.");
    }
  }

  function scheduleCloudinaryReupload() {
    clearTimeout(state.reuploadTimer);
    state.reuploadTimer = setTimeout(() => {
      if (state.step === 4 && state.bgImg && state.cutoutImg) {
        uploadMergedToCloudinaryAndGenerateQR();
      }
    }, 1000);
  }

  function getDefaultPlacement() {
    let defaultScale = 0.68;
    if (state.cutoutImg) {
      const fgW = state.cutoutImg.naturalWidth || state.cutoutImg.width;
      const fgH = state.cutoutImg.naturalHeight || state.cutoutImg.height;
      const aspect = fgW / fgH;
      if (PRINT_H * defaultScale * aspect > PRINT_W * 0.94) {
        defaultScale = Math.max(0.3, (PRINT_W * 0.92) / (aspect * PRINT_H));
      }
    }
    return { scale: defaultScale, offsetX: 0, offsetY: 0 };
  }

  function syncAdjustControls() {
    if (els.scaleSlider) {
      els.scaleSlider.value = String(Math.round(state.placement.scale * 100));
    }
    if (els.verticalSlider) {
      const clampedVert = Math.max(-1000, Math.min(1000, Math.round(-state.placement.offsetY)));
      els.verticalSlider.value = String(clampedVert);
    }
  }

  // Drag & Wheel Resize on Canvas
  els.compositeCanvas.addEventListener("pointerdown", (e) => {
    if (!state.cutoutImg) return;
    state.isDragging = true;
    els.compositeCanvas.setPointerCapture(e.pointerId);
    state.dragStart = {
      x: e.clientX,
      y: e.clientY,
      origOffsetX: state.placement.offsetX,
      origOffsetY: state.placement.offsetY,
    };
  });

  els.compositeCanvas.addEventListener("pointermove", (e) => {
    if (!state.isDragging) return;
    const rect = els.compositeCanvas.getBoundingClientRect();
    const scaleX = PRINT_W / (rect.width || 1);
    const scaleY = PRINT_H / (rect.height || 1);
    state.placement.offsetX = state.dragStart.origOffsetX + (e.clientX - state.dragStart.x) * scaleX;
    state.placement.offsetY = state.dragStart.origOffsetY + (e.clientY - state.dragStart.y) * scaleY;
    syncAdjustControls();
    renderComposite();
  });

  const stopDrag = () => {
    if (!state.isDragging) return;
    state.isDragging = false;
    scheduleCloudinaryReupload();
  };
  els.compositeCanvas.addEventListener("pointerup", stopDrag);
  els.compositeCanvas.addEventListener("pointercancel", stopDrag);

  els.compositeCanvas.addEventListener(
    "wheel",
    (e) => {
      if (!state.cutoutImg) return;
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.03 : -0.03;
      state.placement.scale = Math.min(1.5, Math.max(0.25, state.placement.scale + delta));
      syncAdjustControls();
      renderComposite();
      scheduleCloudinaryReupload();
    },
    { passive: false }
  );

  els.scaleSlider.addEventListener("input", () => {
    if (!state.cutoutImg) return;
    state.placement.scale = Number(els.scaleSlider.value) / 100;
    renderComposite();
    scheduleCloudinaryReupload();
  });

  els.verticalSlider.addEventListener("input", () => {
    if (!state.cutoutImg) return;
    state.placement.offsetY = -Number(els.verticalSlider.value);
    renderComposite();
    scheduleCloudinaryReupload();
  });

  els.resetAdjustBtn.addEventListener("click", () => {
    if (!state.cutoutImg) return;
    state.placement = getDefaultPlacement();
    syncAdjustControls();
    renderComposite();
    scheduleCloudinaryReupload();
  });

  // Print & Download
  async function handlePrint() {
    if (!state.bgImg || !state.cutoutImg) return;

    els.printFinalBtn.disabled = true;
    try {
      const mergedDataUrl = els.compositeCanvas.toDataURL("image/png");

      fetch("/api/save-print", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: mergedDataUrl,
          backgroundTitle: state.selectedPhoto?.title || "merged",
        }),
      }).catch(() => {});

      els.printImage.src = mergedDataUrl;
      if (els.printImage.decode) {
        await els.printImage.decode();
      } else {
        await sleep(100);
      }

      els.printFinalBtn.disabled = false;
      window.print();
    } catch {
      els.printFinalBtn.disabled = false;
      showError("Unable to open print preview.");
    }
  }

  function handleDownload() {
    if (!state.bgImg || !state.cutoutImg) return;
    const link = document.createElement("a");
    const safeTitle = (state.selectedPhoto?.title || "photo").replace(/[^a-z0-9_-]+/gi, "_");
    link.download = `ChromaAI_${safeTitle}.png`;
    link.href = els.compositeCanvas.toDataURL("image/png");
    link.click();
  }

  // Upload fallback
  els.uploadFallbackBtn.addEventListener("click", () => {
    els.uploadFileInput.value = "";
    els.uploadFileInput.click();
  });

  els.uploadFileInput.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const img = await loadImage(ev.target.result);
        const maxDim = 1920;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const cw = Math.round(img.width * scale);
        const ch = Math.round(img.height * scale);
        const c = document.createElement("canvas");
        c.width = cw;
        c.height = ch;
        c.getContext("2d").drawImage(img, 0, 0, cw, ch);
        await processForegroundAndMerge(c.toDataURL("image/jpeg", 0.92));
      } catch {
        showError("Could not read image file.");
      }
    };
    reader.readAsDataURL(file);
  });

  // Navigation Events
  els.stepPills.forEach((pill) => {
    pill.addEventListener("click", () => {
      if (!pill.disabled && !state.isBusy) {
        const target = Number(pill.dataset.step);
        if (target === 3) {
          state.cutoutImg = null;
        }
        goToStep(target);
      }
    });
  });

  function goHome() {
    if (state.isBusy) return;
    clearTimeout(state.reuploadTimer);
    state.uploadSeq++;
    state.selectedCategory = null;
    state.selectedPhoto = null;
    state.bgImg = null;
    state.cutoutImg = null;
    goToStep(1);
  }

  els.brandHomeBtn.addEventListener("click", goHome);
  els.homeResultBtn.addEventListener("click", goHome);
  els.backToGroupsBtn.addEventListener("click", () => {
    if (!state.isBusy) goToStep(1);
  });
  els.backToPhotosBtn.addEventListener("click", () => {
    if (!state.isBusy) goToStep(2);
  });
  els.retryQrBtn.addEventListener("click", uploadMergedToCloudinaryAndGenerateQR);

  els.cameraSelect.addEventListener("change", () => startCamera(els.cameraSelect.value));
  els.capturePhotoBtn.addEventListener("click", handlePhotoClick);

  window.addEventListener("keydown", (e) => {
    if (state.step === 3 && e.code === "Space" && !state.isBusy) {
      e.preventDefault();
      handlePhotoClick();
    }
  });

  els.printFinalBtn.addEventListener("click", handlePrint);
  els.downloadFinalBtn.addEventListener("click", handleDownload);

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  checkApiStatus();
  loadCategories();
})();
