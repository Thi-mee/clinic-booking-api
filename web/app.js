import { API_ORIGIN, FRONTEND_ORIGIN } from '../shared/config.js';
import { createApiClient } from './api-client.js';
import { element, escapeHtml, formatDate, showMessage } from './dom.js';

const apiBase = location.origin === FRONTEND_ORIGIN ? API_ORIGIN : '';
const api = createApiClient(apiBase);
const state = {
  slots: [],
  selectedSlot: null,
  pendingAttempt: null,
  cursor: null,
  searchEmail: '',
  confirmedBookingId: null,
  submitting: false,
};

function selectSlot(slot) {
  state.selectedSlot = slot;
  state.pendingAttempt = null;
  element('selection').innerHTML =
    `<strong>${escapeHtml(slot.provider)}</strong><br>${escapeHtml(formatDate(slot.start))}`;
  element('submit').disabled = state.submitting;
  renderSlots();
}

function renderSlots() {
  const provider = element('provider').value;
  const now = Date.now();
  const visible = state.slots.filter(
    (slot) =>
      slot.available &&
      Date.parse(slot.start) > now &&
      (!provider || slot.provider === provider),
  );
  element('slotstatus').textContent =
    `${visible.length} available · ${Intl.DateTimeFormat().resolvedOptions().timeZone}`;
  element('slots').replaceChildren();

  if (!visible.length) {
    element('slots').innerHTML =
      '<div class="empty">No appointments available. Please check again later.</div>';
    return;
  }

  for (const slot of visible) {
    const button = document.createElement('button');
    const duration = Math.round((Date.parse(slot.end) - Date.parse(slot.start)) / 60_000);
    button.type = 'button';
    button.className = 'slot';
    button.disabled = state.submitting;
    button.setAttribute('aria-pressed', String(state.selectedSlot?.id === slot.id));
    button.innerHTML = `
      <div>
        <b>${escapeHtml(formatDate(slot.start))}</b>
        <span>${escapeHtml(slot.provider)} · ${duration} min</span>
      </div>
      <i class="circle" aria-hidden="true"></i>`;
    button.addEventListener('click', () => selectSlot(slot));
    element('slots').append(button);
  }
}

async function loadSlots() {
  const { slots } = await api.listSlots();
  state.slots = slots;
  const providerSelect = element('provider');
  const previousProvider = providerSelect.value;
  providerSelect.replaceChildren(new Option('All providers', ''));
  for (const provider of new Set(slots.map((slot) => slot.provider))) {
    providerSelect.append(new Option(provider, provider));
  }
  providerSelect.value = previousProvider;

  if (
    state.selectedSlot &&
    !slots.some((slot) => slot.id === state.selectedSlot.id && slot.available)
  ) {
    state.selectedSlot = null;
    element('selection').textContent = 'Choose another available appointment.';
    element('submit').disabled = true;
  }
  renderSlots();
}

async function connect(event) {
  event.preventDefault();
  api.setKey(element('key').value);
  element('load').disabled = true;
  element('slotstatus').textContent = 'Loading appointments…';
  try {
    await loadSlots();
    element('load').textContent = 'Refresh';
  } catch (error) {
    showMessage('slotstatus', error.message, true);
  } finally {
    element('load').disabled = false;
  }
}

function showConfirmation(booking, slot) {
  element('confirmed-details').innerHTML = `
    <strong>${escapeHtml(slot.provider)}</strong><br>
    ${escapeHtml(formatDate(slot.start))}<br>
    ${escapeHtml(booking.name)}<br>
    ${escapeHtml(booking.email)}`;
  element('bookingid').textContent = booking.id;
  element('details').classList.add('hidden');
  element('confirmation').classList.remove('hidden');
  element('findemail').value = booking.email;
  element('feedback').textContent = '';
  state.confirmedBookingId = booking.id;
}

function showBookingForm() {
  element('confirmation').classList.add('hidden');
  element('details').classList.remove('hidden');
  element('selection').textContent = 'Choose an appointment on the left.';
  state.confirmedBookingId = null;
}

