// api.js
class ApiClient {
    constructor(config) {
        this.apiUrl = config.API_URL;
    }
    
    async request(endpoint, params = {}) {
        try {
            const url = new URL(this.apiUrl);
            
            // Agregar acción como parámetro
            url.searchParams.append('accion', endpoint);
            
            // Agregar todos los parámetros
            Object.keys(params).forEach(key => {
                if (params[key] !== undefined && params[key] !== null) {
                    if (typeof params[key] === 'object') {
                        url.searchParams.append(key, JSON.stringify(params[key]));
                    } else {
                        url.searchParams.append(key, params[key].toString());
                    }
                }
            });
            
            const response = await fetch(url.toString(), {
                method: 'GET',
                mode: 'cors',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            return data;
            
        } catch (error) {
            console.error('API Error:', error);
            throw error;
        }
    }
    
    // Métodos específicos
    async verificarDispositivo(deviceToken) {
        return this.request('verificarDispositivo', { deviceToken });
    }
    
    async registrarDispositivo(empleadoId, pin, deviceToken) {
        return this.request('registrarDispositivo', { empleadoId, pin, deviceToken });
    }
    
    async verificarPIN(pin, deviceToken) {
        return this.request('verificarPIN', { pin, deviceToken });
    }
    
    async obtenerEstado(id, deviceToken) {
        return this.request('obtenerEstado', { id, deviceToken });
    }
    
    async guardarRegistro(data) {
        return this.request('guardarRegistro', data);
    }
    
    async obtenerRegistros(empleadoId) {
        return this.request('obtenerRegistros', { empleadoId });
    }
    
    async obtenerDatosSupervisor() {
        return this.request('obtenerDatosSupervisor', {});
    }
    
    async desvincularDispositivo(empleadoId, deviceToken) {
        return this.request('desvincularDispositivo', { empleadoId, deviceToken });
    }
    
    async verificarToken(token, empleadoId) {
        return this.request('verificarToken', { token, empleadoId });
    }
    
    async obtenerInfoEmpleado(id) {
        return this.request('obtenerInfoEmpleado', { id });
    }
}

// Crear instancia global
const api = new ApiClient(CONFIG);