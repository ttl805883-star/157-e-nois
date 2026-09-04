// Vercel Serverless Function — /api/places
//
// Proxy seguro para a Google Places API (New), usado pela tela "Pesquisar
// leads" para trazer empresas REAIS (nunca dados sorteados/inventados).
//
// Por que um proxy no servidor: a chave do Google Places é secreta (dá
// acesso à sua cota faturável). Ela nunca deve aparecer no navegador — por
// isso usamos aqui GOOGLE_MAPS_KEY (sem o prefixo VITE_, que exporia a
// chave no bundle do frontend). O front chama /api/places, este arquivo
// chama o Google e devolve só os dados já formatados.
//
// Configure em Project Settings > Environment Variables na Vercel (ou no
// .env local):
//   GOOGLE_MAPS_KEY — chave do Google Cloud com "Places API (New)" ativada
//                      e faturamento habilitado no projeto do Google Cloud.
//
// IMPORTANTE — API usada: esta função usa EXCLUSIVAMENTE a Google Places
// API (New) (places.googleapis.com/v1/places:searchText). Ela NÃO usa em
// nenhum momento a Places API Legacy (maps.googleapis.com/maps/api/place/*,
// textsearch/json, place/details/json).
//
// IMPORTANTE SOBRE OS DADOS: a Places API (New) devolve nome, endereço,
// telefone, site, avaliação e nº de avaliações — dados reais do Google. Ela
// NÃO devolve WhatsApp, Instagram, Facebook, LinkedIn, e-mail, nome do
// responsável ou cargo — esses campos não existem na fonte, então esta
// função sempre os retorna como null. O frontend deve exibir "Não
// informado" para qualquer campo null, nunca inventar um valor.

const SEARCH_TEXT_URL = "https://places.googleapis.com/v1/places:searchText";
const TIMEOUT_MS = 20000;

// Campos pedidos via FieldMask na própria busca de texto — a Places API
// (New) já devolve tudo isso em uma única chamada, sem precisar de uma
// segunda requisição de "Details" por lugar (ao contrário da Legacy).
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.addressComponents",
  "places.internationalPhoneNumber",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.rating",
  "places.userRatingCount",
  "places.location",
  "places.googleMapsUri",
  "places.businessStatus",
  "nextPageToken",
].join(",");

/* ------------------------------------------------------------------ */
/* ESTRATÉGIA DE CONSULTA POR SEGMENTO                                 */
/*                                                                     */
/* Para cada segmento pré-definido da tela "Pesquisar leads", mantemos */
/* algumas variações de texto semanticamente equivalentes (mais        */
/* específica → mais ampla). Isso aumenta a cobertura de empresas reais */
/* sem misturar segmentos diferentes (ex: "Barbearia" nunca usa termos  */
/* de "Salão de Beleza"). Segmentos personalizados (adicionados pelo    */
/* usuário) não têm variações — usamos o texto exatamente como digitado.*/
/* ------------------------------------------------------------------ */
const SEGMENT_QUERY_VARIANTS = {
  "Pet Shop": ["pet shop", "loja de produtos para animais", "pet store"],
  "Banho e Tosa": ["banho e tosa", "pet shop banho e tosa", "estética animal"],
  "Barbearia": ["barbearia", "barbearia masculina", "barber shop"],
  "Salão de Beleza": ["salão de beleza", "salao de beleza", "cabeleireiro"],
  "Clínica de Estética": ["clínica de estética", "estética facial e corporal", "clinica de estetica"],
  "Clínica Médica": ["clínica médica", "clínica de saúde", "consultório médico"],
  "Dentista": ["dentista", "clínica odontológica", "consultório odontológico"],
  "Academia": ["academia", "academia de musculação", "centro de treinamento fitness"],
  "Studio": ["studio", "estúdio de pilates", "studio de dança"],
  "Restaurante": ["restaurante", "restaurante e lanchonete", "casa de comida"],
  "Advocacia": ["escritório de advocacia", "advogado", "advocacia"],
  "Contabilidade": ["escritório de contabilidade", "contador", "contabilidade"],
  "Imobiliária": ["imobiliária", "corretora de imóveis", "administradora de imóveis"],
  "Hotel": ["hotel", "rede de hotéis", "hospedagem"],
  "Pousada": ["pousada", "hospedagem", "chalés e pousadas"],
  "Oficina": ["oficina mecânica", "auto center", "oficina automotiva"],
  "Eventos": ["organização de eventos", "buffet e eventos", "cerimonial de eventos"],
  "Fotografia": ["estúdio de fotografia", "fotógrafo profissional", "fotografia de eventos"],
};

