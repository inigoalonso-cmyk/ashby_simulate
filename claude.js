// Thin wrapper around the Anthropic Messages API. Used only inside this
// local sandbox (scoring + simulated interview). Never sends candidate data
// anywhere except to Anthropic's API with your own key.
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929';

async function callClaude({ system, messages, maxTokens = 1500 }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set. Copy .env.example to .env and fill it in.');
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${text}`);
  }
  const data = await res.json();
  return data.content.map((block) => block.text || '').join('');
}

// Pulls the first {...} or [...] JSON blob out of a model response, in case
// it wraps it in prose or a markdown fence despite instructions not to.
function extractJSON(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.search(/[[{]/);
  if (start === -1) throw new Error(`No JSON found in model response: ${text.slice(0, 300)}`);
  return JSON.parse(candidate.slice(start));
}

module.exports = { callClaude, extractJSON, MODEL };
