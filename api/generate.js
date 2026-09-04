// Vercel Serverless Function — /api/generate
//
// Proxy seguro para múltiplos provedores de IA, usado pelos recursos de IA
// do app (gerar mensagem de WhatsApp, gerar conteúdo de site/landing page,
// ler fotos de cardápio, sugerir categorias/itens de catálogo).
//
// Por que isso existe: as chaves de API são secretas. Se fossem usadas
// direto no navegador, qualquer visitante do site poderia copiá-las e gastar
// a cota. Esta função roda apenas no servidor (Vercel), injeta a chave
// aqui, chama o provedor e devolve ao frontend só o texto gerado — nunca a
// chave.
//
// O frontend continua enviando o mesmo formato que já usava
// ({ system, messages, max_tokens, images? }) — a tradução para o formato
// de cada provedor acontece aqui, e a resposta é devolvida no formato
// { content: [{ type: "text", text }] } para não exigir mudanças em nenhum
// componente que chama a IA.
//
// ---------------------------------------------------------------------
// ARQUITETURA MULTI-PROVEDOR: Groq → Gemini → OpenAI
// ---------------------------------------------------------------------
// Groq e Gemini têm camadas de compatibilidade com o formato de chat
// completions da OpenAI (mesma estrutura de request/response), então os três
// provedores são tratados de forma unificada aqui — só muda o endpoint, a
// chave e a lista de modelos de cada um. A OpenAI é o único pago dos três;
// por isso fica por último, como garantia final.
//
// Cada provedor só entra na cadeia se sua chave estiver configurada — dá
// pra usar só um, dois, ou os três ao mesmo tempo:
//   GROQ_API_KEY    — grátis, sem cartão de crédito (console.groq.com)
//   GEMINI_API_KEY  — grátis (Google AI Studio, aistudio.google.com)
//   OPENAI_API_KEY  — pago por uso (platform.openai.com)
//
// Dentro de cada provedor, se o modelo principal não existir/não estiver
// acessível (HTTP 404/403), tenta o(s) modelo(s) de reserva do MESMO
// provedor. Se um provedor inteiro falhar (por qualquer motivo — chave
// inválida, limite de uso, indisponibilidade, timeout), o próximo provedor
// da cadeia é tentado automaticamente — essa é a ideia central do recurso:
// usar os provedores gratuitos primeiro, e só cair na OpenAI (paga) se os
// gratuitos realmente não responderem. Nada disso esconde o erro: se TODOS
// os provedores falharem, a mensagem final lista exatamente o que foi
// tentado, e o log do servidor tem a causa técnica completa de cada
// tentativa, provedor por provedor.
//
// ---------------------------------------------------------------------
// HISTÓRICO
// ---------------------------------------------------------------------
// Este arquivo já usou só a API da NVIDIA, depois só a API da OpenAI. A
// NVIDIA foi abandonada porque o modelo principal foi descontinuado pela
// própria NVIDIA em 25/08/2026 e os fallbacks escolhidos numa correção
// seguinte vieram de uma fonte não confiável e nem existiam de fato no
// plano gratuito — a lição foi: só confiar na documentação OFICIAL de cada
// provedor, nunca em blog/doc de terceiros. Essa mesma checagem foi feita
// para Groq e Gemini antes desta migração (inclusive um modelo do Groq que
// eu ia usar também estava para ser desligado).

// Modelos de cada provedor confirmados na documentação OFICIAL em
// 31/08/2026 — reconfirme antes de trocar qualquer um destes no futuro,
// direto na doc oficial do provedor:
//   Groq:   console.groq.com/docs/models
//   Gemini: ai.google.dev/gemini-api/docs/openai
//   OpenAI: platform.openai.com/docs/models
const PROVIDER_DEFS = [
  {
    key: "groq",
    nome: "Groq",
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    apiKeyEnv: "GROQ_API_KEY",
    modelEnv: "GROQ_MODEL",
    fallbackEnv: "GROQ_FALLBACK_MODELS",
    // gpt-oss é a família de modelos abertos da própria OpenAI, hospedada
    // pelo Groq — reasoning models, então a defesa contra vazamento de
    // raciocínio (extrairRespostaFinal, mais abaixo) importa aqui.
    defaultModel: "openai/gpt-oss-20b",
    defaultFallbacks: ["openai/gpt-oss-120b"],
  },
  {
    key: "gemini",
    nome: "Gemini",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    apiKeyEnv: "GEMINI_API_KEY",
    modelEnv: "GEMINI_MODEL",
    fallbackEnv: "GEMINI_FALLBACK_MODELS",
    defaultModel: "gemini-3-flash-preview",
    defaultFallbacks: ["gemini-2.5-flash"],
  },
  {
    key: "openai",
    nome: "OpenAI",
    endpoint: "https://api.openai.com/v1/chat/completions",
    apiKeyEnv: "OPENAI_API_KEY",
    modelEnv: "OPENAI_MODEL",
    fallbackEnv: "OPENAI_FALLBACK_MODELS",
    // gpt-4o-mini/gpt-4o não são modelos "de raciocínio" — não vazam
    // rascunho de pensamento, o que era uma classe inteira de bug com os
    // modelos usados anteriormente (NVIDIA Nemotron).
    defaultModel: "gpt-4o-mini",
    defaultFallbacks: ["gpt-4o"],
  },
];

