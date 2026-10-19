# PROMPT MASTER — GPISSI | Rastreamento GPS em Segundo Plano com Arquitetura Preparada para Capacitor

## 1. PAPEL DO AGENTE

Atue como engenheiro de software sênior, arquiteto de soluções, especialista em aplicações móveis, geolocalização, Node.js, Express, React Native, Expo, Capacitor, APIs REST, bancos de dados Turso/libSQL e segurança de aplicações multitenant.

Sua missão é **evoluir o GPISSI existente**, implementando rastreamento GPS automático em segundo plano, com armazenamento seguro, sincronização com o servidor e visualização das rotas reais no sistema.

A solução deverá preservar a arquitetura atual e, simultaneamente, criar uma estrutura técnica que permita utilizar o **Capacitor como alternativa de empacotamento ou execução móvel**, caso essa alternativa seja compatível com o projeto.

Não recrie o GPISSI do zero. Não substitua tecnologias existentes sem justificativa técnica documentada. Não remova funcionalidades para facilitar a implementação.

## 2. PRIMEIRA ETAPA — INSPECIONAR O PROJETO REAL

Antes de alterar qualquer arquivo:

1. Examine toda a estrutura do repositório.
2. Identifique frontend web, aplicativo móvel, backend, autenticação, banco de dados e sistema de mapas.
3. Identifique os arquivos e serviços responsáveis por localização, viagens, check-in, rotas e radar.
4. Examine as dependências, versões, scripts, configurações de build, variáveis de ambiente e migrações existentes.
5. Verifique como o aplicativo identifica o usuário, o veículo, a viagem ativa e as permissões de acesso.
6. Localize os endpoints existentes e os formatos de requisição e resposta.
7. Identifique testes, padrões de código, componentes reutilizáveis e convenções de nomenclatura.

Considere inicialmente os seguintes componentes, confirmando sua existência antes de utilizá-los:

- `mobile/src/services/location.js`
- `mobile/src/screens/TrackerScreen.js`
- `POST /api/viagens/:id/checkin`
- Backend Node.js + Express.
- Banco de dados Turso/libSQL, acessado pelo backend.
- Aplicação web com radar, mapas e visualização de viagens.
- Aplicativo móvel possivelmente baseado em React Native com Expo.

Não presuma que essa lista representa integralmente a versão atual do projeto. Confirme os arquivos e as dependências existentes.

Ao concluir a inspeção, produza um diagnóstico técnico objetivo e prossiga com a implementação, sem interromper o trabalho para solicitar aprovações sobre decisões técnicas ordinárias.

## 3. OBJETIVO FUNCIONAL

Implementar um sistema de rastreamento GPS que:

- Inicie quando uma viagem for iniciada ou quando o usuário autorizado ativar o rastreamento.
- Continue capturando posições quando o aplicativo estiver em segundo plano, dentro das limitações de cada sistema operacional.
- Não dependa da tela do rastreador permanecer aberta.
- Registre latitude, longitude, precisão, velocidade, direção e horário da medição, quando disponíveis.
- Armazene pontos localmente quando não houver conexão com a internet.
- Sincronize os pontos pendentes automaticamente quando houver conectividade.
- Evite duplicações na sincronização.
- Permita pausar, retomar e encerrar o rastreamento.
- Preserve o histórico de posições da viagem.
- Exiba no radar a posição mais recente e a rota efetivamente percorrida.
- Diferencie a rota planejada da rota real.
- Registre falhas de permissão, indisponibilidade do GPS e erros de sincronização.
- Funcione com autenticação e autorização por usuário, organização e viagem.

O rastreamento não deve ser encerrado apenas porque o usuário navegou para outra tela, minimizou o aplicativo ou bloqueou a tela do dispositivo.

## 4. ARQUITETURA COM SUPORTE FUTURO AO CAPACITOR

Implemente uma arquitetura com separação entre regras de negócio, aquisição de localização, armazenamento local e comunicação com o servidor.

