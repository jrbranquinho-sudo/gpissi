# GPISSI - PROTOCOLO DE VIAGEM - INSANOS MC
## 🏍️ INSANO NA ESTRADA - Sistema Oficial de Roteiro, Dashboard e Telemetria em Tempo Real

O **GPISSI** (Gestão de Protocolo de Itinerário de Segurança do Insanos MC) é o sistema oficial de monitoramento, roteirização e telemetria de viagens do **INSANOS MC**. Desenvolvido com paleta visual em **Azul Elétrico (`#00b0ff`), Laranja Vibrante (`#ff6600`) e Preto Tático**, integração dos emblemas originais transparentes (`logosembg.png` e `caveirasembg.png`), tipografia moderna (Google Fonts: Montserrat, Rajdhani e Inter, sem fontes estilo Times/serif), base completa de cidades brasileiras do **IBGE**, catálogo completo de marcas e modelos de veículos, cálculo inteligente de rota/distância/tempo e camadas avançadas de proteção e segurança cibernética.

> **"GPISSI - INSANOS MC • Protocolo Oficial de Rota • Ninguém fica para trás!"**

---

### 🌐 Links Oficiais em Produção (Vercel & Local)

- 📊 **Dashboard (Página Inicial)**: [https://gpissi.vercel.app/](https://gpissi.vercel.app/)
- 📝 **Novo Protocolo de Viagem**: [https://gpissi.vercel.app/novo](https://gpissi.vercel.app/novo)
- 📡 **Radar ao Vivo**: [https://gpissi.vercel.app/radar](https://gpissi.vercel.app/radar)
- 💻 **Ambiente Local**: `http://localhost:3000`

---

### 🛡️ Proteções e Níveis de Segurança Implementados

Para garantir resiliência contra ataques maliciosos, invasões e abusos na estrada, o sistema conta com:

1. **Helmet & Content Security Policy (CSP)**:
   - Proteção contra **XSS (Cross-Site Scripting)**, **Clickjacking** (`frame-ancestors 'self'`), MIME-type sniffing e injeção de scripts externos.
   - Whitelist estrita permitindo apenas fontes autorizadas (Google Fonts, MapLibre via unpkg, OpenFreeMap tiles, OpenStreetMap e IBGE).

2. **Defesa Contra Ataques de Força Bruta no PIN (`express-rate-limit`)**:
   - Limite estrito de tentativas no endpoint de encerramento (`/api/viagens/:id/encerrar`): máximo de 15 requisições por IP a cada 15 minutos. Tentativas sucessivas bloqueiam o IP temporariamente, impedindo ataques de força bruta no PIN de 4 dígitos.
   - Limitador de criação de viagens (`/api/viagens`): máximo de 25 protocolos a cada 15 minutos por IP, evitando spamming e negação de serviço.
   - Limitador de check-ins de telemetria GPS para conter flood de tráfego.
   - Rate limit global para toda a API REST (`/api/*`).

3. **Validador & Gerador de PIN Não Sequencial**:
   - Rejeição obrigatória tanto no front-end quanto no back-end de números sequenciais crescentes (ex: `1234`, `2345`, `3456`, `6789`), decrescentes (ex: `4321`, `5432`, `9876`, `3210`) e dígitos repetidos (`1111`, `2222`, `9999`).
   - Endpoint dedicado [`GET /api/gerar-pin`](file:///c:/projetos/gpissi/server.js) com geração criptograficamente segura de PINs não triviais e botão `🎲 Gerar` na interface.

4. **Sanitização de Entradas & Prevenção de Injeção**:
   - Sanitização de strings em todos os campos (`sanitizeString`) removendo tags HTML, scripts maliciosos e protocolos javascript.
   - Validação estrita de formato de ID de viagens (`^[A-Za-z0-9_-]{4,35}$`).

5. **Proteção Contra Payload Bomb / DOS**:
   - Limite rígido de tamanho do corpo de requisição (`express.json({ limit: '100kb' })`), prevenindo estouro de memória (Out-Of-Memory DOS).

6. **Ocultação de Erros e Stack Traces**:
   - Middleware global de captura de erros que não expõe detalhes de arquivos internos, variáveis de ambiente ou caminhos do servidor para os clientes.

7. **Compatibilidade Multi-Ambiente (Vercel Serverless & Local)**:
   - Em produção na nuvem Vercel, o armazenamento temporário opera em `/tmp/gpissi_data` com cache resiliente em memória, evitando erros de leitura/escrita em sistemas de arquivos somente-leitura.

---

### 🚀 Funcionalidades Principais

1. **📊 Dashboard como Página Inicial (`/`)**:
   - Visão executiva com contadores KPI (Na Estrada Agora, Viagens Encerradas, Total).
   - Divisão clara entre **"Na Estrada Agora"** (com badge pulsante e tempo decorrido) e **"Viagens Encerradas"**.
   - **Clique e Acompanhe no Radar**: clicar em qualquer card de viagem abre diretamente a visualização focada no Radar.
   - Retenção inteligente de **2 horas** para viagens concluídas (sendo expurgadas automaticamente após 2h do encerramento).
   - Ordenação cronológica estrita do mais recente para o mais antigo.
   - Polling automático a cada 20 segundos.

2. **📝 Novo Protocolo (`/novo`)**:
   - Cidades do IBGE com busca preditiva.
   - Cálculo automático de distância rodoviária, duração e previsão de chegada.
   - Catálogo de veículos por marca e modelo filtrados em tempo real.
   - Máscaras para telefones e placas (padrão Brasil e Mercosul).
   - Ficha formatada oficial pronta para envio no WhatsApp e cópia com um clique.

3. **📡 Radar de Estrada (`/radar`)**:
   - Mapa vetorial interativo com **OpenFreeMap** (`tiles.openfreemap.org/styles/liberty`) via MapLibre GL JS.
   - Atualização em tempo real de posições GPS a cada 5 minutos.
   - Fallback offline que mantém o último ponto registrado caso o sinal de operadora caia em serras ou rodovias.

---

### 📦 Repositório GitHub

- 🐙 **GitHub Oficial**: [https://github.com/jrbranquinho-sudo/gpissi](https://github.com/jrbranquinho-sudo/gpissi)
- Branch Principal: `main`