// Máximo de fotos aceitas por requisição (ex.: fotos de um cardápio
// impresso) — cada imagem consome bastante contexto/tempo de
// processamento; um teto baixo mantém a resposta dentro do orçamento de
// tempo total e evita payloads gigantes vindos do navegador. Os três
// provedores leem imagem nativamente no formato "image_url", então não
// existe uma configuração separada de "modelo de visão".
const MAX_IMAGENS_POR_REQUISICAO = 6;
const MAX_TAMANHO_IMAGEM_BASE64 = 8_000_000;

// Por quanto tempo um modelo marcado como indisponível fica "de molho"
// antes de ser tentado de novo automaticamente. Cache em memória, por
// instância do servidor — não é persistente entre cold starts, o que é
// aceitável porque é só uma otimização (evitar tentativas repetidas óbvias),
// nunca a única linha de defesa: a detecção acontece a cada chamada de
// qualquer forma.
const UNAVAILABLE_TTL_MS = Number(process.env.AI_MODEL_UNAVAILABLE_TTL_MS) > 0
  ? Number(process.env.AI_MODEL_UNAVAILABLE_TTL_MS)
  : 10 * 60 * 1000; // 10 minutos

const LANGUAGE_INSTRUCTION =
  "Responda SEMPRE e EXCLUSIVAMENTE em português do Brasil (pt-BR), com ortografia e gramática corretas. " +
  "Nunca responda em inglês ou em qualquer outro idioma — mesmo que parte do prompt, algum nome próprio ou termo técnico esteja em inglês.";

// Rede de segurança contra vazamento de raciocínio em texto solto (ver
// HISTÓRICO) — importa especialmente para os modelos gpt-oss do Groq, que
// são "de raciocínio". Sem custo quando o modelo já responde limpo.
const OUTPUT_MARKER_START = "[[RESPOSTA_FINAL]]";
const OUTPUT_MARKER_END = "[[/RESPOSTA_FINAL]]";
const OUTPUT_FORMAT_INSTRUCTION =
  `Formato de saída OBRIGATÓRIO: escreva a resposta final, e SOMENTE ela, entre as marcações ${OUTPUT_MARKER_START} e ${OUTPUT_MARKER_END}, sem nada antes ou depois. ` +
  `Exemplo: ${OUTPUT_MARKER_START}texto da resposta aqui${OUTPUT_MARKER_END}`;
const SAUDACOES_MENSAGEM = /\b(oi|olá|ola|e a[ií]|fala|bom dia|boa tarde|boa noite)\b[,!.]?/i;

// Orçamento total de tempo para TODAS as tentativas (todos os provedores e
// modelos) somadas. O frontend cancela a requisição em 35s (ver callClaude
// em src/VibeLeadsAI.jsx); reservamos margem para round-trip/overhead.
const TOTAL_TIMEOUT_BUDGET_MS = 28000;
const PER_ATTEMPT_TIMEOUT_MS = 12000;

const unavailableModels = new Map();

function parseModelList(envValue) {
  if (!envValue) return [];
  return String(envValue).split(",").map(s => s.trim()).filter(Boolean);
}

// Monta a lista de provedores realmente utilizáveis (com chave configurada),
// na ordem definida em PROVIDER_DEFS (Groq → Gemini → OpenAI), cada um já
// com sua própria cadeia de modelos (principal + fallbacks, sem duplicatas).
function getProvidersDisponiveis() {
  const providers = [];
  for (const def of PROVIDER_DEFS) {
    const apiKey = process.env[def.apiKeyEnv];
    if (!apiKey) continue; // provedor sem chave configurada — pulado, sem erro
    const primary = process.env[def.modelEnv] || def.defaultModel;
    const fallbacksConfigurados = parseModelList(process.env[def.fallbackEnv]);
    const fallbacks = fallbacksConfigurados.length > 0 ? fallbacksConfigurados : def.defaultFallbacks;
    const seen = new Set();
    const chain = [];
    for (const m of [primary, ...fallbacks]) {
      if (m && !seen.has(m)) { seen.add(m); chain.push(m); }
    }
    providers.push({ ...def, apiKey, primary, chain });
  }
  return providers;
}

