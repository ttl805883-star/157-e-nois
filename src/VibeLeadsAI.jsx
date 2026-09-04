import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  LayoutDashboard, Search, Users, Map as MapIcon, MessageSquare, Bot, Globe,
  Trello, Star, BarChart3, Settings, Phone, Instagram, Facebook, Copy,
  ExternalLink, ChevronRight, ChevronDown, Menu, X, Plus, Filter, Upload,
  Download, Edit2, Trash2, Check, Clock, Flame, TrendingUp, User, LogOut,
  ArrowLeft, Send, Sparkles, Eye, Save, Rocket, RefreshCw, Building2,
  MapPin, Mail, Calendar, AlertCircle, Loader2, GripVertical, Radar,
  ChevronLeft, Smartphone, Tablet, Monitor, ShoppingCart, ShoppingBag,
  Package, ClipboardList, Image as ImageIcon, Minus, Bell, Store, Layers,
  FileSpreadsheet, CheckCircle2, XCircle, ImagePlus, Tag, ListChecks,
  ChevronUp, CircleDot, Volume2, VolumeX, PackageCheck, PackageX, Truck
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, LineChart, Line
} from "recharts";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { supabase, isSupabaseConfigured, traduzErroAuth } from "./lib/supabaseClient.js";

// Chave client-side do Google Maps Embed API — feita para uso no navegador,
// restrinja por domínio/referrer HTTP no Google Cloud Console. Diferente da
// GOOGLE_MAPS_KEY usada em api/places.js (essa fica só no servidor).
const GOOGLE_MAPS_EMBED_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY || "";

/* ------------------------------------------------------------------ */
/* DESIGN TOKENS                                                       */
/* ------------------------------------------------------------------ */
const T = {
  bg: "#F6F6F2",
  surface: "#FFFFFF",
  surface2: "#EFEEE7",
  ink: "#14171C",
  ink2: "#5B6472",
  ink3: "#8B92A0",
  line: "#E3E2DA",
  accent: "#1F6D4C",
  accentSoft: "#E6F1EB",
  accentDark: "#123F2C",
  warn: "#C2410C",
  warnSoft: "#FBEAE1",
  danger: "#B3261E",
  dangerSoft: "#FBEAE9",
  gold: "#9C6B12",
  goldSoft: "#F7EDDA",
  sidebarBg: "#12161A",
  sidebarInk: "#B7C0C9",
  sidebarInkDim: "#6E7885",
  sidebarActive: "#1F6D4C",
};

const FONT_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap');
`;

/* ------------------------------------------------------------------ */
/* CONSTANTES E HELPERS DE LEAD (sem geração fictícia — busca real via   */
/* Google Places API (New) em api/places.js; leads manuais/CSV entram   */
/* sempre com campos vazios até o usuário preencher)                    */
/* ------------------------------------------------------------------ */
const SEGMENTS = [
  "Pet Shop", "Banho e Tosa", "Barbearia", "Salão de Beleza", "Clínica de Estética",
  "Clínica Médica", "Dentista", "Academia", "Studio", "Restaurante", "Advocacia",
  "Contabilidade", "Imobiliária", "Hotel", "Pousada", "Oficina", "Eventos", "Fotografia"
];
function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }

// Cria um lead vazio/manual — usado por importação de CSV e cadastro manual.
// Nunca preenche campo nenhum com dado sorteado: o que não vier da fonte real
// (a linha do CSV, o formulário) fica null e a UI mostra "Não informado".
function emptyLead(overrides = {}) {
  return {
    id: uid(),
    empresa: "Não informado",
    responsavel: null,
    cargo: null,
    telefone: null,
    whatsapp: null,
    email: null,
    instagram: null,
    facebook: null,
    linkedin: null,
    site: null,
    siteStatus: "Não informado",
    endereco: null,
    cidade: null,
    estado: null,
    avaliacao: null,
    numAvaliacoes: null,
    segmento: "Não informado",
    servicos: [],
    score: 0,
    status: "novo",
    createdAt: Date.now(),
    fonte: "Importação manual",
    dataVerificacao: new Date().toLocaleDateString("pt-BR"),
    historico: [{ tipo: "Lead importado", data: Date.now() }],
    mensagens: [],
    feedbacksIds: [],
    website: null,
    ...overrides,
  };
}

// O Google Places NÃO fornece WhatsApp (só telefone) — por isso, na imensa
// maioria dos leads vindos de busca real, `lead.whatsapp` nunca é
// preenchido, e sem isso os botões de WhatsApp ficavam sempre desabilitados
// ("Sem WhatsApp"), mesmo o lead tendo um telefone real. Para pequenos
// negócios no Brasil, o telefone comercial É, na prática esmagadora dos
// casos, o mesmo número do WhatsApp — então usamos o telefone real (nunca
// inventado, é o dado que o próprio Google devolveu) como alvo para abrir a
// conversa quando não existe um WhatsApp específico cadastrado. Isso não é
// "inventar dado": é usar um dado real já existente para uma ação razoável,
// e a UI sempre deixa claro quando o número usado é o telefone (não um
// WhatsApp confirmado), para o usuário poder corrigir se estiver errado.
function whatsappAlvo(lead) {
  return lead?.whatsapp || lead?.telefone || null;
}
// Verdadeiro quando o número usado para abrir o WhatsApp é uma suposição
// (telefone comercial), não um WhatsApp explicitamente confirmado/cadastrado.
function whatsappEhSuposicao(lead) {
  return !lead?.whatsapp && Boolean(lead?.telefone);
}

// Normaliza um número para uso em um link wa.me: remove tudo que não é
// dígito e garante o código do país (padrão do sistema: Brasil/55) SEM
// quebrar números que já venham em formato internacional. Números
// "curtos" (10-11 dígitos, ou seja, DDD + telefone, sem código de país)
// recebem o 55 na frente. Números já mais longos (12+ dígitos) já têm
// algum código de país embutido — sejam eles 55 ou de outro país — e são
// mantidos como estão. Retorna null quando não sobram dígitos suficientes
// para ser um telefone válido.
function normalizeWhatsNumber(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length < 10) return null;
  if (digits.length <= 11) return `55${digits}`;
  return digits;
}

// Substitui variáveis como {nome}, {empresa}, {cidade} etc. pelos dados
// reais do lead. Nunca inventa dado: quando o campo não existe, a
// variável vira string vazia. {nome} usa o responsável cadastrado e,
// na falta dele, cai para o nome da empresa (evita "Olá , tudo bem?").
function preencherVariaveisMensagem(template, lead) {
  const vars = {
    nome: lead?.responsavel || lead?.empresa || "",
    empresa: lead?.empresa || "",
    cidade: lead?.cidade || "",
    estado: lead?.estado || "",
    segmento: lead?.segmento || "",
    categoria: lead?.segmento || "",
    telefone: lead?.telefone || "",
  };
  return String(template || "").replace(/\{(\w+)\}/g, (m, key) => {
    const k = key.toLowerCase();
    return k in vars ? vars[k] : m;
  });
}

// Extrai e faz o parse de um JSON devolvido pela IA (usado por
// SitesView.gerarSite e AIConfigModal.gerar), tolerando o caso em que o
// modelo deixa texto solto (raciocínio, comentário, cerca ```json) antes ou
// depois do objeto JSON de verdade — não é mascarar erro, é extrair o
// mesmo dado real que o modelo pretendia devolver. Retorna null (nunca
// lança) quando não há nenhum JSON válido para extrair, para o chamador
// decidir a mensagem de erro.
function parseJsonRobusto(raw) {
  const limpo = String(raw || "").replace(/```json|```/gi, "").trim();
  try {
    return JSON.parse(limpo);
  } catch { /* tenta o fallback abaixo */ }
  const inicio = limpo.indexOf("{");
  const fim = limpo.lastIndexOf("}");
  if (inicio !== -1 && fim > inicio) {
    try {
      return JSON.parse(limpo.slice(inicio, fim + 1));
    } catch { /* nenhum JSON válido encontrado */ }
  }
  return null;
}

function classify(score) {
  if (score >= 90) return { label: "Muito alta", icon: "🔥", color: T.danger, bg: T.dangerSoft };
  if (score >= 75) return { label: "Alta", icon: "🟢", color: T.accent, bg: T.accentSoft };
  if (score >= 50) return { label: "Média", icon: "🟡", color: T.gold, bg: T.goldSoft };
  return { label: "Baixa", icon: "🔴", color: T.ink3, bg: T.surface2 };
}

const KANBAN_STAGES = [
  { id: "novo", label: "Novo" },
  { id: "pesquisado", label: "Pesquisado" },
  { id: "mensagem_preparada", label: "Mensagem preparada" },
  { id: "contatado", label: "Contatado" },
  { id: "respondeu", label: "Respondeu" },
  { id: "interessado", label: "Interessado" },
  { id: "reuniao", label: "Reunião" },
  { id: "proposta", label: "Proposta" },
  { id: "negociacao", label: "Negociação" },
  { id: "followup", label: "Follow-up" },
  { id: "cliente", label: "Cliente" },
  { id: "sem_interesse", label: "Sem interesse" },
];

const DEFAULT_OFFER = {
  servicoPrincipal: "Criação de sites e automação com IA",
  servicos: "Landing pages, sites institucionais, automação, treinamento de IA",
  descricao: "Ajudo pequenos negócios a conquistarem presença digital profissional e a automatizarem o atendimento com IA.",
  precoInicial: "",
  diferenciais: "Entrega rápida, suporte direto via WhatsApp, design sob medida",
  tom: "Persuasivo",
};

/* ------------------------------------------------------------------ */
/* LOJA / CATÁLOGO / CARDÁPIO / PEDIDOS — CONSTANTES                   */
/* ------------------------------------------------------------------ */
const TIPOS_SITE = [
  { id: "Landing Page", emoji: "🚀", modelo: "Informativo" },
  { id: "Site Institucional", emoji: "🏢", modelo: "Informativo" },
  { id: "Catálogo", emoji: "🛍️", modelo: "Produtos" },
  { id: "Cardápio Digital", emoji: "📋", modelo: "Pedidos" },
  { id: "Loja/Produtos", emoji: "🛒", modelo: "Produtos" },
  { id: "Serviços + Agendamento", emoji: "📅", modelo: "Agendamento" },
  { id: "Restaurante/Pizzaria", emoji: "🍕", modelo: "Pedidos" },
  { id: "Salão de Beleza", emoji: "💇", modelo: "Agendamento" },
  { id: "Barbearia", emoji: "💈", modelo: "Agendamento" },
  { id: "Pet Shop", emoji: "🐶", modelo: "Produtos + Serviços" },
  { id: "Clínica", emoji: "🏥", modelo: "Agendamento" },
  { id: "Outro", emoji: "✨", modelo: "Produtos + Serviços" },
];

const MODELOS_NEGOCIO = ["Informativo", "Produtos", "Serviços", "Produtos + Serviços", "Pedidos", "Agendamento"];

const BUSINESS_TEMPLATES = {
  "Restaurante/Pizzaria": [["🍕 Pizzas"], ["🥤 Bebidas"], ["🍟 Acompanhamentos"], ["🍰 Sobremesas"]],
  "Cardápio Digital": [["🍽️ Pratos"], ["🥤 Bebidas"], ["🍰 Sobremesas"]],
  "Salão de Beleza": [["💅 Unhas"], ["💇 Cabelo"], ["💄 Maquiagem"], ["✨ Estética"]],
  "Barbearia": [["✂️ Cabelo"], ["🧔 Barba"], ["💈 Combos"]],
  "Pet Shop": [["🐶 Banho"], ["✂️ Tosa"], ["🧴 Higiene"], ["🛍️ Produtos"]],
  "Clínica": [["🩺 Consultas"], ["🧪 Exames"]],
  "Loja/Produtos": [["🛍️ Produtos"]],
  "Catálogo": [["🛍️ Itens"]],
  "Serviços + Agendamento": [["🔧 Serviços"]],
  "Outro": [],
};

// Modelos de negócio que vendem "serviços" (agendamento) por padrão
const SERVICO_POR_PADRAO = new Set(["Agendamento", "Serviços"]);

const STATUS_PEDIDO = [
  { id: "novo", label: "Novo", icon: "🆕", group: "novos" },
  { id: "confirmado", label: "Confirmado", icon: "✅", group: "andamento" },
  { id: "preparo", label: "Em preparação", icon: "👨‍🍳", group: "andamento" },
  { id: "pronto", label: "Pronto", icon: "📦", group: "andamento" },
  { id: "entrega", label: "Saiu para entrega", icon: "🛵", group: "andamento" },
  { id: "concluido", label: "Concluído", icon: "🏁", group: "concluidos" },
  { id: "cancelado", label: "Cancelado", icon: "🚫", group: "cancelados" },
];
const STATUS_MAP = Object.fromEntries(STATUS_PEDIDO.map(s => [s.id, s]));

function brl(n) {
  const v = Number(n);
  if (!isFinite(v)) return "R$ 0,00";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function onlyDigits(s) { return (s || "").replace(/\D/g, ""); }

function waPhoneLink(phone) {
  let d = onlyDigits(phone);
  if (!d) return "";
  if (!d.startsWith("55")) d = "55" + d;
  return d;
}

function defaultLoja(tipoSite) {
  const cats = (BUSINESS_TEMPLATES[tipoSite] || []).map(([nome]) => ({ id: uid(), nome }));
  const meta = TIPOS_SITE.find(t => t.id === tipoSite);
  return {
    tipo: tipoSite || "Landing Page",
    modeloNegocio: meta?.modelo || "Informativo",
    whatsappLoja: "",
    modoEnvio: "link", // "link" | "api"
    pagamentoOnline: false,
    somNotificacao: true,
    categorias: cats,
    itens: [],
    pedidos: [],
    pedidoSeq: 0,
  };
}

function ensureLoja(lead) {
  return lead.loja || defaultLoja(lead.website?.tipo || "Landing Page");
}

function calcItemPrecoUnit(item, selecao) {
  let base = Number(item.preco) || 0;
  (selecao.variacoes || []).forEach(v => { base += Number(v.precoExtra) || 0; });
  let adicionais = 0;
  (selecao.adicionais || []).forEach(a => { adicionais += Number(a.preco) || 0; });
  return { unit: base + adicionais, base, adicionais };
}

function cartTotal(cart) {
  return cart.reduce((acc, c) => acc + c.subtotal, 0);
}

function nextOrderNumber(seq) {
  return "#" + String((seq || 0) + 1).padStart(4, "0");
}

function buildOrderMessage(loja, lead, order) {
  const isAgendamento = order.tipo === "agendamento";
  const linhas = [];
  linhas.push(isAgendamento ? "📅 NOVO AGENDAMENTO" : "🧾 NOVO PEDIDO");
  linhas.push(`Loja: ${lead.empresa}`);
  linhas.push(`Pedido: ${order.numero}`);
  linhas.push(`Cliente: ${order.cliente}`);
  linhas.push(`Telefone: ${order.telefone}`);
  linhas.push("");
  linhas.push(isAgendamento ? "Serviços:" : "Itens:");
  order.itens.forEach(it => {
    const partes = [];
    if (it.variacoes?.length) partes.push(it.variacoes.map(v => v.opcaoNome).join(", "));
    if (it.adicionais?.length) partes.push(...it.adicionais.map(a => `+ ${a.nome}`));
    if (it.profissional) partes.push(`Profissional: ${it.profissional}`);
    if (it.data) partes.push(`Data: ${it.data}`);
    if (it.horario) partes.push(`Horário: ${it.horario}`);
    const extra = partes.length ? ` (${partes.join(" | ")})` : "";
    linhas.push(`${isAgendamento ? "" : it.quantidade + "x "}${it.nome}${extra} — ${brl(it.subtotal)}`);
    if (it.observacao) linhas.push(`  Obs: ${it.observacao}`);
  });
  linhas.push("");
  linhas.push(`Subtotal: ${brl(order.subtotal)}`);
  if (order.modoEntrega) {
    linhas.push(`${order.modoEntrega === "Entrega" ? "Entrega" : "Retirada"}: ${order.modoEntrega === "Entrega" ? (order.endereco || "Endereço informado pelo cliente") : "Retirada no local"}`);
  }
  if (order.observacaoGeral) linhas.push(`Observação: ${order.observacaoGeral}`);
  linhas.push(`TOTAL: ${brl(order.total)}`);
  return linhas.join("\n");
}

function waLink(phoneDigits, text) {
  return `https://wa.me/${phoneDigits}?text=${encodeURIComponent(text)}`;
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = 880; g.gain.value = 0.08;
    o.start(); setTimeout(() => { o.stop(); ctx.close(); }, 180);
  } catch (e) { /* ignore */ }
}

/* ------------------------------------------------------------------ */
/* PERSISTENCE                                                         */
/* ------------------------------------------------------------------ */
const STORAGE_KEY = "vibeleads_state_v1";

// Dados operacionais (leads, feedbacks, buscas salvas etc.) continuam em
// localStorage — mas agora isolados por usuário (userKey = id do Supabase,
// ou o e-mail no modo de demonstração sem Supabase configurado), para que
// duas contas usadas no mesmo navegador nunca vejam os dados uma da outra.
function storageKeyFor(userKey) {
  return userKey ? `${STORAGE_KEY}__${userKey}` : STORAGE_KEY;
}

async function loadState(userKey) {
  try {
    const raw = window.localStorage.getItem(storageKeyFor(userKey));
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
async function saveState(state, userKey) {
  try { window.localStorage.setItem(storageKeyFor(userKey), JSON.stringify(state)); }
  catch (e) { /* best effort */ }
}

// ---- Sincronização de perfil com o Supabase (tabela public.profiles) ----
// Só é usada quando o app está com Supabase configurado (login real).
// Falhas aqui nunca travam o app: os dados continuam disponíveis via
// localStorage, e a sincronização é best-effort.
async function fetchSupabaseProfile(userId) {
  if (!isSupabaseConfigured || !userId) return null;
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw error;
    return data;
  } catch (e) {
    console.warn("Não foi possível carregar o perfil do Supabase:", e.message);
    return null;
  }
}
async function upsertSupabaseProfile(userId, patch) {
  if (!isSupabaseConfigured || !userId) return;
  try {
    const { error } = await supabase.from("profiles").upsert({ id: userId, ...patch });
    if (error) throw error;
  } catch (e) {
    console.warn("Não foi possível salvar o perfil no Supabase:", e.message);
  }
}

/* ------------------------------------------------------------------ */
/* CLAUDE API HELPER                                                   */
/* ------------------------------------------------------------------ */
async function callClaude(userPrompt, systemPrompt, maxTokens = 800) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 35000);
  let resp;
  try {
    resp = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("Tempo limite excedido ao gerar com IA (35s). Tente novamente.");
    }
    throw new Error("Não foi possível conectar ao servidor de IA. Verifique sua conexão e tente novamente.");
  } finally {
    clearTimeout(timeoutId);
  }
  const data = await resp.json().catch(() => null);
  if (!resp.ok) {
    throw new Error(data?.error || `Falha na API de IA (HTTP ${resp.status}).`);
  }
  const text = (data?.content || []).map(b => b.text || "").join("\n").trim();
  if (!text) throw new Error("A IA respondeu, mas sem conteúdo de texto utilizável.");
  return text;
}

/* ------------------------------------------------------------------ */
/* GOOGLE PLACES HELPER (busca real de leads)                          */
/* ------------------------------------------------------------------ */
async function searchRealLeads({ segmentos, cidade, estado, qtd, semSite }) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25000);
  let resp;
  try {
    resp = await fetch("/api/places", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ segmentos, cidade, estado, qtd, semSite }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("Tempo limite excedido ao buscar leads (25s). Tente novamente.");
    }
    throw new Error("Não foi possível conectar ao servidor de busca. Verifique sua conexão e tente novamente.");
  } finally {
    clearTimeout(timeoutId);
  }
  const data = await resp.json().catch(() => null);
  if (!resp.ok) {
    throw new Error(data?.error || `Falha na busca de leads (HTTP ${resp.status}).`);
  }
  return data?.results || [];
}

// Converte um resultado real da Google Places API (vindo de /api/places) no
// formato de lead usado pelo app. Campos que a fonte não fornece ficam null —
// nunca preenchidos com dado inventado (a UI mostra "Não informado").
function placeToLead(p) {
  return {
    id: uid(),
    empresa: p.empresaGoogle || "Não informado",
    responsavel: null,
    cargo: null,
    telefone: p.telefone || null,
    whatsapp: null, // Google Places não fornece WhatsApp — nunca inventar
    email: null,
    instagram: null,
    facebook: null,
    linkedin: null,
    site: p.site || null,
    siteStatus: p.site ? "CONFIRMADO" : "Site não encontrado no Google",
    endereco: p.endereco || null,
    cidade: p.cidade || null,
    estado: p.estado || null,
    lat: p.lat ?? null,
    lng: p.lng ?? null,
    googleMapsUrl: p.googleMapsUrl || null,
    avaliacao: p.avaliacao ?? null,
    numAvaliacoes: p.numAvaliacoes ?? null,
    fechadoTemporariamente: Boolean(p.fechadoTemporariamente),
    segmento: p.segmento || "Não informado",
    servicos: p.segmento ? [p.segmento] : [],
    score: computeLeadScore(p),
    status: "novo",
    createdAt: Date.now(),
    fonte: "Google Places",
    dataVerificacao: new Date().toLocaleDateString("pt-BR"),
    historico: [{ tipo: "Lead encontrado (Google Places)", data: Date.now() }],
    mensagens: [],
    feedbacksIds: [],
    website: null,
  };
}

// Pontuação de oportunidade calculada só a partir de dados reais retornados
// pela busca (sem sortear nada): empresa sem site próprio, com boa avaliação
// e volume de avaliações pesa mais.
function computeLeadScore(p) {
  let score = 0;
  if (!p.site) score += 35;
  if (typeof p.numAvaliacoes === "number") {
    if (p.numAvaliacoes > 50) score += 20;
    else if (p.numAvaliacoes > 20) score += 12;
    else if (p.numAvaliacoes > 0) score += 6;
  }
  if (typeof p.avaliacao === "number" && p.avaliacao >= 4.5) score += 15;
  else if (typeof p.avaliacao === "number" && p.avaliacao >= 4) score += 8;
  if (p.telefone) score += 15;
  return Math.min(100, score);
}

/* ------------------------------------------------------------------ */
/* SMALL UI PRIMITIVES                                                 */
/* ------------------------------------------------------------------ */
function Badge({ children, color, bg }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 600,
      padding: "3px 9px", borderRadius: 999, color: color || T.ink2, background: bg || T.surface2,
      whiteSpace: "nowrap", fontFamily: "Inter, sans-serif"
    }}>{children}</span>
  );
}

function Btn({ children, onClick, variant = "secondary", icon: Icon, style, disabled, type = "button", full }) {
  const base = {
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
    fontFamily: "Inter, sans-serif", fontWeight: 600, fontSize: 13.5, borderRadius: 9,
    padding: "9px 15px", cursor: disabled ? "not-allowed" : "pointer", border: "1px solid transparent",
    transition: "all .15s", opacity: disabled ? 0.55 : 1, width: full ? "100%" : "auto",
  };
  const variants = {
    primary: { background: T.accent, color: "#fff" },
    outline: { background: "transparent", color: T.ink, border: `1px solid ${T.line}` },
    secondary: { background: T.surface2, color: T.ink },
    danger: { background: T.dangerSoft, color: T.danger },
    ghost: { background: "transparent", color: T.ink2 },
    whatsapp: { background: "#1F6D4C", color: "#fff" },
  };
  return (
    <button type={type} disabled={disabled} onClick={onClick} style={{ ...base, ...variants[variant], ...style }}>
      {Icon && <Icon size={15} />}
      {children}
    </button>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: "block", marginBottom: 14 }}>
      <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: T.ink2, marginBottom: 6, fontFamily: "Inter, sans-serif" }}>{label}</span>
      {children}
    </label>
  );
}

const inputStyle = {
  width: "100%", padding: "9px 11px", borderRadius: 8, border: `1px solid ${T.line}`,
  fontSize: 13.5, fontFamily: "Inter, sans-serif", background: "#fff", color: T.ink, outline: "none", boxSizing: "border-box"
};

function Input(props) { return <input {...props} style={{ ...inputStyle, ...(props.style || {}) }} />; }
function Select(props) { return <select {...props} style={{ ...inputStyle, ...(props.style || {}) }} />; }
function TextArea(props) { return <textarea {...props} style={{ ...inputStyle, resize: "vertical", ...(props.style || {}) }} />; }

