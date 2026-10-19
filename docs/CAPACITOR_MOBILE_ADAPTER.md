# GPISSI — Adaptador Mobile Híbrido com Capacitor

## 1. Visão Geral da Ponte Híbrida (Web / Mobile)

O GPISSI utiliza o **Capacitor** como camada de ponte entre a aplicação web (HTML5/CSS/JavaScript vanilla) e os recursos nativos dos sistemas operacionais móveis (Android e iOS).

### Estrutura dos Módulos:
```
public/js/tracking/
├── TrackingStatus.js      -> Enum e máquina de estados da sessão
├── TrackingApi.js         -> Cliente HTTP para a API /api/viagens/:id/tracking
├── TrackingQueue.js       -> Fila offline persistente com deduplicação
├── LocationProvider.js    -> Adaptador agnóstico (Capacitor nativo vs HTML5 Geolocation)
└── TrackingManager.js     -> Orquestrador central unificado
```

O `LocationProvider.js` detecta automaticamente se está executando dentro de um container Capacitor nativo:
- **Se nativo:** Registra o plugin `@capgo/background-geolocation`, inicializando um Foreground Service com notificação persistente.
- **Se web/navegador:** Ativa `navigator.geolocation.watchPosition`, solicita `navigator.wakeLock` (Screen Wake Lock API) e inicia um oscilador de áudio em baixa amplitude (AudioContext keep-alive) para evitar que navegadores móveis congelem a aba ao desligar a tela.

---

## 2. Comandos de Compilação e Sincronização

No diretório raiz do projeto:

```bash
# Sincronizar assets estáticos da pasta public/ com as plataformas nativas
npm run cap:sync

# Compilar e executar no emulador ou dispositivo Android conectado
npm run cap:android

# Abrir o projeto Android Studio
npm run cap:open:android

# Compilar e executar no iOS (requer macOS e Xcode)
npm run cap:ios
```

---

## 3. Configuração Nativa de Permissões

### Android (`android/app/src/main/AndroidManifest.xml`)
As seguintes permissões são mandatórias para rastreamento contínuo em estradas sem interrupção pelo sistema operacional:

```xml
<!-- Permissões de Rede e Localização de Alta Precisão -->
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />

<!-- Localização em Segundo Plano (Android 10+) -->
<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />

<!-- Serviço em Primeiro Plano (Android 9+) e Notificações (Android 13+) -->
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />

<!-- WakeLock para manter a CPU ativa durante a transmissão -->
<uses-permission android:name="android.permission.WAKE_LOCK" />
```

### iOS (`ios/App/App/Info.plist`)
Para a plataforma Apple iOS, as seguintes chaves de autorização de privacidade e modos de segundo plano devem ser declaradas:

```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>O GPISSI necessita da sua localização para traçar a rota da viagem em tempo real.</string>

<key>NSLocationAlwaysAndWhenInUseUsageDescription</key>
<string>O GPISSI necessita de acesso à localização em segundo plano para garantir o rastreamento contínuo durante a estrada, mesmo com a tela bloqueada.</string>

<key>UIBackgroundModes</key>
<array>
    <string>location</string>
    <string>fetch</string>
</array>
```

---

## 4. Boas Práticas Contra o Encerramento pelo Sistema Operacional

Dispositivos modernos (Samsung OneUI, Xiaomi MIUI/HyperOS, Huawei EMUI, Apple iOS) possuem mecanismos agressivos de economia de bateria ("Battery Optimization / App Standby") que matam processos em segundo plano após poucos minutos com a tela apagada.

### Estratégias Adotadas no GPISSI:
1. **Foreground Service Notificado (Android):**
   - O `@capgo/background-geolocation` cria uma notificação em primeiro plano com título *"GPISSI - Rastreamento Ativo"* e mensagem *"GPISSI está registrando seu trajeto para a sua segurança na estrada."*. Isso eleva a prioridade do processo perante o Linux OOM Killer.
2. **Screen WakeLock:**
   - Na versão Web, a API `navigator.wakeLock.request('screen')` mantém a tela ligada quando montada no suporte de guidão da moto ou painel do carro.
3. **Instruções ao Integrante no App:**
   - O aplicativo recomenda configurar o GPISSI em *"Sem Restrições"* nas configurações de Bateria do Android (desabilitando a otimização de bateria para o app).
4. **Reserva de Dados Local com Sincronização em Bloco:**
   - Se o sistema pausar a CPU, no instante em que o integrante tocar na tela ou o app acordar por um evento de rede, a `TrackingQueue` descarrega imediatamente os pontos acumulados em uma única requisição HTTP `/batch`.
