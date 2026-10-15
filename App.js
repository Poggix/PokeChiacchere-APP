import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import PokeLocation from './modules/poke-location';
import MapView, { Marker, Circle } from 'react-native-maps';
import * as Device from 'expo-device';
import * as ImagePicker from 'expo-image-picker';
import Constants from 'expo-constants';
import { createClient } from '@supabase/supabase-js';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Image,
  Linking,
  FlatList,
  Modal,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});


const PARTNER_LOCATION_TASK = 'pokechiacchere-partner-location';

TaskManager.defineTask(PARTNER_LOCATION_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) {
    if (error) console.warn('Task posizione socio:', error.message || error);
    return;
  }
  try {
    const raw = await AsyncStorage.getItem('pokechiacchere_session');
    let stored = raw ? JSON.parse(raw) : null;
    if (!stored?.access_token || !stored?.user?.id || stored.user.id === '01bf546e-bf28-46ac-8370-b4fe30d8a8fd') return;

    // La sessione salvata può scadere mentre l'app è in background.
    // Rinnova il token quando sta per scadere, senza dipendere dall'apertura dell'interfaccia.
    const expiresAt = Number(stored.expires_at || 0);
    if (stored.refresh_token && expiresAt && expiresAt * 1000 < Date.now() + 120000) {
      try {
        const refreshResponse = await fetch('https://omovacbvfhmtjqrrgszx.supabase.co/auth/v1/token?grant_type=refresh_token', {
          method: 'POST',
          headers: {
            apikey: 'sb_publishable_riYV0ro2BZo3umMa71mPGQ_mUPm4MA9',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ refresh_token: stored.refresh_token }),
        });
        const renewed = await refreshResponse.json();
        if (refreshResponse.ok && renewed.access_token) {
          stored = renewed;
          await AsyncStorage.setItem('pokechiacchere_session', JSON.stringify(renewed));
        } else {
          console.warn('Rinnovo sessione posizione non riuscito:', refreshResponse.status);
        }
      } catch (refreshError) {
        console.warn('Errore rinnovo sessione posizione:', refreshError?.message || refreshError);
      }
    }

    const location = data.locations[data.locations.length - 1];
    const sendLocation = (accessToken) => fetch('https://omovacbvfhmtjqrrgszx.supabase.co/rest/v1/partner_locations?on_conflict=user_id', {
      method: 'POST',
      headers: {
        apikey: 'sb_publishable_riYV0ro2BZo3umMa71mPGQ_mUPm4MA9',
        Authorization: 'Bearer ' + accessToken,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({
        user_id: stored.user.id,
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        accuracy: location.coords.accuracy,
        updated_at: new Date(location.timestamp || Date.now()).toISOString(),
      }),
    });

    let response = await sendLocation(stored.access_token);
    if (response.status === 401 && stored.refresh_token) {
      const refreshResponse = await fetch('https://omovacbvfhmtjqrrgszx.supabase.co/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        headers: {
          apikey: 'sb_publishable_riYV0ro2BZo3umMa71mPGQ_mUPm4MA9',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refresh_token: stored.refresh_token }),
      });
      const renewed = await refreshResponse.json();
      if (refreshResponse.ok && renewed.access_token) {
        stored = renewed;
        await AsyncStorage.setItem('pokechiacchere_session', JSON.stringify(renewed));
        response = await sendLocation(stored.access_token);
      }
    }
    if (!response.ok) console.warn('Invio posizione non riuscito:', response.status, await response.text().catch(() => ''));
  } catch (e) { console.warn('Task posizione socio:', e?.message || e); }
});

const PARTNER_NOTIFICATION_BACKGROUND_TASK = 'pokechiacchere-partner-notifications';

