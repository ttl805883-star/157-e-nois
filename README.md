# VibeLeads AI

Projeto Vite + React pronto para deploy, empacotado a partir do componente `VibeLeadsAI.jsx` original.

## Estrutura

```
vibeleads-ai/
├── api/
│   ├── generate.js         # Função serverless (Vercel) — proxy seguro para a API da OpenAI
│   └── places.js           # Função serverless (Vercel) — proxy seguro para a Google Places API (busca real de leads)
├── public/
│   └── favicon.svg
├── src/
│   ├── App.jsx              # Renderiza <VibeLeadsAI />
│   ├── VibeLeadsAI.jsx      # Componente principal do app
│   ├── lib/
│   │   └── supabaseClient.js  # Cliente Supabase (login real) com fallback de demonstração
│   ├── index.css
│   └── main.jsx              # Ponto de entrada React
├── supabase/
│   └── schema.sql           # SQL do banco (tabela de perfis + RLS + trigger)
├── .env.example
├── .gitignore
├── index.html
├── package.json
└── vite.config.js
```

## Rodando localmente

```bash
npm install
npm run dev
```

## Build de produção

```bash
npm run build
npm run preview   # opcional, para testar o build localmente
```

## Deploy na Vercel

1. Suba esta pasta para um repositório no GitHub.
2. Na Vercel: **Add New… → Project → Import** o repositório.
3. Framework preset "Vite" é detectado automaticamente — não é preciso configurar nada manualmente (build command `vite build`, output `dist`, e a função em `api/generate.js` são reconhecidos sem configuração extra).
4. Configure as variáveis de ambiente (veja abaixo).
5. Deploy.

## Login real com Supabase

