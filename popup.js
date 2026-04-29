const startBtn = document.getElementById("start");
const stopBtn = document.getElementById("stop");
const outputDiv = document.getElementById("output");

// ---- START LISTENING ----
startBtn.onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    outputDiv.textContent = "No active tab found.";
    return;
  }

  chrome.tabs.sendMessage(tab.id, { type: "start-listening" });
  outputDiv.textContent = "🎤 Listening started...";
  startBtn.disabled = true;
  stopBtn.disabled = false;
};

// ---- STOP LISTENING ----
stopBtn.onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    outputDiv.textContent = "No active tab found.";
    return;
  }

  chrome.tabs.sendMessage(tab.id, { type: "stop-listening" });
  outputDiv.textContent = "🛑 Listening stopped.";
  startBtn.disabled = false;
  stopBtn.disabled = true;
};

// ---- RECEIVE MESSAGES BACK ----
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "voice-command") {
    outputDiv.textContent = `Heard: "${message.text}"`;
  }
});
