import { db } from './firebase-init.js';
import {
  collection, doc,
  addDoc, setDoc, updateDoc, deleteDoc,
  getDocs, getDoc, query, orderBy, where, onSnapshot,
  serverTimestamp, Timestamp
} from 'firebase/firestore';

// ── Helpers ──────────────────────────────────────────────────────
function userRef(uid) { return doc(db, 'users', uid); }
function tripsRef(uid) { return collection(db, 'users', uid, 'trips'); }
function tripRef(uid, tid) { return doc(db, 'users', uid, 'trips', tid); }
function subRef(uid, tid, sub) { return collection(db, 'users', uid, 'trips', tid, sub); }
function subDocRef(uid, tid, sub, id) { return doc(db, 'users', uid, 'trips', tid, sub, id); }
function guestCodeRef(code) { return doc(db, 'guest_codes', code); }

function snap(snapshot) {
  return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
}

function sortByDateTime(items) {
  return items.sort((a, b) => {
    const d = (a.date || '').localeCompare(b.date || '');
    return d !== 0 ? d : (a.time || '').localeCompare(b.time || '');
  });
}

function _touchArchive(uid) {
  try { sessionStorage.setItem('arch_dirty_' + uid, '1'); } catch (_) {}
}

// ── Trips ────────────────────────────────────────────────────────
export async function getTrips(uid) {
  const q = query(tripsRef(uid), orderBy('createdAt', 'desc'));
  const s = await getDocs(q);
  return snap(s);
}