O sistema deve permitir que o mecanismo de rastreamento seja adaptado a diferentes tecnologias móveis, sem duplicar as regras fiscais, logísticas ou de negócio do GPISSI.

### 4.1. Regra obrigatória de compatibilidade

Identifique qual destas situações representa o projeto real:

**Cenário A — Aplicativo React Native com Expo**

- Preserve o aplicativo existente.
- Utilize as APIs de localização e execução em segundo plano compatíveis com a versão instalada do Expo.
- Avalie `expo-location` e `expo-task-manager`.
- Não substitua o aplicativo por Capacitor apenas para implementar o rastreamento.
- Estruture o serviço de localização para permitir uma implementação alternativa futura.

**Cenário B — Aplicação web que pode ser executada no Capacitor**

- Avalie a possibilidade de empacotar o frontend existente com Capacitor.
- Verifique a compatibilidade das bibliotecas de interface, roteamento, autenticação, armazenamento e mapas.
- Implemente acesso nativo à localização por meio de plugins compatíveis e mantidos, ou por meio de plugin próprio quando necessário.
- Não utilize exclusivamente `navigator.geolocation` para prometer rastreamento contínuo em segundo plano.
- Implemente os recursos nativos necessários para Android e iOS, incluindo serviços em segundo plano e permissões apropriadas.

**Cenário C — Necessidade de manter Expo e Capacitor**

Se houver necessidade real de oferecer as duas opções, mantenha os aplicativos como adaptadores distintos que utilizem os mesmos contratos de API e as mesmas regras de negócio no backend.

Não tente executar APIs de Expo diretamente em uma aplicação Capacitor, nem APIs de Capacitor em React Native, sem uma camada de compatibilidade comprovada.

### 4.2. Estrutura arquitetural desejada

Adapte os nomes e diretórios à estrutura existente. A organização conceitual deverá contemplar:

```text
GPISSI
├── backend
│   ├── routes
│   ├── controllers
│   ├── services
│   │   └── tracking
│   ├── repositories
│   ├── validators
│   └── migrations
│
├── mobile ou frontend
│   └── tracking
│       ├── TrackingManager
│       ├── LocationProvider
│       ├── TrackingApi
│       ├── TrackingQueue
│       ├── TrackingPermissions
│       └── TrackingStatus
│
├── web
│   └── componentes de radar e rotas
│
└── docs
    ├── GPS_BACKGROUND_TRACKING.md
    ├── GPS_BACKGROUND_TRACKING_TESTS.md
    └── CAPACITOR_MOBILE_ADAPTER.md
```

Essa árvore é uma referência conceitual, não uma exigência para reorganizar o projeto inteiro.

### 4.3. Contrato independente de plataforma

Defina uma interface comum para o rastreamento, equivalente conceitualmente a:

```ts
interface TrackingProvider {
  requestPermissions(): Promise<PermissionStatus>;
  start(options: TrackingOptions): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): Promise<TrackingStatus>;
}
```

Crie tipos claros para `TrackingOptions`, `PermissionStatus`, `TrackingStatus` e `LocationPoint`.

O contrato deverá ser implementado pelo adaptador correspondente à plataforma efetivamente utilizada.

O serviço de negócio não poderá depender diretamente de APIs específicas do Expo ou do Capacitor. Essa dependência deverá ficar restrita aos adaptadores nativos.

Não implemente abstrações vazias ou classes fictícias apenas para aparentar suporte a múltiplas plataformas. Cada adaptador deverá possuir uma implementação funcional ou ser explicitamente documentado como planejado, sem declarar suporte ainda inexistente.

## 5. RASTREAMENTO EM SEGUNDO PLANO

### 5.1. Android

Implemente e documente os recursos necessários para:

- Solicitar permissões de localização em primeiro plano e em segundo plano, conforme a versão do Android.
- Solicitar localização precisa quando necessária.
- Utilizar serviço em primeiro plano com notificação persistente quando exigido pela arquitetura adotada.
- Declarar as permissões e os tipos de serviço apropriados no manifesto.
- Tratar restrições de bateria e otimização do fabricante.
- Comunicar ao usuário que o rastreamento está ativo.
- Recuperar o estado de uma sessão após reinicializações ou reabertura, quando tecnicamente suportado.
- Tratar encerramento forçado do aplicativo sem prometer retomada automática garantida.

