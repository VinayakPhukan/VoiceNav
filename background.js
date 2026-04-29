// client/background.js
console.log("VoiceNav+ background service worker running");

// --- Global Mic + Debounce ---
let micActive = false;
let lastCommand = "";
let lastCommandTime = 0;

// ---- Listen for messages ----
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === "voice-command") {
    console.log("Voice command received:", message.text);
    handleCommand(message.text, sender.tab.id);
  }

  if (message.type === "toggle-mic") {
    micActive = message.active;
    chrome.storage.local.set({ listening: micActive });

    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        chrome.tabs.sendMessage(tab.id, {
          type: micActive ? "start-listening" : "stop-listening",
        });
      }
    });

    console.log(`🔊 Mic ${micActive ? "activated" : "deactivated"} globally`);
  }
});

// Restore after browser restart
chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.get("listening", (res) => {
    if (res.listening) {
      micActive = true;
      console.log("🔁 Restoring active mic session after browser restart");
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach((tab) => {
          chrome.tabs.sendMessage(tab.id, { type: "start-listening" });
        });
      });
    }
  });
});

// Stop mic in non-active tabs when switching
chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id !== activeInfo.tabId) {
        chrome.tabs.sendMessage(tab.id, { type: "stop-listening" });
      }
    }
  });
  if (micActive) {
    setTimeout(() => {
      chrome.tabs.sendMessage(activeInfo.tabId, { type: "start-listening" });
    }, 700);
  }
});

// Reactivate mic after reload
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === "complete" && micActive) {
    setTimeout(() => {
      chrome.tabs.sendMessage(tabId, { type: "start-listening" });
    }, 700);
  }
});

// ---- Helpers ----
function speak(tabId, msg) {
  chrome.scripting.executeScript({
    target: { tabId },
    func: (text) => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "en-US";
      speechSynthesis.speak(u);
    },
    args: [msg],
  });
}

async function getActiveTabUrl(tabId) {
  const tab = await chrome.tabs.get(tabId);
  return tab.url || "";
}

async function extractPageText(tabId) {
  const [{ result: text }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const sel = window.getSelection()?.toString().trim();
      if (sel && sel.length > 30) return sel.slice(0, 12000);

      const article = document.querySelector("article");
      const main = document.querySelector("main");
      let t = "";
      if (article) t = article.innerText;
      else if (main) t = main.innerText;
      else {
        const paragraphs = Array.from(document.querySelectorAll("p"))
          .map((p) => p.innerText)
          .filter((t) => t.split(" ").length > 5)
          .join("\n\n");
        t = paragraphs;
      }
      return (t || document.body.innerText || "").slice(0, 12000);
    },
  });
  return text || "";
}

async function callAskAPI(payload) {
  const res = await fetch("http://localhost:3000/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Ask API failed");
  const data = await res.json();
  return data.answer || "";
}

