import React, { useCallback, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import {
  ActivityIndicator,
  Alert,
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

const URL = 'https://omovacbvfhmtjqrrgszx.supabase.co';
const KEY = 'sb_publishable_riYV0ro2BZo3umMa71mPGQ_mUPm4MA9';
const NOTIFICATION_FUNCTION_URL = `${URL}/functions/v1/rapid-processor`;
// Sostituisci questo valore con l'UUID del tuo utente in Supabase > Authentication > Users.
const OWNER_USER_ID = '01bf546e-bf28-46ac-8370-b4fe30d8a8fd';
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

function Card({ title, value, color = C.cyan, subtitle }) {
  return (
    <View style={s.metric}>
      <View style={[s.metricLine, { backgroundColor: color }]} />
      <Text style={s.metricLabel}>{title}</Text>
      <Text style={s.metricValue}>{money(value)}</Text>
      {!!subtitle && <Text style={s.mutedSmall}>{subtitle}</Text>}
    </View>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [listSearch, setListSearch] = useState('');
  const [sortMode, setSortMode] = useState('date_desc');
  const [listView, setListView] = useState('details');
  const [namePosition, setNamePosition] = useState('center');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState('home');
  const [notificationTitle, setNotificationTitle] = useState('PokeChiacchere');
  const [notificationMessage, setNotificationMessage] = useState('');
  const [notificationBusy, setNotificationBusy] = useState(false);
  const [form, setForm] = useState({});
  const [editing, setEditing] = useState(null);
  const [picker, setPicker] = useState(null);
  const [search, setSearch] = useState('');
  const [activityLogs, setActivityLogs] = useState([]);
  const [selectedActivity, setSelectedActivity] = useState(null);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [activitySearch, setActivitySearch] = useState('');
  const [activityActionFilter, setActivityActionFilter] = useState('ALL');
  const [activityTableFilter, setActivityTableFilter] = useState('ALL');

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
  const change = (key, value) => setForm((old) => ({ ...old, [key]: value }));

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
            await AsyncStorage.setItem(
              'pokechiacchere_session',
              JSON.stringify(renewed)
            );
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

  async function sendPartnerNotification() {
    const title = notificationTitle.trim();
    const message = notificationMessage.trim();
    if (!isOwner) {
      Alert.alert(
        'Accesso non autorizzato',
        'Solo il proprietario configurato può inviare notifiche.'
      );
      return;
    }
    if (!title || !message) {
      Alert.alert('Notifica', 'Inserisci un titolo e un messaggio.');
      return;
    }
    setNotificationBusy(true);
    try {
      const response = await fetch(NOTIFICATION_FUNCTION_URL, {
        method: 'POST',
        headers: {
          apikey: KEY,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title, body: message, recipient: 'all' }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          payload.error || payload.message || `Errore HTTP ${response.status}`
        );
      // Una risposta HTTP 2xx dalla Edge Function non dimostra, da sola,
      // che Expo/APNs abbia accettato o consegnato la notifica.
      const tickets = Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload?.tickets)
          ? payload.tickets
          : Array.isArray(payload?.results)
            ? payload.results
            : [];
      const ticketErrors = tickets
        .filter((ticket) => ticket?.status === 'error' || ticket?.details?.error)
        .map((ticket) => {
          const code = ticket?.details?.error || ticket?.message || 'Errore push';
          return String(code);
        });
      const serverErrors = Array.isArray(payload?.errors)
        ? payload.errors.map((item) =>
            typeof item === 'string' ? item : item?.message || item?.error || JSON.stringify(item)
          )
        : [];
      const errors = [...ticketErrors, ...serverErrors];
      const acceptedCount =
        typeof payload?.sent === 'number'
          ? payload.sent
          : typeof payload?.accepted === 'number'
            ? payload.accepted
            : tickets.filter((ticket) => ticket?.status === 'ok').length;

      if (errors.length > 0) {
        Alert.alert(
          'Problemi nell’invio push',
          errors.slice(0, 4).join('\\n') +
            (errors.length > 4 ? '\\n…' : '') +
            '\\n\\nSe compare DeviceNotRegistered, il token salvato non è più valido. Se il server non riporta errori, va verificato anche l’entitlement aps-environment della firma iOS.'
        );
      } else if (tickets.length > 0 || typeof payload?.sent === 'number' || typeof payload?.accepted === 'number') {
        Alert.alert(
          'Richiesta elaborata',
          `Expo ha accettato ${acceptedCount} ticket secondo la risposta del server. Questo non conferma la consegna al dispositivo: bisogna controllare le ricevute Expo e la firma APNs dell’app.`
        );
      } else {
        Alert.alert(
          'Richiesta ricevuta dal server',
          'La Edge Function ha risposto correttamente, ma non ha restituito i ticket Expo né le ricevute di consegna. Non è possibile confermare che la notifica sia stata accettata da Expo o consegnata. Controlla la risposta della funzione rapid-processor e l’entitlement aps-environment della build iOS.'
        );
      }
      setNotificationMessage('');
    } catch (e) {
      Alert.alert(
        'Invio non riuscito',
        `${e.message}\nControlla la Edge Function rapid-processor e la configurazione push.`
      );
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
    if (token && session?.user?.id) registerForPushNotifications();
  }, [token, session?.user?.id]);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem('pokechiacchere_session')
      .then((raw) => {
        if (active && raw) {
          try {
            setSession(JSON.parse(raw));
          } catch {
            AsyncStorage.removeItem('pokechiacchere_session');
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setSessionReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (token) loadData();
  }, [token, loadData]);

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
      await AsyncStorage.setItem(
        'pokechiacchere_session',
        JSON.stringify(data)
      );
    } catch (e) {
      Alert.alert('Errore di accesso', e.message);
    } finally {
      setLoading(false);
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
    const product = String(form.product || '').trim();
    const first = String(form.first_name || '').trim();
    const last = String(form.last_name || '').trim();
    const quantity = num(form.quantity);
    const price = num(form.unit_price);
    const total = quantity * price;
    const productCost = quantity * num(form.purchase_unit_cost);

    if (!product || quantity <= 0 || price < 0) {
      Alert.alert('Dati mancanti', 'Controlla prodotto, quantità e prezzo.');
      return;
    }

    setLoading(true);
    try {
      await addCatalog('products', product);

      const customer = [first, last].filter(Boolean).join(' ');
      if (customer) await addCatalog('customers', customer);

      const data = {
        sale_date: toDatabaseDate(form.date),
        order_number: form.order_number || '',
        customer_name: customer,
        customer_first_name: first || null,
        customer_last_name: last || null,
        product,
        quantity,
        sale_unit_price: price,
        unit_price: price,
        total_sale: total,
        tiktok_fees: num(form.fees),
        shipping_cost: num(form.shipping_cost),
        other_costs: num(form.other_costs),
        purchase_unit_cost: num(form.purchase_unit_cost),
        product_cost: productCost,
        net_profit:
          total -
          num(form.fees) -
          num(form.shipping_cost) -
          num(form.other_costs) -
          productCost,
        flat_tax: total * 0.02,
      };

      await saveRecord('sales', data);
    } catch (e) {
      Alert.alert('Errore vendita', e.message);
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

  function renderNotifications() {
    return (
      <>
        {header('Notifiche al socio', 'Invia un avviso a tutti gli utenti, incluso il proprietario')}
        <View style={s.panel}>
          <Text style={s.panelTitle}>Nuova notifica push</Text>
          <Text style={s.mutedSmall}>
            Tutti gli utenti che hanno installato l’app e autorizzato le notifiche push, incluso il proprietario, riceveranno l’avviso
            sul proprio dispositivo.
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
              maxLength={500}
            />
          </View>
          <Button
            title={
              notificationBusy ? 'Invio in corso…' : 'Invia notifica al socio'
            }
            onPress={sendPartnerNotification}
          />
          <Text style={s.mutedSmall}>
            L’invio è autorizzato dalla Edge Function rapid-processor.
          </Text>
        </View>
        <View style={s.panel}>
          <Text style={s.panelTitle}>Notifiche automatiche</Text>
          <Text style={s.mutedText}>
            Quando questo account proprietario registra una nuova vendita o un
            nuovo prelievo, viene inviata una notifica al socio. Le modifiche ai
            record esistenti non generano notifiche.
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
          <Card title="Commissioni TikTok" value={totals.fees} color={C.red} />
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
    const total = num(form.quantity) * num(form.unit_price);
    const cost = num(form.quantity) * num(form.purchase_unit_cost);

    return (
      <>
        {header(
          editing ? 'Modifica vendita' : 'Nuova vendita',
          'Registrazione TikTok Shop'
        )}
        <View style={s.panel}>
          <Field
            label="Data (GG/MM/AAAA)"
            value={form.date}
            onChangeText={(v) => change('date', v)}
            placeholder="GG/MM/AAAA"
          />
          <Field
            label="Numero ordine"
            value={form.order_number}
            onChangeText={(v) => change('order_number', v)}
          />
          {dropdown(
            'Cliente',
            'customer',
            'customer',
            [form.first_name, form.last_name].filter(Boolean).join(' '),
            'Scegli o scrivi un cliente'
          )}
          <Field
            label="Nome cliente"
            value={form.first_name}
            onChangeText={(v) => change('first_name', v)}
          />
          <Field
            label="Cognome cliente"
            value={form.last_name}
            onChangeText={(v) => change('last_name', v)}
          />
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
          <Field
            label="Commissioni TikTok (€)"
            value={form.fees}
            onChangeText={(v) => change('fees', v)}
            keyboardType="decimal-pad"
          />
          <Field
            label="Costo spedizione (€)"
            value={form.shipping_cost}
            onChangeText={(v) => change('shipping_cost', v)}
            keyboardType="decimal-pad"
          />
          <Field
            label="Altri costi (€)"
            value={form.other_costs}
            onChangeText={(v) => change('other_costs', v)}
            keyboardType="decimal-pad"
          />
          <Field
            label="Costo unitario merce (€)"
            value={form.purchase_unit_cost}
            onChangeText={(v) => change('purchase_unit_cost', v)}
            keyboardType="decimal-pad"
          />

          <View style={s.summary}>
            <Text style={s.summaryLine}>
              Totale vendita (quantità × prezzo): {money(total)}
            </Text>
            <Text style={s.summaryLine}>
              Costo spedizione: − {money(form.shipping_cost)}
            </Text>
            <Text style={s.summaryLine}>
              Commissioni TikTok: − {money(form.fees)}
            </Text>
            <Text style={s.summaryLine}>
              Altri costi: − {money(form.other_costs)}
            </Text>
            <Text style={s.summaryLine}>Costo merce: − {money(cost)}</Text>
            <View style={s.separator} />
            <Text style={s.summaryLine}>
              Utile prima della tassa:{' '}
              {money(
                total -
                  cost -
                  num(form.fees) -
                  num(form.shipping_cost) -
                  num(form.other_costs)
              )}
            </Text>
            <Text style={s.summaryLine}>
              Tassa stimata (2% del totale vendita): − {money(total * 0.02)}
            </Text>
            <Text style={[s.summaryLine, { color: C.green }]}>
              Utile netto stimato:{' '}
              {money(
                total -
                  cost -
                  num(form.fees) -
                  num(form.shipping_cost) -
                  num(form.other_costs) -
                  total * 0.02
              )}
            </Text>
          </View>

          <Button
            title={editing ? 'Salva modifiche' : 'Salva vendita'}
            onPress={saveSale}
          />
          <Button
            title="Annulla"
            type="secondary"
            onPress={() => setPage('sales')}
          />
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
    const data = records[table] || [];

    return (
      <>
        {header('Archivio', 'Clienti e prodotti salvati')}
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
          <Text style={s.label}>Posizione del nome nell'elenco</Text>
          <View style={s.filterRow}>
            {['top', 'center', 'bottom'].map((pos) => (
              <TouchableOpacity
                key={pos}
                style={[s.chip, namePosition === pos && s.chipActive]}
                onPress={() => setNamePosition(pos)}>
                <Text
                  style={[
                    s.chipText,
                    namePosition === pos && s.chipTextActive,
                  ]}>
                  {pos === 'top'
                    ? 'Alto'
                    : pos === 'center'
                    ? 'Centro'
                    : 'Basso'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Field
            label={isProduct ? 'Nome prodotto' : 'Nome e cognome'}
            value={form.name}
            onChangeText={(v) => change('name', v)}
            placeholder="Inserisci un nome"
          />
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
                await addCatalog(table, name);
                setForm({});
                Alert.alert('Archivio aggiornato', `${name} è stato aggiunto.`);
              } catch (e) {
                Alert.alert('Errore archivio', e.message);
              } finally {
                setLoading(false);
              }
            }}
          />
        </View>

        {data.map((row) => (
          <TouchableOpacity
            key={row.id}
            activeOpacity={0.82}
            onPress={() => {
              if (isProduct) return;
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
    const profit = history.reduce(
      (sum, sale) =>
        sum +
        num(
          sale.net_profit ??
            num(sale.total_sale) -
              num(sale.product_cost) -
              num(sale.tiktok_fees) -
              num(sale.shipping_cost) -
              num(sale.other_costs)
        ),
      0
    );
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
          <Text style={s.label}>Ordina per</Text>
          <View style={s.filterWrap}>
            {[
              ['date_desc', 'Data ↓'],
              ['date_asc', 'Data ↑'],
              ['name_asc', 'Nome A-Z'],
              ['name_desc', 'Nome Z-A'],
              ['price_asc', 'Prezzo ↑'],
              ['price_desc', 'Prezzo ↓'],
            ].map(([value, label]) => (
              <TouchableOpacity
                key={value}
                style={[s.chip, sortMode === value && s.chipActive]}
                onPress={() => setSortMode(value)}>
                <Text
                  style={[s.chipText, sortMode === value && s.chipTextActive]}>
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
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
        'Registro attività',
        `Non riesco a caricare il registro. Verifica di aver eseguito lo script SQL in Supabase.\n\n${e.message}`
      );
    } finally {
      setLoading(false);
    }
  }

  function renderSettings() {
    return (
      <>
        {header('Impostazioni', 'Preferenze e controllo delle attività')}
        <View style={s.panel}>
          <Text style={s.panelTitle}>Registro attività</Text>
          <Text style={s.mutedSmall}>
            Consulta chi ha creato, modificato o eliminato registrazioni, con
            data, ora e confronto dettagliato dei campi.
          </Text>
          <Button title="Apri registro attività" onPress={openActivityLog} />
        </View>
        <View style={s.panel}>
          <Text style={s.panelTitle}>Account attivo</Text>
          <Text style={s.activityActor}>
            {session?.user?.email || 'Email non disponibile'}
          </Text>
          <Text style={s.mutedSmall}>
            Le operazioni vengono associate all'account Supabase con cui hai
            effettuato l'accesso.
          </Text>
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
          'Registro attività',
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
            title="← Registro attività"
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

  function navItem(title, icon, target) {
    const active =
      page === target ||
      (target === 'payments' && page === 'paymentForm') ||
      (target === 'products' && page === 'customers');

    return (
      <TouchableOpacity
        key={target}
        style={s.navItem}
        onPress={() => setPage(target)}>
        <Text style={[s.navIcon, active && { color: C.cyan }]}>{icon}</Text>
        <Text style={[s.navLabel, active && { color: C.cyan }]}>{title}</Text>
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

  if (!session) {
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View style={s.login}>
          <Text style={s.brand}>
            POKE<Text style={{ color: C.red }}>CHIACCHIERE</Text>
          </Text>
          <Text style={s.pageTitle}>Bentornato.</Text>
          <Text style={s.subtitle}>Gestionale condiviso</Text>
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
              title={loading ? 'Accesso in corso…' : 'Accedi'}
              onPress={signIn}
            />
          </View>
          {loading && <ActivityIndicator color={C.cyan} />}
        </View>
      </SafeAreaView>
    );
  }

  let content;
  if (page === 'home') content = renderHome();
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
      </View>

      {pickerModal()}
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
