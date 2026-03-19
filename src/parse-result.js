/**
 * Parsea la salida de un CLI de IA y extrae el resultado útil.
 * Claude con --output-format json devuelve JSON lines, el último con type:"result".
 */
export function parseResult(stdout) {
  if (!stdout || typeof stdout !== 'string') {
    return { success: false, error: 'Empty output' };
  }

  const trimmed = stdout.trim();

  // Claude JSON output: buscar linea con type:"result"
  const lines = trimmed.split('\n');
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line.trim());
      if (parsed.type === 'result') {
        const tokens = extractTokens(parsed.modelUsage);
        return {
          success: !parsed.is_error,
          result: parsed.result,
          cost: parsed.total_cost_usd ?? 0,
          turns: parsed.num_turns ?? 0,
          duration: parsed.duration_ms ?? 0,
          model: Object.keys(parsed.modelUsage || {})[0] ?? null,
          tokens,
        };
      }
    } catch {}
  }

  // Fallback: intentar parsear todo como JSON directo
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed.result !== undefined) {
      const tokens = extractTokens(parsed.modelUsage);
      return {
        success: !parsed.is_error,
        result: parsed.result,
        cost: parsed.total_cost_usd ?? 0,
        turns: parsed.num_turns ?? 0,
        duration: parsed.duration_ms ?? 0,
        model: Object.keys(parsed.modelUsage || {})[0] ?? null,
        tokens,
      };
    }
  } catch {}

  return { success: false, error: 'No result found in output', raw: trimmed.slice(0, 500) };
}

/**
 * Extrae totales de tokens de modelUsage de Claude.
 * modelUsage: { "claude-opus-4-6[1m]": { inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens } }
 */
function extractTokens(modelUsage) {
  if (!modelUsage) return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };

  let input = 0, output = 0, cacheRead = 0, cacheWrite = 0;

  for (const model of Object.values(modelUsage)) {
    input += model.inputTokens || 0;
    output += model.outputTokens || 0;
    cacheRead += model.cacheReadInputTokens || 0;
    cacheWrite += model.cacheCreationInputTokens || 0;
  }

  return { input, output, cacheRead, cacheWrite, total: input + output + cacheRead + cacheWrite };
}

/**
 * Elimina bloques ```json ... ``` del texto para extraer JSON limpio.
 */
function stripCodeBlock(text) {
  if (!text) return text;
  const match = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  return match ? match[1].trim() : text.trim();
}

/**
 * Intenta parsear el result como JSON (para cuando el agente devuelve JSON estructurado).
 */
export function parseResultAsJson(stdout) {
  const parsed = parseResult(stdout);
  if (!parsed.success) return parsed;

  const cleaned = stripCodeBlock(parsed.result);
  try {
    parsed.data = JSON.parse(cleaned);
  } catch {
    // El result es texto plano, no JSON — eso está bien para algunos agentes
    parsed.data = null;
  }

  return parsed;
}
