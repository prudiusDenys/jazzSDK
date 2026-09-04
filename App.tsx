/**
 * SberJazz — демо интеграции Jazz iOS SDK с React Native 0.77.3.
 *
 * Весь нативный функционал спрятан за модулем `src/jazz/JazzSdk.ts`,
 * который проксирует вызовы в `JazzSession.shared`
 * (см. ios/SberJazz/Jazz/JazzSdkModule.swift).
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import {architectureLabel} from './src/arch';
import Jazz, {
  isJazzSupported,
  type JazzConferencePhaseEvent,
} from './src/jazz/JazzSdk';

const DEFAULT_HOST = 'https://jazz.sber.ru';

function App(): React.JSX.Element {
  const [sdkSecret, setSdkSecret] = useState('');
  const [hostUrl, setHostUrl] = useState(DEFAULT_HOST);
  const [userId, setUserId] = useState('123456');
  const [userName, setUserName] = useState('React Native User');

  const [title, setTitle] = useState('RN Demo Meeting');
  const [roomId, setRoomId] = useState('');
  const [roomPassword, setRoomPassword] = useState('');
  const [linkUrl, setLinkUrl] = useState('');

  const [isCameraOn, setCameraOn] = useState(false);
  const [isMicrophoneOn, setMicrophoneOn] = useState(false);

  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<string>('—');
  const [log, setLog] = useState<string[]>([]);

  const append = useCallback((line: string) => {
    const stamp = new Date().toLocaleTimeString();
    setLog(prev => [`[${stamp}] ${line}`, ...prev].slice(0, 40));
  }, []);

  // Фаза конференции приходит из Combine-подписки на
  // JazzSession.shared.$jazzConferencePhase внутри нативного модуля.
  useEffect(() => {
    const sub = Jazz.addConferencePhaseListener(
      (event: JazzConferencePhaseEvent) => {
        setPhase(event.phase);
        append(`phase → ${event.phase}`);
      },
    );
    return () => sub?.remove();
  }, [append]);

  const run = useCallback(
    async (label: string, fn: () => Promise<unknown>) => {
      setBusy(true);
      try {
        const result = await fn();
        const detail =
          result == null || result === true
            ? ''
            : ` → ${
                typeof result === 'string' ? result : JSON.stringify(result)
              }`;
        append(`${label}: ok${detail}`);
        return result;
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        append(`${label}: ошибка — ${message}`);
        Alert.alert(label, message);
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [append],
  );

  const onInitialize = useCallback(async () => {
    if (!sdkSecret.trim()) {
      Alert.alert(
        'Нужен ключ SDK',
        'Вставьте секретный ключ, полученный при регистрации приложения в Jazz. ' +
          'Без него инициализация не пройдёт.',
      );
    }
    const ok = await run('Jazz.initialize', () =>
      Jazz.initialize({
        sdkSecret: sdkSecret.trim(),
        hostUrl: hostUrl.trim() || DEFAULT_HOST,
        userId: userId.trim() || 'rn-demo-user',
        userName: userName.trim() || undefined,
        issuer: 'SberJazzRNDemo',
        timeToLive: 120,
      }),
    );
    setReady(ok === true);
  }, [hostUrl, run, sdkSecret, userId, userName]);

  const conferenceOptions = useMemo(
    () => ({
      title: title.trim() || 'RN Demo Meeting',
      type: 'meeting',
      isGuestsOn: true,
      isLobbyOn: false,
      isAutoRecordEnabled: false,
    }),
    [title],
  );

  const statusText = !isJazzSupported
    ? 'Нативный модуль JazzSdk недоступен (iOS-only)'
    : ready
    ? `SDK инициализирован · фаза: ${phase}`
    : 'SDK не инициализирован';

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#0B1220" />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled">
          <Text style={styles.h1}>SberJazz SDK</Text>
          <Text style={styles.subtitle}>
            React Native 0.77.3 · Jazz iOS SDK
          </Text>
          <Text style={styles.arch}>{architectureLabel}</Text>

          <View
            style={[styles.badge, ready ? styles.badgeReady : styles.badgeIdle]}>
            <Text style={styles.badgeText}>{statusText}</Text>
          </View>

          <Section title="Инициализация">
            <Field
              label="Секретный ключ SDK"
              value={sdkSecret}
              onChangeText={setSdkSecret}
              placeholder="sdk secret key"
              secureTextEntry
            />
            <Field label="Host URL" value={hostUrl} onChangeText={setHostUrl} />
            <Field label="User ID" value={userId} onChangeText={setUserId} />
            <Field
              label="Имя пользователя"
              value={userName}
              onChangeText={setUserName}
            />
            <Button
              title="Инициализировать Jazz"
              onPress={onInitialize}
              disabled={busy || !isJazzSupported}
              primary
            />
          </Section>

          <Section title="Медиа">
            <Toggle
              label="Камера включена при входе"
              value={isCameraOn}
              onValueChange={setCameraOn}
            />
            <Toggle
              label="Микрофон включён при входе"
              value={isMicrophoneOn}
              onValueChange={setMicrophoneOn}
            />
          </Section>

          <Section title="Конференция">
            <Field
              label="Название встречи"
              value={title}
              onChangeText={setTitle}
            />
            <Button
              title="Создать конференцию"
              disabled={busy || !ready}
              onPress={() =>
                run('createConference', () =>
                  Jazz.createConference(conferenceOptions),
                )
              }
            />
            <Button
              title="Начать конференцию"
              disabled={busy || !ready}
              onPress={() =>
                run('startConference', () =>
                  Jazz.startConference({
                    ...conferenceOptions,
                    isCameraOn,
                    isMicrophoneOn,
                  }),
                )
              }
            />
          </Section>

          <Section title="Присоединиться">
            <Field
              label="Код встречи (необязательно)"
              value={roomId}
              onChangeText={setRoomId}
              placeholder="например 123-456-789"
            />
            <Field
              label="Пароль встречи"
              value={roomPassword}
              onChangeText={setRoomPassword}
            />
            <Button
              title="Присоединиться к конференции"
              disabled={busy || !ready}
              onPress={() =>
                run('joinConference', () =>
                  Jazz.joinConference({
                    roomId: roomId.trim() || undefined,
                    roomPassword: roomPassword.trim() || undefined,
                    isCameraOn,
                    isMicrophoneOn,
                  }),
                )
              }
            />
            <Field
              label="Ссылка на встречу"
              value={linkUrl}
              onChangeText={setLinkUrl}
              placeholder="https://jazz.sber.ru/..."
            />
            <Button
              title="Разобрать ссылку"
              disabled={busy || !ready || !linkUrl.trim()}
              onPress={() =>
                run('handleUrl', () => Jazz.handleUrl(linkUrl.trim(), 'applink'))
              }
            />
            <Button
              title="Завершить активную конференцию"
              disabled={busy || !ready}
              onPress={() =>
                run('terminateActiveConference', Jazz.terminateActiveConference)
              }
            />
          </Section>

          <Section title="Лог">
            {busy ? <ActivityIndicator color="#7DD3FC" /> : null}
            {log.length === 0 ? (
              <Text style={styles.logEmpty}>Пока пусто</Text>
            ) : (
              log.map((line, i) => (
                <Text key={`${i}-${line}`} style={styles.logLine}>
                  {line}
                </Text>
              ))
            )}
          </Section>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Field({
  label,
  ...props
}: {label: string} & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        placeholderTextColor="#64748B"
        autoCapitalize="none"
        autoCorrect={false}
        {...props}
      />
    </View>
  );
}

function Toggle({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Switch value={value} onValueChange={onValueChange} />
    </View>
  );
}

function Button({
  title,
  onPress,
  disabled,
  primary,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({pressed}) => [
        styles.button,
        primary && styles.buttonPrimary,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
      ]}>
      <Text style={[styles.buttonText, disabled && styles.buttonTextDisabled]}>
        {title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#0B1220'},
  flex: {flex: 1},
  content: {padding: 20, paddingBottom: 48, gap: 16},
  h1: {color: '#F8FAFC', fontSize: 30, fontWeight: '700'},
  subtitle: {color: '#94A3B8', fontSize: 14, marginTop: -10},
  arch: {color: '#7DD3FC', fontSize: 13, fontWeight: '600', marginTop: -10},
  badge: {borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14},
  badgeIdle: {backgroundColor: '#1E293B'},
  badgeReady: {backgroundColor: '#14532D'},
  badgeText: {color: '#E2E8F0', fontSize: 13, fontWeight: '600'},
  section: {
    backgroundColor: '#111C2E',
    borderRadius: 14,
    padding: 16,
    gap: 12,
  },
  sectionTitle: {color: '#F1F5F9', fontSize: 17, fontWeight: '700'},
  field: {gap: 6},
  fieldLabel: {color: '#94A3B8', fontSize: 13, flexShrink: 1},
  input: {
    backgroundColor: '#0B1220',
    borderColor: '#1E293B',
    borderWidth: 1,
    borderRadius: 10,
    color: '#F8FAFC',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  button: {
    backgroundColor: '#1E293B',
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  buttonPrimary: {backgroundColor: '#2563EB'},
  buttonPressed: {opacity: 0.75},
  buttonDisabled: {backgroundColor: '#16202F'},
  buttonText: {color: '#F8FAFC', fontSize: 15, fontWeight: '600'},
  buttonTextDisabled: {color: '#475569'},
  logEmpty: {color: '#475569', fontSize: 13},
  logLine: {color: '#CBD5E1', fontSize: 12, fontFamily: 'Menlo'},
});

export default App;
