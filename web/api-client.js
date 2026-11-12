export function createApiClient(baseUrl) {
  let apiKey = '';

  async function request(path, { headers, ...options } = {}) {
    const response = await fetch(baseUrl + path, {
      ...options,
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json',
        ...headers,
      },
    });
    const data = await response.json();
    if (!response.ok) {
      const retryMessage =
        response.status === 429
          ? ` Try again in ${response.headers.get('Retry-After')} seconds.`
          : '';
      throw new Error(data.error + retryMessage);
    }
    return data;
  }

  return {
    setKey(key) {
      apiKey = key;
    },
    listSlots: () => request('/slots'),
    book: (body, key) =>
      request('/bookings', {
        method: 'POST',
        body,
        headers: { 'Idempotency-Key': key },
      }),
    find: (id) => request(`/bookings/${encodeURIComponent(id)}`),
    cancel: (id) => request(`/bookings/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    listBookings: (email, cursor) => {
      const params = new URLSearchParams({ email, limit: '3' });
      if (cursor) params.set('cursor', cursor);
      return request(`/bookings?${params}`);
    },
  };
}