Não solicite permissões desnecessárias. Solicite permissões em contexto, explicando sua finalidade ao usuário.

### 5.2. iOS

Implemente e documente:

- Configurações de localização em segundo plano compatíveis com a arquitetura escolhida.
- Descrições de uso da localização no aplicativo.
- Solicitação progressiva de permissões.
- Tratamento da autorização reduzida ou negada.
- Comportamento com tela bloqueada.
- Limitações de atualização de localização impostas pelo iOS.
- Tratamento de suspensão, encerramento do aplicativo e retomada quando suportada.

Não prometa execução contínua garantida após encerramento forçado pelo usuário ou quando o sistema operacional impedir a execução.

### 5.3. Configuração por viagem

Utilize configurações ajustáveis para:

- Intervalo-alvo entre coletas.
- Distância mínima para registrar um novo ponto.
- Precisão mínima aceitável.
- Limite de pontos armazenados localmente.
- Tamanho dos lotes de sincronização.
- Política de consumo de bateria.
- Critérios de rejeição de coordenadas inválidas.

Essas configurações devem ter valores padrão documentados e ser compatíveis com as restrições do dispositivo. Não prometa intervalos exatos quando o sistema operacional não os garantir.

### 5.4. Gerenciamento do ciclo de vida

Implemente estados explícitos:

- `IDLE`
- `STARTING`
- `TRACKING`
- `PAUSED`
- `SYNC_PENDING`
- `STOPPING`
- `STOPPED`
- `ERROR`

Os estados devem ser persistidos quando necessário e recuperados com segurança.

Evite sessões duplicadas, múltiplos serviços concorrentes e tarefas de localização repetidas.

O fechamento de uma tela não poderá, por si só, encerrar a sessão de rastreamento.

## 6. ARMAZENAMENTO LOCAL E MODO OFFLINE

Implemente uma fila persistente de pontos de localização.

Avalie uma solução apropriada à plataforma existente, como SQLite ou armazenamento local equivalente com transações e recuperação confiável.

Cada ponto deverá conter, conforme aplicável:

- Identificador único gerado no dispositivo.
- Identificador da sessão de rastreamento.
- Identificador da viagem.
- Data e hora da medição em UTC.
- Latitude e longitude.
- Precisão horizontal.
- Velocidade original e unidade de origem.
- Velocidade normalizada em km/h, quando disponível.
- Direção do deslocamento.
- Altitude, quando disponível.
- Data e hora da criação local.
- Estado de sincronização.
- Tentativas e informações de erro, quando necessárias.

Requisitos:

1. Gravar localmente antes de considerar o ponto protegido contra perda por falha de rede.
2. Não apagar pontos pendentes antes da confirmação de persistência pelo servidor.
3. Sincronizar em lotes.
4. Repetir tentativas com backoff progressivo.
5. Evitar crescimento ilimitado da fila.
6. Tratar falhas parciais em um lote.
7. Deduplicar por identificador único do ponto.
8. Proteger os dados locais de acordo com a sensibilidade e o ambiente de execução.
9. Documentar o comportamento quando o armazenamento ficar sem espaço.
10. Não utilizar o banco Turso diretamente no aplicativo com credenciais privilegiadas.

## 7. API E BACKEND

Integre o rastreamento à API Express existente.

Antes de criar novos endpoints, verifique se já existem operações equivalentes. Reutilize-as ou evolua-as preservando compatibilidade sempre que possível.

Se necessário, implemente operações equivalentes a:

```text
POST /api/viagens/:id/tracking/start
POST /api/viagens/:id/tracking/pause
POST /api/viagens/:id/tracking/resume
POST /api/viagens/:id/tracking/stop
POST /api/viagens/:id/tracking/points/batch
GET  /api/viagens/:id/tracking/points
GET  /api/viagens/:id/tracking/status
```

