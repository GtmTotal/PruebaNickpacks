import { getApiBaseUrl } from '../api-config';
import { adminService } from './admin.svelte';
import type { InformeGuardado } from '$lib/types/informe.interface';

class ServicioBaseDeDatos {
  private get apiBase() { return getApiBaseUrl(); }
  private readonly LOCAL_STORAGE_KEY = 'gtm_informes_locales';

  // --- LÓGICA LOCAL ---

  private obtenerInformesLocales(): Record<string, any> {
    if (typeof localStorage === 'undefined') return {};
    const stored = localStorage.getItem(this.LOCAL_STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  }

  private guardarLocalmente(informe: any) {
    if (typeof localStorage === 'undefined') return;
    const locales = this.obtenerInformesLocales();
    // Usamos una clave única combinando cuatrimestre y centro
    const key = `${informe.cuatrimestre}_${informe.nombreObra}`;
    locales[key] = {
      ...informe,
      _localOnly: true,
      _syncPending: true,
      _lastLocalUpdate: Date.now()
    };
    localStorage.setItem(this.LOCAL_STORAGE_KEY, JSON.stringify(locales));
  }

  private eliminarLocal(cuatrimestre: string, centro: string) {
    if (typeof localStorage === 'undefined') return;
    const locales = this.obtenerInformesLocales();
    const key = `${cuatrimestre}_${centro}`;
    delete locales[key];
    localStorage.setItem(this.LOCAL_STORAGE_KEY, JSON.stringify(locales));
  }

  // --- LÓGICA PÚBLICA ---

  async guardar(informe: any) {
    if (!informe.cuatrimestre || !informe.cuatrimestre.trim()) {
      throw new Error('El informe debe tener un cuatrimestre asignado');
    }

    // 1. Guardar SIEMPRE en local primero (instantáneo)
    this.guardarLocalmente(informe);

    const payload = {
      id: informe.id,
      nombreObra: informe.nombreObra || 'Sin nombre',
      fecha: informe.fecha || null,
      cuatrimestre: informe.cuatrimestre.trim(),
      ultimaModificacion: informe.ultimaModificacion || new Date().toLocaleString(),
      datos: informe,
    };
    
    try {
      const res = await fetch(`${this.apiBase}/informes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...adminService.getAuthHeaders()
        },
        body: JSON.stringify(payload)
      });
      
      if (res.ok) {
        const data = await res.json();
        // Si se guardó en el servidor con éxito, podemos marcarlo como sincronizado
        // o simplemente limpiar la marca de pendiente
        if (data.id) {
          const locales = this.obtenerInformesLocales();
          const key = `${informe.cuatrimestre}_${informe.nombreObra}`;
          if (locales[key]) {
            locales[key]._syncPending = false;
            locales[key].id = data.id; // Actualizamos el ID real de la BD
            localStorage.setItem(this.LOCAL_STORAGE_KEY, JSON.stringify(locales));
          }
        }
        return data;
      } else {
        console.warn('[OFFLINE] Error en servidor, mantenemos copia local');
        return { success: true, offline: true };
      }
    } catch (err) {
      console.warn('[OFFLINE] Fallo de red, el informe se queda en local:', err);
      return { success: true, offline: true };
    }
  }

  async obtenerTodos(): Promise<InformeGuardado[]> {
    let serverInformes: InformeGuardado[] = [];
    try {
      const res = await fetch(`${this.apiBase}/informes`);
      if (res.ok) {
        const data = await res.json();
        serverInformes = data.map((item: any) => ({
          id: item.id,
          nombreObra: item.nombre_obra,
          fecha: item.fecha,
          cuatrimestre: item.cuatrimestre,
          protegido: item.datos?.protegido === true,
          progreso: item.datos?.progreso ?? 0,
          ultimaModificacion: item.modificado,
        }));
      }
    } catch (e) {
      console.error('[DATABASE] Error cargando desde servidor, usando solo local');
    }

    // Mezclamos con los locales
    const locales = this.obtenerInformesLocales();
    const result = [...serverInformes];

    for (const [key, localInf] of Object.entries(locales)) {
      const index = result.findIndex(s => 
        s.cuatrimestre === (localInf as any).cuatrimestre && 
        s.nombreObra === (localInf as any).nombreObra
      );

      const mappedLocal: InformeGuardado = {
        id: (localInf as any).id,
        nombreObra: (localInf as any).nombreObra,
        fecha: (localInf as any).fecha,
        cuatrimestre: (localInf as any).cuatrimestre,
        protegido: (localInf as any).protegido || false,
        progreso: (localInf as any).progreso || 0,
        ultimaModificacion: (localInf as any).ultimaModificacion,
        _syncPending: (localInf as any)._syncPending
      };

      if (index !== -1) {
        // Si existe en ambos, comparamos fechas si es necesario o priorizamos local si tiene cambios pendientes
        if ((localInf as any)._syncPending) {
          result[index] = mappedLocal;
        }
      } else {
        // Solo existe en local
        result.push(mappedLocal);
      }
    }

    return result;
  }

  async obtenerPorId(id: number): Promise<any | null> {
    // Primero intentamos servidor
    try {
      const res = await fetch(`${this.apiBase}/informes/${id}`);
      if (res.ok) {
        const data = await res.json();
        const serverData = data?.datos ?? null;
        
        // Verificamos si tenemos una versión local más reciente con cambios pendientes
        if (serverData) {
          const locales = this.obtenerInformesLocales();
          const key = `${serverData.cuatrimestre}_${serverData.nombreObra}`;
          const localVersion = locales[key];
          if (localVersion && localVersion._syncPending) {
            console.log('[DATABASE] Cargando versión local más reciente por cambios pendientes');
            return localVersion;
          }
        }
        return serverData;
      }
    } catch (e) {
      console.warn('[DATABASE] Fallo al obtener por ID, buscando en local...');
    }

    // Si falla o no existe, buscamos en todos los locales por ID
    const locales = this.obtenerInformesLocales();
    return Object.values(locales).find((l: any) => l.id === id) || null;
  }

  async eliminar(id: number) {
    // Buscamos el informe para saber su cuatrimestre/centro y borrarlo de local también
    const informes = await this.obtenerTodos();
    const inf = informes.find(i => i.id === id);
    if (inf) {
      this.eliminarLocal(inf.cuatrimestre, inf.nombreObra);
    }

    try {
      const res = await fetch(`${this.apiBase}/informes/${id}`, {
        method: 'DELETE',
        headers: adminService.getAuthHeaders()
      });
      if (!res.ok) throw new Error('Error al eliminar informe');
      return res.json();
    } catch (e) {
      // Si falla el servidor pero lo borramos de local, al menos en la UI del técnico desaparecerá
      return { success: true };
    }
  }

  async existeCuatrimestre(cuatrimestre: string): Promise<boolean> {
    const informes = await this.obtenerTodos();
    return informes.some(i => i.cuatrimestre === cuatrimestre);
  }

  async eliminarCuatrimestre(cuatrimestre: string) {
    if (!cuatrimestre || cuatrimestre === 'sin-cuatri') {
      throw new Error('Cuatrimestre inválido para eliminación');
    }
    
    // Borrar de local
    if (typeof localStorage !== 'undefined') {
      const locales = this.obtenerInformesLocales();
      const keysToDelete = Object.keys(locales).filter(k => k.startsWith(`${cuatrimestre}_`));
      keysToDelete.forEach(k => delete locales[k]);
      localStorage.setItem(this.LOCAL_STORAGE_KEY, JSON.stringify(locales));
    }

    const res = await fetch(`${this.apiBase}/informes/cuatrimestre/${encodeURIComponent(cuatrimestre)}`, {
      method: 'DELETE',
      headers: adminService.getAuthHeaders()
    });
    if (!res.ok) throw new Error('Error al eliminar cuatrimestre');
    return res.json();
  }
}

export const databaseService = new ServicioBaseDeDatos();
