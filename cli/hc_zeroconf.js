'use strict';

/**
 * hc_zeroconf.js - mDNS/Bonjour service advertisement and discovery
 *
 * Phase B1-B2: Bonjour/mDNS support for hypercollider
 *
 * Provides:
 *   - advertiseServer() : publish hcsynth OSC servers via mDNS
 *   - browseLan()       : discover OSC servers on the local network
 *
 * Uses bonjour-service (pure JS) as the primary implementation.
 * Falls back to no-op stubs if the package is not installed.
 */

let Bonjour;
try {
  Bonjour = require('bonjour-service');
} catch (_) {
  // bonjour-service not installed — provide no-op stubs
}

/**
 * Advertise an hcsynth server instance over mDNS/Bonjour.
 *
 * @param {object} opts
 * @param {string}  [opts.name='SuperCollider'] - Service name
 * @param {number}  [opts.udpPort]   - UDP OSC port (advertises _osc._udp)
 * @param {number}  [opts.tcpPort]   - TCP OSC port (advertises _osc._tcp)
 * @param {number}  [opts.oscQueryPort] - OSCQuery HTTP port (advertises _oscjson._tcp)
 * @param {object}  [opts.logger]   - Logger with .info() / .warn()
 * @returns {{ unpublish(): Promise<void> }} - Handle to stop advertisement
 */
function advertiseServer({ name = 'SuperCollider', udpPort, tcpPort, oscQueryPort, logger } = {}) {
  if (!Bonjour) {
    logger?.warn('mDNS advertisement skipped: bonjour-service not installed');
    return { unpublish: async () => {} };
  }

  const bonjour = new Bonjour();
  const services = [];

  if (udpPort) {
    const service = bonjour.publish({
      name,
      type: 'osc',
      protocol: 'udp',
      port: udpPort,
    });
    service.on('error', (err) => {
      logger?.warn(`mDNS _osc._udp error: ${err.message || err}`);
    });
    services.push(service);
    logger?.info(`mDNS: advertising _osc._udp "${name}" on port ${udpPort}`);
  }

  if (tcpPort) {
    const service = bonjour.publish({
      name,
      type: 'osc',
      protocol: 'tcp',
      port: tcpPort,
    });
    service.on('error', (err) => {
      logger?.warn(`mDNS _osc._tcp error: ${err.message || err}`);
    });
    services.push(service);
    logger?.info(`mDNS: advertising _osc._tcp "${name}" on port ${tcpPort}`);
  }

  if (oscQueryPort) {
    const service = bonjour.publish({
      name,
      type: 'oscjson',
      protocol: 'tcp',
      port: oscQueryPort,
      txt: {
        osc_port: String(udpPort || tcpPort || 57110),
        osc_transport: udpPort ? 'UDP' : 'TCP',
      },
    });
    service.on('error', (err) => {
      logger?.warn(`mDNS _oscjson._tcp error: ${err.message || err}`);
    });
    services.push(service);
    logger?.info(`mDNS: advertising _oscjson._tcp "${name}" on port ${oscQueryPort}`);
  }

  return {
    async unpublish() {
      await Promise.all(services.map(s => new Promise(resolve => s.stop(resolve))));
      bonjour.destroy();
    },
  };
}

/**
 * Browse for SuperCollider OSC services on the LAN.
 *
 * @param {object} opts
 * @param {Function} [opts.onFound]  - callback(name, host, port, protocol)
 * @param {Function} [opts.onLost]   - callback(name)
 * @param {string}  [opts.type='osc'] - Service type to browse for ('osc' or 'oscjson')
 * @param {object}  [opts.logger]   - Logger with .info() / .warn()
 * @returns {{ stop(): void }} - Handle to stop browsing
 */
function browseLan({ onFound, onLost, type = 'osc', logger } = {}) {
  if (!Bonjour) {
    logger?.warn('mDNS browsing skipped: bonjour-service not installed');
    return { stop: () => {} };
  }

  const bonjour = new Bonjour();
  const browser = bonjour.find({ type });

  browser.on('up', (service) => {
    const { name, host, port, protocol } = service;
    logger?.info(`mDNS: found _${type}._${protocol} "${name}" at ${host}:${port}`);
    onFound?.(name, host, port, protocol);
  });

  browser.on('down', (service) => {
    logger?.info(`mDNS: lost _${type}._${service.protocol} "${service.name}"`);
    onLost?.(service.name);
  });

  browser.on('error', (err) => {
    logger?.warn(`mDNS browser error: ${err.message || err}`);
  });

  return {
    stop() {
      browser.stop();
      bonjour.destroy();
    },
  };
}

module.exports = { advertiseServer, browseLan };
