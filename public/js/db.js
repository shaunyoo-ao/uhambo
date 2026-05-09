import { db } from './firebase-init.js';
import {
  collection, doc,
  addDoc, setDoc, updateDoc, deleteDoc,
  getDocs, getDoc, query, orderBy, onSnapshot,
  serverTimestamp, Timestamp
} from 'firebase/firestore';

// ── Helpers ──────────────────────────────────────────────────────
function userRef(uid) { return doc(db, 'users', uid); }
function tripsRef(uid) { return collection(db, 'users', uid, 'trips'); }
function tripRef(uid, tid) { return doc(db, 'users', uid, 'trips', tid); }
function subRef(uid, tid, sub) { return collection(db, 'users', uid, 'trips', tid, sub); }
function subDocRef(uid, tid, sub, id) { return doc(db, 'users', uid, 'trips', tid, sub, id); }

function snap(snapshot) {
  return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
}

function sortByDateTime(items) {
  return items.sort((a, b) => {
    const d = (a.date || '').localeCompare(b.date || '');
    return d !== 0 ? d : (a.time || '').localeCompare(b.time || '');
  });
}

// ── Trips ────────────────────────────────────────────────────────
export async function getTrips(uid) {
  const q = query(tripsRef(uid), orderBy('createdAt', 'desc'));
  const s = await getDocs(q);
  return snap(s);
}

export async function createTrip(uid, data) {
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
  return updateDoc(tripRef(uid, tid), { ...data, updatedAt: serverTimestamp() });
}

export async function deleteTrip(uid, tid) {
  return deleteDoc(tripRef(uid, tid));
}

// ── Itinerary ────────────────────────────────────────────────────
export async function getItinerary(uid, tid) {
  const q = query(subRef(uid, tid, 'itinerary'), orderBy('date'));
  const s = await getDocs(q);
  return sortByDateTime(snap(s));
}

export function subscribeItinerary(uid, tid, cb) {
  const q = query(subRef(uid, tid, 'itinerary'), orderBy('date'));
  return onSnapshot(q, s => cb(sortByDateTime(snap(s))));
}

export async function addItineraryItem(uid, tid, data) {
  return addDoc(subRef(uid, tid, 'itinerary'), { ...data, createdAt: serverTimestamp() });
}

export async function updateItineraryItem(uid, tid, id, data) {
  return updateDoc(subDocRef(uid, tid, 'itinerary', id), data);
}

export async function deleteItineraryItem(uid, tid, id) {
  return deleteDoc(subDocRef(uid, tid, 'itinerary', id));
}

// ── Accommodation ────────────────────────────────────────────────
export async function getAccommodation(uid, tid) {
  const q = query(subRef(uid, tid, 'accommodation'), orderBy('checkIn'));
  const s = await getDocs(q);
  return snap(s);
}

export function subscribeAccommodation(uid, tid, cb) {
  const q = query(subRef(uid, tid, 'accommodation'), orderBy('checkIn'));
  return onSnapshot(q, s => cb(snap(s)));
}

export async function addAccommodation(uid, tid, data) {
  return addDoc(subRef(uid, tid, 'accommodation'), { ...data, createdAt: serverTimestamp() });
}

export async function updateAccommodation(uid, tid, id, data) {
  return updateDoc(subDocRef(uid, tid, 'accommodation', id), data);
}

export async function deleteAccommodation(uid, tid, id) {
  return deleteDoc(subDocRef(uid, tid, 'accommodation', id));
}

// ── Activities ───────────────────────────────────────────────────
export async function getActivities(uid, tid) {
  const q = query(subRef(uid, tid, 'activities'), orderBy('date'));
  const s = await getDocs(q);
  return sortByDateTime(snap(s));
}

export function subscribeActivities(uid, tid, cb) {
  const q = query(subRef(uid, tid, 'activities'), orderBy('date'));
  return onSnapshot(q, s => cb(sortByDateTime(snap(s))));
}

export async function addActivity(uid, tid, data) {
  return addDoc(subRef(uid, tid, 'activities'), {
    ...data,
    completed: false,
    createdAt: serverTimestamp()
  });
}

export async function updateActivity(uid, tid, id, data) {
  return updateDoc(subDocRef(uid, tid, 'activities', id), data);
}

export async function deleteActivity(uid, tid, id) {
  return deleteDoc(subDocRef(uid, tid, 'activities', id));
}

export async function toggleActivity(uid, tid, id, completed) {
  return updateDoc(subDocRef(uid, tid, 'activities', id), { completed });
}

// ── Expenses ─────────────────────────────────────────────────────
export async function getExpenses(uid, tid) {
  const q = query(subRef(uid, tid, 'expenses'), orderBy('date', 'desc'));
  const s = await getDocs(q);
  return snap(s);
}

export function subscribeExpenses(uid, tid, cb) {
  const q = query(subRef(uid, tid, 'expenses'), orderBy('date', 'desc'));
  return onSnapshot(q, s => cb(snap(s)));
}

export async function addExpense(uid, tid, data) {
  return addDoc(subRef(uid, tid, 'expenses'), { ...data, createdAt: serverTimestamp() });
}

export async function updateExpense(uid, tid, id, data) {
  return updateDoc(subDocRef(uid, tid, 'expenses', id), data);
}

export async function deleteExpense(uid, tid, id) {
  return deleteDoc(subDocRef(uid, tid, 'expenses', id));
}

// ── Linked expense helpers ────────────────────────────────────────
export async function upsertLinkedExpense(uid, tid, sourceId, sourceType, data) {
  const all = await getDocs(subRef(uid, tid, 'expenses'));
  const existing = all.docs.find(d => d.data().sourceId === sourceId && d.data().sourceType === sourceType);
  if (existing) {
    await updateDoc(existing.ref, data);
    return existing.id;
  }
  const ref = await addDoc(subRef(uid, tid, 'expenses'), { ...data, sourceId, sourceType, createdAt: serverTimestamp() });
  return ref.id;
}

export async function deleteLinkedExpense(uid, tid, sourceId, sourceType) {
  const all = await getDocs(subRef(uid, tid, 'expenses'));
  const match = all.docs.find(d => d.data().sourceId === sourceId && d.data().sourceType === sourceType);
  if (match) await deleteDoc(match.ref);
}

// ── Linked itinerary helpers ──────────────────────────────────────
export async function upsertLinkedItinItem(uid, tid, sourceId, sourceType, sourceSubType, data) {
  const all = await getDocs(subRef(uid, tid, 'itinerary'));
  const existing = all.docs.find(d => {
    const dd = d.data();
    return dd.sourceId === sourceId && dd.sourceType === sourceType && dd.sourceSubType === sourceSubType;
  });
  if (existing) {
    await updateDoc(existing.ref, data);
    return existing.id;
  }
  const ref = await addDoc(subRef(uid, tid, 'itinerary'), { ...data, sourceId, sourceType, sourceSubType, createdAt: serverTimestamp() });
  return ref.id;
}

export async function deleteLinkedItinItems(uid, tid, sourceId, sourceType) {
  const all = await getDocs(subRef(uid, tid, 'itinerary'));
  const matches = all.docs.filter(d => d.data().sourceId === sourceId && d.data().sourceType === sourceType);
  await Promise.all(matches.map(d => deleteDoc(d.ref)));
}
