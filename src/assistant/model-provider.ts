/** Server-only transport. No user text, tool result or history is accepted here. */
export const MODEL_PROVIDERS = [
  'openai',
  'anthropic',
  'google',
  'mistral',
] as const;
export type ModelProvider = (typeof MODEL_PROVIDERS)[number];
export function modelConfig() {
  const provider = process.env.ASSISTANT_PROVIDER as ModelProvider;
  const model = process.env.ASSISTANT_MODEL?.trim();
  const key = process.env.ASSISTANT_API_KEY?.trim();
  if (
    !MODEL_PROVIDERS.includes(provider) ||
    !model ||
    !key ||
    !/^[\w.:-]{1,120}$/.test(model)
  )
    return null;
  return { provider, model, key };
}
export function externalReady(settings: any) {
  const config = modelConfig();
  return !!(
    config &&
    !settings.killSwitch &&
    settings.licenseConfirmed &&
    settings.licenseReference?.trim() &&
    settings.licenseDate &&
    new Date(settings.licenseDate).getTime() <= Date.now() &&
    settings.provider === config.provider &&
    settings.licenseProvider === config.provider &&
    settings.model === config.model
  );
}
const SYSTEM =
  'Tu aides à présenter une analyse RH vérifiée. Choisis uniquement des identifiants dans la liste proposée, sans ajout ni répétition. Renvoie uniquement un objet JSON {"sentences":["overview", ...]}. Commence toujours par overview. Aucun texte libre, chiffre, conseil juridique ni décision RH.';
export async function selectSentences(candidates: string[]): Promise<string[]> {
  if (
    !candidates.length ||
    candidates.length > 10 ||
    candidates.some((s) => !/^[a-z_]+$/.test(s))
  )
    throw new Error('Invalid model input');
  const c = modelConfig();
  if (!c) throw new Error('Model unavailable');
  // The entire provider payload is built from an internal, finite vocabulary.
  const user = JSON.stringify({ candidates });
  let url: string, body: any;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (c.provider === 'anthropic') {
    url = 'https://api.anthropic.com/v1/messages';
    headers['x-api-key'] = c.key;
    headers['anthropic-version'] = '2023-06-01';
    body = {
      model: c.model,
      system: SYSTEM,
      max_tokens: 256,
      messages: [{ role: 'user', content: user }],
    };
  } else if (c.provider === 'google') {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(c.model)}:generateContent`;
    headers['x-goog-api-key'] = c.key;
    body = {
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: {
        maxOutputTokens: 256,
        responseMimeType: 'application/json',
      },
    };
  } else {
    url =
      c.provider === 'openai'
        ? 'https://api.openai.com/v1/chat/completions'
        : 'https://api.mistral.ai/v1/chat/completions';
    headers.Authorization = `Bearer ${c.key}`;
    body = {
      model: c.model,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' },
      ...(c.provider === 'openai'
        ? { max_completion_tokens: 256, store: false }
        : { max_tokens: 256 }),
    };
  }
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 12000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      redirect: 'error',
      signal: abort.signal,
    });
    if (!res.ok || !res.body) throw new Error('Model unavailable');
    const reader = res.body.getReader(),
      chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.length;
        if (bytes > 65536) throw new Error('Model response too large');
        chunks.push(chunk.value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const text =
      c.provider === 'anthropic'
        ? data.content
            ?.filter((p: any) => p.type === 'text')
            .map((p: any) => p.text)
            .join('')
        : c.provider === 'google'
          ? data.candidates?.[0]?.content?.parts
              ?.map((p: any) => p.text || '')
              .join('')
          : data.choices?.[0]?.message?.content;
    const output = JSON.parse(text);
    if (
      !output ||
      Object.keys(output).join() !== 'sentences' ||
      !Array.isArray(output.sentences) ||
      output.sentences[0] !== 'overview' ||
      output.sentences.length > 3 ||
      new Set(output.sentences).size !== output.sentences.length ||
      output.sentences.some(
        (s: unknown) => typeof s !== 'string' || !candidates.includes(s),
      )
    )
      throw new Error('Ungrounded model response');
    return output.sentences;
  } finally {
    clearTimeout(timer);
  }
}
