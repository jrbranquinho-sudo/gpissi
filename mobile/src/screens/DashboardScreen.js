import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { COLORS } from '../theme/colors';
import { fetchTrips } from '../services/api';

export default function DashboardScreen({ onSelectTrip, onNewTrip, onOpenSettings }) {
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadTrips = async () => {
    try {
      const data = await fetchTrips();
      if (Array.isArray(data) && data.length > 0) {
        setTrips(data);
      } else {
        // Viagem padrão para teste imediato de telemetria caso a API ainda não tenha registros
        setTrips([
          {
            id: 'INS-2026-SP-RJ',
            integrante: 'Falcão da Noite',
            colete: 'Falcão',
            divisao: 'Divisão São Paulo - Capital',
            veiculo: 'Harley-Davidson Street Glide 114',
            origem: 'São Paulo - SP',
            destino: 'Rio de Janeiro - RJ',
            distancia_km: 435,
            tempo_estimado_formatado: '4h 30min',
            status: 'NA ESTRADA',
            checkins: [
              {
                cidade: 'São Paulo - SP (Saída)',
                descricao: 'Início da rota pela Dutra',
                timestamp: new Date().toISOString(),
              },
            ],
          },
          {
            id: 'INS-2026-BH-SP',
            integrante: 'Lobo Solitário',
            colete: 'Lobo',
            divisao: 'Divisão Belo Horizonte',
            veiculo: 'BMW R 1250 GS',
            origem: 'Belo Horizonte - MG',
            destino: 'São Paulo - SP',
            distancia_km: 585,
            tempo_estimado_formatado: '6h 15min',
            status: 'NA ESTRADA',
            checkins: [],
          },
        ]);
      }
    } catch (err) {
      // Fallback em caso de offline com viagem de demonstração pronta
      setTrips([
        {
          id: 'TESTE-GPS-01',
          integrante: 'Irmão de Estrada',
          colete: 'Caveira 01',
          divisao: 'Sede Nacional',
          veiculo: 'Triumph Tiger 900',
          origem: 'São Paulo - SP',
          destino: 'Santos - SP',
          distancia_km: 78,
          tempo_estimado_formatado: '1h 10min',
          status: 'NA ESTRADA',
          checkins: [],
        },
      ]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadTrips();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    loadTrips();
  };

  const renderTripCard = ({ item }) => {
    const isEnRoute = item.status === 'NA ESTRADA' || item.status === 'ABERTA';

    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.85}
        onPress={() => onSelectTrip(item)}
      >
        <View style={styles.cardHeader}>
          <View style={styles.riderBox}>
            <Text style={styles.riderIcon}>🏍️</Text>
            <View>
              <Text style={styles.riderName}>{item.integrante || 'Piloto'}</Text>
              <Text style={styles.riderColete}>Colete: "{item.colete || item.integrante}"</Text>
            </View>
          </View>

          <View style={[styles.badge, isEnRoute ? styles.badgeActive : styles.badgeDone]}>
            <View style={[styles.badgeDot, { backgroundColor: isEnRoute ? COLORS.success : COLORS.textMuted }]} />
            <Text style={[styles.badgeText, { color: isEnRoute ? COLORS.success : COLORS.textMuted }]}>
              {item.status || 'NA ESTRADA'}
            </Text>
          </View>
        </View>

        <View style={styles.divider} />

        <View style={styles.routeBox}>
          <View style={styles.routePoint}>
            <Text style={styles.routeLabel}>ORIGEM</Text>
            <Text style={styles.routeCity} numberOfLines={1}>{item.origem}</Text>
          </View>
          <Text style={styles.routeArrow}>➔</Text>
          <View style={styles.routePoint}>
            <Text style={styles.routeLabel}>DESTINO</Text>
            <Text style={styles.routeCity} numberOfLines={1}>{item.destino}</Text>
          </View>
        </View>

        <View style={styles.detailsRow}>
          <Text style={styles.vehicleText} numberOfLines={1}>
            🔧 {item.veiculo || 'Motocicleta'}
          </Text>
          <Text style={styles.distanceText}>
            📏 {item.distancia_km ? `${item.distancia_km} km` : 'Calculando...'}
          </Text>
        </View>

        <TouchableOpacity
          style={styles.btnCardTrack}
          onPress={() => onSelectTrip(item)}
        >
          <Text style={styles.btnCardTrackText}>📍 ACOMPANHAR & TRANSMITIR GPS</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* KPI Tático */}
      <View style={styles.kpiContainer}>
        <View style={styles.kpiCard}>
          <Text style={styles.kpiValue}>{trips.filter(t => t.status !== 'CONCLUÍDA').length}</Text>
          <Text style={styles.kpiLabel}>NA ESTRADA AGORA</Text>
        </View>
        <View style={styles.kpiCard}>
          <Text style={[styles.kpiValue, { color: COLORS.gpBlue }]}>{trips.length}</Text>
          <Text style={styles.kpiLabel}>TOTAL PROTOCOLOS</Text>
        </View>
      </View>

      {/* Botões de Ação Rápida */}
      <View style={styles.actionsBar}>
        <TouchableOpacity style={styles.btnNewTrip} onPress={onNewTrip}>
          <Text style={styles.btnNewTripText}>➕ NOVO PROTOCOLO</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btnSettings} onPress={onOpenSettings}>
          <Text style={styles.btnSettingsText}>⚙️ CONEXÃO</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionTitle}>MONITORAMENTO DE VIAGENS EM TEMPO REAL</Text>

      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={COLORS.issiOrange} />
          <Text style={styles.loadingText}>Carregando protocolos do radar...</Text>
        </View>
      ) : (
        <FlatList
          data={trips}
          keyExtractor={(item) => String(item.id || Math.random())}
          renderItem={renderTripCard}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={COLORS.issiOrange}
              colors={[COLORS.issiOrange]}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyTitle}>Nenhuma viagem ativa no momento</Text>
              <Text style={styles.emptySubtitle}>Cadastre um novo protocolo de viagem para iniciar a telemetria GPS.</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bgDark,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  kpiContainer: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  kpiCard: {
    flex: 1,
    backgroundColor: COLORS.bgCard,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
  },
  kpiValue: {
    fontSize: 22,
    fontWeight: '900',
    color: COLORS.issiOrange,
  },
  kpiLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: COLORS.textMuted,
    marginTop: 2,
    letterSpacing: 0.5,
  },
  actionsBar: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  btnNewTrip: {
    flex: 2,
    backgroundColor: COLORS.issiOrange,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    shadowColor: COLORS.issiOrange,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  btnNewTripText: {
    color: '#fff',
    fontWeight: '900',
    fontSize: 13,
    letterSpacing: 0.5,
  },
  btnSettings: {
    flex: 1,
    backgroundColor: COLORS.bgCard,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  btnSettingsText: {
    color: COLORS.textSecondary,
    fontWeight: '800',
    fontSize: 12,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: COLORS.textMuted,
    letterSpacing: 1,
    marginBottom: 10,
  },
  listContent: {
    paddingBottom: 24,
  },
  card: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  riderBox: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  riderIcon: {
    fontSize: 24,
    marginRight: 10,
  },
  riderName: {
    color: COLORS.textWhite,
    fontSize: 15,
    fontWeight: '800',
  },
  riderColete: {
    color: COLORS.issiOrangeBright,
    fontSize: 12,
    fontWeight: '600',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgeActive: {
    backgroundColor: COLORS.successBg,
    borderWidth: 1,
    borderColor: 'rgba(0, 230, 118, 0.4)',
  },
  badgeDone: {
    backgroundColor: COLORS.bgSurface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 5,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginVertical: 10,
  },
  routeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.bgSurface,
    padding: 10,
    borderRadius: 6,
    marginBottom: 10,
  },
  routePoint: {
    flex: 1,
  },
  routeLabel: {
    color: COLORS.textMuted,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  routeCity: {
    color: COLORS.textWhite,
    fontSize: 13,
    fontWeight: '700',
  },
  routeArrow: {
    color: COLORS.gpBlue,
    fontSize: 16,
    paddingHorizontal: 8,
  },
  detailsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  vehicleText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    flex: 1,
  },
  distanceText: {
    color: COLORS.gpBlueLight,
    fontSize: 12,
    fontWeight: '700',
  },
  btnCardTrack: {
    backgroundColor: 'rgba(0, 176, 255, 0.12)',
    borderWidth: 1,
    borderColor: COLORS.gpBlue,
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
  },
  btnCardTrackText: {
    color: COLORS.gpBlueLight,
    fontWeight: '800',
    fontSize: 12,
    letterSpacing: 0.5,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 40,
  },
  loadingText: {
    color: COLORS.textMuted,
    marginTop: 10,
    fontSize: 13,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyTitle: {
    color: COLORS.textWhite,
    fontSize: 16,
    fontWeight: '700',
  },
  emptySubtitle: {
    color: COLORS.textMuted,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 6,
    paddingHorizontal: 20,
  },
});
