// Fælles adgang til Claude API for robottens AI-trin (relevans, projektkort, For og imod).
//
// Nøglen ligger i GitHub-hemmeligheden RELEVANS_NOEGLE (navnet er fra det første trin, der brugte den). Nøglen er ikke
// bundet til et arbejdsrum i Anthropic-konsollen, så arbejdsrummets id sendes med fra variablen RELEVANS_ARBEJDSRUM.
// ANTHROPIC_API_KEY bruges kun, hvis den er sat lokalt.
import Anthropic from "@anthropic-ai/sdk";

export { Anthropic };

export function klient() {
  const apiKey = process.env.RELEVANS_NOEGLE || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const arbejdsrum = process.env.RELEVANS_ARBEJDSRUM;
  return new Anthropic({ apiKey, ...(arbejdsrum && { defaultHeaders: { "anthropic-workspace-id": arbejdsrum } }) });
}

// Fejl i nøglen eller opsætningen rammer alle kald ens: så skal trinnet stoppe i stedet for at prøve alle sager igennem
export function opsaetningsfejl(e, ok, fejl) {
  return e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError || e instanceof Anthropic.NotFoundError
    || (e instanceof Anthropic.BadRequestError && /workspace|api key|credit balance/i.test(e.message)) || (ok === 0 && fejl >= 20);
}

// Dollar pr. million tokens ind / ud (prompter under 100.000 tokens)
const TAKST = { "claude-haiku-5-5": [0.1, 0.5], "claude-sonnet-5-5": [2, 10] };
export function pris(model, ind, ud) {
  const [a, b] = TAKST[model] || [0, 0];
  return (ind * a + ud * b) / 1e6;
}
