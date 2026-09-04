// src/lib/supabaseClient.js
//
// Cliente do Supabase usado para autenticação real (login, cadastro,
// recuperação de senha) e para persistir o perfil do usuário logado.
//
// As duas variáveis abaixo usam o prefixo VITE_ de propósito: a "anon key"
// do Supabase é uma chave pública, feita para ser usada no navegador (a
// segurança de verdade vem das políticas de Row Level Security definidas em
// supabase/schema.sql — nunca da chave em si ficar "escondida"). Isso é
// diferente da ANTHROPIC_API_KEY, que é secreta e por isso fica só no
// servidor (veja api/generate.js).
//
// Se essas variáveis não estiverem configuradas, o app cai automaticamente
// em modo de demonstração (autenticação local, sem backend real) — nada
// quebra, mas os dados não ficam disponíveis em outros dispositivos/navegadores.

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

// Traduz as mensagens de erro mais comuns do Supabase Auth para PT-BR,
// mantendo a mensagem original como fallback para casos não mapeados.
export function traduzErroAuth(err) {
  const msg = err?.message || "";
  const map = [
    [/invalid login credentials/i, "E-mail ou senha incorretos."],
    [/email not confirmed/i, "Confirme seu e-mail antes de entrar (verifique sua caixa de entrada)."],
    [/user already registered/i, "Já existe uma conta com este e-mail."],
    [/password should be at least/i, "A senha precisa ter pelo menos 6 caracteres."],
    [/unable to validate email address/i, "E-mail inválido."],
    [/rate limit/i, "Muitas tentativas. Aguarde alguns instantes e tente novamente."],
    [/network/i, "Falha de conexão. Verifique sua internet e tente novamente."],
  ];
  for (const [re, pt] of map) {
    if (re.test(msg)) return pt;
  }
  // Fallback: nenhum padrão conhecido bateu — a causa técnica (que pode vir
  // em inglês, direto do Supabase) fica só no console para diagnóstico;
  // o usuário sempre vê uma mensagem em português.
  if (msg) console.warn("[traduzErroAuth] erro do Supabase sem tradução mapeada:", msg);
  return "Não foi possível concluir a operação. Tente novamente.";
}