// Detecta "modelo indisponível" (nome errado, descontinuado, ou sem acesso
// da conta a ele) — os três provedores usam majoritariamente HTTP 404 com
// mensagem citando o model id para isso (formato OpenAI-compatível). Também
// tratamos 403 do mesmo jeito — tentar o próximo modelo/provedor é seguro:
// se o problema fosse a chave em si, a tentativa seguinte falharia igual e
// o erro real ainda apareceria no final.
function isModelUnavailableError(status, causaMsg) {
  if (status === 403) return true;
  if (status === 404) {
    const msg = String(causaMsg || "").toLowerCase();
    return /model/.test(msg) && /(does not exist|not found|invalid|não encontrado|nao encontrado|access|acesso|indispon)/.test(msg);
  }
  return false;
}

function marcarIndisponivel(providerKey, model, motivo) {
  unavailableModels.set(`${providerKey}:${model}`, Date.now() + UNAVAILABLE_TTL_MS);
  console.log(`[api/generate] modelo marcado como indisponível por ${Math.round(UNAVAILABLE_TTL_MS / 1000)}s: ${providerKey}/${model} | motivo: ${motivo}`);
}

function estaMarcadoIndisponivel(providerKey, model) {
  const ate = unavailableModels.get(`${providerKey}:${model}`);
  return Boolean(ate && ate > Date.now());
}

// Mensagem curta e sempre em português para o usuário final — a causa
// técnica completa (muitas vezes em inglês) nunca é escondida: continua no
// log do servidor (chamarProvider já registra o corpo cru de cada resposta
// de erro), só não é concatenada na mensagem exibida na tela.
function mensagemAmigavel(nomeProvedor, status) {
  if (status === 401) return `A chave da API da ${nomeProvedor} foi recusada (credencial inválida ou expirada).`;
  if (status === 429) return `O limite de uso da API da ${nomeProvedor} foi atingido no momento.`;
  if (status >= 500) return `A API da ${nomeProvedor} está instável no momento (erro do lado do provedor).`;
  if (status === 400) return `A API da ${nomeProvedor} recusou o formato da requisição.`;
  return `A API da ${nomeProvedor} recusou a requisição.`;
}

// Extrai a resposta final do texto bruto, descartando raciocínio/comentário
// vazado — em qualquer idioma, com ou sem tags reconhecíveis. Ordem: (1)
// conteúdo entre os marcadores pedidos ao modelo; (2) remoção de blocos
// <think>; (3) heurística de saudação (corta tudo antes de "Oi,"/"Olá,"
// etc. se aparecer no meio de um texto longo); (4) se nada disso encontrar
// um corte razoável, devolve o texto já limpo de <think> mesmo assim.
function extrairRespostaFinal(textoBruto) {
  const semThink = textoBruto.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const inicioMarcador = semThink.indexOf(OUTPUT_MARKER_START);
  const fimMarcador = semThink.indexOf(OUTPUT_MARKER_END);
  if (inicioMarcador !== -1 && fimMarcador !== -1 && fimMarcador > inicioMarcador) {
    const extraido = semThink.slice(inicioMarcador + OUTPUT_MARKER_START.length, fimMarcador).trim();
    if (extraido) return extraido;
  }
  const match = SAUDACOES_MENSAGEM.exec(semThink);
  if (match && match.index >= 10) {
    const cortado = semThink.slice(match.index).trim();
    if (cortado) return cortado;
  }
  return semThink;
}

