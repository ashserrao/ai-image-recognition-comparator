// =======================
// CONFIGURATION
// =======================
const GEMINI_API_KEY = "";
const OPENROUTER_API_KEY = "";

// =======================
// MAIN CLICK HANDLER
// =======================
document.getElementById("analyzeBtn").addEventListener("click", async () => {
  console.trace("analyzeBtn click handler invoked");
  const fileInput = document.getElementById("imageInput");
  if (!fileInput.files.length) return alert("Please select an image.");

  const imageFile = fileInput.files[0];
  const imageData = await imageFile.arrayBuffer();
  const analyzeBtn = document.getElementById("analyzeBtn");
  analyzeBtn.disabled = true; // prevent accidental double-clicks
  try {
    // Call Gemini once, then send the resulting tags to OpenRouter for refinement.
    const geminiTags = await analyzeWithGemini(imageData);
    const openRouterTags = await analyzeWithOpenRouterSafe(geminiTags);
    displayResults("geminiResults", geminiTags);
    displayResults("hfResults", openRouterTags);

    // Compare results and show overlap with metrics
    const overlap = geminiTags.filter((tag) => openRouterTags.includes(tag));
    const stats = compareResults(geminiTags, openRouterTags, overlap);
    
    // Show comparison summary above overlap list
    const summary = document.getElementById('comparisonSummary');
    if (summary) {
      summary.innerHTML = `
        <p><strong>Winner:</strong> ${stats.winner}</p>
        <p>Gemini provided ${stats.geminiCount} tags, OpenRouter refined to ${stats.openRouterCount} tags.</p>
        <p>${stats.overlapCount} tags matched between both models (${Math.round(stats.precisionGemini * 100)}% of Gemini tags).</p>
      `;
    }
    
    // Show the overlapping tags
    displayResults("overlapResults", overlap);
  } finally {
    analyzeBtn.disabled = false;
  }
});

// =======================
// GEMINI VISION API (unchanged)
// =======================
async function analyzeWithGemini(imageBuffer) {
  console.trace("analyzeWithGemini invoked");
  const base64Image = btoa(
    new Uint8Array(imageBuffer).reduce(
      (data, byte) => data + String.fromCharCode(byte),
      ""
    )
  );

  const body = {
    contents: [
      {
        parts: [
          {
            inline_data: { mime_type: "image/jpeg", data: base64Image },
          },
          { text: "Describe the objects or tags in this image." },
        ],
      },
    ],
  };

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

  return text
    .split(/[,.\n]/)
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
}

// =======================
// OPENROUTER IMAGE RECOGNITION (REPLACES CLARIFAI)
// =======================


// Safe wrapper with defensive handling for OpenRouter responses (handles 204, logs status)
async function analyzeWithOpenRouterSafe(tags) {
  console.trace("analyzeWithOpenRouterSafe invoked with tags:", tags);
  try {
    const prompt = `These are detected image tags: ${tags.join(", ")}` +
      "\nRefine the list, remove irrelevant items, and return key descriptive tags only.";

    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'openrouter/polaris-alpha',
          messages: [{ role: "user", content: prompt }],
        }),
      }
    );

    console.log("OpenRouter response status:", response.status, response.statusText);

    if (response.status === 204) return [];

    if (!response.ok) {
      let bodyText = "";
      try { bodyText = await response.text(); } catch (e) { /* ignore */ }
      console.error("OpenRouter fetch failed:", response.status, bodyText);
      return [];
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || "";
    return text.split(/[,\.\n]/).map((t) => t.trim().toLowerCase()).filter(Boolean);
  } catch (err) {
    console.error("analyzeWithOpenRouterSafe error:", err);
    return [];
  }
}
// =======================
// DISPLAY RESULTS
// =======================
function displayResults(elementId, tags) {
  const list = document.getElementById(elementId);
  list.innerHTML = "";
  tags.forEach((tag) => {
    const li = document.createElement("li");
    li.textContent = tag;
    list.appendChild(li);
  });
}

// Compare tag lists with a simple heuristic (no ground truth available)
// We treat agreement between the two models as a proxy for quality.
// Metrics returned:
// - geminiCount, openRouterCount, overlapCount, unionCount
// - precisionGemini = overlap / geminiCount
// - precisionOpenRouter = overlap / openRouterCount
// Winner: higher precision (more of the model's tags agreed by the other model).
function compareResults(geminiTags, openRouterTags, overlap) {
  const geminiCount = geminiTags.length;
  const openRouterCount = openRouterTags.length;
  const overlapCount = overlap.length;
  const unionCount = new Set([...geminiTags, ...openRouterTags]).size;

  // If either model returned no results, it can't win
  if (geminiCount === 0 || openRouterCount === 0) {
    const winner = geminiCount > 0 ? 'Gemini' : (openRouterCount > 0 ? 'OpenRouter' : 'No results from either model');
    return {
      geminiCount,
      openRouterCount,
      overlapCount,
      unionCount,
      precisionGemini: 0,
      precisionOpenRouter: 0,
      winner
    };
  }

  // Score components:
  // 1. Tag count score (reward having more relevant tags, but with diminishing returns)
  const maxIdealTags = 10; // Assuming ~10 tags is a good sweet spot
  const tagCountScoreGemini = Math.min(geminiCount, maxIdealTags) / maxIdealTags;
  const tagCountScoreOpenRouter = Math.min(openRouterCount, maxIdealTags) / maxIdealTags;

  // 2. Agreement score (what % of tags are agreed upon by both models)
  const agreementScoreGemini = geminiCount ? overlapCount / geminiCount : 0;
  const agreementScoreOpenRouter = openRouterCount ? overlapCount / openRouterCount : 0;

  // Combined score (60% weight on agreement, 40% on tag count)
  const scoreGemini = (agreementScoreGemini * 0.6) + (tagCountScoreGemini * 0.4);
  const scoreOpenRouter = (agreementScoreOpenRouter * 0.6) + (tagCountScoreOpenRouter * 0.4);
  // Determine winner based on final scores
  let winner;
  if (Math.abs(scoreGemini - scoreOpenRouter) < 0.1) {
    // Scores are very close - consider it a tie
    winner = overlapCount > 0 ? 'Both (similar results)' : 'Tie (different perspectives)';
  } else if (scoreGemini > scoreOpenRouter) {
    winner = `Gemini (better ${scoreGemini > scoreOpenRouter + 0.2 ? 'by far' : 'slightly'})`;
  } else {
    winner = `OpenRouter (better ${scoreOpenRouter > scoreGemini + 0.2 ? 'by far' : 'slightly'})`;
  }

  return {
    geminiCount,
    openRouterCount,
    overlapCount,
    unionCount,
    precisionGemini: agreementScoreGemini,
    precisionOpenRouter: agreementScoreOpenRouter,
    winner
  };
}