TaskManager.defineTask(PARTNER_NOTIFICATION_BACKGROUND_TASK, async () => {
  try {
    const rawSession = await AsyncStorage.getItem('pokechiacchere_session');
    const storedSession = rawSession ? JSON.parse(rawSession) : null;
    const userId = storedSession?.user?.id;
    const accessToken = storedSession?.access_token;
    if (!userId || !accessToken) return BackgroundTask.BackgroundTaskResult.Failed;

    const seenRaw = await AsyncStorage.getItem('pokechiacchere_seen_local_notifications');
    const seen = new Set(JSON.parse(seenRaw || '[]').map(String));
    const response = await fetch(
      `https://omovacbvfhmtjqrrgszx.supabase.co/rest/v1/partner_notifications?select=id,title,body,sender_id,created_at&sender_id=neq.${encodeURIComponent(userId)}&order=created_at.asc&limit=30`,
      {
        headers: {
          apikey: 'sb_publishable_riYV0ro2BZo3umMa71mPGQ_mUPm4MA9',
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );
    if (!response.ok) return BackgroundTask.BackgroundTaskResult.Failed;
    const rows = await response.json();
    for (const item of (Array.isArray(rows) ? rows : []).filter((row) => !seen.has(String(row.id)))) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: item.title || 'PokeChiacchere',
          body: item.body || 'Hai ricevuto una nuova notifica.',
          data: { partnerNotificationId: item.id },
          sound: true,
        },
        trigger: null,
      });
      seen.add(String(item.id));
    }
    await AsyncStorage.setItem(
      'pokechiacchere_seen_local_notifications',
      JSON.stringify([...seen].slice(-200))
    );
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (error) {
    console.warn('Controllo notifiche in background fallito:', error?.message || error);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

const URL = 'https://omovacbvfhmtjqrrgszx.supabase.co';
const KEY = 'sb_publishable_riYV0ro2BZo3umMa71mPGQ_mUPm4MA9';
const realtimeClient = createClient(URL, KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const NOTIFICATION_FUNCTION_URL = `${URL}/functions/v1/rapid-processor`;
const WHATSAPP_FUNCTION_URL = `${URL}/functions/v1/whatsapp-notifications`;
// Sostituisci questo valore con l'UUID del tuo utente in Supabase > Authentication > Users.
const OWNER_USER_ID = '01bf546e-bf28-46ac-8370-b4fe30d8a8fd';
const INSTALLED_APP_VERSION = String(
  Constants.nativeAppVersion || Constants.expoConfig?.version || '0.0.0'
);
const SOCI = ['Poggio', 'Fanton'];

const C = {
  bg: '#080D18',
  panel: '#111B2D',
  panel2: '#192943',
  blue: '#168BFF',
  cyan: '#55B5FF',
  red: '#FF334F',
  yellow: '#FFD43B',
  white: '#F5F8FF',
  muted: '#9BAAC2',
  green: '#4DDFAB',
  border: '#2B3D59',
};

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
    2,
    '0'
  )}-${String(d.getDate()).padStart(2, '0')}`;
};

const num = (v) => Number(String(v ?? 0).replace(',', '.')) || 0;

// Il database continua a ricevere date ISO (AAAA-MM-GG), mentre l'app le mostra in italiano.
const toItalianDate = (value) => {
  if (!value) return '';
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  const italian = String(value).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return italian ? value : String(value);
};
const toDatabaseDate = (value) => {
  if (!value) return today();
  const match = String(value)
    .trim()
    .match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;
  return String(value).trim();
};
const dateSortValue = (value) => {
  const iso = toDatabaseDate(value);
  const time = Date.parse(iso);
  return Number.isNaN(time) ? 0 : time;
};
const money = (v) =>
  new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR',
  }).format(num(v));

async function api(path, token, options = {}) {
  const response = await fetch(URL + path, {
    ...options,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${token || KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let result;
  try {
    result = text ? JSON.parse(text) : null;
  } catch {
    result = text;
  }

  if (!response.ok) {
    throw new Error(
      result?.message ||
        result?.details ||
        result?.hint ||
        String(result || 'Errore Supabase')
    );
  }
  return result;
}

function Button({ title, onPress, type = 'primary' }) {
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={onPress}
      style={[
        s.button,
        type === 'secondary' && s.buttonSecondary,
        type === 'danger' && s.buttonDanger,
        type === 'success' && s.buttonSuccess,
      ]}>
      <Text style={s.buttonText}>{title}</Text>
    </TouchableOpacity>
  );
}

function Field({ label, value, onChangeText, keyboardType, placeholder }) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        style={s.input}
        value={String(value ?? '')}
        onChangeText={onChangeText}
        keyboardType={keyboardType || 'default'}
        placeholder={placeholder || label}
        placeholderTextColor={C.muted}
        autoCapitalize="sentences"
      />
    </View>
  );
}

function DropDown({ label, value, onPress, hint }) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TouchableOpacity style={s.dropdown} onPress={onPress}>
        <Text style={[s.dropdownText, !value && { color: C.muted }]}>
          {value || hint || 'Seleziona'}
        </Text>
        <Text style={s.chevron}>⌄</Text>
      </TouchableOpacity>
    </View>
  );
}

function Card({ title, value, color = C.cyan, subtitle, valueFormat = 'money' }) {
  const displayValue =
    valueFormat === 'pieces'
      ? `${Number(value || 0).toLocaleString('it-IT', { maximumFractionDigits: 2 })} pz`
      : valueFormat === 'types'
      ? Number(value || 0).toLocaleString('it-IT', { maximumFractionDigits: 0 })
      : valueFormat === 'text'
      ? String(value || 'Nessun dato')
      : money(value);

  return (
    <View style={s.metric}>
      <View style={[s.metricLine, { backgroundColor: color }]} />
      <Text style={s.metricLabel}>{title}</Text>
      <Text style={s.metricValue}>{displayValue}</Text>
      {!!subtitle && <Text style={s.mutedSmall}>{subtitle}</Text>}
    </View>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [listSearch, setListSearch] = useState('');
  const [sortMode, setSortMode] = useState('date_desc');
  const [showSortFilters, setShowSortFilters] = useState(false);
  const [archiveSortMode, setArchiveSortMode] = useState('name_asc');
  const [archiveFiltersOpen, setArchiveFiltersOpen] = useState(false);
  const [listView, setListView] = useState('details');
  const [namePosition, setNamePosition] = useState('center');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState('home');
  const [notificationTitle, setNotificationTitle] = useState('PokeChiacchere');
  const [notificationMessage, setNotificationMessage] = useState('');
  const [notificationBusy, setNotificationBusy] = useState(false);
  const [whatsappRecipients, setWhatsappRecipients] = useState([]);
  const [whatsappRecipientName, setWhatsappRecipientName] = useState('');
  const [whatsappRecipientPhone, setWhatsappRecipientPhone] = useState('');
  const [whatsappRecipientsBusy, setWhatsappRecipientsBusy] = useState(false);
  const [whatsappRecipientSaving, setWhatsappRecipientSaving] = useState(false);
  const [form, setForm] = useState({});
  const [tiktokFeePercent, setTiktokFeePercent] = useState(0);
  const [editing, setEditing] = useState(null);
  const [picker, setPicker] = useState(null);
  const [search, setSearch] = useState('');
  const [activityLogs, setActivityLogs] = useState([]);
  const [selectedActivity, setSelectedActivity] = useState(null);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [activitySearch, setActivitySearch] = useState('');
  const [activityActionFilter, setActivityActionFilter] = useState('ALL');
  const [activityTableFilter, setActivityTableFilter] = useState('ALL');
  const [profileFirstName, setProfileFirstName] = useState('');
  const [profileLastName, setProfileLastName] = useState('');
  const [profilePhotoUrl, setProfilePhotoUrl] = useState('');
  const profileDirtyRef = useRef(false);
  const [profilePhotoUploading, setProfilePhotoUploading] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profiles, setProfiles] = useState([]);
  const [presenceLoading, setPresenceLoading] = useState(false);
  const [updateCheckBusy, setUpdateCheckBusy] = useState(false);
  const [downloadedIpa, setDownloadedIpa] = useState(null);
  const [savedAccounts, setSavedAccounts] = useState([]);
  const [accountEmail, setAccountEmail] = useState('');
  const [accountPassword, setAccountPassword] = useState('');
  const [accountBusy, setAccountBusy] = useState(false);
  const [showAccountLogin, setShowAccountLogin] = useState(false);
  const [partnerMapVisible, setPartnerMapVisible] = useState(false);
  const [partnerMapLocation, setPartnerMapLocation] = useState(null);
  const [partnerMapBusy, setPartnerMapBusy] = useState(false);
  const [partnerMapError, setPartnerMapError] = useState('');

  const [records, setRecords] = useState({
    sales: [],
    purchases: [],
    internal_payments: [],
    withdrawals: [],
    products: [],
    customers: [],
  });

  const token = session?.access_token;
  const isOwner =
    !!session?.user?.id &&
    OWNER_USER_ID !== 'INSERISCI_UUID_TUO_ACCOUNT' &&
    session.user.id === OWNER_USER_ID;
  function getFifoSaleCost(productName, requestedQuantity, excludedSaleId = null) {
    const productKey = String(productName || '').trim().toLocaleLowerCase('it');
    const quantityNeeded = Math.max(0, num(requestedQuantity));
    if (!productKey || quantityNeeded <= 0) return { totalCost: 0, unitCost: 0, available: 0 };

    const lots = [...(records.purchases || [])]
      .filter((purchase) =>
        String(purchase.product || '').trim().toLocaleLowerCase('it') === productKey
      )
      .sort((a, b) =>
        dateSortValue(a.purchase_date || a.created_at) -
        dateSortValue(b.purchase_date || b.created_at)
      )
      .map((purchase) => ({
        quantity: Math.max(0, num(purchase.quantity)),
        remaining: Math.max(0, num(purchase.quantity)),
        unitPrice: Math.max(0, num(purchase.unit_price)),
      }));

    const previousSales = [...(records.sales || [])]
      .filter((sale) =>
        String(sale.product || '').trim().toLocaleLowerCase('it') === productKey &&
        !(excludedSaleId && String(sale.id) === String(excludedSaleId))
      )
      .sort((a, b) =>
        dateSortValue(a.sale_date || a.created_at) -
        dateSortValue(b.sale_date || b.created_at)
      );

    previousSales.forEach((sale) => {
      let remainingToDeduct = Math.max(0, num(sale.quantity));
      for (const lot of lots) {
        if (remainingToDeduct <= 0) break;
        const used = Math.min(lot.remaining, remainingToDeduct);
        lot.remaining -= used;
        remainingToDeduct -= used;
      }
    });

    const available = lots.reduce((sum, lot) => sum + lot.remaining, 0);
    let toCost = Math.min(quantityNeeded, available);
    let totalCost = 0;
    for (const lot of lots) {
      if (toCost <= 0) break;
      const used = Math.min(lot.remaining, toCost);
      totalCost += used * lot.unitPrice;
      toCost -= used;
    }
    return {
      totalCost,
      unitCost: quantityNeeded > 0 ? totalCost / quantityNeeded : 0,
      available,
    };
  }

  const change = (key, value) => {
    setForm((old) => {
      const next = { ...old, [key]: value };
      if (page === 'saleForm' && ['quantity', 'unit_price'].includes(key) && !editing) {
        const saleTotal = num(key === 'quantity' ? value : next.quantity) * num(key === 'unit_price' ? value : next.unit_price);
        next.fees = String(Number((saleTotal * tiktokFeePercent / 100).toFixed(2)));
      }
      if (page === 'saleForm' && ['product', 'quantity'].includes(key)) {
        const productName = key === 'product' ? value : next.product;
        const qty = key === 'quantity' ? value : next.quantity;
        const result = getFifoSaleCost(
          productName,
          qty,
          editing?.table === 'sales' ? editing.id : null
        );
        next.purchase_unit_cost = num(qty) > 0
          ? String(Number(result.unitCost.toFixed(4)))
          : '0';
        next._available_stock = result.available;
        next._calculated_product_cost = result.totalCost;
      }
      return next;
    });
  };

  const loadData = useCallback(async () => {
    if (!token) return;
    try {
      const tables = [
        'sales',
        'purchases',
        'internal_payments',
        'withdrawals',
        'products',
        'customers',
      ];
      // Se una tabella non ha created_at, la richiesta senza ordinamento evita di bloccare tutti gli archivi.
      const values = await Promise.all(
        tables.map(async (table) => {
          try {
            return await api(
              `/rest/v1/${table}?select=*&order=created_at.desc`,
              token
            );
          } catch (firstError) {
            try {
              return await api(`/rest/v1/${table}?select=*`, token);
            } catch {
              throw firstError;
            }
          }
        })
      );
      const next = {};
      tables.forEach((table, i) => {
        next[table] = Array.isArray(values[i]) ? values[i] : [];
      });
      setRecords(next);
    } catch (e) {
      // Se il token è scaduto, prova a rinnovarlo usando il refresh_token salvato.
      if (
        /JWT|token|expired|401/i.test(e.message || '') &&
        session?.refresh_token
      ) {
        try {
          const response = await fetch(
            `${URL}/auth/v1/token?grant_type=refresh_token`,
            {
              method: 'POST',
              headers: { apikey: KEY, 'Content-Type': 'application/json' },
              body: JSON.stringify({ refresh_token: session.refresh_token }),
            }
          );
          const renewed = await response.json();
          if (response.ok && renewed.access_token) {
            setSession(renewed);
            await AsyncStorage.setItem('pokechiacchere_session', JSON.stringify(renewed));
            const rawAccounts = await AsyncStorage.getItem('pokechiacchere_accounts');
            let accounts = [];
            try { accounts = JSON.parse(rawAccounts || '[]'); } catch (_) {}
            accounts = [renewed, ...accounts.filter((item) => item?.user?.id !== renewed.user?.id)];
            setSavedAccounts(accounts);
            await AsyncStorage.setItem('pokechiacchere_accounts', JSON.stringify(accounts));
            return;
          }
        } catch (_) {}
        await AsyncStorage.removeItem('pokechiacchere_session').catch(() => {});
        setSession(null);
      }
      Alert.alert('Errore caricamento', e.message);
    }
  }, [token, session]);

  async function registerForPushNotifications() {
    if (!session?.access_token || !session?.user?.id || !Device.isDevice)
      return;
    try {
      const existing = await Notifications.getPermissionsAsync();
      let status = existing.status;
      if (status !== 'granted') {
        const requested = await Notifications.requestPermissionsAsync();
        status = requested.status;
      }
      if (status !== 'granted') {
        console.warn('Push disabilitate: permesso notifiche non concesso.', status);
        return;
      }
      const projectId = '1174ee6b-3282-4a57-8930-ce6d145be04e';
      if (!projectId) {
        console.warn(
          'Project ID Expo mancante: le notifiche push richiedono la configurazione EAS.'
        );
        return;
      }
      // Genera il token Expo reale di QUESTO dispositivo.
      const result = await Notifications.getExpoPushTokenAsync({ projectId });
      const expoPushToken = result?.data;
      if (!expoPushToken || !expoPushToken.startsWith('ExponentPushToken[')) {
        throw new Error('Expo non ha restituito un token push valido.');
      }
      await api(
        '/rest/v1/push_devices?on_conflict=user_id',
        session.access_token,
        {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify({
            user_id: session.user.id,
            expo_push_token: expoPushToken,
            updated_at: new Date().toISOString(),
          }),
        }
      );
      console.info('Registrazione push completata per questo utente.');
    } catch (e) {
      console.error('Registrazione notifiche non riuscita:', e?.message || e);
    }
  }

  async function callWhatsAppAction(action, params = {}) {
    const response = await fetch(WHATSAPP_FUNCTION_URL, {
      method: 'POST',
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action, ...params }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || payload.message || `Errore HTTP ${response.status}`);
    }
    return payload;
  }

  async function loadWhatsAppRecipients() {
    if (!isOwner || !token) return;
    setWhatsappRecipientsBusy(true);
    try {
      const payload = await callWhatsAppAction('whatsapp-list');
      setWhatsappRecipients(Array.isArray(payload.recipients) ? payload.recipients : []);
    } catch (e) {
      Alert.alert('Rubrica WhatsApp', `Impossibile caricare i destinatari: ${e.message}`);
    } finally {
      setWhatsappRecipientsBusy(false);
    }
  }

  async function addWhatsAppRecipient() {
    const name = whatsappRecipientName.trim();
    const phone = whatsappRecipientPhone.trim();
    if (!name || !phone) {
      Alert.alert('Rubrica WhatsApp', 'Inserisci nome e numero internazionale, ad esempio +393331234567.');
      return;
    }
    setWhatsappRecipientSaving(true);
    try {
      await callWhatsAppAction('whatsapp-add', { name, phone, enabled: true });
      setWhatsappRecipientName('');
      setWhatsappRecipientPhone('');
      await loadWhatsAppRecipients();
      Alert.alert('Destinatario aggiunto', 'Il numero è stato salvato in rubrica.');
    } catch (e) {
      Alert.alert('Aggiunta non riuscita', e.message);
    } finally {
      setWhatsappRecipientSaving(false);
    }
  }

  async function toggleWhatsAppRecipient(recipient) {
    try {
      await callWhatsAppAction('whatsapp-toggle', {
        id: recipient.id,
        enabled: !recipient.enabled,
      });
      await loadWhatsAppRecipients();
    } catch (e) {
      Alert.alert('Modifica non riuscita', e.message);
    }
  }

  function deleteWhatsAppRecipient(recipient) {
    Alert.alert(
      'Eliminare destinatario?',
      `Vuoi rimuovere ${recipient.name} (${recipient.phone_e164}) dalla rubrica?`,
      [
        { text: 'Annulla', style: 'cancel' },
        {
          text: 'Elimina',
          style: 'destructive',
          onPress: async () => {
            try {
              await callWhatsAppAction('whatsapp-delete', { id: recipient.id });
              await loadWhatsAppRecipients();
            } catch (e) {
              Alert.alert('Eliminazione non riuscita', e.message);
            }
          },
        },
      ]
    );
  }

  async function sendLocalPartnerNotification() {
    const title = notificationTitle.trim();
    const message = notificationMessage.trim();
    if (!isOwner) {
      Alert.alert('Accesso non autorizzato', 'Solo il proprietario può inviare notifiche al socio.');
      return;
    }
    if (!title || !message) {
      Alert.alert('Notifica locale', 'Inserisci un titolo e un messaggio.');
      return;
    }
    setNotificationBusy(true);
    try {
      await api('/rest/v1/partner_notifications', token, {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          title,
          body: message,
          sender_id: session.user.id,
          created_at: new Date().toISOString(),
        }),
      });
      Alert.alert(
        'Messaggio salvato',
        'La notifica è stata salvata su Supabase. Il dispositivo del socio potrà mostrarla localmente quando l’app riuscirà a controllare il database; non è garantito l’arrivo immediato con l’app chiusa.'
      );
      setNotificationMessage('');
    } catch (e) {
      Alert.alert('Invio notifica non riuscito', `${e.message}\nVerifica di aver eseguito il file SQL partner_notifications.sql su Supabase.`);
    } finally {
      setNotificationBusy(false);
    }
  }

  async function checkLocalPartnerNotifications() {
    if (!token || !session?.user?.id) return;
    try {
      const rows = await api(
        `/rest/v1/partner_notifications?select=id,title,body,sender_id,created_at&sender_id=neq.${encodeURIComponent(session.user.id)}&order=created_at.asc&limit=30`,
        token
      );
      const seenRaw = await AsyncStorage.getItem('pokechiacchere_seen_local_notifications');
      const seen = new Set(JSON.parse(seenRaw || '[]').map(String));
      const fresh = (Array.isArray(rows) ? rows : []).filter((item) => !seen.has(String(item.id)));
      for (const item of fresh) {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: item.title || 'PokeChiacchere',
            body: item.body || 'Hai ricevuto una nuova notifica.',
            data: { partnerNotificationId: item.id },
            sound: true,
          },
          trigger: null,
        });
        seen.add(String(item.id));
      }
      if (fresh.length) {
        await AsyncStorage.setItem(
          'pokechiacchere_seen_local_notifications',
          JSON.stringify([...seen].slice(-200))
        );
      }
    } catch (e) {
      // Il polling è best-effort: le policy RLS o la tabella potrebbero non essere ancora configurate.
      console.warn('Controllo notifiche locali non riuscito:', e?.message || e);
    }
  }

  async function sendPartnerNotification() {
    const title = notificationTitle.trim();
    const message = notificationMessage.trim();
    if (!isOwner) {
      Alert.alert('Accesso non autorizzato', 'Solo il proprietario configurato può inviare messaggi WhatsApp.');
      return;
    }
    if (!title || !message) {
      Alert.alert('WhatsApp', 'Inserisci un titolo e un messaggio.');
      return;
    }
    const activeCount = whatsappRecipients.filter((item) => item.enabled).length;
    if (!activeCount) {
      Alert.alert('WhatsApp', 'Aggiungi e attiva almeno un destinatario nella rubrica.');
      return;
    }
    setNotificationBusy(true);
    try {
      const payload = await callWhatsAppAction('whatsapp-send', { title, body: message });
      const results = Array.isArray(payload.results) ? payload.results : [];
      const failures = results.filter((item) => !item.ok);
      const successes = results.filter((item) => item.ok).length;
      const details = failures.slice(0, 4).map((item) => `${item.name || item.phone || 'Destinatario'}: ${item.error || 'invio non riuscito'}`);
      Alert.alert(
        failures.length ? 'Invio WhatsApp parziale' : 'Richieste WhatsApp inviate',
        `Accettati da Meta: ${successes} su ${Number(payload.total || results.length)}.` +
          (details.length ? `\n\nErrori:\n${details.join('\n')}` : '') +
          '\n\nL’accettazione da parte di Meta non garantisce la consegna finale al telefono.'
      );
      if (successes > 0) setNotificationMessage('');
    } catch (e) {
      Alert.alert('Invio WhatsApp non riuscito', `${e.message}\nControlla la Edge Function whatsapp-notifications, il template e i Secrets Meta.`);
    } finally {
      setNotificationBusy(false);
    }
  }

  async function sendAutomaticPartnerNotification(table, data) {
    if (!isOwner || !['sales', 'withdrawals'].includes(table)) return;
    const title =
      table === 'sales'
        ? 'Nuova vendita registrata'
        : 'Nuovo prelievo registrato';
    const detail =
      table === 'sales'
        ? `${data.product || 'Vendita'} · ${money(
            data.total_sale ??
              num(data.quantity) * num(data.unit_price ?? data.sale_unit_price)
          )}`
        : `Prelievo di ${money(data.amount)}${
            data.partner ? ` · ${data.partner}` : ''
          }`;
    try {
      const response = await fetch(NOTIFICATION_FUNCTION_URL, {
        method: 'POST',
        headers: {
          apikey: KEY,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title, body: detail, recipient: 'all' }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        console.warn(
          'Notifica automatica non inviata:',
          payload.error || payload.message || response.status
        );
      }
    } catch (e) {
      console.warn('Notifica automatica non inviata:', e?.message || e);
    }
  }

  useEffect(() => {
    if (token && page === 'notifications' && isOwner) loadWhatsAppRecipients();
  }, [page, token, isOwner]);

  // Controlla all'accesso/al ritorno in primo piano e usa Supabase Realtime
  // per reagire subito a una nuova notifica, senza polling periodico.
  useEffect(() => {
    if (!token || !session?.user?.id) return;
    let cancelled = false;
    let channel = null;

    checkLocalPartnerNotifications();

    const connectRealtime = async () => {
      try {
        await realtimeClient.realtime.setAuth(token);
        if (cancelled) return;
        channel = realtimeClient
          .channel(`partner-notifications-${session.user.id}`)
          .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'partner_notifications' },
            (payload) => {
              const notification = payload?.new;
              if (!notification || notification.sender_id === session.user.id) return;
              // Mostra la notifica locale e aggiorna subito i dati condivisi dell'app.
              checkLocalPartnerNotifications();
              loadData();
              loadProfilesAndPresence();
            }
          )
          .subscribe((status) => {
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              console.warn('Connessione Supabase Realtime non riuscita:', status);
            }
          });
      } catch (e) {
        console.warn('Avvio Supabase Realtime non riuscito:', e?.message || e);
      }
    };
    connectRealtime();

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        checkLocalPartnerNotifications();
        loadData();
        loadProfilesAndPresence();
      }
    });
    return () => {
      cancelled = true;
      subscription.remove();
      if (channel) realtimeClient.removeChannel(channel);
    };
  }, [token, session?.user?.id, loadData, loadProfilesAndPresence]);

  useEffect(() => {
    const received = Notifications.addNotificationReceivedListener((notification) => {
      console.info('Notifica push ricevuta in primo piano.', {
        hasTitle: !!notification.request.content.title,
        hasBody: !!notification.request.content.body,
      });
    });
    const response = Notifications.addNotificationResponseReceivedListener(() => {
      console.info('Interazione con notifica push registrata.');
    });
    return () => {
      received.remove();
      response.remove();
    };
  }, []);

  useEffect(() => {
    if (!token || !session?.user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const status = await BackgroundTask.getStatusAsync();
        if (status !== BackgroundTask.BackgroundTaskStatus.Available) {
          console.warn('Attività in background non disponibile su questo dispositivo.');
          return;
        }
        const registered = await TaskManager.isTaskRegisteredAsync(PARTNER_NOTIFICATION_BACKGROUND_TASK);
        if (!registered) {
          await BackgroundTask.registerTaskAsync(PARTNER_NOTIFICATION_BACKGROUND_TASK, {
            minimumInterval: 15,
          });
        }
      } catch (error) {
        if (!cancelled) console.warn('Registrazione attività in background non riuscita:', error?.message || error);
      }
    })();
    return () => { cancelled = true; };
  }, [token, session?.user?.id]);

  useEffect(() => {
    if (token && session?.user?.id) registerForPushNotifications();
  }, [token, session?.user?.id]);

  // La condivisione parte automaticamente solo con l'account del socio.
  // Se si passa all'account owner sullo stesso telefono, arresta il task per evitare
  // che l'owner venga inviato come posizione del socio.
  useEffect(() => {
    if (!token || !session?.user?.id) return;
    if (isOwner) {
      (async () => {
        try {
          if (await TaskManager.isTaskRegisteredAsync(PARTNER_LOCATION_TASK)) {
            await Location.stopLocationUpdatesAsync(PARTNER_LOCATION_TASK);
          }
        } catch (e) {
          console.warn('Arresto condivisione posizione:', e?.message || e);
        }
      })();
      return;
    }

    // Avvia al login e ricontrolla quando l'app torna in primo piano.
    enablePartnerLocationSharing();
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') enablePartnerLocationSharing();
    });
    return () => appStateSubscription.remove();
  }, [token, session?.user?.id, isOwner]);

  const loadProfilesAndPresence = useCallback(async () => {
    if (!token || !session?.user?.id) return;
    setPresenceLoading(true);
    try {
      const profileRows = await api('/rest/v1/member_profiles?select=*&order=updated_at.desc', token);
      setProfiles(Array.isArray(profileRows) ? profileRows : []);
      const first = (Array.isArray(profileRows) ? profileRows : []).find((p) => p.user_id === session.user.id);
      // Il polling della presenza non deve sovrascrivere i campi che l'utente sta modificando.
      if (!profileDirtyRef.current) {
        setProfileFirstName(first?.first_name || session.user.user_metadata?.first_name || '');
        setProfileLastName(first?.last_name || session.user.user_metadata?.last_name || '');
        setProfilePhotoUrl(first?.avatar_url || session.user.user_metadata?.avatar_url || '');
      }
      await api('/rest/v1/member_presence?on_conflict=user_id', token, {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({
          user_id: session.user.id,
          email: session.user.email || '',
          last_seen_at: new Date().toISOString(),
          is_active: true,
          app_version: INSTALLED_APP_VERSION,
        }),
      });
      const presenceRows = await api('/rest/v1/member_presence?select=*&order=last_seen_at.desc', token);
      const profileList = Array.isArray(profileRows) ? profileRows : [];
      const presenceList = Array.isArray(presenceRows) ? presenceRows : [];
      const mergedProfiles = new Map(profileList.map((p) => [p.user_id, p]));
      presenceList.forEach((presence) => {
        if (!mergedProfiles.has(presence.user_id)) {
          mergedProfiles.set(presence.user_id, {
            user_id: presence.user_id,
            email: presence.email || '',
            first_name: '',
            last_name: '',
            avatar_url: null,
          });
        }
      });
      setProfiles([...mergedProfiles.values()].map((p) => ({
        ...p,
        presence: presenceList.find((x) => x.user_id === p.user_id) || null,
      })));
    } catch (e) {
      console.warn('Profilo/presenza non disponibili. Verifica lo script SQL Supabase:', e?.message || e);
    } finally {
      setPresenceLoading(false);
    }
  }, [token, session?.user?.id]);

  useEffect(() => {
    if (!token || !session?.user?.id) return;
    loadProfilesAndPresence();
    const heartbeat = setInterval(() => {
      if (AppState.currentState === 'active') {
        api('/rest/v1/member_presence?on_conflict=user_id', token, {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify({
            user_id: session.user.id,
            email: session.user.email || '',
            last_seen_at: new Date().toISOString(),
            is_active: true,
            app_version: INSTALLED_APP_VERSION,
          }),
        }).catch(() => {});
      }
    }, 15000);
    const subscription = AppState.addEventListener('change', (state) => {
      api('/rest/v1/member_presence?on_conflict=user_id', token, {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({
          user_id: session.user.id,
          email: session.user.email || '',
          last_seen_at: new Date().toISOString(),
          is_active: state === 'active',
          app_version: INSTALLED_APP_VERSION,
        }),
      }).catch(() => {});
      if (state === 'active') loadProfilesAndPresence();
    });
    return () => {
      clearInterval(heartbeat);
      subscription.remove();
    };
  }, [token, session?.user?.id, loadProfilesAndPresence]);

  // Nella schermata Impostazioni aggiorna frequentemente lo stato degli altri soci.
  useEffect(() => {
    if (!token || !session?.user?.id || page !== 'settings') return;
    loadProfilesAndPresence();
    const presenceRefresh = setInterval(() => {
      if (AppState.currentState === 'active') loadProfilesAndPresence();
    }, 5000);
    return () => clearInterval(presenceRefresh);
  }, [page, token, session?.user?.id, loadProfilesAndPresence]);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem('pokechiacchere_tiktok_fee_percent').then((raw) => {
      const value = Number(raw);
      if (active && raw !== null && Number.isFinite(value) && value >= 0 && value <= 100) setTiktokFeePercent(value);
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  async function configureTiktokFeePercent() {
    Alert.prompt(
      'Commissioni TikTok',
      'Inserisci la percentuale fissa da applicare al prezzo attuale della vendita.',
      [
        { text: 'Annulla', style: 'cancel' },
        { text: 'Salva', onPress: async (raw) => {
          const normalized = String(raw ?? '').trim().replace(',', '.');
          const value = Number(normalized);
          if (!normalized || !Number.isFinite(value) || value < 0 || value > 100) {
            Alert.alert('Percentuale non valida', 'Inserisci un valore tra 0 e 100.');
            return;
          }
          setTiktokFeePercent(value);
          try { await AsyncStorage.setItem('pokechiacchere_tiktok_fee_percent', String(value)); }
          catch (_) { Alert.alert('Errore', 'Non è stato possibile salvare la percentuale su questo dispositivo.'); }
        } },
      ],
      'plain-text',
      String(tiktokFeePercent),
      'decimal-pad'
    );
  }

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [rawSession, rawAccounts] = await Promise.all([
          AsyncStorage.getItem('pokechiacchere_session'),
          AsyncStorage.getItem('pokechiacchere_accounts'),
        ]);
        let accounts = [];
        try { accounts = JSON.parse(rawAccounts || '[]'); } catch (_) {}
        let current = null;
        try { current = rawSession ? JSON.parse(rawSession) : null; } catch (_) {}
        if (current?.user?.id && current?.access_token && !accounts.some((item) => item?.user?.id === current.user.id)) accounts = [current, ...accounts];
        accounts = accounts.filter((item) => item?.user?.id && item?.access_token);
        if (active) {
          setSavedAccounts(accounts);
          if (current) setSession(current);
        }
        await AsyncStorage.setItem('pokechiacchere_accounts', JSON.stringify(accounts));
      } catch (_) {}
      finally { if (active) setSessionReady(true); }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (token) loadData();
  }, [token, loadData]);

  // Ricarica i dati ogni volta che si cambia sezione.
  useEffect(() => {
    if (token && session?.user?.id) loadData();
  }, [page, token, session?.user?.id, loadData]);

  // Sincronizzazione quasi in tempo reale tra i dispositivi dei soci.
  // Il polling viene sospeso quando l'app non è in primo piano.
  useEffect(() => {
    if (!token || !session?.user?.id) return;
    let busy = false;
    const syncIfActive = async () => {
      if (AppState.currentState !== 'active' || busy) return;
      busy = true;
      try {
        await loadData();
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(syncIfActive, 5000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') syncIfActive();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [token, session?.user?.id, loadData]);

  async function signOut() {
    await AsyncStorage.removeItem('pokechiacchere_session').catch(() => {});
    setSession(null);
    setPassword('');
    setPage('home');
    setForm({});
    setEditing(null);
    setPicker(null);
    setRecords({
      sales: [],
      purchases: [],
      internal_payments: [],
      withdrawals: [],
      products: [],
      customers: [],
    });
    setActivityLogs([]);
    setSelectedActivity(null);
    setActivitySearch('');
    setActivityActionFilter('ALL');
    setActivityTableFilter('ALL');
  }

  async function signIn() {
    if (!email.trim() || !password) {
      Alert.alert('Accesso', 'Inserisci email e password.');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: {
          apikey: KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: email.trim(),
          password,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(
          data.error_description || data.message || 'Accesso non riuscito'
        );
      }
      setSession(data);
      setShowAccountLogin(false);
      await AsyncStorage.setItem('pokechiacchere_session', JSON.stringify(data));
      const rawAccounts = await AsyncStorage.getItem('pokechiacchere_accounts');
      let accounts = [];
      try { accounts = JSON.parse(rawAccounts || '[]'); } catch (_) {}
      accounts = [data, ...accounts.filter((item) => item?.user?.id !== data.user?.id)];
      setSavedAccounts(accounts);
      await AsyncStorage.setItem('pokechiacchere_accounts', JSON.stringify(accounts));
    } catch (e) {
      Alert.alert('Errore di accesso', e.message);
    } finally {
      setLoading(false);
    }
  }

  async function switchSavedAccount(account) {
    if (!account?.access_token || !account?.user?.id) return;
    setSession(account);
    await AsyncStorage.setItem('pokechiacchere_session', JSON.stringify(account));
    setPage('home');
    setForm({});
    setEditing(null);
    setPicker(null);
    setRecords({ sales: [], purchases: [], internal_payments: [], withdrawals: [], products: [], customers: [] });
    setActivityLogs([]);
    setSelectedActivity(null);
    setActivitySearch('');
    setActivityActionFilter('ALL');
    setActivityTableFilter('ALL');
    Alert.alert('Account cambiato', 'Ora stai usando ' + (account.user.email || 'l’account selezionato') + '.');
  }

  async function addAnotherAccount() {
    if (!accountEmail.trim() || !accountPassword) {
      Alert.alert('Aggiungi account', 'Inserisci email e password del secondo account.');
      return;
    }
    setAccountBusy(true);
    try {
      const response = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: accountEmail.trim(), password: accountPassword }),
      });
      const data = await response.json();
      if (!response.ok || !data?.access_token || !data?.user?.id) {
        throw new Error(data.error_description || data.message || 'Accesso non riuscito');
      }
      const accounts = [data, ...savedAccounts.filter((item) => item?.user?.id !== data.user.id)];
      setSavedAccounts(accounts);
      await AsyncStorage.setItem('pokechiacchere_accounts', JSON.stringify(accounts));
      setAccountEmail('');
      setAccountPassword('');
      await switchSavedAccount(data);
    } catch (e) {
      Alert.alert('Account non aggiunto', e.message || 'Verifica email e password.');
    } finally {
      setAccountBusy(false);
    }
  }

  async function removeSavedAccount(account) {
    const accounts = savedAccounts.filter((item) => item?.user?.id !== account?.user?.id);
    setSavedAccounts(accounts);
    await AsyncStorage.setItem('pokechiacchere_accounts', JSON.stringify(accounts));
    if (session?.user?.id === account?.user?.id) {
      const next = accounts[0] || null;
      if (next) await switchSavedAccount(next);
      else await signOut();
    }
  }

  function openForm(target, initial = {}) {
    setEditing(null);
    setForm({
      date: toItalianDate(today()),
      quantity: '1',
      unit_price: '0',
      amount: '',
      fees: '0',
      other_costs: '0',
      shipping_cost: '0',
      purchase_unit_cost: '0',
      ...initial,
    });
    setPage(target);
  }

  function editRow(table, row) {
    setEditing({ table, id: row.id });

    setForm({
      ...row,
      date: toItalianDate(
        row.sale_date ||
          row.purchase_date ||
          row.payment_date ||
          row.withdrawal_date ||
          today()
      ),
      quantity: String(row.quantity ?? '1'),
      unit_price: String(row.unit_price ?? row.sale_unit_price ?? '0'),
      amount: String(row.amount ?? '0'),
      fees: String(row.tiktok_fees ?? '0'),
      other_costs: String(row.other_costs ?? '0'),
      shipping_cost: String(row.shipping_cost ?? '0'),
      purchase_unit_cost: String(row.purchase_unit_cost ?? '0'),
      first_name: row.customer_first_name || '',
      last_name: row.customer_last_name || '',
      name: row.name || '',
    });

    const targets = {
      sales: 'saleForm',
      purchases: 'purchaseForm',
      internal_payments: 'paymentForm',
      withdrawals: 'withdrawalForm',
      products: 'products',
      customers: 'customers',
    };
    setPage(targets[table] || 'home');
  }

  async function saveRecord(table, data) {
    setLoading(true);

    try {
      if (editing?.table === table && editing?.id) {
        await api(
          `/rest/v1/${table}?id=eq.${encodeURIComponent(editing.id)}`,
          token,
          {
            method: 'PATCH',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify(data),
          }
        );
      } else {
        await api(`/rest/v1/${table}`, token, {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({
            ...data,
            created_by: session?.user?.id,
          }),
        });
        // Notifica soltanto le nuove vendite e i nuovi prelievi, mai le modifiche.
        if (['sales', 'withdrawals'].includes(table)) {
          sendAutomaticPartnerNotification(table, data);
        }
      }

      setEditing(null);
      setForm({});
      await loadData();

      const targets = {
        sales: 'sales',
        purchases: 'purchases',
        internal_payments: 'payments',
        withdrawals: 'withdrawals',
      };
      setPage(targets[table] || 'home');
      Alert.alert('Salvato', 'Registrazione salvata.');
    } catch (e) {
      Alert.alert('Salvataggio non riuscito', e.message);
    } finally {
      setLoading(false);
    }
  }

  async function uploadProductPhoto(uri, mimeType = 'image/jpeg') {
    if (!token) throw new Error('Sessione non valida.');
    const localResponse = await fetch(uri);
    const blob = await localResponse.blob();
    const extension = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
    const objectPath = `products/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
    const uploadResponse = await fetch(`${URL}/storage/v1/object/product-photos/${objectPath}`, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: `Bearer ${token}`, 'Content-Type': mimeType, 'x-upsert': 'true' },
      body: blob,
    });
    if (!uploadResponse.ok) throw new Error(await uploadResponse.text() || 'Caricamento foto non riuscito');
    return `${URL}/storage/v1/object/public/product-photos/${objectPath}`;
  }

  async function chooseProductPhoto() {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.82,
      });
      if (result.canceled || !result.assets?.[0]?.uri) return;
      const asset = result.assets[0];
      setLoading(true);
      const url = await uploadProductPhoto(asset.uri, asset.mimeType || 'image/jpeg');
      setForm((old) => ({ ...old, photo_url: url, photo_preview: asset.uri }));
      Alert.alert('Foto caricata', 'La foto verrà salvata nell’archivio quando premi “Aggiungi prodotto”.');
    } catch (e) {
      Alert.alert('Errore foto prodotto', 'Verifica che lo storage product-photos sia configurato in Supabase. ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  async function addCatalog(table, value) {
    const name = String(value || '').trim();
    if (!name) return;

    const existing = records[table].some(
      (row) => String(row.name || '').toLowerCase() === name.toLowerCase()
    );
    if (existing) return;

    const payload = { name };
    await api(`/rest/v1/${table}`, token, {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(payload),
    });
    await loadData();
  }

  async function saveSale() {
    const first = String(form.first_name || '').trim();
    const last = String(form.last_name || '').trim();
    const customer = [first, last].filter(Boolean).join(' ');
    const extraItems = Array.isArray(form.order_items) ? form.order_items : [];
    const items = [
      { product: String(form.product || '').trim(), quantity: num(form.quantity), price: num(form.unit_price) },
      ...extraItems.map((item) => ({
        product: String(item.product || '').trim(),
        quantity: num(item.quantity),
        price: num(item.unit_price),
      })),
    ].filter((item) => item.product || item.quantity || item.price);

    if (!items.length || items.some((item) => !item.product || item.quantity <= 0 || item.price < 0)) {
      Alert.alert('Dati mancanti', 'Per ogni prodotto inserisci prodotto, quantità e prezzo unitario.');
      return;
    }

    const prepared = items.map((item) => {
      const fifo = getFifoSaleCost(item.product, item.quantity, editing?.table === 'sales' ? editing.id : null);
      return { ...item, total: item.quantity * item.price, fifo };
    });

    const insufficient = prepared.find((item) => item.quantity > item.fifo.available + 0.000001);
    if (insufficient) {
      Alert.alert(
        'Giacenza insufficiente',
        `Hai ${insufficient.fifo.available.toLocaleString('it-IT')} pezzi disponibili di "${insufficient.product}", ma stai registrando una vendita di ${insufficient.quantity.toLocaleString('it-IT')}.`
      );
      return;
    }

    // I costi inseriti nella testata sono costi complessivi dell'ordine:
    // vengono ripartiti tra le righe in proporzione al valore di ciascun prodotto.
    const orderTotal = prepared.reduce((sum, item) => sum + item.total, 0);
    const feesTotal = num(form.fees);
    const shippingTotal = num(form.shipping_cost);
    const otherCostsTotal = num(form.other_costs);
    const allocated = (amount, item) => orderTotal > 0 ? amount * item.total / orderTotal : amount / prepared.length;

    setLoading(true);
    try {
      for (const item of prepared) await addCatalog('products', item.product);
      if (customer) await addCatalog('customers', customer);

      const common = {
        sale_date: toDatabaseDate(form.date),
        order_number: form.order_number || '',
        customer_name: customer,
        customer_first_name: first || null,
        customer_last_name: last || null,
      };

      if (editing?.table === 'sales' && editing?.id) {
        const item = prepared[0];
        const fees = feesTotal;
        const shipping = shippingTotal;
        const other = otherCostsTotal;
        await saveRecord('sales', {
          ...common,
          product: item.product,
          quantity: item.quantity,
          sale_unit_price: item.price,
          unit_price: item.price,
          total_sale: item.total,
          tiktok_fees: fees,
          shipping_cost: shipping,
          other_costs: other,
          purchase_unit_cost: item.quantity > 0 ? item.fifo.totalCost / item.quantity : 0,
          product_cost: item.fifo.totalCost,
          net_profit: item.total - fees - shipping - other - item.fifo.totalCost,
          flat_tax: item.total * 0.02,
        });
        return;
      }

      const rows = prepared.map((item) => {
        const fees = allocated(feesTotal, item);
        const shipping = allocated(shippingTotal, item);
        const other = allocated(otherCostsTotal, item);
        return {
          ...common,
          product: item.product,
          quantity: item.quantity,
          sale_unit_price: item.price,
          unit_price: item.price,
          total_sale: item.total,
          tiktok_fees: fees,
          shipping_cost: shipping,
          other_costs: other,
          purchase_unit_cost: item.quantity > 0 ? item.fifo.totalCost / item.quantity : 0,
          product_cost: item.fifo.totalCost,
          net_profit: item.total - fees - shipping - other - item.fifo.totalCost,
          flat_tax: item.total * 0.02,
          created_by: session?.user?.id,
        };
      });

      await api('/rest/v1/sales', token, {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(rows),
      });
      rows.forEach((row) => sendAutomaticPartnerNotification('sales', row));
      setEditing(null);
      setForm({});
      await loadData();
      setPage('sales');
      Alert.alert('Salvato', prepared.length > 1
        ? `Ordine salvato con ${prepared.length} prodotti.`
        : 'Registrazione salvata.');
    } catch (e) {
      Alert.alert('Errore vendita', e.message);
    } finally {
      setLoading(false);
    }
  }

  async function savePurchase() {
    const product = String(form.product || '').trim();
    const buyer = String(form.buyer || '').trim();
    const quantity = num(form.quantity);
    const price = num(form.unit_price);

    if (!product || !buyer || quantity <= 0 || price < 0) {
      Alert.alert('Dati mancanti', 'Inserisci socio, prodotto e quantità.');
      return;
    }

    try {
      await addCatalog('products', product);
      await saveRecord('purchases', {
        purchase_date: toDatabaseDate(form.date),
        buyer,
        product,
        quantity,
        unit_price: price,
      });
    } catch (e) {
      Alert.alert('Errore acquisto', e.message);
      setLoading(false);
    }
  }

  async function deleteRow(table, row) {
    Alert.alert(
      'Eliminare la registrazione?',
      'L’operazione non si può annullare.',
      [
        { text: 'Annulla', style: 'cancel' },
        {
          text: 'Elimina',
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              await api(
                `/rest/v1/${table}?id=eq.${encodeURIComponent(row.id)}`,
                token,
                { method: 'DELETE' }
              );
              await loadData();
            } catch (e) {
              Alert.alert('Errore eliminazione', e.message);
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  }

  const totals = useMemo(() => {
    const sales = records.sales.reduce(
      (sum, r) =>
        sum +
        num(
          r.total_sale ||
            num(r.quantity) * num(r.unit_price || r.sale_unit_price)
        ),
      0
    );

    const fees = records.sales.reduce((sum, r) => sum + num(r.tiktok_fees), 0);
    const other = records.sales.reduce((sum, r) => sum + num(r.other_costs), 0);
    const shipping = records.sales.reduce(
      (sum, r) => sum + num(r.shipping_cost),
      0
    );
    const cost = records.sales.reduce(
      (sum, r) =>
        sum +
        num(r.product_cost ?? num(r.quantity) * num(r.purchase_unit_cost)),
      0
    );
    const tax = records.sales.reduce((sum, r) => sum + num(r.flat_tax), 0);
    const profitBeforeTax = sales - fees - other - shipping - cost;
    const profit = profitBeforeTax - tax;

    const purchases = records.purchases.reduce(
      (sum, r) => sum + num(r.quantity) * num(r.unit_price),
      0
    );

    const purchaseBy = (person) =>
      records.purchases
        .filter((r) => r.buyer === person)
        .reduce((sum, r) => sum + num(r.quantity) * num(r.unit_price), 0);

    const withdrawals = (person) =>
      records.withdrawals
        .filter((r) => r.person === person)
        .reduce((sum, r) => sum + num(r.amount), 0);

    const paymentsMade = (person) =>
      records.internal_payments
        .filter((r) => r.payer === person)
        .reduce((sum, r) => sum + num(r.amount), 0);

    const paymentsReceived = (person) =>
      records.internal_payments
        .filter((r) => r.receiver === person)
        .reduce((sum, r) => sum + num(r.amount), 0);

    const halfProfit = profit / 2;

    // Stima del saldo tra soci: acquisti anticipati + quota utile
    // meno prelievi e pagamenti ricevuti, più pagamenti effettuati.
    const balance = (person) =>
      purchaseBy(person) +
      halfProfit -
      withdrawals(person) -
      paymentsReceived(person) +
      paymentsMade(person);

    const poggioBalance = balance('Poggio');
    const fantonBalance = balance('Fanton');

    return {
      sales,
      fees,
      other,
      shipping,
      cost,
      tax,
      profitBeforeTax,
      profit,
      purchases,
      poggioPurchases: purchaseBy('Poggio'),
      fantonPurchases: purchaseBy('Fanton'),
      poggioWithdrawals: withdrawals('Poggio'),
      fantonWithdrawals: withdrawals('Fanton'),
      poggioBalance,
      fantonBalance,
      poggioPosition: halfProfit - withdrawals('Poggio'),
      fantonPosition: halfProfit - withdrawals('Fanton'),
      paymentsMadeP: paymentsMade('Poggio'),
      paymentsMadeF: paymentsMade('Fanton'),
      paymentsReceivedP: paymentsReceived('Poggio'),
      paymentsReceivedF: paymentsReceived('Fanton'),
      cashEstimate:
        sales -
        fees -
        other -
        shipping -
        purchases -
        records.withdrawals.reduce((sum, r) => sum + num(r.amount), 0),
    };
  }, [records]);

  function openPicker(type, key) {
    setSearch('');
    setPicker({ type, key });
  }

  function optionsForPicker() {
    if (!picker) return [];
    if (picker.type === 'product') return records.products.map((r) => r.name);
    if (picker.type === 'customer') return records.customers.map((r) => r.name);
    if (picker.type === 'partner') return SOCI;
    if (picker.type === 'receiver') return SOCI;
    return [];
  }

  function chooseOption(value) {
    if (!picker) return;

    if (picker.type === 'customer') {
      const parts = value.split(' ');
      change('first_name', parts.shift() || '');
      change('last_name', parts.join(' '));
    } else if (picker.key && picker.key.startsWith('order_items.')) {
      const match = picker.key.match(/^order_items\.(\d+)\.product$/);
      if (match) {
        const index = Number(match[1]);
        setForm((old) => ({
          ...old,
          order_items: (old.order_items || []).map((line, i) => i === index ? { ...line, product: value } : line),
        }));
      }
    } else {
      change(picker.key, value);
    }

    setPicker(null);
    setSearch('');
  }

  function dropdown(label, type, key, value, hint) {
    return (
      <DropDown
        label={label}
        value={value}
        hint={hint}
        onPress={() => openPicker(type, key)}
      />
    );
  }

  function pickerModal() {
    const options = optionsForPicker().filter((value) =>
      value.toLowerCase().includes(search.toLowerCase())
    );
    const isCatalog = picker?.type === 'product' || picker?.type === 'customer';

    return (
      <Modal
        visible={!!picker}
        transparent
        animationType="slide"
        onRequestClose={() => setPicker(null)}>
        <View style={s.modalBackdrop}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>
              {picker?.type === 'product'
                ? 'Seleziona prodotto'
                : picker?.type === 'customer'
                ? 'Seleziona cliente'
                : 'Seleziona socio'}
            </Text>

            <TextInput
              style={s.input}
              value={search}
              onChangeText={setSearch}
              placeholder="Cerca o scrivi un nuovo nome"
              placeholderTextColor={C.muted}
              autoFocus={false}
            />

            <FlatList
              data={options}
              keyExtractor={(item, index) => `${item}-${index}`}
              keyboardShouldPersistTaps="handled"
              style={{ maxHeight: 280 }}
              ListEmptyComponent={
                <Text style={s.empty}>Nessun risultato.</Text>
              }
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={s.optionRow}
                  onPress={() => chooseOption(item)}>
                  <Text style={s.optionText}>{item}</Text>
                  <Text style={{ color: C.cyan }}>Seleziona ›</Text>
                </TouchableOpacity>
              )}
            />

            {isCatalog &&
              search.trim() &&
              !options.some(
                (x) => x.toLowerCase() === search.trim().toLowerCase()
              ) && (
                <Button
                  title={`Usa: ${search.trim()}`}
                  onPress={() => chooseOption(search.trim())}
                  type="success"
                />
              )}

            <Button
              title="Chiudi"
              type="secondary"
              onPress={() => setPicker(null)}
            />
          </View>
        </View>
      </Modal>
    );
  }

  function header(title, subtitle) {
    const t = String(title || '').toLowerCase();
    const identity = t.includes('vendit')
      ? { icon: '↗', color: C.green, label: 'VENDITE' }
      : t.includes('acquist')
      ? { icon: '▤', color: C.yellow, label: 'ACQUISTI' }
      : t.includes('magazzin')
      ? { icon: '●', color: C.green, label: 'MAGAZZINO' }
      : t.includes('client') || t.includes('archivio')
      ? { icon: '♙', color: '#C39BFF', label: 'ANAGRAFICHE' }
      : t.includes('preliev') || t.includes('soci') || t.includes('pagament')
      ? { icon: '⇄', color: C.yellow, label: 'MOVIMENTI' }
      : t.includes('impost') || t.includes('attivit')
      ? { icon: '⚙', color: C.cyan, label: 'SISTEMA' }
      : t.includes('spes') || t.includes('utile')
      ? { icon: '€', color: C.red, label: 'FINANZA' }
      : { icon: '⌂', color: C.cyan, label: 'DASHBOARD' };
    return (
      <View style={[s.pageHeader, { borderLeftColor: identity.color }]}>
        <View style={s.headerIdentity}>
          <View
            style={[
              s.headerIconBox,
              {
                borderColor: identity.color,
                backgroundColor: `${identity.color}18`,
              },
            ]}>
            <Text style={[s.headerIconText, { color: identity.color }]}>
              {identity.icon}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.eyebrow, { color: identity.color }]}>
              {identity.label} / POKECHIACCHERE
            </Text>
            <Text style={s.pageTitle}>{title}</Text>
          </View>
        </View>
        {!!subtitle && <Text style={s.subtitle}>{subtitle}</Text>}
      </View>
    );
  }

  function section(title) {
    return <Text style={s.sectionTitle}>{title}</Text>;
  }

  function renderInventory() {
    // Calcolo FIFO: ogni acquisto resta un lotto separato, anche se il prodotto
    // è stato comprato a prezzi unitari diversi. Le vendite scaricano prima i lotti più vecchi.
    const purchases = [...(records.purchases || [])].sort(
      (a, b) =>
        dateSortValue(a.purchase_date || a.created_at) -
        dateSortValue(b.purchase_date || b.created_at)
    );
    const sales = [...(records.sales || [])].sort(
      (a, b) =>
        dateSortValue(a.sale_date || a.created_at) -
        dateSortValue(b.sale_date || b.created_at)
    );
    const groups = new Map();

    purchases.forEach((purchase) => {
      const product = String(purchase.product || '').trim();
      const key = product.toLocaleLowerCase('it');
      const quantity = Math.max(0, num(purchase.quantity));
      if (!product || quantity <= 0) return;
      if (!groups.has(key)) groups.set(key, { product, lots: [] });
      groups.get(key).lots.push({
        id: purchase.id || `${key}-${purchase.purchase_date || purchase.created_at || ''}-${purchase.unit_price}`,
        date: purchase.purchase_date || purchase.created_at,
        buyer: purchase.buyer || '',
        unitPrice: num(purchase.unit_price),
        purchased: quantity,
        remaining: quantity,
      });
    });

    sales.forEach((sale) => {
      const key = String(sale.product || '').trim().toLocaleLowerCase('it');
      let toRemove = Math.max(0, num(sale.quantity));
      const group = groups.get(key);
      if (!group || toRemove <= 0) return;
      for (const lot of group.lots) {
        if (toRemove <= 0) break;
        const removed = Math.min(lot.remaining, toRemove);
        lot.remaining -= removed;
        toRemove -= removed;
      }
    });

    const stockedProducts = [...groups.values()]
      .map((group) => ({
        ...group,
        lots: group.lots.filter((lot) => lot.remaining > 0.000001),
      }))
      .filter((group) => group.lots.length > 0)
      .sort((a, b) => a.product.localeCompare(b.product, 'it'));
    const totalUnits = stockedProducts.reduce(
      (sum, group) => sum + group.lots.reduce((n, lot) => n + lot.remaining, 0),
      0
    );
    const totalValue = stockedProducts.reduce(
      (sum, group) =>
        sum + group.lots.reduce((n, lot) => n + lot.remaining * lot.unitPrice, 0),
      0
    );

    // Prodotto con il maggior utile cumulativo sulle vendite registrate.
    // Usa utile netto dopo imposta forfettaria, coerentemente con il riepilogo generale.
    const profitByProduct = new Map();
    (records.sales || []).forEach((sale) => {
      const product = String(sale.product || '').trim();
      if (!product) return;
      const key = product.toLocaleLowerCase('it');
      const saleTotal = num(sale.total_sale || num(sale.quantity) * num(sale.unit_price || sale.sale_unit_price));
      const cost = num(sale.product_cost ?? num(sale.quantity) * num(sale.purchase_unit_cost));
      const fees = num(sale.tiktok_fees);
      const shipping = num(sale.shipping_cost);
      const other = num(sale.other_costs);
      const tax = num(sale.flat_tax ?? saleTotal * 0.02);
      const profit = saleTotal - fees - shipping - other - cost - tax;
      const current = profitByProduct.get(key) || { product, profit: 0 };
      current.profit += profit;
      profitByProduct.set(key, current);
    });
    const topProfitProduct = [...profitByProduct.values()]
      .sort((a, b) => b.profit - a.profit)[0];

    return (
      <>
        {header('Magazzino', 'Giacenze aggiornate da acquisti e vendite')}
        <View style={s.grid}>
          <Card
            title="Tipologie di prodotti"
            value={stockedProducts.length}
            valueFormat="types"
            color={C.green}
            subtitle="Numero di articoli diversi ancora disponibili"
          />
          <Card
            title="Pezzi totali in magazzino"
            value={totalUnits}
            valueFormat="pieces"
            color={C.green}
            subtitle="Somma di tutte le quantità residue"
          />
          <Card
            title="Valore del magazzino"
            value={totalValue}
            color={C.green}
            subtitle="Calcolato al costo d'acquisto"
          />
          <Card
            title="Prodotto con più utile"
            value={topProfitProduct?.product || 'Nessun dato'}
            valueFormat="text"
            color={C.green}
            subtitle={topProfitProduct
              ? `Utile netto totale: ${money(topProfitProduct.profit)}`
              : 'Registra una vendita per vedere il prodotto più redditizio'}
          />
        </View>
        <View style={s.panel}>
          <Text style={[s.sectionTitle, { color: C.green, marginTop: 0 }]}>
            ● GIACENZE DISPONIBILI
          </Text>
          <Text style={s.mutedText}>
            Il calcolo usa il criterio FIFO: le vendite scalano prima gli acquisti più vecchi.
            Ogni lotto mantiene il proprio prezzo d'acquisto.
          </Text>
        </View>
        {stockedProducts.map((group) => {
          const quantity = group.lots.reduce((sum, lot) => sum + lot.remaining, 0);
          const value = group.lots.reduce(
            (sum, lot) => sum + lot.remaining * lot.unitPrice,
            0
          );
          return (
            <View key={group.product.toLocaleLowerCase('it')} style={s.panel}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={s.recordTitle}>{group.product}</Text>
                  <Text style={s.recordSub}>
                    {group.lots.length} {group.lots.length === 1 ? 'lotto' : 'lotti'} ancora disponibili
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ color: C.green, fontWeight: '900', fontSize: 17 }}>
                    {quantity.toLocaleString('it-IT')} pz
                  </Text>
                  <Text style={s.recordSub}>{money(value)}</Text>
                </View>
              </View>
              {group.lots.map((lot, index) => (
                <View
                  key={String(lot.id) + '-' + index}
                  style={{
                    marginTop: 12,
                    padding: 12,
                    borderRadius: 12,
                    backgroundColor: C.panel2,
                    borderLeftWidth: 3,
                    borderLeftColor: C.green,
                  }}>
                  <Text style={s.recordTitle}>
                    {lot.remaining.toLocaleString('it-IT')} pz × {money(lot.unitPrice)}
                  </Text>
                  <Text style={s.recordSub}>
                    Valore residuo: {money(lot.remaining * lot.unitPrice)}
                    {lot.date ? ` · Acquisto: ${toItalianDate(lot.date)}` : ''}
                  </Text>
                  {!!lot.buyer && (
                    <Text style={s.recordSub}>Pagato da: {lot.buyer}</Text>
                  )}
                </View>
              ))}
            </View>
          );
        })}
        {!stockedProducts.length && (
          <View style={s.panel}>
            <Text style={s.empty}>
              Nessuna giacenza disponibile. Registra gli acquisti e le vendite per calcolare il magazzino.
            </Text>
          </View>
        )}
      </>
    );
  }

  function renderNotifications() {
    return (
      <>
        {header('Notifiche al socio', 'Invia messaggi WhatsApp ai numeri scelti')}
        <View style={s.panel}>
          <Text style={s.panelTitle}>Rubrica WhatsApp</Text>
          <Text style={s.mutedSmall}>
            Inserisci i numeri in formato internazionale con prefisso +. Solo i destinatari attivi riceveranno i messaggi.
          </Text>
          <Field
            label="Nome destinatario"
            value={whatsappRecipientName}
            onChangeText={setWhatsappRecipientName}
            placeholder="Es. Socio"
          />
          <Field
            label="Numero WhatsApp"
            value={whatsappRecipientPhone}
            onChangeText={setWhatsappRecipientPhone}
            keyboardType="phone-pad"
            placeholder="+393331234567"
          />
          <Button
            title={whatsappRecipientSaving ? 'Salvataggio…' : '＋ Aggiungi destinatario'}
            onPress={addWhatsAppRecipient}
            type="success"
          />
          <View style={{ marginTop: 14 }}>
            <Button
              title={whatsappRecipientsBusy ? 'Aggiornamento…' : '↻ Aggiorna rubrica'}
              onPress={loadWhatsAppRecipients}
              type="secondary"
            />
          </View>
          {whatsappRecipients.length === 0 ? (
            <Text style={[s.empty, { marginTop: 12 }]}>
              Nessun destinatario in rubrica. Aggiungi un numero per iniziare.
            </Text>
          ) : (
            whatsappRecipients.map((recipient) => (
              <View
                key={recipient.id}
                style={{
                  marginTop: 12,
                  padding: 12,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: C.border,
                  backgroundColor: C.panel2,
                }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.recordTitle}>{recipient.name}</Text>
                    <Text style={s.recordSub}>{recipient.phone_e164}</Text>
                    <Text style={{ color: recipient.enabled ? C.green : C.muted, marginTop: 5, fontWeight: '700' }}>
                      {recipient.enabled ? 'ATTIVO · riceve i messaggi' : 'DISATTIVATO · escluso dagli invii'}
                    </Text>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Button
                      title={recipient.enabled ? 'Disattiva' : 'Attiva'}
                      type="secondary"
                      onPress={() => toggleWhatsAppRecipient(recipient)}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button
                      title="Elimina"
                      type="danger"
                      onPress={() => deleteWhatsAppRecipient(recipient)}
                    />
                  </View>
                </View>
              </View>
            ))
          )}
        </View>
        <View style={s.panel}>
          <Text style={s.panelTitle}>Nuovo messaggio WhatsApp</Text>
          <Text style={s.mutedSmall}>
            Il titolo e il testo verranno inseriti nel modello approvato da Meta. L’invio ai gruppi è disabilitato finché non sarà verificata l’idoneità dell’account.
          </Text>
          <Field
            label="Titolo"
            value={notificationTitle}
            onChangeText={setNotificationTitle}
          />
          <View style={s.field}>
            <Text style={s.label}>Messaggio</Text>
            <TextInput
              style={[s.input, { minHeight: 110, textAlignVertical: 'top' }]}
              value={notificationMessage}
              onChangeText={setNotificationMessage}
              placeholder="Scrivi qui il messaggio da inviare…"
              placeholderTextColor={C.muted}
              multiline
              maxLength={1000}
            />
          </View>
          <Button
            title={notificationBusy ? 'Invio in corso…' : 'Invia via WhatsApp'}
            onPress={sendPartnerNotification}
          />
          <View style={{ marginTop: 10 }}>
            <Button
              title={notificationBusy ? 'Salvataggio…' : '♧ Invia notifica locale'}
              type="success"
              onPress={sendLocalPartnerNotification}
            />
          </View>
          <Text style={s.mutedSmall}>
            La notifica locale viene salvata su Supabase e mostrata sul dispositivo del socio al successivo controllo dell’app. iOS non garantisce controlli immediati in background.
            Questo pulsante usa esclusivamente WhatsApp. Le notifiche automatiche restano separate.
          </Text>
        </View>
        <View style={s.panel}>
          <Text style={s.panelTitle}>Notifiche automatiche</Text>
          <Text style={s.mutedText}>
            Le notifiche automatiche di nuove vendite e prelievi restano gestite separatamente dalla funzione rapid-processor.
          </Text>
        </View>
      </>
    );
  }
  function renderHome() {
    return (
      <>
        {header('Dashboard', 'Situazione economica e movimenti')}
        {isOwner && (
          <View style={{ marginBottom: 14 }}>
            <Button
              title="♧ Notifiche al socio"
              onPress={() => setPage('notifications')}
              type="secondary"
            />
          </View>
        )}

        <View style={s.hero}>
          <Text style={s.heroLabel}>VENDITE TOTALI</Text>
          <Text style={s.heroValue}>{money(totals.sales)}</Text>
          <View style={s.separator} />
          <View style={s.heroRow}>
            <Text style={s.mutedText}>Utile dopo tassa stimata</Text>
            <Text style={s.profitValue}>{money(totals.profit)}</Text>
          </View>
        </View>

        <View style={s.grid}>
          <View style={s.metric}>
            <View style={[s.metricLine, { backgroundColor: C.red }]} />
            <Text style={s.metricLabel}>Commissioni TikTok</Text>
            <Text style={s.metricValue}>{money(totals.fees)}</Text>
            <TouchableOpacity onPress={configureTiktokFeePercent} activeOpacity={0.75} style={{ alignSelf: 'flex-end', marginTop: 6, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8, backgroundColor: C.panel2 }}>
              <Text style={{ color: C.cyan, fontSize: 12, fontWeight: '700' }}>⚙ {tiktokFeePercent}%</Text>
            </TouchableOpacity>
          </View>
          <Card title="Altri costi" value={totals.other} color={C.yellow} />
          <Card
            title="Costo merce venduta"
            value={totals.cost}
            color={C.cyan}
          />
          <Card title="Tassa stimata 2%" value={totals.tax} color={C.red} />
        </View>

        {section('01 · GESTIONE MERCE')}
        <View style={s.panel}>
          <Text style={s.panelTitle}>Totale acquisti registrati</Text>
          <Text style={s.panelValue}>{money(totals.purchases)}</Text>
          <View style={s.twoColumns}>
            <View style={s.miniBox}>
              <Text style={s.mutedText}>Anticipato da Poggio</Text>
              <Text style={s.miniValue}>{money(totals.poggioPurchases)}</Text>
            </View>
            <View style={s.miniBox}>
              <Text style={s.mutedText}>Anticipato da Fanton</Text>
              <Text style={s.miniValue}>{money(totals.fantonPurchases)}</Text>
            </View>
          </View>
          <Button
            title="+ Registra acquisto merce"
            onPress={() => openForm('purchaseForm')}
          />
        </View>

        {section('02 · UTILE E CASSA')}
        <View style={s.grid}>
          <Card
            title="Utile prima della tassa"
            value={totals.profitBeforeTax}
            color={C.cyan}
          />
          <Card
            title="Utile dopo la tassa"
            value={totals.profit}
            color={C.green}
          />
          <Card
            title="Quota utile Poggio"
            value={totals.profit / 2}
            color={C.cyan}
          />
          <Card
            title="Quota utile Fanton"
            value={totals.profit / 2}
            color={C.yellow}
          />
        </View>

        <View style={s.panel}>
          <Text style={s.panelTitle}>Stima cassa residua</Text>
          <Text style={s.panelValue}>{money(totals.cashEstimate)}</Text>
          <Text style={s.mutedSmall}>
            Stima semplificata: non comprende eventuali giacenze iniziali,
            rimborsi o movimenti non registrati.
          </Text>
        </View>

        {section('03 · PRELIEVI E SPETTANZE')}
        <View style={s.grid}>
          <Card
            title="Prelievi Poggio"
            value={totals.poggioWithdrawals}
            color={C.cyan}
          />
          <Card
            title="Prelievi Fanton"
            value={totals.fantonWithdrawals}
            color={C.yellow}
          />
          <Card
            title="Quota utile residua Poggio"
            value={totals.poggioPosition}
            color={C.green}
          />
          <Card
            title="Quota utile residua Fanton"
            value={totals.fantonPosition}
            color={C.green}
          />
        </View>

        {section('04 · CONGUAGLIO SOCI')}
        <View style={s.panel}>
          <Text style={s.panelTitle}>Saldo indicativo dei movimenti</Text>
          <View style={s.twoColumns}>
            <View style={s.miniBox}>
              <Text style={s.partnerName}>POGGIO</Text>
              <Text style={s.balanceValue}>{money(totals.poggioBalance)}</Text>
            </View>
            <View style={s.miniBox}>
              <Text style={s.partnerName}>FANTON</Text>
              <Text style={s.balanceValue}>{money(totals.fantonBalance)}</Text>
            </View>
          </View>
          <Text style={s.mutedSmall}>
            Il saldo tiene conto degli acquisti anticipati, della quota utile,
            dei prelievi e dei pagamenti interni. Va verificato rispetto alle
            formule del foglio Excel prima di effettuare un conguaglio reale.
          </Text>
          <Button
            title="Apri movimenti tra soci"
            onPress={() => setPage('payments')}
            type="secondary"
          />
        </View>

        {section('05 · OPERAZIONI')}
        <View style={s.actionGrid}>
          <Button
            title="+ Nuova vendita"
            onPress={() => openForm('saleForm')}
          />
          <Button
            title="+ Nuovo acquisto"
            onPress={() => openForm('purchaseForm')}
          />
          <Button
            title="⇄ Pagamento tra soci"
            onPress={() => openForm('paymentForm')}
            type="success"
          />
          <Button
            title="↓ Nuovo prelievo"
            onPress={() => openForm('withdrawalForm')}
            type="secondary"
          />
          <Button
            title="Vedi prelievi registrati"
            onPress={() => setPage('withdrawals')}
            type="secondary"
          />
        </View>

        {section('06 · ARCHIVI')}
        <View style={s.actionGrid}>
          <Button
            title="Prodotti"
            onPress={() => setPage('products')}
            type="secondary"
          />
          <Button
            title="Clienti"
            onPress={() => setPage('customers')}
            type="secondary"
          />
        </View>
      </>
    );
  }

  function renderSaleForm() {
    const items = [
      { product: form.product || '', quantity: form.quantity || '1', unit_price: form.unit_price || '0' },
      ...(Array.isArray(form.order_items) ? form.order_items : []),
    ];
    const orderTotal = items.reduce((sum, item) => sum + num(item.quantity) * num(item.unit_price), 0);
    const itemCost = items.reduce((sum, item) => sum + getFifoSaleCost(
      item.product, item.quantity, editing?.table === 'sales' ? editing.id : null
    ).totalCost, 0);
    const total = num(form.quantity) * num(form.unit_price);
    const cost = getFifoSaleCost(form.product, form.quantity, editing?.table === 'sales' ? editing.id : null).totalCost;
    const updateExtra = (index, key, value) => setForm((old) => ({
      ...old,
      order_items: (old.order_items || []).map((line, i) => i === index ? { ...line, [key]: value } : line),
    }));

    return (
      <>
        {header(editing ? 'Modifica vendita' : 'Nuova vendita', 'Registrazione TikTok Shop')}
        <View style={s.panel}>
          <View style={[s.summary, { borderColor: C.green, borderWidth: 1, marginBottom: 14 }]}>
            <Text style={[s.sectionTitle, { color: C.green }]}>① DATI ORDINE E CLIENTE</Text>
            <Field label="Data (GG/MM/AAAA)" value={form.date} onChangeText={(v) => change('date', v)} placeholder="GG/MM/AAAA" />
            <Field label="Numero ordine" value={form.order_number} onChangeText={(v) => change('order_number', v)} />
            {dropdown(
              'Scelta rapida cliente',
              'customer',
              'customer',
              [form.first_name, form.last_name].filter(Boolean).join(' '),
              'Seleziona un cliente dall’archivio'
            )}
            <Field label="Nome cliente" value={form.first_name} onChangeText={(v) => change('first_name', v)} />
            <Field label="Cognome cliente" value={form.last_name} onChangeText={(v) => change('last_name', v)} />
          </View>

          <View style={[s.summary, { borderColor: C.green, borderWidth: 1, marginBottom: 14 }]}>
            <Text style={[s.sectionTitle, { color: C.green }]}>② PRODOTTI DELL'ORDINE · {items.length}</Text>
            {items.map((item, index) => (
              <View key={index === 0 ? 'main-product' : `order-item-${index}`} style={[s.summary, { marginTop: 10, borderWidth: 1, borderColor: C.border || '#2B3C55' }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={s.summaryLine}>Prodotto {index + 1}</Text>
                  {index > 0 && !editing && (
                    <TouchableOpacity onPress={() => setForm((old) => ({ ...old, order_items: old.order_items.filter((_, i) => i !== index - 1) }))}>
                      <Text style={{ color: C.red, fontWeight: '800' }}>Rimuovi ✕</Text>
                    </TouchableOpacity>
                  )}
                </View>
                {index === 0
                  ? dropdown('Prodotto', 'product', 'product', form.product, 'Scegli o scrivi un prodotto')
                  : dropdown('Prodotto', 'product', `order_items.${index - 1}.product`, item.product, 'Scegli o scrivi un prodotto')}
                {(() => {
                  const catalogProduct = (records.products || []).find((row) => String(row.name || '').toLowerCase() === String(item.product || '').toLowerCase());
                  return catalogProduct?.photo_url ? (
                    <View style={{ marginTop: 8, marginBottom: 8 }}>
                      <Image source={{ uri: catalogProduct.photo_url }} style={{ width: 88, height: 88, borderRadius: 10, backgroundColor: C.card }} resizeMode="cover" />
                    </View>
                  ) : null;
                })()}
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 0.7 }}>
                    <Field label="Quantità" value={item.quantity} onChangeText={(v) => index === 0 ? change('quantity', v) : updateExtra(index - 1, 'quantity', v)} keyboardType="decimal-pad" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Field label="Prezzo unitario (€)" value={item.unit_price} onChangeText={(v) => index === 0 ? change('unit_price', v) : updateExtra(index - 1, 'unit_price', v)} keyboardType="decimal-pad" />
                  </View>
                </View>
                <Text style={s.mutedText}>Totale prodotto: {money(num(item.quantity) * num(item.unit_price))}</Text>
              </View>
            ))}
            {!editing && (
              <Button title="+ Aggiungi un altro prodotto" type="secondary" onPress={() => setForm((old) => ({
                ...old,
                order_items: [...(old.order_items || []), { product: '', quantity: '1', unit_price: '0' }],
              }))} />
            )}
            <Text style={[s.summaryLine, { marginTop: 10 }]}>Totale prodotti: {money(orderTotal)}</Text>
          </View>

          <View style={[s.summary, { borderColor: C.green, borderWidth: 1, marginBottom: 14 }]}>
            <Text style={[s.sectionTitle, { color: C.green }]}>③ COSTI DELL'ORDINE</Text>
            <Field label={`Commissioni TikTok (€) — ${tiktokFeePercent}%`} value={form.fees} onChangeText={(v) => change('fees', v)} keyboardType="decimal-pad" />
            <Field label="Costo spedizione (€)" value={form.shipping_cost} onChangeText={(v) => change('shipping_cost', v)} keyboardType="decimal-pad" />
            <Field label="Altri costi (€)" value={form.other_costs} onChangeText={(v) => change('other_costs', v)} keyboardType="decimal-pad" />
          </View>

          <View style={s.summary}>
            <Text style={s.summaryLine}>Totale vendita: {money(orderTotal)}</Text>
            <Text style={s.summaryLine}>Costi merce stimati: − {money(itemCost)}</Text>
            <Text style={s.summaryLine}>Spedizione: − {money(form.shipping_cost)}</Text>
            <Text style={s.summaryLine}>Commissioni TikTok: − {money(form.fees)}</Text>
            <Text style={s.summaryLine}>Altri costi: − {money(form.other_costs)}</Text>
            <Text style={s.summaryLine}>Tassa stimata (2%): − {money(orderTotal * 0.02)}</Text>
            <View style={s.separator} />
            <Text style={[s.summaryLine, { color: C.green }]}>Utile netto stimato: {money(orderTotal - itemCost - num(form.fees) - num(form.shipping_cost) - num(form.other_costs) - orderTotal * 0.02)}</Text>
          </View>
          <Button title={editing ? 'Salva modifiche' : 'Salva vendita'} onPress={saveSale} />
          <Button title="Annulla" type="secondary" onPress={() => setPage('sales')} />
        </View>
      </>
    );
  }

  function renderPurchaseForm() {
    return (
      <>
        {header(
          editing ? 'Modifica acquisto' : 'Acquisto merce',
          'Registra chi ha anticipato la spesa'
        )}
        <View style={s.panel}>
          <Field
            label="Data (GG/MM/AAAA)"
            value={form.date}
            onChangeText={(v) => change('date', v)}
            placeholder="GG/MM/AAAA"
          />
          {dropdown(
            'Chi ha pagato',
            'partner',
            'buyer',
            form.buyer,
            'Seleziona Poggio o Fanton'
          )}
          {dropdown(
            'Prodotto',
            'product',
            'product',
            form.product,
            'Scegli o scrivi un prodotto'
          )}
          <Field
            label="Quantità"
            value={form.quantity}
            onChangeText={(v) => change('quantity', v)}
            keyboardType="decimal-pad"
          />
          <Field
            label="Prezzo unitario (€)"
            value={form.unit_price}
            onChangeText={(v) => change('unit_price', v)}
            keyboardType="decimal-pad"
          />
          <View style={s.summary}>
            <Text style={s.summaryLine}>
              Totale acquisto:{' '}
              {money(num(form.quantity) * num(form.unit_price))}
            </Text>
          </View>
          <Button
            title={editing ? 'Salva modifiche' : 'Salva acquisto'}
            onPress={savePurchase}
          />
          <Button
            title="Annulla"
            type="secondary"
            onPress={() => setPage('purchases')}
          />
        </View>
      </>
    );
  }

  function renderPaymentForm() {
    return (
      <>
        {header(
          editing ? 'Modifica pagamento' : 'Pagamento tra soci',
          'Trasferimenti interni'
        )}
        <View style={s.panel}>
          <Field
            label="Data (GG/MM/AAAA)"
            value={form.date}
            onChangeText={(v) => change('date', v)}
            placeholder="GG/MM/AAAA"
          />
          {dropdown(
            'Chi ha pagato',
            'partner',
            'payer',
            form.payer,
            'Seleziona socio'
          )}
          {dropdown(
            'Chi ha ricevuto',
            'receiver',
            'receiver',
            form.receiver,
            'Seleziona socio'
          )}
          <Field
            label="Importo (€)"
            value={form.amount}
            onChangeText={(v) => change('amount', v)}
            keyboardType="decimal-pad"
          />
          <Field
            label="Note"
            value={form.note}
            onChangeText={(v) => change('note', v)}
          />
          <Button
            title={editing ? 'Salva modifiche' : 'Salva pagamento'}
            onPress={() => {
              if (
                !form.payer ||
                !form.receiver ||
                form.payer === form.receiver ||
                num(form.amount) <= 0
              ) {
                Alert.alert(
                  'Controlla i dati',
                  'Scegli due soci diversi e un importo maggiore di zero.'
                );
                return;
              }
              saveRecord('internal_payments', {
                payment_date: toDatabaseDate(form.date),
                payer: form.payer,
                receiver: form.receiver,
                amount: num(form.amount),
                note: form.note || '',
              });
            }}
          />
          <Button
            title="Annulla"
            type="secondary"
            onPress={() => setPage('payments')}
          />
        </View>
      </>
    );
  }

  function renderWithdrawalForm() {
    return (
      <>
        {header(
          editing ? 'Modifica prelievo' : 'Nuovo prelievo',
          'Prelievi personali dei soci'
        )}
        <View style={s.panel}>
          <Field
            label="Data (GG/MM/AAAA)"
            value={form.date}
            onChangeText={(v) => change('date', v)}
            placeholder="GG/MM/AAAA"
          />
          {dropdown(
            'Socio',
            'partner',
            'person',
            form.person,
            'Seleziona socio'
          )}
          <Field
            label="Importo (€)"
            value={form.amount}
            onChangeText={(v) => change('amount', v)}
            keyboardType="decimal-pad"
          />
          <Field
            label="Note"
            value={form.note}
            onChangeText={(v) => change('note', v)}
          />
          <Button
            title={editing ? 'Salva modifiche' : 'Salva prelievo'}
            onPress={() => {
              if (!form.person || num(form.amount) <= 0) {
                Alert.alert(
                  'Dati mancanti',
                  'Seleziona il socio e inserisci l’importo.'
                );
                return;
              }
              saveRecord('withdrawals', {
                withdrawal_date: toDatabaseDate(form.date),
                person: form.person,
                amount: num(form.amount),
                note: form.note || '',
              });
            }}
          />
          <Button
            title="Annulla"
            type="secondary"
            onPress={() => setPage('home')}
          />
        </View>
      </>
    );
  }

  function renderCatalog(table) {
    const isProduct = table === 'products';
    const rawCatalogData = records[table] || [];
    const data = [...rawCatalogData].sort((a, b) => {
      const nameA = String(a.name || '');
      const nameB = String(b.name || '');
      return archiveSortMode === 'name_desc'
        ? nameB.localeCompare(nameA, 'it', { sensitivity: 'base' })
        : nameA.localeCompare(nameB, 'it', { sensitivity: 'base' });
    });

    return (
      <>
        {header('Archivio', isProduct ? 'Nomi prodotto salvati' : 'Clienti salvati')}
        <View style={s.filterRow}>
          <TouchableOpacity
            style={[s.chip, isProduct && s.chipActive]}
            onPress={() => {
              setForm({});
              setPage('products');
            }}>
            <Text style={[s.chipText, isProduct && s.chipTextActive]}>
              Prodotti ({records.products.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.chip, !isProduct && s.chipActive]}
            onPress={() => {
              setForm({});
              setPage('customers');
            }}>
            <Text style={[s.chipText, !isProduct && s.chipTextActive]}>
              Clienti ({records.customers.length})
            </Text>
          </TouchableOpacity>
        </View>
        <View style={s.panel}>
          <Field
            label={isProduct ? 'Nome prodotto' : 'Nome e cognome'}
            value={form.name}
            onChangeText={(v) => change('name', v)}
            placeholder="Inserisci un nome"
          />
          {isProduct && (
            <View style={{ marginBottom: 12 }}>
              <Text style={s.label}>Foto prodotto</Text>
              {form.photo_preview ? (
                <TouchableOpacity onPress={chooseProductPhoto} activeOpacity={0.8}>
                  <Image source={{ uri: form.photo_preview }} style={{ width: 112, height: 112, borderRadius: 12, marginBottom: 10, backgroundColor: C.card }} resizeMode="cover" />
                </TouchableOpacity>
              ) : (
                <View style={{ width: 112, height: 112, borderRadius: 12, marginBottom: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border || '#2B3C55', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: C.muted, fontSize: 28 }}>▧</Text>
                  <Text style={{ color: C.muted, fontSize: 11 }}>Nessuna foto</Text>
                </View>
              )}
              <Button title="📷 Apri galleria e scegli foto" type="secondary" onPress={chooseProductPhoto} />
            </View>
          )}
          <Button
            title={isProduct ? '+ Aggiungi prodotto' : '+ Aggiungi cliente'}
            onPress={async () => {
              const name = String(form.name || '').trim();
              if (!name) {
                Alert.alert('Nome mancante', 'Scrivi un nome.');
                return;
              }
              setLoading(true);
              try {
                if (isProduct) {
                  const existing = records.products.find((row) => String(row.name || '').toLowerCase() === name.toLowerCase());
                  if (existing) {
                    if (form.photo_url && existing.id) {
                      await api(`/rest/v1/products?id=eq.${encodeURIComponent(existing.id)}`, token, {
                        method: 'PATCH',
                        headers: { Prefer: 'return=minimal' },
                        body: JSON.stringify({ photo_url: form.photo_url }),
                      });
                    } else if (!form.photo_url) {
                      Alert.alert('Prodotto già presente', 'Il prodotto esiste già. Puoi selezionare una foto e salvare per aggiornarla.');
                      return;
                    }
                  } else {
                    await api('/rest/v1/products', token, {
                      method: 'POST',
                      headers: { Prefer: 'return=minimal' },
                      body: JSON.stringify({ name, photo_url: form.photo_url || null }),
                    });
                  }
                } else {
                  await addCatalog(table, name);
                }
                setForm({});
                await loadData();
                Alert.alert('Archivio aggiornato', `${name} è stato ${isProduct ? 'salvato' : 'aggiunto'}.`);
              } catch (e) {
                Alert.alert('Errore archivio', e.message);
              } finally {
                setLoading(false);
              }
            }}
          />
        </View>

        <TouchableOpacity
          style={[s.chip, archiveFiltersOpen && s.chipActive, { alignSelf: 'flex-start', marginTop: 12, marginBottom: 12 }]}
          onPress={() => setArchiveFiltersOpen((visible) => !visible)}>
          <Text style={[s.chipText, archiveFiltersOpen && s.chipTextActive]}>
            {archiveFiltersOpen ? '⌃ Nascondi filtri' : '☷ Filtri e ordinamento'}
          </Text>
        </TouchableOpacity>
        {archiveFiltersOpen && (
          <View style={[s.panel, { marginBottom: 12 }]}>
            <Text style={s.label}>Ordina per nome</Text>
            <View style={s.filterWrap}>
              {[
                ['name_asc', 'Nome A-Z'],
                ['name_desc', 'Nome Z-A'],
              ].map(([value, label]) => (
                <TouchableOpacity
                  key={value}
                  style={[s.chip, archiveSortMode === value && s.chipActive]}
                  onPress={() => setArchiveSortMode(value)}>
                  <Text style={[s.chipText, archiveSortMode === value && s.chipTextActive]}>
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={[s.mutedText, { marginTop: 8 }]}>
              Nell'Archivio sono disponibili gli ordinamenti per nome; data e prezzo non sono campi delle anagrafiche.
            </Text>
          </View>
        )}
        {data.map((row) => (
          <TouchableOpacity
            key={row.id}
            activeOpacity={0.82}
            onPress={() => {
              if (isProduct) {
                setForm({ name: row.name || '', photo_url: row.photo_url || '', photo_preview: row.photo_url || '', product_id: row.id });
                return;
              }
              setSelectedCustomer(row);
              setForm({
                phone: row.phone || '',
                email: row.email || '',
                customer_notes: row.notes || '',
              });
              setPage('customerDetail');
            }}
            style={[
              s.record,
              {
                alignItems:
                  namePosition === 'top'
                    ? 'flex-start'
                    : namePosition === 'bottom'
                    ? 'flex-end'
                    : 'center',
                borderLeftWidth: 4,
                borderLeftColor: isProduct ? C.yellow : '#C39BFF',
              },
            ]}>
            {isProduct && (
              row.photo_url
                ? <Image source={{ uri: row.photo_url }} style={{ width: 58, height: 58, borderRadius: 10, marginRight: 12, backgroundColor: C.card }} resizeMode="cover" />
                : <View style={{ width: 58, height: 58, borderRadius: 10, marginRight: 12, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: C.muted, fontSize: 22 }}>▧</Text></View>
            )}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                style={[
                  s.recordTitle,
                  {
                    textAlignVertical:
                      namePosition === 'top'
                        ? 'top'
                        : namePosition === 'bottom'
                        ? 'bottom'
                        : 'center',
                  },
                ]}>
                {row.name}
              </Text>
              {!isProduct && (
                <Text style={s.recordSub}>
                  Apri scheda cliente · storico acquisti ›
                </Text>
              )}
            </View>
            <View style={{ width: 94 }}>
              {!isProduct && (
                <Button
                  title="Scheda"
                  type="secondary"
                  onPress={() => {
                    setSelectedCustomer(row);
                    setForm({
                      phone: row.phone || '',
                      email: row.email || '',
                      customer_notes: row.notes || '',
                    });
                    setPage('customerDetail');
                  }}
                />
              )}
              <Button
                title="Elimina"
                type="danger"
                onPress={() => deleteRow(table, row)}
              />
            </View>
          </TouchableOpacity>
        ))}
        {!data.length && (
          <Text style={s.empty}>Nessun elemento registrato.</Text>
        )}
      </>
    );
  }

  async function saveCustomerDetails() {
    if (!selectedCustomer?.id) return;
    setLoading(true);
    try {
      await api(
        `/rest/v1/customers?id=eq.${encodeURIComponent(selectedCustomer.id)}`,
        token,
        {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({
            phone: form.phone || '',
            email: form.email || '',
            notes: form.customer_notes || '',
          }),
        }
      );
      await loadData();
      const updated = {
        ...selectedCustomer,
        phone: form.phone || '',
        email: form.email || '',
        notes: form.customer_notes || '',
      };
      setSelectedCustomer(updated);
      Alert.alert(
        'Scheda aggiornata',
        'I dati del cliente sono stati salvati.'
      );
    } catch (e) {
      Alert.alert('Errore salvataggio', e.message);
    } finally {
      setLoading(false);
    }
  }

  function renderCustomerDetail() {
    if (!selectedCustomer)
      return (
        <>
          {header('Scheda cliente', 'Seleziona un cliente dall’archivio')}
          <Button
            title="← Torna all’archivio"
            type="secondary"
            onPress={() => setPage('customers')}
          />
        </>
      );
    const customerName =
      selectedCustomer.name ||
      [
        selectedCustomer.customer_first_name,
        selectedCustomer.customer_last_name,
      ]
        .filter(Boolean)
        .join(' ');
    const history = (records.sales || [])
      .filter((sale) => {
        const saleName = String(
          sale.customer_name ||
            [sale.customer_first_name, sale.customer_last_name]
              .filter(Boolean)
              .join(' ')
        ).trim();
        return (
          saleName.toLocaleLowerCase('it') ===
          String(customerName).trim().toLocaleLowerCase('it')
        );
      })
      .sort((a, b) => dateSortValue(b.sale_date) - dateSortValue(a.sale_date));
    const total = history.reduce(
      (sum, sale) =>
        sum +
        num(
          sale.total_sale ??
            num(sale.quantity) * num(sale.sale_unit_price ?? sale.unit_price)
        ),
      0
    );
    const profit = history.reduce((sum, sale) => {
      const saleTotal = num(
        sale.total_sale ??
          num(sale.quantity) * num(sale.sale_unit_price ?? sale.unit_price)
      );
      const profitBeforeTax = num(
        sale.net_profit ??
          saleTotal -
            num(sale.product_cost) -
            num(sale.tiktok_fees) -
            num(sale.shipping_cost) -
            num(sale.other_costs)
      );
      // net_profit è salvato prima della tassa: sottraiamo la tassa anche nello storico cliente.
      const tax = num(sale.flat_tax ?? saleTotal * 0.02);
      return sum + profitBeforeTax - tax;
    }, 0);
    return (
      <>
        {header('Scheda cliente', 'Anagrafica, storico ordini e riepilogo')}
        <Button
          title="← Torna all’archivio clienti"
          type="secondary"
          onPress={() => setPage('customers')}
        />
        <View style={[s.customerHero, { borderColor: '#C39BFF' }]}>
          <View style={s.customerAvatar}>
            <Text style={s.customerAvatarText}>
              {String(customerName || '?')
                .trim()
                .split(/\s+/)
                .slice(0, 2)
                .map((x) => x[0] || '')
                .join('')
                .toUpperCase()}
            </Text>
          </View>
          <Text style={s.customerName}>{customerName}</Text>
          <Text style={s.mutedText}>Cliente registrato nell’archivio</Text>
          <View style={s.customerStats}>
            <View style={s.customerStat}>
              <Text style={s.customerStatLabel}>ORDINI</Text>
              <Text style={s.customerStatValue}>{history.length}</Text>
            </View>
            <View style={s.customerStat}>
              <Text style={s.customerStatLabel}>TOTALE ACQUISTI</Text>
              <Text style={s.customerStatValue}>{money(total)}</Text>
            </View>
            <View style={s.customerStat}>
              <Text style={s.customerStatLabel}>UTILE STIMATO</Text>
              <Text style={[s.customerStatValue, { color: C.green }]}>
                {money(profit)}
              </Text>
            </View>
          </View>
        </View>
        <View style={s.panel}>
          <Text style={s.sectionTitle}>DATI DI CONTATTO</Text>
          <Field
            label="Telefono"
            value={form.phone}
            onChangeText={(v) => change('phone', v)}
            keyboardType="phone-pad"
            placeholder="Numero di telefono"
          />
          <Field
            label="Email"
            value={form.email}
            onChangeText={(v) => change('email', v)}
            keyboardType="email-address"
            placeholder="Indirizzo email"
          />
          <Text style={s.label}>Note cliente</Text>
          <TextInput
            style={[s.input, { minHeight: 90, textAlignVertical: 'top' }]}
            multiline
            value={String(form.customer_notes || '')}
            onChangeText={(v) => change('customer_notes', v)}
            placeholder="Preferenze, informazioni utili…"
            placeholderTextColor={C.muted}
          />
          <Button
            title="Salva dati cliente"
            onPress={saveCustomerDetails}
            type="success"
          />
        </View>
        <Text style={s.sectionTitle}>
          STORICO VENDITE · {history.length} ORDINI
        </Text>
        {history.map((sale) => (
          <TouchableOpacity
            key={String(sale.id)}
            style={[s.record, { borderLeftWidth: 4, borderLeftColor: C.green }]}
            activeOpacity={0.8}
            onPress={() => editRow('sales', sale)}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.recordTitle}>{sale.product || 'Vendita'}</Text>
              <Text style={s.recordSub}>
                {toItalianDate(sale.sale_date)}
                {sale.order_number ? ` · Ordine ${sale.order_number}` : ''} ·
                Quantità: {sale.quantity ?? 1}
              </Text>
              <Text style={s.recordAmount}>
                {money(
                  sale.total_sale ??
                    num(sale.quantity) *
                      num(sale.sale_unit_price ?? sale.unit_price)
                )}
              </Text>
            </View>
            <Text style={s.activityChevron}>›</Text>
          </TouchableOpacity>
        ))}
        {!history.length && (
          <Text style={s.empty}>
            Nessuna vendita collegata a questo cliente.
          </Text>
        )}
      </>
    );
  }

  function renderList(table) {
    const config = {
      sales: { title: 'Vendite', date: 'sale_date', amount: 'total_sale' },
      purchases: {
        title: 'Acquisti merce',
        date: 'purchase_date',
        amount: null,
      },
      internal_payments: {
        title: 'Pagamenti soci',
        date: 'payment_date',
        amount: 'amount',
      },
      withdrawals: {
        title: 'Prelievi',
        date: 'withdrawal_date',
        amount: 'amount',
      },
    }[table];
    const target = {
      sales: 'saleForm',
      purchases: 'purchaseForm',
      internal_payments: 'paymentForm',
      withdrawals: 'withdrawalForm',
    }[table];

    const rawData = records[table] || [];
    const getAmount = (row) =>
      config.amount
        ? num(row[config.amount])
        : num(row.quantity) * num(row.unit_price);
    const getTitle = (row) =>
      row.product ||
      row.customer_name ||
      ([row.payer, row.receiver].filter(Boolean).length
        ? `${row.payer || ''} → ${row.receiver || ''}`
        : '') ||
      row.person ||
      row.buyer ||
      row.order_number ||
      row.note ||
      'Registrazione';
    const filteredData = rawData
      .filter((row) => {
        const searchable = [
          getTitle(row),
          row.customer_name,
          row.buyer,
          row.person,
          row.payer,
          row.receiver,
          row.order_number,
          row.note,
          row.product,
          row[config.date],
          getAmount(row),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return searchable.includes(listSearch.trim().toLowerCase());
      })
      .sort((a, b) => {
        if (sortMode === 'name_asc')
          return getTitle(a).localeCompare(getTitle(b), 'it', {
            sensitivity: 'base',
          });
        if (sortMode === 'name_desc')
          return getTitle(b).localeCompare(getTitle(a), 'it', {
            sensitivity: 'base',
          });
        if (sortMode === 'price_asc') return getAmount(a) - getAmount(b);
        if (sortMode === 'price_desc') return getAmount(b) - getAmount(a);
        if (sortMode === 'date_asc')
          return dateSortValue(a[config.date]) - dateSortValue(b[config.date]);
        return dateSortValue(b[config.date]) - dateSortValue(a[config.date]);
      });

    return (
      <>
        {header(config.title, 'Registro delle operazioni')}
        <Button
          title="+ Nuova registrazione"
          onPress={() => openForm(target)}
        />
        <View style={s.panel}>
          <Field
            label="Cerca per nome, data, prezzo o dettaglio"
            value={listSearch}
            onChangeText={setListSearch}
            placeholder="Scrivi per filtrare…"
          />
          <TouchableOpacity
            style={[s.chip, showSortFilters && s.chipActive, { alignSelf: 'flex-start', marginTop: 12 }]}
            onPress={() => setShowSortFilters((visible) => !visible)}>
            <Text style={[s.chipText, showSortFilters && s.chipTextActive]}>
              {showSortFilters ? '⌃ Nascondi filtri' : '☷ Filtri e ordinamento'}
            </Text>
          </TouchableOpacity>
          {showSortFilters && (
            <View style={{ marginTop: 10 }}>
              <Text style={s.label}>Ordina per</Text>
              <View style={s.filterWrap}>
                {[
                  ['name_asc', 'Nome A-Z'],
                  ['date_desc', 'Data più recente'],
                  ['date_asc', 'Data meno recente'],
                  ['price_desc', 'Prezzo più alto'],
                  ['price_asc', 'Prezzo più basso'],
                ].map(([value, label]) => (
                  <TouchableOpacity
                    key={value}
                    style={[s.chip, sortMode === value && s.chipActive]}
                    onPress={() => setSortMode(value)}>
                    <Text style={[s.chipText, sortMode === value && s.chipTextActive]}>
                      {label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}
          <Text style={[s.label, { marginTop: 12 }]}>Visualizzazione</Text>
          <View style={s.filterRow}>
            {['details', 'list'].map((value) => (
              <TouchableOpacity
                key={value}
                style={[s.chip, listView === value && s.chipActive]}
                onPress={() => setListView(value)}>
                <Text
                  style={[s.chipText, listView === value && s.chipTextActive]}>
                  {value === 'details' ? 'Dettagli' : 'Elenco compatto'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={s.mutedSmall}>
            {filteredData.length} di {rawData.length} registrazioni
          </Text>
        </View>

        {filteredData.map((row) => {
          const amount = getAmount(row);
          const title = getTitle(row);
          const dateText = toItalianDate(row[config.date]);
          const details = [
            row.order_number ? `Ordine ${row.order_number}` : '',
            row.shipping_cost != null
              ? `Spedizione ${money(row.shipping_cost)}`
              : '',
            row.buyer ? `Pagato da ${row.buyer}` : '',
            row.customer_name || '',
            row.person ? `Socio: ${row.person}` : '',
            row.payer && row.receiver ? `${row.payer} → ${row.receiver}` : '',
            row.quantity != null ? `Quantità: ${row.quantity}` : '',
            row.note || '',
          ]
            .filter(Boolean)
            .join(' · ');
          return (
            <View key={row.id} style={s.record}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.recordTitle}>{title}</Text>
                <Text style={s.recordSub}>
                  {dateText}
                  {listView === 'details' && details ? ` · ${details}` : ''}
                </Text>
                <Text style={s.recordAmount}>{money(amount)}</Text>
              </View>
              <View style={{ width: 100 }}>
                <Button
                  title="Modifica"
                  type="secondary"
                  onPress={() => editRow(table, row)}
                />
                <Button
                  title="Elimina"
                  type="danger"
                  onPress={() => deleteRow(table, row)}
                />
              </View>
            </View>
          );
        })}
        {!filteredData.length && (
          <Text style={s.empty}>
            {rawData.length
              ? 'Nessun risultato per questi filtri.'
              : 'Ancora nessuna registrazione.'}
          </Text>
        )}
      </>
    );
  }

  const activityTableLabels = {
    sales: 'Vendite',
    purchases: 'Acquisti',
    internal_payments: 'Pagamenti tra soci',
    withdrawals: 'Prelievi',
    products: 'Prodotti',
    customers: 'Clienti',
  };

  const activityFieldLabels = {
    id: 'ID',
    created_at: 'Data creazione',
    updated_at: 'Ultimo aggiornamento',
    created_by: 'Creato da',
    sale_date: 'Data vendita',
    purchase_date: 'Data acquisto',
    payment_date: 'Data pagamento',
    withdrawal_date: 'Data prelievo',
    product: 'Prodotto',
    customer_name: 'Cliente',
    customer_first_name: 'Nome cliente',
    customer_last_name: 'Cognome cliente',
    buyer: 'Acquirente',
    quantity: 'Quantità',
    unit_price: 'Prezzo unitario',
    sale_unit_price: 'Prezzo vendita',
    amount: 'Importo',
    total_sale: 'Totale vendita',
    tiktok_fees: 'Commissioni TikTok',
    other_costs: 'Altri costi',
    purchase_unit_cost: 'Costo unitario merce',
    product_cost: 'Costo prodotto',
    flat_tax: 'Tassa stimata',
    order_number: 'Numero ordine',
    note: 'Note',
    name: 'Nome',
    person: 'Socio',
    payer: 'Paga',
    receiver: 'Riceve',
  };

  function activityActionLabel(action) {
    return action === 'INSERT'
      ? 'Creazione'
      : action === 'UPDATE'
      ? 'Modifica'
      : action === 'DELETE'
      ? 'Eliminazione'
      : String(action || 'Operazione');
  }

  function activityDate(value) {
    if (!value) return 'Data non disponibile';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return `${d.toLocaleDateString('it-IT')} · ${d.toLocaleTimeString('it-IT', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })}`;
  }

  function displayActivityValue(value) {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  function activityChanges(item) {
    const before =
      item.old_data && typeof item.old_data === 'object' ? item.old_data : {};
    const after =
      item.new_data && typeof item.new_data === 'object' ? item.new_data : {};
    const ignored = new Set(['id', 'created_at', 'updated_at']);
    const keys = [
      ...new Set([...Object.keys(before), ...Object.keys(after)]),
    ].filter((k) => !ignored.has(k));
    if (item.action === 'INSERT')
      return keys
        .filter((k) => after[k] !== undefined)
        .map((k) => ({
          key: k,
          label: activityFieldLabels[k] || k.replaceAll('_', ' '),
          before: undefined,
          after: after[k],
        }));
    if (item.action === 'DELETE')
      return keys
        .filter((k) => before[k] !== undefined)
        .map((k) => ({
          key: k,
          label: activityFieldLabels[k] || k.replaceAll('_', ' '),
          before: before[k],
          after: undefined,
        }));
    return keys
      .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
      .map((k) => ({
        key: k,
        label: activityFieldLabels[k] || k.replaceAll('_', ' '),
        before: before[k],
        after: after[k],
      }));
  }

  function activityPreview(item) {
    const changes = activityChanges(item);
    if (!changes.length) return 'Dettagli operazione disponibili';
    return changes
      .slice(0, 2)
      .map((change) => {
        if (item.action === 'INSERT')
          return `${change.label}: ${displayActivityValue(change.after)}`;
        if (item.action === 'DELETE')
          return `${change.label}: ${displayActivityValue(change.before)}`;
        return `${change.label}: ${displayActivityValue(
          change.before
        )} → ${displayActivityValue(change.after)}`;
      })
      .join(' · ');
  }

  async function openActivityLog() {
    setPage('activityLog');
    setLoading(true);
    try {
      const data = await api(
        '/rest/v1/activity_logs?select=*&order=created_at.desc&limit=500',
        token
      );
      setActivityLogs(Array.isArray(data) ? data : []);
    } catch (e) {
      Alert.alert(
        'Log',
        `Non riesco a caricare il registro. Verifica di aver eseguito lo script SQL in Supabase.\n\n${e.message}`
      );
    } finally {
      setLoading(false);
    }
  }

  async function uploadProfilePhoto(uri, mimeType = 'image/jpeg') {
    if (!token || !session?.user?.id) return;
    setProfilePhotoUploading(true);
    try {
      const localResponse = await fetch(uri);
      const blob = await localResponse.blob();
      const extension = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
      const objectPath = `${session.user.id}/avatar-${Date.now()}.${extension}`;
      const uploadResponse = await fetch(`${URL}/storage/v1/object/profile-photos/${objectPath}`, {
        method: 'POST',
        headers: {
          apikey: KEY,
          Authorization: `Bearer ${token}`,
          'Content-Type': mimeType,
          'x-upsert': 'true',
        },
        body: blob,
      });
      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        throw new Error(errorText || 'Caricamento foto non riuscito');
      }
      setProfilePhotoUrl(`${URL}/storage/v1/object/public/profile-photos/${objectPath}`);
      Alert.alert('Foto caricata', 'Ricordati di premere “Salva profilo” per renderla visibile agli altri soci.');
    } catch (e) {
      Alert.alert('Errore foto', 'Controlla la configurazione dello storage Supabase e riprova. ' + e.message);
    } finally {
      setProfilePhotoUploading(false);
    }
  }

  async function chooseProfilePhoto(source) {
    try {
      let result;
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          Alert.alert('Permesso fotocamera', 'Consenti l’accesso alla fotocamera nelle impostazioni del dispositivo.');
          return;
        }
        result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.85 });
      } else if (source === 'files') {
        result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.85 });
      } else {
        result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.85 });
      }
      if (result.canceled || !result.assets?.[0]?.uri) return;
      const asset = result.assets[0];
      await uploadProfilePhoto(asset.uri, asset.mimeType || 'image/jpeg');
    } catch (e) {
      Alert.alert('Impossibile scegliere la foto', e.message);
    }
  }

  function openProfilePhotoOptions() {
    Alert.alert('Foto profilo', 'Scegli da dove caricare la foto', [
      { text: 'Fotocamera', onPress: () => chooseProfilePhoto('camera') },
      { text: 'Rullino foto', onPress: () => chooseProfilePhoto('library') },
      { text: 'File', onPress: () => chooseProfilePhoto('files') },
      { text: 'Annulla', style: 'cancel' },
    ]);
  }

  async function saveMemberProfile() {
    if (!token || !session?.user?.id) return;
    setProfileSaving(true);
    try {
      await api('/rest/v1/member_profiles?on_conflict=user_id', token, {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({
          user_id: session.user.id,
          email: session.user.email || '',
          first_name: profileFirstName.trim(),
          last_name: profileLastName.trim(),
          avatar_url: profilePhotoUrl.trim() || null,
          updated_at: new Date().toISOString(),
        }),
      });
      profileDirtyRef.current = false;
      await loadProfilesAndPresence();
      Alert.alert('Profilo salvato', 'I dati del profilo sono sincronizzati.');
    } catch (e) {
      Alert.alert('Errore profilo', 'Verifica di aver eseguito lo script SQL in Supabase. ' + e.message);
    } finally {
      setProfileSaving(false);
    }
  }


  async function shareDownloadedIpa() {
    try {
      const uri = downloadedIpa?.uri;
      if (!uri) {
        Alert.alert('Nessuna IPA disponibile', 'Scarica prima l’aggiornamento.');
        return;
      }
      const info = await FileSystem.getInfoAsync(uri);
      if (!info.exists || !info.size || info.size < 100000) {
        setDownloadedIpa(null);
        throw new Error('Il file IPA non è più disponibile o risulta incompleto. Scaricalo di nuovo.');
      }
      await Sharing.shareAsync(uri, {
        mimeType: 'application/octet-stream',
        UTI: 'com.apple.itunes.ipa',
        dialogTitle: 'Condividi la IPA con SideStore',
      });
      // Quando il menu di condivisione viene chiuso, rimuove la IPA temporanea
      // per evitare che resti nei Documenti dell'app e occupi spazio.
      await FileSystem.deleteAsync(uri, { idempotent: true });
      setDownloadedIpa(null);
      Alert.alert('IPA temporanea eliminata', 'Il file IPA condiviso è stato rimosso dalla memoria dell’app.');
    } catch (error) {
      Alert.alert('Condivisione non riuscita', error?.message || 'Impossibile condividere la IPA.');
    }
  }

  async function showStorageDiagnostics() {
    const formatSize = (bytes) => {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    };
    const scanDirectory = async (uri, depth = 0) => {
      if (!uri) return { files: [], total: 0, error: null };
      const files = [];
      let total = 0;
      try {
        const entries = await FileSystem.readDirectoryAsync(uri);
        for (const name of entries) {
          const childUri = uri.endsWith('/') ? uri + name : uri + '/' + name;
          try {
            const info = await FileSystem.getInfoAsync(childUri);
            if (!info.exists) continue;
            if (info.isDirectory) {
              if (depth < 2) {
                const nested = await scanDirectory(childUri, depth + 1);
                total += nested.total;
                files.push(...nested.files);
              } else {
                files.push({ name: childUri, size: 0, kind: 'Cartella (non esplorata)' });
              }
            } else {
              const size = info.size || 0;
              total += size;
              files.push({ name, uri: childUri, size, kind: /\.ipa$/i.test(name) ? 'IPA' : 'File' });
            }
          } catch (_) {}
        }
      } catch (error) {
        return { files, total, error: error?.message || String(error) };
      }
      return { files, total, error: null };
    };
    try {
      const doc = await scanDirectory(FileSystem.documentDirectory);
      const cache = await scanDirectory(FileSystem.cacheDirectory);
      const ipa = [...doc.files, ...cache.files].filter((f) => f.kind === 'IPA');
      const largest = [...doc.files.map((f) => ({ ...f, area: 'Documenti' })), ...cache.files.map((f) => ({ ...f, area: 'Cache' }))]
        .sort((a, b) => b.size - a.size).slice(0, 12);
      const lines = [
        'Documenti: ' + formatSize(doc.total),
        'Cache: ' + formatSize(cache.total),
        'IPA trovate: ' + ipa.length + ' (' + formatSize(ipa.reduce((n, f) => n + f.size, 0)) + ')',
        '',
        'File più grandi (fino a 12):',
        ...(largest.length ? largest.map((f) => '• [' + f.area + '] ' + f.name + ' — ' + formatSize(f.size)) : ['Nessun file accessibile trovato.']),
        '',
        'Nota: iOS può conteggiare anche database, storage interno e dati non esposti da queste cartelle.'
      ];
      Alert.alert('Diagnostica memoria', lines.join('\n').slice(0, 3800), [{ text: 'OK' }]);
    } catch (error) {
      Alert.alert('Diagnostica non disponibile', error?.message || 'Impossibile analizzare la memoria.');
    }
  }

  async function openDownloadedIpaFolder() {
    try {
      const directories = [
        { uri: FileSystem.documentDirectory, label: 'Documenti' },
        { uri: FileSystem.cacheDirectory, label: 'Cache' },
      ].filter((item) => item.uri);
      const ipaFiles = [];
      for (const directory of directories) {
        const names = await FileSystem.readDirectoryAsync(directory.uri);
        for (const name of names.filter((item) => /\.ipa$/i.test(item))) {
          const uri = directory.uri.endsWith('/') ? directory.uri + name : directory.uri + '/' + name;
          const info = await FileSystem.getInfoAsync(uri);
          if (info.exists && !info.isDirectory) {
            ipaFiles.push({ name, uri, size: info.size || 0, area: directory.label });
          }
        }
      }
      if (!ipaFiles.length) {
        Alert.alert('IPA scaricate', 'Non sono stati trovati file IPA né in Documenti né in Cache.');
        return;
      }
      const totalBytes = ipaFiles.reduce((sum, file) => sum + file.size, 0);
      const totalMb = totalBytes / (1024 * 1024);
      const summary = ipaFiles.map((file) => '• [' + file.area + '] ' + file.name + ' (' + (file.size / (1024 * 1024)).toFixed(2) + ' MB)').join('\n');
      Alert.alert(
        'IPA scaricate (' + ipaFiles.length + ')',
        summary + '\n\nSpazio recuperabile: ' + totalMb.toFixed(2) + ' MB',
        [
          { text: 'Annulla', style: 'cancel' },
          {
            text: 'Elimina IPA',
            style: 'destructive',
            onPress: async () => {
              try {
                let removed = 0;
                let freed = 0;
                for (const file of ipaFiles) {
                  await FileSystem.deleteAsync(file.uri, { idempotent: true });
                  removed += 1;
                  freed += file.size;
                }
                setDownloadedIpa((current) => current && ipaFiles.some((file) => file.uri === current.uri) ? null : current);
                Alert.alert('Pulizia completata', 'Eliminate ' + removed + ' IPA. Spazio liberato: circa ' + (freed / (1024 * 1024)).toFixed(2) + ' MB.');
              } catch (error) {
                Alert.alert('Pulizia incompleta', error?.message || 'Non è stato possibile eliminare tutti i file IPA.');
              }
            },
          },
        ]
      );
    } catch (error) {
      Alert.alert('Cartella non disponibile', error?.message || 'Impossibile leggere i file IPA.');
    }
  }

  async function checkForUpdates() {
    if (updateCheckBusy) return;
    setUpdateCheckBusy(true);
    try {
      const response = await fetch(
        'https://raw.githubusercontent.com/Poggix/PokeChiacchere-APP/main/version.json?t=' + Date.now()
      );
      if (!response.ok) throw new Error('Impossibile leggere le informazioni online (HTTP ' + response.status + ').');
      const manifest = await response.json();
      const latest = manifest;
      const installedVersion = String(
        Constants.nativeAppVersion || Constants.expoConfig?.version || '0.0.0'
      );
      const installedBuild = Number(
        Constants.nativeBuildVersion || Constants.expoConfig?.ios?.buildNumber || 0
      );
      const latestVersion = String(latest.version || '');
      const latestBuild = Number(latest.build || 0);
      if (!latestVersion || !Number.isFinite(latestBuild) || latestBuild < 1) {
        throw new Error('Il file version.json non contiene versione e build valide.');
      }

      const versionParts = (value) => value.split('.').map((part) => Number(part) || 0);
      const compareVersions = (a, b) => {
        const aa = versionParts(a);
        const bb = versionParts(b);
        for (let i = 0; i < Math.max(aa.length, bb.length); i += 1) {
          const diff = (aa[i] || 0) - (bb[i] || 0);
          if (diff !== 0) return diff;
        }
        return 0;
      };
      const versionComparison = compareVersions(latestVersion, installedVersion);
      const updateAvailable =
        versionComparison > 0 ||
        (versionComparison === 0 && latestBuild > installedBuild);

      if (updateAvailable) {
        const downloadUrl = String(latest.download_url || '').trim();
        if (!downloadUrl || !/^https:\/\//i.test(downloadUrl)) {
          throw new Error('Il file version.json deve contenere un download_url HTTPS diretto alla IPA.');
        }

        Alert.alert(
          'Aggiornamento disponibile',
          'Installata: v' + installedVersion + ' (build ' + installedBuild + ')\\n' +
            'Disponibile: v' + latestVersion + ' (build ' + latestBuild + ')' +
            (latest.notes ? '\\n\\n' + latest.notes : '') +
            '\\n\\nPremi “Scarica e condividi” per scaricare la IPA e aprire il menu di condivisione iOS. Da lì scegli SideStore, se compare.',
          [
            { text: 'Più tardi', style: 'cancel' },
            {
              text: 'Scarica e condividi',
              onPress: async () => {
                try {
                  const safeVersion = latestVersion.replace(/[^0-9.]/g, '_');
                  // Conserva la IPA nella directory documenti dell'app invece che nella cache,
                  // così il file resta disponibile durante il passaggio al menu di condivisione.
                  const fileName = 'PokeChiacchere-v' + safeVersion + '-build' + latestBuild + '.ipa';
                  const baseDirectory = FileSystem.documentDirectory;
                  if (!baseDirectory) {
                    throw new Error('La cartella documenti temporanea non è disponibile su questo dispositivo.');
                  }
                  // Elimina soltanto le vecchie IPA di aggiornamento da Documenti e Cache.
                  // Non elimina immagini, database o altri dati dell'app.
                  for (const folder of [FileSystem.documentDirectory, FileSystem.cacheDirectory].filter(Boolean)) {
                    const savedFiles = await FileSystem.readDirectoryAsync(folder);
                    for (const savedFile of savedFiles) {
                      if (/^PokeChiacchere-v.*-build.*\.ipa$/i.test(savedFile) && savedFile !== fileName) {
                        const oldUri = folder.endsWith('/') ? folder + savedFile : folder + '/' + savedFile;
                        await FileSystem.deleteAsync(oldUri, { idempotent: true });
                      }
                    }
                  }
                  const fileUri = baseDirectory + fileName;
                  const existing = await FileSystem.getInfoAsync(fileUri);
                  if (existing.exists) {
                    await FileSystem.deleteAsync(fileUri, { idempotent: true });
                  }

                  const downloaded = await FileSystem.downloadAsync(downloadUrl, fileUri);
                  if (downloaded.status < 200 || downloaded.status >= 300) {
                    throw new Error('Download non riuscito (HTTP ' + downloaded.status + ').');
                  }

                  const info = await FileSystem.getInfoAsync(downloaded.uri);
                  if (!info.exists || !info.size || info.size < 100000) {
                    throw new Error('Il file scaricato non esiste o è troppo piccolo per essere una IPA valida.');
                  }

                  // Conserva il file nella sezione Aggiornamenti: la condivisione avviene
                  // solo quando l'utente preme il pulsante dedicato nella schermata Impostazioni.
                  setDownloadedIpa({
                    uri: fileUri,
                    fileName,
                    version: latestVersion,
                    build: latestBuild,
                    size: info.size,
                  });
                  Alert.alert(
                    'IPA scaricata',
                    'File completo salvato nella sezione Aggiornamenti dell’app.\n\nApri Impostazioni → Aggiornamenti e premi “Condividi IPA con SideStore” quando vuoi installarlo.'
                  );
                } catch (error) {
                  Alert.alert(
                    'Download aggiornamento non riuscito',
                    (error?.message || 'Errore durante il download.') +
                      '\n\nNota: download_url deve essere un link diretto al file IPA. Un link a una cartella o pagina di iCloud potrebbe scaricare una pagina web invece dell’app.'
                  );
                }
              },
            },
          ]
        );
      } else if (versionComparison === 0 && latestBuild === installedBuild) {
        Alert.alert(
          'App aggiornata',
          'Hai già la versione più recente: v' + installedVersion + ' (build ' + installedBuild + ').'
        );
      } else {
        Alert.alert(
          'Versione online non aggiornata',
          'Sul dispositivo è installata v' + installedVersion + ' (build ' + installedBuild + '), ma il file online indica v' + latestVersion + ' (build ' + latestBuild + '). Controlla version.json.'
        );
      }
    } catch (error) {
      Alert.alert('Controllo aggiornamenti non riuscito', error?.message || 'Errore di rete.');
    } finally {
      setUpdateCheckBusy(false);
    }
  }

  async function enablePartnerLocationSharing() {
    try {
      // Non interrompere un tracciamento già attivo quando l'app torna in primo piano:
      // stop/start ripetuti possono creare finestre senza aggiornamenti in background.
      const registered = await TaskManager.isTaskRegisteredAsync(PARTNER_LOCATION_TASK);
      const alreadyStarted = registered
        ? await Location.hasStartedLocationUpdatesAsync(PARTNER_LOCATION_TASK).catch(() => false)
        : false;
      const foreground = await Location.requestForegroundPermissionsAsync();
      if (foreground.status !== 'granted') {
        Alert.alert('Permesso posizione necessario', 'Per condividere automaticamente la posizione con l’owner, consenti l’accesso alla posizione nelle impostazioni di iOS.');
        return;
      }
      const background = await Location.requestBackgroundPermissionsAsync();
      if (background.status !== 'granted') {
        Alert.alert('Permesso posizione in background', 'Per aggiornare la posizione anche quando l’app è chiusa, imposta la localizzazione su “Sempre” nelle Impostazioni di iOS.');
        return;
      }
      // Invia prima una posizione usando la sessione effettivamente attiva.
      // In questo modo eventuali errori di RLS/API vengono mostrati subito e non
      // restano nascosti dentro al task in background.
      const storedRaw = await AsyncStorage.getItem('pokechiacchere_session');
      const storedSession = storedRaw ? JSON.parse(storedRaw) : null;
      if (!storedSession?.access_token || !storedSession?.user?.id || storedSession.user.id === OWNER_USER_ID) {
        throw new Error('Sessione del socio non valida per la condivisione della posizione. Accedi con l’account del socio.');
      }
      // Per la posizione condivisa usa alta precisione anche sul primo rilevamento.
      const initialPosition = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const initialResponse = await fetch(URL + '/rest/v1/partner_locations?on_conflict=user_id', {
        method: 'POST',
        headers: { apikey: KEY, Authorization: 'Bearer ' + storedSession.access_token, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ user_id: storedSession.user.id, latitude: initialPosition.coords.latitude, longitude: initialPosition.coords.longitude, accuracy: initialPosition.coords.accuracy, updated_at: new Date(initialPosition.timestamp || Date.now()).toISOString() }),
      });
      if (!initialResponse.ok) {
        const detail = await initialResponse.text().catch(() => '');
        throw new Error('Supabase non ha salvato la posizione (HTTP ' + initialResponse.status + '). ' + (detail || 'Controlla partner_locations e le policy RLS.'));
      }
      // Avvia il tracker nativo Core Location, indipendente dal task JavaScript Expo.
      await PokeLocation.startTracking(
        storedSession.user.id,
        storedSession.access_token,
        storedSession.refresh_token || '',
        Number(storedSession.expires_at || 0)
      );
      // Applica una sola volta le nuove opzioni anche ai task già esistenti;
      // dopo, non interrompere più il tracciamento a ogni ritorno in primo piano.
      const locationConfigApplied = await AsyncStorage.getItem('pokechiacchere_location_config_314');
      const shouldRestart = !alreadyStarted || locationConfigApplied !== 'yes';
      if (shouldRestart) {
        if (await TaskManager.isTaskRegisteredAsync(PARTNER_LOCATION_TASK)) {
          await Location.stopLocationUpdatesAsync(PARTNER_LOCATION_TASK).catch(() => {});
        }
        await Location.startLocationUpdatesAsync(PARTNER_LOCATION_TASK, {
        // GPS più preciso per la mappa condivisa; iOS decide comunque la frequenza effettiva.
        accuracy: Location.Accuracy.High,
        activityType: Location.ActivityType.Fitness,
        distanceInterval: 10,
        timeInterval: 10000,
        pausesUpdatesAutomatically: false,
        // Evita l'indicatore di localizzazione in background quando iOS lo consente.
        // iOS può comunque mostrare indicatori di sistema in alcune condizioni.
        showsBackgroundLocationIndicator: false,
        deferredUpdatesDistance: 0,
        deferredUpdatesInterval: 0,
        });
        await AsyncStorage.setItem('pokechiacchere_location_config_314', 'yes');
      }
    } catch (e) {
      Alert.alert('Impossibile attivare la posizione', e?.message || 'Controlla i permessi iOS.');
    }
  }

  async function disablePartnerLocationSharing() {
    try {
      await PokeLocation.stopTracking().catch(() => {});
      if (await TaskManager.isTaskRegisteredAsync(PARTNER_LOCATION_TASK)) {
        await Location.stopLocationUpdatesAsync(PARTNER_LOCATION_TASK);
      }
      Alert.alert('Condivisione disattivata', 'Il telefono non invierà più nuove posizioni.');
    } catch (e) {
      Alert.alert('Errore', e?.message || 'Non è stato possibile disattivare la condivisione.');
    }
  }

  async function fetchPartnerMapLocation(showErrors = false) {
    try {
      setPartnerMapBusy(true);
      const response = await fetch(URL + '/rest/v1/partner_locations?select=user_id,latitude,longitude,accuracy,updated_at&user_id=neq.' + encodeURIComponent(OWNER_USER_ID) + '&order=updated_at.desc&limit=1', {
        headers: { apikey: KEY, Authorization: 'Bearer ' + token },
      });
      if (!response.ok) throw new Error('Supabase ha restituito HTTP ' + response.status);
      const rows = await response.json();
      if (!rows.length) throw new Error('Non è ancora stata registrata alcuna posizione dal telefono del socio.');
      const p = rows[0];
      const next = {
        latitude: Number(p.latitude),
        longitude: Number(p.longitude),
        accuracy: p.accuracy == null ? null : Number(p.accuracy),
        updated_at: p.updated_at,
      };
      if (!Number.isFinite(next.latitude) || !Number.isFinite(next.longitude)) throw new Error('Le coordinate ricevute non sono valide.');
      setPartnerMapLocation((old) => old && old.updated_at === next.updated_at ? old : next);
      setPartnerMapError('');
      return next;
    } catch (e) {
      setPartnerMapError(e?.message || 'Posizione non disponibile');
      if (showErrors) Alert.alert('Posizione non disponibile', e?.message || 'Controlla la connessione e le policy Supabase.');
      return null;
    } finally {
      setPartnerMapBusy(false);
    }
  }

  async function viewPartnerLocation() {
    setPartnerMapVisible(true);
    await fetchPartnerMapLocation(true);
  }

  useEffect(() => {
    if (!partnerMapVisible || !token || !isOwner) return undefined;
    // Aggiorna la posizione mostrata ogni 5 secondi mentre la mappa è aperta.
    const timer = setInterval(() => { fetchPartnerMapLocation(false); }, 5000);
    return () => clearInterval(timer);
  }, [partnerMapVisible, token, isOwner]);

  function renderSettings() {
    const currentProfile = profiles.find((p) => p.user_id === session?.user?.id);
    return (
      <>
        {header('Impostazioni', 'Profilo personale e controllo delle attività')}
        {isOwner && (
          <View style={s.panel}>
            <Text style={s.panelTitle}>Posizione socio</Text>
            <Text style={s.mutedSmall}>La condivisione viene avviata automaticamente dal telefono del socio dopo aver concesso i permessi di localizzazione a iOS.</Text>
            <Button title="Visualizza posizione socio" type="secondary" onPress={viewPartnerLocation} />
          </View>
        )}
        <View style={s.panel}>
          <Text style={s.panelTitle}>Il mio profilo</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 12 }}>
            {profilePhotoUrl.trim() ? (
              <Image source={{ uri: profilePhotoUrl.trim() }} style={{ width: 68, height: 68, borderRadius: 34, backgroundColor: C.panel2 }} />
            ) : (
              <View style={{ width: 68, height: 68, borderRadius: 34, backgroundColor: C.panel2, borderWidth: 1, borderColor: C.green, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: C.green, fontSize: 25, fontWeight: '900' }}>{(profileFirstName[0] || session?.user?.email?.[0] || '?').toUpperCase()}</Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={s.mutedSmall}>La foto viene mostrata agli altri soci tramite un link immagine.</Text>
            </View>
          </View>
          <Field label="Nome" value={profileFirstName} onChangeText={(value) => { profileDirtyRef.current = true; setProfileFirstName(value); }} placeholder="Il tuo nome" />
          <Field label="Cognome" value={profileLastName} onChangeText={(value) => { profileDirtyRef.current = true; setProfileLastName(value); }} placeholder="Il tuo cognome" />
          <Text style={{ color: C.muted, fontSize: 12, fontWeight: '800', marginBottom: 8 }}>Foto profilo</Text>
          <Button title={profilePhotoUploading ? 'Caricamento foto...' : 'Scegli foto da File, Rullino o Fotocamera'} type="secondary" onPress={openProfilePhotoOptions} />
          {profilePhotoUrl ? <Text style={s.mutedSmall}>Foto selezionata. Premi “Salva profilo” per sincronizzarla.</Text> : <Text style={s.mutedSmall}>Puoi scegliere un'immagine dai file, dal rullino oppure scattarne una nuova.</Text>}
          <Button title={profileSaving ? 'Salvataggio...' : 'Salva profilo'} onPress={saveMemberProfile} />
        </View>
        <View style={s.panel}>
          <Text style={s.panelTitle}>Attività soci</Text>
          <Text style={s.mutedSmall}>Presenza aggiornata automaticamente quando l'app è aperta. Ultimo accesso mostrato per ogni account.</Text>
          <Button title={presenceLoading ? 'Aggiornamento...' : 'Aggiorna attività soci'} type="secondary" onPress={loadProfilesAndPresence} />
          {profiles.map((p) => {
            const isMe = p.user_id === session?.user?.id;
            const presence = p.presence;
            const active = !!presence?.is_active && presence.last_seen_at && (Date.now() - new Date(presence.last_seen_at).getTime() < 2 * 60 * 1000);
            const displayName = [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email || 'Socio';
            return (
              <View key={p.user_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border }}>
                {p.avatar_url ? <Image source={{ uri: p.avatar_url }} style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: C.panel2 }} /> : <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: C.panel2, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: C.green, fontWeight: '900' }}>{displayName[0]?.toUpperCase() || '?'}</Text></View>}
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: 7 }}>
                    <Text style={s.panelTitle}>{displayName}{isMe ? ' (tu)' : ''}</Text>
                    {!!presence?.app_version && <Text style={{ color: C.muted, fontSize: 11, fontWeight: '700' }}>v{presence.app_version}</Text>}
                  </View>
                  <Text style={s.mutedSmall}>{active ? '● Attivo ora' : presence?.last_seen_at ? 'Ultimo accesso: ' + new Date(presence.last_seen_at).toLocaleString('it-IT') : 'Nessun accesso registrato'}</Text>
                </View>
                <View
                  accessibilityLabel={active ? 'Socio attivo' : 'Socio non attivo'}
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: 5,
                    backgroundColor: active ? C.green : C.red,
                  }}
                />
              </View>
            );
          })}
          {!profiles.length && <Text style={s.mutedSmall}>Nessun profilo trovato. Ogni socio deve salvare il profilo una prima volta.</Text>}
        </View>
        <View style={s.panel}>
          <Text style={s.panelTitle}>Log</Text>
          <Text style={s.mutedSmall}>Consulta chi ha creato, modificato o eliminato registrazioni, con data, ora e confronto dettagliato dei campi.</Text>
          <Button title="Apri registro attività" onPress={openActivityLog} />
        </View>
        <View style={s.panel}>
          <Text style={s.panelTitle}>Account attivo</Text>
          <Text style={s.activityActor}>{session?.user?.email || 'Email non disponibile'}</Text>
          <Text style={s.mutedSmall}>Tieni più account collegati sul dispositivo e passa dall'uno all'altro senza uscire ogni volta.</Text>
          {savedAccounts.map((account) => (
            <View key={account.user.id} style={{ backgroundColor: C.panel2, borderRadius: 12, padding: 12, marginTop: 10 }}>
              <Text style={{ color: C.white, fontWeight: '800', fontSize: 13 }}>{account.user.email || 'Account senza email'}</Text>
              <Text style={s.mutedSmall}>{account.user.id === session?.user?.id ? 'Account attualmente attivo' : 'Account salvato'}</Text>
              {account.user.id !== session?.user?.id && <Button title="Passa a questo account" type="secondary" onPress={() => switchSavedAccount(account)} />}
              {account.user.id !== session?.user?.id && <Button title="Rimuovi account salvato" type="danger" onPress={() => Alert.alert('Rimuovere account?', 'Verrà rimosso da questo dispositivo, senza eliminare l’account Supabase.', [{ text: 'Annulla', style: 'cancel' }, { text: 'Rimuovi', style: 'destructive', onPress: () => removeSavedAccount(account) }])} />}
            </View>
          ))}
          <TouchableOpacity
            onPress={() => { setEmail(''); setPassword(''); setShowAccountLogin(true); }}
            style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 11, borderWidth: 1, borderColor: C.cyan, backgroundColor: C.panel2 }}>
            <Text style={{ color: C.cyan, fontSize: 20, fontWeight: '900' }}>＋</Text>
            <Text style={{ color: C.cyan, fontSize: 13, fontWeight: '900' }}>Aggiungi account</Text>
          </TouchableOpacity>
        </View>
        <View style={s.panel}>
          <Text style={s.panelTitle}>Aggiornamenti app</Text>
          <Text style={s.mutedSmall}>Versione installata: v{Constants.nativeAppVersion || Constants.expoConfig?.version || '—'} · build {Constants.nativeBuildVersion || Constants.expoConfig?.ios?.buildNumber || '—'}. Il controllo confronta sia la versione sia il numero di build; non viene eseguito in automatico.</Text>
          <Button title={updateCheckBusy ? 'Controllo in corso…' : 'Controlla aggiornamenti'} type="secondary" onPress={checkForUpdates} />
          <Button title="Apri cartella IPA scaricate" type="secondary" onPress={openDownloadedIpaFolder} />
          <Button title="Diagnostica memoria app" type="secondary" onPress={showStorageDiagnostics} />
          {downloadedIpa ? (
            <View style={{ backgroundColor: C.panel2, borderRadius: 12, padding: 13, marginTop: 12 }}>
              <Text style={{ color: C.green, fontSize: 13, fontWeight: '900' }}>IPA pronta per la condivisione</Text>
              <Text style={s.mutedSmall}>{downloadedIpa.fileName}</Text>
              <Text style={s.mutedSmall}>Versione {downloadedIpa.version} · build {downloadedIpa.build} · {(downloadedIpa.size / (1024 * 1024)).toFixed(1)} MB</Text>
              <Button title="Condividi IPA con SideStore" onPress={shareDownloadedIpa} />
              <Button title="Elimina IPA scaricata" type="danger" onPress={async () => {
                try {
                  await FileSystem.deleteAsync(downloadedIpa.uri, { idempotent: true });
                } catch (_) {}
                setDownloadedIpa(null);
                Alert.alert('IPA eliminata', 'Il file scaricato è stato rimosso dal dispositivo.');
              }} />
            </View>
          ) : (
            <Text style={s.mutedSmall}>Dopo il download, il file IPA comparirà qui. Potrai condividerlo con SideStore quando vuoi.</Text>
          )}
        </View>
      </>
    );
  }

  function renderActivityLog() {
    const normalizedSearch = activitySearch.trim().toLowerCase();
    const filtered = activityLogs.filter((item) => {
      const actor = item.actor_email || item.actor_id || '';
      const tableLabel =
        activityTableLabels[item.table_name] || item.table_name || '';
      const searchable = [
        actor,
        tableLabel,
        item.action,
        item.record_id,
        activityPreview(item),
        JSON.stringify(item.old_data || {}),
        JSON.stringify(item.new_data || {}),
      ]
        .join(' ')
        .toLowerCase();
      return (
        (!normalizedSearch || searchable.includes(normalizedSearch)) &&
        (activityActionFilter === 'ALL' ||
          item.action === activityActionFilter) &&
        (activityTableFilter === 'ALL' ||
          item.table_name === activityTableFilter)
      );
    });
    return (
      <>
        {header(
          'Log',
          'Anteprime compatte · Tocca un evento per i dettagli'
        )}
        <Button
          title="← Impostazioni"
          type="secondary"
          onPress={() => setPage('settings')}
        />
        <View style={s.panel}>
          <Field
            label="Cerca utente, record o modifica"
            value={activitySearch}
            onChangeText={setActivitySearch}
            placeholder="Email, prodotto, importo…"
          />
          <Text style={s.label}>Tipo di operazione</Text>
          <View style={s.filterWrap}>
            {[
              ['ALL', 'Tutte'],
              ['INSERT', 'Creazioni'],
              ['UPDATE', 'Modifiche'],
              ['DELETE', 'Eliminazioni'],
            ].map(([value, label]) => (
              <TouchableOpacity
                key={value}
                style={[s.chip, activityActionFilter === value && s.chipActive]}
                onPress={() => setActivityActionFilter(value)}>
                <Text
                  style={[
                    s.chipText,
                    activityActionFilter === value && s.chipTextActive,
                  ]}>
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={[s.label, { marginTop: 12 }]}>Sezione</Text>
          <View style={s.filterWrap}>
            {[
              ['ALL', 'Tutte'],
              ['sales', 'Vendite'],
              ['purchases', 'Acquisti'],
              ['internal_payments', 'Pagamenti soci'],
              ['withdrawals', 'Prelievi'],
              ['products', 'Prodotti'],
              ['customers', 'Clienti'],
            ].map(([value, label]) => (
              <TouchableOpacity
                key={value}
                style={[s.chip, activityTableFilter === value && s.chipActive]}
                onPress={() => setActivityTableFilter(value)}>
                <Text
                  style={[
                    s.chipText,
                    activityTableFilter === value && s.chipTextActive,
                  ]}>
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={s.mutedSmall}>
            {filtered.length} eventi visualizzati · massimo 500 più recenti
          </Text>
        </View>
        {filtered.map((item, index) => (
          <TouchableOpacity
            key={String(item.id || `${item.created_at}-${index}`)}
            style={s.activityCard}
            activeOpacity={0.78}
            onPress={() => {
              setSelectedActivity(item);
              setPage('activityDetail');
            }}>
            <View style={s.activityIcon}>
              <Text style={s.activityIconText}>
                {item.action === 'DELETE'
                  ? '−'
                  : item.action === 'INSERT'
                  ? '+'
                  : '↻'}
              </Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.recordTitle}>
                {activityActionLabel(item.action)} ·{' '}
                {activityTableLabels[item.table_name] || item.table_name}
              </Text>
              <Text style={s.recordSub}>
                {activityDate(item.created_at)} ·{' '}
                {item.actor_email || item.actor_id || 'Utente sconosciuto'}
              </Text>
              <Text style={s.activityPreview} numberOfLines={2}>
                {activityPreview(item)}
              </Text>
            </View>
            <Text style={s.activityChevron}>›</Text>
          </TouchableOpacity>
        ))}
        {!filtered.length && (
          <Text style={s.empty}>
            {activityLogs.length
              ? 'Nessun evento corrisponde ai filtri.'
              : 'Il registro è vuoto. Gli eventi compariranno dopo l’attivazione del registro nel database.'}
          </Text>
        )}
      </>
    );
  }

  function renderActivityDetail() {
    const item = selectedActivity;
    if (!item)
      return (
        <>
          <Button
            title="← Log"
            type="secondary"
            onPress={() => setPage('activityLog')}
          />
        </>
      );
    const changes = activityChanges(item);
    return (
      <>
        {header(
          'Dettaglio attività',
          `${activityActionLabel(item.action)} · ${
            activityTableLabels[item.table_name] || item.table_name
          }`
        )}
        <Button
          title="← Torna al registro"
          type="secondary"
          onPress={() => setPage('activityLog')}
        />
        <View style={s.panel}>
          <Text style={s.sectionTitle}>INFORMAZIONI GENERALI</Text>
          <Text style={s.detailLabel}>Utente</Text>
          <Text style={s.detailValue}>
            {item.actor_email || item.actor_id || 'Utente sconosciuto'}
          </Text>
          <Text style={s.detailLabel}>Data e ora</Text>
          <Text style={s.detailValue}>{activityDate(item.created_at)}</Text>
          <Text style={s.detailLabel}>Operazione</Text>
          <Text style={s.detailValue}>{activityActionLabel(item.action)}</Text>
          <Text style={s.detailLabel}>Sezione</Text>
          <Text style={s.detailValue}>
            {activityTableLabels[item.table_name] || item.table_name}
          </Text>
          <Text style={s.detailLabel}>ID record</Text>
          <Text style={s.detailValue}>
            {item.record_id || 'Non disponibile'}
          </Text>
          <Text style={s.detailLabel}>ID evento</Text>
          <Text style={s.detailValue}>{item.id || '—'}</Text>
        </View>
        <View style={s.panel}>
          <Text style={s.sectionTitle}>
            {item.action === 'INSERT'
              ? 'DATI REGISTRATI'
              : item.action === 'DELETE'
              ? 'DATI PRIMA DELL’ELIMINAZIONE'
              : 'CAMPI MODIFICATI'}
          </Text>
          {!changes.length && (
            <Text style={s.empty}>
              Non sono disponibili dettagli dei campi per questo evento.
            </Text>
          )}
          {changes.map((change, index) => (
            <View key={`${change.key}-${index}`} style={s.changeRow}>
              <Text style={s.detailLabel}>{change.label}</Text>
              {item.action === 'UPDATE' ? (
                <View style={s.changeValues}>
                  <View style={s.oldValueBox}>
                    <Text style={s.oldValueText}>
                      {displayActivityValue(change.before)}
                    </Text>
                  </View>
                  <Text style={s.changeArrow}>→</Text>
                  <View style={s.newValueBox}>
                    <Text style={s.newValueText}>
                      {displayActivityValue(change.after)}
                    </Text>
                  </View>
                </View>
              ) : (
                <Text style={s.detailValue}>
                  {displayActivityValue(
                    item.action === 'DELETE' ? change.before : change.after
                  )}
                </Text>
              )}
            </View>
          ))}
        </View>
        <View style={s.panel}>
          <Text style={s.sectionTitle}>DATI COMPLETI DEL RECORD</Text>
          <Text style={s.detailLabel}>Valori precedenti</Text>
          <Text selectable style={s.jsonText}>
            {item.old_data ? JSON.stringify(item.old_data, null, 2) : '—'}
          </Text>
          <Text style={s.detailLabel}>Valori successivi</Text>
          <Text selectable style={s.jsonText}>
            {item.new_data ? JSON.stringify(item.new_data, null, 2) : '—'}
          </Text>
        </View>
      </>
    );
  }

  function navItem(title, icon, target, accentColor = C.cyan) {
    const active =
      page === target ||
      (target === 'payments' && page === 'paymentForm') ||
      (target === 'products' && page === 'customers');

    return (
      <TouchableOpacity
        key={target}
        style={s.navItem}
        onPress={() => setPage(target)}>
        <Text style={[s.navIcon, active && { color: accentColor }]}>{icon}</Text>
        <Text style={[s.navLabel, active && { color: accentColor }]}>{title}</Text>
      </TouchableOpacity>
    );
  }

  if (!sessionReady) {
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View style={s.login}>
          <ActivityIndicator color={C.cyan} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (!session || showAccountLogin) {
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View style={s.login}>
          <Text style={s.brand}>
            POKE<Text style={{ color: C.red }}>CHIACCHIERE</Text>
          </Text>
          <Text style={s.pageTitle}>Bentornato.</Text>
          <Text style={s.subtitle}>{showAccountLogin ? 'Aggiungi un account senza disconnettere quello attuale' : 'Gestionale condiviso'}</Text>
          <View style={s.panel}>
            <Field
              label="Email Supabase"
              value={email}
              onChangeText={setEmail}
            />
            <Field
              label="Password"
              value={password}
              onChangeText={setPassword}
            />
            <Button
              title={loading ? 'Accesso in corso…' : showAccountLogin ? 'Aggiungi e accedi' : 'Accedi'}
              onPress={signIn}
            />
            {showAccountLogin && <Button title="Annulla e torna alle impostazioni" type="secondary" onPress={() => { setShowAccountLogin(false); setEmail(''); setPassword(''); }} />}
          </View>
          {loading && <ActivityIndicator color={C.cyan} />}
        </View>
      </SafeAreaView>
    );
  }

  let content;
  if (page === 'home') content = renderHome();
  else if (page === 'inventory') content = renderInventory();
  else if (page === 'notifications' && isOwner) content = renderNotifications();
  else if (page === 'saleForm') content = renderSaleForm();
  else if (page === 'purchaseForm') content = renderPurchaseForm();
  else if (page === 'paymentForm') content = renderPaymentForm();
  else if (page === 'withdrawalForm') content = renderWithdrawalForm();
  else if (page === 'products' || page === 'customers')
    content = renderCatalog(page);
  else if (page === 'customerDetail') content = renderCustomerDetail();
  else if (
    ['sales', 'purchases', 'internal_payments', 'withdrawals'].includes(page)
  )
    content = renderList(page);
  else if (page === 'payments') content = renderList('internal_payments');
  else if (page === 'settings') content = renderSettings();
  else if (page === 'activityLog') content = renderActivityLog();
  else if (page === 'activityDetail') content = renderActivityDetail();
  else content = renderHome();

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      <View style={s.topBar}>
        <View>
          <Text style={s.brand}>
            POKE<Text style={{ color: C.red }}>CHIACCHIERE</Text>
          </Text>
          <Text style={s.topCaption}>GESTIONALE · LIVE</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TouchableOpacity
            style={s.refresh}
            onPress={() => setPage('settings')}>
            <Text style={s.refreshText}>⚙</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.refresh} onPress={loadData}>
            <Text style={s.refreshText}>↻</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.refresh, { width: 62 }]}
            onPress={signOut}>
            <Text style={[s.buttonText, { color: C.red }]}>Esci</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={s.main}
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled">
        {content}
        {loading && <ActivityIndicator color={C.cyan} style={{ margin: 16 }} />}
      </ScrollView>

      <View style={s.nav}>
        {navItem('Home', '⌂', 'home')}
        {navItem('Vendite', '↗', 'sales')}
        {navItem('Acquisti', '▤', 'purchases')}
        {navItem('Soci', '⇄', 'payments')}
        {navItem('Archivio', '▦', 'products')}
        {navItem('Magazzino', '●', 'inventory', C.green)}
      </View>

      {pickerModal()}
      <Modal visible={partnerMapVisible} animationType="slide" onRequestClose={() => setPartnerMapVisible(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
          <View style={[s.topBar, { justifyContent: 'space-between' }]}>
            <View>
              <Text style={s.brand}>POSIZIONE SOCIO</Text>
              <Text style={s.topCaption}>AGGIORNAMENTO AUTOMATICO</Text>
            </View>
            <TouchableOpacity style={s.refresh} onPress={() => fetchPartnerMapLocation(true)}>
              <Text style={s.refreshText}>↻</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.refresh, { width: 62 }]} onPress={() => setPartnerMapVisible(false)}>
              <Text style={[s.buttonText, { color: C.red }]}>Chiudi</Text>
            </TouchableOpacity>
          </View>
          {partnerMapLocation ? (
            <>
              <MapView
                style={{ flex: 1 }}
                initialRegion={{ latitude: partnerMapLocation.latitude, longitude: partnerMapLocation.longitude, latitudeDelta: 0.012, longitudeDelta: 0.012 }}
                region={{ latitude: partnerMapLocation.latitude, longitude: partnerMapLocation.longitude, latitudeDelta: 0.012, longitudeDelta: 0.012 }}
                showsUserLocation={false}
                showsCompass
                showsScale
              >
                <Marker coordinate={{ latitude: partnerMapLocation.latitude, longitude: partnerMapLocation.longitude }} title="Socio" description={'Ultimo aggiornamento: ' + new Date(partnerMapLocation.updated_at).toLocaleTimeString('it-IT')} />
                {partnerMapLocation.accuracy != null && <Circle center={{ latitude: partnerMapLocation.latitude, longitude: partnerMapLocation.longitude }} radius={Math.max(5, partnerMapLocation.accuracy)} strokeColor="rgba(22,139,255,0.8)" fillColor="rgba(22,139,255,0.18)" />}
              </MapView>
              <View style={{ padding: 16, backgroundColor: C.panel, borderTopWidth: 1, borderTopColor: C.border, gap: 6 }}>
                <Text style={s.panelTitle}>{Date.now() - new Date(partnerMapLocation.updated_at).getTime() <= 120000 ? '● Posizione recente' : '○ Ultima posizione salvata'}</Text>
                <Text style={s.mutedSmall}>Ultimo dato: {new Date(partnerMapLocation.updated_at).toLocaleString('it-IT')} · Precisione: {partnerMapLocation.accuracy == null ? 'n/d' : Math.round(partnerMapLocation.accuracy) + ' m'}</Text>
                <Text style={s.mutedSmall}>La mappa controlla nuovi dati ogni 5 secondi. La frequenza effettiva dipende dagli aggiornamenti GPS e dalle limitazioni di iOS.</Text>
                {partnerMapBusy && <ActivityIndicator color={C.cyan} />}
                {!!partnerMapError && <Text style={{ color: C.yellow }}>{partnerMapError}</Text>}
              </View>
            </>
          ) : (
            <View style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 12 }}>
              <ActivityIndicator color={C.cyan} size="large" />
              <Text style={s.panelTitle}>Recupero posizione…</Text>
              <Text style={s.mutedSmall}>{partnerMapError || 'In attesa della prima posizione registrata dal telefono del socio.'}</Text>
              <Button title="Riprova" onPress={() => fetchPartnerMapLocation(true)} />
            </View>
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  main: { flex: 1 },
  content: { padding: 17, paddingBottom: 30 },
  topBar: {
    paddingHorizontal: 18,
    paddingVertical: 16,
    backgroundColor: C.panel,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  brand: {
    fontSize: 17,
    fontWeight: '900',
    letterSpacing: 1.1,
    color: C.white,
  },
  topCaption: { fontSize: 10, color: C.muted, letterSpacing: 2, marginTop: 5 },
  refresh: {
    width: 46,
    height: 46,
    borderRadius: 15,
    backgroundColor: C.panel2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshText: { fontSize: 27, color: C.cyan },
  pageHeader: {
    marginBottom: 20,
    borderLeftWidth: 4,
    paddingLeft: 13,
    paddingVertical: 4,
    borderRadius: 3,
  },
  headerIdentity: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  headerIconBox: {
    width: 45,
    height: 45,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerIconText: { fontSize: 23, fontWeight: '900' },
  customerHero: {
    backgroundColor: C.panel,
    borderWidth: 1,
    borderRadius: 22,
    padding: 18,
    alignItems: 'center',
    marginBottom: 14,
  },
  customerAvatar: {
    width: 66,
    height: 66,
    borderRadius: 23,
    backgroundColor: '#2A2140',
    borderWidth: 1,
    borderColor: '#C39BFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 11,
  },
  customerAvatarText: { color: '#DCC7FF', fontSize: 23, fontWeight: '900' },
  customerName: {
    color: C.white,
    fontSize: 22,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 5,
  },
  customerStats: { flexDirection: 'row', gap: 8, marginTop: 17, width: '100%' },
  customerStat: {
    flex: 1,
    minWidth: 0,
    backgroundColor: C.panel2,
    borderRadius: 12,
    padding: 10,
  },
  customerStatLabel: {
    color: C.muted,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  customerStatValue: {
    color: C.white,
    fontSize: 13,
    fontWeight: '900',
    marginTop: 8,
  },
  eyebrow: {
    fontSize: 10,
    letterSpacing: 2,
    color: C.cyan,
    fontWeight: '900',
    marginBottom: 8,
  },
  pageTitle: { fontSize: 29, fontWeight: '900', color: C.white },
  subtitle: { fontSize: 14, color: C.muted, marginTop: 7 },
  hero: {
    backgroundColor: C.panel,
    borderWidth: 1,
    borderColor: '#315783',
    borderRadius: 22,
    padding: 22,
    marginBottom: 15,
  },
  heroLabel: {
    color: C.cyan,
    fontWeight: '900',
    letterSpacing: 3,
    fontSize: 11,
  },
  heroValue: { color: C.white, fontWeight: '900', fontSize: 36, marginTop: 12 },
  separator: { height: 1, backgroundColor: C.border, marginVertical: 19 },
  heroRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  mutedText: { color: C.muted, fontSize: 12 },
  profitValue: { color: C.green, fontWeight: '900', fontSize: 17 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  metric: {
    width: '48%',
    minHeight: 118,
    backgroundColor: C.panel,
    borderRadius: 17,
    padding: 14,
    marginBottom: 11,
    borderWidth: 1,
    borderColor: C.border,
  },
  metricLine: { height: 4, width: 34, borderRadius: 4, marginBottom: 14 },
  metricLabel: { color: C.muted, fontSize: 12, lineHeight: 18 },
  metricValue: {
    color: C.white,
    fontSize: 17,
    fontWeight: '900',
    marginTop: 8,
  },
  mutedSmall: { color: C.muted, fontSize: 11, lineHeight: 17, marginTop: 9 },
  sectionTitle: {
    color: C.cyan,
    fontWeight: '900',
    fontSize: 12,
    letterSpacing: 1.5,
    marginTop: 20,
    marginBottom: 12,
  },
  panel: {
    backgroundColor: C.panel,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 13,
  },
  panelTitle: { color: C.muted, fontSize: 13, fontWeight: '700' },
  panelValue: { color: C.white, fontSize: 25, fontWeight: '900', marginTop: 8 },
  twoColumns: { flexDirection: 'row', gap: 10, marginTop: 14 },
  miniBox: {
    flex: 1,
    backgroundColor: C.panel2,
    padding: 13,
    borderRadius: 13,
    minWidth: 0,
  },
  miniValue: { color: C.white, fontWeight: '900', fontSize: 15, marginTop: 8 },
  partnerName: {
    color: C.cyan,
    fontWeight: '900',
    letterSpacing: 2,
    fontSize: 11,
  },
  balanceValue: {
    color: C.white,
    fontSize: 18,
    fontWeight: '900',
    marginTop: 9,
  },
  actionGrid: { gap: 4, marginBottom: 12 },
  button: {
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: C.blue,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  buttonSecondary: {
    backgroundColor: C.panel2,
    borderWidth: 1,
    borderColor: '#405674',
  },
  buttonDanger: {
    backgroundColor: '#462131',
    borderWidth: 1,
    borderColor: C.red,
  },
  buttonSuccess: {
    backgroundColor: '#123D37',
    borderWidth: 1,
    borderColor: C.green,
  },
  buttonText: {
    color: C.white,
    fontSize: 13,
    fontWeight: '900',
    textAlign: 'center',
  },
  field: { marginBottom: 13 },
  label: { color: C.muted, fontSize: 12, fontWeight: '800', marginBottom: 7 },
  input: {
    backgroundColor: C.bg,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 13,
    paddingVertical: 13,
    color: C.white,
    fontSize: 15,
  },
  dropdown: {
    backgroundColor: C.bg,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 13,
    paddingVertical: 15,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dropdownText: { color: C.white, fontSize: 14 },
  chevron: { color: C.cyan, fontSize: 22, fontWeight: '900' },
  summary: {
    backgroundColor: C.panel2,
    borderRadius: 12,
    padding: 14,
    marginTop: 8,
  },
  summaryLine: {
    color: C.white,
    fontSize: 13,
    fontWeight: '700',
    marginVertical: 4,
  },
  record: {
    backgroundColor: C.panel,
    borderRadius: 15,
    padding: 13,
    marginTop: 10,
    borderWidth: 1,
    borderColor: C.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  recordTitle: { color: C.white, fontWeight: '900', fontSize: 13 },
  recordSub: { color: C.muted, fontSize: 10, marginTop: 5 },
  recordAmount: {
    color: C.green,
    fontWeight: '900',
    fontSize: 15,
    marginTop: 7,
  },
  activityCard: {
    backgroundColor: C.panel,
    borderRadius: 15,
    padding: 13,
    marginTop: 9,
    borderWidth: 1,
    borderColor: C.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  activityIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: C.panel2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activityIconText: { color: C.cyan, fontSize: 22, fontWeight: '900' },
  activityChevron: {
    color: C.cyan,
    fontSize: 27,
    fontWeight: '700',
    paddingLeft: 2,
  },
  activityPreview: {
    color: C.white,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 6,
  },
  activityActor: {
    color: C.cyan,
    fontSize: 14,
    fontWeight: '800',
    marginTop: 10,
  },
  detailLabel: {
    color: C.muted,
    fontSize: 11,
    fontWeight: '800',
    marginTop: 12,
    marginBottom: 4,
  },
  detailValue: { color: C.white, fontSize: 13, lineHeight: 19 },
  changeRow: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  changeValues: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 7,
    marginTop: 5,
  },
  oldValueBox: {
    flex: 1,
    backgroundColor: '#38212B',
    borderRadius: 9,
    padding: 9,
    minWidth: 0,
  },
  newValueBox: {
    flex: 1,
    backgroundColor: '#123D37',
    borderRadius: 9,
    padding: 9,
    minWidth: 0,
  },
  oldValueText: { color: '#FFB7C3', fontSize: 12 },
  newValueText: { color: C.green, fontSize: 12, fontWeight: '800' },
  changeArrow: { color: C.cyan, alignSelf: 'center', fontSize: 15 },
  jsonText: {
    color: C.muted,
    backgroundColor: C.bg,
    borderRadius: 9,
    padding: 10,
    fontSize: 10,
    lineHeight: 15,
    marginTop: 5,
  },
  empty: { color: C.muted, textAlign: 'center', padding: 20 },
  nav: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: C.panel,
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingTop: 10,
    paddingBottom: 8,
  },
  navItem: { alignItems: 'center', flex: 1, paddingVertical: 3 },
  navIcon: { fontSize: 22, color: C.muted, fontWeight: '800' },
  navLabel: { fontSize: 10, color: C.muted, marginTop: 5, fontWeight: '800' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: '#000C',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: C.panel,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 30,
    borderWidth: 1,
    borderColor: C.border,
  },
  modalTitle: {
    color: C.white,
    fontSize: 21,
    fontWeight: '900',
    marginBottom: 15,
  },
  optionRow: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  optionText: { color: C.white, fontSize: 14 },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginBottom: 6,
  },
  filterWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: {
    borderRadius: 10,
    paddingHorizontal: 11,
    paddingVertical: 9,
    backgroundColor: C.panel2,
    borderWidth: 1,
    borderColor: C.border,
  },
  chipActive: { backgroundColor: '#123D5D', borderColor: C.cyan },
  chipText: { color: C.muted, fontSize: 11, fontWeight: '800' },
  chipTextActive: { color: C.white },
  login: { flex: 1, justifyContent: 'center', padding: 22 },
});