// Chama um provedor (Groq/Gemini/OpenAI — todos falam o mesmo formato
// OpenAI-compatível) para um único modelo. Retorna { ok: true, text } em
// caso de sucesso, ou { ok: false, status, causa, ... } em caso de falha —
// nunca lança para erros HTTP normais.
async function chamarProvider({ provider, model, openaiMessages, maxTokens, timeoutMs }) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(provider.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: openaiMessages,
        max_tokens: maxTokens,
        temperature: 0.7,
        top_p: 0.9,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      return { ok: false, isTimeout: true, causa: `A API da ${provider.nome} não respondeu em ${timeoutMs / 1000}s (timeout) para o modelo ${model}.` };
    }
    return { ok: false, isNetworkError: true, causa: `Falha de rede ao chamar a API da ${provider.nome} (modelo ${model}): ${err.message}` };
  }
  clearTimeout(timeoutId);

  console.log(`[api/generate] tentativa: ${provider.nome}/${model} | status: ${res.status}`);

  const rawText = await res.text();
  let data = null;
  try { data = rawText ? JSON.parse(rawText) : null; } catch { /* resposta não-JSON, tratado abaixo */ }

  if (!res.ok) {
    console.log(`[api/generate] corpo cru da resposta de erro (${provider.nome}/${model}):`, rawText);
    const causa = data?.error?.message || data?.message || rawText?.slice(0, 400) || `HTTP ${res.status}`;
    return { ok: false, status: res.status, causa };
  }

  const text = data?.choices?.[0]?.message?.content;
  if (!text || !text.trim()) {
    return { ok: false, status: res.status, causa: `A API da ${provider.nome} respondeu com sucesso, mas sem conteúdo de texto utilizável.`, isEmptyContent: true };
  }

  const textoLimpo = extrairRespostaFinal(text);
  if (textoLimpo !== text.trim()) {
    console.log(`[api/generate] resposta de ${provider.nome}/${model} continha raciocínio/formatação vazada — texto extraído com sucesso.`);
  }
  const respostaFinal = textoLimpo || text.trim();

  // Rede de segurança contra respostas cortadas pelo limite de tokens — já
  // aconteceu de sobrar só uma palavra solta (ex.: "and") com modelos de
  // raciocínio anteriores. Nunca entregamos isso como mensagem pronta.
  if (respostaFinal.length < 20) {
    console.log(`[api/generate] resposta de ${provider.nome}/${model} descartada por estar suspeita de corte (muito curta): "${respostaFinal}" | finish_reason: ${data?.choices?.[0]?.finish_reason}`);
    return { ok: false, status: 502, causa: `Resposta cortada antes de terminar (${provider.nome}/${model}).`, isTruncated: true };
  }

  return { ok: true, text: respostaFinal };
}

