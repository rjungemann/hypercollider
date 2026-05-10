'use strict';
const http = require('node:http');

// Static scsynth OSC address namespace (OSCQuery host_info + root node)
const SCSYNTH_NAMESPACE = {
  FULL_PATH: '/',
  CONTENTS: {
    notify:     { FULL_PATH: '/notify',     TYPE: ',i',    DESCRIPTION: 'Enable/disable server notifications', ACCESS: 1 },
    status:     { FULL_PATH: '/status',     TYPE: ',',     DESCRIPTION: 'Request server status', ACCESS: 1 },
    quit:       { FULL_PATH: '/quit',       TYPE: ',',     DESCRIPTION: 'Quit scsynth', ACCESS: 1 },
    version:    { FULL_PATH: '/version',    TYPE: ',',     DESCRIPTION: 'Request version string', ACCESS: 1 },
    d_recv:     { FULL_PATH: '/d_recv',     TYPE: ',b',    DESCRIPTION: 'Receive a compiled SynthDef', ACCESS: 1 },
    d_load:     { FULL_PATH: '/d_load',     TYPE: ',s',    DESCRIPTION: 'Load a SynthDef from path', ACCESS: 1 },
    d_loadDir:  { FULL_PATH: '/d_loadDir',  TYPE: ',s',    DESCRIPTION: 'Load all SynthDefs from directory', ACCESS: 1 },
    d_free:     { FULL_PATH: '/d_free',     TYPE: ',s',    DESCRIPTION: 'Free a SynthDef by name', ACCESS: 1 },
    n_free:     { FULL_PATH: '/n_free',     TYPE: ',i',    DESCRIPTION: 'Free a node', ACCESS: 1 },
    n_run:      { FULL_PATH: '/n_run',      TYPE: ',ii',   DESCRIPTION: 'Set node running state', ACCESS: 1 },
    n_set:      { FULL_PATH: '/n_set',      TYPE: ',isf',  DESCRIPTION: 'Set a named node control', ACCESS: 1 },
    n_setn:     { FULL_PATH: '/n_setn',     TYPE: ',iif',  DESCRIPTION: 'Set a range of node controls', ACCESS: 1 },
    n_fill:     { FULL_PATH: '/n_fill',     TYPE: ',iiif', DESCRIPTION: 'Fill a range of node controls', ACCESS: 1 },
    n_map:      { FULL_PATH: '/n_map',      TYPE: ',isi',  DESCRIPTION: 'Map a control bus to a node control', ACCESS: 1 },
    n_mapn:     { FULL_PATH: '/n_mapn',     TYPE: ',isii', DESCRIPTION: 'Map a range of control buses', ACCESS: 1 },
    n_before:   { FULL_PATH: '/n_before',   TYPE: ',ii',   DESCRIPTION: 'Move node before another', ACCESS: 1 },
    n_after:    { FULL_PATH: '/n_after',    TYPE: ',ii',   DESCRIPTION: 'Move node after another', ACCESS: 1 },
    n_query:    { FULL_PATH: '/n_query',    TYPE: ',i',    DESCRIPTION: 'Query node info', ACCESS: 1 },
    n_trace:    { FULL_PATH: '/n_trace',    TYPE: ',i',    DESCRIPTION: 'Trace a node', ACCESS: 1 },
    n_order:    { FULL_PATH: '/n_order',    TYPE: ',iii',  DESCRIPTION: 'Reorder nodes', ACCESS: 1 },
    s_new:      { FULL_PATH: '/s_new',      TYPE: ',siii', DESCRIPTION: 'Create a new synth', ACCESS: 1 },
    s_get:      { FULL_PATH: '/s_get',      TYPE: ',is',   DESCRIPTION: 'Get a synth control value', ACCESS: 1 },
    s_getn:     { FULL_PATH: '/s_getn',     TYPE: ',iii',  DESCRIPTION: 'Get a range of synth controls', ACCESS: 1 },
    s_noid:     { FULL_PATH: '/s_noid',     TYPE: ',i',    DESCRIPTION: 'Auto-free synth on n_end', ACCESS: 1 },
    g_new:      { FULL_PATH: '/g_new',      TYPE: ',iii',  DESCRIPTION: 'Create a new group', ACCESS: 1 },
    g_head:     { FULL_PATH: '/g_head',     TYPE: ',ii',   DESCRIPTION: 'Move node to head of group', ACCESS: 1 },
    g_tail:     { FULL_PATH: '/g_tail',     TYPE: ',ii',   DESCRIPTION: 'Move node to tail of group', ACCESS: 1 },
    g_freeAll:  { FULL_PATH: '/g_freeAll',  TYPE: ',i',    DESCRIPTION: 'Free all nodes in a group', ACCESS: 1 },
    g_deepFree: { FULL_PATH: '/g_deepFree', TYPE: ',i',    DESCRIPTION: 'Deep-free all nodes in a group', ACCESS: 1 },
    g_queryTree:{ FULL_PATH: '/g_queryTree',TYPE: ',ii',   DESCRIPTION: 'Query group node tree', ACCESS: 1 },
    g_dumpTree: { FULL_PATH: '/g_dumpTree', TYPE: ',ii',   DESCRIPTION: 'Dump group tree to post window', ACCESS: 1 },
    p_new:      { FULL_PATH: '/p_new',      TYPE: ',iii',  DESCRIPTION: 'Create a new parallel group', ACCESS: 1 },
    b_alloc:    { FULL_PATH: '/b_alloc',    TYPE: ',iii',  DESCRIPTION: 'Allocate a buffer', ACCESS: 1 },
    b_allocRead:{ FULL_PATH: '/b_allocRead',TYPE: ',isii', DESCRIPTION: 'Allocate buffer and read soundfile', ACCESS: 1 },
    b_read:     { FULL_PATH: '/b_read',     TYPE: ',isiii',DESCRIPTION: 'Read soundfile into existing buffer', ACCESS: 1 },
    b_write:    { FULL_PATH: '/b_write',    TYPE: ',isssii',DESCRIPTION: 'Write buffer to soundfile', ACCESS: 1 },
    b_free:     { FULL_PATH: '/b_free',     TYPE: ',i',    DESCRIPTION: 'Free a buffer', ACCESS: 1 },
    b_zero:     { FULL_PATH: '/b_zero',     TYPE: ',i',    DESCRIPTION: 'Zero a buffer', ACCESS: 1 },
    b_set:      { FULL_PATH: '/b_set',      TYPE: ',iif',  DESCRIPTION: 'Set buffer sample values', ACCESS: 1 },
    b_setn:     { FULL_PATH: '/b_setn',     TYPE: ',iiif', DESCRIPTION: 'Set a range of buffer samples', ACCESS: 1 },
    b_fill:     { FULL_PATH: '/b_fill',     TYPE: ',iiif', DESCRIPTION: 'Fill buffer samples', ACCESS: 1 },
    b_gen:      { FULL_PATH: '/b_gen',      TYPE: ',is',   DESCRIPTION: 'Call a buffer gen command', ACCESS: 1 },
    b_close:    { FULL_PATH: '/b_close',    TYPE: ',i',    DESCRIPTION: 'Close soundfile (NRT)', ACCESS: 1 },
    b_query:    { FULL_PATH: '/b_query',    TYPE: ',i',    DESCRIPTION: 'Query buffer info', ACCESS: 1 },
    b_get:      { FULL_PATH: '/b_get',      TYPE: ',ii',   DESCRIPTION: 'Get a buffer sample value', ACCESS: 1 },
    b_getn:     { FULL_PATH: '/b_getn',     TYPE: ',iii',  DESCRIPTION: 'Get a range of buffer samples', ACCESS: 1 },
    c_set:      { FULL_PATH: '/c_set',      TYPE: ',if',   DESCRIPTION: 'Set a control bus value', ACCESS: 1 },
    c_setn:     { FULL_PATH: '/c_setn',     TYPE: ',iif',  DESCRIPTION: 'Set a range of control bus values', ACCESS: 1 },
    c_fill:     { FULL_PATH: '/c_fill',     TYPE: ',iiif', DESCRIPTION: 'Fill control buses', ACCESS: 1 },
    c_get:      { FULL_PATH: '/c_get',      TYPE: ',i',    DESCRIPTION: 'Get a control bus value', ACCESS: 1 },
    c_getn:     { FULL_PATH: '/c_getn',     TYPE: ',ii',   DESCRIPTION: 'Get a range of control bus values', ACCESS: 1 },
    u_cmd:      { FULL_PATH: '/u_cmd',      TYPE: ',iiis', DESCRIPTION: 'Send a UGen command', ACCESS: 1 },
  },
};

