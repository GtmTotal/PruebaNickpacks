/**
 * Devuelve la URL base de la API.
 * En producción (mismo host que el frontend), usa window.location.hostname.
 * En desarrollo local (localhost), apunta al servidor de producción.
 */
export function getApiBaseUrl(): string {
  if (typeof window === 'undefined') return ''; 

  // 1. Intentar usar una variable de entorno definida en tiempo de construcción (Vite)
  // @ts-ignore
  const envUrl = import.meta.env.VITE_API_URL;
  if (envUrl) return envUrl;

  const hostname = window.location.hostname;

  // 2. Si estamos en desarrollo local, apuntamos al backend de producción por defecto
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'http://192.168.1.135:5000/api';
  }

  // 3. En producción, si no hay variable, asumimos que la API está en el puerto 5000 del mismo host
  return `http://${hostname}:5000/api`;
}