Ajuste os caminhos à convenção real do projeto.

### Requisitos da API

- Validar autenticação e autorização em todos os endpoints.
- Confirmar que o usuário pode acessar a viagem informada.
- Validar latitude, longitude, datas, identificadores e tamanho dos lotes.
- Impedir que um usuário envie pontos para viagens de outra organização.
- Utilizar transações quando suportadas pela operação.
- Tornar a sincronização idempotente.
- Retornar resultados individuais ou agrupados de forma inequívoca.
- Registrar eventos de início, pausa, retomada e encerramento.
- Aplicar limites de requisições e de tamanho de payload.
- Tratar erros de maneira consistente.
- Evitar expor informações internas, credenciais ou dados de outras organizações.

O backend deverá continuar sendo o responsável pelo acesso ao Turso/libSQL e pelas decisões de autorização.

## 8. BANCO DE DADOS TURSO/LIBSQL

Inspecione o esquema real antes de propor alterações.

Reutilize as tabelas de viagens, usuários, organizações e veículos existentes sempre que adequado.

Caso seja necessário criar tabelas específicas, considere entidades equivalentes a:

### tracking_sessions

- `id`
- `tenant_id` ou identificador equivalente de organização
- `viagem_id`
- `user_id`
- `vehicle_id`, quando aplicável
- `status`
- `started_at`
- `paused_at`
- `resumed_at`
- `ended_at`
- `last_point_at`
- `created_at`
- `updated_at`

### tracking_points

- `id`
- `tenant_id`
- `session_id`
- `viagem_id`
- `point_uid`
- `latitude`
- `longitude`
- `accuracy_m`
- `speed_mps`
- `speed_kmh`
- `heading`
- `altitude`
- `recorded_at`
- `received_at`
- `created_at`

Ajuste os campos às necessidades reais do projeto. Não duplique dados desnecessariamente.

Crie índices adequados para consultas por organização, viagem, sessão e intervalo temporal.

Implemente restrições de unicidade para evitar a duplicação de pontos. Defina a política de exclusão e retenção de dados de forma consistente com os requisitos do GPISSI.

Crie migração versionada, reversível quando viável, e atualize o esquema de referência do projeto.

**Importante:** Turso/libSQL não deve ser tratado automaticamente como PostgreSQL. Utilize apenas recursos SQL compatíveis com o mecanismo real e não presuma que políticas RLS do PostgreSQL estejam disponíveis. Implemente as verificações de autorização na camada correta.

## 9. VELOCIDADE, DISTÂNCIA E QUALIDADE DOS DADOS

Revise toda a cadeia de tratamento de velocidade.

- A localização nativa normalmente fornece velocidade em metros por segundo.
- A conversão para quilômetros por hora é `km/h = m/s × 3,6`.
- Execute essa conversão uma única vez.
- Defina e documente a unidade de cada campo da API e do banco.
- Trate valores ausentes ou inválidos sem transformá-los silenciosamente em medições reais.
- Não confunda ausência de velocidade com velocidade zero.

Verifique se a implementação atual já converte a velocidade em `location.js` e se outro serviço volta a multiplicá-la por 3,6.

Revise também:

- Coordenadas fora do intervalo permitido.
- Precisão insuficiente.
- Pontos repetidos.
- Saltos geográficos incompatíveis com o tempo transcorrido.
- Datas futuras ou inconsistentes.
- Distância entre pontos.
- Ordenação cronológica.
- Falhas de relógio do dispositivo.

Não descarte automaticamente um ponto apenas porque ele parece improvável. Quando possível, marque-o para análise e mantenha rastreabilidade.

## 10. INTEGRAÇÃO COM O RADAR E A INTERFACE WEB

Adapte o radar existente para consumir os pontos persistidos no backend.

A interface deverá distinguir visualmente:

- Posição mais recente.
- Rota planejada.
- Rota efetivamente percorrida.
- Último horário de atualização.
- Estado da sessão de rastreamento.
- Indicação de dispositivo offline ou sincronização pendente, quando conhecida.
- Eventuais lacunas na coleta.