O app agora suporta autenticação real (cadastro, login, "esqueci minha senha" e logout) via [Supabase Auth](https://supabase.com/auth), com **fallback automático para um modo de demonstração** quando o Supabase não está configurado — nada quebra se você ainda não configurou nada.

### Como ativar

1. Crie um projeto gratuito em [supabase.com](https://supabase.com).
2. Abra **SQL Editor** no painel do projeto, cole o conteúdo de `supabase/schema.sql` e rode. Isso cria:
   - a tabela `public.profiles` (perfil + oferta de cada usuário);
   - as políticas de Row Level Security (cada usuário só acessa a própria linha);
   - um trigger que cria automaticamente o perfil assim que alguém se cadastra.
3. Em **Settings → API**, copie a **Project URL** e a **anon public key**.
4. Copie `.env.example` para `.env` e preencha:
   ```
   VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
   VITE_SUPABASE_ANON_KEY=sua-anon-key
   ```
5. (Opcional, recomendado) Em **Authentication → Providers → Email**, decida se quer exigir confirmação por e-mail antes do primeiro login — o app já trata os dois casos (com e sem confirmação).
6. Rode `npm run dev` novamente (ou faça o deploy) — o app detecta as variáveis automaticamente e passa a usar login real.

### Sem configurar o Supabase

O app continua funcionando 100% em modo de demonstração: a tela de login aceita qualquer e-mail/senha e guarda a sessão apenas no navegador (`localStorage`), exatamente como antes. Um aviso discreto aparece na tela de login informando que é um ambiente de demonstração.

### O que fica em cada lugar

- **Autenticação** (e-mail/senha, sessão, recuperação de senha): Supabase Auth.
- **Perfil e oferta** (nome, telefone, WhatsApp, empresa, respostas do onboarding): sincronizados com a tabela `public.profiles` no Supabase quando configurado, e sempre também salvos em `localStorage` como cache local.
- **Leads, feedbacks, buscas salvas, loja/pedidos**: continuam em `localStorage`, agora isolados por usuário (cada conta tem seus próprios dados no mesmo navegador).

## Geração por IA (mensagens, prompts, sites, leitura de fotos de cardápio)

Sem configurar nada, esses botões mostram o motivo real do erro (nunca "Não foi possível gerar agora" genérico). O backend suporta três provedores encadeados — configure pelo menos um:

| Provedor | Custo | Onde criar a chave | Variável |
|---|---|---|---|
| Groq | Grátis, sem cartão | console.groq.com | `GROQ_API_KEY` |
| Gemini | Grátis | aistudio.google.com/apikey | `GEMINI_API_KEY` |
| OpenAI | Pago por uso | platform.openai.com/api-keys | `OPENAI_API_KEY` |

Se mais de um estiver configurado, a ordem de tentativa é sempre **Groq → Gemini → OpenAI** — os dois primeiros são gratuitos; a OpenAI entra só como garantia final se os dois gratuitos falharem (limite de uso, indisponibilidade, etc.).

1. **Localmente:** preencha as chaves no `.env` (veja `.env.example`) e rode `vercel dev` (não `npm run dev`, que não executa funções serverless — para testar as rotas `/api/*` localmente você precisa da CLI da Vercel: `npm i -g vercel` e depois `vercel dev`).
2. **Na Vercel:** Project Settings → Environment Variables → adicione as chaves dos provedores que for usar.

Essas variáveis **não** levam o prefixo `VITE_` de propósito — são secretas e só devem existir no servidor (`api/generate.js` é quem as usa).

## Busca real de leads (Google Places API — New)

A tela "Pesquisar leads" busca empresas reais via **Google Places API (New)** — `POST https://places.googleapis.com/v1/places:searchText` — nunca dados sorteados, e nunca a API Legacy (`maps.googleapis.com/maps/api/place/...`). Ela traz nome, endereço, telefone, site e avaliação (dados reais do Google). Campos que a Places API não fornece (WhatsApp, Instagram, Facebook, LinkedIn, e-mail, responsável, cargo) ficam em branco — preencha manualmente no card do lead.

Para ativar:

1. No [Google Cloud Console](https://console.cloud.google.com/), crie/selecione um projeto, ative a **Places API (New)** (não a "Places API" clássica) e habilite o **faturamento** do projeto (é paga acima de uma cota gratuita mensal).
2. Gere/confirme uma chave de API restrita à **Places API (New)**, sem restrição de referrer (ela roda no servidor, não no navegador).
3. Configure `GOOGLE_MAPS_KEY` (sem prefixo `VITE_`) no `.env` local e nas variáveis de ambiente da Vercel.
4. Opcional — mapa incorporado no detalhe do lead: ative também a **Maps Embed API**, gere uma **segunda** chave, essa sim restrita por domínio/referrer HTTP, e configure como `VITE_GOOGLE_MAPS_KEY`.

Sem `GOOGLE_MAPS_KEY`, a busca mostra o erro real explicando o que falta configurar — nunca inventa resultados. Se o Google recusar a chave (ex.: `REQUEST_DENIED`), o erro real da API é repassado à interface — a API (New) exige que a chave esteja restrita/habilitada especificamente para "Places API (New)", diferente da "Places API" clássica.

## Variáveis de ambiente (resumo)

| Variável | Onde usar | Obrigatória? |
|---|---|---|
| `VITE_SUPABASE_URL` | Cliente (navegador) | Não — sem ela, login em modo demonstração |
| `VITE_SUPABASE_ANON_KEY` | Cliente (navegador) | Não — idem |
| `GROQ_API_KEY` / `GEMINI_API_KEY` / `OPENAI_API_KEY` | Servidor (`api/generate.js`) | Não — configure pelo menos uma. Sem nenhuma, os botões de IA mostram o erro real explicando a causa |
| `GOOGLE_MAPS_KEY` | Servidor (`api/places.js`) | Não — sem ela, a busca de leads mostra o erro real explicando a causa |
| `VITE_GOOGLE_MAPS_KEY` | Cliente (navegador) | Não — sem ela, o mapa incorporado não aparece; usa-se link externo |

### Fallback automático entre modelos e entre provedores

Dentro de cada provedor, se o modelo principal não existir/não estiver acessível (HTTP 404/403), o backend tenta o(s) modelo(s) de reserva do mesmo provedor (`GROQ_FALLBACK_MODELS`, `GEMINI_FALLBACK_MODELS`, `OPENAI_FALLBACK_MODELS` — cada um tem um padrão embutido, não precisa configurar). Se um provedor inteiro falhar por qualquer motivo (chave inválida, limite de uso, indisponibilidade, timeout), o **próximo provedor da cadeia** é tentado automaticamente — essa é a ideia central: usar os gratuitos primeiro, só cair no pago se necessário.

- A integração com o Google Places (`api/places.js`) não foi alterada.
- Se todos os provedores/modelos falharem, o frontend recebe um erro HTTP 503 claro, listando cada combinação tentada — nunca um dado fake.
- Os logs da Vercel mostram a causa técnica completa de cada tentativa, provedor por provedor.
- Os três provedores leem imagens nativamente (multimodais), então a mesma cadeia também é usada para a leitura de fotos de cardápio — não existe uma configuração separada de "modelo de visão".

> **Histórico:** este projeto já usou só a NVIDIA, depois só a OpenAI, antes desta arquitetura multi-provedor. A NVIDIA foi abandonada porque o modelo principal foi descontinuado pela própria NVIDIA e os fallbacks configurados numa correção seguinte vieram de uma fonte não confiável e nem existiam de fato no plano gratuito. Se algum modelo aqui parar de funcionar no futuro, confira sempre a disponibilidade na documentação **oficial** do provedor antes de trocar — nunca em blog/doc de terceiros.

## Segurança — chaves expostas nesta sessão

O `.env` enviado para revisão continha uma chave de IA e uma `VITE_GOOGLE_MAPS_KEY` com valores reais. Como esse arquivo passou por um upload, considere as duas expostas: **revogue/gere novas chaves no provedor de IA e no Google Cloud Console antes de usar este projeto em produção.**

## Sobre a verificação do build

Este projeto foi revisado com o compilador `esbuild` em modo "somente sintaxe" sobre todos os arquivos `.jsx`/`.js` (incluindo `api/generate.js` e `api/places.js`), sem apontar erros de sintaxe. O ambiente onde o projeto foi preparado não tem acesso à internet, então não foi possível rodar `npm install`/`npm run build` de ponta a ponta aqui — **rode os dois comandos localmente (ou deixe a própria Vercel buildar no deploy) antes de considerar o projeto validado.** Se aparecer algum erro nessa etapa, envie a mensagem completa para eu corrigir.