// Constrói a lista de consultas de texto (mais específica → mais ampla)
// para um segmento + localização. Nunca transforma a cidade em uma
// palavra-chave genérica: a cidade/estado sempre entram como localização
// da busca ("<termo> em <cidade>/<estado>"), nunca como o termo em si.
function buildSearchQueries({ segmento, cidade, estado }) {
  const local = estado ? `${cidade}/${estado}` : cidade;

  if (!segmento) {
    // Sem segmento selecionado: busca genérica de empresas na localização,
    // sem inventar um termo de segmento que o usuário não escolheu.
    return [`empresas em ${local}`];
  }

  const variantes = SEGMENT_QUERY_VARIANTS[segmento] || [segmento];
  return variantes.map(termo => `${termo} em ${local}`);
}

// Abaixo do número de leads NOVOS (ainda não vistos) trazidos por uma
// consulta, tentamos a próxima variação mais ampla do mesmo segmento —
// isso é a "busca ampla + busca específica" pedida, com um limite seguro
// de tentativas (nunca consultas infinitas).
const BROADEN_MIN_NEW_LEADS = 3;
// Teto absoluto de chamadas à Google Places API por requisição — protege
// contra custo/tempo descontrolado mesmo com muitos segmentos selecionados.
const MAX_TOTAL_REQUESTS = 12;

function withTimeout() {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return { signal: controller.signal, cancel: () => clearTimeout(id) };
}

async function searchText(query, apiKey, pageToken) {
  const { signal, cancel } = withTimeout();
  let r;
  try {
    r = await fetch(SEARCH_TEXT_URL, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({
        textQuery: query,
        languageCode: "pt-BR",
        regionCode: "BR",
        ...(pageToken ? { pageToken } : {}),
      }),
    });
  } finally {
    cancel();
  }

  const data = await r.json().catch(() => null);

  if (!r.ok) {
    const causa = data?.error?.message
      ? `${data.error.status || r.status}: ${data.error.message}`
      : `HTTP ${r.status}`;
    throw new Error(causa);
  }

  return {
    places: data?.places || [],
    nextPageToken: data?.nextPageToken || null,
  };
}

function extractCityState(addressComponents) {
  if (!Array.isArray(addressComponents)) return { cidade: null, estado: null };
  const cidade =
    addressComponents.find(c => Array.isArray(c.types) && (c.types.includes("administrative_area_level_2") || c.types.includes("locality")))
      ?.longText || null;
  const estado =
    addressComponents.find(c => Array.isArray(c.types) && c.types.includes("administrative_area_level_1"))
      ?.shortText || null;
  return { cidade, estado };
}

function toLead(place, segmento) {
  const { cidade, estado } = extractCityState(place.addressComponents);
  return {
    empresaGoogle: place.displayName?.text || "Não informado",
    telefone: place.nationalPhoneNumber || place.internationalPhoneNumber || null,
    site: place.websiteUri || null,
    endereco: place.formattedAddress || null,
    cidade,
    estado,
    avaliacao: typeof place.rating === "number" ? place.rating : null,
    numAvaliacoes: typeof place.userRatingCount === "number" ? place.userRatingCount : null,
    lat: place.location?.latitude ?? null,
    lng: place.location?.longitude ?? null,
    googleMapsUrl: place.googleMapsUri || null,
    placeId: place.id || null,
    businessStatus: place.businessStatus || null,
    // Conveniência para a UI marcar claramente sem inventar status: só é
    // true quando o próprio Google informou CLOSED_TEMPORARILY.
    fechadoTemporariamente: place.businessStatus === "CLOSED_TEMPORARILY",
    segmento: segmento || null,
    fonte: "Google Places API (New)",
    // Campos que a Places API não fornece — nunca inventados aqui:
    responsavel: null,
    cargo: null,
    whatsapp: null,
    instagram: null,
    facebook: null,
    linkedin: null,
    email: null,
  };
}

