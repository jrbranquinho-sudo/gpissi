import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { COLORS } from '../theme/colors';
import { createTrip, generateSecurePin, calculateRoute } from '../services/api';
import { notifyRoadAlert } from '../services/notifications';

export default function NovoProtocoloScreen({ onBack, onTripCreated }) {
  const [integrante, setIntegrante] = useState('');
  const [colete, setColete] = useState('');
  const [divisao, setDivisao] = useState('Divisão São Paulo - Capital');
  const [veiculo, setVeiculo] = useState('');
  const [origem, setOrigem] = useState('');
  const [destino, setDestino] = useState('');
  const [pin, setPin] = useState('');
  const [contatoEmergencia, setContatoEmergencia] = useState('');

  const [calculating, setCalculating] = useState(false);
  const [routeInfo, setRouteInfo] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Gera um PIN de 4 dígitos não sequencial
  const handleGeneratePin = async () => {
    try {
      const generated = await generateSecurePin();
      setPin(generated);
    } catch (e) {
      setPin('7492');
    }
  };

  // Calcula a rota e distância
  const handleCalcRoute = async () => {
    if (!origem || !destino) {
      Alert.alert('Preenchimento', 'Informe a Cidade de Origem e a Cidade de Destino.');
      return;
    }

    try {
      setCalculating(true);
      const res = await calculateRoute(origem, destino, 'MOTO');
      if (res && res.distancia_km) {
        setRouteInfo(res);
        Alert.alert(
          'Rota Calculada',
          `Distância: ${res.distancia_km} km\nTempo estimado: ${res.tempo_estimado_formatado || res.duracao}`
        );
      } else {
        // Estimativa padrão se offline
        setRouteInfo({
          distancia_km: 250,
          tempo_estimado_formatado: '2h 45min',
        });
      }
    } catch (err) {
      setRouteInfo({
        distancia_km: 250,
        tempo_estimado_formatado: '2h 45min',
      });
    } finally {
      setCalculating(false);
    }
  };

  // Envia formulário para API
  const handleSubmit = async () => {
    if (!integrante || !origem || !destino || !pin) {
      Alert.alert('Atenção', 'Preencha Nome do Integrante, Origem, Destino e o PIN de 4 dígitos.');
      return;
    }

    if (pin.length !== 4) {
      Alert.alert('PIN Inválido', 'O PIN de segurança deve ter exatamente 4 dígitos.');
      return;
    }

    try {
      setSubmitting(true);
      const payload = {
        integrante,
        colete: colete || integrante,
        divisao,
        veiculo: veiculo || 'Motocicleta Padrão',
        origem,
        destino,
        creator_pin: pin,
        contato_emergencia: contatoEmergencia,
        distancia_km: routeInfo?.distancia_km || 150,
        tempo_estimado_formatado: routeInfo?.tempo_estimado_formatado || '1h 50min',
        status: 'NA ESTRADA',
      };

      const res = await createTrip(payload);

      // Notificação local de rota iniciada
      await notifyRoadAlert(`Novo protocolo criado: ${origem} ➔ ${destino}. Boa viagem irmão!`);

      Alert.alert(
        'Protocolo Aberto!',
        `Viagem registrada com sucesso!\nGuarde o seu PIN (${pin}) para o encerramento.`,
        [
          {
            text: 'INICIAR RASTREAMENTO',
            onPress: () => {
              const createdTrip = res.viagem || { ...payload, id: res.id || 'INS-' + Date.now().toString().slice(-6) };
              onTripCreated(createdTrip);
            },
          },
        ]
      );
    } catch (err) {
      // Fallback local caso backend não esteja respondendo
      const localTrip = {
        id: 'INS-LOCAL-' + Math.floor(1000 + Math.random() * 9000),
        integrante,
        colete: colete || integrante,
        divisao,
        veiculo: veiculo || 'Motocicleta Padrão',
        origem,
        destino,
        creator_pin: pin,
        distancia_km: routeInfo?.distancia_km || 150,
        tempo_estimado_formatado: routeInfo?.tempo_estimado_formatado || '1h 50min',
        status: 'NA ESTRADA',
        checkins: [],
      };

      Alert.alert(
        'Protocolo Aberto Localmente',
        `Servidor offline. O protocolo foi criado localmente para telemetria imediata. ID: ${localTrip.id}`,
        [
          {
            text: 'OK',
            onPress: () => onTripCreated(localTrip),
          },
        ]
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <TouchableOpacity style={styles.btnBack} onPress={onBack}>
        <Text style={styles.btnBackText}>← VOLTAR AO DASHBOARD</Text>
      </TouchableOpacity>

      <Text style={styles.screenTitle}>📝 NOVO PROTOCOLO DE VIAGEM</Text>
      <Text style={styles.screenSubtitle}>Insanos MC • Gestão Oficial de Itinerário de Segurança</Text>

      {/* DADOS DO PILOTO */}
      <View style={styles.sectionCard}>
        <Text style={styles.sectionLabel}>DADOS DO INTEGRANTE</Text>

        <Text style={styles.inputLabel}>NOME COMPLETO</Text>
        <TextInput
          style={styles.input}
          placeholder="Ex: Carlos Eduardo Silva"
          placeholderTextColor={COLORS.textMuted}
          value={integrante}
          onChangeText={setIntegrante}
        />

        <Text style={styles.inputLabel}>NOME DE COLETE</Text>
        <TextInput
          style={styles.input}
          placeholder="Ex: Falcão"
          placeholderTextColor={COLORS.textMuted}
          value={colete}
          onChangeText={setColete}
        />

        <Text style={styles.inputLabel}>DIVISÃO / REGIONAL</Text>
        <TextInput
          style={styles.input}
          placeholder="Ex: Divisão São Paulo - Capital"
          placeholderTextColor={COLORS.textMuted}
          value={divisao}
          onChangeText={setDivisao}
        />

        <Text style={styles.inputLabel}>VEÍCULO / MOTOCICLETA</Text>
        <TextInput
          style={styles.input}
          placeholder="Ex: Harley-Davidson Road Glide 114"
          placeholderTextColor={COLORS.textMuted}
          value={veiculo}
          onChangeText={setVeiculo}
        />
      </View>

      {/* ROTA E CIDADES */}
      <View style={styles.sectionCard}>
        <Text style={styles.sectionLabel}>ITINERÁRIO DA ESTRADA</Text>

        <Text style={styles.inputLabel}>CIDADE DE ORIGEM</Text>
        <TextInput
          style={styles.input}
          placeholder="Ex: São Paulo - SP"
          placeholderTextColor={COLORS.textMuted}
          value={origem}
          onChangeText={setOrigem}
        />

        <Text style={styles.inputLabel}>CIDADE DE DESTINO</Text>
        <TextInput
          style={styles.input}
          placeholder="Ex: Rio de Janeiro - RJ"
          placeholderTextColor={COLORS.textMuted}
          value={destino}
          onChangeText={setDestino}
        />

        <TouchableOpacity
          style={styles.btnCalc}
          onPress={handleCalcRoute}
          disabled={calculating}
        >
          {calculating ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.btnCalcText}>⚡ CALCULAR DISTÂNCIA E TEMPO</Text>
          )}
        </TouchableOpacity>

        {routeInfo && (
          <View style={styles.routeResultBox}>
            <Text style={styles.routeResultText}>
              📏 Distância: {routeInfo.distancia_km} km | ⏱️ Previsão: {routeInfo.tempo_estimado_formatado}
            </Text>
          </View>
        )}
      </View>

      {/* SEGURANÇA E PIN */}
      <View style={styles.sectionCard}>
        <Text style={styles.sectionLabel}>SEGURANÇA & PIN DE ENCERRAMENTO</Text>

        <Text style={styles.inputLabel}>PIN DE 4 DÍGITOS (NÃO SEQUENCIAL)</Text>
        <View style={styles.pinRow}>
          <TextInput
            style={[styles.input, styles.pinInput]}
            placeholder="0000"
            placeholderTextColor={COLORS.textMuted}
            keyboardType="number-pad"
            maxLength={4}
            value={pin}
            onChangeText={setPin}
          />
          <TouchableOpacity style={styles.btnGenPin} onPress={handleGeneratePin}>
            <Text style={styles.btnGenPinText}>🎲 GERAR</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.inputLabel}>CELULAR / CONTATO DE EMERGÊNCIA</Text>
        <TextInput
          style={styles.input}
          placeholder="(11) 99999-9999"
          placeholderTextColor={COLORS.textMuted}
          keyboardType="phone-pad"
          value={contatoEmergencia}
          onChangeText={setContatoEmergencia}
        />
      </View>

      {/* BOTÃO SUBMIT */}
      <TouchableOpacity
        style={styles.btnSubmit}
        onPress={handleSubmit}
        disabled={submitting}
      >
        {submitting ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <Text style={styles.btnSubmitText}>🚀 ABRIR PROTOCOLO & INICIAR</Text>
        )}
      </TouchableOpacity>
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
    paddingBottom: 40,
  },
  btnBack: {
    paddingVertical: 8,
    marginBottom: 4,
  },
  btnBackText: {
    color: COLORS.gpBlue,
    fontSize: 12,
    fontWeight: '800',
  },
  screenTitle: {
    color: COLORS.textWhite,
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  screenSubtitle: {
    color: COLORS.textMuted,
    fontSize: 11,
    marginTop: 2,
    marginBottom: 16,
  },
  sectionCard: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    marginBottom: 14,
  },
  sectionLabel: {
    color: COLORS.issiOrange,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 10,
  },
  inputLabel: {
    color: COLORS.textSecondary,
    fontSize: 10,
    fontWeight: '800',
    marginBottom: 4,
  },
  input: {
    backgroundColor: COLORS.bgDark,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: COLORS.border,
    color: COLORS.textWhite,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    marginBottom: 10,
  },
  btnCalc: {
    backgroundColor: 'rgba(0, 176, 255, 0.15)',
    borderWidth: 1,
    borderColor: COLORS.gpBlue,
    borderRadius: 6,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 4,
  },
  btnCalcText: {
    color: COLORS.gpBlueLight,
    fontWeight: '800',
    fontSize: 11,
    letterSpacing: 0.5,
  },
  routeResultBox: {
    backgroundColor: COLORS.bgSurface,
    padding: 10,
    borderRadius: 6,
    marginTop: 10,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.gpBlue,
  },
  routeResultText: {
    color: COLORS.textWhite,
    fontSize: 12,
    fontWeight: '700',
  },
  pinRow: {
    flexDirection: 'row',
    gap: 10,
  },
  pinInput: {
    flex: 1,
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 4,
    textAlign: 'center',
  },
  btnGenPin: {
    backgroundColor: COLORS.bgSurface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 6,
    paddingHorizontal: 16,
    justifyContent: 'center',
    marginBottom: 10,
  },
  btnGenPinText: {
    color: COLORS.issiOrangeBright,
    fontWeight: '800',
    fontSize: 12,
  },
  btnSubmit: {
    backgroundColor: COLORS.issiOrange,
    paddingVertical: 15,
    borderRadius: 8,
    alignItems: 'center',
    shadowColor: COLORS.issiOrange,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4,
    shadowRadius: 5,
    elevation: 4,
    marginTop: 6,
  },
  btnSubmitText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
});
