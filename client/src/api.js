const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:9000').replace(/\/$/, '');

// HTTP errors and unreachable servers need different feedback.
export async function apiRequest(endpoint, { method = 'GET', values, signal } = {}) {
  let response;
  try {
    response = await fetch(`${API_URL}/${endpoint}`, {
      method,
      headers: values === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: values === undefined ? undefined : JSON.stringify(values),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    });
  } catch {
    if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
    throw new Error('Could not connect to the server. Please try again shortly.');
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('The server returned an unexpected response. Please try again.');
  }
  if (!response.ok) throw new Error(data.message || 'Something went wrong. Please try again.');
  return data;
}

export function postForm(endpoint, values) {
  return apiRequest(endpoint, { method: 'POST', values });
}
