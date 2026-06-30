// =====================================================
// TCONTROL Logger — sistema centralizado de logs
// Niveles: DEBUG < INFO < WARN < ERROR
// Buffer circular de 200 entradas accesible desde
// la página de diagnóstico o la consola del navegador.
// =====================================================

(function () {
    const BUFFER_SIZE = 200;
    const PROD = location.hostname !== 'localhost' && !location.hostname.startsWith('127.');

    // En producción solo se emiten WARN y ERROR a la consola
    const MIN_CONSOLE_LEVEL = PROD ? 2 : 0; // 0=DEBUG,1=INFO,2=WARN,3=ERROR

    const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
    const LABELS = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
    const CONSOLE_FN = [
        console.debug.bind(console),
        console.info.bind(console),
        console.warn.bind(console),
        console.error.bind(console),
    ];

    let buffer = [];

    function log(level, tag, msg, data) {
        const entry = {
            ts: new Date().toISOString(),
            level: LABELS[level],
            tag,
            msg,
            data: data !== undefined ? data : null,
        };
        buffer.push(entry);
        if (buffer.length > BUFFER_SIZE) buffer.shift();

        if (level >= MIN_CONSOLE_LEVEL) {
            const prefix = `[TC:${tag}]`;
            if (data !== undefined) {
                CONSOLE_FN[level](prefix, msg, data);
            } else {
                CONSOLE_FN[level](prefix, msg);
            }
        }
    }

    window.TCLogger = {
        debug: (tag, msg, data) => log(LEVELS.DEBUG, tag, msg, data),
        info:  (tag, msg, data) => log(LEVELS.INFO,  tag, msg, data),
        warn:  (tag, msg, data) => log(LEVELS.WARN,  tag, msg, data),
        error: (tag, msg, data) => log(LEVELS.ERROR, tag, msg, data),

        // Devuelve una copia del buffer para diagnóstico
        getLogs: () => [...buffer],

        // Descarga los logs como JSON — útil para soporte
        download: () => {
            const blob = new Blob(
                [JSON.stringify(buffer, null, 2)],
                { type: 'application/json' }
            );
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `tcontrol-logs-${Date.now()}.json`;
            a.click();
        },
    };

    // ===== HANDLERS GLOBALES =====

    window.addEventListener('error', (e) => {
        window.TCLogger.error('GlobalError', e.message, {
            source: e.filename,
            line: e.lineno,
            col: e.colno,
            stack: e.error?.stack,
        });
    });

    window.addEventListener('unhandledrejection', (e) => {
        const reason = e.reason;
        window.TCLogger.error('UnhandledPromise', reason?.message || String(reason), {
            stack: reason?.stack,
        });
    });

    TCLogger.info('Logger', 'TCLogger iniciado', { prod: PROD });
})();
