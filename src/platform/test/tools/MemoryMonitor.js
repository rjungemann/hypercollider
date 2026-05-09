/**
 * MemoryMonitor - Real-time memory tracking for SuperCollider WASM
 * 
 * Usage:
 *   const monitor = new MemoryMonitor();
 *   monitor.sample('sclang-init');
 *   // ... code to measure ...
 *   monitor.sample('sclang-ready');
 *   monitor.report();
 */

class MemoryMonitor {
    constructor(options = {}) {
        this.samples = [];
        this.startTime = Date.now();
        this.enabled = options.enabled !== false;
        this.verbose = options.verbose || false;
        
        // Store options for context
        this.options = options;
        
        // Attempt to get WASM module reference if available
        this.wasmModule = options.wasmModule || null;
    }

    /**
     * Record a memory snapshot at a named point
     */
    sample(label, metadata = {}) {
        if (!this.enabled) return;

        const now = Date.now();
        const snapshot = {
            label,
            timestamp: now - this.startTime,
            metadata,
        };

        // JavaScript heap metrics (Chrome/Edge/some browsers)
        if (performance.memory) {
            snapshot.jsHeapUsed = performance.memory.usedJSHeapSize;
            snapshot.jsHeapTotal = performance.memory.totalJSHeapSize;
            snapshot.jsHeapLimit = performance.memory.jsHeapSizeLimit;
            
            // Convert to MB for easier reading
            snapshot.jsHeapUsedMB = (snapshot.jsHeapUsed / 1024 / 1024).toFixed(2);
            snapshot.jsHeapTotalMB = (snapshot.jsHeapTotal / 1024 / 1024).toFixed(2);
            snapshot.jsHeapLimitMB = (snapshot.jsHeapLimit / 1024 / 1024).toFixed(2);
        }

        // WASM module heap metrics (if available)
        if (this.wasmModule && this.wasmModule.HEAPU8) {
            snapshot.wasmHeapBytes = this.wasmModule.HEAPU8.buffer.byteLength;
            snapshot.wasmHeapMB = (snapshot.wasmHeapBytes / 1024 / 1024).toFixed(2);
        }

        // Calculate delta from previous sample
        if (this.samples.length > 0) {
            const prev = this.samples[this.samples.length - 1];
            snapshot.jsHeapDeltaMB = (
                (snapshot.jsHeapUsed - prev.jsHeapUsed) / 1024 / 1024
            ).toFixed(2);
            snapshot.timeDelta = snapshot.timestamp - prev.timestamp;
        }

        this.samples.push(snapshot);

        if (this.verbose) {
            console.log(`[MemoryMonitor] ${label}: ${snapshot.jsHeapUsedMB} MB (Δ${snapshot.jsHeapDeltaMB || 'init'} MB)`);
        }
    }

    /**
     * Get current memory usage
     */
    current() {
        if (this.samples.length === 0) return null;
        return this.samples[this.samples.length - 1];
    }

    /**
     * Calculate peak memory during profiling
     */
    peak() {
        if (this.samples.length === 0) return null;
        return this.samples.reduce((max, s) => 
            s.jsHeapUsed > (max.jsHeapUsed || 0) ? s : max
        );
    }

    /**
     * Print formatted table report
     */
    report() {
        console.group('[MemoryMonitor] Profiling Report');
        
        const tableData = this.samples.map(s => ({
            'Label': s.label,
            'Time (ms)': s.timestamp,
            'Heap Used (MB)': s.jsHeapUsedMB,
            'Heap Limit (MB)': s.jsHeapLimitMB,
            'Delta (MB)': s.jsHeapDeltaMB || '—',
            'WASM Heap (MB)': s.wasmHeapMB || '—',
        }));
        
        console.table(tableData);

        // Summary statistics
        const peak = this.peak();
        const current = this.current();
        const startSample = this.samples[0];
        
        console.log(`\n📊 Summary:`);
        console.log(`  Initial: ${startSample.jsHeapUsedMB} MB`);
        console.log(`  Peak: ${peak.jsHeapUsedMB} MB (${peak.label})`);
        console.log(`  Current: ${current.jsHeapUsedMB} MB`);
        console.log(`  Total Growth: ${(peak.jsHeapUsed - startSample.jsHeapUsed) / 1024 / 1024} MB`);
        console.log(`  Duration: ${current.timestamp} ms`);
        
        console.groupEnd();
    }

    /**
     * Export data as JSON for external analysis
     */
    exportJSON() {
        return JSON.stringify({
            timestamp: new Date().toISOString(),
            totalDuration: this.samples[this.samples.length - 1]?.timestamp || 0,
            samples: this.samples.map(s => ({
                label: s.label,
                time: s.timestamp,
                jsHeapUsedMB: parseFloat(s.jsHeapUsedMB),
                jsHeapLimitMB: parseFloat(s.jsHeapLimitMB),
                deltaMB: s.jsHeapDeltaMB ? parseFloat(s.jsHeapDeltaMB) : null,
                wasmHeapMB: s.wasmHeapMB ? parseFloat(s.wasmHeapMB) : null,
                metadata: s.metadata,
            })),
        }, null, 2);
    }

    /**
     * Export data as CSV for spreadsheet analysis
     */
    exportCSV() {
        const headers = [
            'Label',
            'Time (ms)',
            'JS Heap Used (MB)',
            'JS Heap Limit (MB)',
            'Delta (MB)',
            'WASM Heap (MB)',
            'Metadata'
        ];
        
        const rows = this.samples.map(s => [
            s.label,
            s.timestamp,
            s.jsHeapUsedMB,
            s.jsHeapLimitMB,
            s.jsHeapDeltaMB || '',
            s.wasmHeapMB || '',
            JSON.stringify(s.metadata),
        ]);
        
        return [
            headers.join(','),
            ...rows.map(r => r.join(','))
        ].join('\n');
    }

    /**
     * Download exported data as file
     */
    downloadJSON(filename = 'memory_profile.json') {
        const data = this.exportJSON();
        this._downloadFile(data, filename, 'application/json');
    }

    downloadCSV(filename = 'memory_profile.csv') {
        const data = this.exportCSV();
        this._downloadFile(data, filename, 'text/csv');
    }

    _downloadFile(data, filename, mimeType) {
        const blob = new Blob([data], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    /**
     * Hook into sclang initialization for automatic sampling
     */
    hookSCLang() {
        console.log('[MemoryMonitor] Installing sclang hooks');
        
        // Sample at key SC lifecycle points
        // These would be called from sc_ide.js or similar
        window.memoryMonitor = this;
        
        return {
            atBoot: () => this.sample('sc-boot-start'),
            atReady: () => this.sample('sc-ready'),
            atIntrospection: () => this.sample('sc-introspection-complete'),
            atServerBoot: () => this.sample('server-boot-start'),
            atServerRunning: () => this.sample('server-running'),
        };
    }
}

// Export for use in browser or Node.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MemoryMonitor;
}
