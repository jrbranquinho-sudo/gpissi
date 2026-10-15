# 📜 Histórico de Alterações e Controle de Versões • GPISSI

Documento oficial de versionamento e registro de mudanças do sistema **GPISSI (Gestão de Protocolo de Itinerário de Segurança do Insanos MC)**.

---

## 📌 Sumário das Versões

- [v1.4.1 - Dropdowns Pesquisáveis com Filtro em Tempo Real & Formato Unificado de Divisão](#v141---outubro2026)
- [v1.4.0 - Integração da Estrutura de Divisões via API Externa & Eliminação de Arquivos Estáticos](#v140---outubro2026)
- [v1.3.1 - Aplicativo Móvel Multiplataforma (React Native / Expo)](#v131---outubro2026)
- [v1.3.0 - Remoção da Evolution API e Autonomia Total por Links WhatsApp](#v130---outubro2026)
- [v1.2.0 - Paradas Técnicas Automáticas Acumuladas & Melhorias no Layout Mobile](#v120---outubro2026)
- [v1.1.0 - Cadastro de Veículos por Placa, Desafio Visual HMAC & Persistência Turso](#v110---outubro2026)
- [v1.0.0 - Lançamento Inicial do GPISSI](#v100---versão-inicial)

---

## [v1.4.1] - Outubro/2026
### 🔍 Dropdowns Pesquisáveis com Filtro em Tempo Real & Formato Limpo de Divisão

#### 🚀 Adicionado
- **Dropdowns Pesquisáveis em Tempo Real (`makeSearchableSelect` / `searchable-select.js`)**:
  - Permite digitar qualquer caractere (com suporte a busca parcial, sem distinção de acentos ou maiúsculas/minúsculas) nos campos de **Comando**, **Regional** e **Divisão**.
  - A lista filtra instantaneamente conforme a digitação.
  - Aplicado no cadastro do integrante, na tela de edição do perfil e no banner de atualização cadastral do dashboard.
- **Componente e Estilização Visual**:
  - Estilos customizados em `style.css` com seta indicativa (`▾`), realce de hover e animação de abertura.

#### 🔄 Modificado
- **Formatação de Exibição na Conta do Integrante**:
  - Padronizada a exibição cadastral para o formato direto e limpo solicitado: `Divisão | Regional | Comando` (ex.: `Divisão Orizona | REGIONAL GOIÁS I - GO | Comando Regional XLVIII`), sem prefixos repetitivos.

---

## [v1.4.0] - Outubro/2026
### 🌐 Integração da Estrutura Dinâmica via API Externa do ISSI Expansão

#### 🚀 Adicionado
- **Integração com a API Pública do ISSI Expansão (`/api/public/estrutura?pais_id=BR`)**:
  - Eliminação completa de listas fixas em arquivos de planilha (`.xlsx`) ou arquivos locais (`divisoes_data.json`).
  - O sistema passa a consultar dinamicamente a estrutura viva de **55 Comandos**, **224 Regionais** e mais de **1.600 Divisões**.
- **Novo Endpoint Backend [`GET /api/public/estrutura`](file:///c:/projetos/gpissi/server.js)**:
  - Atua como cache em memória de alta performance (TTL de 30 minutos) e proxy de fallback resiliente.
  - Sincronização periódica em background a cada 30 minutos via `setInterval`.
- **Dropdowns Encadeados no Frontend (Opção 1 - Zero Latência)**:
  - Adicionado fluxo de 3 selects dependentes (**1. Comando ➔ 2. Regional ➔ 3. Divisão**) nas seguintes telas:
    1. **Cadastro do Integrante** ([`public/account.html`](file:///c:/projetos/gpissi/public/account.html)): preenchimento automático hierárquico ao criar a conta.
    2. **Painel do Integrante / Minha Conta** ([`public/account.html`](file:///c:/projetos/gpissi/public/account.html)): formulário de atualização de divisão com pré-seleção dos dados atuais.
    3. **Banner de Alerta do Dashboard** ([`public/index.html`](file:///c:/projetos/gpissi/public/index.html) e [`public/dashboard.html`](file:///c:/projetos/gpissi/public/dashboard.html)): interface para integrantes pendentes de divisão.

#### 🔄 Modificado
- **[`divisoes.js`](file:///c:/projetos/gpissi/divisoes.js)**:
  - Refatorado para carregar e processar a árvore da API externa com normalização de maiúsculas/minúsculas, preservação de algarismos romanos em comandos (ex.: `Comando Regional XLVIII`) e geração dos nomes canônicos das divisões.
  - Mantidas as funções `matchDivision()` e `searchDivisions()` com 100% de compatibilidade retroativa.
- **[`server.js`](file:///c:/projetos/gpissi/server.js)**:
  - Rotas de cadastro (`/api/auth/register`) e atualização (`/api/account/divisao`) ajustadas para receber e validar diretamente os campos `comando`, `regional` e `divisao`.

#### 🗑️ Removido
- Removido arquivo legado `test/divisoes_regionais_comandos.xlsx` (1.4 MB).
- Removido arquivo estático `data/divisoes_data.json` (383 KB).
- Removido arquivo duplicado com extensão incorreta `public/images/logo2.jog` (56 KB).

---

## [v1.3.1] - Outubro/2026
### 📱 Aplicativo Móvel Multiplataforma (React Native / Expo)

#### 🚀 Adicionado
- Estrutura completa de aplicativo mobile na pasta [`mobile/`](file:///c:/projetos/gpissi/mobile/):
  - Telas: `DashboardScreen`, `NovoProtocoloScreen`, `TrackerScreen` e `ConfigScreen`.
  - Módulos de telemetria GPS em segundo plano (`services/location.js`), notificações locais e persistência de credenciais em `AsyncStorage`.
  - Identidade visual idêntica à aplicação web (paleta em Azul Elétrico, Laranja e Preto Tático).
- Script npm `"mobile": "npm --prefix mobile start"` adicionado ao `package.json` principal.

---

## [v1.3.0] - Outubro/2026
### ⚡ Remoção da Evolution API e Autonomia por Links WhatsApp

#### 🔄 Modificado
- Eliminação da dependência de servidores locais/daemons de mensageria da Evolution API.
- Envio de protocolo 100% simplificado e nativo via links universais `https://wa.me/?text=...` e botão com cópia rápida para área de transferência.
- O sistema tornou-se imune a bloqueios de sessão de WhatsApp e dispensou custos de manutenção de instâncias de bot.

---

## [v1.2.0] - Outubro/2026
### ⏱️ Paradas Técnicas Automáticas & Responsividade Mobile

#### 🚀 Adicionado
- **Cálculo Cumulativo de Paradas de Descanso**:
  - Adição automática de **25 minutos** a cada intervalo de **2 horas** de tempo de percurso estimado.
  - Exemplo: 7 horas de viagem rodoviária adicionam 3 intervalos de 25 minutos (total de 1h15m), ajustando com precisão a previsão de chegada do motociclista.

#### 🎨 Melhorias de Interface (UI/UX)
- Padronização do layout mobile responsivo em coluna única para telas menores de 768px: caixas de texto, selects e botões empilhados sem cortes.
- Barra de navegação 2x2 otimizada para smartphones.
- Cards de veículos e acompanhantes redesenhados com melhor legibilidade sob luz solar.

---

## [v1.1.0] - Outubro/2026
### 🔒 Segurança, Desafio Visual & Persistência em Nuvem

#### 🚀 Adicionado
- **Desafio Visual Anti-Robô (Anti-Bot)**:
  - Geração no backend de sequências alfanuméricas criptograficamente assinadas via HMAC SHA-256.
  - Expiração automática em 5 minutos e descarte imediato após tentativa incorreta.
- **Cadastro Separado de Veículos por Placa**:
  - Salvamento automático de veículos utilizados em protocolos vinculados à conta do integrante.
- **Persistência em Turso/libSQL**:
  - Suporte nativo à nuvem Turso para banco de dados distribuído em produção na Vercel.
  - Fallback automático para SQLite local durante testes e desenvolvimento.

---

## [v1.0.0] - Versão Inicial
### 🏍️ Lançamento do Sistema GPISSI

#### 🚀 Funcionalidades Originais
- Emissão de Protocolo de Viagem com número rastreável oficial (`INS-XXXXXX`).
- Autocompletar de todos os municípios brasileiros com dados do IBGE.
- Catálogo de veículos por marca e modelo com máscara de placa Mercosul e tradicional.
- Radar em tempo real com mapa vetorial Liberty (OpenFreeMap) e MapLibre GL JS.
- Algoritmo de corredor de rota tolerando desvios na estrada e identificando passagens de municípios.
- Alerta visual e temporizador para viagens atrasadas / pilotos em atraso.
- Proteção por PIN de 4 dígitos não-trivial para encerramento de protocolos.
