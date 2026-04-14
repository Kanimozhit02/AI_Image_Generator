import { useEffect, useMemo, useRef, useState } from "react";

const examplePrompts = [
  "A magic forest with glowing plants and fairy homes among giant mushrooms",
  "An old steampunk airship floating through golden clouds at sunset",
  "A future Mars colony with glass domes and gardens against red mountains",
  "A dragon sleeping on gold coins in a crystal cave",
  "An underwater kingdom with merpeople and glowing coral buildings",
  "A floating island with waterfalls pouring into clouds below",
  "A witch's cottage in fall with magic herbs in the garden",
  "A robot painting in a sunny studio with art supplies around it",
  "A magical library with floating glowing books and spiral staircases",
  "A Japanese shrine during cherry blossom season with lanterns and misty mountains",
  "A cosmic beach with glowing sand and an aurora in the night sky",
  "A medieval marketplace with colorful tents and street performers",
  "A cyberpunk city with neon signs and flying cars at night",
  "A peaceful bamboo forest with a hidden ancient temple",
  "A giant turtle carrying a village on its back in the ocean",
];

const MODELS = [
  { value: "black-forest-labs/FLUX.1-schnell", label: "Fast Image Generation" },
];

function getImageDimensions(aspectRatio, baseSize = 512) {
  const [w, h] = aspectRatio.split("/").map(Number);
  const scale = baseSize / Math.sqrt(w * h);
  let width = Math.round(w * scale);
  let height = Math.round(h * scale);
  width = Math.floor(width / 16) * 16;
  height = Math.floor(height / 16) * 16;
  return { width, height };
}

