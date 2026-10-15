// GPISSI - Notification Service (Android & iOS)
// Notificações locais em tempo real para telemetria e segurança na estrada

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// Configura como as notificações aparecem quando o app está aberto (em primeiro plano)
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

/**
 * Solicita permissões de notificação ao usuário
 */
export async function requestNotificationPermission() {
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.warn('[GPISSI] Permissão de notificação não concedida.');
      return false;
    }

    // Configuração de canal para Android (Som e Vibração Máxima)
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('gpissi-telemetria', {
        name: 'GPISSI Telemetria e Segurança',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#ff6600',
        sound: 'default',
        enableVibrate: true,
      });

      await Notifications.setNotificationChannelAsync('gpissi-alerta', {
        name: 'GPISSI Alerta SOS',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 500, 200, 500],
        lightColor: '#ff3d00',
        sound: 'default',
        enableVibrate: true,
      });
    }

    return true;
  } catch (err) {
    console.warn('[GPISSI Notifications] Erro ao pedir permissão:', err.message);
    return false;
  }
}

/**
 * Dispara uma notificação local imediata
 */
export async function triggerNotification(title, body, channelId = 'gpissi-telemetria') {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: 'default',
        priority: Notifications.AndroidNotificationPriority.MAX,
        data: { timestamp: new Date().toISOString() },
      },
      trigger: null, // Imediato
    });
  } catch (err) {
    console.warn('[GPISSI] Falha ao disparar notificação:', err.message);
  }
}

/**
 * Notificação de confirmação de Check-in GPS transmitido
 */
export async function notifyCheckinSuccess(cidade, speedKmH) {
  const speedText = speedKmH ? ` | ⚡ ${speedKmH} km/h` : '';
  await triggerNotification(
    '📍 Check-in GPS Transmitido',
    `Localização sincronizada: ${cidade || 'Ponto na Rodovia'}${speedText}`,
    'gpissi-telemetria'
  );
}

/**
 * Notificação de Alerta / SOS
 */
export async function notifyRoadAlert(mensagem) {
  await triggerNotification(
    '🚨 ALERTA NA ESTRADA - GPISSI',
    mensagem || 'Atenção redobrada na rodovia. Ninguém fica para trás!',
    'gpissi-alerta'
  );
}

/**
 * Notificação de Encerramento com Sucesso
 */
export async function notifyTripFinished(protocoloId) {
  await triggerNotification(
    '🏁 Viagem Concluída com Sucesso!',
    `Protocolo ${protocoloId} encerrado em segurança. Bem-vindo ao destino!`,
    'gpissi-telemetria'
  );
}
