export const element = (id) => document.getElementById(id);

export function escapeHtml(value) {
  const entities = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return String(value).replace(/[&<>"']/g, (character) => entities[character]);
}

export function formatDate(value) {
  return new Date(value).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function showMessage(id, text, isError = false) {
  const target = element(id);
  target.classList.add('message');
  target.classList.toggle('error', isError);
  target.textContent = text;
}