function downloadBlobUrl(blobUrl, filename = "image.png") {
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 90000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

export default function App() {
  const apiBase = import.meta.env.VITE_API_BASE ?? "http://localhost:3000";
  const apiBaseIsLocalhost = /localhost|127\.0\.0\.1/i.test(apiBase);
  const isDeployedSite =
    typeof window !== "undefined" &&
    !/localhost|127\.0\.0\.1/i.test(window.location.hostname);

  const [dark, setDark] = useState(false);
  const [modelOptions, setModelOptions] = useState(
    MODELS.map((m) => ({ ...m, available: true, status: null }))
  );

  const [promptText, setPromptText] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [imageCount, setImageCount] = useState("");
  const [aspectRatio, setAspectRatio] = useState("");

  const [isGenerating, setIsGenerating] = useState(false);

  // each item: { status: "loading"|"done"|"error", url?: string, error?: string }
  const [images, setImages] = useState([]);

  const promptRef = useRef(null);

  useEffect(() => {
    const savedTheme = localStorage.getItem("theme");
    const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const isDark = savedTheme === "dark" || (!savedTheme && systemPrefersDark);
    setDark(isDark);
  }, []);

  useEffect(() => {
    document.body.classList.toggle("dark-theme", dark);
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);

  useEffect(() => {
    const loadModelStatus = async () => {
      try {
        const resp = await fetch(`${apiBase}/api/models/status`);
        if (!resp.ok) return;

        const data = await resp.json();
        if (!data?.models || !Array.isArray(data.models)) return;

        const availableModels = data.models.filter((m) => m.available);
        if (availableModels.length > 0) {
          setModelOptions(availableModels);
        } else {
          setModelOptions(MODELS.map((m) => ({ ...m, available: true, status: null })));
        }
      } catch (_e) {
        // Keep static model options if status check fails.
      }
    };

    loadModelStatus();
  }, [apiBase]);

  const iconClass = useMemo(() => (dark ? "fa-solid fa-sun" : "fa-solid fa-moon"), [dark]);

  const onRandomPrompt = () => {
    const chosen = examplePrompts[Math.floor(Math.random() * examplePrompts.length)];
    if (promptRef.current) promptRef.current.focus();

    setPromptText("");
    // type effect
    let i = 0;
    const timer = setInterval(() => {
      i += 1;
      setPromptText(chosen.slice(0, i));
      if (i >= chosen.length) clearInterval(timer);
    }, 10);
  };

  const generateOne = async ({ width, height, index }) => {
    try {
      const resp = await fetchWithTimeout(`${apiBase}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selectedModel,
          promptText,
          width,
          height,
        }),
      }, 90000);

      if (!resp.ok) {
        const err = await resp.text();
        throw new Error(err);
      }

      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);

      setImages((prev) => {
        const next = [...prev];
        next[index] = { status: "done", url };
        return next;
      });
    } catch (e) {
      const message =
        e?.name === "AbortError"
          ? "Request timed out. Please try again in a few seconds."
          : String(e);

      setImages((prev) => {
        const next = [...prev];
        next[index] = { status: "error", error: message };
        return next;
      });
    }
  };

  const onSubmit = async (e) => {
    e.preventDefault();

    if (!promptText.trim()) return;
    if (!selectedModel) return;
    if (!imageCount) return;
    if (!aspectRatio) return;

    const count = parseInt(imageCount, 10);

    // clear old blob URLs
    images.forEach((img) => {
      if (img?.url) URL.revokeObjectURL(img.url);
    });

    const { width, height } = getImageDimensions(aspectRatio);

    setIsGenerating(true);
    setImages(Array.from({ length: count }, () => ({ status: "loading" })));

    const tasks = Array.from({ length: count }, (_, index) =>
      generateOne({ width, height, index })
    );

      const allTasks = Promise.allSettled(tasks);

      // UI-level watchdog: guarantees we leave "Generating..." even if one request gets stuck.
      await Promise.race([allTasks, wait(95000)]);

      setImages((prev) =>
        prev.map((img) =>
          img.status === "loading"
            ? {
                status: "error",
                error: "Generation timed out. Please retry.",
              }
            : img
        )
      );

    setIsGenerating(false);
  };

  return (
    <div className="container">
      <header className="header">
        <div className="logo-wrapper">
          <div className="logo">
            <i className="fa-solid fa-wand-magic-sparkles"></i>
          </div>
          <h1>AI Image Generator</h1>
        </div>

        <button className="theme-toggle" type="button" onClick={() => setDark((v) => !v)}>
          <i className={iconClass}></i>
        </button>
      </header>

      <div className="main-content">
        {isDeployedSite && apiBaseIsLocalhost && (
          <p style={{ marginBottom: "12px", color: "#ef4444", fontWeight: 600 }}>
            VITE_API_BASE is still pointing to localhost. Update it in Vercel environment variables.
          </p>
        )}

        <form className="prompt-form" onSubmit={onSubmit}>
          <div className="prompt-container">
            <textarea
              ref={promptRef}
              className="prompt-input"
              placeholder="Describe Your Imagination in detail..."
              required
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
            />

            <button
              type="button"
              className="prompt-btn"
              onClick={onRandomPrompt}
              disabled={isGenerating}
              title="Random prompt"
            >
              <i className="fa-solid fa-dice"></i>
            </button>
          </div>

          <div className="prompt-actions">
            <div className="select-wrapper">
              <select
                className="custom-select"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                required
              >
                <option value="" disabled>
                  Model
                </option>
                {modelOptions.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="select-wrapper">
              <select
                className="custom-select"
                value={imageCount}
                onChange={(e) => setImageCount(e.target.value)}
                required
              >
                <option value="" disabled>
                  Image Count
                </option>
                <option value="1">1 Image</option>
                <option value="2">2 Images</option>
                <option value="3">3 Images</option>
                <option value="4">4 Images</option>
              </select>
            </div>

            <div className="select-wrapper">
              <select
                className="custom-select"
                value={aspectRatio}
                onChange={(e) => setAspectRatio(e.target.value)}
                required
              >
                <option value="" disabled>
                  Aspect Ratio
                </option>
                <option value="1/1">Square (1:1)</option>
                <option value="16/9">Landscape (16:9)</option>
                <option value="9/16">Portrait (9:16)</option>
              </select>
            </div>

            <button className="generate-btn" type="submit" disabled={isGenerating}>
              <i className="fa-solid fa-wand-sparkles"></i>
              {isGenerating ? "Generating..." : "Generate"}
            </button>
          </div>

          {images.length > 0 && (
            <div className="gallery-grid">
              {images.map((img, i) => (
                <div
                  key={i}
                  className={`img-card ${img.status === "loading" ? "loading" : ""} ${
                    img.status === "error" ? "error" : ""
                  }`}
                  style={{ aspectRatio }}
                >
                  <div className="status-container">
                    <div className="spinner"></div>
                    <i className="fa-solid fa-triangle-exclamation"></i>
                    <p className="status-text">
                      {img.status === "loading"
                        ? "Generating..."
                        : img.status === "error"
                          ? (img.error ?? "Generation failed")
                          : ""}
                    </p>
                  </div>

                  {img.status === "done" && (
                    <>
                      <img className="result-img" src={img.url} alt={`Result ${i + 1}`} />
                      <div className="img-overlay">
                        <button
                          className="img-download-btn"
                          type="button"
                          title="Download Image"
                          onClick={() => downloadBlobUrl(img.url, `ai-image-${i + 1}.png`)}
                        >
                          <i className="fa-solid fa-download"></i>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </form>
      </div>
    </div>
  );
}