export async function createTrip(uid, data) {
  _touchArchive(uid);
  const ref = await addDoc(tripsRef(uid), {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function getTrip(uid, tid) {
  const s = await getDoc(tripRef(uid, tid));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}

export async function updateTrip(uid, tid, data) {
  _touchArchive(uid);
  return updateDoc(tripRef(uid, tid), { ...data, updatedAt: serverTimestamp() });
}

const SUBCOLLECTIONS = ['itinerary', 'accommodation', 'activities', 'expenses', 'packing'];

export async function deleteTrip(uid, tid) {
  _touchArchive(uid);
  // Clean up guest code if one exists
  const tripSnap = await getDoc(tripRef(uid, tid));
  const existingCode = tripSnap.exists() ? tripSnap.data().guestCode : null;
  if (existingCode) await deleteDoc(guestCodeRef(existingCode)).catch(() => {});

  for (const sub of SUBCOLLECTIONS) {
    const s = await getDocs(subRef(uid, tid, sub));
    await Promise.all(s.docs.map(d => deleteDoc(d.ref)));
  }
  return deleteDoc(tripRef(uid, tid));
}

export async function deleteAllTrips(uid) {
  const s = await getDocs(tripsRef(uid));
  for (const tripDoc of s.docs) {
    await deleteTrip(uid, tripDoc.id);
  }
}

// ── Itinerary ────────────────────────────────────────────────────
export async function getItinerary(uid, tid) {
  const q = query(subRef(uid, tid, 'itinerary'), orderBy('date'));
  const s = await getDocs(q);
  return sortByDateTime(snap(s));
}

export function subscribeItinerary(uid, tid, cb, onErr) {
  const q = query(subRef(uid, tid, 'itinerary'), orderBy('date'));
  return onSnapshot(q, s => cb(sortByDateTime(snap(s))), onErr);
}

export async function addItineraryItem(uid, tid, data) {
  _touchArchive(uid);
  return addDoc(subRef(uid, tid, 'itinerary'), { ...data, createdAt: serverTimestamp() });
}

export async function updateItineraryItem(uid, tid, id, data) {
  _touchArchive(uid);
  return updateDoc(subDocRef(uid, tid, 'itinerary', id), data);
}

export async function deleteItineraryItem(uid, tid, id) {
  _touchArchive(uid);
  return deleteDoc(subDocRef(uid, tid, 'itinerary', id));
}

// ── Bookings (stored in `accommodation` collection for backward compat) ──
export async function getBookings(uid, tid) {
  const s = await getDocs(subRef(uid, tid, 'accommodation'));
  return snap(s);
}

export function subscribeBookings(uid, tid, cb, onErr) {
  return onSnapshot(subRef(uid, tid, 'accommodation'), s => cb(snap(s)), onErr);
}

export async function addBooking(uid, tid, data) {
  _touchArchive(uid);
  return addDoc(subRef(uid, tid, 'accommodation'), { ...data, createdAt: serverTimestamp() });
}

export async function updateBooking(uid, tid, id, data) {
  _touchArchive(uid);
  return updateDoc(subDocRef(uid, tid, 'accommodation', id), data);
}

export async function deleteBooking(uid, tid, id) {
  _touchArchive(uid);
  return deleteDoc(subDocRef(uid, tid, 'accommodation', id));
}

// ── Activities ───────────────────────────────────────────────────
export async function getActivities(uid, tid) {
  const q = query(subRef(uid, tid, 'activities'), orderBy('date'));
  const s = await getDocs(q);
  return sortByDateTime(snap(s));
}

export function subscribeActivities(uid, tid, cb, onErr) {
  const q = query(subRef(uid, tid, 'activities'), orderBy('date'));
  return onSnapshot(q, s => cb(sortByDateTime(snap(s))), onErr);
}

export async function addActivity(uid, tid, data) {
  _touchArchive(uid);
  return addDoc(subRef(uid, tid, 'activities'), {
    ...data,
    completed: false,
    createdAt: serverTimestamp()
  });
}

export async function updateActivity(uid, tid, id, data) {
  _touchArchive(uid);
  return updateDoc(subDocRef(uid, tid, 'activities', id), data);
}

export async function deleteActivity(uid, tid, id) {
  _touchArchive(uid);
  return deleteDoc(subDocRef(uid, tid, 'activities', id));
}

export async function toggleActivity(uid, tid, id, completed) {
  _touchArchive(uid);
  return updateDoc(subDocRef(uid, tid, 'activities', id), { completed });
}

// ── Packing ───────────────────────────────────────────────────────
export function subscribePacking(uid, tid, cb, onErr) {
  return onSnapshot(subRef(uid, tid, 'packing'), s => cb(snap(s)), onErr);
}
export async function addPackingItem(uid, tid, data) {
  return addDoc(subRef(uid, tid, 'packing'), { ...data, createdAt: serverTimestamp() });
}
export async function updatePackingItem(uid, tid, id, data) {
  return setDoc(subDocRef(uid, tid, 'packing', id), data, { merge: true });
}
export async function deletePackingItem(uid, tid, id) {
  return deleteDoc(subDocRef(uid, tid, 'packing', id));
}
export async function togglePackingItem(uid, tid, id, isPacked) {
  return setDoc(subDocRef(uid, tid, 'packing', id), { isPacked }, { merge: true });
}

// ── Expenses ─────────────────────────────────────────────────────
export async function getExpenses(uid, tid) {
  const q = query(subRef(uid, tid, 'expenses'), orderBy('date', 'desc'));
  const s = await getDocs(q);
  return snap(s);
}

export function subscribeExpenses(uid, tid, cb, onErr) {
  const q = query(subRef(uid, tid, 'expenses'), orderBy('date', 'desc'));
  return onSnapshot(q, s => cb(snap(s)), onErr);
}

export async function addExpense(uid, tid, data) {
  _touchArchive(uid);
  return addDoc(subRef(uid, tid, 'expenses'), { ...data, createdAt: serverTimestamp() });
}

export async function updateExpense(uid, tid, id, data) {
  _touchArchive(uid);
  return updateDoc(subDocRef(uid, tid, 'expenses', id), data);
}

export async function deleteExpense(uid, tid, id) {
  _touchArchive(uid);
  return deleteDoc(subDocRef(uid, tid, 'expenses', id));
}

// ── Linked expense helpers ────────────────────────────────────────
export async function upsertLinkedExpense(uid, tid, sourceId, sourceType, data) {
  const q = query(subRef(uid, tid, 'expenses'), where('sourceId', '==', sourceId));
  const all = await getDocs(q);
  const existing = all.docs.find(d => d.data().sourceType === sourceType);
  if (existing) {
    await updateDoc(existing.ref, data);
    return existing.id;
  }
  const ref = await addDoc(subRef(uid, tid, 'expenses'), { ...data, sourceId, sourceType, createdAt: serverTimestamp() });
  return ref.id;
}

export async function deleteLinkedExpense(uid, tid, sourceId, sourceType) {
  const q = query(subRef(uid, tid, 'expenses'), where('sourceId', '==', sourceId));
  const all = await getDocs(q);
  const match = all.docs.find(d => d.data().sourceType === sourceType);
  if (match) await deleteDoc(match.ref);
}

// ── Linked itinerary helpers ──────────────────────────────────────
export async function upsertLinkedItinItem(uid, tid, sourceId, sourceType, sourceSubType, data) {
  const q = query(subRef(uid, tid, 'itinerary'), where('sourceId', '==', sourceId));
  const all = await getDocs(q);
  const existing = all.docs.find(d => d.data().sourceSubType === sourceSubType);
  if (existing) {
    await updateDoc(existing.ref, { ...data, sourceType });
    return existing.id;
  }
  const ref = await addDoc(subRef(uid, tid, 'itinerary'), { ...data, sourceId, sourceType, sourceSubType, createdAt: serverTimestamp() });
  return ref.id;
}

export async function getAllTripsData(uid) {
  const trips = await getTrips(uid);
  return Promise.all(trips.map(async trip => ({
    trip,
    expenses:      await getExpenses(uid, trip.id),
    activities:    await getActivities(uid, trip.id),
    bookings: await getBookings(uid, trip.id),
    itinerary:     await getItinerary(uid, trip.id),
  })));
}

export async function deleteLinkedItinItems(uid, tid, sourceId, sourceType) {
  const q = query(subRef(uid, tid, 'itinerary'), where('sourceId', '==', sourceId));
  const all = await getDocs(q);
  const matches = all.docs.filter(d => d.data().sourceType === sourceType);
  await Promise.all(matches.map(d => deleteDoc(d.ref)));
}

export async function deleteLinkedItinItem(uid, tid, sourceId, sourceType, sourceSubType) {
  const q = query(subRef(uid, tid, 'itinerary'), where('sourceId', '==', sourceId));
  const all = await getDocs(q);
  const match = all.docs.find(d => {
    const dd = d.data();
    return dd.sourceType === sourceType && dd.sourceSubType === sourceSubType;
  });
  if (match) await deleteDoc(match.ref);
}

// ── Guest code ────────────────────────────────────────────────────
export async function getGuestCode(uid, tid) {
  const s = await getDoc(tripRef(uid, tid));
  return s.exists() ? (s.data().guestCode || null) : null;
}

export async function setGuestCode(uid, tid, code) {
  await Promise.all([
    updateDoc(tripRef(uid, tid), { guestCode: code }),
    setDoc(guestCodeRef(code), { ownerUid: uid, tripId: tid, createdAt: serverTimestamp() }),
  ]);
}

export async function removeGuestCode(uid, tid, code) {
  await Promise.all([
    updateDoc(tripRef(uid, tid), { guestCode: null }),
    deleteDoc(guestCodeRef(code)),
  ]);
}

export async function lookupGuestCode(code) {
  const s = await getDoc(guestCodeRef(code));
  return s.exists() ? s.data() : null;
}
