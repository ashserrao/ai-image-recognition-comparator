// =======================
// CONFIGURATION
// =======================
const GEMINI_API_KEY = "YOUR_GEMINI_API_KEY";
const CLARIFAI_API_KEY = "YOUR_CLARIFAI_API_KEY";
// const CLARIFAI_MODEL_URL =
// "https://api.clarifai.com/v2/models/general-image-recognition/outputs";
const CLARIFAI_MODEL_URL = ` https://api.clarifai.com/v2/models/general-image-recognition/outputs?pat=${CLARIFAI_API_KEY}`;

// =======================
// MAIN CLICK HANDLER
// =======================
document.getElementById("analyzeBtn").addEventListener("click", async () => {
  const fileInput = document.getElementById("imageInput");
  if (!fileInput.files.length) return alert("Please select an image.");

  const imageFile = fileInput.files[0];
  const imageData = await imageFile.arrayBuffer();

  const [geminiTags, clarifaiTags] = await Promise.all([
    analyzeWithGemini(imageData),
    analyzeWithClarifai(imageData),
  ]);

  displayResults("geminiResults", geminiTags);
  displayResults("hfResults", clarifaiTags);

  const overlap = geminiTags.filter((tag) => clarifaiTags.includes(tag));
  displayResults("overlapResults", overlap);
});

// =======================
// GEMINI VISION API
// =======================
async function analyzeWithGemini(imageBuffer) {
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
// CLARIFAI IMAGE RECOGNITION API
// =======================
async function analyzeWithClarifai(imageBuffer) {
  const base64Image = btoa(
    new Uint8Array(imageBuffer).reduce(
      (data, byte) => data + String.fromCharCode(byte),
      ""
    )
  );

  const body = {
    inputs: [
      {
        data: { image: { base64: base64Image } },
      },
    ],
  };

  const response = await fetch(CLARIFAI_MODEL_URL, {
    method: "POST",
    headers: {
      // Authorization: `Key ${CLARIFAI_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  const concepts = data.outputs?.[0]?.data?.concepts || [];

  return concepts.map((c) => c.name.toLowerCase());
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
