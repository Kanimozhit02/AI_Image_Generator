import "dotenv/config";
import express from "express";
import cors from "cors";

const app = express();
const MODEL_CATALOG = [
  { value: "black-forest-labs/FLUX.1-dev", label: "Best Quality (Pro)" },
  { value: "black-forest-labs/FLUX.1-schnell", label: "Fast Image Generation" },
  { value: "stabilityai/stable-diffusion-xl-base-1.0", label: "High Quality" },
  { value: "runwayml/stable-diffusion-v1-5", label: "Normal Quality" },
  { value: "prompthero/openjourney", label: "Artistic Style" },
];

const MODEL_STATUS_CACHE_TTL_MS = 10 * 60 * 1000;
let modelStatusCache = null;
let modelStatusCacheAt = 0;

function getAllowedOrigins() {
  const fromEnv = (process.env.FRONTEND_URLS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return new Set([
    ...fromEnv,
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ]);
}

const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true);

    const allowedOrigins = getAllowedOrigins();
    if (allowedOrigins.has(origin)) return callback(null, true);

    return callback(new Error(`Not allowed by CORS: ${origin}`));
  },
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

app.use(express.json({ limit: "2mb" }));

function getBaseHeaders() {
  return {
    Authorization: `Bearer ${process.env.HF_TOKEN}`,
    "Content-Type": "application/json",
    "x-use-cache": "false",
  };
}

async function checkModelAvailability(modelId) {
  try {
    const testPayload = JSON.stringify({
      inputs: "quick test image",
      parameters: { width: 256, height: 256 },
    });

    const resp = await fetch(
      `https://router.huggingface.co/hf-inference/models/${modelId}`,
      {
        method: "POST",
        headers: getBaseHeaders(),
        body: testPayload,
        signal: AbortSignal.timeout(20000),
      }
    );

    if (resp.ok) {
      return { available: true, status: resp.status };
    }

    return { available: false, status: resp.status };
  } catch (_e) {
    return { available: false, status: 0 };
  }
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/models/status", async (_req, res) => {
  try {
    if (!process.env.HF_TOKEN) {
      return res.status(500).json({ error: "HF_TOKEN missing in backend .env" });
    }

    const now = Date.now();
    if (modelStatusCache && now - modelStatusCacheAt < MODEL_STATUS_CACHE_TTL_MS) {
      return res.json({ models: modelStatusCache, cached: true });
    }

    const checks = await Promise.all(
      MODEL_CATALOG.map(async (model) => {
        const status = await checkModelAvailability(model.value);
        return {
          ...model,
          available: status.available,
          status: status.status,
        };
      })
    );

    modelStatusCache = checks;
    modelStatusCacheAt = now;

    return res.json({ models: checks, cached: false });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
});

app.post("/api/generate", async (req, res) => {
  try {
    const { selectedModel, promptText, width, height } = req.body ?? {};

    if (!process.env.HF_TOKEN) {
      return res.status(500).json({ error: "HF_TOKEN missing in backend .env" });
    }
    if (!selectedModel) return res.status(400).json({ error: "selectedModel is required" });
    if (!promptText) return res.status(400).json({ error: "promptText is required" });

    const payload = JSON.stringify({
      inputs: promptText,
      parameters: { width, height }
    });

    const hfResp = await fetch(
      `https://router.huggingface.co/hf-inference/models/${selectedModel}`,
      {
        method: "POST",
        headers: getBaseHeaders(),
        body: payload,
      }
    );

    if (!hfResp.ok) {
      const errText = await hfResp.text();
      console.error("Hugging Face request failed", {
        status: hfResp.status,
        statusText: hfResp.statusText,
        error: errText,
      });

      if (hfResp.status === 404 || hfResp.status === 410) {
        return res.status(400).json({
          error:
            "Selected model is unavailable on Hugging Face Router. Please choose black-forest-labs/FLUX.1-schnell.",
        });
      }

      return res.status(hfResp.status).json({ error: errText });
    }

    const buf = Buffer.from(await hfResp.arrayBuffer());

    // Most of these models return png; if not, the browser still usually displays it.
    res.setHeader("Content-Type", "image/png");
    res.send(buf);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`Backend running on http://localhost:${port}`);
});