/* ------------------------------------------------------------------ */
/* NORMALIZAÇÃO (para deduplicação)                                    */
/* ------------------------------------------------------------------ */
// Remove acentuação, caixa, pontuação e espaços duplicados — usado para
// comparar nomes/endereços de forma tolerante ("Pai e Filho Barbearia" ===
// "PAI E FILHO BARBEARIA").
function normalizeTexto(s) {
  if (!s) return "";
  return s
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Mantém só dígitos e remove zero(s) à esquerda e o código do país (55)
// quando presente, para que "(79) 99999-0000" e "+55 79 999990000"
// normalizem para o mesmo valor.
function normalizeTelefone(s) {
  if (!s) return null;
  let d = String(s).replace(/\D/g, "");
  if (!d) return null;
  d = d.replace(/^0+/, "");
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
  return d || null;
}

// Extrai o domínio (sem "www.") de uma URL de site — usado para detectar a
// mesma empresa cadastrada em dois registros diferentes do Google com o
// mesmo site.
function normalizeDominio(url) {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.replace(/^www\./, "");
  } catch {
    return null;
  }
}

// Conta quantos leads "relevantes" já foram coletados — quando o filtro
// "sem site" está ativo, só contam os leads sem site, porque é isso que o
// usuário pediu para ver até a quantidade escolhida.
function contarRelevantes(seenMap, semSite) {
  if (!semSite) return seenMap.size;
  let c = 0;
  for (const v of seenMap.values()) if (!v.site) c++;
  return c;
}

// Deduplicação secundária: além do place ID (já garantido pelo Map
// principal), remove entradas que compartilham domínio do site, telefone
// normalizado, ou nome+endereço normalizados — cobrindo casos raros em que
// o mesmo negócio aparece com IDs diferentes em consultas diferentes.
function dedupSecundario(leads) {
  const vistoDominio = new Set();
  const vistoTelefone = new Set();
  const vistoNomeEndereco = new Set();
  const resultado = [];

  for (const lead of leads) {
    const dominio = normalizeDominio(lead.site);
    const telefone = normalizeTelefone(lead.telefone);
    const nomeEndereco = `${normalizeTexto(lead.empresaGoogle)}|${normalizeTexto(lead.endereco)}`;

    if (dominio && vistoDominio.has(dominio)) continue;
    if (telefone && vistoTelefone.has(telefone)) continue;
    if (nomeEndereco !== "|" && vistoNomeEndereco.has(nomeEndereco)) continue;

    if (dominio) vistoDominio.add(dominio);
    if (telefone) vistoTelefone.add(telefone);
    vistoNomeEndereco.add(nomeEndereco);
    resultado.push(lead);
  }
  return resultado;
}

