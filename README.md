# GPISSI - PROTOCOLO DE VIAGEM - INSANOS MC
## 🏍️ INSANO NA ESTRADA - Sistema de Roteiro e Telemetria em Tempo Real

O **GPISSI** é o sistema oficial de gestão e rastreamento de itinerários de estrada do **INSANOS MC**, desenvolvido com paleta visual em **Azul, Laranja e Preto**, integração dos emblemas transparentes `logosembg.png` e `caveirasembg.png`, tipografia moderna do Google Fonts (Montserrat, Rajdhani e Inter, sem fontes estilo Times/serif), base de cidades brasileiras do **IBGE**, catálogo completo de marcas e modelos de veículos (`dados_extras`), máscaras inteligentes (Mercosul e telefone), cálculo automatizado de tempo de estrada e limpeza programada de segurança a cada 72 horas.

> **"GPISSI - INSANOS MC • Protocolo Oficial de Rota • Ninguém fica para trás!"**

---

### 🚀 Funcionalidades Implementadas

1. **🎨 Identidade Visual Laranja e Preto (GPISSI)**:
   - Tema tático escuro (preto profundo, grafite e acabamento metálico) com destaques em laranja vibrante (`#ff6600`, `#ff7700`) e iluminação neon.
   - Logo oficial `public/images/logo2.jpg` (com suporte a `logo2.jog`) incorporado na barra de navegação, cabeçalho e quadro do radar com acabamento circular/oval estilizado e transparência.

2. **📍 Cidades Brasileiras com Referência do IBGE**:
   - Campos de **Origem** e **Destino** com busca preditiva e autocomplete de todos os 5.571 municípios brasileiros no formato `Cidade - UF`.

3. **⏱️ Previsão de Chegada e Rota Automática**:
   - Cálculo automático da distância rodoviária média entre as cidades e do tempo de viagem.
   - Estipula automaticamente a **Hora Prevista de Chegada** com base na data e hora de saída (ex: `10:15 (280 km | ~3h 40min)`).
   - O campo é livre para ajustes manuais pelo integrante caso deseje alterar.

4. **📅 Data de Retorno Sincronizada**:
   - A data de retorno é preenchida automaticamente com a mesma data da saída, podendo ser alterada conforme o roteiro do irmão.

5. **👤 Dados do Integrante & Lista Oficial de Função/Grau**:
   - Campo renomeado para **Função/Grau** com a lista ordenada estritamente:
     1. MUNDIAL - I
     2. SUPLENTE - II
     3. COMANDO BRASIL - III
     4. COMANDO REGIONAL - IV
     5. EXPANSÃO REGIONAL - V
     6. DIRETOR REGIONAL - V
     7. OPERACIONAL REGIONAL - V
     8. SOCIAL REGIONAL - V
     9. ADM REGIONAL - V
     10. COMUNICAÇÃO REGIONAL - V
     11. SARGENTO DE ARMAS - V
     12. DIRETOR DE DIVISÃO - VI
     13. SUB-DIRETOR DE DIVISÃO - VI
     14. SOCIAL DE DIVISÃO - VI
     15. ADM DE DIVISÃO - VI
     16. SARGENTO DE ARMAS - VI
     17. NÔMADE - VII
     18. FULL - VIII
     19. SARGENTO DE ARMAS - VIII
     20. MEIO-COLETE - IX
     21. SARGENTO DE ARMAS - IX
     22. CAMISETA - X
     23. PP - X
     24. SARGENTO DE ARMAS - X

6. **🏍️ Veículo, Placa Mercosul e Catálogo de Marcas/Modelos (`dados_extras`)**:
   - Seção renomeada para **Veículo** com seleção `[ X ] MOTO`, `[ ] CARRO`, `[ ] ÔNIBUS`.
   - **Placa**: máscara inteligente que aceita tanto o padrão tradicional brasileiro (`ABC-1234`) quanto o padrão Mercosul (`ABC-1B34`).
   - **Marca e Modelo**: alimentados diretamente da base de dados de `dados_extras` (`marcas-motos.csv`, `modelos-moto.csv`, etc.). Ao escolher uma marca, a lista de modelos é filtrada automaticamente, permitindo seleção ou digitação manual.

7. **📞 Máscara Automática de Telefone**:
   - Aplicação dinâmica da máscara `(XX) XXXXX-XXXX` (ou `(XX) XXXX-XXXX`) em todos os campos de telefone (integrante e emergência).

8. **⏳ Exclusão Automática após 72 Horas**:
   - Fichas de viagem que ultrapassarem 72 horas são apagadas automaticamente pelo servidor, mantendo o banco de dados limpo e focado em deslocamentos ativos.

9. **🗺️ OpenFreeMap e Rastreamento em Tempo Real (5 em 5 minutos)**:
   - Mapas vetoriais ultra-rápidos e nítidos utilizando a infraestrutura do **OpenFreeMap** (`tiles.openfreemap.org/styles/liberty`) através do MapLibre GL JS, sem limites ou chaves de API pagas.
   - **Rastreamento Automático a cada 5 Minutos**: o piloto transmite sua posição periodicamente enquanto viaja, marcando pontos no trajeto da rodovia.
   - **Resiliência a Quedas de Sinal**: se o sinal de celular ou 4G cair na serra ou rodovia, o sistema **mantém fixado o último ponto registrado** no mapa para visualização do MC e da família. Quando o sinal de celular retorna, quaisquer pontos acumulados na fila offline são sincronizados automaticamente.

10. **📡 RADAR & Integração com Google Maps, Waze e Apple Mapas**:
    - Tela **RADAR** com mapa geral de todos os irmãos em deslocamento simultâneo atualizado em tempo real.
    - Botões rápidos em cada ficha e no mapa para abrir o ponto exato no **Google Maps**, **Waze** e **Apple Mapas**.

10. **🔐 Trava de Encerramento Exclusiva**:
    - Somente quem gerou a ficha (via chave gravada no aparelho ou PIN de segurança de 4 dígitos) consegue encerrar a viagem no GPISSI. Visitantes contam apenas com visualização e recursos de emergência.

---

### 💻 Como Acessar

O servidor já está ativo:
- **Página Inicial (Novo Protocolo)**: [http://localhost:3000](http://localhost:3000)
- **Radar na Estrada (Quadro Geral & Mapa)**: [http://localhost:3000/radar](http://localhost:3000/radar)