Evite afirmar que um veículo está em movimento apenas porque existe uma sessão ativa.

O radar deverá utilizar a última posição válida disponível e indicar quando ela estiver desatualizada.

Preserve os mapas, filtros, telas e funcionalidades existentes. Não remova recursos para simplificar a integração.

## 11. PRIVACIDADE, SEGURANÇA E GOVERNANÇA

Como o rastreamento envolve dados de localização, implemente:

- Finalidade clara para a coleta.
- Aviso transparente ao usuário.
- Controle de acesso às rotas e ao histórico.
- Segregação por organização e viagem.
- Proteção de tokens e segredos.
- Logs sem exposição desnecessária de coordenadas ou credenciais.
- Política de retenção e exclusão.
- Tratamento adequado de dados pessoais, considerando a LGPD.
- Encerramento do rastreamento quando autorizado e solicitado.
- Auditoria de ações administrativas relevantes.

Não inclua chaves privilegiadas do banco, tokens permanentes ou credenciais de servidor no aplicativo móvel.

## 12. ESTRATÉGIA DE TESTES

Crie testes automatizados para o backend e para os serviços que possam ser testados sem dispositivo físico.

Cubra, no mínimo:

1. Início válido de rastreamento.
2. Tentativa de iniciar uma sessão duplicada.
3. Pausa e retomada.
4. Encerramento.
5. Envio de lote válido.
6. Reenvio de pontos já recebidos.
7. Falha parcial na sincronização.
8. Ausência de conexão.
9. Retomada da sincronização.
10. Coordenadas inválidas.
11. Usuário sem autorização.
12. Tentativa de acesso entre organizações.
13. Conversão de velocidade.
14. Ordenação cronológica.
15. Recuperação de sessão após reabertura.
16. Fila local com pontos pendentes.
17. Falha no armazenamento.
18. Falha no serviço de localização.

Prepare um roteiro de testes reais para Android e iOS, incluindo tela bloqueada, aplicativo em segundo plano, perda de conexão, recuperação de conectividade e permissões negadas.

Para o caminho Capacitor, valide separadamente a compatibilidade do plugin de localização, a configuração nativa e os requisitos de build.

Não declare testes executados quando apenas tiver criado os arquivos de teste. Não declare suporte comprovado a segundo plano sem evidências obtidas no ambiente correspondente.

## 13. BUILD E CONFIGURAÇÃO NATIVA

Identifique os requisitos de build da arquitetura efetivamente implementada.

Para Expo, avalie a necessidade de development build, configuração nativa, permissões, plugins de configuração e geração dos binários apropriados.

Para Capacitor, avalie:

- Configuração do projeto e das plataformas nativas.
- Versões compatíveis de Capacitor e plugins.
- Manifesto Android e permissões.
- Configurações de background do iOS.
- Código nativo necessário para execução contínua.
- Compatibilidade com o frontend e a autenticação existentes.

Não misture os comandos de build de Expo, React Native e Capacitor sem confirmar que são aplicáveis.

Se o ambiente atual não possuir SDKs, certificados, dispositivos ou ferramentas necessárias, documente precisamente o que falta e forneça os comandos reproduzíveis para completar a validação.

## 14. DOCUMENTAÇÃO OBRIGATÓRIA

Crie ou atualize:

### `docs/GPS_BACKGROUND_TRACKING.md`

Documente:

- Arquitetura implementada.
- Fluxo do rastreamento.
- Contratos da API.
- Esquema e migrações do banco.
- Permissões Android e iOS.
- Configuração do ambiente.
- Estratégia offline.
- Recuperação de sessões.
- Limitações dos sistemas operacionais.
- Segurança, privacidade e retenção.
- Procedimentos de diagnóstico.

### `docs/GPS_BACKGROUND_TRACKING_TESTS.md`

Inclua:

- Testes automatizados disponíveis.
- Comandos para executá-los.
- Cenários de teste manual.
- Matriz de compatibilidade.
- Resultados reais obtidos.
- Falhas e pendências identificadas.

