// server/server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import Groq from "groq-sdk";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ---- Groq Setup ----
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
// Safe default; change via env: GROQ_MODEL
const MODEL = process.env.GROQ_MODEL || "llama-3.1-8b-instant";

// Health
app.get("/", (req, res) => {
  res.json({ status: "VoiceNav+ backend (Groq) is running 🚀" });
});

// ---- Summarize (existing) ----
app.post("/summarize", async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: "No text provided for summarization." });
    }

    const completion = await groq.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are a concise assistant. Summarize the user's content in 4-6 bullet points with short, clear sentences. Avoid fluff.",
        },
        {
          role: "user",
          content: text.slice(0, 12000),
        },
      ],
      temperature: 0.3,
      max_tokens: 400,
    });

    const summary = completion.choices?.[0]?.message?.content?.trim() || "";
    res.json({ summary });
  } catch (err) {
    console.error("Error during summarization:", err?.response?.status, err?.response?.data || err.message);
    res.status(500).json({ error: "Summarization failed." });
  }
});

// ---- Ask (NEW) ----
// body: { text, mode, prompt, language }
app.post("/ask", async (req, res) => {
  try {
    const { text, mode = "qa", prompt = "", language = "English" } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: "No text provided." });
    }

    // Build task-specific instructions
    let system = "";
    let userMsg = "";

    if (mode === "qa") {
      system =
        "You answer questions briefly and accurately using ONLY the provided page/context. If the answer isn't in the text, say you cannot find it.";
      userMsg = `Context:\n${text.slice(0, 12000)}\n\nUser question: ${prompt}\n\nAnswer in 2-4 concise sentences.`;
    } else if (mode === "explain") {
      system =
        "You simplify technical text. Keep it clear, concrete, and short. Avoid jargon unless necessary.";
      userMsg = `Simplify this for a beginner:\n\n${text.slice(0, 12000)}\n\nKeep it within 4-6 short sentences.`;
    } else if (mode === "translate") {
      system =
        "You translate text accurately while preserving meaning and names. Do not add commentary, output only the translation.";
      userMsg = `Translate the following to ${language}:\n\n${text.slice(0, 12000)}`;
    } else {
      system = "You are a helpful assistant. Keep answers short and precise.";
      userMsg = `${prompt}\n\nContext:\n${text.slice(0, 12000)}`;
    }

    const completion = await groq.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userMsg },
      ],
      temperature: 0.2,
      max_tokens: 450,
    });

    const answer = completion.choices?.[0]?.message?.content?.trim() || "";
    res.json({ answer });
  } catch (err) {
    console.error("Error during /ask:", err?.response?.status, err?.response?.data || err.message);
    res.status(500).json({ error: "Ask failed." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running (Groq) on http://localhost:${PORT}`);
});