function Toggle({ checked, onChange, label }) {
  return (
    <div onClick={() => onChange(!checked)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 0", cursor: "pointer" }}>
      <span style={{ fontSize: 13.5, color: T.ink, fontFamily: "Inter, sans-serif" }}>{label}</span>
      <div style={{ width: 38, height: 22, borderRadius: 999, background: checked ? T.accent : T.line, position: "relative", transition: "all .15s", flexShrink: 0 }}>
        <div style={{ width: 18, height: 18, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: checked ? 18 : 2, transition: "all .15s" }} />
      </div>
    </div>
  );
}

function Card({ children, style, onClick }) {
  return (
    <div onClick={onClick} style={{
      background: T.surface, border: `1px solid ${T.line}`, borderRadius: 14, padding: 18,
      cursor: onClick ? "pointer" : "default", ...style
    }}>{children}</div>
  );
}

function Empty({ icon: Icon, title, body, action }) {
  return (
    <div style={{ textAlign: "center", padding: "56px 20px", color: T.ink2 }}>
      <Icon size={30} style={{ opacity: 0.35, marginBottom: 10 }} />
      <div style={{ fontFamily: "Space Grotesk, sans-serif", fontWeight: 600, fontSize: 15, color: T.ink, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 13, marginBottom: 16, maxWidth: 360, marginLeft: "auto", marginRight: "auto" }}>{body}</div>
      {action}
    </div>
  );
}

/* Signature element: radar score gauge */
function ScoreGauge({ score, size = 64 }) {
  const c = classify(score);
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke={T.surface2} strokeWidth={5} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={c.color} strokeWidth={5} fill="none"
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" style={{ transition: "stroke-dashoffset .5s" }} />
      </svg>
      <div style={{
        position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
        flexDirection: "column"
      }}>
        <span style={{ fontFamily: "IBM Plex Mono, monospace", fontWeight: 600, fontSize: size * 0.28, color: T.ink, lineHeight: 1 }}>{score}</span>
      </div>
      {score >= 90 && (
        <div style={{ position: "absolute", top: -2, right: -2, width: 10, height: 10, borderRadius: "50%", background: T.danger, boxShadow: `0 0 0 3px ${T.dangerSoft}` }} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* NAV CONFIG                                                          */
/* ------------------------------------------------------------------ */
const NAV = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "buscar", label: "Pesquisar leads", icon: Search },
  { id: "leads", label: "Meus leads", icon: Users },
  { id: "mapa", label: "Mapa", icon: MapIcon },
  { id: "kanban", label: "Kanban", icon: Trello },
  { id: "feedbacks", label: "Feedbacks", icon: Star },
  { id: "prompts", label: "Prompts", icon: Bot },
  { id: "sites", label: "Criador de sites", icon: Globe },
  { id: "loja", label: "Loja & Pedidos", icon: ShoppingCart },
  { id: "analytics", label: "Estatísticas", icon: BarChart3 },
  { id: "config", label: "Configurações", icon: Settings },
];

/* ==================================================================== */
/* APP                                                                    */
/* ==================================================================== */
export default function VibeLeadsAI() {
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState(null); // {id, nome, email} — id vem do Supabase quando configurado
  const [authView, setAuthView] = useState("login");
  const userKey = session ? (session.id || session.email) : null;
  const [onboardingDone, setOnboardingDone] = useState(false);
  const [profile, setProfile] = useState({ nome: "", email: "", telefone: "", whatsapp: "", empresa: "", instagram: "", site: "", cidade: "", estado: "" });
  const [offer, setOffer] = useState(DEFAULT_OFFER);
  const [leads, setLeads] = useState([]);
  const [feedbacks, setFeedbacks] = useState([]);
  const [savedSearches, setSavedSearches] = useState([]);
  const [view, setView] = useState("dashboard");
  const [activeLeadId, setActiveLeadId] = useState(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(typeof window !== "undefined" ? window.innerWidth < 860 : false);
  const [toast, setToast] = useState(null);

  const containerRef = useRef(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) setIsMobile(entry.contentRect.width < 860);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Carrega a sessão real do Supabase (se configurado) ou, no modo de
  // demonstração, a sessão local salva anteriormente. Em seguida, sempre que
  // a sessão muda (login/logout em qualquer aba), o estado é atualizado.
  useEffect(() => {
    let unsub = () => {};
    (async () => {
      if (isSupabaseConfigured) {
        const { data } = await supabase.auth.getSession();
        const u = data?.session?.user || null;
        if (u) {
          setSession({ id: u.id, nome: u.user_metadata?.nome || u.email.split("@")[0], email: u.email });
        }
        const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
          const su = sess?.user || null;
          setSession(su ? { id: su.id, nome: su.user_metadata?.nome || su.email.split("@")[0], email: su.email } : null);
        });
        unsub = () => sub?.subscription?.unsubscribe();
        setBooting(false);
      } else {
        // Modo de demonstração — sem Supabase configurado — comportamento
        // original preservado: sessão e dados salvos apenas neste navegador.
        const legacy = await loadState(null);
        if (legacy?.session) setSession(legacy.session);
        setBooting(false);
      }
    })();
    return () => unsub();
    // eslint-disable-next-line
  }, []);

  // Carrega os dados operacionais (perfil, leads, feedbacks etc.) assim que
  // sabemos qual usuário está logado — isolados por usuário no localStorage,
  // e complementados pelo perfil salvo no Supabase quando disponível.
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    (async () => {
      let s = await loadState(userKey);
      if (!s) {
        // Compatibilidade com versões anteriores (sem isolamento por usuário):
        // se existirem dados salvos na chave antiga, migra para a chave do usuário atual.
        const legacy = await loadState(null);
        if (legacy) { s = legacy; saveState(legacy, userKey); }
      }
      const remoteProfile = await fetchSupabaseProfile(session.id);
      if (cancelled) return;
      if (remoteProfile) {
        setOnboardingDone(!!remoteProfile.onboarding_done);
        setProfile(p => ({
          ...p,
          nome: remoteProfile.nome || session.nome || "",
          email: remoteProfile.email || session.email || "",
          telefone: remoteProfile.telefone || "",
          whatsapp: remoteProfile.whatsapp || "",
          empresa: remoteProfile.empresa || "",
          instagram: remoteProfile.instagram || "",
          site: remoteProfile.site || "",
          cidade: remoteProfile.cidade || "",
          estado: remoteProfile.estado || "",
        }));
        setOffer(o => ({ ...o, ...(remoteProfile.offer || {}) }));
      } else if (s) {
        setOnboardingDone(!!s.onboardingDone);
        setProfile(s.profile || { nome: session.nome, email: session.email, telefone: "", whatsapp: "", empresa: "", instagram: "", site: "", cidade: "", estado: "" });
        setOffer(s.offer || DEFAULT_OFFER);
      } else {
        setOnboardingDone(false);
        setProfile(p => ({ ...p, nome: session.nome, email: session.email }));
      }
      setLeads(s?.leads || []);
      setFeedbacks(s?.feedbacks || []);
      setSavedSearches(s?.savedSearches || []);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line
  }, [session?.id, session?.email]);

  useEffect(() => {
    if (booting || !session) return;
    saveState({ session, onboardingDone, profile, offer, leads, feedbacks, savedSearches }, userKey);
    // eslint-disable-next-line
  }, [session, onboardingDone, profile, offer, leads, feedbacks, savedSearches, booting]);

  // Sincroniza o perfil/oferta com o Supabase (best-effort, não bloqueia a UI)
  useEffect(() => {
    if (booting || !session?.id || !isSupabaseConfigured) return;
    const t = setTimeout(() => {
      upsertSupabaseProfile(session.id, {
        email: session.email,
        nome: profile.nome,
        telefone: profile.telefone,
        whatsapp: profile.whatsapp,
        empresa: profile.empresa,
        instagram: profile.instagram,
        site: profile.site,
        cidade: profile.cidade,
        estado: profile.estado,
        onboarding_done: onboardingDone,
        offer,
      });
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line
  }, [profile, offer, onboardingDone, booting, session?.id]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const notify = useCallback((msg) => setToast(msg), []);

  const updateLead = useCallback((id, patch, historyEntry) => {
    setLeads(prev => prev.map(l => l.id === id ? {
      ...l, ...patch,
      historico: historyEntry ? [...l.historico, { tipo: historyEntry, data: Date.now() }] : l.historico
    } : l));
  }, []);

  const activeLead = leads.find(l => l.id === activeLeadId) || null;

  const handleLogout = useCallback(async () => {
    if (isSupabaseConfigured) {
      try { await supabase.auth.signOut(); } catch (e) { /* segue o fluxo mesmo se falhar */ }
    }
    setSession(null);
    setLeads([]); setFeedbacks([]); setSavedSearches([]); setOnboardingDone(false);
  }, []);

  if (booting) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 400, fontFamily: "Inter, sans-serif", color: T.ink2 }}>
        <Loader2 size={20} className="spin" style={{ marginRight: 8 }} /> Carregando…
        <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  if (!session) {
    return (
      <div ref={containerRef} style={{ fontFamily: "Inter, sans-serif" }}>
        <style>{FONT_CSS}</style>
        <AuthScreens
          view={authView} setView={setAuthView}
          onLogin={(nome, email, id) => {
            setSession({ id: id || null, nome, email });
            setProfile(p => ({ ...p, nome, email }));
            notify(`Bem-vindo, ${nome.split(" ")[0]}!`);
          }}
        />
      </div>
    );
  }

  if (!onboardingDone) {
    return (
      <div ref={containerRef} style={{ fontFamily: "Inter, sans-serif" }}>
        <style>{FONT_CSS}</style>
        <Onboarding
          onFinish={(answers) => {
            setOffer(o => ({ ...o, ...answers }));
            setOnboardingDone(true);
          }}
        />
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ fontFamily: "Inter, sans-serif", background: T.bg, color: T.ink, minHeight: 500 }}>
      <style>{FONT_CSS}</style>
      <style>{`
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { height: 8px; width: 8px; }
        ::-webkit-scrollbar-thumb { background: ${T.line}; border-radius: 8px; }
      `}</style>

      <div style={{ display: "flex", minHeight: 560 }}>
        {!isMobile && (
          <Sidebar view={view} setView={(v) => { setView(v); setActiveLeadId(null); }} session={session}
            onLogout={handleLogout} />
        )}

        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <TopBar
            isMobile={isMobile}
            onMenu={() => setMobileNavOpen(true)}
            leadsCount={leads.length}
            profile={profile}
            viewLabel={NAV.find(n => n.id === view)?.label}
          />

          <div style={{ padding: isMobile ? "16px 14px 90px" : "24px 28px 40px", flex: 1 }}>
            {view === "dashboard" && <Dashboard leads={leads} setView={setView} setActiveLeadId={setActiveLeadId} profile={profile} />}
            {view === "buscar" && <BuscarLeads onResults={(novos) => {
              setLeads(prev => {
                const existing = new Set(prev.map(l => (l.whatsapp || l.telefone || "") + l.empresa + l.endereco));
                let novosCount = 0, dupCount = 0;
                const toAdd = [];
                novos.forEach(n => {
                  const key = (n.whatsapp || n.telefone || "") + n.empresa + n.endereco;
                  if (existing.has(key)) { dupCount++; } else { toAdd.push(n); novosCount++; existing.add(key); }
                });
                notify(`${novosCount} novos leads · ${dupCount} duplicados ignorados`);
                return [...toAdd, ...prev];
              });
            }} savedSearches={savedSearches} setSavedSearches={setSavedSearches} />}
            {view === "leads" && <LeadsList leads={leads} onOpen={(id) => { setActiveLeadId(id); setView("leadDetail"); }} setLeads={setLeads} notify={notify} offer={offer} profile={profile} updateLead={updateLead} />}
            {view === "leadDetail" && activeLead && (
              <LeadDetail lead={activeLead} offer={offer} profile={profile}
                onBack={() => setView("leads")}
                updateLead={updateLead}
                feedbacks={feedbacks} setFeedbacks={setFeedbacks}
                notify={notify} />
            )}
            {view === "mapa" && <MapaView leads={leads} onOpen={(id) => { setActiveLeadId(id); setView("leadDetail"); }} />}
            {view === "kanban" && <KanbanBoard leads={leads} updateLead={updateLead} onOpen={(id) => { setActiveLeadId(id); setView("leadDetail"); }} />}
            {view === "feedbacks" && <FeedbacksView feedbacks={feedbacks} setFeedbacks={setFeedbacks} leads={leads} />}
            {view === "prompts" && <PromptsView leads={leads} />}
            {view === "sites" && <SitesView leads={leads} updateLead={updateLead} offer={offer} notify={notify} />}
            {view === "loja" && <LojaModule leads={leads} updateLead={updateLead} notify={notify} isMobile={isMobile} />}
            {view === "analytics" && <AnalyticsView leads={leads} />}
            {view === "config" && <ConfigView profile={profile} setProfile={setProfile} offer={offer} setOffer={setOffer} notify={notify} />}
          </div>
        </div>
      </div>

      {isMobile && (
        <BottomNav view={view} setView={(v) => { setView(v); setActiveLeadId(null); }} onMore={() => setMobileNavOpen(true)} />
      )}
      {isMobile && mobileNavOpen && (
        <MobileNavSheet view={view} setView={(v) => { setView(v); setActiveLeadId(null); setMobileNavOpen(false); }} onClose={() => setMobileNavOpen(false)} onLogout={() => { handleLogout(); setMobileNavOpen(false); }} />
      )}

      {toast && (
        <div style={{
          position: "fixed", bottom: isMobile ? 78 : 22, left: "50%", transform: "translateX(-50%)",
          background: T.ink, color: "#fff", padding: "10px 18px", borderRadius: 10, fontSize: 13,
          fontFamily: "Inter, sans-serif", zIndex: 50, boxShadow: "0 8px 24px rgba(0,0,0,.18)", maxWidth: "90%", textAlign: "center"
        }}>{toast}</div>
      )}
    </div>
  );
}

/* ==================================================================== */
/* AUTH                                                                   */
/* ==================================================================== */
function AuthScreens({ view, setView, onLogin }) {
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submitLogin(e) {
    e.preventDefault();
    setError("");
    if (!email || !senha) { setError("Preencha e-mail e senha."); return; }

    if (!isSupabaseConfigured) {
      // Modo de demonstração (sem Supabase configurado): comportamento original.
      onLogin(nome || email.split("@")[0], email, null);
      return;
    }

    setLoading(true);
    try {
      const { data, error: err } = await supabase.auth.signInWithPassword({ email, password: senha });
      if (err) throw err;
      const u = data.user;
      onLogin(u.user_metadata?.nome || nome || email.split("@")[0], u.email, u.id);
    } catch (err) {
      setError(traduzErroAuth(err));
    } finally {
      setLoading(false);
    }
  }

  async function submitRegister(e) {
    e.preventDefault();
    setError("");
    if (!nome || !email || !senha) { setError("Preencha todos os campos."); return; }
    if (senha !== confirmar) { setError("As senhas não coincidem."); return; }
    if (senha.length < 6) { setError("A senha precisa ter pelo menos 6 caracteres."); return; }

    if (!isSupabaseConfigured) {
      onLogin(nome, email, null);
      return;
    }

    setLoading(true);
    try {
      const { data, error: err } = await supabase.auth.signUp({
        email, password: senha,
        options: { data: { nome } },
      });
      if (err) throw err;
      if (data.user && !data.session) {
        // Confirmação de e-mail habilitada no projeto Supabase: ainda não há sessão.
        setError("");
        setSent(true);
        setView("confirm");
      } else if (data.user) {
        onLogin(nome, data.user.email, data.user.id);
      }
    } catch (err) {
      setError(traduzErroAuth(err));
    } finally {
      setLoading(false);
    }
  }

  async function submitForgot() {
    setError("");
    if (!email) { setError("Informe seu e-mail."); return; }
    if (!isSupabaseConfigured) { setSent(true); return; }
    setLoading(true);
    try {
      const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
      });
      if (err) throw err;
      setSent(true);
    } catch (err) {
      setError(traduzErroAuth(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: 560, display: "flex", alignItems: "center", justifyContent: "center", background: T.bg, padding: 20
    }}>
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "center", marginBottom: 26 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: T.accent, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Radar size={19} color="#fff" />
          </div>
          <span style={{ fontFamily: "Space Grotesk, sans-serif", fontWeight: 700, fontSize: 19, color: T.ink }}>Vibe Leads AI</span>
        </div>

        <Card style={{ padding: 26 }}>
          {view === "login" && (
            <form onSubmit={submitLogin}>
              <h2 style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: 19, margin: "0 0 4px" }}>Entre na sua conta</h2>
              <p style={{ fontSize: 13, color: T.ink2, margin: "0 0 20px" }}>Prospecção com IA em um único lugar.</p>
              {!isSupabaseConfigured && (
                <Field label="Nome (opcional)"><Input value={nome} onChange={e => setNome(e.target.value)} placeholder="Seu nome" /></Field>
              )}
              <Field label="E-mail"><Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="voce@empresa.com" /></Field>
              <Field label="Senha"><Input type="password" value={senha} onChange={e => setSenha(e.target.value)} placeholder="••••••••" /></Field>
              {error && <div style={{ color: T.danger, fontSize: 12.5, marginBottom: 10 }}>{error}</div>}
              <Btn variant="primary" type="submit" full disabled={loading} icon={loading ? Loader2 : undefined}>
                {loading ? "Entrando…" : "Entrar"}
              </Btn>
              <div style={{ textAlign: "center", marginTop: 14, fontSize: 12.5 }}>
                <a onClick={() => { setError(""); setSent(false); setView("forgot"); }} style={{ color: T.ink2, cursor: "pointer" }}>Esqueci minha senha</a>
              </div>
              <div style={{ textAlign: "center", marginTop: 8, fontSize: 12.5, color: T.ink2 }}>
                Não possui conta? <a onClick={() => { setError(""); setView("register"); }} style={{ color: T.accent, cursor: "pointer", fontWeight: 600 }}>Criar conta</a>
              </div>
            </form>
          )}
          {view === "register" && (
            <form onSubmit={submitRegister}>
              <h2 style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: 19, margin: "0 0 4px" }}>Criar conta</h2>
              <p style={{ fontSize: 13, color: T.ink2, margin: "0 0 20px" }}>Leva menos de um minuto.</p>
              <Field label="Nome"><Input value={nome} onChange={e => setNome(e.target.value)} placeholder="Seu nome" /></Field>
              <Field label="E-mail"><Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="voce@empresa.com" /></Field>
              <Field label="Senha"><Input type="password" value={senha} onChange={e => setSenha(e.target.value)} placeholder="••••••••" /></Field>
              <Field label="Confirmar senha"><Input type="password" value={confirmar} onChange={e => setConfirmar(e.target.value)} placeholder="••••••••" /></Field>
              {error && <div style={{ color: T.danger, fontSize: 12.5, marginBottom: 10 }}>{error}</div>}
              <Btn variant="primary" type="submit" full disabled={loading}>
                {loading ? "Criando conta…" : "Criar conta"}
              </Btn>
              <div style={{ textAlign: "center", marginTop: 14, fontSize: 12.5, color: T.ink2 }}>
                Já possui conta? <a onClick={() => { setError(""); setView("login"); }} style={{ color: T.accent, cursor: "pointer", fontWeight: 600 }}>Entrar</a>
              </div>
            </form>
          )}
          {view === "forgot" && (
            <div>
              <h2 style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: 19, margin: "0 0 4px" }}>Recuperar senha</h2>
              <p style={{ fontSize: 13, color: T.ink2, margin: "0 0 20px" }}>Informe seu e-mail para receber o link de redefinição.</p>
              {!sent ? (
                <>
                  <Field label="E-mail"><Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="voce@empresa.com" /></Field>
                  {error && <div style={{ color: T.danger, fontSize: 12.5, marginBottom: 10 }}>{error}</div>}
                  <Btn variant="primary" full onClick={submitForgot} disabled={loading}>
                    {loading ? "Enviando…" : "Enviar link"}
                  </Btn>
                </>
              ) : (
                <div style={{ fontSize: 13.5, color: T.ink2 }}>Se este e-mail estiver cadastrado, você receberá um link de redefinição em instantes.</div>
              )}
              <div style={{ textAlign: "center", marginTop: 14, fontSize: 12.5 }}>
                <a onClick={() => setView("login")} style={{ color: T.ink2, cursor: "pointer" }}>← Voltar para login</a>
              </div>
            </div>
          )}
          {view === "confirm" && (
            <div>
              <h2 style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: 19, margin: "0 0 4px" }}>Confirme seu e-mail</h2>
              <p style={{ fontSize: 13.5, color: T.ink2, margin: "0 0 4px" }}>
                Enviamos um link de confirmação para <strong style={{ color: T.ink }}>{email}</strong>. Clique nele para ativar sua conta e depois volte para entrar.
              </p>
              <div style={{ textAlign: "center", marginTop: 18, fontSize: 12.5 }}>
                <a onClick={() => setView("login")} style={{ color: T.accent, cursor: "pointer", fontWeight: 600 }}>← Voltar para login</a>
              </div>
            </div>
          )}
        </Card>
        <p style={{ textAlign: "center", fontSize: 11.5, color: T.ink3, marginTop: 16 }}>
          {isSupabaseConfigured
            ? "Seus dados de login são protegidos pela autenticação do Supabase."
            : "Ambiente de demonstração — autenticação local neste navegador. Configure o Supabase para login real (veja o .env.example)."}
        </p>
      </div>
    </div>
  );
}