### `docs/CAPACITOR_MOBILE_ADAPTER.md`

Documente:

- Se o Capacitor é compatível com a arquitetura encontrada.
- O que já foi implementado para suportá-lo.
- Interfaces compartilhadas.
- Dependências específicas da plataforma.
- Etapas necessárias para ativá-lo.
- Limitações conhecidas.
- O que ainda depende de migração ou implementação nativa.

Não descreva como implementado aquilo que estiver apenas planejado.

## 15. CRITÉRIOS DE ACEITAÇÃO

A tarefa somente poderá ser considerada concluída quando:

- [ ] O projeto original tiver sido preservado.
- [ ] O fluxo de localização tiver sido analisado e corrigido.
- [ ] O rastreamento não depender da tela aberta.
- [ ] A coleta em segundo plano estiver implementada para a plataforma efetivamente suportada.
- [ ] A fila offline persistente estiver funcional.
- [ ] A sincronização for idempotente.
- [ ] O backend validar identidade, autorização e dados recebidos.
- [ ] O banco possuir migrações e índices necessários.
- [ ] O radar diferenciar rota planejada e rota real.
- [ ] O tratamento de velocidade estiver correto.
- [ ] A solução possuir testes automatizados relevantes.
- [ ] A documentação estiver atualizada.
- [ ] A alternativa Capacitor estiver documentada e arquiteturalmente contemplada.
- [ ] As limitações reais de Android, iOS e build estiverem explicitadas.
- [ ] Nenhuma credencial privilegiada tiver sido exposta no cliente.

## 16. ORDEM DE EXECUÇÃO

Execute o trabalho nesta ordem:

1. Inspeção completa do projeto.
2. Diagnóstico técnico e escolha da estratégia móvel.
3. Definição dos contratos e separação por adaptadores.
4. Implementação do rastreamento na plataforma existente.
5. Persistência local e fila offline.
6. Integração com API e Turso/libSQL.
7. Integração com radar e interface.
8. Migrações e segurança.
9. Testes automatizados.
10. Verificações de build possíveis no ambiente.
11. Documentação.
12. Relatório final.

Não interrompa o trabalho após apresentar o diagnóstico. Continue implementando as alterações possíveis no ambiente de desenvolvimento.

Se encontrar incompatibilidades, preserve o que funciona e implemente a solução mais segura que respeite a arquitetura existente. Registre as pendências que realmente dependam de decisão, credenciais, SDKs ou testes físicos.

## 17. RELATÓRIO FINAL OBRIGATÓRIO

Ao terminar, entregue um relatório contendo:

1. Arquitetura original encontrada.
2. Arquitetura implementada.
3. Arquivos criados, modificados e removidos.
4. Migrações realizadas.
5. Endpoints criados ou alterados.
6. Estratégia de localização em segundo plano.
7. Funcionamento da fila offline.
8. Integração com o radar.
9. Situação do suporte a Capacitor: implementado, parcialmente preparado ou apenas documentado.
10. Testes efetivamente executados e respectivos resultados.
11. Comandos de build.
12. Pendências para validação em dispositivos físicos.
13. Riscos e limitações conhecidos.

**Regra final:** o resultado deve ser uma evolução funcional do GPISSI existente, com rastreamento GPS confiável dentro das limitações das plataformas móveis e uma arquitetura que permita adotar Capacitor sem reescrever as regras de negócio ou comprometer a integridade dos dados.

# IMPLEMENTAÇÃO OBRIGATÓRIA DO CAPACITOR NO GPISSI

Atue diretamente no repositório existente do GPISSI. Sua missão é transformar o sistema em uma aplicação compatível com Capacitor para Android e, quando o ambiente permitir, iOS, mantendo o backend, o banco de dados, a autenticação e as regras de negócio existentes.

**Não quero apenas planejamento, documentação ou uma proposta de arquitetura. Quero a implementação efetiva no código.**

## 1. Inspeção e decisão técnica

