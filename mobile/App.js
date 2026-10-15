import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  SafeAreaView,
  StatusBar as RNStatusBar,
  Platform,
  TouchableOpacity,
  Text,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { COLORS } from './src/theme/colors';
import Header from './src/components/Header';
import DashboardScreen from './src/screens/DashboardScreen';
import TrackerScreen from './src/screens/TrackerScreen';
import NovoProtocoloScreen from './src/screens/NovoProtocoloScreen';
import ConfigScreen from './src/screens/ConfigScreen';
import { getBaseUrl, testServerConnection } from './src/services/api';
import { requestNotificationPermission } from './src/services/notifications';
import { requestLocationPermissions } from './src/services/location';

export default function App() {
  const [currentScreen, setCurrentScreen] = useState('DASHBOARD'); // 'DASHBOARD' | 'TRACKER' | 'NOVO' | 'CONFIG'
  const [selectedTrip, setSelectedTrip] = useState(null);
  const [isConnected, setIsConnected] = useState(true);

  // Inicialização e verificação de saúde do sistema
  useEffect(() => {
    checkHealth();
    requestNotificationPermission();
    requestLocationPermissions();
  }, []);

  const checkHealth = async () => {
    const ok = await testServerConnection();
    setIsConnected(ok);
  };

  const handleSelectTrip = (trip) => {
    setSelectedTrip(trip);
    setCurrentScreen('TRACKER');
  };

  const handleTripCreated = (newTrip) => {
    setSelectedTrip(newTrip);
    setCurrentScreen('TRACKER');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" backgroundColor={COLORS.bgDark} />

      {/* Cabeçalho Oficial GPISSI */}
      <Header
        isConnected={isConnected}
        serverUrl={getBaseUrl()}
        onRefresh={checkHealth}
      />

      {/* Renderização de Telas */}
      <View style={styles.body}>
        {currentScreen === 'DASHBOARD' && (
          <DashboardScreen
            onSelectTrip={handleSelectTrip}
            onNewTrip={() => setCurrentScreen('NOVO')}
            onOpenSettings={() => setCurrentScreen('CONFIG')}
          />
        )}

        {currentScreen === 'TRACKER' && (
          <TrackerScreen
            trip={
              selectedTrip || {
                id: 'DEMO-GPISSI',
                integrante: 'Irmão de Estrada',
                colete: 'Insano',
                veiculo: 'Motocicleta Padrão',
                origem: 'São Paulo - SP',
                destino: 'Rio de Janeiro - RJ',
                distancia_km: 435,
                status: 'NA ESTRADA',
                checkins: [],
              }
            }
            onBack={() => setCurrentScreen('DASHBOARD')}
            onTripUpdated={() => checkHealth()}
          />
        )}

        {currentScreen === 'NOVO' && (
          <NovoProtocoloScreen
            onBack={() => setCurrentScreen('DASHBOARD')}
            onTripCreated={handleTripCreated}
          />
        )}

        {currentScreen === 'CONFIG' && (
          <ConfigScreen
            onBack={() => {
              checkHealth();
              setCurrentScreen('DASHBOARD');
            }}
          />
        )}
      </View>

      {/* BARRA DE NAVEGAÇÃO INFERIOR (BOTTOM TABS) */}
      <View style={styles.bottomNav}>
        <TouchableOpacity
          style={styles.navItem}
          onPress={() => setCurrentScreen('DASHBOARD')}
        >
          <Text style={[styles.navIcon, currentScreen === 'DASHBOARD' && styles.navIconActive]}>
            📊
          </Text>
          <Text style={[styles.navLabel, currentScreen === 'DASHBOARD' && styles.navLabelActive]}>
            Dashboard
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.navItem}
          onPress={() => {
            if (!selectedTrip) {
              setSelectedTrip({
                id: 'GPS-RADAR-01',
                integrante: 'Piloto Ativo',
                colete: 'Estrada',
                veiculo: 'Harley-Davidson Fat Boy',
                origem: 'São Paulo - SP',
                destino: 'Curitiba - PR',
                distancia_km: 408,
                status: 'NA ESTRADA',
                checkins: [],
              });
            }
            setCurrentScreen('TRACKER');
          }}
        >
          <Text style={[styles.navIcon, currentScreen === 'TRACKER' && styles.navIconActive]}>
            📍
          </Text>
          <Text style={[styles.navLabel, currentScreen === 'TRACKER' && styles.navLabelActive]}>
            GPS Ao Vivo
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.navItem}
          onPress={() => setCurrentScreen('NOVO')}
        >
          <Text style={[styles.navIcon, currentScreen === 'NOVO' && styles.navIconActive]}>
            ➕
          </Text>
          <Text style={[styles.navLabel, currentScreen === 'NOVO' && styles.navLabelActive]}>
            Novo Protocolo
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.navItem}
          onPress={() => setCurrentScreen('CONFIG')}
        >
          <Text style={[styles.navIcon, currentScreen === 'CONFIG' && styles.navIconActive]}>
            ⚙️
          </Text>
          <Text style={[styles.navLabel, currentScreen === 'CONFIG' && styles.navLabelActive]}>
            Ajustes
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.bgDark,
    paddingTop: Platform.OS === 'android' ? RNStatusBar.currentHeight : 0,
  },
  body: {
    flex: 1,
  },
  bottomNav: {
    flexDirection: 'row',
    backgroundColor: COLORS.bgCard,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingVertical: 8,
    paddingHorizontal: 6,
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  navIcon: {
    fontSize: 18,
    opacity: 0.6,
  },
  navIconActive: {
    opacity: 1,
    transform: [{ scale: 1.1 }],
  },
  navLabel: {
    color: COLORS.textMuted,
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
  },
  navLabelActive: {
    color: COLORS.issiOrange,
    fontWeight: '900',
  },
});