/* ==================================================================== */
/* ONBOARDING                                                             */
/* ==================================================================== */
function Onboarding({ onFinish }) {
  const [step, setStep] = useState(0);
  const [a, setA] = useState({
    servicoPrincipal: "", nicho: "", clienteIdeal: "", tipoEmpresa: "",
    localizacao: "", tamanho: "", decisor: "", excluir: ""
  });
  const questions = [
    { key: "servicoPrincipal", q: "O que você vende?", ph: "Ex: sites, automação, IA para atendimento" },
    { key: "nicho", q: "Qual seu nicho?", ph: "Ex: tecnologia, marketing, design" },
    { key: "clienteIdeal", q: "Quem é seu cliente ideal?", ph: "Ex: pequenas empresas locais sem presença digital" },
    { key: "tipoEmpresa", q: "Que tipo de empresa procura?", ph: "Ex: pet shops, clínicas, salões" },
    { key: "localizacao", q: "Qual localização?", ph: "Ex: Aracaju e região" },
    { key: "tamanho", q: "Qual tamanho de empresa?", ph: "Ex: micro e pequenas" },
    { key: "decisor", q: "Quem é o decisor?", ph: "Ex: proprietário(a) ou gerente" },
    { key: "excluir", q: "O que deve ser excluído?", ph: "Ex: empresas que já têm site, grandes redes" },
  ];
  const cur = questions[step];
  const progress = ((step) / questions.length) * 100;

  return (
    <div style={{ minHeight: 560, display: "flex", alignItems: "center", justifyContent: "center", background: T.bg, padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 460 }}>
        <div style={{ height: 4, borderRadius: 4, background: T.line, marginBottom: 24, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${progress}%`, background: T.accent, transition: "width .3s" }} />
        </div>
        <Card style={{ padding: 28 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: T.accent, letterSpacing: 0.4, marginBottom: 8 }}>
            VAMOS CONFIGURAR SUA PROSPECÇÃO · {step + 1}/{questions.length}
          </div>
          <h2 style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: 20, margin: "0 0 18px" }}>{cur.q}</h2>
          <Input
            autoFocus
            value={a[cur.key]}
            onChange={e => setA(prev => ({ ...prev, [cur.key]: e.target.value }))}
            placeholder={cur.ph}
            onKeyDown={e => { if (e.key === "Enter") { step < questions.length - 1 ? setStep(step + 1) : onFinish(a); } }}
          />
          <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
            {step > 0 && <Btn variant="outline" onClick={() => setStep(step - 1)} icon={ArrowLeft}>Voltar</Btn>}
            {step < questions.length - 1 ? (
              <Btn variant="primary" onClick={() => setStep(step + 1)} style={{ flex: 1 }}>Continuar</Btn>
            ) : (
              <Btn variant="primary" onClick={() => onFinish(a)} style={{ flex: 1 }}>Concluir e ir ao dashboard</Btn>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ==================================================================== */
/* SIDEBAR / TOPBAR / MOBILE NAV                                          */
/* ==================================================================== */
function Sidebar({ view, setView, session, onLogout }) {
  return (
    <div style={{ width: 224, background: T.sidebarBg, flexShrink: 0, display: "flex", flexDirection: "column", padding: "18px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "4px 8px 20px" }}>
        <div style={{ width: 28, height: 28, borderRadius: 8, background: T.accent, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Radar size={16} color="#fff" />
        </div>
        <span style={{ fontFamily: "Space Grotesk, sans-serif", fontWeight: 700, fontSize: 15, color: "#fff" }}>Vibe Leads AI</span>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
        {NAV.map(item => {
          const active = view === item.id || (view === "leadDetail" && item.id === "leads");
          const Icon = item.icon;
          return (
            <div key={item.id} onClick={() => setView(item.id)} style={{
              display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 8,
              cursor: "pointer", background: active ? "rgba(31,109,76,0.28)" : "transparent",
              color: active ? "#fff" : T.sidebarInk, fontSize: 13.5, fontWeight: active ? 600 : 500,
              fontFamily: "Inter, sans-serif", transition: "all .12s"
            }}>
              <Icon size={16} style={{ flexShrink: 0 }} />
              {item.label}
            </div>
          );
        })}
      </div>
      <div style={{ borderTop: `1px solid rgba(255,255,255,0.08)`, paddingTop: 12, marginTop: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "6px 8px" }}>
          <div style={{ width: 28, height: 28, borderRadius: "50%", background: T.accentSoft, color: T.accentDark, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
            {session.nome?.[0]?.toUpperCase() || "U"}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ color: "#fff", fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{session.nome}</div>
            <div style={{ color: T.sidebarInkDim, fontSize: 11 }}>{session.email}</div>
          </div>
          <LogOut size={15} color={T.sidebarInkDim} style={{ cursor: "pointer", flexShrink: 0 }} onClick={onLogout} />
        </div>
      </div>
    </div>
  );
}

function TopBar({ isMobile, onMenu, leadsCount, viewLabel, profile }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: isMobile ? "14px 14px" : "16px 28px", borderBottom: `1px solid ${T.line}`, background: T.surface
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {isMobile && <Menu size={20} onClick={onMenu} style={{ cursor: "pointer" }} />}
        <span style={{ fontFamily: "Space Grotesk, sans-serif", fontWeight: 600, fontSize: isMobile ? 15 : 16 }}>{viewLabel}</span>
      </div>
      <Badge bg={T.accentSoft} color={T.accentDark}>{leadsCount} leads</Badge>
    </div>
  );
}

function BottomNav({ view, setView }) {
  const items = NAV.slice(0, 5);
  return (
    <div style={{
      position: "fixed", bottom: 0, left: 0, right: 0, background: T.surface, borderTop: `1px solid ${T.line}`,
      display: "flex", justifyContent: "space-around", padding: "8px 4px", zIndex: 40
    }}>
      {items.map(item => {
        const Icon = item.icon;
        const active = view === item.id || (view === "leadDetail" && item.id === "leads");
        return (
          <div key={item.id} onClick={() => setView(item.id)} style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "4px 8px",
            color: active ? T.accent : T.ink3, cursor: "pointer"
          }}>
            <Icon size={19} />
            <span style={{ fontSize: 10, fontWeight: 600 }}>{item.label.split(" ")[0]}</span>
          </div>
        );
      })}
    </div>
  );
}

function MobileNavSheet({ view, setView, onClose, onLogout }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 60, display: "flex", alignItems: "flex-end" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.sidebarBg, width: "100%", borderRadius: "16px 16px 0 0", padding: 16, maxHeight: "75%", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span style={{ color: "#fff", fontFamily: "Space Grotesk, sans-serif", fontWeight: 600 }}>Menu</span>
          <X size={20} color="#fff" onClick={onClose} style={{ cursor: "pointer" }} />
        </div>
        {NAV.map(item => {
          const Icon = item.icon;
          const active = view === item.id;
          return (
            <div key={item.id} onClick={() => setView(item.id)} style={{
              display: "flex", alignItems: "center", gap: 12, padding: "12px 8px", borderRadius: 8,
              color: active ? "#fff" : T.sidebarInk, background: active ? "rgba(31,109,76,0.28)" : "transparent"
            }}>
              <Icon size={18} /> <span style={{ fontSize: 14.5 }}>{item.label}</span>
            </div>
          );
        })}
        <div style={{ borderTop: "1px solid rgba(255,255,255,.08)", marginTop: 10, paddingTop: 10 }}>
          <div onClick={onLogout} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 8px", color: T.sidebarInk }}>
            <LogOut size={18} /> <span style={{ fontSize: 14.5 }}>Sair</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ==================================================================== */
/* DASHBOARD                                                              */
/* ==================================================================== */
function Dashboard({ leads, setView, setActiveLeadId, profile }) {
  const total = leads.length;
  const novos = leads.filter(l => l.status === "novo").length;
  const contatados = leads.filter(l => ["contatado", "respondeu", "interessado", "reuniao", "proposta", "negociacao", "followup", "cliente"].includes(l.status)).length;
  const responderam = leads.filter(l => ["respondeu", "interessado", "reuniao", "proposta", "negociacao", "followup", "cliente"].includes(l.status)).length;
  const interessados = leads.filter(l => ["interessado", "reuniao", "proposta", "negociacao", "followup", "cliente"].includes(l.status)).length;
  const propostas = leads.filter(l => ["proposta", "negociacao", "cliente"].includes(l.status)).length;
  const clientes = leads.filter(l => l.status === "cliente").length;

  const taxaResposta = contatados ? Math.round((responderam / contatados) * 100) : 0;
  const taxaInteresse = responderam ? Math.round((interessados / responderam) * 100) : 0;
  const taxaConversao = total ? Math.round((clientes / total) * 100) : 0;

  const melhores = [...leads].sort((a, b) => b.score - a.score).slice(0, 4);
  const hoje = new Date().toDateString();
  const followupsHoje = leads.filter(l => l.followup && new Date(l.followup.data).toDateString() === hoje);

  const funil = [
    { name: "Leads", v: total }, { name: "Contatados", v: contatados },
    { name: "Responderam", v: responderam }, { name: "Interessados", v: interessados },
    { name: "Propostas", v: propostas }, { name: "Clientes", v: clientes },
  ];

  const cards = [
    { label: "Total de leads", v: total }, { label: "Novos leads", v: novos },
    { label: "Contatados", v: contatados }, { label: "Responderam", v: responderam },
    { label: "Interessados", v: interessados }, { label: "Propostas", v: propostas },
    { label: "Clientes", v: clientes },
  ];

  return (
    <div>
      <h1 style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: 22, margin: "0 0 4px" }}>
        Bem-vindo, {profile.nome?.split(" ")[0] || "de volta"}
      </h1>
      <p style={{ color: T.ink2, fontSize: 13.5, margin: "0 0 20px" }}>Aqui está o panorama da sua prospecção hoje.</p>

      {total === 0 ? (
        <Empty icon={Radar} title="Nenhum lead ainda" body="Comece pesquisando empresas no seu segmento para ver seu funil ganhar vida aqui."
          action={<Btn variant="primary" icon={Search} onClick={() => setView("buscar")}>Pesquisar leads</Btn>} />
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 10, marginBottom: 22 }}>
            {cards.map(c => (
              <Card key={c.label} style={{ padding: "14px 16px" }}>
                <div style={{ fontSize: 11.5, color: T.ink2, marginBottom: 6, fontWeight: 600 }}>{c.label}</div>
                <div style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: 24, fontWeight: 700 }}>{c.v}</div>
              </Card>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 10, marginBottom: 22 }}>
            <Card style={{ padding: "14px 16px" }}>
              <div style={{ fontSize: 11.5, color: T.ink2, marginBottom: 4, fontWeight: 600 }}>Taxa de resposta</div>
              <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 20, fontWeight: 600, color: T.accent }}>{taxaResposta}%</div>
            </Card>
            <Card style={{ padding: "14px 16px" }}>
              <div style={{ fontSize: 11.5, color: T.ink2, marginBottom: 4, fontWeight: 600 }}>Taxa de interesse</div>
              <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 20, fontWeight: 600, color: T.gold }}>{taxaInteresse}%</div>
            </Card>
            <Card style={{ padding: "14px 16px" }}>
              <div style={{ fontSize: 11.5, color: T.ink2, marginBottom: 4, fontWeight: 600 }}>Taxa de conversão</div>
              <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 20, fontWeight: 600, color: T.warn }}>{taxaConversao}%</div>
            </Card>
          </div>

          <Card style={{ marginBottom: 22 }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12, fontFamily: "Space Grotesk, sans-serif" }}>Funil de conversão</div>
            <div style={{ height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={funil}>
                  <CartesianGrid strokeDasharray="3 3" stroke={T.line} vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: T.ink2 }} axisLine={{ stroke: T.line }} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: T.ink2 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12, border: `1px solid ${T.line}` }} />
                  <Bar dataKey="v" fill={T.accent} radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <div style={{ display: "grid", gridTemplateColumns: window.innerWidth < 860 ? "1fr" : "1.2fr 1fr", gap: 16 }}>
            <Card>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12, fontFamily: "Space Grotesk, sans-serif", display: "flex", alignItems: "center", gap: 6 }}>
                <Flame size={16} color={T.danger} /> Melhores oportunidades
              </div>
              {melhores.map(l => (
                <div key={l.id} onClick={() => { setActiveLeadId(l.id); setView("leadDetail"); }} style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "9px 4px", borderBottom: `1px solid ${T.line}`, cursor: "pointer"
                }}>
                  <ScoreGauge score={l.score} size={38} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.empresa}</div>
                    <div style={{ fontSize: 11.5, color: T.ink2 }}>{l.segmento} · {l.cidade}/{l.estado}</div>
                  </div>
                  <ChevronRight size={15} color={T.ink3} />
                </div>
              ))}
            </Card>
            <Card>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12, fontFamily: "Space Grotesk, sans-serif", display: "flex", alignItems: "center", gap: 6 }}>
                <Clock size={16} color={T.gold} /> Follow-ups de hoje
              </div>
              {followupsHoje.length === 0 ? (
                <div style={{ fontSize: 13, color: T.ink2 }}>Nenhum follow-up agendado para hoje.</div>
              ) : followupsHoje.map(l => (
                <div key={l.id} onClick={() => { setActiveLeadId(l.id); setView("leadDetail"); }} style={{ padding: "8px 4px", borderBottom: `1px solid ${T.line}`, cursor: "pointer" }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{l.empresa}</div>
                  <div style={{ fontSize: 11.5, color: T.ink2 }}>{l.followup?.observacao || "Sem observação"}</div>
                </div>
              ))}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

/* ==================================================================== */
/* BUSCAR LEADS                                                           */
/* ==================================================================== */
function BuscarLeads({ onResults, savedSearches, setSavedSearches }) {
  const [segmentos, setSegmentos] = useState([]);
  const [customSeg, setCustomSeg] = useState("");
  const [cidade, setCidade] = useState("");
  const [estado, setEstado] = useState("");
  const [semSite, setSemSite] = useState(true);
  const [qtd, setQtd] = useState(12);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searchName, setSearchName] = useState("");
  // Guarda os filtros da última tentativa (para o botão "Tentar novamente")
  // e o resultado (contador / aviso de poucos resultados).
  const [lastFilters, setLastFilters] = useState(null);
  const [resultInfo, setResultInfo] = useState(null); // { count, requested }

  function toggleSeg(s) {
    setSegmentos(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  }

  async function runSearch(filters) {
    if (!filters.cidade) {
      setError("Informe pelo menos uma cidade para buscar empresas reais.");
      return;
    }
    setLastFilters(filters);
    setLoading(true);
    setError("");
    setResultInfo(null);
    try {
      const raw = await searchRealLeads({
        segmentos: filters.segmentos,
        cidade: filters.cidade,
        estado: filters.estado,
        qtd: filters.qtd || qtd,
        semSite: filters.semSite,
      });
      onResults(raw.map(placeToLead));
      const requested = filters.qtd || qtd;
      setResultInfo({ count: raw.length, requested });
      if (raw.length === 0) {
        setError("A busca não retornou nenhuma empresa para esses filtros no Google. Tente ampliar a cidade/segmento ou desativar o filtro \"sem site\".");
      }
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }

  function handleSearch() {
    runSearch({ segmentos, cidade, estado, semSite, qtd });
  }

  function handleRetry() {
    if (lastFilters) runSearch(lastFilters);
  }

  function saveSearch() {
    if (!searchName.trim()) return;
    setSavedSearches(prev => [{ id: uid(), nome: searchName, segmentos, cidade, estado, semSite, qtd, data: Date.now() }, ...prev]);
    setSearchName("");
  }

  return (
    <div>
      <h1 style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: 20, margin: "0 0 4px" }}>Encontrar novos leads</h1>
      <p style={{ color: T.ink2, fontSize: 13.5, margin: "0 0 18px" }}>
        Busca real via Google Places — nome, endereço, telefone, site e avaliações vêm direto do Google. Campos que o Google não fornece (WhatsApp, Instagram, e-mail, responsável) ficam em branco para você preencher.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: window.innerWidth < 860 ? "1fr" : "1fr 1fr", gap: 20 }}>
        <Card>
          <div style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 10 }}>Segmento</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
            {SEGMENTS.map(s => (
              <div key={s} onClick={() => toggleSeg(s)} style={{
                padding: "5px 11px", borderRadius: 999, fontSize: 12, cursor: "pointer",
                background: segmentos.includes(s) ? T.accent : T.surface2,
                color: segmentos.includes(s) ? "#fff" : T.ink2, fontWeight: 600
              }}>{s}</div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Input placeholder="Adicionar segmento personalizado" value={customSeg} onChange={e => setCustomSeg(e.target.value)} />
            <Btn variant="outline" onClick={() => { if (customSeg.trim()) { setSegmentos(p => [...p, customSeg.trim()]); setCustomSeg(""); } }}>Adicionar</Btn>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 16 }}>
            <Field label="Cidade *"><Input value={cidade} onChange={e => setCidade(e.target.value)} placeholder="Ex: Aracaju" /></Field>
            <Field label="Estado"><Input value={estado} onChange={e => setEstado(e.target.value)} placeholder="Ex: SE" /></Field>
          </div>
          <Field label={`Quantidade de resultados: ${qtd}`}>
            <input type="range" min="4" max="60" step="1" value={qtd} onChange={e => setQtd(parseInt(e.target.value))} style={{ width: "100%" }} />
          </Field>
        </Card>

        <Card>
          <div style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 6 }}>Filtros de oportunidade</div>
          <Toggle checked={semSite} onChange={setSemSite} label="🔥 Somente empresas sem site cadastrado no Google" />
          <div style={{ fontSize: 11.5, color: T.ink3, marginTop: -4, marginBottom: 8 }}>
            Instagram, Facebook e WhatsApp não vêm do Google Places — não é possível filtrar por eles automaticamente.
          </div>

          <div style={{ height: 1, background: T.line, margin: "14px 0" }} />
          <div style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 8 }}>Salvar esta pesquisa</div>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <Input placeholder="Ex: Pet Shops sem site em Aracaju" value={searchName} onChange={e => setSearchName(e.target.value)} />
            <Btn variant="outline" onClick={saveSearch}>Salvar</Btn>
          </div>

          {savedSearches.length > 0 && (
            <div style={{ marginTop: 10 }}>
              {savedSearches.slice(0, 4).map(s => (
                <div key={s.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 0", borderBottom: `1px solid ${T.line}` }}>
                  <span style={{ fontSize: 12.5 }}>{s.nome}</span>
                  <Btn variant="ghost" icon={RefreshCw} onClick={() => runSearch(s)}>Buscar</Btn>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div style={{ marginTop: 18 }}>
        <Btn variant="primary" icon={loading ? Loader2 : Search} onClick={handleSearch} disabled={loading}>
          {loading ? "Buscando empresas reais…" : "Pesquisar"}
        </Btn>

        {error && (
          <div style={{
            display: "flex", alignItems: "flex-start", gap: 8, marginTop: 12, maxWidth: 560,
            background: T.dangerSoft, border: `1px solid ${T.danger}22`, borderRadius: 10, padding: "10px 12px"
          }}>
            <AlertCircle size={16} color={T.danger} style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ flex: 1 }}>
              <div style={{ color: T.danger, fontSize: 12.5 }}>{error}</div>
              {lastFilters && (
                <Btn variant="outline" icon={RefreshCw} onClick={handleRetry} disabled={loading} style={{ marginTop: 8 }}>
                  Tentar novamente
                </Btn>
              )}
            </div>
          </div>
        )}

        {!error && resultInfo && resultInfo.count > 0 && (
          <div style={{ fontSize: 12.5, color: T.ink2, marginTop: 10 }}>
            {resultInfo.count} {resultInfo.count === 1 ? "empresa real encontrada" : "empresas reais encontradas"} no Google
            {resultInfo.count < resultInfo.requested && (
              <span style={{ color: T.warn }}> — menos do que os {resultInfo.requested} pedidos; o Google não tem mais resultados reais para esses filtros nesta localização.</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ==================================================================== */
/* LEADS LIST                                                             */
/* ==================================================================== */
function LeadCard({ lead, onOpen, selectable, selected, onToggleSelect }) {
  const c = classify(lead.score);
  return (
    <Card onClick={() => selectable ? onToggleSelect(lead.id) : onOpen(lead.id)} style={{ display: "flex", flexDirection: "column", gap: 10, position: "relative", outline: selected ? `2px solid ${T.accent}` : "none" }}>
      {selectable && (
        <div style={{ position: "absolute", top: 10, right: 10 }} onClick={(e) => { e.stopPropagation(); onToggleSelect(lead.id); }}>
          <input type="checkbox" checked={!!selected} onChange={() => onToggleSelect(lead.id)} style={{ width: 17, height: 17, cursor: "pointer" }} />
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <ScoreGauge score={lead.score} size={46} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 14.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", paddingRight: selectable ? 22 : 0 }}>{lead.empresa}</div>
          <div style={{ fontSize: 12, color: T.ink2 }}>{lead.segmento || "Não informado"} · {lead.cidade || "Não informado"}{lead.estado ? `/${lead.estado}` : ""}</div>
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        <Badge color={c.color} bg={c.bg}>{c.icon} {c.label}</Badge>
        {!lead.site && <Badge color={T.warn} bg={T.warnSoft}>Sem site</Badge>}
        {lead.fechadoTemporariamente && <Badge color={T.warn} bg={T.warnSoft}>Fechado temporariamente</Badge>}
        {lead.whatsapp && <Badge color={T.accent} bg={T.accentSoft}>WhatsApp</Badge>}
        {!lead.whatsapp && lead.telefone && <Badge>WhatsApp (tel.)</Badge>}
        <Badge>{KANBAN_STAGES.find(s => s.id === lead.status)?.label}</Badge>
      </div>
      <div style={{ fontSize: 12, color: T.ink2, fontFamily: "IBM Plex Mono, monospace" }}>
        {lead.avaliacao != null ? `★ ${lead.avaliacao} (${lead.numAvaliacoes ?? 0})` : "Avaliação não informada"}
      </div>
    </Card>
  );
}

function LeadsList({ leads, onOpen, setLeads, notify, offer, profile, updateLead }) {
  const [q, setQ] = useState("");
  const [semSiteOnly, setSemSiteOnly] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [waOpen, setWaOpen] = useState(false);
  const fileRef = useRef(null);

  const filtered = leads.filter(l => {
    const ql = q.toLowerCase();
    const matches = !q
      || (l.empresa || "").toLowerCase().includes(ql)
      || (l.segmento || "").toLowerCase().includes(ql)
      || (l.cidade || "").toLowerCase().includes(ql);
    return matches && (!semSiteOnly || !l.site);
  });

  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected(prev => prev.size === filtered.length ? new Set() : new Set(filtered.map(l => l.id)));
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelected(new Set());
  }

  const selectedLeads = filtered.filter(l => selected.has(l.id));

  function exportCSV() {
    const headers = ["Empresa", "Contato", "Cargo", "Telefone", "WhatsApp", "Email", "Instagram", "Site", "Endereço", "Cidade", "Estado", "Segmento", "Pontuação", "Status"];
    const rows = leads.map(l => [l.empresa, l.responsavel, l.cargo, l.telefone, l.whatsapp || "", l.email || "", l.instagram || "", l.site || "", l.endereco, l.cidade, l.estado, l.segmento, l.score, l.status]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "vibe-leads-export.csv"; a.click();
    URL.revokeObjectURL(url);
    notify("Exportação CSV gerada");
  }

  // Mapeia uma linha importada (objeto com as chaves do cabeçalho, exatamente
  // como o exportCSV gera) para um lead. Só usa o que veio na planilha —
  // qualquer coluna ausente ou vazia vira null/"Não informado", nunca inventado.
  function rowToLead(row) {
    const get = (...keys) => {
      for (const k of keys) {
        const found = Object.keys(row).find(rk => rk.trim().toLowerCase() === k.toLowerCase());
        if (found && String(row[found]).trim()) return String(row[found]).trim();
      }
      return null;
    };
    const empresa = get("Empresa", "empresa", "Nome");
    if (!empresa) return null;
    return emptyLead({
      empresa,
      responsavel: get("Contato", "Responsável", "responsavel"),
      cargo: get("Cargo"),
      telefone: get("Telefone"),
      whatsapp: get("WhatsApp"),
      email: get("Email", "E-mail"),
      instagram: get("Instagram"),
      site: get("Site"),
      siteStatus: get("Site") ? "CONFIRMADO" : "Não informado",
      endereco: get("Endereço", "Endereco"),
      cidade: get("Cidade") || "Não informado",
      estado: get("Estado") || "",
      segmento: get("Segmento") || "Não informado",
      servicos: get("Segmento") ? [get("Segmento")] : [],
      fonte: "Importação de planilha",
    });
  }

  function processRows(rows, notifyImport) {
    const existing = new Set(leads.map(l => (l.empresa || "") + (l.endereco || "")));
    let novos = 0, dup = 0, invalid = 0;
    const toAdd = [];
    rows.forEach(row => {
      const lead = rowToLead(row);
      if (!lead) { invalid++; return; }
      const key = (lead.empresa || "") + (lead.endereco || "");
      if (existing.has(key)) { dup++; return; }
      existing.add(key);
      toAdd.push(lead);
      novos++;
    });
    setLeads(prev => [...toAdd, ...prev]);
    notifyImport(`${novos} novos · ${dup} duplicados · ${invalid} inválidos (sem coluna "Empresa")`);
  }

  function handleImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    const isExcel = /\.xlsx?$/i.test(file.name);
    if (isExcel) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const wb = XLSX.read(ev.target.result, { type: "array" });
          const sheet = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
          processRows(rows, notify);
        } catch (err) {
          notify(`Não foi possível ler o arquivo Excel: ${err.message}`);
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (res) => {
          if (res.errors?.length) {
            notify(`Arquivo importado com ${res.errors.length} linha(s) com erro de formatação.`);
          }
          processRows(res.data, notify);
        },
        error: (err) => notify(`Não foi possível ler o CSV: ${err.message}`),
      });
    }
    e.target.value = "";
  }

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h1 style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: 20, margin: 0 }}>Meus leads</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <input type="file" accept=".csv,.xlsx,.xls" ref={fileRef} style={{ display: "none" }} onChange={handleImport} />
          <Btn variant={selectMode ? "primary" : "outline"} icon={ListChecks} onClick={() => selectMode ? exitSelectMode() : setSelectMode(true)}>
            {selectMode ? "Cancelar seleção" : "Selecionar"}
          </Btn>
          <Btn variant="outline" icon={Upload} onClick={() => fileRef.current.click()}>Importar</Btn>
          <Btn variant="outline" icon={Download} onClick={exportCSV}>Exportar</Btn>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <Input placeholder="Buscar por empresa, segmento ou cidade…" value={q} onChange={e => setQ(e.target.value)} style={{ maxWidth: 320 }} />
        <div onClick={() => setSemSiteOnly(!semSiteOnly)} style={{
          display: "flex", alignItems: "center", gap: 6, padding: "9px 13px", borderRadius: 8, cursor: "pointer",
          background: semSiteOnly ? T.warnSoft : T.surface2, color: semSiteOnly ? T.warn : T.ink2, fontSize: 12.5, fontWeight: 600
        }}>
          <Filter size={13} /> Sem site
        </div>
      </div>

      {selectMode && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10,
          background: T.accentSoft, border: `1px solid ${T.accent}33`, borderRadius: 10, padding: "10px 14px", marginBottom: 16
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              <input type="checkbox" checked={filtered.length > 0 && selected.size === filtered.length} onChange={toggleSelectAll} style={{ width: 16, height: 16 }} />
              Selecionar todos
            </label>
            <span style={{ fontSize: 12.5, color: T.ink2 }}>{selected.size} lead(s) selecionado(s)</span>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Btn variant="whatsapp" icon={Send} disabled={selected.size === 0} onClick={() => setWaOpen(true)}>
              Abrir WhatsApps ({selected.size})
            </Btn>
            <Btn variant="primary" icon={Sparkles} disabled={selected.size === 0} onClick={() => setBulkOpen(true)}>
              Gerar mensagens ({selected.size})
            </Btn>
            {selected.size > 0 && (
              <Btn variant="outline" onClick={() => setSelected(new Set())}>Desmarcar todos</Btn>
            )}
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <Empty icon={Users} title="Nenhum lead encontrado" body="Ajuste os filtros ou pesquise novos leads." />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 14 }}>
          {filtered.map(l => (
            <LeadCard key={l.id} lead={l} onOpen={onOpen} selectable={selectMode} selected={selected.has(l.id)} onToggleSelect={toggleSelect} />
          ))}
        </div>
      )}

      {bulkOpen && (
        <BulkMessageModal
          leads={selectedLeads}
          offer={offer}
          profile={profile}
          updateLead={updateLead}
          notify={notify}
          onClose={() => { setBulkOpen(false); }}
        />
      )}

      {waOpen && (
        <OpenWhatsAppsModal
          leads={selectedLeads}
          updateLead={updateLead}
          notify={notify}
          onClose={() => setWaOpen(false)}
        />
      )}
    </div>
  );
}

/* ==================================================================== */
/* MENSAGENS EM LOTE                                                      */
/* ==================================================================== */
function BulkMessageModal({ leads, offer, profile, updateLead, notify, onClose }) {
  // status por lead: idle | gerando | pronto | erro
  const [status, setStatus] = useState(() => Object.fromEntries(leads.map(l => [l.id, { state: "idle", texto: "", erro: "" }])));
  const [gerandoTodos, setGerandoTodos] = useState(false);
  const [tipo, setTipo] = useState("Primeiro contato");
  const [tom, setTom] = useState(offer.tom || "Profissional");
  const [fila, setFila] = useState(null); // null = ainda não confirmou envio; array = fila de envio ativa
  const [enviados, setEnviados] = useState(() => new Set());

  async function gerarUm(lead) {
    setStatus(prev => ({ ...prev, [lead.id]: { ...prev[lead.id], state: "gerando", erro: "" } }));
    const system = "Você escreve mensagens curtas de prospecção via WhatsApp em português do Brasil. Nunca invente dados que não foram fornecidos. Seja natural, humano, sem parecer robótico ou genérico. Não use markdown, apenas texto puro pronto para copiar. Máximo 6 frases.";
    const prompt = `Escreva uma mensagem do tipo "${tipo}" com tom "${tom}".

Quem envia: ${profile.nome || "um profissional"}, oferecendo: ${offer.servicoPrincipal}. Serviços: ${offer.servicos}. Diferenciais: ${offer.diferenciais}. Descrição da oferta: ${offer.descricao}

Empresa (lead): ${lead.empresa}, segmento ${lead.segmento || "não informado"}, cidade ${lead.cidade || "não informada"}${lead.estado ? `/${lead.estado}` : ""}. ${!lead.site ? "Não foi encontrado site próprio da empresa." : ""} ${lead.avaliacao != null ? `Avaliação ${lead.avaliacao} com ${lead.numAvaliacoes ?? 0} avaliações.` : ""}

A mensagem precisa citar o nome real da empresa. Não invente informações sobre a empresa além do que foi passado aqui.`;
    try {
      const text = await callClaude(prompt, system, 900);
      setStatus(prev => ({ ...prev, [lead.id]: { state: "pronto", texto: text, erro: "" } }));
      updateLead(lead.id, { mensagens: [...(lead.mensagens || []), { texto: text, tipo, tom, data: Date.now() }], status: lead.status === "novo" ? "mensagem_preparada" : lead.status });
    } catch (e) {
      setStatus(prev => ({ ...prev, [lead.id]: { state: "erro", texto: "", erro: e.message } }));
    }
  }

  async function gerarTodos() {
    setGerandoTodos(true);
    // sequencial de propósito — evita disparar N chamadas simultâneas à IA
    for (const lead of leads) {
      // eslint-disable-next-line no-await-in-loop
      await gerarUm(lead);
    }
    setGerandoTodos(false);
  }

  function editarTexto(id, texto) {
    setStatus(prev => ({ ...prev, [id]: { ...prev[id], texto } }));
  }

  const prontos = leads.filter(l => status[l.id]?.state === "pronto");
  const comWhats = prontos.filter(l => whatsappAlvo(l));

  function abrirWhatsDoLead(lead) {
    // Chamado sempre dentro de um onClick direto — nunca via setTimeout/loop —
    // porque o navegador bloqueia window.open() que não vem de um clique real.
    const texto = status[lead.id]?.texto || "";
    const alvo = whatsappAlvo(lead);
    const numero = normalizeWhatsNumber(alvo);
    if (!numero) { notify(`${lead.empresa} não tem WhatsApp nem telefone cadastrado — não é possível abrir o envio.`); return; }
    window.open(waLink(numero, texto), "_blank");
    updateLead(lead.id, { status: "contatado" });
    setEnviados(prev => new Set(prev).add(lead.id));
  }

  function iniciarFila() {
    setFila(comWhats.map(l => l.id));
    setEnviados(new Set());
  }

  // Tenta abrir, em um único clique, uma aba do WhatsApp para cada lead
  // pronto de uma vez. Isso NÃO é uma "API de envio em massa": continua
  // sendo o link wa.me, então quem confirma o envio em cada aba é você. A
  // diferença é que todas as tentativas de abertura acontecem juntas, no
  // mesmo clique — não uma de cada vez. Navegadores limitam quantas janelas
  // um site pode abrir de uma vez (normalmente só a primeira passa sem
  // bloqueio); as que forem bloqueadas continuam na fila abaixo, prontas
  // para abrir uma a uma, sem perder o que já foi aberto.
  function abrirTodosDeUmaVez() {
    const alvos = comWhats;
    if (alvos.length === 0) return;
    const idsAbertos = [];
    let bloqueados = 0;
    for (const lead of alvos) {
      const texto = status[lead.id]?.texto || "";
      const alvo = whatsappAlvo(lead);
      const numero = normalizeWhatsNumber(alvo);
      const win = numero ? window.open(waLink(numero, texto), "_blank") : null;
      if (win) {
        idsAbertos.push(lead.id);
      } else {
        bloqueados++;
      }
    }
    setEnviados(prev => {
      const next = new Set(prev);
      idsAbertos.forEach(id => next.add(id));
      return next;
    });
    idsAbertos.forEach(id => updateLead(id, { status: "contatado" }));
    // Mantém na fila os que ficaram bloqueados (a lógica de "próximo" já
    // pula quem está em `enviados`), para que a mesma UI de envio um a um
    // sirva de continuação natural sem exigir recomeçar do zero.
    setFila(alvos.map(l => l.id));
    if (bloqueados > 0) {
      notify(`${idsAbertos.length} conversa(s) aberta(s) no WhatsApp. O navegador bloqueou ${bloqueados} aba(s) — permita pop-ups para este site nas configurações do navegador, ou abra o restante uma por uma abaixo.`);
    } else {
      notify(`${idsAbertos.length} conversa(s) do WhatsApp abertas em novas abas.`);
    }
  }

  const proximoId = fila?.find(id => !enviados.has(id));
  const proximoLead = proximoId ? leads.find(l => l.id === proximoId) : null;

  return (
    <ModalShell title={`Gerar mensagens em lote (${leads.length})`} onClose={onClose} width={640}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
        <Field label="Tipo de mensagem">
          <Select value={tipo} onChange={e => setTipo(e.target.value)}>
            {["Apresentação", "Primeiro contato", "Oferta de landing page", "Oferta de site", "Follow-up", "Última tentativa"].map(t => <option key={t}>{t}</option>)}
          </Select>
        </Field>
        <Field label="Tom">
          <Select value={tom} onChange={e => setTom(e.target.value)}>
            {["Profissional", "Casual", "Direto", "Amigável", "Persuasivo"].map(t => <option key={t}>{t}</option>)}
          </Select>
        </Field>
      </div>

      <Btn variant="primary" icon={gerandoTodos ? Loader2 : Sparkles} disabled={gerandoTodos} onClick={gerarTodos} full>
        {gerandoTodos ? "Gerando mensagens…" : "Gerar mensagem para todos"}
      </Btn>

      <div style={{ marginTop: 14, maxHeight: 360, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
        {leads.map(lead => {
          const s = status[lead.id] || { state: "idle" };
          return (
            <div key={lead.id} style={{ border: `1px solid ${T.line}`, borderRadius: 10, padding: 10, opacity: fila && enviados.has(lead.id) ? 0.55 : 1 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{lead.empresa}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {s.state === "idle" && <Badge>Aguardando</Badge>}
                  {s.state === "gerando" && <Badge color={T.gold} bg={T.goldSoft}>Gerando…</Badge>}
                  {s.state === "pronto" && !enviados.has(lead.id) && <Badge color={T.accent} bg={T.accentSoft}>Pronta</Badge>}
                  {enviados.has(lead.id) && <Badge color={T.accent} bg={T.accentSoft}>✓ WhatsApp aberto</Badge>}
                  {s.state === "erro" && <Badge color={T.danger} bg={T.dangerSoft}>Erro</Badge>}
                  <Btn variant="ghost" icon={RefreshCw} onClick={() => gerarUm(lead)} disabled={s.state === "gerando"}>Regenerar</Btn>
                </div>
              </div>
              {s.state === "erro" && <div style={{ color: T.danger, fontSize: 12, marginTop: 6 }}>{s.erro}</div>}
              {s.texto && (
                <>
                  <TextArea rows={3} value={s.texto} onChange={e => editarTexto(lead.id, e.target.value)} style={{ marginTop: 8, fontSize: 12.5 }} />
                  <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                    <Btn variant="outline" icon={Copy} onClick={() => { navigator.clipboard?.writeText(s.texto); notify("Mensagem copiada"); }}>Copiar</Btn>
                    <Btn variant="whatsapp" icon={Send} disabled={!whatsappAlvo(lead)} onClick={() => abrirWhatsDoLead(lead)}>
                      {!whatsappAlvo(lead) ? "Sem WhatsApp" : whatsappEhSuposicao(lead) ? "Abrir WhatsApp (telefone)" : "Abrir WhatsApp"}
                    </Btn>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ height: 1, background: T.line, margin: "14px 0" }} />

      {!fila ? (
        <>
          <Btn variant="whatsapp" icon={Send} disabled={comWhats.length === 0} onClick={abrirTodosDeUmaVez} full>
            Abrir todos de uma vez no WhatsApp ({comWhats.length})
          </Btn>
          <div style={{ fontSize: 11.5, color: T.ink2, margin: "6px 0 10px" }}>
            Abre uma aba do WhatsApp para cada lead pronto, tudo no mesmo clique. Se o navegador bloquear pop-ups depois da primeira aba (comportamento padrão de segurança do navegador, não do app), permita pop-ups para este site ou continue de onde parou usando a opção abaixo — nada do que já foi aberto se perde. Quando o Google não informa um WhatsApp específico da empresa, usamos o telefone comercial real para abrir a conversa (comum ser o mesmo número) — confira antes de enviar.
          </div>
          <Btn variant="outline" icon={Send} disabled={prontos.length === 0} onClick={iniciarFila} full>
            Enviar um por um ({prontos.length} pronta(s))
          </Btn>
        </>
      ) : proximoLead ? (
        <div style={{ background: T.warnSoft, borderRadius: 10, padding: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>
            {enviados.size} de {fila.length} já abertos
          </div>
          <div style={{ fontSize: 12.5, color: T.ink2, marginBottom: 10 }}>
            Não há integração oficial de WhatsApp Business API configurada, e o navegador só deixa abrir uma conversa por clique — por isso é um clique por lead, mas rápido: a mensagem já vai pronta, você só confirma o envio no WhatsApp.
          </div>
          <Btn variant="whatsapp" icon={Send} onClick={() => abrirWhatsDoLead(proximoLead)} full>
            Abrir WhatsApp de {proximoLead.empresa} ({enviados.size + 1}/{fila.length})
          </Btn>
        </div>
      ) : (
        <div style={{ background: T.accentSoft, borderRadius: 10, padding: 12, textAlign: "center" }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>✓ Todos os {fila.length} abertos no WhatsApp</div>
          <div style={{ fontSize: 12, color: T.ink2, marginTop: 2 }}>Cada conversa precisa ser enviada manualmente na aba correspondente.</div>
        </div>
      )}
    </ModalShell>
  );
}

/* ==================================================================== */
/* ABRIR WHATSAPPS EM MASSA (um clique, sem depender de mensagem gerada  */
/* por IA — usa um template com variáveis preenchido na hora)            */
/* ==================================================================== */
const INTERVALO_OPCOES = [
  { label: "Sem intervalo (0 ms)", value: 0 },
  { label: "500 ms", value: 500 },
  { label: "1 segundo", value: 1000 },
  { label: "2 segundos", value: 2000 },
  { label: "3 segundos", value: 3000 },
];
const LOTE_OPCOES = [10, 20, 30, 50];

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function OpenWhatsAppsModal({ leads, updateLead, notify, onClose }) {
  const [template, setTemplate] = useState("Olá {nome}, tudo bem?");
  const [intervaloMs, setIntervaloMs] = useState(1000);
  const [maxLote, setMaxLote] = useState(20);
  const [fase, setFase] = useState("config"); // config | rodando | concluido
  const [statusPorLead, setStatusPorLead] = useState({}); // id -> "aberto" | "bloqueado"
  const [progresso, setProgresso] = useState({ feito: 0, total: 0 });
  const [loteIndex, setLoteIndex] = useState(0);
  const rodandoRef = useRef(false);

  // Detecta duplicados (mesmo número normalizado) e números inválidos —
  // nenhum dos dois é aberto.
  const analise = useMemo(() => {
    const vistos = new Set();
    const validos = [];
    const invalidos = [];
    const duplicados = [];
    for (const lead of leads) {
      const numero = normalizeWhatsNumber(whatsappAlvo(lead));
      if (!numero) { invalidos.push(lead); continue; }
      if (vistos.has(numero)) { duplicados.push(lead); continue; }
      vistos.add(numero);
      validos.push({ lead, numero });
    }
    return { validos, invalidos, duplicados };
  }, [leads]);

  const lotes = useMemo(() => chunkArray(analise.validos, maxLote), [analise.validos, maxLote]);
  const loteAtual = lotes[loteIndex] || [];
  const bloqueados = analise.validos.filter(it => statusPorLead[it.lead.id] === "bloqueado");

  // Abre uma aba por lead do lote, com um intervalo configurável entre
  // cada abertura. Isso continua sendo o link wa.me — nada é enviado
  // sozinho, o usuário confirma o envio em cada aba. Navegadores podem
  // bloquear janelas abertas fora do clique síncrono original; as
  // bloqueadas ficam listadas para reabrir uma a uma (clique direto,
  // que nunca é bloqueado).
  async function processarLote(itens) {
    if (rodandoRef.current || itens.length === 0) return;
    rodandoRef.current = true;
    setFase("rodando");
    setProgresso({ feito: 0, total: itens.length });
    let bloqueadosCount = 0;
    for (let i = 0; i < itens.length; i++) {
      const item = itens[i];
      if (i > 0 && intervaloMs > 0) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise(res => setTimeout(res, intervaloMs));
      }
      const texto = preencherVariaveisMensagem(template, item.lead);
      const win = window.open(waLink(item.numero, texto), "_blank");
      const aberto = !!win;
      if (!aberto) bloqueadosCount++;
      setStatusPorLead(prev => ({ ...prev, [item.lead.id]: aberto ? "aberto" : "bloqueado" }));
      if (aberto) {
        updateLead(item.lead.id, { status: item.lead.status === "novo" ? "contatado" : item.lead.status }, "WhatsApp aberto (lote)");
      }
      setProgresso(prev => ({ ...prev, feito: prev.feito + 1 }));
    }
    rodandoRef.current = false;
    setFase("concluido");
    if (bloqueadosCount > 0) {
      notify(`${itens.length - bloqueadosCount} de ${itens.length} WhatsApp(s) abertos. O navegador bloqueou ${bloqueadosCount} aba(s) — permita pop-ups para este site, ou abra os bloqueados abaixo um a um.`);
    } else {
      notify(`${itens.length} WhatsApp(s) abertos.`);
    }
  }

  // Reabertura individual: sempre um clique direto do usuário, então
  // nunca é bloqueada pelo navegador.
  function abrirUm(item) {
    const texto = preencherVariaveisMensagem(template, item.lead);
    window.open(waLink(item.numero, texto), "_blank");
    setStatusPorLead(prev => ({ ...prev, [item.lead.id]: "aberto" }));
    updateLead(item.lead.id, { status: item.lead.status === "novo" ? "contatado" : item.lead.status }, "WhatsApp aberto");
  }

  function proximoLote() {
    setLoteIndex(i => i + 1);
    setFase("config");
  }

  return (
    <ModalShell title={`Abrir WhatsApps selecionados (${leads.length})`} onClose={onClose} width={640}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
        <Badge>{leads.length} selecionado(s)</Badge>
        <Badge color={T.accent} bg={T.accentSoft}>{analise.validos.length} número(s) único(s) e válido(s)</Badge>
        {analise.duplicados.length > 0 && <Badge color={T.warn} bg={T.warnSoft}>{analise.duplicados.length} duplicado(s) ignorado(s)</Badge>}
        {analise.invalidos.length > 0 && <Badge color={T.danger} bg={T.dangerSoft}>{analise.invalidos.length} sem WhatsApp/telefone</Badge>}
      </div>

      {fase === "config" && (
        <>
          <Field label="Mensagem — use {nome}, {empresa}, {cidade}, {estado} ou {segmento}">
            <TextArea rows={3} value={template} onChange={e => setTemplate(e.target.value)} />
          </Field>
          {analise.validos[0] && (
            <div style={{ fontSize: 11.5, color: T.ink2, marginTop: -8, marginBottom: 14 }}>
              Prévia com {analise.validos[0].lead.empresa}: "{preencherVariaveisMensagem(template, analise.validos[0].lead)}"
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 6 }}>
            <Field label="Intervalo entre aberturas">
              <Select value={intervaloMs} onChange={e => setIntervaloMs(Number(e.target.value))}>
                {INTERVALO_OPCOES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </Field>
            <Field label="Máximo por lote">
              <Select value={maxLote} onChange={e => { setMaxLote(Number(e.target.value)); setLoteIndex(0); }}>
                {LOTE_OPCOES.map(n => <option key={n} value={n}>{n}</option>)}
              </Select>
            </Field>
          </div>

          {lotes.length > 1 && (
            <div style={{ fontSize: 12, color: T.ink2, marginBottom: 12 }}>
              Serão processados em {lotes.length} lotes de até {maxLote}. Lote {loteIndex + 1} de {lotes.length} ({loteAtual.length} contato(s)).
            </div>
          )}

          <Btn variant="whatsapp" icon={Send} disabled={loteAtual.length === 0} onClick={() => processarLote(loteAtual)} full>
            Abrir WhatsApps ({loteAtual.length})
          </Btn>
          <div style={{ fontSize: 11.5, color: T.ink2, marginTop: 8 }}>
            Cada aba abre já com o número certo e a mensagem preenchida — abrir a conversa não significa que ela foi enviada, você confirma o envio em cada aba.
          </div>
        </>
      )}

      {fase === "rodando" && (
        <div style={{ background: T.surface2, borderRadius: 10, padding: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Abrindo WhatsApps… {progresso.feito} / {progresso.total}</div>
          <div style={{ height: 8, borderRadius: 999, background: T.line, overflow: "hidden", marginBottom: 12 }}>
            <div style={{ height: "100%", width: `${progresso.total ? (progresso.feito / progresso.total) * 100 : 0}%`, background: T.accent, transition: "width .2s" }} />
          </div>
          <div style={{ maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
            {loteAtual.map(item => (
              <div key={item.lead.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12.5 }}>
                <span>{item.lead.empresa}</span>
                {statusPorLead[item.lead.id] === "aberto" && <Badge color={T.accent} bg={T.accentSoft}>aberto</Badge>}
                {statusPorLead[item.lead.id] === "bloqueado" && <Badge color={T.danger} bg={T.dangerSoft}>bloqueado</Badge>}
                {!statusPorLead[item.lead.id] && <Badge>aguardando</Badge>}
              </div>
            ))}
          </div>
        </div>
      )}

      {fase === "concluido" && (
        <div>
          <div style={{ background: T.accentSoft, borderRadius: 10, padding: 12, textAlign: "center", marginBottom: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{progresso.total} processado(s) neste lote</div>
            <div style={{ fontSize: 12, color: T.ink2, marginTop: 2 }}>Abrir a conversa não significa que a mensagem foi enviada — confirme o envio em cada aba do WhatsApp.</div>
          </div>

          {bloqueados.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 6 }}>O navegador bloqueou {bloqueados.length} aba(s) — permita pop-ups para este site ou abra um a um:</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {bloqueados.map(item => (
                  <div key={item.lead.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", border: `1px solid ${T.line}`, borderRadius: 8, padding: "6px 10px" }}>
                    <span style={{ fontSize: 12.5 }}>{item.lead.empresa}</span>
                    <Btn variant="whatsapp" icon={Send} onClick={() => abrirUm(item)}>Abrir</Btn>
                  </div>
                ))}
              </div>
            </div>
          )}

          {loteIndex + 1 < lotes.length ? (
            <Btn variant="primary" icon={ChevronRight} onClick={proximoLote} full>
              Continuar para o próximo lote ({lotes[loteIndex + 1].length} contato(s))
            </Btn>
          ) : (
            <Btn variant="outline" onClick={onClose} full>Fechar</Btn>
          )}
        </div>
      )}

      {analise.invalidos.length > 0 && fase === "config" && (
        <div style={{ marginTop: 14, fontSize: 11.5, color: T.ink2 }}>
          Ignorados por falta de telefone/WhatsApp: {analise.invalidos.map(l => l.empresa).join(", ")}
        </div>
      )}
    </ModalShell>
  );
}

/* ==================================================================== */
/* LEAD DETAIL                                                            */
/* ==================================================================== */
function LeadDetail({ lead, offer, profile, onBack, updateLead, feedbacks, setFeedbacks, notify }) {
  const [tab, setTab] = useState("resumo");
  const c = classify(lead.score);
  const tabs = [
    { id: "resumo", label: "Resumo" }, { id: "contato", label: "Contato" }, { id: "mapa", label: "Mapa" },
    { id: "mensagens", label: "Mensagens" }, { id: "historico", label: "Histórico" },
    { id: "feedbacks", label: "Feedbacks" }, { id: "prompts", label: "Prompts" }, { id: "site", label: "Site" },
  ];

  return (
    <div>
      <Btn variant="ghost" icon={ArrowLeft} onClick={onBack} style={{ marginBottom: 12, padding: "6px 4px" }}>Voltar</Btn>

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <ScoreGauge score={lead.score} size={64} />
          <div style={{ flex: 1, minWidth: 200 }}>
            <h1 style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: 20, margin: "0 0 6px" }}>{lead.empresa}</h1>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              <Badge color={c.color} bg={c.bg}>{c.icon} Oportunidade {c.label}</Badge>
              <Badge>{KANBAN_STAGES.find(s => s.id === lead.status)?.label}</Badge>
              <Badge>{lead.segmento}</Badge>
            </div>
          </div>
          <Select value={lead.status} onChange={e => updateLead(lead.id, { status: e.target.value }, `Status alterado para ${KANBAN_STAGES.find(s => s.id === e.target.value)?.label}`)} style={{ width: 200 }}>
            {KANBAN_STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </Select>
        </div>
      </Card>

      <div style={{ display: "flex", gap: 4, overflowX: "auto", marginBottom: 16, borderBottom: `1px solid ${T.line}` }}>
        {tabs.map(t => (
          <div key={t.id} onClick={() => setTab(t.id)} style={{
            padding: "9px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
            color: tab === t.id ? T.accent : T.ink2, borderBottom: tab === t.id ? `2px solid ${T.accent}` : "2px solid transparent"
          }}>{t.label}</div>
        ))}
      </div>

      {tab === "resumo" && (
        <Card>
          <Row label="Empresa" value={lead.empresa} />
          <Row label="Segmento" value={lead.segmento || "Não informado"} />
          <Row label="Serviços" value={(lead.servicos || []).join(", ") || "Não informado"} />
          <Row label="Avaliação" value={lead.avaliacao != null ? `★ ${lead.avaliacao} (${lead.numAvaliacoes ?? 0} avaliações)` : "Não informado"} />
          <Row label="Site" value={lead.site || lead.siteStatus || "Não informado"} />
          <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 8 }}>Fonte: {lead.fonte || "Não informado"} · Verificado em {lead.dataVerificacao || "Não informado"}</div>
        </Card>
      )}

      {tab === "contato" && (
        <Card>
          <Row label="Responsável" value={lead.responsavel ? `${lead.responsavel}${lead.cargo ? ` (${lead.cargo})` : ""}` : "Não informado"} />
          <Row label="Telefone" value={lead.telefone || "Não informado"} />
          <Row label="WhatsApp" value={lead.whatsapp || (lead.telefone ? `${lead.telefone} (telefone — não confirmado como WhatsApp)` : "Não informado")} />
          <Row label="E-mail" value={lead.email || "Não informado"} />
          <Row label="Instagram" value={lead.instagram || "Não informado"} />
          <Row label="Site" value={lead.site || "Site próprio não encontrado"} />
          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            {normalizeWhatsNumber(whatsappAlvo(lead)) && <Btn variant="whatsapp" icon={MessageSquare} onClick={() => window.open(waLink(normalizeWhatsNumber(whatsappAlvo(lead)), ""), "_blank")}>{whatsappEhSuposicao(lead) ? "WhatsApp (telefone)" : "WhatsApp"}</Btn>}
            {lead.telefone && <Btn variant="outline" icon={Phone} onClick={() => window.open(`tel:${lead.telefone.replace(/\D/g, "")}`)}>Ligar</Btn>}
            {lead.instagram && <Btn variant="outline" icon={Instagram} onClick={() => window.open(`https://instagram.com/${lead.instagram.replace("@", "")}`, "_blank")}>Instagram</Btn>}
            {lead.site && <Btn variant="outline" icon={Globe} onClick={() => window.open(lead.site.startsWith("http") ? lead.site : `https://${lead.site}`, "_blank")}>Site</Btn>}
          </div>
        </Card>
      )}

      {tab === "mapa" && <MapaTab lead={lead} />}
      {tab === "mensagens" && <MensagensTab lead={lead} offer={offer} profile={profile} updateLead={updateLead} notify={notify} />}
      {tab === "historico" && (
        <Card>
          {(lead.historico || []).slice().reverse().map((h, i) => (
            <div key={i} style={{ display: "flex", gap: 10, padding: "9px 0", borderBottom: `1px solid ${T.line}` }}>
              <Clock size={14} color={T.ink3} style={{ marginTop: 2 }} />
              <div>
                <div style={{ fontSize: 13 }}>{h.tipo}</div>
                <div style={{ fontSize: 11, color: T.ink3 }}>{new Date(h.data).toLocaleString("pt-BR")}</div>
              </div>
            </div>
          ))}
        </Card>
      )}
      {tab === "feedbacks" && <LeadFeedbacksTab lead={lead} feedbacks={feedbacks} setFeedbacks={setFeedbacks} />}
      {tab === "prompts" && <PromptGenerator lead={lead} />}
      {tab === "site" && (
        <Card>
          <div style={{ marginBottom: 10 }}>
            <Badge bg={lead.website ? T.accentSoft : T.surface2} color={lead.website ? T.accent : T.ink2}>
              {lead.website ? (lead.website.publicado ? "Publicado" : "Site em produção") : "Nenhum site criado"}
            </Badge>
          </div>
          <p style={{ fontSize: 13, color: T.ink2 }}>Use o Criador de Sites para gerar uma landing page com IA para este lead.</p>
        </Card>
      )}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${T.line}`, gap: 12 }}>
      <span style={{ fontSize: 12.5, color: T.ink2, fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 13, textAlign: "right" }}>{value}</span>
    </div>
  );
}

function MapaTab({ lead }) {
  const enderecoTexto = [lead.endereco, lead.cidade, lead.estado].filter(Boolean).join(", ") || lead.empresa;
  const query = encodeURIComponent(enderecoTexto);
  const embedSrc = GOOGLE_MAPS_EMBED_KEY
    ? `https://www.google.com/maps/embed/v1/place?key=${GOOGLE_MAPS_EMBED_KEY}&q=${lead.lat && lead.lng ? `${lead.lat},${lead.lng}` : query}`
    : null;
  return (
    <Card>
      {embedSrc ? (
        <div style={{ borderRadius: 10, overflow: "hidden", marginBottom: 12 }}>
          <iframe title="Mapa do lead" width="100%" height="180" style={{ border: 0, display: "block" }} loading="lazy" referrerPolicy="no-referrer-when-downgrade" src={embedSrc} />
        </div>
      ) : (
        <div style={{
          height: 160, background: T.surface2, borderRadius: 10, display: "flex", alignItems: "center",
          justifyContent: "center", flexDirection: "column", gap: 6, marginBottom: 12, border: `1px dashed ${T.line}`
        }}>
          <MapPin size={22} color={T.ink3} />
          <span style={{ fontSize: 11.5, color: T.ink3, textAlign: "center", maxWidth: 280 }}>
            Mapa incorporado requer VITE_GOOGLE_MAPS_KEY configurada (veja Configurações → Integrações)
          </span>
        </div>
      )}
      <Row label="Endereço" value={lead.endereco || "Não informado"} />
      <Row label="Cidade/Estado" value={lead.cidade ? `${lead.cidade}${lead.estado ? `/${lead.estado}` : ""}` : "Não informado"} />
      <Btn variant="outline" icon={ExternalLink} style={{ marginTop: 10 }} onClick={() => window.open(lead.googleMapsUrl || `https://www.google.com/maps/search/?api=1&query=${query}`, "_blank")}>
        Abrir no Google Maps
      </Btn>
    </Card>
  );
}

/* ---- Mensagens tab (real AI) ---- */
function MensagensTab({ lead, offer, profile, updateLead, notify }) {
  const [tipo, setTipo] = useState("Primeiro contato");
  const [tom, setTom] = useState(offer.tom || "Profissional");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(lead.mensagens?.[lead.mensagens.length - 1]?.texto || "");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");

  const tipos = ["Apresentação", "Primeiro contato", "Oferta de landing page", "Oferta de site", "Oferta de automação", "Oferta de IA", "Follow-up", "Segundo contato", "Última tentativa"];
  const tons = ["Profissional", "Casual", "Direto", "Amigável", "Persuasivo"];

  async function gerar() {
    setLoading(true); setError("");
    const system = "Você escreve mensagens curtas de prospecção via WhatsApp em português do Brasil. Nunca invente dados que não foram fornecidos. Seja natural, humano, sem parecer robótico ou genérico. Não use markdown, apenas texto puro pronto para copiar. Máximo 6 frases.";
    const prompt = `Escreva uma mensagem do tipo "${tipo}" com tom "${tom}".

Quem envia: ${profile.nome || "um profissional"}, oferecendo: ${offer.servicoPrincipal}. Serviços: ${offer.servicos}. Diferenciais: ${offer.diferenciais}. Descrição da oferta: ${offer.descricao}

Empresa (lead): ${lead.empresa}, segmento ${lead.segmento || "não informado"}, cidade ${lead.cidade || "não informada"}${lead.estado ? `/${lead.estado}` : ""}. ${!lead.site ? "Não foi encontrado site próprio da empresa." : ""} ${lead.avaliacao != null ? `Avaliação ${lead.avaliacao} com ${lead.numAvaliacoes ?? 0} avaliações.` : ""}

A mensagem precisa citar o nome real da empresa. Não invente informações sobre a empresa além do que foi passado aqui.`;
    try {
      const text = await callClaude(prompt, system, 900);
      setMsg(text);
      updateLead(lead.id, { mensagens: [...(lead.mensagens || []), { texto: text, tipo, tom, data: Date.now() }], status: lead.status === "novo" ? "mensagem_preparada" : lead.status }, "Mensagem gerada");
    } catch (e) {
      setError(e.message || "Não foi possível gerar a mensagem agora.");
    }
    setLoading(false);
  }

  function copiar() {
    navigator.clipboard?.writeText(msg);
    updateLead(lead.id, {}, "Mensagem copiada");
    notify("Mensagem copiada");
  }

  function abrirWhats() {
    const alvo = whatsappAlvo(lead);
    const numero = normalizeWhatsNumber(alvo);
    if (!numero) { notify("Este lead não possui WhatsApp nem telefone cadastrado"); return; }
    window.open(waLink(numero, msg), "_blank");
    updateLead(lead.id, { status: "contatado" }, "WhatsApp aberto");
    notify("WhatsApp aberto com a mensagem preenchida");
  }

  return (
    <Card>
      <div style={{ display: "grid", gridTemplateColumns: window.innerWidth < 860 ? "1fr" : "1fr 1fr", gap: 10, marginBottom: 12 }}>
        <Field label="Tipo de mensagem">
          <Select value={tipo} onChange={e => setTipo(e.target.value)}>
            {tipos.map(t => <option key={t}>{t}</option>)}
          </Select>
        </Field>
        <Field label="Tom">
          <Select value={tom} onChange={e => setTom(e.target.value)}>
            {tons.map(t => <option key={t}>{t}</option>)}
          </Select>
        </Field>
      </div>

      <Btn variant="primary" icon={loading ? Loader2 : Sparkles} onClick={gerar} disabled={loading}>
        {loading ? "Gerando…" : msg ? "Gerar novamente" : "Gerar mensagem"}
      </Btn>
      {error && <div style={{ color: T.danger, fontSize: 12.5, marginTop: 8 }}>{error}</div>}

      {msg && (
        <div style={{ marginTop: 16 }}>
          {editing ? (
            <TextArea rows={6} value={msg} onChange={e => setMsg(e.target.value)} />
          ) : (
            <div style={{ background: T.surface2, borderRadius: 10, padding: 14, fontSize: 13.5, whiteSpace: "pre-wrap", lineHeight: 1.55 }}>{msg}</div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <Btn variant="outline" icon={Copy} onClick={copiar}>Copiar</Btn>
            <Btn variant="whatsapp" icon={Send} onClick={abrirWhats}>Abrir WhatsApp</Btn>
            <Btn variant="outline" icon={Edit2} onClick={() => setEditing(!editing)}>{editing ? "Concluir edição" : "Editar"}</Btn>
          </div>
        </div>
      )}
    </Card>
  );
}

function LeadFeedbacksTab({ lead, feedbacks, setFeedbacks }) {
  const leadFeedbacks = feedbacks.filter(f => f.leadId === lead.id);
  const [showForm, setShowForm] = useState(false);
  return (
    <Card>
      <Btn variant="outline" icon={Plus} onClick={() => setShowForm(!showForm)} style={{ marginBottom: 12 }}>Adicionar feedback</Btn>
      {showForm && <FeedbackForm leadId={lead.id} leadNome={lead.empresa} onSave={(fb) => { setFeedbacks(prev => [fb, ...prev]); setShowForm(false); }} />}
      {leadFeedbacks.length === 0 ? (
        <div style={{ fontSize: 13, color: T.ink2 }}>Nenhum feedback registrado para este lead ainda.</div>
      ) : leadFeedbacks.map(fb => <FeedbackItem key={fb.id} fb={fb} onDelete={() => setFeedbacks(prev => prev.filter(x => x.id !== fb.id))} />)}
    </Card>
  );
}

/* ==================================================================== */
/* MAPA VIEW (list based, no external API required)                       */
/* ==================================================================== */
function MapaView({ leads, onOpen }) {
  const [filtro, setFiltro] = useState("todos");
  const [selecionado, setSelecionado] = useState(null);
  const filtered = leads.filter(l => {
    if (filtro === "semsite") return !l.site;
    if (filtro === "alta") return l.score >= 75;
    return true;
  });

  function enderecoTexto(l) {
    return [l.endereco, l.cidade, l.estado].filter(Boolean).join(", ") || l.empresa;
  }

  return (
    <div>
      <h1 style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: 20, margin: "0 0 4px" }}>Mapa</h1>
      <p style={{ color: T.ink2, fontSize: 13.5, margin: "0 0 16px" }}>
        {GOOGLE_MAPS_EMBED_KEY
          ? "Clique em uma empresa para ver o mapa incorporado."
          : "Mapa incorporado indisponível: configure VITE_GOOGLE_MAPS_KEY (Google Maps Embed API) para habilitá-lo. Por enquanto, use o link para abrir no Google Maps."}
      </p>

      {GOOGLE_MAPS_EMBED_KEY && selecionado && (
        <Card style={{ padding: 0, overflow: "hidden", marginBottom: 16 }}>
          <iframe
            title="Mapa"
            width="100%"
            height="280"
            style={{ border: 0, display: "block" }}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            src={`https://www.google.com/maps/embed/v1/place?key=${GOOGLE_MAPS_EMBED_KEY}&q=${encodeURIComponent(
              selecionado.lat && selecionado.lng ? `${selecionado.lat},${selecionado.lng}` : enderecoTexto(selecionado)
            )}`}
          />
        </Card>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {[["todos", "Todos"], ["semsite", "Sem site"], ["alta", "Alta oportunidade"]].map(([id, label]) => (
          <div key={id} onClick={() => setFiltro(id)} style={{
            padding: "6px 13px", borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
            background: filtro === id ? T.accent : T.surface2, color: filtro === id ? "#fff" : T.ink2
          }}>{label}</div>
        ))}
      </div>
      {filtered.length === 0 ? <Empty icon={MapIcon} title="Nenhuma empresa para exibir" body="Pesquise leads para vê-los aqui." /> : (
        <div style={{ display: "grid", gap: 10 }}>
          {filtered.map(l => (
            <Card key={l.id} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <MapPin size={18} color={T.accent} style={{ flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0, cursor: GOOGLE_MAPS_EMBED_KEY ? "pointer" : "default" }} onClick={() => GOOGLE_MAPS_EMBED_KEY ? setSelecionado(l) : onOpen(l.id)}>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>{l.empresa}</div>
                <div style={{ fontSize: 12, color: T.ink2 }}>{enderecoTexto(l)}</div>
              </div>
              <Badge color={classify(l.score).color} bg={classify(l.score).bg}>{l.score}</Badge>
              <ExternalLink size={15} color={T.ink3} style={{ cursor: "pointer" }}
                onClick={() => window.open(l.googleMapsUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(enderecoTexto(l))}`, "_blank")} />
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/* ==================================================================== */
/* KANBAN                                                                 */
/* ==================================================================== */
function KanbanBoard({ leads, updateLead, onOpen }) {
  const [dragId, setDragId] = useState(null);

  function onDrop(stageId) {
    if (dragId) updateLead(dragId, { status: stageId }, `Movido para ${KANBAN_STAGES.find(s => s.id === stageId)?.label}`);
    setDragId(null);
  }

  return (
    <div>
      <h1 style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: 20, margin: "0 0 14px" }}>Kanban</h1>
      <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 10 }}>
        {KANBAN_STAGES.map(stage => {
          const stageLeads = leads.filter(l => l.status === stage.id);
          return (
            <div key={stage.id}
              onDragOver={e => e.preventDefault()}
              onDrop={() => onDrop(stage.id)}
              style={{ minWidth: 220, width: 220, flexShrink: 0, background: T.surface2, borderRadius: 12, padding: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, padding: "0 4px" }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: T.ink }}>{stage.label}</span>
                <Badge>{stageLeads.length}</Badge>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 40 }}>
                {stageLeads.map(l => (
                  <div key={l.id}
                    draggable
                    onDragStart={() => setDragId(l.id)}
                    onClick={() => onOpen(l.id)}
                    style={{
                      background: T.surface, border: `1px solid ${T.line}`, borderRadius: 9, padding: "9px 10px",
                      cursor: "grab", fontSize: 12.5
                    }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      <GripVertical size={12} color={T.ink3} />
                      <span style={{ fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.empresa}</span>
                    </div>
                    <div style={{ color: T.ink2, fontSize: 11 }}>{l.segmento || "Não informado"}</div>
                    <div style={{ marginTop: 5 }}><Badge color={classify(l.score).color} bg={classify(l.score).bg}>{l.score}</Badge></div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ==================================================================== */
/* FEEDBACKS                                                              */
/* ==================================================================== */
const FEEDBACK_CATS = [
  { id: "positivo", label: "Positivo", color: T.accent, bg: T.accentSoft, icon: "🟢" },
  { id: "neutro", label: "Neutro", color: T.gold, bg: T.goldSoft, icon: "🟡" },
  { id: "negativo", label: "Negativo", color: T.danger, bg: T.dangerSoft, icon: "🔴" },
  { id: "interessado", label: "Interessado", color: "#1D4ED8", bg: "#E7EEFC", icon: "🔵" },
  { id: "semresposta", label: "Sem resposta", color: T.ink2, bg: T.surface2, icon: "⚫" },
];

function FeedbackForm({ leadId, leadNome, onSave, initial }) {
  const [mensagemEnviada, setMensagemEnviada] = useState(initial?.mensagemEnviada || "");
  const [respostaCliente, setRespostaCliente] = useState(initial?.respostaCliente || "");
  const [resultado, setResultado] = useState(initial?.resultado || "positivo");
  const [observacoes, setObservacoes] = useState(initial?.observacoes || "");

  return (
    <Card style={{ marginBottom: 12, background: T.surface2 }}>
      <Field label={`Lead: ${leadNome}`}>
        <TextArea rows={2} placeholder="Mensagem enviada (opcional)" value={mensagemEnviada} onChange={e => setMensagemEnviada(e.target.value)} />
      </Field>
      <Field label="Resposta do cliente"><TextArea rows={2} value={respostaCliente} onChange={e => setRespostaCliente(e.target.value)} /></Field>
      <Field label="Resultado">
        <Select value={resultado} onChange={e => setResultado(e.target.value)}>
          {FEEDBACK_CATS.map(c => <option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
        </Select>
      </Field>
      <Field label="Observações"><TextArea rows={2} value={observacoes} onChange={e => setObservacoes(e.target.value)} /></Field>
      <Btn variant="primary" onClick={() => onSave({ id: initial?.id || uid(), leadId, leadNome, mensagemEnviada, respostaCliente, resultado, observacoes, data: Date.now() })}>
        Salvar feedback
      </Btn>
    </Card>
  );
}

function FeedbackItem({ fb, onDelete, onEdit }) {
  const cat = FEEDBACK_CATS.find(c => c.id === fb.resultado);
  return (
    <div style={{ padding: "10px 0", borderBottom: `1px solid ${T.line}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Badge color={cat?.color} bg={cat?.bg}>{cat?.icon} {cat?.label}</Badge>
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>{fb.leadNome}</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {onEdit && <Edit2 size={13} color={T.ink3} style={{ cursor: "pointer" }} onClick={onEdit} />}
          <Trash2 size={13} color={T.ink3} style={{ cursor: "pointer" }} onClick={onDelete} />
        </div>
      </div>
      {fb.respostaCliente && <div style={{ fontSize: 12.5, color: T.ink2, marginBottom: 2 }}>"{fb.respostaCliente}"</div>}
      {fb.observacoes && <div style={{ fontSize: 12, color: T.ink3 }}>{fb.observacoes}</div>}
      <div style={{ fontSize: 11, color: T.ink3, marginTop: 2 }}>{new Date(fb.data).toLocaleDateString("pt-BR")}</div>
    </div>
  );
}

function FeedbacksView({ feedbacks, setFeedbacks, leads }) {
  const [showForm, setShowForm] = useState(false);
  const [leadId, setLeadId] = useState(leads[0]?.id || "");

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h1 style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: 20, margin: 0 }}>Feedbacks</h1>
        {leads.length > 0 && <Btn variant="primary" icon={Plus} onClick={() => setShowForm(!showForm)}>Novo feedback</Btn>}
      </div>
      {showForm && (
        <Card style={{ marginBottom: 14 }}>
          <Field label="Lead">
            <Select value={leadId} onChange={e => setLeadId(e.target.value)}>
              {leads.map(l => <option key={l.id} value={l.id}>{l.empresa}</option>)}
            </Select>
          </Field>
          <FeedbackForm leadId={leadId} leadNome={leads.find(l => l.id === leadId)?.empresa}
            onSave={(fb) => { setFeedbacks(prev => [fb, ...prev]); setShowForm(false); }} />
        </Card>
      )}
      {feedbacks.length === 0 ? (
        <Empty icon={Star} title="Nenhum feedback registrado" body="Registre respostas e resultados de contatos para acompanhar sua taxa de sucesso." />
      ) : (
        <Card>{feedbacks.map(fb => <FeedbackItem key={fb.id} fb={fb} onDelete={() => setFeedbacks(prev => prev.filter(x => x.id !== fb.id))} />)}</Card>
      )}
    </div>
  );
}

/* ==================================================================== */
/* PROMPTS                                                                */
/* ==================================================================== */
const PROMPT_TARGETS = ["Lovable", "Claude", "Gemini", "ChatGPT", "Codex", "Outro"];
const PROMPT_TIPOS_NEGOCIO = ["Loja", "Restaurante", "Pizzaria", "Barbearia", "Salão de beleza", "Pet shop", "Clínica", "Escritório", "Serviços", "Outros"];
const PROMPT_OBJETIVOS = ["Captar contatos/leads", "Vender online", "Agendar horários", "Fortalecer a marca", "Divulgar portfólio", "Apresentar a empresa"];
const PROMPT_TIPOS_SITE = ["Landing page", "Site institucional", "Loja virtual", "Página de agendamento", "Portfólio"];
const PROMPT_ESTILOS = ["Moderno", "Premium", "Minimalista", "Elegante", "Luxuoso", "Profissional", "Jovem", "Criativo", "Tecnológico", "Sofisticado", "Dark", "Clean"];
const PROMPT_TONS = ["Profissional", "Descontraído", "Caloroso", "Divertido", "Sério", "Inspirador"];
const PROMPT_CTAS = ["WhatsApp", "Ligação", "Formulário de contato", "Agendamento online", "Instagram"];
const PROMPT_SECOES_DISPONIVEIS = ["Hero", "Sobre", "Serviços", "Produtos", "Benefícios", "Diferenciais", "Galeria", "Depoimentos", "FAQ", "CTA", "Contato", "Localização", "Rodapé"];
const PROMPT_SECOES_PADRAO = ["Hero", "Sobre", "Serviços", "Diferenciais", "CTA", "Contato", "Rodapé"];

// Bloco de dados da empresa: usa EXCLUSIVAMENTE campos reais do lead.
// Qualquer campo ausente aparece como "Não informado" — nunca inventado.
function buildDadosEmpresaBlock(lead) {
  const v = (x) => (x === null || x === undefined || x === "" ? "Não informado" : x);
  return `Nome da empresa: ${v(lead.empresa)}
Segmento: ${v(lead.segmento)}
Cidade: ${v(lead.cidade)}
Estado: ${v(lead.estado)}
Endereço: ${v(lead.endereco)}
Telefone: ${v(lead.telefone)}
WhatsApp: ${v(lead.whatsapp)}
Site: ${v(lead.site)}
Instagram: ${v(lead.instagram)}
LinkedIn: ${v(lead.linkedin)}
Descrição: ${v(lead.descricao)}
Diferenciais: ${v(lead.diferenciais)}
Observações: ${v(lead.observacoes)}
Avaliação no Google: ${lead.avaliacao != null ? `${lead.avaliacao} estrelas (${lead.numAvaliacoes ?? 0} avaliações)` : "Não informado"}`;
}

function buildPromptText(lead, opts) {
  const { target, tipoNegocio, objetivo, tipoSite, publicoAlvo, estilo, tom, cta, secoes, instrucoes, nivelDetalhe } = opts;
  const secoesTexto = secoes.length ? secoes.join(" → ") : "a critério da IA";
  const nivel = nivelDetalhe === "Curto"
    ? "Seja objetivo: gere só a estrutura de seções e os textos principais (headline, subtítulo, CTA), sem explicações longas."
    : "Gere com detalhamento completo: estrutura de seções, todos os textos (headline, subtítulo, sobre, cada serviço/diferencial, prova social só se houver dados reais, chamada final), sugestão de paleta de cores coerente com o estilo pedido, e componentes de UI sugeridos para cada seção.";

  return `Crie um ${tipoSite.toLowerCase()} profissional para a empresa abaixo, para ser implementado em ${target}.

TIPO DE NEGÓCIO: ${tipoNegocio}
OBJETIVO DO SITE: ${objetivo}
PÚBLICO-ALVO: ${publicoAlvo || "não informado — infira a partir do segmento"}
ESTILO VISUAL: ${estilo}
TOM DE VOZ: ${tom}
CTA PRINCIPAL: ${cta}${cta === "WhatsApp" && whatsappAlvo(lead) ? ` (${whatsappAlvo(lead)}${whatsappEhSuposicao(lead) ? " — telefone comercial, confirme se é WhatsApp" : ""})` : cta === "Ligação" && lead.telefone ? ` (${lead.telefone})` : ""}

DADOS DA EMPRESA (reais — não altere nem complete com suposições):
${buildDadosEmpresaBlock(lead)}

SEÇÕES DO SITE (nesta ordem — respeite exatamente esta lista, não adicione nem remova seções):
${secoesTexto}

REGRAS OBRIGATÓRIAS:
- Nunca invente telefone, endereço, WhatsApp, Instagram, avaliações, depoimentos ou preços que não estejam nos dados acima.
- Se um dado disser "Não informado", não mencione esse tópico no site em vez de inventar um valor.
- Use apenas fotos/imagens reais fornecidas pelo cliente — não trate imagens de banco de imagens como se fossem da empresa.
${instrucoes.trim() ? `\nINSTRUÇÕES ADICIONAIS DO USUÁRIO:\n${instrucoes.trim()}\n` : ""}
${nivel}`;
}

function PromptGenerator({ lead }) {
  const [target, setTarget] = useState("Claude");
  const [tipoNegocio, setTipoNegocio] = useState(PROMPT_TIPOS_NEGOCIO.find(t => t.toLowerCase() === (lead.segmento || "").toLowerCase()) || "Outros");
  const [objetivo, setObjetivo] = useState(PROMPT_OBJETIVOS[0]);
  const [tipoSite, setTipoSite] = useState(PROMPT_TIPOS_SITE[0]);
  const [publicoAlvo, setPublicoAlvo] = useState("");
  const [estilo, setEstilo] = useState("Moderno");
  const [tom, setTom] = useState("Profissional");
  const [cta, setCta] = useState(whatsappAlvo(lead) ? "WhatsApp" : "Formulário de contato");
  const [secoes, setSecoes] = useState(PROMPT_SECOES_PADRAO);
  const [instrucoes, setInstrucoes] = useState("");
  const [nivelDetalhe, setNivelDetalhe] = useState("Completo");
  const [editText, setEditText] = useState(null);

  const gerado = buildPromptText(lead, { target, tipoNegocio, objetivo, tipoSite, publicoAlvo, estilo, tom, cta, secoes, instrucoes, nivelDetalhe });
  const text = editText ?? gerado;

  function toggleSecao(s) {
    setEditText(null);
    setSecoes(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  }
  function moverSecao(s, dir) {
    setEditText(null);
    setSecoes(prev => {
      const i = prev.indexOf(s);
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: window.innerWidth < 900 ? "1fr" : "340px 1fr", gap: 16 }}>
      <Card>
        <Field label="Tipo de negócio">
          <Select value={tipoNegocio} onChange={e => { setEditText(null); setTipoNegocio(e.target.value); }}>
            {PROMPT_TIPOS_NEGOCIO.map(t => <option key={t}>{t}</option>)}
          </Select>
        </Field>
        <Field label="Objetivo do site">
          <Select value={objetivo} onChange={e => { setEditText(null); setObjetivo(e.target.value); }}>
            {PROMPT_OBJETIVOS.map(t => <option key={t}>{t}</option>)}
          </Select>
        </Field>
        <Field label="Tipo de site">
          <Select value={tipoSite} onChange={e => { setEditText(null); setTipoSite(e.target.value); }}>
            {PROMPT_TIPOS_SITE.map(t => <option key={t}>{t}</option>)}
          </Select>
        </Field>
        <Field label="Público-alvo (opcional)">
          <Input value={publicoAlvo} onChange={e => { setEditText(null); setPublicoAlvo(e.target.value); }} placeholder="Ex: donos de pets na zona sul" />
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label="Estilo">
            <Select value={estilo} onChange={e => { setEditText(null); setEstilo(e.target.value); }}>
              {PROMPT_ESTILOS.map(t => <option key={t}>{t}</option>)}
            </Select>
          </Field>
          <Field label="Tom">
            <Select value={tom} onChange={e => { setEditText(null); setTom(e.target.value); }}>
              {PROMPT_TONS.map(t => <option key={t}>{t}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="CTA principal">
          <Select value={cta} onChange={e => { setEditText(null); setCta(e.target.value); }}>
            {PROMPT_CTAS.map(t => <option key={t}>{t}</option>)}
          </Select>
        </Field>

        <div style={{ fontWeight: 600, fontSize: 12.5, margin: "12px 0 6px" }}>Seções (marque e ordene)</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
          {secoes.map(s => (
            <div key={s} style={{ display: "flex", alignItems: "center", gap: 6, background: T.surface2, borderRadius: 6, padding: "4px 8px" }}>
              <span style={{ fontSize: 12, flex: 1 }}>{s}</span>
              <Btn variant="ghost" style={{ padding: "2px 6px" }} onClick={() => moverSecao(s, -1)}><ChevronUp size={13} /></Btn>
              <Btn variant="ghost" style={{ padding: "2px 6px" }} onClick={() => moverSecao(s, 1)}><ChevronDown size={13} /></Btn>
              <Btn variant="ghost" style={{ padding: "2px 6px" }} onClick={() => toggleSecao(s)}><X size={13} /></Btn>
            </div>
          ))}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 4 }}>
            {PROMPT_SECOES_DISPONIVEIS.filter(s => !secoes.includes(s)).map(s => (
              <div key={s} onClick={() => toggleSecao(s)} style={{ padding: "3px 9px", borderRadius: 999, fontSize: 11, cursor: "pointer", background: T.surface2, color: T.ink3 }}>
                + {s}
              </div>
            ))}
          </div>
        </div>

        <Field label="Instruções personalizadas (opcional)">
          <TextArea rows={2} value={instrucoes} onChange={e => { setEditText(null); setInstrucoes(e.target.value); }} placeholder="Ex: incluir seção de horário de funcionamento" />
        </Field>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label="Nível de detalhamento">
            <Select value={nivelDetalhe} onChange={e => { setEditText(null); setNivelDetalhe(e.target.value); }}>
              <option>Curto</option><option>Completo</option>
            </Select>
          </Field>
          <Field label="Gerar prompt para">
            <Select value={target} onChange={e => { setEditText(null); setTarget(e.target.value); }}>
              {PROMPT_TARGETS.map(t => <option key={t}>{t}</option>)}
            </Select>
          </Field>
        </div>
      </Card>

      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>Prompt gerado</div>
          <div style={{ display: "flex", gap: 6 }}>
            <Btn variant="outline" icon={RefreshCw} onClick={() => setEditText(null)}>Regenerar</Btn>
            <Btn variant="outline" icon={Copy} onClick={() => { navigator.clipboard?.writeText(text); }}>Copiar</Btn>
          </div>
        </div>
        <TextArea
          rows={20}
          value={text}
          onChange={e => setEditText(e.target.value)}
          style={{ fontSize: 12.5, fontFamily: "IBM Plex Mono, monospace", lineHeight: 1.6 }}
        />
      </Card>
    </div>
  );
}

function PromptsView({ leads }) {
  const [leadId, setLeadId] = useState(leads[0]?.id || "");
  const lead = leads.find(l => l.id === leadId);
  return (
    <div>
      <h1 style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: 20, margin: "0 0 14px" }}>Gerador de prompts</h1>
      {leads.length === 0 ? (
        <Empty icon={Bot} title="Nenhum lead disponível" body="Pesquise leads primeiro para gerar prompts de criação de site." />
      ) : (
        <>
          <Field label="Selecionar lead">
            <Select value={leadId} onChange={e => setLeadId(e.target.value)} style={{ maxWidth: 320 }}>
              {leads.map(l => <option key={l.id} value={l.id}>{l.empresa}</option>)}
            </Select>
          </Field>
          {lead && <PromptGenerator key={lead.id} lead={lead} />}
        </>
      )}
    </div>
  );
}

/* ==================================================================== */
/* SITES (AI website creator)                                             */
/* ==================================================================== */
const SITE_STYLES = ["Premium", "Luxo", "Moderno", "Clean", "Dark", "Elegante", "Minimalista"];
const SITE_CTAS = ["WhatsApp", "Instagram", "Ligação", "Agendamento"];


const STYLE_PALETTES = {
  Premium: { bg: "#0F1115", ink: "#F4F1EA", accent: "#C9A24B" },
  Luxo: { bg: "#12100E", ink: "#F5EFE6", accent: "#B08B3F" },
  Moderno: { bg: "#FFFFFF", ink: "#14171C", accent: T.accent },
  Clean: { bg: "#FFFFFF", ink: "#1C1F24", accent: "#2563EB" },
  Dark: { bg: "#0D0F12", ink: "#EDEFF2", accent: "#3FCF8E" },
  Elegante: { bg: "#F7F5F1", ink: "#25231F", accent: "#7A4B3A" },
  Minimalista: { bg: "#FAFAF9", ink: "#141414", accent: "#141414" },
};
const DESIGN_FONTES = ["Space Grotesk, sans-serif", "Inter, sans-serif", "Georgia, serif", "IBM Plex Mono, monospace"];
const DESIGN_FONTE_LABEL = { "Space Grotesk, sans-serif": "Moderna (Space Grotesk)", "Inter, sans-serif": "Neutra (Inter)", "Georgia, serif": "Clássica (serifada)", "IBM Plex Mono, monospace": "Técnica (monoespaçada)" };
const DESIGN_ESPACAMENTOS = { compacto: 28, normal: 48, espacoso: 72 };
const DESIGN_SECOES_SITE = [
  { id: "hero", label: "Hero (headline)" },
  { id: "sobre", label: "Sobre" },
  { id: "servicos", label: "Serviços" },
  { id: "depoimento", label: "Avaliação/depoimento" },
];

function defaultDesign(estilo) {
  const pal = STYLE_PALETTES[estilo] || STYLE_PALETTES.Moderno;
  return {
    corFundo: pal.bg,
    corTexto: pal.ink,
    corPrimaria: pal.accent,
    corSecundaria: pal.accent,
    corBotaoTexto: pal.bg === "#FFFFFF" ? "#FFFFFF" : pal.bg,
    fonte: "Space Grotesk, sans-serif",
    arredondamento: 8,
    estiloBotao: "solid",
    sombra: true,
    espacamento: "normal",
    secoes: ["hero", "sobre", "servicos", "depoimento"],
  };
}

function SitesView({ leads, updateLead, offer, notify }) {
  const [leadId, setLeadId] = useState(leads[0]?.id || "");
  const [tipo, setTipo] = useState("Landing Page");
  const [estilo, setEstilo] = useState("Moderno");
  const [cta, setCta] = useState("WhatsApp");
  const [loading, setLoading] = useState(false);
  const [device, setDevice] = useState("desktop");
  const [error, setError] = useState("");
  const [tabDireita, setTabDireita] = useState("preview"); // preview | design
  const lead = leads.find(l => l.id === leadId);

  useEffect(() => { if (!leadId && leads.length) setLeadId(leads[0].id); }, [leads]);

  async function gerarSite() {
    if (!lead) return;
    setLoading(true); setError("");
    const system = "Você gera conteúdo de landing pages em português do Brasil. Responda APENAS com um objeto JSON válido, sem markdown, sem texto fora do JSON, com as chaves: headline, subheadline, sobre, servicos (array de até 4 strings curtas), depoimentoFicticio (deixe vazio string se não houver avaliações reais), ctaTexto. Nunca invente números de avaliações ou depoimentos reais — se não houver dados fornecidos, deixe depoimentoFicticio como string vazia.";
    const prompt = `Gere o conteúdo de um site do tipo "${tipo}", estilo "${estilo}", com CTA principal "${cta}" para:

Empresa: ${lead.empresa}
Segmento: ${lead.segmento || "não informado"}
Cidade: ${lead.cidade || "não informada"}${lead.estado ? `/${lead.estado}` : ""}
Serviços: ${(lead.servicos || []).join(", ") || "não informado"}
${lead.avaliacao != null ? `Avaliação real: ${lead.avaliacao} estrelas em ${lead.numAvaliacoes ?? 0} avaliações (Google)` : "Sem dados reais de avaliação disponíveis — não mencione avaliações."}
Diferenciais do prestador de serviço que criará o site: ${offer.diferenciais}`;
    try {
      const raw = await callClaude(prompt, system, 1200);
      const json = parseJsonRobusto(raw);
      if (!json) {
        throw new Error("A IA respondeu em um formato inesperado (não era um JSON válido). Tente gerar novamente.");
      }
      // Normaliza cada campo — nunca confia cegamente no tipo devolvido pela
      // IA (ex.: às vezes vem uma string solta em vez do array esperado em
      // "servicos"), pra não quebrar o preview do site em runtime.
      const strOrVazio = v => (typeof v === "string" ? v.trim() : "");
      const servicos = Array.isArray(json.servicos)
        ? json.servicos.filter(s => typeof s === "string" && s.trim()).slice(0, 4)
        : strOrVazio(json.servicos) ? [strOrVazio(json.servicos)] : [];
      const headline = strOrVazio(json.headline);
      if (!headline) {
        throw new Error("A IA não gerou um título (headline) para o site. Tente gerar novamente.");
      }
      const conteudo = {
        headline,
        subheadline: strOrVazio(json.subheadline),
        sobre: strOrVazio(json.sobre),
        servicos,
        depoimentoFicticio: strOrVazio(json.depoimentoFicticio),
        ctaTexto: strOrVazio(json.ctaTexto),
      };
      const design = lead.website?.design || defaultDesign(estilo);
      updateLead(lead.id, { website: { ...conteudo, tipo, estilo, cta, design, publicado: false, geradoEm: Date.now() } }, "Site gerado com IA");
      notify("Conteúdo do site gerado");
    } catch (e) {
      setError(e.message || "Não foi possível gerar o site agora.");
    }
    setLoading(false);
  }

  function publicar() {
    if (!lead?.website) return;
    updateLead(lead.id, { website: { ...lead.website, publicado: true } }, "Site publicado");
    notify("Site marcado como publicado (URL de demonstração)");
  }

  function editField(field, value) {
    updateLead(lead.id, { website: { ...lead.website, [field]: value } });
  }

  function editDesign(patch) {
    const current = lead.website?.design || defaultDesign(lead.website?.estilo || estilo);
    updateLead(lead.id, { website: { ...lead.website, design: { ...current, ...patch } } });
  }

  const widths = { desktop: "100%", tablet: 480, mobile: 300 };
  const design = lead?.website?.design || defaultDesign(lead?.website?.estilo || estilo);

  return (
    <div>
      <h1 style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: 20, margin: "0 0 14px" }}>Criador de sites com IA</h1>
      {leads.length === 0 ? (
        <Empty icon={Globe} title="Nenhum lead disponível" body="Pesquise leads primeiro para criar sites para eles." />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: window.innerWidth < 860 ? "1fr" : "320px 1fr", gap: 18 }}>
          <Card>
            <Field label="Lead">
              <Select value={leadId} onChange={e => setLeadId(e.target.value)}>
                {leads.map(l => <option key={l.id} value={l.id}>{l.empresa}</option>)}
              </Select>
            </Field>
            <Field label="Tipo de site">
              <Select value={tipo} onChange={e => setTipo(e.target.value)}>
                <option>Landing Page</option><option>Site institucional</option><option>Página de serviços</option>
              </Select>
            </Field>
            <Field label="Estilo">
              <Select value={estilo} onChange={e => setEstilo(e.target.value)}>
                {SITE_STYLES.map(s => <option key={s}>{s}</option>)}
              </Select>
            </Field>
            <Field label="CTA principal">
              <Select value={cta} onChange={e => setCta(e.target.value)}>
                {SITE_CTAS.map(s => <option key={s}>{s}</option>)}
              </Select>
            </Field>
            <Btn variant="primary" icon={loading ? Loader2 : Sparkles} onClick={gerarSite} disabled={loading} full>
              {loading ? "Gerando…" : lead?.website ? "Gerar novamente" : "Gerar com IA"}
            </Btn>
            {error && <div style={{ color: T.danger, fontSize: 12, marginTop: 8 }}>{error}</div>}
            {lead?.website && (
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <Btn variant="outline" icon={Save} onClick={() => notify("Alterações salvas")}>Salvar</Btn>
                <Btn variant="primary" icon={Rocket} onClick={publicar}>Publicar</Btn>
              </div>
            )}
          </Card>

          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
              <div style={{ display: "flex", gap: 4 }}>
                {[["preview", "Preview"], ["design", "Personalizar design"]].map(([id, label]) => (
                  <div key={id} onClick={() => setTabDireita(id)} style={{
                    padding: "6px 12px", borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: "pointer",
                    background: tabDireita === id ? T.accent : T.surface2, color: tabDireita === id ? "#fff" : T.ink2
                  }}>{label}</div>
                ))}
              </div>
              {tabDireita === "preview" && (
                <div style={{ display: "flex", gap: 6 }}>
                  {[["desktop", Monitor], ["tablet", Tablet], ["mobile", Smartphone]].map(([id, Icon]) => (
                    <div key={id} onClick={() => setDevice(id)} style={{
                      padding: "6px 10px", borderRadius: 8, cursor: "pointer",
                      background: device === id ? T.accent : T.surface2, color: device === id ? "#fff" : T.ink2
                    }}><Icon size={15} /></div>
                  ))}
                </div>
              )}
            </div>

            {!lead?.website ? (
              <Card><Empty icon={Sparkles} title="Nenhum preview ainda" body='Configure as opções e clique em "Gerar com IA" para ver o preview do site aqui.' /></Card>
            ) : tabDireita === "design" ? (
              <DesignPanel design={design} onChange={editDesign} />
            ) : (
              <div style={{ display: "flex", justifyContent: device === "desktop" ? "stretch" : "center" }}>
                <div style={{ width: widths[device], maxWidth: "100%", transition: "width .2s" }}>
                  <SitePreview site={lead.website} lead={lead} design={design} onEdit={editField} />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DesignPanel({ design, onChange }) {
  function toggleSecao(id) {
    if (id === "hero") return; // "hero" nunca pode ser removida (ver comentário abaixo, no JSX)
    const secoes = design.secoes.includes(id) ? design.secoes.filter(s => s !== id) : [...design.secoes, id];
    onChange({ secoes });
  }
  function moverSecao(id, dir) {
    const arr = [...design.secoes];
    const i = arr.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    onChange({ secoes: arr });
  }
  return (
    <Card>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Cor principal"><ColorInput value={design.corPrimaria} onChange={v => onChange({ corPrimaria: v })} /></Field>
        <Field label="Cor secundária"><ColorInput value={design.corSecundaria} onChange={v => onChange({ corSecundaria: v })} /></Field>
        <Field label="Cor de fundo"><ColorInput value={design.corFundo} onChange={v => onChange({ corFundo: v })} /></Field>
        <Field label="Cor dos textos"><ColorInput value={design.corTexto} onChange={v => onChange({ corTexto: v })} /></Field>
        <Field label="Cor do texto do botão"><ColorInput value={design.corBotaoTexto} onChange={v => onChange({ corBotaoTexto: v })} /></Field>
      </div>

      <Field label="Tipografia">
        <Select value={design.fonte} onChange={e => onChange({ fonte: e.target.value })}>
          {DESIGN_FONTES.map(f => <option key={f} value={f}>{DESIGN_FONTE_LABEL[f]}</option>)}
        </Select>
      </Field>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Estilo do botão">
          <Select value={design.estiloBotao} onChange={e => onChange({ estiloBotao: e.target.value })}>
            <option value="solid">Preenchido</option>
            <option value="outline">Contornado</option>
            <option value="pill">Arredondado (pílula)</option>
          </Select>
        </Field>
        <Field label="Espaçamento">
          <Select value={design.espacamento} onChange={e => onChange({ espacamento: e.target.value })}>
            <option value="compacto">Compacto</option>
            <option value="normal">Normal</option>
            <option value="espacoso">Espaçoso</option>
          </Select>
        </Field>
      </div>

      <Field label={`Arredondamento dos cards: ${design.arredondamento}px`}>
        <input type="range" min="0" max="28" value={design.arredondamento} onChange={e => onChange({ arredondamento: parseInt(e.target.value) })} style={{ width: "100%" }} />
      </Field>

      <Toggle checked={design.sombra} onChange={v => onChange({ sombra: v })} label="Sombra nos cards" />

      <div style={{ fontWeight: 600, fontSize: 12.5, margin: "14px 0 6px" }}>Seções visíveis (marque e ordene)</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {design.secoes.map(id => (
          <div key={id} style={{ display: "flex", alignItems: "center", gap: 6, background: T.surface2, borderRadius: 6, padding: "4px 8px" }}>
            <span style={{ fontSize: 12, flex: 1 }}>{DESIGN_SECOES_SITE.find(s => s.id === id)?.label || id}{id === "hero" ? " (obrigatória)" : ""}</span>
            {id !== "hero" && <Btn variant="ghost" style={{ padding: "2px 6px" }} onClick={() => moverSecao(id, -1)}><ChevronUp size={13} /></Btn>}
            {id !== "hero" && <Btn variant="ghost" style={{ padding: "2px 6px" }} onClick={() => moverSecao(id, 1)}><ChevronDown size={13} /></Btn>}
            {/* "hero" nunca pode ser removida: é onde ficam o título e o
                botão de contato (CTA) — sem ela o site fica praticamente em
                branco, sem nenhuma forma de o visitante entrar em contato. */}
            {id !== "hero" && <Btn variant="ghost" style={{ padding: "2px 6px" }} onClick={() => toggleSecao(id)}><X size={13} /></Btn>}
          </div>
        ))}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 4 }}>
          {DESIGN_SECOES_SITE.filter(s => !design.secoes.includes(s.id)).map(s => (
            <div key={s.id} onClick={() => toggleSecao(s.id)} style={{ padding: "3px 9px", borderRadius: 999, fontSize: 11, cursor: "pointer", background: T.surface2, color: T.ink3 }}>
              + {s.label}
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function ColorInput({ value, onChange }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <input type="color" value={/^#([0-9A-Fa-f]{6})$/.test(value) ? value : "#000000"} onChange={e => onChange(e.target.value)}
        style={{ width: 34, height: 30, border: `1px solid ${T.line}`, borderRadius: 6, cursor: "pointer", padding: 0 }} />
      <Input value={value} onChange={e => onChange(e.target.value)} style={{ fontSize: 12 }} />
    </div>
  );
}

function SitePreview({ site, lead, design, onEdit }) {
  const d = design || defaultDesign(site.estilo);
  const botaoStyle = d.estiloBotao === "outline"
    ? { background: "transparent", color: d.corPrimaria, border: `2px solid ${d.corPrimaria}` }
    : { background: d.corPrimaria, color: d.corBotaoTexto, border: "none" };
  const raioBotao = d.estiloBotao === "pill" ? 999 : d.arredondamento;
  const padSecao = DESIGN_ESPACAMENTOS[d.espacamento] || 48;
  const sombra = d.sombra ? "0 6px 18px rgba(0,0,0,.08)" : "none";

  // Blindagem contra dados salvos em formato inesperado — por exemplo,
  // sites gerados antes de uma correção anterior, ou uma resposta da IA que
  // fugiu do formato mesmo com a validação no momento da geração. Sem isso,
  // um campo salvo com o tipo errado (ex.: "servicos" como texto solto em
  // vez de lista) quebrava a tela de preview inteira ao tentar usar .map()
  // em algo que não é array. Preview nunca deve quebrar por causa de um
  // dado salvo malformado — na pior das hipóteses, mostra vazio.
  const servicos = Array.isArray(site.servicos) ? site.servicos.filter(s => typeof s === "string") : [];
  const headline = typeof site.headline === "string" ? site.headline : "";
  const subheadline = typeof site.subheadline === "string" ? site.subheadline : "";
  const sobre = typeof site.sobre === "string" ? site.sobre : "";
  const depoimentoFicticio = typeof site.depoimentoFicticio === "string" ? site.depoimentoFicticio : "";
  const ctaTexto = typeof site.ctaTexto === "string" ? site.ctaTexto : "";

  const blocos = {
    hero: (
      <div key="hero" style={{ background: d.corFundo, color: d.corTexto, padding: `${padSecao}px 28px`, textAlign: "center", fontFamily: d.fonte }}>
        <div style={{ fontSize: 11, letterSpacing: 1, opacity: 0.7, marginBottom: 10 }}>{(lead.empresa || "").toUpperCase()}</div>
        <EditableText value={headline} onChange={v => onEdit("headline", v)} style={{ fontFamily: d.fonte, fontSize: 26, fontWeight: 700, marginBottom: 10 }} />
        <EditableText value={subheadline} onChange={v => onEdit("subheadline", v)} style={{ fontSize: 14, opacity: 0.85, maxWidth: 420, margin: "0 auto 20px" }} />
        <div style={{ display: "inline-block", ...botaoStyle, padding: "10px 22px", borderRadius: raioBotao, fontSize: 13, fontWeight: 700 }}>
          {ctaTexto || `Fale no ${site.cta}`}
        </div>
      </div>
    ),
    sobre: (
      <div key="sobre" style={{ padding: `${Math.round(padSecao * 0.5)}px 22px 0` }}>
        <EditableText value={sobre} onChange={v => onEdit("sobre", v)} style={{ fontSize: 13, color: T.ink2, lineHeight: 1.6, fontFamily: d.fonte }} multiline />
      </div>
    ),
    servicos: (
      <div key="servicos" style={{ padding: `${Math.round(padSecao * 0.35)}px 22px 0` }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 10 }}>
          {servicos.map((s, i) => (
            <div key={i} style={{ background: T.surface2, borderRadius: d.arredondamento, boxShadow: sombra, padding: "10px 12px", fontSize: 12, fontWeight: 600, textAlign: "center", fontFamily: d.fonte }}>{s}</div>
          ))}
        </div>
      </div>
    ),
    depoimento: depoimentoFicticio ? (
      <div key="depoimento" style={{ padding: `${Math.round(padSecao * 0.35)}px 22px ${Math.round(padSecao * 0.5)}px` }}>
        <div style={{ fontSize: 12.5, fontStyle: "italic", color: T.ink2, borderLeft: `2px solid ${d.corPrimaria}`, paddingLeft: 10 }}>
          "{depoimentoFicticio}"
        </div>
      </div>
    ) : null,
  };

  const secoes = Array.isArray(d.secoes) ? d.secoes : defaultDesign(site.estilo).secoes;

  return (
    <div style={{ border: `1px solid ${T.line}`, borderRadius: 14, overflow: "hidden", background: "#fff" }}>
      {secoes.filter(id => id === "hero").map(id => blocos[id])}
      <div>{secoes.filter(id => id !== "hero").map(id => blocos[id])}</div>
    </div>
  );
}

function EditableText({ value, onChange, style, multiline }) {
  const Tag = multiline ? "textarea" : "input";
  return (
    <Tag value={value ?? ""} onChange={e => onChange(e.target.value)} rows={multiline ? 3 : undefined}
      style={{ ...style, background: "transparent", border: "none", outline: "none", textAlign: "inherit", width: "100%", fontFamily: "inherit", resize: multiline ? "vertical" : "none" }} />
  );
}

/* ==================================================================== */
/* MÓDULO — LOJA / CATÁLOGO / CARDÁPIO / CARRINHO / PEDIDOS              */
/* ==================================================================== */
function LojaModule({ leads, updateLead, notify, isMobile }) {
  const [leadId, setLeadId] = useState(leads[0]?.id || "");
  const [tab, setTab] = useState("cardapio");
  useEffect(() => { if (!leadId && leads.length) setLeadId(leads[0].id); }, [leads]);
  const lead = leads.find(l => l.id === leadId);

  const setLoja = useCallback((patch) => {
    if (!lead) return;
    const current = ensureLoja(lead);
    const next = typeof patch === "function" ? patch(current) : { ...current, ...patch };
    updateLead(lead.id, { loja: next });
  }, [lead, updateLead]);

  if (leads.length === 0) {
    return (
      <div>
        <h1 style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: 20, margin: "0 0 14px" }}>Loja & Pedidos</h1>
        <Empty icon={Store} title="Nenhum lead disponível" body="Pesquise leads primeiro para criar uma loja/cardápio para eles." />
      </div>
    );
  }

  const loja = lead ? ensureLoja(lead) : null;
  const novosCount = loja?.pedidos?.filter(p => p.status === "novo").length || 0;

  const tabs = [
    ["cardapio", "📋 Meu cardápio", ClipboardList],
    ["loja", "🛒 Ver como cliente", ShoppingBag],
    ["painel", `🏪 Painel da loja${novosCount ? ` (${novosCount})` : ""}`, Bell],
  ];

  return (
    <div>
      <h1 style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: 20, margin: "0 0 14px" }}>Loja & Pedidos</h1>
      <Card style={{ marginBottom: 14, maxWidth: 420 }}>
        <Field label="Site / estabelecimento">
          <Select value={leadId} onChange={e => setLeadId(e.target.value)}>
            {leads.map(l => <option key={l.id} value={l.id}>{l.empresa}</option>)}
          </Select>
        </Field>
      </Card>

      {lead && (
        <>
          <div style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: `1px solid ${T.line}`, overflowX: "auto" }}>
            {tabs.map(([id, label]) => (
              <div key={id} onClick={() => setTab(id)} style={{
                padding: "9px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
                color: tab === id ? T.accent : T.ink2, borderBottom: tab === id ? `2px solid ${T.accent}` : "2px solid transparent"
              }}>{label}</div>
            ))}
          </div>

          {tab === "cardapio" && <CatalogBuilder lead={lead} loja={loja} setLoja={setLoja} notify={notify} isMobile={isMobile} />}
          {tab === "loja" && <StorefrontPreview lead={lead} loja={loja} setLoja={setLoja} notify={notify} isMobile={isMobile} />}
          {tab === "painel" && <PainelLoja lead={lead} loja={loja} setLoja={setLoja} notify={notify} />}
        </>
      )}
    </div>
  );
}

/* -------------------- 1. TIPO DE SITE + CONFIG DA LOJA --------------- */
function CatalogBuilder({ lead, loja, setLoja, notify, isMobile }) {
  const [showAI, setShowAI] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editingItem, setEditingItem] = useState(null); // {item, categoriaId} | null | "new"
  const [newCatName, setNewCatName] = useState("");

  function escolherTipo(tipoId) {
    const meta = TIPOS_SITE.find(t => t.id === tipoId);
    setLoja(prev => ({
      ...prev,
      tipo: tipoId,
      modeloNegocio: meta?.modelo || prev.modeloNegocio,
      categorias: prev.categorias.length ? prev.categorias : (BUSINESS_TEMPLATES[tipoId] || []).map(([nome]) => ({ id: uid(), nome })),
    }));
    notify(`Tipo de site definido: ${tipoId}`);
  }

  function addCategoria() {
    if (!newCatName.trim()) return;
    setLoja(prev => ({ ...prev, categorias: [...prev.categorias, { id: uid(), nome: newCatName.trim() }] }));
    setNewCatName("");
  }
  function renameCategoria(id, nome) {
    setLoja(prev => ({ ...prev, categorias: prev.categorias.map(c => c.id === id ? { ...c, nome } : c) }));
  }
  function deleteCategoria(id) {
    setLoja(prev => ({
      ...prev,
      categorias: prev.categorias.filter(c => c.id !== id),
      itens: prev.itens.filter(i => i.categoriaId !== id),
    }));
  }
  function moveCategoria(id, dir) {
    setLoja(prev => {
      const arr = [...prev.categorias];
      const idx = arr.findIndex(c => c.id === id);
      const swap = idx + dir;
      if (swap < 0 || swap >= arr.length) return prev;
      [arr[idx], arr[swap]] = [arr[swap], arr[idx]];
      return { ...prev, categorias: arr };
    });
  }

  function saveItem(item) {
    setLoja(prev => {
      const exists = prev.itens.some(i => i.id === item.id);
      return { ...prev, itens: exists ? prev.itens.map(i => i.id === item.id ? item : i) : [...prev.itens, item] };
    });
    setEditingItem(null);
    notify("Item salvo");
  }
  function deleteItem(id) {
    setLoja(prev => ({ ...prev, itens: prev.itens.filter(i => i.id !== id) }));
  }
  function duplicateItem(item) {
    setLoja(prev => ({ ...prev, itens: [...prev.itens, { ...item, id: uid(), nome: item.nome + " (cópia)" }] }));
    notify("Item duplicado");
  }
  function moveItem(item, dir) {
    setLoja(prev => {
      const arr = prev.itens.filter(i => i.categoriaId === item.categoriaId);
      const rest = prev.itens.filter(i => i.categoriaId !== item.categoriaId);
      const idx = arr.findIndex(i => i.id === item.id);
      const swap = idx + dir;
      if (swap < 0 || swap >= arr.length) return prev;
      [arr[idx], arr[swap]] = [arr[swap], arr[idx]];
      return { ...prev, itens: [...rest, ...arr] };
    });
  }

  const wantsProdutos = loja.modeloNegocio === "Produtos" || loja.modeloNegocio === "Produtos + Serviços" || loja.modeloNegocio === "Pedidos";
  const wantsServicos = loja.modeloNegocio === "Serviços" || loja.modeloNegocio === "Produtos + Serviços" || loja.modeloNegocio === "Agendamento";

  return (
    <div>
      {/* 1. Escolher tipo de site */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 10, fontFamily: "Space Grotesk, sans-serif" }}>🚀 Qual tipo de site deseja criar?</div>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4,1fr)", gap: 8 }}>
          {TIPOS_SITE.map(t => (
            <div key={t.id} onClick={() => escolherTipo(t.id)} style={{
              border: `1px solid ${loja.tipo === t.id ? T.accent : T.line}`, borderRadius: 10, padding: "10px 8px",
              textAlign: "center", cursor: "pointer", fontSize: 12.5, fontWeight: 600,
              background: loja.tipo === t.id ? T.accentSoft : T.surface, color: loja.tipo === t.id ? T.accentDark : T.ink,
            }}>
              <div style={{ fontSize: 18, marginBottom: 4 }}>{t.emoji}</div>
              {t.id}
            </div>
          ))}
        </div>
      </Card>

      {/* 2. Modelo de negócio + config */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: 12 }}>
          <Field label="Modelo de negócio">
            <Select value={loja.modeloNegocio} onChange={e => setLoja(prev => ({ ...prev, modeloNegocio: e.target.value }))}>
              {MODELOS_NEGOCIO.map(m => <option key={m}>{m}</option>)}
            </Select>
          </Field>
          <Field label="WhatsApp comercial da loja">
            <Input placeholder="(79) 90000-0000" value={loja.whatsappLoja} onChange={e => setLoja(prev => ({ ...prev, whatsappLoja: e.target.value }))} />
          </Field>
          <Field label="Forma de envio do pedido">
            <Select value={loja.modoEnvio} onChange={e => setLoja(prev => ({ ...prev, modoEnvio: e.target.value }))}>
              <option value="link">Link do WhatsApp (sem API)</option>
              <option value="api">WhatsApp Business API</option>
            </Select>
          </Field>
        </div>
        {loja.modoEnvio === "api" && (
          <div style={{ marginTop: 8, fontSize: 12, color: T.ink2, background: T.goldSoft, padding: 10, borderRadius: 8 }}>
            A WhatsApp Business Platform exige credenciais oficiais e envio via servidor — não é possível autenticar essa API diretamente do navegador. Enquanto isso não for configurado no backend, os pedidos continuarão sendo enviados pelo link do WhatsApp (Modo 1), sem custo e sem necessidade de automação não oficial.
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10, flexWrap: "wrap", gap: 10 }}>
          <Toggle checked={loja.pagamentoOnline} onChange={v => setLoja(prev => ({ ...prev, pagamentoOnline: v }))} label="Pagamento online (em breve — pedido segue sem cobrança agora)" />
          <Toggle checked={loja.somNotificacao} onChange={v => setLoja(prev => ({ ...prev, somNotificacao: v }))} label="Som ao receber pedido" />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
          <Btn variant="outline" icon={Sparkles} onClick={() => setShowAI(true)}>✨ Gerar cardápio com IA</Btn>
          <Btn variant="outline" icon={FileSpreadsheet} onClick={() => setShowImport(true)}>Importar CSV/Excel</Btn>
          <span style={{ fontSize: 11.5, color: T.ink2 }}>Descreva o negócio em uma frase e a IA sugere categorias e itens — sem inventar preços.</span>
        </div>
      </Card>

      {/* 3. Categorias */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 10, fontFamily: "Space Grotesk, sans-serif" }}>Categorias</div>
        {loja.categorias.length === 0 && <div style={{ fontSize: 12.5, color: T.ink3, marginBottom: 10 }}>Nenhuma categoria ainda.</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
          {loja.categorias.map((c, idx) => (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Input value={c.nome} onChange={e => renameCategoria(c.id, e.target.value)} style={{ flex: 1 }} />
              <div onClick={() => moveCategoria(c.id, -1)} style={{ cursor: "pointer", color: T.ink3, padding: 4 }}><ChevronUp size={16} /></div>
              <div onClick={() => moveCategoria(c.id, 1)} style={{ cursor: "pointer", color: T.ink3, padding: 4 }}><ChevronDown size={16} /></div>
              <div onClick={() => deleteCategoria(c.id)} style={{ cursor: "pointer", color: T.danger, padding: 4 }}><Trash2 size={16} /></div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Input placeholder="Nova categoria (ex: 🍕 Pizzas)" value={newCatName} onChange={e => setNewCatName(e.target.value)} style={{ flex: 1 }} />
          <Btn variant="primary" icon={Plus} onClick={addCategoria}>Adicionar</Btn>
        </div>
      </Card>

      {/* 4. Itens por categoria */}
      {loja.categorias.map(cat => {
        const itensCat = loja.itens.filter(i => i.categoriaId === cat.id);
        return (
          <Card key={cat.id} style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ fontWeight: 700, fontFamily: "Space Grotesk, sans-serif" }}>{cat.nome}</div>
              <Btn variant="outline" icon={Plus} onClick={() => setEditingItem({ categoriaId: cat.id })}>Adicionar item</Btn>
            </div>
            {itensCat.length === 0 ? (
              <div style={{ fontSize: 12.5, color: T.ink3 }}>Nenhum item nesta categoria ainda.</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill,minmax(220px,1fr))", gap: 10 }}>
                {itensCat.map(item => (
                  <div key={item.id} style={{ border: `1px solid ${T.line}`, borderRadius: 10, padding: 10, opacity: item.disponivel === false ? 0.55 : 1 }}>
                    <div style={{ display: "flex", gap: 8 }}>
                      {item.imagem ? (
                        <img src={item.imagem} alt="" style={{ width: 48, height: 48, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />
                      ) : (
                        <div style={{ width: 48, height: 48, borderRadius: 8, background: T.surface2, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <ImageIcon size={18} color={T.ink3} />
                        </div>
                      )}
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", gap: 5 }}>
                          {item.destaque && <span title="Destaque">⭐</span>}
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.nome}</span>
                        </div>
                        <div style={{ fontSize: 12, color: T.ink2 }}>{brl(item.preco)}{item.tipo === "servico" ? " · serviço" : ""}</div>
                      </div>
                    </div>
                    {item.descricao && <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 6, lineHeight: 1.4 }}>{item.descricao}</div>}
                    <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                      <Btn variant="ghost" style={{ padding: "5px 8px", fontSize: 12 }} icon={Edit2} onClick={() => setEditingItem({ item, categoriaId: cat.id })}>Editar</Btn>
                      <Btn variant="ghost" style={{ padding: "5px 8px", fontSize: 12 }} icon={Copy} onClick={() => duplicateItem(item)}>Duplicar</Btn>
                      <Btn variant="ghost" style={{ padding: "5px 8px", fontSize: 12, color: T.danger }} icon={Trash2} onClick={() => deleteItem(item.id)}>Excluir</Btn>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        );
      })}

      {editingItem && (
        <ItemFormModal
          initial={editingItem.item}
          categoriaId={editingItem.categoriaId}
          categorias={loja.categorias}
          allowProduto={wantsProdutos}
          allowServico={wantsServicos}
          onSave={saveItem}
          onClose={() => setEditingItem(null)}
        />
      )}
      {showAI && (
        <AIConfigModal lead={lead} loja={loja} setLoja={setLoja} onClose={() => setShowAI(false)} notify={notify} />
      )}
      {showImport && (
        <ImportModal loja={loja} setLoja={setLoja} onClose={() => setShowImport(false)} notify={notify} />
      )}
    </div>
  );
}

/* -------------------- MODAL BASE --------------------------------- */
function ModalShell({ title, onClose, children, width = 560 }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(20,23,28,.5)", display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 100, padding: 16, overflowY: "auto" }}>
      <div style={{ background: "#fff", borderRadius: 14, padding: 20, width: "100%", maxWidth: width, marginTop: 30, marginBottom: 30 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 16, fontFamily: "Space Grotesk, sans-serif" }}>{title}</div>
          <div onClick={onClose} style={{ cursor: "pointer", color: T.ink3 }}><X size={20} /></div>
        </div>
        {children}
      </div>
    </div>
  );
}

/* -------------------- FORM DE ITEM (produto/serviço) -------------- */
function emptyItem(categoriaId, tipoPadrao) {
  return {
    id: uid(), categoriaId, tipo: tipoPadrao, nome: "", descricao: "", preco: "",
    imagem: "", disponivel: true, destaque: false, tempoEstimado: "",
    variacoes: [], adicionais: [],
  };
}

function ItemFormModal({ initial, categoriaId, categorias, allowProduto, allowServico, onSave, onClose }) {
  const tipoPadrao = allowProduto && !allowServico ? "produto" : (!allowProduto && allowServico ? "servico" : "produto");
  const [item, setItem] = useState(initial ? { ...initial, variacoes: initial.variacoes || [], adicionais: initial.adicionais || [] } : emptyItem(categoriaId, tipoPadrao));

  function patch(p) { setItem(prev => ({ ...prev, ...p })); }

  function addVariacao() {
    patch({ variacoes: [...item.variacoes, { id: uid(), nome: "Tamanho", opcoes: [{ id: uid(), nome: "Padrão", precoExtra: 0 }] }] });
  }
  function addAdicionalGrupo() {
    patch({ adicionais: [...item.adicionais, { id: uid(), nome: "Adicionais", opcoes: [{ id: uid(), nome: "Item extra", preco: 0 }] }] });
  }

  function onImagemFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => patch({ imagem: reader.result });
    reader.readAsDataURL(file);
  }

  function handleSave() {
    if (!item.nome.trim()) return;
    onSave({ ...item, preco: Number(item.preco) || 0, categoriaId: item.categoriaId || categoriaId });
  }

  return (
    <ModalShell title={initial ? "Editar item" : "Adicionar item"} onClose={onClose} width={640}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Categoria">
          <Select value={item.categoriaId} onChange={e => patch({ categoriaId: e.target.value })}>
            {categorias.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </Select>
        </Field>
        {allowProduto && allowServico && (
          <Field label="Tipo">
            <Select value={item.tipo} onChange={e => patch({ tipo: e.target.value })}>
              <option value="produto">Produto</option>
              <option value="servico">Serviço</option>
            </Select>
          </Field>
        )}
      </div>
      <Field label="Nome"><Input value={item.nome} onChange={e => patch({ nome: e.target.value })} placeholder="Ex: Pizza Calabresa" /></Field>
      <Field label="Descrição"><TextArea rows={2} value={item.descricao} onChange={e => patch({ descricao: e.target.value })} placeholder="Molho de tomate, mussarela e calabresa." /></Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Preço base (R$)"><Input type="number" step="0.01" value={item.preco} onChange={e => patch({ preco: e.target.value })} placeholder="39.90" /></Field>
        <Field label="Tempo estimado (opcional)"><Input value={item.tempoEstimado} onChange={e => patch({ tempoEstimado: e.target.value })} placeholder="Ex: 30-40 min" /></Field>
      </div>
      <Field label="Imagem">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {item.imagem && <img src={item.imagem} alt="" style={{ width: 44, height: 44, borderRadius: 8, objectFit: "cover" }} />}
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: T.accent, cursor: "pointer" }}>
            <ImagePlus size={15} /> {item.imagem ? "Trocar imagem" : "Enviar imagem"}
            <input type="file" accept="image/*" onChange={onImagemFile} style={{ display: "none" }} />
          </label>
          {item.imagem && <div onClick={() => patch({ imagem: "" })} style={{ cursor: "pointer", color: T.danger }}><Trash2 size={15} /></div>}
        </div>
      </Field>
      <div style={{ display: "flex", gap: 18, marginBottom: 10 }}>
        <Toggle checked={item.disponivel} onChange={v => patch({ disponivel: v })} label="Disponível" />
        <Toggle checked={item.destaque} onChange={v => patch({ destaque: v })} label="Destaque" />
      </div>

      {/* Variações */}
      <div style={{ borderTop: `1px solid ${T.line}`, paddingTop: 12, marginTop: 4 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>Variações (ex: tamanho, cor)</div>
          <Btn variant="ghost" icon={Plus} style={{ fontSize: 12 }} onClick={addVariacao}>Adicionar grupo</Btn>
        </div>
        {item.variacoes.map((grupo, gi) => (
          <div key={grupo.id} style={{ border: `1px solid ${T.line}`, borderRadius: 8, padding: 10, marginBottom: 8 }}>
            <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
              <Input value={grupo.nome} onChange={e => {
                const arr = [...item.variacoes]; arr[gi] = { ...grupo, nome: e.target.value }; patch({ variacoes: arr });
              }} placeholder="Nome do grupo (ex: Tamanho)" style={{ flex: 1 }} />
              <div onClick={() => patch({ variacoes: item.variacoes.filter(v => v.id !== grupo.id) })} style={{ cursor: "pointer", color: T.danger, padding: 6 }}><Trash2 size={15} /></div>
            </div>
            {grupo.opcoes.map((op, oi) => (
              <div key={op.id} style={{ display: "flex", gap: 6, marginBottom: 4 }}>
                <Input value={op.nome} onChange={e => {
                  const arr = [...item.variacoes]; const opts = [...arr[gi].opcoes]; opts[oi] = { ...op, nome: e.target.value }; arr[gi] = { ...arr[gi], opcoes: opts }; patch({ variacoes: arr });
                }} placeholder="Ex: Grande" style={{ flex: 1 }} />
                <Input type="number" step="0.01" value={op.precoExtra} onChange={e => {
                  const arr = [...item.variacoes]; const opts = [...arr[gi].opcoes]; opts[oi] = { ...op, precoExtra: e.target.value }; arr[gi] = { ...arr[gi], opcoes: opts }; patch({ variacoes: arr });
                }} placeholder="+R$" style={{ width: 90 }} />
                <div onClick={() => {
                  const arr = [...item.variacoes]; arr[gi] = { ...arr[gi], opcoes: arr[gi].opcoes.filter(o => o.id !== op.id) }; patch({ variacoes: arr });
                }} style={{ cursor: "pointer", color: T.ink3, padding: 6 }}><X size={14} /></div>
              </div>
            ))}
            <Btn variant="ghost" style={{ fontSize: 11.5, padding: "4px 8px" }} icon={Plus} onClick={() => {
              const arr = [...item.variacoes]; arr[gi] = { ...arr[gi], opcoes: [...arr[gi].opcoes, { id: uid(), nome: "", precoExtra: 0 }] }; patch({ variacoes: arr });
            }}>Opção</Btn>
          </div>
        ))}
      </div>

      {/* Adicionais */}
      <div style={{ borderTop: `1px solid ${T.line}`, paddingTop: 12, marginTop: 4 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>Adicionais (ex: borda, extra queijo)</div>
          <Btn variant="ghost" icon={Plus} style={{ fontSize: 12 }} onClick={addAdicionalGrupo}>Adicionar grupo</Btn>
        </div>
        {item.adicionais.map((grupo, gi) => (
          <div key={grupo.id} style={{ border: `1px solid ${T.line}`, borderRadius: 8, padding: 10, marginBottom: 8 }}>
            <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
              <Input value={grupo.nome} onChange={e => {
                const arr = [...item.adicionais]; arr[gi] = { ...grupo, nome: e.target.value }; patch({ adicionais: arr });
              }} placeholder="Nome do grupo (ex: Borda)" style={{ flex: 1 }} />
              <div onClick={() => patch({ adicionais: item.adicionais.filter(a => a.id !== grupo.id) })} style={{ cursor: "pointer", color: T.danger, padding: 6 }}><Trash2 size={15} /></div>
            </div>
            {grupo.opcoes.map((op, oi) => (
              <div key={op.id} style={{ display: "flex", gap: 6, marginBottom: 4 }}>
                <Input value={op.nome} onChange={e => {
                  const arr = [...item.adicionais]; const opts = [...arr[gi].opcoes]; opts[oi] = { ...op, nome: e.target.value }; arr[gi] = { ...arr[gi], opcoes: opts }; patch({ adicionais: arr });
                }} placeholder="Ex: Catupiry" style={{ flex: 1 }} />
                <Input type="number" step="0.01" value={op.preco} onChange={e => {
                  const arr = [...item.adicionais]; const opts = [...arr[gi].opcoes]; opts[oi] = { ...op, preco: e.target.value }; arr[gi] = { ...arr[gi], opcoes: opts }; patch({ adicionais: arr });
                }} placeholder="R$" style={{ width: 90 }} />
                <div onClick={() => {
                  const arr = [...item.adicionais]; arr[gi] = { ...arr[gi], opcoes: arr[gi].opcoes.filter(o => o.id !== op.id) }; patch({ adicionais: arr });
                }} style={{ cursor: "pointer", color: T.ink3, padding: 6 }}><X size={14} /></div>
              </div>
            ))}
            <Btn variant="ghost" style={{ fontSize: 11.5, padding: "4px 8px" }} icon={Plus} onClick={() => {
              const arr = [...item.adicionais]; arr[gi] = { ...arr[gi], opcoes: [...arr[gi].opcoes, { id: uid(), nome: "", preco: 0 }] }; patch({ adicionais: arr });
            }}>Opção</Btn>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
        <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
        <Btn variant="primary" icon={Save} onClick={handleSave} disabled={!item.nome.trim()}>Salvar item</Btn>
      </div>
    </ModalShell>
  );
}

/* -------------------- CONFIGURAR COM IA ---------------------------- */
// Normaliza a sugestão da IA para um formato sempre previsível
// (categorias/itens/perguntas sempre em array, itens sempre com os campos
// certos), mesmo que o modelo devolva um tipo errado (ex.: uma string solta
// em vez de lista). Sem isso, um desvio pequeno no formato quebrava a tela
// inteira ao tentar usar .map() em algo que não era array — o "bugar" que
// às vezes acontecia.
function normalizarSugestaoCardapio(json) {
  const paraListaDeTexto = v => Array.isArray(v)
    ? v.filter(x => typeof x === "string" && x.trim()).map(x => x.trim())
    : typeof v === "string" && v.trim() ? [v.trim()] : [];
  const itensBrutos = Array.isArray(json?.itens) ? json.itens : [];
  const itens = itensBrutos
    .map(it => (it && typeof it === "object") ? {
      categoria: typeof it.categoria === "string" ? it.categoria.trim() : "",
      nome: typeof it.nome === "string" ? it.nome.trim() : "",
      descricao: typeof it.descricao === "string" ? it.descricao.trim() : "",
      tipo: it.tipo === "servico" ? "servico" : "produto",
    } : null)
    .filter(it => it && it.nome); // item sem nome não serve pra nada — descarta
  return {
    categorias: paraListaDeTexto(json?.categorias),
    itens,
    perguntas: paraListaDeTexto(json?.perguntas),
  };
}

const normalizarNomeCat = s => String(s || "").toLowerCase().trim().replace(/\s+/g, " ");

function AIConfigModal({ lead, loja, setLoja, onClose, notify }) {
  const [descricao, setDescricao] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sugestao, setSugestao] = useState(null);

  async function gerar() {
    if (!descricao.trim()) return;
    setLoading(true); setError(""); setSugestao(null);
    const system = "Você ajuda a estruturar catálogos/cardápios para pequenos negócios brasileiros. Responda APENAS com um objeto JSON válido, sem markdown, com as chaves: categorias (array de strings, com emoji), itens (array de objetos {categoria, nome, descricao, tipo:'produto'|'servico'}), perguntas (array de strings com informações que faltam, como preços, ex: 'Qual o preço da Pizza Calabresa?'). NUNCA invente preços nem produtos reais que o usuário não mencionou — sugira apenas a partir do que foi descrito, e sempre pergunte pelos preços já que você não pode inventá-los.";
    const prompt = `Negócio: ${lead.empresa} (${lead.segmento})\nDescrição do administrador: "${descricao}"\nModelo de negócio atual: ${loja.modeloNegocio}\nSugira categorias e itens de catálogo/cardápio para esse negócio.`;
    try {
      const raw = await callClaude(prompt, system, 1200);
      const json = parseJsonRobusto(raw);
      if (!json) {
        throw new Error("A IA respondeu em um formato inesperado (não era um JSON válido). Tente novamente.");
      }
      const normalizado = normalizarSugestaoCardapio(json);
      if (normalizado.categorias.length === 0 && normalizado.itens.length === 0) {
        throw new Error("A IA não conseguiu sugerir nada a partir dessa descrição. Tente detalhar um pouco mais (ex.: quais produtos ou serviços o negócio oferece).");
      }
      setSugestao(normalizado);
    } catch (e) {
      setError(e.message || "Não foi possível gerar sugestões agora.");
    }
    setLoading(false);
  }

  function aplicar() {
    if (!sugestao) return;
    // Evita duplicar categorias que já existem na loja (por nome, sem
    // diferenciar maiúsculas/acentos/espaços) — sem isso, gerar sugestões
    // mais de uma vez ia empilhando categorias repetidas no cardápio.
    const existentesPorNome = new Map(loja.categorias.map(c => [normalizarNomeCat(c.nome), c.id]));
    const novasCategorias = [];
    const catIdPorNomeSugerido = {};
    for (const nome of sugestao.categorias) {
      const chave = normalizarNomeCat(nome);
      if (existentesPorNome.has(chave)) {
        catIdPorNomeSugerido[nome] = existentesPorNome.get(chave);
      } else {
        const nova = { id: uid(), nome };
        novasCategorias.push(nova);
        catIdPorNomeSugerido[nome] = nova.id;
        existentesPorNome.set(chave, nova.id);
      }
    }
    const todasCategorias = [...loja.categorias, ...novasCategorias];
    function findCatId(catNome) {
      const direct = catIdPorNomeSugerido[catNome];
      if (direct) return direct;
      const found = todasCategorias.find(c => c.nome.toLowerCase().includes((catNome || "").toLowerCase()) || (catNome || "").toLowerCase().includes(c.nome.toLowerCase()));
      return found?.id || todasCategorias[0]?.id;
    }
    // Evita duplicar itens com o mesmo nome que já existem na loja.
    const nomesExistentes = new Set(loja.itens.map(it => normalizarNomeCat(it.nome)));
    const novosItens = sugestao.itens
      .filter(it => !nomesExistentes.has(normalizarNomeCat(it.nome)))
      .map(it => ({
        ...emptyItem(findCatId(it.categoria), it.tipo),
        nome: it.nome,
        descricao: it.descricao,
        preco: "", // preço nunca é inventado — fica pendente para o administrador preencher
        disponivel: false, // fica indisponível até o preço ser definido
      }));
    if (novasCategorias.length === 0 && novosItens.length === 0) {
      notify("Nada novo para adicionar — as categorias e itens sugeridos já existem no cardápio.");
      onClose();
      return;
    }
    setLoja(prev => ({
      ...prev,
      categorias: [...prev.categorias, ...novasCategorias],
      itens: [...prev.itens, ...novosItens],
    }));
    notify(`${novosItens.length} ${novosItens.length === 1 ? "item adicionado" : "itens adicionados"} — defina os preços antes de disponibilizá-los`);
    onClose();
  }

  return (
    <ModalShell title="✨ Gerar cardápio com IA" onClose={onClose}>
      <p style={{ fontSize: 12.5, color: T.ink2, marginTop: -4, marginBottom: 14, lineHeight: 1.5 }}>
        Como funciona: descreva o negócio em uma frase → a IA sugere <b>categorias</b> e <b>itens</b> do cardápio →
        você revisa e clica em "Adicionar ao cardápio". Os itens entram <b>sem preço e desativados</b> — a IA nunca inventa
        valores, então você preenche o preço real de cada um antes de publicar.
      </p>
      <Field label="Descreva o negócio">
        <TextArea rows={3} value={descricao} onChange={e => setDescricao(e.target.value)} placeholder='Ex: "É uma pizzaria que vende pizzas, bebidas e sobremesas."' />
      </Field>
      <Btn variant="primary" icon={loading ? Loader2 : Sparkles} onClick={gerar} disabled={loading || !descricao.trim()} full>
        {loading ? "Gerando sugestões…" : sugestao ? "Gerar novamente" : "Gerar sugestões"}
      </Btn>
      {error && <div style={{ color: T.danger, fontSize: 12, marginTop: 8 }}>{error}</div>}

      {sugestao && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Categorias sugeridas ({sugestao.categorias.length})</div>
          {sugestao.categorias.length === 0 ? (
            <p style={{ fontSize: 12, color: T.ink3, marginBottom: 12 }}>Nenhuma categoria nova sugerida.</p>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
              {sugestao.categorias.map((c, i) => <Badge key={i}>{c}</Badge>)}
            </div>
          )}
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Itens sugeridos ({sugestao.itens.length})</div>
          {sugestao.itens.length === 0 ? (
            <p style={{ fontSize: 12, color: T.ink3, marginBottom: 12 }}>Nenhum item sugerido — só categorias.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }}>
              {sugestao.itens.map((it, i) => (
                <div key={i} style={{ fontSize: 12.5, color: T.ink2 }}>• <b>{it.nome}</b> — {it.categoria || "sem categoria"} {it.descricao ? `· ${it.descricao}` : ""}</div>
              ))}
            </div>
          )}
          {sugestao.perguntas.length > 0 && (
            <div style={{ background: T.goldSoft, borderRadius: 8, padding: 10, marginBottom: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 4 }}>Informações que a IA precisa de você:</div>
              {sugestao.perguntas.map((p, i) => <div key={i} style={{ fontSize: 12, color: T.ink2 }}>• {p}</div>)}
            </div>
          )}
          <p style={{ fontSize: 11.5, color: T.ink3, marginBottom: 10 }}>Os itens serão adicionados sem preço e marcados como indisponíveis — preencha os preços reais no cardápio antes de publicar.</p>
          <Btn variant="primary" icon={Check} onClick={aplicar} full>Adicionar ao cardápio</Btn>
        </div>
      )}
    </ModalShell>
  );
}

/* -------------------- IMPORTAR CSV/EXCEL ---------------------------- */
function ImportModal({ loja, setLoja, onClose, notify }) {
  const [resultado, setResultado] = useState(null);
  const [error, setError] = useState("");

  function processarLinhas(linhas) {
    let importados = 0, duplicados = 0, invalidos = 0;
    const catMap = Object.fromEntries(loja.categorias.map(c => [c.nome.toLowerCase().trim(), c.id]));
    const novasCategorias = [];
    const novosItens = [];
    const vistos = new Set(loja.itens.map(i => (i.nome || "").toLowerCase().trim() + "|" + i.categoriaId));

    linhas.forEach(row => {
      const categoria = (row.Categoria || row.categoria || "").trim();
      const nome = (row.Nome || row.nome || "").trim();
      const descricao = (row.Descrição || row.descricao || row.Descricao || "").trim();
      const precoRaw = (row.Preço ?? row.preco ?? row.Preco ?? "").toString().replace(",", ".").replace(/[^\d.]/g, "");
      const disponibilidade = (row.Disponibilidade || row.disponibilidade || "sim").toString().toLowerCase();
      if (!nome) return;

      const preco = parseFloat(precoRaw);
      if (!precoRaw || isNaN(preco)) { invalidos++; return; }

      let catId = catMap[categoria.toLowerCase()];
      if (!catId && categoria) {
        const existingNew = novasCategorias.find(c => c.nome.toLowerCase() === categoria.toLowerCase());
        if (existingNew) catId = existingNew.id;
        else { catId = uid(); novasCategorias.push({ id: catId, nome: categoria }); catMap[categoria.toLowerCase()] = catId; }
      }
      if (!catId) catId = loja.categorias[0]?.id;

      const key = nome.toLowerCase() + "|" + catId;
      if (vistos.has(key)) { duplicados++; return; }
      vistos.add(key);

      novosItens.push({
        ...emptyItem(catId, "produto"),
        nome, descricao, preco,
        disponivel: !["não", "nao", "no", "0", "false"].includes(disponibilidade),
        imagem: row.Imagem || row.imagem || "",
      });
      importados++;
    });

    setLoja(prev => ({ ...prev, categorias: [...prev.categorias, ...novasCategorias], itens: [...prev.itens, ...novosItens] }));
    setResultado({ importados, duplicados, invalidos });
    notify(`${importados} itens importados`);
  }

  function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    const ext = file.name.split(".").pop().toLowerCase();
    if (ext === "csv") {
      Papa.parse(file, {
        header: true, skipEmptyLines: true,
        complete: (res) => processarLinhas(res.data),
        error: () => setError("Não foi possível ler o arquivo CSV."),
      });
    } else if (ext === "xlsx" || ext === "xls") {
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const wb = XLSX.read(ev.target.result, { type: "array" });
          const sheet = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
          processarLinhas(rows);
        } catch (err) { setError("Não foi possível ler o arquivo Excel."); }
      };
      reader.readAsArrayBuffer(file);
    } else {
      setError("Formato não suportado. Envie um arquivo .csv ou .xlsx.");
    }
  }

  return (
    <ModalShell title="Importar cardápio (CSV / Excel)" onClose={onClose}>
      <p style={{ fontSize: 12.5, color: T.ink2, marginBottom: 10 }}>
        Colunas esperadas: <b>Categoria, Nome, Descrição, Preço, Imagem, Disponibilidade</b>. A primeira linha deve conter os cabeçalhos.
      </p>
      <label style={{
        display: "flex", flexDirection: "column", alignItems: "center", gap: 8, border: `1.5px dashed ${T.line}`,
        borderRadius: 10, padding: "28px 16px", cursor: "pointer", color: T.ink2
      }}>
        <Upload size={22} />
        <span style={{ fontSize: 13, fontWeight: 600 }}>Clique para escolher um arquivo .csv ou .xlsx</span>
        <input type="file" accept=".csv,.xlsx,.xls" onChange={onFile} style={{ display: "none" }} />
      </label>
      {error && <div style={{ color: T.danger, fontSize: 12, marginTop: 8 }}>{error}</div>}
      {resultado && (
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 13, color: T.accent, fontWeight: 700 }}>✅ {resultado.importados} produtos importados</div>
          {resultado.duplicados > 0 && <div style={{ fontSize: 13, color: T.gold }}>⚠️ {resultado.duplicados} duplicados ignorados</div>}
          {resultado.invalidos > 0 && <div style={{ fontSize: 13, color: T.danger }}>❌ {resultado.invalidos} com preço inválido (ignorados)</div>}
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
        <Btn variant="primary" onClick={onClose}>Concluir</Btn>
      </div>
    </ModalShell>
  );
}

/* -------------------- 9/10/12/20. VITRINE (visão do cliente) ------- */
function StorefrontPreview({ lead, loja, setLoja, notify, isMobile }) {
  const [catAtiva, setCatAtiva] = useState(loja.categorias[0]?.id || "");
  const [detalheItem, setDetalheItem] = useState(null);
  const [cart, setCart] = useState([]);
  const [showCart, setShowCart] = useState(false);
  const [checkout, setCheckout] = useState(false);
  const [confirmado, setConfirmado] = useState(null);

  useEffect(() => { if (!catAtiva && loja.categorias.length) setCatAtiva(loja.categorias[0].id); }, [loja.categorias]);

  const isAgendamento = loja.modeloNegocio === "Agendamento";
  const itensVisiveis = loja.itens.filter(i => i.categoriaId === catAtiva && i.disponivel !== false);

  function addToCart(cartItem) {
    setCart(prev => [...prev, cartItem]);
    setDetalheItem(null);
    notify(isAgendamento ? "Adicionado à seleção" : "Adicionado ao carrinho");
  }
  function removeFromCart(cartId) { setCart(prev => prev.filter(c => c.cartId !== cartId)); }
  function clearCart() { setCart([]); }
  function changeQty(cartId, dir) {
    setCart(prev => prev.map(c => {
      if (c.cartId !== cartId) return c;
      const q = Math.max(1, c.quantidade + dir);
      return { ...c, quantidade: q, subtotal: c.precoUnit * q };
    }));
  }

  function finalizar(dadosCliente) {
    const seq = (loja.pedidoSeq || 0) + 1;
    const numero = nextOrderNumber(loja.pedidoSeq);
    const order = {
      id: uid(), numero, data: Date.now(), status: "novo",
      tipo: isAgendamento ? "agendamento" : "pedido",
      cliente: dadosCliente.nome, telefone: dadosCliente.telefone,
      endereco: dadosCliente.endereco || "", observacaoGeral: dadosCliente.observacao || "",
      modoEntrega: dadosCliente.modoEntrega || "",
      itens: cart.map(c => ({
        nome: c.nome, quantidade: c.quantidade, subtotal: c.subtotal,
        variacoes: c.variacoes, adicionais: c.adicionais, observacao: c.observacao,
        profissional: c.profissional, data: c.dataAgendamento, horario: c.horario,
      })),
      subtotal: cartTotal(cart), total: cartTotal(cart),
    };
    const msg = buildOrderMessage(loja, lead, order);
    const phone = waPhoneLink(loja.whatsappLoja);
    setLoja(prev => ({ ...prev, pedidoSeq: seq, pedidos: [order, ...(prev.pedidos || [])] }));
    setConfirmado({ order, msg, phone });
    setCheckout(false);
    setShowCart(false);
    setCart([]);
    if (phone) window.open(waLink(phone, msg), "_blank");
  }

  if (!loja.whatsappLoja) {
    return (
      <div>
        <Empty icon={Phone} title="Configure o WhatsApp da loja" body='Vá até a aba "Meu cardápio" e informe o número de WhatsApp comercial antes de simular a loja para o cliente.' />
      </div>
    );
  }

  if (confirmado) {
    return (
      <Card style={{ maxWidth: 460, margin: "0 auto", textAlign: "center", padding: 28 }}>
        <CheckCircle2 size={40} color={T.accent} style={{ marginBottom: 10 }} />
        <div style={{ fontFamily: "Space Grotesk, sans-serif", fontWeight: 700, fontSize: 18, marginBottom: 4 }}>
          {isAgendamento ? "AGENDAMENTO ENVIADO!" : "PEDIDO ENVIADO!"}
        </div>
        <div style={{ fontSize: 13, color: T.ink2, marginBottom: 16 }}>
          {isAgendamento ? "Sua solicitação foi enviada para a loja." : "Seu pedido foi enviado para a loja."}
        </div>
        <div style={{ textAlign: "left", background: T.surface2, borderRadius: 10, padding: 14, fontSize: 12.5, whiteSpace: "pre-wrap", fontFamily: "IBM Plex Mono, monospace", marginBottom: 16 }}>
          {confirmado.msg}
        </div>
        <div style={{ fontWeight: 700, marginBottom: 16 }}>Pedido {confirmado.order.numero}</div>
        <Btn variant="primary" full onClick={() => setConfirmado(null)}>Voltar ao cardápio</Btn>
      </Card>
    );
  }

  return (
    <div style={{ position: "relative" }}>
      <Card style={{ marginBottom: 14, textAlign: "center" }}>
        <div style={{ fontFamily: "Space Grotesk, sans-serif", fontWeight: 700, fontSize: 17 }}>{lead.empresa}</div>
        <div style={{ fontSize: 12, color: T.ink2 }}>{lead.segmento} · {lead.cidade}/{lead.estado}</div>
      </Card>

      <div style={{ display: "flex", gap: 6, marginBottom: 14, overflowX: "auto", paddingBottom: 4 }}>
        {loja.categorias.map(c => (
          <div key={c.id} onClick={() => setCatAtiva(c.id)} style={{
            padding: "8px 14px", borderRadius: 999, fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", cursor: "pointer",
            background: catAtiva === c.id ? T.accent : T.surface2, color: catAtiva === c.id ? "#fff" : T.ink,
          }}>{c.nome}</div>
        ))}
      </div>

      {loja.categorias.length === 0 ? (
        <Empty icon={ClipboardList} title="Cardápio vazio" body='Adicione categorias e itens na aba "Meu cardápio".' />
      ) : itensVisiveis.length === 0 ? (
        <Empty icon={ClipboardList} title="Nenhum item disponível nesta categoria" body="Adicione itens ou marque como disponível na aba de cardápio." />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill,minmax(200px,1fr))", gap: 12, marginBottom: 90 }}>
          {itensVisiveis.map(item => (
            <Card key={item.id} onClick={() => setDetalheItem(item)} style={{ cursor: "pointer" }}>
              {item.imagem ? (
                <img src={item.imagem} alt="" style={{ width: "100%", height: 110, objectFit: "cover", borderRadius: 8, marginBottom: 8 }} />
              ) : (
                <div style={{ width: "100%", height: 90, background: T.surface2, borderRadius: 8, marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <ImageIcon size={22} color={T.ink3} />
                </div>
              )}
              <div style={{ fontWeight: 700, fontSize: 13.5, display: "flex", gap: 4, alignItems: "center" }}>
                {item.destaque && "⭐"} {item.nome}
              </div>
              {item.descricao && <div style={{ fontSize: 11.5, color: T.ink3, margin: "4px 0" }}>{item.descricao}</div>}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
                <div style={{ fontWeight: 700, color: T.accent, fontSize: 13.5 }}>{brl(item.preco)}</div>
                {item.tempoEstimado && <Badge>{item.tempoEstimado}</Badge>}
              </div>
            </Card>
          ))}
        </div>
      )}

      {cart.length > 0 && !checkout && (
        <div onClick={() => setShowCart(true)} style={{
          position: "fixed", bottom: isMobile ? 76 : 20, left: "50%", transform: "translateX(-50%)",
          background: T.accent, color: "#fff", padding: "12px 22px", borderRadius: 999, cursor: "pointer",
          display: "flex", alignItems: "center", gap: 10, fontWeight: 700, fontSize: 13.5, boxShadow: "0 8px 20px rgba(0,0,0,.2)", zIndex: 40
        }}>
          <ShoppingCart size={17} />
          {isAgendamento ? "Minha seleção" : "Carrinho"} ({cart.length}) · {brl(cartTotal(cart))}
        </div>
      )}

      {detalheItem && (
        <ItemDetailModal item={detalheItem} isAgendamento={isAgendamento} onAdd={addToCart} onClose={() => setDetalheItem(null)} />
      )}

      {showCart && !checkout && (
        <CartDrawer
          cart={cart} isAgendamento={isAgendamento}
          onRemove={removeFromCart} onQty={changeQty} onClear={clearCart}
          onClose={() => setShowCart(false)}
          onCheckout={() => { setShowCart(false); setCheckout(true); }}
        />
      )}

      {checkout && (
        <CheckoutForm
          lead={lead} loja={loja} isAgendamento={isAgendamento} cart={cart}
          onBack={() => { setCheckout(false); setShowCart(true); }}
          onConfirm={finalizar}
        />
      )}
    </div>
  );
}

function ItemDetailModal({ item, isAgendamento, onAdd, onClose }) {
  const [variacoesSel, setVariacoesSel] = useState({}); // grupoId -> opcao
  const [adicionaisSel, setAdicionaisSel] = useState({}); // opcaoId -> {grupoNome, nome, preco}
  const [quantidade, setQuantidade] = useState(1);
  const [observacao, setObservacao] = useState("");
  const [profissional, setProfissional] = useState("");
  const [dataAgendamento, setDataAgendamento] = useState("");
  const [horario, setHorario] = useState("");

  const variacoesEscolhidas = Object.entries(variacoesSel).map(([grupoId, op]) => ({ grupoId, opcaoNome: op.nome, precoExtra: Number(op.precoExtra) || 0 }));
  const adicionaisEscolhidos = Object.values(adicionaisSel);
  const { unit } = calcItemPrecoUnit(item, { variacoes: variacoesEscolhidas, adicionais: adicionaisEscolhidos });

  function toggleAdicional(op, grupoNome) {
    setAdicionaisSel(prev => {
      const next = { ...prev };
      if (next[op.id]) delete next[op.id];
      else next[op.id] = { nome: `${op.nome}`, preco: Number(op.preco) || 0 };
      return next;
    });
  }

  function confirmar() {
    onAdd({
      cartId: uid(), itemId: item.id, nome: item.nome,
      quantidade: isAgendamento ? 1 : quantidade,
      precoUnit: unit, subtotal: unit * (isAgendamento ? 1 : quantidade),
      variacoes: variacoesEscolhidas, adicionais: adicionaisEscolhidos,
      observacao, profissional: isAgendamento ? profissional : undefined,
      dataAgendamento: isAgendamento ? dataAgendamento : undefined,
      horario: isAgendamento ? horario : undefined,
    });
  }

  return (
    <ModalShell title={item.nome} onClose={onClose}>
      {item.imagem && <img src={item.imagem} alt="" style={{ width: "100%", height: 160, objectFit: "cover", borderRadius: 10, marginBottom: 12 }} />}
      {item.descricao && <p style={{ fontSize: 13, color: T.ink2, marginBottom: 10 }}>{item.descricao}</p>}
      <div style={{ fontWeight: 700, color: T.accent, fontSize: 16, marginBottom: 14 }}>{brl(item.preco)}</div>

      {item.variacoes?.map(grupo => (
        <Field key={grupo.id} label={grupo.nome}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {grupo.opcoes.map(op => (
              <div key={op.id} onClick={() => setVariacoesSel(prev => ({ ...prev, [grupo.id]: op }))} style={{
                padding: "7px 12px", borderRadius: 999, fontSize: 12.5, cursor: "pointer",
                border: `1px solid ${variacoesSel[grupo.id]?.id === op.id ? T.accent : T.line}`,
                background: variacoesSel[grupo.id]?.id === op.id ? T.accentSoft : "#fff",
                color: variacoesSel[grupo.id]?.id === op.id ? T.accentDark : T.ink,
              }}>{op.nome}{Number(op.precoExtra) > 0 ? ` (+${brl(op.precoExtra)})` : ""}</div>
            ))}
          </div>
        </Field>
      ))}

      {item.adicionais?.map(grupo => (
        <Field key={grupo.id} label={grupo.nome}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {grupo.opcoes.map(op => (
              <label key={op.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13, cursor: "pointer" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input type="checkbox" checked={!!adicionaisSel[op.id]} onChange={() => toggleAdicional(op, grupo.nome)} />
                  {op.nome}
                </span>
                <span style={{ color: T.ink2 }}>{Number(op.preco) > 0 ? `+${brl(op.preco)}` : "grátis"}</span>
              </label>
            ))}
          </div>
        </Field>
      ))}

      {isAgendamento && (
        <>
          <Field label="Profissional (opcional)"><Input value={profissional} onChange={e => setProfissional(e.target.value)} placeholder="Ex: Ana" /></Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label="Data"><Input type="date" value={dataAgendamento} onChange={e => setDataAgendamento(e.target.value)} /></Field>
            <Field label="Horário"><Input type="time" value={horario} onChange={e => setHorario(e.target.value)} /></Field>
          </div>
        </>
      )}

      {!isAgendamento && (
        <Field label="Quantidade">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div onClick={() => setQuantidade(q => Math.max(1, q - 1))} style={{ cursor: "pointer", padding: 6, background: T.surface2, borderRadius: 8 }}><Minus size={16} /></div>
            <div style={{ fontWeight: 700, minWidth: 20, textAlign: "center" }}>{quantidade}</div>
            <div onClick={() => setQuantidade(q => q + 1)} style={{ cursor: "pointer", padding: 6, background: T.surface2, borderRadius: 8 }}><Plus size={16} /></div>
          </div>
        </Field>
      )}

      <Field label="Observação (opcional)"><TextArea rows={2} value={observacao} onChange={e => setObservacao(e.target.value)} placeholder="Ex: sem cebola" /></Field>

      <Btn variant="primary" full onClick={confirmar} disabled={isAgendamento && (!dataAgendamento || !horario)}>
        Adicionar {isAgendamento ? "" : `· ${brl(unit * quantidade)}`}
      </Btn>
    </ModalShell>
  );
}

function CartDrawer({ cart, isAgendamento, onRemove, onQty, onClear, onClose, onCheckout }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(20,23,28,.5)", display: "flex", justifyContent: "flex-end", zIndex: 90 }}>
      <div style={{ background: "#fff", width: "min(420px,100%)", height: "100%", padding: 18, overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{isAgendamento ? "Minha seleção" : "Carrinho"}</div>
          <div onClick={onClose} style={{ cursor: "pointer" }}><X size={20} /></div>
        </div>
        {cart.length === 0 ? (
          <Empty icon={ShoppingCart} title="Vazio" body="Adicione itens para continuar." />
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
              {cart.map(c => (
                <div key={c.cartId} style={{ border: `1px solid ${T.line}`, borderRadius: 10, padding: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{c.nome}</div>
                    <div onClick={() => onRemove(c.cartId)} style={{ cursor: "pointer", color: T.danger }}><Trash2 size={15} /></div>
                  </div>
                  {c.variacoes?.length > 0 && <div style={{ fontSize: 11.5, color: T.ink2 }}>{c.variacoes.map(v => v.opcaoNome).join(", ")}</div>}
                  {c.adicionais?.length > 0 && <div style={{ fontSize: 11.5, color: T.ink2 }}>+ {c.adicionais.map(a => a.nome).join(", +")}</div>}
                  {c.profissional && <div style={{ fontSize: 11.5, color: T.ink2 }}>Profissional: {c.profissional}</div>}
                  {c.dataAgendamento && <div style={{ fontSize: 11.5, color: T.ink2 }}>{c.dataAgendamento} às {c.horario}</div>}
                  {c.observacao && <div style={{ fontSize: 11.5, color: T.ink3, fontStyle: "italic" }}>Obs: {c.observacao}</div>}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                    {!isAgendamento ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div onClick={() => onQty(c.cartId, -1)} style={{ cursor: "pointer", padding: 4, background: T.surface2, borderRadius: 6 }}><Minus size={13} /></div>
                        <span style={{ fontSize: 12.5, fontWeight: 700 }}>{c.quantidade}</span>
                        <div onClick={() => onQty(c.cartId, 1)} style={{ cursor: "pointer", padding: 4, background: T.surface2, borderRadius: 6 }}><Plus size={13} /></div>
                      </div>
                    ) : <span />}
                    <div style={{ fontWeight: 700, color: T.accent, fontSize: 13 }}>{brl(c.subtotal)}</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 15, marginBottom: 14 }}>
              <span>TOTAL</span><span>{brl(cartTotal(cart))}</span>
            </div>
            <Btn variant="primary" full onClick={onCheckout} style={{ marginBottom: 8 }}>
              {isAgendamento ? "📅 Solicitar agendamento" : "📦 Finalizar pedido"}
            </Btn>
            <Btn variant="ghost" full onClick={onClear}>Limpar {isAgendamento ? "seleção" : "carrinho"}</Btn>
          </>
        )}
      </div>
    </div>
  );
}

function CheckoutForm({ lead, loja, isAgendamento, cart, onBack, onConfirm }) {
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [endereco, setEndereco] = useState("");
  const [observacao, setObservacao] = useState("");
  const [modoEntrega, setModoEntrega] = useState("Entrega");

  const precisaEndereco = !isAgendamento && modoEntrega === "Entrega";
  const podeEnviar = nome.trim() && telefone.trim() && (!precisaEndereco || endereco.trim());

  return (
    <ModalShell title={isAgendamento ? "📅 Solicitação de agendamento" : "📦 Finalizar pedido"} onClose={onBack}>
      <Field label="Nome"><Input value={nome} onChange={e => setNome(e.target.value)} placeholder="Seu nome" /></Field>
      <Field label="Telefone / WhatsApp"><Input value={telefone} onChange={e => setTelefone(e.target.value)} placeholder="(79) 90000-0000" /></Field>

      {!isAgendamento && (
        <Field label="Como deseja receber?">
          <div style={{ display: "flex", gap: 14 }}>
            {["Entrega", "Retirada"].map(op => (
              <label key={op} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                <input type="radio" checked={modoEntrega === op} onChange={() => setModoEntrega(op)} /> {op}
              </label>
            ))}
          </div>
        </Field>
      )}
      {precisaEndereco && (
        <Field label="Endereço"><Input value={endereco} onChange={e => setEndereco(e.target.value)} placeholder="Rua, número, bairro" /></Field>
      )}
      <Field label="Observação (opcional)"><TextArea rows={2} value={observacao} onChange={e => setObservacao(e.target.value)} /></Field>

      <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 15, margin: "12px 0" }}>
        <span>TOTAL</span><span>{brl(cartTotal(cart))}</span>
      </div>
      {!loja.pagamentoOnline && (
        <div style={{ fontSize: 11.5, color: T.ink3, marginBottom: 12 }}>Pagamento combinado diretamente com a loja — nenhuma cobrança é feita neste site.</div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <Btn variant="ghost" onClick={onBack}>Voltar</Btn>
        <Btn variant="whatsapp" icon={Send} full disabled={!podeEnviar} onClick={() => onConfirm({ nome, telefone, endereco, observacao, modoEntrega: isAgendamento ? "" : modoEntrega })}>
          💬 Enviar pelo WhatsApp
        </Btn>
      </div>
    </ModalShell>
  );
}

/* -------------------- 17/18/19. PAINEL DA LOJA ---------------------- */
function ReciboPrintArea({ lead, pedido }) {
  if (!pedido) return <div className="print-area" />;
  return (
    <div className="print-area">
      <div style={{ padding: 24, fontFamily: "Inter, sans-serif", color: "#000" }}>
        <h2 style={{ margin: "0 0 4px" }}>{lead.empresa || "Não informado"}</h2>
        {lead.endereco && <div style={{ fontSize: 12 }}>{lead.endereco}{lead.cidade ? `, ${lead.cidade}${lead.estado ? `/${lead.estado}` : ""}` : ""}</div>}
        {lead.telefone && <div style={{ fontSize: 12 }}>Tel: {lead.telefone}</div>}
        <hr style={{ margin: "14px 0" }} />
        <div style={{ fontSize: 13, fontWeight: 700 }}>Pedido {pedido.numero}</div>
        <div style={{ fontSize: 12 }}>{new Date(pedido.data).toLocaleString("pt-BR")}</div>
        <div style={{ fontSize: 12 }}>Cliente: {pedido.cliente || "Não informado"} · {pedido.telefone || "Não informado"}</div>
        {pedido.modoEntrega && <div style={{ fontSize: 12 }}>{pedido.modoEntrega}{pedido.endereco ? `: ${pedido.endereco}` : ""}</div>}
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 14, fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #000" }}>
              <th style={{ textAlign: "left", padding: "4px 0" }}>Item</th>
              <th style={{ textAlign: "right", padding: "4px 0" }}>Valor</th>
            </tr>
          </thead>
          <tbody>
            {(pedido.itens || []).map((it, i) => (
              <tr key={i}>
                <td style={{ padding: "3px 0" }}>{pedido.tipo === "agendamento" ? "" : `${it.quantidade}x `}{it.nome}</td>
                <td style={{ padding: "3px 0", textAlign: "right" }}>{brl(it.subtotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {pedido.observacaoGeral && <div style={{ fontSize: 12, marginTop: 8, fontStyle: "italic" }}>Obs: {pedido.observacaoGeral}</div>}
        <div style={{ fontWeight: 700, marginTop: 12, fontSize: 14, borderTop: "1px solid #000", paddingTop: 8 }}>TOTAL: {brl(pedido.total)}</div>
      </div>
    </div>
  );
}

function PainelLoja({ lead, loja, setLoja, notify }) {
  const prevCount = useRef((loja.pedidos || []).length);
  const [printPedido, setPrintPedido] = useState(null);
  useEffect(() => {
    const count = (loja.pedidos || []).length;
    if (count > prevCount.current && loja.somNotificacao) beep();
    prevCount.current = count;
  }, [loja.pedidos, loja.somNotificacao]);

  useEffect(() => {
    if (printPedido) {
      const t = setTimeout(() => { window.print(); setPrintPedido(null); }, 80);
      return () => clearTimeout(t);
    }
  }, [printPedido]);

  const pedidos = loja.pedidos || [];
  const grupos = {
    novos: pedidos.filter(p => STATUS_MAP[p.status]?.group === "novos"),
    andamento: pedidos.filter(p => STATUS_MAP[p.status]?.group === "andamento"),
    concluidos: pedidos.filter(p => STATUS_MAP[p.status]?.group === "concluidos"),
    cancelados: pedidos.filter(p => STATUS_MAP[p.status]?.group === "cancelados"),
  };

  function changeStatus(id, status) {
    setLoja(prev => ({ ...prev, pedidos: prev.pedidos.map(p => p.id === id ? { ...p, status } : p) }));
    notify("Status atualizado");
  }

  return (
    <div>
      <ReciboPrintArea lead={lead} pedido={printPedido} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10, marginBottom: 18 }}>
        <Card style={{ textAlign: "center" }}><div style={{ fontSize: 22, fontWeight: 700 }}>🆕 {grupos.novos.length}</div><div style={{ fontSize: 12, color: T.ink2 }}>Novos</div></Card>
        <Card style={{ textAlign: "center" }}><div style={{ fontSize: 22, fontWeight: 700 }}>🔄 {grupos.andamento.length}</div><div style={{ fontSize: 12, color: T.ink2 }}>Em andamento</div></Card>
        <Card style={{ textAlign: "center" }}><div style={{ fontSize: 22, fontWeight: 700 }}>✅ {grupos.concluidos.length}</div><div style={{ fontSize: 12, color: T.ink2 }}>Concluídos</div></Card>
        <Card style={{ textAlign: "center" }}><div style={{ fontSize: 22, fontWeight: 700 }}>🚫 {grupos.cancelados.length}</div><div style={{ fontSize: 12, color: T.ink2 }}>Cancelados</div></Card>
      </div>

      {pedidos.length === 0 ? (
        <Empty icon={ClipboardList} title="Nenhum pedido ainda" body='Simule um pedido na aba "Ver como cliente" para ver o painel em ação.' />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {pedidos.map(p => (
            <Card key={p.id}>
              <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>{STATUS_MAP[p.status]?.icon} Pedido {p.numero} · {p.cliente}</div>
                  <div style={{ fontSize: 11.5, color: T.ink3 }}>{new Date(p.data).toLocaleString("pt-BR")} · {p.telefone}</div>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <Btn variant="outline" icon={FileSpreadsheet} onClick={() => setPrintPedido(p)}>Imprimir</Btn>
                  <Select value={p.status} onChange={e => changeStatus(p.id, e.target.value)} style={{ width: 180 }}>
                    {STATUS_PEDIDO.map(s => <option key={s.id} value={s.id}>{s.icon} {s.label}</option>)}
                  </Select>
                </div>
              </div>
              <div style={{ fontSize: 12.5, color: T.ink2, marginBottom: 4 }}>
                {p.itens.map((it, i) => (
                  <div key={i}>{p.tipo === "agendamento" ? "" : `${it.quantidade}x `}{it.nome} — {brl(it.subtotal)}</div>
                ))}
              </div>
              {p.modoEntrega && <div style={{ fontSize: 12, color: T.ink3 }}>{p.modoEntrega}{p.endereco ? `: ${p.endereco}` : ""}</div>}
              {p.observacaoGeral && <div style={{ fontSize: 12, color: T.ink3, fontStyle: "italic" }}>Obs: {p.observacaoGeral}</div>}
              <div style={{ fontWeight: 700, marginTop: 6 }}>TOTAL: {brl(p.total)}</div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/* ==================================================================== */
/* ANALYTICS                                                              */
/* ==================================================================== */
const PIE_COLORS = [T.accent, T.gold, T.warn, T.danger, "#1D4ED8", T.ink3];

function AnalyticsView({ leads }) {
  const bySegmento = useMemo(() => {
    const m = {};
    leads.forEach(l => { m[l.segmento] = (m[l.segmento] || 0) + 1; });
    return Object.entries(m).map(([name, v]) => ({ name, v })).sort((a, b) => b.v - a.v).slice(0, 8);
  }, [leads]);

  const byCidade = useMemo(() => {
    const m = {};
    leads.forEach(l => { const k = `${l.cidade}/${l.estado}`; m[k] = (m[k] || 0) + 1; });
    return Object.entries(m).map(([name, v]) => ({ name, v })).sort((a, b) => b.v - a.v).slice(0, 8);
  }, [leads]);

  const byStatus = useMemo(() => {
    return KANBAN_STAGES.map(s => ({ name: s.label, v: leads.filter(l => l.status === s.id).length })).filter(s => s.v > 0);
  }, [leads]);

  if (leads.length === 0) return <Empty icon={BarChart3} title="Sem dados ainda" body="Pesquise e trabalhe leads para ver suas métricas aqui." />;

  return (
    <div>
      <h1 style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: 20, margin: "0 0 16px" }}>Estatísticas</h1>
      <div style={{ display: "grid", gridTemplateColumns: window.innerWidth < 860 ? "1fr" : "1fr 1fr", gap: 16 }}>
        <Card>
          <div style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 10 }}>Leads por segmento</div>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bySegmento} layout="vertical" margin={{ left: 10 }}>
                <XAxis type="number" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis dataKey="name" type="category" width={90} tick={{ fontSize: 10.5 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Bar dataKey="v" fill={T.accent} radius={[0, 5, 5, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card>
          <div style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 10 }}>Leads por cidade</div>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byCidade} layout="vertical" margin={{ left: 10 }}>
                <XAxis type="number" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis dataKey="name" type="category" width={90} tick={{ fontSize: 10.5 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Bar dataKey="v" fill={T.gold} radius={[0, 5, 5, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card style={{ gridColumn: window.innerWidth < 860 ? "auto" : "1 / -1" }}>
          <div style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 10 }}>Distribuição por status (Kanban)</div>
          <div style={{ height: 240, display: "flex", alignItems: "center" }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={byStatus} dataKey="v" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={{ fontSize: 10 }}>
                  {byStatus.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ==================================================================== */
/* CONFIG                                                                 */
/* ==================================================================== */
function ConfigView({ profile, setProfile, offer, setOffer, notify }) {
  const [tab, setTab] = useState("perfil");
  const [aiStatus, setAiStatus] = useState({ loading: true });
  const [placesStatus, setPlacesStatus] = useState({ loading: true });
  const tabs = [["perfil", "Meu perfil"], ["oferta", "Minha oferta"], ["integracoes", "Integrações"]];

  useEffect(() => {
    let alive = true;
    fetch("/api/generate").then(r => r.json()).then(d => { if (alive) setAiStatus({ loading: false, ...d }); })
      .catch(() => { if (alive) setAiStatus({ loading: false, configured: false, erro: true }); });
    fetch("/api/places").then(r => r.json()).then(d => { if (alive) setPlacesStatus({ loading: false, ...d }); })
      .catch(() => { if (alive) setPlacesStatus({ loading: false, configured: false, erro: true }); });
    return () => { alive = false; };
  }, []);

  return (
    <div>
      <h1 style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: 20, margin: "0 0 14px" }}>Configurações</h1>
      <div style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: `1px solid ${T.line}` }}>
        {tabs.map(([id, label]) => (
          <div key={id} onClick={() => setTab(id)} style={{
            padding: "9px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer",
            color: tab === id ? T.accent : T.ink2, borderBottom: tab === id ? `2px solid ${T.accent}` : "2px solid transparent"
          }}>{label}</div>
        ))}
      </div>

      {tab === "perfil" && (
        <Card style={{ maxWidth: 480 }}>
          <Field label="Nome"><Input value={profile.nome} onChange={e => setProfile(p => ({ ...p, nome: e.target.value }))} /></Field>
          <Field label="E-mail"><Input value={profile.email} onChange={e => setProfile(p => ({ ...p, email: e.target.value }))} /></Field>
          <Field label="Telefone"><Input value={profile.telefone} onChange={e => setProfile(p => ({ ...p, telefone: e.target.value }))} /></Field>
          <Field label="WhatsApp"><Input value={profile.whatsapp} onChange={e => setProfile(p => ({ ...p, whatsapp: e.target.value }))} /></Field>
          <Field label="Empresa"><Input value={profile.empresa} onChange={e => setProfile(p => ({ ...p, empresa: e.target.value }))} /></Field>
          <Field label="Instagram"><Input value={profile.instagram} onChange={e => setProfile(p => ({ ...p, instagram: e.target.value }))} /></Field>
          <Field label="Site"><Input value={profile.site} onChange={e => setProfile(p => ({ ...p, site: e.target.value }))} /></Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label="Cidade"><Input value={profile.cidade} onChange={e => setProfile(p => ({ ...p, cidade: e.target.value }))} /></Field>
            <Field label="Estado"><Input value={profile.estado} onChange={e => setProfile(p => ({ ...p, estado: e.target.value }))} /></Field>
          </div>
          <Btn variant="primary" onClick={() => notify("Perfil salvo")}>Salvar perfil</Btn>
        </Card>
      )}

      {tab === "oferta" && (
        <Card style={{ maxWidth: 480 }}>
          <Field label="Serviço principal"><Input value={offer.servicoPrincipal} onChange={e => setOffer(o => ({ ...o, servicoPrincipal: e.target.value }))} /></Field>
          <Field label="Serviços (separados por vírgula)"><TextArea rows={2} value={offer.servicos} onChange={e => setOffer(o => ({ ...o, servicos: e.target.value }))} /></Field>
          <Field label="Descrição da oferta"><TextArea rows={3} value={offer.descricao} onChange={e => setOffer(o => ({ ...o, descricao: e.target.value }))} /></Field>
          <Field label="Preço inicial (opcional)"><Input value={offer.precoInicial} onChange={e => setOffer(o => ({ ...o, precoInicial: e.target.value }))} /></Field>
          <Field label="Diferenciais"><TextArea rows={2} value={offer.diferenciais} onChange={e => setOffer(o => ({ ...o, diferenciais: e.target.value }))} /></Field>
          <Field label="Tom de comunicação">
            <Select value={offer.tom} onChange={e => setOffer(o => ({ ...o, tom: e.target.value }))}>
              <option>Profissional</option><option>Casual</option><option>Direto</option><option>Persuasivo</option><option>Premium</option>
            </Select>
          </Field>
          <p style={{ fontSize: 11.5, color: T.ink3, marginBottom: 12 }}>A IA usa essas informações para gerar mensagens e sites personalizados.</p>
          <Btn variant="primary" onClick={() => notify("Oferta salva")}>Salvar oferta</Btn>
        </Card>
      )}

      {tab === "integracoes" && (
        <div style={{ display: "grid", gap: 10, maxWidth: 480 }}>
          <IntegrationRow name="IA (Groq / Gemini / OpenAI)"
            status={aiStatus.loading ? "checking" : aiStatus.configured ? "ok" : "off"}
            note={aiStatus.loading ? "Verificando…" : aiStatus.configured ? `Conectada · ${(aiStatus.providers || []).map(p => `${p.nome} (${p.model})`).join(", ") || aiStatus.model}` : "Nenhuma chave de IA configurada no servidor (GROQ_API_KEY, GEMINI_API_KEY ou OPENAI_API_KEY). Sem elas, geração de mensagens/prompts/sites falha com erro real."} />
          <IntegrationRow name="Google Places (busca de leads)"
            status={placesStatus.loading ? "checking" : placesStatus.configured ? "ok" : "off"}
            note={placesStatus.loading ? "Verificando…" : placesStatus.configured ? "Conectada · buscando empresas reais" : "GOOGLE_MAPS_KEY não configurada no servidor. Sem ela, a busca de leads não retorna resultados."} />
          <IntegrationRow name="Google Maps (mapa incorporado)"
            status={GOOGLE_MAPS_EMBED_KEY ? "ok" : "off"}
            note={GOOGLE_MAPS_EMBED_KEY ? "VITE_GOOGLE_MAPS_KEY configurada" : "VITE_GOOGLE_MAPS_KEY não configurada — o mapa mostrará apenas link externo para o Google Maps"} />
          <IntegrationRow name="Supabase (login e dados)"
            status={isSupabaseConfigured ? "ok" : "off"}
            note={isSupabaseConfigured ? "Conectado — autenticação real" : "VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY não configuradas — usando modo local sem persistência"} />
          <IntegrationRow name="WhatsApp" status="ok" note="Abertura via wa.me — sem necessidade de WhatsApp Business API" />
        </div>
      )}
    </div>
  );
}

function IntegrationRow({ name, status, note }) {
  const map = {
    ok: { label: "Conectado", color: T.accent, bg: T.accentSoft, dot: "🟢" },
    checking: { label: "Verificando", color: T.ink2, bg: T.surface2, dot: "⏳" },
    config: { label: "Configurar", color: T.gold, bg: T.goldSoft, dot: "🟡" },
    off: { label: "Não configurado", color: T.danger, bg: T.dangerSoft, dot: "🔴" },
  }[status];
  return (
    <Card style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: 13.5 }}>{name}</div>
        <div style={{ fontSize: 11.5, color: T.ink2 }}>{note}</div>
      </div>
      <Badge color={map.color} bg={map.bg}>{map.dot} {map.label}</Badge>
    </Card>
  );
}
