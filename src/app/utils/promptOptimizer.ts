import type { OutputType, MessageMetrics } from '@/app/App';

interface OptimizationResult {
  optimizedPrompt: string;
  output: string;
  outputType: OutputType;
  explanation: string;
  metrics: MessageMetrics;
}

// ─── Token helpers ────────────────────────────────────────────────────────────
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function calculateMetrics(originalTokens: number, optimizedTokens: number): MessageMetrics {
  const tokensSaved = Math.max(0, originalTokens - optimizedTokens);
  return {
    tokensSaved,
    co2Saved: tokensSaved * 0.002,
    waterSaved: tokensSaved * 0.05,
    electricityOptimized: tokensSaved * 0.0003,
  };
}

// ─── Detect intended output type ─────────────────────────────────────────────
function detectOutputType(prompt: string): OutputType {
  const lower = prompt.toLowerCase();
  if (lower.includes('image') || lower.includes('picture') || lower.includes('photo') || lower.includes('draw')) return 'image';
  if (lower.includes('speech') || lower.includes('transcript') || lower.includes('talk') || lower.includes('presentation')) return 'speech';
  if (lower.includes('code') || lower.includes('function') || lower.includes('program') || lower.includes('algorithm') || lower.includes('script')) return 'code';
  return 'essay';
}

// ─── Shared Gemini fetch helper ───────────────────────────────────────────────
// Free tier: gemini-2.0-flash  →  15 RPM, 1M TPM, 1500 req/day  (no credit card needed)
// Get your key at: https://aistudio.google.com/app/apikey
async function callGemini(systemPrompt: string, userMessage: string): Promise<string> {
  const apiKey = (import.meta.env.VITE_GEMINI_API_KEY ?? '') as string;

  if (!apiKey) {
    throw new Error(
      'Missing API key.\n\nCreate a .env.local file in your project root:\nVITE_GEMINI_API_KEY=YOUR_KEY\n\nGet a free key at https://aistudio.google.com/app/apikey'
    );
  }

  const model = 'gemini-3-flash-preview';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      // Gemini uses systemInstruction + contents (no separate system role in messages)
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: userMessage }],
        },
      ],
      generationConfig: {
        maxOutputTokens: 1024,
        temperature: 0.7,
      },
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${errBody}`);
  }

  const data = await response.json();

  // Gemini response shape: data.candidates[0].content.parts[0].text
  const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  if (!text) {
    throw new Error('Gemini returned an empty response. Check your API key and quota.');
  }
  return text.trim();
}

// ─── Step 1: Compress the prompt (small/fast call) ───────────────────────────
async function compressPrompt(userPrompt: string): Promise<string> {
  const result = await callGemini(
    `You are an expert prompt compressor for an eco-friendly AI system.
Your ONLY job: rewrite the user's query so it is as short and precise as possible
while preserving 100% of the intent.

Rules:
- Remove filler words, slang, typos, repetition, and polite preamble.
- Fix spelling errors.
- Do NOT answer the question — only rewrite it.
- Output ONLY the rewritten prompt, nothing else. No preamble, no quotes.`,
    userPrompt,
  );
  return result || userPrompt;
}

// ─── Step 2: Generate the answer using the optimized prompt ──────────────────
async function generateAnswer(optimizedPrompt: string, outputType: OutputType): Promise<string> {
  const systemPrompt =
    outputType === 'code'
      ? 'You are an expert programmer. Return only clean, well-commented code. No markdown fences, no explanations outside the code.'
      : outputType === 'image'
      ? 'You are an image prompt engineer. Return a single vivid, detailed, comma-separated image generation prompt. No preamble or explanation.'
      : outputType === 'speech'
      ? 'You are a professional speechwriter. Return only the speech text. No headings, no meta-commentary, no stage directions.'
      : 'You are a clear, concise writer. Return a well-structured essay in plain prose paragraphs. No headings.';

  return callGemini(systemPrompt, optimizedPrompt);
}

// ─── Public entry-point ───────────────────────────────────────────────────────
export async function optimizePrompt(userPrompt: string): Promise<OptimizationResult> {
  const originalTokens = estimateTokens(userPrompt);
  const outputType = detectOutputType(userPrompt);

  // ① Flash model compresses the prompt
  const optimizedPrompt = await compressPrompt(userPrompt);
  const optimizedTokens = estimateTokens(optimizedPrompt);

  // ② Flash model answers using the compressed prompt
  const output = await generateAnswer(optimizedPrompt, outputType);

  const metrics = calculateMetrics(originalTokens, optimizedTokens);
  const savingPct = originalTokens > 0
    ? ((metrics.tokensSaved / originalTokens) * 100).toFixed(0)
    : '0';

  return {
    optimizedPrompt,
    output,
    outputType,
    explanation: `Prompt compressed by Gemini 2.0 Flash from ${originalTokens} → ${optimizedTokens} tokens (${savingPct}% saved). Answer generated using the optimized prompt.`,
    metrics,
  };
}