Antes de modificar arquivos:

1. Identifique a estrutura completa do projeto.
2. Confirme qual aplicação web pode ser executada dentro do Capacitor.
3. Identifique se o aplicativo atual utiliza React Native/Expo, React, Next.js ou outra tecnologia.
4. Verifique as versões de Node.js, npm, framework frontend, dependências e ferramentas nativas.
5. Identifique como o frontend se comunica com o backend Express e com o Turso/libSQL.
6. Faça um inventário das funcionalidades que precisam continuar operacionais.

Se existir um frontend web compatível, utilize-o como base do aplicativo Capacitor.

Se existir apenas um aplicativo React Native/Expo, não tente empacotá-lo diretamente como se fosse uma aplicação web. Preserve-o e implemente uma estratégia realista para disponibilizar a interface necessária ao Capacitor, reutilizando o backend, as APIs, os contratos e as regras de negócio.

Não reescreva todo o sistema desnecessariamente.

## 2. Instalar e configurar Capacitor

Selecione uma versão estável do Capacitor compatível com as dependências e com o ambiente existente. Não misture versões principais incompatíveis.

Execute os comandos apropriados ao projeto, adaptando-os ao gerenciador de pacotes e ao framework identificados.

O resultado deverá incluir, conforme aplicável:

- `@capacitor/core`
- `@capacitor/cli`
- `@capacitor/android`
- `@capacitor/ios`
- Arquivo `capacitor.config.ts` ou configuração equivalente.
- Configuração correta do diretório de build do frontend.
- Projeto nativo Android.
- Projeto nativo iOS, quando possível.
- Scripts de build e sincronização.
- Documentação dos comandos para desenvolvimento e distribuição.

Utilize a documentação oficial: https://capacitorjs.com/docs/getting-started

Configure corretamente o identificador do aplicativo, o nome de exibição, o diretório web, a origem da aplicação e os ambientes de desenvolvimento e produção.

Não utilize uma URL de desenvolvimento como endereço definitivo de produção.

## 3. Transformar a interface existente em uma aplicação móvel

Faça a interface funcionar dentro do WebView do Capacitor.

Verifique:

- Login e logout.
- Persistência segura da sessão.
- Navegação.
- Telas de viagens.
- Início e encerramento de viagens.
- Radar e mapas.
- Formulários.
- Upload e download de arquivos.
- Chamadas à API.
- Tratamento de erros de rede.
- Layout responsivo.
- Áreas seguras de tela, teclado e navegação nativa.

Adapte os componentes necessários para dispositivos móveis sem remover funcionalidades do sistema web.

Não exponha segredos do backend no frontend. Configure URLs da API e ambientes sem inserir credenciais privilegiadas no pacote móvel.

## 4. Implementar localização nativa e rastreamento em segundo plano

O rastreamento GPS em segundo plano é requisito funcional obrigatório.

Não utilize somente a API web `navigator.geolocation`, nem apenas o plugin comum de geolocalização do Capacitor, como solução suficiente para rastreamento contínuo com a tela bloqueada.

Avalie a compatibilidade do plugin `@capgo/background-geolocation` com a versão selecionada do Capacitor, consultando sua documentação: https://capgo.app/docs/plugins/background-geolocation/

Se outra solução mantida for tecnicamente superior ou mais compatível com a versão encontrada, justifique a escolha e implemente-a.

### Android

Implemente:

- Permissões de localização adequadas à versão do Android.
- Serviço nativo de localização em segundo plano.
- Notificação persistente quando exigida.
- Configurações de serviço e permissões no manifesto.
- Tratamento de permissões negadas.
- Tratamento de restrições de bateria.
- Armazenamento local dos pontos coletados.
- Recuperação de estado quando suportada.

### iOS

Implemente:

- Descrições de uso da localização.
- Permissões necessárias.
- Configuração de background location.
- Configurações nativas no projeto iOS.
- Tratamento de autorização negada ou limitada.
- Recuperação de estado conforme os recursos suportados pelo iOS.