// ---- Main Command Handler ----
async function handleCommand(command, tabId) {
  const lower = command.toLowerCase();

  // Debounce duplicate
  const now = Date.now();
  if (lower === lastCommand && now - lastCommandTime < 2000) {
    console.log("Duplicate command ignored:", lower);
    return;
  }
  lastCommand = lower;
  lastCommandTime = now;

  // ===== SCROLL =====
  if (lower.includes("scroll down")) {
    speak(tabId, "Scrolling down.");
    chrome.scripting.executeScript({
      target: { tabId },
      func: () => window.scrollBy({ top: window.innerHeight, behavior: "smooth" }),
    });
  } else if (lower.includes("scroll up")) {
    speak(tabId, "Scrolling up.");
    chrome.scripting.executeScript({
      target: { tabId },
      func: () => window.scrollBy({ top: -window.innerHeight, behavior: "smooth" }),
    });
  }

  // ===== READ / TTS =====
  else if (lower.includes("read page") || lower.includes("read this")) {
    speak(tabId, "Reading this page.");
    chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const article = document.querySelector("article");
        const main = document.querySelector("main");
        let text = "";
        if (article) text = article.innerText;
        else if (main) text = main.innerText;
        else {
          const paragraphs = Array.from(document.querySelectorAll("p"))
            .map((p) => p.innerText)
            .filter((t) => t.split(" ").length > 5)
            .join("\n\n");
          text = paragraphs;
        }
        text = text.slice(0, 4000);
        const utter = new SpeechSynthesisUtterance(text);
        utter.lang = "en-US";
        speechSynthesis.speak(utter);
      },
    });
  } else if (lower.includes("stop reading") || lower.includes("cancel reading")) {
    speak(tabId, "Stopped reading.");
    chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (speechSynthesis.speaking) speechSynthesis.cancel();
      },
    });
    chrome.tabs.sendMessage(tabId, { type: "reading-state", text: "🛑 Reading stopped" });
  } else if (lower.includes("pause reading") || lower.includes("pause")) {
    speak(tabId, "Paused reading.");
    chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (speechSynthesis.speaking && !speechSynthesis.paused) speechSynthesis.pause();
      },
    });
    chrome.tabs.sendMessage(tabId, { type: "reading-state", text: "⏸️ Reading paused" });
  } else if (lower.includes("resume reading") || lower.includes("continue reading")) {
    speak(tabId, "Resuming reading.");
    chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (speechSynthesis.paused) speechSynthesis.resume();
      },
    });
    chrome.tabs.sendMessage(tabId, { type: "reading-state", text: "▶️ Reading resumed" });
  }

  // ===== AI: SUMMARIZE (existing) =====
  else if (
    lower.includes("summarize") ||
    lower.includes("summarise") ||
    lower.includes("summarize this") ||
    lower.includes("summarize selection")
  ) {
    speak(tabId, "Okay, summarizing now.");
    await summarizePage(tabId);
  }

  // ===== AI: ASK =====
  else if (lower.startsWith("ask ai")) {
    const question = lower.replace("ask ai", "").trim() || "What is this about?";
    speak(tabId, "Let me check that.");
    try {
      const pageText = await extractPageText(tabId);
      if (!pageText) throw new Error("No readable text on page.");
      const answer = await callAskAPI({ text: pageText, mode: "qa", prompt: question });
      chrome.tabs.sendMessage(tabId, { type: "ai-result", text: answer });
      speak(tabId, answer.slice(0, 500));
    } catch (e) {
      chrome.tabs.sendMessage(tabId, { type: "ai-error", text: "AI query failed." });
      speak(tabId, "Sorry, I couldn't answer that.");
    }
  }

  // ===== AI: EXPLAIN =====
  else if (lower.startsWith("explain")) {
    speak(tabId, "Explaining.");
    try {
      const pageText = await extractPageText(tabId);
      if (!pageText) throw new Error("No readable text on page.");
      const answer = await callAskAPI({ text: pageText, mode: "explain" });
      chrome.tabs.sendMessage(tabId, { type: "ai-result", text: answer });
      speak(tabId, answer.slice(0, 500));
    } catch (e) {
      chrome.tabs.sendMessage(tabId, { type: "ai-error", text: "Explain failed." });
      speak(tabId, "Sorry, I couldn't explain that.");
    }
  }

  // ===== AI: TRANSLATE =====
  else if (lower.startsWith("translate")) {
    // e.g., "translate this to hindi", "translate to hindi", "translate hindi"
    const m = lower.match(/translate(?:\s+this)?(?:\s+to)?\s+([a-zA-Z ]+)$/);
    const language = m && m[1] ? m[1].trim() : "Hindi";
    speak(tabId, `Translating to ${language}.`);
    try {
      const pageText = await extractPageText(tabId);
      if (!pageText) throw new Error("No readable text on page.");
      const answer = await callAskAPI({ text: pageText, mode: "translate", language });
      chrome.tabs.sendMessage(tabId, { type: "ai-result", text: answer });
      speak(tabId, answer.slice(0, 500));
    } catch (e) {
      chrome.tabs.sendMessage(tabId, { type: "ai-error", text: "Translation failed." });
      speak(tabId, "Sorry, I couldn't translate that.");
    }
  }

  // ===== OPEN (universal) =====
  else if (lower.startsWith("open ")) {
    const siteName = lower.replace("open ", "").trim();
    const domainMap = {
      youtube: "https://www.youtube.com",
      instagram: "https://www.instagram.com",
      amazon: "https://www.amazon.in",
      wikipedia: "https://www.wikipedia.org",
      linkedin: "https://www.linkedin.com",
      github: "https://www.github.com",
      google: "https://www.google.com",
      facebook: "https://www.facebook.com",
      twitter: "https://www.twitter.com",
      reddit: "https://www.reddit.com",
      playstore: "https://play.google.com",
      chatgpt: "https://chat.openai.com",
    };
    let url = domainMap[siteName] || `https://www.${siteName.replace(/\s+/g, "").toLowerCase()}.com`;
    speak(tabId, `Opening ${siteName}.`);
    chrome.tabs.update(tabId, { url });
  }

  // ===== SEARCH (context-aware) =====
  else if (lower.startsWith("search ")) {
    const query = lower.replace("search", "").trim();
    const currentUrl = await getActiveTabUrl(tabId);
    if (currentUrl.includes("wikipedia.org")) {
      chrome.tabs.update(tabId, { url: `https://en.wikipedia.org/wiki/${encodeURIComponent(query)}` });
      speak(tabId, `Searching ${query} on Wikipedia.`);
    } else if (currentUrl.includes("youtube.com")) {
      chrome.tabs.update(tabId, { url: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}` });
      speak(tabId, `Searching ${query} on YouTube.`);
    } else {
      chrome.tabs.update(tabId, { url: `https://www.google.com/search?q=${encodeURIComponent(query)}` });
      speak(tabId, `Searching ${query} on Google.`);
    }
  }

  // ===== PLAY (YouTube) =====
  else if (lower.startsWith("play ")) {
    const q = lower.replace("play", "").trim();
    const currentUrl = await getActiveTabUrl(tabId);
    if (currentUrl.includes("youtube.com")) {
      speak(tabId, `Playing ${q} on YouTube.`);
      chrome.tabs.update(tabId, {
        url: `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`
      });
    } else {
      speak(tabId, `Opening YouTube for ${q}.`);
      chrome.tabs.update(tabId, {
        url: `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`
      });
    }
  }

  // ===== TAB MANAGEMENT =====
  else if (lower.includes("next tab")) {
    speak(tabId, "Switching to next tab.");
    chrome.tabs.query({ currentWindow: true }, (tabs) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (activeTabs) => {
        const i = activeTabs[0].index;
        const next = (i + 1) % tabs.length;
        chrome.tabs.update(tabs[next].id, { active: true });
      });
    });
  } else if (lower.includes("previous tab")) {
    speak(tabId, "Going to previous tab.");
    chrome.tabs.query({ currentWindow: true }, (tabs) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (activeTabs) => {
        const i = activeTabs[0].index;
        const prev = (i - 1 + tabs.length) % tabs.length;
        chrome.tabs.update(tabs[prev].id, { active: true });
      });
    });
  } else if (lower.includes("new tab")) {
    speak(tabId, "Opening a new tab.");
    chrome.tabs.create({ url: "https://www.google.com" });
  } else if (lower.includes("close tab")) {
    speak(tabId, "Closing this tab.");
    chrome.tabs.remove(tabId);
  } else if (lower.includes("refresh page") || lower.includes("reload page")) {
    speak(tabId, "Reloading this page.");
    chrome.tabs.reload(tabId);
  }

  // ===== FALLBACK =====
  else {
    speak(tabId, "Sorry, I didn't understand that.");
    chrome.tabs.sendMessage(tabId, { type: "unknown-command", text: command });
  }
}

