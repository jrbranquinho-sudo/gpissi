import React from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity } from 'react-native';
import { COLORS } from '../theme/colors';

export default function Header({ onRefresh, isConnected = true, serverUrl }) {
  return (
    <View style={styles.headerContainer}>
      <View style={styles.brandRow}>
        <View style={styles.logoBadge}>
          {/* Fallback caso a imagem não carregue */}
          <Image
            source={require('../../assets/logo.png')}
            style={styles.logoImage}
            resizeMode="contain"
          />
        </View>

        <View style={styles.titleContainer}>
          <View style={styles.titleRow}>
            <Text style={styles.titleGp}>GP</Text>
            <Text style={styles.titleIssi}>ISSI</Text>
            <Text style={styles.titleTag}>• MC</Text>
          </View>
          <Text style={styles.subtitle}>INSANO NA ESTRADA</Text>
        </View>

        <View style={styles.statusBox}>
          <View style={[styles.statusDot, { backgroundColor: isConnected ? COLORS.success : COLORS.danger }]} />
          <Text style={styles.statusText}>{isConnected ? 'CONECTADO' : 'OFFLINE'}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  headerContainer: {
    backgroundColor: COLORS.bgCard,
    paddingTop: 12,
    paddingBottom: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  logoBadge: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 102, 0, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 102, 0, 0.3)',
  },
  logoImage: {
    width: 28,
    height: 28,
  },
  titleContainer: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  titleGp: {
    fontSize: 20,
    fontWeight: '900',
    color: COLORS.gpBlue,
    letterSpacing: 1,
  },
  titleIssi: {
    fontSize: 20,
    fontWeight: '900',
    color: COLORS.issiOrange,
    letterSpacing: 1,
  },
  titleTag: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textMuted,
    marginLeft: 6,
  },
  subtitle: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.textMuted,
    letterSpacing: 1.5,
  },
  statusBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.bgSurface,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginRight: 6,
  },
  statusText: {
    fontSize: 9,
    fontWeight: '800',
    color: COLORS.textSecondary,
    letterSpacing: 0.5,
  },
});
