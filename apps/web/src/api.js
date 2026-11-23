export async function request(path, { token, method = 'GET', body, signal, csv = false, key } = {}) {
  let response;
  try {
    response = await fetch('/api' + path, {
      method, signal, cache: 'no-store',
      headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(key ? { 'Idempotency-Key':key } : {}), ...(body !== undefined ? { 'Content-Type':'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error('Нет связи с сервером. Проверьте соединение и обновите данные.');
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const error = new Error(payload.error || 'Сервер не выполнил запрос. Повторите попытку.');
    error.status = response.status;
    throw error;
  }
  if (csv) return response.blob();
  return response.status === 204 ? {} : response.json();
}

export function isAndroidOffice() {
  return navigator.userAgent.includes('FarvaterAndroidOffice/1');
}

export function minuteText(value) {
  if (value === null || value === undefined) return '—';
  const n = Number(value);
  return String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
}
export function toMinutes(value) {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}
export const orderStates = { pending:'В очереди', assigned:'Назначен', delivered:'Доставлен', failed:'Срыв доставки', cancelled:'Отменён' };
export const shiftStates = { pending:'Ожидает выхода', confirmed:'Выход подтверждён', active:'На смене', closed:'Смена сдана' };
export const tripStates = { planned:'Запланирован', active:'В пути', returned:'На базе' };
export const roleNames = { operator:'Оператор', dispatcher:'Диспетчер', manager:'Руководитель', driver:'Экспедитор' };
