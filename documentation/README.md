# GPISSI - PROTOCOLO DE VIAGEM - INSANOS MC
## 🏍️ INSANO NA ESTRADA - Sistema Oficial de Roteiro, Dashboard e Telemetria em Tempo Real

O **GPISSI** (Gestão de Protocolo de Itinerário de Segurança do Insanos MC) é o sistema oficial de monitoramento, roteirização e telemetria de viagens do **INSANOS MC**. Desenvolvido com paleta visual em **Azul Elétrico (`#00b0ff`), Laranja Vibrante (`#ff6600`) e Preto Tático**, integração dos emblemas originais transparentes (`logosembg.png` e `caveirasembg.png`), tipografia moderna (Google Fonts: Montserrat, Rajdhani e Inter), base completa de municípios do **IBGE**, catálogo completo de marcas e modelos de veículos, cálculo inteligente de rota/distância/tempo, estrutura viva de divisões via API externa e camadas avançadas de proteção e segurança cibernética.

> **"GPISSI - INSANOS MC • Protocolo Oficial de Rota • Ninguém fica para trás!"**

---

### 🌐 Links Oficiais em Produção (Vercel & Local)

- 📊 **Dashboard (Página Inicial)**: [https://gpissi.vercel.app/](https://gpissi.vercel.app/)
- 📝 **Novo Protocolo de Viagem**: [https://gpissi.vercel.app/novo](https://gpissi.vercel.app/novo)
- 📡 **Radar ao Vivo**: [https://gpissi.vercel.app/radar](https://gpissi.vercel.app/radar)
- 🔐 **Conta e autenticação**: [https://gpissi.vercel.app/conta](https://gpissi.vercel.app/conta)
- 💻 **Ambiente Local**: `http://localhost:3000`

---

### 🗄️ Arquitetura, Banco de Dados e Integração de Dados

1. **Estrutura Viva de Divisões (ISSI Expansão API)**:
   - Os comandos, regionais e divisões do Insanos MC não ficam mais armazenados em arquivos estáticos (planilhas ou JSONs) no repositório.
   - São consumidos dinamicamente da API pública do ISSI Expansão: `https://issi-expansao.duckdns.org/api/public/estrutura?pais_id=BR`.
   - O backend (`divisoes.js` e `server.js`) mantém um cache inteligente em memória (TTL de 30 minutos) e sincronização automática em background.
   - O frontend oferece seleção instantânea (zero latência) através de dropdowns encadeados: **Comando ➔ Regional ➔ Divisão**.

2. **Banco de Dados e Persistência**:
   - Viagens, perfis e desafios de segurança são persistidos em **Turso/libSQL** em produção e **SQLite local** em desenvolvimento.
   - Variáveis de ambiente necessárias em produção: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` e `SESSION_SECRET`.
   - O schema das tabelas é criado automaticamente na inicialização se ainda não existir.

3. **Autenticação e Segurança do Integrante**:
   - Cadastro completo: Nome, Nome de Colete, Celular, Função/Grau, Comando, Regional, Divisão, E-mail e Senha (mínimo de 12 caracteres).
   - Desafio visual (anti-automação/bot) com código alfanumérico assinado criptograficamente via HMAC SHA-256.
   - Sessões seguras com cookies `HttpOnly`, `SameSite=Strict` e flag `Secure` em produção.

4. **Regras de Estimativa de Rota e Paradas**:
   - Velocidade média padrão: **110 km/h** para motos e carros, **80 km/h** para ônibus.
   - **Parada Técnica Acumulada**: Adiciona **25 minutos** de descanso a cada 2 horas de viagem previstas (ex.: 2h = 1 parada; 4h = 2 paradas; 6h = 3 paradas).

---

### 🛡️ Proteções e Níveis de Segurança Implementados

1. **Helmet & Content Security Policy (CSP)**:
   - Proteção estrita contra XSS, Clickjacking (`frame-ancestors 'self'`) e injeção de scripts externos.
   - Whitelist autorizando apenas recursos estritamente necessários (Google Fonts, MapLibre, OpenFreeMap, IBGE e duckdns).

2. **Defesa Contra Ataques de Força Bruta (`express-rate-limit`)**:
   - Limite por IP para tentativas no PIN de encerramento (`/api/viagens/:id/encerrar`), evitando força bruta em códigos de 4 dígitos.
   - Limitador de criação de viagens (`/api/viagens`), check-ins de GPS e rate limit global da API.

3. **Gerador e Validador Criptográfico de PIN**:
   - Rejeição de números triviais (sequências como `1234`, `4321` ou repetidos como `1111`).
   - Geração de PINs criptograficamente aleatórios no endpoint `/api/gerar-pin`.

4. **Sanitização Global**:
   - Remoção de tags maliciosas, HTML e comandos maliciosos em todos os campos textuais.
   - Validação regex do formato de IDs de viagem (`^[A-Za-z0-9_-]{4,35}$`).

---

### 📱 Módulos do Sistema

1. **Dashboard Principal (`/`)**:
   - Indicadores executivos (Na Estrada Agora, Concluídas, Total de Viagens).
   - Cartões detalhados com status em tempo real, destino, velocidade e horário previsto.
   - Alerta visual e banner caso o integrante logado não possua Divisão/Regional vinculada.

2. **Novo Protocolo (`/novo`)**:
   - Formulário inteligente com autocompletar de cidades do IBGE, marcas e modelos de veículos, acompanhantes e contatos de emergência.
   - Geração imediata de ficha formatada oficial para WhatsApp com link do tracker.

3. **Radar e Telemetria (`/radar` e `/tracker`)**:
   - Rastreamento por mapa vetorial interativo com rotas, passagens por municípios, cálculo de corredor geográfico e telemetria GPS.

4. **Área da Conta (`/conta`)**:
   - Gestão de acompanhantes padrão, contatos de emergência, histórico de viagens e veículos cadastrados por placa.
   - Atualização hierárquica de Divisão com selects encadeados de Comando e Regional.

5. **Aplicativo Mobile (`mobile/`)**:
   - Cliente móvel multiplataforma em React Native / Expo para Android e iOS.
