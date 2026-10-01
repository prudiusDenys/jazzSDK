/**
 * SberJazz — интеграция Jazz iOS SDK с React Native 0.77.3.
 *
 * На экране одна кнопка: она инициализирует SDK (при первом нажатии) и
 * присоединяет к встрече по ссылке. Весь дальнейший UI рисует сам SDK.
 * Логика — в хуке src/jazz/useJazzMeeting.ts, нативная часть —
 * ios/SberJazz/Jazz/JazzSdkModule.swift.
 */
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
} from 'react-native';

import {useJazzMeeting} from './src/jazz/useJazzMeeting';

/**
 * Транспортный JWT для Jazz. Выпускается вашим бэкендом по ключу SDK
 * (см. README, «Авторизация по токену») — замените на запрос к нему.
 */
async function getJazzTransportToken(): Promise<string> {
  throw new Error(
    'Не настроено получение транспортного токена: ' +
      'реализуйте getJazzTransportToken() в App.tsx.',
  );
}

/**
 * Ссылка на встречу. Комната создаётся вне приложения — подставьте ссылку,
 * полученную оттуда (например, из вашего API).
 */
const MEETING_URL =
  'https://salutejazz.ru/zhckk3?psw=OB4WUBpWD0MCDhFGRUIYUA0EDA';

function App(): React.JSX.Element {
  const {joinMeeting, busy} = useJazzMeeting({
    getTransportToken: getJazzTransportToken,
  });

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#0B1220" />
      <Pressable
        accessibilityRole="button"
        onPress={() => joinMeeting(MEETING_URL)}
        disabled={busy}
        style={({pressed}) => [styles.button, pressed && styles.pressed]}>
        {busy ? (
          <ActivityIndicator color="#F8FAFC" />
        ) : (
          <Text style={styles.buttonText}>Online Встреча</Text>
        )}
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0B1220',
    alignItems: 'center',
    justifyContent: 'center',
  },
  button: {
    minWidth: 240,
    backgroundColor: '#2563EB',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 32,
    alignItems: 'center',
  },
  pressed: {opacity: 0.75},
  buttonText: {color: '#F8FAFC', fontSize: 17, fontWeight: '600'},
});

export default App;