export default async function handler(req, res) {
  const providersDisponiveis = getProvidersDisponiveis();

  if (req.method === "GET") {
    // Status check leve, sem expor chaves — usado pela tela de Configurações.
    return res.status(200).json({
      configured: providersDisponiveis.length > 0,
      providers: providersDisponiveis.map(p => ({ nome: p.nome, model: p.primary })),
      model: providersDisponiveis[0]?.primary || null,
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, GET");
    return res.status(405).json({ error: "Método não permitido." });
  }

  if (providersDisponiveis.length === 0) {
    return res.status(500).json({
      error:
        "Nenhum provedor de IA configurado no servidor. Configure pelo menos uma destas chaves em Project Settings > Environment Variables na Vercel: GROQ_API_KEY (grátis, console.groq.com), GEMINI_API_KEY (grátis, aistudio.google.com) ou OPENAI_API_KEY (paga, platform.openai.com).",
    });
  }

  const body = req.body || {};
  const { system, messages, max_tokens, images } = body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Requisição inválida: 'messages' é obrigatório e não pode estar vazio." });
  }

  // Validação das imagens (se houver) — nunca confiamos no que o navegador
  // manda sem checar: só aceitamos data URLs de imagem, com teto de
  // quantidade e tamanho.
  let imagensValidas = [];
  if (images !== undefined) {
    if (!Array.isArray(images)) {
      return res.status(400).json({ error: "Requisição inválida: 'images' precisa ser uma lista de imagens." });
    }
    if (images.length > MAX_IMAGENS_POR_REQUISICAO) {
      return res.status(400).json({ error: `No máximo ${MAX_IMAGENS_POR_REQUISICAO} fotos por vez. Envie menos fotos e tente novamente.` });
    }
    for (const img of images) {
      if (typeof img !== "string" || !/^data:image\/(png|jpe?g|webp);base64,/i.test(img)) {
        return res.status(400).json({ error: "Uma das fotos enviadas não é uma imagem válida (formatos aceitos: PNG, JPEG, WEBP)." });
      }
      if (img.length > MAX_TAMANHO_IMAGEM_BASE64) {
        return res.status(400).json({ error: "Uma das fotos enviadas é grande demais. Tente uma foto com menor resolução/tamanho de arquivo." });
      }
      imagensValidas.push(img);
    }
  }
  const temImagens = imagensValidas.length > 0;

  const openaiMessages = [];
  const systemContent = system
    ? `${LANGUAGE_INSTRUCTION}\n${OUTPUT_FORMAT_INSTRUCTION}\n${String(system)}`
    : `${LANGUAGE_INSTRUCTION}\n${OUTPUT_FORMAT_INSTRUCTION}`;
  openaiMessages.push({ role: "system", content: systemContent });
  for (const m of messages) {
    if (!m || typeof m.content !== "string") continue;
    openaiMessages.push({ role: m.role === "assistant" ? "assistant" : "user", content: m.content });
  }
  if (openaiMessages.length === 1) {
    return res.status(400).json({ error: "Requisição inválida: nenhuma mensagem com conteúdo de texto foi enviada." });
  }

  if (temImagens) {
    let ultimoUserIdx = -1;
    for (let i = openaiMessages.length - 1; i >= 0; i--) {
      if (openaiMessages[i].role === "user") { ultimoUserIdx = i; break; }
    }
    if (ultimoUserIdx === -1) {
      return res.status(400).json({ error: "Requisição inválida: envie um texto junto com as fotos (o que você quer que a IA faça com elas)." });
    }
    const textoOriginal = openaiMessages[ultimoUserIdx].content;
    openaiMessages[ultimoUserIdx] = {
      role: "user",
      content: [
        { type: "text", text: textoOriginal },
        ...imagensValidas.map(url => ({ type: "image_url", image_url: { url } })),
      ],
    };
  }

  const maxTokens = Number(max_tokens) > 0 ? Math.max(Number(max_tokens), 700) : 800;

  console.log(
    `[api/generate] provedores disponíveis${temImagens ? " (com imagem)" : ""}:`,
    providersDisponiveis.map(p => `${p.nome}[${p.chain.join(",")}]`).join(" -> ")
  );

  const falhas = [];
  const inicio = Date.now();

  for (const provider of providersDisponiveis) {
    // Dentro de cada provedor: pula modelos marcados como indisponíveis
    // recentemente, a menos que TODOS estejam marcados (nesse caso tenta a
    // cadeia inteira mesmo assim — a marcação é só uma otimização).
    const naoMarcados = provider.chain.filter(m => !estaMarcadoIndisponivel(provider.key, m));
    const ordemTentativa = naoMarcados.length > 0 ? naoMarcados : provider.chain;

    let sucessoNesteProvedor = false;

    for (const model of ordemTentativa) {
      const decorrido = Date.now() - inicio;
      const restante = TOTAL_TIMEOUT_BUDGET_MS - decorrido;
      if (restante <= 1000) {
        falhas.push({ provider: provider.nome, model, causa: "orçamento de tempo total esgotado antes de tentar esta combinação" });
        break;
      }
      const timeoutMs = Math.min(PER_ATTEMPT_TIMEOUT_MS, restante);

      const resultado = await chamarProvider({ provider, model, openaiMessages, maxTokens, timeoutMs });

      if (resultado.ok) {
        console.log(`[api/generate] resposta gerada com sucesso: ${provider.nome}/${model}${falhas.length > 0 ? " (após falhas em tentativas anteriores)" : ""}`);
        return res.status(200).json({ content: [{ type: "text", text: resultado.text }] });
      }

      if (isModelUnavailableError(resultado.status, resultado.causa)) {
        marcarIndisponivel(provider.key, model, `HTTP ${resultado.status}: ${resultado.causa}`);
      }
      falhas.push({ provider: provider.nome, model, causa: resultado.isTimeout || resultado.isNetworkError || resultado.isTruncated ? resultado.causa : `HTTP ${resultado.status}: ${resultado.causa}` });
      // Qualquer falha (modelo indisponível, timeout, erro de rede, chave
      // inválida, limite de uso, 5xx) segue para o próximo modelo do MESMO
      // provedor; se a cadeia do provedor acabar, o laço externo passa para
      // o próximo provedor. É intencional: o objetivo deste recurso é
      // resiliência entre provedores gratuitos antes de cair no pago — não
      // faria sentido parar tudo porque o Groq está sem crédito/limite
      // atingido se o Gemini ainda nem foi tentado.
    }
  }

  // Todos os provedores e modelos configurados falharam — erro claro, sem
  // dado fake, listando exatamente o que foi tentado. A causa técnica
  // completa de cada tentativa está nos logs acima.
  console.log("[api/generate] todos os provedores/modelos falharam:", JSON.stringify(falhas));
  return res.status(503).json({
    error:
      "Nenhum provedor de IA respondeu com sucesso (tentamos: " +
      falhas.map(f => `${f.provider}/${f.model}`).join(", ") +
      "). Verifique as chaves configuradas ou tente novamente em instantes.",
  });
}