async function submitBooking(event) {
  event.preventDefault();
  if (!state.selectedSlot || state.submitting) return;
  const slot = state.selectedSlot;
  const body = JSON.stringify({
    slot_id: slot.id,
    name: element('name').value,
    email: element('email').value,
  });
  // Retain the same key until this exact attempt has a confirmed response.
  if (!state.pendingAttempt || state.pendingAttempt.body !== body) {
    state.pendingAttempt = { body, key: crypto.randomUUID() };
  }

  state.submitting = true;
  element('submit').disabled = true;
  element('submit').textContent = 'Confirming…';
  renderSlots();
  try {
    const booking = await api.book(body, state.pendingAttempt.key);
    showConfirmation(booking, slot);
    state.selectedSlot = null;
    state.pendingAttempt = null;
  } catch (error) {
    showMessage('feedback', error.message, true);
  } finally {
    // A failed refresh must not turn a successful booking into an apparent failure.
    try {
      await loadSlots();
    } catch (error) {
      showMessage('slotstatus', error.message, true);
    }
    state.submitting = false;
    element('submit').disabled = !state.selectedSlot;
    element('submit').textContent = 'Confirm appointment →';
    renderSlots();
  }
}

async function cancelBooking(booking, row, button) {
  button.disabled = true;
  try {
    await api.cancel(booking.id);
    button.remove();
    row.querySelector('p').textContent = `${booking.slot_id} · cancelled`;
    if (state.confirmedBookingId === booking.id) showBookingForm();
    showMessage('history-message', 'Appointment cancelled. The slot is available again.');
  } catch (error) {
    showMessage('history-message', error.message, true);
    button.disabled = false;
    return;
  }
  try {
    await loadSlots();
  } catch (error) {
    showMessage('slotstatus', error.message, true);
  }
}

function appendBooking(booking) {
  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML = `
    <div>
      <strong>${escapeHtml(booking.name)}</strong>
      <p>${escapeHtml(booking.slot_id)} · ${escapeHtml(booking.status)}</p>
      <p>${escapeHtml(formatDate(booking.created_at))}</p>
      <span class="confirmation-id">${escapeHtml(booking.id)}</span>
    </div>`;
  if (booking.status === 'confirmed') {
    const button = document.createElement('button');
    button.className = 'secondary';
    button.textContent = 'Cancel';
    button.addEventListener('click', () => cancelBooking(booking, row, button));
    row.append(button);
  }
  element('history').append(row);
}

async function loadBookings(loadMore = false) {
  element('more').disabled = true;
  try {
    if (!loadMore) {
      element('history').replaceChildren();
      state.cursor = null;
      state.searchEmail = element('findemail').value.trim();
    }
    const page = await api.listBookings(state.searchEmail, state.cursor);
    page.bookings.forEach(appendBooking);
    state.cursor = page.next_cursor;
    element('more').classList.toggle('hidden', !state.cursor);
    showMessage(
      'history-message',
      page.bookings.length ? 'Bookings loaded.' : 'No bookings found.',
    );
  } catch (error) {
    showMessage('history-message', error.message, true);
  } finally {
    element('more').disabled = false;
  }
}

async function lookupBooking(event) {
  event.preventDefault();
  try {
    const booking = await api.find(element('reference').value.trim());
    element('history').replaceChildren();
    element('more').classList.add('hidden');
    appendBooking(booking);
    showMessage('history-message', 'Booking found.');
  } catch (error) {
    showMessage('history-message', error.message, true);
  }
}

element('connect').addEventListener('submit', connect);
element('provider').addEventListener('change', renderSlots);
element('book').addEventListener('submit', submitBooking);
element('another').addEventListener('click', showBookingForm);
element('find').addEventListener('submit', (event) => {
  event.preventDefault();
  loadBookings();
});
element('more').addEventListener('click', () => loadBookings(true));
element('lookup').addEventListener('submit', lookupBooking);