Não declare suporte ao iOS como validado se não houver ambiente de build e testes disponível.

## 5. Criar serviço de rastreamento independente da interface

Implemente um serviço central de rastreamento com operações equivalentes a:

- `startTracking(viagemId)`
- `pauseTracking()`
- `resumeTracking()`
- `stopTracking()`
- `getTrackingStatus()`
- `syncPendingPoints()`

O serviço deve utilizar o plugin nativo Capacitor para aquisição da localização e separar essa responsabilidade da tela.

Persistir o estado da sessão, impedir rastreamentos duplicados e manter os pontos mesmo quando a interface for suspensa.

Não dependa de um temporizador JavaScript em execução no WebView para garantir a coleta em segundo plano. Utilize os mecanismos nativos fornecidos pela solução escolhida.

## 6. Fila offline e sincronização

Implemente armazenamento local persistente e sincronização idempotente.

Cada ponto deverá possuir identificador único, identificador da viagem, sessão, latitude, longitude, precisão, horário UTC e velocidade com unidade definida.

A fila deverá:

- Persistir antes da sincronização.
- Manter pontos pendentes durante indisponibilidade de rede.
- Sincronizar em lotes.
- Repetir tentativas com backoff.
- Evitar duplicação.
- Tratar falhas parciais.
- Remover pontos da fila somente após confirmação de recebimento pelo servidor.
- Limitar o armazenamento e tratar falta de espaço.

Utilize um mecanismo adequado à plataforma móvel e às versões existentes. Não coloque credenciais privilegiadas do Turso no aplicativo.

## 7. Integrar com o backend Express e Turso

Preserve o backend atual e reutilize os endpoints existentes quando apropriado.

Implemente ou adapte operações para:

- Iniciar sessão.
- Pausar sessão.
- Retomar sessão.
- Encerrar sessão.
- Receber lotes de pontos.
- Consultar histórico.
- Consultar status de rastreamento.

Valide autenticação, autorização, viagem, usuário e organização. Implemente idempotência e índices adequados no banco.

Crie migrações versionadas e compatíveis com libSQL/Turso. Não aplique sintaxe específica de PostgreSQL sem confirmar sua compatibilidade.

## 8. Corrigir a integração com o radar

O radar web deve apresentar a última posição válida, o horário da última atualização e a rota real percorrida.

Diferencie a rota planejada da rota real. Identifique posições antigas e sessões sem atualização.

Revise a conversão de velocidade: metros por segundo para quilômetros por hora exige multiplicação por 3,6, realizada uma única vez.

## 9. Executar e comprovar a implementação

Execute os comandos de instalação, build e sincronização que forem viáveis no ambiente.

Crie ou atualize scripts equivalentes a:

- `build:web`
- `cap:sync`
- `cap:android`
- `cap:ios`

Adapte os nomes aos padrões do projeto.

Execute testes automatizados, valide os arquivos nativos gerados e corrija erros encontrados.

Se houver Android SDK disponível, tente compilar o aplicativo Android. Se houver Mac/Xcode disponível, valide também o iOS.

Se algum requisito depender de SDK, certificado, conta de desenvolvedor ou dispositivo físico indisponível, informe a limitação sem alegar que o teste foi concluído.

## 10. Entrega obrigatória

Ao concluir, informe:

1. Arquitetura identificada.
2. Estratégia adotada para Capacitor.
3. Arquivos criados e modificados.
4. Dependências instaladas e versões.
5. Configurações nativas implementadas.
6. Estratégia de localização em segundo plano.
7. Alterações na API e no Turso.
8. Resultado real dos builds e testes.
9. Comandos para executar o projeto.
10. Pendências para gerar e instalar o APK.
11. Procedimento para validar o GPS com a tela bloqueada.

**Critério de sucesso:** o GPISSI deverá ter uma implementação concreta do Capacitor, com código, configuração nativa, integração com o backend e rastreamento implementado na plataforma selecionada. Não considere a tarefa concluída apenas porque os pacotes foram instalados ou o arquivo de configuração foi criado.