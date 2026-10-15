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
import { getBaseUrl, setBaseUrl, testServerConnection } from '../services/api';
import { getCurrentPosition } from '../services/location';
import { triggerNotification, requestNotificationPermission } from '../services/notifications';

export default function ConfigScreen({ onBack }) {
  const [url, setUrl] = useState(getBaseUrl());
  const [testing, setTesting] = useState(false);
  const [statusMsg, setStatusMsg] = useState(null);

  const applyPreset = (presetUrl) => {
    setUrl(presetUrl);
    setBaseUrl(presetUrl);
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setStatusMsg(null);
    setBaseUrl(url);

    const ok = await testServerConnection(url);
    setTesting(false);
    if (ok) {
      setStatusMsg({ ok: true, text: '✅ Conexão estabelecida com sucesso com o GPISSI!' });
      Alert.alert('Sucesso', 'Servidor respondendo normalmente.');
    } else {
      setStatusMsg({ ok: false, text: '❌ Não foi possível conectar ao servidor neste endereço.' });
      Alert.alert('Falha na Conexão', 'Verifique a URL ou se o backend está ligado na mesma rede Wi-Fi.');
    }
  };

  // Teste de GPS
  const handleTestGps = async () => {
    try {
      Alert.alert('Lendo GPS...', 'Aguarde a fixação de satélites no dispositivo.');
      const pos = await getCurrentPosition();
      Alert.alert(
        '🛰️ Sinal de GPS Confirmado!',
        `Latitude: ${pos.lat.toFixed(6)}\nLongitude: ${pos.lng.toFixed(6)}\nVelocidade: ${pos.speedKmH} km/h\nPrecisão: ±${pos.accuracy}m\nLocal: ${pos.cidade}`
      );
    } catch (err) {
      Alert.alert('Erro no GPS', err.message || 'Não foi possível ler o GPS.');
    }
  };

  // Teste de Notificação
  const handleTestNotification = async () => {
    const granted = await requestNotificationPermission();
    if (!granted) {
      Alert.alert('Permissão', 'Permissão de notificação não concedida nas configurações do celular.');
      return;
    }

    await triggerNotification(
      '🔔 Teste de Notificação GPISSI',
      'Som e vibração funcionando perfeitamente no seu dispositivo!'
    );

    Alert.alert('Notificação Disparada!', 'Confira a barra de notificações do seu celular.');
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <TouchableOpacity style={styles.btnBack} onPress={onBack}>
        <Text style={styles.btnBackText}>← VOLTAR AO DASHBOARD</Text>
      </TouchableOpacity>

      <Text style={styles.title}>⚙️ CONFIGURAÇÕES & CONEXÃO</Text>
      <Text style={styles.subtitle}>Configuração do ambiente de teste e diagnóstico de sensores</Text>

      {/* URL DO SERVIDOR */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>ENDEREÇO DA API GPISSI</Text>
        <TextInput
          style={styles.input}
          value={url}
          onChangeText={(val) => {
            setUrl(val);
            setBaseUrl(val);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="https://..."
          placeholderTextColor={COLORS.textMuted}
        />

        <Text style={styles.presetsLabel}>PRESETS RÁPIDOS:</Text>
        <View style={styles.presetsRow}>
          <TouchableOpacity
            style={styles.presetBtn}
            onPress={() => applyPreset('https://gpissi.vercel.app')}
          >
            <Text style={styles.presetBtnText}>🌐 Nuvem Vercel</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.presetBtn}
            onPress={() => applyPreset('http://10.0.2.2:3000')}
          >
            <Text style={styles.presetBtnText}>📱 Emulador Android</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.presetBtn}
            onPress={() => applyPreset('http://localhost:3000')}
          >
            <Text style={styles.presetBtnText}>💻 Localhost</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.btnTest}
          onPress={handleTestConnection}
          disabled={testing}
        >
          {testing ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.btnTestText}>TESTAR CONEXÃO COM SERVIDOR</Text>
          )}
        </TouchableOpacity>

        {statusMsg && (
          <Text style={[styles.statusMsg, { color: statusMsg.ok ? COLORS.success : COLORS.danger }]}>
            {statusMsg.text}
          </Text>
        )}
      </View>

      {/* DIAGNÓSTICO DE HARDWARE */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>DIAGNÓSTICO DE SENSORES NATIVOS</Text>

        <TouchableOpacity style={styles.btnDiagGps} onPress={handleTestGps}>
          <Text style={styles.btnDiagText}>🛰️ TESTAR SENSOR GPS AGORA</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.btnDiagNotif} onPress={handleTestNotification}>
          <Text style={styles.btnDiagText}>🔔 TESTAR NOTIFICAÇÃO & SOM AGORA</Text>
        </TouchableOpacity>
      </View>

      {/* GUIA DE TESTE RÁPIDO */}
      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>💡 Como testar no seu celular físico:</Text>
        <Text style={styles.infoText}>
          1. Certifique-se de que o computador e o celular estão conectados no mesmo Wi-Fi.{'\n'}
          2. No terminal do PC, veja o seu IP local (ex: 192.168.1.50).{'\n'}
          3. Digite http://SEU_IP:3000 acima para conectar seu celular físico ao backend local.{'\n'}
          4. Ou use o preset "🌐 Nuvem Vercel" para testar sem precisar rodar servidor local!
        </Text>
      </View>
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
  title: {
    color: COLORS.textWhite,
    fontSize: 18,
    fontWeight: '900',
  },
  subtitle: {
    color: COLORS.textMuted,
    fontSize: 11,
    marginTop: 2,
    marginBottom: 16,
  },
  card: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    marginBottom: 14,
  },
  cardTitle: {
    color: COLORS.issiOrange,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 10,
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
    marginBottom: 12,
  },
  presetsLabel: {
    color: COLORS.textMuted,
    fontSize: 9,
    fontWeight: '800',
    marginBottom: 6,
  },
  presetsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  presetBtn: {
    backgroundColor: COLORS.bgSurface,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  presetBtnText: {
    color: COLORS.textSecondary,
    fontSize: 11,
    fontWeight: '700',
  },
  btnTest: {
    backgroundColor: COLORS.gpBlue,
    paddingVertical: 12,
    borderRadius: 6,
    alignItems: 'center',
  },
  btnTestText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  statusMsg: {
    marginTop: 10,
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },
  btnDiagGps: {
    backgroundColor: 'rgba(0, 176, 255, 0.15)',
    borderWidth: 1,
    borderColor: COLORS.gpBlue,
    paddingVertical: 12,
    borderRadius: 6,
    alignItems: 'center',
    marginBottom: 10,
  },
  btnDiagNotif: {
    backgroundColor: 'rgba(255, 102, 0, 0.15)',
    borderWidth: 1,
    borderColor: COLORS.issiOrange,
    paddingVertical: 12,
    borderRadius: 6,
    alignItems: 'center',
  },
  btnDiagText: {
    color: COLORS.textWhite,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  infoCard: {
    backgroundColor: 'rgba(0, 176, 255, 0.08)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(0, 176, 255, 0.25)',
    padding: 14,
  },
  infoTitle: {
    color: COLORS.gpBlueLight,
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 6,
  },
  infoText: {
    color: COLORS.textSecondary,
    fontSize: 11,
    lineHeight: 18,
  },
});
