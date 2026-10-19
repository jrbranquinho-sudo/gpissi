# GPISSI — Relação dos Cenários de Teste Automatizados de Tracking

Esta suíte de testes automatizados cobre 18 cenários obrigatórios de sucesso, concorrência, tolerância a falhas e segurança do rastreamento em segundo plano.

## Execução dos Testes
Para executar a suíte completa de testes do projeto:
```bash
npm test
```
Ou para executar especificamente a suíte de tracking:
```bash
node --test test/tracking.test.js
```

---

## Relação Detalhada dos 18 Cenários

### Cenário 1: Início de rastreamento com viagem válida
- **Objetivo:** Garantir a criação de uma sessão `active` no banco com retorno HTTP 201 e fornecimento de `session_id`.
- **Validação:** Status HTTP 201, `success: true`, `status: 'active'`, e `session_id` existente e válido.

### Cenário 2: Tentativa de iniciar rastreamento para viagem com sessão ativa já existente
- **Objetivo:** Verificar a idempotência ao chamar o endpoint de start repetidamente.
- **Validação:** Status HTTP 200, preservação do mesmo `session_id` e status `active` sem duplicar sessões ativas.

### Cenário 3: Pausa de rastreamento
- **Objetivo:** Permitir que o integrante pause temporariamente a transmissão em paradas ou postos de combustível.
- **Validação:** Transição de estado de `active` para `paused` (HTTP 200) e confirmação no banco via consulta de status.

### Cenário 4: Retomada de rastreamento
- **Objetivo:** Retomar uma sessão que estava pausada.
- **Validação:** Transição de estado de `paused` para `active` (HTTP 200) com persistência do timestamp `resumed_at`.

### Cenário 5: Encerramento de rastreamento
- **Objetivo:** Encerrar formalmente o tracking ao finalizar a viagem.
- **Validação:** Status HTTP 200, transição para `stopped` e preenchimento automático do campo `ended_at`.

### Cenário 6: Envio de lote de pontos válido
- **Objetivo:** Validar a inserção de telemetria em batch (`POST /api/viagens/:id/tracking/points/batch`).
- **Validação:** Inserção correta de N pontos, resposta com confirmação de contagem (`inserted: N`) e atualização da `last_location` da viagem.

### Cenário 7: Idempotência / reenvio de pontos
- **Objetivo:** Garantir que o reenvio de coordenadas com `point_uid` idêntico não duplique dados no banco.
- **Validação:** Resposta HTTP 200 com `inserted: 0`, contagem inalterada no banco de dados e unicidade de `point_uid`.

### Cenário 8: Rejeição de lote com coordenadas inválidas
- **Objetivo:** Impedir que valores espúrios ou corrompidos afetem a precisão do trajeto.
- **Validação:** Rejeição com HTTP 400 para latitudes fora de [-90, 90], longitudes fora de [-180, 180], `NaN` ou `null`.

### Cenário 9: Tratamento de lote vazio ou malformado
- **Objetivo:** Proteger a API contra payloads vazios (`points: []`) ou estruturas de dados inconsistentes.
- **Validação:** Retorno de erro HTTP 400 com mensagem explicativa.

### Cenário 10: Tentativa de envio de pontos por usuário não autorizado
- **Objetivo:** Assegurar que apenas o autor do protocolo (portador do token ou PIN de criação) transmita telemetria.
- **Validação:** HTTP 401 quando ausente de autenticação e HTTP 403 quando fornecido token incorreto.

### Cenário 11: Tentativa de acesso para viagem inexistente
- **Objetivo:** Garantir que requisições com IDs inexistentes ou inválidos não causem inconsistência.
- **Validação:** Resposta HTTP 404 informando protocolo não encontrado.

### Cenário 12: Tentativa de controle de sessão por terceiro desautorizado
- **Objetivo:** Evitar que outro usuário ou atacante pause ou interrompa o rastreamento alheio.
- **Validação:** Retorno HTTP 403 (Acesso Negado) quando o token pertence a outra viagem.

### Cenário 13: Conversão e preservação correta de velocidade
- **Objetivo:** Eliminar o bug histórico de dupla conversão por 3.6 (que multiplicava 100 km/h por 3.6 duas vezes, gerando 360 km/h).
- **Validação:** Coordenadas com 10 m/s convertidas exatamente para 36 km/h; coordenadas com 80 km/h mantidas em 80 km/h sem sofrer nova multiplicação.

### Cenário 14: Ordenação cronológica correta dos pontos retornados
- **Objetivo:** Assegurar que os pontos da rota sejam entregues ao cliente estritamente ordenados pelo tempo de gravação (`recorded_at ASC`), mesmo se chegarem fora de ordem na sincronização offline.
- **Validação:** Iteração sobre os pontos retornados verificando `prevTime <= currTime`.

### Cenário 15: Recuperação de sessão ativa após reinício do cliente
- **Objetivo:** Permitir que o aplicativo recupere seu estado de rastreamento após fechar o navegador ou reiniciar o aparelho.
- **Validação:** Consulta ao endpoint `GET /api/viagens/:id/tracking/status` retornando dados da sessão ativa, quantidade de pontos e último ponto.

### Cenário 16: Fila local offline (TrackingQueue)
- **Objetivo:** Testar a lógica da fila persistente em memória e armazenamento local.
- **Validação:** Enfileiramento, respeito ao teto de armazenamento (FIFO) e remoção cirúrgica apenas dos pontos confirmados pelo servidor via `.remove([uids])`.

### Cenário 17: Resiliência a falhas de rede no envio em lote
- **Objetivo:** Simular queda de conexão e garantir que nenhum ponto seja perdido durante falhas de rede.
- **Validação:** Quando ocorre erro ou timeout, os pontos continuam preservados na fila; ao restabelecer a conexão, o lote é transmitido e a fila é esvaziada.

### Cenário 18: Deduplicação na fila local antes da transmissão
- **Objetivo:** Evitar que eventos concorrentes de GPS enfileirem duas vezes a mesma leitura com idêntico `point_uid`.
- **Validação:** A segunda tentativa de `queue.enqueue({ point_uid: X })` retorna `null` e não altera o tamanho da fila.
