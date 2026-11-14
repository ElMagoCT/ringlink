// "Control over USB": the rings' own control page (control.html), but its /api/ requests travel over
// Web Serial to the ring plugged into this computer:  @<id> <GET|POST> <path> <form body>
// The ring passes them to the leader ring and answers  @<id> <status> <json>.
(() => {
  const realFetch = window.fetch.bind(window);
  const enc = new TextEncoder(), dec = new TextDecoder();
  const pending = new Map();
  let port = null, writer = null, reader = null, nextId = 1;

  async function readLoop() {
    let buf = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).replace(/\r$/, '');
          buf = buf.slice(i + 1);
          const m = line.match(/^@(\d+) (\d+) ?(.*)$/);
          if (m && pending.has(+m[1])) { pending.get(+m[1])(+m[2], m[3]); pending.delete(+m[1]); }
        }
      }
    } catch (e) { /* unplugged */ }
    disconnected('The ring was unplugged.');
  }

  function disconnected(msg) {
    try { reader && reader.releaseLock(); } catch (e) {}
    try { writer && writer.releaseLock(); } catch (e) {}
    if (port) port.close().catch(() => {});
    port = writer = reader = null;
    for (const [, done] of pending) done(503, '{"err":"unplugged"}');
    pending.clear();
    gate(true, msg);
  }

  async function connect() {
    if (!('serial' in navigator)) { gate(true, "This browser can't use USB. Open this page in Chrome or Edge on a computer."); return; }
    try {
      const known = (await navigator.serial.getPorts()).filter(p => p.getInfo().usbVendorId === 0x303a);
      port = known.length === 1 ? known[0] : await navigator.serial.requestPort({ filters: [{ usbVendorId: 0x303a }] });
      await port.open({ baudRate: 115200 });
      try { await port.setSignals({ dataTerminalReady: false, requestToSend: false }); } catch (e) {}
      writer = port.writable.getWriter();
      reader = port.readable.getReader();
      readLoop();
      gate(false);
      if (typeof poll === 'function') poll();
    } catch (e) {
      port = null;
      gate(true, /open/i.test(e.message) ? 'That port is busy. Close the flasher tab or other programs using the ring, then try again.' : (e.name === 'NotFoundError' ? 'No port picked.' : e.message));
    }
  }

  // Route the control page's /api/ calls over USB; everything else goes to the network as usual.
  window.fetch = (url, opts = {}) => {
    const u = String(url);
    if (!u.startsWith('/api/')) return realFetch(url, opts);
    if (!writer) return Promise.reject(new Error('not connected'));
    const id = nextId++;
    const method = (opts.method || 'GET').toUpperCase();
    const body = opts.body ? String(opts.body).replace(/[\r\n]/g, '') : '';
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('timeout')); }, 15000);
      pending.set(id, (status, text) => {
        clearTimeout(timer);
        resolve(new Response(text || '{}', { status: status >= 200 && status <= 599 ? status : 502, headers: { 'Content-Type': 'application/json' } }));
      });
      writer.write(enc.encode(`@${id} ${method} ${u} ${body}\n`)).catch(e => { pending.delete(id); clearTimeout(timer); reject(e); });
    });
  };

  function gate(show, msg) {
    const g = document.getElementById('usbgate');
    if (!g) return;
    g.style.display = show ? 'flex' : 'none';
    document.getElementById('usbmsg').textContent = msg || '';
  }

  document.addEventListener('DOMContentLoaded', () => {
    const g = document.createElement('div');
    g.id = 'usbgate';
    g.style.cssText = 'position:fixed;inset:0;z-index:30;background:var(--bg);display:flex;align-items:center;justify-content:center;padding:24px';
    g.innerHTML = `<div class="card" style="width:100%;max-width:400px;text-align:center">
      <h1 style="margin-bottom:6px">LED Rings over USB</h1>
      <div class="sub" style="margin-bottom:14px">Plug any ring into this computer with a USB-C data cable. It passes your controls to every ring that's on, over their radio.</div>
      <button class="btn pri" id="usbgo" style="width:100%">Connect</button>
      <div class="hint" id="usbmsg" style="color:var(--warn)"></div>
      <div class="hint" style="margin-top:12px"><a href="./" style="color:var(--acc)">Back to the flasher</a></div></div>`;
    document.body.appendChild(g);
    document.getElementById('usbgo').onclick = connect;
    // Firmware updates over USB go through the flasher's Install button instead.
    // (keep the card's elements - the page updates them on every poll - and just hide the upload row)
    const fw = document.getElementById('fwinfo'), file = document.getElementById('fwfile');
    if (fw && file) {
      file.closest('.row').style.display = 'none';
      fw.style.display = 'none';
      const note = document.createElement('div');
      note.className = 'hint';
      note.innerHTML = 'Over USB, update this ring with the Install button on the <a href="./" style="color:var(--acc)">flasher page</a>. To update every ring at once, join the LED-Rings Wi-Fi and use the controls there.';
      fw.closest('.card').appendChild(note);
    }
    const sum = document.getElementById('sum');
    if (sum) sum.title = 'Connected over USB';
  });
})();