// Ordena por relevância real (sem pontuação fictícia exposta ao usuário):
// 1) nome bate fortemente com o segmento pesquisado
// 2) operacional (CLOSED_TEMPORARILY entra depois, CLOSED_PERMANENTLY já
//    foi descartado antes de chegar aqui)
// 3) telefone disponível
// 4) endereço disponível
// 5) avaliação disponível
// 6) mais avaliações
// 7) sem site (só pesa quando o filtro "sem site" está ativo)
function ordenarPorRelevancia(leads, { semSite }) {
  function pontuar(lead) {
    let p = 0;
    const nomeNorm = normalizeTexto(lead.empresaGoogle);
    const segNorm = normalizeTexto(lead.segmento);
    if (segNorm && nomeNorm.includes(segNorm)) p += 50;
    if (lead.businessStatus === "OPERATIONAL" || !lead.businessStatus) p += 30;
    else if (lead.businessStatus === "CLOSED_TEMPORARILY") p += 10;
    if (lead.telefone) p += 15;
    if (lead.endereco) p += 10;
    if (lead.avaliacao != null) p += 8;
    p += Math.min(10, Math.log10((lead.numAvaliacoes || 0) + 1) * 5);
    if (semSite && !lead.site) p += 20;
    return p;
  }
  return leads
    .map((lead, idx) => ({ lead, idx, p: pontuar(lead) }))
    // idx como desempate estável: mantém a ordem de chegada quando a
    // pontuação é igual, em vez de embaralhar os resultados.
    .sort((a, b) => (b.p - a.p) || (a.idx - b.idx))
    .map(x => x.lead);
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    // Status check leve, sem expor a chave — usado pela tela de Configurações
    // para mostrar se a busca real de leads está configurada.
    return res.status(200).json({ configured: Boolean(process.env.GOOGLE_MAPS_KEY) });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, GET");
    return res.status(405).json({ error: "Método não permitido." });
  }

  const apiKey = process.env.GOOGLE_MAPS_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error:
        "GOOGLE_MAPS_KEY não configurada no servidor. No Google Cloud Console, ative a 'Places API (New)', habilite o faturamento do projeto, gere/confirme a chave e adicione a variável GOOGLE_MAPS_KEY em Project Settings > Environment Variables na Vercel (ou no .env local). Sem isso, a busca de leads reais não pode funcionar.",
    });
  }

  const { segmentos, cidade, estado, qtd, semSite } = req.body || {};

  if (!cidade || !String(cidade).trim()) {
    return res.status(400).json({ error: "Informe pelo menos uma cidade para buscar empresas reais." });
  }

  const segmentosLimpos = Array.isArray(segmentos) && segmentos.length ? segmentos : [null];
  // Teto de 60: a Places API (New) entrega até 20 resultados por página e
  // libera no máximo 3 páginas por busca de texto (20 x 3 = 60). Pedir mais
  // que isso não traz resultado extra, só desperdiça chamadas.
  const limite = Math.min(Math.max(Number(qtd) || 12, 1), 60);

  try {
    const seen = new Map();
    let requestsUsed = 0;

    for (const seg of segmentosLimpos) {
      if (contarRelevantes(seen, semSite) >= limite || requestsUsed >= MAX_TOTAL_REQUESTS) break;

      const queries = buildSearchQueries({ segmento: seg, cidade: String(cidade).trim(), estado: estado ? String(estado).trim() : "" });

      for (let i = 0; i < queries.length; i++) {
        if (contarRelevantes(seen, semSite) >= limite || requestsUsed >= MAX_TOTAL_REQUESTS) break;
        const query = queries[i];

        let novosNestaConsulta = 0;
        let pageToken = null;
        let paginas = 0;
        do {
          if (requestsUsed >= MAX_TOTAL_REQUESTS) break;
          // O nextPageToken do Google só fica válido alguns segundos depois de
          // gerado — sem essa espera, a próxima página falha ou vem vazia,
          // cortando resultados sem necessidade.
          if (pageToken) await new Promise(r => setTimeout(r, 2000));

          let places, nextPageToken;
          try {
            ({ places, nextPageToken } = await searchText(query, apiKey, pageToken));
          } finally {
            requestsUsed++;
          }

          for (const p of places) {
            if (contarRelevantes(seen, semSite) >= limite) break;
            // Empresas permanentemente fechadas nunca ocupam uma vaga do
            // limite pedido pelo usuário — não fazem sentido como lead.
            if (p.businessStatus === "CLOSED_PERMANENTLY") continue;
            if (p.id && !seen.has(p.id)) {
              seen.set(p.id, toLead(p, seg));
              novosNestaConsulta++;
            }
          }
          pageToken = nextPageToken;
          paginas++;
        } while (pageToken && contarRelevantes(seen, semSite) < limite && paginas < 3 && requestsUsed < MAX_TOTAL_REQUESTS);

        // Busca ampla + específica: se esta variação trouxe poucos leads
        // novos e ainda há uma variação mais ampla disponível (e orçamento
        // de requisições), tenta a próxima; caso contrário, já cobriu bem
        // este segmento e passa para o próximo.
        const podeAmpliar = i < queries.length - 1 && requestsUsed < MAX_TOTAL_REQUESTS;
        if (novosNestaConsulta >= BROADEN_MIN_NEW_LEADS || !podeAmpliar) break;
      }
    }

    let resultados = Array.from(seen.values());
    // Deduplicação secundária (domínio/telefone/nome+endereço) antes do
    // filtro e do corte final, para nunca contar a mesma empresa duas vezes
    // dentro da quantidade pedida.
    resultados = dedupSecundario(resultados);

    if (semSite) {
      // Filtro real: só mantém quem de fato não tem website cadastrado no Google.
      // Nunca considera Instagram/Facebook/WhatsApp como "site".
      resultados = resultados.filter(lead => !lead.site);
    }

    resultados = ordenarPorRelevancia(resultados, { semSite: Boolean(semSite) });
    resultados = resultados.slice(0, limite);

    return res.status(200).json({ results: resultados });
  } catch (err) {
    // Nunca escondemos que houve um erro (nem inventamos leads no lugar) —
    // mas a mensagem exibida ao usuário fica sempre em português, sem
    // concatenar o texto técnico cru do Google (que vem em inglês). A causa
    // completa continua no log do servidor, na linha acima, para diagnóstico.
    console.error("[api/places] erro ao consultar Google Places API (New):", err.message);
    if (err.name === "AbortError") {
      return res.status(504).json({ error: "A Google Places API não respondeu a tempo (timeout). Tente novamente." });
    }
    return res.status(502).json({ error: "Não foi possível realizar a busca no Google Places. Tente novamente em instantes." });
  }
}