/**
 * Start an OSCQuery HTTP server.
 *
 * Serves the scsynth OSC namespace as JSON per the OSCQuery spec:
 *   GET /          → full namespace document
 *   GET /<address> → single address node (e.g. GET /s_new)
 *
 * CORS headers allow the browser IDE to fetch without a proxy.
 * mDNS advertisement for _oscjson._tcp is handled by hcsynth.js via hc_zeroconf.js.
 *
 * @param {object} opts
 * @param {number}  opts.port      - HTTP port to listen on
 * @param {number}  opts.oscPort   - OSC UDP port (included in HOST_INFO)
 * @param {object}  opts.logger    - logger with .info() / .warn()
 * @returns {Promise<{ port: number, close(): Promise<void> }>}
 */
function createOscQueryServer({ port, oscPort, logger } = {}) {
  const hostInfo = {
    NAME: 'hcsynth',
    OSC_PORT: oscPort || 57110,
    OSC_TRANSPORT: 'UDP',
    EXTENSIONS: { ACCESS: true, VALUE: false, RANGE: false, DESCRIPTION: true },
  };

  const server = http.createServer((req, res) => {
    if (req.method !== 'GET') {
      res.writeHead(405);
      res.end('Method Not Allowed');
      return;
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');

    const reqPath = req.url.split('?')[0];

    if (reqPath === '/host_info') {
      res.writeHead(200);
      res.end(JSON.stringify(hostInfo, null, 2));
      return;
    }

    if (reqPath === '/' || reqPath === '') {
      res.writeHead(200);
      res.end(JSON.stringify(SCSYNTH_NAMESPACE, null, 2));
      return;
    }

    const key = reqPath.replace(/^\//, '');
    const node = SCSYNTH_NAMESPACE.CONTENTS[key];
    if (node) {
      res.writeHead(200);
      res.end(JSON.stringify(node, null, 2));
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: `Unknown OSC address: ${reqPath}` }));
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      if (logger && typeof logger.info === 'function') {
        logger.info(`OSCQuery HTTP server on http://127.0.0.1:${port} (OSC UDP port: ${oscPort || 57110})`);
      }
      resolve({
        port,
        close() { return new Promise(r => server.close(r)); },
      });
    });
  });
}

module.exports = { createOscQueryServer, SCSYNTH_NAMESPACE };
