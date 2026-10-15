import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Modal,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { COLORS } from '../theme/colors';
import { getCurrentPosition, startLocationWatch, stopLocationWatch } from '../services/location';
import { sendCheckin, finishTrip } from '../services/api';
import {
  notifyCheckinSuccess,
  notifyRoadAlert,
  notifyTripFinished,
  requestNotificationPermission,
} from '../services/notifications';

export default function TrackerScreen({ trip, onBack, onTripUpdated }) {
  const [isTracking, setIsTracking] = useState(false);
  const [currentGps, setCurrentGps] = useState(null);
  const [loadingGps, setLoadingGps] = useState(false);
  const [sendingCheckin, setSendingCheckin] = useState(false);
  const [checkinsList, setCheckinsList] = useState(trip?.checkins || []);

  // Modal de Encerramento com PIN
  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [closingTrip, setClosingTrip] = useState(false);

  // Modal de Checkin com Descrição Personalizada
  const [descModalVisible, setDescModalVisible] = useState(false);
  const [customDesc, setCustomDesc] = useState('');

  const lastCoordsRef = useRef(null);

  useEffect(() => {
    // Solicita permissões de notificação ao abrir o rastreador
    requestNotificationPermission();

    // Captura a localização atual inicial
    fetchInitialPosition();

    return () => {
      stopLocationWatch();
    };
  }, []);

  const fetchInitialPosition = async () => {
    try {
      setLoadingGps(true);
      const pos = await getCurrentPosition();
      setCurrentGps(pos);
      lastCoordsRef.current = pos;
    } catch (err) {
      console.warn('[GPISSI Tracker] GPS inicial:', err.message);
    } finally {
      setLoadingGps(false);
    }
  };

  // Alterna transmissão contínua de GPS
  const toggleTracking = async () => {
    if (isTracking) {
      stopLocationWatch();
      setIsTracking(false);
      Alert.alert('Rastreamento Pausado', 'A transmissão contínua de GPS foi pausada.');
    } else {
      setIsTracking(true);
      Alert.alert(
        'Telemetria Ativada',
        'Seu GPS agora está transmitindo atualizações automáticas de rota para o GPISSI.'
      );

      startLocationWatch(
        async (newPos) => {
          setCurrentGps(newPos);
          lastCoordsRef.current = newPos;

          // Transmite automaticamente para a API
          try {
            await sendCheckin(trip.id, {
              lat: newPos.lat,
              lng: newPos.lng,
              speed: newPos.speedKmH,
              altitude: newPos.altitude,
              accuracy: newPos.accuracy,
              cidade: newPos.cidade,
              descricao: 'Ponto contínuo de rota transmitido',
            });

            // Atualiza histórico local
            setCheckinsList((prev) => [
              {
                cidade: newPos.cidade,
                descricao: 'Ponto contínuo de rota',
                timestamp: new Date().toISOString(),
                speedKmH: newPos.speedKmH,
              },
              ...prev,
            ]);
          } catch (e) {
            console.warn('[GPISSI Tracker] Erro ao sincronizar ponto:', e.message);
          }
        },
        (error) => {
          Alert.alert('Erro no GPS', error.message);
          setIsTracking(false);
        }
      );
    }
  };

  // Disparo manual de Check-in imediato
  const handleManualCheckin = async (descricao = 'Check-in Manual no Trajeto') => {
    try {
      setSendingCheckin(true);
      let pos = currentGps;
      try {
        pos = await getCurrentPosition();
        setCurrentGps(pos);
      } catch (e) {
        // Usa a última coordenada salva se disponível
        pos = lastCoordsRef.current;
      }

      if (!pos) {
        Alert.alert('Atenção', 'Aguarde o sinal de GPS ser fixado pelo dispositivo.');
        return;
      }

      // Envia à API do GPISSI
      await sendCheckin(trip.id, {
        lat: pos.lat,
        lng: pos.lng,
        speed: pos.speedKmH,
        altitude: pos.altitude,
        accuracy: pos.accuracy,
        cidade: pos.cidade,
        descricao,
      });

      // Dispara Notificação Sonora e Visual no Aparelho
      await notifyCheckinSuccess(pos.cidade, pos.speedKmH);

      // Adiciona ao histórico da tela
      setCheckinsList((prev) => [
        {
          cidade: pos.cidade,
          descricao,
          timestamp: new Date().toISOString(),
          speedKmH: pos.speedKmH,
        },
        ...prev,
      ]);

      Alert.alert(
        'Check-in Concluído!',
        `Ponto registrado em: ${pos.cidade}\nVelocidade: ${pos.speedKmH} km/h`
      );
    } catch (err) {
      Alert.alert('Aviso de Rede', `Ponto registrado localmente. (${err.message})`);
    } finally {
      setSendingCheckin(false);
      setDescModalVisible(false);
      setCustomDesc('');
    }
  };

  // Botão de Alerta / SOS
  const handleAlertSOS = async () => {
    Alert.alert(
      'Disparar Alerta SOS?',
      'Esta ação notificará os integrantes da divisão com a sua localização de GPS exata.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'DISPARAR ALERTA',
          style: 'destructive',
          onPress: async () => {
            await notifyRoadAlert('Alerta de segurança disparado pelo integrante na rodovia!');
            handleManualCheckin('🚨 ALERTA SOS DISPARADO');
          },
        },
      ]
    );
  };

  // Encerramento da viagem com validação do PIN
  const handleFinishTrip = async () => {
    if (!pinInput || pinInput.length !== 4) {
      Alert.alert('PIN Inválido', 'Digite o PIN de 4 dígitos registrado no início da viagem.');
      return;
    }

    try {
      setClosingTrip(true);
      await finishTrip(trip.id, pinInput);

      // Desliga o GPS
      stopLocationWatch();
      setIsTracking(false);

      // Dispara Notificação de Chegada ao Destino
      await notifyTripFinished(trip.id);

      setPinModalVisible(false);
      Alert.alert('Viagem Encerrada', 'Protocolo finalizado com sucesso! Ninguém fica para trás!', [
        {
          text: 'OK',
          onPress: () => {
            if (onTripUpdated) onTripUpdated();
            if (onBack) onBack();
          },
        },
      ]);
    } catch (err) {
      Alert.alert('Erro ao Encerrar', err.message || 'PIN incorreto ou falha na conexão.');
    } finally {
      setClosingTrip(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Botão Voltar */}
      <TouchableOpacity style={styles.btnBack} onPress={onBack}>
        <Text style={styles.btnBackText}>← VOLTAR AO DASHBOARD</Text>
      </TouchableOpacity>

      {/* Cartão de Detalhes da Viagem */}
      <View style={styles.tripCard}>
        <View style={styles.tripHeader}>
          <View>
            <Text style={styles.tripIdBadge}>PROTOCOLO: {trip.id}</Text>
            <Text style={styles.riderName}>{trip.integrante}</Text>
            <Text style={styles.motoName}>🏍️ {trip.veiculo}</Text>
          </View>
          <View style={[styles.statusBadge, isTracking ? styles.statusActive : styles.statusIdle]}>
            <View style={[styles.statusDot, { backgroundColor: isTracking ? COLORS.success : COLORS.warning }]} />
            <Text style={styles.statusText}>{isTracking ? 'GPS AO VIVO' : 'PAUSADO'}</Text>
          </View>
        </View>

        <View style={styles.routeBox}>
          <Text style={styles.routeText}>
            📍 {trip.origem} ➔ {trip.destino}
          </Text>
          <Text style={styles.distanceText}>
            Distância Prevista: {trip.distancia_km || '--'} km • Tempo: {trip.tempo_estimado_formatado || '--'}
          </Text>
        </View>
      </View>

      {/* CLUSTER DE INSTRUMENTOS GPS / VELOCÍMETRO */}
      <View style={styles.telemetryCard}>
        <Text style={styles.cardSectionTitle}>TELEMETRIA & LOCALIZAÇÃO GPS</Text>

        <View style={styles.speedCluster}>
          <View style={styles.speedCircle}>
            <Text style={styles.speedNumber}>{currentGps ? currentGps.speedKmH : 0}</Text>
            <Text style={styles.speedUnit}>KM/H</Text>
          </View>

          <View style={styles.gpsMetrics}>
            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>CIDADE / PONTO:</Text>
              <Text style={styles.metricValue} numberOfLines={1}>
                {loadingGps ? 'Fixando satélites...' : currentGps?.cidade || 'Aguardando GPS...'}
              </Text>
            </View>

            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>COORDENADAS:</Text>
              <Text style={styles.metricCoords}>
                {currentGps
                  ? `${currentGps.lat.toFixed(5)}, ${currentGps.lng.toFixed(5)}`
                  : '--.-----, --.-----'}
              </Text>
            </View>

            <View style={styles.metricRow}>
              <Text style={styles.metricSub}>ALT: {currentGps?.altitude || 0}m</Text>
              <Text style={styles.metricSub}>PRECISÃO: ±{currentGps?.accuracy || 0}m</Text>
            </View>
          </View>
        </View>

        {/* BOTÃO PRINCIPAL DE TRANSMISSÃO CONTÍNUA */}
        <TouchableOpacity
          style={[styles.btnTracking, isTracking ? styles.btnTrackingActive : styles.btnTrackingIdle]}
          onPress={toggleTracking}
        >
          <Text style={styles.btnTrackingText}>
            {isTracking ? '⏸️ PAUSAR TRANSMISSÃO GPS' : '🟢 INICIAR TRANSMISSÃO CONTÍNUA'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* BOTÕES DE AÇÃO NA ESTRADA */}
      <View style={styles.actionsGrid}>
        <TouchableOpacity
          style={styles.actionBtnCheckin}
          onPress={() => setDescModalVisible(true)}
          disabled={sendingCheckin}
        >
          {sendingCheckin ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Text style={styles.actionBtnIcon}>📍</Text>
              <Text style={styles.actionBtnText}>CHECK-IN AGORA</Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionBtnAlert} onPress={handleAlertSOS}>
          <Text style={styles.actionBtnIcon}>🚨</Text>
          <Text style={styles.actionBtnText}>ALERTA SOS</Text>
        </TouchableOpacity>
      </View>

      {/* BOTÃO DE ENCERRAMENTO COM PIN */}
      <TouchableOpacity style={styles.btnFinish} onPress={() => setPinModalVisible(true)}>
        <Text style={styles.btnFinishText}>🏁 ENCERRAMENTO COM PIN</Text>
      </TouchableOpacity>

      {/* HISTÓRICO DE CHECKINS */}
      <View style={styles.historyCard}>
        <Text style={styles.cardSectionTitle}>HISTÓRICO DE PONTOS TRANSMITIDOS</Text>
        {checkinsList.length === 0 ? (
          <Text style={styles.emptyHistory}>Nenhum ponto registrado ainda. Toque em "Check-in Agora".</Text>
        ) : (
          checkinsList.slice(0, 10).map((item, index) => (
            <View key={index} style={styles.historyItem}>
              <View style={styles.historyDot} />
              <View style={styles.historyContent}>
                <Text style={styles.historyCity}>{item.cidade || 'Ponto na Rodovia'}</Text>
                <Text style={styles.historyDesc}>{item.descricao || 'Check-in GPS'}</Text>
                <Text style={styles.historyTime}>
                  {item.timestamp ? new Date(item.timestamp).toLocaleTimeString('pt-BR') : '--:--'}
                  {item.speedKmH ? ` • ⚡ ${item.speedKmH} km/h` : ''}
                </Text>
              </View>
            </View>
          ))
        )}
      </View>

      {/* MODAL DE CHECKIN PERSONALIZADO */}
      <Modal visible={descModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>📍 Registrar Check-in</Text>
            <Text style={styles.modalSub}>Adicione uma observação do ponto (ex: Posto, Pedágio, Parada para chuva):</Text>

            <TextInput
              style={styles.modalInput}
              placeholder="Ex: Parada no Posto Graal"
              placeholderTextColor={COLORS.textMuted}
              value={customDesc}
              onChangeText={setCustomDesc}
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalBtnCancel}
                onPress={() => setDescModalVisible(false)}
              >
                <Text style={styles.modalBtnCancelText}>CANCELAR</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalBtnConfirm}
                onPress={() => handleManualCheckin(customDesc || 'Ponto no trajeto')}
              >
                <Text style={styles.modalBtnConfirmText}>TRANSMITIR</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* MODAL DE ENCERRAMENTO COM PIN */}
      <Modal visible={pinModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>🏁 Encerrar Protocolo</Text>
            <Text style={styles.modalSub}>
              Digite o PIN de segurança de 4 dígitos registrado para este protocolo:
            </Text>

            <TextInput
              style={[styles.modalInput, styles.pinInput]}
              placeholder="0000"
              placeholderTextColor={COLORS.textMuted}
              keyboardType="number-pad"
              maxLength={4}
              value={pinInput}
              onChangeText={setPinInput}
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalBtnCancel}
                onPress={() => setPinModalVisible(false)}
              >
                <Text style={styles.modalBtnCancelText}>CANCELAR</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtnConfirm, { backgroundColor: COLORS.issiOrange }]}
                onPress={handleFinishTrip}
                disabled={closingTrip}
              >
                {closingTrip ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.modalBtnConfirmText}>CONFIRMAR</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bgDark,
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  btnBack: {
    paddingVertical: 8,
    marginBottom: 8,
  },
  btnBackText: {
    color: COLORS.gpBlue,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  tripCard: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 8,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 12,
  },
  tripHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  tripIdBadge: {
    color: COLORS.issiOrange,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  riderName: {
    color: COLORS.textWhite,
    fontSize: 18,
    fontWeight: '800',
    marginTop: 2,
  },
  motoName: {
    color: COLORS.textSecondary,
    fontSize: 13,
    marginTop: 2,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusActive: {
    backgroundColor: COLORS.successBg,
    borderWidth: 1,
    borderColor: COLORS.success,
  },
  statusIdle: {
    backgroundColor: COLORS.bgSurface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  statusText: {
    color: COLORS.textWhite,
    fontSize: 9,
    fontWeight: '900',
  },
  routeBox: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  routeText: {
    color: COLORS.textWhite,
    fontSize: 13,
    fontWeight: '700',
  },
  distanceText: {
    color: COLORS.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  telemetryCard: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 10,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 12,
  },
  cardSectionTitle: {
    color: COLORS.textMuted,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 12,
  },
  speedCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 16,
  },
  speedCircle: {
    width: 90,
    height: 90,
    borderRadius: 45,
    borderWidth: 3,
    borderColor: COLORS.issiOrange,
    backgroundColor: COLORS.bgSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speedNumber: {
    color: COLORS.textWhite,
    fontSize: 32,
    fontWeight: '900',
  },
  speedUnit: {
    color: COLORS.issiOrange,
    fontSize: 10,
    fontWeight: '800',
  },
  gpsMetrics: {
    flex: 1,
  },
  metricItem: {
    marginBottom: 6,
  },
  metricLabel: {
    color: COLORS.textMuted,
    fontSize: 9,
    fontWeight: '800',
  },
  metricValue: {
    color: COLORS.textWhite,
    fontSize: 13,
    fontWeight: '700',
  },
  metricCoords: {
    color: COLORS.gpBlueLight,
    fontSize: 11,
    fontFamily: 'monospace',
  },
  metricRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  metricSub: {
    color: COLORS.textMuted,
    fontSize: 10,
  },
  btnTracking: {
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  btnTrackingActive: {
    backgroundColor: 'rgba(255, 61, 0, 0.15)',
    borderWidth: 1,
    borderColor: COLORS.danger,
  },
  btnTrackingIdle: {
    backgroundColor: 'rgba(0, 230, 118, 0.15)',
    borderWidth: 1,
    borderColor: COLORS.success,
  },
  btnTrackingText: {
    color: COLORS.textWhite,
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  actionsGrid: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  actionBtnCheckin: {
    flex: 1,
    backgroundColor: COLORS.gpBlue,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  actionBtnAlert: {
    flex: 1,
    backgroundColor: COLORS.danger,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  actionBtnIcon: {
    fontSize: 16,
  },
  actionBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '900',
  },
  btnFinish: {
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.issiOrange,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 16,
  },
  btnFinishText: {
    color: COLORS.issiOrange,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  historyCard: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 8,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  emptyHistory: {
    color: COLORS.textMuted,
    fontSize: 12,
    textAlign: 'center',
    paddingVertical: 12,
  },
  historyItem: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  historyDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.issiOrange,
    marginTop: 4,
    marginRight: 10,
  },
  historyContent: {
    flex: 1,
  },
  historyCity: {
    color: COLORS.textWhite,
    fontSize: 13,
    fontWeight: '700',
  },
  historyDesc: {
    color: COLORS.textSecondary,
    fontSize: 11,
  },
  historyTime: {
    color: COLORS.textMuted,
    fontSize: 10,
    marginTop: 2,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 20,
  },
  modalTitle: {
    color: COLORS.textWhite,
    fontSize: 18,
    fontWeight: '800',
  },
  modalSub: {
    color: COLORS.textSecondary,
    fontSize: 12,
    marginTop: 6,
    marginBottom: 14,
  },
  modalInput: {
    backgroundColor: COLORS.bgDark,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: COLORS.border,
    color: COLORS.textWhite,
    padding: 12,
    fontSize: 14,
    marginBottom: 16,
  },
  pinInput: {
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: 10,
    textAlign: 'center',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  modalBtnCancel: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: COLORS.bgSurface,
    borderRadius: 6,
  },
  modalBtnCancelText: {
    color: COLORS.textMuted,
    fontWeight: '800',
    fontSize: 12,
  },
  modalBtnConfirm: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: COLORS.gpBlue,
    borderRadius: 6,
  },
  modalBtnConfirmText: {
    color: '#fff',
    fontWeight: '900',
    fontSize: 12,
  },
});
