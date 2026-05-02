# LubriConnect — Redesign visual aplicado

Este pacote contém os arquivos atualizados com a nova identidade visual do **LubriConnect**.
Cada arquivo foi gerado como `.new` para preservar o original. Para aplicar, renomeie sobrescrevendo:

```bash
cd lubritec-main

# 1. Tokens e tipografia
mv src/styles/globals.css.new            src/styles/globals.css
mv tailwind.config.ts.new                tailwind.config.ts
mv index.html.new                        index.html

# 2. Componentes de marca (NOVO diretório)
mkdir -p src/components/brand
mv src/components/brand/BrandMark.tsx.new src/components/brand/BrandMark.tsx

# 3. Layout
mv src/components/layout/Sidebar.tsx.new     src/components/layout/Sidebar.tsx
mv src/components/layout/Topbar.tsx.new      src/components/layout/Topbar.tsx
mv src/components/layout/Placeholder.tsx.new src/components/layout/Placeholder.tsx

# 4. Páginas e features
mv src/pages/login/Login.tsx.new                 src/pages/login/Login.tsx
mv src/features/inside-sales/DealCard.tsx.new    src/features/inside-sales/DealCard.tsx
```

Depois reinstale dependências para garantir Geist:

```bash
npm install
npm run dev
```

## O que mudou

### Identidade visual original (sem reproduzir marcas terceiras)
- **Logo proprietário** (`BrandMark`): gota de óleo abrigando o monograma "LC", com brilho âmbar (lubrificação) e selo rubi (qualidade).
- **Lockup** "Lubri**Connect**" com tagline mono `CRM · Pipeline · Inbox`.

### Paleta industrial 3+2
| Token              | Hex        | Uso                                     |
|--------------------|------------|------------------------------------------|
| `--lc-navy`        | `#0B2545`  | primary, sidebar, CTAs                   |
| `--lc-navy-deep`   | `#13315C`  | hover/gradients                          |
| `--lc-navy-soft`   | `#1E456C`  | superfícies elevadas escuras             |
| `--lc-ruby`        | `#C8102E`  | accent CTA, badges "perdido", notif.    |
| `--lc-amber`       | `#E8A317`  | highlight de óleo, indicadores ativos    |
| `--lc-ink`         | `#0A1628`  | texto principal                          |
| `--lc-paper`       | `#F6F7F9`  | background da app                        |

### Tipografia
- **Geist** (UI / títulos / números) com tracking negativo em h1/h2 para densidade industrial.
- **Geist Mono** para placas, valores monetários, etiquetas e timestamps.

### Componentes redesenhados
- **Sidebar**: navy escuro com padrão hexagonal sutil, agrupamento Operação/Sistema, indicador âmbar na rota ativa, status do WhatsApp, perfil ao pé.
- **Topbar**: breadcrumbs dinâmicos por rota, indicador "operação online", badge de notificação no sino, avatar com gradiente navy→ruby.
- **Login**: split layout — painel de marca à esquerda com glow âmbar/rubi, hero copy, métricas operacionais; à direita card flutuante com badge "Sistema operando".
- **DealCard**: borda esquerda colorida por etapa (navy/âmbar/sucesso/rubi), valor em fonte mono, mantém drag & drop e badges originais.
- **Placeholder**: ícone em caixa navy com gradiente, label mono "Em desenvolvimento".

### Telas inalteradas
Mantidos sem reescrita pesada: Inside Sales board (KanbanBoard.tsx), WhatsApp Inbox (WhatsappPage.tsx), Cadastros (CadastrosPage.tsx). Eles **herdam automaticamente** as novas cores e tipografia via tokens CSS, então o visual já melhora drasticamente sem alterar a lógica.

### Próximos passos sugeridos
1. Aplicar o mesmo tratamento visual aos diálogos (`AddDealDialog`, `LeadDialog`) — só precisa subir o radius para `rounded-xl` e usar `shadow-lc-card`.
2. Substituir o emoji 🔥 do "HOT" por um selo SVG dedicado se quiser remover qualquer dependência de fonte de emoji.
3. Construir o Dashboard real (`DashboardPage.tsx`) com base no mockup — hoje é só `Placeholder`.

Veja o arquivo `LubriConnect Redesign.html` na raiz do projeto para a referência visual completa.
