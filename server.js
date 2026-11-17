const path = require("path");
const fs = require("fs");
const express = require("express");
const dotenv = require("dotenv");
const QRCode = require("qrcode");
const { createFalClient } = require("@fal-ai/client");

const ENV_PATH = path.join(__dirname, ".env");
dotenv.config({ path: ENV_PATH, override: true, quiet: true });

const app = express();
const PORT = process.env.PORT || 3000;

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".avif"]);

function getBackgroundsDir() {
  dotenv.config({ path: ENV_PATH, override: true, quiet: true });
  const configured = (process.env.BACKGROUNDS_DIR || "NSE green screens - Portrait").trim();
  return path.isAbsolute(configured) ? configured : path.join(__dirname, configured);
}

function getFalKey() {
  dotenv.config({ path: ENV_PATH, override: true, quiet: true });
  const raw = (process.env.FAL_KEY || "").trim().replace(/^['"]|['"]$/g, "");
  if (!raw || raw === "your_fal_api_key_here") {
    return "";
  }
  return raw;
}

function getCloudinaryConfig() {
  dotenv.config({ path: ENV_PATH, override: true, quiet: true });
  const clean = (val, placeholder) => {
    const v = (val || "").trim().replace(/^['"]|['"]$/g, "");
    return !v || v === placeholder ? "" : v;
  };
  return {
    cloudName: clean(process.env.CLOUDINARY_CLOUD_NAME, "your_cloud_name"),
    uploadPreset: clean(process.env.CLOUDINARY_UPLOAD_PRESET, "your_unsigned_upload_preset"),
  };
}

function formatPhotoTitle(filename) {
  const ext = path.extname(filename);
  return path
    .basename(filename, ext)
    .replace(/_/g, " - ")
    .replace(/\s+/g, " ")
    .trim();
}

const OUTPUTS_DIR = path.join(__dirname, "outputs");
if (!fs.existsSync(OUTPUTS_DIR)) {
  fs.mkdirSync(OUTPUTS_DIR, { recursive: true });
}

app.use(express.json({ limit: "35mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/outputs", express.static(OUTPUTS_DIR));

// Dynamically serve background images from configured folder
app.use("/backgrounds", (req, res, next) => {
  const bgDir = getBackgroundsDir();
  express.static(bgDir)(req, res, next);
});

// Check API key, Cloudinary unsigned config & folder status
app.get("/api/status", (req, res) => {
  const hasFalKey = Boolean(getFalKey());
  const bgDir = getBackgroundsDir();
  const folderExists = fs.existsSync(bgDir);
  const cloudinary = getCloudinaryConfig();
  res.json({
    falKeyConfigured: hasFalKey,
    backgroundsFolder: path.basename(bgDir),
    folderExists,
    cloudinaryCloudName: cloudinary.cloudName,
    cloudinaryUploadPreset: cloudinary.uploadPreset,
  });
});

// Generate scannable QR code data URL
app.get("/api/qr", async (req, res) => {
  try {
    const url = String(req.query.url || "").trim();
    if (!url) {
      return res.status(400).json({ error: "Missing URL for QR code." });
    }
    const qrDataUrl = await QRCode.toDataURL(url, {
      width: 260,
      margin: 2,
      errorCorrectionLevel: "M",
    });
    res.json({ qrDataUrl });
  } catch (err) {
    console.error("QR generation failed:", err);
    res.status(500).json({ error: "Failed to generate QR code." });
  }
});

// List categories and their background photos dynamically
app.get("/api/categories", (req, res) => {
  try {
    const bgDir = getBackgroundsDir();
    if (!fs.existsSync(bgDir)) {
      return res.json({ categories: [] });
    }

    const entries = fs.readdirSync(bgDir, { withFileTypes: true });
    const categories = [];

    // 1. Subfolders as categories
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const categoryName = entry.name;
      const categoryPath = path.join(bgDir, categoryName);
      const files = fs
        .readdirSync(categoryPath, { withFileTypes: true })
        .filter((f) => f.isFile() && IMAGE_EXTENSIONS.has(path.extname(f.name).toLowerCase()))
        .map((f) => ({
          fileName: f.name,
          title: formatPhotoTitle(f.name),
          url: `/backgrounds/${encodeURIComponent(categoryName)}/${encodeURIComponent(f.name)}`,
        }))
        .sort((a, b) => a.title.localeCompare(b.title));

      if (files.length > 0) {
        categories.push({
          id: categoryName,
          name: categoryName,
          count: files.length,
          coverUrl: files[0].url,
          previewUrls: files.slice(0, 3).map((p) => p.url),
          photos: files,
        });
      }
    }

    // 2. Any top-level images placed directly in the folder
    const rootPhotos = entries
      .filter((f) => f.isFile() && IMAGE_EXTENSIONS.has(path.extname(f.name).toLowerCase()))
      .map((f) => ({
        fileName: f.name,
        title: formatPhotoTitle(f.name),
        url: `/backgrounds/${encodeURIComponent(f.name)}`,
      }))
      .sort((a, b) => a.title.localeCompare(b.title));

    if (rootPhotos.length > 0) {
      categories.push({
        id: "__general__",
        name: "General",
        count: rootPhotos.length,
        coverUrl: rootPhotos[0].url,
        previewUrls: rootPhotos.slice(0, 3).map((p) => p.url),
        photos: rootPhotos,
      });
    }

    categories.sort((a, b) => a.name.localeCompare(b.name));
    res.json({ categories });
  } catch (err) {
    console.error("Failed to read categories:", err);
    res.status(500).json({ error: "Failed to read background categories folder." });
  }
});

// Remove background from captured foreground photo via fal-ai/bria/background/remove
app.post("/api/remove-bg", async (req, res) => {
  try {
    const falKey = getFalKey();
    if (!falKey) {
      return res.status(400).json({
        error:
          "FAL_KEY is missing! Please open the .env file, paste your fal.ai API key after FAL_KEY=, save the file, and try again.",
      });
    }

    const { imageBase64 } = req.body || {};
    if (!imageBase64 || typeof imageBase64 !== "string") {
      return res.status(400).json({ error: "No captured foreground image received." });
    }

    const match = imageBase64.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
    if (!match) {
      return res.status(400).json({ error: "Invalid image data format." });
    }

    const mimeType = match[1];
    const imageBuffer = Buffer.from(match[2], "base64");

    const client = createFalClient({ credentials: falKey });

    // Upload captured foreground to fal storage and run Bria RMBG 2.0
    const blob = new Blob([imageBuffer], { type: mimeType });
    const uploadedUrl = await client.storage.upload(blob);

    const result = await client.subscribe("fal-ai/bria/background/remove", {
      input: {
        image_url: uploadedUrl,
      },
    });

    const cutoutUrl = result?.data?.image?.url || result?.image?.url;
    if (!cutoutUrl) {
      throw new Error("fal.ai did not return an output image URL.");
    }

    // Fetch cutout PNG on server so browser canvas has zero CORS issues
    const imgResponse = await fetch(cutoutUrl);
    if (!imgResponse.ok) {
      throw new Error(`Failed to download processed image (${imgResponse.status}).`);
    }

    const arrayBuf = await imgResponse.arrayBuffer();
    const cutoutBase64 = Buffer.from(arrayBuf).toString("base64");
    const contentType = imgResponse.headers.get("content-type") || "image/png";

    res.json({
      cutoutDataUrl: `data:${contentType};base64,${cutoutBase64}`,
    });
  } catch (err) {
    console.error("Background removal error:", err);
    const status = err?.status || 500;
    let message = err?.body?.detail || err?.message || "Background removal failed.";
    if (status === 401 || status === 403 || /unauthorized|credentials|key/i.test(String(message))) {
      message = "Invalid FAL_KEY in .env. Please check your fal.ai API key and try again.";
    }
    res.status(status >= 400 && status < 600 ? status : 500).json({ error: message });
  }
});

// Save final merged print image to outputs/ folder
app.post("/api/save-print", (req, res) => {
  try {
    const { imageBase64, backgroundTitle } = req.body || {};
    if (!imageBase64 || typeof imageBase64 !== "string") {
      return res.status(400).json({ error: "Missing merged image data." });
    }

    const match = imageBase64.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,(.+)$/);
    if (!match) {
      return res.status(400).json({ error: "Invalid merged image format." });
    }

    const ext = match[1] === "jpeg" ? "jpg" : "png";
    const buffer = Buffer.from(match[2], "base64");

    const now = new Date();
    const stamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
      "_",
      String(now.getHours()).padStart(2, "0"),
      String(now.getMinutes()).padStart(2, "0"),
      String(now.getSeconds()).padStart(2, "0"),
    ].join("");

    const safeLabel = (backgroundTitle || "photo")
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40);

    const fileName = `ChromaAI_${stamp}_${safeLabel}.${ext}`;
    const filePath = path.join(OUTPUTS_DIR, fileName);
    fs.writeFileSync(filePath, buffer);

    res.json({
      saved: true,
      fileName,
      fileUrl: `/outputs/${encodeURIComponent(fileName)}`,
    });
  } catch (err) {
    console.error("Failed to save merged photo:", err);
    res.status(500).json({ error: "Failed to save merged photo." });
  }
});

app.listen(PORT, () => {
  console.log(`\n✨ Chroma AI Photo Booth running at http://localhost:${PORT}`);
  console.log(`📁 Backgrounds directory: ${getBackgroundsDir()}`);
  console.log(`🔑 FAL_KEY configured: ${getFalKey() ? "Yes ✅" : "No ⚠️ (Add FAL_KEY in .env)"}\n`);
});
