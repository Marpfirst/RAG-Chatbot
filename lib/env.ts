function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  return v === undefined ? fallback : Number(v);
}

export const env = {
  // chat provider (any OpenAI-compatible endpoint)
  openaiKey: () => req("OPENAI_API_KEY"),
  openaiBase: () => process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
  modelManager: () => process.env.MODEL_MANAGER || "gpt-4o-mini",
  modelSpecialist: () => process.env.MODEL_SPECIALIST || "gpt-4o-mini",

  // embedding provider (kept separate so the chat provider can move alone)
  embedKey: () => process.env.EMBED_API_KEY || req("OPENAI_API_KEY"),
  embedBase: () =>
    process.env.EMBED_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
  embedModel: () => process.env.EMBED_MODEL || "text-embedding-3-small",

  supabaseUrl: () => req("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseKey: () => req("SUPABASE_SERVICE_ROLE_KEY"),

  corpusLang: () => process.env.CORPUS_LANG || "id",
  matchCount: () => num("MATCH_COUNT", 3),
  matchThreshold: () => num("MATCH_THRESHOLD", 0.35),
  relativeGap: () => num("RELATIVE_GAP", 0.08),
  historyTurns: () => num("HISTORY_TURNS", 4),
  maxTokensManager: () => num("MAX_TOKENS_MANAGER", 250),
  maxTokensSpecialist: () => num("MAX_TOKENS_SPECIALIST", 400),
  maxInputChars: () => num("MAX_INPUT_CHARS", 1000),

  naiveMode: () => process.env.NAIVE_MODE === "true",
};