// ---- Auto-play first YouTube video after search ----
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === "complete" && tab.url.includes("youtube.com/results")) {
    chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const firstVideo = document.querySelector("#video-title");
        if (firstVideo) firstVideo.click();
      },
    });
  }
});

// ---- Summarization Handler (existing) ----
async function summarizePage(tabId) {
  try {
    const [{ result: pageText }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const selectedText = window.getSelection()?.toString().trim();
        if (selectedText && selectedText.length > 30) return selectedText.slice(0, 4000);
        const article = document.querySelector("article");
        const main = document.querySelector("main");
        let text = "";
        if (article) text = article.innerText;
        else if (main) text = main.innerText;
        else {
          const paragraphs = Array.from(document.querySelectorAll("p"))
            .map((p) => p.innerText)
            .filter((t) => t.split(" ").length > 5)
            .join("\n\n");
          text = paragraphs;
        }
        return text.slice(0, 4000);
      },
    });

    if (!pageText || pageText.trim().length === 0) {
      chrome.tabs.sendMessage(tabId, {
        type: "summary-error",
        text: "No readable or selected text found on this page.",
      });
      return;
    }

    const response = await fetch("http://localhost:3000/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: pageText }),
    });

    if (!response.ok) throw new Error("Backend request failed");
    const data = await response.json();
    const summary = data.summary || "No summary received.";

    chrome.tabs.sendMessage(tabId, { type: "summary-result", text: summary });

    chrome.scripting.executeScript({
      target: { tabId },
      func: (summaryText) => {
        const utter = new SpeechSynthesisUtterance(summaryText);
        utter.lang = "en-US";
        speechSynthesis.speak(utter);
      },
      args: [summary],
    });
  } catch (error) {
    console.error("Summarization error:", error);
    chrome.tabs.sendMessage(tabId, {
      type: "summary-error",
      text: "Failed to summarize. Check backend connection.",
    });
  }
}
